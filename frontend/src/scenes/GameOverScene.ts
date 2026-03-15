import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameOverScene' });
  }

  create(): void {
    // Clear any leftover DOM overlays (countdown, HUD)
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      while (uiOverlay.firstChild) {
        uiOverlay.removeChild(uiOverlay.firstChild);
      }
    }

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const data = this.registry.get('gameOverData');
    const socketClient: SocketClient = this.registry.get('socketClient');

    // Listen for room restart (another player clicked Play Again)
    const roomStateHandler = (room: any) => {
      if (room.status === 'waiting') {
        socketClient.off('room:state' as any, roomStateHandler as any);
        this.registry.set('currentRoom', room);
        this.scene.start('LobbyScene');
      }
    };
    socketClient.on('room:state' as any, roomStateHandler as any);

    this.events.on('shutdown', () => {
      socketClient.off('room:state' as any, roomStateHandler as any);
    });

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);

    this.add.text(width / 2, 45, 'GAME OVER', {
      fontSize: '42px',
      color: '#e94560',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Show reason text beneath game over
    if (data?.reason) {
      this.add.text(width / 2, 85, data.reason, {
        fontSize: '16px',
        color: '#a0a0b0',
      }).setOrigin(0.5);
    }

    // Play Again button
    const playAgainBtn = this.add.text(width / 2 - 100, height - 40, '[ Play Again ]', {
      fontSize: '20px',
      color: '#44ff44',
      fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    playAgainBtn.on('pointerover', () => playAgainBtn.setColor('#88ff88'));
    playAgainBtn.on('pointerout', () => playAgainBtn.setColor('#44ff44'));
    playAgainBtn.on('pointerdown', () => {
      // Remove room:state listener to prevent double-navigation (callback handles this player)
      socketClient.off('room:state' as any, roomStateHandler as any);
      socketClient.emit('room:restart', (response: any) => {
        if (response.success && response.room) {
          this.registry.set('currentRoom', response.room);
          this.scene.start('LobbyScene');
        }
      });
    });

    // Back to lobby button
    const backBtn = this.add.text(width / 2 + 100, height - 40, '[ Back to Lobby ]', {
      fontSize: '20px',
      color: '#e94560',
      fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor('#ff6b81'));
    backBtn.on('pointerout', () => backBtn.setColor('#e94560'));
    backBtn.on('pointerdown', () => {
      socketClient.emit('room:leave' as any);
      this.registry.remove('currentRoom');
      this.scene.start('LobbyScene');
    });

    if (data?.placements) {
      const list: any[] = data.placements;
      const count = list.length;
      const startY = 140;
      const endY = height - 70;
      const spacing = Math.min(28, (endY - startY) / Math.max(count, 1));

      // Check if team mode (winnerTeam is set)
      const isTeamMode = data.winnerTeam !== null && data.winnerTeam !== undefined;
      const teamColors = ['#e94560', '#44aaff'];
      const teamNames = ['Red', 'Blue'];

      // Column layout
      const colName = width * 0.35;
      const colTeam = isTeamMode ? width * 0.6 : -1;
      const colScore = width * 0.75;

      // Header
      const hs = { fontSize: '13px', color: '#555', fontStyle: 'bold' } as Phaser.Types.GameObjects.Text.TextStyle;
      this.add.text(colName, 115, 'PLAYER', hs).setOrigin(0.5);
      if (isTeamMode) this.add.text(colTeam, 115, 'TEAM', hs).setOrigin(0.5);
      this.add.text(colScore, 115, 'SCORE', hs).setOrigin(0.5);

      list.forEach((p: any, i: number) => {
        const y = startY + i * spacing;
        const medalColor = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#707080';
        const dead = p.alive === false;
        const botTag = p.isBot ? ' [BOT]' : '';
        const name = (p.username || `Player ${p.userId}`) + botTag;
        const kills = p.kills ?? 0;

        const nameText = this.add.text(colName, y, name, { fontSize: '16px', color: dead ? '#555' : medalColor }).setOrigin(0.5);
        if (dead) {
          const lineY = nameText.y;
          const lineWidth = nameText.width;
          const line = this.add.graphics();
          line.lineStyle(1.5, 0x666666, 0.8);
          line.lineBetween(nameText.x - lineWidth / 2, lineY, nameText.x + lineWidth / 2, lineY);
          line.setDepth(1);
        }
        if (isTeamMode && p.team !== null && p.team !== undefined) {
          this.add.text(colTeam, y, teamNames[p.team], { fontSize: '14px', color: teamColors[p.team] }).setOrigin(0.5);
        }
        this.add.text(colScore, y, `${kills}`, { fontSize: '16px', color: dead ? '#555' : '#fff' }).setOrigin(0.5);
      });
    }
  }
}
