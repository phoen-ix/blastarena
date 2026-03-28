import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { Party, PartyChatMessage, ChatMode, Friend } from '@blast-arena/shared';
import { PartyBar } from '../PartyBar';
import { escapeHtml } from '../../utils/html';
import { t } from '../../i18n';

const AVATAR_COLORS = [
  'var(--primary)',
  'var(--info)',
  'var(--success)',
  'var(--warning)',
  '#bb44ff',
  'var(--accent)',
];

export class PartyView implements ILobbyView {
  readonly viewId = 'party';
  get title() {
    return t('ui:party.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private partyBar: PartyBar;
  private party: Party | null = null;
  private chatMessages: PartyChatMessage[] = [];
  private chatMode: ChatMode = 'everyone';
  private currentUserId: number;
  private currentUserRole: string;

  // Socket handlers
  private partyStateHandler: any;
  private partyDisbandedHandler: any;
  private partyChatHandler: any;
  private settingsChangedHandler: any;

  constructor(deps: ViewDeps, partyBar: PartyBar) {
    this.deps = deps;
    this.partyBar = partyBar;
    const user = deps.authManager.getUser();
    this.currentUserId = user?.id ?? 0;
    this.currentUserRole = user?.role ?? 'user';
    this.party = partyBar.getParty();
    this.setupSocketListeners();
    this.loadChatMode();
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    this.renderView();
  }

  destroy(): void {
    this.container = null;
    const sc = this.deps.socketClient;
    sc.off('party:state', this.partyStateHandler);
    sc.off('party:disbanded', this.partyDisbandedHandler);
    sc.off('party:chat', this.partyChatHandler);
    sc.off('admin:settingsChanged', this.settingsChangedHandler);
  }

  private setupSocketListeners(): void {
    const sc = this.deps.socketClient;

    this.partyStateHandler = (party: Party) => {
      this.party = party;
      this.renderView();
    };
    sc.on('party:state', this.partyStateHandler);

    this.partyDisbandedHandler = () => {
      this.party = null;
      this.chatMessages = [];
      this.renderView();
    };
    sc.on('party:disbanded', this.partyDisbandedHandler);

    this.partyChatHandler = (msg: PartyChatMessage) => {
      this.chatMessages.push(msg);
      if (this.chatMessages.length > 100) this.chatMessages.shift();
      this.renderChatMessages();
      this.scrollChatToBottom();
    };
    sc.on('party:chat', this.partyChatHandler);

    this.settingsChangedHandler = (data: { key: string; value?: unknown }) => {
      if (data.key === 'party_chat_mode') {
        this.chatMode = data.value as ChatMode;
        this.renderView();
      }
    };
    sc.on('admin:settingsChanged', this.settingsChangedHandler);
  }

  private async loadChatMode(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ mode: ChatMode }>('/admin/settings/party_chat_mode');
      this.chatMode = resp.mode ?? 'everyone';
    } catch {
      // Default
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

  private get isLeader(): boolean {
    return this.party?.leaderId === this.currentUserId;
  }

  private renderView(): void {
    if (!this.container) return;

    if (!this.party) {
      this.renderNoParty();
    } else {
      this.renderPartyPage();
    }
  }

  private renderNoParty(): void {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="party-page party-page-empty">
        <div class="party-empty-content">
          <div class="party-empty-icon">&#9733;</div>
          <h2 class="party-empty-title">${t('ui:party.noPartyTitle')}</h2>
          <p class="party-empty-text">${t('ui:party.noPartyDescription')}</p>
          <button class="btn btn-primary" id="party-create-btn">${t('ui:party.create')}</button>
          <p class="party-empty-tip">${t('ui:party.noPartyTip')}</p>
        </div>
      </div>
    `;

    this.container.querySelector('#party-create-btn')!.addEventListener('click', () => {
      this.partyBar.createParty();
    });
  }

  private renderPartyPage(): void {
    if (!this.container || !this.party) return;

    this.container.innerHTML = `
      <div class="party-page">
        <div class="party-page-main">
          <div class="party-page-header">
            <div class="party-page-header-info">
              <span class="party-page-title">${t('ui:party.title')}</span>
              <span class="party-page-count">${t('ui:party.memberCount', { count: this.party.members.length })}</span>
            </div>
            <div class="party-page-header-actions">
              ${this.isLeader ? `<button class="btn btn-sm btn-primary" id="party-page-invite">${t('ui:party.inviteFriendPlus')}</button>` : ''}
              ${
                this.isLeader
                  ? `<button class="btn btn-sm btn-ghost" id="party-page-disband" style="color:var(--danger);">${t('ui:party.disband')}</button>`
                  : `<button class="btn btn-sm btn-ghost" id="party-page-leave" style="color:var(--danger);">${t('ui:party.leaveParty')}</button>`
              }
            </div>
          </div>

          <div class="party-members-grid">
            ${this.party.members
              .map((m) => {
                const color = AVATAR_COLORS[m.userId % AVATAR_COLORS.length];
                const isLead = m.userId === this.party!.leaderId;
                const isMe = m.userId === this.currentUserId;
                return `
                <div class="party-member-card ${isLead ? 'leader' : ''}" data-user-id="${m.userId}">
                  <div class="party-member-card-avatar" style="background:${color};">
                    ${escapeHtml(m.username.charAt(0).toUpperCase())}
                    ${isLead ? '<span class="party-leader-crown">&#9733;</span>' : ''}
                  </div>
                  <div class="party-member-card-info">
                    <span class="party-member-card-name">${escapeHtml(m.username)}${isMe ? ` <span class="text-dim">${t('ui:party.you')}</span>` : ''}</span>
                    <span class="party-member-card-role">${isLead ? t('ui:party.leader') : t('ui:party.member')}</span>
                  </div>
                  ${this.isLeader && !isMe ? '<button class="btn btn-ghost btn-sm party-kick-btn" data-kick-id="' + m.userId + '" style="color:var(--danger);padding:2px 8px;font-size:11px;">' + t('ui:party.kick') + '</button>' : ''}
                </div>
              `;
              })
              .join('')}
          </div>
        </div>

        ${
          this.canChat()
            ? `
          <div class="party-page-chat">
            <div class="party-page-chat-header">${t('ui:party.chatHeader')}</div>
            <div class="party-page-chat-messages" data-chat-messages></div>
            <div class="party-page-chat-input">
              <input type="text" class="input" placeholder="${t('ui:party.chatPlaceholder')}" maxlength="200" data-chat-input aria-label="${t('ui:party.chatAriaLabel')}">
              <button class="btn btn-primary" data-chat-send>${t('ui:party.chatSend')}</button>
            </div>
          </div>
        `
            : this.chatMode === 'disabled'
              ? `
          <div class="party-page-chat">
            <div class="party-page-chat-header">${t('ui:party.chatHeader')}</div>
            <div class="party-page-chat-disabled">${t('ui:party.chatDisabled')}</div>
          </div>
        `
              : ''
        }
      </div>
    `;

    this.bindPartyEvents();
    this.renderChatMessages();
    this.scrollChatToBottom();
  }

  private bindPartyEvents(): void {
    if (!this.container) return;

    // Invite button
    const inviteBtn = this.container.querySelector('#party-page-invite');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', () => this.showInviteModal());
    }

    // Leave button
    const leaveBtn = this.container.querySelector('#party-page-leave');
    if (leaveBtn) {
      leaveBtn.addEventListener('click', () => {
        this.deps.socketClient.emit('party:leave', (res) => {
          if (res.success) {
            this.party = null;
            this.chatMessages = [];
            this.renderView();
          }
        });
      });
    }

    // Disband button
    const disbandBtn = this.container.querySelector('#party-page-disband');
    if (disbandBtn) {
      disbandBtn.addEventListener('click', () => {
        this.deps.socketClient.emit('party:leave', (res) => {
          if (res.success) {
            this.party = null;
            this.chatMessages = [];
            this.renderView();
          }
        });
      });
    }

    // Kick buttons
    this.container.querySelectorAll('.party-kick-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = parseInt((btn as HTMLElement).dataset.kickId!);
        this.deps.socketClient.emit('party:kick', { userId }, (res) => {
          if (!res.success) {
            this.deps.notifications.error(res.error || t('ui:party.kickFailed'));
          }
        });
      });
    });

    // Chat input
    const chatInput = this.container.querySelector('[data-chat-input]') as HTMLInputElement;
    const chatSend = this.container.querySelector('[data-chat-send]');
    if (chatInput && chatSend) {
      const send = () => {
        const msg = chatInput.value.trim();
        if (!msg) return;
        this.deps.socketClient.emit('party:chat', { message: msg });
        chatInput.value = '';
      };
      chatSend.addEventListener('click', send);
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') send();
      });
    }
  }

  private renderChatMessages(): void {
    const body = this.container?.querySelector('[data-chat-messages]') as HTMLElement;
    if (!body) return;

    if (this.chatMessages.length === 0) {
      body.innerHTML = `<div class="party-page-chat-empty">${t('ui:party.chatEmpty')}</div>`;
      return;
    }

    body.innerHTML = this.chatMessages
      .map(
        (m) => `
        <div class="party-page-chat-msg">
          <span class="party-chat-sender">${escapeHtml(m.fromUsername)}</span>
          <span class="party-chat-text">${escapeHtml(m.message)}</span>
        </div>
      `,
      )
      .join('');
  }

  private scrollChatToBottom(): void {
    requestAnimationFrame(() => {
      const body = this.container?.querySelector('[data-chat-messages]') as HTMLElement;
      if (body) body.scrollTop = body.scrollHeight;
    });
  }

  private async showInviteModal(): Promise<void> {
    // Load friends to show invite list
    let friends: Friend[] = [];
    try {
      const resp = await ApiClient.get<{ friends: Friend[] }>('/friends');
      friends = resp.friends.filter((f) => f.status === 'accepted');
    } catch {
      this.deps.notifications.error(t('ui:party.loadFriendsFailed'));
      return;
    }

    // Filter out members already in party
    const memberIds = new Set(this.party?.members.map((m) => m.userId) ?? []);
    const available = friends.filter((f) => !memberIds.has(f.userId));

    if (available.length === 0) {
      this.deps.notifications.info(t('ui:party.noFriendsToInvite'));
      return;
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('ui:party.inviteModalTitle'));
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <h3>${t('ui:party.inviteModalTitle')}</h3>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body" style="max-height:300px;overflow-y:auto;padding:0;">
          ${available
            .map((f) => {
              const color = AVATAR_COLORS[f.userId % AVATAR_COLORS.length];
              const statusDot =
                f.activity === 'offline'
                  ? 'var(--text-muted)'
                  : f.activity === 'in_game' || f.activity === 'in_campaign'
                    ? 'var(--warning)'
                    : 'var(--success)';
              return `
              <div class="party-invite-item" data-invite-user-id="${f.userId}">
                <div class="party-invite-avatar" style="background:${color};">${escapeHtml(f.username.charAt(0).toUpperCase())}</div>
                <span class="party-invite-name">${escapeHtml(f.username)}</span>
                <span class="party-invite-status" style="color:${statusDot};">&#9679;</span>
                <button class="btn btn-sm btn-primary party-invite-send">${t('ui:party.inviteFriend')}</button>
              </div>
            `;
            })
            .join('')}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    };
    overlay.querySelector('.modal-close')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', escHandler);

    overlay.querySelectorAll('.party-invite-send').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.party-invite-item') as HTMLElement;
        const userId = parseInt(item.dataset.inviteUserId!);
        this.deps.socketClient.emit('party:invite', { userId }, (res) => {
          if (res.success) {
            (btn as HTMLButtonElement).textContent = t('ui:party.chatSent');
            (btn as HTMLButtonElement).disabled = true;
            (btn as HTMLButtonElement).classList.remove('btn-primary');
          } else {
            this.deps.notifications.error(res.error || t('ui:party.inviteFailed'));
          }
        });
      });
    });
  }
}
