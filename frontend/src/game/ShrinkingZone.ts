import { ZoneState } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';

export class ShrinkingZoneRenderer {
  private graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(15);
  }

  update(zone: ZoneState, mapWidth: number, mapHeight: number): void {
    this.graphics.clear();
    this.graphics.setVisible(true);

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

  destroy(): void {
    if (this.graphics && this.graphics.active) {
      this.graphics.destroy();
    }
  }
}
