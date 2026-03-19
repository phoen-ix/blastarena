import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { escapeHtml } from '../../utils/html';
import { GameState, ReplayData } from '@blast-arena/shared';
import game from '../../main';

export class MatchesTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private page = 1;
  private isAdmin = false;

  constructor(notifications: NotificationUI, isAdmin = false) {
    this.notifications = notifications;
    this.isAdmin = isAdmin;
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

      const colCount = this.isAdmin ? 9 : 8;
      this.container.innerHTML = `
        ${this.isAdmin && result.total > 0 ? `<div style="margin-bottom:10px;display:flex;justify-content:flex-end;">
          <button class="btn btn-secondary" id="delete-all-matches" style="font-size:12px;padding:5px 12px;color:var(--danger);border-color:var(--danger);">Delete All Matches</button>
        </div>` : ''}
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
              ${this.isAdmin ? '<th>Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${result.matches
              .map(
                (m: any) => `
              <tr style="cursor:pointer;" data-match-id="${m.id}">
                <td>${m.id}</td>
                <td>${escapeHtml(m.room_code)}</td>
                <td>${escapeHtml(m.game_mode)}</td>
                <td>${m.player_count}</td>
                <td>${m.duration ? `${m.duration}s` : '-'}</td>
                <td>${m.winner_username ? escapeHtml(m.winner_username) : '-'}</td>
                <td><span class="badge badge-${this.statusBadgeClass(m)}">${this.statusLabel(m)}</span></td>
                <td>${m.started_at ? new Date(m.started_at).toLocaleString() : '-'}</td>
                ${this.isAdmin ? `<td><button class="btn btn-secondary delete-match-btn" data-delete-match="${m.id}" style="font-size:11px;padding:2px 8px;color:var(--danger);border-color:var(--danger);">Delete</button></td>` : ''}
              </tr>
            `,
              )
              .join('')}
            ${result.matches.length === 0 ? `<tr><td colspan="${colCount}" style="text-align:center;color:var(--text-dim);">No matches found</td></tr>` : ''}
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

    // Delete single match
    if (target.dataset.deleteMatch) {
      e.stopPropagation();
      const matchId = parseInt(target.dataset.deleteMatch);
      if (!confirm(`Delete match #${matchId}? This will also delete its replay if one exists.`)) return;
      try {
        await ApiClient.delete(`/admin/matches/${matchId}`);
        this.notifications.success(`Match #${matchId} deleted`);
        await this.loadMatches();
      } catch {
        this.notifications.error('Failed to delete match');
      }
      return;
    }

    // Delete all matches
    if (target.id === 'delete-all-matches' || target.closest('#delete-all-matches')) {
      if (!confirm('Delete ALL matches and their replays? This cannot be undone.')) return;
      try {
        const result = await ApiClient.delete<{ count: number; replaysCleaned: number }>('/admin/matches');
        this.notifications.success(`Deleted ${result.count} matches, ${result.replaysCleaned} replays cleaned`);
        this.page = 1;
        await this.loadMatches();
      } catch {
        this.notifications.error('Failed to delete matches');
      }
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

      // Use replay placements (includes bots) if available, otherwise DB players
      const useReplayPlayers = match.allPlayers && match.allPlayers.length > 0;
      const playerList = useReplayPlayers ? match.allPlayers : match.players;

      const playerRows = playerList
        .map((p: any) => {
          // Replay placements use different field names than DB players
          const name = p.username ?? p.name ?? '?';
          const isBot = p.isBot ?? false;
          const placement = p.placement ?? '-';
          const kills = p.kills ?? 0;
          const selfKills = p.selfKills ?? 0;
          const team = p.team;
          const alive = p.alive ?? false;
          const isWinner =
            (p.userId ?? p.id) === match.winnerId ||
            (placement === 1 && alive);
          const displayName =
            escapeHtml(name) +
            (isBot ? ' <span style="color:var(--text-dim);">(bot)</span>' : '') +
            (isWinner ? ' <span style="color:#ffd700;">&#9733;</span>' : '');
          const rowStyle = !alive ? 'color:var(--text-dim);' : '';

          return `
            <tr style="${rowStyle}">
              <td>${placement}</td>
              <td>${displayName}</td>
              <td>${team !== null && team !== undefined ? `Team ${team + 1}` : '-'}</td>
              <td>${kills}${selfKills > 0 ? ` <span style="color:var(--danger);font-size:11px;">(-${selfKills})</span>` : ''}</td>
            </tr>`;
        })
        .join('');

      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:520px;">
          <h2 style="margin-bottom:16px;">Match #${match.id} Details</h2>
          <div style="margin-bottom:16px;">
            <div class="match-detail-row"><span class="label">Room Code:</span><span class="value">${escapeHtml(match.roomCode)}</span></div>
            <div class="match-detail-row"><span class="label">Game Mode:</span><span class="value">${escapeHtml(match.gameMode)}</span></div>
            <div class="match-detail-row"><span class="label">Map:</span><span class="value">${match.mapWidth}x${match.mapHeight} (seed: ${match.mapSeed})</span></div>
            <div class="match-detail-row"><span class="label">Status:</span><span class="value">${match.status}</span></div>
            <div class="match-detail-row"><span class="label">Duration:</span><span class="value">${match.duration ? `${match.duration}s` : '-'}</span></div>
            <div class="match-detail-row"><span class="label">Started:</span><span class="value">${match.startedAt ? new Date(match.startedAt).toLocaleString() : '-'}</span></div>
            <div class="match-detail-row"><span class="label">Finished:</span><span class="value">${match.finishedAt ? new Date(match.finishedAt).toLocaleString() : '-'}</span></div>
          </div>
          <h3 style="margin-bottom:8px;">Players</h3>
          <div style="overflow-x:auto;">
            <table class="admin-table" style="font-size:13px;">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Team</th>
                  <th>Kills</th>
                </tr>
              </thead>
              <tbody>
                ${playerRows}
              </tbody>
            </table>
          </div>
          <div class="modal-actions" style="margin-top:16px;">
            ${match.hasReplay ? '<button class="btn btn-primary" id="match-watch-replay" style="margin-right:8px;">Watch Replay</button>' : ''}
            <button class="btn btn-secondary" id="match-detail-close">Close</button>
          </div>
        </div>
      `;
      document.getElementById('ui-overlay')!.appendChild(modal);
      modal.querySelector('#match-detail-close')!.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });

      // Watch Replay button
      const replayBtn = modal.querySelector('#match-watch-replay');
      if (replayBtn) {
        replayBtn.addEventListener('click', async () => {
          await this.launchReplay(matchId);
        });
      }
    } catch {
      this.notifications.error('Failed to load match details');
    }
  }

  private async launchReplay(matchId: number): Promise<void> {
    try {
      this.notifications.info('Loading replay...');
      const replayData = await ApiClient.get<ReplayData>(`/admin/replays/${matchId}`);

      if (!replayData || !replayData.frames || replayData.frames.length === 0) {
        this.notifications.error('Replay data is empty or corrupted');
        return;
      }

      // Reconstruct initial GameState from first frame + stored map
      const firstFrame = replayData.frames[0];
      const initialState: GameState = {
        tick: firstFrame.tick,
        players: firstFrame.players,
        bombs: firstFrame.bombs,
        explosions: firstFrame.explosions,
        powerUps: firstFrame.powerUps,
        map: replayData.map,
        status: firstFrame.status,
        winnerId: firstFrame.winnerId,
        winnerTeam: firstFrame.winnerTeam,
        roundTime: firstFrame.roundTime,
        timeElapsed: firstFrame.timeElapsed,
      };
      if (firstFrame.zone) initialState.zone = firstFrame.zone;
      if (firstFrame.hillZone) initialState.hillZone = firstFrame.hillZone;
      if (firstFrame.kothScores) initialState.kothScores = firstFrame.kothScores;

      // Clear all DOM overlays (admin panel, lobby, etc.)
      const uiOverlay = document.getElementById('ui-overlay');
      if (uiOverlay) {
        while (uiOverlay.firstChild) {
          uiOverlay.removeChild(uiOverlay.firstChild);
        }
      }

      // Set registry values for GameScene
      const registry = game.registry;
      registry.set('initialGameState', initialState);
      registry.set('replayMode', true);
      registry.set('replayData', replayData);

      // Start GameScene and HUDScene
      const activeScene =
        game.scene.getScene('LobbyScene') || game.scene.getScene('MenuScene');
      if (activeScene) {
        activeScene.scene.start('GameScene');
        activeScene.scene.launch('HUDScene');
      }
    } catch {
      this.notifications.error('Failed to load replay');
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
}
