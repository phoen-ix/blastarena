import { HillZone } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';

export class HillZoneRenderer {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private pulseTimer: number = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(5); // Above tiles, below players/bombs
  }

  update(hillZone: HillZone, _scores?: Record<number, number>): void {
    this.graphics.clear();
    this.graphics.setVisible(true);
    this.pulseTimer += 0.03;

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
  }

  hide(): void {
    this.graphics.clear();
    this.graphics.setVisible(false);
  }

  destroy(): void {
    if (this.graphics && this.graphics.active) {
      this.graphics.destroy();
    }
  }
}
