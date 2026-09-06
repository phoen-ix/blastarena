import { describe, it, expect, beforeEach } from 'vitest';
import type { TileType } from '@blast-arena/shared';
import {
  MinimapTerrain,
  minimapTileColor,
  MINIMAP_DEFAULT_COLOR,
  MINIMAP_TILE_COLORS,
  type MinimapFillContext,
} from '../../src/game/minimapTerrain';

/**
 * The HUD minimap's terrain layer is painted once and then patched per tile diff (audit F1).
 * A recording context stands in for the canvas so the test can see exactly which cells were
 * painted, and with what.
 */

interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

class RecordingContext implements MinimapFillContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  fills: Fill[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ x, y, w, h, color: String(this.fillStyle) });
  }
}

const W = 4;
const H = 3;
const TS = 5;

function grid(): TileType[][] {
  return [
    ['wall', 'wall', 'wall', 'wall'],
    ['wall', 'empty', 'destructible', 'wall'],
    ['wall', 'lava', 'ice', 'wall'],
  ];
}

let ctx: RecordingContext;
let terrain: MinimapTerrain;

beforeEach(() => {
  ctx = new RecordingContext();
  terrain = new MinimapTerrain(ctx, grid(), W, H, TS);
});

describe('minimapTileColor', () => {
  it('maps the listed tile types and falls back to the floor colour', () => {
    expect(minimapTileColor('wall')).toBe(MINIMAP_TILE_COLORS.wall);
    expect(minimapTileColor('lava')).toBe('#cc3300');
    expect(minimapTileColor('empty')).toBe(MINIMAP_DEFAULT_COLOR);
    expect(minimapTileColor('switch_red')).toBe(MINIMAP_DEFAULT_COLOR);
    expect(minimapTileColor('teleporter_a')).toBe(MINIMAP_DEFAULT_COLOR);
  });
});

describe('MinimapTerrain', () => {
  it('paints every cell once on construction, scaled by the tile size', () => {
    expect(ctx.fills).toHaveLength(W * H);
    expect(ctx.fills[0]).toEqual({ x: 0, y: 0, w: TS, h: TS, color: minimapTileColor('wall') });
    // (2,1) is destructible
    const cell = ctx.fills.find((f) => f.x === 2 * TS && f.y === 1 * TS);
    expect(cell?.color).toBe(minimapTileColor('destructible'));
    expect(terrain.matches(W, H)).toBe(true);
    expect(terrain.matches(W + 1, H)).toBe(false);
  });

  it('applyDiffs repaints only the cells that actually change', () => {
    ctx.fills = [];
    const painted = terrain.applyDiffs([
      { x: 2, y: 1, type: 'empty' }, // destructible destroyed
      { x: 1, y: 1, type: 'empty' }, // already empty — no paint
      { x: 9, y: 9, type: 'wall' }, // out of range — ignored
    ]);
    expect(painted).toBe(1);
    expect(ctx.fills).toEqual([
      { x: 2 * TS, y: 1 * TS, w: TS, h: TS, color: MINIMAP_DEFAULT_COLOR },
    ]);
    expect(terrain.tileAt(2, 1)).toBe('empty');
    expect(terrain.tileAt(1, 1)).toBe('empty');
  });

  it('does not copy the caller’s grid by reference', () => {
    const tiles = grid();
    const own = new MinimapTerrain(new RecordingContext(), tiles, W, H, TS);
    tiles[1][1] = 'lava';
    expect(own.tileAt(1, 1)).toBe('empty');
  });

  it('sync repaints exactly the cells that differ from the last known grid', () => {
    ctx.fills = [];
    const next = grid();
    next[1][2] = 'destructible_cracked';
    next[2][1] = 'empty';
    const painted = terrain.sync(next);
    expect(painted).toBe(2);
    expect(ctx.fills.map((f) => [f.x / TS, f.y / TS, f.color])).toEqual([
      [2, 1, minimapTileColor('destructible_cracked')],
      [1, 2, MINIMAP_DEFAULT_COLOR],
    ]);
    // A second sync with the same grid is free
    ctx.fills = [];
    expect(terrain.sync(next)).toBe(0);
    expect(ctx.fills).toEqual([]);
  });

  it('sync tolerates a short or ragged incoming grid', () => {
    ctx.fills = [];
    expect(terrain.sync([['lava']])).toBe(1);
    expect(ctx.fills).toEqual([{ x: 0, y: 0, w: TS, h: TS, color: minimapTileColor('lava') }]);
  });
});
