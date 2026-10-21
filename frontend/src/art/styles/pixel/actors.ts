/** Crisp Pixel characters: bombers, the knockout ghost, marker badges and campaign enemies. */
import type { Direction, EnemySpriteConfig } from '@blast-arena/shared';
import { shade } from '../../paint';
import type { EyeStyle, MarkerShape, PlayerPose } from '../../painters/types';
import {
  OUT,
  WHITE,
  grid,
  gs,
  gg,
  outline,
  fromMap,
  flipX,
  gridSprite,
  blobInto,
  put,
} from './pixelKit';
import type { Grid } from './pixelKit';

/* ================= bombers ================= */

const P_DOWN = [
  '......oooo......',
  '.....oQYYyo.....',
  '.....oYYyyo.....',
  '...oooooooooo...',
  '..oLHHLCCCCCDo..',
  '.oLHLCCCCCCCCDo.',
  '.oCCWWWWWWWWCDo.',
  '.oCWWWWWWWWWWDo.',
  '.oCWWWWWWWWWWDo.',
  '.oDCwWWWWWWwDEo.',
  '..oDCwwwwwwCEo..',
  '...oEDDDDDDEo...',
  '..oGoLCCCCDoGo..',
  '..oGoCCCCCDoGo..',
  '...ooDDEEDDoo...',
  '...oFfo..oFfo...',
  '...oooo..oooo...',
];
const P_UP = [
  '......oooo......',
  '.....oQYYyo.....',
  '.....oYYyyo.....',
  '...oooooooooo...',
  '..oLHHLCCCCCDo..',
  '.oLHLCCCCCCCCDo.',
  '.oLCCCCCCCCCCDo.',
  '.oCCCCCLCCCCCDo.',
  '.oCCCCCCCCCCDDo.',
  '.oDCCCCCCCCDDEo.',
  '..oDDCCCCDDDEo..',
  '...oEEEEEEEEo...',
  '..oGoDCCCCDoGo..',
  '..oGoDCCCCDoGo..',
  '...ooDDEEDDoo...',
  '...oFfo..oFfo...',
  '...oooo..oooo...',
];
const P_RIGHT = [
  '.....oooo.......',
  '....oQYYyo......',
  '....oYYyyo......',
  '...oooooooooo...',
  '..oLHHLCCCCCDo..',
  '.oLHLCCCCCCCCo..',
  '.oCCCCCWWWWWWo..',
  '.oCCCCWWWWWWWWo.',
  '.oCCCCWWWWWWWWo.',
  '.oDCCCwWWWWWWwo.',
  '..oDCCCwwwwwwo..',
  '...oEDDDDDDEo...',
  '...oGoCCCCDo....',
  '...oGoCCCCDGo...',
  '...ooDDEEDDoo...',
  '....oFfoFfo.....',
  '....ooooooo.....',
];
const FEET = {
  front: {
    A: ['...oFfoEEDDoo...', '...oooo..oFfo...', '.........oooo...'],
    B: ['...ooDDEEoFfo...', '...oFfo..oooo...', '...oooo.........'],
  },
  side: {
    A: ['...ooDDEEDDoo...', '...oFfo.oFfo....', '...oooo.oooo....'],
    B: ['...ooDDEEDDoo...', '....oFfFfo......', '....oooooo......'],
  },
};
const FIXED: Record<string, string> = {
  o: OUT,
  Q: '#fff4b8',
  Y: '#ffd23f',
  y: '#d98a1f',
  W: '#f6f1ea',
  w: '#c4bccb',
  G: '#f6f1ea',
  F: '#7a6aa0',
  f: '#4a3d72',
};

function playerPal(c: string): Record<string, string> {
  return {
    H: shade(c, 0.6),
    L: shade(c, 0.28),
    C: c,
    D: shade(c, -0.32),
    E: shade(c, -0.56),
    ...FIXED,
  };
}

function eyesOn(g: Grid, side: boolean, style: EyeStyle, closed: boolean): void {
  const K = OUT;
  const RED = '#ff3344';
  if (style === 'cyclops') {
    const x = side ? 10 : 7;
    if (closed) {
      gs(g, x, 8, K);
      gs(g, x + 1, 8, K);
    } else {
      gs(g, x, 7, WHITE);
      gs(g, x + 1, 7, K);
      gs(g, x, 8, K);
      gs(g, x + 1, 8, K);
    }
    return;
  }
  const eyes: [number, number, number][] = side
    ? [[11, 7, 1]]
    : [
        [5, 7, -1],
        [10, 7, 1],
      ];
  for (const [x, y, out] of eyes) {
    if (closed) {
      gs(g, x, y + 1, K);
      continue;
    }
    if (style === 'dot') gs(g, x, y + 1, K);
    else if (style === 'angry') {
      gs(g, x + out, y - 1, K);
      gs(g, x, y, K);
      gs(g, x, y + 1, RED);
      gs(g, x + out, y + 1, RED);
    } else {
      gs(g, x, y, K);
      gs(g, x, y + 1, K);
    }
  }
}

type Frame = 'idle' | 'A' | 'B';

function playerGrid(
  color: string,
  dir: Direction,
  eyes: EyeStyle,
  frame: Frame,
  closed: boolean,
): Grid {
  const side = dir === 'left' || dir === 'right';
  const rows = (dir === 'up' ? P_UP : dir === 'down' ? P_DOWN : P_RIGHT).slice();
  if (frame !== 'idle') {
    const f = FEET[side ? 'side' : 'front'][frame];
    rows[14] = f[0];
    rows[15] = f[1];
    rows[16] = f[2];
  }
  let g = fromMap(rows, playerPal(color));
  if (dir !== 'up') eyesOn(g, side, eyes, closed);
  if (dir === 'left') g = flipX(g);
  return g;
}

/** A bomber with its feet on the tile's lower half; origin at the tile centre (art pixels). */
export function playerSprite(
  g: CanvasRenderingContext2D,
  color: string,
  eyes: EyeStyle,
  dir: Direction,
  pose: PlayerPose,
): void {
  let frame: Frame = 'idle';
  let dy = 0;
  let closed = false;
  if (pose.kind === 'idle') closed = pose.blink;
  else {
    frame = pose.step === 0 ? 'A' : pose.step === 2 ? 'B' : 'idle';
    if (pose.step % 2 === 1) dy = -1;
  }
  const spr = gridSprite(`pl:${color}:${dir}:${eyes}:${frame}:${closed ? 1 : 0}`, () =>
    playerGrid(color, dir, eyes, frame, closed),
  );
  put(g, spr, -8, -10 + dy);
}

const GHOST = [
  '...oooo...',
  '..oWWWWo..',
  '.oWWWWWWo.',
  '.oWKWWKWo.',
  '.oWKWWKWo.',
  '.oWWWWWWo.',
  '.owWWWWWo.',
  '.owWWWWwo.',
  '.owwWWwwo.',
  '.owowwowo.',
  '..o.oo.o..',
];

export function ghostSprite(g: CanvasRenderingContext2D, color: string): void {
  const spr = gridSprite('ghost:' + color, () =>
    fromMap(GHOST, { o: '#3a3060', W: '#ece8ff', w: '#b8b0e0', K: shade(color, -0.2) }),
  );
  put(g, spr, -5, -10);
}

const MARKS: Record<MarkerShape, string[]> = {
  circle: ['###', '#.#', '###'],
  triangle: ['.#.', '###', '###'],
  square: ['###', '###', '###'],
  diamond: ['.#.', '#.#', '.#.'],
  star: ['#.#', '.#.', '#.#'],
  plus: ['.#.', '###', '.#.'],
  hex: ['.#.', '###', '#.#'],
  heart: ['#.#', '###', '.#.'],
};

export function markerSprite(g: CanvasRenderingContext2D, shape: MarkerShape, color: string): void {
  const spr = gridSprite(`mark:${shape}:${color}`, () => {
    const gr = grid(5, 5);
    const m = MARKS[shape] ?? MARKS.circle;
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) if (m[y][x] === '#') gs(gr, x + 1, y + 1, color);
    outline(gr);
    return gr;
  });
  put(g, spr, -3, -3);
}

/* ================= enemies ================= */

function ramp(c: string): string[] {
  return [shade(c, 0.5), shade(c, 0.22), c, shade(c, -0.3), shade(c, -0.55)];
}

const EW = 22;
const EH = 22;
const CX = 11;
const CY = 12;

/** Lit shading for an arbitrary filled shape (same light as blobInto). */
function shadeShape(
  g: Grid,
  inside: (x: number, y: number) => boolean,
  r: string[],
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (!inside(x, y)) continue;
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const d = Math.min(1, nx * nx + ny * ny);
      const l =
        -(nx * 0.6 + ny * 0.8) * 0.7 +
        (1 - d) * 0.4 -
        0.12 +
        (((x * 3 + y * 5) % 4) / 4 - 0.4) * 0.3;
      const i = l > 0.6 ? 0 : l > 0.28 ? 1 : l > -0.06 ? 2 : l > -0.4 ? 3 : 4;
      gs(g, x, y, r[i]);
    }
  }
}

/** Top row of each body, for horns, crowns and bandanas. */
const BODY_TOP: Record<string, number> = {
  blob: CY - 6,
  spiky: CY - 6,
  ghost: CY - 7,
  robot: 6,
  bug: CY - 6,
  skull: CY - 7,
};

function body(g: Grid, sp: EnemySpriteConfig, frame: number): void {
  const pr = ramp(sp.primaryColor);
  const sr = ramp(sp.secondaryColor);
  switch (sp.bodyShape) {
    case 'spiky': {
      blobInto(g, CX, CY, 5.6, 5.6, pr);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5 + (frame ? Math.PI / 10 : 0);
        for (let k = 6; k <= 8; k++) {
          const x = Math.round(CX - 0.5 + Math.cos(a) * k);
          const y = Math.round(CY - 0.5 + Math.sin(a) * k);
          gs(g, x, y, k === 8 ? sr[0] : sr[2]);
          if (k === 6) {
            gs(g, Math.round(x - Math.sin(a)), Math.round(y + Math.cos(a)), sr[3]);
            gs(g, Math.round(x + Math.sin(a)), Math.round(y - Math.cos(a)), sr[1]);
          }
        }
      }
      return;
    }
    case 'ghost': {
      const inside = (x: number, y: number) => {
        const dx = x + 0.5 - CX;
        const dy = y + 0.5 - (CY - 1);
        if (dy < 0) return dx * dx + dy * dy <= 6.3 * 6.3;
        if (dy > 6) return false;
        if (Math.abs(dx) > 6.3) return false;
        // wavy hem that shifts between the two frames
        if (dy > 5) return (x + frame) % 3 !== 0;
        return true;
      };
      shadeShape(g, inside, pr, CX, CY - 1, 6.3, 7);
      return;
    }
    case 'robot': {
      const x0 = CX - 6;
      const y0 = 6;
      for (let y = y0; y < y0 + 12; y++) {
        for (let x = x0; x < x0 + 12; x++) {
          const corner = (x === x0 || x === x0 + 11) && (y === y0 || y === y0 + 11);
          if (corner) continue;
          let c = pr[2];
          if (y === y0) c = pr[0];
          else if (x === x0) c = pr[1];
          else if (x === x0 + 11) c = pr[3];
          else if (y >= y0 + 10) c = pr[4];
          else if (y === y0 + 9) c = pr[3];
          gs(g, x, y, c);
        }
      }
      for (let y = y0 + 6; y < y0 + 9; y++)
        for (let x = CX - 3; x < CX + 3; x++) gs(g, x, y, sr[2]);
      for (let x = CX - 3; x < CX + 3; x++) gs(g, x, y0 + 6, sr[1]);
      gs(g, CX - 2, y0 + 7, frame ? '#7aff8a' : sr[4]);
      gs(g, CX + 1, y0 + 7, frame ? sr[4] : '#ff6a5a');
      for (let y = y0 - 3; y < y0; y++) gs(g, CX, y, sr[3]);
      gs(g, CX, y0 - 4, frame ? '#ff6a5a' : sr[0]);
      return;
    }
    case 'bug': {
      for (const ly of [CY - 3, CY + 1, CY + 5]) {
        const off = ((ly + frame) % 2) * 1;
        gs(g, CX - 7, ly + off, sr[3]);
        gs(g, CX - 8, ly + off + 1, sr[3]);
        gs(g, CX + 6, ly + 1 - off, sr[3]);
        gs(g, CX + 7, ly + 2 - off, sr[3]);
      }
      blobInto(g, CX, CY + 0.5, 5.6, 6.6, pr);
      for (const ry of [CY - 1, CY + 3]) {
        for (let x = 0; x < EW; x++)
          if (gg(g, x, ry) && Math.abs(x + 0.5 - CX) < 5) gs(g, x, ry, pr[3]);
      }
      gs(g, CX - 2, CY - 7, sr[3]);
      gs(g, CX - 3, CY - 8, sr[3]);
      gs(g, CX - 4, CY - 9 + frame, sr[1]);
      gs(g, CX + 1, CY - 7, sr[3]);
      gs(g, CX + 2, CY - 8, sr[3]);
      gs(g, CX + 3, CY - 9 + frame, sr[1]);
      return;
    }
    case 'skull': {
      blobInto(g, CX, CY - 1, 6.2, 6, pr);
      for (let y = CY + 4; y <= CY + 6; y++) {
        for (let x = CX - 4; x <= CX + 3; x++) {
          if (y === CY + 6 && (x === CX - 4 || x === CX + 3)) continue;
          gs(g, x, y, y === CY + 4 ? pr[2] : pr[3]);
        }
      }
      // teeth gaps on the jaw
      for (let x = CX - 3; x <= CX + 2; x += 2) gs(g, x, CY + 5, pr[4]);
      gs(g, CX - 1, CY + 2, sr[4]);
      gs(g, CX, CY + 2, sr[4]);
      return;
    }
    default: {
      // blob
      blobInto(g, CX, CY + (frame ? 0.5 : 0), frame ? 7 : 6.6, frame ? 5.6 : 6.2, pr);
    }
  }
}

/** Eye positions on the grid, before mirroring. Side view looks right. */
function eyePositions(side: boolean): [number, number][] {
  return side
    ? [
        [CX + 1, CY - 2],
        [CX + 4, CY - 2],
      ]
    : [
        [CX - 4, CY - 2],
        [CX + 2, CY - 2],
      ];
}

function eyes(g: Grid, sp: EnemySpriteConfig, side: boolean): void {
  const pos = eyePositions(side);
  const K = OUT;
  if (sp.bodyShape === 'skull') {
    // dark sockets the eyes sit in
    for (const [x, y] of pos) {
      for (let yy = y - 1; yy <= y + 1; yy++)
        for (let xx = x - 1; xx <= x + 2; xx++) gs(g, xx, yy, shade(sp.secondaryColor, -0.6));
    }
  }
  pos.forEach(([x, y], i) => {
    const far = side && i === 0;
    switch (sp.eyeStyle) {
      case 'angry': {
        // red eye, pupil on the inner side, brow slanting down toward the middle
        const inner = side ? 1 : i === 0 ? 1 : 0;
        gs(g, x, y, '#ff4a4a');
        gs(g, x, y + 1, '#ff4a4a');
        if (!far) {
          gs(g, x + 1, y, '#ff4a4a');
          gs(g, x + 1, y + 1, '#ff4a4a');
          gs(g, x + inner, y + 1, K);
        } else gs(g, x, y + 1, K);
        if (far) gs(g, x, y - 1, K);
        else if (inner === 1) {
          gs(g, x, y - 2, K);
          gs(g, x + 1, y - 1, K);
        } else {
          gs(g, x + 1, y - 2, K);
          gs(g, x, y - 1, K);
        }
        break;
      }
      case 'sleepy':
        gs(g, x, y, K);
        if (!far) gs(g, x + 1, y, K);
        gs(g, x, y + 1, '#e8e4f0');
        if (!far) gs(g, x + 1, y + 1, K);
        break;
      case 'crazy':
        if (i === 0) {
          gs(g, x - 1, y - 1, '#ffff5a');
          gs(g, x, y - 1, '#ffff5a');
          gs(g, x - 1, y, '#ffff5a');
          gs(g, x, y, K);
        } else {
          gs(g, x, y, '#ffff5a');
          gs(g, x + 1, y + 1, K);
        }
        break;
      default:
        gs(g, x, y, WHITE);
        if (!far) gs(g, x + 1, y, WHITE);
        gs(g, x, y + 1, WHITE);
        if (!far) gs(g, x + 1, y + 1, K);
        else gs(g, x, y + 1, K);
    }
  });
}

function extras(g: Grid, sp: EnemySpriteConfig, dir: Direction): void {
  const sr = ramp(sp.secondaryColor);
  const pr = ramp(sp.primaryColor);
  const top = BODY_TOP[sp.bodyShape] ?? CY - 6;
  const side = dir === 'left' || dir === 'right';
  const faceDown = dir !== 'up';
  if (sp.hasScar && faceDown) {
    for (const [x, y] of [
      [CX + 2, CY - 4],
      [CX + 1, CY - 3],
      [CX, CY - 2],
      [CX - 1, CY - 1],
    ]) {
      if (gg(g, x, y)) gs(g, x, y, pr[4]);
    }
  }
  if (sp.hasTeeth && faceDown) {
    const y = sp.bodyShape === 'robot' ? 15 : CY + 3;
    const x0 = side ? CX - 1 : CX - 3;
    for (let x = x0; x < x0 + (side ? 4 : 6); x++) gs(g, x, y, x % 2 ? WHITE : '#d8d4e0');
    gs(g, x0, y + 1, WHITE);
    gs(g, x0 + (side ? 2 : 4), y + 1, WHITE);
  }
  if (sp.hasHorns) {
    for (const s of [-1, 1]) {
      const bx = CX + s * 4 - (s > 0 ? 1 : 0);
      gs(g, bx, top, sr[2]);
      gs(g, bx + s, top - 1, sr[1]);
      gs(g, bx + s, top - 2, sr[0]);
    }
  } else if (sp.hasCrown) {
    for (let x = CX - 3; x <= CX + 2; x++) gs(g, x, top - 1, x === CX - 1 ? '#ff4a4a' : '#ffd23f');
    for (const x of [CX - 3, CX - 1, CX + 2]) gs(g, x, top - 2, '#ffd23f');
    for (const x of [CX - 3, CX + 2]) gs(g, x, top - 3, '#fff0a0');
    gs(g, CX - 1, top - 3, '#fff0a0');
  }
  if (sp.hasWings) {
    for (const s of side ? [-1] : [-1, 1]) {
      const wx = s < 0 ? CX - 7 : CX + 6;
      for (let k = 0; k < 4; k++) {
        gs(g, wx + s * Math.min(k, 2), CY - 4 + k, sr[1]);
        if (k < 3) gs(g, wx + s * (k + 1), CY - 5 + k, sr[0]);
      }
    }
  }
  if (sp.hasTail) {
    const pts: [number, number][] =
      dir === 'down'
        ? [
            [CX + 6, CY + 4],
            [CX + 7, CY + 3],
            [CX + 8, CY + 2],
          ]
        : dir === 'up'
          ? [
              [CX, CY + 7],
              [CX, CY + 8],
              [CX + 1, CY + 9],
            ]
          : [
              [CX - 7, CY + 3],
              [CX - 8, CY + 2],
              [CX - 9, CY + 1],
            ];
    pts.forEach(([x, y], i) => gs(g, x, y, i === 2 ? sr[0] : sr[2]));
  }
  const acc = sp.accessory ?? 'none';
  if (acc === 'bow_tie' && faceDown) {
    const y = sp.bodyShape === 'robot' ? 17 : CY + 5;
    const map = ['#..#', '####', '#..#'];
    const x0 = side ? CX : CX - 2;
    map.forEach((row, yy) => {
      for (let xx = 0; xx < 4; xx++)
        if (row[xx] === '#') gs(g, x0 + xx, y - 1 + yy, xx === 1 || xx === 2 ? sr[3] : sr[1]);
    });
  } else if (acc === 'monocle' && faceDown) {
    const [ex, ey] = eyePositions(side)[1];
    for (const [x, y] of [
      [ex - 1, ey - 1],
      [ex, ey - 2],
      [ex + 1, ey - 2],
      [ex + 2, ey - 1],
      [ex + 2, ey],
      [ex + 2, ey + 1],
      [ex - 1, ey],
      [ex - 1, ey + 1],
      [ex, ey + 2],
      [ex + 1, ey + 2],
    ]) {
      gs(g, x, y, '#e8e8f4');
    }
    gs(g, ex + 3, ey + 2, '#ffd23f');
    gs(g, ex + 3, ey + 3, '#ffd23f');
  } else if (acc === 'bandana') {
    for (let x = 0; x < EW; x++) {
      for (const y of [top + 1, top + 2])
        if (gg(g, x, y)) gs(g, x, y, y === top + 1 ? sr[1] : sr[2]);
    }
    gs(g, CX + 6, top + 1, sr[2]);
    gs(g, CX + 7, top, sr[1]);
    gs(g, CX + 7, top + 2, sr[3]);
  }
}

function enemyGrid(sp: EnemySpriteConfig, dir: Direction, frame: number): Grid {
  const g = grid(EW, EH);
  const side = dir === 'left' || dir === 'right';
  body(g, sp, frame);
  if (dir !== 'up') eyes(g, sp, side);
  extras(g, sp, dir === 'left' ? 'right' : dir);
  outline(g);
  if (sp.hasAura) {
    const ac = shade(sp.secondaryColor, 0.3);
    for (let y = 0; y < EH; y++) {
      for (let x = 0; x < EW; x++) {
        if (gg(g, x, y)) continue;
        const r = Math.hypot(x + 0.5 - CX, y + 0.5 - CY);
        if (r > 8.6 && r < 10.2 && (x + y + frame) % 2 === 0) gs(g, x, y, ac);
      }
    }
  }
  return dir === 'left' ? flipX(g) : g;
}

export function enemySprite(
  g: CanvasRenderingContext2D,
  sp: EnemySpriteConfig,
  dir: Direction,
  frame: number,
): void {
  const key = `en:${JSON.stringify(sp)}:${dir}:${frame & 1}`;
  put(
    g,
    gridSprite(key, () => enemyGrid(sp, dir, frame & 1)),
    -CX,
    -CY - 1,
  );
}
