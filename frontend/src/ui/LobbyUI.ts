import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { AdminUI } from './AdminUI';
import { RoomListItem, Room, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';
import { showCreateRoomModal } from './modals/CreateRoomModal';
import { showAccountModal } from './modals/AccountModal';
import { showSettingsModal } from './modals/SettingsModal';
import { showHelpModal } from './modals/HelpModal';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';

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
    onJoinRoom: (room: Room) => void,
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
    this.container.remove();
  }

  private render(): void {
    const user = this.authManager.getUser();
    this.container.innerHTML = `
      <div class="lobby-header">
        <h1><span>BLAST</span>ARENA</h1>
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

    this.container
      .querySelector('#create-room-btn')!
      .addEventListener('click', () => this.showCreateRoomModal());
    this.container
      .querySelector('#account-btn')!
      .addEventListener('click', () => this.showAccountModal());
    this.container
      .querySelector('#settings-btn')!
      .addEventListener('click', () => this.showSettingsModal());
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
      <div class="room-card" data-code="${room.code}">
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

  private showCreateRoomModal(): void {
    showCreateRoomModal({
      socketClient: this.socketClient,
      notifications: this.notifications,
      onRoomCreated: (room) => {
        this.hide();
        this.onJoinRoom(room);
      },
      generateRoomName: () => this.generateRoomName(),
    });
  }

  private showAccountModal(): void {
    showAccountModal({
      authManager: this.authManager,
      notifications: this.notifications,
      onUpdate: () => this.render(),
    });
  }

  private showSettingsModal(): void {
    showSettingsModal();
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
