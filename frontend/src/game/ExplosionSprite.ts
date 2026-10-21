import Phaser from 'phaser';
import { ExplosionState } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { wrapGhostPositions } from '../utils/wrapGhosts';
import { DEPTH, Y_BIAS, ySortDepth } from '../art/depth';
import { base, fit } from '../art/scale';
import { explosionPieces } from '../art/explosionPieces';
import type { StyledFx } from '../art/StyledFx';

interface TrackedExplosion {
  sprites: Phaser.GameObjects.Sprite[];
  emitters: Phaser.GameObjects.Particles.ParticleEmitter[];
  fadingStarted: boolean;
}

const EMITTER_SOFT_CAP = 20;
const EMITTER_HARD_CAP = 40;

export class ExplosionRenderer {
  private scene: Phaser.Scene;
  private tracked: Map<string, TrackedExplosion> = new Map();
  public wrappingWorldSize: { w: number; h: number } | null = null;
  private activeEmitterCount: number = 0;
  /** Reused across ticks instead of a fresh Set per update, like BombSpriteRenderer. (audit F5) */
  private _activeIds = new Set<string>();

  /** Set for the drawn art styles; null draws the classic blob per cell. */
  private fx: StyledFx | null;

  constructor(scene: Phaser.Scene, fx: StyledFx | null = null) {
    this.scene = scene;
    this.fx = fx;
  }

  update(explosions: ExplosionState[]): void {
    this._activeIds.clear();
    for (const e of explosions) this._activeIds.add(e.id);
    const activeIds = this._activeIds;

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
        if (this.fx) this.createStyledExplosion(explosion, this.fx);
        else this.createExplosion(explosion);
      } else if (!this.fx) {
        // Existing explosion — handle fade phase
        if (getSettings().animations && explosion.ticksRemaining <= 3 && !existing.fadingStarted) {
          existing.fadingStarted = true;
          for (const sprite of existing.sprites) {
            this.scene.tweens.add({
              targets: sprite,
              alpha: 0,
              scale: 1.3 * base(sprite),
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

    if (!this.wrappingWorldSize) return [{ x: px, y: py }];

    // Every explosion cell used to get three wrapped copies unconditionally — the threshold was
    // half the world size, which matches every position. A fire-range-5 bomb (~11 cells) therefore
    // created ~44 sprites and instantly saturated EMITTER_HARD_CAP, so a player's own explosion had
    // its particles suppressed by off-screen ghost copies. (audit WRAP-GHOST-1)
    const { w, h } = this.wrappingWorldSize;
    return wrapGhostPositions(this.scene.cameras.main.worldView, px, py, w, h, TILE_SIZE);
  }

  /**
   * Drawn styles: one sprite per cell playing the baked life of its flame piece (centre, arm or
   * end cap, so the cross reads as one connected shape), rippling out from the centre, with
   * light pools, a shockwave and scorch marks.
   */
  private createStyledExplosion(explosion: ExplosionState, fx: StyledFx): void {
    const art = fx.art;
    const sprites: Phaser.GameObjects.Sprite[] = [];
    const key = art.fxKey();
    const animations = getSettings().animations;
    const additive = art.painters.id === 'neon';
    const wrapTiles = this.wrappingWorldSize
      ? { w: this.wrappingWorldSize.w / TILE_SIZE, h: this.wrappingWorldSize.h / TILE_SIZE }
      : undefined;
    const pieces = explosionPieces(explosion.cells, wrapTiles);
    const center = explosion.cells[0];
    const pierce = !!explosion.pierce;
    const pal = art.painters.palette;

    for (const piece of pieces) {
      const dir =
        piece.role === 'center'
          ? 'down'
          : piece.role === 'arm'
            ? piece.dir === 'left' || piece.dir === 'right'
              ? 'right'
              : 'down'
            : (piece.dir ?? 'down');
      const anim = art.flameAnim(piece.role, dir, pierce);
      const distance = Math.abs(piece.x - center.x) + Math.abs(piece.y - center.y);
      for (const pos of this.getCellPositions(piece.x, piece.y)) {
        const sprite = fit(this.scene.add.sprite(pos.x, pos.y, key));
        sprite.setDepth(ySortDepth(pos.y + TILE_SIZE / 2, Y_BIAS.FLAME));
        if (additive) sprite.setBlendMode(Phaser.BlendModes.ADD);
        const play = () => {
          if (!sprite.active) return;
          sprite.setVisible(true);
          if (this.scene.anims.exists(anim)) sprite.play(anim);
        };
        if (animations && distance > 0) {
          sprite.setVisible(false);
          this.scene.time.delayedCall(18 * distance, play);
        } else {
          play();
        }
        sprites.push(sprite);
      }
    }

    // Light, shockwave and scorch at the centre (and its wrapped copies on screen).
    for (const pos of this.getCellPositions(center.x, center.y)) {
      fx.light(pos.x, pos.y, TILE_SIZE * 2.6, pal.flameLight, 0.85, 520);
      fx.shockwave(pos.x, pos.y, 1.4 + Math.min(4, explosion.cells.length / 4) * 0.35, pal.shock);
      fx.scorch(pos.x, pos.y, true);
    }
    for (const piece of pieces) {
      if (piece.role === 'end') {
        for (const pos of this.getCellPositions(piece.x, piece.y)) {
          fx.light(pos.x, pos.y, TILE_SIZE * 1.4, pal.flameLight, 0.5, 420);
        }
      }
      if (piece.role !== 'center' && Math.random() < 0.3) {
        const pos = this.getCellPositions(piece.x, piece.y)[0];
        fx.scorch(pos.x, pos.y, false);
      }
    }

    this.tracked.set(explosion.id, { sprites, emitters: [], fadingStarted: true });
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
        sprite.setDepth(DEPTH.EXPLOSION);
        sprite.setAlpha(0.9);
        const b = base(sprite);
        sprite.setScale(b);

        if (settings.animations) {
          const delay = 30 * distance;
          sprite.setScale(0.3 * b);

          this.scene.tweens.add({
            targets: sprite,
            scale: b,
            duration: 150,
            ease: 'Back.Out',
            delay,
            onComplete: () => {
              this.scene.tweens.add({
                targets: sprite,
                scale: { from: 0.95 * b, to: 1.05 * b },
                duration: 200,
                yoyo: true,
                repeat: 2,
                ease: 'Sine.InOut',
              });
            },
          });
        }

        if (settings.particles && this.activeEmitterCount < EMITTER_HARD_CAP) {
          const isReduced = this.activeEmitterCount >= EMITTER_SOFT_CAP;
          const fireCount = isReduced ? 2 : 3 + Math.floor(Math.random() * 2);
          const fireEmitter = this.scene.add.particles(pos.x, pos.y, 'particle_fire', {
            speed: { min: 50, max: 100 },
            lifespan: isReduced ? 200 : 300,
            scale: { start: 1, end: 0 },
            tint: [0xff6600, 0xff4400, 0xffaa00],
            emitting: false,
          });
          fireEmitter.setDepth(DEPTH.EXPLOSION_FX);
          fireEmitter.explode(fireCount);
          emitters.push(fireEmitter);
          this.activeEmitterCount++;

          this.scene.time.delayedCall(isReduced ? 300 : 400, () => {
            if (fireEmitter && fireEmitter.active) {
              fireEmitter.destroy();
            }
            this.activeEmitterCount = Math.max(0, this.activeEmitterCount - 1);
          });

          if (!isReduced) {
            const smokeCount = 2 + Math.floor(Math.random() * 2);
            const smokeEmitter = this.scene.add.particles(pos.x, pos.y, 'particle_smoke', {
              speed: { min: 20, max: 40 },
              lifespan: 600,
              scale: { start: 1, end: 0.5 },
              gravityY: -20,
              alpha: { start: 0.5, end: 0 },
              emitting: false,
            });
            smokeEmitter.setDepth(DEPTH.EXPLOSION_FX);
            smokeEmitter.explode(smokeCount);
            emitters.push(smokeEmitter);
            this.activeEmitterCount++;

            this.scene.time.delayedCall(700, () => {
              if (smokeEmitter && smokeEmitter.active) {
                smokeEmitter.destroy();
              }
              this.activeEmitterCount = Math.max(0, this.activeEmitterCount - 1);
            });
          }
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
        this.activeEmitterCount = Math.max(0, this.activeEmitterCount - 1);
      }
    }
  }

  destroy(): void {
    for (const tracked of this.tracked.values()) {
      this.destroyTracked(tracked);
    }
    this.tracked.clear();
    this.activeEmitterCount = 0;
  }
}
