import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { escapeHtml } from '../utils/html';
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

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="admin-header">
        <h1 style="color:var(--primary);margin:0;">Leaderboard</h1>
        <button class="btn btn-secondary" id="lb-back">Back to Lobby</button>
      </div>
      <div style="padding:0 24px 12px;display:flex;align-items:center;gap:12px;">
        <label style="color:var(--text-dim);font-size:13px;">Season:</label>
        <select id="lb-season-select" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:6px 10px;color:var(--text);font-size:13px;font-family:var(--font-body);outline:none;">
          <option value="">Loading...</option>
        </select>
      </div>
      <div id="lb-table-container" style="padding:0 24px 24px;">
        <div style="color:var(--text-dim);padding:40px 0;text-align:center;">Loading...</div>
      </div>
      <div id="lb-pagination" style="padding:0 24px 24px;display:flex;justify-content:center;align-items:center;gap:12px;"></div>
    `;

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
      const [seasonsData, tiersData] = await Promise.all([
        ApiClient.get<Season[]>('/leaderboard/seasons'),
        ApiClient.get<RankConfig>('/leaderboard/tiers'),
      ]);
      this.seasons = seasonsData;
      this.rankConfig = tiersData;
      this.populateSeasonSelect();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
    await this.loadLeaderboard();
  }

  private populateSeasonSelect(): void {
    const select = this.container.querySelector('#lb-season-select') as HTMLSelectElement;
    if (!select) return;

    const activeSeason = this.seasons.find((s) => s.isActive);
    if (activeSeason) this.currentSeasonId = activeSeason.id;

    select.innerHTML =
      this.seasons
        .map(
          (s) =>
            `<option value="${s.id}" ${s.id === this.currentSeasonId ? 'selected' : ''}>${escapeHtml(s.name)}${s.isActive ? ' (Current)' : ''}</option>`,
        )
        .join('') || '<option value="">No seasons</option>';
  }

  private async loadLeaderboard(): Promise<void> {
    const tableContainer = this.container.querySelector('#lb-table-container')!;
    tableContainer.innerHTML =
      '<div style="color:var(--text-dim);padding:40px 0;text-align:center;">Loading...</div>';

    try {
      let url = `/leaderboard?page=${this.currentPage}&limit=${PAGE_LIMIT}`;
      if (this.currentSeasonId) url += `&season_id=${this.currentSeasonId}`;
      const data = await ApiClient.get<LeaderboardResponse>(url);
      this.renderTable(data);
      this.renderPagination(data);
    } catch (err: unknown) {
      tableContainer.innerHTML = `<div style="color:var(--danger);padding:40px 0;text-align:center;">Failed to load leaderboard: ${escapeHtml(getErrorMessage(err))}</div>`;
    }
  }

  private renderTable(data: LeaderboardResponse): void {
    const tableContainer = this.container.querySelector('#lb-table-container')!;

    if (data.entries.length === 0) {
      tableContainer.innerHTML =
        '<div style="color:var(--text-dim);padding:40px 0;text-align:center;">No entries yet for this season.</div>';
      return;
    }

    tableContainer.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th style="width:60px;">#</th>
            <th>Player</th>
            <th style="width:80px;">Elo</th>
            <th style="width:120px;">Rank</th>
            <th style="width:70px;">Wins</th>
            <th style="width:70px;">Kills</th>
          </tr>
        </thead>
        <tbody>
          ${data.entries.map((e) => this.renderRow(e)).join('')}
        </tbody>
      </table>
    `;
  }

  private renderRow(entry: LeaderboardEntry): string {
    const rankBadge = `<span style="background:${escapeHtml(entry.rankColor)};color:#fff;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;">${escapeHtml(entry.rankTier)}</span>`;

    return `
      <tr>
        <td style="font-weight:700;color:var(--text-dim);">${entry.rank}</td>
        <td>
          <span data-user-id="${entry.userId}" style="color:var(--accent);cursor:pointer;font-weight:600;">${escapeHtml(entry.username)}</span>
        </td>
        <td style="font-weight:600;">${entry.eloRating}</td>
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
      paginationEl.innerHTML = '';
      return;
    }

    paginationEl.innerHTML = `
      <button class="btn btn-secondary" id="lb-prev" ${this.currentPage <= 1 ? 'disabled' : ''} style="padding:6px 14px;font-size:13px;">Prev</button>
      <span style="color:var(--text-dim);font-size:13px;">Page ${this.currentPage} of ${totalPages}</span>
      <button class="btn btn-secondary" id="lb-next" ${this.currentPage >= totalPages ? 'disabled' : ''} style="padding:6px 14px;font-size:13px;">Next</button>
    `;

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
