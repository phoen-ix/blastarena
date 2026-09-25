import { SocketClient } from '../network/SocketClient';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import {
  Party,
  PartyChatMessage,
  PartyInvite,
  ChatMode,
  UserRole,
  ServerToClientEvents,
} from '@blast-arena/shared';
import { escapeHtml, setHtml } from '../utils/html';
import { t } from '../i18n';

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
  // PartyView (and anything else showing the party) follows this bar's state instead of keeping
  // its own copy; the two used to drift apart after every create/leave.
  private partyListeners = new Set<(party: Party | null) => void>();
  // Set while our own party:leave is in flight: the server tells the leaver's tabs with
  // party:disbanded, which must not toast "Party disbanded" at the user who just left.
  private leavePending = false;

  // Socket handler refs (assigned in setupSocketListeners, called from the constructor)
  private partyStateHandler!: ServerToClientEvents['party:state'];
  private partyDisbandedHandler!: ServerToClientEvents['party:disbanded'];
  private partyChatHandler!: ServerToClientEvents['party:chat'];
  private partyInviteHandler!: ServerToClientEvents['party:invite'];
  private roomInviteHandler!: ServerToClientEvents['invite:room'];
  private settingsChangedHandler!: ServerToClientEvents['admin:settingsChanged'];

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
    this.syncParty();
  }

  /**
   * A PartyBar is built with every LobbyUI and used to start at "no party" until the next party
   * event — so after any room trip the bar was gone while the user was still in a party.
   */
  private syncParty(): void {
    this.socketClient.emit('party:sync', (res) => {
      if (res.success) this.setParty(res.party ?? null);
    });
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
    if (this.chatMode === 'staff')
      return this.currentUserRole === 'admin' || this.currentUserRole === 'moderator';
    return false;
  }

  mount(parent: HTMLElement): void {
    if (!parent.contains(this.container)) {
      parent.appendChild(this.container);
    }
    this.render(); // re-mounted after a language change: redraw its labels
  }

  destroy(): void {
    this.socketClient.off('party:state', this.partyStateHandler);
    this.socketClient.off('party:disbanded', this.partyDisbandedHandler);
    this.socketClient.off('party:chat', this.partyChatHandler);
    this.socketClient.off('party:invite', this.partyInviteHandler);
    this.socketClient.off('invite:room', this.roomInviteHandler);
    this.socketClient.off('admin:settingsChanged', this.settingsChangedHandler);
    this.chatContainer?.remove();
    this.container.remove();
    this.partyListeners.clear();
  }

  getParty(): Party | null {
    return this.party;
  }

  /** Follow party changes; returns the unsubscribe function. */
  onPartyChange(listener: (party: Party | null) => void): () => void {
    this.partyListeners.add(listener);
    return () => {
      this.partyListeners.delete(listener);
    };
  }

  /** The single place party state changes: every create/leave/sync/server event ends here. */
  private setParty(party: Party | null): void {
    this.party = party;
    if (!party) {
      this.chatMessages = [];
      this.chatOpen = false;
      this.chatContainer?.remove();
      this.chatContainer = null;
    }
    this.render();
    for (const listener of this.partyListeners) listener(party);
  }

  private setupSocketListeners(): void {
    this.partyStateHandler = (party: Party) => {
      this.setParty(party);
    };
    this.socketClient.on('party:state', this.partyStateHandler);

    this.partyDisbandedHandler = () => {
      const wasInParty = this.party !== null;
      this.setParty(null);
      if (wasInParty && !this.leavePending) this.notifications.info(t('ui:party.disbanded'));
    };
    this.socketClient.on('party:disbanded', this.partyDisbandedHandler);

    this.partyChatHandler = (msg: PartyChatMessage) => {
      this.chatMessages.push(msg);
      if (this.chatMessages.length > 50) this.chatMessages.shift();
      this.renderChat();
    };
    this.socketClient.on('party:chat', this.partyChatHandler);

    this.partyInviteHandler = (invite: PartyInvite) => {
      this.showInviteToast(invite);
    };
    this.socketClient.on('party:invite', this.partyInviteHandler);

    // `party:joinRoom` (leader entered a room → followers auto-join) is handled by LobbyScene,
    // which owns the room transition. PartyBar used to subscribe as well, so every follower
    // emitted room:join twice and the second answer was an ALREADY_IN_ROOM error toast.
    // (audit PARTY-JOIN-TWICE-1)

    this.roomInviteHandler = (invite: PartyInvite) => {
      this.showInviteToast(invite);
    };
    this.socketClient.on('invite:room', this.roomInviteHandler);

    this.settingsChangedHandler = (data: { key: string; value?: unknown }) => {
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
    this.socketClient.on('admin:settingsChanged', this.settingsChangedHandler);
  }

  createParty(): void {
    this.socketClient.emit('party:create', (response) => {
      if (response.success && response.party) {
        this.setParty(response.party);
        this.notifications.success(t('ui:party.created'));
      } else {
        this.notifications.error(response.error || t('ui:party.createFailed'));
      }
    });
  }

  /** Leave the party (the leader leaving disbands it). */
  leaveParty(): void {
    if (this.leavePending) return;
    this.leavePending = true;
    this.socketClient.emit('party:leave', (res) => {
      this.leavePending = false;
      if (res.success) {
        this.setParty(null);
      } else if (res.error) {
        this.notifications.error(res.error);
      }
    });
  }

  private render(): void {
    if (!this.party) {
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'flex';
    const isLeader = this.party.leaderId === this.currentUserId;

    setHtml(
      this.container,
      `
      <span class="party-label">${t('ui:party.title')}</span>
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
      ${isLeader ? `<button class="btn btn-ghost" id="party-invite-btn" style="padding:4px 12px;font-size:11px;color:var(--accent);">${t('ui:party.invite')}</button>` : ''}
      ${this.canChat() ? `<button class="btn btn-ghost" id="party-chat-btn" style="padding:4px 12px;font-size:11px;">${t('ui:party.chat')}</button>` : ''}
      <button class="btn btn-ghost" id="party-leave-btn" style="padding:4px 12px;font-size:11px;color:var(--danger);">${t('ui:party.leave')}</button>
    `,
    );

    const inviteBtn = this.container.querySelector('#party-invite-btn');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', () => {
        this.notifications.info(t('ui:party.usePartyPage'));
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
      this.leaveParty();
    });
  }

  private showChat(): void {
    if (this.chatContainer) {
      this.chatContainer.remove();
    }

    this.chatContainer = document.createElement('div');
    this.chatContainer.className = 'party-chat';
    setHtml(
      this.chatContainer,
      `
      <div class="party-chat-messages" id="party-chat-messages"></div>
      <div class="party-chat-input">
        <input type="text" id="party-chat-input" placeholder="${t('ui:party.chatPlaceholder')}" maxlength="200" aria-label="${t('ui:party.chatAriaLabel')}">
        <button class="btn btn-primary" id="party-chat-send" style="padding:6px 12px;font-size:12px;">${t('ui:messages.send')}</button>
      </div>
    `,
    );

    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) uiOverlay.appendChild(this.chatContainer);

    this.renderChat();

    const input = this.chatContainer.querySelector('#party-chat-input') as HTMLInputElement;
    const sendBtn = this.chatContainer.querySelector('#party-chat-send')!;

    const send = () => {
      const msg = input.value.trim();
      if (!msg) return;
      this.socketClient.emit('party:chat', { message: msg });
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

    setHtml(
      messagesEl,
      this.chatMessages
        .map(
          (m) =>
            `<div class="party-chat-msg"><span class="sender">${escapeHtml(m.fromUsername)}</span><span class="text">${escapeHtml(m.message)}</span></div>`,
        )
        .join(''),
    );

    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private showInviteToast(invite: PartyInvite): void {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'invite-toast';

    const inviteMessage =
      invite.type === 'party'
        ? t('ui:party.invitedToParty', { username: escapeHtml(invite.fromUsername) })
        : t('ui:party.invitedToRoom', { username: escapeHtml(invite.fromUsername) });
    setHtml(
      toast,
      `
      <div class="invite-text">${inviteMessage}</div>
      <div class="invite-actions">
        <button class="btn btn-primary invite-accept">${t('ui:party.accept')}</button>
        <button class="btn btn-ghost invite-decline" style="color:var(--danger);">${t('ui:party.decline')}</button>
      </div>
    `,
    );

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
        this.socketClient.emit('party:acceptInvite', { inviteId: invite.inviteId }, (res) => {
          if (res.success) {
            this.notifications.success(t('ui:party.joinedParty'));
          } else {
            this.notifications.error(res.error || t('ui:party.joinFailed'));
          }
        });
      } else if (invite.type === 'room' && invite.roomCode) {
        // Decline the invite server-side (cleanup)
        this.socketClient.emit('invite:acceptRoom', { inviteId: invite.inviteId }, () => {});
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
        this.socketClient.emit('party:declineInvite', { inviteId: invite.inviteId });
      } else {
        this.socketClient.emit('invite:declineRoom', { inviteId: invite.inviteId });
      }
      cleanup();
    });
  }
}
