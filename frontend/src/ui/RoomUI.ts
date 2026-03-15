import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { NotificationUI } from './NotificationUI';
import { Room, RoomPlayer, POWERUP_DEFINITIONS } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';

export class RoomUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private room: Room;
  private onLeave: () => void;
  constructor(
    socketClient: SocketClient,
    authManager: AuthManager,
    notifications: NotificationUI,
    room: Room,
    onLeave: () => void,
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
  }

  private setupListeners(): void {
    this.socketClient.on('room:state', ((room: Room) => {
      this.room = room;
      this.render();
    }) as any);

    this.socketClient.on('room:playerJoined', ((player: RoomPlayer) => {
      if (!this.room.players.some((p) => p.user.id === player.user.id)) {
        this.room.players.push(player);
      }
      this.render();
      this.notifications.info(`${player.user.username} joined`);
    }) as any);

    this.socketClient.on('room:playerLeft', ((userId: number) => {
      const player = this.room.players.find((p) => p.user.id === userId);
      this.room.players = this.room.players.filter((p) => p.user.id !== userId);
      this.render();
      if (player) {
        this.notifications.info(`${player.user.username} left`);
      }
    }) as any);

    this.socketClient.on('room:playerReady', ((data: { userId: number; ready: boolean }) => {
      const player = this.room.players.find((p) => p.user.id === data.userId);
      if (player) player.ready = data.ready;
      this.render();
    }) as any);
  }

  private removeListeners(): void {
    this.socketClient.off('room:state');
    this.socketClient.off('room:playerJoined');
    this.socketClient.off('room:playerLeft');
    this.socketClient.off('room:playerReady');
  }

  private isHost(): boolean {
    const user = this.authManager.getUser();
    return user?.id === this.room.host.id;
  }

  private isReady(): boolean {
    const user = this.authManager.getUser();
    const me = this.room.players.find((p) => p.user.id === user?.id);
    return me?.ready ?? false;
  }

  private allPlayersReady(): boolean {
    return this.room.players.every((p) => p.user.id === this.room.host.id || p.ready);
  }

  private render(): void {
    const isHost = this.isHost();
    const isReady = this.isReady();
    const allReady = this.allPlayersReady();
    const botCount = this.room.config.botCount || 0;
    const canStart = isHost && allReady && (this.room.players.length >= 2 || botCount >= 1);

    const modeLabel = this.room.config.gameMode.replace('_', ' ').toUpperCase();

    this.container.innerHTML = `
      <div class="lobby-header">
        <div style="display:flex;align-items:center;gap:16px;">
          <button class="btn btn-ghost" id="room-back" style="padding:8px 14px;">← Back</button>
          <h1>${escapeHtml(this.room.name)}</h1>
          <span class="room-mode" style="font-size:12px;padding:4px 12px;">${modeLabel}</span>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <span style="color:var(--text-dim);font-size:13px;">Room Code: <strong style="color:var(--text);letter-spacing:2px;font-family:var(--font-mono);">${this.room.code}</strong></span>
        </div>
      </div>

      <div style="display:flex;gap:24px;flex:1;overflow:hidden;padding:20px 24px;">
        <!-- Player List -->
        <div style="flex:1;display:flex;flex-direction:column;">
          <div style="margin-bottom:12px;color:var(--text-dim);font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">
            Players (${this.room.players.length}/${this.room.config.maxPlayers})
          </div>
          <div style="flex:1;overflow-y:auto;" id="room-player-list">
            ${this.room.players.map((p, i) => this.renderPlayer(p, i)).join('')}
            ${this.renderBots()}
          </div>

          <div style="display:flex;gap:12px;margin-top:16px;">
            ${
              isHost
                ? `
              <button class="btn btn-primary" id="room-start" ${canStart ? '' : 'disabled'}
                style="flex:1;padding:14px;font-size:16px;font-family:var(--font-display);letter-spacing:1px;text-transform:uppercase;">
                ${this.room.players.length < 2 && botCount < 1 ? 'Need Players or Bots' : !allReady ? 'Waiting for Players...' : 'Start Game'}
              </button>
            `
                : `
              <button class="btn ${isReady ? 'btn-secondary' : 'btn-primary'}" id="room-ready"
                style="flex:1;padding:14px;font-size:16px;font-family:var(--font-display);letter-spacing:1px;text-transform:uppercase;">
                ${isReady ? 'Not Ready' : 'Ready'}
              </button>
            `
            }
          </div>
        </div>

        <!-- Room Settings -->
        <div style="width:280px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;">
          <h3 style="margin-bottom:16px;color:var(--primary);font-family:var(--font-display);font-weight:700;letter-spacing:0.5px;">Room Settings</h3>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:14px;">
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Game Mode</span>
              <span style="color:var(--text);">${modeLabel}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Max Players</span>
              <span style="color:var(--text);">${this.room.config.maxPlayers}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Map Size</span>
              <span style="color:var(--text);">${this.room.config.mapWidth}x${this.room.config.mapHeight}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Round Time</span>
              <span style="color:var(--text);">${Math.floor(this.room.config.roundTime / 60)}:${(this.room.config.roundTime % 60).toString().padStart(2, '0')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Wall Density</span>
              <span style="color:var(--text);">${Math.round((this.room.config.wallDensity ?? 0.65) * 100)}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Power-Up Rate</span>
              <span style="color:var(--text);">${Math.round((this.room.config.powerUpDropRate ?? 0.3) * 100)}%</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Bots</span>
              <span style="color:var(--text);">${this.room.config.botCount || 0}${this.room.config.botCount ? ` (${(this.room.config.botDifficulty || 'normal').charAt(0).toUpperCase() + (this.room.config.botDifficulty || 'normal').slice(1)})` : ''}</span>
            </div>
            ${
              this.room.config.gameMode === 'teams'
                ? `
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Friendly Fire</span>
              <span style="color:${this.room.config.friendlyFire !== false ? 'var(--danger)' : 'var(--success)'};">${this.room.config.friendlyFire !== false ? 'ON' : 'OFF'}</span>
            </div>`
                : ''
            }
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">Host</span>
              <span style="color:var(--text);">${escapeHtml(this.room.host.username)}</span>
            </div>
            ${
              this.room.config.enabledPowerUps && this.room.config.enabledPowerUps.length > 0
                ? `
              <div style="margin-top:4px;">
                <span style="color:var(--text-dim);display:block;margin-bottom:6px;">Power-Ups</span>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${this.room.config.enabledPowerUps
                    .map((type) => {
                      const def = POWERUP_DEFINITIONS[type];
                      return def
                        ? `<span style="font-size:11px;padding:2px 8px;background:var(--bg-deep);border:1px solid ${def.color}40;border-radius:4px;color:${def.color};">${def.name}</span>`
                        : '';
                    })
                    .join('')}
                </div>
              </div>
            `
                : ''
            }
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

    // Team assignment dropdowns (host only, teams mode)
    this.container.querySelectorAll('.team-select').forEach((select) => {
      select.addEventListener('change', (e) => {
        const el = e.target as HTMLSelectElement;
        const userId = parseInt(el.dataset.userId!);
        const team = parseInt(el.value);
        this.socketClient.emit('room:setTeam' as any, { userId, team });
      });
    });

    // Bot team assignment dropdowns (host only, teams mode)
    this.container.querySelectorAll('.bot-team-select').forEach((select) => {
      select.addEventListener('change', (e) => {
        const el = e.target as HTMLSelectElement;
        const botIndex = parseInt(el.dataset.botIndex!);
        const team = parseInt(el.value);
        this.socketClient.emit('room:setBotTeam' as any, { botIndex, team });
      });
    });
  }

  private renderPlayer(player: RoomPlayer, index: number): string {
    const isPlayerHost = player.user.id === this.room.host.id;
    const isTeamsMode = this.room.config.gameMode === 'teams';
    const iAmHost = this.isHost();

    // In teams mode, use team color; otherwise individual color
    const teamColors = ['#ff4466', '#448aff'];
    const individualColors = [
      '#ff6b35',
      '#448aff',
      '#00e676',
      '#ffaa22',
      '#bb44ff',
      '#ffdd44',
      '#ff44dd',
      '#00d4aa',
    ];
    const playerTeam = player.team ?? index % 2;
    const color = isTeamsMode
      ? teamColors[playerTeam]
      : individualColors[index % individualColors.length];
    const teamLabel = isTeamsMode ? (playerTeam === 0 ? 'Team Red' : 'Team Blue') : '';

    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
        background:var(--bg-surface);border:1px solid ${isTeamsMode ? color + '40' : 'var(--border)'};border-radius:var(--radius);margin-bottom:8px;transition:all 150ms ease;">
        <div style="width:40px;height:40px;border-radius:var(--radius);background:${color};
          display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:18px;
          color:rgba(0,0,0,0.5);font-family:var(--font-display);">
          ${escapeHtml(player.user.username.charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;">
          <div style="font-weight:600;color:var(--text);">
            ${escapeHtml(player.user.username)}
            ${isPlayerHost ? '<span style="color:var(--primary);font-size:11px;margin-left:6px;font-family:var(--font-display);letter-spacing:0.5px;">HOST</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-muted);">
            @${escapeHtml(player.user.username)}
            ${isTeamsMode ? ` <span style="color:${color};font-weight:600;">${teamLabel}</span>` : ''}
          </div>
        </div>
        ${
          isTeamsMode && iAmHost
            ? `
          <select class="team-select admin-select" data-user-id="${player.user.id}">
            <option value="0" ${playerTeam === 0 ? 'selected' : ''} style="color:#ff4466;">Team Red</option>
            <option value="1" ${playerTeam === 1 ? 'selected' : ''} style="color:#448aff;">Team Blue</option>
          </select>
        `
            : ''
        }
        <div>
          ${
            isPlayerHost
              ? '<span style="color:var(--primary);font-size:12px;font-weight:700;font-family:var(--font-display);letter-spacing:0.5px;">HOST</span>'
              : player.ready
                ? '<span style="color:var(--success);font-size:12px;font-weight:700;font-family:var(--font-display);">READY</span>'
                : '<span style="color:var(--text-muted);font-size:12px;">Not Ready</span>'
          }
        </div>
      </div>
    `;
  }

  private renderBots(): string {
    const botCount = this.room.config.botCount || 0;
    if (botCount === 0) return '';

    const isTeamsMode = this.room.config.gameMode === 'teams';
    const iAmHost = this.isHost();
    const botNames = ['Bomber Bot', 'Blast Bot', 'Kaboom', 'TNT', 'Dynamite', 'Sparky'];
    const botTeams = this.room.config.botTeams || [];
    const humanCount = this.room.players.length;

    let html = '';
    for (let i = 0; i < botCount; i++) {
      const botName = botNames[i % botNames.length];
      const botTeam = botTeams[i] ?? (humanCount + i) % 2;
      const teamColors = ['#ff4466', '#448aff'];
      const color = isTeamsMode ? teamColors[botTeam] : 'var(--text-muted)';
      const teamLabel = isTeamsMode ? (botTeam === 0 ? 'Team Red' : 'Team Blue') : '';

      html += `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;
          background:var(--bg-surface);border:1px solid ${isTeamsMode ? teamColors[botTeam] + '40' : 'var(--border)'};border-radius:var(--radius);margin-bottom:8px;opacity:0.7;">
          <div style="width:40px;height:40px;border-radius:var(--radius);background:${color};
            display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;
            color:rgba(0,0,0,0.5);">
            🤖
          </div>
          <div style="flex:1;">
            <div style="font-weight:600;color:var(--text);">
              ${escapeHtml(botName)}
              <span style="color:var(--text-muted);font-size:11px;margin-left:6px;font-family:var(--font-display);letter-spacing:0.5px;">BOT</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);">
              ${isTeamsMode ? `<span style="color:${color};font-weight:600;">${teamLabel}</span>` : 'AI Player'}
            </div>
          </div>
          ${
            isTeamsMode && iAmHost
              ? `
            <select class="bot-team-select admin-select" data-bot-index="${i}">
              <option value="0" ${botTeam === 0 ? 'selected' : ''} style="color:#ff4466;">Team Red</option>
              <option value="1" ${botTeam === 1 ? 'selected' : ''} style="color:#448aff;">Team Blue</option>
            </select>
          `
              : ''
          }
          <div>
            <span style="color:var(--success);font-size:12px;font-weight:700;font-family:var(--font-display);">READY</span>
          </div>
        </div>
      `;
    }
    return html;
  }
}
