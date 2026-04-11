import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { escapeHtml, trapFocus } from '../utils/html';
import {
  getErrorMessage,
  Cosmetic,
  CosmeticType,
  EquippedCosmetics,
  THEME_IDS,
  THEME_NAMES,
  BuddySettings,
} from '@blast-arena/shared';
import type { ThemeId } from '@blast-arena/shared';
import { getSettings, saveSettings, VisualSettings } from '../game/Settings';
import { i18n, t } from '../i18n';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { themeManager } from '../themes/ThemeManager';
import { THEME_DEFINITIONS } from '../themes/definitions';
import { PLAYER_COLORS } from '../scenes/BootScene';
import { drawPlayerSprite, drawBombSprite, getPlayerColorHex } from '../utils/playerCanvas';
import { audioManager } from '../game/AudioManager';

interface Tab {
  id: string;
  label: string;
}

export class SettingsUI {
  private container: HTMLElement;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onClose: () => void;
  private activeTabId: string;
  private contentEl: HTMLElement | null = null;
  private onLanguageChanged: () => void;
  private rendering = false;
  private delegationBound = false;
  private get tabs(): Tab[] {
    return [
      { id: 'account', label: t('settings.tabs.account') },
      { id: 'preferences', label: t('settings.tabs.preferences') },
      { id: 'privacy', label: t('settings.tabs.privacy') },
      { id: 'cosmetics', label: t('settings.tabs.cosmetics') },
    ];
  }

  constructor(
    authManager: AuthManager,
    notifications: NotificationUI,
    onClose: () => void,
    initialTab?: string,
  ) {
    this.authManager = authManager;
    this.notifications = notifications;
    this.onClose = onClose;
    this.container = document.createElement('div');
    this.container.className = 'admin-container';
    this.activeTabId =
      initialTab && this.tabs.some((tab) => tab.id === initialTab) ? initialTab : 'account';
    this.onLanguageChanged = () => this.render();
  }

  async show(): Promise<void> {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    window.addEventListener('language-changed', this.onLanguageChanged);
    await this.render();
    this.pushGamepadContext();
  }

  hide(): void {
    window.removeEventListener('language-changed', this.onLanguageChanged);
    UIGamepadNavigator.getInstance().popContext('settings-ui');
    this.container.remove();
  }

  private async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;

    try {
      // Bind event delegation once on the stable container element
      if (!this.delegationBound) {
        this.delegationBound = true;
        this.container.addEventListener('click', (e: Event) => {
          const target = e.target as HTMLElement;
          if (target.id === 'settings-ui-close' || target.closest('#settings-ui-close')) {
            this.hide();
            this.onClose();
            return;
          }
          const tabBtn = target.closest<HTMLElement>('[data-tab]');
          if (tabBtn?.dataset.tab && tabBtn.dataset.tab !== this.activeTabId) {
            this.switchTab(tabBtn.dataset.tab);
          }
        });
      }

      this.container.innerHTML = `
        <div class="admin-header">
          <h1>${t('settings.title')}</h1>
          <button class="btn btn-secondary" id="settings-ui-close">${t('settings.backToLobby')}</button>
        </div>
        <div class="admin-tabs" id="settings-tab-bar">
          ${this.tabs
            .map(
              (tab) => `
            <button class="admin-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>
          `,
            )
            .join('')}
        </div>
        <div class="admin-tab-content" id="settings-tab-content"></div>
      `;

      this.contentEl = this.container.querySelector('#settings-tab-content');
      await this.renderActiveTab();
    } finally {
      this.rendering = false;
    }
  }

  private async switchTab(tabId: string): Promise<void> {
    this.activeTabId = tabId;

    const tabBar = this.container.querySelector('#settings-tab-bar');
    if (tabBar) {
      tabBar.querySelectorAll('.admin-tab').forEach((btn) => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tabId);
      });
    }

    if (this.contentEl) {
      this.contentEl.innerHTML = '';
    }
    await this.renderActiveTab();
    this.pushGamepadContext();
  }

  private async renderActiveTab(): Promise<void> {
    if (!this.contentEl) return;

    switch (this.activeTabId) {
      case 'account':
        await this.renderAccountTab();
        break;
      case 'preferences':
        this.renderPreferencesTab();
        break;
      case 'privacy':
        await this.renderPrivacyTab();
        break;
      case 'cosmetics':
        await this.renderCosmeticsTab();
        break;
    }
  }

  private async renderAccountTab(): Promise<void> {
    if (!this.contentEl) return;

    let profile: any;
    try {
      profile = await ApiClient.get('/user/profile');
    } catch (err: unknown) {
      this.contentEl.innerHTML = `<div class="error-banner">${t('settings.loadProfileFailed', { error: escapeHtml(getErrorMessage(err)) })}</div>`;
      return;
    }

    const user = this.authManager.getUser();
    const isAdmin = user?.role === 'admin';

    this.contentEl.innerHTML = `
      <div class="settings-panel">
        <div class="content-section">
          <h3 class="settings-section-title">${t('settings.account.profile')}</h3>
          <div class="form-group">
            <label>${t('settings.account.username')}</label>
            <input type="text" class="input" id="acct-username" value="${escapeHtml(profile.username)}" maxlength="20">
            <div class="settings-hint">${t('settings.account.usernameHint')}</div>
          </div>
          <div id="acct-profile-status" class="settings-status"></div>
          <button class="btn btn-primary" id="acct-save-profile">${t('settings.account.saveUsername')}</button>
        </div>

        <hr class="settings-separator">

        <div class="content-section">
          <h3 class="settings-section-title">${t('settings.account.email')}</h3>
          <div class="settings-current-value">
            ${t('settings.account.current')} <strong>${escapeHtml(profile.emailHint)}</strong>
            ${profile.emailVerified ? `<span class="text-success ml-1">${t('settings.account.verified')}</span>` : `<span class="text-warning ml-1">${t('settings.account.unverified')}</span>`}
          </div>
          ${
            !isAdmin && profile.pendingEmailHint
              ? `
            <div class="settings-pending-banner">
              ${t('settings.account.pendingChange')} <strong>${escapeHtml(profile.pendingEmailHint)}</strong> — ${t('settings.account.pendingHint')}
              <button class="btn btn-secondary btn-sm ml-2" id="acct-cancel-email">${t('settings.account.deleteModal.cancel')}</button>
            </div>
          `
              : ''
          }
          <div class="form-group">
            <input type="email" class="input" id="acct-new-email" placeholder="${t('settings.account.newEmailPlaceholder')}" maxlength="255" aria-label="${t('settings.account.newEmailPlaceholder')}">
          </div>
          <div id="acct-email-status" class="settings-status"></div>
          <button class="btn btn-primary" id="acct-change-email">${isAdmin ? t('settings.account.changeEmail') : t('settings.account.sendConfirmation')}</button>
        </div>

        <hr class="settings-separator">

        <div class="content-section">
          <h3 class="settings-section-title">${t('settings.account.changePassword')}</h3>
          <div class="form-group settings-field-stack">
            <input type="password" class="input" id="acct-current-password" placeholder="${t('settings.account.currentPassword')}" autocomplete="current-password" aria-label="${t('settings.account.currentPassword')}">
            <input type="password" class="input" id="acct-new-password" placeholder="${t('settings.account.newPassword')}" autocomplete="new-password" aria-label="${t('settings.account.newPassword')}">
            <input type="password" class="input" id="acct-confirm-password" placeholder="${t('settings.account.confirmPassword')}" autocomplete="new-password" aria-label="${t('settings.account.confirmPassword')}">
          </div>
          <div id="acct-password-status" class="settings-status"></div>
          <button class="btn btn-primary" id="acct-change-password">${t('settings.account.changePassword')}</button>
        </div>

        <hr class="settings-separator">

        <div class="content-section">
          <h3 class="settings-section-title">${t('settings.account.twoFactor.title')}</h3>
          ${
            profile.twoFactorEnabled
              ? `
            <p class="settings-hint" style="color:var(--success);margin-bottom:var(--sp-3);">${t('settings.account.twoFactor.enabled')}</p>
            <button class="btn btn-secondary" id="acct-disable-2fa">${t('settings.account.twoFactor.disable')}</button>
          `
              : `
            <p class="settings-hint" style="margin-bottom:var(--sp-3);">${t('settings.account.twoFactor.description')}</p>
            <button class="btn btn-primary" id="acct-enable-2fa">${t('settings.account.twoFactor.enable')}</button>
          `
          }
          <div id="acct-2fa-status" class="settings-status"></div>
        </div>

        ${
          !isAdmin
            ? `
        <hr class="settings-separator">

        <div class="content-section">
          <h3 class="settings-section-title" style="color:var(--danger);">${t('settings.account.dangerZone')}</h3>
          <p class="settings-hint" style="margin-bottom:var(--sp-3);">${t('settings.account.deleteWarning')}</p>
          <button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--danger);" id="acct-delete-account">${t('settings.account.deleteAccount')}</button>
        </div>
        `
            : ''
        }
      </div>
    `;

    // Save username
    this.contentEl.querySelector('#acct-save-profile')!.addEventListener('click', async () => {
      const statusEl = this.contentEl!.querySelector('#acct-profile-status')!;
      const newUsername = (
        this.contentEl!.querySelector('#acct-username') as HTMLInputElement
      ).value.trim();

      if (!newUsername) {
        statusEl.innerHTML = `<span class="text-danger">${t('settings.account.usernameEmpty')}</span>`;
        return;
      }

      const updates: any = {};
      if (newUsername !== profile.username) updates.username = newUsername;

      if (Object.keys(updates).length === 0) {
        statusEl.innerHTML = `<span class="text-dim">${t('settings.account.noChanges')}</span>`;
        return;
      }

      try {
        const updated: any = await ApiClient.put('/user/profile', updates);
        profile = updated;
        this.authManager.updateUser({ username: updated.username });
        statusEl.innerHTML = `<span class="text-success">${t('settings.account.profileUpdated')}</span>`;
      } catch (err: unknown) {
        statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    // Change email
    this.contentEl.querySelector('#acct-change-email')!.addEventListener('click', async () => {
      const statusEl = this.contentEl!.querySelector('#acct-email-status')!;
      const newEmail = (
        this.contentEl!.querySelector('#acct-new-email') as HTMLInputElement
      ).value.trim();

      if (!newEmail) {
        statusEl.innerHTML = `<span class="text-danger">${t('settings.account.emailEmpty')}</span>`;
        return;
      }

      try {
        const result: any = await ApiClient.post('/user/email', { email: newEmail });
        statusEl.innerHTML = `<span class="text-success">${escapeHtml(result.message)}</span>`;
        (this.contentEl!.querySelector('#acct-new-email') as HTMLInputElement).value = '';
      } catch (err: unknown) {
        statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    // Change password
    this.contentEl.querySelector('#acct-change-password')!.addEventListener('click', async () => {
      const statusEl = this.contentEl!.querySelector('#acct-password-status')!;
      const currentPassword = (
        this.contentEl!.querySelector('#acct-current-password') as HTMLInputElement
      ).value;
      const newPassword = (this.contentEl!.querySelector('#acct-new-password') as HTMLInputElement)
        .value;
      const confirmPassword = (
        this.contentEl!.querySelector('#acct-confirm-password') as HTMLInputElement
      ).value;

      if (!currentPassword || !newPassword) {
        statusEl.innerHTML = `<span class="text-danger">${t('settings.account.passwordFieldsRequired')}</span>`;
        return;
      }
      if (newPassword.length < 8) {
        statusEl.innerHTML = `<span class="text-danger">${t('settings.account.passwordTooShort')}</span>`;
        return;
      }
      if (newPassword !== confirmPassword) {
        statusEl.innerHTML = `<span class="text-danger">${t('settings.account.passwordMismatch')}</span>`;
        return;
      }

      try {
        const result: any = await ApiClient.post('/user/password', {
          currentPassword,
          newPassword,
        });
        statusEl.innerHTML = `<span class="text-success">${escapeHtml(result.message)}</span>`;
        (this.contentEl!.querySelector('#acct-current-password') as HTMLInputElement).value = '';
        (this.contentEl!.querySelector('#acct-new-password') as HTMLInputElement).value = '';
        (this.contentEl!.querySelector('#acct-confirm-password') as HTMLInputElement).value = '';
      } catch (err: unknown) {
        statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    // Cancel pending email
    const cancelEmailBtn = this.contentEl.querySelector('#acct-cancel-email');
    if (cancelEmailBtn) {
      cancelEmailBtn.addEventListener('click', async () => {
        try {
          await ApiClient.delete('/user/email');
          this.notifications.success(t('settings.account.pendingCancelled'));
          if (this.contentEl) {
            this.contentEl.innerHTML = '';
            await this.renderAccountTab();
          }
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    }

    // Enable 2FA
    const enable2faBtn = this.contentEl.querySelector('#acct-enable-2fa');
    if (enable2faBtn) {
      enable2faBtn.addEventListener('click', () => this.showSetup2FAModal());
    }

    // Disable 2FA
    const disable2faBtn = this.contentEl.querySelector('#acct-disable-2fa');
    if (disable2faBtn) {
      disable2faBtn.addEventListener('click', () => this.showDisable2FAModal());
    }

    // Delete account
    const deleteBtn = this.contentEl.querySelector('#acct-delete-account');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.showDeleteAccountModal());
    }
  }

  private async showSetup2FAModal(): Promise<void> {
    let setupData: { qrDataUri: string; secret: string; backupCodes: string[] };
    try {
      setupData = await ApiClient.post('/user/totp/setup');
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('settings.account.twoFactor.setupTitle'));
    modal.innerHTML = `
      <div class="modal" style="max-width:480px;">
        <h2>${t('settings.account.twoFactor.setupTitle')}</h2>

        <p style="margin:var(--sp-2) 0;color:var(--text-dim);">${t('settings.account.twoFactor.scanQr')}</p>
        <div style="text-align:center;margin:var(--sp-3) 0;">
          <img src="${setupData.qrDataUri}" alt="TOTP QR Code" style="width:200px;height:200px;image-rendering:pixelated;border-radius:var(--radius);background:#fff;padding:8px;">
        </div>

        <p style="margin:var(--sp-2) 0;color:var(--text-dim);">${t('settings.account.twoFactor.manualEntry')}</p>
        <div style="display:flex;gap:var(--sp-2);align-items:center;margin-bottom:var(--sp-3);">
          <code style="flex:1;padding:var(--sp-2);background:var(--bg-inset);border-radius:var(--radius);font-size:14px;letter-spacing:2px;word-break:break-all;user-select:all;">${setupData.secret}</code>
          <button class="btn btn-secondary btn-sm" id="totp-copy-secret">${t('settings.account.twoFactor.copy')}</button>
        </div>

        <details style="margin-bottom:var(--sp-3);">
          <summary style="cursor:pointer;color:var(--text-dim);font-size:13px;">${t('settings.account.twoFactor.backupTitle')}</summary>
          <p style="margin:var(--sp-1) 0;color:var(--text-dim);font-size:13px;">${t('settings.account.twoFactor.backupDescription')}</p>
          <pre style="padding:var(--sp-2);background:var(--bg-inset);border-radius:var(--radius);font-size:13px;user-select:all;">${setupData.backupCodes.join('\n')}</pre>
        </details>

        <p style="margin:var(--sp-2) 0;color:var(--text-dim);">${t('settings.account.twoFactor.confirmCode')}</p>
        <div class="form-group">
          <input type="text" class="input" id="totp-confirm-code" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        </div>
        <div id="totp-setup-status" class="settings-status" style="margin-bottom:var(--sp-2);"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="totp-setup-cancel">${t('settings.account.twoFactor.cancel')}</button>
          <button class="btn btn-primary" id="totp-setup-confirm">${t('settings.account.twoFactor.confirm')}</button>
        </div>
      </div>
    `;

    const releaseFocusTrap = trapFocus(modal);
    const closeModal = () => {
      releaseFocusTrap();
      document.removeEventListener('keydown', escHandler);
      modal.remove();
    };
    modal.querySelector('#totp-setup-cancel')!.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    modal.querySelector('#totp-copy-secret')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(setupData.secret);
        const btn = modal.querySelector('#totp-copy-secret') as HTMLButtonElement;
        btn.textContent = t('settings.account.twoFactor.copied');
        setTimeout(() => {
          btn.textContent = t('settings.account.twoFactor.copy');
        }, 2000);
      } catch {
        /* clipboard not available */
      }
    });

    modal.querySelector('#totp-setup-confirm')!.addEventListener('click', async () => {
      const code = (modal.querySelector('#totp-confirm-code') as HTMLInputElement).value.trim();
      const statusEl = modal.querySelector('#totp-setup-status')!;
      if (!code || code.length < 6) {
        statusEl.innerHTML = `<span class="text-danger">${t('auth:totp.invalidCode')}</span>`;
        return;
      }
      const btn = modal.querySelector('#totp-setup-confirm') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = t('settings.account.twoFactor.confirming');
      try {
        await ApiClient.post('/user/totp/confirm', { code });
        closeModal();
        this.notifications.success(t('settings.account.twoFactor.enableSuccess'));
        if (this.contentEl) {
          this.contentEl.innerHTML = '';
          await this.renderAccountTab();
        }
      } catch (err: unknown) {
        btn.disabled = false;
        btn.textContent = t('settings.account.twoFactor.confirm');
        statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    modal.querySelector('#totp-confirm-code')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        (modal.querySelector('#totp-setup-confirm') as HTMLButtonElement).click();
      }
    });

    document.getElementById('ui-overlay')!.appendChild(modal);
    (modal.querySelector('#totp-confirm-code') as HTMLInputElement).focus();
  }

  private showDisable2FAModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('settings.account.twoFactor.disableTitle'));
    modal.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <h2>${t('settings.account.twoFactor.disableTitle')}</h2>
        <p style="margin:var(--sp-3) 0;color:var(--text-dim);">${t('settings.account.twoFactor.disableDescription')}</p>
        <div class="form-group settings-field-stack">
          <input type="password" class="input" id="disable-2fa-password" placeholder="${t('settings.account.twoFactor.disablePassword')}" autocomplete="current-password">
          <input type="text" class="input" id="disable-2fa-code" placeholder="${t('settings.account.twoFactor.disableCode')}" inputmode="numeric" autocomplete="one-time-code" maxlength="10">
        </div>
        <div id="disable-2fa-status" class="settings-status" style="margin-bottom:var(--sp-2);"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="disable-2fa-cancel">${t('settings.account.twoFactor.cancel')}</button>
          <button class="btn" style="background:var(--danger);color:#fff;" id="disable-2fa-confirm">${t('settings.account.twoFactor.disableConfirm')}</button>
        </div>
      </div>
    `;

    const releaseFocusTrap = trapFocus(modal);
    const closeModal = () => {
      releaseFocusTrap();
      document.removeEventListener('keydown', escHandler);
      modal.remove();
    };
    modal.querySelector('#disable-2fa-cancel')!.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    modal.querySelector('#disable-2fa-confirm')!.addEventListener('click', async () => {
      const password = (modal.querySelector('#disable-2fa-password') as HTMLInputElement).value;
      const code = (modal.querySelector('#disable-2fa-code') as HTMLInputElement).value.trim();
      const statusEl = modal.querySelector('#disable-2fa-status')!;
      if (!password || !code) {
        statusEl.innerHTML = `<span class="text-danger">${t('settings.account.passwordFieldsRequired')}</span>`;
        return;
      }
      const btn = modal.querySelector('#disable-2fa-confirm') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = t('settings.account.twoFactor.disabling');
      try {
        await ApiClient.post('/user/totp/disable', { password, code });
        closeModal();
        this.notifications.success(t('settings.account.twoFactor.disableSuccess'));
        if (this.contentEl) {
          this.contentEl.innerHTML = '';
          await this.renderAccountTab();
        }
      } catch (err: unknown) {
        btn.disabled = false;
        btn.textContent = t('settings.account.twoFactor.disableConfirm');
        statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    document.getElementById('ui-overlay')!.appendChild(modal);
    (modal.querySelector('#disable-2fa-password') as HTMLInputElement).focus();
  }

  private showDeleteAccountModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('settings.account.deleteModal.title'));
    modal.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <h2 style="color:var(--danger);">${t('settings.account.deleteModal.title')}</h2>
        <p style="margin:var(--sp-3) 0;color:var(--text-dim);">${t('settings.account.deleteModal.description')}</p>
        <div class="form-group">
          <label for="delete-password">${t('settings.account.deleteModal.passwordLabel')}</label>
          <input type="password" class="input" id="delete-password" placeholder="${t('settings.account.deleteModal.passwordPlaceholder')}" autocomplete="current-password">
        </div>
        <div id="delete-status" class="settings-status" style="margin-bottom:var(--sp-2);"></div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="delete-cancel">${t('settings.account.deleteModal.cancel')}</button>
          <button class="btn" style="background:var(--danger);color:#fff;" id="delete-confirm">${t('settings.account.deleteModal.confirm')}</button>
        </div>
      </div>
    `;

    const releaseFocusTrap = trapFocus(modal);
    const closeModal = () => {
      releaseFocusTrap();
      document.removeEventListener('keydown', escHandler);
      modal.remove();
    };
    modal.querySelector('#delete-cancel')!.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);

    modal.querySelector('#delete-confirm')!.addEventListener('click', async () => {
      const password = (modal.querySelector('#delete-password') as HTMLInputElement).value;
      const statusEl = modal.querySelector('#delete-status')!;
      if (!password) {
        statusEl.innerHTML = `<span class="text-danger">${t('settings.account.deleteModal.passwordRequired')}</span>`;
        return;
      }
      const btn = modal.querySelector('#delete-confirm') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = t('settings.account.deleteModal.deleting');
      try {
        await ApiClient.delete('/user/account', { password });
        closeModal();
        this.authManager.logout();
      } catch (err: unknown) {
        btn.disabled = false;
        btn.textContent = t('settings.account.deleteModal.confirm');
        statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    document.getElementById('ui-overlay')!.appendChild(modal);
    (modal.querySelector('#delete-password') as HTMLInputElement).focus();
  }

  private renderPreferencesTab(): void {
    if (!this.contentEl) return;
    const settings = getSettings();
    const currentTheme = themeManager.getTheme();

    this.contentEl.innerHTML = `
      <div class="settings-panel wide">
        <h3 class="content-section-title">${t('settings.theme')}</h3>
        <div class="theme-picker" id="theme-picker">
          ${THEME_IDS.map((id) => {
            const def = THEME_DEFINITIONS[id];
            return `
              <button class="theme-swatch ${id === currentTheme ? 'active' : ''}" data-theme="${id}">
                <div class="theme-swatch-colors">
                  <div class="theme-swatch-dot" style="background:${def.css.primary}"></div>
                  <div class="theme-swatch-dot" style="background:${def.css.accent}"></div>
                  <div class="theme-swatch-dot" style="background:${def.css.bgSurface}"></div>
                </div>
                <div class="theme-swatch-name">${THEME_NAMES[id]}</div>
              </button>
            `;
          }).join('')}
        </div>

        <h3 class="content-section-title mt-6">${t('settings.language')}</h3>
        <div class="settings-toggle-list">
          <div class="setting-row">
            <select class="select" id="pref-language" style="width:180px;">
              <option value="en" ${i18n.language === 'en' ? 'selected' : ''}>English</option>
              <option value="de" ${i18n.language === 'de' ? 'selected' : ''}>Deutsch</option>
              <option value="fr" ${i18n.language === 'fr' ? 'selected' : ''}>Français</option>
              <option value="es" ${i18n.language === 'es' ? 'selected' : ''}>Español</option>
              <option value="it" ${i18n.language === 'it' ? 'selected' : ''}>Italiano</option>
              <option value="pt" ${i18n.language === 'pt' ? 'selected' : ''}>Português</option>
              <option value="pl" ${i18n.language === 'pl' ? 'selected' : ''}>Polski</option>
              <option value="nl" ${i18n.language === 'nl' ? 'selected' : ''}>Nederlands</option>
              <option value="tr" ${i18n.language === 'tr' ? 'selected' : ''}>Türkçe</option>
              <option value="sv" ${i18n.language === 'sv' ? 'selected' : ''}>Svenska</option>
              <option value="nb" ${i18n.language === 'nb' ? 'selected' : ''}>Norsk</option>
              <option value="da" ${i18n.language === 'da' ? 'selected' : ''}>Dansk</option>
            </select>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.languageDesc')}</div>
            </div>
          </div>
        </div>

        <h3 class="content-section-title mt-6">${t('settings.visualSettings')}</h3>
        <div class="settings-toggle-list">
          <div class="setting-row">
            <label class="toggle-switch">
              <input type="checkbox" name="animations" role="switch" aria-checked="${settings.animations ? 'true' : 'false'}" ${settings.animations ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.animations')}</div>
              <div class="setting-row-desc">${t('settings.animationsDesc')}</div>
            </div>
          </div>
          <div class="setting-row">
            <label class="toggle-switch">
              <input type="checkbox" name="screenShake" role="switch" aria-checked="${settings.screenShake ? 'true' : 'false'}" ${settings.screenShake ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.screenShake')}</div>
              <div class="setting-row-desc">${t('settings.screenShakeDesc')}</div>
            </div>
          </div>
          <div class="setting-row">
            <label class="toggle-switch">
              <input type="checkbox" name="particles" role="switch" aria-checked="${settings.particles ? 'true' : 'false'}" ${settings.particles ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.particles')}</div>
              <div class="setting-row-desc">${t('settings.particlesDesc')}</div>
            </div>
          </div>
          <div class="setting-row">
            <label class="toggle-switch">
              <input type="checkbox" name="minimap" role="switch" aria-checked="${settings.minimap ? 'true' : 'false'}" ${settings.minimap ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.minimap')}</div>
              <div class="setting-row-desc">${t('settings.minimapDesc')}</div>
            </div>
          </div>
          <div class="setting-row">
            <label class="toggle-switch">
              <input type="checkbox" name="sound" role="switch" aria-checked="${settings.sound ? 'true' : 'false'}" ${settings.sound ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.sound')}</div>
              <div class="setting-row-desc">${t('settings.soundDesc')}</div>
            </div>
          </div>
        </div>

        <h3 class="content-section-title mt-6">${t('settings.audio')}</h3>
        <div class="settings-toggle-list">
          <div class="setting-row">
            <label class="toggle-switch">
              <input type="checkbox" id="audio-mute" role="switch" aria-checked="${audioManager.isMuted() ? 'true' : 'false'}" ${audioManager.isMuted() ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.mute')}</div>
              <div class="setting-row-desc">${t('settings.muteDesc')}</div>
            </div>
          </div>
          <div class="setting-row">
            <input type="range" id="audio-master" min="0" max="100" step="5" value="${Math.round(audioManager.getMasterVolume() * 100)}" style="width:120px;accent-color:var(--primary);">
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.masterVolume')}</div>
            </div>
          </div>
          <div class="setting-row">
            <input type="range" id="audio-sfx" min="0" max="100" step="5" value="${Math.round(audioManager.getSfxVolume() * 100)}" style="width:120px;accent-color:var(--primary);">
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.sfxVolume')}</div>
            </div>
          </div>
        </div>

        <h3 class="content-section-title mt-6">${t('settings.chat')}</h3>
        <div class="settings-toggle-list">
          <div class="setting-row">
            <label class="toggle-switch">
              <input type="checkbox" name="lobbyChat" role="switch" aria-checked="${settings.lobbyChat ? 'true' : 'false'}" ${settings.lobbyChat ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
            <div class="setting-row-info">
              <div class="setting-row-label">${t('settings.lobbyChat')}</div>
              <div class="setting-row-desc">${t('settings.lobbyChatDesc')}</div>
            </div>
          </div>
        </div>

        <h3 class="content-section-title mt-6">${t('settings.buddyMode')}</h3>
        <div id="buddy-settings-section" style="display:flex;flex-direction:column;gap:14px;">
          <div class="form-group">
            <label style="font-size:13px;color:var(--text-dim);display:block;margin-bottom:4px;">${t('settings.buddyName')}</label>
            <input class="input" type="text" id="buddy-name-input" maxlength="20" placeholder="Buddy" style="width:100%;max-width:260px;">
          </div>
          <div class="form-group">
            <label style="font-size:13px;color:var(--text-dim);display:block;margin-bottom:4px;">${t('settings.buddyColor')}</label>
            <div id="buddy-color-swatches" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
          </div>
          <div class="form-group">
            <label id="buddy-size-label" style="font-size:13px;color:var(--text-dim);display:block;margin-bottom:4px;">${t('settings.buddySize', { percent: '60' })}</label>
            <input type="range" id="buddy-size-slider" min="40" max="80" step="5" value="60" style="width:100%;max-width:260px;accent-color:var(--primary);">
          </div>
          <div>
            <button class="btn btn-primary btn-sm" id="buddy-save-btn">${t('settings.buddySave')}</button>
            <span id="buddy-save-status" style="font-size:13px;color:var(--success);margin-left:8px;display:none;">${t('settings.buddySaved')}</span>
          </div>
        </div>
      </div>
    `;

    // Load and populate buddy settings
    this.loadBuddySettings();

    // Theme picker clicks
    this.contentEl.querySelector('#theme-picker')!.addEventListener('click', (e: Event) => {
      const btn = (e.target as HTMLElement).closest('.theme-swatch') as HTMLElement;
      if (!btn) return;
      const id = btn.dataset.theme as ThemeId;
      if (!id) return;
      themeManager.setTheme(id);
      // Update active states
      this.contentEl!.querySelectorAll('.theme-swatch').forEach((s) =>
        s.classList.remove('active'),
      );
      btn.classList.add('active');
    });

    // Language selector
    const langSelect = this.contentEl.querySelector('#pref-language') as HTMLSelectElement;
    if (langSelect) {
      langSelect.addEventListener('change', () => {
        const lang = langSelect.value;
        i18n.changeLanguage(lang);
        // Persist to DB for logged-in users
        ApiClient.put('/user/language', { language: lang }).catch(() => {});
      });
    }

    // Visual settings checkboxes
    this.contentEl.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target || target.type !== 'checkbox') return;
      const key = target.name as keyof VisualSettings;
      if (!(key in getSettings())) return;
      const current = getSettings();
      (current as any)[key] = target.checked;
      if (target.hasAttribute('role') && target.getAttribute('role') === 'switch') {
        target.setAttribute('aria-checked', String(target.checked));
      }
      saveSettings(current);
      if (key === 'lobbyChat') {
        window.dispatchEvent(new CustomEvent('lobbychat-toggle'));
      }
    });

    // Audio controls
    const muteCheckbox = this.contentEl.querySelector('#audio-mute') as HTMLInputElement;
    if (muteCheckbox) {
      muteCheckbox.addEventListener('change', () => {
        audioManager.setMuted(muteCheckbox.checked);
        muteCheckbox.setAttribute('aria-checked', String(muteCheckbox.checked));
      });
    }
    const masterSlider = this.contentEl.querySelector('#audio-master') as HTMLInputElement;
    if (masterSlider) {
      masterSlider.addEventListener('input', () => {
        audioManager.setMasterVolume(parseInt(masterSlider.value) / 100);
      });
    }
    const sfxSlider = this.contentEl.querySelector('#audio-sfx') as HTMLInputElement;
    if (sfxSlider) {
      sfxSlider.addEventListener('input', () => {
        audioManager.setSfxVolume(parseInt(sfxSlider.value) / 100);
      });
    }
  }

  private async loadBuddySettings(): Promise<void> {
    if (!this.contentEl) return;

    let settings: BuddySettings;
    try {
      settings = await ApiClient.get<BuddySettings>('/user/buddy-settings');
    } catch {
      settings = { name: 'Buddy', color: '#44aaff', size: 0.6 };
    }

    const nameInput = this.contentEl.querySelector('#buddy-name-input') as HTMLInputElement;
    const sizeSlider = this.contentEl.querySelector('#buddy-size-slider') as HTMLInputElement;
    const sizeLabel = this.contentEl.querySelector('#buddy-size-label') as HTMLElement;
    const swatchContainer = this.contentEl.querySelector('#buddy-color-swatches') as HTMLElement;
    const saveBtn = this.contentEl.querySelector('#buddy-save-btn') as HTMLButtonElement;
    const saveStatus = this.contentEl.querySelector('#buddy-save-status') as HTMLElement;

    if (!nameInput || !sizeSlider || !swatchContainer || !saveBtn) return;

    nameInput.value = settings.name;
    sizeSlider.value = String(Math.round(settings.size * 100));
    if (sizeLabel)
      sizeLabel.textContent = t('settings.buddySize', {
        percent: String(Math.round(settings.size * 100)),
      });

    let selectedColor = settings.color;

    // Build color swatches
    const buildSwatches = () => {
      swatchContainer.innerHTML = '';
      for (const color of PLAYER_COLORS) {
        const hex = '#' + color.toString(16).padStart(6, '0');
        const swatch = document.createElement('div');
        swatch.style.cssText = `
          width:32px;height:32px;border-radius:50%;cursor:pointer;
          background:${hex};
          border:3px solid ${selectedColor === hex ? 'var(--text)' : 'transparent'};
          box-shadow:${selectedColor === hex ? '0 0 0 2px var(--primary)' : 'none'};
          transition:border-color 0.15s,box-shadow 0.15s;
        `;
        swatch.addEventListener('click', () => {
          selectedColor = hex;
          buildSwatches();
        });
        swatchContainer.appendChild(swatch);
      }
    };
    buildSwatches();

    sizeSlider.addEventListener('input', () => {
      if (sizeLabel) sizeLabel.textContent = t('settings.buddySize', { percent: sizeSlider.value });
    });

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        await ApiClient.put('/user/buddy-settings', {
          name: nameInput.value || 'Buddy',
          color: selectedColor,
          size: parseInt(sizeSlider.value, 10) / 100,
        });
        if (saveStatus) {
          saveStatus.style.display = 'inline';
          setTimeout(() => {
            saveStatus.style.display = 'none';
          }, 2000);
        }
      } catch (err: unknown) {
        this.notifications.error(t('settings.buddySaveFailed', { error: getErrorMessage(err) }));
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  private async renderPrivacyTab(): Promise<void> {
    if (!this.contentEl) return;

    let profile: any;
    try {
      profile = await ApiClient.get('/user/profile');
    } catch (err: unknown) {
      this.contentEl.innerHTML = `<div class="error-banner">${t('settings.loadProfileFailed', { error: escapeHtml(getErrorMessage(err)) })}</div>`;
      return;
    }

    this.contentEl.innerHTML = `
      <div class="settings-panel">
        <h3 class="settings-section-title">${t('settings.privacy.settingsTitle')}</h3>
        <div class="settings-toggle-list">
          <label class="privacy-option">
            <input type="checkbox" id="privacy-public-profile" ${profile.isProfilePublic ? 'checked' : ''}>
            <div>
              <div class="privacy-option-label">${t('settings.privacy.publicProfile')}</div>
              <div class="privacy-option-desc">${t('settings.privacy.publicProfileDesc')}</div>
            </div>
          </label>
          <label class="privacy-option">
            <input type="checkbox" id="privacy-accept-friends" ${profile.acceptFriendRequests ? 'checked' : ''}>
            <div>
              <div class="privacy-option-label">${t('settings.privacy.acceptRequests')}</div>
              <div class="privacy-option-desc">${t('settings.privacy.acceptRequestsDesc')}</div>
            </div>
          </label>
        </div>
        <div id="privacy-status" class="settings-status mt-3"></div>
      </div>
    `;

    const savePrivacy = async (field: string, value: boolean) => {
      const statusEl = this.contentEl!.querySelector('#privacy-status')!;
      try {
        await ApiClient.put('/user/privacy', { [field]: value });
        statusEl.innerHTML = `<span class="text-success">${t('settings.privacy.saved')}</span>`;
        setTimeout(() => {
          statusEl.innerHTML = '';
        }, 2000);
      } catch (err: unknown) {
        statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    };

    this.contentEl.querySelector('#privacy-public-profile')!.addEventListener('change', (e) => {
      savePrivacy('isProfilePublic', (e.target as HTMLInputElement).checked);
    });
    this.contentEl.querySelector('#privacy-accept-friends')!.addEventListener('change', (e) => {
      savePrivacy('acceptFriendRequests', (e.target as HTMLInputElement).checked);
    });
  }

  private async renderCosmeticsTab(): Promise<void> {
    if (!this.contentEl) return;

    let allCosmetics: Cosmetic[] = [];
    let myCosmetics: Cosmetic[] = [];
    let equipped: EquippedCosmetics = {
      colorId: null,
      eyesId: null,
      trailId: null,
      bombSkinId: null,
    };

    try {
      const [allResp, mineResp, equippedResp] = await Promise.all([
        ApiClient.get<{ cosmetics: Cosmetic[] }>('/cosmetics'),
        ApiClient.get<{ cosmetics: Cosmetic[] }>('/cosmetics/mine'),
        ApiClient.get<EquippedCosmetics>('/cosmetics/equipped'),
      ]);
      allCosmetics = allResp.cosmetics;
      myCosmetics = mineResp.cosmetics;
      equipped = equippedResp;
    } catch (err: unknown) {
      this.contentEl.innerHTML = `<div class="error-banner">${t('settings.cosmetics.loadFailed', { error: escapeHtml(getErrorMessage(err)) })}</div>`;
      return;
    }

    const ownedIds = new Set(myCosmetics.map((c) => c.id));
    const slots: { key: keyof EquippedCosmetics; type: CosmeticType; label: string }[] = [
      { key: 'colorId', type: 'color', label: t('settings.cosmetics.playerColor') },
      { key: 'eyesId', type: 'eyes', label: t('settings.cosmetics.eyeStyle') },
      { key: 'trailId', type: 'trail', label: t('settings.cosmetics.movementTrail') },
      { key: 'bombSkinId', type: 'bomb_skin', label: t('settings.cosmetics.bombSkin') },
    ];

    const renderSlot = (slot: (typeof slots)[0]) => {
      const items = allCosmetics.filter((c) => c.type === slot.type);
      const equippedId = equipped[slot.key];

      return `
        <div class="cosmetic-slot">
          <h4 class="cosmetic-slot-title">${slot.label}</h4>
          <div class="cosmetic-grid">
            <button class="cosmetic-item ${equippedId === null ? 'equipped' : ''}" data-slot="${slot.type}" data-cosmetic-id="null">
              ${t('settings.cosmetics.none')}
            </button>
            ${items
              .map((c) => {
                const owned = ownedIds.has(c.id);
                const isEquipped = equippedId === c.id;
                const preview =
                  c.type === 'color' && c.config.hex
                    ? `<span class="cosmetic-color-dot" style="background:${typeof c.config.hex === 'string' ? '#' + (c.config.hex as string).replace('0x', '') : '#fff'}"></span>`
                    : '';
                return `
                  <button class="cosmetic-item ${isEquipped ? 'equipped' : ''}" data-slot="${slot.type}" data-cosmetic-id="${c.id}"
                    ${!owned ? 'disabled' : ''}>
                    ${preview}${escapeHtml(c.name)}
                    ${!owned ? `<span class="locked-label">${t('settings.cosmetics.locked')}</span>` : ''}
                  </button>`;
              })
              .join('')}
          </div>
        </div>
      `;
    };

    this.contentEl.innerHTML = `
      <div class="settings-panel wide">
        <h3 class="settings-section-title">${t('settings.cosmetics.title')}</h3>
        <div class="cosmetic-preview">
          <div class="cosmetic-preview-item">
            <canvas id="cosmetic-preview-player" width="80" height="80" style="width:80px;height:80px;"></canvas>
            <span class="cosmetic-preview-label">${t('settings.cosmetics.previewPlayer')}</span>
          </div>
          <div class="cosmetic-preview-item">
            <canvas id="cosmetic-preview-bomb" width="56" height="56" style="width:56px;height:56px;"></canvas>
            <span class="cosmetic-preview-label">${t('settings.cosmetics.previewBomb')}</span>
          </div>
          <div class="cosmetic-preview-item cosmetic-preview-trail">
            <span class="cosmetic-preview-trail-dot" id="cosmetic-trail-dot"></span>
            <span class="cosmetic-preview-label" id="cosmetic-trail-label">${t('settings.cosmetics.previewTrailNone')}</span>
          </div>
        </div>
        ${slots.map(renderSlot).join('')}
        <div id="cosmetics-status" class="settings-status"></div>
      </div>
    `;

    this.drawCosmeticsPreview(allCosmetics, equipped);

    this.contentEl.querySelectorAll('.cosmetic-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const slot = (btn as HTMLElement).dataset.slot as CosmeticType;
        const cosmeticIdStr = (btn as HTMLElement).dataset.cosmeticId!;
        const cosmeticId = cosmeticIdStr === 'null' ? null : parseInt(cosmeticIdStr);

        const statusEl = this.contentEl!.querySelector('#cosmetics-status')!;
        try {
          const newEquipped = await ApiClient.put<EquippedCosmetics>('/cosmetics/equip', {
            slot,
            cosmeticId,
          });
          equipped = newEquipped;
          // Re-render to update visual state
          await this.renderCosmeticsTab();
          this.notifications.success(t('settings.cosmetics.updated'));
        } catch (err: unknown) {
          statusEl.innerHTML = `<span class="text-danger">${escapeHtml(getErrorMessage(err))}</span>`;
        }
      });
    });
  }

  private drawCosmeticsPreview(allCosmetics: Cosmetic[], equipped: EquippedCosmetics): void {
    if (!this.contentEl) return;

    // Resolve player color
    let playerHex = getPlayerColorHex(0);
    if (equipped.colorId !== null) {
      const colorCosmetic = allCosmetics.find((c) => c.id === equipped.colorId);
      if (colorCosmetic?.config.hex) {
        const raw = colorCosmetic.config.hex as string;
        playerHex = '#' + raw.replace('0x', '').replace('#', '');
      }
    }

    // Resolve eye style
    let eyeStyle: string | undefined;
    if (equipped.eyesId !== null) {
      const eyeCosmetic = allCosmetics.find((c) => c.id === equipped.eyesId);
      if (eyeCosmetic?.config.style) {
        eyeStyle = eyeCosmetic.config.style as string;
      }
    }

    // Draw player sprite
    const playerCanvas = this.contentEl.querySelector(
      '#cosmetic-preview-player',
    ) as HTMLCanvasElement;
    if (playerCanvas) {
      const ctx = playerCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 80, 80);
        drawPlayerSprite(ctx, 0, 0, 80, playerHex, eyeStyle);
      }
    }

    // Resolve bomb skin
    let bombBaseHex: string | undefined;
    let bombFuseHex: string | undefined;
    if (equipped.bombSkinId !== null) {
      const bombCosmetic = allCosmetics.find((c) => c.id === equipped.bombSkinId);
      if (bombCosmetic?.config.baseColor != null) {
        const base = bombCosmetic.config.baseColor as number;
        bombBaseHex = '#' + base.toString(16).padStart(6, '0');
        if (bombCosmetic.config.fuseColor != null) {
          const fuse = bombCosmetic.config.fuseColor as number;
          bombFuseHex = '#' + fuse.toString(16).padStart(6, '0');
        }
      }
    }

    // Draw bomb sprite
    const bombCanvas = this.contentEl.querySelector('#cosmetic-preview-bomb') as HTMLCanvasElement;
    if (bombCanvas) {
      const ctx = bombCanvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 56, 56);
        drawBombSprite(ctx, 0, 0, 56, bombBaseHex, bombFuseHex);
      }
    }

    // Update trail info
    const trailDot = this.contentEl.querySelector('#cosmetic-trail-dot') as HTMLElement;
    const trailLabel = this.contentEl.querySelector('#cosmetic-trail-label') as HTMLElement;
    if (trailDot && trailLabel) {
      if (equipped.trailId !== null) {
        const trailCosmetic = allCosmetics.find((c) => c.id === equipped.trailId);
        if (trailCosmetic) {
          if (trailCosmetic.config.tint != null) {
            const tint = trailCosmetic.config.tint as number;
            trailDot.style.background = '#' + tint.toString(16).padStart(6, '0');
          } else {
            trailDot.style.background = 'var(--text)';
          }
          trailDot.style.display = 'inline-block';
          trailLabel.textContent = trailCosmetic.name;
        }
      } else {
        trailDot.style.display = 'none';
        trailLabel.textContent = t('settings.cosmetics.previewTrailNone');
      }
    }
  }

  async renderEmbedded(container: HTMLElement): Promise<void> {
    this.container = container;

    this.container.innerHTML = `
      <div class="view-content">
        <div class="admin-tabs" id="settings-tab-bar">
          ${this.tabs
            .map(
              (tab) => `
            <button class="admin-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>
          `,
            )
            .join('')}
        </div>
        <div class="admin-tab-content" id="settings-tab-content"></div>
      </div>
    `;

    this.container.querySelector('#settings-tab-bar')!.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.dataset.tab && target.dataset.tab !== this.activeTabId) {
        this.switchTab(target.dataset.tab);
      }
    });

    this.contentEl = this.container.querySelector('#settings-tab-content');
    await this.renderActiveTab();
    this.pushGamepadContext();
  }

  destroy(): void {
    UIGamepadNavigator.getInstance().popContext('settings-ui');
  }

  private pushGamepadContext(): void {
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.popContext('settings-ui');
    gpNav.pushContext({
      id: 'settings-ui',
      elements: () => [
        ...this.container.querySelectorAll<HTMLElement>('#settings-ui-close'),
        ...this.container.querySelectorAll<HTMLElement>('.admin-tab'),
        ...(this.contentEl?.querySelectorAll<HTMLElement>('input, button, .btn') || []),
      ],
      onBack: () => {
        this.hide();
        this.onClose();
      },
    });
  }
}
