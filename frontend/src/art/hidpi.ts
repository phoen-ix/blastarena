import Phaser from 'phaser';
import { getSettings, onSettingsChange } from '../game/Settings';
import { markTexScale } from './scale';

/**
 * Sharp rendering on high-density screens.
 *
 * The canvas is sized in device pixels (CSS size × ratio) and shown at its CSS size, so nothing
 * is upscaled by the browser. Cameras zoom by the ratio to keep the world at its usual size:
 * GameScene multiplies its zooms by `renderRatio()`, and the UI scenes use `uiCamera()`, which
 * lets them lay out in CSS pixels. Phaser Text is rendered at the ratio, and textures are baked
 * at `textureRatio()` (decided once, at boot) so they stay crisp under the zoom.
 *
 * The ratio is the screen's device pixel ratio capped at 2, or 1 when Sharp rendering is off or
 * the quality is Low. `?dpr=2` in the URL forces a ratio, to try it on an ordinary monitor.
 */

const MAX_RATIO = 2;

let ratio = 1;
let bakeRatio = 0;

function debugRatio(): number | null {
  try {
    const v = Number(new URLSearchParams(window.location.search).get('dpr'));
    return Number.isFinite(v) && v >= 1 ? Math.min(3, v) : null;
  } catch {
    return null;
  }
}

/** The ratio the current settings and screen ask for. */
export function computeRenderRatio(): number {
  const forced = debugRatio();
  if (forced) return forced;
  const s = getSettings();
  if (!s.sharpRendering || s.quality === 'low') return 1;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.max(1, Math.min(MAX_RATIO, dpr));
}

/** Device pixels per CSS pixel the game currently renders at. */
export function renderRatio(): number {
  return ratio;
}

/**
 * Scale textures are baked at: the render ratio when the game booted. Kept for the session, so a
 * change of setting does not leave a mix of texture sizes; a texture baked above the current
 * ratio is simply drawn smaller.
 */
export function textureRatio(): number {
  if (!bakeRatio) bakeRatio = Math.max(1, Math.ceil(ratio * 2) / 2);
  return bakeRatio;
}

function containerSize(game: Phaser.Game): { w: number; h: number } {
  const parent = game.canvas?.parentElement ?? document.getElementById('game-container');
  const w = parent?.clientWidth || window.innerWidth;
  const h = parent?.clientHeight || window.innerHeight;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Size the canvas for the current ratio. Cameras follow through the scale manager's resize. */
function apply(game: Phaser.Game): void {
  ratio = computeRenderRatio();
  const { w, h } = containerSize(game);
  const width = Math.round(w * ratio);
  const height = Math.round(h * ratio);
  if (game.scale.width !== width || game.scale.height !== height) {
    game.scale.resize(width, height);
  }
  game.scale.setZoom(1 / ratio);
}

/** Game config for a canvas at the initial ratio (call before `new Phaser.Game`). */
export function scaleConfig(): Phaser.Types.Core.ScaleConfig {
  ratio = computeRenderRatio();
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  return {
    mode: Phaser.Scale.NONE,
    width: Math.round(w * ratio),
    height: Math.round(h * ratio),
    zoom: 1 / ratio,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  };
}

/**
 * Keep the canvas matched to its container, the screen's pixel density and the settings:
 * on window resize, on a pixel-ratio change (browser zoom, another monitor) and on save.
 */
export function installHiDpi(game: Phaser.Game): void {
  patchTextResolution();
  const reapply = () => apply(game);
  window.addEventListener('resize', reapply);
  let mq: MediaQueryList | null = null;
  const watchDpr = () => {
    mq?.removeEventListener('change', onDpr);
    mq = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    mq?.addEventListener('change', onDpr);
  };
  const onDpr = () => {
    reapply();
    watchDpr();
  };
  watchDpr();
  onSettingsChange(reapply);
  reapply();
}

/**
 * Lay a UI scene out in CSS pixels: its main camera zooms by the ratio from the top-left corner.
 * Returns the layout size. Call at the top of `create()` (and again after a resize).
 */
export function uiCamera(scene: Phaser.Scene): { width: number; height: number } {
  const cam = scene.cameras.main;
  const r = renderRatio();
  cam.setOrigin(0, 0);
  cam.setZoom(r);
  return { width: cam.width / r, height: cam.height / r };
}

let textPatched = false;

/**
 * Render every Phaser Text at the current ratio unless its style sets a resolution, so text
 * stays sharp under the zoomed cameras. Patches the `add.text` / `make.text` factories once.
 */
function patchTextResolution(): void {
  if (textPatched) return;
  textPatched = true;
  type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as unknown as {
    text: (x: number, y: number, text: string | string[], style?: TextStyle) => unknown;
  };
  const addText = factory.text;
  factory.text = function (x, y, text, style) {
    return addText.call(this, x, y, text, { resolution: ratio, ...style });
  };
  const creator = Phaser.GameObjects.GameObjectCreator.prototype as unknown as {
    text: (config: { style?: TextStyle }, addToScene?: boolean) => unknown;
  };
  const makeText = creator.text;
  creator.text = function (config, addToScene) {
    const style = { resolution: ratio, ...(config?.style ?? {}) };
    return makeText.call(this, { ...config, style }, addToScene);
  };
}

/**
 * A Graphics for baking a texture at `textureRatio()`: draw in normal units, then call
 * `bakeGraphics`. Its first command scales the canvas, so do not `clear()` it before baking.
 */
export function hiResGraphics(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  const r = textureRatio();
  if (r !== 1) gfx.scaleCanvas(r, r);
  return gfx;
}

/** Generate texture `key` (`w`×`h` units) from a `hiResGraphics` and record its scale. */
export function bakeGraphics(
  gfx: Phaser.GameObjects.Graphics,
  key: string,
  w: number,
  h: number,
): void {
  const r = textureRatio();
  gfx.generateTexture(key, Math.ceil(w * r), Math.ceil(h * r));
  const scene = gfx.scene;
  if (r !== 1 && scene?.textures.exists(key)) markTexScale(scene.textures.get(key), r);
}
