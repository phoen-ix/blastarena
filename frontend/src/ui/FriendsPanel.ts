import { SocketClient } from '../network/SocketClient';
import { NotificationUI } from './NotificationUI';
import { Friend, FriendRequest, ActivityStatus } from '@blast-arena/shared';
import type { ServerToClientEvents } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';
import { t } from '../i18n';

export class FriendsPanel {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private notifications: NotificationUI;
  private onMessageFriend?: (userId: number, username: string) => void;
  private isOpen = false;
  private activeTab: 'friends' | 'requests' | 'blocked' = 'friends';
  private friends: Friend[] = [];
  private incoming: FriendRequest[] = [];
  private outgoing: FriendRequest[] = [];
  private blocked: { userId: number; username: string }[] = [];
  private searchResults: { id: number; username: string }[] = [];

  // Socket handler references for cleanup
  private friendUpdateHandler!: ServerToClientEvents['friend:update'];
  private friendRequestHandler!: ServerToClientEvents['friend:requestReceived'];
  private friendRemovedHandler!: ServerToClientEvents['friend:removed'];
  private friendOnlineHandler!: ServerToClientEvents['friend:online'];
  private friendOfflineHandler!: ServerToClientEvents['friend:offline'];

  constructor(
    socketClient: SocketClient,
    notifications: NotificationUI,
    onMessageFriend?: (userId: number, username: string) => void,
  ) {
    this.socketClient = socketClient;
    this.notifications = notifications;
    this.onMessageFriend = onMessageFriend;
    this.container = document.createElement('div');
    this.container.className = 'slide-panel friends-panel';
    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    this.friendUpdateHandler = (data: {
      friends: Friend[];
      incoming: FriendRequest[];
      outgoing: FriendRequest[];
    }) => {
      this.friends = data.friends;
      this.incoming = data.incoming;
      this.outgoing = data.outgoing;
      this.renderContent();
    };
    this.socketClient.on('friend:update', this.friendUpdateHandler);

    this.friendRequestHandler = (data: FriendRequest) => {
      if (!this.incoming.some((r) => r.fromUserId === data.fromUserId)) {
        this.incoming.push(data);
      }
      this.renderContent();
      this.notifications.info(
        t('ui:friends.friendRequestReceived', { username: data.fromUsername }),
      );
    };
    this.socketClient.on('friend:requestReceived', this.friendRequestHandler);

    this.friendRemovedHandler = (data: { userId: number }) => {
      this.friends = this.friends.filter((f) => f.userId !== data.userId);
      this.renderContent();
    };
    this.socketClient.on('friend:removed', this.friendRemovedHandler);

    this.friendOnlineHandler = (data: { userId: number; activity: ActivityStatus }) => {
      const friend = this.friends.find((f) => f.userId === data.userId);
      if (friend) {
        friend.activity = data.activity;
        this.renderContent();
      }
    };
    this.socketClient.on('friend:online', this.friendOnlineHandler);

    this.friendOfflineHandler = (data: { userId: number }) => {
      const friend = this.friends.find((f) => f.userId === data.userId);
      if (friend) {
        friend.activity = 'offline';
        this.renderContent();
      }
    };
    this.socketClient.on('friend:offline', this.friendOfflineHandler);
  }

  mount(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    this.renderContent();
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.container.classList.toggle('open', this.isOpen);
    if (this.isOpen) {
      this.loadFriends();
    }
  }

  close(): void {
    this.isOpen = false;
    this.container.classList.remove('open');
  }

  destroy(): void {
    this.socketClient.off('friend:update', this.friendUpdateHandler);
    this.socketClient.off('friend:requestReceived', this.friendRequestHandler);
    this.socketClient.off('friend:removed', this.friendRemovedHandler);
    this.socketClient.off('friend:online', this.friendOnlineHandler);
    this.socketClient.off('friend:offline', this.friendOfflineHandler);
    this.container.remove();
  }

  private loadFriends(): void {
    this.socketClient.emit('friend:list', (response) => {
      if (response.success) {
        this.friends = response.friends || [];
        this.incoming = response.incoming || [];
        this.outgoing = response.outgoing || [];
        this.renderContent();
      }
    });
  }

  private renderContent(): void {
    const incomingCount = this.incoming.length;

    this.container.innerHTML = `
      <div class="panel-header">
        <span class="panel-header-title">${t('ui:friends.title')}</span>
        <button class="panel-header-close">&times;</button>
      </div>
      <div class="tab-bar compact">
        <button class="tab-item ${this.activeTab === 'friends' ? 'active' : ''}" data-tab="friends">
          ${t('ui:friends.friendsCount', { count: this.friends.length })}
        </button>
        <button class="tab-item ${this.activeTab === 'requests' ? 'active' : ''}" data-tab="requests">
          ${t('ui:friends.tabs.requests')}${incomingCount > 0 ? `<span class="badge">${incomingCount}</span>` : ''}
        </button>
        <button class="tab-item ${this.activeTab === 'blocked' ? 'active' : ''}" data-tab="blocked">
          ${t('ui:friends.tabs.blocked')}
        </button>
      </div>
      <div class="friends-search">
        <input type="text" id="friend-search-input" placeholder="${t('ui:friends.searchPlaceholder')}" maxlength="20" aria-label="${t('ui:friends.searchPlaceholder')}">
        <button class="btn btn-primary" id="friend-search-btn">${t('ui:friends.addFriend')}</button>
      </div>
      <div class="friends-list" id="friends-list-content">
        ${this.renderActiveTab()}
      </div>
    `;

    // Event listeners
    this.container
      .querySelector('.panel-header-close')!
      .addEventListener('click', () => this.close());

    this.container.querySelectorAll('.tab-item').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.activeTab = (tab.getAttribute('data-tab') as typeof this.activeTab) ?? 'friends';
        this.searchResults = [];
        this.renderContent();
      });
    });

    const searchInput = this.container.querySelector('#friend-search-input') as HTMLInputElement;
    const searchBtn = this.container.querySelector('#friend-search-btn')!;
    searchBtn.addEventListener('click', () => this.handleSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSearch(searchInput.value);
    });

    this.attachActionListeners();
  }

  private renderActiveTab(): string {
    if (this.searchResults.length > 0) {
      return this.renderSearchResults();
    }

    switch (this.activeTab) {
      case 'friends':
        return this.renderFriendsList();
      case 'requests':
        return this.renderRequests();
      case 'blocked':
        return this.renderBlocked();
    }
  }

  private renderFriendsList(): string {
    if (this.friends.length === 0) {
      return `<div class="friends-empty">${t('ui:friends.noFriends')}</div>`;
    }

    // Sort: online first, then alphabetical
    const sorted = [...this.friends].sort((a, b) => {
      const aOnline = a.activity !== 'offline' ? 0 : 1;
      const bOnline = b.activity !== 'offline' ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return a.username.localeCompare(b.username);
    });

    const avatarColors = [
      'var(--primary)',
      'var(--info)',
      'var(--success)',
      'var(--warning)',
      '#bb44ff',
      'var(--accent)',
    ];

    return sorted
      .map((f) => {
        const isOnline = f.activity !== 'offline';
        const activityLabel = this.getActivityLabel(f.activity);
        const color = avatarColors[f.userId % avatarColors.length];

        return `
          <div class="friend-item" data-user-id="${f.userId}">
            <div class="friend-avatar" style="background:${color}${isOnline ? '' : '80'};">
              ${escapeHtml(f.username.charAt(0).toUpperCase())}
              <span class="status-dot ${f.activity}"></span>
            </div>
            <div class="friend-info">
              <div class="friend-name${!isOnline ? ' offline' : ''}">${escapeHtml(f.username)}</div>
              <div class="friend-activity ${isOnline ? (f.activity === 'in_game' || f.activity === 'in_campaign' ? 'in-game' : 'active') : ''}">${activityLabel}</div>
            </div>
            <div class="friend-actions">
              ${f.activity === 'in_lobby' && f.roomCode ? `<button class="btn btn-primary friend-join-btn" data-room="${escapeHtml(f.roomCode || '')}">${t('ui:friends.join')}</button>` : ''}
              <button class="btn btn-ghost friend-msg-btn" data-user-id="${f.userId}" data-username="${escapeHtml(f.username)}">${t('ui:friends.msg')}</button>
              <button class="btn btn-ghost friend-invite-btn" data-user-id="${f.userId}">${t('ui:friends.invite')}</button>
              <button class="btn btn-ghost btn-danger-text friend-remove-btn" data-friend-id="${f.userId}">${t('ui:friends.removeShort')}</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private renderRequests(): string {
    let html = '';

    if (this.incoming.length > 0) {
      html += `<div class="friends-section-label">${t('ui:friends.incoming')}</div>`;
      html += this.incoming
        .map(
          (r) => `
          <div class="friend-item">
            <div class="friend-avatar avatar-accent">${escapeHtml(r.fromUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-info">
              <div class="friend-name">${escapeHtml(r.fromUsername)}</div>
              <div class="friend-activity">${t('ui:friends.wantsToBeYourFriend')}</div>
            </div>
            <div class="friend-actions">
              <button class="btn btn-primary friend-accept-btn" data-from-id="${r.fromUserId}">${t('ui:friends.accept')}</button>
              <button class="btn btn-ghost btn-danger-text friend-decline-btn" data-from-id="${r.fromUserId}">${t('ui:friends.decline')}</button>
            </div>
          </div>
        `,
        )
        .join('');
    }

    if (this.outgoing.length > 0) {
      html += `<div class="friends-section-label spaced">${t('ui:friends.outgoing')}</div>`;
      html += this.outgoing
        .map(
          (r) => `
          <div class="friend-item">
            <div class="friend-avatar avatar-muted">${escapeHtml(r.fromUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-info">
              <div class="friend-name">${escapeHtml(r.fromUsername)}</div>
              <div class="friend-activity">${t('ui:friends.pending')}</div>
            </div>
            <div class="friend-actions">
              <button class="btn btn-ghost btn-danger-text friend-cancel-btn" data-to-id="${r.fromUserId}">${t('ui:friends.cancel')}</button>
            </div>
          </div>
        `,
        )
        .join('');
    }

    if (this.incoming.length === 0 && this.outgoing.length === 0) {
      html = `<div class="friends-empty">${t('ui:friends.noRequests')}</div>`;
    }

    return html;
  }

  private renderBlocked(): string {
    if (this.blocked.length === 0) {
      return `<div class="friends-empty">${t('ui:friends.noBlocked')}</div>`;
    }

    return this.blocked
      .map(
        (b) => `
        <div class="friend-item">
          <div class="friend-avatar avatar-danger">${escapeHtml(b.username.charAt(0).toUpperCase())}</div>
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(b.username)}</div>
          </div>
          <div class="friend-actions">
            <button class="btn btn-ghost friend-unblock-btn" data-user-id="${b.userId}">${t('ui:friends.unblock')}</button>
          </div>
        </div>
      `,
      )
      .join('');
  }

  private renderSearchResults(): string {
    return this.searchResults
      .map(
        (u) => `
        <div class="friend-item">
          <div class="friend-avatar avatar-info">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(u.username)}</div>
          </div>
          <div class="friend-actions">
            <button class="btn btn-primary friend-add-btn" data-username="${escapeHtml(u.username)}">${t('ui:friends.addFriend')}</button>
          </div>
        </div>
      `,
      )
      .join('');
  }

  private async handleSearch(query: string): Promise<void> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      this.searchResults = [];
      this.renderContent();
      return;
    }

    try {
      const { ApiClient } = await import('../network/ApiClient');
      const result = await ApiClient.post<{ users: { id: number; username: string }[] }>(
        '/friends/search',
        { query: trimmed },
      );
      this.searchResults = result.users;
      const listEl = this.container.querySelector('#friends-list-content');
      if (listEl) {
        listEl.innerHTML = this.renderSearchResults();
        this.attachActionListeners();
      }
    } catch {
      this.notifications.error(t('ui:friends.searchFailed'));
    }
  }

  private attachActionListeners(): void {
    // Add friend
    this.container.querySelectorAll('.friend-add-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const username = btn.getAttribute('data-username')!;
        this.socketClient.emit('friend:request', { username }, (res) => {
          if (res.success) {
            this.notifications.success(t('ui:friends.requestSent', { username }));
            this.searchResults = [];
            this.loadFriends();
          } else {
            this.notifications.error(res.error || t('ui:friends.requestFailed'));
          }
        });
      });
    });

    // Accept request
    this.container.querySelectorAll('.friend-accept-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fromUserId = parseInt(btn.getAttribute('data-from-id')!);
        this.socketClient.emit('friend:accept', { fromUserId }, (res) => {
          if (res.success) {
            this.notifications.success(t('ui:friends.accepted'));
            this.incoming = this.incoming.filter((r) => r.fromUserId !== fromUserId);
            this.loadFriends();
          } else {
            this.notifications.error(res.error || t('ui:friends.failed'));
          }
        });
      });
    });

    // Decline request
    this.container.querySelectorAll('.friend-decline-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fromUserId = parseInt(btn.getAttribute('data-from-id')!);
        this.socketClient.emit('friend:decline', { fromUserId }, (res) => {
          if (res.success) {
            this.incoming = this.incoming.filter((r) => r.fromUserId !== fromUserId);
            this.renderContent();
          }
        });
      });
    });

    // Cancel outgoing request
    this.container.querySelectorAll('.friend-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const toUserId = parseInt(btn.getAttribute('data-to-id')!);
        this.socketClient.emit('friend:cancel', { toUserId }, (res) => {
          if (res.success) {
            this.outgoing = this.outgoing.filter((r) => r.fromUserId !== toUserId);
            this.renderContent();
          }
        });
      });
    });

    // Remove friend
    this.container.querySelectorAll('.friend-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const friendId = parseInt(btn.getAttribute('data-friend-id')!);
        this.socketClient.emit('friend:remove', { friendId }, (res) => {
          if (res.success) {
            this.friends = this.friends.filter((f) => f.userId !== friendId);
            this.renderContent();
          }
        });
      });
    });

    // Unblock
    this.container.querySelectorAll('.friend-unblock-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = parseInt(btn.getAttribute('data-user-id')!);
        this.socketClient.emit('friend:unblock', { userId }, (res) => {
          if (res.success) {
            this.blocked = this.blocked.filter((b) => b.userId !== userId);
            this.renderContent();
          }
        });
      });
    });

    // Join room
    this.container.querySelectorAll('.friend-join-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roomCode = btn.getAttribute('data-room')!;
        this.socketClient.emit('room:join', { code: roomCode }, (res) => {
          if (res.success) {
            this.close();
          } else {
            this.notifications.error(res.error || t('ui:friends.joinFailed'));
          }
        });
      });
    });

    // Message friend
    this.container.querySelectorAll('.friend-msg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = parseInt(btn.getAttribute('data-user-id')!);
        const username = btn.getAttribute('data-username')!;
        if (this.onMessageFriend) {
          this.onMessageFriend(userId, username);
        }
      });
    });

    // Invite to room
    this.container.querySelectorAll('.friend-invite-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetUserId = parseInt(btn.getAttribute('data-user-id')!);
        this.socketClient.emit('invite:room', { userId: targetUserId }, (res) => {
          if (res.success) {
            this.notifications.success(t('ui:friends.inviteSent'));
          } else {
            this.notifications.error(res.error || t('ui:friends.inviteFailed'));
          }
        });
      });
    });
  }

  private getActivityLabel(activity: ActivityStatus): string {
    switch (activity) {
      case 'online':
      case 'in_lobby':
        return t('ui:friends.online');
      case 'in_game':
        return t('ui:friends.inGame');
      case 'in_campaign':
        return t('ui:friends.inCampaign');
      case 'offline':
      default:
        return t('ui:friends.offline');
    }
  }

  /** Load blocked list (for blocked tab) */
  loadBlocked(): void {
    import('../network/ApiClient').then(({ ApiClient }) => {
      ApiClient.get<{ blocked: { userId: number; username: string }[] }>('/friends/blocked')
        .then((res) => {
          this.blocked = res.blocked;
          if (this.activeTab === 'blocked') this.renderContent();
        })
        .catch(() => {});
    });
  }
}
