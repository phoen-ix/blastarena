import Phaser from 'phaser';
import { PowerUpState } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';

export class PowerUpRenderer {
  private scene: Phaser.Scene;
  private sprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private _activeIds = new Set<string>();

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
      }
    }

    // Create sprites for new power-ups
    for (const powerUp of powerUps) {
      if (!this.sprites.has(powerUp.id)) {
        const sprite = this.scene.add.sprite(
          powerUp.position.x * TILE_SIZE + TILE_SIZE / 2,
          powerUp.position.y * TILE_SIZE + TILE_SIZE / 2,
          `powerup_${powerUp.type}`,
        );
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
    }
  }

  destroy(): void {
    for (const [, sprite] of this.sprites) {
      sprite.destroy();
    }
    this.sprites.clear();
  }
}
