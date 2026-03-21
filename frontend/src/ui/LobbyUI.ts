import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { NotificationUI } from './NotificationUI';
import { PartyBar } from './PartyBar';
import { LobbyChatPanel } from './LobbyChatPanel';
import { RoomListItem, Room } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { ILobbyView, ViewDeps } from './views/types';
import { RoomsView } from './views/RoomsView';

const SIDEBAR_COLLAPSED_KEY = 'blast-arena-sidebar-collapsed';

export class LobbyUI {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onJoinRoom: (room: Room) => void;
  private roomListHandler: ((rooms: RoomListItem[]) => void) | null = null;
  private lobbyChatToggleHandler: (() => void) | null = null;
  private partyBar: PartyBar;
  private lobbyChatPanel: LobbyChatPanel;
  private sidebarCollapsed = false;
  private activeView: ILobbyView | null = null;
  private activeViewId = 'rooms';
  private roomsView: RoomsView | null = null;
  private initialView: string | null = null;
  private initialViewOptions: Record<string, any> | null = null;

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
    this.container.className = 'app-layout';
    this.sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    const user = authManager.getUser();
    const userId = user?.id ?? 0;
    const userRole = user?.role ?? 'user';
    this.lobbyChatPanel = new LobbyChatPanel(socketClient, notifications, userId, userRole);
    this.partyBar = new PartyBar(socketClient, notifications, userId, userRole);
    this.partyBar.setJoinRoomCallback((roomCode) => this.joinRoom(roomCode));
  }

  show(initialView?: string, viewOptions?: Record<string, any>): void {
    this.initialView = initialView || null;
    this.initialViewOptions = viewOptions || null;

    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    this.render();

    // Set up room list listener (stays active across view changes)
    this.roomListHandler = (rooms: RoomListItem[]) => {
      if (this.roomsView) {
        this.roomsView.updateRooms(rooms);
      }
    };
    this.socketClient.on('room:list' as any, this.roomListHandler as any);

    // Mount persistent UI
    const mainContent = this.container.querySelector('.main-content') as HTMLElement;
    if (mainContent) {
      this.partyBar.mount(mainContent);
    }
    this.lobbyChatPanel.mount(this.container);

    // Listen for lobby chat user-setting toggle
    this.lobbyChatToggleHandler = () => this.lobbyChatPanel.refreshVisibility();
    window.addEventListener('lobbychat-toggle', this.lobbyChatToggleHandler);

    // Navigate to initial view
    this.navigateTo(this.initialView || 'rooms', this.initialViewOptions || undefined);

    // Sidebar rank/level badges
    this.loadSidebarBadges();
  }

  showView(viewId: string, options?: Record<string, any>): void {
    this.navigateTo(viewId, options);
  }

  hide(): void {
    this.activeView?.destroy();
    this.activeView = null;
    this.roomsView = null;
    if (this.roomListHandler) {
      this.socketClient.off('room:list' as any, this.roomListHandler as any);
      this.roomListHandler = null;
    }
    if (this.lobbyChatToggleHandler) {
      window.removeEventListener('lobbychat-toggle', this.lobbyChatToggleHandler);
      this.lobbyChatToggleHandler = null;
    }
    UIGamepadNavigator.getInstance().popContext('lobby');
    this.lobbyChatPanel.unmount();
    this.container.remove();
  }

  destroyPanels(): void {
    this.partyBar.destroy();
    this.lobbyChatPanel.destroy();
  }

  private async navigateTo(viewId: string, options?: Record<string, any>): Promise<void> {
    // Destroy current view
    if (this.activeView) {
      this.activeView.destroy();
      this.activeView = null;
    }

    this.activeViewId = viewId;

    // Update sidebar active state
    this.container.querySelectorAll('.sidebar-nav-item').forEach((item) => {
      item.classList.toggle('active', item.id === `nav-${viewId}`);
    });

    // Create view
    const view = await this.createView(viewId, options);
    this.activeView = view;

    // Update main header actions
    const headerActions = this.container.querySelector('.main-header-actions') as HTMLElement;
    if (headerActions) {
      headerActions.innerHTML = view.getHeaderActions?.() ?? '';
      this.bindHeaderActions(viewId);
    }

    // Views with their own sub-header hide .main-header; others show it
    const viewsWithOwnHeader = ['admin', 'settings', 'help', 'friends'];
    const mainHeader = this.container.querySelector('.main-header') as HTMLElement;
    if (mainHeader) {
      mainHeader.style.display = viewsWithOwnHeader.includes(viewId) ? 'none' : '';
    }

    // Clear and render main body
    const mainBody = this.container.querySelector('.main-body') as HTMLElement;
    if (mainBody) {
      mainBody.innerHTML = '';
      await view.render(mainBody);
    }

    // Update gamepad context
    this.updateGamepadContext();
  }

  private async createView(viewId: string, options?: Record<string, any>): Promise<ILobbyView> {
    const deps: ViewDeps = {
      socketClient: this.socketClient,
      authManager: this.authManager,
      notifications: this.notifications,
    };

    switch (viewId) {
      case 'rooms': {
        const view = new RoomsView(deps, (room) => {
          this.hide();
          this.onJoinRoom(room);
        });
        this.roomsView = view;
        return view;
      }
      case 'admin': {
        const { AdminView } = await import('./views/AdminView');
        return new AdminView(deps, options);
      }
      case 'settings': {
        const { SettingsView } = await import('./views/SettingsView');
        return new SettingsView(deps);
      }
      case 'help': {
        const { HelpView } = await import('./views/HelpView');
        return new HelpView(deps);
      }
      case 'leaderboard': {
        const { LeaderboardView } = await import('./views/LeaderboardView');
        return new LeaderboardView(deps, (userId) => this.navigateTo('profile', { userId }));
      }
      case 'campaign': {
        const { CampaignView } = await import('./views/CampaignView');
        return new CampaignView(deps, this.partyBar);
      }
      case 'friends': {
        const { FriendsView } = await import('./views/FriendsView');
        return new FriendsView(deps, (userId: number, username: string) => {
          this.navigateTo('messages', { userId, username });
        });
      }
      case 'messages': {
        const { MessagesView } = await import('./views/MessagesView');
        return new MessagesView(deps, options);
      }
      case 'party': {
        const { PartyView } = await import('./views/PartyView');
        return new PartyView(deps, this.partyBar);
      }
      case 'create-room': {
        const { CreateRoomView } = await import('./views/CreateRoomView');
        return new CreateRoomView(
          deps,
          (room) => {
            this.hide();
            this.onJoinRoom(room);
          },
          () => this.navigateTo('rooms'),
        );
      }
      case 'profile': {
        const { ProfileView } = await import('./views/ProfileView');
        return new ProfileView(deps, options);
      }
      default:
        return new RoomsView(deps, (room) => {
          this.hide();
          this.onJoinRoom(room);
        });
    }
  }

  private bindHeaderActions(viewId: string): void {
    if (viewId === 'rooms') {
      const createBtn = this.container.querySelector('#create-room-btn');
      if (createBtn) {
        createBtn.addEventListener('click', () => this.navigateTo('create-room'));
      }
    }
  }

  private render(): void {
    const user = this.authManager.getUser();
    const isStaff = user?.role === 'admin' || user?.role === 'moderator';
    const username = escapeHtml(user?.username ?? '');
    const initial = (user?.username ?? 'U')[0].toUpperCase();
    const collapsedClass = this.sidebarCollapsed ? ' collapsed' : '';

    this.container.innerHTML = `
      <nav class="sidebar${collapsedClass}">
        <div class="sidebar-brand">
          <h1 class="sidebar-brand-full"><span>BLAST</span>ARENA</h1>
          <div class="sidebar-brand-icon"><span>B</span>A</div>
        </div>

        <div class="sidebar-nav">
          <div class="sidebar-section-label">Play</div>
          <button class="sidebar-nav-item active" id="nav-rooms">
            <span class="nav-icon">&#9776;</span>
            <span class="nav-label">Rooms</span>
          </button>
          <button class="sidebar-nav-item" id="nav-campaign">
            <span class="nav-icon">&#9876;</span>
            <span class="nav-label">Campaign</span>
          </button>

          <div class="sidebar-section-label">Social</div>
          <button class="sidebar-nav-item" id="nav-friends">
            <span class="nav-icon">&#9829;</span>
            <span class="nav-label">Friends</span>
          </button>
          <button class="sidebar-nav-item" id="nav-messages">
            <span class="nav-icon">&#9993;</span>
            <span class="nav-label">Messages</span>
          </button>
          <button class="sidebar-nav-item" id="nav-party">
            <span class="nav-icon">&#9733;</span>
            <span class="nav-label">Party</span>
          </button>

          <div class="sidebar-section-label">Progress</div>
          <button class="sidebar-nav-item" id="nav-leaderboard">
            <span class="nav-icon">&#9818;</span>
            <span class="nav-label">Leaderboard</span>
          </button>

          <div class="sidebar-divider"></div>

          <button class="sidebar-nav-item" id="nav-settings">
            <span class="nav-icon">&#9881;</span>
            <span class="nav-label">Settings</span>
          </button>
          <button class="sidebar-nav-item" id="nav-help">
            <span class="nav-icon">?</span>
            <span class="nav-label">Help</span>
          </button>
          ${
            isStaff
              ? `
          <button class="sidebar-nav-item" id="nav-admin">
            <span class="nav-icon">&#9888;</span>
            <span class="nav-label">Admin</span>
          </button>
          `
              : ''
          }
        </div>

        <div class="sidebar-footer">
          <div class="sidebar-user" id="sidebar-user-profile" style="cursor:pointer;" title="View profile">
            <div class="sidebar-user-avatar">${initial}</div>
            <div class="sidebar-user-info">
              <div class="sidebar-user-name">${username}</div>
              <div class="sidebar-user-rank">
                <span id="sidebar-level"></span>
                <span id="sidebar-rank"></span>
              </div>
            </div>
          </div>
          <button class="sidebar-nav-item" id="nav-logout">
            <span class="nav-icon">&#10132;</span>
            <span class="nav-label">Logout</span>
          </button>
        </div>
      </nav>
      <button class="sidebar-ear" id="sidebar-toggle" title="${this.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}">
        <span class="sidebar-ear-icon">${this.sidebarCollapsed ? '&#9654;' : '&#9664;'}</span>
      </button>

      <div class="main-content">
        <div class="main-header">
          <div class="main-header-actions"></div>
        </div>
        <div class="main-body"></div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Navigation items
    this.container
      .querySelector('#nav-rooms')!
      .addEventListener('click', () => this.navigateTo('rooms'));
    this.container
      .querySelector('#nav-campaign')!
      .addEventListener('click', () => this.navigateTo('campaign'));
    this.container
      .querySelector('#nav-friends')!
      .addEventListener('click', () => this.navigateTo('friends'));
    this.container
      .querySelector('#nav-messages')!
      .addEventListener('click', () => this.navigateTo('messages'));
    this.container
      .querySelector('#nav-leaderboard')!
      .addEventListener('click', () => this.navigateTo('leaderboard'));
    this.container
      .querySelector('#nav-settings')!
      .addEventListener('click', () => this.navigateTo('settings'));
    this.container
      .querySelector('#nav-help')!
      .addEventListener('click', () => this.navigateTo('help'));

    const adminBtn = this.container.querySelector('#nav-admin');
    if (adminBtn) {
      adminBtn.addEventListener('click', () => this.navigateTo('admin'));
    }

    this.container
      .querySelector('#nav-party')!
      .addEventListener('click', () => this.navigateTo('party'));

    this.container.querySelector('#sidebar-user-profile')!.addEventListener('click', () => {
      const user = this.authManager.getUser();
      if (user) this.navigateTo('profile', { userId: user.id });
    });

    this.container.querySelector('#nav-logout')!.addEventListener('click', () => {
      this.authManager.logout();
      this.hide();
    });

    // Sidebar collapse toggle (ear)
    this.container.querySelector('#sidebar-toggle')!.addEventListener('click', () => {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(this.sidebarCollapsed));
      const sidebar = this.container.querySelector('.sidebar')!;
      sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
      const ear = this.container.querySelector('#sidebar-toggle') as HTMLElement;
      const icon = ear.querySelector('.sidebar-ear-icon')!;
      icon.innerHTML = this.sidebarCollapsed ? '&#9654;' : '&#9664;';
      ear.title = this.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
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

  private loadSidebarBadges(): void {
    import('../network/ApiClient').then(({ ApiClient }) => {
      ApiClient.get<{ rankTier: string; rankColor: string; level?: number }>('/user/rank')
        .then((rank) => {
          const sidebarLevel = this.container.querySelector('#sidebar-level') as HTMLElement;
          if (sidebarLevel && rank.level) {
            sidebarLevel.textContent = `Lvl ${rank.level}`;
          }
          const sidebarRank = this.container.querySelector('#sidebar-rank') as HTMLElement;
          if (sidebarRank && rank.rankTier) {
            sidebarRank.textContent = rank.rankTier;
            sidebarRank.style.color = rank.rankColor;
          }
        })
        .catch(() => {});
    });
  }

  private updateGamepadContext(): void {
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.popContext('lobby');
    gpNav.pushContext({
      id: 'lobby',
      elements: () => [
        ...this.container.querySelectorAll<HTMLElement>('.sidebar-nav-item'),
        ...this.container.querySelectorAll<HTMLElement>(
          '.main-body input, .main-body select, .main-body textarea, .main-body button, .main-body .btn, .main-body .room-card, .main-body .admin-tab, .main-body .tab-item',
        ),
        ...this.container.querySelectorAll<HTMLElement>('.main-header .btn'),
      ],
      onBack: () => {
        if (this.activeViewId !== 'rooms') {
          this.navigateTo('rooms');
        }
      },
    });
  }
}
