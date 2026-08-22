import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { t } from '../../i18n';
import { escapeHtml, setHtml } from '../../utils/html';

interface MatchEntry {
  id: number;
  gameMode: string;
  duration: number;
  finishedAt: string;
  playerCount: number;
  winnerUsername: string | null;
  placement: number;
  kills: number;
  deaths: number;
}

interface MatchHistoryResponse {
  matches: MatchEntry[];
  total: number;
  page: number;
  limit: number;
}

const MODE_LABELS: Record<string, string> = {
  ffa: 'FFA',
  teams: 'Teams',
  battle_royale: 'BR',
  sudden_death: 'SD',
  deathmatch: 'DM',
  koth: 'KOTH',
};

export class MatchHistoryView implements ILobbyView {
  readonly viewId = 'matchHistory';
  get title() {
    return t('ui:matchHistory.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private page = 1;
  private total = 0;

  constructor(deps: ViewDeps) {
    this.deps = deps;
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    this.page = 1;
    await this.loadPage();
  }

  destroy(): void {
    this.container = null;
  }

  private async loadPage(): Promise<void> {
    if (!this.container) return;

    setHtml(
      this.container,
      `<div style="padding:20px;color:var(--text-dim);text-align:center;">${t('ui:matchHistory.loading')}</div>`,
    );

    try {
      const data = await ApiClient.get<MatchHistoryResponse>(
        `/user/matches?page=${this.page}&limit=20`,
      );
      this.total = data.total;
      this.renderMatches(data);
    } catch {
      setHtml(
        this.container,
        `<div style="padding:20px;color:var(--danger);text-align:center;">${t('ui:matchHistory.error')}</div>`,
      );
    }
  }

  private renderMatches(data: MatchHistoryResponse): void {
    if (!this.container) return;
    const totalPages = Math.ceil(data.total / data.limit);

    if (data.matches.length === 0) {
      setHtml(
        this.container,
        `<div style="padding:40px;color:var(--text-dim);text-align:center;">${t('ui:matchHistory.noMatches')}</div>`,
      );
      return;
    }

    // Per-mode aggregate stats
    const modeStats = new Map<
      string,
      { wins: number; games: number; kills: number; deaths: number }
    >();
    // These are just for the current page, but we show them as a summary
    for (const m of data.matches) {
      const s = modeStats.get(m.gameMode) || { wins: 0, games: 0, kills: 0, deaths: 0 };
      s.games++;
      s.kills += m.kills;
      s.deaths += m.deaths;
      if (m.placement === 1) s.wins++;
      modeStats.set(m.gameMode, s);
    }

    const statsHtml = Array.from(modeStats.entries())
      .map(([mode, s]) => {
        const wr = s.games > 0 ? Math.round((s.wins / s.games) * 100) : 0;
        const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(1) : s.kills.toString();
        return `<div class="mini-stat"><div class="mini-stat-value">${MODE_LABELS[mode] || mode}</div><div class="mini-stat-label">${wr}% WR &middot; ${kd} K/D</div></div>`;
      })
      .join('');

    const rowsHtml = data.matches
      .map((m) => {
        const won = m.placement === 1;
        const resultClass = won ? 'color:var(--success)' : '';
        const resultText = won ? t('ui:matchHistory.win') : `#${m.placement}`;
        const duration = m.duration
          ? `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}`
          : '-';
        const date = m.finishedAt ? new Date(m.finishedAt).toLocaleDateString() : '-';
        return `<tr>
          <td>${MODE_LABELS[m.gameMode] || escapeHtml(m.gameMode)}</td>
          <td style="${resultClass};font-weight:bold;">${resultText}</td>
          <td>${m.kills}</td>
          <td>${m.deaths}</td>
          <td>${m.playerCount}</td>
          <td>${duration}</td>
          <td>${date}</td>
        </tr>`;
      })
      .join('');

    const prevDisabled = this.page <= 1 ? 'disabled' : '';
    const nextDisabled = this.page >= totalPages ? 'disabled' : '';

    setHtml(
      this.container,
      `
      <div style="padding:16px;">
        ${statsHtml ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;">${statsHtml}</div>` : ''}
        <table class="data-table">
          <thead>
            <tr>
              <th>${t('ui:matchHistory.mode')}</th>
              <th>${t('ui:matchHistory.result')}</th>
              <th>${t('ui:matchHistory.kills')}</th>
              <th>${t('ui:matchHistory.deaths')}</th>
              <th>${t('ui:matchHistory.players')}</th>
              <th>${t('ui:matchHistory.duration')}</th>
              <th>${t('ui:matchHistory.date')}</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${
          totalPages > 1
            ? `<div style="display:flex;justify-content:center;gap:12px;margin-top:12px;">
                <button class="btn btn-sm btn-ghost" id="mh-prev" ${prevDisabled}>&laquo; ${t('ui:matchHistory.prev')}</button>
                <span style="color:var(--text-dim);font-size:13px;line-height:30px;">${this.page} / ${totalPages}</span>
                <button class="btn btn-sm btn-ghost" id="mh-next" ${nextDisabled}>${t('ui:matchHistory.next')} &raquo;</button>
              </div>`
            : ''
        }
      </div>
    `,
    );

    // Pagination handlers
    this.container.querySelector('#mh-prev')?.addEventListener('click', () => {
      if (this.page > 1) {
        this.page--;
        this.loadPage();
      }
    });
    this.container.querySelector('#mh-next')?.addEventListener('click', () => {
      if (this.page < totalPages) {
        this.page++;
        this.loadPage();
      }
    });
  }
}
