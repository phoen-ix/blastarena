import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { DirectMessage, DMConversation, ChatMode, DM_MAX_LENGTH } from '@blast-arena/shared';
import { escapeHtml } from '../../utils/html';

export class MessagesView implements ILobbyView {
  readonly viewId = 'messages';
  readonly title = 'Messages';

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private userId: number;
  private userRole: string;
  private dmMode: ChatMode = 'everyone';

  private activeConversation: { userId: number; username: string } | null = null;
  private conversations: DMConversation[] = [];
  private messages: DirectMessage[] = [];
  private initialTarget: { userId: number; username: string } | null = null;

  // Socket handlers
  private dmReceiveHandler: (message: DirectMessage) => void;
  private dmReadHandler: (data: { fromUserId: number; readAt: string }) => void;
  private settingsChangedHandler: (data: { key: string; value?: unknown }) => void;

  constructor(deps: ViewDeps, options?: Record<string, any>) {
    this.deps = deps;
    const user = deps.authManager.getUser();
    this.userId = user?.id ?? 0;
    this.userRole = user?.role ?? 'user';

    if (options?.userId && options?.username) {
      this.initialTarget = { userId: options.userId, username: options.username };
    }

    this.dmReceiveHandler = (message: DirectMessage) => this.handleDMReceive(message);
    this.dmReadHandler = (data) => this.handleDMRead(data);
    this.settingsChangedHandler = (data) => {
      if (data.key === 'dm_mode') {
        this.dmMode = data.value as ChatMode;
        this.renderView();
      }
    };

    this.setupSocketListeners();
    this.loadDMMode();
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    this.setupDelegatedListeners();
    await this.loadConversations();

    if (this.initialTarget) {
      this.openConversation(this.initialTarget.userId, this.initialTarget.username);
      this.initialTarget = null;
    } else {
      this.renderView();
    }
  }

  /** Set up delegated event handlers once — survive innerHTML rebuilds */
  private setupDelegatedListeners(): void {
    if (!this.container) return;

    // Conversation list clicks
    this.container.addEventListener('click', (e) => {
      const convItem = (e.target as HTMLElement).closest(
        '.messages-conv-item',
      ) as HTMLElement | null;
      if (convItem) {
        const userId = parseInt(convItem.dataset.convUserId!);
        const username = convItem.dataset.convUsername!;
        this.openConversation(userId, username);
        return;
      }

      // Send button
      const sendBtn = (e.target as HTMLElement).closest('[data-msg-send]');
      if (sendBtn) {
        this.sendMessage();
      }
    });

    // Enter key in message input
    this.container.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.matches('[data-msg-input]') && e.key === 'Enter') {
        this.sendMessage();
      }
    });
  }

  private sendMessage(): void {
    const input = this.container?.querySelector('[data-msg-input]') as HTMLInputElement;
    if (!input) return;

    const text = input.value.trim();
    if (!text || !this.activeConversation) return;

    this.deps.socketClient.emit(
      'dm:send',
      { toUserId: this.activeConversation.userId, message: text },
      (res) => {
        if (res.success && res.message) {
          this.messages.push(res.message);
          this.renderMessages();
          this.scrollToBottom();
          const conv = this.conversations.find((c) => c.userId === this.activeConversation?.userId);
          if (conv) {
            conv.lastMessage = text;
            conv.lastMessageAt = res.message.createdAt;
          }
        } else {
          this.deps.notifications.error(res.error || 'Failed to send message');
        }
      },
    );
    input.value = '';
  }

  destroy(): void {
    this.container = null;
    const sc = this.deps.socketClient;
    sc.off('dm:receive', this.dmReceiveHandler);
    sc.off('dm:read', this.dmReadHandler);
    sc.off('admin:settingsChanged', this.settingsChangedHandler);
  }

  private setupSocketListeners(): void {
    const sc = this.deps.socketClient;
    sc.on('dm:receive', this.dmReceiveHandler);
    sc.on('dm:read', this.dmReadHandler);
    sc.on('admin:settingsChanged', this.settingsChangedHandler);
  }

  private async loadDMMode(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ mode: ChatMode }>('/admin/settings/dm_mode');
      this.dmMode = resp.mode ?? 'everyone';
    } catch {
      // Default
    }
  }

  private canSend(): boolean {
    if (this.dmMode === 'everyone') return true;
    if (this.dmMode === 'disabled') return false;
    if (this.dmMode === 'admin_only') return this.userRole === 'admin';
    if (this.dmMode === 'staff') return this.userRole === 'admin' || this.userRole === 'moderator';
    return false;
  }

  private async loadConversations(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ conversations: DMConversation[] }>('/messages');
      this.conversations = resp.conversations;
    } catch {
      this.deps.notifications.error('Failed to load messages');
    }
  }

  private handleDMReceive(message: DirectMessage): void {
    if (this.activeConversation && message.senderId === this.activeConversation.userId) {
      this.messages.push(message);
      this.renderMessages();
      this.scrollToBottom();
      this.deps.socketClient.emit('dm:read', { fromUserId: message.senderId });
    } else {
      const conv = this.conversations.find((c) => c.userId === message.senderId);
      if (conv) {
        conv.unreadCount++;
        conv.lastMessage = message.message;
        conv.lastMessageAt = message.createdAt;
      } else {
        this.conversations.unshift({
          userId: message.senderId,
          username: message.senderUsername,
          lastMessage: message.message,
          lastMessageAt: message.createdAt,
          unreadCount: 1,
        });
      }
      this.renderConversationList();
    }
  }

  private handleDMRead(data: { fromUserId: number; readAt: string }): void {
    if (this.activeConversation && this.activeConversation.userId === data.fromUserId) {
      for (const msg of this.messages) {
        if (msg.senderId === this.userId && msg.recipientId === data.fromUserId && !msg.readAt) {
          msg.readAt = data.readAt;
        }
      }
      this.renderMessages();
    }
  }

  private openConversation(userId: number, username: string): void {
    this.activeConversation = { userId, username };
    this.messages = [];
    this.renderView();
    this.loadMessages(userId);
    this.deps.socketClient.emit('dm:read', { fromUserId: userId });
    const conv = this.conversations.find((c) => c.userId === userId);
    if (conv) conv.unreadCount = 0;
  }

  private async loadMessages(userId: number): Promise<void> {
    try {
      const resp = await ApiClient.get<{
        messages: DirectMessage[];
        total: number;
        page: number;
        limit: number;
      }>(`/messages/${userId}`);
      this.messages = resp.messages.reverse();
    } catch {
      this.deps.notifications.error('Failed to load messages');
    }
    this.renderMessages();
    this.scrollToBottom();
  }

  private renderView(): void {
    if (!this.container) return;

    const avatarColors = [
      'var(--primary)',
      'var(--info)',
      'var(--success)',
      'var(--warning)',
      '#bb44ff',
      'var(--accent)',
    ];

    this.container.innerHTML = `
      <div class="messages-page">
        <div class="messages-sidebar">
          <div class="messages-sidebar-header">Conversations</div>
          <div class="messages-conv-list" data-conv-list></div>
        </div>
        <div class="messages-main">
          ${
            this.activeConversation
              ? `
            <div class="messages-conv-header">
              <div class="messages-conv-avatar" style="background:${avatarColors[this.activeConversation.userId % avatarColors.length]};">
                ${escapeHtml(this.activeConversation.username.charAt(0).toUpperCase())}
              </div>
              <span class="messages-conv-name">${escapeHtml(this.activeConversation.username)}</span>
            </div>
            <div class="messages-body" data-messages-body></div>
            ${
              this.canSend()
                ? `
              <div class="messages-input-row">
                <input type="text" class="input messages-input" placeholder="Type a message..." maxlength="${DM_MAX_LENGTH}" data-msg-input aria-label="Direct message">
                <button class="btn btn-primary" data-msg-send>Send</button>
              </div>
            `
                : this.dmMode === 'disabled'
                  ? `
              <div class="messages-disabled">Direct messages are disabled</div>
            `
                  : ''
            }
          `
              : `
            <div class="messages-empty-state">
              <div class="messages-empty-icon">&#9993;</div>
              <div class="messages-empty-text">Select a conversation or message a friend to get started</div>
            </div>
          `
          }
        </div>
      </div>
    `;

    this.renderConversationList();

    if (this.activeConversation) {
      this.renderMessages();
      this.focusMessageInput();
      this.scrollToBottom();
    }
  }

  private renderConversationList(): void {
    const listEl = this.container?.querySelector('[data-conv-list]');
    if (!listEl) return;

    const avatarColors = [
      'var(--primary)',
      'var(--info)',
      'var(--success)',
      'var(--warning)',
      '#bb44ff',
      'var(--accent)',
    ];

    if (this.conversations.length === 0) {
      listEl.innerHTML = '<div class="messages-conv-empty">No conversations yet</div>';
      return;
    }

    listEl.innerHTML = this.conversations
      .map((conv) => {
        const color = avatarColors[conv.userId % avatarColors.length];
        const isActive = this.activeConversation?.userId === conv.userId;
        const preview =
          conv.lastMessage.length > 40 ? conv.lastMessage.slice(0, 40) + '...' : conv.lastMessage;

        return `
          <div class="messages-conv-item ${isActive ? 'active' : ''}" data-conv-user-id="${conv.userId}" data-conv-username="${escapeHtml(conv.username)}">
            <div class="messages-conv-item-avatar" style="background:${color};">
              ${escapeHtml(conv.username.charAt(0).toUpperCase())}
            </div>
            <div class="messages-conv-item-info">
              <div class="messages-conv-item-name">${escapeHtml(conv.username)}</div>
              <div class="messages-conv-item-preview">${escapeHtml(preview)}</div>
            </div>
            ${conv.unreadCount > 0 ? `<span class="messages-unread-badge">${conv.unreadCount > 99 ? '99+' : conv.unreadCount}</span>` : ''}
            <div class="messages-conv-item-time">${this.formatTimeAgo(conv.lastMessageAt)}</div>
          </div>
        `;
      })
      .join('');

    // Click listeners are delegated via setupDelegatedListeners()
  }

  private renderMessages(): void {
    const body = this.container?.querySelector('[data-messages-body]') as HTMLElement;
    if (!body) return;

    if (this.messages.length === 0) {
      body.innerHTML = '<div class="messages-empty-chat">No messages yet. Say hello!</div>';
      return;
    }

    body.innerHTML = this.messages
      .map((msg) => {
        const isSent = msg.senderId === this.userId;
        const timeStr = this.formatMessageTime(msg.createdAt);
        const readIndicator =
          isSent && msg.readAt
            ? '<span class="messages-read-indicator">&#10003;&#10003;</span>'
            : '';

        return `
          <div class="messages-msg ${isSent ? 'sent' : 'received'}">
            <div class="messages-msg-bubble">${escapeHtml(msg.message)}</div>
            <div class="messages-msg-meta">${timeStr}${readIndicator}</div>
          </div>
        `;
      })
      .join('');
  }

  private focusMessageInput(): void {
    const input = this.container?.querySelector('[data-msg-input]') as HTMLInputElement;
    if (input) requestAnimationFrame(() => input.focus());
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      const body = this.container?.querySelector('[data-messages-body]') as HTMLElement;
      if (body) body.scrollTop = body.scrollHeight;
    });
  }

  private formatTimeAgo(isoStr: string): string {
    const date = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'now';
    if (diffMin < 60) return `${diffMin}m`;
    if (diffHr < 24) return `${diffHr}h`;
    if (diffDay < 7) return `${diffDay}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private formatMessageTime(isoStr: string): string {
    const date = new Date(isoStr);
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
  }
}
