import Phaser from 'phaser';
import { getSettings, qualityAtLeast } from '../game/Settings';
import { StyleArt } from './StyleArt';
import type { ArtStyle } from './types';
import type { FxKind, World } from './painters/types';

/** Bloom is dropped when the game cannot hold this frame rate for a few seconds. */
const BLOOM_MIN_FPS = 40;

function isWebGL(scene: Phaser.Scene): boolean {
  return scene.game.renderer.type === Phaser.WEBGL;
}

/**
 * Camera-level polish for a drawn art style: the style's background colour, a vignette and,
 * at High quality, bloom. Filters only exist on the WebGL renderer. Returns a function that
 * removes what was added; call `watch()` every frame to drop bloom if it costs too much.
 */
export class StylePost {
  private scene: Phaser.Scene;
  private bloom: { parallelFilters: { destroy(): void } }[] = [];
  private vignettes: { destroy(): void }[] = [];
  private slowSince = 0;

  private style: ArtStyle;

  constructor(scene: Phaser.Scene, style: ArtStyle, cameras: Phaser.Cameras.Scene2D.Camera[]) {
    this.scene = scene;
    this.style = style;
    if (!style.painters) return;
    for (const cam of cameras) {
      this.addCamera(cam);
      if (!isWebGL(scene)) continue;
      if (style.features.bloom && qualityAtLeast('high')) {
        const out = Phaser.Actions.AddEffectBloom(cam, {
          threshold: 0.6,
          blurRadius: 2,
          blurSteps: 4,
          blendAmount: 0.6,
        });
        for (const o of out) this.bloom.push(o);
      }
    }
  }

  /** Background and vignette for a camera (split-screen adds a second one; it skips bloom). */
  addCamera(cam: Phaser.Cameras.Scene2D.Camera): void {
    const painters = this.style.painters;
    if (!painters) return;
    cam.setBackgroundColor(painters.bg);
    if (!isWebGL(this.scene) || !qualityAtLeast('medium')) return;
    this.vignettes.push(
      cam.filters.external.addVignette(
        0.5,
        0.5,
        0.85,
        0.18,
        parseInt(painters.palette.vignette.replace('#', ''), 16),
      ),
    );
  }

  /** Drop bloom after ~3 s below the target frame rate. */
  watch(time: number): void {
    if (this.bloom.length === 0) return;
    if (this.scene.game.loop.actualFps < BLOOM_MIN_FPS) {
      if (!this.slowSince) this.slowSince = time;
      else if (time - this.slowSince > 3000) this.dropBloom();
    } else {
      this.slowSince = 0;
    }
  }

  private dropBloom(): void {
    for (const b of this.bloom) b.parallelFilters.destroy();
    this.bloom = [];
  }

  destroy(): void {
    this.dropBloom();
    for (const v of this.vignettes) v.destroy();
    this.vignettes = [];
  }
}

const AMBIENT: Record<World, { kind: FxKind; fall: number; drift: number; rate: number }> = {
  classic: { kind: 'mote', fall: -6, drift: 4, rate: 260 },
  forest: { kind: 'firefly', fall: -4, drift: 14, rate: 180 },
  swamp: { kind: 'firefly', fall: -3, drift: 10, rate: 200 },
  desert: { kind: 'dust', fall: 2, drift: 70, rate: 120 },
  ice: { kind: 'snow', fall: 38, drift: 14, rate: 70 },
  sky: { kind: 'snow', fall: 22, drift: 24, rate: 110 },
  volcano: { kind: 'ember', fall: -40, drift: 10, rate: 90 },
  void: { kind: 'mote', fall: -8, drift: 6, rate: 160 },
  castle: { kind: 'mote', fall: 4, drift: 5, rate: 220 },
};

/**
 * Drifting particles that give each world some life (snow, embers, fireflies, dust motes).
 * High quality only; the emitter follows the camera so particles appear wherever you look.
 */
export class AmbientParticles {
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private cam: Phaser.Cameras.Scene2D.Camera;

  constructor(scene: Phaser.Scene, art: StyleArt, world: World, depth: number) {
    this.cam = scene.cameras.main;
    if (!qualityAtLeast('high') || !getSettings().particles) return;
    const a = AMBIENT[world] ?? AMBIENT.classic;
    const view = this.cam.worldView;
    this.emitter = scene.add.particles(view.x, view.y, art.fxKey(), {
      frame: StyleArt.fxFrame(a.kind),
      x: { min: 0, max: Math.max(1, view.width) },
      y: { min: 0, max: Math.max(1, view.height) },
      speedX: { min: -a.drift, max: a.drift },
      speedY: { min: a.fall * 0.6, max: a.fall * 1.4 },
      lifespan: { min: 3500, max: 7000 },
      scale: { start: 0.45 / art.scale, end: 0.2 / art.scale },
      alpha: { values: [0, 0.8, 0.6, 0] },
      frequency: a.rate,
      blendMode:
        a.kind === 'ember' || a.kind === 'firefly'
          ? Phaser.BlendModes.ADD
          : Phaser.BlendModes.NORMAL,
      emitting: true,
    });
    this.emitter.setDepth(depth);
  }

  /** Keep the spawn area on the camera. */
  frame(): void {
    if (!this.emitter) return;
    const v = this.cam.worldView;
    this.emitter.setPosition(v.x, v.y);
  }

  destroy(): void {
    this.emitter?.destroy();
    this.emitter = null;
  }
}
