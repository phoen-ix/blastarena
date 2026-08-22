import { SocketClient } from '../network/SocketClient';
import { ApiClient } from '../network/ApiClient';
import { escapeHtml, setHtml } from '../utils/html';
import type { ChatMode, UserRole } from '@blast-arena/shared';
import { t } from '../i18n';

interface SpectatorChatMessage {
  fromUserId: number;
  fromUsername: string;
  role: UserRole;
  message: string;
  timestamp: number;
}

const MAX_MESSAGES = 50;

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--primary)',
  moderator: 'var(--info)',
  user: 'var(--accent)',
};

export class SpectatorChat {
  private socketClient: SocketClient;
  private userId: number;
  private userRole: string;
  private messages: SpectatorChatMessage[] = [];
  private chatMode: ChatMode = 'everyone';
  private expanded = false;
  private container: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private chatHandler: ((data: SpectatorChatMessage) => void) | null = null;
  private settingsHandler: ((data: { key: string; value?: unknown }) => void) | null = null;

  constructor(socketClient: SocketClient, userId: number, userRole: string) {
    this.socketClient = socketClient;
    this.userId = userId;
    this.userRole = userRole;
  }

  async mount(parent: HTMLElement): Promise<void> {
    // Load current mode
    try {
      const res = await ApiClient.get<{ mode: ChatMode }>('/admin/settings/spectator_chat_mode');
      this.chatMode = res.mode;
    } catch {
      // Default to 'everyone'
    }

    this.container = document.createElement('div');
    this.container.id = 'spectator-chat';
    this.container.style.cssText =
      'position:fixed;bottom:16px;left:16px;z-index:150;font-family:DM Sans,sans-serif;';
    parent.appendChild(this.container);

    this.setupSocketListeners();
    this.render();
  }

  destroy(): void {
    if (this.chatHandler) {
      this.socketClient.off('game:spectatorChat', this.chatHandler);
      this.chatHandler = null;
    }
    if (this.settingsHandler) {
      this.socketClient.off('admin:settingsChanged', this.settingsHandler);
      this.settingsHandler = null;
    }
    this.container?.remove();
    this.container = null;
    this.messagesEl = null;
    this.inputEl = null;
    this.toggleBtn = null;
    this.messages = [];
  }

  private setupSocketListeners(): void {
    this.chatHandler = (data: SpectatorChatMessage) => {
      this.messages.push(data);
      if (this.messages.length > MAX_MESSAGES) {
        this.messages.shift();
      }
      this.renderMessages();
    };
    this.socketClient.on('game:spectatorChat', this.chatHandler);

    this.settingsHandler = (data: { key: string; value?: unknown }) => {
      if (data.key === 'spectator_chat_mode') {
        this.chatMode = data.value as ChatMode;
        this.render();
      }
    };
    this.socketClient.on('admin:settingsChanged', this.settingsHandler);
  }

  private canChat(): boolean {
    if (this.chatMode === 'disabled') return false;
    if (this.chatMode === 'admin_only' && this.userRole !== 'admin') return false;
    if (this.chatMode === 'staff' && this.userRole !== 'admin' && this.userRole !== 'moderator')
      return false;
    return true;
  }

  private render(): void {
    if (!this.container) return;

    if (this.chatMode === 'disabled') {
      setHtml(this.container, '');
      return;
    }

    if (!this.expanded) {
      setHtml(
        this.container,
        `
        <button id="spec-chat-toggle" style="
          background:var(--bg-elevated);border:1px solid var(--border);
          color:var(--text-dim);padding:6px 12px;border-radius:8px;
          cursor:pointer;font-size:12px;font-family:DM Sans,sans-serif;
          transition:color 0.15s;
        ">${t('ui:spectatorChat.title')}</button>
      `,
      );
      this.toggleBtn = this.container.querySelector('#spec-chat-toggle');
      this.toggleBtn?.addEventListener('click', () => {
        this.expanded = true;
        this.render();
      });
      return;
    }

    const canSend = this.canChat();
    setHtml(
      this.container,
      `
      <div style="
        width:280px;background:var(--bg-deep);border:1px solid var(--border);
        border-radius:10px;overflow:hidden;
      ">
        <div style="
          display:flex;justify-content:space-between;align-items:center;
          padding:6px 10px;background:var(--bg-surface);border-bottom:1px solid var(--border);
        ">
          <span style="color:var(--text-dim);font-size:12px;font-weight:600;">${t('ui:spectatorChat.title')}</span>
          <button id="spec-chat-close" style="
            background:none;border:none;color:var(--text-dim);cursor:pointer;
            font-size:16px;padding:0 4px;
          ">×</button>
        </div>
        <div id="spec-chat-messages" style="
          height:160px;overflow-y:auto;padding:6px 8px;font-size:12px;
        "></div>
        ${
          canSend
            ? `
          <div style="padding:6px 8px;border-top:1px solid var(--border);display:flex;gap:4px;">
            <input id="spec-chat-input" type="text" maxlength="200" placeholder="${t('ui:spectatorChat.placeholder')}"
              style="flex:1;background:var(--bg-surface);border:1px solid var(--border);
              color:var(--text);padding:4px 8px;border-radius:6px;font-size:12px;
              font-family:DM Sans,sans-serif;outline:none;">
            <button id="spec-chat-send" style="
              background:var(--primary);border:none;color:white;padding:4px 10px;
              border-radius:6px;cursor:pointer;font-size:12px;font-family:DM Sans,sans-serif;
            ">${t('ui:messages.send')}</button>
          </div>
        `
            : ''
        }
      </div>
    `,
    );

    this.container.querySelector('#spec-chat-close')?.addEventListener('click', () => {
      this.expanded = false;
      this.render();
    });

    this.messagesEl = this.container.querySelector('#spec-chat-messages');
    this.renderMessages();

    if (canSend) {
      this.inputEl = this.container.querySelector('#spec-chat-input') as HTMLInputElement;
      const sendBtn = this.container.querySelector('#spec-chat-send');

      const send = () => {
        const msg = this.inputEl?.value.trim();
        if (!msg) return;
        this.socketClient.emit('game:spectatorChat', { message: msg });
        if (this.inputEl) this.inputEl.value = '';
      };

      this.inputEl?.addEventListener('keydown', (e) => {
        e.stopPropagation(); // Prevent spectator camera controls
        if (e.key === 'Enter') send();
      });
      sendBtn?.addEventListener('click', send);

      // Focus after a tick to avoid triggering game controls
      setTimeout(() => this.inputEl?.focus(), 50);
    }
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    setHtml(
      this.messagesEl,
      this.messages
        .map((m) => {
          const color = ROLE_COLORS[m.role] || 'var(--text-dim)';
          return `<div style="margin-bottom:3px;word-break:break-word;">
          <span style="color:${color};font-weight:600;">${escapeHtml(m.fromUsername)}</span>
          <span style="color:var(--text-dim);">: ${escapeHtml(m.message)}</span>
        </div>`;
        })
        .join(''),
    );
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
