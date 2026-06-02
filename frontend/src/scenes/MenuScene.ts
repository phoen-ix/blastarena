import Phaser from 'phaser';
import { AuthManager } from '../network/AuthManager';
import { SocketClient } from '../network/SocketClient';
import { AuthUI } from '../ui/AuthUI';
import { VerificationUI } from '../ui/VerificationUI';
import { NotificationUI } from '../ui/NotificationUI';
import { themeManager } from '../themes/ThemeManager';
import { API_URL } from '../config';
import { t } from '../i18n';

interface OpenWorldStatus {
  enabled: boolean;
  playerCount: number;
  maxPlayers: number;
  guestAccess: boolean;
}

export class MenuScene extends Phaser.Scene {
  private authManager!: AuthManager;
  private socketClient!: SocketClient;
  private notifications!: NotificationUI;
  private authUI!: AuthUI;
  private landingContainer: HTMLElement | null = null;
  private connectingText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    this.notifications = new NotificationUI();
    this.authManager = new AuthManager();
    this.socketClient = new SocketClient(this.authManager);

    // Store in registry for other scenes
    this.registry.set('authManager', this.authManager);
    this.registry.set('socketClient', this.socketClient);
    this.registry.set('notifications', this.notifications);

    // Title
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    const titleStyle = {
      fontSize: '52px',
      fontFamily: 'Chakra Petch, sans-serif',
      fontStyle: 'bold',
    };
    const colors = themeManager.getCanvasColors();
    const blastText = this.add.text(0, 0, t('auth:login.title') + ' ', {
      ...titleStyle,
      color: colors.textHex,
    });
    const arenaText = this.add.text(0, 0, t('auth:login.titleAccent'), {
      ...titleStyle,
      color: colors.primaryHex,
    });
    const totalWidth = blastText.width + arenaText.width;
    blastText.setPosition(width / 2 - totalWidth / 2, height / 2 - 60 - blastText.height / 2);
    arenaText.setPosition(blastText.x + blastText.width, blastText.y);

    this.add
      .text(width / 2, height / 2, t('ui:menu.tagline'), {
        fontSize: '16px',
        color: colors.textDimHex,
        fontFamily: 'DM Sans, sans-serif',
      })
      .setOrigin(0.5);

    // Shown only during the brief auto-login check; removed once we know whether to authenticate
    // or fall back to the landing page (otherwise it lingers behind the landing buttons).
    this.connectingText = this.add
      .text(width / 2, height / 2 + 60, t('ui:menu.connecting'), {
        fontSize: '14px',
        color: colors.textMutedHex,
        fontFamily: 'DM Sans, sans-serif',
      })
      .setOrigin(0.5);

    // Check for ?emailVerified=true from verification redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('emailVerified') === 'true') {
      window.history.replaceState({}, '', window.location.pathname);
      this.notifications.success(t('auth:verification.verified'));
    }

    // Try auto-login first
    this.authManager.tryAutoLogin().then((success) => {
      if (success) {
        this.onAuthenticated();
      } else {
        this.showLanding();
      }
    });
  }

  /** Show landing page with guest play, login, and register options */
  private async showLanding(): Promise<void> {
    // Auto-login resolved (no session) — clear the transient "Connecting..." label.
    this.connectingText?.destroy();
    this.connectingText = null;

    // Fetch open world status for guest button visibility
    let owStatus: OpenWorldStatus | null = null;
    try {
      const res = await fetch(`${API_URL}/admin/settings/open_world/status`);
      if (res.ok) {
        owStatus = await res.json();
      }
    } catch {
      // Ignore — landing page works without status
    }

    const showGuest = owStatus?.enabled && owStatus?.guestAccess;
    const playerCount = owStatus?.playerCount ?? 0;

    this.landingContainer = document.createElement('div');
    this.landingContainer.className = 'menu-landing';
    this.landingContainer.innerHTML = `
      <div class="menu-landing-buttons">
        ${
          showGuest
            ? `<button class="btn btn-primary btn-lg" id="menu-guest-btn">
                ${t('ui:menu.playAsGuest')}
              </button>
              ${playerCount > 0 ? `<div class="menu-player-count">${t('ui:menu.onlinePlayers', { count: playerCount })}</div>` : ''}`
            : ''
        }
        <button class="btn btn-secondary" id="menu-login-btn">${t('ui:menu.login')}</button>
        <button class="btn btn-ghost" id="menu-register-btn">${t('ui:menu.register')}</button>
      </div>
    `;

    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      uiOverlay.appendChild(this.landingContainer);
    }

    // Bind events
    const guestBtn = this.landingContainer.querySelector('#menu-guest-btn');
    if (guestBtn) {
      guestBtn.addEventListener('click', () => this.onGuestPlay());
    }

    this.landingContainer.querySelector('#menu-login-btn')!.addEventListener('click', () => {
      this.hideLanding();
      this.showAuth();
    });

    this.landingContainer.querySelector('#menu-register-btn')!.addEventListener('click', () => {
      this.hideLanding();
      this.showAuth();
    });
  }

  private hideLanding(): void {
    if (this.landingContainer) {
      this.landingContainer.remove();
      this.landingContainer = null;
    }
  }

  private onGuestPlay(): void {
    this.hideLanding();
    this.socketClient.connectAsGuest();
    this.registry.set('guestOpenWorld', true);
    this.scene.start('LobbyScene');
  }

  private showAuth(): void {
    this.authUI = new AuthUI(this.authManager, this.notifications, () => {
      this.onAuthenticated();
    });
    this.authUI.show();
  }

  private onAuthenticated(): void {
    const user = this.authManager.getUser();
    if (user && !user.emailVerified) {
      this.showVerification();
      return;
    }
    this.socketClient.connect();
    this.scene.start('LobbyScene');
  }

  private showVerification(): void {
    const ui = new VerificationUI(this.authManager, this.notifications, () => {
      // User verified — proceed to lobby
      this.socketClient.connect();
      this.scene.start('LobbyScene');
    });
    ui.show();
  }
}
