/**
 * Shared look for the Toy Diorama style: a tabletop diorama under warm daylight. Blocks have a
 * raised top face (3/4 view), shadows fall to the bottom right, everything has a warm dark ink
 * outline and matte, lightly cel-shaded colours.
 */
import type { World } from '../../painters/types';

export type G = CanvasRenderingContext2D;

/** Units a block's top face is raised above its tile. */
export const RAISE = 11;
export const INK = '#2a2033';
export const OUT = 1.6;
export const CREAM = '#fff4e2';

export function st(g: G, c: string = INK, w: number = OUT): void {
  g.strokeStyle = c;
  g.lineWidth = w;
  g.stroke();
}

export function fl(g: G, c: string): void {
  g.fillStyle = c;
  g.fill();
}

/** Stroke a polyline given as flat [x0, y0, x1, y1, ...]. */
export function seg(g: G, pts: number[], c: string, w: number): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.strokeStyle = c;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();
}

export function ell(g: G, x: number, y: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
}

export type Pal = Record<string, string>;

/** Per-world colours. Every world defines the keys its own painters read. */
export const W: Record<World, Pal> = {
  classic: {
    floorA: '#d8cdb0',
    floorB: '#cdc1a3',
    grout: '#8fa26a',
    wallTop: '#8f99b8',
    wallFront: '#58617f',
    wallHi: '#c6cee6',
    crateTop: '#d6964f',
    crateFront: '#a2622b',
    crateHi: '#f2c48a',
    crateLine: '#7f4a1f',
    crateTrim: '#6f3d18',
    nail: '#f6dfb2',
    shadow: '#28122a',
  },
  forest: {
    floorA: '#7cb153',
    floorB: '#72a64a',
    grout: '#5d8f3b',
    wallTop: '#8f958b',
    wallFront: '#5c6258',
    wallHi: '#bcc1b5',
    moss: '#4f8f33',
    mossHi: '#7cc04e',
    bark: '#7b5331',
    barkDark: '#553820',
    logEnd: '#e0bb83',
    logRing: '#a77c4a',
    shadow: '#16300c',
  },
  desert: {
    floorA: '#ecd29a',
    floorB: '#e5c88b',
    grout: '#cfa968',
    ripple: '#c9a15e',
    wallTop: '#dcab6a',
    wallFront: '#a86f3c',
    wallHi: '#f7dcab',
    strata: '#b9824a',
    crateTop: '#d9784b',
    crateFront: '#9c4528',
    crateHi: '#f6ab80',
    paint: '#fff0d2',
    shadow: '#5a3214',
  },
  ice: {
    floorA: '#eef4fb',
    floorB: '#e1eaf6',
    grout: '#c4d5ea',
    wallTop: '#f8fbff',
    wallFront: '#a7c1e2',
    wallHi: '#ffffff',
    icicle: '#dff1ff',
    crateTop: '#a9e4ff',
    crateFront: '#5aa9db',
    crateHi: '#eafaff',
    shadow: '#2c4a78',
  },
  volcano: {
    floorA: '#3f3132',
    floorB: '#382b2c',
    grout: '#231819',
    wallTop: '#4d3e42',
    wallFront: '#2a2023',
    wallHi: '#715e63',
    seam: '#ff7a2e',
    crateTop: '#5e3d2c',
    crateFront: '#38231a',
    crateHi: '#7d5640',
    ember: '#ff6a2a',
    shadow: '#000000',
  },
  void: {
    floorA: '#2b2244',
    floorB: '#261d3c',
    grout: '#140e24',
    wallTop: '#4f3d80',
    wallFront: '#2b1f4e',
    wallHi: '#a08ae6',
    glowLine: '#c4a2ff',
    crateTop: '#5d5773',
    crateFront: '#37324a',
    crateHi: '#8d87a6',
    rune: '#c08cff',
    shadow: '#000000',
  },
  castle: {
    floorA: '#908c97',
    floorB: '#87838e',
    grout: '#5d5965',
    wallTop: '#aca7b3',
    wallFront: '#736e7c',
    wallHi: '#d3cfda',
    brick: '#5b5663',
    barrel: '#93603a',
    barrelDark: '#5f3a1d',
    barrelHi: '#b98154',
    hoop: '#8e97a3',
    shadow: '#1e1a26',
  },
  swamp: {
    floorA: '#66733f',
    floorB: '#5e6b39',
    grout: '#414d28',
    puddle: '#2f4743',
    wallTop: '#6f7c69',
    wallFront: '#465041',
    wallHi: '#a0ad97',
    moss: '#58752f',
    mossHi: '#86a64a',
    crateTop: '#7d7249',
    crateFront: '#4f492d',
    crateHi: '#a29a6c',
    crateLine: '#3d3820',
    fungus: '#c2c97a',
    shadow: '#141a0a',
  },
  sky: {
    floorA: '#d2e8fc',
    floorB: '#c6dff8',
    grout: '#a3c5ea',
    wallTop: '#ffffff',
    wallFront: '#c7d3ea',
    wallHi: '#ffffff',
    trim: '#f0c25a',
    crateTop: '#f3dcaa',
    crateFront: '#c79f62',
    crateHi: '#fff3d6',
    crateLine: '#a7814a',
    shadow: '#33507a',
  },
};

export function pal(world: World): Pal {
  return W[world] ?? W.classic;
}
