import { SocketClient } from '../network/SocketClient';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { LobbyChatMessage, ChatMode, UserRole, LOBBY_CHAT_MAX_LENGTH } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';

export class LobbyChatPanel {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private notifications: NotificationUI;
  private currentUserId: number;
  private currentUserRole: UserRole;
  private chatMode: ChatMode = 'everyone';
  private messages: LobbyChatMessage[] = [];
  private expanded = false;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;

  // Socket handler refs
  private lobbyChatHandler: any;
  private settingsChangedHandler: any;

  constructor(
    socketClient: SocketClient,
    notifications: NotificationUI,
    userId: number,
    userRole: UserRole,
  ) {
    this.socketClient = socketClient;
    this.notifications = notifications;
    this.currentUserId = userId;
    this.currentUserRole = userRole;
    this.container = document.createElement('div');
    this.setupSocketListeners();
    this.loadChatMode();
  }

  private async loadChatMode(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ mode: ChatMode }>('/admin/settings/lobby_chat_mode');
      this.chatMode = resp.mode ?? 'everyone';
    } catch {
      // Default to everyone on failure
    }
  }

  private canChat(): boolean {
    if (this.chatMode === 'everyone') return true;
    if (this.chatMode === 'disabled') return false;
    if (this.chatMode === 'admin_only') return this.currentUserRole === 'admin';
    if (this.chatMode === 'staff')
      return this.currentUserRole === 'admin' || this.currentUserRole === 'moderator';
    return false;
  }

  mount(parent: HTMLElement): void {
    if (!parent.contains(this.container)) {
      parent.appendChild(this.container);
    }
    this.render();
  }

  unmount(): void {
    this.container.remove();
  }

  destroy(): void {
    this.socketClient.off('lobby:chat' as any, this.lobbyChatHandler);
    this.socketClient.off('admin:settingsChanged' as any, this.settingsChangedHandler);
    this.container.remove();
  }

  private setupSocketListeners(): void {
    this.lobbyChatHandler = (message: LobbyChatMessage) => {
      this.messages.push(message);
      if (this.messages.length > 100) this.messages.shift();
      this.renderMessages();
    };
    this.socketClient.on('lobby:chat' as any, this.lobbyChatHandler);

    this.settingsChangedHandler = (data: { key: string; value: any }) => {
      if (data.key === 'lobby_chat_mode') {
        this.chatMode = data.value as ChatMode;
        if (!this.canChat() && this.expanded) {
          this.expanded = false;
        }
        this.render();
      }
    };
    this.socketClient.on('admin:settingsChanged' as any, this.settingsChangedHandler);
  }

  private getRoleColor(role: UserRole): string {
    if (role === 'admin') return 'var(--primary)';
    if (role === 'moderator') return 'var(--info)';
    return 'var(--accent)';
  }

  private render(): void {
    Object.assign(this.container.style, {
      position: 'fixed',
      bottom: '16px',
      left: '16px',
      zIndex: '150',
      width: '320px',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--bg-surface)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
    });

    this.container.innerHTML = '';

    // Toggle button
    const toggle = document.createElement('button');
    Object.assign(toggle.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '10px 14px',
      background: 'var(--bg-elevated)',
      border: 'none',
      borderBottom: this.expanded ? '1px solid var(--border)' : 'none',
      color: 'var(--text)',
      fontFamily: "'Chakra Petch', sans-serif",
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      letterSpacing: '0.5px',
    });
    toggle.innerHTML = `<span>Lobby Chat</span><span style="font-size:10px;color:var(--text-muted);transition:transform 0.2s;">${this.expanded ? '\u25BC' : '\u25B2'}</span>`;
    toggle.addEventListener('click', () => {
      this.expanded = !this.expanded;
      this.render();
      if (this.expanded) {
        this.scrollToBottom();
        this.inputEl?.focus();
      }
    });
    this.container.appendChild(toggle);

    if (!this.expanded) {
      this.messagesEl = null;
      this.inputEl = null;
      return;
    }

    // Chat body
    const body = document.createElement('div');
    Object.assign(body.style, {
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-deep)',
    });

    // Messages area
    const messagesArea = document.createElement('div');
    Object.assign(messagesArea.style, {
      height: '220px',
      overflowY: 'auto',
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      scrollbarWidth: 'thin',
      scrollbarColor: 'var(--bg-hover) transparent',
    });
    this.messagesEl = messagesArea;
    body.appendChild(messagesArea);
    this.renderMessages();

    // Input area (only if canChat)
    if (this.canChat()) {
      const inputRow = document.createElement('div');
      Object.assign(inputRow.style, {
        display: 'flex',
        gap: '6px',
        padding: '8px 10px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)',
      });

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Type a message...';
      input.maxLength = LOBBY_CHAT_MAX_LENGTH;
      Object.assign(input.style, {
        flex: '1',
        padding: '7px 10px',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--text)',
        fontSize: '12px',
        fontFamily: "'DM Sans', sans-serif",
        outline: 'none',
      });
      this.inputEl = input;

      const sendBtn = document.createElement('button');
      sendBtn.textContent = 'Send';
      sendBtn.className = 'btn btn-primary';
      Object.assign(sendBtn.style, {
        padding: '7px 14px',
        fontSize: '12px',
        fontWeight: '600',
        borderRadius: 'var(--radius-sm)',
        whiteSpace: 'nowrap',
      });

      const send = () => {
        const msg = input.value.trim();
        if (!msg) return;
        this.socketClient.emit('lobby:chat' as any, { message: msg });
        input.value = '';
        input.focus();
      };

      sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') send();
      });

      inputRow.appendChild(input);
      inputRow.appendChild(sendBtn);
      body.appendChild(inputRow);
    }

    this.container.appendChild(body);
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;

    if (this.messages.length === 0) {
      this.messagesEl.innerHTML = `<div style="color:var(--text-muted);font-size:11px;text-align:center;padding:16px 0;font-style:italic;">No messages yet</div>`;
      return;
    }

    this.messagesEl.innerHTML = this.messages
      .map((m) => {
        const nameColor = this.getRoleColor(m.role);
        return `<div style="font-size:12px;line-height:1.4;word-wrap:break-word;"><span style="color:${nameColor};font-weight:600;">${escapeHtml(m.fromUsername)}</span> <span style="color:var(--text-dim);">${escapeHtml(m.message)}</span></div>`;
      })
      .join('');

    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }
}
