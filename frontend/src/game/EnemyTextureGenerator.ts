import Phaser from 'phaser';
import {
  EnemyTypeEntry,
  EnemySpriteConfig,
  EnemyBodyShape,
  EnemyEyeStyle,
  EnemyAccessory,
} from '@blast-arena/shared';

const SIZE = 48;
const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;

type EyeOffsets = { lx: number; ly: number; rx: number; ry: number; px: number; py: number };

const EYE_OFFSETS: Record<string, EyeOffsets> = {
  down: { lx: -7, ly: 2, rx: 7, ry: 2, px: 0, py: 2 },
  up: { lx: -7, ly: -4, rx: 7, ry: -4, px: 0, py: -2 },
  left: { lx: -8, ly: -1, rx: -1, ry: -1, px: -2, py: 0 },
  right: { lx: 1, ly: -1, rx: 8, ry: -1, px: 2, py: 0 },
};

const TAIL_OFFSETS: Record<string, { bx: number; by: number; tx: number; ty: number }> = {
  down: { bx: 12, by: -8, tx: 18, ty: -14 },
  up: { bx: 12, by: 10, tx: 18, ty: 16 },
  left: { bx: 14, by: 4, tx: 20, ty: 8 },
  right: { bx: -14, by: 4, tx: -20, ty: 8 },
};

const WING_Y_ADJUST: Record<EnemyBodyShape, number> = {
  blob: 0,
  spiky: 0,
  ghost: 0,
  robot: 0,
  bug: -4,
  skull: 0,
};

const CROWN_Y_OFFSET: Record<EnemyBodyShape, number> = {
  blob: 0,
  spiky: -2,
  ghost: 2,
  robot: -6,
  bug: 0,
  skull: 2,
};

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function darkenHex(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export class EnemyTextureGenerator {
  /**
   * Generate textures for all enemy types needed in a level.
   * Called in GameScene.create() and LevelEditorScene.create().
   */
  static generateForLevel(scene: Phaser.Scene, enemyTypes: EnemyTypeEntry[]): void {
    for (const et of enemyTypes) {
      for (const dir of DIRECTIONS) {
        const key = `enemy_${et.id}_${dir}`;
        if (scene.textures.exists(key)) continue;

        const gfx = scene.make.graphics({ x: 0, y: 0 });
        EnemyTextureGenerator.drawEnemy(gfx, et.config.sprite, dir, et.config.sizeMultiplier);
        gfx.generateTexture(key, SIZE, SIZE);
        gfx.destroy();
      }
    }
  }

  /**
   * Generate a preview image on a raw Canvas2D element (no Phaser needed).
   * Used in admin enemy type editor.
   */
  static generatePreview(canvas: HTMLCanvasElement, sprite: EnemySpriteConfig, size = 64): void {
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);

    const primary = sprite.primaryColor;
    const secondary = sprite.secondaryColor;
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.4;

    // Aura (behind body)
    if (sprite.hasAura ?? false) {
      ctx.fillStyle = secondary;
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Body
    ctx.fillStyle = primary;
    EnemyTextureGenerator.drawBodyCanvas(ctx, sprite.bodyShape, cx, cy, r);

    // Secondary detail
    ctx.fillStyle = secondary;
    ctx.globalAlpha = 0.4;
    EnemyTextureGenerator.drawBodyCanvas(ctx, sprite.bodyShape, cx, cy + 2, r * 0.85);
    ctx.globalAlpha = 1;

    // Scar (on body surface)
    if (sprite.hasScar ?? false) {
      ctx.strokeStyle = darkenHex(primary, 60);
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.15, cy - r * 0.3);
      ctx.lineTo(cx - r * 0.25, cy + r * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.1, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.05, cy + r * 0.1);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Eyes
    EnemyTextureGenerator.drawEyesCanvas(ctx, sprite.eyeStyle, cx, cy, r);

    // Features
    if (sprite.hasTeeth) {
      ctx.fillStyle = '#ffffff';
      const tw = r * 0.15;
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx + i * tw * 1.5 - tw / 2, cy + r * 0.6, tw, tw * 1.2);
      }
    }
    if (sprite.hasHorns) {
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy - r * 0.7);
      ctx.lineTo(cx - r * 0.3, cy - r * 1.1);
      ctx.lineTo(cx - r * 0.1, cy - r * 0.6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.5, cy - r * 0.7);
      ctx.lineTo(cx + r * 0.3, cy - r * 1.1);
      ctx.lineTo(cx + r * 0.1, cy - r * 0.6);
      ctx.fill();
    }

    // Crown (mutually exclusive with horns)
    if ((sprite.hasCrown ?? false) && !sprite.hasHorns) {
      ctx.fillStyle = '#FFD700';
      ctx.globalAlpha = 0.9;
      const crownY = cy - r * 0.75;
      // Base
      ctx.fillRect(cx - r * 0.3, crownY, r * 0.6, r * 0.12);
      // Three points
      for (const xOff of [-0.2, 0, 0.2]) {
        ctx.beginPath();
        ctx.moveTo(cx + r * (xOff - 0.08), crownY);
        ctx.lineTo(cx + r * xOff, crownY - r * 0.3);
        ctx.lineTo(cx + r * (xOff + 0.08), crownY);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Tail
    if (sprite.hasTail ?? false) {
      ctx.fillStyle = secondary;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.5, cy + r * 0.4);
      ctx.lineTo(cx + r * 0.9, cy + r * 0.7);
      ctx.lineTo(cx + r * 0.4, cy + r * 0.6);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Wings
    if (sprite.hasWings ?? false) {
      ctx.fillStyle = secondary;
      ctx.globalAlpha = 0.6;
      // Left wing
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.85, cy - r * 0.2);
      ctx.lineTo(cx - r * 1.15, cy - r * 0.5);
      ctx.lineTo(cx - r * 0.85, cy + r * 0.15);
      ctx.fill();
      // Right wing
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.85, cy - r * 0.2);
      ctx.lineTo(cx + r * 1.15, cy - r * 0.5);
      ctx.lineTo(cx + r * 0.85, cy + r * 0.15);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Accessory
    const accessory = sprite.accessory ?? 'none';
    if (accessory === 'bow_tie') {
      ctx.fillStyle = secondary;
      ctx.globalAlpha = 0.85;
      // Left triangle
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.35);
      ctx.lineTo(cx - r * 0.25, cy + r * 0.25);
      ctx.lineTo(cx - r * 0.25, cy + r * 0.45);
      ctx.fill();
      // Right triangle
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.35);
      ctx.lineTo(cx + r * 0.25, cy + r * 0.25);
      ctx.lineTo(cx + r * 0.25, cy + r * 0.45);
      ctx.fill();
      // Center knot
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.35, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (accessory === 'monocle') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      const eyeSpacing = r * 0.4;
      ctx.beginPath();
      ctx.arc(cx + eyeSpacing, cy - r * 0.1, r * 0.25, 0, Math.PI * 2);
      ctx.stroke();
      // Chain line
      ctx.beginPath();
      ctx.moveTo(cx + eyeSpacing + r * 0.25, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.8, cy + r * 0.3);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (accessory === 'bandana') {
      ctx.fillStyle = secondary;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(cx - r * 0.6, cy - r * 0.35, r * 1.2, r * 0.15);
      // Knot on right side
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.6, cy - r * 0.35);
      ctx.lineTo(cx + r * 0.8, cy - r * 0.5);
      ctx.lineTo(cx + r * 0.75, cy - r * 0.2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  private static drawEnemy(
    gfx: Phaser.GameObjects.Graphics,
    sprite: EnemySpriteConfig,
    direction: string,
    sizeMultiplier: number,
  ): void {
    const primary = hexToNumber(sprite.primaryColor);
    const secondary = hexToNumber(sprite.secondaryColor);
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    // Aura (behind body)
    if (sprite.hasAura ?? false) {
      gfx.fillStyle(secondary, 0.12);
      gfx.fillCircle(cx, cy, 26);
    }

    // Body
    const bodyFn = EnemyTextureGenerator.getBodyRenderer(sprite.bodyShape);
    bodyFn(gfx, cx, cy, primary, secondary, sizeMultiplier);

    // Scar (on body surface)
    if (sprite.hasScar ?? false) {
      const scarColor = Phaser.Display.Color.IntegerToColor(primary).darken(40).color;
      gfx.lineStyle(2, scarColor, 0.6);
      gfx.lineBetween(cx + 3, cy - 6, cx - 5, cy + 4);
      gfx.lineBetween(cx - 2, cy - 2, cx + 1, cy + 2);
    }

    // Eyes
    EnemyTextureGenerator.drawEyes(gfx, sprite.eyeStyle, cx, cy, direction);

    // Features
    if (sprite.hasTeeth) {
      gfx.fillStyle(0xffffff, 0.9);
      for (let i = -2; i <= 2; i++) {
        gfx.fillTriangle(cx + i * 4 - 2, cy + 14, cx + i * 4 + 2, cy + 14, cx + i * 4, cy + 18);
      }
    }
    if (sprite.hasHorns) {
      gfx.fillStyle(secondary, 0.9);
      gfx.fillTriangle(cx - 10, cy - 14, cx - 6, cy - 22, cx - 2, cy - 12);
      gfx.fillTriangle(cx + 10, cy - 14, cx + 6, cy - 22, cx + 2, cy - 12);
    }

    // Crown (mutually exclusive with horns)
    if ((sprite.hasCrown ?? false) && !sprite.hasHorns) {
      const crownYOff = CROWN_Y_OFFSET[sprite.bodyShape] ?? 0;
      const crownBaseY = cy - 16 + crownYOff;
      gfx.fillStyle(0xffd700, 0.9);
      gfx.fillRect(cx - 6, crownBaseY, 12, 3);
      gfx.fillTriangle(cx - 5, crownBaseY, cx - 3, crownBaseY - 7, cx - 1, crownBaseY);
      gfx.fillTriangle(cx - 2, crownBaseY, cx, crownBaseY - 9, cx + 2, crownBaseY);
      gfx.fillTriangle(cx + 1, crownBaseY, cx + 3, crownBaseY - 7, cx + 5, crownBaseY);
    }

    // Tail (direction-aware)
    if (sprite.hasTail ?? false) {
      const tOff = TAIL_OFFSETS[direction] ?? TAIL_OFFSETS.down;
      gfx.fillStyle(secondary, 0.8);
      gfx.fillTriangle(
        cx + tOff.bx - 3,
        cy + tOff.by,
        cx + tOff.tx,
        cy + tOff.ty,
        cx + tOff.bx + 3,
        cy + tOff.by,
      );
      // Tail tip circle
      gfx.fillCircle(cx + tOff.tx, cy + tOff.ty, 2);
    }

    // Wings (direction-aware scaling)
    if (sprite.hasWings ?? false) {
      const wingY = cy - 4 + (WING_Y_ADJUST[sprite.bodyShape] ?? 0);
      const frontSide = direction === 'right' ? -1 : direction === 'left' ? 1 : 0;
      const lScale = frontSide === 1 ? 1.0 : frontSide === -1 ? 0.7 : 1.0;
      const rScale = frontSide === -1 ? 1.0 : frontSide === 1 ? 0.7 : 1.0;
      gfx.fillStyle(secondary, 0.6);
      // Left wing
      gfx.fillTriangle(
        cx - 18,
        wingY,
        cx - 18 - 6 * lScale,
        wingY - 8 * lScale,
        cx - 18,
        wingY + 6,
      );
      // Right wing
      gfx.fillTriangle(
        cx + 18,
        wingY,
        cx + 18 + 6 * rScale,
        wingY - 8 * rScale,
        cx + 18,
        wingY + 6,
      );
    }

    // Accessory
    EnemyTextureGenerator.drawAccessory(
      gfx,
      sprite.accessory ?? 'none',
      cx,
      cy,
      secondary,
      direction,
    );
  }

  private static getBodyRenderer(shape: EnemyBodyShape) {
    switch (shape) {
      case 'blob':
        return EnemyTextureGenerator.drawBlob;
      case 'spiky':
        return EnemyTextureGenerator.drawSpiky;
      case 'ghost':
        return EnemyTextureGenerator.drawGhost;
      case 'robot':
        return EnemyTextureGenerator.drawRobot;
      case 'bug':
        return EnemyTextureGenerator.drawBug;
      case 'skull':
        return EnemyTextureGenerator.drawSkull;
      default:
        return EnemyTextureGenerator.drawBlob;
    }
  }

  // --- Body shape renderers (Phaser Graphics) ---

  private static drawBlob(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    primary: number,
    _secondary: number,
    _scale: number,
  ): void {
    const darker = Phaser.Display.Color.IntegerToColor(primary).darken(20).color;
    gfx.fillStyle(darker, 1);
    gfx.fillCircle(cx, cy + 2, 20);
    gfx.fillStyle(primary, 1);
    gfx.fillCircle(cx, cy - 1, 19);
    // Highlight
    gfx.fillStyle(0xffffff, 0.2);
    gfx.fillCircle(cx - 5, cy - 8, 6);
  }

  private static drawSpiky(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    primary: number,
    secondary: number,
    _scale: number,
  ): void {
    // Pentagon body with spikes
    gfx.fillStyle(primary, 1);
    const points: number[] = [];
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      points.push(cx + Math.cos(angle) * 18, cy + Math.sin(angle) * 18);
    }
    // (A fillPoints() call used to precede this, mapping every flat coordinate to a Point with
    // x === y — a zero-area polygon on the diagonal that drew nothing. The path below is the
    // pentagon. audit G4)
    gfx.beginPath();
    gfx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) {
      gfx.lineTo(points[i], points[i + 1]);
    }
    gfx.closePath();
    gfx.fillPath();

    // Spikes
    gfx.fillStyle(secondary, 0.8);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const bx = cx + Math.cos(angle) * 18;
      const by = cy + Math.sin(angle) * 18;
      const tx = cx + Math.cos(angle) * 24;
      const ty = cy + Math.sin(angle) * 24;
      const perpAngle = angle + Math.PI / 2;
      gfx.fillTriangle(
        bx + Math.cos(perpAngle) * 3,
        by + Math.sin(perpAngle) * 3,
        bx - Math.cos(perpAngle) * 3,
        by - Math.sin(perpAngle) * 3,
        tx,
        ty,
      );
    }
  }

  private static drawGhost(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    primary: number,
    _secondary: number,
    _scale: number,
  ): void {
    // Semicircle top + wavy bottom
    gfx.fillStyle(primary, 0.85);
    gfx.fillCircle(cx, cy - 2, 18);
    gfx.fillRect(cx - 18, cy - 2, 36, 16);
    // Wavy bottom edge
    gfx.fillStyle(primary, 0.85);
    for (let i = 0; i < 4; i++) {
      const wx = cx - 14 + i * 9;
      gfx.fillCircle(wx, cy + 14, 5);
    }
    // Highlight
    gfx.fillStyle(0xffffff, 0.15);
    gfx.fillCircle(cx - 5, cy - 8, 7);
  }

  private static drawRobot(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    primary: number,
    secondary: number,
    _scale: number,
  ): void {
    const darker = Phaser.Display.Color.IntegerToColor(primary).darken(15).color;
    // Rectangular body with beveled edges
    gfx.fillStyle(darker, 1);
    gfx.fillRoundedRect(cx - 16, cy - 16, 32, 34, 3);
    gfx.fillStyle(primary, 1);
    gfx.fillRoundedRect(cx - 15, cy - 15, 30, 28, 3);
    // Antenna
    gfx.lineStyle(2, secondary, 0.8);
    gfx.lineBetween(cx, cy - 16, cx, cy - 22);
    gfx.fillStyle(secondary, 1);
    gfx.fillCircle(cx, cy - 22, 3);
    // Chest plate detail
    gfx.fillStyle(secondary, 0.3);
    gfx.fillRect(cx - 8, cy + 2, 16, 8);
  }

  private static drawBug(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    primary: number,
    secondary: number,
    _scale: number,
  ): void {
    // Oval body
    gfx.fillStyle(primary, 1);
    gfx.fillEllipse(cx, cy, 32, 36);
    // Darker segments
    gfx.lineStyle(1, Phaser.Display.Color.IntegerToColor(primary).darken(30).color, 0.5);
    gfx.lineBetween(cx - 14, cy - 2, cx + 14, cy - 2);
    gfx.lineBetween(cx - 12, cy + 6, cx + 12, cy + 6);
    // Leg stubs
    gfx.fillStyle(secondary, 0.7);
    for (const yOff of [-6, 2, 10]) {
      gfx.fillRect(cx - 19, cy + yOff, 5, 3);
      gfx.fillRect(cx + 14, cy + yOff, 5, 3);
    }
    // Antennae
    gfx.lineStyle(1, secondary, 0.6);
    gfx.lineBetween(cx - 6, cy - 16, cx - 12, cy - 22);
    gfx.lineBetween(cx + 6, cy - 16, cx + 12, cy - 22);
  }

  private static drawSkull(
    gfx: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    primary: number,
    secondary: number,
    _scale: number,
  ): void {
    // Circle with concave jaw
    gfx.fillStyle(primary, 1);
    gfx.fillCircle(cx, cy - 3, 18);
    // Jaw
    gfx.fillStyle(Phaser.Display.Color.IntegerToColor(primary).darken(10).color, 1);
    gfx.fillRoundedRect(cx - 12, cy + 8, 24, 12, 4);
    // Dark eye sockets
    gfx.fillStyle(secondary, 0.8);
    gfx.fillCircle(cx - 7, cy - 4, 6);
    gfx.fillCircle(cx + 7, cy - 4, 6);
    // Nose
    gfx.fillStyle(secondary, 0.5);
    gfx.fillTriangle(cx, cy + 2, cx - 3, cy + 7, cx + 3, cy + 7);
  }

  // --- Eye renderers (Phaser Graphics) ---

  private static drawEyes(
    gfx: Phaser.GameObjects.Graphics,
    style: EnemyEyeStyle,
    cx: number,
    cy: number,
    direction: string,
  ): void {
    const off = EYE_OFFSETS[direction] || EYE_OFFSETS.down;

    switch (style) {
      case 'round': {
        gfx.fillStyle(0xffffff, 0.95);
        gfx.fillCircle(cx + off.lx, cy + off.ly, 5);
        gfx.fillCircle(cx + off.rx, cy + off.ry, 5);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + off.lx + off.px, cy + off.ly + off.py, 2.5);
        gfx.fillCircle(cx + off.rx + off.px, cy + off.ry + off.py, 2.5);
        break;
      }
      case 'angry': {
        gfx.fillStyle(0xff4444, 0.95);
        gfx.fillCircle(cx + off.lx, cy + off.ly, 5);
        gfx.fillCircle(cx + off.rx, cy + off.ry, 5);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + off.lx + off.px, cy + off.ly + off.py, 2.5);
        gfx.fillCircle(cx + off.rx + off.px, cy + off.ry + off.py, 2.5);
        // Angry eyebrows
        gfx.lineStyle(2, 0x111111, 0.8);
        gfx.lineBetween(cx + off.lx - 4, cy + off.ly - 6, cx + off.lx + 4, cy + off.ly - 4);
        gfx.lineBetween(cx + off.rx + 4, cy + off.ry - 6, cx + off.rx - 4, cy + off.ry - 4);
        break;
      }
      case 'sleepy': {
        // Half-closed eyes
        gfx.fillStyle(0xffffff, 0.7);
        gfx.fillEllipse(cx + off.lx, cy + off.ly, 10, 6);
        gfx.fillEllipse(cx + off.rx, cy + off.ry, 10, 6);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + off.lx + off.px, cy + off.ly + 1, 2);
        gfx.fillCircle(cx + off.rx + off.px, cy + off.ry + 1, 2);
        break;
      }
      case 'crazy': {
        // Asymmetric eyes
        gfx.fillStyle(0xffff44, 0.95);
        gfx.fillCircle(cx + off.lx, cy + off.ly, 6);
        gfx.fillCircle(cx + off.rx, cy + off.ry, 4);
        gfx.fillStyle(0x111111, 1);
        gfx.fillCircle(cx + off.lx + off.px * 1.5, cy + off.ly + off.py, 3);
        gfx.fillCircle(cx + off.rx + off.px * 0.5, cy + off.ry + off.py, 1.5);
        break;
      }
    }
  }

  // --- Accessory renderer (Phaser Graphics) ---

  private static drawAccessory(
    gfx: Phaser.GameObjects.Graphics,
    accessory: EnemyAccessory,
    cx: number,
    cy: number,
    secondary: number,
    direction: string,
  ): void {
    if (accessory === 'none') return;

    switch (accessory) {
      case 'bow_tie': {
        gfx.fillStyle(secondary, 0.85);
        // Left wing
        gfx.fillTriangle(cx, cy + 8, cx - 5, cy + 5, cx - 5, cy + 11);
        // Right wing
        gfx.fillTriangle(cx, cy + 8, cx + 5, cy + 5, cx + 5, cy + 11);
        // Center knot
        gfx.fillCircle(cx, cy + 8, 1.5);
        break;
      }
      case 'monocle': {
        const off = EYE_OFFSETS[direction] || EYE_OFFSETS.down;
        gfx.lineStyle(1.5, 0xffffff, 0.7);
        gfx.strokeCircle(cx + off.rx, cy + off.ry, 6);
        // Chain line
        gfx.lineBetween(cx + off.rx + 6, cy + off.ry, cx + off.rx + 10, cy + off.ry + 8);
        break;
      }
      case 'bandana': {
        gfx.fillStyle(secondary, 0.75);
        gfx.fillRect(cx - 14, cy - 8, 28, 3);
        // Knot on right
        gfx.fillTriangle(cx + 14, cy - 8, cx + 18, cy - 13, cx + 17, cy - 5);
        break;
      }
    }
  }

  // --- Canvas2D helpers for preview ---

  private static drawBodyCanvas(
    ctx: CanvasRenderingContext2D,
    shape: EnemyBodyShape,
    cx: number,
    cy: number,
    r: number,
  ): void {
    ctx.beginPath();
    switch (shape) {
      case 'blob':
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      case 'spiky': {
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        break;
      }
      case 'ghost':
        ctx.arc(cx, cy - r * 0.2, r, Math.PI, 0);
        ctx.lineTo(cx + r, cy + r * 0.6);
        for (let i = 3; i >= 0; i--) {
          const wx = cx - r + (i + 0.5) * ((r * 2) / 4);
          ctx.quadraticCurveTo(wx, cy + r * 0.9, cx - r + i * ((r * 2) / 4), cy + r * 0.6);
        }
        break;
      case 'robot':
        ctx.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.15);
        break;
      case 'bug':
        ctx.ellipse(cx, cy, r * 0.85, r, 0, 0, Math.PI * 2);
        break;
      case 'skull':
        ctx.arc(cx, cy - r * 0.1, r * 0.9, 0, Math.PI * 2);
        break;
    }
    ctx.fill();
  }

  private static drawEyesCanvas(
    ctx: CanvasRenderingContext2D,
    style: EnemyEyeStyle,
    cx: number,
    cy: number,
    r: number,
  ): void {
    const eyeR = r * 0.2;
    const eyeSpacing = r * 0.4;

    ctx.fillStyle = style === 'angry' ? '#ff4444' : style === 'crazy' ? '#ffff44' : '#ffffff';

    // Left eye
    ctx.beginPath();
    ctx.arc(cx - eyeSpacing, cy - r * 0.1, eyeR, 0, Math.PI * 2);
    ctx.fill();

    // Right eye
    ctx.beginPath();
    ctx.arc(cx + eyeSpacing, cy - r * 0.1, style === 'crazy' ? eyeR * 0.7 : eyeR, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    ctx.arc(cx - eyeSpacing, cy - r * 0.1, eyeR * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + eyeSpacing, cy - r * 0.1, eyeR * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
}
