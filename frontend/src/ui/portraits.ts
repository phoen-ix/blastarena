import { artStyleManager } from '../art/ArtStyleManager';
import { getPaintScale, setPaintScale } from '../art/paint';
import type { EyeStyle, StylePainters } from '../art/painters/types';
import { drawPlayerSprite } from '../utils/playerCanvas';

/**
 * Character portraits for the HUD and results screens, painted in the player's chosen art style:
 * the drawn styles use their own player painter, Classic the Canvas2D copy of its sprite.
 */

/** The part of a drawn character a portrait shows, in painter units around its tile centre. */
const CROPS = {
  /** Whole figure, for big portraits (results podium). */
  full: { x: -28, y: -38, size: 56 },
  /** Head and shoulders, readable at kill-feed size. */
  bust: { x: -20, y: -38, size: 40 },
};
export type PortraitCrop = keyof typeof CROPS;

function pixelRatio(): number {
  const r = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.max(1, Math.min(2, r));
}

function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function paintDrawn(
  P: StylePainters,
  color: number,
  eyes: EyeStyle,
  px: number,
  crop: PortraitCrop,
): HTMLCanvasElement {
  const CROP = CROPS[crop];
  // Pixel art is painted at its own resolution and scaled up without smoothing.
  const art = P.pixel ? Math.max(1, Math.round(CROP.size / P.pixel)) : px;
  const unit = art / CROP.size;
  const src = document.createElement('canvas');
  src.width = src.height = art;
  const g = src.getContext('2d');
  if (!g) return src;
  const before = getPaintScale();
  setPaintScale(unit);
  try {
    g.scale(unit, unit);
    g.translate(-CROP.x, -CROP.y);
    P.player(g, { color: cssHex(color), eyes, dir: 'down', pose: { kind: 'idle', blink: false } });
  } finally {
    setPaintScale(before);
  }
  if (art === px) return src;
  const out = document.createElement('canvas');
  out.width = out.height = px;
  const o = out.getContext('2d');
  if (!o) return out;
  // Whole-number upscaling keeps every art pixel the same size.
  const d = art * Math.max(1, Math.floor(px / art));
  const at = Math.floor((px - d) / 2);
  o.imageSmoothingEnabled = false;
  o.drawImage(src, at, at, d, d);
  return out;
}

function paintClassic(color: number, eyes: EyeStyle, px: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  if (g) drawPlayerSprite(g, 0, 0, px, cssHex(color), eyes === 'default' ? undefined : eyes);
  return c;
}

/** A portrait canvas `px` device pixels square, in the current art style. */
export function paintPortrait(
  color: number,
  eyes: EyeStyle,
  px: number,
  crop: PortraitCrop = 'full',
): HTMLCanvasElement {
  const P = artStyleManager.style().painters;
  return P ? paintDrawn(P, color, eyes, px, crop) : paintClassic(color, eyes, px);
}

const cache = new Map<string, string>();

/** Data URL of a portrait `size` CSS pixels square; '' where there is no 2D canvas (tests). */
export function portraitUrl(
  color: number,
  eyes: EyeStyle,
  size: number,
  crop: PortraitCrop = 'bust',
): string {
  const px = Math.round(size * pixelRatio());
  const key = `${artStyleManager.get()}:${color}:${eyes}:${px}:${crop}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  if (typeof document !== 'undefined' && document.createElement('canvas').getContext('2d')) {
    url = paintPortrait(color, eyes, px, crop).toDataURL('image/png');
  }
  cache.set(key, url);
  return url;
}

/** `<img>` markup for a head-and-shoulders portrait; empty when it cannot be painted. */
export function portrait(look: { color: number; eyes: EyeStyle } | undefined, size = 20): string {
  if (!look) return '';
  const url = portraitUrl(look.color, look.eyes, size);
  if (!url) return '';
  return `<img class="hud-portrait" src="${url}" width="${size}" height="${size}" alt="" aria-hidden="true">`;
}
