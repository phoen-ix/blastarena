import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { getErrorMessage } from '@blast-arena/shared';
import { t } from '../i18n';

export class VerificationUI {
  private overlay: HTMLElement;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onVerified: () => void;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private resendUsed = false;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(authManager: AuthManager, notifications: NotificationUI, onVerified: () => void) {
    this.authManager = authManager;
    this.notifications = notifications;
    this.onVerified = onVerified;
    this.overlay = document.createElement('div');
    this.overlay.className = 'auth-overlay';
  }

  show(): void {
    this.render();
    document.body.appendChild(this.overlay);
    this.startPolling();
  }

  private render(): void {
    const user = this.authManager.getUser();
    this.overlay.innerHTML = `
      <div class="auth-container" style="max-width:440px;">
        <div class="auth-header">
          <h1><span style="color:var(--text)">${t('auth:verification.title')}</span> <span style="color:var(--primary)">${t('auth:verification.titleAccent')}</span></h1>
        </div>
        <div class="auth-form" style="text-align:center;">
          <p style="color:var(--text);margin-bottom:var(--sp-4);line-height:1.6;">
            ${t('auth:verification.message')}
          </p>
          <p style="color:var(--text-dim);font-size:13px;margin-bottom:var(--sp-6);">
            ${t('auth:verification.checkSpam')}
          </p>
          <div style="display:flex;flex-direction:column;gap:var(--sp-3);align-items:center;">
            <div style="display:flex;gap:var(--sp-2);width:100%;">
              <input type="email" id="verify-email-input" class="input" style="flex:1;"
                placeholder="${t('auth:verification.emailPlaceholder')}" />
              <button id="resend-btn" class="btn btn-secondary">
                ${t('auth:verification.resend')}
              </button>
            </div>
            <button id="check-verified-btn" class="btn btn-primary" style="width:100%;">
              ${t('auth:verification.checkStatus')}
            </button>
            <button id="logout-btn" class="btn btn-ghost" style="width:100%;">
              ${t('auth:verification.logout')}
            </button>
          </div>
          <div id="verify-status" style="margin-top:var(--sp-3);font-size:13px;min-height:20px;"></div>
          ${user ? `<p style="color:var(--text-muted);font-size:12px;margin-top:var(--sp-4);">${t('auth:verification.loggedInAs', { username: user.username })}</p>` : ''}
        </div>
      </div>
    `;

    this.overlay.querySelector('#resend-btn')!.addEventListener('click', () => this.handleResend());
    this.overlay
      .querySelector('#check-verified-btn')!
      .addEventListener('click', () => this.checkVerification());
    this.overlay.querySelector('#logout-btn')!.addEventListener('click', () => this.handleLogout());
  }

  private async handleResend(): Promise<void> {
    if (this.resendUsed) return;

    const emailInput = this.overlay.querySelector('#verify-email-input') as HTMLInputElement;
    const email = emailInput.value.trim();
    const statusEl = this.overlay.querySelector('#verify-status')!;
    const btn = this.overlay.querySelector('#resend-btn') as HTMLButtonElement;

    if (!email) {
      statusEl.innerHTML = `<span class="text-danger">${t('auth:verification.enterEmail')}</span>`;
      return;
    }

    btn.disabled = true;
    try {
      await ApiClient.post('/auth/resend-verification', { email }, true);
      this.resendUsed = true;
      statusEl.innerHTML = `<span class="text-success">${t('auth:verification.resent')}</span>`;
      this.startResendCountdown(btn);
    } catch (err: unknown) {
      statusEl.innerHTML = `<span class="text-danger">${getErrorMessage(err)}</span>`;
      btn.disabled = false;
    }
  }

  private startResendCountdown(btn: HTMLButtonElement): void {
    let remaining = 120;
    btn.textContent = t('auth:verification.resendCountdown', { seconds: remaining });
    this.countdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        btn.textContent = t('auth:verification.resendLimitReached');
      } else {
        btn.textContent = t('auth:verification.resendCountdown', { seconds: remaining });
      }
    }, 1000);
  }

  private async checkVerification(): Promise<void> {
    const statusEl = this.overlay.querySelector('#verify-status')!;
    const btn = this.overlay.querySelector('#check-verified-btn') as HTMLButtonElement;

    btn.disabled = true;
    btn.textContent = t('auth:verification.checking');

    try {
      const refreshed = await this.authManager.refresh();
      if (!refreshed) {
        statusEl.innerHTML = `<span class="text-danger">${t('auth:verification.sessionExpired')}</span>`;
        return;
      }

      const user = this.authManager.getUser();
      if (user?.emailVerified) {
        this.stopPolling();
        this.notifications.success(t('auth:verification.verified'));
        this.overlay.remove();
        this.onVerified();
      } else {
        statusEl.innerHTML = `<span class="text-warning">${t('auth:verification.notYet')}</span>`;
      }
    } catch {
      statusEl.innerHTML = `<span class="text-danger">${t('auth:verification.checkFailed')}</span>`;
    } finally {
      btn.disabled = false;
      btn.textContent = t('auth:verification.checkStatus');
    }
  }

  private async handleLogout(): Promise<void> {
    this.stopPolling();
    await this.authManager.logout();
    this.overlay.remove();
    window.location.reload();
  }

  /** Poll every 15s to auto-detect verification */
  private startPolling(): void {
    this.checkInterval = setInterval(async () => {
      try {
        const refreshed = await this.authManager.refresh();
        if (refreshed) {
          const user = this.authManager.getUser();
          if (user?.emailVerified) {
            this.stopPolling();
            this.notifications.success(t('auth:verification.verified'));
            this.overlay.remove();
            this.onVerified();
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 15000);
  }

  private stopPolling(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
}
