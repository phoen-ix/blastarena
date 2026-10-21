import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TileType } from '@blast-arena/shared';
import { makeFakeScene } from '../helpers/fakeScene';

vi.mock('phaser', () => ({
  default: {
    TintModes: { MULTIPLY: 0, FILL: 1 },
    BlendModes: { ADD: 1, NORMAL: 0 },
    Textures: { FilterMode: { NEAREST: 1 } },
  },
}));

const { StyledTileMap } = await import('../../src/game/StyledTileMap');
const { StyleArt } = await import('../../src/art/StyleArt');

/** The slice of StyleArt the tile map uses; frame names come from StyleArt's static helpers. */
function fakeArt() {
  return {
    ensureTiles: () => 'tiles',
    specialFrameCount: (tile: TileType) => (tile === 'lava' ? 4 : 1),
    specialAnim: (_w: string, tile: TileType) => `anim/${tile}`,
  } as unknown as InstanceType<typeof StyleArt>;
}

function grid(rows: string[]): TileType[][] {
  const map: Record<string, TileType> = {
    '#': 'wall',
    c: 'destructible',
    k: 'destructible_cracked',
    '.': 'empty',
    L: 'lava',
    G: 'gate_red',
  };
  return rows.map((r) => [...r].map((ch) => map[ch]));
}

const W = 1;
const N = 2;
const NW = 4;

function floorShadow(frame: string): number {
  return Number(frame.match(/s(\d+)$/)![1]);
}

describe('StyledTileMap', () => {
  let scene: ReturnType<typeof makeFakeScene>;
  beforeEach(() => {
    localStorage.clear();
    scene = makeFakeScene();
  });

  function build(rows: string[]) {
    const tiles = grid(rows);
    const map = new StyledTileMap(
      scene as never,
      fakeArt(),
      tiles,
      tiles[0].length,
      tiles.length,
      'classic',
      false,
    );
    const at = (x: number, y: number, floor = true) =>
      scene.sprites.filter(
        (s) =>
          s.active &&
          s.x === x * 48 &&
          s.y === y * 48 &&
          (floor ? s.frame.name.startsWith('f') : !s.frame.name.startsWith('f')),
      );
    return { map, at };
  }

  it('bakes the shadows of west, north and north-west blocks into floor frames', () => {
    const { at } = build(['#####', '#..c#', '#...#', '#####']);
    expect(floorShadow(at(1, 1)[0].frame.name)).toBe(W | N | NW);
    expect(floorShadow(at(2, 2)[0].frame.name)).toBe(0);
    // under the crate's east and south neighbours
    expect(floorShadow(at(3, 2)[0].frame.name) & N).toBe(N);
  });

  it('connects walls to neighbouring walls and marks the border', () => {
    const { at } = build(['###', '#.#', '###']);
    const corner = at(0, 0, false)[0];
    const variant = Number(corner.frame.name.slice(-1));
    expect(corner.frame.name).toBe(StyleArt.wallFrame(2 | 4, true, variant));
  });

  it('removes a destroyed crate, reports it, and clears the shadows it cast', () => {
    const { map, at } = build(['#####', '#.c.#', '#...#', '#####']);
    expect(floorShadow(at(3, 1)[0].frame.name) & W).toBe(W);
    expect(at(2, 1, false)).toHaveLength(1);
    const destroyed = map.applyTileDiffs([{ x: 2, y: 1, type: 'empty' }]);
    expect(destroyed).toEqual([{ x: 2, y: 1 }]);
    // the old block animates out, and nothing new replaces it
    const tween = scene.tweens.list.find((t) => t.targets === at(2, 1, false)[0]);
    expect(tween).toBeDefined();
    expect(floorShadow(at(3, 1)[0].frame.name) & W).toBe(0);
    expect(floorShadow(at(2, 2)[0].frame.name) & N).toBe(0);
  });

  it('cracks a reinforced block in place', () => {
    const { map, at } = build(['###', '#c#', '###']);
    const block = at(1, 1, false)[0];
    map.applyTileDiffs([{ x: 1, y: 1, type: 'destructible_cracked' }]);
    expect(at(1, 1, false)).toEqual([block]);
    expect(block.frame.name).toMatch(/^ck/);
  });

  it('drops in a new block and y-sorts blocks by their row', () => {
    const { map, at } = build(['#####', '#...#', '#...#', '#####']);
    map.applyTileDiffs([{ x: 2, y: 2, type: 'destructible' }]);
    const block = at(2, 2, false)[0] ?? scene.sprites.find((s) => s.frame.name.startsWith('c'))!;
    expect(block.frame.name).toMatch(/^cc/);
    expect(scene.tweens.list.some((t) => t.targets === block)).toBe(true);
    const upper = at(1, 0, false)[0];
    expect(block.depth).toBeGreaterThan(upper.depth);
  });

  it('plays the loop of an animated special tile and keeps it on the ground', () => {
    scene.anims.exists = (key: string) => key === 'anim/lava';
    const { at } = build(['###', '#L#', '###']);
    const lava = at(1, 1, false)[0];
    expect(lava.playing).toBe('anim/lava');
    expect(lava.depth).toBeLessThan(100);
  });

  it('treats a closed gate as a raised block and an opened one as ground', () => {
    const { map, at } = build(['###', '#G#', '###']);
    expect(at(1, 1, false)[0].depth).toBeGreaterThan(10000);
    map.applyTileDiffs([{ x: 1, y: 1, type: 'gate_red_open' }]);
    const open = scene.sprites.filter(
      (s) => s.active && s.frame.name.startsWith('s:gate_red_open'),
    );
    expect(open).toHaveLength(1);
    expect(open[0].depth).toBeLessThan(100);
  });
});
