import type { TileType } from '@blast-arena/shared';
import { circle, ease, hash2, poly, rgba, rr, shade, star } from '../../paint';
import type {
  BlockShadowOpts,
  CrateOpts,
  FloorOpts,
  SpecialOpts,
  WallOpts,
  World,
} from '../../painters/types';
import { CREAM, INK, RAISE, ell, fl, pal, seg, st } from './common';
import type { G, Pal } from './common';

const TAU = Math.PI * 2;

/* ================================================================== floors */

function paver(g: G, c: string, grout: string, bevel = 0.12): void {
  g.fillStyle = grout;
  g.fillRect(0, 0, 48, 48);
  rr(g, 2, 2, 45, 45, 5);
  fl(g, shade(c, -bevel));
  rr(g, 1.5, 1.5, 44, 44, 5);
  fl(g, shade(c, bevel * 0.9));
  rr(g, 2.4, 2.4, 43, 43, 4.6);
  fl(g, c);
}

function speckles(
  g: G,
  a: number,
  b: number,
  color: string,
  n: number,
  seed: number,
  size = 1,
): void {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const px = 5 + hash2(a * 7 + i, b, seed) * 38;
    const py = 5 + hash2(a, b * 7 + i, seed + 1) * 38;
    circle(g, px, py, (0.5 + hash2(a + i, b - i, seed + 2)) * size);
    g.fill();
  }
}

export function floor(g: G, o: FloorOpts): void {
  const p = pal(o.world);
  const v = o.variant;
  const par = o.parity;
  const h = hash2(v, par, 3);
  const base = shade(par ? p.floorB : p.floorA, (h - 0.5) * 0.07);
  switch (o.world) {
    case 'forest': {
      g.fillStyle = base;
      g.fillRect(0, 0, 48, 48);
      g.fillStyle = 'rgba(30,60,20,0.08)';
      g.fillRect(0, 46.5, 48, 1.5);
      g.fillRect(46.5, 0, 1.5, 48);
      g.fillStyle = 'rgba(255,255,220,0.07)';
      g.fillRect(0, 0, 48, 1.2);
      for (let i = 0; i < 4; i++) {
        const tx = 6 + hash2(v * 5 + i, par, 11) * 34;
        const ty = 8 + hash2(v, par * 5 + i, 12) * 32;
        seg(g, [tx - 2.5, ty - 3, tx, ty, tx + 2.5, ty - 3.5], shade(p.grout, -0.08), 1.3);
      }
      if (h < 0.25) {
        const fx = 10 + hash2(v, par, 14) * 28;
        const fy = 10 + hash2(v, par, 15) * 28;
        g.fillStyle = '#fff6f0';
        for (let i = 0; i < 5; i++) {
          circle(g, fx + Math.cos(i * 1.256) * 2, fy + Math.sin(i * 1.256) * 2, 1.4);
          g.fill();
        }
        g.fillStyle = '#ffcf3a';
        circle(g, fx, fy, 1.2);
        g.fill();
      }
      break;
    }
    case 'desert': {
      g.fillStyle = base;
      g.fillRect(0, 0, 48, 48);
      // wind ripples, kept inside the tile so neighbours never meet mid-ripple
      for (let i = 0; i < 3; i++) {
        const y0 = 9 + i * 14 + h * 4;
        const x0 = 5 + hash2(v, i, 16) * 8;
        const x1 = 43 - hash2(i, v, 17) * 8;
        const amp = 2 + hash2(v + i, par, 18) * 1.5;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo((x0 + x1) / 2, y0 - amp * 2, x1, y0);
        g.strokeStyle = rgba(p.ripple, 0.75);
        g.lineWidth = 1.4;
        g.lineCap = 'round';
        g.stroke();
        g.beginPath();
        g.moveTo(x0 + 1, y0 + 1.6);
        g.quadraticCurveTo((x0 + x1) / 2, y0 - amp * 2 + 1.6, x1 - 1, y0 + 1.6);
        g.strokeStyle = 'rgba(255,248,226,0.6)';
        g.lineWidth = 1;
        g.stroke();
      }
      if (h > 0.7) {
        g.fillStyle = '#b48552';
        ell(g, 34, 38, 2.4, 1.6);
        g.fill();
        ell(g, 38, 36, 1.4, 1);
        g.fill();
      }
      break;
    }
    case 'ice': {
      paver(g, base, p.grout, 0.04);
      speckles(g, v, par, 'rgba(120,160,210,0.25)', 4, 21, 1.1);
      g.fillStyle = 'rgba(255,255,255,0.65)';
      circle(g, 10 + h * 20, 12 + h * 8, 1.6);
      g.fill();
      break;
    }
    case 'volcano': {
      paver(g, base, p.grout, 0.1);
      speckles(g, v, par, 'rgba(0,0,0,0.25)', 5, 31, 1.2);
      if (h < 0.32) {
        const cx = 10 + hash2(v, par, 33) * 22;
        const pts = [cx, 8, cx + 6, 20, cx + 2, 30, cx + 10, 40];
        seg(g, pts, 'rgba(255,106,42,0.18)', 4);
        seg(g, pts, 'rgba(255,140,60,0.7)', 1.3);
      }
      break;
    }
    case 'void': {
      paver(g, base, p.grout, 0.14);
      speckles(g, v, par, 'rgba(230,220,255,0.75)', 3, 81, 0.6);
      speckles(g, v + 3, par, 'rgba(180,150,255,0.5)', 3, 82, 0.5);
      if (h > 0.62) {
        g.fillStyle = '#e8dcff';
        star(g, 12 + h * 22, 30 - h * 14, 4, 3.2, 0.8);
        g.fill();
      }
      if (h < 0.18) {
        circle(g, 24, 24, 9);
        st(g, 'rgba(192,140,255,0.35)', 1.2);
        poly(g, [24, 18, 29, 27, 19, 27]);
        st(g, 'rgba(192,140,255,0.35)', 1);
      }
      break;
    }
    case 'castle': {
      g.fillStyle = p.grout;
      g.fillRect(0, 0, 48, 48);
      const split = 14 + hash2(v, par, 41) * 20;
      const vertical = hash2(v, par, 42) < 0.5;
      const stones: number[][] = vertical
        ? [
            [1.5, 1.5, split - 2.5, 45],
            [split + 1, 1.5, 47 - split - 2.5, 45],
          ]
        : [
            [1.5, 1.5, 45, split - 2.5],
            [1.5, split + 1, 45, 47 - split - 2.5],
          ];
      stones.forEach((s, i) => {
        const c = shade(base, (hash2(v + i, par, 43) - 0.5) * 0.1);
        rr(g, s[0] + 0.6, s[1] + 0.6, s[2], s[3], 3);
        fl(g, shade(c, -0.14));
        rr(g, s[0], s[1], s[2], s[3], 3);
        fl(g, shade(c, 0.1));
        rr(g, s[0] + 0.8, s[1] + 0.8, s[2] - 1.2, s[3] - 1.2, 2.6);
        fl(g, c);
      });
      speckles(g, v, par, 'rgba(40,30,50,0.18)', 4, 44, 1);
      break;
    }
    case 'swamp': {
      g.fillStyle = base;
      g.fillRect(0, 0, 48, 48);
      g.fillStyle = rgba(p.grout, 0.35);
      ell(g, 12 + h * 20, 34, 12, 6, 0.2);
      g.fill();
      g.fillStyle = 'rgba(30,40,10,0.08)';
      g.fillRect(0, 46.5, 48, 1.5);
      g.fillRect(46.5, 0, 1.5, 48);
      if (h < 0.45) {
        const px = 14 + hash2(v, par, 61) * 18;
        const py = 14 + hash2(par, v, 62) * 16;
        ell(g, px, py, 11, 6.5, 0.15);
        fl(g, shade(p.puddle, -0.1));
        ell(g, px, py - 0.6, 10, 5.6, 0.15);
        fl(g, p.puddle);
        seg(g, [px - 6, py - 2, px - 1, py - 3.2], 'rgba(220,240,230,0.55)', 1.2);
      }
      if (h > 0.78) {
        const lx = 34;
        const ly = 30;
        g.beginPath();
        g.moveTo(lx, ly);
        g.arc(lx, ly, 5.5, 0.4, TAU - 0.2);
        g.closePath();
        fl(g, '#5d9a3a');
        st(g, rgba(INK, 0.6), 1);
      }
      speckles(g, v, par, 'rgba(20,30,10,0.25)', 4, 63, 0.9);
      break;
    }
    case 'sky': {
      paver(g, base, p.grout, 0.06);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      ell(g, 14 + h * 16, 36, 9, 3.4);
      g.fill();
      ell(g, 22 + h * 16, 33.5, 6, 3);
      g.fill();
      if (h > 0.6) {
        g.fillStyle = 'rgba(255,255,255,0.85)';
        star(g, 34 - h * 10, 12, 4, 2.6, 0.7);
        g.fill();
      }
      break;
    }
    default: {
      paver(g, base, p.grout, 0.1);
      speckles(g, v, par, 'rgba(120,100,70,0.22)', 5, 51, 0.9);
      if (h > 0.8) {
        g.fillStyle = '#7f9a55';
        circle(g, 2, 2, 2.6);
        g.fill();
      }
    }
  }
}

/** Soft shadow one block throws to the bottom right (layered, so it needs no canvas blur). */
export function blockShadow(g: G, o: BlockShadowOpts): void {
  const p = pal(o.world);
  const dark = o.world === 'volcano' || o.world === 'void';
  const a = dark ? 0.12 : 0.075;
  for (let i = 0; i < 6; i++) {
    const grow = i * 1.6;
    rr(g, 5 - grow, 5 - grow, 46 + grow * 2, 46 + grow * 2, 7 + grow);
    g.fillStyle = rgba(p.shadow, a);
    g.fill();
  }
}

/* ================================================================== blocks */

/** Generic chunky block. Origin = tile top-left; covers y in [-RAISE, 47]. */
function blockBase(g: G, top: string, front: string, hi: string): void {
  rr(g, 1, -RAISE, 46, 48 + RAISE - 1, 8);
  fl(g, front);
  rr(g, 1, -RAISE, 46, 46, 8);
  fl(g, top);
  g.save();
  rr(g, 1, -RAISE, 46, 46, 8);
  g.clip();
  g.fillStyle = rgba('#000000', 0.07);
  g.fillRect(1, 22, 46, 13);
  g.restore();
  seg(g, [3, 35, 45, 35], rgba('#000000', 0.28), 1.2);
  seg(g, [8, -RAISE + 2, 40, -RAISE + 2], hi, 1.8);
  seg(g, [2.6, -RAISE + 8, 2.6, 28], rgba(hi, 0.6), 1.3);
}

function blockOutline(g: G): void {
  rr(g, 1, -RAISE, 46, 48 + RAISE - 1, 8);
  st(g);
}

function clipTop(g: G): void {
  rr(g, 1, -RAISE, 46, 46, 8);
  g.clip();
}

export function wall(g: G, o: WallOpts): void {
  const p = pal(o.world);
  const v = o.variant & 1;
  const v2 = o.variant >> 1;
  blockBase(g, p.wallTop, p.wallFront, p.wallHi);
  switch (o.world) {
    case 'forest': {
      g.save();
      clipTop(g);
      g.fillStyle = p.moss;
      const blobs = [
        [8, -8, 9],
        [20, -10, 8],
        [34, -7, 10],
        [44, -2, 7],
        [6, 6, 6],
        [28, 4, 5],
        [16, 16, 4],
      ];
      blobs.forEach(([bx, by, r], i) => {
        if (i > 3 && hash2(v, i, 61) < 0.5) return;
        circle(g, bx, by, r);
        g.fill();
      });
      g.fillStyle = p.mossHi;
      blobs.slice(0, 4).forEach(([bx, by, r]) => {
        circle(g, bx - r * 0.25, by - r * 0.3, r * 0.45);
        g.fill();
      });
      g.restore();
      g.fillStyle = p.moss;
      for (const [dx, len] of [
        [10, 6],
        [26, 9],
        [38, 5],
      ]) {
        rr(g, dx - 2, 33, 4.5, len + 2, 2.2);
        g.fill();
      }
      seg(g, [30, 18, 36, 24, 42, 22], rgba('#000000', 0.18), 1.2);
      break;
    }
    case 'desert': {
      g.save();
      clipTop(g);
      // strata bands across the top face
      for (const [y, a] of [
        [-2, 0.5],
        [12, 0.4],
        [24, 0.35],
      ]) {
        g.beginPath();
        g.moveTo(1, y);
        g.quadraticCurveTo(16, y - 3 + v * 2, 30, y + 1);
        g.quadraticCurveTo(40, y + 3, 47, y - 1);
        g.strokeStyle = rgba(p.strata, a);
        g.lineWidth = 2.2;
        g.stroke();
      }
      g.fillStyle = rgba(p.strata, 0.55);
      ell(g, 12 + v2 * 18, 4, 2.6, 1.8);
      g.fill();
      ell(g, 34 - v2 * 10, 18, 1.8, 1.3);
      g.fill();
      g.restore();
      seg(g, [3, 40.5, 45, 40.5], rgba(p.strata, 0.9), 1.4);
      seg(g, [3, 44, 45, 44], rgba(p.wallHi, 0.35), 1);
      break;
    }
    case 'ice': {
      g.save();
      clipTop(g);
      g.fillStyle = 'rgba(160,190,230,0.35)';
      ell(g, 30, 30, 26, 10, -0.1);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      ell(g, 14, -4, 9, 4, -0.2);
      g.fill();
      g.restore();
      g.fillStyle = p.icicle;
      g.strokeStyle = rgba(INK, 0.55);
      g.lineWidth = 0.9;
      const icicles = v
        ? [
            [8, 8],
            [15, 5],
            [23, 10],
            [31, 6],
            [39, 9],
          ]
        : [
            [9, 6],
            [17, 9],
            [27, 5],
            [36, 10],
          ];
      for (const [ix, len] of icicles) {
        poly(g, [ix - 2.6, 35.5, ix + 2.6, 35.5, ix, 35.5 + len]);
        g.fill();
        g.stroke();
      }
      break;
    }
    case 'volcano': {
      const cracks = v
        ? [
            [6, -6, 14, 2, 12, 12, 20, 20],
            [30, -9, 28, 2, 36, 10, 42, 8],
            [22, 22, 30, 28, 40, 27],
          ]
        : [
            [10, -8, 8, 4, 16, 12],
            [36, -6, 30, 8, 34, 18, 28, 26],
          ];
      for (const c of cracks) {
        seg(g, c, 'rgba(255,110,40,0.22)', 4.5);
        seg(g, c, p.seam, 1.4);
      }
      const base = [6, 41, 16, 39, 24, 43, 34, 40, 42, 42];
      seg(g, base, 'rgba(255,110,40,0.3)', 3);
      seg(g, base, '#ff9a4a', 1);
      break;
    }
    case 'void': {
      g.save();
      clipTop(g);
      // crystal facets on the top face
      g.fillStyle = rgba('#ffffff', 0.13);
      poly(g, [1, -RAISE, 24, -RAISE, 14, 14, 1, 20]);
      g.fill();
      g.fillStyle = rgba('#000000', 0.16);
      poly(g, [47, 2, 47, 35, 26, 35, 34, 10]);
      g.fill();
      g.fillStyle = rgba('#ffffff', 0.08);
      poly(g, [24, -RAISE, 47, -RAISE, 34, 10, 14, 14]);
      g.fill();
      g.restore();
      const facet = [14, 14, 24, -RAISE + 1];
      seg(g, facet, rgba(p.glowLine, 0.35), 3.2);
      seg(g, facet, rgba(p.glowLine, 0.9), 1);
      seg(g, [14, 14, 34, 10, 47, 2], rgba(p.glowLine, 0.55), 1);
      // glowing edge along the top of the front face
      seg(g, [4, 35, 44, 35], rgba(p.glowLine, 0.4), 3.2);
      seg(g, [4, 35, 44, 35], p.glowLine, 1);
      if (v2) {
        g.fillStyle = '#f0e6ff';
        star(g, 36, -2, 4, 3.4, 0.9);
        g.fill();
      }
      break;
    }
    case 'castle': {
      const line = shade(p.wallTop, -0.22);
      seg(g, [2, 4, 46, 4], line, 1.2);
      seg(g, [2, 19, 46, 19], line, 1.2);
      seg(g, [24, -RAISE + 1, 24, 4], line, 1.2);
      seg(g, [12, 4, 12, 19], line, 1.2);
      seg(g, [36, 4, 36, 19], line, 1.2);
      seg(g, [24, 19, 24, 34], line, 1.2);
      const fline = shade(p.wallFront, -0.25);
      seg(g, [2, 41, 46, 41], fline, 1.1);
      seg(g, [16, 35, 16, 41], fline, 1.1);
      seg(g, [32, 35, 32, 41], fline, 1.1);
      seg(g, [10, 41, 10, 47], fline, 1.1);
      seg(g, [38, 41, 38, 47], fline, 1.1);
      break;
    }
    case 'swamp': {
      g.save();
      clipTop(g);
      g.fillStyle = p.moss;
      const blobs = [
        [6, -6, 8],
        [40, -4, 9],
        [24, 16, 6],
      ];
      blobs.forEach(([bx, by, r], i) => {
        if (i === 2 && v) return;
        circle(g, bx, by, r);
        g.fill();
      });
      g.fillStyle = p.mossHi;
      circle(g, 4, -8, 3.4);
      g.fill();
      circle(g, 38, -7, 3.8);
      g.fill();
      // wet sheen
      seg(g, [16, -6, 28, 6], 'rgba(255,255,255,0.35)', 2);
      seg(g, [20, -8, 24, -4], 'rgba(255,255,255,0.5)', 1.4);
      g.restore();
      g.fillStyle = p.moss;
      for (const [dx, len] of [
        [8, 8],
        [34, 6],
      ]) {
        rr(g, dx - 2, 33, 4.5, len + 2, 2.2);
        g.fill();
      }
      // drips of water
      g.fillStyle = 'rgba(200,230,220,0.7)';
      ell(g, 22, 43, 1.4, 2);
      g.fill();
      break;
    }
    case 'sky': {
      g.save();
      clipTop(g);
      g.fillStyle = 'rgba(150,180,225,0.28)';
      ell(g, 28, 28, 26, 9, -0.05);
      g.fill();
      g.restore();
      // cloud puffs along the top edge
      g.fillStyle = '#ffffff';
      const puffs = v
        ? [
            [8, -RAISE + 3, 6],
            [19, -RAISE + 1, 7.5],
            [31, -RAISE + 2, 6.5],
            [41, -RAISE + 4, 5.5],
          ]
        : [
            [10, -RAISE + 2, 7],
            [24, -RAISE + 1, 8],
            [38, -RAISE + 3, 6.5],
          ];
      for (const [px, py, r] of puffs) {
        circle(g, px, py, r);
        g.fill();
        st(g, rgba(INK, 0.35), 1);
      }
      for (const [px, py, r] of puffs) {
        circle(g, px, py, r - 0.6);
        g.fill();
      }
      // gold trim band on the front
      g.fillStyle = p.trim;
      g.fillRect(2, 38, 44, 3.2);
      seg(g, [2, 38, 46, 38], rgba('#ffffff', 0.7), 0.9);
      seg(g, [2, 41.2, 46, 41.2], rgba(INK, 0.45), 0.9);
      break;
    }
    default: {
      rr(g, 8, -RAISE + 7, 32, 30, 5);
      fl(g, shade(p.wallTop, 0.07));
      st(g, shade(p.wallTop, -0.18), 1.2);
      seg(g, [11, -RAISE + 9.5, 36, -RAISE + 9.5], rgba('#ffffff', 0.35), 1.2);
      g.fillStyle = shade(p.wallFront, 0.25);
      for (const bx of v2 ? [9, 24, 39] : [9, 39]) {
        circle(g, bx, 41, 1.6);
        g.fill();
      }
    }
  }
  if (o.border) {
    // the arena's rim reads a touch heavier than the pillars inside it
    rr(g, 1, 35, 46, 12, 6);
    g.fillStyle = rgba('#000000', 0.12);
    g.fill();
  }
  blockOutline(g);
}

/* ================================================================== crates */

function crateClassic(g: G, p: Pal, v: number): void {
  blockBase(g, p.crateTop, p.crateFront, p.crateHi);
  rr(g, 4, -RAISE + 3, 40, 40, 6);
  st(g, p.crateTrim, 3);
  seg(g, [6, 4.4, 42, 4.4], p.crateLine, 1.4);
  seg(g, [6, 18.6, 42, 18.6], p.crateLine, 1.4);
  seg(g, v ? [8, -5, 40, 30] : [8, 30, 40, -5], rgba(p.crateTrim, 0.55), 2.4);
  g.fillStyle = p.nail;
  for (const [nx, ny] of [
    [7.5, -RAISE + 6.5],
    [40.5, -RAISE + 6.5],
    [7.5, 29.5],
    [40.5, 29.5],
  ]) {
    circle(g, nx, ny, 1.5);
    g.fill();
  }
  seg(g, [16, 36.5, 16, 46], p.crateLine, 1.2);
  seg(g, [32, 36.5, 32, 46], p.crateLine, 1.2);
}

function crateLogs(g: G, p: Pal, v: number): void {
  rr(g, 1, -RAISE, 46, 48 + RAISE - 1, 8);
  fl(g, p.barkDark);
  const logs = [-RAISE + 1, -RAISE + 16, -RAISE + 31];
  logs.forEach((ly, i) => {
    rr(g, 1.5, ly, 45, 14.5, 7);
    fl(g, i === 2 ? shade(p.bark, -0.12) : p.bark);
    seg(g, [10, ly + 4.5, 22, ly + 4.5], rgba('#000000', 0.25), 1.1);
    seg(g, [26, ly + 9.5, 38, ly + 9.5], rgba('#000000', 0.25), 1.1);
    seg(g, [7, ly + 2.2, 40, ly + 2.2], rgba('#ffffff', 0.18), 1.1);
    for (const ex of [6.5, 41.5]) {
      ell(g, ex, ly + 7.25, 4.6, 6.4);
      fl(g, p.logEnd);
      st(g, INK, 1);
      ell(g, ex, ly + 7.25, 2.2, 3.2);
      st(g, p.logRing, 0.9);
    }
  });
  const rx = v ? 18 : 24;
  seg(g, [rx, -RAISE + 1, rx, 46], '#d9c08a', 2.6);
  seg(g, [rx, -RAISE + 1, rx, 46], rgba(INK, 0.35), 0.8);
  g.fillStyle = rgba('#000000', 0.18);
  g.fillRect(2, 36, 44, 10.5);
}

function crateIce(g: G, p: Pal, v: number): void {
  blockBase(g, p.crateTop, p.crateFront, p.crateHi);
  g.save();
  clipTop(g);
  g.fillStyle = rgba('#ffffff', 0.45);
  poly(g, [1, -RAISE, 22, -RAISE, 8, 18, 1, 22]);
  g.fill();
  g.fillStyle = rgba('#2d7fb8', 0.18);
  poly(g, [47, 4, 47, 35, 20, 35]);
  g.fill();
  g.fillStyle = rgba('#ffffff', 0.25);
  poly(g, [28, -RAISE, 40, -RAISE, 24, 20, 16, 20]);
  g.fill();
  g.restore();
  seg(g, [10, 2, 24, 12, 38, 6], rgba('#ffffff', 0.85), 1.1);
  seg(g, [24, 12, 22, 26], rgba('#ffffff', 0.85), 1.1);
  g.fillStyle = '#ffffff';
  star(g, v ? 13 : 35, -2, 4, 4.5, 1.2);
  g.fill();
  g.fillStyle = rgba('#ffffff', 0.35);
  g.fillRect(4, 37, 40, 2);
}

function crateCharred(g: G, p: Pal, v: number): void {
  blockBase(g, p.crateTop, p.crateFront, p.crateHi);
  rr(g, 4, -RAISE + 3, 40, 40, 6);
  st(g, shade(p.crateFront, -0.35), 3);
  seg(g, [6, 4.4, 42, 4.4], shade(p.crateTop, -0.35), 1.4);
  seg(g, [6, 18.6, 42, 18.6], shade(p.crateTop, -0.35), 1.4);
  g.fillStyle = rgba('#000000', 0.3);
  circle(g, v ? 14 : 34, 22, 8);
  g.fill();
  circle(g, v ? 36 : 12, -2, 6);
  g.fill();
  for (const c of [
    [10, 8, 16, 14, 14, 24],
    [30, -6, 36, 2, 34, 10],
  ]) {
    seg(g, c, 'rgba(255,106,42,0.3)', 4);
    seg(g, c, p.ember, 1.3);
  }
  seg(g, [16, 37, 16, 46], shade(p.crateFront, -0.4), 1.2);
  seg(g, [32, 37, 32, 46], shade(p.crateFront, -0.4), 1.2);
}

function crateBarrel(g: G, p: Pal, v: number): void {
  rr(g, 3, -RAISE + 8, 42, 48 + RAISE - 9, 10);
  fl(g, p.barrelDark);
  rr(g, 3, -RAISE + 8, 42, 48 + RAISE - 12, 10);
  fl(g, p.barrel);
  for (const sx of [12, 20, 28, 36]) seg(g, [sx, 6, sx, 44], rgba('#000000', 0.22), 1.1);
  seg(g, [6, 12, 6, 40], rgba(p.barrelHi, 0.8), 1.6);
  for (const hy of v ? [14, 34] : [12, 36]) {
    g.fillStyle = p.hoop;
    g.fillRect(3, hy - 2, 42, 4);
    seg(g, [3, hy - 2, 45, hy - 2], rgba('#ffffff', 0.4), 0.8);
  }
  rr(g, 3, -RAISE + 8, 42, 48 + RAISE - 9, 10);
  st(g);
  ell(g, 24, -RAISE + 9, 21, 10);
  fl(g, p.barrelHi);
  st(g);
  ell(g, 24, -RAISE + 9, 16, 7);
  st(g, rgba(p.barrelDark, 0.8), 1.2);
  seg(g, [12, -RAISE + 8, 36, -RAISE + 8], rgba(p.barrelDark, 0.5), 1);
  seg(g, [14, -RAISE + 12, 34, -RAISE + 12], rgba(p.barrelDark, 0.5), 1);
}

function crateClay(g: G, p: Pal, v: number): void {
  blockBase(g, p.crateTop, p.crateFront, p.crateHi);
  // painted zigzag band and dots, like a terracotta storage block
  g.save();
  clipTop(g);
  const zy = v ? 6 : 10;
  g.beginPath();
  g.moveTo(1, zy);
  for (let i = 0; i <= 8; i++) g.lineTo(1 + i * 5.75, zy + (i % 2 ? -5 : 0));
  g.strokeStyle = p.paint;
  g.lineWidth = 2.2;
  g.lineJoin = 'round';
  g.stroke();
  g.fillStyle = p.paint;
  for (const dx of [10, 24, 38]) {
    circle(g, dx, zy + 12, 1.8);
    g.fill();
  }
  g.restore();
  rr(g, 5, -RAISE + 3, 38, 40, 6);
  st(g, rgba(p.crateFront, 0.7), 1.6);
  g.fillStyle = rgba(p.paint, 0.8);
  g.fillRect(4, 39, 40, 2.4);
  seg(g, [12, 36.5, 12, 46], rgba(INK, 0.3), 1);
  seg(g, [36, 36.5, 36, 46], rgba(INK, 0.3), 1);
}

function crateRune(g: G, p: Pal, v: number): void {
  blockBase(g, p.crateTop, p.crateFront, p.crateHi);
  g.save();
  clipTop(g);
  g.fillStyle = rgba('#000000', 0.12);
  ell(g, 34, 26, 12, 7);
  g.fill();
  g.restore();
  // glowing glyph carved into the top face: a kite or a spiral
  const glyph = (w: number, c: string): void => {
    g.beginPath();
    if (v) {
      g.moveTo(14, 2);
      g.lineTo(24, -6);
      g.lineTo(34, 2);
      g.lineTo(24, 22);
      g.closePath();
    } else {
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 3.2;
        const r = 1.5 + (i / 40) * 11;
        const x = 24 + Math.cos(a) * r;
        const y = 8 + Math.sin(a) * r * 0.8;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    }
    g.strokeStyle = c;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
  };
  glyph(5, rgba(p.rune, 0.3));
  glyph(2, p.rune);
  glyph(0.8, '#f4e8ff');
  seg(g, [8, 40, 40, 40], rgba(p.rune, 0.45), 1.2);
}

function crateRotten(g: G, p: Pal, v: number): void {
  blockBase(g, p.crateTop, p.crateFront, p.crateHi);
  rr(g, 4, -RAISE + 3, 40, 40, 6);
  st(g, shade(p.crateFront, -0.2), 2.6);
  seg(g, [6, 4.4, 42, 4.4], p.crateLine, 1.4);
  seg(g, [6, 18.6, 42, 18.6], p.crateLine, 1.4);
  // a missing plank corner
  poly(g, [30, 19.5, 43, 19.5, 43, 30, 36, 30]);
  fl(g, shade(p.crateFront, -0.35));
  // fungus spots
  g.fillStyle = rgba(p.fungus, 0.7);
  for (const [fx, fy, r] of [
    [10, 26, 2.4],
    [14, 29, 1.6],
    [38, -3, 2],
  ]) {
    circle(g, fx, fy, r);
    g.fill();
  }
  // a little mushroom on top
  const mx = v ? 12 : 34;
  const my = -RAISE + 10;
  rr(g, mx - 1.5, my - 1, 3, 6, 1.2);
  fl(g, '#f2ead8');
  st(g, INK, 0.9);
  g.beginPath();
  g.arc(mx, my, 5.5, Math.PI, 0);
  g.closePath();
  fl(g, '#d94a35');
  st(g, INK, 1);
  g.fillStyle = '#ffffff';
  circle(g, mx - 2, my - 2.4, 1);
  g.fill();
  circle(g, mx + 2.2, my - 1.4, 0.8);
  g.fill();
  seg(g, [16, 36.5, 16, 46], p.crateLine, 1.2);
  seg(g, [32, 36.5, 32, 46], p.crateLine, 1.2);
}

function crateLight(g: G, p: Pal, v: number): void {
  blockBase(g, p.crateTop, p.crateFront, p.crateHi);
  rr(g, 4, -RAISE + 3, 40, 40, 6);
  st(g, p.crateLine, 2.2);
  seg(g, [6, 11, 42, 11], rgba(p.crateLine, 0.7), 1.2);
  // gold corner caps
  g.fillStyle = '#f0c25a';
  for (const [cx, cy] of [
    [4, -RAISE + 3],
    [44, -RAISE + 3],
    [4, 35],
    [44, 35],
  ]) {
    circle(g, cx, cy, 3.2);
    g.fill();
    st(g, INK, 1);
  }
  // star emblem
  g.fillStyle = '#ffffff';
  star(g, v ? 18 : 24, 11, 5, 6.5, 2.8);
  g.fill();
  st(g, rgba('#c99c3c', 0.9), 1.1);
  seg(g, [16, 36.5, 16, 46], rgba(p.crateLine, 0.8), 1.1);
  seg(g, [32, 36.5, 32, 46], rgba(p.crateLine, 0.8), 1.1);
}

function reinforce(g: G, isBarrel: boolean): void {
  const steel = '#a3acb7';
  const steelDark = '#6b7480';
  if (isBarrel) {
    g.fillStyle = steel;
    g.fillRect(3, 22, 42, 5);
    seg(g, [3, 22, 45, 22], INK, 1.1);
    seg(g, [3, 27, 45, 27], INK, 1.1);
    return;
  }
  const corner = (cx: number, cy: number, sx: number, sy: number): void => {
    poly(g, [
      cx,
      cy,
      cx + sx * 14,
      cy,
      cx + sx * 14,
      cy + sy * 5,
      cx + sx * 5,
      cy + sy * 5,
      cx + sx * 5,
      cy + sy * 14,
      cx,
      cy + sy * 14,
    ]);
    g.fillStyle = steel;
    g.fill();
    st(g, INK, 1.1);
    g.fillStyle = steelDark;
    circle(g, cx + sx * 3, cy + sy * 3, 1.2);
    g.fill();
  };
  corner(2, -RAISE + 1, 1, 1);
  corner(46, -RAISE + 1, -1, 1);
  corner(2, 34, 1, -1);
  corner(46, 34, -1, -1);
  g.fillStyle = steel;
  g.fillRect(2, 38.5, 44, 4.5);
  seg(g, [2, 38.5, 46, 38.5], INK, 1);
  seg(g, [2, 43, 46, 43], INK, 1);
  g.fillStyle = steelDark;
  for (const rx of [8, 18, 30, 40]) {
    circle(g, rx, 40.7, 1);
    g.fill();
  }
}

function crack(g: G): void {
  const pts = [12, -RAISE + 1, 20, 2, 16, 12, 26, 22, 22, 35];
  seg(g, pts, rgba('#2a1406', 0.85), 3);
  seg(
    g,
    pts.map((n, i) => (i % 2 ? n : n + 1.4)),
    rgba('#ffffff', 0.25),
    0.9,
  );
  seg(g, [26, 22, 36, 24, 42, 30], rgba('#2a1406', 0.75), 2);
  seg(g, [22, 35, 24, 41, 21, 47], rgba('#2a1406', 0.8), 2.4);
  g.fillStyle = '#e8b779';
  poly(g, [16, 12, 11, 14, 15, 15]);
  g.fill();
}

export function crate(g: G, o: CrateOpts): void {
  const p = pal(o.world);
  const v = o.variant & 1;
  const barrel = o.world === 'castle';
  switch (o.world) {
    case 'forest':
      crateLogs(g, p, v);
      break;
    case 'ice':
      crateIce(g, p, v);
      break;
    case 'volcano':
      crateCharred(g, p, v);
      break;
    case 'castle':
      crateBarrel(g, p, v);
      break;
    case 'desert':
      crateClay(g, p, v);
      break;
    case 'void':
      crateRune(g, p, v);
      break;
    case 'swamp':
      crateRotten(g, p, v);
      break;
    case 'sky':
      crateLight(g, p, v);
      break;
    default:
      crateClassic(g, p, v);
  }
  // A reinforced block that took its first hit: steel brackets, now split.
  if (o.kind === 'cracked') {
    reinforce(g, barrel);
    crack(g);
  }
  if (!barrel) blockOutline(g);
}

/* ================================================================== special tiles */

const GATE_COLORS: Record<string, string> = {
  red: '#e2493c',
  blue: '#3f7fe0',
  green: '#3fb85a',
  yellow: '#f0c03a',
};

/** Loop lengths and frame counts for the animated tiles. */
export function specialFrames(tile: TileType): number {
  switch (tile) {
    case 'teleporter_a':
    case 'teleporter_b':
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
    case 'lava':
    case 'dark_rift':
    case 'quicksand':
    case 'mud':
    case 'ice':
      return 8;
    case 'vine':
    case 'exit':
    case 'goal':
      return 6;
    default:
      return 1;
  }
}

export function specialLoopSeconds(tile: TileType): number {
  switch (tile) {
    case 'teleporter_a':
    case 'teleporter_b':
      return 0.4;
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
      return 0.7;
    case 'lava':
      return 1.6;
    case 'dark_rift':
      return 1.2;
    case 'quicksand':
      return 2.2;
    case 'mud':
      return 2.4;
    case 'ice':
      return 2.4;
    case 'vine':
      return 2;
    case 'exit':
      return 1.2;
    case 'goal':
      return 1.5;
    default:
      return 1;
  }
}

/** A bubble that grows over the first 75 % of its cycle and pops in the rest (k in [0, 1)). */
function bubble(
  g: G,
  cx: number,
  cy: number,
  k: number,
  col: string,
  hi: string,
  maxR: number,
): void {
  if (k < 0.75) {
    const r = 1 + (maxR - 1) * ease.outQuad(k / 0.75);
    circle(g, cx, cy, r);
    fl(g, col);
    st(g, rgba(INK, 0.5), 0.8);
    circle(g, cx - r * 0.35, cy - r * 0.35, r * 0.3);
    fl(g, hi);
  } else {
    const q = (k - 0.75) / 0.25;
    circle(g, cx, cy, maxR + q * 3);
    st(g, rgba(hi, 1 - q), 1.2);
  }
}

const frac = (x: number): number => x - Math.floor(x);

function teleporter(g: G, phase: number, b: boolean): void {
  const col = b ? '#ff9a4a' : '#4ab8ff';
  ell(g, 24, 27, 19, 17);
  fl(g, 'rgba(40,20,40,0.3)');
  circle(g, 24, 24, 18.5);
  fl(g, '#a59fb0');
  st(g);
  circle(g, 24, 24, 14.5);
  fl(g, shade(col, -0.45));
  st(g, INK, 1.2);
  // inner glow
  const gr = g.createRadialGradient(24, 24, 0, 24, 24, 14);
  gr.addColorStop(0, rgba(shade(col, 0.5), 0.95));
  gr.addColorStop(0.55, rgba(col, 0.55));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  circle(g, 24, 24, 14);
  g.fill();
  seg(g, [12, 15, 18, 10], 'rgba(255,255,255,0.6)', 1.6);
  g.save();
  g.translate(24, 24);
  // eight dashes rotate one dash-spacing per loop, a three-armed swirl a third of a turn
  const dir = b ? -1 : 1;
  g.rotate(dir * phase * (TAU / 8));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    g.beginPath();
    g.arc(0, 0, 11.5, a, a + 0.42);
    st(g, shade(col, 0.45), 2.2);
  }
  g.rotate(-dir * phase * (TAU / 8) - dir * phase * (TAU / 3));
  for (let i = 0; i < 3; i++) {
    g.rotate(TAU / 3);
    g.beginPath();
    g.arc(2.5, 0, 4.5, -0.3, 1.5);
    st(g, '#ffffff', 1.4);
  }
  g.restore();
}

function conveyor(g: G, world: World, dir: 'up' | 'down' | 'left' | 'right', phase: number): void {
  const p = pal(world);
  const frame = shade(world === 'classic' ? '#6e6878' : p.wallFront, 0.1);
  rr(g, 1, 1, 46, 46, 5);
  fl(g, frame);
  st(g);
  const rot = { right: 0, down: 1, left: 2, up: 3 }[dir];
  g.save();
  g.translate(24, 24);
  g.rotate((rot * Math.PI) / 2);
  rr(g, -21, -19, 42, 38, 3);
  fl(g, '#3f3a47');
  g.save();
  rr(g, -21, -19, 42, 38, 3);
  g.clip();
  // the belt travels one chevron spacing (24) per loop; slats repeat every 12
  const off = phase * 24;
  for (let u = -48; u < 48; u += 12) {
    g.fillStyle = '#5a5464';
    g.fillRect(u + (off % 12), -19, 5, 38);
  }
  for (let u = -48; u < 48; u += 24) {
    const cx = u + off;
    seg(g, [cx - 4, -7, cx + 3, 0, cx - 4, 7], '#ffd04a', 3);
  }
  g.restore();
  seg(g, [-21, -20, 21, -20], '#b9b3c4', 2);
  seg(g, [-21, 20, 21, 20], '#b9b3c4', 2);
  g.restore();
}

function lava(g: G, phase: number): void {
  rr(g, 0.5, 0.5, 47, 47, 6);
  fl(g, '#4a3536');
  rr(g, 3, 3, 42, 42, 9);
  fl(g, '#d9431d');
  g.save();
  rr(g, 3, 3, 42, 42, 9);
  g.clip();
  g.fillStyle = '#a62c14';
  circle(g, 12, 34, 9);
  g.fill();
  circle(g, 38, 12, 7);
  g.fill();
  // molten blobs drift in small circles
  g.fillStyle = 'rgba(255,150,50,0.55)';
  for (let i = 0; i < 2; i++) {
    const a = phase * TAU + i * 3;
    circle(g, 24 + Math.cos(a) * 9, 24 + Math.sin(a) * 8, 8 - i * 2);
    g.fill();
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(3, 3, 42, 4);
  bubble(g, 16, 16, frac(phase), '#ffb347', '#fff0b0', 4);
  bubble(g, 32, 28, frac(phase + 0.45), '#ff9a3a', '#ffe08a', 3.4);
  bubble(g, 22, 36, frac(phase + 0.75), '#ffc85a', '#fff4c0', 2.6);
  g.restore();
  rr(g, 3, 3, 42, 42, 9);
  st(g, INK, 1.4);
}

function iceTile(g: G, phase: number): void {
  rr(g, 0.5, 0.5, 47, 47, 4);
  fl(g, '#9fd3ec');
  rr(g, 2, 2, 44, 44, 4);
  fl(g, '#c6eaf8');
  g.fillStyle = 'rgba(255,255,255,0.55)';
  poly(g, [2, 2, 26, 2, 8, 30, 2, 34]);
  g.fill();
  g.fillStyle = 'rgba(120,180,220,0.25)';
  poly(g, [46, 14, 46, 46, 18, 46]);
  g.fill();
  seg(g, [8, 30, 22, 24, 34, 28, 42, 20], 'rgba(255,255,255,0.9)', 1.1);
  seg(g, [22, 24, 20, 40], 'rgba(255,255,255,0.9)', 1.1);
  // two twinkles taking turns
  for (const [x, y, off] of [
    [14, 12, 0],
    [36, 34, 0.5],
  ]) {
    const k = frac(phase + off);
    if (k < 0.4) {
      const s = Math.sin((k / 0.4) * Math.PI);
      g.fillStyle = '#ffffff';
      star(g, x, y, 4, 6 * s, 1.2 * s);
      g.fill();
    }
  }
  rr(g, 2, 2, 44, 44, 4);
  st(g, 'rgba(70,120,170,0.5)', 1.2);
}

function rift(g: G, phase: number): void {
  rr(g, 2.5, 2.5, 43, 43, 12);
  fl(g, '#3a2466');
  rr(g, 5, 5, 38, 38, 11);
  fl(g, '#140c22');
  g.save();
  rr(g, 5, 5, 38, 38, 11);
  g.clip();
  g.translate(24, 24);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 20);
  gr.addColorStop(0, 'rgba(122,76,255,0.55)');
  gr.addColorStop(1, 'rgba(122,76,255,0)');
  g.fillStyle = gr;
  g.fillRect(-20, -20, 40, 40);
  g.rotate(phase * (TAU / 3));
  for (let i = 0; i < 3; i++) {
    g.rotate(TAU / 3);
    g.beginPath();
    g.arc(5, 0, 11, -0.4, 1.6);
    st(g, i === 0 ? '#c4a4ff' : '#8a5cff', 2.4);
  }
  g.fillStyle = '#05020a';
  circle(g, 0, 0, 5);
  g.fill();
  g.restore();
  g.fillStyle = '#d9c8ff';
  for (let i = 0; i < 3; i++) {
    const a = -phase * (TAU / 3) + (i * TAU) / 3;
    circle(g, 24 + Math.cos(a) * 15, 24 + Math.sin(a) * 15, 1.2);
    g.fill();
  }
  rr(g, 2.5, 2.5, 43, 43, 12);
  st(g, INK, 1.4);
}

function spikes(g: G, up: boolean): void {
  rr(g, 3, 3, 42, 42, 6);
  fl(g, '#8d929c');
  st(g);
  rr(g, 5, 5, 38, 38, 4);
  st(g, 'rgba(255,255,255,0.35)', 1);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = 12 + c * 12;
      const cy = 12 + r * 12;
      if (up) {
        poly(g, [cx - 4.2, cy + 3.5, cx, cy - 7, cx + 4.2, cy + 3.5]);
        fl(g, '#e3e7ee');
        poly(g, [cx, cy - 7, cx + 4.2, cy + 3.5, cx + 0.5, cy + 3.5]);
        fl(g, '#a4a9b3');
        poly(g, [cx - 4.2, cy + 3.5, cx, cy - 7, cx + 4.2, cy + 3.5]);
        st(g, INK, 1.1);
      } else {
        circle(g, cx, cy, 3);
        fl(g, '#3c3f48');
        g.fillStyle = '#c3c8d0';
        poly(g, [cx - 1.4, cy + 0.8, cx, cy - 1.6, cx + 1.4, cy + 0.8]);
        g.fill();
      }
    }
  }
  if (up) {
    rr(g, 3, 3, 42, 42, 6);
    st(g, '#e0453a', 1.8);
  }
}

function quicksand(g: G, phase: number): void {
  circle(g, 24, 24, 21);
  fl(g, '#c69b5a');
  st(g, rgba(INK, 0.5), 1.2);
  circle(g, 24, 24, 19);
  fl(g, '#e0bd78');
  g.save();
  g.translate(24, 24);
  g.rotate(phase * (TAU / 3));
  for (let i = 0; i < 3; i++) {
    g.rotate(TAU / 3);
    g.beginPath();
    g.arc(0, 0, 7 + i * 4, 0, Math.PI * 0.9);
    st(g, '#b38a48', 1.8);
  }
  g.fillStyle = '#8a6430';
  circle(g, 0, 0, 3.4);
  g.fill();
  g.restore();
}

function mud(g: G, phase: number): void {
  ell(g, 24, 25, 21, 19, 0.3);
  fl(g, '#5b412a');
  st(g, rgba(INK, 0.45), 1.2);
  ell(g, 23, 24, 19, 17, 0.3);
  fl(g, '#74563a');
  g.fillStyle = '#5f452d';
  circle(g, 16, 28, 6);
  g.fill();
  circle(g, 31, 18, 5);
  g.fill();
  bubble(g, 18, 20, frac(phase), '#8d6c48', '#b89670', 3.2);
  bubble(g, 30, 31, frac(phase + 0.5), '#8d6c48', '#b89670', 2.6);
}

function vine(g: G, phase: number): void {
  seg(g, [2, 30, 12, 22, 22, 28, 32, 16, 46, 20], '#2f6b22', 3.2);
  seg(g, [6, 46, 14, 36, 26, 40, 36, 32, 44, 38], '#2f6b22', 3);
  const sway = Math.sin(phase * TAU) * 0.25;
  for (const [lx, ly, a] of [
    [12, 22, -0.6],
    [22, 28, 0.8],
    [32, 16, -0.4],
    [14, 36, 0.5],
    [36, 32, -0.9],
    [26, 40, 0.3],
    [40, 16, -0.8],
  ]) {
    ell(g, lx, ly - 3, 4.2, 2.2, a + sway);
    fl(g, '#58b03a');
    st(g, INK, 0.9);
  }
}

function exitTile(g: G, phase: number): void {
  rr(g, 4, 4, 40, 40, 6);
  fl(g, '#6e6878');
  st(g);
  rr(g, 7, 7, 34, 34, 4);
  fl(g, '#7a5233');
  st(g, INK, 1.2);
  for (const y of [15, 24, 33]) seg(g, [9, y, 39, y], 'rgba(0,0,0,0.25)', 1.1);
  seg(g, [10, 9.5, 38, 9.5], 'rgba(255,255,255,0.25)', 1.1);
  g.fillStyle = '#d9b44a';
  circle(g, 34, 24, 2.4);
  g.fill();
  st(g, INK, 1);
  const bob = Math.sin(phase * TAU) * 2.5;
  poly(g, [
    24,
    32 + bob,
    16,
    22 + bob,
    21,
    22 + bob,
    21,
    14 + bob,
    27,
    14 + bob,
    27,
    22 + bob,
    32,
    22 + bob,
  ]);
  fl(g, '#6ae06a');
  st(g, INK, 1.3);
}

function goalTile(g: G, phase: number): void {
  ell(g, 24, 28, 17, 12);
  fl(g, 'rgba(40,20,40,0.22)');
  circle(g, 24, 25, 15);
  fl(g, '#c8bba0');
  st(g);
  const pulse = 0.5 + 0.5 * Math.sin(phase * TAU);
  const gr = g.createRadialGradient(24, 22, 0, 24, 22, 16);
  gr.addColorStop(0, rgba('#fff3b0', 0.55 + 0.3 * pulse));
  gr.addColorStop(1, 'rgba(255,220,90,0)');
  g.fillStyle = gr;
  circle(g, 24, 22, 16);
  g.fill();
  star(g, 24, 21, 5, 11 + pulse, 4.6);
  fl(g, '#ffd23f');
  st(g, INK, 1.4);
  star(g, 22.6, 19.6, 5, 5, 2);
  fl(g, 'rgba(255,255,255,0.45)');
  const k = frac(phase * 2);
  if (k < 0.5) {
    const s = Math.sin((k / 0.5) * Math.PI);
    g.fillStyle = '#ffffff';
    star(g, 35, 11, 4, 4.5 * s, 1 * s);
    g.fill();
  }
}

function switchTile(g: G, color: string, active: boolean): void {
  ell(g, 24, 27, 17, 14);
  fl(g, 'rgba(40,20,40,0.25)');
  circle(g, 24, 24, 16);
  fl(g, '#9aa1ad');
  st(g);
  circle(g, 24, 24, 12.5);
  fl(g, '#6b7280');
  if (active) {
    const gr = g.createRadialGradient(24, 25, 0, 24, 25, 16);
    gr.addColorStop(0, rgba(color, 0.9));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    circle(g, 24, 25, 16);
    g.fill();
    circle(g, 24, 25.5, 9);
    fl(g, shade(color, -0.25));
    st(g, INK, 1.2);
    circle(g, 24, 25.5, 6.5);
    fl(g, shade(color, 0.35));
    seg(g, [20.5, 22.5, 23, 21], 'rgba(255,255,255,0.8)', 1.4);
  } else {
    circle(g, 24, 25.5, 9.5);
    fl(g, shade(color, -0.45));
    circle(g, 24, 22.5, 9.5);
    fl(g, color);
    st(g, INK, 1.2);
    seg(g, [19.5, 18.5, 23, 16.6], 'rgba(255,255,255,0.7)', 1.6);
  }
}

function gateClosed(g: G, color: string): void {
  // raised like a block: two posts, a top beam and coloured bars
  rr(g, 1, -RAISE, 46, 48 + RAISE - 1, 6);
  fl(g, 'rgba(30,20,40,0.35)');
  const barTop = -RAISE + 7;
  for (let i = 0; i < 5; i++) {
    const bx = 9 + i * 7.5;
    rr(g, bx - 2.4, barTop, 4.8, 44 - barTop, 2.2);
    fl(g, shade(color, -0.1));
    st(g, INK, 1.1);
    seg(g, [bx - 0.8, barTop + 2, bx - 0.8, 40], rgba('#ffffff', 0.45), 1);
  }
  for (const px of [1, 41]) {
    rr(g, px, -RAISE, 6, 48 + RAISE - 1, 3);
    fl(g, '#7a7381');
    st(g, INK, 1.2);
  }
  rr(g, 1, -RAISE, 46, 9, 3);
  fl(g, shade(color, -0.35));
  st(g, INK, 1.3);
  seg(g, [4, -RAISE + 2, 44, -RAISE + 2], rgba('#ffffff', 0.4), 1.2);
  rr(g, 1, 38, 46, 8, 3);
  fl(g, '#5d5965');
  st(g, INK, 1.2);
  circle(g, 24, -RAISE + 4.5, 2.6);
  fl(g, shade(color, 0.4));
  st(g, INK, 1);
}

function gateOpen(g: G, color: string): void {
  rr(g, 1, 1, 46, 7, 3);
  fl(g, '#5d5965');
  st(g, INK, 1.1);
  for (let i = 0; i < 5; i++) {
    const bx = 9 + i * 7.5;
    rr(g, bx - 2.2, 1.5, 4.4, 5, 1.6);
    fl(g, rgba(color, 0.85));
  }
  for (let i = 0; i < 5; i++) {
    const bx = 9 + i * 7.5;
    seg(g, [bx, 12, bx, 44], 'rgba(30,20,40,0.22)', 1.2);
  }
  rr(g, 1, 40, 46, 7, 3);
  fl(g, 'rgba(70,64,80,0.55)');
}

function crumbling(g: G): void {
  g.fillStyle = 'rgba(30,20,20,0.22)';
  rr(g, 4, 4, 40, 40, 5);
  g.fill();
  const cracks = [
    [8, 6, 18, 20, 14, 34, 22, 44],
    [32, 4, 38, 16, 34, 28],
    [18, 20, 30, 22, 40, 36],
  ];
  for (const c of cracks) {
    seg(g, c, 'rgba(40,24,20,0.85)', 2.4);
    seg(
      g,
      c.map((n, i) => (i % 2 ? n + 1 : n)),
      'rgba(255,255,255,0.25)',
      0.8,
    );
  }
  // chunks already missing
  g.fillStyle = '#1b1524';
  poly(g, [36, 34, 42, 32, 44, 40, 38, 42]);
  g.fill();
  poly(g, [6, 38, 11, 40, 9, 45, 4, 44]);
  g.fill();
}

function pit(g: G): void {
  rr(g, 1, 1, 46, 46, 6);
  fl(g, '#3a3040');
  rr(g, 3, 3, 42, 42, 5);
  const gr = g.createLinearGradient(0, 3, 0, 45);
  gr.addColorStop(0, '#05030a');
  gr.addColorStop(0.5, '#120c18');
  gr.addColorStop(1, '#1d1526');
  g.fillStyle = gr;
  g.fill();
  rr(g, 3, 3, 42, 6, 3);
  fl(g, 'rgba(0,0,0,0.5)');
  rr(g, 1, 1, 46, 46, 6);
  st(g);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  for (const [x, y] of [
    [14, 30],
    [32, 22],
    [26, 38],
  ]) {
    circle(g, x, y, 0.8);
    g.fill();
  }
}

export function special(g: G, o: SpecialOpts): void {
  const ph = frac(o.phase);
  const t = o.tile;
  if (t.startsWith('gate_')) {
    const color = GATE_COLORS[t.split('_')[1]] ?? '#cccccc';
    if (t.endsWith('_open')) gateOpen(g, color);
    else gateClosed(g, color);
    return;
  }
  if (t.startsWith('switch_')) {
    const color = GATE_COLORS[t.split('_')[1]] ?? '#cccccc';
    switchTile(g, color, t.endsWith('_active'));
    return;
  }
  switch (t) {
    case 'teleporter_a':
    case 'teleporter_b':
      teleporter(g, ph, t === 'teleporter_b');
      return;
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
      conveyor(g, o.world, t.slice(9) as 'up' | 'down' | 'left' | 'right', ph);
      return;
    case 'lava':
      lava(g, ph);
      return;
    case 'ice':
      iceTile(g, ph);
      return;
    case 'dark_rift':
      rift(g, ph);
      return;
    case 'spikes':
      spikes(g, false);
      return;
    case 'spikes_active':
      spikes(g, true);
      return;
    case 'quicksand':
      quicksand(g, ph);
      return;
    case 'mud':
      mud(g, ph);
      return;
    case 'vine':
      vine(g, ph);
      return;
    case 'exit':
      exitTile(g, ph);
      return;
    case 'goal':
      goalTile(g, ph);
      return;
    case 'crumbling':
      crumbling(g);
      return;
    case 'pit':
      pit(g);
      return;
    default:
      // unknown tile types draw nothing on top of the floor
      return;
  }
}

/** Colours for crate splinters, per world and material. */
export function chunkColors(world: World, kind: 'crate' | 'cracked'): string[] {
  if (kind === 'cracked') return ['#a3acb7', '#6b7480', '#d6964f'];
  switch (world) {
    case 'forest':
      return ['#7b5331', '#e0bb83', '#553820'];
    case 'ice':
      return ['#c9f0ff', '#7fc8ee', '#ffffff'];
    case 'volcano':
      return ['#5e3d2c', '#2e1d15', '#ff7a2e'];
    case 'castle':
      return ['#93603a', '#5f3a1d', '#8e97a3'];
    case 'desert':
      return ['#d9784b', '#9c4528', '#fff0d2'];
    case 'void':
      return ['#5d5773', '#37324a', '#c08cff'];
    case 'swamp':
      return ['#7d7249', '#4f492d', '#c2c97a'];
    case 'sky':
      return ['#f3dcaa', '#c79f62', '#f0c25a'];
    default:
      return ['#d6964f', '#a2622b', '#f2c48a'];
  }
}

export { CREAM };
