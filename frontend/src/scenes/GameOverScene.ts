import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';

const DEADZONE = 0.3;

export class GameOverScene extends Phaser.Scene {
  private selectedIndex = 0;
  private buttons: Phaser.GameObjects.Text[] = [];
  private baseColors: string[] = [];
  private highlightColors: string[] = [];
  private prevA = false;
  private prevLeft = false;
  private prevRight = false;
  private underline: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    super({ key: 'GameOverScene' });
  }

  create(): void {
    this.selectedIndex = 0;
    this.buttons = [];
    this.baseColors = [];
    this.highlightColors = [];
    this.prevA = false;
    this.prevLeft = false;
    this.prevRight = false;
    this.underline = null;

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

    this.add
      .text(width / 2, 45, 'GAME OVER', {
        fontSize: '42px',
        color: '#ff6b35',
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Show reason text beneath game over
    if (data?.reason) {
      this.add
        .text(width / 2, 85, data.reason, {
          fontSize: '16px',
          color: '#8888a0',
          fontFamily: 'DM Sans, sans-serif',
        })
        .setOrigin(0.5);
    }

    // Play Again button
    const playAgainBtn = this.add
      .text(width / 2 - 100, height - 40, '[ Play Again ]', {
        fontSize: '20px',
        color: '#00e676',
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    playAgainBtn.on('pointerover', () => playAgainBtn.setColor('#66ffaa'));
    playAgainBtn.on('pointerout', () => playAgainBtn.setColor('#00e676'));
    playAgainBtn.on('pointerdown', () => {
      socketClient.off('room:state' as any, roomStateHandler as any);
      socketClient.emit('room:restart', (response: any) => {
        if (response.success && response.room) {
          this.registry.set('currentRoom', response.room);
          this.scene.start('LobbyScene');
        }
      });
    });

    // Back to lobby button
    const backBtn = this.add
      .text(width / 2 + 100, height - 40, '[ Back to Lobby ]', {
        fontSize: '20px',
        color: '#ff6b35',
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor('#ff8555'));
    backBtn.on('pointerout', () => backBtn.setColor('#ff6b35'));
    backBtn.on('pointerdown', () => {
      socketClient.emit('room:leave' as any);
      this.registry.remove('currentRoom');
      this.scene.start('LobbyScene');
    });

    this.buttons = [playAgainBtn, backBtn];
    this.baseColors = ['#00e676', '#ff6b35'];
    this.highlightColors = ['#66ffaa', '#ff8555'];

    // Underline graphic for gamepad selection
    this.underline = this.add.graphics();

    if (data?.placements) {
      const list: any[] = data.placements;
      const count = list.length;
      const startY = 140;
      const endY = height - 70;
      const spacing = Math.min(28, (endY - startY) / Math.max(count, 1));

      // Check if team mode (winnerTeam is set)
      const isTeamMode = data.winnerTeam !== null && data.winnerTeam !== undefined;
      const teamColors = ['#ff4466', '#448aff'];
      const teamNames = ['Red', 'Blue'];

      // Column layout
      const colName = width * 0.35;
      const colTeam = isTeamMode ? width * 0.6 : -1;
      const colScore = width * 0.75;

      // Header
      const hs = {
        fontSize: '13px',
        color: '#505068',
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      } as Phaser.Types.GameObjects.Text.TextStyle;
      this.add.text(colName, 115, 'PLAYER', hs).setOrigin(0.5);
      if (isTeamMode) this.add.text(colTeam, 115, 'TEAM', hs).setOrigin(0.5);
      this.add.text(colScore, 115, 'SCORE', hs).setOrigin(0.5);

      list.forEach((p: any, i: number) => {
        const y = startY + i * spacing;
        const medalColor =
          i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#707080';
        const dead = p.alive === false;
        const botTag = p.isBot ? ' [BOT]' : '';
        const name = (p.username || `Player ${p.userId}`) + botTag;
        const kills = p.kills ?? 0;

        const nameText = this.add
          .text(colName, y, name, { fontSize: '16px', color: dead ? '#555' : medalColor })
          .setOrigin(0.5);
        if (dead) {
          const lineY = nameText.y;
          const lineWidth = nameText.width;
          const line = this.add.graphics();
          line.lineStyle(1.5, 0x666666, 0.8);
          line.lineBetween(nameText.x - lineWidth / 2, lineY, nameText.x + lineWidth / 2, lineY);
          line.setDepth(1);
        }
        if (isTeamMode && p.team !== null && p.team !== undefined) {
          this.add
            .text(colTeam, y, teamNames[p.team], { fontSize: '14px', color: teamColors[p.team] })
            .setOrigin(0.5);
        }
        this.add
          .text(colScore, y, `${kills}`, { fontSize: '16px', color: dead ? '#555' : '#fff' })
          .setOrigin(0.5);
      });
    }
  }

  update(): void {
    if (this.buttons.length === 0) return;

    const gamepads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const gp of gamepads) {
      if (gp && gp.connected) {
        pad = gp;
        break;
      }
    }
    if (!pad) {
      this.prevA = false;
      this.prevLeft = false;
      this.prevRight = false;
      // Clear underline when no gamepad
      this.underline?.clear();
      return;
    }

    // Read left/right from D-pad and stick
    const dpadLeft = pad.buttons[14]?.pressed ?? false;
    const dpadRight = pad.buttons[15]?.pressed ?? false;
    const stickX = pad.axes[0] ?? 0;
    const leftPressed = dpadLeft || stickX < -DEADZONE;
    const rightPressed = dpadRight || stickX > DEADZONE;

    // Just-pressed detection for navigation
    if (leftPressed && !this.prevLeft) {
      this.selectedIndex =
        this.selectedIndex === 0 ? this.buttons.length - 1 : this.selectedIndex - 1;
      this.updateButtonHighlight();
    }
    if (rightPressed && !this.prevRight) {
      this.selectedIndex =
        this.selectedIndex >= this.buttons.length - 1 ? 0 : this.selectedIndex + 1;
      this.updateButtonHighlight();
    }
    this.prevLeft = leftPressed;
    this.prevRight = rightPressed;

    // A button confirm
    const aDown = pad.buttons[0]?.pressed ?? false;
    if (aDown && !this.prevA) {
      // If nothing highlighted yet, show highlight first
      if (!this.underline || this.underline.commandBuffer.length === 0) {
        this.updateButtonHighlight();
      } else {
        this.buttons[this.selectedIndex].emit('pointerdown');
      }
    }
    this.prevA = aDown;
  }

  private updateButtonHighlight(): void {
    // Reset all buttons to base colors
    for (let i = 0; i < this.buttons.length; i++) {
      this.buttons[i].setColor(this.baseColors[i]);
    }

    // Highlight selected
    const btn = this.buttons[this.selectedIndex];
    btn.setColor(this.highlightColors[this.selectedIndex]);

    // Draw underline
    if (this.underline) {
      this.underline.clear();
      const color = this.selectedIndex === 0 ? 0x00e676 : 0xff6b35;
      this.underline.lineStyle(2, color, 0.8);
      const halfW = btn.width / 2;
      this.underline.lineBetween(btn.x - halfW, btn.y + 14, btn.x + halfW, btn.y + 14);
    }
  }
}
