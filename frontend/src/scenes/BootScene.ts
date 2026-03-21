import Phaser from 'phaser';

export const PLAYER_COLORS = [0xe94560, 0x44aaff, 0x44ff44, 0xff8800, 0xcc44ff, 0xffff44, 0xff44ff, 0x44ffff];

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

    const loadingText = this.add.text(width / 2, height / 2 - 40, 'Loading...', {
      fontSize: '18px',
      color: '#ff6b35',
    }).setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0xff6b35, 1);
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
  }

  private generatePlayerTextures(): void {
    const directions: string[] = ['down', 'up', 'left', 'right'];
    // Eye positions relative to center for each direction
    const eyeOffsets: Record<string, { lx: number; ly: number; rx: number; ry: number; px: number; py: number }> = {
      down:  { lx: -7, ly: 2, rx: 7, ry: 2, px: 0, py: 2 },
      up:    { lx: -7, ly: -4, rx: 7, ry: -4, px: 0, py: -2 },
      left:  { lx: -8, ly: -1, rx: -1, ry: -1, px: -2, py: 0 },
      right: { lx: 1, ly: -1, rx: 8, ry: -1, px: 2, py: 0 },
    };

    PLAYER_COLORS.forEach((color, i) => {
      for (const dir of directions) {
        const gfx = this.make.graphics({ x: 0, y: 0 });
        const cx = 24, cy = 24;

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
      const baseShade = 0x2a2a3e + (v * 0x010102);
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

    // Conveyor textures
    const arrowDirs: Record<string, number> = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };
    for (const [dir, angle] of Object.entries(arrowDirs)) {
      const convGfx = this.make.graphics({ x: 0, y: 0 });
      convGfx.fillStyle(0x2a2a3e, 1);
      convGfx.fillRect(0, 0, 48, 48);
      convGfx.fillStyle(0x3a3a4e, 0.5);
      convGfx.fillRect(2, 2, 44, 44);
      // Draw 3 arrows
      convGfx.lineStyle(2, 0x88aacc, 0.6);
      for (let offset = -12; offset <= 12; offset += 12) {
        const cx = 24 + Math.cos(angle + Math.PI / 2) * offset * 0.3;
        const cy = 24 + Math.sin(angle + Math.PI / 2) * offset * 0.3;
        const ax = Math.cos(angle) * 8;
        const ay = Math.sin(angle) * 8;
        const px = Math.cos(angle + Math.PI / 2);
        const py = Math.sin(angle + Math.PI / 2);
        convGfx.beginPath();
        convGfx.moveTo(cx - ax, cy - ay);
        convGfx.lineTo(cx + ax, cy + ay);
        convGfx.strokePath();
        // Arrowhead
        convGfx.beginPath();
        convGfx.moveTo(cx + ax, cy + ay);
        convGfx.lineTo(cx + ax * 0.3 + px * 4, cy + ay * 0.3 + py * 4);
        convGfx.moveTo(cx + ax, cy + ay);
        convGfx.lineTo(cx + ax * 0.3 - px * 4, cy + ay * 0.3 - py * 4);
        convGfx.strokePath();
      }
      convGfx.generateTexture(`conveyor_${dir}`, 48, 48);
      convGfx.destroy();
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
    const defs: Record<string, { color: string; emoji: string }> = {
      bomb_up:     { color: '#ff4444', emoji: '💣' },
      fire_up:     { color: '#ff8800', emoji: '🔥' },
      speed_up:    { color: '#44aaff', emoji: '⚡' },
      shield:      { color: '#44ff44', emoji: '🛡️' },
      kick:        { color: '#cc44ff', emoji: '👢' },
      pierce_bomb: { color: '#ff2222', emoji: '💥' },
      remote_bomb: { color: '#4488ff', emoji: '📡' },
      line_bomb:   { color: '#ffaa44', emoji: '🧨' },
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

      // Emoji icon
      ctx.globalAlpha = 1;
      ctx.font = '22px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.emoji, 24, 25);

      this.textures.addCanvas(`powerup_${type}`, canvas);
    }
  }

  private canvasRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

  create(): void {
    this.scene.start('MenuScene');
  }

  /**
   * Generate custom player textures for a specific color (and optional eye style).
   * Called at game start for players with cosmetics. Skips if textures already exist.
   */
  static generateCustomPlayerTextures(scene: Phaser.Scene, hex: number, eyeStyle?: string): void {
    const directions = ['down', 'up', 'left', 'right'];
    const eyeOffsets: Record<string, { lx: number; ly: number; rx: number; ry: number; px: number; py: number }> = {
      down:  { lx: -7, ly: 2, rx: 7, ry: 2, px: 0, py: 2 },
      up:    { lx: -7, ly: -4, rx: 7, ry: -4, px: 0, py: -2 },
      left:  { lx: -8, ly: -1, rx: -1, ry: -1, px: -2, py: 0 },
      right: { lx: 1, ly: -1, rx: 8, ry: -1, px: 2, py: 0 },
    };

    const suffix = eyeStyle ? `${hex.toString(16)}_${eyeStyle}` : hex.toString(16);

    for (const dir of directions) {
      const key = `player_custom_${suffix}_${dir}`;
      if (scene.textures.exists(key)) continue;

      const gfx = scene.make.graphics({ x: 0, y: 0 });
      const cx = 24, cy = 24;

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
