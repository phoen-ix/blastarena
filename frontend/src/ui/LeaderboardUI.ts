import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { escapeHtml, setHtml } from '../utils/html';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { t } from '../i18n';
import {
  LeaderboardResponse,
  LeaderboardEntry,
  Season,
  RankConfig,
  getErrorMessage,
} from '@blast-arena/shared';

const PAGE_LIMIT = 25;

export class LeaderboardUI {
  private container: HTMLElement;
  private notifications: NotificationUI;
  private onBack: () => void;
  private currentPage: number = 1;
  private currentSeasonId: number | null = null;
  private onViewProfile?: (userId: number) => void;
  private seasons: Season[] = [];
  private rankConfig: RankConfig | null = null;

  constructor(
    notifications: NotificationUI,
    onBack: () => void,
    onViewProfile?: (userId: number) => void,
  ) {
    this.notifications = notifications;
    this.onBack = onBack;
    this.onViewProfile = onViewProfile;
    this.container = document.createElement('div');
    this.container.className = 'admin-container';
  }

  show(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    this.currentPage = 1;
    this.renderShell();
    this.loadInitialData();
  }

  hide(): void {
    this.container.remove();
  }

  async renderEmbedded(container: HTMLElement): Promise<void> {
    this.container = container;
    setHtml(
      this.container,
      `
      <div class="view-content">
        <div class="lb-filter-bar">
          <label>${t('ui:leaderboard.season')}</label>
          <select id="lb-season-select" class="admin-select">
            <option value="">${t('ui:leaderboard.loading')}</option>
          </select>
        </div>
        <div id="lb-table-container" class="lb-content">
          <div class="lb-status">${t('ui:leaderboard.loading')}</div>
        </div>
        <div id="lb-pagination" class="admin-pagination"></div>
      </div>
    `,
    );

    this.container.querySelector('#lb-season-select')!.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this.currentSeasonId = val ? parseInt(val, 10) : null;
      this.currentPage = 1;
      this.loadLeaderboard();
    });

    this.container.addEventListener('click', (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-user-id]') as HTMLElement | null;
      if (target && this.onViewProfile) {
        this.onViewProfile(parseInt(target.dataset.userId!, 10));
      }
    });

    this.currentPage = 1;
    this.pushGamepadContext();
    await this.loadInitialData();
  }

  destroy(): void {
    UIGamepadNavigator.getInstance().popContext('leaderboard-ui');
  }

  private pushGamepadContext(): void {
    UIGamepadNavigator.getInstance().popContext('leaderboard-ui');
    UIGamepadNavigator.getInstance().pushContext({
      id: 'leaderboard-ui',
      elements: () => [
        ...this.container.querySelectorAll<HTMLElement>('#lb-season-select'),
        ...this.container.querySelectorAll<HTMLElement>('.lb-user-link'),
        ...this.container.querySelectorAll<HTMLElement>('#lb-prev, #lb-next'),
      ],
      onBack: () => {
        this.hide();
        this.onBack();
      },
    });
  }

  private renderShell(): void {
    setHtml(
      this.container,
      `
      <div class="admin-header">
        <h1>${t('ui:leaderboard.title')}</h1>
        <button class="btn btn-secondary" id="lb-back">${t('ui:leaderboard.backToLobby')}</button>
      </div>
      <div class="lb-filter-bar">
        <label>${t('ui:leaderboard.season')}</label>
        <select id="lb-season-select" class="admin-select">
          <option value="">${t('ui:leaderboard.loading')}</option>
        </select>
      </div>
      <div id="lb-table-container" class="lb-content">
        <div class="lb-status">${t('ui:leaderboard.loading')}</div>
      </div>
      <div id="lb-pagination" class="admin-pagination"></div>
    `,
    );

    this.container.querySelector('#lb-back')!.addEventListener('click', () => {
      this.hide();
      this.onBack();
    });

    this.container.querySelector('#lb-season-select')!.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      this.currentSeasonId = val ? parseInt(val, 10) : null;
      this.currentPage = 1;
      this.loadLeaderboard();
    });

    this.container.addEventListener('click', (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-user-id]') as HTMLElement | null;
      if (target && this.onViewProfile) {
        this.onViewProfile(parseInt(target.dataset.userId!, 10));
      }
    });
  }

  private async loadInitialData(): Promise<void> {
    try {
      const [seasonsResp, tiersData] = await Promise.all([
        ApiClient.get<{ seasons: Season[]; total: number }>('/leaderboard/seasons'),
        ApiClient.get<RankConfig>('/leaderboard/tiers'),
      ]);
      this.seasons = seasonsResp.seasons ?? [];
      this.rankConfig = tiersData;
      this.populateSeasonSelect();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
    await this.loadLeaderboard();
  }

  private populateSeasonSelect(): void {
    const filterBar = this.container.querySelector('.lb-filter-bar') as HTMLElement;
    if (!filterBar) return;

    if (this.seasons.length === 0) {
      filterBar.style.display = 'none';
      return;
    }

    const select = filterBar.querySelector('#lb-season-select') as HTMLSelectElement;
    if (!select) return;

    const activeSeason = this.seasons.find((s) => s.isActive);
    if (activeSeason) this.currentSeasonId = activeSeason.id;

    setHtml(
      select,
      this.seasons
        .map(
          (s) =>
            `<option value="${s.id}" ${s.id === this.currentSeasonId ? 'selected' : ''}>${escapeHtml(s.name)}${s.isActive ? t('ui:leaderboard.currentSeason') : ''}</option>`,
        )
        .join(''),
    );
  }

  private async loadLeaderboard(): Promise<void> {
    const tableContainer = this.container.querySelector('#lb-table-container')!;
    setHtml(tableContainer, `<div class="lb-status">${t('ui:leaderboard.loading')}</div>`);

    try {
      let url = `/leaderboard?page=${this.currentPage}&limit=${PAGE_LIMIT}`;
      if (this.currentSeasonId) url += `&season_id=${this.currentSeasonId}`;
      const data = await ApiClient.get<LeaderboardResponse>(url);
      this.renderTable(data);
      this.renderPagination(data);
    } catch (err: unknown) {
      setHtml(
        tableContainer,
        `<div class="lb-status error">${escapeHtml(t('ui:leaderboard.loadFailed', { error: getErrorMessage(err) }))}</div>`,
      );
    }
  }

  private renderTable(data: LeaderboardResponse): void {
    const tableContainer = this.container.querySelector('#lb-table-container')!;

    if (data.entries.length === 0) {
      setHtml(tableContainer, `<div class="lb-status">${t('ui:leaderboard.noEntries')}</div>`);
      return;
    }

    setHtml(
      tableContainer,
      `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:50px;">${t('ui:leaderboard.hashSymbol')}</th>
            <th>${t('ui:leaderboard.player')}</th>
            <th style="width:60px;">${t('ui:leaderboard.level')}</th>
            <th style="width:70px;">${t('ui:leaderboard.elo')}</th>
            <th style="width:110px;">${t('ui:leaderboard.rank')}</th>
            <th style="width:60px;">${t('ui:leaderboard.wins')}</th>
            <th style="width:60px;">${t('ui:leaderboard.kills')}</th>
          </tr>
        </thead>
        <tbody>
          ${data.entries.map((e) => this.renderRow(e)).join('')}
        </tbody>
      </table>
    `,
    );
  }

  private renderRow(entry: LeaderboardEntry): string {
    const rankBadge = `<span class="lb-rank-pill" style="background:${escapeHtml(entry.rankColor)}">${escapeHtml(entry.rankTier)}</span>`;

    return `
      <tr>
        <td class="lb-rank-col">${entry.rank}</td>
        <td>
          <span class="lb-user-link" data-user-id="${entry.userId}">${escapeHtml(entry.username)}</span>
        </td>
        <td><span class="lb-level-pill">${entry.level}</span></td>
        <td class="lb-elo-col">${entry.eloRating}</td>
        <td>${rankBadge}</td>
        <td>${entry.totalWins}</td>
        <td>${entry.totalKills}</td>
      </tr>
    `;
  }

  private renderPagination(data: LeaderboardResponse): void {
    const paginationEl = this.container.querySelector('#lb-pagination')!;
    const totalPages = Math.max(1, Math.ceil(data.total / data.limit));

    if (totalPages <= 1) {
      setHtml(paginationEl, '');
      return;
    }

    setHtml(
      paginationEl,
      `
      <button class="btn btn-secondary btn-sm" id="lb-prev" ${this.currentPage <= 1 ? 'disabled' : ''}>${t('ui:leaderboard.prev')}</button>
      <span class="page-info">${t('ui:leaderboard.pageInfo', { current: this.currentPage, total: totalPages })}</span>
      <button class="btn btn-secondary btn-sm" id="lb-next" ${this.currentPage >= totalPages ? 'disabled' : ''}>${t('ui:leaderboard.next')}</button>
    `,
    );

    paginationEl.querySelector('#lb-prev')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.loadLeaderboard();
      }
    });

    paginationEl.querySelector('#lb-next')?.addEventListener('click', () => {
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.loadLeaderboard();
      }
    });
  }
}
