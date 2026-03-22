import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { Friend, FriendRequest, ActivityStatus } from '@blast-arena/shared';
import { escapeHtml } from '../../utils/html';

export class FriendsView implements ILobbyView {
  readonly viewId = 'friends';
  readonly title = 'Friends';

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private onMessageFriend: (userId: number, username: string) => void;

  private activeTab: 'friends' | 'requests' | 'blocked' = 'friends';
  private friends: Friend[] = [];
  private incoming: FriendRequest[] = [];
  private outgoing: FriendRequest[] = [];
  private blocked: { userId: number; username: string }[] = [];
  private searchResults: { id: number; username: string }[] = [];

  // Socket handler references
  private friendUpdateHandler: any;
  private friendRequestHandler: any;
  private friendRemovedHandler: any;
  private friendOnlineHandler: any;
  private friendOfflineHandler: any;

  constructor(deps: ViewDeps, onMessageFriend: (userId: number, username: string) => void) {
    this.deps = deps;
    this.onMessageFriend = onMessageFriend;
    this.setupSocketListeners();
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    this.setupDelegatedListeners();
    this.renderContent();
    this.loadFriends();
    this.loadBlocked();
  }

  /** Set up delegated event handlers once — survive innerHTML rebuilds */
  private setupDelegatedListeners(): void {
    if (!this.container) return;
    const sc = this.deps.socketClient;

    this.container.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) {
        // Tab switching
        const tab = (e.target as HTMLElement).closest('.tab-item') as HTMLElement | null;
        if (tab?.dataset.tab) {
          this.activeTab = tab.dataset.tab as 'friends' | 'requests' | 'blocked';
          this.searchResults = [];
          this.renderContent();
        }
        return;
      }

      switch (btn.dataset.action) {
        case 'add': {
          const username = btn.dataset.username!;
          sc.emit('friend:request', { username }, (res) => {
            if (res.success) {
              this.deps.notifications.success(`Friend request sent to ${username}`);
              this.searchResults = [];
              this.loadFriends();
            } else {
              this.deps.notifications.error(res.error || 'Failed to send request');
            }
          });
          break;
        }
        case 'accept': {
          const fromUserId = parseInt(btn.dataset.fromId!);
          sc.emit('friend:accept', { fromUserId }, (res) => {
            if (res.success) {
              this.deps.notifications.success('Friend request accepted');
              this.incoming = this.incoming.filter((r) => r.fromUserId !== fromUserId);
              this.loadFriends();
            } else {
              this.deps.notifications.error(res.error || 'Failed');
            }
          });
          break;
        }
        case 'decline': {
          const fromUserId = parseInt(btn.dataset.fromId!);
          sc.emit('friend:decline', { fromUserId }, (res) => {
            if (res.success) {
              this.incoming = this.incoming.filter((r) => r.fromUserId !== fromUserId);
              this.renderContent();
            }
          });
          break;
        }
        case 'cancel': {
          const toUserId = parseInt(btn.dataset.toId!);
          sc.emit('friend:cancel', { toUserId }, (res) => {
            if (res.success) {
              this.outgoing = this.outgoing.filter((r) => r.fromUserId !== toUserId);
              this.renderContent();
            }
          });
          break;
        }
        case 'remove': {
          const friendId = parseInt(btn.dataset.friendId!);
          sc.emit('friend:remove', { friendId }, (res) => {
            if (res.success) {
              this.friends = this.friends.filter((f) => f.userId !== friendId);
              this.renderContent();
            }
          });
          break;
        }
        case 'unblock': {
          const userId = parseInt(btn.dataset.userId!);
          sc.emit('friend:unblock', { userId }, (res) => {
            if (res.success) {
              this.blocked = this.blocked.filter((b) => b.userId !== userId);
              this.renderContent();
            }
          });
          break;
        }
        case 'join': {
          const roomCode = btn.dataset.room!;
          sc.emit('room:join', { code: roomCode }, (res) => {
            if (!res.success) {
              this.deps.notifications.error(res.error || 'Failed to join');
            }
          });
          break;
        }
        case 'message': {
          const userId = parseInt(btn.dataset.userId!);
          const username = btn.dataset.username!;
          this.onMessageFriend(userId, username);
          break;
        }
        case 'invite': {
          const targetUserId = parseInt(btn.dataset.userId!);
          sc.emit('invite:room', { userId: targetUserId }, (res) => {
            if (res.success) {
              this.deps.notifications.success('Invite sent');
            } else {
              this.deps.notifications.error(res.error || 'Failed to invite');
            }
          });
          break;
        }
        case 'search': {
          const input = this.container?.querySelector('#friend-search-input') as HTMLInputElement;
          if (input) this.handleSearch(input.value);
          break;
        }
      }
    });

    this.container.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'friend-search-input' && e.key === 'Enter') {
        this.handleSearch((target as HTMLInputElement).value);
      }
    });
  }

  destroy(): void {
    this.container = null;
    const sc = this.deps.socketClient;
    sc.off('friend:update', this.friendUpdateHandler);
    sc.off('friend:requestReceived', this.friendRequestHandler);
    sc.off('friend:removed', this.friendRemovedHandler);
    sc.off('friend:online', this.friendOnlineHandler);
    sc.off('friend:offline', this.friendOfflineHandler);
  }

  private setupSocketListeners(): void {
    const sc = this.deps.socketClient;

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
    sc.on('friend:update', this.friendUpdateHandler);

    this.friendRequestHandler = (data: FriendRequest) => {
      if (!this.incoming.some((r) => r.fromUserId === data.fromUserId)) {
        this.incoming.push(data);
      }
      this.renderContent();
      this.deps.notifications.info(`${data.fromUsername} sent you a friend request`);
    };
    sc.on('friend:requestReceived', this.friendRequestHandler);

    this.friendRemovedHandler = (data: { userId: number }) => {
      this.friends = this.friends.filter((f) => f.userId !== data.userId);
      this.renderContent();
    };
    sc.on('friend:removed', this.friendRemovedHandler);

    this.friendOnlineHandler = (data: { userId: number; activity: ActivityStatus }) => {
      const friend = this.friends.find((f) => f.userId === data.userId);
      if (friend) {
        friend.activity = data.activity;
        this.renderContent();
      }
    };
    sc.on('friend:online', this.friendOnlineHandler);

    this.friendOfflineHandler = (data: { userId: number }) => {
      const friend = this.friends.find((f) => f.userId === data.userId);
      if (friend) {
        friend.activity = 'offline';
        this.renderContent();
      }
    };
    sc.on('friend:offline', this.friendOfflineHandler);
  }

  private loadFriends(): void {
    this.deps.socketClient.emit('friend:list', (response) => {
      if (response.success) {
        this.friends = response.friends || [];
        this.incoming = response.incoming || [];
        this.outgoing = response.outgoing || [];
        this.renderContent();
      }
    });
  }

  private loadBlocked(): void {
    ApiClient.get<{ blocked: { userId: number; username: string }[] }>('/friends/blocked')
      .then((res) => {
        this.blocked = res.blocked;
        if (this.activeTab === 'blocked') this.renderContent();
      })
      .catch(() => {});
  }

  private renderContent(): void {
    if (!this.container) return;
    const incomingCount = this.incoming.length;

    this.container.innerHTML = `
      <div class="friends-page">
        <div class="friends-page-header">
          <div class="tab-bar">
            <button class="tab-item ${this.activeTab === 'friends' ? 'active' : ''}" data-tab="friends">
              Friends (${this.friends.length})
            </button>
            <button class="tab-item ${this.activeTab === 'requests' ? 'active' : ''}" data-tab="requests">
              Requests${incomingCount > 0 ? ` <span class="badge">${incomingCount}</span>` : ''}
            </button>
            <button class="tab-item ${this.activeTab === 'blocked' ? 'active' : ''}" data-tab="blocked">
              Blocked (${this.blocked.length})
            </button>
          </div>
          <div class="friends-search-bar">
            <input type="text" class="input" id="friend-search-input" placeholder="Search by username..." maxlength="20" aria-label="Search friends by username">
            <button class="btn btn-primary" data-action="search">Add Friend</button>
          </div>
        </div>
        <div class="friends-grid" id="friends-list-content">
          ${this.renderActiveTab()}
        </div>
      </div>
    `;

    // Listeners are delegated via setupDelegatedListeners() — no per-render attachment needed
  }

  private renderActiveTab(): string {
    if (this.searchResults.length > 0) return this.renderSearchResults();

    switch (this.activeTab) {
      case 'friends':
        return this.renderFriendsList();
      case 'requests':
        return this.renderRequests();
      case 'blocked':
        return this.renderBlockedList();
    }
  }

  private renderFriendsList(): string {
    if (this.friends.length === 0) {
      return '<div class="friends-empty">No friends yet. Search for players to add!</div>';
    }

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
          <div class="friend-card" data-user-id="${f.userId}">
            <div class="friend-card-avatar" style="background:${color}${isOnline ? '' : '80'};">
              ${escapeHtml(f.username.charAt(0).toUpperCase())}
              <span class="status-dot ${f.activity}"></span>
            </div>
            <div class="friend-card-info">
              <div class="friend-card-name${!isOnline ? ' offline' : ''}">${escapeHtml(f.username)}</div>
              <div class="friend-card-activity ${isOnline ? (f.activity === 'in_game' || f.activity === 'in_campaign' ? 'in-game' : 'active') : ''}">${activityLabel}</div>
            </div>
            <div class="friend-card-actions">
              ${f.activity === 'in_lobby' && f.roomCode ? `<button class="btn btn-primary btn-sm" data-action="join" data-room="${escapeHtml(f.roomCode || '')}">Join</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-action="message" data-user-id="${f.userId}" data-username="${escapeHtml(f.username)}">Msg</button>
              <button class="btn btn-ghost btn-sm" data-action="invite" data-user-id="${f.userId}">Invite</button>
              <button class="btn btn-ghost btn-sm btn-danger-text" data-action="remove" data-friend-id="${f.userId}">Remove</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private renderRequests(): string {
    let html = '';

    if (this.incoming.length > 0) {
      html += '<div class="friends-section-label">Incoming</div>';
      html += this.incoming
        .map(
          (r) => `
          <div class="friend-card">
            <div class="friend-card-avatar" style="background:var(--accent);">${escapeHtml(r.fromUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-card-info">
              <div class="friend-card-name">${escapeHtml(r.fromUsername)}</div>
              <div class="friend-card-activity">Wants to be friends</div>
            </div>
            <div class="friend-card-actions">
              <button class="btn btn-primary btn-sm" data-action="accept" data-from-id="${r.fromUserId}">Accept</button>
              <button class="btn btn-ghost btn-sm btn-danger-text" data-action="decline" data-from-id="${r.fromUserId}">Decline</button>
            </div>
          </div>
        `,
        )
        .join('');
    }

    if (this.outgoing.length > 0) {
      html += '<div class="friends-section-label" style="margin-top:var(--sp-4);">Outgoing</div>';
      html += this.outgoing
        .map(
          (r) => `
          <div class="friend-card">
            <div class="friend-card-avatar" style="background:var(--text-muted);">${escapeHtml(r.fromUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-card-info">
              <div class="friend-card-name">${escapeHtml(r.fromUsername)}</div>
              <div class="friend-card-activity">Pending</div>
            </div>
            <div class="friend-card-actions">
              <button class="btn btn-ghost btn-sm btn-danger-text" data-action="cancel" data-to-id="${r.fromUserId}">Cancel</button>
            </div>
          </div>
        `,
        )
        .join('');
    }

    if (this.incoming.length === 0 && this.outgoing.length === 0) {
      html = '<div class="friends-empty">No pending requests</div>';
    }

    return html;
  }

  private renderBlockedList(): string {
    if (this.blocked.length === 0) {
      return '<div class="friends-empty">No blocked users</div>';
    }

    return this.blocked
      .map(
        (b) => `
        <div class="friend-card">
          <div class="friend-card-avatar" style="background:var(--danger);">${escapeHtml(b.username.charAt(0).toUpperCase())}</div>
          <div class="friend-card-info">
            <div class="friend-card-name">${escapeHtml(b.username)}</div>
          </div>
          <div class="friend-card-actions">
            <button class="btn btn-ghost btn-sm" data-action="unblock" data-user-id="${b.userId}">Unblock</button>
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
        <div class="friend-card">
          <div class="friend-card-avatar" style="background:var(--info);">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>
          <div class="friend-card-info">
            <div class="friend-card-name">${escapeHtml(u.username)}</div>
          </div>
          <div class="friend-card-actions">
            <button class="btn btn-primary btn-sm" data-action="add" data-username="${escapeHtml(u.username)}">Add Friend</button>
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
      const result = await ApiClient.post<{ users: { id: number; username: string }[] }>(
        '/friends/search',
        { query: trimmed },
      );
      this.searchResults = result.users;
      const listEl = this.container?.querySelector('#friends-list-content');
      if (listEl) {
        listEl.innerHTML = this.renderSearchResults();
      }
    } catch {
      this.deps.notifications.error('Search failed');
    }
  }

  // Action listeners are delegated via setupDelegatedListeners()

  private getActivityLabel(activity: ActivityStatus): string {
    switch (activity) {
      case 'online':
      case 'in_lobby':
        return 'Online';
      case 'in_game':
        return 'In Game';
      case 'in_campaign':
        return 'In Campaign';
      case 'offline':
      default:
        return 'Offline';
    }
  }
}
