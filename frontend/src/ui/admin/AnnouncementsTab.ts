import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { UserRole, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml } from '../../utils/html';
import { t } from '../../i18n';

/** Active banner row returned by GET /admin/announcements/banner (null when no banner). */
interface ActiveBanner {
  id: number;
  message: string;
  admin_username: string;
  created_at: string;
}

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
    let currentBanner: ActiveBanner | null = null;
    try {
      currentBanner = await ApiClient.get<ActiveBanner | null>('/admin/announcements/banner');
    } catch {
      // No banner or not available
    }

    this.container.innerHTML = `
      <div class="admin-section">
        <h3>${t('admin:announcements.broadcastToastTitle')}</h3>
        <p style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">${t('admin:announcements.broadcastToastDescription')}</p>
        <div style="display:flex;gap:12px;align-items:center;">
          <input type="text" class="admin-input" id="toast-input" placeholder="${escapeHtml(t('admin:announcements.toastPlaceholder'))}" aria-label="${escapeHtml(t('admin:announcements.toastAriaLabel'))}" style="flex:1;min-width:0;">
          <button class="btn btn-primary" id="toast-send">${t('admin:announcements.sendToastBtn')}</button>
        </div>
        <div id="toast-preview-area"></div>
      </div>

      ${
        isAdmin
          ? `
        <div class="admin-section">
          <h3>${t('admin:announcements.persistentBannerTitle')}</h3>
          <p style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">${t('admin:announcements.persistentBannerDescription')}</p>
          ${
            currentBanner
              ? `
            <div style="margin-bottom:12px;">
              <label style="color:var(--text-dim);font-size:12px;">${t('admin:announcements.currentBannerLabel')}</label>
              <div class="admin-banner" style="margin-top:6px;">
                <span>${escapeHtml(currentBanner.message)}</span>
              </div>
              <button class="btn-danger btn-sm" id="banner-clear" style="margin-top:8px;">${t('admin:announcements.clearBannerBtn')}</button>
            </div>
          `
              : `<p style="color:var(--text-dim);font-size:13px;margin-bottom:12px;">${t('admin:announcements.noActiveBanner')}</p>`
          }
          <div style="display:flex;gap:12px;align-items:center;">
            <input type="text" class="admin-input" id="banner-input" placeholder="${escapeHtml(t('admin:announcements.bannerPlaceholder'))}" aria-label="${escapeHtml(t('admin:announcements.bannerAriaLabel'))}" style="flex:1;min-width:0;">
            <button class="btn btn-primary" id="banner-set">${t('admin:announcements.setBannerBtn')}</button>
          </div>
        </div>
      `
          : ''
      }
    `;

    // Toast preview
    const toastInput = this.container.querySelector('#toast-input') as HTMLInputElement;
    const previewArea = this.container.querySelector('#toast-preview-area');
    if (toastInput && previewArea) {
      toastInput.addEventListener('input', () => {
        if (toastInput.value.trim()) {
          previewArea.innerHTML = `<div class="toast-preview">${t('admin:announcements.toastPreview', { message: escapeHtml(toastInput.value) })}</div>`;
        } else {
          previewArea.innerHTML = '';
        }
      });
    }

    // Toast send
    this.container.querySelector('#toast-send')?.addEventListener('click', async () => {
      const msg = toastInput.value.trim();
      if (!msg) {
        this.notifications.error(t('admin:announcements.messageEmpty'));
        return;
      }
      try {
        await ApiClient.post('/admin/announcements/toast', { message: msg });
        this.notifications.success(t('admin:announcements.toastBroadcasted'));
        toastInput.value = '';
        if (previewArea) previewArea.innerHTML = '';
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });

    // Banner set
    this.container.querySelector('#banner-set')?.addEventListener('click', async () => {
      const input = this.container!.querySelector('#banner-input') as HTMLInputElement;
      const msg = input.value.trim();
      if (!msg) {
        this.notifications.error(t('admin:announcements.bannerMessageEmpty'));
        return;
      }
      try {
        await ApiClient.post('/admin/announcements/banner', { message: msg });
        this.notifications.success(t('admin:announcements.bannerSet'));
        await this.renderContent();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });

    // Banner clear
    this.container.querySelector('#banner-clear')?.addEventListener('click', async () => {
      try {
        await ApiClient.delete('/admin/announcements/banner');
        this.notifications.success(t('admin:announcements.bannerCleared'));
        await this.renderContent();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }
}
