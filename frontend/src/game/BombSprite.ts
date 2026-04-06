import Phaser from 'phaser';
import { BombState, PlayerCosmeticData, TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { BootScene } from '../scenes/BootScene';

interface PendingThrow {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export class BombSpriteRenderer {
  private scene: Phaser.Scene;
  private sprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private pulseTweens: Map<string, Phaser.Tweens.Tween> = new Map();
  private sparkEmitters: Map<string, Phaser.GameObjects.Particles.ParticleEmitter> = new Map();
  private playerCosmetics: Map<number, PlayerCosmeticData> = new Map();
  private _activeIds = new Set<string>();
  private pendingThrows: Map<string, PendingThrow> = new Map();
  public wrappingWorldSize: { w: number; h: number } | null = null;
  private ghostSprites: Map<string, Phaser.GameObjects.Image[]> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Register a bomb throw — called before update() so the arc animation plays on creation */
  registerThrow(
    bombId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    this.pendingThrows.set(bombId, { from, to });
  }

  setPlayerCosmetics(cosmetics: Map<number, PlayerCosmeticData>): void {
    this.playerCosmetics = cosmetics;
  }

  update(bombs: BombState[]): void {
    this._activeIds.clear();
    for (const b of bombs) this._activeIds.add(b.id);
    const activeIds = this._activeIds;
    const settings = getSettings();

    // Remove bombs that no longer exist
    for (const [id] of this.sprites) {
      if (!activeIds.has(id)) {
        this.removeBomb(id);
      }
    }

    for (const bomb of bombs) {
      const posX = bomb.position.x * TILE_SIZE + TILE_SIZE / 2;
      const posY = bomb.position.y * TILE_SIZE + TILE_SIZE / 2;
      const existing = this.sprites.get(bomb.id);

      if (existing) {
        // Update position for sliding/kicked bombs
        existing.x = posX;
        existing.y = posY;

        // Urgency effects when ticksRemaining < 20 (last second at 20 tps)
        if (bomb.ticksRemaining < 20) {
          // Flash red tint on/off - faster as timer counts down
          // At 19 ticks: slow flash; at 1 tick: very fast flash
          const flashRate = Math.max(1, Math.floor(bomb.ticksRemaining / 4));
          const showTint = bomb.ticksRemaining % (flashRate * 2) < flashRate;
          if (showTint) {
            existing.setTint(0xff2222);
          } else {
            existing.clearTint();
          }

          // Increase spark rate for urgency
          if (settings.particles) {
            const emitter = this.sparkEmitters.get(bomb.id);
            if (emitter) {
              emitter.setPosition(posX + 6, posY - 17);
              emitter.frequency = Math.max(20, bomb.ticksRemaining * 5);
            }
          }
        } else {
          existing.clearTint();

          // Update spark emitter position for sliding bombs
          if (settings.particles) {
            const emitter = this.sparkEmitters.get(bomb.id);
            if (emitter) {
              emitter.setPosition(posX + 6, posY - 17);
            }
          }
        }

        // Sync ghost sprites: position, texture, and visual properties (tint, scale, alpha)
        this.updateGhosts(bomb.id, posX, posY, existing.texture.key, existing);
      } else {
        // Create new bomb sprite — use different texture for remote bombs or custom skins
        const isRemote = bomb.bombType === 'remote';
        let textureKey = isRemote ? 'bomb_remote' : 'bomb';

        // Check for custom bomb skin from owner's cosmetics
        const ownerCosmetics = this.playerCosmetics.get(bomb.ownerId);
        if (ownerCosmetics?.bombSkinConfig && !isRemote) {
          const customKey = `bomb_custom_${ownerCosmetics.bombSkinConfig.label}`;
          BootScene.generateCustomBombTexture(this.scene, ownerCosmetics.bombSkinConfig);
          if (this.scene.textures.exists(customKey)) {
            textureKey = customKey;
          }
        }

        // Check if this bomb was thrown — start at origin and arc to landing position
        const throwData = this.pendingThrows.get(bomb.id);
        this.pendingThrows.delete(bomb.id);

        const startX = throwData ? throwData.from.x * TILE_SIZE + TILE_SIZE / 2 : posX;
        const startY = throwData ? throwData.from.y * TILE_SIZE + TILE_SIZE / 2 : posY;

        const sprite = this.scene.add.sprite(startX, startY, textureKey);
        sprite.setDepth(5);
        this.sprites.set(bomb.id, sprite);

        if (throwData) {
          // Arc animation: tween position with a vertical arc using onUpdate
          const dx = posX - startX;
          const dy = posY - startY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const arcHeight = Math.max(20, dist * 0.4);

          sprite.setDepth(15); // Above other sprites during flight
          sprite.setScale(0.8);

          this.scene.tweens.add({
            targets: sprite,
            x: posX,
            y: posY,
            scale: 1,
            duration: 300,
            ease: 'Sine.easeOut',
            onUpdate: (tween) => {
              // Parabolic arc offset: peak at midpoint
              const p = tween.progress;
              const arc = -4 * arcHeight * p * (p - 1);
              sprite.y = startY + (posY - startY) * p - arc;
            },
            onComplete: () => {
              sprite.setDepth(5);
            },
          });
        }

        if (isRemote) {
          // Remote bombs: pulsing scale + slow alpha blink (blue texture distinguishes them)
          const tween = this.scene.tweens.add({
            targets: sprite,
            scaleX: 1.15,
            scaleY: 1.15,
            alpha: 0.5,
            duration: 600,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
          this.pulseTweens.set(bomb.id, tween);
        } else {
          // Normal/pierce bombs: pulsing scale
          const tween = this.scene.tweens.add({
            targets: sprite,
            scaleX: 1.15,
            scaleY: 1.15,
            duration: 300,
            yoyo: true,
            repeat: -1,
          });
          this.pulseTweens.set(bomb.id, tween);
        }

        // Add fuse spark particles (not for remote bombs — they have no fuse)
        if (settings.particles && !isRemote) {
          const fuseX = posX + 6;
          const fuseY = posY - 17;
          const emitter = this.scene.add.particles(fuseX, fuseY, 'particle_spark', {
            speed: { min: 15, max: 50 },
            lifespan: 250,
            scale: { start: 1, end: 0.2 },
            alpha: { start: 1, end: 0 },
            quantity: 1,
            frequency: 100,
            gravityY: -40,
            angle: { min: 230, max: 310 },
            tint: [0xffff88, 0xff8800, 0xffaa44],
          });
          this.sparkEmitters.set(bomb.id, emitter);
        }
      }
    }
  }

  private updateGhosts(
    bombId: string,
    px: number,
    py: number,
    textureKey: string,
    canonical?: Phaser.GameObjects.Sprite,
  ): void {
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

    let ghosts = this.ghostSprites.get(bombId);

    // Remove old ghosts if count changed
    if (ghosts && ghosts.length !== offsets.length) {
      for (const g of ghosts) g.destroy();
      ghosts = undefined;
      this.ghostSprites.delete(bombId);
    }

    if (offsets.length === 0) {
      if (ghosts) {
        for (const g of ghosts) g.destroy();
        this.ghostSprites.delete(bombId);
      }
      return;
    }

    if (!ghosts) {
      ghosts = offsets.map(({ ox, oy }) => {
        const img = this.scene.add.image(px + ox, py + oy, textureKey);
        img.setDepth(5);
        return img;
      });
      this.ghostSprites.set(bombId, ghosts);
    }

    // Sync position, texture, and visual properties from canonical sprite
    for (let i = 0; i < offsets.length; i++) {
      ghosts[i].setPosition(px + offsets[i].ox, py + offsets[i].oy);
      ghosts[i].setTexture(textureKey);
      if (canonical) {
        ghosts[i].setScale(canonical.scaleX, canonical.scaleY);
        ghosts[i].setAlpha(canonical.alpha);
        if (canonical.tintTopLeft !== 0xffffff) {
          ghosts[i].setTint(canonical.tintTopLeft);
        } else {
          ghosts[i].clearTint();
        }
      }
    }
  }

  destroy(): void {
    for (const [id] of this.sprites) {
      this.removeBomb(id);
    }
    this.sprites.clear();
    this.pulseTweens.clear();
    this.sparkEmitters.clear();
    for (const ghosts of this.ghostSprites.values()) {
      for (const g of ghosts) g.destroy();
    }
    this.ghostSprites.clear();
  }

  private removeBomb(id: string): void {
    const sprite = this.sprites.get(id);
    if (sprite) {
      sprite.destroy();
      this.sprites.delete(id);
    }

    const tween = this.pulseTweens.get(id);
    if (tween) {
      tween.destroy();
      this.pulseTweens.delete(id);
    }

    const emitter = this.sparkEmitters.get(id);
    if (emitter) {
      emitter.destroy();
      this.sparkEmitters.delete(id);
    }

    const ghosts = this.ghostSprites.get(id);
    if (ghosts) {
      for (const g of ghosts) g.destroy();
      this.ghostSprites.delete(id);
    }
  }
}
