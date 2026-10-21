import Phaser from 'phaser';
import { CampaignEnemyState, TILE_SIZE, TICK_MS } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { DEPTH, Y_BIAS, setDepthIfChanged, ySortDepth } from '../art/depth';
import { base, fit } from '../art/scale';
import type { StyledFx } from '../art/StyledFx';

/** Fraction of the remaining distance covered per server tick; frame() rescales it per frame. */
const LERP_PER_TICK = 0.45;
/**
 * A target that moves further than this between two states (a teleporter, a replay seek) is drawn
 * as a jump instead of a slide across the map. One tick moves an enemy two tiles at most (a step
 * or conveyor push onto ice, then the slide).
 */
const SNAP_DISTANCE = TILE_SIZE * 3;

export class EnemySpriteRenderer {
  private scene: Phaser.Scene;
  private sprites: Map<number, Phaser.GameObjects.Sprite> = new Map();
  private hpBars: Map<number, Phaser.GameObjects.Graphics> = new Map();
  /**
   * Where each sprite is heading. frame() moves it there once per rendered frame, like players;
   * enemies used to be lerped only when a state arrived, so they stepped at 20 Hz.
   */
  private targets: Map<number, { x: number; y: number }> = new Map();
  /** What each HP bar last showed; bars are drawn at their origin and only redrawn on change. */
  private drawnHp: Map<number, string> = new Map();
  /**
   * Enemies whose death animation has already been started. A dead enemy stays in the state for
   * several ticks while `sprite.visible` is still true (the tween hides it only on completion), so
   * without this guard every tick re-tinted the sprite and stacked another shrink/fade tween on
   * it — ~6 per death. Same idea as PlayerSprite's activeMoveAnim. (audit C5)
   */
  private dying: Set<number> = new Set();

  /** Set for the drawn art styles; null keeps the classic enemy textures. */
  private fx: StyledFx | null;
  /** Size multiplier per enemy type (bosses), drawn styles only for now. */
  private sizeByType: Map<number, number> = new Map();

  constructor(scene: Phaser.Scene, fx: StyledFx | null = null) {
    this.scene = scene;
    this.fx = fx;
  }

  /** Drawn styles: bake each enemy type's frames and remember its size. */
  setEnemyTypes(
    types: { id: number; config: { sprite: unknown; sizeMultiplier?: number } }[],
  ): void {
    if (!this.fx) return;
    for (const t of types) {
      this.fx.art.ensureEnemy(this.scene, t.id, t.config.sprite as never);
      this.sizeByType.set(t.id, Math.max(1, Math.min(3, t.config.sizeMultiplier ?? 1)));
    }
  }

  private styledScale(sprite: Phaser.GameObjects.Sprite, typeId: number): number {
    return base(sprite) * (this.sizeByType.get(typeId) ?? 1);
  }

  update(enemies: CampaignEnemyState[]): void {
    const activeIds = new Set(enemies.map((e) => e.id));
    const settings = getSettings();

    // Remove sprites for enemies no longer present
    for (const [id] of this.sprites) {
      if (!activeIds.has(id)) {
        this.removeEnemy(id);
      }
    }

    for (const enemy of enemies) {
      const targetX = enemy.position.x * TILE_SIZE + TILE_SIZE / 2;
      const targetY = enemy.position.y * TILE_SIZE + TILE_SIZE / 2;

      let sprite = this.sprites.get(enemy.id);

      if (!sprite && this.fx) {
        const key = this.fx.art.enemyKey(enemy.enemyTypeId);
        if (!this.scene.textures.exists(key)) continue;
        sprite = this.scene.add.sprite(targetX, targetY, key, `${enemy.direction}:0`);
        sprite.setScale(this.styledScale(sprite, enemy.enemyTypeId));
        sprite.setDepth(ySortDepth(targetY + 20, Y_BIAS.ENEMY));
        const anim = this.fx.art.enemyAnim(enemy.enemyTypeId, enemy.direction);
        if (settings.animations && this.scene.anims.exists(anim)) sprite.play(anim);
        this.sprites.set(enemy.id, sprite);
      } else if (!sprite) {
        // Create new sprite
        const textureKey = `enemy_${enemy.enemyTypeId}_${enemy.direction}`;
        if (!this.scene.textures.exists(textureKey)) continue;

        sprite = fit(this.scene.add.sprite(targetX, targetY, textureKey));
        sprite.setDepth(DEPTH.ENEMY);

        if (enemy.isBoss) {
          // Boss scaling handled via sizeMultiplier on texture, keep sprite at 1x
        }

        this.sprites.set(enemy.id, sprite);
      }

      // Update texture for direction changes
      const textureKey = `enemy_${enemy.enemyTypeId}_${enemy.direction}`;
      if (this.fx) {
        const anim = this.fx.art.enemyAnim(enemy.enemyTypeId, enemy.direction);
        if (sprite.anims?.currentAnim?.key !== anim && enemy.alive) {
          if (settings.animations && this.scene.anims.exists(anim)) sprite.play(anim);
          else sprite.setFrame(`${enemy.direction}:0`);
        }
      } else if (this.scene.textures.exists(textureKey) && sprite.texture.key !== textureKey) {
        fit(sprite.setTexture(textureKey));
      }

      if (!enemy.alive) {
        // Death animation — once per enemy (audit C5)
        if (sprite.visible && !this.dying.has(enemy.id)) {
          this.dying.add(enemy.id);
          if (settings.animations && this.fx) {
            // Pop, flash white and vanish into a puff.
            const s0 = sprite.scaleX;
            sprite.setTint(0xffffff);
            sprite.setTintMode(Phaser.TintModes.FILL);
            this.fx.puff(sprite.x, sprite.y, 6);
            this.scene.tweens.add({
              targets: sprite,
              scaleX: s0 * 1.25,
              scaleY: s0 * 0.8,
              alpha: 0,
              duration: 240,
              ease: 'Quad.Out',
              onComplete: () => sprite!.setVisible(false),
            });
          } else if (settings.animations) {
            sprite.setTint(0xff0000);
            this.scene.tweens.add({
              targets: sprite,
              scaleX: 0.2 * base(sprite),
              scaleY: 0.2 * base(sprite),
              alpha: 0,
              duration: 300,
              onComplete: () => {
                sprite!.setVisible(false);
              },
            });
          } else {
            sprite.setVisible(false);
          }
          // Remove HP bar
          const hpBar = this.hpBars.get(enemy.id);
          if (hpBar) {
            hpBar.destroy();
            this.hpBars.delete(enemy.id);
            this.drawnHp.delete(enemy.id);
          }
        }
        continue;
      }

      // Ghost enemies get translucency
      if (sprite.alpha > 0.5 && textureKey.includes('ghost')) {
        sprite.setAlpha(0.7);
      }

      // Record where the sprite should head; frame() moves it there
      const target = this.targets.get(enemy.id);
      if (target) {
        const dx = targetX - target.x;
        const dy = targetY - target.y;
        if (dx * dx + dy * dy > SNAP_DISTANCE * SNAP_DISTANCE) sprite.setPosition(targetX, targetY);
        target.x = targetX;
        target.y = targetY;
      } else {
        this.targets.set(enemy.id, { x: targetX, y: targetY });
      }

      // HP bar for enemies with HP > 1
      if (enemy.maxHp > 1) {
        this.updateHPBar(enemy, sprite.x, sprite.y);
      }
    }
  }

  /**
   * Per-frame pass, driven from GameScene.update(): moves every living enemy toward its target
   * at the players' visual speed, whatever the frame rate, and keeps its HP bar on it.
   */
  frame(delta: number): void {
    if (this.sprites.size === 0) return;
    const k = 1 - Math.pow(1 - LERP_PER_TICK, delta / TICK_MS);
    for (const [id, sprite] of this.sprites) {
      if (this.dying.has(id)) continue;
      const target = this.targets.get(id);
      if (!target) continue;
      sprite.setPosition(
        sprite.x + (target.x - sprite.x) * k,
        sprite.y + (target.y - sprite.y) * k,
      );
      if (this.fx) setDepthIfChanged(sprite, ySortDepth(sprite.y + 20, Y_BIAS.ENEMY));
      this.hpBars.get(id)?.setPosition(sprite.x, sprite.y);
    }
  }

  private updateHPBar(enemy: CampaignEnemyState, x: number, y: number): void {
    let bar = this.hpBars.get(enemy.id);
    if (!bar) {
      bar = this.scene.add.graphics();
      bar.setDepth(DEPTH.HP_BAR);
      bar.setPosition(x, y);
      this.hpBars.set(enemy.id, bar);
    }
    const shown = `${enemy.hp}/${enemy.maxHp}/${enemy.isBoss}`;
    if (this.drawnHp.get(enemy.id) === shown) return;
    this.drawnHp.set(enemy.id, shown);

    // Drawn around the bar's origin; frame() moves the Graphics with the sprite
    bar.clear();
    const barWidth = enemy.isBoss ? 40 : 28;
    const barHeight = 4;
    const barX = -barWidth / 2;
    const barY = -TILE_SIZE / 2 - 6;

    // Background
    bar.fillStyle(0x000000, 0.6);
    bar.fillRect(barX, barY, barWidth, barHeight);

    // Health fill
    const hpRatio = enemy.hp / enemy.maxHp;
    const color = hpRatio > 0.5 ? 0x44ff44 : hpRatio > 0.25 ? 0xffaa22 : 0xff3355;
    bar.fillStyle(color, 0.9);
    bar.fillRect(barX, barY, barWidth * hpRatio, barHeight);
  }

  /** True once the death animation for this enemy has been started (test seam). */
  isDying(id: number): boolean {
    return this.dying.has(id);
  }

  private removeEnemy(id: number): void {
    const sprite = this.sprites.get(id);
    if (sprite) {
      this.scene.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    this.sprites.delete(id);

    const bar = this.hpBars.get(id);
    if (bar) bar.destroy();
    this.hpBars.delete(id);
    this.drawnHp.delete(id);

    this.targets.delete(id);
    this.dying.delete(id);
  }

  destroy(): void {
    for (const [id] of this.sprites) {
      this.removeEnemy(id);
    }
    this.dying.clear();
  }
}
