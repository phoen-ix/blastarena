import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { getErrorMessage } from '@blast-arena/shared';
import { i18n, t } from '../i18n';

export class AuthUI {
  private overlay: HTMLElement;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private mode: 'login' | 'register' | 'forgot' | 'totp' = 'login';
  private onAuthenticated: () => void;
  private registrationEnabled: boolean = true;
  private displayImprint: boolean = false;
  private displayGithub: boolean = false;

  constructor(
    authManager: AuthManager,
    notifications: NotificationUI,
    onAuthenticated: () => void,
  ) {
    this.authManager = authManager;
    this.notifications = notifications;
    this.onAuthenticated = onAuthenticated;
    this.overlay = document.createElement('div');
    this.overlay.className = 'auth-overlay';
    this.loadPublicSettings();
    this.render();
  }

  private async loadPublicSettings(): Promise<void> {
    try {
      const resp = await ApiClient.get<{
        registrationEnabled: boolean;
        imprint: boolean;
        displayGithub: boolean;
      }>('/admin/settings/public');
      this.registrationEnabled = resp.registrationEnabled;
      this.displayImprint = resp.imprint;
      this.displayGithub = resp.displayGithub;
      this.render();
    } catch {
      // defaults
    }
  }

  show(): void {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.overlay)) {
      uiOverlay.appendChild(this.overlay);
    }
  }

  hide(): void {
    UIGamepadNavigator.getInstance().popContext('auth');
    this.overlay.remove();
  }

  private pushGamepadContext(): void {
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.setActive(true);
    gpNav.popContext('auth');
    gpNav.pushContext({
      id: 'auth',
      elements: () => [
        ...this.overlay.querySelectorAll<HTMLElement>(
          'input, .btn-primary, .auth-switch a, .auth-lang-toggle',
        ),
      ],
      onBack: () => {
        if (this.mode !== 'login') {
          this.mode = 'login';
          this.render();
        }
      },
    });
  }

  private render(): void {
    switch (this.mode) {
      case 'login':
        this.renderLogin();
        break;
      case 'register':
        if (!this.registrationEnabled) {
          this.mode = 'login';
          this.renderLogin();
          break;
        }
        this.renderRegister();
        break;
      case 'forgot':
        this.renderForgotPassword();
        break;
      case 'totp':
        this.renderTotpVerification();
        break;
    }
  }

  private renderLogin(): void {
    this.overlay.innerHTML = `
      <div class="auth-form">
        ${this.renderLanguagePicker()}
        <h2><span>${t('auth:login.title')}</span>${t('auth:login.titleAccent')}</h2>
        <div class="form-group">
          <label for="login-username">${t('auth:login.username')}</label>
          <input type="text" id="login-username" placeholder="${t('auth:login.usernamePlaceholder')}" autocomplete="username">
        </div>
        <div class="form-group">
          <label for="login-password">${t('auth:login.password')}</label>
          <input type="password" id="login-password" placeholder="${t('auth:login.passwordPlaceholder')}" autocomplete="current-password">
        </div>
        <div class="form-error" id="login-error"></div>
        <button class="btn btn-primary" id="login-btn">${t('auth:login.submit')}</button>
        ${
          this.registrationEnabled
            ? `<div class="auth-switch">
          ${t('auth:login.noAccount')} <a id="switch-register">${t('auth:login.register')}</a>
        </div>`
            : ''
        }
        <div class="auth-switch">
          <a id="switch-forgot">${t('auth:login.forgotPassword')}</a>
        </div>
        ${this.renderFooterLinks()}
      </div>
    `;

    this.overlay.querySelector('#login-btn')!.addEventListener('click', () => this.handleLogin());
    this.overlay.querySelector('#login-password')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.handleLogin();
    });
    this.overlay.querySelector('#switch-register')?.addEventListener('click', () => {
      this.mode = 'register';
      this.render();
    });
    this.overlay.querySelector('#switch-forgot')!.addEventListener('click', () => {
      this.mode = 'forgot';
      this.render();
    });
    this.overlay.querySelector('#auth-imprint-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.showImprint();
    });
    this.bindLanguagePicker();

    this.pushGamepadContext();
  }

  private async showImprint(): Promise<void> {
    let text = '';
    try {
      const resp = await ApiClient.get<{ enabled: boolean; text: string }>(
        '/admin/settings/imprint',
      );
      text = resp.text || t('auth:imprint.noInfo');
    } catch {
      text = t('auth:imprint.loadFailed');
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', t('auth:imprint.title'));
    overlay.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <div class="modal-header">
          <h3>${t('auth:imprint.title')}</h3>
          <button class="modal-close" aria-label="${t('common:actions.close')}">&times;</button>
        </div>
        <div class="modal-body" style="white-space:pre-wrap;font-size:14px;line-height:1.6;max-height:60vh;overflow-y:auto;">${this.escapeHtml(text)}</div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private renderRegister(): void {
    this.overlay.innerHTML = `
      <div class="auth-form">
        ${this.renderLanguagePicker()}
        <h2>${t('auth:register.title')} <span>${t('auth:register.titleAccent')}</span></h2>
        <div class="form-group">
          <label for="reg-username">${t('auth:register.username')}</label>
          <input type="text" id="reg-username" placeholder="${t('auth:register.usernamePlaceholder')}" autocomplete="username">
        </div>
        <div class="form-group">
          <label for="reg-email">${t('auth:register.email')}</label>
          <input type="email" id="reg-email" placeholder="${t('auth:register.emailPlaceholder')}" autocomplete="email">
        </div>
        <div class="form-group">
          <label for="reg-password">${t('auth:register.password')}</label>
          <input type="password" id="reg-password" placeholder="${t('auth:register.passwordPlaceholder')}" autocomplete="new-password">
        </div>
        <div class="form-error" id="reg-error"></div>
        <button class="btn btn-primary" id="reg-btn">${t('auth:register.submit')}</button>
        <div class="auth-switch">
          ${t('auth:register.hasAccount')} <a id="switch-login">${t('auth:register.login')}</a>
        </div>
      </div>
    `;

    this.overlay.querySelector('#reg-btn')!.addEventListener('click', () => this.handleRegister());
    this.overlay.querySelector('#reg-password')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.handleRegister();
    });
    this.overlay.querySelector('#switch-login')!.addEventListener('click', () => {
      this.mode = 'login';
      this.render();
    });
    this.bindLanguagePicker();

    this.pushGamepadContext();
  }

  private renderForgotPassword(): void {
    this.overlay.innerHTML = `
      <div class="auth-form">
        ${this.renderLanguagePicker()}
        <h2>${t('auth:forgotPassword.title')} <span>${t('auth:forgotPassword.titleAccent')}</span></h2>
        <div class="form-group">
          <label for="forgot-email">${t('auth:forgotPassword.email')}</label>
          <input type="email" id="forgot-email" placeholder="${t('auth:forgotPassword.emailPlaceholder')}">
        </div>
        <div class="form-error" id="forgot-error"></div>
        <button class="btn btn-primary" id="forgot-btn">${t('auth:forgotPassword.submit')}</button>
        <div class="auth-switch">
          <a id="switch-login-back">${t('auth:forgotPassword.backToLogin')}</a>
        </div>
      </div>
    `;

    this.overlay
      .querySelector('#forgot-btn')!
      .addEventListener('click', () => this.handleForgotPassword());
    this.overlay.querySelector('#switch-login-back')!.addEventListener('click', () => {
      this.mode = 'login';
      this.render();
    });
    this.bindLanguagePicker();

    this.pushGamepadContext();
  }

  private renderLanguagePicker(): string {
    const languages = [
      { code: 'en', flag: '🇬🇧', label: 'English' },
      { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
      { code: 'fr', flag: '🇫🇷', label: 'Français' },
      { code: 'es', flag: '🇪🇸', label: 'Español' },
      { code: 'it', flag: '🇮🇹', label: 'Italiano' },
      { code: 'pt', flag: '🇵🇹', label: 'Português' },
      { code: 'pl', flag: '🇵🇱', label: 'Polski' },
      { code: 'nl', flag: '🇳🇱', label: 'Nederlands' },
      { code: 'tr', flag: '🇹🇷', label: 'Türkçe' },
      { code: 'sv', flag: '🇸🇪', label: 'Svenska' },
      { code: 'nb', flag: '🇳🇴', label: 'Norsk' },
      { code: 'da', flag: '🇩🇰', label: 'Dansk' },
    ];
    const current = i18n.language?.split('-')[0] || 'en';
    const currentLang = languages.find((l) => l.code === current) || languages[0];
    return `<div class="auth-lang-picker">
      <button class="auth-lang-toggle" id="auth-lang-toggle" aria-label="${t('auth:language')}" aria-expanded="false">${currentLang.flag}</button>
      <div class="auth-lang-dropdown" id="auth-lang-dropdown">
        ${languages
          .map(
            (lang) =>
              `<button class="auth-lang-option ${current === lang.code ? 'active' : ''}" data-lang="${lang.code}">${lang.flag} ${lang.label}</button>`,
          )
          .join('')}
      </div>
    </div>`;
  }

  private bindLanguagePicker(): void {
    const toggle = this.overlay.querySelector('#auth-lang-toggle') as HTMLButtonElement;
    const dropdown = this.overlay.querySelector('#auth-lang-dropdown') as HTMLElement;
    if (!toggle || !dropdown) return;

    toggle.addEventListener('click', () => {
      const open = dropdown.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    dropdown.querySelectorAll<HTMLButtonElement>('.auth-lang-option').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lang = btn.dataset.lang!;
        if (lang !== i18n.language?.split('-')[0]) {
          await i18n.changeLanguage(lang);
          this.render();
        }
      });
    });

    // Close dropdown on outside click
    this.overlay.addEventListener('click', (e) => {
      if (!toggle.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
        dropdown.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  private renderFooterLinks(): string {
    const links: string[] = [];
    if (this.displayGithub) {
      links.push(
        `<a href="https://github.com/phoen-ix/blastarena/" target="_blank" rel="noopener">${t('auth:footer.github')}</a>`,
      );
    }
    if (this.displayImprint) {
      links.push(`<a id="auth-imprint-link" href="#">${t('auth:footer.imprint')}</a>`);
    }
    if (links.length === 0) return '';
    return `<div class="auth-footer-links">${links.join('<span class="auth-footer-sep">&middot;</span>')}</div>`;
  }

  private async handleLogin(): Promise<void> {
    const username = (document.getElementById('login-username') as HTMLInputElement).value.trim();
    const password = (document.getElementById('login-password') as HTMLInputElement).value;
    const errorEl = document.getElementById('login-error')!;
    const btn = document.getElementById('login-btn') as HTMLButtonElement;

    if (!username || !password) {
      errorEl.textContent = t('auth:login.fillAllFields');
      return;
    }

    btn.disabled = true;
    btn.textContent = t('auth:login.submitting');
    errorEl.textContent = '';

    try {
      const result = await this.authManager.login(username, password);
      if (result === 'totp-required') {
        this.mode = 'totp';
        this.render();
        return;
      }
      this.notifications.success(t('auth:login.welcomeBack'));
      this.hide();
      this.onAuthenticated();
    } catch (err: unknown) {
      errorEl.textContent = this.translateError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = t('auth:login.submit');
    }
  }

  private renderTotpVerification(): void {
    this.overlay.innerHTML = `
      <div class="auth-form">
        <h2>${t('auth:totp.title')}</h2>
        <p class="auth-totp-hint">${t('auth:totp.description')}</p>
        <div class="form-group">
          <label for="totp-code">${t('auth:totp.codePlaceholder')}</label>
          <input type="text" id="totp-code" placeholder="000000" inputmode="numeric" autocomplete="one-time-code" maxlength="10">
        </div>
        <p class="auth-totp-backup-hint">${t('auth:totp.backupHint')}</p>
        <div class="form-error" id="totp-error"></div>
        <button class="btn btn-primary" id="totp-btn">${t('auth:totp.submit')}</button>
        <div class="auth-switch">
          <a id="switch-login-back">${t('auth:totp.backToLogin')}</a>
        </div>
      </div>
    `;

    this.overlay
      .querySelector('#totp-btn')!
      .addEventListener('click', () => this.handleTotpVerify());
    this.overlay.querySelector('#totp-code')!.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.handleTotpVerify();
    });
    this.overlay.querySelector('#switch-login-back')!.addEventListener('click', () => {
      this.mode = 'login';
      this.render();
    });

    this.pushGamepadContext();

    // Auto-focus the code input
    (this.overlay.querySelector('#totp-code') as HTMLInputElement)?.focus();
  }

  private async handleTotpVerify(): Promise<void> {
    const code = (document.getElementById('totp-code') as HTMLInputElement).value.trim();
    const errorEl = document.getElementById('totp-error')!;
    const btn = document.getElementById('totp-btn') as HTMLButtonElement;

    if (!code) {
      errorEl.textContent = t('auth:totp.invalidCode');
      return;
    }

    btn.disabled = true;
    btn.textContent = t('auth:totp.submitting');
    errorEl.textContent = '';

    try {
      await this.authManager.verifyTotp(code);
      this.notifications.success(t('auth:login.welcomeBack'));
      this.hide();
      this.onAuthenticated();
    } catch (err: unknown) {
      errorEl.textContent = this.translateError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = t('auth:totp.submit');
    }
  }

  private async handleRegister(): Promise<void> {
    const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
    const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('reg-password') as HTMLInputElement).value;
    const errorEl = document.getElementById('reg-error')!;
    const btn = document.getElementById('reg-btn') as HTMLButtonElement;

    if (!username || !email || !password) {
      errorEl.textContent = t('auth:register.fillAllFields');
      return;
    }

    btn.disabled = true;
    btn.textContent = t('auth:register.submitting');
    errorEl.textContent = '';

    try {
      await this.authManager.register(username, email, password);
      this.notifications.success(t('auth:register.success'));
      this.hide();
      this.onAuthenticated();
    } catch (err: unknown) {
      errorEl.textContent = this.translateError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = t('auth:register.submit');
    }
  }

  private async handleForgotPassword(): Promise<void> {
    const email = (document.getElementById('forgot-email') as HTMLInputElement).value.trim();
    const errorEl = document.getElementById('forgot-error')!;
    const btn = document.getElementById('forgot-btn') as HTMLButtonElement;

    if (!email) {
      errorEl.textContent = t('auth:forgotPassword.enterEmail');
      return;
    }

    btn.disabled = true;
    btn.textContent = t('auth:forgotPassword.submitting');

    try {
      await (
        await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
      ).json();
      this.notifications.info(t('auth:forgotPassword.success'));
      this.mode = 'login';
      this.render();
    } catch (err: unknown) {
      errorEl.textContent = this.translateError(err);
    } finally {
      btn.disabled = false;
      btn.textContent = t('auth:forgotPassword.submit');
    }
  }

  /**
   * Translate backend error: try error code from errors namespace,
   * fall back to the raw error message.
   */
  private translateError(err: unknown): string {
    const message = getErrorMessage(err);
    // Try to extract error code from the error message or object
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: string }).code;
      const translated = t(`errors:${code}`, { defaultValue: '' });
      if (translated) return translated;
    }
    return message;
  }
}
