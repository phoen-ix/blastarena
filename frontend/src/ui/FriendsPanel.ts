import { SocketClient } from '../network/SocketClient';
import { NotificationUI } from './NotificationUI';
import { Friend, FriendRequest, ActivityStatus } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';

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
  private friendUpdateHandler: any;
  private friendRequestHandler: any;
  private friendRemovedHandler: any;
  private friendOnlineHandler: any;
  private friendOfflineHandler: any;

  constructor(socketClient: SocketClient, notifications: NotificationUI, onMessageFriend?: (userId: number, username: string) => void) {
    this.socketClient = socketClient;
    this.notifications = notifications;
    this.onMessageFriend = onMessageFriend;
    this.container = document.createElement('div');
    this.container.className = 'friends-panel';
    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    this.friendUpdateHandler = (data: any) => {
      this.friends = data.friends;
      this.incoming = data.incoming;
      this.outgoing = data.outgoing;
      this.renderContent();
    };
    this.socketClient.on('friend:update' as any, this.friendUpdateHandler);

    this.friendRequestHandler = (data: FriendRequest) => {
      if (!this.incoming.some((r) => r.fromUserId === data.fromUserId)) {
        this.incoming.push(data);
      }
      this.renderContent();
      this.notifications.info(`${data.fromUsername} sent you a friend request`);
    };
    this.socketClient.on('friend:requestReceived' as any, this.friendRequestHandler);

    this.friendRemovedHandler = (data: { userId: number }) => {
      this.friends = this.friends.filter((f) => f.userId !== data.userId);
      this.renderContent();
    };
    this.socketClient.on('friend:removed' as any, this.friendRemovedHandler);

    this.friendOnlineHandler = (data: { userId: number; activity: ActivityStatus }) => {
      const friend = this.friends.find((f) => f.userId === data.userId);
      if (friend) {
        friend.activity = data.activity;
        this.renderContent();
      }
    };
    this.socketClient.on('friend:online' as any, this.friendOnlineHandler);

    this.friendOfflineHandler = (data: { userId: number }) => {
      const friend = this.friends.find((f) => f.userId === data.userId);
      if (friend) {
        friend.activity = 'offline';
        this.renderContent();
      }
    };
    this.socketClient.on('friend:offline' as any, this.friendOfflineHandler);
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
    this.socketClient.off('friend:update' as any, this.friendUpdateHandler);
    this.socketClient.off('friend:requestReceived' as any, this.friendRequestHandler);
    this.socketClient.off('friend:removed' as any, this.friendRemovedHandler);
    this.socketClient.off('friend:online' as any, this.friendOnlineHandler);
    this.socketClient.off('friend:offline' as any, this.friendOfflineHandler);
    this.container.remove();
  }

  private loadFriends(): void {
    this.socketClient.emit('friend:list' as any, ((response: any) => {
      if (response.success) {
        this.friends = response.friends || [];
        this.incoming = response.incoming || [];
        this.outgoing = response.outgoing || [];
        this.renderContent();
      }
    }) as any);
  }

  private renderContent(): void {
    const incomingCount = this.incoming.length;

    this.container.innerHTML = `
      <div class="friends-panel-header">
        <h3>Friends</h3>
        <button class="friends-panel-close">&times;</button>
      </div>
      <div class="friends-tabs">
        <button class="friends-tab ${this.activeTab === 'friends' ? 'active' : ''}" data-tab="friends">
          Friends (${this.friends.length})
        </button>
        <button class="friends-tab ${this.activeTab === 'requests' ? 'active' : ''}" data-tab="requests">
          Requests${incomingCount > 0 ? `<span class="badge">${incomingCount}</span>` : ''}
        </button>
        <button class="friends-tab ${this.activeTab === 'blocked' ? 'active' : ''}" data-tab="blocked">
          Blocked
        </button>
      </div>
      <div class="friends-search">
        <input type="text" id="friend-search-input" placeholder="Search username..." maxlength="20">
        <button class="btn btn-primary" id="friend-search-btn" style="padding:8px 14px;font-size:12px;">Add</button>
      </div>
      <div class="friends-list" id="friends-list-content">
        ${this.renderActiveTab()}
      </div>
    `;

    // Event listeners
    this.container.querySelector('.friends-panel-close')!.addEventListener('click', () => this.close());

    this.container.querySelectorAll('.friends-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.getAttribute('data-tab') as any;
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
      return '<div style="text-align:center;padding:30px 16px;color:var(--text-muted);font-size:13px;">No friends yet. Search for players to add!</div>';
    }

    // Sort: online first, then alphabetical
    const sorted = [...this.friends].sort((a, b) => {
      const aOnline = a.activity !== 'offline' ? 0 : 1;
      const bOnline = b.activity !== 'offline' ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;
      return a.username.localeCompare(b.username);
    });

    return sorted
      .map((f) => {
        const isOnline = f.activity !== 'offline';
        const activityLabel = this.getActivityLabel(f.activity);
        const colors = ['#ff6b35', '#448aff', '#00e676', '#ffaa22', '#bb44ff', '#00d4aa'];
        const color = colors[f.userId % colors.length];

        return `
          <div class="friend-item" data-user-id="${f.userId}">
            <div class="friend-avatar" style="background:${color}${isOnline ? '' : '80'};">
              ${escapeHtml(f.username.charAt(0).toUpperCase())}
              <span class="status-dot ${f.activity}"></span>
            </div>
            <div class="friend-info">
              <div class="friend-name" style="${!isOnline ? 'opacity:0.5;' : ''}">${escapeHtml(f.username)}</div>
              <div class="friend-activity ${isOnline ? (f.activity === 'in_game' || f.activity === 'in_campaign' ? 'in-game' : 'active') : ''}">${activityLabel}</div>
            </div>
            <div class="friend-actions">
              ${f.activity === 'in_lobby' && f.roomCode ? `<button class="btn btn-primary friend-join-btn" data-room="${escapeHtml(f.roomCode || '')}">Join</button>` : ''}
              <button class="btn btn-ghost friend-msg-btn" data-user-id="${f.userId}" data-username="${escapeHtml(f.username)}" style="padding:4px 8px;font-size:11px;">Msg</button>
              <button class="btn btn-ghost friend-invite-btn" data-user-id="${f.userId}" style="padding:4px 8px;font-size:11px;">Invite</button>
              <button class="btn btn-ghost friend-remove-btn" data-friend-id="${f.userId}" style="padding:4px 8px;font-size:11px;color:var(--danger);">X</button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private renderRequests(): string {
    let html = '';

    if (this.incoming.length > 0) {
      html += '<div style="padding:4px 12px 8px;color:var(--text-dim);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Incoming</div>';
      html += this.incoming
        .map(
          (r) => `
          <div class="friend-item">
            <div class="friend-avatar" style="background:var(--accent);">${escapeHtml(r.fromUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-info">
              <div class="friend-name">${escapeHtml(r.fromUsername)}</div>
              <div class="friend-activity">Wants to be friends</div>
            </div>
            <div class="friend-actions">
              <button class="btn btn-primary friend-accept-btn" data-from-id="${r.fromUserId}">Accept</button>
              <button class="btn btn-ghost friend-decline-btn" data-from-id="${r.fromUserId}" style="color:var(--danger);">Decline</button>
            </div>
          </div>
        `,
        )
        .join('');
    }

    if (this.outgoing.length > 0) {
      html += '<div style="padding:12px 12px 8px;color:var(--text-dim);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Outgoing</div>';
      html += this.outgoing
        .map(
          (r) => `
          <div class="friend-item">
            <div class="friend-avatar" style="background:var(--text-muted);">${escapeHtml(r.fromUsername.charAt(0).toUpperCase())}</div>
            <div class="friend-info">
              <div class="friend-name">${escapeHtml(r.fromUsername)}</div>
              <div class="friend-activity">Pending</div>
            </div>
            <div class="friend-actions">
              <button class="btn btn-ghost friend-cancel-btn" data-to-id="${r.fromUserId}" style="color:var(--danger);">Cancel</button>
            </div>
          </div>
        `,
        )
        .join('');
    }

    if (this.incoming.length === 0 && this.outgoing.length === 0) {
      html = '<div style="text-align:center;padding:30px 16px;color:var(--text-muted);font-size:13px;">No pending requests</div>';
    }

    return html;
  }

  private renderBlocked(): string {
    if (this.blocked.length === 0) {
      return '<div style="text-align:center;padding:30px 16px;color:var(--text-muted);font-size:13px;">No blocked users</div>';
    }

    return this.blocked
      .map(
        (b) => `
        <div class="friend-item">
          <div class="friend-avatar" style="background:var(--danger);">${escapeHtml(b.username.charAt(0).toUpperCase())}</div>
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(b.username)}</div>
          </div>
          <div class="friend-actions">
            <button class="btn btn-ghost friend-unblock-btn" data-user-id="${b.userId}">Unblock</button>
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
          <div class="friend-avatar" style="background:var(--info);">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(u.username)}</div>
          </div>
          <div class="friend-actions">
            <button class="btn btn-primary friend-add-btn" data-username="${escapeHtml(u.username)}">Add</button>
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
      this.notifications.error('Search failed');
    }
  }

  private attachActionListeners(): void {
    // Add friend
    this.container.querySelectorAll('.friend-add-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const username = btn.getAttribute('data-username')!;
        this.socketClient.emit('friend:request' as any, { username }, ((res: any) => {
          if (res.success) {
            this.notifications.success(`Friend request sent to ${username}`);
            this.searchResults = [];
            this.loadFriends();
          } else {
            this.notifications.error(res.error || 'Failed to send request');
          }
        }) as any);
      });
    });

    // Accept request
    this.container.querySelectorAll('.friend-accept-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fromUserId = parseInt(btn.getAttribute('data-from-id')!);
        this.socketClient.emit('friend:accept' as any, { fromUserId }, ((res: any) => {
          if (res.success) {
            this.notifications.success('Friend request accepted');
            this.incoming = this.incoming.filter((r) => r.fromUserId !== fromUserId);
            this.loadFriends();
          } else {
            this.notifications.error(res.error || 'Failed');
          }
        }) as any);
      });
    });

    // Decline request
    this.container.querySelectorAll('.friend-decline-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fromUserId = parseInt(btn.getAttribute('data-from-id')!);
        this.socketClient.emit('friend:decline' as any, { fromUserId }, ((res: any) => {
          if (res.success) {
            this.incoming = this.incoming.filter((r) => r.fromUserId !== fromUserId);
            this.renderContent();
          }
        }) as any);
      });
    });

    // Cancel outgoing request
    this.container.querySelectorAll('.friend-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const toUserId = parseInt(btn.getAttribute('data-to-id')!);
        this.socketClient.emit('friend:cancel' as any, { toUserId }, ((res: any) => {
          if (res.success) {
            this.outgoing = this.outgoing.filter((r) => r.fromUserId !== toUserId);
            this.renderContent();
          }
        }) as any);
      });
    });

    // Remove friend
    this.container.querySelectorAll('.friend-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const friendId = parseInt(btn.getAttribute('data-friend-id')!);
        this.socketClient.emit('friend:remove' as any, { friendId }, ((res: any) => {
          if (res.success) {
            this.friends = this.friends.filter((f) => f.userId !== friendId);
            this.renderContent();
          }
        }) as any);
      });
    });

    // Unblock
    this.container.querySelectorAll('.friend-unblock-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const userId = parseInt(btn.getAttribute('data-user-id')!);
        this.socketClient.emit('friend:unblock' as any, { userId }, ((res: any) => {
          if (res.success) {
            this.blocked = this.blocked.filter((b) => b.userId !== userId);
            this.renderContent();
          }
        }) as any);
      });
    });

    // Join room
    this.container.querySelectorAll('.friend-join-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roomCode = btn.getAttribute('data-room')!;
        this.socketClient.emit('room:join' as any, { code: roomCode }, ((res: any) => {
          if (res.success) {
            this.close();
          } else {
            this.notifications.error(res.error || 'Failed to join');
          }
        }) as any);
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
        this.socketClient.emit('invite:room' as any, { userId: targetUserId }, ((res: any) => {
          if (res.success) {
            this.notifications.success('Invite sent');
          } else {
            this.notifications.error(res.error || 'Failed to invite');
          }
        }) as any);
      });
    });
  }

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
