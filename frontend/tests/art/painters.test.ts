import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { PowerUpType, TileType } from '@blast-arena/shared';
import { neonPainters } from '../../src/art/styles/neon/painters';
import { toyPainters } from '../../src/art/styles/toy/painters';
import { SPECIAL_TILES } from '../../src/art/painters/types';
import { PU_TYPES, setPaintScale } from '../../src/art/paint';
import type { StylePainters, World, FxKind } from '../../src/art/painters/types';

/**
 * Smoke tests for the drawn art styles: every painter is run over every option the game bakes,
 * against a context that accepts any drawing call. They catch runtime errors (a missing world, a
 * typo'd tile branch) and painters that draw nothing; the look itself is checked by eye.
 */

const WORLDS: World[] = [
  'classic',
  'forest',
  'desert',
  'ice',
  'volcano',
  'void',
  'castle',
  'swamp',
  'sky',
];
const FX: FxKind[] = [
  'spark',
  'smoke',
  'dust',
  'star',
  'ember',
  'snow',
  'firefly',
  'mote',
  'glow',
  'ring',
  'localRing',
  'teamRing',
];
const DRAWS = new Set([
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'drawImage',
  'fillText',
  'strokeText',
  'putImageData',
]);

function fakeContext(): { ctx: CanvasRenderingContext2D; draws: () => number } {
  let draws = 0;
  const gradient = { addColorStop() {} };
  const target: Record<string, unknown> = {
    canvas: { width: 96, height: 96 },
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => ({}),
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
  };
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        if (DRAWS.has(prop)) draws++;
        void args;
      };
    },
    set(t, prop: string, value) {
      t[prop] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws: () => draws };
}

function run(name: string, paint: (g: CanvasRenderingContext2D) => void): void {
  const { ctx, draws } = fakeContext();
  try {
    paint(ctx);
  } catch (err) {
    throw new Error(`${name} threw: ${(err as Error).stack ?? err}`);
  }
  if (draws() === 0) throw new Error(`${name} drew nothing`);
}

const STYLES: StylePainters[] = [toyPainters, neonPainters];

beforeAll(() => {
  // jsdom has no 2D canvas; the painters' sprite caches then draw directly.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

describe.each(STYLES.map((p) => [p.id, p] as const))('%s painters', (_id, P) => {
  it('declare sane frame counts and metadata', () => {
    expect(P.flameFrames).toBeGreaterThanOrEqual(4);
    expect(P.powerUpFrames).toBeGreaterThanOrEqual(1);
    expect(P.fuseFrames).toBeGreaterThanOrEqual(1);
    expect(P.blockHeight).toBeGreaterThanOrEqual(0);
    for (const tile of SPECIAL_TILES) {
      const n = P.specialFrames(tile);
      expect(Number.isInteger(n) && n >= 1 && n <= 12, `${tile}: ${n} frames`).toBe(true);
      expect(P.specialLoopSeconds(tile)).toBeGreaterThan(0);
    }
    for (const key of Object.keys(P.palette) as (keyof typeof P.palette)[]) {
      expect(P.palette[key], key).toMatch(/^#[0-9a-f]{6}/i);
    }
  });

  it('paint every tile in every world', () => {
    setPaintScale(P.pixel ? 1 / P.pixel : 1);
    for (const world of WORLDS) {
      for (let variant = 0; variant < 8; variant++) {
        run(`floor ${world} ${variant}`, (g) =>
          P.floor(g, { world, variant, parity: (variant & 1) as 0 | 1 }),
        );
      }
      run(`shadow ${world}`, (g) => P.blockShadow(g, { world }));
      for (let mask = 0; mask < 16; mask++) {
        run(`wall ${world} ${mask}`, (g) =>
          P.wall(g, { world, mask, border: mask === 6, variant: mask % 4 }),
        );
      }
      for (const kind of ['crate', 'cracked'] as const) {
        run(`crate ${world} ${kind}`, (g) => P.crate(g, { world, kind, variant: 1 }));
        for (const variant of [0, 1, 2] as const) {
          run(`chunk ${world} ${kind}`, (g) => P.chunk(g, { world, kind, variant }));
        }
      }
      for (const tile of SPECIAL_TILES as TileType[]) {
        const n = P.specialFrames(tile);
        for (let i = 0; i < n; i++) {
          run(`special ${world} ${tile} ${i}`, (g) => P.special(g, { world, tile, phase: i / n }));
        }
      }
    }
  });

  it('paint every character, bomb, flame, pickup and effect', () => {
    setPaintScale(P.pixel ? 1 / P.pixel : 1);
    for (const dir of ['down', 'up', 'left', 'right'] as const) {
      for (const eyes of ['default', 'angry', 'cyclops', 'dot'] as const) {
        run(`player ${dir} ${eyes}`, (g) =>
          P.player(g, { color: '#e94560', eyes, dir, pose: { kind: 'idle', blink: false } }),
        );
        run(`player blink ${dir}`, (g) =>
          P.player(g, { color: '#44aaff', eyes, dir, pose: { kind: 'idle', blink: true } }),
        );
      }
      for (const step of [0, 1, 2, 3] as const) {
        run(`player walk ${dir} ${step}`, (g) =>
          P.player(g, { color: '#222233', eyes: 'default', dir, pose: { kind: 'walk', step } }),
        );
      }
      for (const bodyShape of ['blob', 'spiky', 'ghost', 'robot', 'bug', 'skull'] as const) {
        for (const eyeStyle of ['round', 'angry', 'sleepy', 'crazy'] as const) {
          run(`enemy ${bodyShape} ${eyeStyle} ${dir}`, (g) =>
            P.enemy(g, {
              sprite: {
                bodyShape,
                primaryColor: '#44cc44',
                secondaryColor: '#000000',
                eyeStyle,
                hasTeeth: true,
                hasHorns: true,
                hasTail: true,
                hasAura: true,
                hasCrown: true,
                hasScar: true,
                hasWings: true,
                accessory: 'monocle',
              },
              dir,
              frame: 1,
            }),
          );
        }
      }
    }
    run('ghost', (g) => P.ghost(g, { color: '#ffff44' }));
    for (const type of ['normal', 'pierce', 'remote'] as const) {
      for (let i = 0; i < P.fuseFrames; i++) {
        run(`bomb ${type} ${i}`, (g) =>
          P.bomb(g, {
            type,
            fuse: 1 - i / Math.max(1, P.fuseFrames - 1),
            spark: (i & 1) as 0 | 1,
            hot: false,
          }),
        );
      }
      run(`bomb ${type} hot`, (g) => P.bomb(g, { type, fuse: 0.02, spark: 1, hot: true }));
      run(`band ${type}`, (g) => P.bombBand(g, { type }));
    }
    for (const piece of ['center', 'arm', 'end'] as const) {
      for (const dir of ['down', 'up', 'left', 'right'] as const) {
        for (let frame = 0; frame < P.flameFrames; frame++) {
          for (const pierce of [false, true]) {
            run(`flame ${piece} ${dir} ${frame}`, (g) =>
              P.flame(g, { piece, dir, frame, frames: P.flameFrames, pierce }),
            );
          }
        }
      }
    }
    for (const type of PU_TYPES as PowerUpType[]) {
      for (let frame = 0; frame < P.powerUpFrames; frame++) {
        run(`powerUp ${type} ${frame}`, (g) =>
          P.powerUp(g, { type, frame, frames: P.powerUpFrames }),
        );
      }
    }
    for (let frame = 0; frame < 4; frame++) run(`shield ${frame}`, (g) => P.shield(g, { frame }));
    for (const kind of FX) run(`fx ${kind}`, (g) => P.fx(g, { kind }));
    for (const variant of [0, 1, 2, 3] as const)
      run(`scorch ${variant}`, (g) => P.scorch(g, { variant }));
    run('meteor', (g) => P.meteor(g));
  });

  it('is deterministic (same options, same drawing calls)', () => {
    const record = () => {
      const calls: string[] = [];
      const ctx = new Proxy({} as Record<string, unknown>, {
        get(t, prop: string) {
          if (prop === 'canvas') return { width: 96, height: 96 };
          if (prop.startsWith('create')) return () => ({ addColorStop() {} });
          if (prop === 'measureText') return () => ({ width: 10 });
          if (prop === 'getImageData' || prop === 'createImageData')
            return (_a: number, _b: number, w = 1, h = 1) => ({
              data: new Uint8ClampedArray(4 * w * h),
              width: w,
              height: h,
            });
          if (prop === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
          if (prop in t) return t[prop];
          return (...args: unknown[]) => calls.push(prop + JSON.stringify(args));
        },
        set(t, prop: string, value) {
          t[prop] = value;
          calls.push(`${prop}=${JSON.stringify(value)}`);
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      P.player(ctx, {
        color: '#e94560',
        eyes: 'default',
        dir: 'left',
        pose: { kind: 'walk', step: 2 },
      });
      P.special(ctx, { world: 'volcano', tile: 'lava', phase: 0.25 });
      P.flame(ctx, { piece: 'arm', dir: 'right', frame: 3, frames: P.flameFrames, pierce: false });
      return calls.join('\n');
    };
    expect(record()).toBe(record());
  });
});
