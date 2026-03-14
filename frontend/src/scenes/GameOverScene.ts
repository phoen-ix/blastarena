import Phaser from 'phaser';

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

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);

    this.add.text(width / 2, 50, 'GAME OVER', {
      fontSize: '42px',
      color: '#e94560',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Back to lobby button at the bottom
    const backBtn = this.add.text(width / 2, height - 40, '[ Back to Lobby ]', {
      fontSize: '20px',
      color: '#e94560',
      fontStyle: 'bold',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor('#ff6b81'));
    backBtn.on('pointerout', () => backBtn.setColor('#e94560'));
    backBtn.on('pointerdown', () => {
      this.scene.start('LobbyScene');
    });

    if (data?.placements) {
      const list: any[] = data.placements;
      const count = list.length;
      const startY = 140;
      const endY = height - 70;
      const spacing = Math.min(28, (endY - startY) / Math.max(count, 1));

      // Column layout
      const colName = width * 0.35;
      const colScore = width * 0.75;

      // Header
      const hs = { fontSize: '13px', color: '#555', fontStyle: 'bold' } as Phaser.Types.GameObjects.Text.TextStyle;
      this.add.text(colName, 115, 'PLAYER', hs).setOrigin(0.5);
      this.add.text(colScore, 115, 'SCORE', hs).setOrigin(0.5);

      list.forEach((p: any, i: number) => {
        const y = startY + i * spacing;
        const medalColor = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#707080';
        const botTag = p.isBot ? ' [BOT]' : '';
        const name = (p.displayName || `Player ${p.userId}`) + botTag;
        const kills = p.kills ?? 0;

        this.add.text(colName, y, name, { fontSize: '16px', color: medalColor }).setOrigin(0.5);
        this.add.text(colScore, y, `${kills}`, { fontSize: '16px', color: '#fff' }).setOrigin(0.5);
      });
    }
  }
}
