import { GameMap, TileType, Position } from '@blast-arena/shared';
import {
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_WALL_DENSITY,
  SPAWN_CLEAR_RADIUS,
} from '@blast-arena/shared';

// Simple seeded random number generator
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }
}

export function generateMap(
  width: number = DEFAULT_MAP_WIDTH,
  height: number = DEFAULT_MAP_HEIGHT,
  seed?: number,
  wallDensity: number = DEFAULT_WALL_DENSITY,
  hazardTiles: string[] = [],
): GameMap {
  const mapSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const rng = new SeededRandom(mapSeed);

  // Initialize all tiles as empty
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      tiles[y][x] = 'empty';
    }
  }

  // Place indestructible walls in a grid pattern (every other cell)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Border walls
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        tiles[y][x] = 'wall';
        continue;
      }
      // Internal grid pattern: walls on even row AND even column (1-indexed inner grid)
      if (x % 2 === 0 && y % 2 === 0) {
        tiles[y][x] = 'wall';
      }
    }
  }

  // Define spawn points at corners and edges
  // Ensure mid-points are on odd coordinates to avoid indestructible wall grid
  const midX = Math.floor(width / 2) % 2 === 0 ? Math.floor(width / 2) - 1 : Math.floor(width / 2);
  const midY =
    Math.floor(height / 2) % 2 === 0 ? Math.floor(height / 2) - 1 : Math.floor(height / 2);
  const spawnPoints: Position[] = [
    { x: 1, y: 1 }, // top-left
    { x: width - 2, y: 1 }, // top-right
    { x: 1, y: height - 2 }, // bottom-left
    { x: width - 2, y: height - 2 }, // bottom-right
    { x: midX, y: 1 }, // top-center
    { x: midX, y: height - 2 }, // bottom-center
    { x: 1, y: midY }, // left-center
    { x: width - 2, y: midY }, // right-center
  ];

  // Mark spawn points
  for (const sp of spawnPoints) {
    tiles[sp.y][sp.x] = 'spawn';
  }

  // Calculate cells that must stay clear (around spawn points)
  const clearCells = new Set<string>();
  for (const sp of spawnPoints) {
    for (let dy = -SPAWN_CLEAR_RADIUS; dy <= SPAWN_CLEAR_RADIUS; dy++) {
      for (let dx = -SPAWN_CLEAR_RADIUS; dx <= SPAWN_CLEAR_RADIUS; dx++) {
        const nx = sp.x + dx;
        const ny = sp.y + dy;
        if (nx >= 1 && nx < width - 1 && ny >= 1 && ny < height - 1) {
          if (Math.abs(dx) + Math.abs(dy) <= SPAWN_CLEAR_RADIUS) {
            clearCells.add(`${nx},${ny}`);
          }
        }
      }
    }
  }

  // Place destructible walls randomly
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (tiles[y][x] !== 'empty') continue;
      if (clearCells.has(`${x},${y}`)) continue;

      if (rng.next() < wallDensity) {
        tiles[y][x] = 'destructible';
      }
    }
  }

  // Place hazard tiles in clusters
  if (hazardTiles.length > 0) {
    // Collect empty tiles not in spawn clear zones
    const emptyTiles: Position[] = [];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        if (tiles[y][x] === 'empty' && !clearCells.has(`${x},${y}`)) {
          emptyTiles.push({ x, y });
        }
      }
    }

    // Target ~4% of empty tiles as hazard, spread across selected types
    const totalBudget = Math.max(hazardTiles.length, Math.floor(emptyTiles.length * 0.04));
    const perType = Math.max(2, Math.floor(totalBudget / hazardTiles.length));

    for (const hazardType of hazardTiles) {
      const isLava = hazardType === 'lava';
      const clusterSize = isLava ? Math.min(2, perType) : Math.min(4, perType);

      // Pick a random seed tile from remaining empties
      const available = emptyTiles.filter(
        (p) => tiles[p.y][p.x] === 'empty' && !clearCells.has(`${p.x},${p.y}`),
      );
      if (available.length === 0) break;

      const seedIdx = Math.floor(rng.next() * available.length);
      const seed = available[seedIdx];
      const placed: Position[] = [];

      // Place seed tile
      const tileToPlace = hazardType === 'spikes' ? 'spikes' : hazardType;
      tiles[seed.y][seed.x] = tileToPlace as TileType;
      placed.push(seed);

      // Expand cluster via neighbors
      for (let i = 0; i < clusterSize - 1 && placed.length < clusterSize; i++) {
        const base = placed[Math.floor(rng.next() * placed.length)];
        const dirs = [
          { x: base.x + 1, y: base.y },
          { x: base.x - 1, y: base.y },
          { x: base.x, y: base.y + 1 },
          { x: base.x, y: base.y - 1 },
        ];
        // Shuffle directions
        for (let d = dirs.length - 1; d > 0; d--) {
          const j = Math.floor(rng.next() * (d + 1));
          [dirs[d], dirs[j]] = [dirs[j], dirs[d]];
        }
        for (const nb of dirs) {
          if (
            nb.x >= 1 &&
            nb.x < width - 1 &&
            nb.y >= 1 &&
            nb.y < height - 1 &&
            tiles[nb.y][nb.x] === 'empty' &&
            !clearCells.has(`${nb.x},${nb.y}`)
          ) {
            tiles[nb.y][nb.x] = tileToPlace as TileType;
            placed.push(nb);
            break;
          }
        }
      }
    }
  }

  return {
    width,
    height,
    tiles,
    spawnPoints,
    seed: mapSeed,
  };
}
