import { SocketClient } from '../network/SocketClient';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { LobbyChatMessage, ChatMode, UserRole, LOBBY_CHAT_MAX_LENGTH } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';
import { getSettings } from '../game/Settings';
import { t } from '../i18n';

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

  /** Re-check user setting and show/hide accordingly */
  refreshVisibility(): void {
    this.render();
  }

  unmount(): void {
    this.container.remove();
  }

  destroy(): void {
    this.socketClient.off('lobby:chat', this.lobbyChatHandler);
    this.socketClient.off('admin:settingsChanged', this.settingsChangedHandler);
    this.container.remove();
  }

  private setupSocketListeners(): void {
    this.lobbyChatHandler = (message: LobbyChatMessage) => {
      this.messages.push(message);
      if (this.messages.length > 100) this.messages.shift();
      this.renderMessages();
    };
    this.socketClient.on('lobby:chat', this.lobbyChatHandler);

    this.settingsChangedHandler = (data: { key: string; value?: unknown }) => {
      if (data.key === 'lobby_chat_mode') {
        this.chatMode = data.value as ChatMode;
        if (!this.canChat() && this.expanded) {
          this.expanded = false;
        }
        this.render();
      }
    };
    this.socketClient.on('admin:settingsChanged', this.settingsChangedHandler);
  }

  private getRoleColor(role: UserRole): string {
    if (role === 'admin') return 'var(--primary)';
    if (role === 'moderator') return 'var(--info)';
    return 'var(--accent)';
  }

  private render(): void {
    this.container.className = 'lobby-chat';
    this.container.innerHTML = '';

    // User-level disable
    if (!getSettings().lobbyChat) {
      this.container.style.display = 'none';
      this.messagesEl = null;
      this.inputEl = null;
      return;
    }
    this.container.style.display = '';

    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = 'lobby-chat-toggle' + (this.expanded ? ' expanded' : '');
    toggle.innerHTML = `<span>Lobby Chat</span><span class="lobby-chat-arrow">${this.expanded ? '\u25BC' : '\u25B2'}</span>`;
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
    body.className = 'lobby-chat-body';

    // Messages area
    const messagesArea = document.createElement('div');
    messagesArea.className = 'lobby-chat-messages';
    this.messagesEl = messagesArea;
    body.appendChild(messagesArea);
    this.renderMessages();

    // Input area (only if canChat)
    if (this.canChat()) {
      const inputRow = document.createElement('div');
      inputRow.className = 'lobby-chat-input-row';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = t('ui:party.chatPlaceholder');
      input.maxLength = LOBBY_CHAT_MAX_LENGTH;
      input.className = 'lobby-chat-input';
      input.setAttribute('aria-label', t('ui:lobbyChat.ariaLabel'));
      this.inputEl = input;

      const sendBtn = document.createElement('button');
      sendBtn.textContent = t('ui:messages.send');
      sendBtn.className = 'btn btn-primary lobby-chat-send';

      const send = () => {
        const msg = input.value.trim();
        if (!msg) return;
        this.socketClient.emit('lobby:chat', { message: msg });
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
      this.messagesEl.innerHTML = `<div class="lobby-chat-empty">${t('ui:lobbyChat.empty')}</div>`;
      return;
    }

    this.messagesEl.innerHTML = this.messages
      .map((m) => {
        const nameColor = this.getRoleColor(m.role);
        return `<div class="lobby-chat-msg"><span class="lobby-chat-msg-name" style="color:${nameColor};">${escapeHtml(m.fromUsername)}</span> <span class="lobby-chat-msg-text">${escapeHtml(m.message)}</span></div>`;
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
