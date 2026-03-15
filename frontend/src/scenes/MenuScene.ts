import Phaser from 'phaser';
import { AuthManager } from '../network/AuthManager';
import { SocketClient } from '../network/SocketClient';
import { AuthUI } from '../ui/AuthUI';
import { NotificationUI } from '../ui/NotificationUI';

export class MenuScene extends Phaser.Scene {
  private authManager!: AuthManager;
  private socketClient!: SocketClient;
  private notifications!: NotificationUI;
  private authUI!: AuthUI;

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
    const blastText = this.add.text(0, 0, 'BLAST ', { ...titleStyle, color: '#eae8e4' });
    const arenaText = this.add.text(0, 0, 'ARENA', { ...titleStyle, color: '#ff6b35' });
    const totalWidth = blastText.width + arenaText.width;
    blastText.setPosition(width / 2 - totalWidth / 2, height / 2 - 60 - blastText.height / 2);
    arenaText.setPosition(blastText.x + blastText.width, blastText.y);

    this.add
      .text(width / 2, height / 2, 'Multiplayer Explosive Combat', {
        fontSize: '16px',
        color: '#8888a0',
        fontFamily: 'DM Sans, sans-serif',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 60, 'Connecting...', {
        fontSize: '14px',
        color: '#505068',
        fontFamily: 'DM Sans, sans-serif',
      })
      .setOrigin(0.5);

    // Try auto-login first
    this.authManager.tryAutoLogin().then((success) => {
      if (success) {
        this.onAuthenticated();
      } else {
        this.showAuth();
      }
    });
  }

  private showAuth(): void {
    this.authUI = new AuthUI(this.authManager, this.notifications, () => {
      this.onAuthenticated();
    });
    this.authUI.show();
  }

  private onAuthenticated(): void {
    this.socketClient.connect();
    this.scene.start('LobbyScene');
  }
}
