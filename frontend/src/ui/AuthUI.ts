import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { getErrorMessage } from '@blast-arena/shared';

export class AuthUI {
  private overlay: HTMLElement;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private mode: 'login' | 'register' | 'forgot' = 'login';
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
    this.checkRegistration();
    this.loadFooterLinks();
    this.render();
  }

  private async checkRegistration(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ enabled: boolean }>(
        '/admin/settings/registration_enabled',
      );
      this.registrationEnabled = resp.enabled;
      if (this.mode === 'login') this.render();
    } catch {
      // Default to enabled on failure
    }
  }

  private async loadFooterLinks(): Promise<void> {
    try {
      const [imprintResp, githubResp] = await Promise.all([
        ApiClient.get<{ enabled: boolean }>('/admin/settings/imprint'),
        ApiClient.get<{ enabled: boolean }>('/admin/settings/display_github'),
      ]);
      this.displayImprint = imprintResp.enabled;
      this.displayGithub = githubResp.enabled;
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
        ...this.overlay.querySelectorAll<HTMLElement>('input, .btn-primary, .auth-switch a'),
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
    }
  }

  private renderLogin(): void {
    this.overlay.innerHTML = `
      <div class="auth-form">
        <h2><span>BLAST</span>ARENA</h2>
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="login-username" placeholder="Enter username" autocomplete="username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="login-password" placeholder="Enter password" autocomplete="current-password">
        </div>
        <div class="form-error" id="login-error"></div>
        <button class="btn btn-primary" id="login-btn">Login</button>
        ${
          this.registrationEnabled
            ? `<div class="auth-switch">
          Don't have an account? <a id="switch-register">Register</a>
        </div>`
            : ''
        }
        <div class="auth-switch">
          <a id="switch-forgot">Forgot password?</a>
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

    this.pushGamepadContext();
  }

  private async showImprint(): Promise<void> {
    let text = '';
    try {
      const resp = await ApiClient.get<{ enabled: boolean; text: string }>(
        '/admin/settings/imprint',
      );
      text = resp.text || 'No imprint information available.';
    } catch {
      text = 'Failed to load imprint.';
    }
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:600px;">
        <div class="modal-header">
          <h3>Imprint</h3>
          <button class="modal-close">&times;</button>
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
        <h2>CREATE <span>ACCOUNT</span></h2>
        <div class="form-group">
          <label>Username</label>
          <input type="text" id="reg-username" placeholder="3-20 chars, letters/numbers/_/-" autocomplete="username">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="reg-email" placeholder="your@email.com" autocomplete="email">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="reg-password" placeholder="Min 8 characters" autocomplete="new-password">
        </div>
        <div class="form-error" id="reg-error"></div>
        <button class="btn btn-primary" id="reg-btn">Register</button>
        <div class="auth-switch">
          Already have an account? <a id="switch-login">Login</a>
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

    this.pushGamepadContext();
  }

  private renderForgotPassword(): void {
    this.overlay.innerHTML = `
      <div class="auth-form">
        <h2>RESET <span>PASSWORD</span></h2>
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="forgot-email" placeholder="your@email.com">
        </div>
        <div class="form-error" id="forgot-error"></div>
        <button class="btn btn-primary" id="forgot-btn">Send Reset Link</button>
        <div class="auth-switch">
          <a id="switch-login-back">Back to Login</a>
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

    this.pushGamepadContext();
  }

  private renderFooterLinks(): string {
    const links: string[] = [];
    if (this.displayGithub) {
      links.push(
        '<a href="https://github.com/phoen-ix/blastarena/" target="_blank" rel="noopener">GitHub</a>',
      );
    }
    if (this.displayImprint) {
      links.push('<a id="auth-imprint-link" href="#">Imprint</a>');
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
      errorEl.textContent = 'Please fill in all fields';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Logging in...';
    errorEl.textContent = '';

    try {
      await this.authManager.login(username, password);
      this.notifications.success('Welcome back!');
      this.hide();
      this.onAuthenticated();
    } catch (err: unknown) {
      errorEl.textContent = getErrorMessage(err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Login';
    }
  }

  private async handleRegister(): Promise<void> {
    const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
    const email = (document.getElementById('reg-email') as HTMLInputElement).value.trim();
    const password = (document.getElementById('reg-password') as HTMLInputElement).value;
    const errorEl = document.getElementById('reg-error')!;
    const btn = document.getElementById('reg-btn') as HTMLButtonElement;

    if (!username || !email || !password) {
      errorEl.textContent = 'Please fill in all required fields';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';
    errorEl.textContent = '';

    try {
      await this.authManager.register(username, email, password);
      this.notifications.success('Account created! Check your email to verify.');
      this.hide();
      this.onAuthenticated();
    } catch (err: unknown) {
      errorEl.textContent = getErrorMessage(err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register';
    }
  }

  private async handleForgotPassword(): Promise<void> {
    const email = (document.getElementById('forgot-email') as HTMLInputElement).value.trim();
    const errorEl = document.getElementById('forgot-error')!;
    const btn = document.getElementById('forgot-btn') as HTMLButtonElement;

    if (!email) {
      errorEl.textContent = 'Please enter your email';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      await (
        await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
      ).json();
      this.notifications.info('If the email exists, a reset link has been sent');
      this.mode = 'login';
      this.render();
    } catch (err: unknown) {
      errorEl.textContent = getErrorMessage(err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Reset Link';
    }
  }
}
