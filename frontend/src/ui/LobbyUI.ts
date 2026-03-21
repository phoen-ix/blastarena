import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { AdminUI } from './AdminUI';
import { CampaignUI } from './CampaignUI';
import { FriendsPanel } from './FriendsPanel';
import { PartyBar } from './PartyBar';
import { LobbyChatPanel } from './LobbyChatPanel';
import { DMPanel } from './DMPanel';
import { RoomListItem, Room, GameDefaults, BotAIEntry, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml, escapeAttr } from '../utils/html';
import { showCreateRoomModal } from './modals/CreateRoomModal';
import { showHelpModal } from './modals/HelpModal';
import { SettingsUI } from './SettingsUI';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';

export class LobbyUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onJoinRoom: (room: Room) => void;
  private roomListHandler: ((rooms: RoomListItem[]) => void) | null = null;
  private friendsPanel: FriendsPanel;
  private partyBar: PartyBar;
  private lobbyChatPanel: LobbyChatPanel;
  private dmPanel: DMPanel;

  constructor(
    socketClient: SocketClient,
    authManager: AuthManager,
    notifications: NotificationUI,
    onJoinRoom: (room: Room) => void,
  ) {
    this.socketClient = socketClient;
    this.authManager = authManager;
    this.notifications = notifications;
    this.onJoinRoom = onJoinRoom;
    this.container = document.createElement('div');
    this.container.className = 'lobby-container';
    const user = authManager.getUser();
    const userId = user?.id ?? 0;
    const userRole = user?.role ?? 'user';
    this.dmPanel = new DMPanel(socketClient, notifications, userId, userRole);
    this.friendsPanel = new FriendsPanel(socketClient, notifications, (fUserId, fUsername) => {
      this.dmPanel.openConversation(fUserId, fUsername);
    });
    this.lobbyChatPanel = new LobbyChatPanel(socketClient, notifications, userId, userRole);
    this.partyBar = new PartyBar(socketClient, notifications, userId, userRole);
    this.partyBar.setJoinRoomCallback((roomCode) => this.joinRoom(roomCode));
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
    this.friendsPanel.mount();
    this.partyBar.mount(this.container);
    this.lobbyChatPanel.mount(this.container);
    this.dmPanel.mount();
    UIGamepadNavigator.getInstance().pushContext({
      id: 'lobby',
      elements: () => [
        ...this.container.querySelectorAll<HTMLElement>('.lobby-header .btn'),
        ...this.container.querySelectorAll<HTMLElement>('.room-card'),
      ],
    });
  }

  hide(): void {
    if (this.roomListHandler) {
      this.socketClient.off('room:list' as any, this.roomListHandler as any);
      this.roomListHandler = null;
    }
    UIGamepadNavigator.getInstance().popContext('lobby');
    this.friendsPanel.close();
    this.lobbyChatPanel.unmount();
    this.dmPanel.close();
    this.container.remove();
  }

  destroyPanels(): void {
    this.friendsPanel.destroy();
    this.partyBar.destroy();
    this.lobbyChatPanel.destroy();
    this.dmPanel.destroy();
  }

  private render(): void {
    const user = this.authManager.getUser();
    this.container.innerHTML = `
      <div class="lobby-header">
        <h1><span>BLAST</span>ARENA</h1>
        <div style="display:flex;gap:10px;align-items:center;">
          <span style="color:var(--text-dim);font-size:13px;">Welcome, <strong style="color:var(--text);">${escapeHtml(user?.username ?? '')}</strong></span>
          ${user?.role === 'admin' || user?.role === 'moderator' ? '<button class="btn btn-ghost" id="admin-btn">Admin</button>' : ''}
          <button class="btn btn-primary" id="create-room-btn">+ New Room</button>
          <button class="btn" id="campaign-btn" style="background:linear-gradient(135deg, var(--primary), #ff8f35);color:#fff;font-weight:700;letter-spacing:0.5px;">Campaign</button>
          <button class="btn btn-ghost" id="friends-btn" style="color:var(--accent);">Friends</button>
          <button class="btn btn-ghost" id="messages-btn">Messages</button>
          <button class="btn btn-ghost" id="party-btn">Party</button>
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

    this.container
      .querySelector('#create-room-btn')!
      .addEventListener('click', () => this.showCreateRoomModal());
    this.container.querySelector('#campaign-btn')!.addEventListener('click', () => {
      this.hide();
      const campaignUI = new CampaignUI(this.socketClient, this.notifications, () => {
        this.show();
      });
      campaignUI.show();
    });
    this.container.querySelector('#friends-btn')!.addEventListener('click', () => {
      this.friendsPanel.toggle();
    });
    this.container.querySelector('#messages-btn')!.addEventListener('click', () => {
      this.dmPanel.toggle();
    });
    this.container.querySelector('#party-btn')!.addEventListener('click', () => {
      if (this.partyBar.getParty()) {
        this.notifications.info('Already in a party');
      } else {
        this.partyBar.createParty();
      }
    });
    this.container.querySelector('#settings-btn')!.addEventListener('click', () => {
      this.hide();
      const settingsUI = new SettingsUI(this.authManager, this.notifications, () => {
        this.show();
      });
      settingsUI.show();
    });
    this.container
      .querySelector('#help-btn')!
      .addEventListener('click', () => this.showHelpModal());
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
    } catch (err: unknown) {
      this.notifications.error('Failed to load rooms: ' + getErrorMessage(err));
    }
  }

  private async loadBanner(): Promise<void> {
    try {
      const banner = await ApiClient.get<any>('/admin/announcements/banner');
      const area = this.container.querySelector('#lobby-banner-area');
      if (area && banner && banner.message) {
        area.innerHTML = `
          <div class="admin-banner">
            <span>${escapeHtml(banner.message)}</span>
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
      list.innerHTML =
        '<div style="color:var(--text-muted);text-align:center;padding:60px 20px;font-size:15px;">No rooms yet — create one to get started!</div>';
      return;
    }

    list.innerHTML = rooms
      .map(
        (room) => `
      <div class="room-card" data-code="${escapeAttr(room.code)}">
        <h3>${escapeHtml(room.name)}</h3>
        <div class="room-info">
          <span>${room.playerCount}/${room.maxPlayers} players</span>
          <span class="room-mode">${room.gameMode.replace('_', ' ').toUpperCase()}</span>
        </div>
        <div class="room-info" style="margin-top:6px;">
          <span>Host: ${escapeHtml(room.host)}</span>
          <span style="color:${room.status === 'playing' ? 'var(--warning)' : 'var(--success)'};">${room.status}</span>
        </div>
      </div>
    `,
      )
      .join('');

    list.querySelectorAll('.room-card').forEach((card) => {
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

  private async showCreateRoomModal(): Promise<void> {
    let recordingsEnabled = false;
    let gameDefaults: GameDefaults = {};
    let activeAIs: BotAIEntry[] = [];
    try {
      const [recResp, defResp, aiResp] = await Promise.all([
        ApiClient.get<{ enabled: boolean }>('/admin/settings/recordings_enabled'),
        ApiClient.get<{ defaults: GameDefaults }>('/admin/settings/game_defaults'),
        ApiClient.get<{ ais: BotAIEntry[] }>('/admin/ai/active'),
      ]);
      recordingsEnabled = recResp.enabled;
      gameDefaults = defResp.defaults ?? {};
      activeAIs = aiResp.ais ?? [];
    } catch {
      // Default to false/empty on fetch failure
    }
    showCreateRoomModal({
      socketClient: this.socketClient,
      notifications: this.notifications,
      onRoomCreated: (room) => {
        this.hide();
        this.onJoinRoom(room);
      },
      generateRoomName: () => this.generateRoomName(),
      recordingsEnabled,
      gameDefaults,
      activeAIs,
    });
  }

  private showHelpModal(): void {
    showHelpModal();
  }

  private generateRoomName(): string {
    const adjectives = [
      'Explosive',
      'Chaotic',
      'Blazing',
      'Fiery',
      'Reckless',
      'Volatile',
      'Scorched',
      'Molten',
      'Infernal',
      'Savage',
    ];
    const nouns = [
      'Arena',
      'Warzone',
      'Blitz',
      'Showdown',
      'Brawl',
      'Mayhem',
      'Rumble',
      'Frenzy',
      'Clash',
      'Carnage',
    ];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
  }
}
