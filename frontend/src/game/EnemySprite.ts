import Phaser from 'phaser';
import { CampaignEnemyState, TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';

const LERP_FACTOR = 0.45;

export class EnemySpriteRenderer {
  private scene: Phaser.Scene;
  private sprites: Map<number, Phaser.GameObjects.Sprite> = new Map();
  private hpBars: Map<number, Phaser.GameObjects.Graphics> = new Map();
  private prevPositions: Map<number, { x: number; y: number }> = new Map();
  /**
   * Enemies whose death animation has already been started. A dead enemy stays in the state for
   * several ticks while `sprite.visible` is still true (the tween hides it only on completion), so
   * without this guard every tick re-tinted the sprite and stacked another shrink/fade tween on
   * it — ~6 per death. Same idea as PlayerSprite's activeMoveAnim. (audit C5)
   */
  private dying: Set<number> = new Set();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
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

      if (!sprite) {
        // Create new sprite
        const textureKey = `enemy_${enemy.enemyTypeId}_${enemy.direction}`;
        if (!this.scene.textures.exists(textureKey)) continue;

        sprite = this.scene.add.sprite(targetX, targetY, textureKey);
        sprite.setDepth(9);

        if (enemy.isBoss) {
          // Boss scaling handled via sizeMultiplier on texture, keep sprite at 1x
        }

        this.sprites.set(enemy.id, sprite);
        this.prevPositions.set(enemy.id, { x: targetX, y: targetY });
      }

      // Update texture for direction changes
      const textureKey = `enemy_${enemy.enemyTypeId}_${enemy.direction}`;
      if (this.scene.textures.exists(textureKey) && sprite.texture.key !== textureKey) {
        sprite.setTexture(textureKey);
      }

      if (!enemy.alive) {
        // Death animation — once per enemy (audit C5)
        if (sprite.visible && !this.dying.has(enemy.id)) {
          this.dying.add(enemy.id);
          if (settings.animations) {
            sprite.setTint(0xff0000);
            this.scene.tweens.add({
              targets: sprite,
              scaleX: 0.2,
              scaleY: 0.2,
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
          }
        }
        continue;
      }

      // Ghost enemies get translucency
      if (sprite.alpha > 0.5 && textureKey.includes('ghost')) {
        sprite.setAlpha(0.7);
      }

      // Smooth position interpolation
      const prev = this.prevPositions.get(enemy.id) ?? { x: targetX, y: targetY };
      const newX = prev.x + (targetX - prev.x) * LERP_FACTOR;
      const newY = prev.y + (targetY - prev.y) * LERP_FACTOR;
      sprite.setPosition(newX, newY);
      this.prevPositions.set(enemy.id, { x: newX, y: newY });

      // HP bar for enemies with HP > 1
      if (enemy.maxHp > 1) {
        this.updateHPBar(enemy, newX, newY);
      }
    }
  }

  private updateHPBar(enemy: CampaignEnemyState, x: number, y: number): void {
    let bar = this.hpBars.get(enemy.id);
    if (!bar) {
      bar = this.scene.add.graphics();
      bar.setDepth(11);
      this.hpBars.set(enemy.id, bar);
    }

    bar.clear();
    const barWidth = enemy.isBoss ? 40 : 28;
    const barHeight = 4;
    const barX = x - barWidth / 2;
    const barY = y - TILE_SIZE / 2 - 6;

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

    this.prevPositions.delete(id);
    this.dying.delete(id);
  }

  destroy(): void {
    for (const [id] of this.sprites) {
      this.removeEnemy(id);
    }
    this.dying.clear();
  }
}
