import { SocketClient } from '../network/SocketClient';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { DirectMessage, DMConversation, ChatMode, UserRole, DM_MAX_LENGTH } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';

export class DMPanel {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private notifications: NotificationUI;
  private userId: number;
  private userRole: UserRole;
  private isOpen = false;
  private dmMode: ChatMode = 'everyone';

  // View state
  private activeConversation: { userId: number; username: string } | null = null;
  private conversations: DMConversation[] = [];
  private messages: DirectMessage[] = [];
  private loadingConversations = false;
  private loadingMessages = false;

  // Socket handler references for cleanup
  private dmReceiveHandler: (message: DirectMessage) => void;
  private dmReadHandler: (data: { fromUserId: number; readAt: string }) => void;
  private settingsChangedHandler: (data: { key: string; value: any }) => void;

  constructor(
    socketClient: SocketClient,
    notifications: NotificationUI,
    userId: number,
    userRole: UserRole,
  ) {
    this.socketClient = socketClient;
    this.notifications = notifications;
    this.userId = userId;
    this.userRole = userRole;
    this.container = document.createElement('div');
    this.applyContainerStyles();

    this.dmReceiveHandler = (message: DirectMessage) => {
      this.handleDMReceive(message);
    };

    this.dmReadHandler = (data: { fromUserId: number; readAt: string }) => {
      this.handleDMRead(data);
    };

    this.settingsChangedHandler = (data: { key: string; value: any }) => {
      if (data.key === 'dm_mode') {
        this.dmMode = data.value as ChatMode;
        this.renderCurrentView();
      }
    };

    this.setupSocketListeners();
    this.loadDMMode();
  }

  private applyContainerStyles(): void {
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '0',
      right: '-380px',
      width: '380px',
      height: '100%',
      zIndex: '201',
      background: 'var(--bg-card)',
      borderLeft: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'right 0.3s ease',
      fontFamily: "'DM Sans', sans-serif",
      boxShadow: '-4px 0 24px rgba(0, 0, 0, 0.4)',
    });
  }

  private async loadDMMode(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ mode: ChatMode }>('/admin/settings/dm_mode');
      this.dmMode = resp.mode ?? 'everyone';
    } catch {
      // Default to everyone on failure
    }
  }

  private canSend(): boolean {
    if (this.dmMode === 'everyone') return true;
    if (this.dmMode === 'disabled') return false;
    if (this.dmMode === 'admin_only') return this.userRole === 'admin';
    if (this.dmMode === 'staff')
      return this.userRole === 'admin' || this.userRole === 'moderator';
    return false;
  }

  private setupSocketListeners(): void {
    this.socketClient.on('dm:receive' as any, this.dmReceiveHandler);
    this.socketClient.on('dm:read' as any, this.dmReadHandler);
    this.socketClient.on('admin:settingsChanged' as any, this.settingsChangedHandler);
  }

  private handleDMReceive(message: DirectMessage): void {
    // If viewing the conversation with this sender, append and auto-read
    if (this.activeConversation && message.senderId === this.activeConversation.userId) {
      this.messages.push(message);
      this.renderMessages();
      this.scrollToBottom();
      this.socketClient.emit('dm:read' as any, { fromUserId: message.senderId });
    } else {
      // Update unread count in conversation list
      const conv = this.conversations.find((c) => c.userId === message.senderId);
      if (conv) {
        conv.unreadCount++;
        conv.lastMessage = message.message;
        conv.lastMessageAt = message.createdAt;
      } else {
        // New conversation from unknown sender
        this.conversations.unshift({
          userId: message.senderId,
          username: message.senderUsername,
          lastMessage: message.message,
          lastMessageAt: message.createdAt,
          unreadCount: 1,
        });
      }
      if (!this.activeConversation) {
        this.renderConversationList();
      }
    }
  }

  private handleDMRead(data: { fromUserId: number; readAt: string }): void {
    if (this.activeConversation && this.activeConversation.userId === data.fromUserId) {
      // Mark all sent messages to this user as read
      for (const msg of this.messages) {
        if (msg.senderId === this.userId && msg.recipientId === data.fromUserId && !msg.readAt) {
          msg.readAt = data.readAt;
        }
      }
      this.renderMessages();
    }
  }

  mount(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
  }

  unmount(): void {
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }

  destroy(): void {
    this.socketClient.off('dm:receive' as any, this.dmReceiveHandler);
    this.socketClient.off('dm:read' as any, this.dmReadHandler);
    this.socketClient.off('admin:settingsChanged' as any, this.settingsChangedHandler);
    this.container.remove();
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  close(): void {
    this.isOpen = false;
    this.container.style.right = '-380px';
  }

  openConversation(userId: number, username: string): void {
    this.isOpen = true;
    this.container.style.right = '0';
    this.activeConversation = { userId, username };
    this.messages = [];
    this.renderCurrentView();
    this.loadMessages(userId);
    this.socketClient.emit('dm:read' as any, { fromUserId: userId });
    // Clear unread for this conversation
    const conv = this.conversations.find((c) => c.userId === userId);
    if (conv) conv.unreadCount = 0;
  }

  private open(): void {
    this.isOpen = true;
    this.container.style.right = '0';
    if (!this.activeConversation) {
      this.loadConversations();
    }
    this.renderCurrentView();
  }

  private renderCurrentView(): void {
    if (this.activeConversation) {
      this.renderActiveConversation();
    } else {
      this.renderConversationListView();
    }
  }

  // ── Conversation List View ──

  private async loadConversations(): Promise<void> {
    this.loadingConversations = true;
    this.renderConversationListView();
    try {
      const resp = await ApiClient.get<{ conversations: DMConversation[] }>('/messages');
      this.conversations = resp.conversations;
    } catch {
      this.notifications.error('Failed to load messages');
    }
    this.loadingConversations = false;
    this.renderConversationListView();
  }

  private renderConversationListView(): void {
    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 16px 12px',
      borderBottom: '1px solid var(--border)',
      flexShrink: '0',
    });
    header.innerHTML = `
      <h3 style="margin:0;font-family:'Chakra Petch',sans-serif;font-size:16px;font-weight:700;color:var(--text);letter-spacing:0.5px;">Messages</h3>
      <button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:20px;padding:0 4px;line-height:1;">&times;</button>
    `;
    header.querySelector('button')!.addEventListener('click', () => this.close());
    this.container.appendChild(header);

    // List
    const list = document.createElement('div');
    Object.assign(list.style, {
      flex: '1',
      overflowY: 'auto',
      overflowX: 'hidden',
    });

    if (this.loadingConversations) {
      list.innerHTML =
        '<div style="text-align:center;padding:40px 16px;color:var(--text-muted);font-size:13px;">Loading...</div>';
    } else if (this.conversations.length === 0) {
      list.innerHTML =
        '<div style="text-align:center;padding:40px 16px;color:var(--text-muted);font-size:13px;">No conversations yet</div>';
    } else {
      this.conversations.forEach((conv) => {
        const item = this.createConversationItem(conv);
        list.appendChild(item);
      });
    }

    this.container.appendChild(list);
  }

  private renderConversationList(): void {
    // Only re-render the list portion if we're in list view
    if (this.activeConversation) return;
    const listEl = this.container.querySelector('[data-dm-list]') as HTMLElement;
    if (!listEl) {
      // Full re-render if structure not found
      this.renderConversationListView();
      return;
    }
    listEl.innerHTML = '';
    this.conversations.forEach((conv) => {
      const item = this.createConversationItem(conv);
      listEl.appendChild(item);
    });
  }

  private createConversationItem(conv: DMConversation): HTMLElement {
    const item = document.createElement('div');
    Object.assign(item.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      cursor: 'pointer',
      transition: 'background 0.15s ease',
      borderBottom: '1px solid var(--border)',
    });
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--bg-hover)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });

    const colors = ['#ff6b35', '#448aff', '#00e676', '#ffaa22', '#bb44ff', '#00d4aa'];
    const color = colors[conv.userId % colors.length];

    // Avatar
    const avatar = document.createElement('div');
    Object.assign(avatar.style, {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      background: color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: '700',
      fontSize: '16px',
      color: '#fff',
      flexShrink: '0',
      fontFamily: "'Chakra Petch', sans-serif",
    });
    avatar.textContent = conv.username.charAt(0).toUpperCase();
    item.appendChild(avatar);

    // Info
    const info = document.createElement('div');
    Object.assign(info.style, {
      flex: '1',
      minWidth: '0',
      overflow: 'hidden',
    });

    const nameRow = document.createElement('div');
    Object.assign(nameRow.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '2px',
    });

    const name = document.createElement('span');
    Object.assign(name.style, {
      fontWeight: '600',
      fontSize: '13px',
      color: 'var(--text)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    name.textContent = conv.username;

    const time = document.createElement('span');
    Object.assign(time.style, {
      fontSize: '11px',
      color: 'var(--text-dim)',
      flexShrink: '0',
      marginLeft: '8px',
    });
    time.textContent = this.formatTimeAgo(conv.lastMessageAt);

    nameRow.appendChild(name);
    nameRow.appendChild(time);
    info.appendChild(nameRow);

    const preview = document.createElement('div');
    Object.assign(preview.style, {
      fontSize: '12px',
      color: 'var(--text-muted)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '220px',
    });
    preview.textContent =
      conv.lastMessage.length > 50 ? conv.lastMessage.slice(0, 50) + '...' : conv.lastMessage;
    info.appendChild(preview);

    item.appendChild(info);

    // Unread badge
    if (conv.unreadCount > 0) {
      const badge = document.createElement('span');
      Object.assign(badge.style, {
        background: 'var(--primary)',
        color: '#fff',
        borderRadius: '10px',
        padding: '2px 7px',
        fontSize: '11px',
        fontWeight: '700',
        minWidth: '18px',
        textAlign: 'center',
        flexShrink: '0',
      });
      badge.textContent = conv.unreadCount > 99 ? '99+' : String(conv.unreadCount);
      item.appendChild(badge);
    }

    item.addEventListener('click', () => {
      this.openConversation(conv.userId, conv.username);
    });

    return item;
  }

  // ── Active Conversation View ──

  private async loadMessages(userId: number): Promise<void> {
    this.loadingMessages = true;
    this.renderMessages();
    try {
      const resp = await ApiClient.get<{
        messages: DirectMessage[];
        total: number;
        page: number;
        limit: number;
      }>(`/messages/${userId}`);
      // API returns DESC order; reverse to chronological
      this.messages = resp.messages.reverse();
    } catch {
      this.notifications.error('Failed to load messages');
    }
    this.loadingMessages = false;
    this.renderMessages();
    this.scrollToBottom();
  }

  private renderActiveConversation(): void {
    if (!this.activeConversation) return;

    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
      flexShrink: '0',
    });

    const backBtn = document.createElement('button');
    Object.assign(backBtn.style, {
      background: 'none',
      border: 'none',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      fontSize: '18px',
      padding: '0 4px',
      lineHeight: '1',
    });
    backBtn.innerHTML = '&#8592;';
    backBtn.addEventListener('click', () => {
      this.activeConversation = null;
      this.messages = [];
      this.loadConversations();
    });
    header.appendChild(backBtn);

    const headerName = document.createElement('span');
    Object.assign(headerName.style, {
      flex: '1',
      fontFamily: "'Chakra Petch', sans-serif",
      fontWeight: '700',
      fontSize: '15px',
      color: 'var(--text)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    headerName.textContent = this.activeConversation.username;
    header.appendChild(headerName);

    const closeBtn = document.createElement('button');
    Object.assign(closeBtn.style, {
      background: 'none',
      border: 'none',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      fontSize: '20px',
      padding: '0 4px',
      lineHeight: '1',
    });
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(closeBtn);

    this.container.appendChild(header);

    // Messages area
    const messagesArea = document.createElement('div');
    messagesArea.setAttribute('data-dm-messages', '');
    Object.assign(messagesArea.style, {
      flex: '1',
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    });
    this.container.appendChild(messagesArea);

    this.renderMessages();

    // Input area (only if allowed to send)
    if (this.canSend()) {
      const inputArea = document.createElement('div');
      Object.assign(inputArea.style, {
        display: 'flex',
        gap: '8px',
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        flexShrink: '0',
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Type a message...';
      input.maxLength = DM_MAX_LENGTH;
      Object.assign(input.style, {
        flex: '1',
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '8px 12px',
        color: 'var(--text)',
        fontSize: '13px',
        outline: 'none',
        fontFamily: "'DM Sans', sans-serif",
      });

      const sendBtn = document.createElement('button');
      Object.assign(sendBtn.style, {
        background: 'var(--primary)',
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        padding: '8px 16px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
        fontFamily: "'Chakra Petch', sans-serif",
        letterSpacing: '0.5px',
        transition: 'opacity 0.15s ease',
      });
      sendBtn.textContent = 'Send';
      sendBtn.addEventListener('mouseenter', () => {
        sendBtn.style.opacity = '0.85';
      });
      sendBtn.addEventListener('mouseleave', () => {
        sendBtn.style.opacity = '1';
      });

      const sendMessage = () => {
        const text = input.value.trim();
        if (!text || !this.activeConversation) return;

        this.socketClient.emit(
          'dm:send' as any,
          { toUserId: this.activeConversation.userId, message: text },
          ((res: any) => {
            if (res.success && res.message) {
              this.messages.push(res.message);
              this.renderMessages();
              this.scrollToBottom();
              // Update conversation list preview
              const conv = this.conversations.find(
                (c) => c.userId === this.activeConversation?.userId,
              );
              if (conv) {
                conv.lastMessage = text;
                conv.lastMessageAt = res.message.createdAt;
              }
            } else {
              this.notifications.error(res.error || 'Failed to send message');
            }
          }) as any,
        );
        input.value = '';
      };

      sendBtn.addEventListener('click', sendMessage);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
      });

      inputArea.appendChild(input);
      inputArea.appendChild(sendBtn);
      this.container.appendChild(inputArea);

      // Focus input
      requestAnimationFrame(() => input.focus());
    } else if (this.dmMode === 'disabled') {
      const disabledNotice = document.createElement('div');
      Object.assign(disabledNotice.style, {
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        textAlign: 'center',
        color: 'var(--text-dim)',
        fontSize: '12px',
        flexShrink: '0',
      });
      disabledNotice.textContent = 'Direct messages are disabled';
      this.container.appendChild(disabledNotice);
    }

    this.scrollToBottom();
  }

  private renderMessages(): void {
    const messagesEl = this.container.querySelector('[data-dm-messages]') as HTMLElement;
    if (!messagesEl) return;

    if (this.loadingMessages) {
      messagesEl.innerHTML =
        '<div style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:13px;">Loading...</div>';
      return;
    }

    if (this.messages.length === 0) {
      messagesEl.innerHTML =
        '<div style="text-align:center;padding:40px 0;color:var(--text-muted);font-size:13px;">No messages yet. Say hello!</div>';
      return;
    }

    messagesEl.innerHTML = this.messages
      .map((msg) => {
        const isSent = msg.senderId === this.userId;
        const align = isSent ? 'flex-end' : 'flex-start';
        const bg = isSent ? 'var(--accent)' : 'var(--bg-elevated)';
        const textColor = isSent ? '#fff' : 'var(--text)';
        const timeStr = this.formatMessageTime(msg.createdAt);
        const readIndicator =
          isSent && msg.readAt
            ? '<span style="font-size:10px;color:rgba(255,255,255,0.6);margin-left:4px;">&#10003;&#10003;</span>'
            : '';

        return `
          <div style="display:flex;flex-direction:column;align-items:${align};max-width:85%;">
            <div style="background:${bg};color:${textColor};padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;word-break:break-word;">${escapeHtml(msg.message)}</div>
            <div style="font-size:10px;color:var(--text-dim);margin-top:2px;padding:0 4px;">${timeStr}${readIndicator}</div>
          </div>
        `;
      })
      .join('');
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      const messagesEl = this.container.querySelector('[data-dm-messages]') as HTMLElement;
      if (messagesEl) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
    });
  }

  // ── Formatting Helpers ──

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
