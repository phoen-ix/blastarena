import { ZoneState } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { DEPTH } from '../art/depth';
import type { StylePalette } from '../art/painters/types';

const css = (c: string) => parseInt(c.replace('#', '').slice(0, 6), 16);

export class ShrinkingZoneRenderer {
  private graphics: Phaser.GameObjects.Graphics;
  private scene: Phaser.Scene;
  /** Drawn art styles: an energy wall in the style's colours instead of the red overlay. */
  private palette: StylePalette | null;

  constructor(scene: Phaser.Scene, palette: StylePalette | null = null) {
    this.scene = scene;
    this.palette = palette;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(DEPTH.ZONE);
  }

  update(zone: ZoneState, mapWidth: number, mapHeight: number): void {
    this.graphics.clear();
    this.graphics.setVisible(true);
    if (this.palette) {
      this.drawStyled(zone, mapWidth, mapHeight, this.palette);
      return;
    }

    const worldW = mapWidth * TILE_SIZE;
    const worldH = mapHeight * TILE_SIZE;

    // Zone center and radius in pixel coordinates
    const cx = zone.centerX * TILE_SIZE + TILE_SIZE / 2;
    const cy = zone.centerY * TILE_SIZE + TILE_SIZE / 2;
    const r = zone.currentRadius * TILE_SIZE;

    // Draw danger overlay with a hole for the safe zone
    this.graphics.fillStyle(0xff0000, 0.2);
    this.graphics.beginPath();

    // Outer rectangle (clockwise)
    this.graphics.moveTo(0, 0);
    this.graphics.lineTo(worldW, 0);
    this.graphics.lineTo(worldW, worldH);
    this.graphics.lineTo(0, worldH);
    this.graphics.closePath();

    // Inner circle (counter-clockwise to cut hole)
    this.graphics.moveTo(cx + r, cy);
    this.graphics.arc(cx, cy, r, 0, Math.PI * 2, true);
    this.graphics.closePath();

    this.graphics.fillPath();

    // Draw zone border ring
    this.graphics.lineStyle(2, 0xff4444, 0.6);
    this.graphics.strokeCircle(cx, cy, r);
  }

  private drawStyled(
    zone: ZoneState,
    mapWidth: number,
    mapHeight: number,
    pal: StylePalette,
  ): void {
    const g = this.graphics;
    const worldW = mapWidth * TILE_SIZE;
    const worldH = mapHeight * TILE_SIZE;
    const cx = zone.centerX * TILE_SIZE + TILE_SIZE / 2;
    const cy = zone.centerY * TILE_SIZE + TILE_SIZE / 2;
    const r = zone.currentRadius * TILE_SIZE;
    const t = this.scene.time.now / 1000;

    // Tinted danger area outside the circle.
    g.fillStyle(css(pal.zoneOutside), 0.3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(worldW, 0);
    g.lineTo(worldW, worldH);
    g.lineTo(0, worldH);
    g.closePath();
    g.moveTo(cx + r, cy);
    g.arc(cx, cy, r, 0, Math.PI * 2, true);
    g.closePath();
    g.fillPath();

    // The energy wall: a soft halo, a band and a bright core line.
    const edge = css(pal.zoneEdge);
    const pulse = 0.85 + 0.15 * Math.sin(t * 4);
    g.lineStyle(18, edge, 0.14 * pulse);
    g.strokeCircle(cx, cy, r);
    g.lineStyle(7, edge, 0.32 * pulse);
    g.strokeCircle(cx, cy, r);
    g.lineStyle(2, 0xffffff, 0.75);
    g.strokeCircle(cx, cy, r);

    // Sparks flowing along the wall.
    g.fillStyle(0xffffff, 0.85);
    const n = Math.max(12, Math.round(r / 18));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.6;
      const rr = r + Math.sin(t * 5 + i * 1.7) * 3;
      g.fillCircle(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.8);
    }

    // The next circle, dashed.
    if (zone.targetRadius !== undefined && zone.targetRadius < zone.currentRadius) {
      const tr = zone.targetRadius * TILE_SIZE;
      g.lineStyle(2, 0xffffff, 0.45);
      const dashes = Math.max(16, Math.round(tr / 10));
      for (let i = 0; i < dashes; i++) {
        const a0 = ((i + t * 0.5) / dashes) * Math.PI * 2;
        g.beginPath();
        g.arc(cx, cy, tr, a0, a0 + (Math.PI / dashes) * 0.9);
        g.strokePath();
      }
    }
  }

  destroy(): void {
    if (this.graphics && this.graphics.active) {
      this.graphics.destroy();
    }
  }
}
