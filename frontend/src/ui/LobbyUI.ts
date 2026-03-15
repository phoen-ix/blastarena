import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { AdminUI } from './AdminUI';
import { RoomListItem, Room, GAME_MODES, GameMode, PowerUpType, POWERUP_DEFINITIONS } from '@blast-arena/shared';
import { getSettings, saveSettings, VisualSettings } from '../game/Settings';

export class LobbyUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onJoinRoom: (room: Room) => void;
  private roomListHandler: ((rooms: RoomListItem[]) => void) | null = null;

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
    this.loadBanner();
    this.roomListHandler = (rooms: RoomListItem[]) => this.renderRooms(rooms);
    this.socketClient.on('room:list' as any, this.roomListHandler as any);
  }

  hide(): void {
    if (this.roomListHandler) {
      this.socketClient.off('room:list' as any, this.roomListHandler as any);
      this.roomListHandler = null;
    }
    this.container.remove();
  }

  private render(): void {
    const user = this.authManager.getUser();
    this.container.innerHTML = `
      <div class="lobby-header">
        <h1>BLAST<span>ARENA</span></h1>
        <div style="display:flex;gap:10px;align-items:center;">
          <span style="color:var(--text-dim);font-size:13px;">Welcome, <strong style="color:var(--text);">${user?.username}</strong></span>
          ${user?.role === 'admin' || user?.role === 'moderator' ? '<button class="btn btn-ghost" id="admin-btn">Admin</button>' : ''}
          <button class="btn btn-primary" id="create-room-btn">+ New Room</button>
          <button class="btn btn-ghost" id="account-btn">Account</button>
          <button class="btn btn-ghost" id="settings-btn">Settings</button>
          <button class="btn btn-ghost" id="help-btn">Help</button>
          <button class="btn btn-ghost" id="logout-btn">Logout</button>
        </div>
      </div>
      <div id="lobby-banner-area" style="padding:0 24px;"></div>
      <div style="padding:16px 24px 0;"><span style="color:var(--text-dim);font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Available Rooms</span></div>
      <div class="room-list" id="room-list">
        <div style="color:var(--text-muted);text-align:center;padding:60px 20px;font-size:15px;">Loading rooms...</div>
      </div>
    `;

    this.container.querySelector('#create-room-btn')!.addEventListener('click', () => this.showCreateRoomModal());
    this.container.querySelector('#account-btn')!.addEventListener('click', () => this.showAccountModal());
    this.container.querySelector('#settings-btn')!.addEventListener('click', () => this.showSettingsModal());
    this.container.querySelector('#help-btn')!.addEventListener('click', () => this.showHelpModal());
    this.container.querySelector('#logout-btn')!.addEventListener('click', () => {
      this.authManager.logout();
      this.hide();
    });

    const adminBtn = this.container.querySelector('#admin-btn');
    if (adminBtn) {
      adminBtn.addEventListener('click', () => {
        this.hide();
        const adminUI = new AdminUI(this.socketClient, this.authManager, this.notifications, () => {
          this.show();
        });
        adminUI.show();
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

  private async loadBanner(): Promise<void> {
    try {
      const banner = await ApiClient.get<any>('/admin/announcements/banner');
      const area = this.container.querySelector('#lobby-banner-area');
      if (area && banner && banner.message) {
        area.innerHTML = `
          <div class="admin-banner">
            <span>${this.escapeHtml(banner.message)}</span>
            <button class="banner-close">&times;</button>
          </div>
        `;
        area.querySelector('.banner-close')?.addEventListener('click', () => {
          area.innerHTML = '';
        });
      }
    } catch {
      // No banner or error — ignore
    }
  }

  private renderRooms(rooms: RoomListItem[]): void {
    const list = this.container.querySelector('#room-list')!;
    if (rooms.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:60px 20px;font-size:15px;">No rooms yet — create one to get started!</div>';
      return;
    }

    list.innerHTML = rooms.map(room => `
      <div class="room-card" data-code="${room.code}">
        <h3>${this.escapeHtml(room.name)}</h3>
        <div class="room-info">
          <span>${room.playerCount}/${room.maxPlayers} players</span>
          <span class="room-mode">${room.gameMode.replace('_', ' ').toUpperCase()}</span>
        </div>
        <div class="room-info" style="margin-top:6px;">
          <span>Host: ${this.escapeHtml(room.host)}</span>
          <span style="color:${room.status === 'playing' ? 'var(--warning)' : 'var(--success)'};">${room.status}</span>
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
          <div class="form-group" id="bot-difficulty-row">
            <label>Bot Difficulty</label>
            <select id="room-bot-difficulty" disabled>
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
            background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;flex:1;">
            <input type="checkbox" id="room-friendly-fire" checked style="accent-color:var(--danger);">
            <span style="color:var(--danger);font-weight:600;">Friendly Fire</span>
          </label>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
          <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
            background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="room-reinforced-walls" style="accent-color:#886633;">
            <span style="color:#b8884d;font-weight:600;">Reinforced Walls</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
            background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="room-map-events" style="accent-color:var(--warning);">
            <span style="color:var(--warning);font-weight:600;">Map Events</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
            background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">
            <input type="checkbox" id="room-hazard-tiles" style="accent-color:var(--info);">
            <span style="color:var(--info);font-weight:600;">Hazard Tiles</span>
          </label>
        </div>

        <div class="form-group" style="margin-top:12px;">
          <label>Power-Ups</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
            ${allPowerUps.map(pu => `
              <label style="display:flex;align-items:center;gap:6px;padding:6px 10px;
                background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:13px;">
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

    // Enable bot difficulty only when bots > 0
    const botsSelect = modal.querySelector('#room-bots') as HTMLSelectElement;
    const botDiffSelect = modal.querySelector('#room-bot-difficulty') as HTMLSelectElement;
    const updateBotDiffEnabled = () => {
      const hasBots = parseInt(botsSelect.value) > 0;
      botDiffSelect.disabled = !hasBots;
      botDiffSelect.style.opacity = hasBots ? '1' : '0.4';
    };
    botsSelect.addEventListener('change', updateBotDiffEnabled);
    updateBotDiffEnabled();

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

  private async showAccountModal(): Promise<void> {
    // Fetch current profile
    let profile: any;
    try {
      profile = await ApiClient.get('/user/profile');
    } catch (err: any) {
      this.notifications.error('Failed to load profile: ' + err.message);
      return;
    }

    const user = this.authManager.getUser();
    const isAdmin = user?.role === 'admin';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="width:420px;">
        <h2>Account Settings</h2>

        <div class="form-group">
          <label>Username</label>
          <input type="text" id="acct-username" value="${this.escapeHtml(profile.username)}" maxlength="20">
          <div id="acct-username-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px;">Letters, numbers, underscores, hyphens. 3-20 characters.</div>
        </div>

        <div id="acct-profile-status" style="margin-bottom:12px;"></div>

        <div class="modal-actions" style="margin-bottom:20px;">
          <button class="btn btn-primary" id="acct-save-profile">Save</button>
        </div>

        <hr style="border-color:var(--border);margin:16px 0;">

        <div class="form-group">
          <label>Email Address</label>
          <div style="color:var(--text-dim);font-size:13px;margin-bottom:6px;">
            Current: <strong style="color:var(--text);">${this.escapeHtml(profile.email)}</strong>
            ${profile.emailVerified ? '<span style="color:var(--success);margin-left:6px;">verified</span>' : '<span style="color:var(--warning);margin-left:6px;">unverified</span>'}
          </div>
          ${!isAdmin && profile.pendingEmail ? `
            <div style="color:var(--warning);font-size:13px;margin-bottom:8px;padding:10px;background:var(--warning-dim);border:1px solid var(--warning);border-radius:8px;">
              Pending change to <strong>${this.escapeHtml(profile.pendingEmail)}</strong> — check that inbox for the confirmation link.
              <button class="btn btn-secondary" id="acct-cancel-email" style="margin-left:8px;padding:2px 8px;font-size:11px;">Cancel</button>
            </div>
          ` : ''}
          <input type="email" id="acct-new-email" placeholder="New email address" maxlength="255">
        </div>

        <div id="acct-email-status" style="margin-bottom:12px;"></div>

        <div class="modal-actions" style="margin-bottom:8px;">
          <button class="btn btn-primary" id="acct-change-email">${isAdmin ? 'Change Email' : 'Send Confirmation'}</button>
        </div>

        <hr style="border-color:var(--border);margin:16px 0;">

        <div class="modal-actions">
          <button class="btn btn-secondary" id="acct-close">Close</button>
        </div>
      </div>
    `;

    // Save profile (username)
    modal.querySelector('#acct-save-profile')!.addEventListener('click', async () => {
      const statusEl = modal.querySelector('#acct-profile-status')!;
      const newUsername = (modal.querySelector('#acct-username') as HTMLInputElement).value.trim();

      if (!newUsername) {
        statusEl.innerHTML = '<span style="color:var(--danger);">Username cannot be empty.</span>';
        return;
      }

      const updates: any = {};
      if (newUsername !== profile.username) updates.username = newUsername;

      if (Object.keys(updates).length === 0) {
        statusEl.innerHTML = '<span style="color:var(--text-dim);">No changes to save.</span>';
        return;
      }

      try {
        const updated: any = await ApiClient.put('/user/profile', updates);
        profile = updated;
        this.authManager.updateUser({
          username: updated.username,
        });
        statusEl.innerHTML = '<span style="color:var(--success);">Profile updated!</span>';
        // Re-render lobby header to show new name
        this.render();
      } catch (err: any) {
        statusEl.innerHTML = `<span style="color:var(--danger);">${this.escapeHtml(err.message)}</span>`;
      }
    });

    // Change email
    modal.querySelector('#acct-change-email')!.addEventListener('click', async () => {
      const statusEl = modal.querySelector('#acct-email-status')!;
      const newEmail = (modal.querySelector('#acct-new-email') as HTMLInputElement).value.trim();

      if (!newEmail) {
        statusEl.innerHTML = '<span style="color:var(--danger);">Enter a new email address.</span>';
        return;
      }
      if (newEmail === profile.email) {
        statusEl.innerHTML = '<span style="color:var(--text-dim);">That\'s already your current email.</span>';
        return;
      }

      try {
        const result: any = await ApiClient.post('/user/email', { email: newEmail });
        statusEl.innerHTML = `<span style="color:var(--success);">${this.escapeHtml(result.message)}</span>`;
        // Clear the input
        (modal.querySelector('#acct-new-email') as HTMLInputElement).value = '';
      } catch (err: any) {
        statusEl.innerHTML = `<span style="color:var(--danger);">${this.escapeHtml(err.message)}</span>`;
      }
    });

    // Cancel pending email change
    const cancelEmailBtn = modal.querySelector('#acct-cancel-email');
    if (cancelEmailBtn) {
      cancelEmailBtn.addEventListener('click', async () => {
        try {
          await ApiClient.delete('/user/email');
          this.notifications.success('Pending email change cancelled');
          modal.remove();
          this.showAccountModal();
        } catch (err: any) {
          this.notifications.error(err.message);
        }
      });
    }

    modal.querySelector('#acct-close')!.addEventListener('click', () => modal.remove());

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
      <div class="modal" style="width:540px;max-height:85vh;overflow-y:auto;">
        <h2>How to Play</h2>

        <div class="help-section">
          <div class="help-heading">Controls</div>
          <div class="help-row"><span class="help-key">WASD / Arrows</span> Move</div>
          <div class="help-row"><span class="help-key">Space</span> Place bomb</div>
          <div class="help-row"><span class="help-key">E</span> Detonate remote bombs</div>
          <div class="help-row"><span class="help-key">1-9</span> Spectate Nth player (when dead)</div>
        </div>

        <div class="help-section">
          <div class="help-heading">Controller (Xbox / Gamepad)</div>
          <div class="help-tip">Any standard-mapped controller works. Just plug in and play.</div>
          <div class="help-row"><span class="help-key">D-Pad / Left Stick</span> Move</div>
          <div class="help-row"><span class="help-key">A</span> Place bomb</div>
          <div class="help-row"><span class="help-key">B</span> Detonate remote bombs</div>
          <div class="help-row"><span class="help-key">LB / RB</span> Cycle spectate target (when dead)</div>
        </div>

        <div class="help-section">
          <div class="help-heading">Power-Ups</div>
          <div class="help-tip">Dropped when breakable walls are destroyed. Walk over floating tiles to collect. Your HUD (bottom-left) shows your current stats.</div>
          <div class="help-row">
            <span class="help-pu" style="background:#FF4444;">●+</span>
            <span class="help-hud">💣</span>
            <b>Bomb Up</b> — +1 max bombs (up to 8)
          </div>
          <div class="help-row">
            <span class="help-pu" style="background:#FF8800;">▲</span>
            <span class="help-hud">🔥</span>
            <b>Fire Up</b> — +1 explosion range (up to 8)
          </div>
          <div class="help-row">
            <span class="help-pu" style="background:#44AAFF;">⚡</span>
            <span class="help-hud">⚡</span>
            <b>Speed Up</b> — faster movement (up to 5)
          </div>
          <div class="help-row">
            <span class="help-pu" style="background:#44FF44;">⬡</span>
            <span class="help-hud">🛡️</span>
            <b>Shield</b> — absorbs one hit, then breaks. Doesn't stack, no time limit
          </div>
          <div class="help-row">
            <span class="help-pu" style="background:#CC44FF;">▶</span>
            <span class="help-hud">👢</span>
            <b>Kick</b> — walk into a bomb to slide it across the map
          </div>
          <div class="help-row">
            <span class="help-pu" style="background:#FF2222;">→</span>
            <span class="help-hud" style="opacity:0.3">—</span>
            <b>Pierce Bomb</b> — explosions pass through breakable walls (still destroys them)
          </div>
          <div class="help-row">
            <span class="help-pu" style="background:#4488FF;">⦿</span>
            <span class="help-hud" style="opacity:0.3">—</span>
            <b>Remote Bomb</b> — bombs don't auto-explode; press <span class="help-key">E</span> to detonate all. Auto-detonates after 10s
          </div>
          <div class="help-row">
            <span class="help-pu" style="background:#FFAA44;">●●●</span>
            <span class="help-hud" style="opacity:0.3">—</span>
            <b>Line Bomb</b> — places a line of bombs in your facing direction (uses remaining bomb capacity)
          </div>
        </div>

        <div class="help-section">
          <div class="help-heading">Game Modes</div>
          <div class="help-row"><b style="color:var(--primary)">Free for All</b> — Last player standing wins</div>
          <div class="help-row"><b style="color:var(--primary)">Teams</b> — 2 teams, last team standing. Friendly fire is configurable</div>
          <div class="help-row"><b style="color:var(--primary)">Battle Royale</b> — A danger zone shrinks from the edges. Stay inside or take damage every tick</div>
          <div class="help-row"><b style="color:var(--primary)">Sudden Death</b> — Everyone starts maxed out (8 bombs, 8 range, max speed, kick). No power-ups, one hit kills</div>
          <div class="help-row"><b style="color:var(--primary)">Deathmatch</b> — Respawn 3s after death with reset stats. First to 10 kills wins</div>
          <div class="help-row"><b style="color:var(--primary)">King of the Hill</b> — Stand in the 3x3 center zone to score. First to 100 points wins</div>
        </div>

        <div class="help-section">
          <div class="help-heading">Map Features</div>
          <div class="help-tip">Optional — toggled when creating a room.</div>
          <div class="help-row"><b style="color:#886633">Reinforced Walls</b> — Breakable walls take 2 hits. First hit cracks them, second destroys them</div>
          <div class="help-row" style="margin-top:8px;"><b style="color:var(--warning)">Map Events</b></div>
          <div class="help-row" style="padding-left:12px;">Meteor strikes hit random tiles with a 2s warning reticle on the ground</div>
          <div class="help-row" style="padding-left:12px;">Power-up rain periodically drops items across the map</div>
          <div class="help-row" style="margin-top:8px;"><b style="color:var(--info)">Hazard Tiles</b></div>
          <div class="help-row" style="padding-left:12px;">
            <span class="help-tile" style="background:radial-gradient(circle, rgba(68,170,255,0.5) 30%, rgba(68,170,255,0.15) 70%, #2a2a3e 100%);"></span>
            <span class="help-tile" style="background:radial-gradient(circle, rgba(255,136,68,0.5) 30%, rgba(255,136,68,0.15) 70%, #2a2a3e 100%);"></span>
            <b>Teleporters</b> — glowing pads in blue/orange pairs. Step on one to instantly warp to the other
          </div>
          <div class="help-row" style="padding-left:12px;">
            <span class="help-tile" style="background:#3a3a4e;color:#88aacc;font-size:14px;line-height:22px;">▸▸▸</span>
            <b>Conveyor Belts</b> — dark tiles with arrows. Push you in the arrow direction when you step on them
          </div>
        </div>

        <div class="help-section">
          <div class="help-heading">Mechanics</div>
          <div class="help-row"><b>Bombs</b> explode after 3 seconds in 4 cardinal directions up to their fire range</div>
          <div class="help-row"><b>Chain reactions</b> — bombs caught in an explosion detonate instantly</div>
          <div class="help-row"><b>Kicked bombs</b> slide until hitting a wall, bomb, or player</div>
          <div class="help-row"><b>Shield break</b> — after your shield absorbs a hit, you get brief invulnerability to escape</div>
          <div class="help-row"><b>Invulnerability</b> — 2 seconds after spawning or respawning</div>
          <div class="help-row"><b>Self-kills</b> subtract 1 from your kill score</div>
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
