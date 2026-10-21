import Phaser from 'phaser';
import { markTexScale } from './scale';
import { setPaintScale } from './paint';

/** One frame to bake: `w`×`h` logical units, painted with its origin at (ox, oy). */
export interface FrameSpec {
  name: string;
  w: number;
  h: number;
  ox: number;
  oy: number;
  paint: (g: CanvasRenderingContext2D) => void;
  /**
   * Repeat the frame's edge pixels into its padding. For tiles that must meet their neighbours
   * without seams (floors), since filtering samples a little past a frame's edge.
   */
  extrude?: boolean;
}

interface Placed {
  spec: FrameSpec;
  x: number;
  y: number;
  pw: number;
  ph: number;
}

const PAD = 2;
const MAX_WIDTH = 2048;

/**
 * Pack `frames` into one canvas (shelf packing), paint them at `scale` pixels per unit, and add
 * the result to Phaser as texture `key` with one named frame per spec. Each frame's pivot is its
 * painter origin, so a sprite showing it is positioned by that origin, and the texture records
 * its bake scale for `fit()`/`base()`. An existing texture under `key` is replaced.
 *
 * Returns null when no 2D canvas is available (tests).
 */
export function bakeAtlas(
  scene: Phaser.Scene,
  key: string,
  frames: FrameSpec[],
  scale: number,
  nearest = false,
): Phaser.Textures.Texture | null {
  if (frames.length === 0 || typeof document === 'undefined') return null;
  const order = frames
    .map((spec) => ({
      spec,
      pw: Math.ceil(spec.w * scale),
      ph: Math.ceil(spec.h * scale),
    }))
    .sort((a, b) => b.ph - a.ph);

  const placed: Placed[] = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  let width = 0;
  for (const f of order) {
    if (x + f.pw + PAD > MAX_WIDTH && x > PAD) {
      x = PAD;
      y += rowH + PAD * 2;
      rowH = 0;
    }
    placed.push({ spec: f.spec, x, y, pw: f.pw, ph: f.ph });
    x += f.pw + PAD * 2;
    rowH = Math.max(rowH, f.ph);
    width = Math.max(width, x);
  }
  const height = y + rowH + PAD;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.imageSmoothingEnabled = !nearest;

  setPaintScale(scale);
  for (const p of placed) {
    const { spec } = p;
    g.save();
    g.beginPath();
    g.rect(p.x, p.y, p.pw, p.ph);
    g.clip();
    g.translate(p.x, p.y);
    g.scale(scale, scale);
    g.translate(spec.ox, spec.oy);
    try {
      spec.paint(g);
    } catch (err) {
      console.error(`Art frame ${key}/${spec.name} failed`, err);
    }
    g.restore();
    if (spec.extrude) extrudeEdges(g, p);
  }

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return null;
  for (const p of placed) {
    const frame = tex.add(p.spec.name, 0, p.x, p.y, p.pw, p.ph);
    if (frame) {
      frame.customPivot = true;
      frame.pivotX = p.spec.ox / p.spec.w;
      frame.pivotY = p.spec.oy / p.spec.h;
    }
  }
  markTexScale(tex, scale);
  if (nearest) tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return tex;
}

/** Copy a frame's outermost pixel rows and columns into its padding. */
function extrudeEdges(g: CanvasRenderingContext2D, p: Placed): void {
  const c = g.canvas;
  const { x, y, pw, ph } = p;
  g.save();
  g.imageSmoothingEnabled = false;
  g.drawImage(c, x, y, pw, 1, x, y - PAD, pw, PAD);
  g.drawImage(c, x, y + ph - 1, pw, 1, x, y + ph, pw, PAD);
  g.drawImage(c, x, y - PAD, 1, ph + PAD * 2, x - PAD, y - PAD, PAD, ph + PAD * 2);
  g.drawImage(c, x + pw - 1, y - PAD, 1, ph + PAD * 2, x + pw, y - PAD, PAD, ph + PAD * 2);
  g.restore();
}

/** Create (or replace) a looping animation over named frames of one texture. */
export function makeAnim(
  scene: Phaser.Scene,
  key: string,
  texture: string,
  frames: string[],
  frameRate: number,
  repeat = -1,
): void {
  if (scene.anims.exists(key)) scene.anims.remove(key);
  scene.anims.create({
    key,
    frames: frames.map((frame) => ({ key: texture, frame })),
    frameRate,
    repeat,
  });
}
