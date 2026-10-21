/** Crisp Pixel items and effects: bombs, flames, power-ups, shield, particles, scorch, meteor. */
import type { PowerUpType } from '@blast-arena/shared';
import { shade, ease, clamp, PU_COLORS_NEW, PU_SHAPE } from '../../paint';
import type { BombType, FlamePiece, FxKind } from '../../painters/types';
import {
  OUT,
  WHITE,
  R,
  P,
  grid,
  gs,
  gg,
  outline,
  gridSprite,
  spr,
  put,
  blobInto,
  dith,
  H,
  ditherDisc,
} from './pixelKit';
import type { Grid } from './pixelKit';
import type { Direction } from '@blast-arena/shared';

/* ================= bombs ================= */

const BOMB_RAMP = ['#b4b0e0', '#625e90', '#3a3658', '#25213c', '#16132a'];
const BOMB_RED = ['#ffc0b0', '#ff5a4a', '#c42a2a', '#8a1a1e', '#5a1016'];
/** Fuse pixels from the cap outward (grid coordinates, before the vertical offset). */
const FUSE: [number, number][] = [
  [11, 3],
  [12, 2],
  [13, 2],
  [14, 1],
  [15, 1],
];
const BCX = 10;
const BCY = 11;
const BR = 6;
const BTOP = Math.round(BCY - BR) - 1;

function bombGrid(type: BombType, hot: boolean, fuseN: number, led: boolean): Grid {
  const g = grid(20, 20);
  const ramp = hot ? BOMB_RED : BOMB_RAMP;
  blobInto(g, BCX, BCY, BR, BR, ramp);
  gs(g, BCX - 3, BCY - 3, WHITE);
  gs(g, BCX - 4, BCY - 2, ramp[0]);
  if (type === 'pierce') {
    const sp = '#d6d6e6';
    const pts: [number, number, number, number][] = [
      [BCX + BR, BCY - 1, 1, 0],
      [BCX - BR - 1, BCY - 1, -1, 0],
      [BCX - 1, BCY - BR - 1, 0, -1],
      [BCX - 1, BCY + BR, 0, 1],
      [BCX + 4, BCY - 5, 1, -1],
      [BCX - 5, BCY - 5, -1, -1],
      [BCX + 4, BCY + 4, 1, 1],
      [BCX - 5, BCY + 4, -1, 1],
    ];
    for (const [x, y, dx, dy] of pts) {
      gs(g, x, y, '#9a9aac');
      gs(g, x + dx, y + dy, sp);
    }
    gs(g, BCX - 1, BCY, '#ff3b3b');
    gs(g, BCX - 1, BCY + 1, '#c41e2a');
    gs(g, BCX, BCY + 1, '#ff3b3b');
    gs(g, BCX, BCY, '#ffc0b0');
  }
  if (type === 'remote') {
    gs(g, BCX, BTOP, '#9a9aa8');
    gs(g, BCX, BTOP - 1, '#9a9aa8');
    gs(g, BCX, BTOP - 2, '#9a9aa8');
    gs(g, BCX, BTOP - 3, led ? '#ff4a4a' : '#5a2a2a');
  } else {
    gs(g, BCX - 1, BTOP, '#6a6a7a');
    gs(g, BCX, BTOP, '#a0a0b0');
    for (let i = 0; i < fuseN; i++)
      gs(g, FUSE[i][0], FUSE[i][1] + (BTOP - 4), i % 2 ? '#a88848' : '#e0c080');
  }
  outline(g);
  if (type === 'remote' && led) {
    // a faint halo around the lit LED
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
    ]) {
      if (!gg(g, BCX + dx, BTOP - 3 + dy) || gg(g, BCX + dx, BTOP - 3 + dy) === OUT) {
        gs(g, BCX + dx, BTOP - 3 + dy, '#ff8a7a');
      }
    }
  }
  return g;
}

function sparkAt(g: CanvasRenderingContext2D, x: number, y: number, f: number): void {
  if (f === 0) {
    P(g, x, y, WHITE);
    P(g, x - 1, y, '#ffd84a');
    P(g, x + 1, y, '#ffd84a');
    P(g, x, y - 1, '#ffd84a');
    P(g, x, y + 1, '#ff9a2a');
  } else {
    P(g, x, y, '#fff4b0');
    P(g, x - 1, y - 1, '#ff9a2a');
    P(g, x + 1, y - 1, '#ffd84a');
    P(g, x - 1, y + 1, '#ff6a2a');
    P(g, x + 1, y + 1, '#ff9a2a');
  }
}

/** Fuse pixels shown for a fuse fraction. */
export function fuseLength(fuse: number): number {
  return Math.max(0, Math.min(5, Math.ceil(fuse * 5 - 1e-6)));
}

export function bombSprite(
  g: CanvasRenderingContext2D,
  type: BombType,
  fuse: number,
  spark: 0 | 1,
  hot: boolean,
): void {
  const fuseN = type === 'remote' ? 0 : fuseLength(fuse);
  const led = type === 'remote' && spark === 1;
  const c = gridSprite(`bm:${type}:${hot ? 1 : 0}:${fuseN}:${led ? 1 : 0}`, () =>
    bombGrid(type, hot, fuseN, led),
  );
  put(g, c, -10, -10);
  if (type !== 'remote') {
    const tx = fuseN > 0 ? FUSE[fuseN - 1][0] : BCX;
    const ty = fuseN > 0 ? FUSE[fuseN - 1][1] + (BTOP - 4) : BTOP - 1;
    sparkAt(g, -10 + tx, -10 + ty, spark);
  }
}

/** Where the full-length fuse burns, in game units from the bomb's centre. */
export const FUSE_TIP = {
  x: (-10 + FUSE[4][0]) * 3 + 1.5,
  y: (-10 + FUSE[4][1] + (BTOP - 4)) * 3 + 1.5,
};

/** The owner stripe: a two-pixel band round the bomb's middle, white. */
export function bombBandSprite(g: CanvasRenderingContext2D, type: BombType): void {
  const c = gridSprite(`bmband:${type}`, () => {
    const gr = grid(20, 20);
    for (const y of [BCY + 1, BCY + 2]) {
      for (let x = 0; x < 20; x++) {
        const nx = (x + 0.5 - BCX) / BR;
        const ny = (y + 0.5 - BCY) / BR;
        if (nx * nx + ny * ny > 0.86) continue;
        if (type === 'pierce' && (x === BCX - 1 || x === BCX)) continue;
        gs(gr, x, y, WHITE);
      }
    }
    return gr;
  });
  put(g, c, -10, -10);
}

/* ================= flames ================= */

const FLAME_PAL = {
  n: ['', '#e0381c', '#ff7f1f', '#ffd640', '#fffbe8'],
  p: ['', '#2448d0', '#4a9cff', '#bfe6ff', '#ffffff'],
};

function flamePaint(
  g: CanvasRenderingContext2D,
  kind: FlamePiece,
  dir: string,
  h: number,
  f: number,
  pierce: boolean,
  shift: number,
): void {
  const pal = pierce ? FLAME_PAL.p : FLAME_PAL.n;
  const wob = (a: number, b: number) => (b <= 0 || b >= 15 ? 0 : ((H(a, b, f + 11) * 3) | 0) - 1);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const px = x + 0.5 - 8;
      const py = y + 0.5 - 8;
      let d: number;
      let w: number;
      if (kind === 'center') {
        const dh = h - Math.abs(py);
        const dv = h - Math.abs(px);
        const dc = h + 1.8 - Math.hypot(px, py);
        d = Math.max(dh, dv, dc);
        w = d === dh ? wob(1, x) : d === dv ? wob(2, y) : 0;
      } else if (kind === 'arm') {
        const hor = dir === 'right' || dir === 'left';
        d = hor ? h - Math.abs(py) : h - Math.abs(px);
        w = hor ? wob(1, x) : wob(2, y);
      } else {
        let along: number;
        let across: number;
        if (dir === 'right') {
          along = x;
          across = py;
        } else if (dir === 'left') {
          along = 15 - x;
          across = py;
        } else if (dir === 'down') {
          along = y;
          across = px;
        } else {
          along = 15 - y;
          across = px;
        }
        let hh = h;
        if (along > 6) {
          const q = (along - 6 + 0.5) / 9.5;
          hh *= Math.sqrt(Math.max(0, 1 - q * q));
        }
        d = hh - Math.abs(across);
        w = wob(3, along);
      }
      // the wobble only moves the outer edge, so the core stays clean
      if (d + w < 0) continue;
      let layer = d < 1.2 ? 1 : d < 2.8 ? 2 : d < 4.8 ? 3 : 4;
      layer = Math.max(1, layer - shift);
      P(g, x, y, pal[layer]);
    }
  }
}

export function flameSprite(
  g: CanvasRenderingContext2D,
  piece: FlamePiece,
  dir: Direction,
  frame: number,
  frames: number,
  pierce: boolean,
): void {
  // frame i spans the 0.5 s life: grow fast, hold with a flicker, thin out at the end
  const t = frames > 1 ? frame / (frames - 1) : 0;
  const age = t * 0.5;
  const life = 1 - t;
  const grow = ease.outCubic(clamp(age / 0.1));
  let h = 7 * (0.35 + 0.65 * grow);
  if (life < 0.45) h *= 0.4 + 0.6 * (life / 0.45);
  h = Math.max(1.5, Math.round(h * 2) / 2);
  const shift = life < 0.18 ? 2 : life < 0.36 ? 1 : 0;
  const f = frame % 3;
  const d = piece === 'center' ? 'c' : dir;
  put(
    g,
    spr(`fl:${piece}:${d}:${h}:${f}:${pierce ? 1 : 0}:${shift}`, 16, 16, (c) =>
      flamePaint(c, piece, dir, h, f, pierce, shift),
    ),
    -8,
    -8,
  );
}

/* ================= power-ups ================= */

const GLYPHS: Record<PowerUpType, string[]> = {
  bomb_up: [
    '......#.',
    '..#..###',
    '.###..#.',
    '#####...',
    '#####...',
    '#####...',
    '.###....',
    '........',
  ],
  fire_up: [
    '....#...',
    '...##...',
    '...###..',
    '..####.#',
    '.###x##.',
    '.##xx##.',
    '.##xx##.',
    '..####..',
  ],
  speed_up: [
    '....###.',
    '...###..',
    '..###...',
    '.######.',
    '...###..',
    '..###...',
    '.##.....',
    '#.......',
  ],
  shield: [
    '........',
    '...##...',
    '...##...',
    '.######.',
    '.######.',
    '...##...',
    '...##...',
    '........',
  ],
  kick: [
    '...###..',
    '...###..',
    '...###..',
    '##.####.',
    '...#####',
    '##.#####',
    '...#####',
    '........',
  ],
  pierce_bomb: [
    '....#...',
    '....##..',
    '..#.###.',
    '########',
    '########',
    '..#.###.',
    '....##..',
    '....#...',
  ],
  remote_bomb: [
    '.#....#.',
    '#..##..#',
    '#.#..#.#',
    '...##...',
    '...##...',
    '...##...',
    '..####..',
    '..####..',
  ],
  line_bomb: [
    '........',
    '.#..#...',
    '......#.',
    '##.##..#',
    '##.##..#',
    '......#.',
    '........',
    '........',
  ],
  bomb_throw: [
    '..####..',
    '.#....#.',
    '#......#',
    '.....###',
    '##....#.',
    '###.....',
    '###.....',
    '.#......',
  ],
};

function inShape(shape: string, x: number, y: number): boolean {
  const dx = x + 0.5 - 8;
  const dy = y + 0.5 - 8;
  switch (shape) {
    case 'hex':
      return Math.abs(dy) <= 6.2 && Math.abs(dx) + Math.abs(dy) * 0.55 <= 7.3;
    case 'diamond':
      return Math.abs(dx) + Math.abs(dy) <= 7.6;
    case 'shield':
      if (dy < -6.5 || dy > 7) return false;
      if (dy < 0.5) return Math.abs(dx) <= 6.6 && !(Math.abs(dx) > 5.6 && dy < -5.5);
      return Math.abs(dx) <= 6.6 * Math.pow(1 - (dy - 0.5) / 7.2, 0.75);
    default:
      return dx * dx + dy * dy <= 6.9 * 6.9;
  }
}

/** shine: 0 none, 1..3 a highlight that travels along the top-left rim. */
function puGrid(type: PowerUpType, shine: number): Grid {
  const g = grid(16, 16);
  const col = PU_COLORS_NEW[type] ?? WHITE;
  const ramp = [shade(col, 0.55), shade(col, 0.22), col, shade(col, -0.3), shade(col, -0.55)];
  const shape = PU_SHAPE[type] ?? 'round';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!inShape(shape, x, y)) continue;
      const dy = (y + 0.5 - 8) / 8;
      const dx = (x + 0.5 - 8) / 8;
      const l = -(dy * 0.9 + dx * 0.35) + dith(x, y) * 0.35;
      gs(g, x, y, l > 0.5 ? ramp[1] : l > -0.25 ? ramp[2] : l > -0.7 ? ramp[3] : ramp[4]);
    }
  }
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!gg(g, x, y)) continue;
      if ((!gg(g, x, y - 1) || !gg(g, x - 1, y)) && x + y < 15) gs(g, x, y, ramp[0]);
    }
  }
  const gl = GLYPHS[type];
  if (gl) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (gl[y][x] === '#' && !(gl[y + 1] && gl[y + 1][x + 1] === '#') && gg(g, x + 5, y + 5))
          gs(g, x + 5, y + 5, ramp[4]);
      }
    }
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (gl[y][x] === '#') gs(g, x + 4, y + 4, WHITE);
        else if (gl[y][x] === 'x') gs(g, x + 4, y + 4, ramp[3]);
      }
    }
  }
  if (shine) {
    const spots: [number, number][][] = [
      [],
      [
        [4, 3],
        [3, 4],
      ],
      [
        [6, 2],
        [5, 3],
        [3, 5],
      ],
      [
        [9, 2],
        [2, 9],
      ],
    ];
    for (const [x, y] of spots[shine] ?? [])
      if (gg(g, x, y) && gg(g, x, y) !== WHITE) gs(g, x, y, WHITE);
  }
  outline(g);
  return g;
}

export function powerUpSprite(
  g: CanvasRenderingContext2D,
  type: PowerUpType,
  frame: number,
  frames: number,
): void {
  // the token rests for the first half of the loop, then a glint travels across the rim
  const step = frames > 1 ? Math.floor((frame / frames) * 6) : 0;
  const shine = step < 3 ? 0 : step - 2;
  put(
    g,
    gridSprite(`pu:${type}:${shine}`, () => puGrid(type, shine)),
    -8,
    -9,
  );
}

/* ================= shield ================= */

export function shieldSprite(g: CanvasRenderingContext2D, frame: number): void {
  const f = ((frame % 4) + 4) % 4;
  const c = spr('shield:' + f, 25, 25, (s) => {
    const ha = (f / 4) * Math.PI * 2 - Math.PI * 0.75;
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 25; x++) {
        const dx = x - 12;
        const dy = y - 12;
        const r = Math.hypot(dx, dy * 1.08);
        if (r > 11.6) continue;
        if (r > 10.4) {
          let da = Math.atan2(dy, dx) - ha;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          P(s, x, y, Math.abs(da) < 0.45 ? WHITE : Math.abs(da) < 0.9 ? '#c4ffe0' : '#5ee8a0');
        } else if ((x + y) % 2 === 0 && r > 8.8) P(s, x, y, 'rgba(94,232,160,0.45)');
        else if ((x + y) % 4 === 0) P(s, x, y, 'rgba(94,232,160,0.18)');
      }
    }
    P(s, 7, 6, WHITE);
    P(s, 6, 7, WHITE);
    P(s, 8, 6, '#c4ffe0');
  });
  put(g, c, -12, -14);
}

/* ================= effects ================= */

function plus(g: CanvasRenderingContext2D, center: string, arm: string): void {
  P(g, 0, 0, center);
  P(g, -1, 0, arm);
  P(g, 1, 0, arm);
  P(g, 0, -1, arm);
  P(g, 0, 1, arm);
}

function ring(
  g: CanvasRenderingContext2D,
  r: number,
  color: string,
  dashed: boolean,
  squash = 1,
): void {
  const n = Math.max(12, Math.round(Math.PI * 2 * r));
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    if (dashed && Math.floor((i / n) * 12) % 2) continue;
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * r);
    const y = Math.round(Math.sin(a) * r * squash);
    const k = x + ',' + y;
    if (seen.has(k)) continue;
    seen.add(k);
    P(g, x, y, color);
  }
}

export function fxSprite(g: CanvasRenderingContext2D, kind: FxKind): void {
  switch (kind) {
    case 'spark':
      plus(g, WHITE, '#ffd84a');
      P(g, 1, 1, '#ff9a2a');
      return;
    case 'smoke': {
      const c = ditherDisc(3, '#4a4552', 0.5);
      put(g, c, -3, -3);
      return;
    }
    case 'dust': {
      const c = ditherDisc(2, '#cfc6d8', 0.45);
      put(g, c, -2, -2);
      return;
    }
    case 'star':
      plus(g, WHITE, '#e4e4ee');
      return;
    case 'ember':
      g.fillStyle = 'rgba(255,122,42,0.35)';
      g.fillRect(-1, 0, 3, 1);
      g.fillRect(0, -1, 1, 3);
      P(g, 0, 0, '#ffd27a');
      return;
    case 'snow':
      R(g, -1, -1, 2, 2, '#f2f8ff');
      P(g, -1, -1, WHITE);
      return;
    case 'firefly':
      g.fillStyle = 'rgba(154,223,58,0.5)';
      g.fillRect(-1, 0, 3, 1);
      g.fillRect(0, -1, 1, 3);
      P(g, 0, 0, '#f2ffb0');
      return;
    case 'mote':
      P(g, 0, 0, '#cfc8f0');
      return;
    case 'glow': {
      // a dithered disc, densest in the middle (white, tinted at runtime)
      for (let y = -7; y <= 7; y++) {
        for (let x = -7; x <= 7; x++) {
          const d = Math.hypot(x, y) / 7.5;
          if (d > 1) continue;
          if (1 - d > dith(x + 8, y + 8) + 0.5)
            P(g, x, y, d < 0.45 ? WHITE : 'rgba(255,255,255,0.6)');
        }
      }
      return;
    }
    case 'ring':
      ring(g, 7, WHITE, false);
      return;
    case 'localRing':
      ring(g, 8, WHITE, false, 0.4);
      ring(g, 7, 'rgba(255,255,255,0.45)', false, 0.4);
      return;
    case 'teamRing': {
      const rows: [number, number, number][] = [
        [-2, -4, 3],
        [-1, -6, 5],
        [0, -7, 6],
        [1, -6, 5],
        [2, -4, 3],
      ];
      for (const [y, a, b] of rows) {
        if (y === -2 || y === 2) R(g, a, y, b - a + 1, 1, y === 2 ? '#bcbcc8' : WHITE);
        else {
          P(g, a, y, WHITE);
          P(g, b, y, WHITE);
          if (y === 0) {
            P(g, a + 1, y, '#bcbcc8');
            P(g, b - 1, y, '#bcbcc8');
          }
        }
      }
      return;
    }
  }
}

/** A debris chunk: 2x2, 2x1 or 1x2 art pixels with a darker edge. */
export function chunkSprite(
  g: CanvasRenderingContext2D,
  cols: [string, string, string],
  variant: number,
): void {
  const c = cols[variant % 3];
  if (variant === 0) {
    R(g, -1, -1, 2, 2, c);
    P(g, 0, 0, shade(c, -0.3));
  } else if (variant === 1) {
    R(g, -1, 0, 2, 1, c);
    P(g, 0, 0, shade(c, -0.3));
  } else {
    R(g, 0, -1, 1, 2, c);
    P(g, 0, 0, shade(c, -0.3));
  }
}

export function scorchSprite(g: CanvasRenderingContext2D, variant: number): void {
  const c = ditherDisc(8, 'rgba(8,4,6,0.78)', 0.42, variant + 1);
  put(g, c, -8, -8);
}

export function meteorSprite(g: CanvasRenderingContext2D): void {
  const c = gridSprite('meteor', () => {
    const gr = grid(22, 22);
    // fire trail to the upper right
    for (let i = 0; i < 9; i++) {
      for (let k = -1; k <= 1; k++) {
        const x = 12 + i;
        const y = 9 - i + k;
        if (Math.abs(k) === 1 && i > 5) continue;
        if (H(x, y, 4) < 0.25 + i * 0.06) continue;
        gs(gr, x, y, i < 3 ? '#ffd23f' : i < 6 ? '#ff7a2a' : '#c43a1a');
      }
    }
    blobInto(gr, 9, 12, 5.6, 5.6, ['#c08050', '#8a5a34', '#6a4026', '#4a2a18', '#2e180c']);
    for (const [x, y] of [
      [10, 13],
      [7, 14],
      [11, 10],
    ]) {
      gs(gr, x, y, '#2e180c');
    }
    for (const [x, y] of [
      [6, 8],
      [5, 9],
      [7, 7],
      [5, 10],
    ]) {
      gs(gr, x, y, '#ffb347');
    }
    gs(gr, 6, 9, '#fff0a0');
    outline(gr);
    return gr;
  });
  put(g, c, -9, -12);
}
