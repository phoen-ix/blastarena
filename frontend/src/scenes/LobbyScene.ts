import Phaser from 'phaser';
import { AuthManager } from '../network/AuthManager';
import { SocketClient } from '../network/SocketClient';
import { NotificationUI } from '../ui/NotificationUI';
import { LobbyUI } from '../ui/LobbyUI';
import { RoomUI } from '../ui/RoomUI';
import { GameState, Room, CoopStartData } from '@blast-arena/shared';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { t } from '../i18n';

export class LobbyScene extends Phaser.Scene {
  private authManager!: AuthManager;
  private socketClient!: SocketClient;
  private notifications!: NotificationUI;
  private lobbyUI!: LobbyUI;
  private roomUI: RoomUI | null = null;
  private gameStartHandler: ((state: GameState) => void) | null = null;
  private adminToastHandler: ((data: { message: string }) => void) | null = null;
  private adminBannerHandler: ((data: { message: string | null }) => void) | null = null;
  private adminKickedHandler: ((data: { reason: string }) => void) | null = null;
  private partyJoinRoomHandler: ((data: { roomCode: string }) => void) | null = null;
  private campaignCoopStartHandler: ((data: CoopStartData) => void) | null = null;

  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    this.authManager = this.registry.get('authManager');
    this.socketClient = this.registry.get('socketClient');
    this.notifications = this.registry.get('notifications');

    // Register early game:start listener for reconnection after browser refresh.
    // If the server detects we were in an active game, it emits game:start on connect.
    // This is replaced by onJoinRoom()'s handler during normal flow.
    if (!this.gameStartHandler) {
      this.gameStartHandler = (state) => {
        if (this.gameStartHandler) {
          this.socketClient.off('game:start', this.gameStartHandler);
          this.gameStartHandler = null;
        }
        this.lobbyUI?.hide();
        this.roomUI?.hide();
        const uiOverlay = document.getElementById('ui-overlay');
        if (uiOverlay) {
          while (uiOverlay.firstChild) {
            uiOverlay.removeChild(uiOverlay.firstChild);
          }
        }
        this.registry.set('initialGameState', state);
        this.scene.start('GameScene');
        this.scene.launch('HUDScene');
      };
      this.socketClient.on('game:start', this.gameStartHandler);
    }

    // Reset gamepad UI navigator for clean state
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.clearAll();
    gpNav.setActive(true);

    // Clear any leftover DOM overlays (countdown, HUD, etc.)
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      while (uiOverlay.firstChild) {
        uiOverlay.removeChild(uiOverlay.firstChild);
      }
    }

    // Listen for auth changes
    this.authManager.onChange((user) => {
      if (!user) {
        this.lobbyUI?.hide();
        this.roomUI?.hide();
        this.scene.start('MenuScene');
      }
    });

    // Check if returning from "Play Again" with a room already set
    const currentRoom = this.registry.get('currentRoom') as Room | undefined;
    const openCampaign = this.registry.get('openCampaign');
    this.registry.remove('openCampaign');
    const returnToAdmin = this.registry.get('returnToAdmin') as string | undefined;
    this.registry.remove('returnToAdmin');
    if (currentRoom && currentRoom.status === 'waiting') {
      this.onJoinRoom(currentRoom);
      this.registry.remove('currentRoom');
    } else if (openCampaign) {
      this.registry.remove('currentRoom');
      this.showLobby('campaign');
    } else if (returnToAdmin) {
      this.registry.remove('currentRoom');
      this.showLobby('admin', { initialTab: returnToAdmin });
    } else {
      this.registry.remove('currentRoom');
      this.showLobby();
    }

    this.events.once('shutdown', this.shutdown, this);

    // Admin socket listeners
    this.adminToastHandler = (data) => {
      this.notifications.info(data.message);
    };
    this.socketClient.on('admin:toast', this.adminToastHandler);

    this.adminBannerHandler = (data) => {
      const area = document.getElementById('lobby-banner-area');
      if (area) {
        if (data.message) {
          area.innerHTML = '';
          const banner = document.createElement('div');
          banner.className = 'admin-banner';
          const span = document.createElement('span');
          span.textContent = data.message;
          const closeBtn = document.createElement('button');
          closeBtn.className = 'banner-close';
          closeBtn.textContent = '\u00d7';
          closeBtn.addEventListener('click', () => banner.remove());
          banner.appendChild(span);
          banner.appendChild(closeBtn);
          area.appendChild(banner);
        } else {
          area.innerHTML = '';
        }
      }
    };
    this.socketClient.on('admin:banner', this.adminBannerHandler);

    this.adminKickedHandler = (data) => {
      this.notifications.error(data.reason || t('ui:rooms.kicked'));
      this.roomUI?.hide();
      this.roomUI = null;
      this.showLobby();
    };
    this.socketClient.on('admin:kicked', this.adminKickedHandler);

    // Party join room listener (party leader joined a room, follow them)
    this.partyJoinRoomHandler = (data) => {
      if (data.roomCode) {
        this.socketClient.emit('room:join', { code: data.roomCode }, (response) => {
          if (response.success && response.room) {
            this.notifications.info(t('ui:party.followingLeader'));
            this.onJoinRoom(response.room);
          }
        });
      }
    };
    this.socketClient.on('party:joinRoom', this.partyJoinRoomHandler);

    // Campaign co-op start listener (partner auto-joins when leader starts co-op)
    this.campaignCoopStartHandler = (data) => {
      this.socketClient.off('campaign:coopStart', this.campaignCoopStartHandler!);
      this.campaignCoopStartHandler = null;

      // Clear all DOM overlays
      const uiOverlay = document.getElementById('ui-overlay');
      if (uiOverlay) {
        while (uiOverlay.firstChild) {
          uiOverlay.removeChild(uiOverlay.firstChild);
        }
      }

      // Set registry flags for GameScene
      const registry = this.registry;
      registry.set('campaignMode', true);
      registry.set('campaignCoopMode', true);
      registry.set('initialGameState', data.state.gameState);
      registry.set('campaignEnemyTypes', data.enemyTypes || []);

      // Transition to GameScene + HUDScene
      this.lobbyUI?.hide();
      this.roomUI?.hide();
      this.scene.start('GameScene');
      this.scene.launch('HUDScene');
    };
    this.socketClient.on('campaign:coopStart', this.campaignCoopStartHandler);

    // Background
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);
  }

  private showLobby(initialView?: string, viewOptions?: Record<string, any>): void {
    this.roomUI?.hide();
    this.roomUI = null;

    this.lobbyUI = new LobbyUI(
      this.socketClient,
      this.authManager,
      this.notifications,
      (room: Room) => this.onJoinRoom(room),
    );
    this.lobbyUI.show(initialView, viewOptions);
  }

  private onJoinRoom(room: Room): void {
    this.lobbyUI?.hide();

    // Store room data
    this.registry.set('currentRoom', room);

    // Show room waiting UI
    this.roomUI = new RoomUI(this.socketClient, this.authManager, this.notifications, room, () =>
      this.showLobby(),
    );
    this.roomUI.show();

    // Remove previous game:start listener if any
    if (this.gameStartHandler) {
      this.socketClient.off('game:start', this.gameStartHandler);
    }

    // Listen for game start (one-shot: removes itself after firing)
    this.gameStartHandler = (state) => {
      // Remove this listener immediately so it doesn't leak to next game
      if (this.gameStartHandler) {
        this.socketClient.off('game:start', this.gameStartHandler);
        this.gameStartHandler = null;
      }

      this.roomUI?.hide();

      // Clear any leftover DOM overlays from lobby/room UI
      const uiOverlay = document.getElementById('ui-overlay');
      if (uiOverlay) {
        while (uiOverlay.firstChild) {
          uiOverlay.removeChild(uiOverlay.firstChild);
        }
      }

      this.registry.set('initialGameState', state);
      this.scene.start('GameScene');
      this.scene.launch('HUDScene');
    };
    this.socketClient.on('game:start', this.gameStartHandler);
  }

  shutdown(): void {
    // Clean up socket listener to prevent leaks across scene transitions
    if (this.gameStartHandler) {
      this.socketClient.off('game:start', this.gameStartHandler);
      this.gameStartHandler = null;
    }
    if (this.adminToastHandler) {
      this.socketClient.off('admin:toast', this.adminToastHandler);
      this.adminToastHandler = null;
    }
    if (this.adminBannerHandler) {
      this.socketClient.off('admin:banner', this.adminBannerHandler);
      this.adminBannerHandler = null;
    }
    if (this.adminKickedHandler) {
      this.socketClient.off('admin:kicked', this.adminKickedHandler);
      this.adminKickedHandler = null;
    }
    if (this.partyJoinRoomHandler) {
      this.socketClient.off('party:joinRoom', this.partyJoinRoomHandler);
      this.partyJoinRoomHandler = null;
    }
    if (this.campaignCoopStartHandler) {
      this.socketClient.off('campaign:coopStart', this.campaignCoopStartHandler);
      this.campaignCoopStartHandler = null;
    }
    this.lobbyUI?.destroyPanels();
    this.lobbyUI?.hide();
    this.roomUI?.hide();
  }
}
