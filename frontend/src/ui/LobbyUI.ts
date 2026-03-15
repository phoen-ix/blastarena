import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { RoomListItem, Room, GAME_MODES, GameMode, PowerUpType, POWERUP_DEFINITIONS } from '@blast-arena/shared';
import { getSettings, saveSettings, VisualSettings } from '../game/Settings';

export class LobbyUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onJoinRoom: (room: Room) => void;

  constructor(
    socketClient: SocketClient,
    authManager: AuthManager,
    notifications: NotificationUI,
    onJoinRoom: (room: Room) => void
  ) {
    this.socketClient = socketClient;
    this.authManager = authManager;
    this.notifications = notifications;
    this.onJoinRoom = onJoinRoom;
    this.container = document.createElement('div');
    this.container.className = 'lobby-container';
  }

  show(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    this.render();
    this.loadRooms();
  }

  hide(): void {
    this.container.remove();
  }

  private render(): void {
    const user = this.authManager.getUser();
    this.container.innerHTML = `
      <div class="lobby-header">
        <h1>BlastArena</h1>
        <div style="display:flex;gap:12px;align-items:center;">
          <span style="color:#a0a0b0;">Welcome, <strong style="color:#fff;">${user?.displayName || user?.username}</strong></span>
          ${user?.role === 'admin' ? '<button class="btn btn-secondary" id="admin-btn">Admin</button>' : ''}
          <button class="btn btn-primary" id="create-room-btn">Create Room</button>
          <button class="btn btn-secondary" id="settings-btn">Settings</button>
          <button class="btn btn-secondary" id="help-btn">Help</button>
          <button class="btn btn-secondary" id="logout-btn">Logout</button>
        </div>
      </div>
      <div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">
        <span style="color:#a0a0b0;">Available Rooms</span>
        <button class="btn btn-secondary" id="refresh-btn" style="padding:6px 12px;font-size:12px;">Refresh</button>
      </div>
      <div class="room-list" id="room-list">
        <div style="color:#a0a0b0;text-align:center;padding:40px;">Loading rooms...</div>
      </div>
    `;

    this.container.querySelector('#create-room-btn')!.addEventListener('click', () => this.showCreateRoomModal());
    this.container.querySelector('#settings-btn')!.addEventListener('click', () => this.showSettingsModal());
    this.container.querySelector('#help-btn')!.addEventListener('click', () => this.showHelpModal());
    this.container.querySelector('#refresh-btn')!.addEventListener('click', () => this.loadRooms());
    this.container.querySelector('#logout-btn')!.addEventListener('click', () => {
      this.authManager.logout();
      this.hide();
    });

    const adminBtn = this.container.querySelector('#admin-btn');
    if (adminBtn) {
      adminBtn.addEventListener('click', () => {
        this.notifications.info('Admin panel - coming soon');
      });
    }
  }

  private async loadRooms(): Promise<void> {
    try {
      const rooms = await ApiClient.get<RoomListItem[]>('/lobby/rooms');
      this.renderRooms(rooms);
    } catch (err: any) {
      this.notifications.error('Failed to load rooms: ' + err.message);
    }
  }

  private renderRooms(rooms: RoomListItem[]): void {
    const list = this.container.querySelector('#room-list')!;
    if (rooms.length === 0) {
      list.innerHTML = '<div style="color:#a0a0b0;text-align:center;padding:40px;">No rooms available. Create one!</div>';
      return;
    }

    list.innerHTML = rooms.map(room => `
      <div class="room-card" data-code="${room.code}">
        <h3>${this.escapeHtml(room.name)}</h3>
        <div class="room-info">
          <span>${room.playerCount}/${room.maxPlayers} players</span>
          <span class="room-mode">${room.gameMode.replace('_', ' ').toUpperCase()}</span>
        </div>
        <div class="room-info" style="margin-top:4px;">
          <span>Host: ${this.escapeHtml(room.host)}</span>
          <span>${room.status}</span>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.room-card').forEach(card => {
      card.addEventListener('click', () => {
        const code = card.getAttribute('data-code')!;
        this.joinRoom(code);
      });
    });
  }

  private async joinRoom(code: string): Promise<void> {
    this.socketClient.emit('room:join', { code }, (response: any) => {
      if (response.success && response.room) {
        this.notifications.success(`Joined room: ${response.room.name}`);
        this.hide();
        this.onJoinRoom(response.room);
      } else {
        this.notifications.error(response.error || 'Failed to join room');
      }
    });
  }

  private showCreateRoomModal(): void {
    const allPowerUps = Object.values(POWERUP_DEFINITIONS);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="width:520px;max-height:90vh;overflow-y:auto;">
        <h2>Create Room</h2>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label>Room Name</label>
            <input type="text" id="room-name" placeholder="My Arena" maxlength="30">
          </div>
          <div class="form-group">
            <label>Game Mode</label>
            <select id="room-mode">
              <option value="ffa">Free for All</option>
              <option value="teams">Teams</option>
              <option value="battle_royale">Battle Royale</option>
              <option value="sudden_death">Sudden Death</option>
              <option value="deathmatch">Deathmatch</option>
              <option value="king_of_the_hill">King of the Hill</option>
            </select>
          </div>
          <div class="form-group">
            <label>Max Players</label>
            <select id="room-max-players">
              <option value="2">2</option>
              <option value="4" selected>4</option>
              <option value="6">6</option>
              <option value="8">8</option>
            </select>
          </div>
          <div class="form-group">
            <label>Match Time</label>
            <select id="room-round-time">
              <option value="60">1 min</option>
              <option value="120">2 min</option>
              <option value="180" selected>3 min</option>
              <option value="300">5 min</option>
              <option value="600">10 min</option>
            </select>
          </div>
          <div class="form-group">
            <label>Wall Density</label>
            <select id="room-wall-density">
              <option value="0.3">Low (30%)</option>
              <option value="0.5">Medium (50%)</option>
              <option value="0.65" selected>High (65%)</option>
              <option value="0.8">Very High (80%)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Power-Up Drop Rate</label>
            <select id="room-powerup-rate">
              <option value="0">None (0%)</option>
              <option value="0.15">Low (15%)</option>
              <option value="0.3" selected>Normal (30%)</option>
              <option value="0.5">High (50%)</option>
              <option value="0.8">Very High (80%)</option>
            </select>
          </div>
          <div class="form-group">
            <label>Bots</label>
            <select id="room-bots">
              <option value="0" selected>None</option>
              <option value="1">1 Bot</option>
              <option value="2">2 Bots</option>
              <option value="3">3 Bots</option>
              <option value="4">4 Bots</option>
              <option value="5">5 Bots</option>
              <option value="6">6 Bots</option>
              <option value="7">7 Bots</option>
            </select>
          </div>
          <div class="form-group" id="bot-difficulty-row" style="display:none;">
            <label>Bot Difficulty</label>
            <select id="room-bot-difficulty">
              <option value="easy">Easy</option>
              <option value="normal" selected>Normal</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div class="form-group">
            <label>Map Size</label>
            <select id="room-map-size">
              <option value="11">11x11 (Small)</option>
              <option value="15" selected>15x15 (Normal)</option>
              <option value="19">19x19 (Large)</option>
              <option value="25">25x25 (Huge)</option>
              <option value="31">31x31 (Massive)</option>
            </select>
          </div>
        </div>

        <div id="friendly-fire-row" style="display:none;gap:12px;margin-top:12px;">
          <label style="display:flex;align-items:center;gap:8px;padding:8px 12px;
            background:#1a1a2e;border:1px solid #0f3460;border-radius:6px;cursor:pointer;font-size:13px;flex:1;">
            <input type="checkbox" id="room-friendly-fire" checked style="accent-color:#e94560;">
            <span style="color:#e94560;font-weight:600;">Friendly Fire</span>
          </label>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
          <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
            background:#1a1a2e;border:1px solid #0f3460;border-radius:6px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="room-reinforced-walls" style="accent-color:#886633;">
            <span style="color:#886633;font-weight:600;">Reinforced Walls</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
            background:#1a1a2e;border:1px solid #0f3460;border-radius:6px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="room-map-events" style="accent-color:#ff8800;">
            <span style="color:#ff8800;font-weight:600;">Map Events</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
            background:#1a1a2e;border:1px solid #0f3460;border-radius:6px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="room-hazard-tiles" style="accent-color:#44aaff;">
            <span style="color:#44aaff;font-weight:600;">Hazard Tiles</span>
          </label>
        </div>

        <div class="form-group" style="margin-top:12px;">
          <label>Power-Ups</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
            ${allPowerUps.map(pu => `
              <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
                background:#1a1a2e;border:1px solid #0f3460;border-radius:6px;cursor:pointer;font-size:13px;">
                <input type="checkbox" class="powerup-check" value="${pu.type}" checked
                  style="accent-color:${pu.color};">
                <span style="color:${pu.color};font-weight:600;">${pu.name}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-create">Create</button>
        </div>
      </div>
    `;

    // Show friendly fire option only for teams mode
    const modeSelect = modal.querySelector('#room-mode') as HTMLSelectElement;
    const ffRow = modal.querySelector('#friendly-fire-row') as HTMLElement;
    const updateFFVisibility = () => {
      ffRow.style.display = modeSelect.value === 'teams' ? 'flex' : 'none';
    };
    modeSelect.addEventListener('change', updateFFVisibility);
    updateFFVisibility();

    // Show bot difficulty only when bots > 0
    const botsSelect = modal.querySelector('#room-bots') as HTMLSelectElement;
    const botDiffRow = modal.querySelector('#bot-difficulty-row') as HTMLElement;
    const updateBotDiffVisibility = () => {
      botDiffRow.style.display = parseInt(botsSelect.value) > 0 ? 'block' : 'none';
    };
    botsSelect.addEventListener('change', updateBotDiffVisibility);
    updateBotDiffVisibility();

    modal.querySelector('#modal-cancel')!.addEventListener('click', () => modal.remove());
    modal.querySelector('#modal-create')!.addEventListener('click', () => {
      const name = (modal.querySelector('#room-name') as HTMLInputElement).value.trim();
      const gameMode = (modal.querySelector('#room-mode') as HTMLSelectElement).value as any;
      const maxPlayers = parseInt((modal.querySelector('#room-max-players') as HTMLSelectElement).value);
      const roundTime = parseInt((modal.querySelector('#room-round-time') as HTMLSelectElement).value);
      const wallDensity = parseFloat((modal.querySelector('#room-wall-density') as HTMLSelectElement).value);
      const powerUpDropRate = parseFloat((modal.querySelector('#room-powerup-rate') as HTMLSelectElement).value);
      const botCount = parseInt((modal.querySelector('#room-bots') as HTMLSelectElement).value);
      const botDifficulty = (modal.querySelector('#room-bot-difficulty') as HTMLSelectElement).value as 'easy' | 'normal' | 'hard';

      const enabledPowerUps: PowerUpType[] = [];
      modal.querySelectorAll('.powerup-check:checked').forEach((cb: any) => {
        enabledPowerUps.push(cb.value as PowerUpType);
      });

      const roomName = name || this.generateRoomName();

      // Cap bots so total (1 host + bots) doesn't exceed maxPlayers
      const effectiveBots = Math.min(botCount, maxPlayers - 1);
      if (effectiveBots < botCount) {
        this.notifications.info(`Bot count capped to ${effectiveBots} (max ${maxPlayers} players)`);
      }

      const mapSize = parseInt((modal.querySelector('#room-map-size') as HTMLSelectElement).value);
      const friendlyFire = gameMode === 'teams' ? (modal.querySelector('#room-friendly-fire') as HTMLInputElement).checked : true;
      const reinforcedWalls = (modal.querySelector('#room-reinforced-walls') as HTMLInputElement).checked;
      const enableMapEvents = (modal.querySelector('#room-map-events') as HTMLInputElement).checked;
      const hazardTiles = (modal.querySelector('#room-hazard-tiles') as HTMLInputElement).checked;

      this.socketClient.emit('room:create', {
        name: roomName,
        config: {
          gameMode,
          maxPlayers,
          mapWidth: mapSize,
          mapHeight: mapSize,
          roundTime,
          wallDensity,
          enabledPowerUps,
          powerUpDropRate,
          botCount: effectiveBots,
          botDifficulty: effectiveBots > 0 ? botDifficulty : undefined,
          friendlyFire,
          reinforcedWalls,
          enableMapEvents,
          hazardTiles,
        },
      }, (response: any) => {
        if (response.success && response.room) {
          modal.remove();
          this.notifications.success('Room created!');
          this.hide();
          this.onJoinRoom(response.room);
        } else {
          this.notifications.error(response.error || 'Failed to create room');
        }
      });
    });

    document.getElementById('ui-overlay')!.appendChild(modal);
  }

  private showSettingsModal(): void {
    const settings = getSettings();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="width:300px;">
        <h2>Visual Settings</h2>
        <label class="settings-option">
          <input type="checkbox" name="animations" ${settings.animations ? 'checked' : ''}>
          <span>Animations</span>
        </label>
        <label class="settings-option">
          <input type="checkbox" name="screenShake" ${settings.screenShake ? 'checked' : ''}>
          <span>Screen Shake</span>
        </label>
        <label class="settings-option">
          <input type="checkbox" name="particles" ${settings.particles ? 'checked' : ''}>
          <span>Particles</span>
        </label>
        <div class="modal-actions">
          <button class="btn btn-primary" id="modal-close">Close</button>
        </div>
      </div>
    `;

    modal.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target || target.type !== 'checkbox') return;
      const key = target.name as keyof VisualSettings;
      const current = getSettings();
      (current as any)[key] = target.checked;
      saveSettings(current);
    });

    modal.querySelector('#modal-close')!.addEventListener('click', () => modal.remove());

    document.getElementById('ui-overlay')!.appendChild(modal);
  }

  private showHelpModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="width:450px;max-height:80vh;overflow-y:auto;">
        <h2>Controls & Items</h2>

        <div class="help-section">
          <div class="help-heading">Controls</div>
          <div class="help-row"><span class="help-key">WASD / Arrows</span> Move</div>
          <div class="help-row"><span class="help-key">Space</span> Place bomb</div>
          <div class="help-row"><span class="help-key">E</span> Detonate remote bombs</div>
          <div class="help-row"><span class="help-key">1-9</span> Spectate Nth player (when dead)</div>
        </div>

        <div class="help-section">
          <div class="help-heading">Power-Ups</div>
          <div class="help-row"><span class="help-icon" style="color:#FF4444">💣+</span> <b>Bomb Up</b> — +1 max bombs (up to 8)</div>
          <div class="help-row"><span class="help-icon" style="color:#FF8800">🔥+</span> <b>Fire Up</b> — +1 explosion range (up to 8)</div>
          <div class="help-row"><span class="help-icon" style="color:#44AAFF">⚡+</span> <b>Speed Up</b> — faster movement (up to 5)</div>
          <div class="help-row"><span class="help-icon" style="color:#44FF44">🛡️</span> <b>Shield</b> — absorbs one explosion</div>
          <div class="help-row"><span class="help-icon" style="color:#CC44FF">👢</span> <b>Kick</b> — walk into a bomb to slide it</div>
          <div class="help-row"><span class="help-icon" style="color:#FF2222">➜</span> <b>Pierce Bomb</b> — blasts go through breakable walls</div>
          <div class="help-row"><span class="help-icon" style="color:#4488FF">📡</span> <b>Remote Bomb</b> — bombs don't auto-explode; press <span class="help-key">E</span> to detonate all at once</div>
          <div class="help-row"><span class="help-icon" style="color:#FFAA44">●●●</span> <b>Line Bomb</b> — places a line of bombs in your facing direction</div>
        </div>

        <div class="help-section">
          <div class="help-heading">Tips</div>
          <div class="help-row">Stand behind a wall before your bomb explodes</div>
          <div class="help-row">Chain reactions: bombs caught in an explosion detonate instantly</div>
          <div class="help-row">Self-kills subtract from your score</div>
          <div class="help-row">You're invulnerable for 2s after spawning</div>
          <div class="help-row">Kicked bombs slide until they hit a wall, bomb, or player</div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-primary" id="modal-close">Close</button>
        </div>
      </div>
    `;

    modal.querySelector('#modal-close')!.addEventListener('click', () => modal.remove());

    document.getElementById('ui-overlay')!.appendChild(modal);
  }

  private generateRoomName(): string {
    const adjectives = ['Explosive', 'Chaotic', 'Blazing', 'Fiery', 'Reckless', 'Volatile', 'Scorched', 'Molten', 'Infernal', 'Savage'];
    const nouns = ['Arena', 'Warzone', 'Blitz', 'Showdown', 'Brawl', 'Mayhem', 'Rumble', 'Frenzy', 'Clash', 'Carnage'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
