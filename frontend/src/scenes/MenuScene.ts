import Phaser from 'phaser';
import { AuthManager } from '../network/AuthManager';
import { SocketClient } from '../network/SocketClient';
import { AuthUI } from '../ui/AuthUI';
import { VerificationUI } from '../ui/VerificationUI';
import { NotificationUI } from '../ui/NotificationUI';
import { themeManager } from '../themes/ThemeManager';
import { API_URL } from '../config';
import { t } from '../i18n';
import type { GameState } from '@blast-arena/shared';

interface OpenWorldStatus {
  enabled: boolean;
  playerCount: number;
  maxPlayers: number;
  guestAccess: boolean;
}

/** Callback payload from the `openworld:join` socket ack. */
interface OpenWorldJoinResponse {
  success: boolean;
  playerId?: number;
  username?: string;
  isGuest?: boolean;
  state?: GameState;
  error?: string;
}

export class MenuScene extends Phaser.Scene {
  private authManager!: AuthManager;
  private socketClient!: SocketClient;
  private notifications!: NotificationUI;
  private authUI!: AuthUI;
  private landingContainer: HTMLElement | null = null;
  private connectingText: Phaser.GameObjects.Text | null = null;
  // Open-world arena rendered live behind the landing menu.
  private bgArenaStarted = false; // GameScene launched & live
  private bgJoinInFlight = false; // openworld:join emitted, awaiting ack
  private pendingReveal = false; // "Play as Guest" clicked before the join completed
  private bgConnectHandler: (() => void) | null = null;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create(): void {
    // Phaser reuses scene instances — reset all session state at the top of create().
    this.bgArenaStarted = false;
    this.bgJoinInFlight = false;
    this.pendingReveal = false;
    this.bgConnectHandler = null;
    this.events.once('shutdown', this.shutdown, this);

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

    // Render the live open-world arena behind the menu (auto-join a guest) when open world + guest
    // access are enabled. The DOM menu buttons stay overlaid on top of the game canvas.
    if (showGuest) {
      this.startBackgroundArena();
    }

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
      this.leaveBackgroundArena();
      this.hideLanding();
      this.showAuth();
    });

    this.landingContainer.querySelector('#menu-register-btn')!.addEventListener('click', () => {
      this.leaveBackgroundArena();
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
    if (this.bgArenaStarted && this.scene.isActive('GameScene')) {
      // The arena is already live + interactive behind the menu — just reveal it.
      this.revealArena();
      return;
    }
    if (this.bgJoinInFlight) {
      // Join still in flight — reveal as soon as the ack arrives.
      this.pendingReveal = true;
      return;
    }
    // No background arena (open world disabled, or join failed) — use the standard lobby flow.
    this.enterGuestViaLobby();
  }

  /** Connect as a guest and auto-join the open world to render the arena behind the landing menu. */
  private startBackgroundArena(): void {
    if (this.bgArenaStarted || this.bgJoinInFlight) return;
    this.socketClient.connectAsGuest();
    if (this.socketClient.isConnected()) {
      this.joinBackgroundWorld();
    } else {
      const socket = this.socketClient.getSocket();
      if (!socket) return;
      // Emit the join once the socket actually connects (connectAsGuest is async).
      this.bgConnectHandler = () => this.joinBackgroundWorld();
      socket.once('connect', this.bgConnectHandler);
    }
  }

  private joinBackgroundWorld(): void {
    if (this.bgArenaStarted || this.bgJoinInFlight) return;
    const socket = this.socketClient.getSocket();
    if (!socket) return;
    this.bgJoinInFlight = true;
    socket.emit('openworld:join', {}, (response: OpenWorldJoinResponse) => {
      this.bgJoinInFlight = false;
      if (response?.success && response.state) {
        if (response.isGuest && response.playerId && response.username) {
          this.authManager.setGuestIdentity(response.playerId, response.username);
        }
        this.registry.set('initialGameState', response.state);
        this.registry.set('openWorldMode', true);
        this.registry.set('openWorldPlayerId', response.playerId);
        // Mark this as a background arena so GameScene's AFK-kick handler returns to the landing
        // (instead of dropping into the lobby) if the idle guest is kicked while on the menu.
        this.registry.set('openWorldBackground', true);
        // Launch the arena as a live background and keep this menu (title) on top. The DOM landing
        // buttons in #ui-overlay already sit above the game canvas. HUD is launched later, on reveal.
        this.scene.launch('GameScene');
        this.scene.bringToTop('MenuScene');
        this.bgArenaStarted = true;
        if (this.pendingReveal) this.revealArena();
      } else if (this.pendingReveal) {
        // Join failed but the user already asked to play — fall back to the lobby flow.
        this.pendingReveal = false;
        this.enterGuestViaLobby();
      }
    });
  }

  /** Reveal the already-running background arena: drop the menu, show the HUD, take control. */
  private revealArena(): void {
    // No longer a background arena — restore normal foreground AFK behavior (kick → lobby).
    this.registry.remove('openWorldBackground');
    this.hideLanding();
    this.scene.launch('HUDScene');
    this.scene.stop('MenuScene');
  }

  /** Fallback guest entry when no background arena is running (open world disabled / join failed). */
  private enterGuestViaLobby(): void {
    this.hideLanding();
    this.socketClient.connectAsGuest();
    this.registry.set('guestOpenWorld', true);
    this.scene.start('LobbyScene');
  }

  /** Tear down the background arena + guest session before showing the auth screen. */
  private leaveBackgroundArena(): void {
    if (this.bgArenaStarted) {
      this.scene.stop('GameScene');
      if (this.scene.isActive('HUDScene')) this.scene.stop('HUDScene');
    }
    if (this.bgConnectHandler) {
      this.socketClient.getSocket()?.off('connect', this.bgConnectHandler);
      this.bgConnectHandler = null;
    }
    this.bgArenaStarted = false;
    this.bgJoinInFlight = false;
    this.pendingReveal = false;
    this.registry.remove('openWorldBackground');
    // Drop the idle guest socket + identity; the server removes the guest player on disconnect.
    this.socketClient.disconnect();
    this.authManager.clearGuest();
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

  /**
   * Phaser does not auto-call shutdown — registered via `events.once('shutdown')` in create().
   * Cleans up the landing DOM + any pending connect listener. Does NOT disconnect the socket: when
   * we transition into the revealed arena, GameScene keeps using the same (guest) socket.
   */
  private shutdown(): void {
    this.hideLanding();
    if (this.bgConnectHandler) {
      this.socketClient.getSocket()?.off('connect', this.bgConnectHandler);
      this.bgConnectHandler = null;
    }
  }
}
