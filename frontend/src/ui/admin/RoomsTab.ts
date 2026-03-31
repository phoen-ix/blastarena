import { ApiClient } from '../../network/ApiClient';
import { SocketClient } from '../../network/SocketClient';
import { NotificationUI } from '../NotificationUI';
import { UserRole } from '@blast-arena/shared';
import { escapeHtml, escapeAttr } from '../../utils/html';
import { t } from '../../i18n';

export class RoomsTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private socketClient: SocketClient;
  private role: UserRole;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;

  constructor(notifications: NotificationUI, socketClient: SocketClient, role: UserRole) {
    this.notifications = notifications;
    this.socketClient = socketClient;
    this.role = role;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.abortController = new AbortController();
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    await this.loadRooms();
    this.refreshInterval = setInterval(() => this.loadRooms(), 5000);
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.container?.remove();
    this.container = null;
  }

  private async loadRooms(): Promise<void> {
    if (!this.container) return;
    const isAdmin = this.role === 'admin';

    try {
      const rooms = await ApiClient.get<any[]>('/admin/rooms');
      if (!this.container) return;

      this.container.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>${t('admin:rooms.columnCode')}</th>
              <th>${t('admin:rooms.columnName')}</th>
              <th>${t('admin:rooms.columnMode')}</th>
              <th>${t('admin:rooms.columnPlayers')}</th>
              <th>${t('admin:rooms.columnStatus')}</th>
              <th>${t('admin:rooms.columnActions')}</th>
            </tr>
          </thead>
          <tbody>
            ${rooms
              .map(
                (r: any) => `
              <tr>
                <td style="font-family:monospace;">${escapeHtml(r.code)}</td>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(r.gameMode)}</td>
                <td>${t('admin:rooms.playerCount', { current: r.playerCount, max: r.maxPlayers })}</td>
                <td><span class="badge badge-${r.status === 'playing' ? 'admin' : 'active'}">${r.status}</span></td>
                <td style="display:flex;gap:4px;flex-wrap:wrap;">
                  <button class="btn btn-secondary btn-sm" data-action="spectate" data-code="${escapeAttr(r.code)}">${t('admin:rooms.spectateBtn')}</button>
                  <button class="btn btn-secondary btn-sm" data-action="message" data-code="${escapeAttr(r.code)}">${t('admin:rooms.messageBtn')}</button>
                  <button class="btn-warn btn-sm" data-action="kick" data-code="${escapeAttr(r.code)}">${t('admin:rooms.kickBtn')}</button>
                  ${isAdmin ? `<button class="btn-danger btn-sm" data-action="close" data-code="${escapeAttr(r.code)}">${t('admin:rooms.closeBtn')}</button>` : ''}
                </td>
              </tr>
            `,
              )
              .join('')}
            ${rooms.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);">${t('admin:rooms.noActiveRooms')}</td></tr>` : ''}
          </tbody>
        </table>
      `;

      this.container.addEventListener('click', this.handleClick);
    } catch {
      this.container.innerHTML = `<div style="color:var(--danger);">${t('admin:rooms.loadFailed')}</div>`;
    }
  }

  private handleClick = async (e: Event) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const code = target.dataset.code;
    if (!action || !code) return;

    if (action === 'spectate') {
      this.socketClient.emit('admin:spectate', { roomCode: code }, (res) => {
        if (res.success) {
          this.notifications.success(t('admin:rooms.spectatingRoom', { code }));
        } else {
          this.notifications.error(res.error || t('admin:rooms.failedToSpectate'));
        }
      });
    } else if (action === 'message') {
      this.showMessageModal(code);
    } else if (action === 'kick') {
      this.showKickModal(code);
    } else if (action === 'close') {
      this.showCloseConfirmation(code);
    }
  };

  private showMessageModal(code: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:rooms.sendMessageTitle'));
    modal.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <h2 style="margin-bottom:12px;">${t('admin:rooms.sendMessageTitle')}</h2>
        <input type="text" class="admin-input" id="room-message-input" placeholder="${escapeAttr(t('admin:rooms.messagePlaceholder'))}" aria-label="${escapeAttr(t('admin:rooms.messageAriaLabel'))}">
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="msg-cancel">${t('admin:rooms.cancelBtn')}</button>
          <button class="btn btn-primary" id="msg-send">${t('admin:rooms.sendBtn')}</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#msg-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    modal.querySelector('#msg-send')!.addEventListener('click', () => {
      const input = modal.querySelector('#room-message-input') as HTMLInputElement;
      if (input.value.trim()) {
        this.socketClient.emit('admin:roomMessage', {
          roomCode: code,
          message: input.value.trim(),
        });
        this.notifications.success(t('admin:rooms.messageSent'));
      }
      modal.remove();
    });
  }

  private async showKickModal(code: string): Promise<void> {
    // Fetch room details to get player list
    let rooms: any[];
    try {
      rooms = await ApiClient.get<any[]>('/admin/rooms');
    } catch {
      this.notifications.error(t('admin:rooms.fetchRoomFailed'));
      return;
    }

    const room = rooms.find((r: any) => r.code === code);
    if (!room) {
      this.notifications.error(t('admin:rooms.roomNotFound'));
      return;
    }

    // We need more detail about players. For now, show a simple input for user ID.
    // The room list endpoint returns playerCount but not player details.
    // Let's ask for the player to kick by prompting.
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:rooms.kickPlayerTitle', { code }));
    modal.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <h2 style="margin-bottom:12px;">${t('admin:rooms.kickPlayerTitle', { code: escapeHtml(code) })}</h2>
        <label style="color:var(--text-dim);font-size:13px;">${t('admin:rooms.playerUserIdLabel')}</label>
        <input type="number" class="admin-input" id="kick-user-id" placeholder="${escapeAttr(t('admin:rooms.enterUserIdPlaceholder'))}" style="margin-top:6px;">
        <label style="color:var(--text-dim);font-size:13px;margin-top:8px;display:block;">${t('admin:rooms.reasonLabel')}</label>
        <input type="text" class="admin-input" id="kick-reason" placeholder="${escapeAttr(t('admin:rooms.reasonPlaceholder'))}" style="margin-top:6px;">
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="kick-cancel">${t('admin:rooms.cancelBtn')}</button>
          <button class="btn-warn" style="padding:8px 16px;font-size:14px;" id="kick-confirm">${t('admin:rooms.kickConfirmBtn')}</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#kick-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    modal.querySelector('#kick-confirm')!.addEventListener('click', () => {
      const userId = parseInt((modal.querySelector('#kick-user-id') as HTMLInputElement).value);
      const reason = (modal.querySelector('#kick-reason') as HTMLInputElement).value;
      if (!userId || isNaN(userId)) {
        this.notifications.error(t('admin:rooms.invalidUserId'));
        return;
      }
      modal.remove();
      this.socketClient.emit('admin:kick', { roomCode: code, userId, reason }, (res) => {
        if (res.success) {
          this.notifications.success(t('admin:rooms.playerKicked'));
          this.loadRooms();
        } else {
          this.notifications.error(res.error || t('admin:rooms.failedToKick'));
        }
      });
    });
  }

  private showCloseConfirmation(code: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:rooms.closeRoomTitle'));
    modal.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <h2 style="margin-bottom:12px;color:var(--danger);">${t('admin:rooms.closeRoomTitle')}</h2>
        <p style="color:var(--text-dim);">${t('admin:rooms.closeRoomConfirmation', { code: escapeHtml(code) })}</p>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="close-cancel">${t('admin:rooms.cancelBtn')}</button>
          <button class="btn-danger" style="padding:8px 16px;font-size:14px;" id="close-confirm">${t('admin:rooms.closeRoomBtn')}</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#close-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    modal.querySelector('#close-confirm')!.addEventListener('click', () => {
      modal.remove();
      this.socketClient.emit('admin:closeRoom', { roomCode: code }, (res) => {
        if (res.success) {
          this.notifications.success(t('admin:rooms.roomClosed'));
          this.loadRooms();
        } else {
          this.notifications.error(res.error || t('admin:rooms.failedToClose'));
        }
      });
    });
  }
}
