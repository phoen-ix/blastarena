import type { KillCause } from '@blast-arena/shared';
import { POWERUP_ICON_DRAWERS } from '../utils/powerUpIcons';
import { POWERUP_COLORS } from '../utils/powerUpColors';

/**
 * Small drawn icons for the in-game HUD (stats bar, kill feed, death banner, campaign lives,
 * player list), replacing emoji, which look different on every system and blur when scaled.
 * Each icon is painted once per size with Canvas 2D and cached as a data URL; the CSP allows
 * `data:` images.
 */

export type HudIconName =
  | 'bomb'
  | 'fire'
  | 'speed'
  | 'shield'
  | 'kick'
  | 'throw'
  | 'remote'
  | 'skull'
  | 'zone'
  | 'lava'
  | 'quicksand'
  | 'spikes'
  | 'dark_rift'
  | 'disconnect'
  | 'heart'
  | 'heartEmpty'
  | 'bot'
  | 'crown';

/** Icon for each way a player can be knocked out. */
export const CAUSE_ICON: Record<KillCause, HudIconName> = {
  bomb: 'bomb',
  self: 'skull',
  zone: 'zone',
  lava: 'lava',
  quicksand: 'quicksand',
  spikes: 'spikes',
  dark_rift: 'dark_rift',
  disconnect: 'disconnect',
};

/** Stat icons reuse the power-up glyphs, tinted with each power-up's colour. */
const POWER_UP_GLYPH: Partial<Record<HudIconName, string>> = {
  fire: 'fire_up',
  speed: 'speed_up',
  shield: 'shield',
  kick: 'kick',
  throw: 'bomb_throw',
  remote: 'remote_bomb',
};

type Paint = (g: CanvasRenderingContext2D) => void;

/* All painters below draw in a 32 × 32 box. */

const paintBomb: Paint = (g) => {
  g.fillStyle = '#2b2b36';
  g.strokeStyle = '#d4d4e0';
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(14.5, 18.5, 10, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.arc(10.5, 14.5, 3, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#d9b77a';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(20, 10.5);
  g.quadraticCurveTo(23, 5, 26.5, 6.5);
  g.stroke();
  star(g, 26.5, 6, 4.8, 2, '#ffcc33');
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(26.5, 6, 1.4, 0, Math.PI * 2);
  g.fill();
};

const paintSkull: Paint = (g) => {
  g.fillStyle = '#f2f0ea';
  g.beginPath();
  g.arc(16, 13.5, 10, Math.PI * 0.92, Math.PI * 2.08);
  g.lineTo(23, 22);
  g.lineTo(21.5, 27);
  g.lineTo(10.5, 27);
  g.lineTo(9, 22);
  g.closePath();
  g.fill();
  g.fillStyle = '#1c1c24';
  g.beginPath();
  g.ellipse(12, 15, 3.2, 3.6, 0, 0, Math.PI * 2);
  g.ellipse(20, 15, 3.2, 3.6, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(16, 18.5);
  g.lineTo(14.4, 21.5);
  g.lineTo(17.6, 21.5);
  g.closePath();
  g.fill();
  g.strokeStyle = '#1c1c24';
  g.lineWidth = 1.2;
  for (const x of [13.5, 16, 18.5]) {
    g.beginPath();
    g.moveTo(x, 24);
    g.lineTo(x, 27);
    g.stroke();
  }
};

const paintZone: Paint = (g) => {
  g.fillStyle = 'rgba(255,51,85,0.25)';
  g.beginPath();
  g.arc(16, 16, 13, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ff3355';
  g.lineWidth = 2.6;
  g.beginPath();
  g.arc(16, 16, 12, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ff8098';
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(16, 16);
    g.rotate((i * Math.PI) / 2);
    g.beginPath();
    g.moveTo(0, -3);
    g.lineTo(-3.4, -8.5);
    g.lineTo(3.4, -8.5);
    g.closePath();
    g.fill();
    g.restore();
  }
};

const paintLava: Paint = (g) => {
  const grad = g.createLinearGradient(0, 10, 0, 28);
  grad.addColorStop(0, '#ffb020');
  grad.addColorStop(1, '#e8361c');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(3, 27);
  g.bezierCurveTo(3, 18, 9, 14, 12, 17);
  g.bezierCurveTo(14, 9, 21, 9, 22, 15);
  g.bezierCurveTo(26, 13, 29, 19, 29, 27);
  g.closePath();
  g.fill();
  g.fillStyle = '#fff2a8';
  g.beginPath();
  g.arc(12, 22, 2.2, 0, Math.PI * 2);
  g.arc(20, 19, 1.6, 0, Math.PI * 2);
  g.arc(23, 24, 1.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffb020';
  g.beginPath();
  g.arc(18, 7, 1.8, 0, Math.PI * 2);
  g.arc(11, 10, 1.2, 0, Math.PI * 2);
  g.fill();
};

const paintQuicksand: Paint = (g) => {
  g.strokeStyle = '#c99a52';
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(8, 4);
  g.lineTo(24, 4);
  g.moveTo(8, 28);
  g.lineTo(24, 28);
  g.stroke();
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(10, 5);
  g.bezierCurveTo(10, 12, 15, 14, 15, 16);
  g.bezierCurveTo(15, 18, 10, 20, 10, 27);
  g.moveTo(22, 5);
  g.bezierCurveTo(22, 12, 17, 14, 17, 16);
  g.bezierCurveTo(17, 18, 22, 20, 22, 27);
  g.stroke();
  g.fillStyle = '#f0c878';
  g.beginPath();
  g.moveTo(11.5, 9);
  g.lineTo(20.5, 9);
  g.lineTo(16, 14.5);
  g.closePath();
  g.moveTo(16, 19);
  g.lineTo(21, 26.5);
  g.lineTo(11, 26.5);
  g.closePath();
  g.fill();
};

const paintSpikes: Paint = (g) => {
  g.fillStyle = '#5a5e6c';
  g.fillRect(3, 24, 26, 4);
  for (const [x, h] of [
    [8, 14],
    [16, 19],
    [24, 14],
  ]) {
    const grad = g.createLinearGradient(x - 4, 0, x + 4, 0);
    grad.addColorStop(0, '#f4f6fa');
    grad.addColorStop(1, '#8c92a4');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x, 24 - h);
    g.lineTo(x + 4.5, 24);
    g.lineTo(x - 4.5, 24);
    g.closePath();
    g.fill();
  }
};

const paintDarkRift: Paint = (g) => {
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 14);
  grad.addColorStop(0, '#120018');
  grad.addColorStop(0.55, '#4a1a7a');
  grad.addColorStop(1, 'rgba(160,80,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(16, 16, 14, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#c58cff';
  g.lineWidth = 1.8;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = i * 0.32;
    const r = 1.5 + i * 0.28;
    const x = 16 + Math.cos(a) * r;
    const y = 16 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
};

const paintDisconnect: Paint = (g) => {
  g.strokeStyle = '#aeb4c2';
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  // cable ends
  g.beginPath();
  g.moveTo(3, 25);
  g.quadraticCurveTo(7, 20, 9.5, 19);
  g.moveTo(29, 7);
  g.quadraticCurveTo(25, 12, 22.5, 13);
  g.stroke();
  // plug and socket halves
  g.fillStyle = '#d6dae4';
  g.save();
  g.translate(12, 18);
  g.rotate(-Math.PI / 4);
  rr(g, -4, -4, 8, 8, 2);
  g.fill();
  g.fillRect(4, -3, 3, 1.6);
  g.fillRect(4, 1.4, 3, 1.6);
  g.restore();
  g.save();
  g.translate(20.5, 14);
  g.rotate(-Math.PI / 4);
  rr(g, -4, -4, 8, 8, 2);
  g.fill();
  g.restore();
  star(g, 16.5, 16, 4, 1.6, '#ffcc33');
};

function heartPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(16, 27);
  g.bezierCurveTo(4, 19, 3, 12, 6, 8.5);
  g.bezierCurveTo(9, 5, 14, 6, 16, 10);
  g.bezierCurveTo(18, 6, 23, 5, 26, 8.5);
  g.bezierCurveTo(29, 12, 28, 19, 16, 27);
  g.closePath();
}

const paintHeart: Paint = (g) => {
  heartPath(g);
  const grad = g.createLinearGradient(0, 6, 0, 27);
  grad.addColorStop(0, '#ff6680');
  grad.addColorStop(1, '#e0203e');
  g.fillStyle = grad;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.ellipse(10.5, 11.5, 2.6, 1.8, -0.6, 0, Math.PI * 2);
  g.fill();
};

const paintHeartEmpty: Paint = (g) => {
  heartPath(g);
  g.fillStyle = 'rgba(30,30,40,0.7)';
  g.fill();
  g.strokeStyle = '#6a6a7c';
  g.lineWidth = 1.8;
  g.stroke();
};

const paintBot: Paint = (g) => {
  g.strokeStyle = '#b8c0cc';
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(16, 9);
  g.lineTo(16, 4.5);
  g.stroke();
  g.fillStyle = '#ff5566';
  g.beginPath();
  g.arc(16, 4, 2.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b8c0cc';
  rr(g, 5, 9, 22, 17, 4);
  g.fill();
  g.fillRect(2.5, 14, 3, 6);
  g.fillRect(26.5, 14, 3, 6);
  g.fillStyle = '#1e2430';
  rr(g, 8, 12, 16, 9, 2.5);
  g.fill();
  g.fillStyle = '#55e0ff';
  g.beginPath();
  g.arc(12.5, 16.5, 2, 0, Math.PI * 2);
  g.arc(19.5, 16.5, 2, 0, Math.PI * 2);
  g.fill();
};

const paintCrown: Paint = (g) => {
  const grad = g.createLinearGradient(0, 6, 0, 26);
  grad.addColorStop(0, '#ffe680');
  grad.addColorStop(1, '#e8a417');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(4, 24);
  g.lineTo(3, 10);
  g.lineTo(10, 16);
  g.lineTo(16, 6);
  g.lineTo(22, 16);
  g.lineTo(29, 10);
  g.lineTo(28, 24);
  g.closePath();
  g.fill();
  g.fillRect(4, 24, 24, 3.5);
  g.fillStyle = '#ff4466';
  g.beginPath();
  g.arc(16, 18.5, 2.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#55c8ff';
  g.beginPath();
  g.arc(9.5, 20, 1.6, 0, Math.PI * 2);
  g.arc(22.5, 20, 1.6, 0, Math.PI * 2);
  g.fill();
};

const PAINTERS: Partial<Record<HudIconName, Paint>> = {
  bomb: paintBomb,
  skull: paintSkull,
  zone: paintZone,
  lava: paintLava,
  quicksand: paintQuicksand,
  spikes: paintSpikes,
  dark_rift: paintDarkRift,
  disconnect: paintDisconnect,
  heart: paintHeart,
  heartEmpty: paintHeartEmpty,
  bot: paintBot,
  crown: paintCrown,
};

function star(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  outer: number,
  inner: number,
  color: string,
): void {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** A power-up glyph (drawn white) recoloured with its power-up's colour. */
function paintGlyph(px: number, type: string): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  const draw = POWERUP_ICON_DRAWERS[type];
  if (!g || !draw) return null;
  draw(g, px / 2, px / 2, (px / 32) * 1.1);
  g.globalCompositeOperation = 'source-in';
  g.globalAlpha = 1;
  g.fillStyle = cssHex(POWERUP_COLORS[type] ?? 0xffffff);
  g.fillRect(0, 0, px, px);
  return c;
}

function pixelRatio(): number {
  const r = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.max(1, Math.min(2, r));
}

const cache = new Map<string, string>();

/**
 * Data URL of an icon `size` CSS pixels wide, painted at the screen's pixel ratio; '' where
 * there is no 2D canvas (tests).
 */
export function hudIconUrl(name: HudIconName, size: number): string {
  const px = Math.round(size * pixelRatio());
  const key = `${name}:${px}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const g = c?.getContext('2d');
  if (c && g) {
    c.width = c.height = px;
    // A soft dark edge keeps every icon readable over a light arena.
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = px / 16;
    g.shadowOffsetY = px / 32;
    const glyph = POWER_UP_GLYPH[name];
    if (glyph) {
      const art = paintGlyph(px, glyph);
      if (art) g.drawImage(art, 0, 0);
    } else {
      g.save();
      g.scale(px / 32, px / 32);
      PAINTERS[name]?.(g);
      g.restore();
    }
    url = c.toDataURL('image/png');
  }
  cache.set(key, url);
  return url;
}

/** `<img>` markup for an icon (decorative: empty alt, hidden from assistive tech). */
export function hudIcon(name: HudIconName, size = 16): string {
  const url = hudIconUrl(name, size);
  const src = url ? ` src="${url}"` : '';
  return `<img class="hud-icon hud-icon-${name}"${src} width="${size}" height="${size}" alt="" aria-hidden="true">`;
}
