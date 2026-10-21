import Phaser from 'phaser';
import { BombState, PlayerCosmeticData, TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { BootScene } from '../scenes/BootScene';
import { wrapGhostOffsets } from '../utils/wrapGhosts';
import { DEPTH, Y_BIAS, setDepthIfChanged, ySortDepth } from '../art/depth';
import { base, fit } from '../art/scale';
import { fuseFraction, fuseFrame } from '../art/explosionPieces';
import { StyleArt } from '../art/StyleArt';
import type { StyledFx } from '../art/StyledFx';
import type { BombType } from '../art/painters/types';

/** Where the classic bomb texture's fuse tip sits, relative to the bomb's centre. */
const FUSE_TIP_DX = 6;
const FUSE_TIP_DY = -17;

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

  /** Set for the drawn art styles; null keeps the classic bomb. */
  private fx: StyledFx | null;
  /** Owner-colour stripes (drawn styles), one per bomb. */
  private bands: Map<string, Phaser.GameObjects.Image> = new Map();
  /** Body colour of a player, so a bomb's stripe matches its owner. */
  ownerColor: (playerId: number) => number | undefined = () => undefined;

  constructor(scene: Phaser.Scene, fx: StyledFx | null = null) {
    this.scene = scene;
    this.fx = fx;
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

      if (existing && this.fx) {
        this.updateStyledBomb(bomb, existing, posX, posY, this.fx);
      } else if (existing) {
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
              emitter.setPosition(posX + FUSE_TIP_DX, posY + FUSE_TIP_DY);
              emitter.frequency = Math.max(20, bomb.ticksRemaining * 5);
            }
          }
        } else {
          existing.clearTint();

          // Update spark emitter position for sliding bombs
          if (settings.particles) {
            const emitter = this.sparkEmitters.get(bomb.id);
            if (emitter) {
              emitter.setPosition(posX + FUSE_TIP_DX, posY + FUSE_TIP_DY);
            }
          }
        }

        // Sync ghost sprites: position, texture, and visual properties (tint, scale, alpha)
        this.updateGhosts(bomb.id, posX, posY, existing.texture.key, existing);
      } else if (this.fx) {
        this.createStyledBomb(bomb, posX, posY, this.fx);
      } else {
        // Create new bomb sprite — use different texture for remote bombs or custom skins
        const isRemote = bomb.bombType === 'remote';
        let textureKey = isRemote ? 'bomb_remote' : 'bomb';

        // Check for custom bomb skin from owner's cosmetics
        const ownerCosmetics = this.playerCosmetics.get(bomb.ownerId);
        if (ownerCosmetics?.bombSkinConfig && !isRemote) {
          const customKey = BootScene.customBombKey(ownerCosmetics.bombSkinConfig);
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
        sprite.setDepth(DEPTH.BOMB);
        const b = base(sprite);
        sprite.setScale(b);
        this.sprites.set(bomb.id, sprite);

        if (throwData) {
          // Arc animation: tween position with a vertical arc using onUpdate
          let dx = posX - startX;
          let dy = posY - startY;

          // Wrap-aware: use shortest-path pixel delta for toroidal maps
          if (this.wrappingWorldSize) {
            const { w, h } = this.wrappingWorldSize;
            if (dx > w / 2) dx -= w;
            else if (dx < -w / 2) dx += w;
            if (dy > h / 2) dy -= h;
            else if (dy < -h / 2) dy += h;
          }

          const dist = Math.sqrt(dx * dx + dy * dy);
          const arcHeight = Math.max(20, dist * 0.4);

          // Recompute start so the animation follows the shortest path
          const adjStartX = posX - dx;
          const adjStartY = posY - dy;
          sprite.setPosition(adjStartX, adjStartY);

          sprite.setDepth(DEPTH.THROWN_BOMB); // Above other sprites during flight
          sprite.setScale(0.8 * b);

          // Scale duration for long throws (300ms base for 3 tiles, up to 600ms)
          const baseDist = 3 * TILE_SIZE;
          const duration = Math.min(600, Math.max(300, (dist / baseDist) * 300));

          this.scene.tweens.add({
            targets: sprite,
            x: posX,
            y: posY,
            scale: b,
            duration,
            ease: 'Sine.easeOut',
            onUpdate: (tween) => {
              // Parabolic arc offset: peak at midpoint
              const p = tween.progress;
              const arc = -4 * arcHeight * p * (p - 1);
              sprite.y = adjStartY + dy * p - arc;
            },
            onComplete: () => {
              sprite.setDepth(DEPTH.BOMB);
            },
          });
        }

        if (isRemote) {
          // Remote bombs: pulsing scale + slow alpha blink (blue texture distinguishes them)
          const tween = this.scene.tweens.add({
            targets: sprite,
            scaleX: 1.15 * b,
            scaleY: 1.15 * b,
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
            scaleX: 1.15 * b,
            scaleY: 1.15 * b,
            duration: 300,
            yoyo: true,
            repeat: -1,
          });
          this.pulseTweens.set(bomb.id, tween);
        }

        // Add fuse spark particles (not for remote bombs — they have no fuse)
        if (settings.particles && !isRemote) {
          const fuseX = posX + FUSE_TIP_DX;
          const fuseY = posY + FUSE_TIP_DY;
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

  /** Frame for a drawn-style bomb at its current fuse. */
  private styledFrame(bomb: BombState): string {
    const type = bomb.bombType as BombType;
    const spark = (Math.floor(this.scene.time.now / 110) % 2) as 0 | 1;
    if (bomb.ticksRemaining < 20 && type !== 'remote')
      return StyleArt.bombFrame(type, 'hot', spark);
    if (type === 'remote') return StyleArt.bombFrame('remote', 0, spark);
    const art = this.fx!.art;
    const i = fuseFrame(fuseFraction(bomb.ticksRemaining, type), art.fuseFrames);
    return StyleArt.bombFrame(type, i, spark);
  }

  private createStyledBomb(bomb: BombState, posX: number, posY: number, fx: StyledFx): void {
    const art = fx.art;
    const key = art.fxKey();
    const settings = getSettings();
    const throwData = this.pendingThrows.get(bomb.id);
    this.pendingThrows.delete(bomb.id);

    const sprite = fit(this.scene.add.sprite(posX, posY, key, this.styledFrame(bomb)));
    sprite.setDepth(ySortDepth(posY + 16, Y_BIAS.BOMB));
    this.sprites.set(bomb.id, sprite);

    const band = fit(
      this.scene.add.image(posX, posY, key, StyleArt.bandFrame(bomb.bombType as BombType)),
    );
    band.setTint(this.ownerColor(bomb.ownerId) ?? 0xffffff);
    band.setDepth(sprite.depth + 0.01);
    this.bands.set(bomb.id, band);

    const b = base(sprite);
    if (throwData) {
      let dx = posX - (throwData.from.x * TILE_SIZE + TILE_SIZE / 2);
      let dy = posY - (throwData.from.y * TILE_SIZE + TILE_SIZE / 2);
      if (this.wrappingWorldSize) {
        const { w, h } = this.wrappingWorldSize;
        if (dx > w / 2) dx -= w;
        else if (dx < -w / 2) dx += w;
        if (dy > h / 2) dy -= h;
        else if (dy < -h / 2) dy += h;
      }
      const dist = Math.sqrt(dx * dx + dy * dy);
      const arcHeight = Math.max(20, dist * 0.4);
      const sx = posX - dx;
      const sy = posY - dy;
      sprite.setPosition(sx, sy);
      sprite.setDepth(DEPTH.THROWN_BOMB);
      sprite.setScale(0.8 * b);
      const duration = Math.min(600, Math.max(300, (dist / (3 * TILE_SIZE)) * 300));
      this.scene.tweens.add({
        targets: sprite,
        x: posX,
        y: posY,
        scale: b,
        duration,
        ease: 'Sine.easeOut',
        onUpdate: (tween) => {
          const p = tween.progress;
          sprite.y = sy + dy * p + 4 * arcHeight * p * (p - 1);
        },
        onComplete: () => {
          sprite.setDepth(ySortDepth(posY + 16, Y_BIAS.BOMB));
          fx.dust(posX, posY + 14, 4);
        },
      });
    } else if (settings.animations) {
      // Plop down onto the floor.
      sprite.setScale(b * 1.25, b * 0.75);
      this.scene.tweens.add({
        targets: sprite,
        scaleX: b,
        scaleY: b,
        duration: 180,
        ease: 'Back.Out',
      });
    }

    if (settings.particles && bomb.bombType !== 'remote') {
      const tip = art.painters.fuseTip;
      const emitter = this.scene.add.particles(posX + tip.x, posY + tip.y, key, {
        frame: StyleArt.fxFrame('spark'),
        speed: { min: 15, max: 50 },
        lifespan: 260,
        scale: { start: 0.35 / art.scale, end: 0 },
        alpha: { start: 1, end: 0 },
        quantity: 1,
        frequency: 110,
        gravityY: -40,
        angle: { min: 230, max: 310 },
        blendMode: Phaser.BlendModes.ADD,
      });
      emitter.setDepth(DEPTH.IMPACT);
      this.sparkEmitters.set(bomb.id, emitter);
    }
  }

  private updateStyledBomb(
    bomb: BombState,
    sprite: Phaser.GameObjects.Sprite,
    posX: number,
    posY: number,
    fx: StyledFx,
  ): void {
    const settings = getSettings();
    // While a thrown bomb is in the air its arc tween owns the position.
    const inFlight = sprite.depth === DEPTH.THROWN_BOMB;
    if (!inFlight) {
      const moving = Math.abs(sprite.x - posX) > 0.5 || Math.abs(sprite.y - posY) > 0.5;
      if (moving && bomb.slideDir) fx.dust(sprite.x, sprite.y + 14, 2);
      sprite.x = posX;
      sprite.y = posY;
    }
    sprite.setFrame(this.styledFrame(bomb));
    if (sprite.depth !== DEPTH.THROWN_BOMB) {
      setDepthIfChanged(sprite, ySortDepth(posY + 16, Y_BIAS.BOMB));
    }

    // The last second: swell and throb, faster as it runs out.
    const b = base(sprite);
    if (bomb.ticksRemaining < 20 && bomb.bombType !== 'remote' && settings.animations) {
      const phase = this.scene.time.now / (60 + bomb.ticksRemaining * 6);
      const s = b * (1.08 + 0.07 * Math.sin(phase * Math.PI));
      sprite.setScale(s);
    } else if (!this.scene.tweens.isTweening(sprite)) {
      const breathe = settings.animations ? 1 + 0.03 * Math.sin(this.scene.time.now / 180) : 1;
      sprite.setScale(b * breathe);
    }

    const band = this.bands.get(bomb.id);
    if (band) {
      band.setPosition(sprite.x, sprite.y);
      band.setScale(sprite.scaleX, sprite.scaleY);
      band.setDepth(sprite.depth + 0.01);
      const owner = this.ownerColor(bomb.ownerId);
      if (owner !== undefined) band.setTint(owner);
    }

    const emitter = this.sparkEmitters.get(bomb.id);
    if (emitter) {
      const tip = fx.art.painters.fuseTip;
      emitter.setPosition(sprite.x + tip.x, sprite.y + tip.y);
      emitter.frequency = bomb.ticksRemaining < 20 ? Math.max(25, bomb.ticksRemaining * 5) : 110;
    }
    this.updateGhosts(bomb.id, posX, posY, sprite.texture.key, sprite);
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
    // See wrapGhostOffsets: the old worldSize/2 threshold matched every position. (audit WRAP-GHOST-1)
    const offsets = wrapGhostOffsets(this.scene.cameras.main.worldView, px, py, w, h, TILE_SIZE);

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
        img.setDepth(DEPTH.BOMB);
        return img;
      });
      this.ghostSprites.set(bombId, ghosts);
    }

    // Sync position, texture, and visual properties from canonical sprite
    for (let i = 0; i < offsets.length; i++) {
      ghosts[i].setPosition(px + offsets[i].ox, py + offsets[i].oy);
      ghosts[i].setTexture(textureKey, canonical?.frame.name);
      if (this.fx) setDepthIfChanged(ghosts[i], ySortDepth(ghosts[i].y + 16, Y_BIAS.BOMB));
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

    const band = this.bands.get(id);
    if (band) {
      band.destroy();
      this.bands.delete(id);
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
