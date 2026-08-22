import { describe, it, expect } from 'vitest';
import {
  getTileTexture,
  themePrefix,
  isConveyorTile,
  conveyorAnimKey,
} from '../../src/utils/tileTextures';
import type { TileType } from '@blast-arena/shared';

/**
 * getTileTexture was duplicated verbatim in TileMap and LevelEditorScene and had begun to drift.
 * They behaved identically for every TileType, but a new tile type had to be added in two places
 * or it silently rendered as floor in one of them. This pins the single implementation against the
 * whole TileType union so the next addition cannot be half-done. (audit TILETEXTURE-DUP-1)
 */
const ALL_TILE_TYPES: TileType[] = [
  'empty',
  'wall',
  'destructible',
  'spawn',
  'destructible_cracked',
  'teleporter_a',
  'teleporter_b',
  'conveyor_up',
  'conveyor_down',
  'conveyor_left',
  'conveyor_right',
  'exit',
  'goal',
  'switch_red',
  'switch_blue',
  'switch_green',
  'switch_yellow',
  'switch_red_active',
  'switch_blue_active',
  'switch_green_active',
  'switch_yellow_active',
  'gate_red',
  'gate_blue',
  'gate_green',
  'gate_yellow',
  'gate_red_open',
  'gate_blue_open',
  'gate_green_open',
  'gate_yellow_open',
  'crumbling',
  'pit',
  'vine',
  'quicksand',
  'ice',
  'lava',
  'mud',
  'spikes',
  'spikes_active',
  'dark_rift',
];

/** Tiles with no themed artwork — the key is the tile type itself, whatever the theme. */
const THEME_INDEPENDENT: TileType[] = [
  'pit',
  'vine',
  'quicksand',
  'ice',
  'lava',
  'mud',
  'spikes',
  'spikes_active',
  'dark_rift',
];

/** Tiles that render as floor rather than as themselves. */
const FLOOR_LIKE: TileType[] = ['empty', 'spawn'];

describe('themePrefix', () => {
  it('is empty for no theme and for classic', () => {
    expect(themePrefix(undefined)).toBe('');
    expect(themePrefix('')).toBe('');
    expect(themePrefix('classic')).toBe('');
  });

  it('is themed_ for any other theme', () => {
    expect(themePrefix('forest')).toBe('themed_');
    expect(themePrefix('volcano')).toBe('themed_');
  });
});

describe('getTileTexture', () => {
  it('returns a non-empty key for every tile type, themed and unthemed', () => {
    for (const type of ALL_TILE_TYPES) {
      for (const theme of [undefined, 'classic', 'forest']) {
        expect(getTileTexture(type, 0, 0, theme)).toBeTruthy();
      }
    }
  });

  it('prefixes themed variants, except where no themed artwork exists', () => {
    for (const type of ALL_TILE_TYPES) {
      const themed = getTileTexture(type, 0, 0, 'forest');
      if (THEME_INDEPENDENT.includes(type)) {
        expect(themed).toBe(type);
      } else {
        expect(themed.startsWith('themed_')).toBe(true);
      }
    }
  });

  it('treats classic exactly like no theme', () => {
    for (const type of ALL_TILE_TYPES) {
      expect(getTileTexture(type, 1, 2, 'classic')).toBe(getTileTexture(type, 1, 2, undefined));
    }
  });

  it('maps most tiles to their own name when unthemed', () => {
    for (const type of ALL_TILE_TYPES) {
      if (FLOOR_LIKE.includes(type)) continue;
      expect(getTileTexture(type, 0, 0, undefined)).toBe(type);
    }
  });

  it('varies floor tiles on (x + y) % 4', () => {
    for (const type of FLOOR_LIKE) {
      expect(getTileTexture(type, 0, 0)).toBe('floor_0');
      expect(getTileTexture(type, 1, 0)).toBe('floor_1');
      expect(getTileTexture(type, 2, 1)).toBe('floor_3');
      expect(getTileTexture(type, 2, 2)).toBe('floor_0'); // wraps
      expect(getTileTexture(type, 0, 0, 'forest')).toBe('themed_floor_0');
    }
  });

  it('falls back to floor for an unknown tile type', () => {
    expect(getTileTexture('not_a_tile' as TileType, 1, 1)).toBe('floor_2');
  });
});

describe('conveyor helpers', () => {
  it('recognises exactly the four conveyor directions', () => {
    const conveyors = ALL_TILE_TYPES.filter((t) => t.startsWith('conveyor_'));
    expect(conveyors).toHaveLength(4);
    for (const t of ALL_TILE_TYPES) {
      expect(isConveyorTile(t)).toBe(conveyors.includes(t));
    }
  });

  it('tolerates undefined', () => {
    expect(isConveyorTile(undefined)).toBe(false);
  });

  it('builds the animation key with the theme prefix', () => {
    expect(conveyorAnimKey('conveyor_up')).toBe('conveyor_up_anim');
    expect(conveyorAnimKey('conveyor_up', 'classic')).toBe('conveyor_up_anim');
    expect(conveyorAnimKey('conveyor_left', 'forest')).toBe('themed_conveyor_left_anim');
  });
});
