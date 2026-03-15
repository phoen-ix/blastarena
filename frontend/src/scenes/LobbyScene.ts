import Phaser from 'phaser';
import { AuthManager } from '../network/AuthManager';
import { SocketClient } from '../network/SocketClient';
import { NotificationUI } from '../ui/NotificationUI';
import { LobbyUI } from '../ui/LobbyUI';
import { RoomUI } from '../ui/RoomUI';
import { Room } from '@blast-arena/shared';
import { escapeHtml } from '../utils/html';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';

export class LobbyScene extends Phaser.Scene {
  private authManager!: AuthManager;
  private socketClient!: SocketClient;
  private notifications!: NotificationUI;
  private lobbyUI!: LobbyUI;
  private roomUI: RoomUI | null = null;
  private gameStartHandler: ((state: any) => void) | null = null;
  private adminToastHandler: ((data: any) => void) | null = null;
  private adminBannerHandler: ((data: any) => void) | null = null;
  private adminKickedHandler: ((data: any) => void) | null = null;

  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    this.authManager = this.registry.get('authManager');
    this.socketClient = this.registry.get('socketClient');
    this.notifications = this.registry.get('notifications');

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
    if (currentRoom && currentRoom.status === 'waiting') {
      this.onJoinRoom(currentRoom);
      this.registry.remove('currentRoom');
    } else {
      this.registry.remove('currentRoom');
      this.showLobby();
    }

    this.events.once('shutdown', this.shutdown, this);

    // Admin socket listeners
    this.adminToastHandler = (data: any) => {
      this.notifications.info(data.message);
    };
    this.socketClient.on('admin:toast' as any, this.adminToastHandler as any);

    this.adminBannerHandler = (data: any) => {
      const area = document.getElementById('lobby-banner-area');
      if (area) {
        if (data.message) {
          area.innerHTML = `
            <div class="admin-banner">
              <span>${escapeHtml(data.message)}</span>
              <button class="banner-close" onclick="this.parentElement.remove()">&times;</button>
            </div>
          `;
        } else {
          area.innerHTML = '';
        }
      }
    };
    this.socketClient.on('admin:banner' as any, this.adminBannerHandler as any);

    this.adminKickedHandler = (data: any) => {
      this.notifications.error(data.reason || 'You have been kicked');
      this.roomUI?.hide();
      this.roomUI = null;
      this.showLobby();
    };
    this.socketClient.on('admin:kicked' as any, this.adminKickedHandler as any);

    // Background
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    this.add.rectangle(width / 2, height / 2, width, height, 0x1a1a2e);
  }

  private showLobby(): void {
    this.roomUI?.hide();
    this.roomUI = null;

    this.lobbyUI = new LobbyUI(
      this.socketClient,
      this.authManager,
      this.notifications,
      (room: Room) => this.onJoinRoom(room),
    );
    this.lobbyUI.show();
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
      this.socketClient.off('game:start' as any, this.gameStartHandler as any);
    }

    // Listen for game start (one-shot: removes itself after firing)
    this.gameStartHandler = (state: any) => {
      // Remove this listener immediately so it doesn't leak to next game
      if (this.gameStartHandler) {
        this.socketClient.off('game:start' as any, this.gameStartHandler as any);
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
    this.socketClient.on('game:start' as any, this.gameStartHandler as any);
  }

  shutdown(): void {
    // Clean up socket listener to prevent leaks across scene transitions
    if (this.gameStartHandler) {
      this.socketClient.off('game:start' as any, this.gameStartHandler as any);
      this.gameStartHandler = null;
    }
    if (this.adminToastHandler) {
      this.socketClient.off('admin:toast' as any, this.adminToastHandler as any);
      this.adminToastHandler = null;
    }
    if (this.adminBannerHandler) {
      this.socketClient.off('admin:banner' as any, this.adminBannerHandler as any);
      this.adminBannerHandler = null;
    }
    if (this.adminKickedHandler) {
      this.socketClient.off('admin:kicked' as any, this.adminKickedHandler as any);
      this.adminKickedHandler = null;
    }
    this.lobbyUI?.hide();
    this.roomUI?.hide();
  }
}
