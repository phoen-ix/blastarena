import { describe, it, expect } from '@jest/globals';
import { validateCustomMap } from '../../shared/src/utils/mapValidation';
import { TileType } from '../../shared/src/types/game';

function makeValidMap(width = 9, height = 9): TileType[][] {
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      tiles[y][x] = isBorder ? 'wall' : 'empty';
    }
  }
  // Place 2 spawns at interior positions
  tiles[1][1] = 'spawn';
  tiles[1][3] = 'spawn';
  return tiles;
}

describe('validateCustomMap', () => {
  it('returns no errors for a valid 9x9 map with 2 spawns', () => {
    const tiles = makeValidMap(9, 9);
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toEqual([]);
  });

  it('rejects width less than 9', () => {
    const tiles = makeValidMap(7, 9);
    const errors = validateCustomMap(tiles, 7, 9);
    expect(errors).toContain('Map width must be between 9 and 51');
  });

  it('rejects width greater than 51', () => {
    const tiles = makeValidMap(53, 9);
    const errors = validateCustomMap(tiles, 53, 9);
    expect(errors).toContain('Map width must be between 9 and 51');
  });

  it('rejects height less than 9', () => {
    const tiles = makeValidMap(9, 7);
    const errors = validateCustomMap(tiles, 9, 7);
    expect(errors).toContain('Map height must be between 9 and 51');
  });

  it('rejects height greater than 51', () => {
    const tiles = makeValidMap(9, 53);
    const errors = validateCustomMap(tiles, 9, 53);
    expect(errors).toContain('Map height must be between 9 and 51');
  });

  it('rejects even width', () => {
    const tiles = makeValidMap(10, 9);
    const errors = validateCustomMap(tiles, 10, 9);
    expect(errors).toContain('Map width must be an odd number');
  });

  it('rejects even height', () => {
    const tiles = makeValidMap(9, 10);
    const errors = validateCustomMap(tiles, 9, 10);
    expect(errors).toContain('Map height must be an odd number');
  });

  it('rejects tiles array with wrong row count', () => {
    const tiles = makeValidMap(9, 9);
    // Claim height is 11 but only provide 9 rows
    const errors = validateCustomMap(tiles, 9, 11);
    expect(errors).toContain('Tiles array has 9 rows but height is 11');
  });

  it('rejects row with wrong column count and returns early', () => {
    const tiles = makeValidMap(9, 9);
    // Shorten row 3 to 7 columns
    tiles[3] = tiles[3].slice(0, 7);
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toContain('Row 3 has 7 columns but width is 9');
    // Should return early - no further errors about tiles/spawns/etc.
    expect(errors).toHaveLength(1);
  });

  it('rejects invalid tile type', () => {
    const tiles = makeValidMap(9, 9);
    tiles[2][2] = 'lava' as TileType;
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toContain("Invalid tile type 'lava' at (2, 2)");
  });

  it('requires border tiles to be wall', () => {
    const tiles = makeValidMap(9, 9);
    // Place a non-wall tile on the top border
    tiles[0][4] = 'empty';
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toContain("Border tile at (4, 0) must be 'wall', got 'empty'");
  });

  it('requires at least 2 spawn points', () => {
    const tiles = makeValidMap(9, 9);
    // Remove one spawn so only 1 remains
    tiles[1][3] = 'empty';
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toContain('Map needs at least 2 spawn points (found 1)');
  });

  it('rejects more than 8 spawn points', () => {
    const tiles = makeValidMap(11, 11);
    // Place 9 spawns in interior positions
    const interiorPositions: [number, number][] = [
      [1, 1],
      [1, 3],
      [1, 5],
      [1, 7],
      [1, 9],
      [3, 1],
      [3, 3],
      [3, 5],
      [3, 7],
    ];
    for (const [y, x] of interiorPositions) {
      tiles[y][x] = 'spawn';
    }
    const errors = validateCustomMap(tiles, 11, 11);
    expect(errors).toContain('Map can have at most 8 spawn points (found 9)');
  });

  it('allows exactly 8 spawn points', () => {
    const tiles = makeValidMap(11, 11);
    // Place exactly 8 spawns (replace the 2 from makeValidMap)
    tiles[1][1] = 'empty';
    tiles[1][3] = 'empty';
    const positions: [number, number][] = [
      [1, 1],
      [1, 3],
      [1, 5],
      [1, 7],
      [3, 1],
      [3, 3],
      [3, 5],
      [3, 7],
    ];
    for (const [y, x] of positions) {
      tiles[y][x] = 'spawn';
    }
    const errors = validateCustomMap(tiles, 11, 11);
    expect(errors).toEqual([]);
  });

  it('rejects teleporter_a without teleporter_b', () => {
    const tiles = makeValidMap(9, 9);
    tiles[2][2] = 'teleporter_a';
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toContain('Teleporter A exists but no Teleporter B found');
  });

  it('rejects teleporter_b without teleporter_a', () => {
    const tiles = makeValidMap(9, 9);
    tiles[2][2] = 'teleporter_b';
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toContain('Teleporter B exists but no Teleporter A found');
  });

  it('accepts paired teleporters', () => {
    const tiles = makeValidMap(9, 9);
    tiles[2][2] = 'teleporter_a';
    tiles[4][4] = 'teleporter_b';
    const errors = validateCustomMap(tiles, 9, 9);
    expect(errors).toEqual([]);
  });

  it('returns multiple dimension errors simultaneously', () => {
    const tiles = makeValidMap(6, 4);
    const errors = validateCustomMap(tiles, 6, 4);
    expect(errors).toContain('Map width must be between 9 and 51');
    expect(errors).toContain('Map height must be between 9 and 51');
    expect(errors).toContain('Map width must be an odd number');
    expect(errors).toContain('Map height must be an odd number');
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});
