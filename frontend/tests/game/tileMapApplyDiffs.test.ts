import { describe, it, expect, vi } from 'vitest';
import type { TileType, TileDiff } from '@blast-arena/shared';
import { TileMapRenderer } from '../../src/game/TileMap';
import { makeFakeScene, type FakeScene } from '../helpers/fakeScene';

// TileMap only uses Phaser for types, so the import is elided at build time; this keeps the
// engine out of the test even if that ever changes.
vi.mock('phaser', () => ({ default: {} }));

/**
 * `applyTileDiffs` is the per-tick path (audit F5). It must produce exactly what the full-grid
 * `updateTiles` did for the same change — same textures, same destroyed positions — while
 * touching nothing but the listed cells.
 */

const W = 5;
const H = 5;

function grid(): TileType[][] {
  const tiles: TileType[][] = [];
  for (let y = 0; y < H; y++) {
    tiles[y] = [];
    for (let x = 0; x < W; x++) {
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      tiles[y][x] = border ? 'wall' : (x + y) % 2 === 0 ? 'destructible' : 'empty';
    }
  }
  tiles[1][3] = 'gate_red';
  tiles[3][1] = 'crumbling';
  return tiles;
}

function spriteKeys(scene: FakeScene): string[] {
  return scene.sprites.filter((s) => s.active).map((s) => `${s.x},${s.y}:${s.texture.key}`);
}

function build(): { scene: FakeScene; map: TileMapRenderer } {
  const scene = makeFakeScene();
  const map = new TileMapRenderer(scene as never, grid(), W, H);
  return { scene, map };
}

describe('TileMapRenderer.applyTileDiffs', () => {
  it('reports destroyed positions and swaps the texture of the listed cell only', () => {
    const { scene, map } = build();
    const before = scene.sprites.slice();

    const destroyed = map.applyTileDiffs([{ x: 2, y: 2, type: 'empty' }]);

    expect(destroyed).toEqual([{ x: 2, y: 2 }]);
    // With animations on, the destroyed wall is tweened out and a new floor sprite is created
    // underneath; every other sprite object is untouched.
    const created = scene.sprites.filter((s) => !before.includes(s));
    expect(created).toHaveLength(1);
    expect(created[0].x).toBe(2 * 48 + 24);
    expect(created[0].y).toBe(2 * 48 + 24);
    expect(scene.tweens.list).toHaveLength(1);
    for (const s of before) {
      if (s.x === 2 * 48 + 24 && s.y === 2 * 48 + 24) continue;
      expect(s.active).toBe(true);
    }
  });

  it('ignores diffs that change nothing and diffs outside the grid', () => {
    const { scene, map } = build();
    const before = spriteKeys(scene);

    const destroyed = map.applyTileDiffs([
      { x: 1, y: 1, type: 'destructible' }, // already destructible
      { x: 99, y: 1, type: 'empty' },
      { x: 1, y: -1, type: 'empty' },
    ]);

    expect(destroyed).toEqual([]);
    expect(spriteKeys(scene)).toEqual(before);
    expect(scene.tweens.list).toHaveLength(0);
  });

  it('returns nothing for an empty diff list', () => {
    const { map } = build();
    expect(map.applyTileDiffs([])).toEqual([]);
  });

  it('matches updateTiles() exactly for the same set of changes', () => {
    const viaDiffs = build();
    const viaFull = build();

    const diffs: TileDiff[] = [
      { x: 2, y: 2, type: 'empty' }, // destructible -> floor (destroyed)
      { x: 1, y: 1, type: 'spawn' }, // destructible -> spawn (destroyed)
      { x: 3, y: 1, type: 'gate_red_open' }, // gate opens
      { x: 1, y: 3, type: 'pit' }, // crumbling collapses
      { x: 2, y: 1, type: 'conveyor_left' }, // plain texture swap
    ];
    const full = grid();
    for (const d of diffs) full[d.y][d.x] = d.type;

    const byPos = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      a.y - b.y || a.x - b.x;
    const destroyedA = viaDiffs.map.applyTileDiffs(diffs).sort(byPos);
    const destroyedB = viaFull.map.updateTiles(full).sort(byPos);

    // Same set; the diff path reports them in diff order, the scan in grid order
    expect(destroyedA).toEqual(destroyedB);
    expect(destroyedA).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    expect(spriteKeys(viaDiffs.scene).sort()).toEqual(spriteKeys(viaFull.scene).sort());
    expect(viaDiffs.scene.tweens.list.length).toBe(viaFull.scene.tweens.list.length);
  });

  it('is idempotent — re-applying a diff already reflected in the grid is a no-op', () => {
    const { scene, map } = build();
    map.applyTileDiffs([{ x: 2, y: 2, type: 'empty' }]);
    const keys = spriteKeys(scene);
    const tweens = scene.tweens.list.length;

    expect(map.applyTileDiffs([{ x: 2, y: 2, type: 'empty' }])).toEqual([]);
    expect(spriteKeys(scene)).toEqual(keys);
    expect(scene.tweens.list.length).toBe(tweens);
  });

  it('a later full-grid sync sees the diffed cells as already current', () => {
    const { scene, map } = build();
    const full = grid();
    full[2][2] = 'empty';
    map.applyTileDiffs([{ x: 2, y: 2, type: 'empty' }]);
    const keys = spriteKeys(scene);

    expect(map.updateTiles(full)).toEqual([]);
    expect(spriteKeys(scene)).toEqual(keys);
  });
});
