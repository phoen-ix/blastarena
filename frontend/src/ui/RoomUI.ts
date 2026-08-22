import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { NotificationUI } from './NotificationUI';
import { Room, RoomPlayer, POWERUP_DEFINITIONS } from '@blast-arena/shared';
import { escapeHtml, setHtml } from '../utils/html';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { t } from '../i18n';

export class RoomUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private room: Room;
  private onLeave: () => void;

  // Kept so removeListeners() can pass the exact handler to off() — a handler-less off() would
  // remove other consumers' listeners for the same event. (audit SOCKET-OFF-REF-1)
  private onRoomState?: (room: Room) => void;
  private onPlayerJoined?: (player: RoomPlayer) => void;
  private onPlayerLeft?: (userId: number) => void;
  private onPlayerReady?: (data: { userId: number; ready: boolean }) => void;
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
    this.pushGamepadContext();
  }

  hide(): void {
    UIGamepadNavigator.getInstance().popContext('room');
    this.container.remove();
    this.removeListeners();
  }

  private pushGamepadContext(): void {
    UIGamepadNavigator.getInstance().popContext('room');
    UIGamepadNavigator.getInstance().pushContext({
      id: 'room',
      elements: () => [
        ...this.container.querySelectorAll<HTMLElement>(
          '[data-action="back"], .team-select, .bot-team-select, [data-action="ready"], [data-action="start"]',
        ),
      ],
      onBack: () => {
        this.socketClient.emit('room:leave');
        this.hide();
        this.onLeave();
      },
    });
  }

  private setupListeners(): void {
    // Handler references are kept so removeListeners can pass them to off().
    //
    // SocketClient.off(event) with no handler removes EVERY listener for that event, and
    // GameOverScene registers its own 'room:state' handler to drive the post-match navigation.
    // Any path that tore down a RoomUI while the scoreboard was up — a party follow, an admin
    // kick, a rematch re-entering the room view — silently killed it, leaving the player stuck on
    // the scoreboard with a dead "Play Again". (audit SOCKET-OFF-REF-1)
    this.onRoomState = (room) => {
      this.room = room;
      this.render();
    };
    this.socketClient.on('room:state', this.onRoomState);

    this.onPlayerJoined = (player) => {
      if (!this.room.players.some((p) => p.user.id === player.user.id)) {
        this.room.players.push(player);
      }
      this.render();
      this.notifications.info(t('ui:room.playerJoined', { username: player.user.username }));
    };
    this.socketClient.on('room:playerJoined', this.onPlayerJoined);

    this.onPlayerLeft = (userId) => {
      const player = this.room.players.find((p) => p.user.id === userId);
      this.room.players = this.room.players.filter((p) => p.user.id !== userId);
      this.render();
      if (player) {
        this.notifications.info(t('ui:room.playerLeft', { username: player.user.username }));
      }
    };
    this.socketClient.on('room:playerLeft', this.onPlayerLeft);

    this.onPlayerReady = (data) => {
      const player = this.room.players.find((p) => p.user.id === data.userId);
      if (player) player.ready = data.ready;
      this.render();
    };
    this.socketClient.on('room:playerReady', this.onPlayerReady);

    // Delegated event handlers — set up once, survive innerHTML rebuilds
    this.container.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!target) return;

      switch (target.dataset.action) {
        case 'back':
          this.socketClient.emit('room:leave');
          this.hide();
          this.onLeave();
          break;
        case 'start':
          this.socketClient.emit('room:start');
          break;
        case 'ready':
          this.socketClient.emit('room:ready', { ready: !this.isReady() });
          break;
        case 'invite-info':
          this.notifications.info(t('ui:room.inviteInfo'));
          break;
      }
    });

    this.container.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.classList.contains('team-select')) {
        const userId = parseInt(target.dataset.userId!);
        this.socketClient.emit('room:setTeam', { userId, team: parseInt(target.value) });
      } else if (target.classList.contains('bot-team-select')) {
        const botIndex = parseInt(target.dataset.botIndex!);
        this.socketClient.emit('room:setBotTeam', { botIndex, team: parseInt(target.value) });
      }
    });
  }

  private removeListeners(): void {
    if (this.onRoomState) this.socketClient.off('room:state', this.onRoomState);
    if (this.onPlayerJoined) this.socketClient.off('room:playerJoined', this.onPlayerJoined);
    if (this.onPlayerLeft) this.socketClient.off('room:playerLeft', this.onPlayerLeft);
    if (this.onPlayerReady) this.socketClient.off('room:playerReady', this.onPlayerReady);
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

    const modeLabel = t(`game:modes.${this.room.config.gameMode}.name`);

    setHtml(
      this.container,
      `
      <div class="lobby-header">
        <div style="display:flex;align-items:center;gap:16px;">
          <button class="btn btn-ghost" data-action="back" style="padding:8px 14px;">${t('ui:room.back')}</button>
          <h1>${escapeHtml(this.room.name)}</h1>
          <span class="room-mode" style="font-size:12px;padding:4px 12px;">${modeLabel}</span>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <button class="btn btn-ghost" data-action="invite-info" style="padding:6px 14px;font-size:12px;color:var(--accent);">${t('ui:room.inviteFriend')}</button>
          <span style="color:var(--text-dim);font-size:13px;">${t('ui:room.roomCode')} <strong style="color:var(--text);letter-spacing:2px;font-family:var(--font-mono);">${this.room.code}</strong></span>
        </div>
      </div>

      <div style="display:flex;gap:24px;flex:1;overflow:hidden;padding:20px 24px;">
        <!-- Player List -->
        <div style="flex:1;display:flex;flex-direction:column;">
          <div style="margin-bottom:12px;color:var(--text-dim);font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">
            ${t('ui:room.playersCount', { current: this.room.players.length, max: this.room.config.maxPlayers })}
          </div>
          <div style="flex:1;overflow-y:auto;" id="room-player-list">
            ${this.room.players.map((p, i) => this.renderPlayer(p, i)).join('')}
            ${this.renderBots()}
          </div>

          <div style="display:flex;gap:12px;margin-top:16px;">
            ${
              isHost
                ? `
              <button class="btn btn-primary" data-action="start" ${canStart ? '' : 'disabled'}
                style="flex:1;padding:14px;font-size:16px;font-family:var(--font-display);letter-spacing:1px;text-transform:uppercase;">
                ${this.room.players.length < 2 && botCount < 1 ? t('ui:room.needPlayers') : !allReady ? t('ui:room.waitingForPlayers') : t('ui:room.startGame')}
              </button>
            `
                : `
              <button class="btn ${isReady ? 'btn-secondary' : 'btn-primary'}" data-action="ready"
                style="flex:1;padding:14px;font-size:16px;font-family:var(--font-display);letter-spacing:1px;text-transform:uppercase;">
                ${isReady ? t('ui:room.notReady') : t('ui:room.ready')}
              </button>
            `
            }
          </div>
        </div>

        <!-- Room Settings -->
        <div style="width:280px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;">
          <h3 style="margin-bottom:16px;color:var(--primary);font-family:var(--font-display);font-weight:700;letter-spacing:0.5px;">${t('ui:room.roomSettings')}</h3>
          <div style="display:flex;flex-direction:column;gap:12px;font-size:14px;">
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.gameMode')}</span>
              <span style="color:var(--text);">${modeLabel}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.maxPlayers')}</span>
              <span style="color:var(--text);">${this.room.config.maxPlayers}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.mapSize')}</span>
              <span style="color:var(--text);">${t('ui:room.mapSizeValue', { width: this.room.config.mapWidth, height: this.room.config.mapHeight })}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.roundTime')}</span>
              <span style="color:var(--text);">${Math.floor(this.room.config.roundTime / 60)}:${(this.room.config.roundTime % 60).toString().padStart(2, '0')}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.wallDensity')}</span>
              <span style="color:var(--text);">${t('ui:room.wallDensityValue', { percent: Math.round((this.room.config.wallDensity ?? 0.65) * 100) })}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.powerUpRate')}</span>
              <span style="color:var(--text);">${t('ui:room.powerUpRateValue', { percent: Math.round((this.room.config.powerUpDropRate ?? 0.3) * 100) })}</span>
            </div>
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.bots')}</span>
              <span style="color:var(--text);">${this.room.config.botCount || 0}${this.room.config.botCount ? ` (${t(`ui:createRoom.difficulty.${this.room.config.botDifficulty || 'normal'}`)})` : ''}</span>
            </div>
            ${
              this.room.config.gameMode === 'teams'
                ? `
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.friendlyFire')}</span>
              <span style="color:${this.room.config.friendlyFire !== false ? 'var(--danger)' : 'var(--success)'};">${this.room.config.friendlyFire !== false ? t('ui:room.friendlyFireOn') : t('ui:room.friendlyFireOff')}</span>
            </div>`
                : ''
            }
            <div style="display:flex;justify-content:space-between;">
              <span style="color:var(--text-dim);">${t('ui:room.host')}</span>
              <span style="color:var(--text);">${escapeHtml(this.room.host.username)}</span>
            </div>
            ${
              this.room.config.enabledPowerUps && this.room.config.enabledPowerUps.length > 0
                ? `
              <div style="margin-top:4px;">
                <span style="color:var(--text-dim);display:block;margin-bottom:6px;">${t('ui:room.powerUps')}</span>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                  ${this.room.config.enabledPowerUps
                    .map((type) => {
                      const def = POWERUP_DEFINITIONS[type];
                      return def
                        ? `<span style="font-size:11px;padding:2px 8px;background:var(--bg-deep);border:1px solid ${def.color}40;border-radius:4px;color:${def.color};">${t(`game:powerups.${type}.name`)}</span>`
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
    `,
    );
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
    const teamLabel = isTeamsMode
      ? playerTeam === 0
        ? t('game:teams.red')
        : t('game:teams.blue')
      : '';

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
            ${isPlayerHost ? `<span style="color:var(--primary);font-size:11px;margin-left:6px;font-family:var(--font-display);letter-spacing:0.5px;">${t('ui:room.hostLabel')}</span>` : ''}
          </div>
          <div style="font-size:12px;color:var(--text-muted);">
            @${escapeHtml(player.user.username)}
            ${isTeamsMode ? ` <span style="color:${color};font-weight:600;">${teamLabel}</span>` : ''}
          </div>
        </div>
        ${
          isTeamsMode && iAmHost
            ? `
          <select class="team-select admin-select" data-user-id="${player.user.id}" aria-label="${t('ui:room.teamAssignment', { username: escapeHtml(player.user.username) })}">
            <option value="0" ${playerTeam === 0 ? 'selected' : ''} style="color:#ff4466;">${t('game:teams.red')}</option>
            <option value="1" ${playerTeam === 1 ? 'selected' : ''} style="color:#448aff;">${t('game:teams.blue')}</option>
          </select>
        `
            : ''
        }
        <div>
          ${
            isPlayerHost
              ? `<span style="color:var(--primary);font-size:12px;font-weight:700;font-family:var(--font-display);letter-spacing:0.5px;">${t('ui:room.hostLabel')}</span>`
              : player.ready
                ? `<span style="color:var(--success);font-size:12px;font-weight:700;font-family:var(--font-display);">${t('ui:room.readyStatus')}</span>`
                : `<span style="color:var(--text-muted);font-size:12px;">${t('ui:room.notReady')}</span>`
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
    const botNames = [
      t('ui:room.botNames.bomberBot'),
      t('ui:room.botNames.blastBot'),
      t('ui:room.botNames.kaboom'),
      t('ui:room.botNames.tnt'),
      t('ui:room.botNames.dynamite'),
      t('ui:room.botNames.sparky'),
    ];
    const botTeams = this.room.config.botTeams || [];
    const humanCount = this.room.players.length;

    let html = '';
    for (let i = 0; i < botCount; i++) {
      const botName = botNames[i % botNames.length];
      const botTeam = botTeams[i] ?? (humanCount + i) % 2;
      const teamColors = ['#ff4466', '#448aff'];
      const color = isTeamsMode ? teamColors[botTeam] : 'var(--text-muted)';
      const teamLabel = isTeamsMode
        ? botTeam === 0
          ? t('game:teams.red')
          : t('game:teams.blue')
        : '';

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
              <span style="color:var(--text-muted);font-size:11px;margin-left:6px;font-family:var(--font-display);letter-spacing:0.5px;">${t('ui:room.botLabel')}</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);">
              ${isTeamsMode ? `<span style="color:${color};font-weight:600;">${teamLabel}</span>` : t('ui:room.aiPlayer')}
            </div>
          </div>
          ${
            isTeamsMode && iAmHost
              ? `
            <select class="bot-team-select admin-select" data-bot-index="${i}" aria-label="${t('ui:room.botTeamAssignment', { index: i + 1 })}">
              <option value="0" ${botTeam === 0 ? 'selected' : ''} style="color:#ff4466;">${t('game:teams.red')}</option>
              <option value="1" ${botTeam === 1 ? 'selected' : ''} style="color:#448aff;">${t('game:teams.blue')}</option>
            </select>
          `
              : ''
          }
          <div>
            <span style="color:var(--success);font-size:12px;font-weight:700;font-family:var(--font-display);">${t('ui:room.readyStatus')}</span>
          </div>
        </div>
      `;
    }
    return html;
  }
}
