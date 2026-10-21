import { getSettings } from './Settings';
import type { MarkerShape } from '../art/painters/types';

/**
 * Player and team colours, standard or colour-blind safe (Settings → Color-blind friendly).
 * The safe set follows the Okabe–Ito palette, which stays distinct under the common forms of
 * colour blindness, with light grey in place of its black so it shows on dark floors. With it on,
 * every player also carries a shape marker, so no one has to tell players apart by colour alone.
 */

/** The original colours; Classic's player textures `player_{i}_{dir}` are drawn in these. */
export const STANDARD_PLAYER_COLORS = [
  0xe94560, 0x44aaff, 0x44ff44, 0xff8800, 0xcc44ff, 0xffff44, 0xff44ff, 0x44ffff,
];

export const COLOR_BLIND_PLAYER_COLORS = [
  0xe69f00, 0x56b4e9, 0x009e73, 0xf0e442, 0xcc79a7, 0x0072b2, 0xd55e00, 0xe8e8e8,
];

const STANDARD_TEAMS = ['#ff4466', '#448aff'];
const COLOR_BLIND_TEAMS = ['#e69f00', '#56b4e9'];

/** Lighter team colours for text on dark backgrounds (name labels). */
const STANDARD_TEAM_TEXT = ['#ff6b7f', '#6bb8ff'];
const COLOR_BLIND_TEAM_TEXT = ['#ffc04d', '#9ad3f5'];

/** Which player colours each team uses: warm for team 0, cool for team 1. */
const STANDARD_TEAM_INDICES: Record<number, number[]> = {
  0: [0, 3, 5],
  1: [1, 7, 4],
};
const COLOR_BLIND_TEAM_INDICES: Record<number, number[]> = {
  0: [0, 6, 3],
  1: [1, 5, 2],
};

export const MARKER_SHAPES: readonly MarkerShape[] = [
  'circle',
  'triangle',
  'square',
  'diamond',
  'star',
  'plus',
  'hex',
  'heart',
];

export function colorBlindMode(): boolean {
  return getSettings().colorBlind;
}

function wrap<T>(list: readonly T[], i: number): T {
  return list[((i % list.length) + list.length) % list.length];
}

/** Colour of player colour index `i` in the active palette. */
export function playerColor(i: number): number {
  return wrap(colorBlindMode() ? COLOR_BLIND_PLAYER_COLORS : STANDARD_PLAYER_COLORS, i);
}

/** CSS colour of team `team` (0 or 1). */
export function teamColor(team: number): string {
  return wrap(colorBlindMode() ? COLOR_BLIND_TEAMS : STANDARD_TEAMS, team);
}

/** Team colour for text over the arena. */
export function teamTextColor(team: number): string {
  return wrap(colorBlindMode() ? COLOR_BLIND_TEAM_TEXT : STANDARD_TEAM_TEXT, team);
}

/** Player colour indices handed out to team `team`, in order. */
export function teamColorIndices(team: number): number[] {
  const table = colorBlindMode() ? COLOR_BLIND_TEAM_INDICES : STANDARD_TEAM_INDICES;
  return table[team] ?? table[0];
}

/** Shape marker for player colour index `i`. */
export function markerShape(i: number): MarkerShape {
  return wrap(MARKER_SHAPES, i);
}

/**
 * Trace `shape`, `r` units in radius around (0, 0), as a closed path on anything with the
 * Canvas 2D path methods (a Canvas 2D context or a Phaser Graphics).
 */
export function traceMarker(
  g: {
    beginPath(): unknown;
    moveTo(x: number, y: number): unknown;
    lineTo(x: number, y: number): unknown;
    closePath(): unknown;
  },
  shape: MarkerShape,
  r: number,
): void {
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.closePath();
  };
  const ring = (n: number, radius: (i: number) => number, start = -Math.PI / 2) =>
    poly(
      Array.from({ length: n }, (_, i) => {
        const a = start + (i * Math.PI * 2) / n;
        return [Math.cos(a) * radius(i), Math.sin(a) * radius(i)] as [number, number];
      }),
    );
  switch (shape) {
    case 'circle':
      ring(20, () => r);
      break;
    case 'triangle':
      ring(3, () => r * 1.15, -Math.PI / 2);
      break;
    case 'square':
      ring(4, () => r * 1.1, -Math.PI / 4);
      break;
    case 'diamond':
      ring(4, () => r * 1.15);
      break;
    case 'star':
      ring(10, (i) => (i % 2 === 0 ? r * 1.2 : r * 0.5));
      break;
    case 'plus': {
      const a = r * 0.38;
      const b = r;
      poly([
        [-a, -b],
        [a, -b],
        [a, -a],
        [b, -a],
        [b, a],
        [a, a],
        [a, b],
        [-a, b],
        [-a, a],
        [-b, a],
        [-b, -a],
        [-a, -a],
      ]);
      break;
    }
    case 'hex':
      ring(6, () => r * 1.05, 0);
      break;
    case 'heart': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        pts.push([(x / 16) * r * 1.1, (y / 16) * r * 1.1 + r * 0.1]);
      }
      poly(pts);
      break;
    }
  }
}
