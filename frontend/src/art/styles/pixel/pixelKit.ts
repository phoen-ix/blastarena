/**
 * Low-level helpers for the Crisp Pixel painters.
 *
 * Painters call `anchor()` to move the origin to a unit point and switch the context to ART
 * PIXELS: one drawing unit becomes one art pixel (3 game units). The game bakes this style at
 * scale 1/3, so one art pixel is exactly one texel; at other scales the cached pixel canvases are
 * blitted without smoothing and stay crisp.
 */
import { hash2 } from '../../paint';

/** Outline ink used around sprites. */
export const OUT = '#120d1a';
export const WHITE = '#ffffff';

/* ---------------- cached pixel canvases ---------------- */

export interface Px {
  canvas: HTMLCanvasElement | null;
  w: number;
  h: number;
  paint: (g: CanvasRenderingContext2D) => void;
}

const cache = new Map<string, Px>();

/**
 * A w x h pixel canvas painted once and cached by key. Where no 2D canvas exists (tests), the
 * returned sprite paints straight into the target instead.
 */
export function spr(
  key: string,
  w: number,
  h: number,
  paint: (g: CanvasRenderingContext2D) => void,
): Px {
  let p = cache.get(key);
  if (p) return p;
  let canvas: HTMLCanvasElement | null = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (g) {
      paint(g);
      canvas = c;
    }
  }
  p = { canvas, w, h, paint };
  if (cache.size > 6000) cache.clear();
  cache.set(key, p);
  return p;
}

/** Draw a cached pixel sprite with its top-left at art pixel (x, y). */
export function put(g: CanvasRenderingContext2D, p: Px, x: number, y: number): void {
  if (p.canvas) {
    g.drawImage(p.canvas, x, y);
    return;
  }
  g.save();
  g.translate(x, y);
  p.paint(g);
  g.restore();
}

/**
 * Move the origin to the unit point (ux, uy), snapped to a whole device pixel, and make one
 * drawing unit one art pixel (3 units).
 */
export function anchor(g: CanvasRenderingContext2D, ux: number, uy: number): void {
  const m = typeof g.getTransform === 'function' ? g.getTransform() : null;
  if (m && typeof m.a === 'number') {
    const s = m.a * 3;
    const X = Math.round(m.a * ux + m.c * uy + m.e);
    const Y = Math.round(m.b * ux + m.d * uy + m.f);
    g.setTransform(s, 0, 0, s, X, Y);
  } else {
    g.translate(ux, uy);
    g.scale(3, 3);
  }
  g.imageSmoothingEnabled = false;
}

/* ---------------- primitives (art pixels) ---------------- */

export function R(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: string,
): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

export function P(g: CanvasRenderingContext2D, x: number, y: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, 1, 1);
}

/* ---------------- colour grids ---------------- */

export interface Grid {
  w: number;
  h: number;
  a: (string | null)[];
}

export function grid(w: number, h: number): Grid {
  return { w, h, a: new Array<string | null>(w * h).fill(null) };
}

export function gs(g: Grid, x: number, y: number, c: string | null): void {
  if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.a[y * g.w + x] = c;
}

export function gg(g: Grid, x: number, y: number): string | null {
  return x >= 0 && y >= 0 && x < g.w && y < g.h ? g.a[y * g.w + x] : null;
}

/** Add a 1-px outline around every filled pixel. */
export function outline(g: Grid, c = OUT): void {
  const add: number[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (gg(g, x, y)) continue;
      if (gg(g, x - 1, y) || gg(g, x + 1, y) || gg(g, x, y - 1) || gg(g, x, y + 1)) add.push(x, y);
    }
  }
  for (let i = 0; i < add.length; i += 2) gs(g, add[i], add[i + 1], c);
}

/** Paint a grid as horizontal runs. */
export function paintGrid(ctx: CanvasRenderingContext2D, g: Grid, ox = 0, oy = 0): void {
  for (let y = 0; y < g.h; y++) {
    let x = 0;
    while (x < g.w) {
      const c = g.a[y * g.w + x];
      if (!c) {
        x++;
        continue;
      }
      let e = x + 1;
      while (e < g.w && g.a[y * g.w + e] === c) e++;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x, oy + y, e - x, 1);
      x = e;
    }
  }
}

/** Build a grid from character rows and a palette ('.' and ' ' are transparent). */
export function fromMap(rows: readonly string[], pal: Record<string, string>): Grid {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const g = grid(w, h);
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const ch = r[x];
      if (ch !== '.' && ch !== ' ' && pal[ch]) gs(g, x, y, pal[ch]);
    }
  });
  return g;
}

export function flipX(g: Grid): Grid {
  const o = grid(g.w, g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) o.a[y * g.w + (g.w - 1 - x)] = g.a[y * g.w + x];
  }
  return o;
}

/** A grid cached as a pixel canvas. */
export function gridSprite(key: string, make: () => Grid): Px {
  const cached = cache.get(key);
  if (cached) return cached;
  const g = make();
  return spr(key, g.w, g.h, (ctx) => paintGrid(ctx, g));
}

/* ---------------- dithering and shading ---------------- */

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Ordered-dither offset, about -0.47..0.47. */
export function dith(x: number, y: number): number {
  return BAYER[y & 3][x & 3] / 16 - 0.47;
}

/** Deterministic 0..1 noise. */
export function H(x: number, y: number, s: number): number {
  return hash2(x, y, s);
}

/** Shaded pixel ellipse, light from the top left, dithered between ramp steps (ramp of 5). */
export function blobInto(
  g: Grid,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: readonly string[],
): void {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const l = -(nx * 0.6 + ny * 0.8) * 0.7 + (1 - d) * 0.4 - 0.12 + dith(x, y) * 0.3;
      const i = l > 0.6 ? 0 : l > 0.28 ? 1 : l > -0.06 ? 2 : l > -0.4 ? 3 : 4;
      gs(g, x, y, ramp[i]);
    }
  }
}

/** Filled dithered disc of radius r (art pixels), e.g. smoke, dust, scorch. */
export function ditherDisc(r: number, col: string, density: number, seed = 0): Px {
  const ri = Math.max(1, Math.round(r));
  return spr(`dd:${ri}:${col}:${density}:${seed}`, ri * 2 + 1, ri * 2 + 1, (g) => {
    for (let y = 0; y <= ri * 2; y++) {
      for (let x = 0; x <= ri * 2; x++) {
        const d = Math.hypot(x - ri, y - ri) / (ri + 0.5);
        if (d > 1) continue;
        const wob = seed ? (H(x, y, seed) - 0.5) * 0.5 : 0;
        if (1 - d + wob > dith(x, y) + 0.5 - density) P(g, x, y, col);
      }
    }
  });
}
