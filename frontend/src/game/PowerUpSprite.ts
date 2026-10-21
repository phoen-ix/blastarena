import Phaser from 'phaser';
import { PowerUpState } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { wrapGhostOffsets } from '../utils/wrapGhosts';
import { DEPTH, Y_BIAS, setDepthIfChanged, ySortDepth } from '../art/depth';
import { base, fit } from '../art/scale';
import { getSettings, qualityAtLeast } from './Settings';
import { PU_COLORS_NEW } from '../art/paint';
import type { StyledFx } from '../art/StyledFx';

export class PowerUpRenderer {
  private scene: Phaser.Scene;
  private sprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private _activeIds = new Set<string>();
  public wrappingWorldSize: { w: number; h: number } | null = null;
  private ghostSprites: Map<string, Phaser.GameObjects.Image[]> = new Map();

  /** Set for the drawn art styles; null keeps the classic power-up tiles. */
  private fx: StyledFx | null;
  /** Soft coloured light under each pickup (drawn styles). */
  private glows: Map<string, Phaser.GameObjects.Image> = new Map();
  /** The first update builds what is already on the map; later ones pop new pickups out. */
  private seenFirstUpdate = false;

  constructor(scene: Phaser.Scene, fx: StyledFx | null = null) {
    this.scene = scene;
    this.fx = fx;
  }

  update(powerUps: PowerUpState[]): void {
    this._activeIds.clear();
    for (const p of powerUps) this._activeIds.add(p.id);
    const activeIds = this._activeIds;

    // Remove sprites for power-ups that no longer exist. The float tween repeats forever and
    // Phaser keeps running it on a destroyed sprite, so it is killed first — otherwise every
    // power-up ever shown left a live tween (and its sprite) behind.
    for (const [id, sprite] of this.sprites) {
      if (!activeIds.has(id)) {
        this.scene.tweens.killTweensOf(sprite);
        sprite.destroy();
        this.sprites.delete(id);
        const glow = this.glows.get(id);
        if (glow) {
          this.scene.tweens.killTweensOf(glow);
          glow.destroy();
          this.glows.delete(id);
        }
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

      if (!this.sprites.has(powerUp.id) && this.fx) {
        this.sprites.set(powerUp.id, this.createStyled(powerUp, px, py, this.fx));
      } else if (!this.sprites.has(powerUp.id)) {
        const sprite = fit(this.scene.add.sprite(px, py, `powerup_${powerUp.type}`));
        sprite.setDepth(DEPTH.POWERUP);

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
          this.updateGhosts(powerUp.id, sprite.x, sprite.y, sprite.texture.key, sprite.frame.name);
        }
      }
    }
    this.seenFirstUpdate = true;
  }

  private createStyled(
    powerUp: PowerUpState,
    px: number,
    py: number,
    fx: StyledFx,
  ): Phaser.GameObjects.Sprite {
    const art = fx.art;
    const sprite = fit(this.scene.add.sprite(px, py, art.fxKey()));
    sprite.setDepth(ySortDepth(py + 12, Y_BIAS.POWERUP));
    const animations = getSettings().animations;
    const anim = art.powerUpAnim(powerUp.type);
    if (this.scene.anims.exists(anim)) {
      if (animations) sprite.play({ key: anim, startFrame: Math.floor(Math.random() * 4) });
      else sprite.setFrame(`pu:${powerUp.type}:0`);
    }
    const b = base(sprite);
    if (qualityAtLeast('medium')) {
      const glow = this.scene.add.image(px, py + 4, 'art/glow');
      glow.setBlendMode(Phaser.BlendModes.ADD);
      glow.setTint(parseInt(PU_COLORS_NEW[powerUp.type].slice(1), 16));
      glow.setAlpha(art.painters.pixel ? 0.18 : 0.35);
      glow.setScale(0.5);
      glow.setDepth(DEPTH.LIGHT_POOL);
      this.glows.set(powerUp.id, glow);
      if (animations) {
        this.scene.tweens.add({
          targets: glow,
          alpha: 0.2,
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
    if (animations && this.seenFirstUpdate) {
      // Pop out of the broken crate with a hop, then settle into the idle bob.
      sprite.setScale(0);
      this.scene.tweens.add({
        targets: sprite,
        scale: b,
        duration: 260,
        ease: 'Back.Out',
      });
      this.scene.tweens.add({
        targets: sprite,
        y: py - 14,
        duration: 150,
        yoyo: true,
        ease: 'Quad.Out',
        onComplete: () => this.bob(sprite, py),
      });
    } else if (animations) {
      this.bob(sprite, py);
    }
    return sprite;
  }

  private bob(sprite: Phaser.GameObjects.Sprite, py: number): void {
    if (!sprite.active) return;
    sprite.y = py;
    this.scene.tweens.add({
      targets: sprite,
      y: py - 3,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private updateGhosts(
    id: string,
    px: number,
    py: number,
    textureKey: string,
    frame?: string,
  ): void {
    if (!this.wrappingWorldSize) return;
    const { w, h } = this.wrappingWorldSize;
    // See wrapGhostOffsets: the old worldSize/2 threshold matched every position. (audit WRAP-GHOST-1)
    const offsets = wrapGhostOffsets(this.scene.cameras.main.worldView, px, py, w, h, TILE_SIZE);

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
        const img = fit(this.scene.add.image(px + ox, py + oy, textureKey, frame));
        img.setDepth(this.fx ? ySortDepth(py + oy + 12, Y_BIAS.POWERUP) : DEPTH.POWERUP);
        return img;
      });
      this.ghostSprites.set(id, ghosts);
    } else {
      for (let i = 0; i < offsets.length; i++) {
        ghosts[i].setPosition(px + offsets[i].ox, py + offsets[i].oy);
        if (frame) ghosts[i].setFrame(frame);
        if (this.fx) setDepthIfChanged(ghosts[i], ySortDepth(ghosts[i].y + 12, Y_BIAS.POWERUP));
      }
    }
  }

  destroy(): void {
    for (const [, sprite] of this.sprites) {
      this.scene.tweens.killTweensOf(sprite);
      sprite.destroy();
    }
    this.sprites.clear();
    for (const glow of this.glows.values()) {
      this.scene.tweens.killTweensOf(glow);
      glow.destroy();
    }
    this.glows.clear();
    for (const ghosts of this.ghostSprites.values()) {
      for (const g of ghosts) g.destroy();
    }
    this.ghostSprites.clear();
  }
}
