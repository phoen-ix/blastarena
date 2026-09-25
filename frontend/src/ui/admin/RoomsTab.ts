import { ApiClient } from '../../network/ApiClient';
import { SocketClient } from '../../network/SocketClient';
import { NotificationUI } from '../NotificationUI';
import { GameState, RoomListItem, UserRole, gameModeName } from '@blast-arena/shared';
import { escapeHtml, escapeAttr, setHtml } from '../../utils/html';
import { createModal } from '../../utils/modal';
import { t } from '../../i18n';
import { game } from '../../main';

export class RoomsTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private socketClient: SocketClient;
  private role: UserRole;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  // Live updates: the server broadcasts `room:list` to the lobby room on every room mutation, so
  // subscribe to that instead of polling /admin/rooms every 5 s. The interval stays as a 60 s
  // safety net for a missed broadcast. (audit F7)
  private roomListHandler: ((rooms: RoomListItem[]) => void) | null = null;

  constructor(notifications: NotificationUI, socketClient: SocketClient, role: UserRole) {
    this.notifications = notifications;
    this.socketClient = socketClient;
    this.role = role;
  }

  async render(parent: HTMLElement): Promise<void> {
    const container = document.createElement('div');
    this.container = container;
    parent.appendChild(container);

    this.roomListHandler = (rooms) => this.renderRooms(rooms);
    this.socketClient.on('room:list', this.roomListHandler);
    // Idempotent server-side join. The tab lives inside the lobby shell, which subscribed on
    // mount and unsubscribes on hide; `socket.leave` is not ref-counted, so this tab must NOT
    // emit `lobby:unsubscribe` in destroy() or the rooms view would stop updating afterwards.
    this.socketClient.emit('lobby:subscribe');

    await this.loadRooms();
    // destroy() ran during the load (a quick tab switch): starting the poll now would leak it.
    if (this.container !== container) return;
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this.loadRooms(), 60000);
  }

  destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this.roomListHandler) {
      this.socketClient.off('room:list', this.roomListHandler);
      this.roomListHandler = null;
    }
    this.container?.remove();
    this.container = null;
  }

  private async loadRooms(): Promise<void> {
    if (!this.container) return;

    try {
      const rooms = await ApiClient.get<RoomListItem[]>('/admin/rooms');
      this.renderRooms(rooms);
    } catch {
      if (!this.container) return;
      setHtml(
        this.container,
        `<div style="color:var(--danger);">${t('admin:rooms.loadFailed')}</div>`,
      );
    }
  }

  private renderRooms(rooms: RoomListItem[]): void {
    if (!this.container) return;
    const isAdmin = this.role === 'admin';

    setHtml(
      this.container,
      `
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
                (r: RoomListItem) => `
              <tr>
                <td style="font-family:monospace;">${escapeHtml(r.code)}</td>
                <td>${escapeHtml(r.name)}</td>
                <td>${escapeHtml(t(gameModeName(r.gameMode), { defaultValue: r.gameMode }))}</td>
                <td>${t('admin:rooms.playerCount', { current: r.playerCount, max: r.maxPlayers })}</td>
                <td><span class="badge badge-${r.status === 'playing' ? 'admin' : 'active'}">${r.status === 'playing' ? t('ui:rooms.statusPlaying') : t('ui:rooms.statusWaiting')}</span></td>
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
      `,
    );

    // Same function reference every time, so addEventListener de-duplicates it.
    this.container.addEventListener('click', this.handleClick);
  }

  private handleClick = async (e: Event) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const code = target.dataset.code;
    if (!action || !code) return;

    if (action === 'spectate') {
      this.socketClient.emit('admin:spectate', { roomCode: code }, (res) => {
        if (res.success && res.state) {
          this.notifications.success(t('admin:rooms.spectatingRoom', { code }));
          this.openSpectatorView(code, res.state);
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

  /**
   * Watch the match. Spectating used to join the socket to the room and stop there: nothing was
   * shown, and the admin's lobby took the room's 20 Hz state for the rest of the session.
   * GameScene sends admin:unspectate when the view closes.
   */
  private openSpectatorView(code: string, state: GameState): void {
    const lobbyScene = game.scene.getScene('LobbyScene');
    if (!lobbyScene || !this.container) {
      this.socketClient.emit('admin:unspectate', { roomCode: code });
      return;
    }
    game.registry.set('initialGameState', state);
    game.registry.set('adminSpectate', { roomCode: code });
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      while (uiOverlay.firstChild) uiOverlay.removeChild(uiOverlay.firstChild);
    }
    lobbyScene.scene.start('GameScene');
    lobbyScene.scene.launch('HUDScene');
  }

  private showMessageModal(code: string): void {
    const { overlay, content, close } = createModal({
      ariaLabel: t('admin:rooms.sendMessageTitle'),
      style: 'max-width:400px;',
      parent: document.getElementById('ui-overlay')!,
    });
    setHtml(
      content,
      `
      <h2 style="margin-bottom:12px;">${t('admin:rooms.sendMessageTitle')}</h2>
      <input type="text" class="admin-input" id="room-message-input" placeholder="${escapeAttr(t('admin:rooms.messagePlaceholder'))}" aria-label="${escapeAttr(t('admin:rooms.messageAriaLabel'))}">
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-secondary" id="msg-cancel">${t('admin:rooms.cancelBtn')}</button>
        <button class="btn btn-primary" id="msg-send">${t('admin:rooms.sendBtn')}</button>
      </div>
    `,
    );

    overlay.querySelector('#msg-cancel')!.addEventListener('click', close);
    const sendBtn = overlay.querySelector('#msg-send') as HTMLButtonElement;
    sendBtn.addEventListener('click', () => {
      const input = overlay.querySelector('#room-message-input') as HTMLInputElement;
      const message = input.value.trim();
      if (!message) {
        close();
        return;
      }
      sendBtn.disabled = true;
      // Acknowledged: the result is shown as it is. The old fire-and-forget emit always toasted
      // "Message sent", even when the room was gone or the message was refused.
      this.socketClient.emit('admin:roomMessage', { roomCode: code, message }, (res) => {
        if (res.success) {
          this.notifications.success(t('admin:rooms.messageSent'));
          close();
        } else {
          sendBtn.disabled = false;
          this.notifications.error(res.error || t('admin:rooms.messageFailed'));
        }
      });
    });
  }

  private async showKickModal(code: string): Promise<void> {
    // Fetch room details to get player list
    let rooms: RoomListItem[];
    try {
      rooms = await ApiClient.get<RoomListItem[]>('/admin/rooms');
    } catch {
      this.notifications.error(t('admin:rooms.fetchRoomFailed'));
      return;
    }

    const room = rooms.find((r: RoomListItem) => r.code === code);
    if (!room) {
      this.notifications.error(t('admin:rooms.roomNotFound'));
      return;
    }

    // We need more detail about players. For now, show a simple input for user ID.
    // The room list endpoint returns playerCount but not player details.
    // Let's ask for the player to kick by prompting.
    const { overlay, content, close } = createModal({
      ariaLabel: t('admin:rooms.kickPlayerTitle', { code }),
      style: 'max-width:400px;',
      parent: document.getElementById('ui-overlay')!,
    });
    setHtml(
      content,
      `
      <h2 style="margin-bottom:12px;">${t('admin:rooms.kickPlayerTitle', { code: escapeHtml(code) })}</h2>
      <label style="color:var(--text-dim);font-size:13px;">${t('admin:rooms.playerUserIdLabel')}</label>
      <input type="number" class="admin-input" id="kick-user-id" placeholder="${escapeAttr(t('admin:rooms.enterUserIdPlaceholder'))}" style="margin-top:6px;">
      <label style="color:var(--text-dim);font-size:13px;margin-top:8px;display:block;">${t('admin:rooms.reasonLabel')}</label>
      <input type="text" class="admin-input" id="kick-reason" placeholder="${escapeAttr(t('admin:rooms.reasonPlaceholder'))}" style="margin-top:6px;">
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-secondary" id="kick-cancel">${t('admin:rooms.cancelBtn')}</button>
        <button class="btn-warn" style="padding:8px 16px;font-size:14px;" id="kick-confirm">${t('admin:rooms.kickConfirmBtn')}</button>
      </div>
    `,
    );

    overlay.querySelector('#kick-cancel')!.addEventListener('click', close);
    overlay.querySelector('#kick-confirm')!.addEventListener('click', () => {
      const userId = parseInt((overlay.querySelector('#kick-user-id') as HTMLInputElement).value);
      const reason = (overlay.querySelector('#kick-reason') as HTMLInputElement).value;
      if (!userId || isNaN(userId)) {
        this.notifications.error(t('admin:rooms.invalidUserId'));
        return;
      }
      close();
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
    const { overlay, content, close } = createModal({
      ariaLabel: t('admin:rooms.closeRoomTitle'),
      style: 'max-width:380px;',
      parent: document.getElementById('ui-overlay')!,
    });
    setHtml(
      content,
      `
      <h2 style="margin-bottom:12px;color:var(--danger);">${t('admin:rooms.closeRoomTitle')}</h2>
      <p style="color:var(--text-dim);">${t('admin:rooms.closeRoomConfirmation', { code: escapeHtml(code) })}</p>
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-secondary" id="close-cancel">${t('admin:rooms.cancelBtn')}</button>
        <button class="btn-danger" style="padding:8px 16px;font-size:14px;" id="close-confirm">${t('admin:rooms.closeRoomBtn')}</button>
      </div>
    `,
    );

    overlay.querySelector('#close-cancel')!.addEventListener('click', close);
    overlay.querySelector('#close-confirm')!.addEventListener('click', () => {
      close();
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
