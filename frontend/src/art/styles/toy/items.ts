import {
  blit,
  circle,
  ease,
  clamp,
  glow,
  hexagon,
  icon,
  poly,
  rgba,
  rng,
  rr,
  shade,
  sprite,
  star,
} from '../../paint';
import { PU_COLORS_NEW, PU_SHAPE } from '../../paint';
import type { PowerUpType } from '@blast-arena/shared';
import type {
  BombOpts,
  BombType,
  ChunkOpts,
  FlameOpts,
  FxOpts,
  PowerUpOpts,
  ScorchOpts,
} from '../../painters/types';
import { INK, ell, fl, seg, st } from './common';
import type { G } from './common';
import { chunkColors } from './tiles';

const TAU = Math.PI * 2;

/* ================================================================== bombs */

/** Where the spark sits with a full fuse (the renderer's spark particles start here). */
export const FUSE_TIP = { x: 9, y: -22 };
export const FUSE_FRAMES = 8;

function bombBody(g: G, type: BombType): void {
  if (type === 'pierce') {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      const bx = Math.cos(a);
      const by = Math.sin(a);
      poly(g, [
        bx * 10.5 - by * 3,
        3 + by * 10.5 + bx * 3,
        bx * 18.5,
        3 + by * 18.5,
        bx * 10.5 + by * 3,
        3 + by * 10.5 - bx * 3,
      ]);
      fl(g, '#d3d8e2');
      st(g, INK, 1.1);
    }
  }
  circle(g, 0, 3, 13.2);
  fl(g, type === 'remote' ? '#263452' : '#2e3150');
  g.save();
  circle(g, 0, 3, 13.2);
  g.clip();
  circle(g, 4, 7, 12);
  fl(g, '#191a2d');
  circle(g, -1.5, 1.5, 11.6);
  fl(g, type === 'remote' ? '#2f4268' : type === 'pierce' ? '#4a3150' : '#363a5e');
  g.restore();
  ell(g, -5, -2.4, 4.6, 3, -0.6);
  fl(g, 'rgba(255,255,255,0.72)');
  circle(g, -0.8, -6.2, 1.2);
  fl(g, 'rgba(255,255,255,0.6)');
  circle(g, 0, 3, 13.2);
  st(g);
  // metal cap
  rr(g, -4.6, -12.6, 9.2, 5.2, 1.8);
  fl(g, '#c9c1b4');
  st(g, INK, 1.2);
  seg(g, [-2.8, -11.2, 2.8, -11.2], 'rgba(255,255,255,0.6)', 0.9);
  if (type === 'remote') {
    seg(g, [0, -12.5, 0, -23], INK, 2.6);
    seg(g, [0, -12.5, 0, -23], '#c9c1b4', 1.2);
  }
}

/** The fuse is a quadratic curve from the cap, truncated at t = f (de Casteljau). */
function fusePath(f: number): { P0: number[]; Q1: number[]; Q2: number[] } {
  const P0 = [0, -12.5];
  const P1 = [1.5, -21.5];
  const P2 = [10, -23];
  const Q1 = [P0[0] + (P1[0] - P0[0]) * f, P0[1] + (P1[1] - P0[1]) * f];
  const A = [P1[0] + (P2[0] - P1[0]) * f, P1[1] + (P2[1] - P1[1]) * f];
  const Q2 = [Q1[0] + (A[0] - Q1[0]) * f, Q1[1] + (A[1] - Q1[1]) * f];
  return { P0, Q1, Q2 };
}

export function bomb(g: G, o: BombOpts): void {
  bombBody(g, o.type);
  if (o.hot) {
    circle(g, 0, 3, 13.2);
    fl(g, 'rgba(255,60,50,0.5)');
    ell(g, -5, -2.4, 4.6, 3, -0.6);
    fl(g, 'rgba(255,230,220,0.6)');
    circle(g, 0, 3, 13.2);
    st(g, '#7a1410', 1.6);
  }
  if (o.type === 'remote') {
    const col = o.spark ? '#ff4d4d' : '#59ff7a';
    glow(g, 0, -24, 7, col, 0.7);
    circle(g, 0, -24, 2.7);
    fl(g, col);
    st(g, INK, 1.1);
    return;
  }
  const f = Math.max(0.1, o.fuse);
  const { P0, Q1, Q2 } = fusePath(f);
  const fuse = (): void => {
    g.beginPath();
    g.moveTo(P0[0], P0[1]);
    g.quadraticCurveTo(Q1[0], Q1[1], Q2[0], Q2[1]);
  };
  g.lineCap = 'round';
  fuse();
  st(g, INK, 3.6);
  fuse();
  st(g, '#dcb57d', 2.2);
  g.save();
  g.setLineDash([1.6, 2]);
  fuse();
  st(g, '#9c7340', 2.2);
  g.restore();
  const fk = o.spark ? 0.78 : 1;
  const rot = o.spark ? 0.6 : 0;
  glow(g, Q2[0], Q2[1], 9 * fk * (o.hot ? 1.25 : 1), o.hot ? '#ff8a5a' : '#ffcf5a', 0.9);
  g.fillStyle = '#ff8a2a';
  star(g, Q2[0], Q2[1], 5, 5.4 * fk, 2, rot);
  g.fill();
  g.fillStyle = '#fff6c2';
  star(g, Q2[0], Q2[1], 4, 3.6 * fk, 1.3, -rot * 1.5);
  g.fill();
}

/** Owner-colour stripe, pure white (tinted per owner at runtime). */
export function bombBand(g: G, o: { type: BombType }): void {
  g.save();
  circle(g, 0, 3, 13.2);
  g.clip();
  g.beginPath();
  g.ellipse(0, 4.5, 13.4, 5.2, 0, 0.02, Math.PI - 0.02);
  st(g, '#ffffff', o.type === 'remote' ? 2.4 : 2.8);
  g.restore();
}

/* ================================================================== flames */

const FL = { edge: '#8f1d14', rim: '#d8341f', body: '#ff9124', core: '#ffe066', hot: '#fffbe8' };
const FLP = { edge: '#5a1f6e', rim: '#c8341f', body: '#ffb636', core: '#dcf3ff', hot: '#ffffff' };
/** Layer: half height, wobble channel, burst radius. */
const LAY = [
  { h: 17.2, w: 0, R: 23.4 },
  { h: 15.4, w: 0, R: 21.4 },
  { h: 10.8, w: 1, R: 15.2 },
  { h: 5.4, w: 2, R: 8.4 },
];
const WAMP = [2.6, 1.7, 1.0];
/**
 * Edge wobble at tile-local coordinate A. |sin(A·π/24)| repeats every 24 units, so the edge
 * height at a tile's +24 edge equals the neighbour's at −24 and the cross reads as one shape.
 */
function wob(A: number, S: number, t: number, w: number): number {
  return WAMP[w] * Math.abs(Math.sin((A * Math.PI) / 24 + t * 7.5 + S * 1.9 + w * 0.7));
}

type Mapper = (u: number, side: number) => [number, number];

/** How the canonical band (along +x) maps onto tile-local along/side for each rotation. */
function mapper(rot: number): Mapper {
  if (rot === 0 || rot === 1) return (u, side) => [u, side];
  return (u, side) => [-u, 1 - side];
}

function bandPath(
  g: G,
  L: number,
  s: number,
  t: number,
  map: Mapper,
  u0: number,
  u1: number,
  uTip?: number,
): void {
  const h = LAY[L].h * s;
  const wl = LAY[L].w;
  const step = 3;
  const top: number[] = [];
  const bot: number[] = [];
  const end = uTip ?? u1;
  for (let u = u0; u <= end + 0.001; u += step) {
    const uu = Math.min(u, end);
    let k = 1;
    if (uTip !== undefined && uu > u1) {
      const q = (uu - u1) / (uTip - u1);
      k = Math.sqrt(Math.max(0, 1 - q * q));
    }
    const [A0, S0] = map(uu, 0);
    const [A1, S1] = map(uu, 1);
    top.push(uu, -(h + wob(A0, S0, t, wl) * s) * k);
    bot.push(uu, (h + wob(A1, S1, t, wl) * s) * k);
    if (uu === end) break;
    if (u + step > end && uu < end) {
      // make sure the last sample lands exactly on the end
      u = end - step;
    }
  }
  g.beginPath();
  g.moveTo(top[0], top[1]);
  for (let i = 2; i < top.length; i += 2) g.lineTo(top[i], top[i + 1]);
  for (let i = bot.length - 2; i >= 0; i -= 2) g.lineTo(bot[i], bot[i + 1]);
  g.closePath();
}

function burstPath(g: G, L: number, s: number, t: number): void {
  const R = LAY[L].R * s;
  const wl = LAY[L].w;
  const n = 16;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const r = R + WAMP[wl] * s * 1.3 * Math.abs(Math.sin(a * 3 + t * 8 + wl));
    if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
}

export const FLAME_FRAMES = 10;
const FLAME_LIFE = 0.55;

const ROT: Record<string, number> = { right: 0, down: 1, left: 2, up: 3 };

export function flame(g: G, o: FlameOpts): void {
  const u = (o.frame + 0.5) / o.frames;
  const age = u * FLAME_LIFE;
  const life = 1 - u;
  const pop = ease.outBack(clamp(age / 0.07));
  const fade = life < 0.35 ? ease.inOut(life / 0.35) : 1;
  const s = Math.max(0, pop * fade);
  const t = o.frame * 0.06;
  const P = o.pierce ? FLP : FL;
  const cols = [P.edge, P.rim, P.body, P.core];
  g.save();
  if (o.piece === 'center') {
    // the burst bulges past the tile edge; keep it off the neighbouring arm pieces
    g.beginPath();
    g.rect(-24, -24, 48, 48);
    g.clip();
  }
  // the flame itself fades as it shrinks, so its last frames never read as a hairline
  g.globalAlpha = clamp(fade * 1.8);
  if (s > 0.12) {
    if (o.piece === 'center') {
      for (let L = 0; L < 4; L++) {
        g.fillStyle = cols[L];
        burstPath(g, L, s, t);
        g.fill();
        bandPath(g, L, s, t, mapper(0), -24, 24);
        g.fill();
        g.save();
        g.rotate(Math.PI / 2);
        bandPath(g, L, s, t, mapper(1), -24, 24);
        g.fill();
        g.restore();
      }
      g.fillStyle = P.hot;
      circle(g, 0, 0, 4.5 * s);
      g.fill();
    } else if (o.piece === 'arm') {
      const rot = o.dir === 'down' || o.dir === 'up' ? 1 : 0;
      g.rotate((rot * Math.PI) / 2);
      for (let L = 0; L < 4; L++) {
        g.fillStyle = cols[L];
        bandPath(g, L, s, t, mapper(rot), -24, 24);
        g.fill();
      }
      if (o.pierce) {
        g.fillStyle = P.hot;
        g.fillRect(-24, -1.4 * s, 48, 2.8 * s);
      }
    } else {
      const rot = ROT[o.dir] ?? 0;
      g.rotate((rot * Math.PI) / 2);
      const map = mapper(rot);
      const f2 = Math.sin(t * 13 + rot) * 2;
      const tips = [21 + f2, 19 + f2, 14 + f2 * 0.7, 6 + f2 * 0.4];
      for (let L = 0; L < 4; L++) {
        g.fillStyle = cols[L];
        bandPath(g, L, s, t, map, -24, -12, -12 + (tips[L] + 12) * (0.6 + 0.4 * s));
        g.fill();
      }
    }
  }
  g.restore();
  // smoke as it dies down
  if (life < 0.42) {
    const k = 1 - life / 0.42;
    const a = Math.sin(k * Math.PI) * 0.5;
    g.save();
    g.globalAlpha = a;
    const ox = o.piece === 'center' ? 0 : (((ROT[o.dir] ?? 0) % 2) * 2 - 1) * 3;
    const oy = -4 - k * 12;
    circle(g, ox, oy, 10 + k * 7);
    g.fillStyle = '#9d94a5';
    g.fill();
    circle(g, ox - 3, oy - 3, 5 + k * 4);
    g.fillStyle = '#c3bbc9';
    g.fill();
    g.restore();
  }
}

/* ================================================================== power-ups */

export const POWERUP_FRAMES = 6;

function tokenPath(g: G, shape: string, dy: number, r: number): void {
  if (shape === 'hex') hexagon(g, 0, dy, r * 1.08, Math.PI / 6);
  else if (shape === 'diamond')
    poly(g, [0, dy - r * 1.2, r * 1.2, dy, 0, dy + r * 1.2, -r * 1.2, dy]);
  else if (shape === 'shield') {
    const w = r * 1.02;
    g.beginPath();
    g.moveTo(-w, dy - r * 0.9);
    g.quadraticCurveTo(0, dy - r * 1.25, w, dy - r * 0.9);
    g.lineTo(w, dy + r * 0.05);
    g.quadraticCurveTo(w * 0.85, dy + r * 0.85, 0, dy + r * 1.2);
    g.quadraticCurveTo(-w * 0.85, dy + r * 0.85, -w, dy + r * 0.05);
    g.closePath();
  } else circle(g, 0, dy, r);
}

/** The power-up glyph recoloured, for its drop shadow. */
function tintedIcon(type: PowerUpType, color: string) {
  return sprite('toy:icon:' + type + ':' + color, 48, 48, 24, 24, (c) => {
    icon(c, type, 0, 0, 0.56);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color;
    c.fillRect(-24, -24, 48, 48);
    c.globalCompositeOperation = 'source-over';
  });
}

function drawToken(g: G, type: PowerUpType): void {
  const c = PU_COLORS_NEW[type] ?? '#ffffff';
  const shape = PU_SHAPE[type] ?? 'round';
  tokenPath(g, shape, 3, 16);
  fl(g, shade(c, -0.45));
  st(g);
  tokenPath(g, shape, -1.5, 16);
  fl(g, shade(c, -0.1));
  st(g);
  tokenPath(g, shape, -2.2, 13.3);
  fl(g, shade(c, 0.28));
  tokenPath(g, shape, -1.3, 12.5);
  fl(g, c);
  g.save();
  tokenPath(g, shape, -1.5, 16);
  g.clip();
  ell(g, -6, -10, 8, 4.2, -0.5);
  fl(g, 'rgba(255,255,255,0.32)');
  g.restore();
  blit(g, tintedIcon(type, rgba(INK, 0.55)), 0.5, -1.2);
  icon(g, type, 0, -2, 0.56);
}

export function powerUp(g: G, o: PowerUpOpts): void {
  drawToken(g, o.type);
  // a sparkle that winks once per loop
  const k = (o.frame + 0.5) / o.frames;
  if (k > 0.15 && k < 0.5) {
    const q = Math.sin(((k - 0.15) / 0.35) * Math.PI);
    g.fillStyle = '#ffffff';
    star(g, -9, -12, 4, 5.2 * q, 1.2 * q);
    g.fill();
  }
  if (k > 0.55 && k < 0.75) {
    const q = Math.sin(((k - 0.55) / 0.2) * Math.PI);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    star(g, 10, 6, 4, 3 * q, 0.8 * q);
    g.fill();
  }
}

/* ================================================================== effects */

export function fx(g: G, o: FxOpts): void {
  switch (o.kind) {
    case 'spark':
      glow(g, 0, 0, 7, '#ffcf5a', 0.9);
      g.fillStyle = '#fff6c2';
      star(g, 0, 0, 4, 3.6, 1.1);
      g.fill();
      return;
    case 'smoke':
      g.fillStyle = 'rgba(214,206,220,0.9)';
      for (const [x, y, r] of [
        [-4, 2, 7],
        [4, 1, 6.5],
        [0, -4, 7.5],
      ]) {
        circle(g, x, y, r);
        g.fill();
      }
      g.fillStyle = 'rgba(245,240,248,0.85)';
      circle(g, -2, -5, 4);
      g.fill();
      return;
    case 'dust':
      g.fillStyle = 'rgba(239,227,200,0.9)';
      for (const [x, y, r] of [
        [-3, 1, 4.5],
        [3, 1, 4],
        [0, -2, 4.6],
      ]) {
        circle(g, x, y, r);
        g.fill();
      }
      return;
    case 'star':
      g.fillStyle = '#ffffff';
      star(g, 0, 0, 4, 6, 1.8);
      g.fill();
      st(g, rgba(INK, 0.45), 0.8);
      return;
    case 'ember':
      glow(g, 0, 0, 6, '#ff7a2a', 0.9);
      circle(g, 0, 0, 1.6);
      fl(g, '#ffd27a');
      return;
    case 'snow':
      g.save();
      for (let i = 0; i < 3; i++) {
        g.rotate(Math.PI / 3);
        seg(g, [-3.2, 0, 3.2, 0], '#ffffff', 1.2);
      }
      g.restore();
      circle(g, 0, 0, 1.2);
      fl(g, '#ffffff');
      return;
    case 'firefly':
      glow(g, 0, 0, 9, '#c8ff5a', 0.7);
      circle(g, 0, 0, 1.8);
      fl(g, '#f2ffb0');
      return;
    case 'mote':
      circle(g, 0, 0, 1.6);
      fl(g, 'rgba(255,244,220,0.75)');
      return;
    case 'glow':
      glow(g, 0, 0, 24, '#ffffff', 1);
      return;
    case 'ring':
      for (const [w, a] of [
        [7, 0.25],
        [4, 0.55],
        [2, 1],
      ]) {
        circle(g, 0, 0, 18);
        st(g, rgba('#ffffff', a), w);
      }
      return;
    case 'localRing':
      g.save();
      ell(g, 0, 0, 19.5, 8);
      fl(g, 'rgba(255,255,255,0.2)');
      g.setLineDash([5.5, 4]);
      ell(g, 0, 0, 19.5, 8);
      st(g, '#ffffff', 2.2);
      g.restore();
      return;
    case 'teamRing':
      ell(g, 0, 0, 17, 7);
      fl(g, 'rgba(255,255,255,0.4)');
      st(g, '#ffffff', 2.2);
      return;
  }
}

/** A splinter or stone shard from a broken block. */
export function chunk(g: G, o: ChunkOpts): void {
  const cols = chunkColors(o.world, o.kind);
  const c = cols[o.variant % cols.length];
  g.save();
  g.rotate((o.variant - 1) * 0.5);
  if (o.kind === 'cracked' && o.variant === 2) {
    // a steel bracket corner
    poly(g, [-5, -5, 5, -5, 5, -1.6, -1.6, -1.6, -1.6, 5, -5, 5]);
    fl(g, '#a3acb7');
    st(g, INK, 1);
  } else {
    poly(g, [-6, -2.5, 5, -3.2, 6.4, 2, -4.6, 3]);
    fl(g, c);
    st(g, INK, 1);
    seg(g, [-4.5, -1.6, 4, -2.2], 'rgba(255,255,255,0.3)', 0.9);
  }
  g.restore();
}

export function scorch(g: G, o: ScorchOpts): void {
  const r = rng(o.variant + 3);
  g.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const rad = 18 + r() * 9;
    if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad * 0.85);
    else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad * 0.85);
  }
  g.closePath();
  g.fillStyle = 'rgba(60,34,30,0.28)';
  g.fill();
  g.fillStyle = 'rgba(40,22,22,0.3)';
  circle(g, 0, 0, 11);
  g.fill();
  g.strokeStyle = 'rgba(40,22,22,0.24)';
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = r() * TAU;
    g.beginPath();
    g.moveTo(Math.cos(a) * 8, Math.sin(a) * 7);
    g.lineTo(Math.cos(a) * (18 + r() * 8), Math.sin(a) * (15 + r() * 6));
    g.stroke();
  }
}

/** A chunky molten rock. */
export function meteor(g: G): void {
  glow(g, 0, 0, 24, '#ff7a2a', 0.45);
  const rock = (): void => {
    g.beginPath();
    const pts = 9;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * TAU;
      const rad = 14 + ((i * 37) % 5) * 0.8;
      if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    g.closePath();
  };
  rock();
  fl(g, '#5b4a46');
  g.save();
  rock();
  g.clip();
  circle(g, 5, 6, 13);
  fl(g, '#3a2c2a');
  ell(g, -5, -6, 6, 3.5, -0.6);
  fl(g, 'rgba(255,255,255,0.18)');
  g.restore();
  for (const c of [
    [-8, -2, -2, 2, 2, 9],
    [4, -10, 6, -2, 12, 1],
  ]) {
    seg(g, c, 'rgba(255,110,40,0.35)', 4);
    seg(g, c, '#ffb04a', 1.4);
  }
  rock();
  st(g, '#1d1215', 1.8);
}
