import { describe, it, expect } from '@jest/globals';
import { generateMap } from '../../../backend/src/game/Map';

describe('Map Generation', () => {
  it('should generate a map with correct dimensions', () => {
    const map = generateMap(15, 13, 12345);
    expect(map.width).toBe(15);
    expect(map.height).toBe(13);
    expect(map.tiles.length).toBe(13);
    expect(map.tiles[0].length).toBe(15);
  });

  it('should have walls on borders', () => {
    const map = generateMap(15, 13, 12345);
    for (let x = 0; x < 15; x++) {
      expect(map.tiles[0][x]).toBe('wall');
      expect(map.tiles[12][x]).toBe('wall');
    }
    for (let y = 0; y < 13; y++) {
      expect(map.tiles[y][0]).toBe('wall');
      expect(map.tiles[y][14]).toBe('wall');
    }
  });

  it('should have indestructible walls in grid pattern', () => {
    const map = generateMap(15, 13, 12345);
    for (let y = 2; y < 12; y += 2) {
      for (let x = 2; x < 14; x += 2) {
        expect(map.tiles[y][x]).toBe('wall');
      }
    }
  });

  it('should have spawn points', () => {
    const map = generateMap(15, 13, 12345);
    expect(map.spawnPoints.length).toBeGreaterThanOrEqual(4);
  });

  it('should clear area around spawn points', () => {
    const map = generateMap(15, 13, 12345);
    // Check first spawn point (1,1) - adjacent cells should be clear
    const sp = map.spawnPoints[0];
    expect(map.tiles[sp.y][sp.x]).toBe('spawn');
    // Adjacent cells should not be destructible
    const adjacent = [
      { x: sp.x + 1, y: sp.y },
      { x: sp.x, y: sp.y + 1 },
    ];
    for (const a of adjacent) {
      if (a.x > 0 && a.x < 14 && a.y > 0 && a.y < 12) {
        expect(map.tiles[a.y][a.x]).not.toBe('destructible');
      }
    }
  });

  it('should be deterministic with same seed', () => {
    const map1 = generateMap(15, 13, 42);
    const map2 = generateMap(15, 13, 42);
    expect(map1.tiles).toEqual(map2.tiles);
    expect(map1.seed).toEqual(map2.seed);
  });

  it('should produce different maps with different seeds', () => {
    const map1 = generateMap(15, 13, 1);
    const map2 = generateMap(15, 13, 2);
    // Maps should differ in at least some destructible wall placements
    let differences = 0;
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 15; x++) {
        if (map1.tiles[y][x] !== map2.tiles[y][x]) differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('should handle minimum map size (9x9)', () => {
    const map = generateMap(9, 9, 100);
    expect(map.width).toBe(9);
    expect(map.height).toBe(9);
    expect(map.tiles.length).toBe(9);
    expect(map.tiles[0].length).toBe(9);
    expect(map.spawnPoints.length).toBeGreaterThanOrEqual(4);
  });

  it('should handle maximum map size (51x51)', () => {
    const map = generateMap(51, 51, 200);
    expect(map.width).toBe(51);
    expect(map.height).toBe(51);
    expect(map.tiles.length).toBe(51);
    expect(map.tiles[0].length).toBe(51);
    expect(map.spawnPoints.length).toBeGreaterThanOrEqual(4);
  });

  it('should generate more walls with higher wallDensity', () => {
    const lowDensity = generateMap(15, 13, 42, 0.2);
    const highDensity = generateMap(15, 13, 42, 0.8);

    let lowCount = 0;
    let highCount = 0;
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 15; x++) {
        if (lowDensity.tiles[y][x] === 'destructible') lowCount++;
        if (highDensity.tiles[y][x] === 'destructible') highCount++;
      }
    }
    expect(highCount).toBeGreaterThan(lowCount);
  });

  it('should generate fewer walls with wallDensity 0', () => {
    const map = generateMap(15, 13, 42, 0);

    let destructibleCount = 0;
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 15; x++) {
        if (map.tiles[y][x] === 'destructible') destructibleCount++;
      }
    }
    expect(destructibleCount).toBe(0);
  });

  it('should include hazard tiles when hazardTiles array is non-empty', () => {
    const map = generateMap(15, 13, 42, 0.3, ['lava', 'ice']);

    let hazardCount = 0;
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 15; x++) {
        const tile = map.tiles[y][x];
        if (tile === 'lava' || tile === 'ice') hazardCount++;
      }
    }
    expect(hazardCount).toBeGreaterThan(0);
  });

  it('should not place hazard tiles on spawn points', () => {
    const map = generateMap(15, 13, 42, 0.3, ['lava', 'ice', 'spikes']);

    for (const sp of map.spawnPoints) {
      expect(map.tiles[sp.y][sp.x]).toBe('spawn');
    }
  });

  it('should not place hazard tiles on indestructible walls', () => {
    const map = generateMap(15, 13, 42, 0.3, ['lava', 'ice', 'spikes']);

    // Border walls remain walls
    for (let x = 0; x < 15; x++) {
      expect(map.tiles[0][x]).toBe('wall');
      expect(map.tiles[12][x]).toBe('wall');
    }
    for (let y = 0; y < 13; y++) {
      expect(map.tiles[y][0]).toBe('wall');
      expect(map.tiles[y][14]).toBe('wall');
    }
    // Internal grid pattern walls remain walls
    for (let y = 2; y < 12; y += 2) {
      for (let x = 2; x < 14; x += 2) {
        expect(map.tiles[y][x]).toBe('wall');
      }
    }
  });

  it('should have borders that are all wall tiles', () => {
    const sizes = [
      { w: 9, h: 9 },
      { w: 15, h: 13 },
      { w: 21, h: 17 },
      { w: 51, h: 51 },
    ];

    for (const { w, h } of sizes) {
      const map = generateMap(w, h, 99);
      // Top and bottom borders
      for (let x = 0; x < w; x++) {
        expect(map.tiles[0][x]).toBe('wall');
        expect(map.tiles[h - 1][x]).toBe('wall');
      }
      // Left and right borders
      for (let y = 0; y < h; y++) {
        expect(map.tiles[y][0]).toBe('wall');
        expect(map.tiles[y][w - 1]).toBe('wall');
      }
    }
  });
});
