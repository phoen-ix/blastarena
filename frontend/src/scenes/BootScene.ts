import Phaser from 'phaser';
import { themeManager } from '../themes/ThemeManager';
import { POWERUP_ICON_DRAWERS } from '../utils/powerUpIcons';
import { generateHazardTileTextures } from '../utils/campaignThemes';

export const PLAYER_COLORS = [
  0xe94560, 0x44aaff, 0x44ff44, 0xff8800, 0xcc44ff, 0xffff44, 0xff44ff, 0x44ffff,
];

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x2a2a48, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 15, 320, 30);

    const colors = themeManager.getCanvasColors();
    const loadingText = this.add
      .text(width / 2, height / 2 - 40, 'Loading...', {
        fontSize: '18px',
        color: colors.primaryHex,
      })
      .setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(colors.primary, 1);
      progressBar.fillRect(width / 2 - 155, height / 2 - 10, 310 * value, 20);
    });

    this.load.on('complete', () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    this.generateTextures();
  }

  private generateTextures(): void {
    this.generatePlayerTextures();
    this.generateTileTextures();
    this.generateBombTexture();
    this.generateExplosionTexture();
    this.generatePowerUpTextures();
    this.generateParticleTextures();
    this.generateMeteorTexture();
  }

  private generatePlayerTextures(): void {
    const directions: string[] = ['down', 'up', 'left', 'right'];
    // Eye positions relative to center for each direction
    const eyeOffsets: Record<
      string,
      { lx: number; ly: number; rx: number; ry: number; px: number; py: number }
    > = {
      down: { lx: -7, ly: 2, rx: 7, ry: 2, px: 0, py: 2 },
      up: { lx: -7, ly: -4, rx: 7, ry: -4, px: 0, py: -2 },
      left: { lx: -8, ly: -1, rx: -1, ry: -1, px: -2, py: 0 },
      right: { lx: 1, ly: -1, rx: 8, ry: -1, px: 2, py: 0 },
    };

    PLAYER_COLORS.forEach((color, i) => {
      for (const dir of directions) {
        const gfx = this.make.graphics({ x: 0, y: 0 });
        const cx = 24,
          cy = 24;

        // Body gradient: darker bottom, lighter top
        const darkerColor = Phaser.Display.Color.IntegerToColor(color).darken(20).color;
        gfx.fillStyle(darkerColor, 1);
        gfx.fillRoundedRect(2, 2, 44, 44, 6);
        gfx.fillStyle(color, 1);
        gfx.fillRoundedRect(2, 2, 44, 36, 6);

        // Border
        gfx.lineStyle(2, 0xffffff, 0.4);
        gfx.strokeRoundedRect(2, 2, 44, 44, 6);

        // Highlight shine
        gfx.fillStyle(0xffffff, 0.3);
        gfx.fillRoundedRect(6, 5, 10, 6, 3);

        // Eyes (white sclera)
        const offsets = eyeOffsets[dir] || eyeOffsets.down;
        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(cx + offsets.lx, cy + offsets.ly, 5);
        gfx.fillCircle(cx + offsets.rx, cy + offsets.ry, 5);

        // Pupils
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + offsets.lx + offsets.px, cy + offsets.ly + offsets.py, 2.5);
        gfx.fillCircle(cx + offsets.rx + offsets.px, cy + offsets.ry + offsets.py, 2.5);

        gfx.generateTexture(`player_${i}_${dir}`, 48, 48);
        gfx.destroy();
      }

      // Also generate a generic player texture for backwards compat
      const gfx = this.make.graphics({ x: 0, y: 0 });
      const darkerColor = Phaser.Display.Color.IntegerToColor(color).darken(20).color;
      gfx.fillStyle(darkerColor, 1);
      gfx.fillRoundedRect(2, 2, 44, 44, 6);
      gfx.fillStyle(color, 1);
      gfx.fillRoundedRect(2, 2, 44, 36, 6);
      gfx.lineStyle(2, 0xffffff, 0.4);
      gfx.strokeRoundedRect(2, 2, 44, 44, 6);
      gfx.fillStyle(0xffffff, 0.3);
      gfx.fillRoundedRect(6, 5, 10, 6, 3);
      gfx.fillStyle(0xffffff, 0.95);
      gfx.fillCircle(17, 26, 5);
      gfx.fillCircle(31, 26, 5);
      gfx.fillStyle(0x111111, 1);
      gfx.fillCircle(17, 28, 2.5);
      gfx.fillCircle(31, 28, 2.5);
      gfx.generateTexture(`player_${i}`, 48, 48);
      gfx.destroy();
    });
  }

  private generateTileTextures(): void {
    // Indestructible wall with bevel/3D effect
    const wallGfx = this.make.graphics({ x: 0, y: 0 });
    wallGfx.fillStyle(0x333355, 1);
    wallGfx.fillRect(0, 0, 48, 48);
    // 3D bevel: lighter top-left edges
    wallGfx.fillStyle(0x444477, 1);
    wallGfx.fillRect(0, 0, 48, 2); // top
    wallGfx.fillRect(0, 0, 2, 48); // left
    // Darker bottom-right edges
    wallGfx.fillStyle(0x222244, 1);
    wallGfx.fillRect(0, 46, 48, 2); // bottom
    wallGfx.fillRect(46, 0, 2, 48); // right
    // Checkerboard pattern
    wallGfx.fillStyle(0x444466, 1);
    wallGfx.fillRect(4, 4, 18, 18);
    wallGfx.fillRect(26, 26, 18, 18);
    // Inner highlight
    wallGfx.fillStyle(0x555577, 0.3);
    wallGfx.fillRect(6, 6, 8, 8);
    wallGfx.fillRect(28, 28, 8, 8);
    wallGfx.generateTexture('wall', 48, 48);
    wallGfx.destroy();

    // Destructible wall with cracks
    const destGfx = this.make.graphics({ x: 0, y: 0 });
    destGfx.fillStyle(0x886633, 1);
    destGfx.fillRect(0, 0, 48, 48);
    // Bevel
    destGfx.fillStyle(0x997744, 1);
    destGfx.fillRect(0, 0, 48, 2);
    destGfx.fillRect(0, 0, 2, 48);
    destGfx.fillStyle(0x664422, 1);
    destGfx.fillRect(0, 46, 48, 2);
    destGfx.fillRect(46, 0, 2, 48);
    // Brick lines
    destGfx.lineStyle(1, 0x664422, 0.6);
    destGfx.lineBetween(0, 16, 48, 16);
    destGfx.lineBetween(0, 32, 48, 32);
    destGfx.lineBetween(24, 0, 24, 16);
    destGfx.lineBetween(12, 16, 12, 32);
    destGfx.lineBetween(36, 16, 36, 32);
    destGfx.lineBetween(24, 32, 24, 48);
    // Crack details
    destGfx.lineStyle(1, 0x553311, 0.3);
    destGfx.lineBetween(8, 4, 14, 12);
    destGfx.lineBetween(34, 20, 42, 28);
    destGfx.generateTexture('destructible', 48, 48);
    destGfx.destroy();

    // Cracked destructible wall (multi-hit)
    const crackGfx = this.make.graphics({ x: 0, y: 0 });
    crackGfx.fillStyle(0x775522, 1);
    crackGfx.fillRect(0, 0, 48, 48);
    crackGfx.fillStyle(0x886633, 1);
    crackGfx.fillRect(0, 0, 48, 2);
    crackGfx.fillRect(0, 0, 2, 48);
    crackGfx.fillStyle(0x553311, 1);
    crackGfx.fillRect(0, 46, 48, 2);
    crackGfx.fillRect(46, 0, 2, 48);
    crackGfx.lineStyle(1, 0x553311, 0.6);
    crackGfx.lineBetween(0, 16, 48, 16);
    crackGfx.lineBetween(0, 32, 48, 32);
    crackGfx.lineBetween(24, 0, 24, 16);
    crackGfx.lineBetween(12, 16, 12, 32);
    crackGfx.lineBetween(36, 16, 36, 32);
    crackGfx.lineBetween(24, 32, 24, 48);
    // Heavy cracks
    crackGfx.lineStyle(2, 0x332211, 0.7);
    crackGfx.lineBetween(6, 2, 20, 14);
    crackGfx.lineBetween(20, 14, 18, 28);
    crackGfx.lineBetween(30, 18, 44, 34);
    crackGfx.lineBetween(44, 34, 38, 46);
    crackGfx.lineBetween(10, 34, 24, 44);
    crackGfx.generateTexture('destructible_cracked', 48, 48);
    crackGfx.destroy();

    // Floor tiles (4 variants for variety)
    for (let v = 0; v < 4; v++) {
      const floorGfx = this.make.graphics({ x: 0, y: 0 });
      const baseShade = 0x2a2a3e + v * 0x010102;
      floorGfx.fillStyle(baseShade, 1);
      floorGfx.fillRect(0, 0, 48, 48);
      floorGfx.lineStyle(1, 0x333348, 0.2);
      floorGfx.strokeRect(0, 0, 48, 48);
      // Subtle dot pattern varies by variant
      if (v === 1 || v === 3) {
        floorGfx.fillStyle(0x333348, 0.15);
        floorGfx.fillCircle(12, 12, 1);
        floorGfx.fillCircle(36, 36, 1);
      }
      if (v === 2 || v === 3) {
        floorGfx.fillStyle(0x333348, 0.1);
        floorGfx.fillCircle(36, 12, 1);
        floorGfx.fillCircle(12, 36, 1);
      }
      floorGfx.generateTexture(`floor_${v}`, 48, 48);
      floorGfx.destroy();
    }
    // Default floor for compat
    const floorGfx = this.make.graphics({ x: 0, y: 0 });
    floorGfx.fillStyle(0x2a2a3e, 1);
    floorGfx.fillRect(0, 0, 48, 48);
    floorGfx.lineStyle(1, 0x333348, 0.3);
    floorGfx.strokeRect(0, 0, 48, 48);
    floorGfx.generateTexture('floor', 48, 48);
    floorGfx.destroy();

    // Teleporter textures
    for (const suffix of ['a', 'b']) {
      const tpGfx = this.make.graphics({ x: 0, y: 0 });
      // Floor base
      tpGfx.fillStyle(0x2a2a3e, 1);
      tpGfx.fillRect(0, 0, 48, 48);
      // Glowing pad
      const padColor = suffix === 'a' ? 0x44aaff : 0xff8844;
      tpGfx.fillStyle(padColor, 0.15);
      tpGfx.fillCircle(24, 24, 20);
      tpGfx.fillStyle(padColor, 0.3);
      tpGfx.fillCircle(24, 24, 14);
      tpGfx.fillStyle(padColor, 0.5);
      tpGfx.fillCircle(24, 24, 8);
      tpGfx.lineStyle(2, padColor, 0.6);
      tpGfx.strokeCircle(24, 24, 18);
      // Swirl indicator
      tpGfx.lineStyle(1, padColor, 0.4);
      tpGfx.beginPath();
      tpGfx.arc(24, 24, 10, 0, Math.PI, true);
      tpGfx.strokePath();
      tpGfx.beginPath();
      tpGfx.arc(24, 24, 10, Math.PI, Math.PI * 2, true);
      tpGfx.strokePath();
      tpGfx.generateTexture(`teleporter_${suffix}`, 48, 48);
      tpGfx.destroy();
    }

    // Conveyor textures — animated moving stripes
    const CONVEYOR_FRAMES = 4;
    const CONVEYOR_FPS = 8;
    const STRIPE_W = 8; // stripe band width; full cycle = STRIPE_W * 2 = 16px
    const conveyorDirs: Record<string, { horizontal: boolean; positive: boolean }> = {
      up: { horizontal: false, positive: false },
      down: { horizontal: false, positive: true },
      left: { horizontal: true, positive: false },
      right: { horizontal: true, positive: true },
    };
    const chevronAngles: Record<string, number> = {
      up: -Math.PI / 2,
      down: Math.PI / 2,
      left: Math.PI,
      right: 0,
    };
    for (const [dir, { horizontal, positive }] of Object.entries(conveyorDirs)) {
      for (let f = 0; f < CONVEYOR_FRAMES; f++) {
        const gfx = this.make.graphics({ x: 0, y: 0 });
        // Background
        gfx.fillStyle(0x2a2a3e, 1);
        gfx.fillRect(0, 0, 48, 48);
        gfx.fillStyle(0x3a3a4e, 0.5);
        gfx.fillRect(2, 2, 44, 44);
        // Stripe offset: each frame shifts by (cycle / frames) pixels
        const cycle = STRIPE_W * 2;
        const rawOffset = (f / CONVEYOR_FRAMES) * cycle;
        const offset = positive ? rawOffset : -rawOffset;
        // Draw stripe bands perpendicular to movement
        gfx.fillStyle(0x88aacc, 0.35);
        if (horizontal) {
          // Vertical stripe bands moving left/right
          for (let sx = -cycle; sx < 48 + cycle; sx += cycle) {
            const x0 = sx + (((offset % cycle) + cycle) % cycle);
            gfx.fillRect(x0, 0, STRIPE_W, 48);
          }
        } else {
          // Horizontal stripe bands moving up/down
          for (let sy = -cycle; sy < 48 + cycle; sy += cycle) {
            const y0 = sy + (((offset % cycle) + cycle) % cycle);
            gfx.fillRect(0, y0, 48, STRIPE_W);
          }
        }
        // Small center chevron arrow for direction hint
        const angle = chevronAngles[dir];
        const ax = Math.cos(angle) * 5;
        const ay = Math.sin(angle) * 5;
        const px = Math.cos(angle + Math.PI / 2);
        const py = Math.sin(angle + Math.PI / 2);
        gfx.lineStyle(2, 0x88aacc, 0.5);
        gfx.beginPath();
        gfx.moveTo(24 + ax, 24 + ay);
        gfx.lineTo(24 - ax * 0.4 + px * 4, 24 - ay * 0.4 + py * 4);
        gfx.moveTo(24 + ax, 24 + ay);
        gfx.lineTo(24 - ax * 0.4 - px * 4, 24 - ay * 0.4 - py * 4);
        gfx.strokePath();
        // Frame 0 keeps the base key for backward compatibility
        const key = f === 0 ? `conveyor_${dir}` : `conveyor_${dir}_${f}`;
        gfx.generateTexture(key, 48, 48);
        gfx.destroy();
      }
      // Create looping animation
      this.anims.create({
        key: `conveyor_${dir}_anim`,
        frames: Array.from({ length: CONVEYOR_FRAMES }, (_, i) => ({
          key: i === 0 ? `conveyor_${dir}` : `conveyor_${dir}_${i}`,
        })),
        frameRate: CONVEYOR_FPS,
        repeat: -1,
      });
    }

    // Exit tile (trapdoor)
    const exitGfx = this.make.graphics({ x: 0, y: 0 });
    exitGfx.fillStyle(0x2a2a3e, 1);
    exitGfx.fillRect(0, 0, 48, 48);
    exitGfx.fillStyle(0x4a3a2e, 1);
    exitGfx.fillRoundedRect(6, 6, 36, 36, 4);
    exitGfx.fillStyle(0x3a2a1e, 1);
    exitGfx.fillRoundedRect(8, 8, 32, 32, 3);
    // Door handle
    exitGfx.fillStyle(0xccaa44, 1);
    exitGfx.fillCircle(30, 24, 3);
    // Arrow down indicator
    exitGfx.fillStyle(0x44ff44, 0.7);
    exitGfx.fillTriangle(24, 34, 18, 26, 30, 26);
    exitGfx.generateTexture('exit', 48, 48);
    exitGfx.destroy();

    // Goal tile (star marker)
    const goalGfx = this.make.graphics({ x: 0, y: 0 });
    goalGfx.fillStyle(0x2a2a3e, 1);
    goalGfx.fillRect(0, 0, 48, 48);
    goalGfx.fillStyle(0xffcc00, 0.2);
    goalGfx.fillCircle(24, 24, 18);
    goalGfx.fillStyle(0xffcc00, 0.4);
    goalGfx.fillCircle(24, 24, 12);
    // Star shape
    goalGfx.fillStyle(0xffdd44, 0.9);
    goalGfx.fillTriangle(24, 12, 27, 20, 35, 20);
    goalGfx.fillTriangle(24, 12, 21, 20, 13, 20);
    goalGfx.fillTriangle(24, 36, 27, 28, 35, 28);
    goalGfx.fillTriangle(24, 36, 21, 28, 13, 28);
    goalGfx.fillTriangle(13, 20, 17, 24, 13, 28);
    goalGfx.fillTriangle(35, 20, 31, 24, 35, 28);
    goalGfx.generateTexture('goal', 48, 48);
    goalGfx.destroy();

    // Puzzle tile textures
    this.generatePuzzleTileTextures();
  }

  private generatePuzzleTileTextures(): void {
    const puzzleColors: Record<string, number> = {
      red: 0xff4444,
      blue: 0x4488ff,
      green: 0x44cc66,
      yellow: 0xffcc44,
    };

    // Switch textures (4 colors × 2 states)
    for (const [colorName, colorVal] of Object.entries(puzzleColors)) {
      const brighterColor = Phaser.Display.Color.IntegerToColor(colorVal).lighten(30).color;
      const darkerColor = Phaser.Display.Color.IntegerToColor(colorVal).darken(30).color;

      // Inactive switch
      const swGfx = this.make.graphics({ x: 0, y: 0 });
      // Floor base
      swGfx.fillStyle(0x2a2a3e, 1);
      swGfx.fillRect(0, 0, 48, 48);
      swGfx.lineStyle(1, 0x333348, 0.2);
      swGfx.strokeRect(0, 0, 48, 48);
      // Circular pressure plate
      swGfx.fillStyle(colorVal, 0.5);
      swGfx.fillCircle(24, 24, 16);
      // Border ring
      swGfx.lineStyle(2, colorVal, 0.6);
      swGfx.strokeCircle(24, 24, 16);
      // Center gem/button
      swGfx.fillStyle(brighterColor, 0.8);
      swGfx.fillCircle(24, 24, 6);
      // Inner highlight
      swGfx.fillStyle(0xffffff, 0.2);
      swGfx.fillCircle(22, 22, 3);
      swGfx.generateTexture(`switch_${colorName}`, 48, 48);
      swGfx.destroy();

      // Active switch
      const swActGfx = this.make.graphics({ x: 0, y: 0 });
      // Floor base
      swActGfx.fillStyle(0x2a2a3e, 1);
      swActGfx.fillRect(0, 0, 48, 48);
      swActGfx.lineStyle(1, 0x333348, 0.2);
      swActGfx.strokeRect(0, 0, 48, 48);
      // Sunken pressure plate (darker shade)
      swActGfx.fillStyle(darkerColor, 0.5);
      swActGfx.fillCircle(24, 24, 16);
      // Glow aura
      swActGfx.fillStyle(colorVal, 0.2);
      swActGfx.fillCircle(24, 24, 20);
      // Border ring
      swActGfx.lineStyle(2, colorVal, 0.8);
      swActGfx.strokeCircle(24, 24, 16);
      // Center gem/button (larger, brighter when active)
      swActGfx.fillStyle(brighterColor, 1);
      swActGfx.fillCircle(24, 24, 8);
      // Inner highlight
      swActGfx.fillStyle(0xffffff, 0.35);
      swActGfx.fillCircle(22, 21, 4);
      swActGfx.generateTexture(`switch_${colorName}_active`, 48, 48);
      swActGfx.destroy();
    }

    // Gate textures (4 colors × 2 states)
    for (const [colorName, colorVal] of Object.entries(puzzleColors)) {
      const darkerColor = Phaser.Display.Color.IntegerToColor(colorVal).darken(20).color;

      // Closed gate (portcullis bars)
      const gateGfx = this.make.graphics({ x: 0, y: 0 });
      // Dark background
      gateGfx.fillStyle(0x2a2a40, 1);
      gateGfx.fillRect(0, 0, 48, 48);
      // Vertical bars
      gateGfx.lineStyle(4, colorVal, 0.8);
      for (let i = 0; i < 5; i++) {
        const bx = 6 + i * 9;
        gateGfx.lineBetween(bx, 2, bx, 46);
      }
      // Horizontal crossbars
      gateGfx.lineStyle(3, darkerColor, 0.7);
      gateGfx.lineBetween(2, 16, 46, 16);
      gateGfx.lineBetween(2, 32, 46, 32);
      // Top/bottom frame
      gateGfx.fillStyle(darkerColor, 0.6);
      gateGfx.fillRect(0, 0, 48, 3);
      gateGfx.fillRect(0, 45, 48, 3);
      gateGfx.generateTexture(`gate_${colorName}`, 48, 48);
      gateGfx.destroy();

      // Open gate (retracted bar stubs at top)
      const gateOpenGfx = this.make.graphics({ x: 0, y: 0 });
      // Floor base (same as empty tile)
      gateOpenGfx.fillStyle(0x2a2a3e, 1);
      gateOpenGfx.fillRect(0, 0, 48, 48);
      gateOpenGfx.lineStyle(1, 0x333348, 0.2);
      gateOpenGfx.strokeRect(0, 0, 48, 48);
      // Small retracted bar stubs at top edge
      gateOpenGfx.lineStyle(3, colorVal, 0.35);
      for (let i = 0; i < 5; i++) {
        const bx = 6 + i * 9;
        gateOpenGfx.lineBetween(bx, 0, bx, 6);
      }
      // Top frame remnant
      gateOpenGfx.fillStyle(colorVal, 0.2);
      gateOpenGfx.fillRect(0, 0, 48, 2);
      gateOpenGfx.generateTexture(`gate_${colorName}_open`, 48, 48);
      gateOpenGfx.destroy();
    }

    // Crumbling floor texture
    const crumbleGfx = this.make.graphics({ x: 0, y: 0 });
    // Brownish-tinted floor base
    crumbleGfx.fillStyle(0x33302e, 1);
    crumbleGfx.fillRect(0, 0, 48, 48);
    crumbleGfx.lineStyle(1, 0x333348, 0.2);
    crumbleGfx.strokeRect(0, 0, 48, 48);
    // Crack lines
    crumbleGfx.lineStyle(2, 0x1a1a28, 0.7);
    crumbleGfx.lineBetween(8, 6, 18, 20);
    crumbleGfx.lineBetween(18, 20, 14, 34);
    crumbleGfx.lineBetween(14, 34, 22, 44);
    crumbleGfx.lineStyle(1.5, 0x1a1a28, 0.6);
    crumbleGfx.lineBetween(32, 4, 38, 16);
    crumbleGfx.lineBetween(38, 16, 34, 28);
    crumbleGfx.lineStyle(1, 0x1a1a28, 0.5);
    crumbleGfx.lineBetween(18, 20, 30, 22);
    crumbleGfx.lineBetween(26, 36, 40, 42);
    // Debris dots near cracks
    crumbleGfx.fillStyle(0x1a1a28, 0.4);
    crumbleGfx.fillCircle(16, 22, 1.5);
    crumbleGfx.fillCircle(20, 18, 1);
    crumbleGfx.fillCircle(36, 14, 1);
    crumbleGfx.fillCircle(32, 26, 1.5);
    crumbleGfx.fillCircle(14, 38, 1);
    crumbleGfx.fillCircle(28, 40, 1);
    crumbleGfx.generateTexture('crumbling', 48, 48);
    crumbleGfx.destroy();

    // Pit texture (dark void)
    const pitGfx = this.make.graphics({ x: 0, y: 0 });
    // Very dark void center
    pitGfx.fillStyle(0x0a0a12, 1);
    pitGfx.fillRect(0, 0, 48, 48);
    // Slightly lighter rim for depth effect
    pitGfx.lineStyle(3, 0x1a1a2e, 0.6);
    pitGfx.strokeRect(2, 2, 44, 44);
    pitGfx.lineStyle(1, 0x222240, 0.3);
    pitGfx.strokeRect(5, 5, 38, 38);
    // Inner shadow gradient — darker center
    pitGfx.fillStyle(0x050508, 0.5);
    pitGfx.fillCircle(24, 24, 16);
    pitGfx.fillStyle(0x020204, 0.4);
    pitGfx.fillCircle(24, 24, 10);
    // Small highlight dots at edges for depth
    pitGfx.fillStyle(0x2a2a44, 0.3);
    pitGfx.fillCircle(6, 6, 1.5);
    pitGfx.fillCircle(42, 6, 1.5);
    pitGfx.fillCircle(6, 42, 1.5);
    pitGfx.fillCircle(42, 42, 1.5);
    pitGfx.fillStyle(0x2a2a44, 0.2);
    pitGfx.fillCircle(24, 4, 1);
    pitGfx.fillCircle(24, 44, 1);
    pitGfx.fillCircle(4, 24, 1);
    pitGfx.fillCircle(44, 24, 1);
    pitGfx.generateTexture('pit', 48, 48);
    pitGfx.destroy();

    // Hazard tile textures (vine, quicksand, ice, lava, mud, spikes, dark_rift)
    generateHazardTileTextures(this);
  }

  private generateBombTexture(): void {
    const bombGfx = this.make.graphics({ x: 0, y: 0 });
    // Body with gradient
    bombGfx.fillStyle(0x111111, 1);
    bombGfx.fillCircle(24, 26, 16);
    bombGfx.fillStyle(0x222222, 1);
    bombGfx.fillCircle(22, 23, 12);
    // Metallic highlight
    bombGfx.fillStyle(0x444444, 0.6);
    bombGfx.fillCircle(18, 20, 4);
    // Fuse line
    bombGfx.lineStyle(2, 0x886644, 1);
    bombGfx.beginPath();
    bombGfx.moveTo(24, 10);
    bombGfx.lineTo(28, 6);
    bombGfx.lineTo(30, 8);
    bombGfx.strokePath();
    // Fuse tip
    bombGfx.fillStyle(0xff4400, 1);
    bombGfx.fillCircle(30, 7, 4);
    bombGfx.fillStyle(0xffaa00, 0.8);
    bombGfx.fillCircle(30, 7, 2);
    bombGfx.generateTexture('bomb', 48, 48);
    bombGfx.destroy();

    // Remote bomb variant (blue tint)
    const remGfx = this.make.graphics({ x: 0, y: 0 });
    remGfx.fillStyle(0x111133, 1);
    remGfx.fillCircle(24, 26, 16);
    remGfx.fillStyle(0x222244, 1);
    remGfx.fillCircle(22, 23, 12);
    remGfx.fillStyle(0x4444aa, 0.6);
    remGfx.fillCircle(18, 20, 4);
    remGfx.lineStyle(2, 0x6666aa, 1);
    remGfx.beginPath();
    remGfx.moveTo(24, 10);
    remGfx.lineTo(28, 6);
    remGfx.strokePath();
    // Antenna indicator
    remGfx.fillStyle(0x4488ff, 1);
    remGfx.fillCircle(28, 5, 3);
    remGfx.generateTexture('bomb_remote', 48, 48);
    remGfx.destroy();
  }

  private generateExplosionTexture(): void {
    const expGfx = this.make.graphics({ x: 0, y: 0 });
    // Radial gradient: bright center to dark edge
    expGfx.fillStyle(0xff2200, 0.6);
    expGfx.fillCircle(24, 24, 22);
    expGfx.fillStyle(0xff6600, 0.7);
    expGfx.fillCircle(24, 24, 16);
    expGfx.fillStyle(0xffaa00, 0.8);
    expGfx.fillCircle(24, 24, 10);
    expGfx.fillStyle(0xffff44, 0.9);
    expGfx.fillCircle(24, 24, 5);
    expGfx.generateTexture('explosion', 48, 48);
    expGfx.destroy();
  }

  private generatePowerUpTextures(): void {
    const defs: Record<string, { color: string }> = {
      bomb_up: { color: '#ff4444' },
      fire_up: { color: '#ff8800' },
      speed_up: { color: '#44aaff' },
      shield: { color: '#44ff44' },
      kick: { color: '#cc44ff' },
      pierce_bomb: { color: '#ff2222' },
      remote_bomb: { color: '#4488ff' },
      line_bomb: { color: '#ffaa44' },
      bomb_throw: { color: '#ff66ff' },
    };

    for (const [type, def] of Object.entries(defs)) {
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext('2d')!;

      // Glow behind
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.arc(24, 24, 22, 0, Math.PI * 2);
      ctx.fill();

      // Background rounded rect
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = def.color;
      this.canvasRoundRect(ctx, 4, 4, 40, 40, 8);
      ctx.fill();

      // Border
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      this.canvasRoundRect(ctx, 4, 4, 40, 40, 8);
      ctx.stroke();

      // Procedural icon
      ctx.globalAlpha = 1;
      const drawIcon = POWERUP_ICON_DRAWERS[type];
      if (drawIcon) {
        drawIcon(ctx, 24, 24, 1);
      }

      this.textures.addCanvas(`powerup_${type}`, canvas);
    }
  }

  private canvasRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private generateParticleTextures(): void {
    // Fire particle (8x8 soft orange-yellow circle)
    const fireGfx = this.make.graphics({ x: 0, y: 0 });
    fireGfx.fillStyle(0xff6600, 0.8);
    fireGfx.fillCircle(4, 4, 4);
    fireGfx.fillStyle(0xffaa00, 0.6);
    fireGfx.fillCircle(4, 4, 2);
    fireGfx.generateTexture('particle_fire', 8, 8);
    fireGfx.destroy();

    // Smoke particle (12x12 gray circle)
    const smokeGfx = this.make.graphics({ x: 0, y: 0 });
    smokeGfx.fillStyle(0x888888, 0.4);
    smokeGfx.fillCircle(6, 6, 6);
    smokeGfx.fillStyle(0x999999, 0.2);
    smokeGfx.fillCircle(6, 6, 3);
    smokeGfx.generateTexture('particle_smoke', 12, 12);
    smokeGfx.destroy();

    // Spark particle (4x4 bright dot)
    const sparkGfx = this.make.graphics({ x: 0, y: 0 });
    sparkGfx.fillStyle(0xffff88, 1);
    sparkGfx.fillRect(0, 0, 4, 4);
    sparkGfx.generateTexture('particle_spark', 4, 4);
    sparkGfx.destroy();

    // Debris particle (6x6 brown fragment)
    const debrisGfx = this.make.graphics({ x: 0, y: 0 });
    debrisGfx.fillStyle(0x886633, 0.9);
    debrisGfx.fillRect(0, 0, 6, 6);
    debrisGfx.fillStyle(0x664422, 0.5);
    debrisGfx.fillRect(1, 1, 4, 4);
    debrisGfx.generateTexture('particle_debris', 6, 6);
    debrisGfx.destroy();

    // Star particle (6x6 colored star)
    const starGfx = this.make.graphics({ x: 0, y: 0 });
    starGfx.fillStyle(0xffffff, 1);
    starGfx.fillRect(2, 0, 2, 6);
    starGfx.fillRect(0, 2, 6, 2);
    starGfx.generateTexture('particle_star', 6, 6);
    starGfx.destroy();

    // Shield particle (8x8 cyan circle)
    const shieldGfx = this.make.graphics({ x: 0, y: 0 });
    shieldGfx.fillStyle(0x44ff44, 0.6);
    shieldGfx.fillCircle(4, 4, 4);
    shieldGfx.fillStyle(0x88ffaa, 0.4);
    shieldGfx.fillCircle(4, 4, 2);
    shieldGfx.generateTexture('particle_shield', 8, 8);
    shieldGfx.destroy();
  }

  private generateMeteorTexture(): void {
    const gfx = this.make.graphics({ x: 0, y: 0 });
    // Fiery rock body
    gfx.fillStyle(0x663311, 1);
    gfx.fillCircle(24, 24, 18);
    gfx.fillStyle(0x884422, 1);
    gfx.fillCircle(22, 22, 14);
    // Craggy surface detail
    gfx.fillStyle(0x553300, 0.8);
    gfx.fillCircle(28, 18, 6);
    gfx.fillCircle(16, 28, 5);
    gfx.fillCircle(30, 28, 4);
    // Hot glow on leading edge
    gfx.fillStyle(0xff6600, 0.7);
    gfx.fillCircle(18, 16, 8);
    gfx.fillStyle(0xffaa00, 0.5);
    gfx.fillCircle(16, 14, 5);
    gfx.fillStyle(0xffdd44, 0.3);
    gfx.fillCircle(15, 13, 3);
    // Fire trail
    gfx.fillStyle(0xff4400, 0.5);
    gfx.fillEllipse(32, 8, 14, 8);
    gfx.fillStyle(0xff6600, 0.3);
    gfx.fillEllipse(36, 4, 10, 6);
    gfx.generateTexture('meteor', 48, 48);
    gfx.destroy();
  }

  create(): void {
    this.scene.start('MenuScene');
  }

  /**
   * Generate custom player textures for a specific color (and optional eye style).
   * Called at game start for players with cosmetics. Skips if textures already exist.
   */
  static generateCustomPlayerTextures(scene: Phaser.Scene, hex: number, eyeStyle?: string): void {
    const directions = ['down', 'up', 'left', 'right'];
    const eyeOffsets: Record<
      string,
      { lx: number; ly: number; rx: number; ry: number; px: number; py: number }
    > = {
      down: { lx: -7, ly: 2, rx: 7, ry: 2, px: 0, py: 2 },
      up: { lx: -7, ly: -4, rx: 7, ry: -4, px: 0, py: -2 },
      left: { lx: -8, ly: -1, rx: -1, ry: -1, px: -2, py: 0 },
      right: { lx: 1, ly: -1, rx: 8, ry: -1, px: 2, py: 0 },
    };

    const suffix = eyeStyle ? `${hex.toString(16)}_${eyeStyle}` : hex.toString(16);

    for (const dir of directions) {
      const key = `player_custom_${suffix}_${dir}`;
      if (scene.textures.exists(key)) continue;

      const gfx = scene.make.graphics({ x: 0, y: 0 });
      const cx = 24,
        cy = 24;

      const darkerColor = Phaser.Display.Color.IntegerToColor(hex).darken(20).color;
      gfx.fillStyle(darkerColor, 1);
      gfx.fillRoundedRect(2, 2, 44, 44, 6);
      gfx.fillStyle(hex, 1);
      gfx.fillRoundedRect(2, 2, 44, 36, 6);
      gfx.lineStyle(2, 0xffffff, 0.4);
      gfx.strokeRoundedRect(2, 2, 44, 44, 6);
      gfx.fillStyle(0xffffff, 0.3);
      gfx.fillRoundedRect(6, 5, 10, 6, 3);

      const offsets = eyeOffsets[dir] || eyeOffsets.down;

      if (eyeStyle === 'angry') {
        // Angry eyes: narrower, red-tinted
        gfx.fillStyle(0xff4444, 0.95);
        gfx.fillEllipse(cx + offsets.lx, cy + offsets.ly, 10, 6);
        gfx.fillEllipse(cx + offsets.rx, cy + offsets.ry, 10, 6);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + offsets.lx + offsets.px, cy + offsets.ly + offsets.py, 2.5);
        gfx.fillCircle(cx + offsets.rx + offsets.px, cy + offsets.ry + offsets.py, 2.5);
      } else if (eyeStyle === 'cyclops') {
        // Single centered eye
        const centerX = (offsets.lx + offsets.rx) / 2;
        const centerY = (offsets.ly + offsets.ry) / 2;
        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(cx + centerX, cy + centerY, 7);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + centerX + offsets.px, cy + centerY + offsets.py, 3);
      } else if (eyeStyle === 'dot') {
        // Small dot eyes
        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(cx + offsets.lx, cy + offsets.ly, 3);
        gfx.fillCircle(cx + offsets.rx, cy + offsets.ry, 3);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + offsets.lx + offsets.px * 0.5, cy + offsets.ly + offsets.py * 0.5, 1.5);
        gfx.fillCircle(cx + offsets.rx + offsets.px * 0.5, cy + offsets.ry + offsets.py * 0.5, 1.5);
      } else {
        // Default eyes (same as standard)
        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(cx + offsets.lx, cy + offsets.ly, 5);
        gfx.fillCircle(cx + offsets.rx, cy + offsets.ry, 5);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + offsets.lx + offsets.px, cy + offsets.ly + offsets.py, 2.5);
        gfx.fillCircle(cx + offsets.rx + offsets.px, cy + offsets.ry + offsets.py, 2.5);
      }

      gfx.generateTexture(key, 48, 48);
      gfx.destroy();
    }
  }

  /**
   * Generate a custom bomb texture for a player's bomb skin.
   * Called at game start for players with bomb skin cosmetics.
   */
  static generateCustomBombTexture(
    scene: Phaser.Scene,
    config: { baseColor: number; fuseColor: number; label: string },
  ): void {
    const key = `bomb_custom_${config.label}`;
    if (scene.textures.exists(key)) return;

    const gfx = scene.make.graphics({ x: 0, y: 0 });
    const darkerColor = Phaser.Display.Color.IntegerToColor(config.baseColor).darken(25).color;

    // Main body
    gfx.fillStyle(darkerColor, 1);
    gfx.fillCircle(24, 26, 16);
    gfx.fillStyle(config.baseColor, 1);
    gfx.fillCircle(24, 24, 16);

    // Shine
    gfx.fillStyle(0xffffff, 0.3);
    gfx.fillCircle(18, 18, 5);

    // Fuse
    gfx.lineStyle(3, config.fuseColor, 1);
    gfx.beginPath();
    gfx.moveTo(24, 8);
    gfx.lineTo(28, 4);
    gfx.lineTo(32, 6);
    gfx.stroke();

    // Spark
    gfx.fillStyle(0xffff00, 1);
    gfx.fillCircle(32, 6, 3);
    gfx.fillStyle(0xffffff, 1);
    gfx.fillCircle(32, 6, 1.5);

    gfx.generateTexture(key, 48, 48);
    gfx.destroy();
  }
}
