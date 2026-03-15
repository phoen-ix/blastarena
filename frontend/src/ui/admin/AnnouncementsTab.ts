import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { UserRole } from '@blast-arena/shared';

export class AnnouncementsTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private role: UserRole;

  constructor(notifications: NotificationUI, role: UserRole) {
    this.notifications = notifications;
    this.role = role;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    await this.renderContent();
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
  }

  private async renderContent(): Promise<void> {
    if (!this.container) return;
    const isAdmin = this.role === 'admin';

    // Fetch current banner
    let currentBanner: any = null;
    try {
      currentBanner = await ApiClient.get<any>('/admin/announcements/banner');
    } catch {
      // No banner or not available
    }

    this.container.innerHTML = `
      <div class="admin-section">
        <h3>Broadcast Toast</h3>
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">Send an ephemeral notification to all connected players. It will disappear after a few seconds.</p>
        <div style="display:flex;gap:12px;align-items:center;">
          <input type="text" class="admin-input" id="toast-input" placeholder="Type toast message..." style="flex:1;min-width:0;">
          <button class="btn btn-primary" id="toast-send">Send Toast</button>
        </div>
        <div id="toast-preview-area"></div>
      </div>

      ${isAdmin ? `
        <div class="admin-section">
          <h3>Persistent Banner</h3>
          <p style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">Set a banner that appears at the top of the lobby for all users until you clear it.</p>
          ${currentBanner ? `
            <div style="margin-bottom:12px;">
              <label style="color:var(--text-dim);font-size:12px;">Current Banner:</label>
              <div class="admin-banner" style="margin-top:6px;">
                <span>${this.escapeHtml(currentBanner.message)}</span>
              </div>
              <button class="btn-danger btn-sm" id="banner-clear" style="margin-top:8px;">Clear Banner</button>
            </div>
          ` : '<p style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">No active banner.</p>'}
          <div style="display:flex;gap:12px;align-items:center;">
            <input type="text" class="admin-input" id="banner-input" placeholder="Type banner message..." style="flex:1;min-width:0;">
            <button class="btn btn-primary" id="banner-set">Set Banner</button>
          </div>
        </div>
      ` : ''}
    `;

    // Toast preview
    const toastInput = this.container.querySelector('#toast-input') as HTMLInputElement;
    const previewArea = this.container.querySelector('#toast-preview-area');
    if (toastInput && previewArea) {
      toastInput.addEventListener('input', () => {
        if (toastInput.value.trim()) {
          previewArea.innerHTML = `<div class="toast-preview">Preview: ${this.escapeHtml(toastInput.value)}</div>`;
        } else {
          previewArea.innerHTML = '';
        }
      });
    }

    // Toast send
    this.container.querySelector('#toast-send')?.addEventListener('click', async () => {
      const msg = toastInput.value.trim();
      if (!msg) {
        this.notifications.error('Message cannot be empty');
        return;
      }
      try {
        await ApiClient.post('/admin/announcements/toast', { message: msg });
        this.notifications.success('Toast broadcasted');
        toastInput.value = '';
        if (previewArea) previewArea.innerHTML = '';
      } catch (err: any) {
        this.notifications.error(err.message);
      }
    });

    // Banner set
    this.container.querySelector('#banner-set')?.addEventListener('click', async () => {
      const input = this.container!.querySelector('#banner-input') as HTMLInputElement;
      const msg = input.value.trim();
      if (!msg) {
        this.notifications.error('Banner message cannot be empty');
        return;
      }
      try {
        await ApiClient.post('/admin/announcements/banner', { message: msg });
        this.notifications.success('Banner set');
        await this.renderContent();
      } catch (err: any) {
        this.notifications.error(err.message);
      }
    });

    // Banner clear
    this.container.querySelector('#banner-clear')?.addEventListener('click', async () => {
      try {
        await ApiClient.delete('/admin/announcements/banner');
        this.notifications.success('Banner cleared');
        await this.renderContent();
      } catch (err: any) {
        this.notifications.error(err.message);
      }
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
