/**
 * Crisp Pixel tiles: floors, walls, crates and special tiles, each a 16 x 16 art-pixel tile.
 * Blocks are not raised: a wall shows a top face and, when nothing stands below it, a darker
 * 4-pixel front face inside its own tile.
 */
import type { TileType } from '@blast-arena/shared';
import { shade } from '../../paint';
import type { World } from '../../painters/types';
import { MASK_S } from '../../painters/types';
import {
  OUT,
  WHITE,
  R,
  P,
  grid,
  gs,
  gg,
  outline,
  paintGrid,
  blobInto,
  dith,
  H,
  spr,
  put,
} from './pixelKit';
import type { Grid } from './pixelKit';

/* ================= floors ================= */

const SLATE = {
  a: '#2c2b42',
  b: '#29283e',
  hi: '#33324b',
  lo: '#222136',
  sp1: '#373653',
  sp2: '#1f1e31',
};

function floorPaint(g: CanvasRenderingContext2D, world: World, v: number, parity: number): void {
  const h = (i: number) => H(v, i, 77);
  switch (world) {
    case 'forest': {
      R(g, 0, 0, 16, 16, parity ? '#2c5124' : '#2e5527');
      for (let i = 0; i < 14; i++) {
        const x = (h(i) * 16) | 0;
        const y = (h(i + 40) * 15) | 0;
        R(g, x, y, 1, 2, i % 3 ? '#3d6e2f' : '#22421c');
      }
      if (v % 3 === 0)
        P(g, (h(90) * 14 + 1) | 0, (h(91) * 14 + 1) | 0, v % 2 ? '#f2d64a' : '#f08ab0');
      if (v === 4) R(g, 10, 11, 2, 1, '#6a6a5a');
      return;
    }
    case 'ice': {
      R(g, 0, 0, 16, 16, parity ? '#8fa9c8' : '#94aecd');
      R(g, 0, 0, 16, 1, '#a6bfdb');
      R(g, 0, 15, 16, 1, '#7d97b8');
      for (let i = 0; i < 8; i++)
        P(g, (h(i) * 16) | 0, (h(i + 30) * 16) | 0, i % 2 ? '#b2c8e2' : '#7f99ba');
      R(g, (h(60) * 10) | 0, 2 + ((h(61) * 12) | 0), 4, 1, '#a9c1dc');
      if (v % 2) P(g, (h(70) * 16) | 0, (h(71) * 16) | 0, '#e6f0fa');
      return;
    }
    case 'volcano': {
      R(g, 0, 0, 16, 16, parity ? '#1d1415' : '#201617');
      for (let i = 0; i < 7; i++)
        P(g, (h(i) * 16) | 0, (h(i + 30) * 16) | 0, i % 2 ? '#2e2020' : '#140d0e');
      if (v % 3 === 1) {
        const x = 3 + ((h(80) * 8) | 0);
        const y = 3 + ((h(81) * 8) | 0);
        R(g, x, y, 3, 1, '#5e2010');
        R(g, x + 2, y + 1, 2, 1, '#5e2010');
        P(g, x + 1, y, '#a8401a');
        P(g, x + 3, y + 1, '#c85020');
      }
      return;
    }
    case 'castle': {
      R(g, 0, 0, 16, 16, '#393942');
      const off = parity ? 4 : 0;
      const stones: [number, number, number, number][] = [
        [0, 0, 7, 7],
        [8, 0, 8, 7],
        [-off, 8, 7, 8],
        [8 - off, 8, 8, 8],
        [16 - off, 8, 8, 8],
      ];
      stones.forEach(([x, y, w, hh], i) => {
        const c = h(i) > 0.5 ? '#4c4c57' : '#51515d';
        R(g, x, y, w - 1, hh - 1, c);
        R(g, x, y, w - 1, 1, '#5d5d6b');
        R(g, x, y, 1, hh - 1, '#5a5a67');
        R(g, x + w - 2, y + 1, 1, hh - 2, '#44444e');
      });
      if (v % 2) P(g, (h(50) * 14) | 0, (h(51) * 14) | 0, '#62626f');
      return;
    }
    case 'desert': {
      R(g, 0, 0, 16, 16, parity ? '#d6ad66' : '#d9b16b');
      // ripples with a period that divides the tile, so they run on across tiles
      for (const row of [3, 8, 13]) {
        for (let x = 0; x < 16; x++) {
          const y = row + Math.round(Math.sin((x / 16) * Math.PI * 2) * 1.2);
          P(g, x, y, '#e6c486');
          if (x % 2 === 0) P(g, x, y + 1, '#bf964f');
        }
      }
      for (let i = 0; i < 3; i++)
        P(g, (h(i) * 16) | 0, (h(i + 20) * 16) | 0, i % 2 ? '#f2dcaa' : '#a8804a');
      if (v === 3) R(g, (h(40) * 12 + 2) | 0, (h(41) * 12 + 2) | 0, 2, 1, '#8a6a3e');
      return;
    }
    case 'void': {
      R(g, 0, 0, 16, 16, parity ? '#130c24' : '#110a20');
      R(g, 0, 0, 16, 1, '#1d1434');
      R(g, 0, 0, 1, 16, '#1d1434');
      for (let i = 0; i < 4; i++)
        P(g, 1 + ((h(i) * 14) | 0), 1 + ((h(i + 10) * 14) | 0), '#4a3a7a');
      if (v % 2) P(g, 2 + ((h(30) * 12) | 0), 2 + ((h(31) * 12) | 0), '#e8dcff');
      if (v % 4 === 0) {
        const x = 3 + ((h(50) * 10) | 0);
        const y = 3 + ((h(51) * 10) | 0);
        P(g, x, y, '#c8b8ff');
        P(g, x - 1, y, '#5e4a9a');
        P(g, x + 1, y, '#5e4a9a');
        P(g, x, y - 1, '#5e4a9a');
        P(g, x, y + 1, '#5e4a9a');
      }
      if (v === 5) {
        for (let y = 5; y < 11; y++) {
          for (let x = 4; x < 12; x++)
            if (dith(x, y) > 0.1 && H(x, y, 9) > 0.4) P(g, x, y, '#24183e');
        }
      }
      return;
    }
    case 'swamp': {
      R(g, 0, 0, 16, 16, parity ? '#2b3a25' : '#2d3d27');
      for (let i = 0; i < 10; i++)
        P(g, (h(i) * 16) | 0, (h(i + 30) * 16) | 0, i % 2 ? '#3d5a2e' : '#22301d');
      if (v % 3 === 0) {
        const x = 2 + ((h(60) * 8) | 0);
        const y = 3 + ((h(61) * 9) | 0);
        R(g, x + 1, y, 3, 1, '#1e2c2c');
        R(g, x, y + 1, 5, 1, '#1e2c2c');
        R(g, x + 1, y + 2, 3, 1, '#1e2c2c');
        P(g, x + 1, y + 1, '#4a6a6a');
      }
      if (v === 6) {
        R(g, 11, 6, 1, 3, '#5a7a3a');
        P(g, 11, 5, '#8aa04a');
        R(g, 13, 7, 1, 2, '#5a7a3a');
      }
      return;
    }
    case 'sky': {
      R(g, 0, 0, 16, 16, parity ? '#bcd9f0' : '#b6d4ee');
      R(g, 0, 0, 16, 1, '#d6eafa');
      R(g, 0, 0, 1, 16, '#d6eafa');
      R(g, 0, 15, 16, 1, '#9cbce0');
      R(g, 15, 0, 1, 16, '#9cbce0');
      if (v % 2) {
        const x = 2 + ((h(10) * 9) | 0);
        const y = 3 + ((h(11) * 9) | 0);
        R(g, x, y + 1, 4, 1, '#eaf5ff');
        R(g, x + 1, y, 2, 1, '#eaf5ff');
      }
      if (v === 4) P(g, 3 + ((h(20) * 10) | 0), 3 + ((h(21) * 10) | 0), WHITE);
      return;
    }
    default: {
      R(g, 0, 0, 16, 16, parity ? SLATE.a : SLATE.b);
      R(g, 0, 0, 16, 1, SLATE.hi);
      R(g, 0, 0, 1, 16, SLATE.hi);
      R(g, 0, 15, 16, 1, SLATE.lo);
      R(g, 15, 0, 1, 16, SLATE.lo);
      for (let i = 0; i < 4; i++) {
        P(g, 2 + ((h(i) * 12) | 0), 2 + ((h(i + 20) * 12) | 0), i % 2 ? SLATE.sp1 : SLATE.sp2);
      }
      if (v === 2) {
        R(g, 4, 9, 3, 1, SLATE.lo);
        R(g, 7, 10, 2, 1, SLATE.lo);
      }
      if (v === 5) R(g, 10, 4, 2, 2, SLATE.sp1);
    }
  }
}

export function floorTile(
  g: CanvasRenderingContext2D,
  world: World,
  variant: number,
  parity: number,
): void {
  put(
    g,
    spr(`fl:${world}:${variant}:${parity}`, 16, 16, (c) => floorPaint(c, world, variant, parity)),
    0,
    0,
  );
}

/** The shadow one block casts below and to the right of its tile. */
export function blockShadowTile(g: CanvasRenderingContext2D): void {
  R(g, 0, 16, 16, 1, 'rgba(6,4,12,0.5)');
  g.fillStyle = 'rgba(6,4,12,0.3)';
  for (let i = 0; i < 16; i += 2) g.fillRect(i, 17, 1, 1);
  g.fillStyle = 'rgba(6,4,12,0.32)';
  g.fillRect(16, 1, 1, 16);
  g.fillStyle = 'rgba(6,4,12,0.18)';
  for (let i = 2; i < 17; i += 2) g.fillRect(17, i, 1, 1);
}

/* ================= walls ================= */

function wallPaint(g: CanvasRenderingContext2D, world: World, front: boolean, v: number): void {
  const th = front ? 12 : 16;
  const h = (i: number) => H(v, i, 31);
  switch (world) {
    case 'forest': {
      R(g, 0, 0, 16, th, '#737b6e');
      R(g, 0, 0, 16, 1, '#959d8e');
      R(g, 0, 0, 1, th, '#868e80');
      R(g, 15, 0, 1, th, '#596056');
      if (front) R(g, 0, 11, 16, 1, '#596056');
      R(g, 3, 3, 9, 6, '#7d8577');
      R(g, 3, 3, 9, 1, '#8f9789');
      for (let i = 0; i < 16; i++) {
        if (h(i) < 0.55) P(g, i, (h(i + 30) * 3) | 0, i % 2 ? '#4f8a3a' : '#6fae4a');
        if (h(i + 60) < 0.25) P(g, (h(i + 90) * 16) | 0, 2 + ((h(i + 120) * 8) | 0), '#4f8a3a');
      }
      if (front) {
        R(g, 0, 12, 16, 4, '#454b42');
        R(g, 0, 15, 16, 1, '#2a2f28');
        R(g, 7, 13, 1, 2, '#30352e');
        for (let i = 0; i < 5; i++)
          R(g, (h(i + 150) * 16) | 0, 12, 1, 1 + ((h(i + 170) * 3) | 0), '#4f8a3a');
      }
      return;
    }
    case 'ice': {
      R(g, 0, 0, 16, th, '#e6f0fa');
      R(g, 0, 0, 16, 1, WHITE);
      R(g, 15, 0, 1, th, '#bcd2ea');
      if (front) R(g, 0, 10, 16, 2, '#c9dcf0');
      for (let i = 0; i < 5; i++)
        P(g, 1 + ((h(i) * 14) | 0), 1 + ((h(i + 9) * 8) | 0), i % 2 ? '#d2e3f4' : WHITE);
      if (front) {
        R(g, 0, 12, 16, 4, '#7cb4dc');
        R(g, 0, 13, 16, 1, '#5b90bc');
        P(g, 4, 12, '#5b90bc');
        P(g, 12, 12, '#5b90bc');
        P(g, 8, 14, '#5b90bc');
        R(g, 0, 15, 16, 1, '#3f6f9a');
        P(g, 2, 14, '#d6f0ff');
        P(g, 10, 12, '#d6f0ff');
        for (let i = 0; i < 16; i++) if (h(i + 40) < 0.4) P(g, i, 12, '#e6f0fa');
      } else {
        R(g, 0, 15, 16, 1, '#bcd2ea');
      }
      return;
    }
    case 'volcano': {
      R(g, 0, 0, 16, th, '#5e4a48');
      R(g, 0, 0, 16, 1, '#7e6662');
      R(g, 0, 0, 1, th, '#6e5854');
      R(g, 15, 0, 1, th, '#40302f');
      R(g, 8, 1, 1, th - 2, '#463634');
      R(g, 1, 6, 7, 1, '#463634');
      R(g, 9, 4, 6, 1, '#463634');
      P(g, 3, 2, '#7a625e');
      P(g, 11, 8, '#7a625e');
      if (front) {
        R(g, 0, 11, 16, 1, '#382a2a');
        R(g, 0, 12, 16, 4, '#2e2222');
        R(g, 0, 15, 16, 1, '#1a1212');
        const x = 3 + ((h(5) * 9) | 0);
        R(g, x, 12, 1, 3, '#ff6a2a');
        P(g, x, 13, '#ffb347');
        P(g, x + 1, 14, '#c8401a');
      } else if (v % 2) {
        P(g, 4, 10, '#c8401a');
        P(g, 5, 10, '#ff6a2a');
      }
      return;
    }
    case 'castle': {
      R(g, 0, 0, 16, th, '#8b8b98');
      const mort = '#5e5e6a';
      for (let r = 0; r < th; r += 4) {
        R(g, 0, r + 3, 16, 1, mort);
        const off = (r / 4) % 2 ? 4 : 0;
        for (let x = off; x < 16; x += 8) R(g, x, r, 1, 3, mort);
        R(g, 0, r, 16, 1, (r / 4) % 2 ? '#9a9aa8' : '#a3a3b0');
      }
      if (v === 2) {
        P(g, 10, 5, '#6a6a76');
        P(g, 11, 6, '#6a6a76');
      }
      if (front) {
        R(g, 0, 11, 16, 1, '#5e5e6a');
        R(g, 0, 12, 16, 4, '#6e6e7c');
        R(g, 0, 13, 16, 1, '#4a4a56');
        P(g, 5, 12, '#4a4a56');
        P(g, 13, 12, '#4a4a56');
        P(g, 9, 14, '#4a4a56');
        R(g, 0, 15, 16, 1, '#33333c');
      }
      return;
    }
    case 'desert': {
      R(g, 0, 0, 16, th, '#d4a65a');
      for (let r = 0; r < th; r += 4) {
        R(g, 0, r, 16, 1, (r / 4) % 2 ? '#dcb066' : '#e6bf76');
        if (r + 3 < th) R(g, 0, r + 3, 16, 1, '#b0823e');
        const off = (r / 4) % 2 ? 5 : 0;
        for (let x = off; x < 16; x += 10) R(g, x, r + 1, 1, 2, '#b0823e');
      }
      R(g, 0, 0, 1, th, '#e0b46a');
      R(g, 15, 0, 1, th, '#a87a38');
      if (v === 1) {
        // a carved glyph
        P(g, 6, 5, '#9a6e34');
        P(g, 7, 6, '#9a6e34');
        P(g, 8, 5, '#9a6e34');
        P(g, 7, 7, '#9a6e34');
      }
      for (let i = 0; i < 3; i++) P(g, 1 + ((h(i) * 14) | 0), 1 + ((h(i + 5) * 9) | 0), '#f0cc8a');
      if (front) {
        R(g, 0, 11, 16, 1, '#a87a38');
        R(g, 0, 12, 16, 4, '#b07c3c');
        R(g, 0, 13, 16, 1, '#8a5e2a');
        P(g, 6, 14, '#8a5e2a');
        P(g, 12, 12, '#8a5e2a');
        R(g, 0, 15, 16, 1, '#6a4620');
      }
      return;
    }
    case 'void': {
      R(g, 0, 0, 16, th, '#2e1c50');
      // crystal bricks: each a lit face with a bright top-left facet
      for (let r = 0; r + 3 <= th; r += 4) {
        const off = (r / 4) % 2 ? 4 : 0;
        for (let x = -off; x < 16; x += 8) {
          const x0 = Math.max(0, x);
          const w = Math.min(16, x + 7) - x0;
          if (w <= 0) continue;
          R(g, x0, r, w, 3, '#553688');
          R(g, x0, r, w, 1, '#6e4ab0');
          P(g, x0, r, '#9a78e0');
          if (w > 2) P(g, x0 + w - 1, r + 2, '#3e2668');
        }
      }
      R(g, 0, 0, 16, 1, '#9a78e0');
      R(g, 0, 0, 1, th, '#6e4ab0');
      R(g, 15, 0, 1, th, '#33205a');
      if (v % 2) {
        P(g, 8, 5, '#e0c8ff');
        P(g, 7, 5, '#8a5ae0');
        P(g, 9, 5, '#8a5ae0');
        P(g, 8, 4, '#8a5ae0');
        P(g, 8, 6, '#8a5ae0');
      } else {
        P(g, 5, 6, '#c8a8ff');
        P(g, 11, 4, '#c8a8ff');
      }
      if (front) {
        R(g, 0, 11, 16, 1, '#2a1848');
        R(g, 0, 12, 16, 4, '#3a2264');
        R(g, 0, 13, 16, 1, '#2a1848');
        P(g, 4 + ((h(7) * 8) | 0), 14, '#b090ff');
        R(g, 0, 15, 16, 1, '#160c2a');
      } else {
        R(g, 0, 15, 16, 1, '#33205a');
      }
      return;
    }
    case 'swamp': {
      R(g, 0, 0, 16, th, '#5a6454');
      R(g, 0, 0, 16, 1, '#7a8672');
      R(g, 0, 0, 1, th, '#6a7462');
      R(g, 15, 0, 1, th, '#424a3e');
      R(g, 3, 3, 10, 6, '#626c5a');
      R(g, 3, 3, 10, 1, '#727c68');
      R(g, 3, 8, 10, 1, '#4a5244');
      for (let i = 0; i < 16; i++) {
        if (h(i) < 0.6) P(g, i, (h(i + 30) * 2) | 0, i % 2 ? '#4f7a3a' : '#6a9a48');
        if (h(i + 50) < 0.18) R(g, i, 1, 1, 2 + ((h(i + 70) * 4) | 0), '#4f7a3a');
      }
      P(g, 5, 5, '#a8c0c0');
      P(g, 11, 7, '#a8c0c0');
      if (front) {
        R(g, 0, 11, 16, 1, '#3a4236');
        R(g, 0, 12, 16, 4, '#3e463a');
        for (let i = 0; i < 4; i++) {
          const x = (h(i + 90) * 15) | 0;
          R(g, x, 12, 1, 1 + ((h(i + 95) * 3) | 0), '#5a8a7a');
        }
        R(g, 0, 15, 16, 1, '#22281e');
      }
      return;
    }
    case 'sky': {
      R(g, 0, 0, 16, th, '#f2f6fc');
      for (let r = 0; r < th; r += 4) {
        if (r + 3 < th) R(g, 0, r + 3, 16, 1, '#c8d6ec');
        const off = (r / 4) % 2 ? 4 : 0;
        for (let x = off; x < 16; x += 8) R(g, x, r, 1, 3, '#d6e2f2');
      }
      R(g, 0, 0, 16, 1, WHITE);
      R(g, 0, 0, 1, th, WHITE);
      R(g, 15, 0, 1, th, '#d0dcef');
      if (v % 2) {
        P(g, 6, 5, '#ffe9a8');
        P(g, 6, 6, '#f6d27a');
      }
      if (front) {
        R(g, 0, 11, 16, 1, '#b0c2e0');
        R(g, 0, 12, 16, 4, '#c4d4ec');
        R(g, 0, 13, 16, 1, '#a8bcdc');
        P(g, 7, 14, '#a8bcdc');
        R(g, 0, 15, 16, 1, '#8aa0c8');
      }
      return;
    }
    default: {
      R(g, 0, 0, 16, th, '#625f8a');
      R(g, 0, 0, 16, 1, '#8c89b4');
      R(g, 0, 0, 1, th, '#77749f');
      R(g, 15, 0, 1, th, '#4c4a70');
      if (front) R(g, 0, 11, 16, 1, '#4c4a70');
      R(g, 3, 3, 10, 6, '#6e6b98');
      R(g, 3, 3, 10, 1, '#8582ad');
      R(g, 3, 3, 1, 6, '#7d7aa6');
      R(g, 3, 8, 10, 1, '#55527c');
      R(g, 12, 3, 1, 6, '#55527c');
      for (let i = 0; i < 3; i++) {
        P(g, 1 + ((h(i) * 14) | 0), 1 + ((h(i + 7) * 9) | 0), i % 2 ? '#6e6b98' : '#57547e');
      }
      if (front) {
        R(g, 0, 12, 16, 4, '#3d3a5c');
        R(g, 0, 12, 16, 1, '#4a4770');
        R(g, 7, 13, 1, 2, '#2c2a44');
        R(g, 0, 15, 16, 1, '#1e1c30');
        P(g, 3, 13, '#4a4770');
        P(g, 11, 14, '#33304e');
      } else {
        R(g, 0, 15, 16, 1, '#4c4a70');
      }
    }
  }
}

export function wallTile(
  g: CanvasRenderingContext2D,
  world: World,
  mask: number,
  border: boolean,
  variant: number,
): void {
  const front = !(mask & MASK_S);
  const v = variant & 3;
  put(
    g,
    spr(`wl:${world}:${v}:${front ? 1 : 0}`, 16, 16, (c) => wallPaint(c, world, front, v)),
    0,
    0,
  );
  if (border) {
    // the outer ring reads a touch heavier than the inner pillars
    g.fillStyle = 'rgba(6,4,12,0.18)';
    g.fillRect(0, front ? 11 : 15, 16, 1);
  }
}

/* ================= crates ================= */

const WOOD = {
  hi: '#e2b06e',
  lt: '#c8904e',
  md: '#b07a40',
  dk: '#7e5028',
  dd: '#5a361a',
  fr: '#7a4c24',
  fr2: '#8e5a2c',
  btm: '#3a2210',
};

interface WoodPal {
  hi: string;
  lt: string;
  md: string;
  dk: string;
  dd: string;
  fr: string;
  fr2: string;
  btm: string;
}

/** A plank crate with a front face (classic, swamp and sky use it with their own wood). */
function plankCrate(
  g: CanvasRenderingContext2D,
  w: WoodPal,
  cracked: boolean,
  v: number,
  crackInk: string,
): void {
  const th = 12;
  R(g, 0, 0, 16, th, w.md);
  R(g, 0, 0, 16, 1, w.dk);
  R(g, 0, 0, 1, th, w.dk);
  R(g, 15, 0, 1, th, w.dd);
  R(g, 0, th - 1, 16, 1, w.dd);
  R(g, 1, 1, 14, 1, w.hi);
  R(g, 1, 1, 1, th - 2, w.lt);
  for (const y of [4, 8]) {
    R(g, 2, y, 12, 1, w.dk);
    R(g, 2, y + 1, 12, 1, w.lt);
  }
  for (const [x, y] of [
    [2, 2],
    [13, 2],
    [2, th - 3],
    [13, th - 3],
  ]) {
    P(g, x, y, '#ecdcb4');
  }
  if (v) P(g, 10, 6, w.dk);
  R(g, 0, 12, 16, 4, w.fr);
  R(g, 0, 12, 16, 1, w.fr2);
  R(g, 5, 13, 1, 2, w.dd);
  R(g, 10, 13, 1, 2, w.dd);
  R(g, 0, 15, 16, 1, w.btm);
  if (cracked) {
    for (const [x, y] of [
      [3, 1],
      [4, 2],
      [5, 3],
      [5, 4],
      [6, 5],
      [8, 6],
      [9, 7],
      [9, 8],
      [10, 9],
      [11, 3],
      [12, 4],
      [12, 5],
      [4, 8],
      [3, 9],
    ]) {
      P(g, x, y, crackInk);
    }
    for (const [x, y] of [
      [6, 4],
      [10, 8],
      [13, 5],
    ]) {
      P(g, x, y, w.hi);
    }
    P(g, 14, 1, '#1a1424');
    P(g, 9, 13, crackInk);
  }
}

function logCrate(g: CanvasRenderingContext2D, cracked: boolean, v: number): void {
  const th = 12;
  const logs: [number, number][] = [
    [0, 5],
    [5, 6],
    [11, 5],
  ];
  for (const [x0, w] of logs) {
    R(g, x0, 0, w, th, '#6e4a2a');
    R(g, x0, 0, 1, th, '#2e1c0e');
    R(g, x0 + 1, 0, 1, th, '#8e643a');
    for (let y = 2; y < th; y += 3) P(g, x0 + 2 + ((y + v) % 2), y, '#4e321c');
    R(g, x0, 0, w, 1, '#9a6e42');
  }
  R(g, 15, 0, 1, th, '#2e1c0e');
  R(g, 0, 11, 16, 1, '#3e2814');
  for (const [x0, w] of logs) {
    R(g, x0 + 1, 12, w - 2, 1, '#4e321c');
    R(g, x0, 13, w, 2, '#4e321c');
    R(g, x0 + 1, 13, w - 2, 2, '#d4a868');
    P(g, x0 + (w >> 1), 13, '#a8783e');
    P(g, x0 + (w >> 1), 14, '#8a5a2a');
    R(g, x0 + 1, 15, w - 2, 1, '#2e1c0e');
    P(g, x0, 15, '#1e120a');
    P(g, x0 + w - 1, 15, '#1e120a');
  }
  if (cracked) {
    for (const [x, y] of [
      [7, 1],
      [7, 2],
      [8, 3],
      [8, 4],
      [7, 5],
      [8, 6],
      [9, 7],
      [8, 8],
      [8, 9],
      [3, 4],
      [2, 5],
      [13, 6],
      [12, 7],
    ]) {
      P(g, x, y, '#1e120a');
    }
    P(g, 9, 3, '#d4a868');
  }
}

function iceCrate(g: CanvasRenderingContext2D, cracked: boolean, v: number): void {
  const th = 12;
  R(g, 0, 0, 16, th, '#a6dcf4');
  R(g, 0, 0, 16, 1, '#e8f8ff');
  R(g, 0, 0, 1, th, '#d0eefc');
  R(g, 15, 0, 1, th, '#7fbfe6');
  R(g, 0, 11, 16, 1, '#7fbfe6');
  R(g, 4, 3, 8, 6, '#7fbfe6');
  R(g, 5, 4, 6, 4, '#6aaedc');
  R(g, 5, 4, 6, 1, '#8ccbec');
  for (const [x, y] of [
    [2, 2],
    [3, 3],
    [2, 3],
    [12, 9],
    [13, 8],
  ]) {
    P(g, x, y, WHITE);
  }
  if (v) P(g, 8, 6, '#b8e4f8');
  R(g, 0, 12, 16, 4, '#6aaedc');
  R(g, 0, 12, 16, 1, '#8ccbec');
  R(g, 0, 15, 16, 1, '#3f7fb2');
  P(g, 3, 13, WHITE);
  P(g, 4, 14, '#d0eefc');
  if (cracked) {
    for (const [x, y] of [
      [3, 1],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 5],
      [8, 6],
      [10, 7],
      [11, 8],
      [12, 2],
      [11, 3],
    ]) {
      P(g, x, y, WHITE);
    }
    P(g, 9, 13, WHITE);
  }
}

function charredCrate(g: CanvasRenderingContext2D, cracked: boolean, v: number): void {
  const th = 12;
  R(g, 0, 0, 16, th, '#4e3426');
  R(g, 0, 0, 16, 1, '#6a4a38');
  R(g, 0, 0, 1, th, '#5e4030');
  R(g, 15, 0, 1, th, '#2a1c14');
  R(g, 1, 4, 14, 1, '#3a261c');
  R(g, 1, 8, 14, 1, '#3a261c');
  for (const [x, y] of [
    [3, 2],
    [11, 6],
    [6, 9],
  ]) {
    P(g, x, y, '#1e1410');
    P(g, x + 1, y, '#1e1410');
  }
  P(g, 12, 2, '#ff7a2a');
  P(g, 4, 6, '#ffb347');
  P(g, v ? 10 : 9, 10, '#ff7a2a');
  P(g, 2, 9, '#6a5a52');
  R(g, 0, 11, 16, 1, '#2a1c14');
  R(g, 0, 12, 16, 4, '#3a261c');
  R(g, 5, 12, 1, 4, '#2a1c14');
  R(g, 10, 12, 1, 4, '#2a1c14');
  R(g, 0, 15, 16, 1, '#160e0a');
  P(g, 7, 13, '#ff7a2a');
  if (cracked) {
    for (const [x, y] of [
      [4, 1],
      [5, 2],
      [5, 3],
      [6, 5],
      [8, 6],
      [9, 7],
      [10, 9],
      [12, 3],
      [13, 4],
    ]) {
      P(g, x, y, '#ff7a2a');
    }
    P(g, 8, 14, '#ffb347');
  }
}

/** A round-bellied container painted into a grid (castle barrel, desert pot). */
function barrelGrid(cracked: boolean, v: number): Grid {
  const gr = grid(16, 16);
  const wood = '#b07c48';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8;
      const topD = (dx * dx) / 42 + ((y + 0.5 - 6) * (y + 0.5 - 6)) / 30;
      const inTop = y <= 11 && topD <= 1;
      const inSide = y >= 6 && y <= 14 && Math.abs(dx) <= 6.4 - (y > 12 ? 1 : 0);
      if (inSide) gs(gr, x, y, y === 9 || y === 13 ? '#8a8a96' : dx > 3 ? '#7a4c24' : '#8e5a2c');
      if (inTop) gs(gr, x, y, topD > 0.62 ? '#5e3a1e' : x === 6 || x === 10 ? '#8a5a30' : wood);
    }
  }
  gs(gr, 4, 4, '#d8a46a');
  gs(gr, 5, 3, '#d8a46a');
  if (v) gs(gr, 9, 5, '#9a6838');
  if (cracked) {
    for (const [x, y] of [
      [5, 5],
      [6, 6],
      [7, 6],
      [8, 7],
      [9, 8],
      [10, 10],
      [4, 8],
      [11, 4],
      [9, 12],
    ]) {
      gs(gr, x, y, '#2a1608');
    }
  }
  outline(gr);
  return gr;
}

function potGrid(cracked: boolean, v: number): Grid {
  const gr = grid(16, 16);
  const clay = ['#f0b878', '#d89058', '#c07040', '#8a4a28', '#5e301a'];
  blobInto(gr, 8, 10, 6.4, 5.6, clay);
  // neck and rim
  for (let x = 5; x <= 10; x++) {
    gs(gr, x, 4, x < 7 ? '#c07040' : '#b06a3a');
    gs(gr, x, 3, x < 7 ? '#c07040' : '#b06a3a');
  }
  for (let x = 4; x <= 11; x++) gs(gr, x, 2, x < 6 ? '#f0b878' : '#e0a068');
  for (let x = 5; x <= 10; x++) gs(gr, x, 2, '#5e301a');
  gs(gr, 4, 2, '#e0a068');
  gs(gr, 11, 2, '#b06a3a');
  // painted band
  for (let x = 3; x <= 12; x++) if (gg(gr, x, 9)) gs(gr, x, 9, (x + v) % 2 ? '#6a3a1e' : '#f0d0a0');
  gs(gr, 5, 7, '#fbd8a6');
  if (cracked) {
    for (const [x, y] of [
      [9, 5],
      [9, 6],
      [8, 7],
      [9, 8],
      [10, 10],
      [11, 11],
      [6, 11],
      [5, 12],
    ]) {
      gs(gr, x, y, '#3a1e10');
    }
  }
  outline(gr);
  return gr;
}

function runeCrate(g: CanvasRenderingContext2D, cracked: boolean, v: number): void {
  R(g, 0, 0, 16, 12, '#2e1e4a');
  R(g, 0, 0, 16, 1, '#4a3270');
  R(g, 0, 0, 1, 12, '#3e2a62');
  R(g, 15, 0, 1, 12, '#1a1030');
  R(g, 0, 11, 16, 1, '#1a1030');
  R(g, 3, 2, 10, 8, '#3a2660');
  R(g, 3, 2, 10, 1, '#4c3478');
  const glyph = v
    ? ['.#.#.', '#####', '.#.#.', '..#..', '.###.']
    : ['..#..', '.###.', '#.#.#', '..#..', '.#.#.'];
  glyph.forEach((row, y) => {
    for (let x = 0; x < 5; x++) {
      if (row[x] === '#') P(g, 5 + x + 1, 3 + y + 1, '#7a52d8');
    }
  });
  glyph.forEach((row, y) => {
    for (let x = 0; x < 5; x++) {
      if (row[x] === '#') P(g, 5 + x, 3 + y, '#c8a8ff');
    }
  });
  R(g, 0, 12, 16, 4, '#24163e');
  R(g, 0, 12, 16, 1, '#2e1e4a');
  P(g, 7, 13, '#9a78e0');
  P(g, 8, 13, '#9a78e0');
  R(g, 0, 15, 16, 1, '#120a20');
  if (cracked) {
    for (const [x, y] of [
      [2, 1],
      [3, 2],
      [3, 3],
      [4, 4],
      [11, 6],
      [12, 7],
      [12, 8],
      [13, 9],
      [6, 9],
    ]) {
      P(g, x, y, '#e0c8ff');
    }
    P(g, 10, 14, '#e0c8ff');
  }
}

const SWAMP_WOOD: WoodPal = {
  hi: '#9a9a6a',
  lt: '#7a7a52',
  md: '#6a6a48',
  dk: '#4a4a30',
  dd: '#3a3a24',
  fr: '#4e4e34',
  fr2: '#5a5a3c',
  btm: '#2a2a1a',
};
const SKY_WOOD: WoodPal = {
  hi: '#fff4d8',
  lt: '#f4e2bc',
  md: '#e8d4a8',
  dk: '#c4a878',
  dd: '#a88c5c',
  fr: '#d0b888',
  fr2: '#dcc498',
  btm: '#a08860',
};

function swampCrate(g: CanvasRenderingContext2D, cracked: boolean, v: number): void {
  plankCrate(g, SWAMP_WOOD, cracked, v, '#1e1e10');
  for (const [x, y] of [
    [1, 2],
    [2, 1],
    [3, 1],
    [14, 9],
    [13, 10],
    [1, 10],
  ]) {
    P(g, x, y, '#4f7a3a');
  }
  // fungus caps
  P(g, 12, 2, '#d8b888');
  P(g, 13, 2, '#c8a87a');
  P(g, 12, 3, '#8a7050');
  if (v) {
    P(g, 3, 13, '#d8b888');
    P(g, 4, 13, '#c8a87a');
  }
}

function skyCrate(g: CanvasRenderingContext2D, cracked: boolean, v: number): void {
  plankCrate(g, SKY_WOOD, cracked, v, '#7a6040');
  R(g, 6, 0, 4, 12, '#8ab0e0');
  R(g, 6, 0, 1, 12, '#b8d4f4');
  R(g, 9, 0, 1, 12, '#6a8cc0');
  R(g, 6, 12, 4, 3, '#7a9cd0');
  R(g, 6, 15, 4, 1, '#4a6aa0');
}

export function crateTile(
  g: CanvasRenderingContext2D,
  world: World,
  cracked: boolean,
  variant: number,
): void {
  const v = variant & 1;
  put(
    g,
    spr(`cr:${world}:${cracked ? 1 : 0}:${v}`, 16, 16, (c) => {
      switch (world) {
        case 'forest':
          return logCrate(c, cracked, v);
        case 'ice':
          return iceCrate(c, cracked, v);
        case 'volcano':
          return charredCrate(c, cracked, v);
        case 'castle':
          return paintGrid(c, barrelGrid(cracked, v));
        case 'desert':
          return paintGrid(c, potGrid(cracked, v));
        case 'void':
          return runeCrate(c, cracked, v);
        case 'swamp':
          return swampCrate(c, cracked, v);
        case 'sky':
          return skyCrate(c, cracked, v);
        default:
          return plankCrate(c, WOOD, cracked, v, '#2a1608');
      }
    }),
    0,
    0,
  );
}

/** Debris colours per world and material. */
export function chunkColors(world: World, cracked: boolean): [string, string, string] {
  const base: Record<World, [string, string, string]> = {
    classic: ['#c8904e', '#8e5a2c', '#e2b06e'],
    forest: ['#6e4a2a', '#d4a868', '#4e321c'],
    desert: ['#d89058', '#f0b878', '#8a4a28'],
    ice: ['#b8e4f8', '#7fbfe6', '#e8f8ff'],
    volcano: ['#4e3426', '#2a1c14', '#ff7a2a'],
    void: ['#3a2660', '#c8a8ff', '#1a1030'],
    castle: ['#b07c48', '#5e3a1e', '#8a8a96'],
    swamp: ['#6a6a48', '#4f7a3a', '#4a4a30'],
    sky: ['#e8d4a8', '#8ab0e0', '#c4a878'],
  };
  const c = base[world] ?? base.classic;
  return cracked ? [shade(c[0], -0.2), shade(c[1], -0.2), shade(c[2], -0.25)] : c;
}

/* ================= special tiles ================= */

const PUZZLE: Record<string, string> = {
  red: '#e04646',
  blue: '#4a7aff',
  green: '#3ec060',
  yellow: '#f0c040',
};

function colorOfTile(tile: string): string {
  const name = tile.split('_')[1];
  return PUZZLE[name] ?? '#cccccc';
}

function teleporterPaint(
  g: CanvasRenderingContext2D,
  world: World,
  pair: 'a' | 'b',
  f: number,
): void {
  floorTile(g, world, 0, 0);
  const col = pair === 'b' ? '#ff9a4a' : '#4ab8ff';
  const dk = shade(col, -0.55);
  const pad = grid(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (r <= 6.9) gs(pad, x, y, r > 5.6 ? '#3a3a52' : r > 3.2 ? '#22222e' : r > 1.6 ? dk : col);
    }
  }
  outline(pad);
  paintGrid(g, pad);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.round(7.5 + Math.cos(a) * 4.6 - 0.5);
    const y = Math.round(7.5 + Math.sin(a) * 4.6 - 0.5);
    const k = (i - f + 8) % 8;
    P(g, x, y, k === 0 ? WHITE : k < 3 ? col : dk);
  }
}

function conveyorPaint(g: CanvasRenderingContext2D, dir: string, f: number): void {
  R(g, 0, 0, 16, 16, '#2a2938');
  const hor = dir === 'left' || dir === 'right';
  if (hor) {
    R(g, 0, 0, 16, 2, '#4a4960');
    R(g, 0, 14, 16, 2, '#4a4960');
    R(g, 0, 1, 16, 1, '#35344a');
    R(g, 0, 15, 16, 1, '#1e1d2a');
  } else {
    R(g, 0, 0, 2, 16, '#4a4960');
    R(g, 14, 0, 2, 16, '#4a4960');
    R(g, 1, 0, 1, 16, '#35344a');
    R(g, 15, 0, 1, 16, '#1e1d2a');
  }
  const sign = dir === 'right' || dir === 'down' ? 1 : -1;
  for (let k = -8; k < 24; k += 8) {
    const baseAlong = k + sign * f;
    for (let i = 0; i < 4; i++) {
      const along = baseAlong + (sign > 0 ? i : -i);
      for (const s of [-1, 1]) {
        const across = s > 0 ? 8 + (3 - i) : 7 - (3 - i);
        if (along < 0 || along > 15) continue;
        const c = i === 0 ? '#bfe0ff' : '#7fa8d0';
        if (hor) P(g, along, across, c);
        else P(g, across, along, c);
      }
    }
  }
}

function switchPaint(
  g: CanvasRenderingContext2D,
  world: World,
  col: string,
  active: boolean,
): void {
  floorTile(g, world, 1, 0);
  const plate = grid(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (r > 6) continue;
      if (r > 4.9) gs(plate, x, y, shade(col, -0.5));
      else if (active) gs(plate, x, y, r > 3.6 ? shade(col, -0.42) : shade(col, -0.25));
      else gs(plate, x, y, y + 0.5 < 8 - r * 0.2 ? shade(col, 0.15) : col);
    }
  }
  outline(plate);
  paintGrid(g, plate);
  if (active) {
    R(g, 6, 6, 4, 4, shade(col, 0.45));
    R(g, 6, 6, 2, 1, WHITE);
    P(g, 6, 7, WHITE);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (i % 2) continue;
      P(g, Math.round(7.5 + Math.cos(a) * 7), Math.round(7.5 + Math.sin(a) * 7), shade(col, 0.3));
    }
  } else {
    R(g, 7, 7, 2, 2, shade(col, 0.4));
    P(g, 7, 7, WHITE);
    R(g, 7, 9, 2, 1, shade(col, -0.35));
  }
}

function gateClosedPaint(g: CanvasRenderingContext2D, col: string): void {
  R(g, 0, 0, 16, 16, '#3a3848');
  R(g, 0, 0, 16, 2, '#5a5870');
  R(g, 0, 0, 16, 1, '#7a7890');
  R(g, 0, 0, 1, 12, '#4a4860');
  R(g, 15, 0, 1, 12, '#26242f');
  R(g, 1, 2, 14, 10, '#1a1822');
  for (const x0 of [2, 6, 10]) {
    R(g, x0, 2, 3, 11, col);
    R(g, x0, 2, 1, 11, shade(col, 0.35));
    R(g, x0 + 2, 2, 1, 11, shade(col, -0.35));
    P(g, x0 + 1, 12, shade(col, 0.55));
  }
  R(g, 1, 5, 14, 1, shade(col, -0.45));
  R(g, 1, 9, 14, 1, shade(col, -0.45));
  R(g, 0, 13, 16, 3, '#2a2836');
  R(g, 0, 13, 16, 1, '#34323f');
  R(g, 0, 15, 16, 1, '#16141e');
}

function gateOpenPaint(g: CanvasRenderingContext2D, world: World, col: string): void {
  floorTile(g, world, 2, 1);
  R(g, 0, 0, 16, 1, '#3a3848');
  for (const x0 of [2, 6, 10]) {
    R(g, x0, 0, 3, 2, shade(col, -0.25));
    P(g, x0, 0, shade(col, 0.2));
    R(g, x0, 2, 3, 1, 'rgba(6,4,12,0.35)');
  }
}

function exitPaint(g: CanvasRenderingContext2D, world: World): void {
  floorTile(g, world, 3, 0);
  const d = grid(16, 16);
  for (let y = 2; y < 14; y++) {
    for (let x = 2; x < 14; x++) {
      const edge = x === 2 || y === 2 || x === 13 || y === 13;
      gs(d, x, y, edge ? '#4a3a2e' : y % 3 === 0 ? '#5e4430' : '#7a5a3a');
    }
  }
  outline(d);
  paintGrid(g, d);
  R(g, 3, 3, 10, 1, '#8e6a44');
  P(g, 11, 8, '#ffd23f');
  // green arrow pointing down
  const arrow = ['.###.', '.###.', '#####', '.###.', '..#..'];
  arrow.forEach((row, y) => {
    for (let x = 0; x < 5; x++)
      if (row[x] === '#') P(g, 5 + x, 5 + y, y < 2 ? '#8aff8a' : '#3ed65a');
  });
}

function goalPaint(g: CanvasRenderingContext2D, world: World, f: number): void {
  floorTile(g, world, 4, 1);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const r = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (r > 6.8 && r < 7.8 && (x + y) % 2 === 0) P(g, x, y, 'rgba(255,210,63,0.55)');
    }
  }
  const star = [
    '.....#.....',
    '....###....',
    '....###....',
    '###########',
    '.#########.',
    '..#######..',
    '..#######..',
    '.####.####.',
    '.###...###.',
    '##.......##',
  ];
  const sg = grid(13, 12);
  star.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') gs(sg, x + 1, y + 1, y < 4 ? '#fff4b8' : y < 7 ? '#ffd23f' : '#d98a1f');
    }
  });
  outline(sg);
  paintGrid(g, sg, 2, 2);
  const tw: [number, number][] = [
    [3, 3],
    [13, 4],
    [12, 13],
    [3, 12],
  ];
  const [tx, ty] = tw[f % 4];
  P(g, tx, ty, WHITE);
  P(g, tx - 1, ty, '#fff4b8');
  P(g, tx + 1, ty, '#fff4b8');
}

function crumblingPaint(g: CanvasRenderingContext2D, world: World): void {
  floorTile(g, world, 6, 0);
  const ink = 'rgba(6,4,12,0.75)';
  for (const [x, y] of [
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 4],
    [6, 5],
    [6, 6],
    [5, 7],
    [5, 8],
    [6, 9],
    [7, 10],
    [7, 11],
    [8, 12],
    [11, 1],
    [11, 2],
    [12, 3],
    [12, 4],
    [11, 5],
    [6, 6],
    [7, 6],
    [8, 7],
    [9, 7],
    [10, 7],
  ]) {
    P(g, x, y, ink);
  }
  R(g, 9, 10, 2, 2, '#06040c');
  R(g, 12, 9, 1, 1, '#06040c');
  R(g, 2, 11, 2, 1, '#06040c');
  P(g, 9, 9, 'rgba(255,255,255,0.18)');
  P(g, 3, 10, 'rgba(255,255,255,0.18)');
}

function pitPaint(g: CanvasRenderingContext2D): void {
  R(g, 0, 0, 16, 16, '#06040c');
  R(g, 0, 0, 16, 1, '#2a2240');
  R(g, 0, 1, 16, 2, '#1a1428');
  R(g, 0, 3, 16, 1, '#120e1c');
  R(g, 0, 0, 1, 16, '#16121f');
  R(g, 15, 0, 1, 16, '#0c0914');
  for (const [x, y] of [
    [4, 8],
    [11, 11],
    [7, 13],
  ]) {
    P(g, x, y, '#14101e');
  }
}

function lavaPaint(g: CanvasRenderingContext2D, phase: number): void {
  const tau = Math.PI * 2;
  const p = phase * tau;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v =
        Math.sin((x / 16) * tau + p) +
        Math.sin((y / 16) * tau * 2 - p) +
        Math.sin(((x + y) / 16) * tau + p) +
        dith(x, y) * 0.6;
      P(
        g,
        x,
        y,
        v > 1.7
          ? '#ffe08a'
          : v > 0.9
            ? '#ffa53a'
            : v > -0.3
              ? '#f0601f'
              : v > -1.3
                ? '#c2361f'
                : '#6e1a12',
      );
    }
  }
}

function icePaint(g: CanvasRenderingContext2D, phase: number): void {
  R(g, 0, 0, 16, 16, '#a6dcf2');
  for (let i = -16; i < 16; i += 7) {
    for (let k = 0; k < 16; k++) if (i + k >= 0 && i + k < 16) P(g, i + k, 15 - k, '#c4e8f8');
  }
  R(g, 0, 0, 16, 1, '#e6f8ff');
  R(g, 0, 15, 16, 1, '#7fc0e2');
  for (const [x, y] of [
    [4, 6],
    [5, 7],
    [6, 7],
    [7, 8],
    [8, 8],
    [8, 9],
    [9, 10],
    [11, 7],
    [12, 6],
  ]) {
    P(g, x, y, '#6fb6da');
  }
  // a glint that sweeps across, then leaves a pause before the loop restarts
  const pos = Math.floor(phase * 40) - 12;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let k = 0; k < 16; k++) {
    const xx = pos - k;
    if (xx >= 0 && xx < 16) g.fillRect(xx, k, 1, 1);
    if (xx + 1 >= 0 && xx + 1 < 16 && k % 2) g.fillRect(xx + 1, k, 1, 1);
  }
}

function riftPaint(g: CanvasRenderingContext2D, f: number, frames: number): void {
  R(g, 0, 0, 16, 16, '#0b0614');
  const turn = (f / frames) * Math.PI * 2;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 8;
      const r = Math.hypot(dx, dy);
      if (r > 7.8) continue;
      const a = Math.atan2(dy, dx);
      const arm = Math.sin(a * 2 + r * 0.75 - turn) + dith(x, y) * 0.4;
      if (r < 2) P(g, x, y, r < 1.1 ? '#000000' : '#c8a8ff');
      else if (arm > 0.55) P(g, x, y, r < 5 ? '#9a6dff' : '#6a42d8');
      else if (arm > 0.05) P(g, x, y, '#3a2288');
      else if (r < 6.5) P(g, x, y, '#1a0f38');
    }
  }
  const sp: [number, number][] = [
    [2, 3],
    [13, 2],
    [12, 13],
    [3, 12],
  ];
  const [sx, sy] = sp[f % 4];
  P(g, sx, sy, '#d8c0ff');
}

function quicksandPaint(g: CanvasRenderingContext2D, phase: number): void {
  R(g, 0, 0, 16, 16, '#c9a35c');
  const turn = (phase * Math.PI * 2) / 3;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 8;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) + turn + r * 0.25;
      if (r < 1.6) P(g, x, y, '#6e5428');
      else if (Math.abs(r - 4) < 0.6 || Math.abs(r - 6.8) < 0.6) {
        if (Math.sin(a * 3) > -0.2) P(g, x, y, '#a8823c');
      }
    }
  }
  for (let i = 0; i < 4; i++) P(g, (H(i, 3, 5) * 16) | 0, (H(i, 4, 5) * 16) | 0, '#e6c886');
}

function mudPaint(g: CanvasRenderingContext2D, f: number): void {
  R(g, 0, 0, 16, 16, '#4b3c2a');
  R(g, 2, 3, 5, 3, '#3a2e20');
  R(g, 9, 9, 6, 4, '#3a2e20');
  R(g, 4, 11, 3, 2, '#3e4a24');
  R(g, 10, 3, 3, 1, '#6a5640');
  P(g, 3, 8, '#6a5640');
  const bx = 7;
  const by = 7;
  if (f < 3) {
    P(g, bx, by, '#7a6448');
    if (f > 0) {
      P(g, bx + 1, by, '#7a6448');
      P(g, bx, by - 1, '#8a7458');
    }
    if (f > 1) P(g, bx + 1, by - 1, '#a08a6a');
  } else if (f === 3) {
    P(g, bx - 1, by, '#6a5438');
    P(g, bx + 2, by, '#6a5438');
    P(g, bx, by - 2, '#6a5438');
  }
}

function vinePaint(g: CanvasRenderingContext2D, f: number): void {
  R(g, 0, 0, 16, 16, '#24361c');
  for (let i = 0; i < 6; i++) P(g, (H(i, 1, 2) * 16) | 0, (H(i, 2, 2) * 16) | 0, '#1a2a14');
  const path: [number, number][] = [
    [0, 9],
    [1, 8],
    [2, 7],
    [3, 7],
    [4, 6],
    [5, 6],
    [6, 7],
    [7, 8],
    [8, 8],
    [9, 7],
    [10, 6],
    [11, 5],
    [12, 5],
    [13, 6],
    [14, 6],
    [15, 5],
  ];
  for (const [x, y] of path) {
    P(g, x, y, '#3f7a2a');
    P(g, x, y + 1, '#2c5a1e');
  }
  const path2: [number, number][] = [
    [2, 15],
    [3, 14],
    [4, 13],
    [5, 12],
    [6, 12],
    [7, 13],
    [8, 13],
    [9, 12],
    [10, 11],
    [11, 11],
    [12, 12],
  ];
  for (const [x, y] of path2) P(g, x, y, '#3f7a2a');
  const sway = f % 2;
  for (const [x, y] of [
    [4, 4],
    [10, 3],
    [8, 10],
    [13, 9],
  ]) {
    P(g, x + sway, y, '#7ac84a');
    P(g, x + sway + 1, y, '#5aa83a');
    P(g, x + sway, y + 1, '#5aa83a');
  }
}

function spikesPaint(g: CanvasRenderingContext2D, active: boolean): void {
  R(g, 0, 0, 16, 16, '#4a4a58');
  R(g, 0, 0, 16, 1, '#5e5e6e');
  R(g, 0, 0, 1, 16, '#5e5e6e');
  R(g, 0, 15, 16, 1, '#363642');
  R(g, 15, 0, 1, 16, '#363642');
  for (const cy of [3, 8, 13]) {
    for (const cx of [3, 8, 13]) {
      R(g, cx - 1, cy, 2, 2, '#22222c');
      if (active) {
        P(g, cx - 1, cy - 2, WHITE);
        R(g, cx - 1, cy - 1, 1, 2, '#c8c8d6');
        R(g, cx, cy - 1, 1, 2, '#7a7a8a');
        R(g, cx - 2, cy + 1, 4, 1, '#55555f');
      } else {
        P(g, cx - 1, cy, '#5a5a66');
      }
    }
  }
  if (active) {
    R(g, 0, 0, 16, 1, '#c83a3a');
    R(g, 0, 15, 16, 1, '#8a2020');
    R(g, 0, 0, 1, 16, '#c83a3a');
    R(g, 15, 0, 1, 16, '#8a2020');
  }
}

/** Frames and loop length per special tile. */
export function specialFrameCount(tile: TileType): number {
  if (tile === 'teleporter_a' || tile === 'teleporter_b') return 8;
  if (tile.startsWith('conveyor_')) return 8;
  switch (tile) {
    case 'lava':
      return 6;
    case 'ice':
      return 8;
    case 'dark_rift':
      return 8;
    case 'quicksand':
      return 4;
    case 'mud':
      return 6;
    case 'vine':
      return 2;
    case 'goal':
      return 4;
    default:
      return 1;
  }
}

export function specialLoopLength(tile: TileType): number {
  if (tile === 'teleporter_a' || tile === 'teleporter_b') return 0.8;
  if (tile.startsWith('conveyor_')) return 0.5;
  switch (tile) {
    case 'lava':
      return 2;
    case 'ice':
      return 3;
    case 'dark_rift':
      return 0.8;
    case 'quicksand':
      return 1.2;
    case 'mud':
      return 1.5;
    case 'vine':
      return 1;
    case 'goal':
      return 1.2;
    default:
      return 1;
  }
}

export function specialTile(
  g: CanvasRenderingContext2D,
  world: World,
  tile: TileType,
  phase: number,
): void {
  const frames = specialFrameCount(tile);
  const f = ((Math.floor(phase * frames) % frames) + frames) % frames;
  const key = `sp:${world}:${tile}:${f}`;
  put(
    g,
    spr(key, 16, 16, (c) => {
      if (tile === 'teleporter_a' || tile === 'teleporter_b') {
        return teleporterPaint(c, world, tile === 'teleporter_b' ? 'b' : 'a', f);
      }
      if (tile.startsWith('conveyor_')) return conveyorPaint(c, tile.slice(9), f);
      if (tile.startsWith('switch_'))
        return switchPaint(c, world, colorOfTile(tile), tile.endsWith('_active'));
      if (tile.startsWith('gate_')) {
        return tile.endsWith('_open')
          ? gateOpenPaint(c, world, colorOfTile(tile))
          : gateClosedPaint(c, colorOfTile(tile));
      }
      switch (tile) {
        case 'exit':
          return exitPaint(c, world);
        case 'goal':
          return goalPaint(c, world, f);
        case 'crumbling':
          return crumblingPaint(c, world);
        case 'pit':
          return pitPaint(c);
        case 'lava':
          return lavaPaint(c, f / frames);
        case 'ice':
          return icePaint(c, f / frames);
        case 'dark_rift':
          return riftPaint(c, f, frames);
        case 'quicksand':
          return quicksandPaint(c, f / frames);
        case 'mud':
          return mudPaint(c, f);
        case 'vine':
          return vinePaint(c, f);
        case 'spikes':
          return spikesPaint(c, false);
        case 'spikes_active':
          return spikesPaint(c, true);
        default:
          return floorPaint(c, world, 0, 0);
      }
    }),
    0,
    0,
  );
}

/** Outline ink, re-exported for the other pixel modules. */
export { OUT };
