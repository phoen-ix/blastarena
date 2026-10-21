import Phaser from 'phaser';
import { TILE_SIZE } from '@blast-arena/shared';
import { getSettings, qualityAtLeast } from '../game/Settings';
import { DEPTH } from './depth';
import { StyleArt } from './StyleArt';
import type { FxKind, World } from './painters/types';

/** Scorch marks kept on the floor at once; the oldest fades first. */
const MAX_SCORCH = 48;
/** Light pools alive at once (big chains create many; past this they add nothing visible). */
const MAX_LIGHTS = 64;
/** Smooth radial glow for light pools, shared by every style (light is not part of the art). */
const GLOW_KEY = 'art/glow';
const GLOW_RADIUS = 64;

function cssToInt(css: string): number {
  return parseInt(css.replace('#', '').slice(0, 6), 16);
}

/**
 * Runtime effects for the drawn art styles, built from the style's baked effect frames:
 * light pools, shockwave rings, scorch decals, block chunks, dust, bursts and pickup labels.
 * What runs depends on the graphics quality: Low skips light, scorch and shockwaves.
 */
export class StyledFx {
  readonly art: StyleArt;
  private scene: Phaser.Scene;
  private key: string;
  private scorches: Phaser.GameObjects.Image[] = [];
  private lights = 0;

  constructor(scene: Phaser.Scene, art: StyleArt) {
    this.scene = scene;
    this.art = art;
    this.key = art.ensureFx(scene);
    if (!scene.textures.exists(GLOW_KEY) && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = c.height = GLOW_RADIUS * 2;
      const g = c.getContext('2d');
      if (g) {
        const gr = g.createRadialGradient(
          GLOW_RADIUS,
          GLOW_RADIUS,
          0,
          GLOW_RADIUS,
          GLOW_RADIUS,
          GLOW_RADIUS,
        );
        gr.addColorStop(0, 'rgba(255,255,255,1)');
        gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, c.width, c.height);
        scene.textures.addCanvas(GLOW_KEY, c);
      }
    }
  }

  /** Object scale that shows an fx frame at `logical` times its painted size. */
  private s(logical = 1): number {
    return logical / this.art.scale;
  }

  private get particlesOn(): boolean {
    return getSettings().particles;
  }

  frameOf(kind: FxKind): string {
    return StyleArt.fxFrame(kind);
  }

  /** A tinted additive glow that fades out; for flames, flashes, pickups. */
  light(x: number, y: number, radius: number, color: string, alpha: number, ms: number): void {
    if (!qualityAtLeast('medium') || this.lights >= MAX_LIGHTS) return;
    if (!this.scene.textures.exists(GLOW_KEY)) return;
    const img = this.scene.add.image(x, y, GLOW_KEY);
    img.setBlendMode(Phaser.BlendModes.ADD);
    img.setTint(cssToInt(color));
    // Pixel art keeps its light subtle so the palette stays crisp.
    img.setAlpha(this.art.painters.pixel ? alpha * 0.45 : alpha);
    img.setScale(radius / GLOW_RADIUS);
    img.setDepth(DEPTH.LIGHT_POOL);
    this.lights++;
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      duration: ms,
      ease: 'Quad.In',
      onComplete: () => {
        img.destroy();
        this.lights--;
      },
    });
  }

  /** Expanding ring from a blast centre. */
  shockwave(x: number, y: number, tiles: number, color: string): void {
    if (!qualityAtLeast('medium') || !getSettings().animations) return;
    const img = this.scene.add.image(x, y, this.key, StyleArt.fxFrame('ring'));
    img.setBlendMode(Phaser.BlendModes.ADD);
    img.setTint(cssToInt(color));
    img.setScale(this.s(0.5));
    img.setDepth(DEPTH.IMPACT);
    this.scene.tweens.add({
      targets: img,
      scale: this.s((tiles * TILE_SIZE) / 24),
      alpha: 0,
      duration: 380,
      ease: 'Cubic.Out',
      onComplete: () => img.destroy(),
    });
  }

  /** A scorch mark that fades away over a few seconds. */
  scorch(x: number, y: number, big: boolean): void {
    if (!qualityAtLeast('medium')) return;
    const v = Math.floor(Math.random() * 4);
    const img = this.scene.add.image(x, y, this.key, StyleArt.scorchFrame(v));
    img.setDepth(DEPTH.DECAL);
    img.setScale(this.s(big ? 0.95 : 0.6));
    img.setRotation(Math.random() * Math.PI * 2);
    img.setAlpha(0.9);
    this.scorches.push(img);
    if (this.scorches.length > MAX_SCORCH) this.scorches.shift()?.destroy();
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      delay: big ? 3500 : 2500,
      duration: 2500,
      onComplete: () => {
        this.scorches = this.scorches.filter((s) => s !== img);
        img.destroy();
      },
    });
  }

  /** Pieces of a broken block flying out and settling, plus a dust puff. */
  chunks(x: number, y: number, world: World, cracked: boolean): void {
    if (!this.particlesOn) return;
    const frames = [0, 1, 2].map((v) => StyleArt.chunkFrame(world, cracked, v));
    const emitter = this.scene.add.particles(x, y - 8, this.key, {
      frame: frames,
      speed: { min: 60, max: 170 },
      angle: { min: 200, max: 340 },
      gravityY: 520,
      rotate: { start: 0, end: 360 },
      lifespan: { min: 450, max: 750 },
      scale: { start: this.s(1), end: this.s(0.7) },
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    emitter.setDepth(DEPTH.IMPACT);
    emitter.explode(qualityAtLeast('medium') ? 9 : 5);
    this.dust(x, y + 10, 4);
    this.scene.time.delayedCall(900, () => emitter.destroy());
  }

  dust(x: number, y: number, n: number): void {
    if (!this.particlesOn) return;
    const emitter = this.scene.add.particles(x, y, this.key, {
      frame: StyleArt.fxFrame('dust'),
      speed: { min: 10, max: 40 },
      angle: { min: 180, max: 360 },
      lifespan: 420,
      scale: { start: this.s(0.35), end: this.s(0.6) },
      alpha: { start: 0.55, end: 0 },
      emitting: false,
    });
    emitter.setDepth(DEPTH.SHADOW);
    emitter.explode(n);
    this.scene.time.delayedCall(500, () => emitter.destroy());
  }

  /** Star burst in a colour (knockouts, pickups, shield breaks). */
  burst(x: number, y: number, color: number, n: number, kind: FxKind = 'star'): void {
    if (!this.particlesOn) return;
    const emitter = this.scene.add.particles(x, y, this.key, {
      frame: StyleArt.fxFrame(kind),
      speed: { min: 70, max: 180 },
      lifespan: { min: 350, max: 600 },
      scale: { start: this.s(0.4), end: 0 },
      alpha: { start: 1, end: 0 },
      tint: color,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    emitter.setDepth(DEPTH.IMPACT);
    emitter.explode(qualityAtLeast('medium') ? n : Math.ceil(n / 2));
    this.scene.time.delayedCall(700, () => emitter.destroy());
  }

  /** Smoke puff (knockout pop, burnt-out flames). */
  puff(x: number, y: number, n: number): void {
    if (!this.particlesOn) return;
    const emitter = this.scene.add.particles(x, y, this.key, {
      frame: StyleArt.fxFrame('smoke'),
      speed: { min: 20, max: 70 },
      lifespan: 520,
      scale: { start: this.s(0.5), end: this.s(1) },
      alpha: { start: 0.7, end: 0 },
      emitting: false,
    });
    emitter.setDepth(DEPTH.IMPACT);
    emitter.explode(n);
    this.scene.time.delayedCall(620, () => emitter.destroy());
  }

  /** The power-up name rising from a pickup, in the style's label colours. */
  label(x: number, y: number, text: string, color: string): void {
    if (!getSettings().animations) return;
    const pal = this.art.painters.palette;
    const t = this.scene.add
      .text(x, y - 14, text.toUpperCase(), {
        fontFamily: '"Chakra Petch", "DM Sans", sans-serif',
        fontStyle: '700',
        fontSize: '13px',
        color: color || pal.labelText,
        stroke: pal.labelStroke,
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.PICKUP_TEXT)
      .setScale(0.4);
    this.scene.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.Out' });
    this.scene.tweens.add({
      targets: t,
      y: y - 44,
      alpha: 0,
      delay: 300,
      duration: 650,
      ease: 'Quad.In',
      onComplete: () => t.destroy(),
    });
  }

  destroy(): void {
    for (const s of this.scorches) s.destroy();
    this.scorches = [];
  }
}
