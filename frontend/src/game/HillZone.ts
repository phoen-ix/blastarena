import { HillZone } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { DEPTH } from '../art/depth';
import type { StylePalette } from '../art/painters/types';

export class HillZoneRenderer {
  private graphics: Phaser.GameObjects.Graphics;
  private pulseTimer: number = 0;
  private scene: Phaser.Scene;
  /** Drawn art styles: owner-coloured hill with a ring and crown; null keeps the classic zone. */
  private palette: StylePalette | null;
  /** Body colour of a player (the hill takes its controller's colour in drawn styles). */
  colorOf: (playerId: number) => number | undefined = () => undefined;

  constructor(scene: Phaser.Scene, palette: StylePalette | null = null) {
    this.scene = scene;
    this.palette = palette;
    this.graphics = scene.add.graphics();
    // Above tiles, below players/bombs; drawn styles keep it on the ground band.
    this.graphics.setDepth(palette ? DEPTH.LIGHT_POOL - 1 : DEPTH.HILL);
  }

  update(
    hillZone: HillZone,
    _scores?: Record<number, number>,
    pendingHillZone?: HillZone | null,
  ): void {
    this.graphics.clear();
    this.graphics.setVisible(true);
    this.pulseTimer += 0.03;
    if (this.palette) {
      this.drawStyled(hillZone, pendingHillZone ?? null, this.palette);
      return;
    }

    const x = hillZone.x * TILE_SIZE;
    const y = hillZone.y * TILE_SIZE;
    const w = hillZone.width * TILE_SIZE;
    const h = hillZone.height * TILE_SIZE;

    // Pulsing alpha for the zone fill
    const baseAlpha = 0.12;
    const pulseAlpha = baseAlpha + Math.sin(this.pulseTimer) * 0.05;

    // Zone fill color depends on who controls it
    let fillColor = 0xffaa22; // Neutral: warm gold
    let borderColor = 0xffaa22;
    if (hillZone.controllingPlayer !== null) {
      fillColor = 0x00e676; // Controlled: green
      borderColor = 0x00e676;
    }

    // Filled zone rectangle
    this.graphics.fillStyle(fillColor, pulseAlpha);
    this.graphics.fillRect(x, y, w, h);

    // Border with glow effect
    const borderAlpha = 0.5 + Math.sin(this.pulseTimer * 1.5) * 0.15;
    this.graphics.lineStyle(2, borderColor, borderAlpha);
    this.graphics.strokeRect(x, y, w, h);

    // Inner corner markers for visibility
    const cornerSize = 6;
    this.graphics.lineStyle(2, borderColor, 0.7);
    // Top-left
    this.graphics.beginPath();
    this.graphics.moveTo(x, y + cornerSize);
    this.graphics.lineTo(x, y);
    this.graphics.lineTo(x + cornerSize, y);
    this.graphics.strokePath();
    // Top-right
    this.graphics.beginPath();
    this.graphics.moveTo(x + w - cornerSize, y);
    this.graphics.lineTo(x + w, y);
    this.graphics.lineTo(x + w, y + cornerSize);
    this.graphics.strokePath();
    // Bottom-left
    this.graphics.beginPath();
    this.graphics.moveTo(x, y + h - cornerSize);
    this.graphics.lineTo(x, y + h);
    this.graphics.lineTo(x + cornerSize, y + h);
    this.graphics.strokePath();
    // Bottom-right
    this.graphics.beginPath();
    this.graphics.moveTo(x + w - cornerSize, y + h);
    this.graphics.lineTo(x + w, y + h);
    this.graphics.lineTo(x + w, y + h - cornerSize);
    this.graphics.strokePath();

    // Crown/flag icon in center
    const cx = x + w / 2;
    const cy = y + h / 2;
    const iconAlpha = 0.3 + Math.sin(this.pulseTimer * 0.8) * 0.1;
    this.graphics.fillStyle(borderColor, iconAlpha);
    // Simple diamond shape
    this.graphics.fillTriangle(cx, cy - 8, cx + 6, cy, cx, cy + 8);
    this.graphics.fillTriangle(cx, cy - 8, cx - 6, cy, cx, cy + 8);

    // Render pending hill zone as a pulsing ghost outline
    if (pendingHillZone) {
      const px = pendingHillZone.x * TILE_SIZE;
      const py = pendingHillZone.y * TILE_SIZE;
      const pw = pendingHillZone.width * TILE_SIZE;
      const ph = pendingHillZone.height * TILE_SIZE;
      const ghostAlpha = 0.15 + Math.sin(this.pulseTimer * 3) * 0.1;
      this.graphics.fillStyle(0x44ccff, ghostAlpha);
      this.graphics.fillRect(px, py, pw, ph);
      const ghostBorderAlpha = 0.5 + Math.sin(this.pulseTimer * 3) * 0.25;
      this.graphics.lineStyle(2, 0x44ccff, ghostBorderAlpha);
      this.graphics.strokeRect(px, py, pw, ph);
      // Arrow icon in center
      const pcx = px + pw / 2;
      const pcy = py + ph / 2;
      this.graphics.fillStyle(0x44ccff, 0.4 + Math.sin(this.pulseTimer * 2) * 0.15);
      this.graphics.fillTriangle(pcx, pcy - 8, pcx + 6, pcy, pcx, pcy + 8);
      this.graphics.fillTriangle(pcx, pcy - 8, pcx - 6, pcy, pcx, pcy + 8);
    }
  }

  private drawStyled(hill: HillZone, pending: HillZone | null, pal: StylePalette): void {
    const g = this.graphics;
    const t = this.scene.time.now / 1000;
    const x = hill.x * TILE_SIZE;
    const y = hill.y * TILE_SIZE;
    const w = hill.width * TILE_SIZE;
    const h = hill.height * TILE_SIZE;
    const owner =
      hill.controllingPlayer !== null ? this.colorOf(hill.controllingPlayer) : undefined;
    const col = owner ?? parseInt(pal.hillNeutral.replace('#', ''), 16);

    g.fillStyle(col, 0.13 + 0.05 * Math.sin(t * 3));
    g.fillRect(x, y, w, h);

    // Corner brackets that breathe in and out.
    const inset = 3 + 2 * Math.sin(t * 2.5);
    const L = 14;
    g.lineStyle(4, col, 0.95);
    for (const [cx, cy, sx, sy] of [
      [x + inset, y + inset, 1, 1],
      [x + w - inset, y + inset, -1, 1],
      [x + inset, y + h - inset, 1, -1],
      [x + w - inset, y + h - inset, -1, -1],
    ]) {
      g.beginPath();
      g.moveTo(cx, cy + sy * L);
      g.lineTo(cx, cy);
      g.lineTo(cx + sx * L, cy);
      g.strokePath();
    }

    // Ring and crown at the centre; the ring turns while someone holds the hill.
    const cx = x + w / 2;
    const cy = y + h / 2;
    g.lineStyle(6, 0x000000, 0.3);
    g.strokeCircle(cx, cy, 28);
    g.lineStyle(4, col, 0.9);
    if (owner !== undefined) {
      const a = t * 2;
      g.beginPath();
      g.arc(cx, cy, 28, a, a + Math.PI * 1.4);
      g.strokePath();
    } else {
      g.strokeCircle(cx, cy, 28);
    }
    g.fillStyle(col, 0.9);
    const crown = [-11, 6, -13, -7, -5, -1, 0, -10, 5, -1, 13, -7, 11, 6];
    g.beginPath();
    g.moveTo(cx + crown[0], cy + crown[1]);
    for (let i = 2; i < crown.length; i += 2) g.lineTo(cx + crown[i], cy + crown[i + 1]);
    g.closePath();
    g.fillPath();

    if (pending) {
      const px = pending.x * TILE_SIZE;
      const py = pending.y * TILE_SIZE;
      const pw = pending.width * TILE_SIZE;
      const ph = pending.height * TILE_SIZE;
      const a = 0.35 + 0.25 * Math.sin(t * 5);
      g.lineStyle(2, 0xffffff, a);
      const step = 12;
      for (let i = 0; i < pw; i += step * 2) {
        g.lineBetween(px + i, py, px + Math.min(pw, i + step), py);
        g.lineBetween(px + i, py + ph, px + Math.min(pw, i + step), py + ph);
      }
      for (let i = 0; i < ph; i += step * 2) {
        g.lineBetween(px, py + i, px, py + Math.min(ph, i + step));
        g.lineBetween(px + pw, py + i, px + pw, py + Math.min(ph, i + step));
      }
    }
  }

  destroy(): void {
    if (this.graphics && this.graphics.active) {
      this.graphics.destroy();
    }
  }
}
