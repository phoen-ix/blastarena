import { ApiClient } from '../../network/ApiClient';
import { SocketClient } from '../../network/SocketClient';
import { NotificationUI } from '../NotificationUI';
import { UserRole } from '@blast-arena/shared';

export class RoomsTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private socketClient: SocketClient;
  private role: UserRole;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(notifications: NotificationUI, socketClient: SocketClient, role: UserRole) {
    this.notifications = notifications;
    this.socketClient = socketClient;
    this.role = role;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    await this.loadRooms();
    this.refreshInterval = setInterval(() => this.loadRooms(), 5000);
  }

  destroy(): void {
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

      this.container.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Mode</th>
              <th>Players</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rooms.map((r: any) => `
              <tr>
                <td style="font-family:monospace;">${this.escapeHtml(r.code)}</td>
                <td>${this.escapeHtml(r.name)}</td>
                <td>${this.escapeHtml(r.gameMode)}</td>
                <td>${r.playerCount}/${r.maxPlayers}</td>
                <td><span class="badge badge-${r.status === 'playing' ? 'admin' : 'active'}">${r.status}</span></td>
                <td style="display:flex;gap:4px;flex-wrap:wrap;">
                  <button class="btn btn-secondary btn-sm" data-action="spectate" data-code="${this.escapeAttr(r.code)}">Spectate</button>
                  <button class="btn btn-secondary btn-sm" data-action="message" data-code="${this.escapeAttr(r.code)}">Message</button>
                  <button class="btn-warn btn-sm" data-action="kick" data-code="${this.escapeAttr(r.code)}">Kick</button>
                  ${isAdmin ? `<button class="btn-danger btn-sm" data-action="close" data-code="${this.escapeAttr(r.code)}">Close</button>` : ''}
                </td>
              </tr>
            `).join('')}
            ${rooms.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);">No active rooms</td></tr>' : ''}
          </tbody>
        </table>
      `;

      this.container.addEventListener('click', this.handleClick);
    } catch {
      this.container.innerHTML = '<div style="color:var(--danger);">Failed to load rooms</div>';
    }
  }

  private handleClick = async (e: Event) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const code = target.dataset.code;
    if (!action || !code) return;

    if (action === 'spectate') {
      this.socketClient.emit('admin:spectate' as any, { roomCode: code }, (res: any) => {
        if (res.success) {
          this.notifications.success(`Spectating room ${code}`);
        } else {
          this.notifications.error(res.error || 'Failed to spectate');
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
    modal.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <h2 style="margin-bottom:12px;">Send Message to Room</h2>
        <input type="text" class="admin-input" id="room-message-input" placeholder="Type your message...">
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="msg-cancel">Cancel</button>
          <button class="btn btn-primary" id="msg-send">Send</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#msg-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#msg-send')!.addEventListener('click', () => {
      const input = modal.querySelector('#room-message-input') as HTMLInputElement;
      if (input.value.trim()) {
        this.socketClient.emit('admin:roomMessage' as any, { roomCode: code, message: input.value.trim() });
        this.notifications.success('Message sent');
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
      this.notifications.error('Failed to fetch room data');
      return;
    }

    const room = rooms.find((r: any) => r.code === code);
    if (!room) {
      this.notifications.error('Room not found');
      return;
    }

    // We need more detail about players. For now, show a simple input for user ID.
    // The room list endpoint returns playerCount but not player details.
    // Let's ask for the player to kick by prompting.
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <h2 style="margin-bottom:12px;">Kick Player from Room ${this.escapeHtml(code)}</h2>
        <label style="color:var(--text-dim);font-size:13px;">Player User ID</label>
        <input type="number" class="admin-input" id="kick-user-id" placeholder="Enter user ID" style="margin-top:6px;">
        <label style="color:var(--text-dim);font-size:13px;margin-top:8px;display:block;">Reason (optional)</label>
        <input type="text" class="admin-input" id="kick-reason" placeholder="Reason..." style="margin-top:6px;">
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="kick-cancel">Cancel</button>
          <button class="btn-warn" style="padding:8px 16px;font-size:14px;" id="kick-confirm">Kick</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#kick-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#kick-confirm')!.addEventListener('click', () => {
      const userId = parseInt((modal.querySelector('#kick-user-id') as HTMLInputElement).value);
      const reason = (modal.querySelector('#kick-reason') as HTMLInputElement).value;
      if (!userId || isNaN(userId)) {
        this.notifications.error('Please enter a valid user ID');
        return;
      }
      modal.remove();
      this.socketClient.emit('admin:kick' as any, { roomCode: code, userId, reason }, (res: any) => {
        if (res.success) {
          this.notifications.success('Player kicked');
          this.loadRooms();
        } else {
          this.notifications.error(res.error || 'Failed to kick');
        }
      });
    });
  }

  private showCloseConfirmation(code: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:380px;">
        <h2 style="margin-bottom:12px;color:var(--danger);">Close Room</h2>
        <p style="color:var(--text-dim);">Are you sure you want to force-close room <strong style="color:var(--text);">${this.escapeHtml(code)}</strong>? All players will be removed.</p>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="close-cancel">Cancel</button>
          <button class="btn-danger" style="padding:8px 16px;font-size:14px;" id="close-confirm">Close Room</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#close-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#close-confirm')!.addEventListener('click', () => {
      modal.remove();
      this.socketClient.emit('admin:closeRoom' as any, { roomCode: code }, (res: any) => {
        if (res.success) {
          this.notifications.success('Room closed');
          this.loadRooms();
        } else {
          this.notifications.error(res.error || 'Failed to close room');
        }
      });
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
