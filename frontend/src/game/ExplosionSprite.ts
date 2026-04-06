import { ExplosionState } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';

interface TrackedExplosion {
  sprites: Phaser.GameObjects.Sprite[];
  emitters: Phaser.GameObjects.Particles.ParticleEmitter[];
  fadingStarted: boolean;
}

export class ExplosionRenderer {
  private scene: Phaser.Scene;
  private tracked: Map<string, TrackedExplosion> = new Map();
  public wrappingWorldSize: { w: number; h: number } | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(explosions: ExplosionState[]): void {
    const activeIds = new Set(explosions.map((e) => e.id));

    // Remove sprites for explosions no longer in state
    for (const [id, tracked] of this.tracked) {
      if (!activeIds.has(id)) {
        this.destroyTracked(tracked);
        this.tracked.delete(id);
      }
    }

    for (const explosion of explosions) {
      const existing = this.tracked.get(explosion.id);

      if (!existing) {
        // New explosion — create sprites and particles
        this.createExplosion(explosion);
      } else {
        // Existing explosion — handle fade phase
        if (getSettings().animations && explosion.ticksRemaining <= 3 && !existing.fadingStarted) {
          existing.fadingStarted = true;
          for (const sprite of existing.sprites) {
            this.scene.tweens.add({
              targets: sprite,
              alpha: 0,
              scale: 1.3,
              duration: 150,
              ease: 'Power2',
            });
          }
        }
      }
    }
  }

  /** Get pixel positions for a cell, including ghost copies for wrapping maps */
  private getCellPositions(cellX: number, cellY: number): { x: number; y: number }[] {
    const px = cellX * TILE_SIZE + TILE_SIZE / 2;
    const py = cellY * TILE_SIZE + TILE_SIZE / 2;
    const positions = [{ x: px, y: py }];

    if (this.wrappingWorldSize) {
      const { w, h } = this.wrappingWorldSize;
      const thresholdX = w / 2;
      const thresholdY = h / 2;
      const nearLeft = cellX * TILE_SIZE < thresholdX;
      const nearRight = cellX * TILE_SIZE > w - thresholdX;
      const nearTop = cellY * TILE_SIZE < thresholdY;
      const nearBottom = cellY * TILE_SIZE > h - thresholdY;

      if (nearLeft) positions.push({ x: px + w, y: py });
      if (nearRight) positions.push({ x: px - w, y: py });
      if (nearTop) positions.push({ x: px, y: py + h });
      if (nearBottom) positions.push({ x: px, y: py - h });
      if (nearLeft && nearTop) positions.push({ x: px + w, y: py + h });
      if (nearLeft && nearBottom) positions.push({ x: px + w, y: py - h });
      if (nearRight && nearTop) positions.push({ x: px - w, y: py + h });
      if (nearRight && nearBottom) positions.push({ x: px - w, y: py - h });
    }

    return positions;
  }

  private createExplosion(explosion: ExplosionState): void {
    const sprites: Phaser.GameObjects.Sprite[] = [];
    const emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    const settings = getSettings();

    // The first cell is treated as the center for distance calculations
    const center = explosion.cells[0];

    for (let i = 0; i < explosion.cells.length; i++) {
      const cell = explosion.cells[i];
      const positions = this.getCellPositions(cell.x, cell.y);
      const distance = Math.abs(cell.x - center.x) + Math.abs(cell.y - center.y);

      for (const pos of positions) {
        const sprite = this.scene.add.sprite(pos.x, pos.y, 'explosion');
        sprite.setDepth(8);
        sprite.setAlpha(0.9);

        if (settings.animations) {
          const delay = 30 * distance;
          sprite.setScale(0.3);

          this.scene.tweens.add({
            targets: sprite,
            scale: 1.0,
            duration: 150,
            ease: 'Back.Out',
            delay,
            onComplete: () => {
              this.scene.tweens.add({
                targets: sprite,
                scale: { from: 0.95, to: 1.05 },
                duration: 200,
                yoyo: true,
                repeat: 2,
                ease: 'Sine.InOut',
              });
            },
          });
        }

        if (settings.particles) {
          const fireCount = 3 + Math.floor(Math.random() * 2);
          const fireEmitter = this.scene.add.particles(pos.x, pos.y, 'particle_fire', {
            speed: { min: 50, max: 100 },
            lifespan: 300,
            scale: { start: 1, end: 0 },
            tint: [0xff6600, 0xff4400, 0xffaa00],
            emitting: false,
          });
          fireEmitter.setDepth(9);
          fireEmitter.explode(fireCount);
          emitters.push(fireEmitter);

          this.scene.time.delayedCall(400, () => {
            if (fireEmitter && fireEmitter.active) {
              fireEmitter.destroy();
            }
          });

          const smokeCount = 2 + Math.floor(Math.random() * 2);
          const smokeEmitter = this.scene.add.particles(pos.x, pos.y, 'particle_smoke', {
            speed: { min: 20, max: 40 },
            lifespan: 600,
            scale: { start: 1, end: 0.5 },
            gravityY: -20,
            alpha: { start: 0.5, end: 0 },
            emitting: false,
          });
          smokeEmitter.setDepth(9);
          smokeEmitter.explode(smokeCount);
          emitters.push(smokeEmitter);

          this.scene.time.delayedCall(700, () => {
            if (smokeEmitter && smokeEmitter.active) {
              smokeEmitter.destroy();
            }
          });
        }

        sprites.push(sprite);
      }
    }

    this.tracked.set(explosion.id, {
      sprites,
      emitters,
      fadingStarted: false,
    });
  }

  private destroyTracked(tracked: TrackedExplosion): void {
    for (const sprite of tracked.sprites) {
      if (sprite && sprite.active) {
        this.scene.tweens.killTweensOf(sprite);
        sprite.destroy();
      }
    }
    for (const emitter of tracked.emitters) {
      if (emitter && emitter.active) {
        emitter.destroy();
      }
    }
  }

  destroy(): void {
    for (const tracked of this.tracked.values()) {
      this.destroyTracked(tracked);
    }
    this.tracked.clear();
  }
}
