import { SocketClient } from '../network/SocketClient';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { Party, PartyChatMessage, PartyInvite, ChatMode, UserRole } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';

export class PartyBar {
  private container: HTMLElement;
  private socketClient: SocketClient;
  private notifications: NotificationUI;
  private party: Party | null = null;
  private chatOpen = false;
  private chatMessages: PartyChatMessage[] = [];
  private chatContainer: HTMLElement | null = null;
  private currentUserId: number;
  private currentUserRole: UserRole;
  private chatMode: ChatMode = 'everyone';

  // Invite handler for room/party invites
  private onJoinRoom: ((roomCode: string) => void) | null = null;

  // Socket handler refs
  private partyStateHandler: any;
  private partyDisbandedHandler: any;
  private partyChatHandler: any;
  private partyInviteHandler: any;
  private partyJoinRoomHandler: any;
  private roomInviteHandler: any;
  private settingsChangedHandler: any;

  constructor(
    socketClient: SocketClient,
    notifications: NotificationUI,
    currentUserId: number,
    currentUserRole: UserRole = 'user',
  ) {
    this.socketClient = socketClient;
    this.notifications = notifications;
    this.currentUserId = currentUserId;
    this.currentUserRole = currentUserRole;
    this.container = document.createElement('div');
    this.container.className = 'party-bar';
    this.container.style.display = 'none';
    this.setupSocketListeners();
    this.loadChatMode();
  }

  setJoinRoomCallback(cb: (roomCode: string) => void): void {
    this.onJoinRoom = cb;
  }

  private async loadChatMode(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ mode: ChatMode }>('/admin/settings/party_chat_mode');
      this.chatMode = resp.mode ?? 'everyone';
    } catch {
      // Default to everyone on failure
    }
  }

  private canChat(): boolean {
    if (this.chatMode === 'everyone') return true;
    if (this.chatMode === 'disabled') return false;
    if (this.chatMode === 'admin_only') return this.currentUserRole === 'admin';
    if (this.chatMode === 'staff') return this.currentUserRole === 'admin' || this.currentUserRole === 'moderator';
    return false;
  }

  mount(parent: HTMLElement): void {
    if (!parent.contains(this.container)) {
      parent.appendChild(this.container);
    }
  }

  destroy(): void {
    this.socketClient.off('party:state' as any, this.partyStateHandler);
    this.socketClient.off('party:disbanded' as any, this.partyDisbandedHandler);
    this.socketClient.off('party:chat' as any, this.partyChatHandler);
    this.socketClient.off('party:invite' as any, this.partyInviteHandler);
    this.socketClient.off('party:joinRoom' as any, this.partyJoinRoomHandler);
    this.socketClient.off('invite:room' as any, this.roomInviteHandler);
    this.socketClient.off('admin:settingsChanged' as any, this.settingsChangedHandler);
    this.chatContainer?.remove();
    this.container.remove();
  }

  getParty(): Party | null {
    return this.party;
  }

  private setupSocketListeners(): void {
    this.partyStateHandler = (party: Party) => {
      this.party = party;
      this.render();
    };
    this.socketClient.on('party:state' as any, this.partyStateHandler);

    this.partyDisbandedHandler = () => {
      this.party = null;
      this.chatMessages = [];
      this.chatOpen = false;
      this.chatContainer?.remove();
      this.chatContainer = null;
      this.render();
      this.notifications.info('Party disbanded');
    };
    this.socketClient.on('party:disbanded' as any, this.partyDisbandedHandler);

    this.partyChatHandler = (msg: PartyChatMessage) => {
      this.chatMessages.push(msg);
      if (this.chatMessages.length > 50) this.chatMessages.shift();
      this.renderChat();
    };
    this.socketClient.on('party:chat' as any, this.partyChatHandler);

    this.partyInviteHandler = (invite: PartyInvite) => {
      this.showInviteToast(invite);
    };
    this.socketClient.on('party:invite' as any, this.partyInviteHandler);

    this.partyJoinRoomHandler = (data: { roomCode: string }) => {
      if (this.onJoinRoom) {
        this.onJoinRoom(data.roomCode);
      }
    };
    this.socketClient.on('party:joinRoom' as any, this.partyJoinRoomHandler);

    this.roomInviteHandler = (invite: PartyInvite) => {
      this.showInviteToast(invite);
    };
    this.socketClient.on('invite:room' as any, this.roomInviteHandler);

    this.settingsChangedHandler = (data: { key: string; value: any }) => {
      if (data.key === 'party_chat_mode') {
        this.chatMode = data.value as ChatMode;
        if (!this.canChat() && this.chatOpen) {
          this.chatOpen = false;
          this.chatContainer?.remove();
          this.chatContainer = null;
        }
        if (this.party) this.render();
      }
    };
    this.socketClient.on('admin:settingsChanged' as any, this.settingsChangedHandler);
  }

  createParty(): void {
    this.socketClient.emit('party:create' as any, ((response: any) => {
      if (response.success && response.party) {
        this.party = response.party;
        this.render();
        this.notifications.success('Party created');
      } else {
        this.notifications.error(response.error || 'Failed to create party');
      }
    }) as any);
  }

  private render(): void {
    if (!this.party) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'flex';
    const isLeader = this.party.leaderId === this.currentUserId;

    this.container.innerHTML = `
      <span class="party-label">Party</span>
      <div class="party-members">
        ${this.party.members
          .map((m) => {
            const isLead = m.userId === this.party!.leaderId;
            return `
              <div class="party-member-chip">
                <div class="party-member-avatar">${escapeHtml(m.username.charAt(0).toUpperCase())}</div>
                ${escapeHtml(m.username)}
                ${isLead ? '<span class="leader-icon">★</span>' : ''}
              </div>
            `;
          })
          .join('')}
      </div>
      ${isLeader ? '<button class="btn btn-ghost" id="party-invite-btn" style="padding:4px 12px;font-size:11px;color:var(--accent);">+ Invite</button>' : ''}
      ${this.canChat() ? '<button class="btn btn-ghost" id="party-chat-btn" style="padding:4px 12px;font-size:11px;">Chat</button>' : ''}
      <button class="btn btn-ghost" id="party-leave-btn" style="padding:4px 12px;font-size:11px;color:var(--danger);">Leave</button>
    `;

    const inviteBtn = this.container.querySelector('#party-invite-btn');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', () => {
        this.notifications.info('Use the Friends panel to invite players');
      });
    }

    this.container.querySelector('#party-chat-btn')?.addEventListener('click', () => {
      this.chatOpen = !this.chatOpen;
      if (this.chatOpen) {
        this.showChat();
      } else {
        this.chatContainer?.remove();
        this.chatContainer = null;
      }
    });

    this.container.querySelector('#party-leave-btn')!.addEventListener('click', () => {
      this.socketClient.emit('party:leave' as any, ((res: any) => {
        if (res.success) {
          this.party = null;
          this.chatMessages = [];
          this.chatOpen = false;
          this.chatContainer?.remove();
          this.chatContainer = null;
          this.render();
        }
      }) as any);
    });
  }

  private showChat(): void {
    if (this.chatContainer) {
      this.chatContainer.remove();
    }

    this.chatContainer = document.createElement('div');
    this.chatContainer.className = 'party-chat';
    this.chatContainer.innerHTML = `
      <div class="party-chat-messages" id="party-chat-messages"></div>
      <div class="party-chat-input">
        <input type="text" id="party-chat-input" placeholder="Type a message..." maxlength="200">
        <button class="btn btn-primary" id="party-chat-send" style="padding:6px 12px;font-size:12px;">Send</button>
      </div>
    `;

    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) uiOverlay.appendChild(this.chatContainer);

    this.renderChat();

    const input = this.chatContainer.querySelector('#party-chat-input') as HTMLInputElement;
    const sendBtn = this.chatContainer.querySelector('#party-chat-send')!;

    const send = () => {
      const msg = input.value.trim();
      if (!msg) return;
      this.socketClient.emit('party:chat' as any, { message: msg });
      input.value = '';
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
    input.focus();
  }

  private renderChat(): void {
    const messagesEl = this.chatContainer?.querySelector('#party-chat-messages');
    if (!messagesEl) return;

    messagesEl.innerHTML = this.chatMessages
      .map(
        (m) =>
          `<div class="party-chat-msg"><span class="sender">${escapeHtml(m.fromUsername)}</span><span class="text">${escapeHtml(m.message)}</span></div>`,
      )
      .join('');

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private showInviteToast(invite: PartyInvite): void {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'invite-toast';

    const typeLabel = invite.type === 'party' ? 'their party' : 'a room';
    toast.innerHTML = `
      <div class="invite-text"><strong>${escapeHtml(invite.fromUsername)}</strong> invited you to ${typeLabel}</div>
      <div class="invite-actions">
        <button class="btn btn-primary invite-accept">Accept</button>
        <button class="btn btn-ghost invite-decline" style="color:var(--danger);">Decline</button>
      </div>
    `;

    toastContainer.appendChild(toast);

    const cleanup = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    };

    // Auto-dismiss after 30s
    const timer = setTimeout(cleanup, 30000);

    toast.querySelector('.invite-accept')!.addEventListener('click', () => {
      clearTimeout(timer);
      if (invite.type === 'party') {
        this.socketClient.emit('party:acceptInvite' as any, { inviteId: invite.inviteId }, ((res: any) => {
          if (res.success) {
            this.notifications.success('Joined party');
          } else {
            this.notifications.error(res.error || 'Failed to join party');
          }
        }) as any);
      } else if (invite.type === 'room' && invite.roomCode) {
        // Decline the invite server-side (cleanup)
        this.socketClient.emit('invite:acceptRoom' as any, { inviteId: invite.inviteId }, (() => {}) as any);
        // Trigger room join
        if (this.onJoinRoom) {
          this.onJoinRoom(invite.roomCode);
        }
      }
      cleanup();
    });

    toast.querySelector('.invite-decline')!.addEventListener('click', () => {
      clearTimeout(timer);
      if (invite.type === 'party') {
        this.socketClient.emit('party:declineInvite' as any, { inviteId: invite.inviteId });
      } else {
        this.socketClient.emit('invite:declineRoom' as any, { inviteId: invite.inviteId });
      }
      cleanup();
    });
  }
}
