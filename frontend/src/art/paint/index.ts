/**
 * Drawing helpers shared by the art-style painters: colour maths, deterministic randomness, path
 * builders, a small offscreen-sprite cache and power-up icons. Nothing here touches Phaser, so
 * painters stay usable for DOM previews and tests.
 */
import type { PowerUpType } from '@blast-arena/shared';
import { POWERUP_ICON_DRAWERS } from '../../utils/powerUpIcons';
import type { MarkerShape } from '../painters/types';

export const T = 48;

/* ---------------- colour ---------------- */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Phaser colour integer to CSS hex. */
export function intToHex(n: number): string {
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

/** f > 0 mixes toward white, f < 0 toward black. */
export function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  if (f >= 0) return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
  return rgbToHex(r * (1 + f), g * (1 + f), b * (1 + f));
}

export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Perceived brightness, 0..1. */
export function luma(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/* ---------------- numbers ---------------- */

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 0..1 value for a grid position. */
export function hash2(x: number, y: number, seed = 0): number {
  let h =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul((seed | 0) + 1, 1442695041)) |
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Triangle wave 0..1..0 over a period of 2. */
export const tri = (x: number): number => 1 - Math.abs((((x % 2) + 2) % 2) - 1);

export const ease = {
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number): number => t * t * t,
  inOut: (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outQuad: (t: number): number => 1 - (1 - t) * (1 - t),
  inQuad: (t: number): number => t * t,
};

/* ---------------- paths ---------------- */

export function rr(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function poly(g: CanvasRenderingContext2D, pts: number[]): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}

export function circle(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

export function star(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  n: number,
  ro: number,
  ri: number,
  rot = -Math.PI / 2,
): void {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const r = i % 2 ? ri : ro;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

export function hexagon(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot = 0,
): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

/** Path for a colour-blind marker shape of radius ~s. */
export function marker(
  g: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  s: number,
): void {
  switch (shape) {
    case 'triangle':
      poly(g, [x, y - s, x + s * 0.95, y + s * 0.75, x - s * 0.95, y + s * 0.75]);
      break;
    case 'square':
      g.beginPath();
      g.rect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6);
      break;
    case 'diamond':
      poly(g, [x, y - s * 1.1, x + s, y, x, y + s * 1.1, x - s, y]);
      break;
    case 'star':
      star(g, x, y, 5, s * 1.15, s * 0.5);
      break;
    case 'plus': {
      const a = s * 0.38;
      poly(g, [
        x - a,
        y - s,
        x + a,
        y - s,
        x + a,
        y - a,
        x + s,
        y - a,
        x + s,
        y + a,
        x + a,
        y + a,
        x + a,
        y + s,
        x - a,
        y + s,
        x - a,
        y + a,
        x - s,
        y + a,
        x - s,
        y - a,
        x - a,
        y - a,
      ]);
      break;
    }
    case 'hex':
      hexagon(g, x, y, s);
      break;
    case 'heart':
      g.beginPath();
      g.moveTo(x, y + s * 0.9);
      g.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.2, x, y - s * 0.45);
      g.bezierCurveTo(x + s * 0.7, y - s * 1.2, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
      g.closePath();
      break;
    default:
      circle(g, x, y, s * 0.9);
  }
}

/* ---------------- offscreen sprite cache ---------------- */

/**
 * Painters cache repeated sub-drawings (a block body, a character's head) as small offscreen
 * canvases. The cache is keyed by the current bake scale, which the baker sets with
 * setPaintScale(). Where a 2D canvas is not available (tests), the drawing runs directly.
 */
export interface CachedSprite {
  canvas: HTMLCanvasElement | null;
  draw: (g: CanvasRenderingContext2D) => void;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

let paintScale = 1;
const spriteCache = new Map<string, CachedSprite>();

export function setPaintScale(scale: number): void {
  paintScale = scale;
}

export function getPaintScale(): number {
  return paintScale;
}

export function clearPaintCache(): void {
  spriteCache.clear();
}

/** A cached drawing covering [-ox, w-ox] x [-oy, h-oy] units, with (0,0) at its origin. */
export function sprite(
  key: string,
  w: number,
  h: number,
  ox: number,
  oy: number,
  draw: (g: CanvasRenderingContext2D) => void,
): CachedSprite {
  const s = Math.round(paintScale * 300) / 300;
  const k = key + '@' + s;
  let spr = spriteCache.get(k);
  if (!spr) {
    let canvas: HTMLCanvasElement | null = null;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * s));
      c.height = Math.max(1, Math.ceil(h * s));
      const g = c.getContext('2d');
      if (g) {
        g.scale(c.width / w, c.height / h);
        g.translate(ox, oy);
        draw(g);
        canvas = c;
      }
    }
    spr = { canvas, draw, w, h, ox, oy };
    if (spriteCache.size > 4000) spriteCache.clear();
    spriteCache.set(k, spr);
  }
  return spr;
}

/** Draw a cached sprite with its origin at (x, y), optionally scaled about that origin. */
export function blit(
  g: CanvasRenderingContext2D,
  spr: CachedSprite,
  x: number,
  y: number,
  sx = 1,
  sy = sx,
): void {
  if (spr.canvas) {
    g.drawImage(spr.canvas, x - spr.ox * sx, y - spr.oy * sy, spr.w * sx, spr.h * sy);
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(sx, sy);
  spr.draw(g);
  g.restore();
}

/** Soft radial glow of radius r. */
export function glow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void {
  if (r <= 0 || alpha <= 0) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(color, alpha));
  gr.addColorStop(1, rgba(color, 0));
  g.save();
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/* ---------------- power-ups ---------------- */

/** Proposed pickup palette: the classic families, pulled apart so no two pickups share a colour. */
export const PU_COLORS_NEW: Record<PowerUpType, string> = {
  bomb_up: '#ff5446',
  fire_up: '#ff9a1f',
  speed_up: '#3fb8ff',
  shield: '#3ee07a',
  kick: '#b55cff',
  pierce_bomb: '#ff2f72',
  remote_bomb: '#4a6dff',
  line_bomb: '#ffc93d',
  bomb_throw: '#ff70d8',
};

/** Shape coding: stat boosts round, bomb modifiers hexagonal, moves diamond, defence a shield. */
export const PU_SHAPE: Record<PowerUpType, 'round' | 'hex' | 'diamond' | 'shield'> = {
  bomb_up: 'round',
  fire_up: 'round',
  speed_up: 'round',
  shield: 'shield',
  kick: 'diamond',
  bomb_throw: 'diamond',
  pierce_bomb: 'hex',
  remote_bomb: 'hex',
  line_bomb: 'hex',
};

export const PU_TYPES: PowerUpType[] = [
  'bomb_up',
  'fire_up',
  'speed_up',
  'shield',
  'kick',
  'pierce_bomb',
  'remote_bomb',
  'line_bomb',
  'bomb_throw',
];

/** The white power-up glyph (shared with the classic textures), centred on (cx, cy). */
export function icon(
  g: CanvasRenderingContext2D,
  type: PowerUpType,
  cx: number,
  cy: number,
  s = 1,
): void {
  const draw = POWERUP_ICON_DRAWERS[type];
  if (!draw) return;
  g.save();
  draw(g, cx, cy, s);
  g.restore();
}
