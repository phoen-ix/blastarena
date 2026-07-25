import { ILobbyView, ViewDeps } from './types';
import { GameState, OpenWorldScoreEntry } from '@blast-arena/shared';
import { API_URL } from '../../config';
import { escapeHtml } from '../../utils/html';
import { t } from '../../i18n';
import { game } from '../../main';

interface OpenWorldStatus {
  enabled: boolean;
  playerCount: number;
  maxPlayers: number;
  roundTimeRemaining: number;
  roundNumber: number;
  guestAccess: boolean;
  leaderboard?: OpenWorldScoreEntry[];
}

interface OpenWorldInfo {
  playerCount: number;
  maxPlayers: number;
  roundTimeRemaining: number;
  roundNumber: number;
  leaderboard: OpenWorldScoreEntry[];
}

/** Callback payload from the `openworld:join` socket ack. */
interface OpenWorldJoinResponse {
  success: boolean;
  playerId?: number;
  username?: string;
  isGuest?: boolean;
  state?: GameState;
  error?: string;
  info?: { roundNumber: number; leaderboard: OpenWorldScoreEntry[] };
}

export class OpenWorldView implements ILobbyView {
  readonly viewId = 'openWorld';
  get title() {
    return t('ui:openWorld.title');
  }

  /** Track whether we've auto-joined this session (prevents re-join loop on game exit) */
  private static hasAutoJoined = false;

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private infoHandler: ((data: OpenWorldInfo) => void) | null = null;
  private roundEndHandler:
    | ((data: {
        roundNumber: number;
        leaderboard: OpenWorldScoreEntry[];
        nextRoundIn: number;
      }) => void)
    | null = null;
  private roundStartHandler: ((data: { roundNumber: number }) => void) | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private roundTimeRemaining = 0;

  constructor(deps: ViewDeps) {
    this.deps = deps;
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;

    // When auto-joining, hide the entire lobby UI so it doesn't flash over the canvas
    // while waiting for the server response. Restored on error or when showing the lobby.
    const willAutoJoin = !OpenWorldView.hasAutoJoined;
    const appLayout = container.closest('.app-layout') as HTMLElement | null;
    if (willAutoJoin && appLayout) {
      appLayout.style.display = 'none';
    }

    container.innerHTML = `<div class="panel-content" style="padding:2rem; text-align:center;">
      <p style="color:var(--text-muted); font-size:1.1rem;">${t('ui:openWorld.joining')}</p>
    </div>`;

    // Fetch current status
    let status: OpenWorldStatus | null = null;
    try {
      const res = await fetch(`${API_URL}/admin/settings/open_world/status`);
      if (res.ok) {
        status = await res.json();
      }
    } catch {
      // Fall through to disabled state
    }

    if (!status?.enabled) {
      if (appLayout) appLayout.style.display = '';
      container.innerHTML = `
        <div class="panel-content" style="padding:2rem; text-align:center;">
          <p style="color:var(--text-muted); font-size:1.1rem;">${t('ui:openWorld.disabled')}</p>
        </div>`;
      return;
    }

    this.roundTimeRemaining = status.roundTimeRemaining;
    this.bindSocketListeners();
    this.startTimerCountdown();

    if (willAutoJoin) {
      // First visit this session — auto-join immediately
      OpenWorldView.hasAutoJoined = true;
      this.joinWorld();
    } else {
      // Returning from game — show lobby with join button
      this.renderLobby(status);
    }
  }

  private renderLobby(status: OpenWorldStatus): void {
    if (!this.container) return;
    const timeStr = this.formatTime(this.roundTimeRemaining);

    this.container.innerHTML = `
      <div style="padding:1rem; max-width:500px; margin:0 auto; text-align:center;">
        <div class="panel-content" style="padding:1.5rem;">
          <div style="display:flex; justify-content:center; gap:1.5rem; margin-bottom:1rem;">
            <span class="mini-stat" id="ow-players">
              ${t('ui:openWorld.playerCount', { current: status.playerCount, max: status.maxPlayers })}
            </span>
            <span class="mini-stat" id="ow-round">${t('ui:openWorld.roundNumber', { number: status.roundNumber })}</span>
            <span class="mini-stat" id="ow-timer">${t('ui:openWorld.roundTimer', { time: timeStr })}</span>
          </div>
          <button class="btn btn-primary btn-lg" id="ow-join-btn" style="width:100%; max-width:280px;">
            ${t('ui:openWorld.joinButton')}
          </button>
        </div>
        <div class="panel-content" style="padding:1rem; margin-top:1rem;">
          <div class="panel-header" style="padding:0 0 0.5rem;">${t('ui:openWorld.leaderboard')}</div>
          <table class="data-table" id="ow-board">
            <thead>
              <tr>
                <th style="width:2rem;">${t('ui:leaderboard.hashSymbol')}</th>
                <th style="text-align:left;">${t('ui:leaderboard.player')}</th>
                <th>${t('ui:openWorld.kills')}</th>
                <th>${t('ui:openWorld.deaths')}</th>
                <th>${t('ui:openWorld.score')}</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>`;

    this.renderLeaderboard(status.leaderboard ?? []);

    this.container.querySelector('#ow-join-btn')?.addEventListener('click', () => {
      const btn = this.container?.querySelector('#ow-join-btn') as HTMLButtonElement;
      if (btn) {
        btn.disabled = true;
        btn.textContent = t('ui:openWorld.joining');
      }
      this.joinWorld();
    });
  }

  /** Top standings of the running round (top 10 of the server's full list). */
  private renderLeaderboard(entries: OpenWorldScoreEntry[]): void {
    const body = this.container?.querySelector('#ow-board tbody');
    if (!body) return;
    if (entries.length === 0) {
      body.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">
        ${t('ui:openWorld.noPlayers')}</td></tr>`;
      return;
    }
    body.innerHTML = entries
      .slice(0, 10)
      .map(
        (e, i) => `<tr>
          <td>${i + 1}</td>
          <td style="text-align:left;">${escapeHtml(e.username)}</td>
          <td>${e.kills}</td>
          <td>${e.deaths}</td>
          <td>${e.score}</td>
        </tr>`,
      )
      .join('');
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private restoreLobbyVisibility(): void {
    const appLayout = this.container?.closest('.app-layout') as HTMLElement | null;
    if (appLayout) appLayout.style.display = '';
  }

  private joinWorld(): void {
    const socket = this.deps.socketClient.getSocket();
    if (!socket) {
      this.restoreLobbyVisibility();
      this.showError('Not connected');
      return;
    }

    socket.emit('openworld:join', {}, (response: OpenWorldJoinResponse) => {
      if (response.success && response.state) {
        // Set guest identity if needed — gate on the server's isGuest (like MenuScene's
        // joinBackgroundWorld), not on authManager.isGuest: on a guest's first successful
        // join via this path the local flag is still false.
        if (response.isGuest && response.playerId && response.username) {
          this.deps.authManager.setGuestIdentity(response.playerId, response.username);
        }

        // Transition to GameScene with open world state
        game.registry.set('initialGameState', response.state);
        game.registry.set('openWorldMode', true);
        game.registry.set('openWorldPlayerId', response.playerId);
        // Seeds the HUD scoreboard before the first periodic `openworld:info` arrives
        if (response.info) game.registry.set('openWorldInfo', response.info);

        // Remove all lobby DOM from the overlay so it doesn't cover the game canvas
        const uiOverlay = document.getElementById('ui-overlay');
        if (uiOverlay) {
          while (uiOverlay.firstChild) {
            uiOverlay.removeChild(uiOverlay.firstChild);
          }
        }

        const lobbyScene = game.scene.getScene('LobbyScene');
        if (lobbyScene) {
          lobbyScene.scene.start('GameScene');
          lobbyScene.scene.launch('HUDScene');
        }
      } else {
        this.restoreLobbyVisibility();
        this.showError(response.error || 'Failed to join');
      }
    });
  }

  private showError(message: string): void {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="panel-content" style="padding:2rem; text-align:center;">
        <p style="color:var(--text-muted); font-size:1.1rem;">${escapeHtml(message)}</p>
        <button class="btn btn-primary" id="ow-retry-btn" style="margin-top:1rem;">
          ${t('ui:openWorld.joinButton')}
        </button>
      </div>`;
    this.container.querySelector('#ow-retry-btn')?.addEventListener('click', () => {
      if (!this.container) return;
      this.container.innerHTML = `<div class="panel-content" style="padding:2rem; text-align:center;">
        <p style="color:var(--text-muted); font-size:1.1rem;">${t('ui:openWorld.joining')}</p>
      </div>`;
      this.joinWorld();
    });
  }

  private bindSocketListeners(): void {
    this.infoHandler = (data) => {
      this.roundTimeRemaining = data.roundTimeRemaining;
      const playersEl = this.container?.querySelector('#ow-players');
      if (playersEl) {
        playersEl.textContent = t('ui:openWorld.playerCount', {
          current: data.playerCount,
          max: data.maxPlayers,
        });
      }
      const roundEl = this.container?.querySelector('#ow-round');
      if (roundEl) {
        roundEl.textContent = t('ui:openWorld.roundNumber', { number: data.roundNumber });
      }
      this.renderLeaderboard(data.leaderboard);
    };
    this.deps.socketClient.on('openworld:info', this.infoHandler);

    this.roundEndHandler = () => {
      // Round end handled by GameScene/HUD when in-game
    };
    this.deps.socketClient.on('openworld:roundEnd', this.roundEndHandler);

    this.roundStartHandler = () => {
      // Round start handled by GameScene/HUD when in-game
    };
    this.deps.socketClient.on('openworld:roundStart', this.roundStartHandler);
  }

  private startTimerCountdown(): void {
    this.stopTimerCountdown();
    let ticks = 0;
    this.timerInterval = setInterval(() => {
      this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - 1);
      const timerEl = this.container?.querySelector('#ow-timer');
      if (timerEl) {
        timerEl.textContent = t('ui:openWorld.roundTimer', {
          time: this.formatTime(this.roundTimeRemaining),
        });
      }
      // `openworld:info` only reaches sockets inside the world room, and this view is shown
      // after leaving it — re-poll the public status endpoint to keep counts and standings live.
      if (++ticks % 10 === 0) void this.refreshStatus();
    }, 1000);
  }

  private async refreshStatus(): Promise<void> {
    // Only meaningful once the lobby markup is up (skipped while an auto-join is in flight)
    if (!this.container?.querySelector('#ow-board')) return;
    try {
      const res = await fetch(`${API_URL}/admin/settings/open_world/status`);
      if (!res.ok) return;
      const status: OpenWorldStatus = await res.json();
      if (!this.container) return; // view destroyed while the request was in flight
      this.roundTimeRemaining = status.roundTimeRemaining;
      const playersEl = this.container.querySelector('#ow-players');
      if (playersEl) {
        playersEl.textContent = t('ui:openWorld.playerCount', {
          current: status.playerCount,
          max: status.maxPlayers,
        });
      }
      const roundEl = this.container.querySelector('#ow-round');
      if (roundEl) {
        roundEl.textContent = t('ui:openWorld.roundNumber', { number: status.roundNumber });
      }
      this.renderLeaderboard(status.leaderboard ?? []);
    } catch {
      // Transient failure — the next poll retries
    }
  }

  private stopTimerCountdown(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  destroy(): void {
    this.stopTimerCountdown();
    if (this.infoHandler) {
      this.deps.socketClient.off('openworld:info', this.infoHandler);
      this.infoHandler = null;
    }
    if (this.roundEndHandler) {
      this.deps.socketClient.off('openworld:roundEnd', this.roundEndHandler);
      this.roundEndHandler = null;
    }
    if (this.roundStartHandler) {
      this.deps.socketClient.off('openworld:roundStart', this.roundStartHandler);
      this.roundStartHandler = null;
    }
    this.container = null;
  }
}
