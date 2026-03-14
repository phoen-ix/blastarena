import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { NotificationUI } from './NotificationUI';
import { Room, RoomPlayer, POWERUP_DEFINITIONS } from '@blast-arena/shared';

export class RoomUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private room: Room;
  private onLeave: () => void;
  private countdownOverlay: HTMLElement | null = null;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    socketClient: SocketClient,
    authManager: AuthManager,
    notifications: NotificationUI,
    room: Room,
    onLeave: () => void
  ) {
    this.socketClient = socketClient;
    this.authManager = authManager;
    this.notifications = notifications;
    this.room = room;
    this.onLeave = onLeave;
    this.container = document.createElement('div');
    this.container.className = 'lobby-container';
    this.setupListeners();
  }

  show(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    this.render();
  }

  hide(): void {
    this.container.remove();
    this.removeListeners();
    this.cleanupCountdown();
  }

  private cleanupCountdown(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.countdownOverlay) {
      this.countdownOverlay.remove();
      this.countdownOverlay = null;
    }
  }

  private setupListeners(): void {
    this.socketClient.on('room:state', ((room: Room) => {
      this.room = room;
      this.render();
    }) as any);

    this.socketClient.on('room:playerJoined', ((player: RoomPlayer) => {
      if (!this.room.players.some(p => p.user.id === player.user.id)) {
        this.room.players.push(player);
      }
      this.render();
      this.notifications.info(`${player.user.displayName} joined`);
    }) as any);

    this.socketClient.on('room:playerLeft', ((userId: number) => {
      const player = this.room.players.find(p => p.user.id === userId);
      this.room.players = this.room.players.filter(p => p.user.id !== userId);
      this.render();
      if (player) {
        this.notifications.info(`${player.user.displayName} left`);
      }
    }) as any);

    this.socketClient.on('room:playerReady', ((data: { userId: number; ready: boolean }) => {
      const player = this.room.players.find(p => p.user.id === data.userId);
      if (player) player.ready = data.ready;
      this.render();
    }) as any);

    this.socketClient.on('room:countdown', ((data: { seconds: number }) => {
      this.showCountdown(data.seconds);
    }) as any);
  }

  private removeListeners(): void {
    this.socketClient.off('room:state');
    this.socketClient.off('room:playerJoined');
    this.socketClient.off('room:playerLeft');
    this.socketClient.off('room:playerReady');
    this.socketClient.off('room:countdown');
  }

  private isHost(): boolean {
    const user = this.authManager.getUser();
    return user?.id === this.room.host.id;
  }

  private isReady(): boolean {
    const user = this.authManager.getUser();
    const me = this.room.players.find(p => p.user.id === user?.id);
    return me?.ready ?? false;
  }

  private allPlayersReady(): boolean {
    return this.room.players.every(p => p.user.id === this.room.host.id || p.ready);
  }

  private render(): void {
    const user = this.authManager.getUser();
    const isHost = this.isHost();
    const isReady = this.isReady();
    const allReady = this.allPlayersReady();
    const botCount = this.room.config.botCount || 0;
    const totalPlayers = this.room.players.length + botCount;
    const canStart = isHost && allReady && (this.room.players.length >= 2 || botCount >= 1);

    const modeLabel = this.room.config.gameMode.replace('_', ' ').toUpperCase();

    this.container.innerHTML = `
      <div class="lobby-header">
        <div style="display:flex;align-items:center;gap:16px;">
          <button class="btn btn-secondary" id="room-back" style="padding:8px 14px;">Back</button>
          <h1>${this.escapeHtml(this.room.name)}</h1>
          <span class="room-mode" style="font-size:14px;padding:4px 12px;">${modeLabel}</span>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <span style="color:#a0a0b0;">Room Code: <strong style="color:#fff;letter-spacing:2px;">${this.room.code}</strong></span>
        </div>
      </div>

      <div style="display:flex;gap:24px;flex:1;overflow:hidden;">
        <!-- Player List -->
        <div style="flex:1;display:flex;flex-direction:column;">
          <div style="margin-bottom:12px;color:#a0a0b0;font-size:14px;">
            Players (${this.room.players.length}/${this.room.config.maxPlayers})
          </div>
          <div style="flex:1;overflow-y:auto;" id="room-player-list">
            ${this.room.players.map((p, i) => this.renderPlayer(p, i)).join('')}
          </div>

          <div style="display:flex;gap:12px;margin-top:16px;">
            ${isHost ? `
              <button class="btn btn-primary" id="room-start" ${canStart ? '' : 'disabled'}
                style="flex:1;padding:14px;font-size:16px;">
                ${this.room.players.length < 2 && botCount < 1 ? 'Need Players or Bots' : !allReady ? 'Waiting for Players...' : 'Start Game'}
              </button>
            ` : `
              <button class="btn ${isReady ? 'btn-secondary' : 'btn-primary'}" id="room-ready"
                style="flex:1;padding:14px;font-size:16px;">
                ${isReady ? 'Not Ready' : 'Ready'}
              </button>
            `}
          </div>
        </div>

        <!-- Room Settings -->
        <div style="width:280px;background:#16213e;border:1px solid #0f3460;border-radius:8px;padding:20px;">
          <h3 style="margin-bottom:16px;color:#e94560;">Room Settings</h3>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:14px;">
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Game Mode</span>
              <span style="color:#fff;">${modeLabel}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Max Players</span>
              <span style="color:#fff;">${this.room.config.maxPlayers}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Map Size</span>
              <span style="color:#fff;">${this.room.config.mapWidth}x${this.room.config.mapHeight}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Round Time</span>
              <span style="color:#fff;">${Math.floor(this.room.config.roundTime / 60)}:${(this.room.config.roundTime % 60).toString().padStart(2, '0')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Wall Density</span>
              <span style="color:#fff;">${Math.round((this.room.config.wallDensity ?? 0.65) * 100)}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Power-Up Rate</span>
              <span style="color:#fff;">${Math.round((this.room.config.powerUpDropRate ?? 0.3) * 100)}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Bots</span>
              <span style="color:#fff;">${this.room.config.botCount || 0}${this.room.config.botCount ? ` (${(this.room.config.botDifficulty || 'normal').charAt(0).toUpperCase() + (this.room.config.botDifficulty || 'normal').slice(1)})` : ''}</span>
            </div>
            ${this.room.config.gameMode === 'teams' ? `
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Friendly Fire</span>
              <span style="color:${this.room.config.friendlyFire !== false ? '#e94560' : '#44ff44'};">${this.room.config.friendlyFire !== false ? 'ON' : 'OFF'}</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;">
              <span style="color:#a0a0b0;">Host</span>
              <span style="color:#fff;">${this.escapeHtml(this.room.host.displayName)}</span>
            </div>
            ${this.room.config.enabledPowerUps && this.room.config.enabledPowerUps.length > 0 ? `
              <div style="margin-top:4px;">
                <span style="color:#a0a0b0;display:block;margin-bottom:6px;">Power-Ups</span>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${this.room.config.enabledPowerUps.map(type => {
                    const def = POWERUP_DEFINITIONS[type];
                    return def ? `<span style="font-size:11px;padding:2px 8px;background:#1a1a2e;border:1px solid ${def.color}40;border-radius:4px;color:${def.color};">${def.name}</span>` : '';
                  }).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    // Event listeners
    this.container.querySelector('#room-back')!.addEventListener('click', () => {
      this.socketClient.emit('room:leave' as any);
      this.hide();
      this.onLeave();
    });

    const startBtn = this.container.querySelector('#room-start');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.socketClient.emit('room:start' as any);
      });
    }

    const readyBtn = this.container.querySelector('#room-ready');
    if (readyBtn) {
      readyBtn.addEventListener('click', () => {
        this.socketClient.emit('room:ready' as any, { ready: !isReady });
      });
    }
  }

  private renderPlayer(player: RoomPlayer, index: number): string {
    const isHost = player.user.id === this.room.host.id;
    const colors = ['#e94560', '#44aaff', '#44ff44', '#ff8800', '#cc44ff', '#ffff44', '#ff44ff', '#44ffff'];
    const color = colors[index % colors.length];

    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
        background:#16213e;border:1px solid #0f3460;border-radius:8px;margin-bottom:8px;">
        <div style="width:40px;height:40px;border-radius:6px;background:${color};
          display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:18px;
          color:rgba(0,0,0,0.5);">
          ${this.escapeHtml(player.user.displayName.charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;">
          <div style="font-weight:600;color:#fff;">
            ${this.escapeHtml(player.user.displayName)}
            ${isHost ? '<span style="color:#e94560;font-size:12px;margin-left:6px;">HOST</span>' : ''}
          </div>
          <div style="font-size:12px;color:#a0a0b0;">@${this.escapeHtml(player.user.username)}</div>
        </div>
        <div>
          ${isHost
            ? '<span style="color:#e94560;font-size:13px;font-weight:600;">Host</span>'
            : player.ready
              ? '<span style="color:#44ff44;font-size:13px;font-weight:600;">Ready</span>'
              : '<span style="color:#666;font-size:13px;">Not Ready</span>'
          }
        </div>
      </div>
    `;
  }

  private showCountdown(seconds: number): void {
    this.cleanupCountdown();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:24px;color:#a0a0b0;margin-bottom:16px;">Game Starting</div>
        <div id="countdown-number" style="font-size:96px;font-weight:bold;color:#e94560;">${seconds}</div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(overlay);
    this.countdownOverlay = overlay;

    let remaining = seconds;
    this.countdownInterval = setInterval(() => {
      remaining--;
      const el = document.getElementById('countdown-number');
      if (el) el.textContent = String(remaining);
      if (remaining <= 0) {
        this.cleanupCountdown();
      }
    }, 1000);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
