import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';

export class MatchesTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private page = 1;

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    this.page = 1;
    await this.loadMatches();
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
  }

  private async loadMatches(): Promise<void> {
    if (!this.container) return;

    try {
      const result = await ApiClient.get<any>(`/admin/matches?page=${this.page}&limit=20`);
      const totalPages = Math.ceil(result.total / result.limit);

      this.container.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Room Code</th>
              <th>Game Mode</th>
              <th>Players</th>
              <th>Duration</th>
              <th>Winner</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            ${result.matches.map((m: any) => `
              <tr style="cursor:pointer;" data-match-id="${m.id}">
                <td>${m.id}</td>
                <td>${this.escapeHtml(m.room_code)}</td>
                <td>${this.escapeHtml(m.game_mode)}</td>
                <td>${m.player_count}</td>
                <td>${m.duration ? `${m.duration}s` : '-'}</td>
                <td>${m.winner_username ? this.escapeHtml(m.winner_username) : '-'}</td>
                <td><span class="badge badge-${this.statusBadgeClass(m)}">${this.statusLabel(m)}</span></td>
                <td>${m.started_at ? new Date(m.started_at).toLocaleString() : '-'}</td>
              </tr>
            `).join('')}
            ${result.matches.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);">No matches found</td></tr>' : ''}
          </tbody>
        </table>
        <div class="admin-pagination">
          <button ${this.page <= 1 ? 'disabled' : ''} data-page="${this.page - 1}">Prev</button>
          <span class="page-info">Page ${this.page} of ${totalPages} (${result.total} matches)</span>
          <button ${this.page >= totalPages ? 'disabled' : ''} data-page="${this.page + 1}">Next</button>
        </div>
      `;

      this.container.addEventListener('click', this.handleClick);
    } catch {
      this.container.innerHTML = '<div style="color:var(--danger);">Failed to load matches</div>';
    }
  }

  private handleClick = async (e: Event) => {
    const target = e.target as HTMLElement;

    if (target.dataset.page) {
      this.page = parseInt(target.dataset.page);
      await this.loadMatches();
      return;
    }

    // Click on table row to show detail
    const row = target.closest('tr[data-match-id]') as HTMLElement | null;
    if (row?.dataset.matchId) {
      await this.showMatchDetail(parseInt(row.dataset.matchId));
    }
  };

  private async showMatchDetail(matchId: number): Promise<void> {
    try {
      const match = await ApiClient.get<any>(`/admin/matches/${matchId}`);

      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:600px;">
          <h2 style="margin-bottom:16px;">Match #${match.id} Details</h2>
          <div style="margin-bottom:16px;">
            <div class="match-detail-row"><span class="label">Room Code:</span><span class="value">${this.escapeHtml(match.roomCode)}</span></div>
            <div class="match-detail-row"><span class="label">Game Mode:</span><span class="value">${this.escapeHtml(match.gameMode)}</span></div>
            <div class="match-detail-row"><span class="label">Map:</span><span class="value">${match.mapWidth}x${match.mapHeight} (seed: ${match.mapSeed})</span></div>
            <div class="match-detail-row"><span class="label">Status:</span><span class="value">${match.status}</span></div>
            <div class="match-detail-row"><span class="label">Duration:</span><span class="value">${match.duration ? `${match.duration}s` : '-'}</span></div>
            <div class="match-detail-row"><span class="label">Started:</span><span class="value">${match.startedAt ? new Date(match.startedAt).toLocaleString() : '-'}</span></div>
            <div class="match-detail-row"><span class="label">Finished:</span><span class="value">${match.finishedAt ? new Date(match.finishedAt).toLocaleString() : '-'}</span></div>
          </div>
          <h3 style="margin-bottom:8px;">Players</h3>
          <table class="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Team</th>
                <th>Kills</th>
                <th>Deaths</th>
                <th>Bombs</th>
                <th>Power-ups</th>
                <th>Survived</th>
              </tr>
            </thead>
            <tbody>
              ${match.players.map((p: any) => `
                <tr>
                  <td>${p.placement ?? '-'}</td>
                  <td>${this.escapeHtml(p.username)}${match.winnerId === p.userId ? ' <span style="color:#ffd700;">&#9733;</span>' : ''}</td>
                  <td>${p.team !== null ? `Team ${p.team + 1}` : '-'}</td>
                  <td>${p.kills}</td>
                  <td>${p.deaths}</td>
                  <td>${p.bombsPlaced}</td>
                  <td>${p.powerupsCollected}</td>
                  <td>${p.survivedSeconds}s</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="modal-actions" style="margin-top:16px;">
            <button class="btn btn-secondary" id="match-detail-close">Close</button>
          </div>
        </div>
      `;
      document.getElementById('ui-overlay')!.appendChild(modal);
      modal.querySelector('#match-detail-close')!.addEventListener('click', () => modal.remove());
    } catch {
      this.notifications.error('Failed to load match details');
    }
  }

  private statusBadgeClass(m: any): string {
    if (m.status === 'finished') return 'active';
    if (m.status === 'aborted') return 'deactivated';
    // playing/countdown without a finished_at is likely abandoned
    if ((m.status === 'playing' || m.status === 'countdown') && !m.finished_at) return 'banned';
    return 'user';
  }

  private statusLabel(m: any): string {
    if ((m.status === 'playing' || m.status === 'countdown') && !m.finished_at) return 'abandoned';
    return m.status;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
