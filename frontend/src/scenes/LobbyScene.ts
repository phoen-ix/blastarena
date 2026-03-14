import Phaser from 'phaser';
import { AuthManager } from '../network/AuthManager';
import { SocketClient } from '../network/SocketClient';
import { NotificationUI } from '../ui/NotificationUI';
import { LobbyUI } from '../ui/LobbyUI';
import { RoomUI } from '../ui/RoomUI';
import { Room } from '@blast-arena/shared';

export class LobbyScene extends Phaser.Scene {
  private authManager!: AuthManager;
  private socketClient!: SocketClient;
  private notifications!: NotificationUI;
  private lobbyUI!: LobbyUI;
  private roomUI: RoomUI | null = null;
  private gameStartHandler: ((state: any) => void) | null = null;

  constructor() {
    super({ key: 'LobbyScene' });
  }

  create(): void {
    this.authManager = this.registry.get('authManager');
    this.socketClient = this.registry.get('socketClient');
    this.notifications = this.registry.get('notifications');

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

    this.showLobby();

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
      (room: Room) => this.onJoinRoom(room)
    );
    this.lobbyUI.show();
  }

  private onJoinRoom(room: Room): void {
    this.lobbyUI?.hide();

    // Store room data
    this.registry.set('currentRoom', room);

    // Show room waiting UI
    this.roomUI = new RoomUI(
      this.socketClient,
      this.authManager,
      this.notifications,
      room,
      () => this.showLobby()
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
    this.lobbyUI?.hide();
    this.roomUI?.hide();
  }
}
