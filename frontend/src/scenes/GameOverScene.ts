import Phaser from 'phaser';
import { SocketClient } from '../network/SocketClient';
import { ApiClient } from '../network/ApiClient';
import { EloResult, AchievementUnlockEvent, XpUpdateResult } from '@blast-arena/shared';
import { themeManager } from '../themes/ThemeManager';

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
  private eloPlacementData: Map<number, number> = new Map(); // userId -> y position
  private eloColX = 0;
  private xpColX = 0;
  private achievementToasts: Phaser.GameObjects.Text[] = [];
  private hasVoted = false;
  private voteButton: Phaser.GameObjects.Text | null = null;
  private voteTallyText: Phaser.GameObjects.Text | null = null;

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
    this.eloPlacementData = new Map();
    this.eloColX = 0;
    this.xpColX = 0;
    this.achievementToasts = [];
    this.hasVoted = false;
    this.voteButton = null;
    this.voteTallyText = null;

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

    // Listen for Elo update results
    const eloHandler = (results: EloResult[]) => {
      socketClient.off('game:eloUpdate' as any, eloHandler as any);
      this.showEloResults(results);
    };
    socketClient.on('game:eloUpdate' as any, eloHandler as any);

    // Listen for XP update results
    const xpHandler = (results: XpUpdateResult[]) => {
      socketClient.off('game:xpUpdate' as any, xpHandler as any);
      this.showXpResults(results);
    };
    socketClient.on('game:xpUpdate' as any, xpHandler as any);

    // Listen for achievement unlocks
    const achievementHandler = (data: AchievementUnlockEvent) => {
      this.showAchievementUnlock(data);
    };
    socketClient.on('achievement:unlocked' as any, achievementHandler as any);

    // Listen for rematch vote updates
    const rematchUpdateHandler = (data: any) => {
      this.updateRematchUI(data);
    };
    socketClient.on('rematch:update' as any, rematchUpdateHandler as any);

    // Listen for rematch triggered (auto-restart)
    const rematchTriggeredHandler = () => {
      socketClient.off('room:state' as any, roomStateHandler as any);
      // The room:state 'waiting' event will follow — navigate on that
    };
    socketClient.on('rematch:triggered' as any, rematchTriggeredHandler as any);

    this.events.on('shutdown', () => {
      socketClient.off('room:state' as any, roomStateHandler as any);
      socketClient.off('game:eloUpdate' as any, eloHandler as any);
      socketClient.off('game:xpUpdate' as any, xpHandler as any);
      socketClient.off('achievement:unlocked' as any, achievementHandler as any);
      socketClient.off('rematch:update' as any, rematchUpdateHandler as any);
      socketClient.off('rematch:triggered' as any, rematchTriggeredHandler as any);
    });

    const colors = themeManager.getCanvasColors();

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);

    // Campaign results
    if (data?.campaignResult) {
      this.createCampaignGameOver(width, height, data, socketClient);
      return;
    }

    const gameText = this.add
      .text(0, 45, 'GAME ', {
        fontSize: '42px',
        color: colors.textHex,
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0.5);
    const overText = this.add
      .text(0, 45, 'OVER', {
        fontSize: '42px',
        color: colors.primaryHex,
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    const totalWidth = gameText.width + overText.width;
    gameText.setX(width / 2 - totalWidth / 2 + gameText.width);
    overText.setX(width / 2 - totalWidth / 2 + gameText.width);

    // Show reason text beneath game over
    if (data?.reason) {
      this.add
        .text(width / 2, 85, data.reason, {
          fontSize: '16px',
          color: colors.textDimHex,
          fontFamily: 'DM Sans, sans-serif',
        })
        .setOrigin(0.5);
    }

    // Determine if solo (only human player, rest are bots)
    const humanCount = data?.placements ? data.placements.filter((p: any) => !p.isBot).length : 2;
    const isSolo = humanCount <= 1;

    let actionBtn: Phaser.GameObjects.Text;

    if (isSolo) {
      // Solo with bots: direct Play Again (no voting needed)
      actionBtn = this.add
        .text(width / 2 - 100, height - 40, '[ Play Again ]', {
          fontSize: '20px',
          color: colors.textHex,
          fontFamily: 'Chakra Petch, sans-serif',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      actionBtn.on('pointerover', () => actionBtn.setColor('#cccccc'));
      actionBtn.on('pointerout', () => actionBtn.setColor(colors.textHex));
      actionBtn.on('pointerdown', () => {
        socketClient.emit('room:restart' as any, () => {});
      });

      this.voteTallyText = this.add.text(0, 0, '').setVisible(false);
    } else {
      // Multiplayer: Vote Rematch button
      actionBtn = this.add
        .text(width / 2 - 100, height - 40, '[ Vote Rematch ]', {
          fontSize: '20px',
          color: colors.textHex,
          fontFamily: 'Chakra Petch, sans-serif',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });

      actionBtn.on('pointerover', () =>
        actionBtn.setColor(this.hasVoted ? colors.successHoverHex : '#cccccc'),
      );
      actionBtn.on('pointerout', () =>
        actionBtn.setColor(this.hasVoted ? colors.successHex : colors.textHex),
      );
      actionBtn.on('pointerdown', () => {
        this.hasVoted = !this.hasVoted;
        socketClient.emit('rematch:vote' as any, { vote: this.hasVoted }, () => {});
        actionBtn.setText(this.hasVoted ? '[ Rematch ✓ ]' : '[ Vote Rematch ]');
        actionBtn.setColor(this.hasVoted ? colors.successHex : colors.textHex);
      });

      // Vote tally text
      this.voteTallyText = this.add
        .text(width / 2, height - 15, '', {
          fontSize: '13px',
          color: colors.textDimHex,
          fontFamily: 'DM Sans, sans-serif',
        })
        .setOrigin(0.5);
    }
    this.voteButton = actionBtn;

    // Back to lobby button
    const backBtn = this.add
      .text(width / 2 + 100, height - 40, '[ Back to Lobby ]', {
        fontSize: '20px',
        color: colors.primaryHex,
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor(colors.primaryHoverHex));
    backBtn.on('pointerout', () => backBtn.setColor(colors.primaryHex));
    backBtn.on('pointerdown', () => {
      socketClient.emit('room:leave' as any);
      this.registry.remove('currentRoom');
      this.scene.start('LobbyScene');
    });

    this.buttons = [actionBtn, backBtn];
    this.baseColors = [colors.textHex, colors.primaryHex];
    this.highlightColors = ['#cccccc', colors.primaryHoverHex];

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
      const colName = width * 0.22;
      const colTeam = isTeamMode ? width * 0.42 : -1;
      const colScore = isTeamMode ? width * 0.55 : width * 0.45;
      const colElo = isTeamMode ? width * 0.68 : width * 0.6;
      const colXp = isTeamMode ? width * 0.82 : width * 0.78;
      this.eloColX = colElo;
      this.xpColX = colXp;

      // Header
      const hs = {
        fontSize: '13px',
        color: colors.textMutedHex,
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      } as Phaser.Types.GameObjects.Text.TextStyle;
      this.add.text(colName, 115, 'PLAYER', hs).setOrigin(0.5);
      if (isTeamMode) this.add.text(colTeam, 115, 'TEAM', hs).setOrigin(0.5);
      this.add.text(colScore, 115, 'SCORE', hs).setOrigin(0.5);
      this.add.text(colElo, 115, 'ELO', hs).setOrigin(0.5);
      this.add.text(colXp, 115, 'XP', hs).setOrigin(0.5);

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
          .text(colScore, y, `${kills}`, {
            fontSize: '16px',
            color: dead ? '#555' : colors.textHex,
          })
          .setOrigin(0.5);

        // Track position for Elo display (skip bots)
        if (!p.isBot && p.userId) {
          this.eloPlacementData.set(p.userId, y);
        }
      });
    }
  }

  private createCampaignGameOver(
    width: number,
    height: number,
    data: any,
    socketClient: any,
  ): void {
    const colors = themeManager.getCanvasColors();
    const success = data.success;
    const titleColor = success ? colors.successHex : colors.dangerHex;
    const titleText = success ? 'LEVEL COMPLETE!' : 'LEVEL FAILED';

    this.add
      .text(width / 2, 50, titleText, {
        fontSize: '38px',
        color: titleColor,
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    if (success) {
      // Stars
      const stars = data.stars || 0;
      const starsText = '★'.repeat(stars) + '☆'.repeat(3 - stars);
      this.add
        .text(width / 2, 100, starsText, {
          fontSize: '32px',
          color: '#ffdd44',
          fontFamily: 'Chakra Petch, sans-serif',
        })
        .setOrigin(0.5);

      // Time
      const mins = Math.floor((data.timeSeconds || 0) / 60);
      const secs = (data.timeSeconds || 0) % 60;
      this.add
        .text(width / 2, 145, `Time: ${mins}:${secs.toString().padStart(2, '0')}`, {
          fontSize: '18px',
          color: colors.textDimHex,
          fontFamily: 'DM Sans, sans-serif',
        })
        .setOrigin(0.5);

      // Next Level button
      if (data.nextLevelId) {
        const nextBtn = this.add
          .text(width / 2 - 120, height - 40, '[ Next Level ]', {
            fontSize: '20px',
            color: colors.successHex,
            fontFamily: 'Chakra Petch, sans-serif',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        nextBtn.on('pointerover', () => nextBtn.setColor(colors.successHoverHex));
        nextBtn.on('pointerout', () => nextBtn.setColor(colors.successHex));
        nextBtn.on('pointerdown', () => {
          this.startCampaignLevel(data.nextLevelId, socketClient);
        });
        this.buttons.push(nextBtn);
        this.baseColors.push(colors.successHex);
        this.highlightColors.push(colors.successHoverHex);
      }
    } else {
      // Reason
      if (data.reason) {
        this.add
          .text(width / 2, 100, data.reason, {
            fontSize: '18px',
            color: colors.textDimHex,
            fontFamily: 'DM Sans, sans-serif',
          })
          .setOrigin(0.5);
      }
    }

    // Retry button
    const retryBtn = this.add
      .text(width / 2, height - 40, '[ Retry ]', {
        fontSize: '20px',
        color: colors.textHex,
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    retryBtn.on('pointerover', () => retryBtn.setColor('#cccccc'));
    retryBtn.on('pointerout', () => retryBtn.setColor(colors.textHex));
    retryBtn.on('pointerdown', () => {
      if (data?.campaignResult) {
        this.startCampaignLevel(data.levelId, socketClient);
      } else {
        this.scene.start('LobbyScene');
      }
    });

    // Back to Campaign button
    const backBtn = this.add
      .text(width / 2 + 120, height - 40, '[ Campaign ]', {
        fontSize: '20px',
        color: colors.primaryHex,
        fontFamily: 'Chakra Petch, sans-serif',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backBtn.on('pointerover', () => backBtn.setColor(colors.primaryHoverHex));
    backBtn.on('pointerout', () => backBtn.setColor(colors.primaryHex));
    backBtn.on('pointerdown', () => {
      this.registry.remove('campaignMode');
      this.registry.set('openCampaign', true);
      this.scene.start('LobbyScene');
    });

    this.buttons = [retryBtn, backBtn];
    this.baseColors = [colors.textHex, colors.primaryHex];
    this.highlightColors = ['#cccccc', colors.primaryHoverHex];
    this.underline = this.add.graphics();
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

  private startCampaignLevel(levelId: number, socketClient: SocketClient): void {
    // Fetch enemy types, then emit campaign:start and transition directly to GameScene
    ApiClient.get<any>('/campaign/enemy-types')
      .then((enemyTypesResp) => {
        const gameStartHandler = (data: any) => {
          socketClient.off('campaign:gameStart' as any, gameStartHandler as any);

          const registry = this.registry;
          registry.set('campaignMode', true);
          registry.set('initialGameState', data.state.gameState);
          registry.set('campaignEnemyTypes', enemyTypesResp.enemyTypes || []);

          this.scene.start('GameScene');
          this.scene.launch('HUDScene');
        };
        socketClient.on('campaign:gameStart' as any, gameStartHandler as any);

        socketClient.emit('campaign:start' as any, { levelId }, (response: any) => {
          if (response && response.error) {
            socketClient.off('campaign:gameStart' as any, gameStartHandler as any);
            this.registry.remove('campaignMode');
            this.scene.start('LobbyScene');
          }
        });
      })
      .catch(() => {
        this.registry.remove('campaignMode');
        this.scene.start('LobbyScene');
      });
  }

  private showEloResults(results: EloResult[]): void {
    const colors = themeManager.getCanvasColors();
    for (const result of results) {
      const y = this.eloPlacementData.get(result.userId);
      if (y === undefined) continue;

      const delta = result.delta;
      const sign = delta >= 0 ? '+' : '';
      const color = delta >= 0 ? colors.successHex : colors.dangerHex;
      const text = this.add
        .text(this.eloColX, y, `${sign}${delta}`, {
          fontSize: '15px',
          color,
          fontFamily: 'DM Sans, sans-serif',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setAlpha(0);

      // Fade in
      this.tweens.add({
        targets: text,
        alpha: 1,
        y: y - 2,
        duration: 400,
        ease: 'Power2',
      });
    }
  }

  private showAchievementUnlock(data: AchievementUnlockEvent): void {
    const width = this.cameras.main.width;
    const colors = themeManager.getCanvasColors();

    for (let i = 0; i < data.achievements.length; i++) {
      const achievement = data.achievements[i];
      const yOffset = 20 + i * 40;

      const label = `${achievement.icon} ${achievement.name}`;
      const toast = this.add
        .text(width / 2, yOffset, label, {
          fontSize: '16px',
          color: '#ffdd44',
          fontFamily: 'Chakra Petch, sans-serif',
          fontStyle: 'bold',
          backgroundColor: colors.bgSurfaceHex,
          padding: { x: 12, y: 6 },
        })
        .setOrigin(0.5)
        .setAlpha(0)
        .setDepth(20);

      this.achievementToasts.push(toast);

      // Slide down + fade in, then fade out after delay
      this.tweens.add({
        targets: toast,
        alpha: 1,
        y: yOffset + 15,
        duration: 500,
        ease: 'Back.easeOut',
        delay: i * 300,
        onComplete: () => {
          this.tweens.add({
            targets: toast,
            alpha: 0,
            y: toast.y - 10,
            duration: 800,
            delay: 3000,
            ease: 'Power2',
          });
        },
      });
    }
  }

  private showXpResults(results: XpUpdateResult[]): void {
    const width = this.cameras.main.width;
    const colors = themeManager.getCanvasColors();

    for (const result of results) {
      const y = this.eloPlacementData.get(result.userId);
      if (y === undefined) continue;

      const text = this.add
        .text(this.xpColX, y, `+${result.xpGained}`, {
          fontSize: '15px',
          color: '#ffdd44',
          fontFamily: 'DM Sans, sans-serif',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setAlpha(0);

      this.tweens.add({
        targets: text,
        alpha: 1,
        y: y - 2,
        duration: 400,
        ease: 'Power2',
        delay: 200,
      });

      // Level up toast
      if (result.newLevel > result.oldLevel) {
        const lvlToast = this.add
          .text(width / 2, 0, `LEVEL UP! → Level ${result.newLevel}`, {
            fontSize: '18px',
            color: '#ffdd44',
            fontFamily: 'Chakra Petch, sans-serif',
            fontStyle: 'bold',
            backgroundColor: colors.bgSurfaceHex,
            padding: { x: 16, y: 8 },
          })
          .setOrigin(0.5)
          .setAlpha(0)
          .setDepth(25);

        // Find a free toast slot
        const toastY = 20 + this.achievementToasts.length * 40;
        this.achievementToasts.push(lvlToast);

        this.tweens.add({
          targets: lvlToast,
          alpha: 1,
          y: toastY + 15,
          duration: 500,
          ease: 'Back.easeOut',
          delay: 500,
          onComplete: () => {
            this.tweens.add({
              targets: lvlToast,
              alpha: 0,
              y: lvlToast.y - 10,
              duration: 800,
              delay: 3000,
              ease: 'Power2',
            });
          },
        });
      }
    }
  }

  private updateRematchUI(data: {
    votes: { userId: number; username: string; vote: boolean }[];
    threshold: number;
    totalPlayers: number;
  }): void {
    if (!this.voteTallyText) return;
    const yesCount = data.votes.filter((v) => v.vote).length;
    this.voteTallyText.setText(`${yesCount}/${data.totalPlayers} voted rematch`);
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
      const c = themeManager.getCanvasColors();
      const color = this.selectedIndex === 0 ? c.success : c.primary;
      this.underline.lineStyle(2, color, 0.8);
      const halfW = btn.width / 2;
      this.underline.lineBetween(btn.x - halfW, btn.y + 14, btn.x + halfW, btn.y + 14);
    }
  }
}
