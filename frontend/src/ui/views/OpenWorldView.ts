import { ILobbyView, ViewDeps } from './types';
import { OpenWorldScoreEntry } from '@blast-arena/shared';
import { API_URL } from '../../config';
import { escapeHtml } from '../../utils/html';
import { t } from '../../i18n';
import game from '../../main';

interface OpenWorldStatus {
  enabled: boolean;
  playerCount: number;
  maxPlayers: number;
  roundTimeRemaining: number;
  roundNumber: number;
  guestAccess: boolean;
}

interface OpenWorldInfo {
  playerCount: number;
  maxPlayers: number;
  roundTimeRemaining: number;
  roundNumber: number;
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
  private scoreHandler: ((data: OpenWorldScoreEntry) => void) | null = null;
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
      container.innerHTML = `
        <div class="panel-content" style="padding:2rem; text-align:center;">
          <p style="color:var(--text-muted); font-size:1.1rem;">${t('ui:openWorld.disabled')}</p>
        </div>`;
      return;
    }

    this.roundTimeRemaining = status.roundTimeRemaining;
    this.bindSocketListeners();
    this.startTimerCountdown();

    if (!OpenWorldView.hasAutoJoined) {
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
      </div>`;

    this.container.querySelector('#ow-join-btn')?.addEventListener('click', () => {
      const btn = this.container?.querySelector('#ow-join-btn') as HTMLButtonElement;
      if (btn) {
        btn.disabled = true;
        btn.textContent = t('ui:openWorld.joining');
      }
      this.joinWorld();
    });
  }

  private formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  private joinWorld(): void {
    const socket = this.deps.socketClient.getSocket();
    if (!socket) {
      this.showError('Not connected');
      return;
    }

    socket.emit('openworld:join', {}, (response: any) => {
      if (response.success && response.state) {
        // Set guest identity if needed
        if (this.deps.authManager.isGuest && response.playerId && response.username) {
          this.deps.authManager.setGuestIdentity(response.playerId, response.username);
        }

        // Transition to GameScene with open world state
        game.registry.set('initialGameState', response.state);
        game.registry.set('openWorldMode', true);
        game.registry.set('openWorldPlayerId', response.playerId);

        // Clear DOM
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
    this.timerInterval = setInterval(() => {
      this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - 1);
      const timerEl = this.container?.querySelector('#ow-timer');
      if (timerEl) {
        timerEl.textContent = t('ui:openWorld.roundTimer', {
          time: this.formatTime(this.roundTimeRemaining),
        });
      }
    }, 1000);
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
    if (this.scoreHandler) {
      this.deps.socketClient.off('openworld:scoreUpdate', this.scoreHandler);
      this.scoreHandler = null;
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
