import Phaser from 'phaser';
import { PowerUpState } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';

export class PowerUpRenderer {
  private scene: Phaser.Scene;
  private sprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private _activeIds = new Set<string>();
  public wrappingWorldSize: { w: number; h: number } | null = null;
  private ghostSprites: Map<string, Phaser.GameObjects.Image[]> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(powerUps: PowerUpState[]): void {
    this._activeIds.clear();
    for (const p of powerUps) this._activeIds.add(p.id);
    const activeIds = this._activeIds;

    // Remove sprites for power-ups that no longer exist
    for (const [id, sprite] of this.sprites) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
        const ghosts = this.ghostSprites.get(id);
        if (ghosts) {
          for (const g of ghosts) g.destroy();
          this.ghostSprites.delete(id);
        }
      }
    }

    // Create sprites for new power-ups
    for (const powerUp of powerUps) {
      const px = powerUp.position.x * TILE_SIZE + TILE_SIZE / 2;
      const py = powerUp.position.y * TILE_SIZE + TILE_SIZE / 2;

      if (!this.sprites.has(powerUp.id)) {
        const sprite = this.scene.add.sprite(px, py, `powerup_${powerUp.type}`);
        sprite.setDepth(3);

        // Floating animation
        this.scene.tweens.add({
          targets: sprite,
          y: sprite.y - 4,
          duration: 600,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });

        this.sprites.set(powerUp.id, sprite);
      }

      if (this.wrappingWorldSize) {
        // Use canonical sprite's current position (includes float tween offset)
        const sprite = this.sprites.get(powerUp.id);
        if (sprite) {
          this.updateGhosts(powerUp.id, sprite.x, sprite.y, `powerup_${powerUp.type}`);
        }
      }
    }
  }

  private updateGhosts(id: string, px: number, py: number, textureKey: string): void {
    if (!this.wrappingWorldSize) return;
    const { w, h } = this.wrappingWorldSize;
    const thresholdX = w / 2;
    const thresholdY = h / 2;
    const nearLeft = px < thresholdX;
    const nearRight = px > w - thresholdX;
    const nearTop = py < thresholdY;
    const nearBottom = py > h - thresholdY;

    const offsets: { ox: number; oy: number }[] = [];
    if (nearLeft) offsets.push({ ox: w, oy: 0 });
    if (nearRight) offsets.push({ ox: -w, oy: 0 });
    if (nearTop) offsets.push({ ox: 0, oy: h });
    if (nearBottom) offsets.push({ ox: 0, oy: -h });
    if (nearLeft && nearTop) offsets.push({ ox: w, oy: h });
    if (nearLeft && nearBottom) offsets.push({ ox: w, oy: -h });
    if (nearRight && nearTop) offsets.push({ ox: -w, oy: h });
    if (nearRight && nearBottom) offsets.push({ ox: -w, oy: -h });

    let ghosts = this.ghostSprites.get(id);

    if (ghosts && ghosts.length !== offsets.length) {
      for (const g of ghosts) g.destroy();
      ghosts = undefined;
      this.ghostSprites.delete(id);
    }

    if (offsets.length === 0) {
      if (ghosts) {
        for (const g of ghosts) g.destroy();
        this.ghostSprites.delete(id);
      }
      return;
    }

    if (!ghosts) {
      ghosts = offsets.map(({ ox, oy }) => {
        const img = this.scene.add.image(px + ox, py + oy, textureKey);
        img.setDepth(3);
        return img;
      });
      this.ghostSprites.set(id, ghosts);
    } else {
      for (let i = 0; i < offsets.length; i++) {
        ghosts[i].setPosition(px + offsets[i].ox, py + offsets[i].oy);
      }
    }
  }

  destroy(): void {
    for (const [, sprite] of this.sprites) {
      sprite.destroy();
    }
    this.sprites.clear();
    for (const ghosts of this.ghostSprites.values()) {
      for (const g of ghosts) g.destroy();
    }
    this.ghostSprites.clear();
  }
}
