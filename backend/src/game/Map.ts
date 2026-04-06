import { GameMap, TileType, Position } from '@blast-arena/shared';
import { PuzzleConfig, PuzzleColor } from '@blast-arena/shared';
import {
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_WALL_DENSITY,
  SPAWN_CLEAR_RADIUS,
  wrapX,
  wrapY,
} from '@blast-arena/shared';
import { PUZZLE_COLORS, getSwitchTile, getGateTile } from '@blast-arena/shared';

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
  puzzleTiles: string[] = [],
  wrapping: boolean = false,
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
      if (!wrapping) {
        // Border walls for non-wrapping maps
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          tiles[y][x] = 'wall';
          continue;
        }
      }
      // Internal grid pattern: walls on even row AND even column
      // For wrapping maps with odd dimensions, skip last even col/row
      // to avoid double-walls at the wrapping seam (x=width-1 adjacent to x=0)
      if (x % 2 === 0 && y % 2 === 0) {
        if (wrapping && (x === width - 1 || y === height - 1)) continue;
        tiles[y][x] = 'wall';
      }
    }
  }

  let spawnPoints: Position[];
  if (wrapping) {
    // Distribute spawn points evenly across the wrapping map on odd coordinates
    spawnPoints = generateWrappingSpawns(width, height);
  } else {
    // Define spawn points at corners and edges
    // Ensure mid-points are on odd coordinates to avoid indestructible wall grid
    const midX =
      Math.floor(width / 2) % 2 === 0 ? Math.floor(width / 2) - 1 : Math.floor(width / 2);
    const midY =
      Math.floor(height / 2) % 2 === 0 ? Math.floor(height / 2) - 1 : Math.floor(height / 2);
    spawnPoints = [
      { x: 1, y: 1 }, // top-left
      { x: width - 2, y: 1 }, // top-right
      { x: 1, y: height - 2 }, // bottom-left
      { x: width - 2, y: height - 2 }, // bottom-right
      { x: midX, y: 1 }, // top-center
      { x: midX, y: height - 2 }, // bottom-center
      { x: 1, y: midY }, // left-center
      { x: width - 2, y: midY }, // right-center
    ];
  }

  // Mark spawn points
  for (const sp of spawnPoints) {
    tiles[sp.y][sp.x] = 'spawn';
  }

  // Calculate cells that must stay clear (around spawn points)
  const clearCells = new Set<string>();
  for (const sp of spawnPoints) {
    for (let dy = -SPAWN_CLEAR_RADIUS; dy <= SPAWN_CLEAR_RADIUS; dy++) {
      for (let dx = -SPAWN_CLEAR_RADIUS; dx <= SPAWN_CLEAR_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > SPAWN_CLEAR_RADIUS) continue;
        let nx = sp.x + dx;
        let ny = sp.y + dy;
        if (wrapping) {
          nx = wrapX(nx, width);
          ny = wrapY(ny, height);
        } else {
          if (nx < 1 || nx >= width - 1 || ny < 1 || ny >= height - 1) continue;
        }
        clearCells.add(`${nx},${ny}`);
      }
    }
  }

  // Place destructible walls randomly
  const startXY = wrapping ? 0 : 1;
  const endX = wrapping ? width : width - 1;
  const endY = wrapping ? height : height - 1;
  for (let y = startXY; y < endY; y++) {
    for (let x = startXY; x < endX; x++) {
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
    for (let y = startXY; y < endY; y++) {
      for (let x = startXY; x < endX; x++) {
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
          {
            const cx = wrapping ? wrapX(nb.x, width) : nb.x;
            const cy = wrapping ? wrapY(nb.y, height) : nb.y;
            const inBounds = wrapping || (cx >= 1 && cx < width - 1 && cy >= 1 && cy < height - 1);
            if (inBounds && tiles[cy][cx] === 'empty' && !clearCells.has(`${cx},${cy}`)) {
              tiles[cy][cx] = tileToPlace as TileType;
              placed.push({ x: cx, y: cy });
              break;
            }
          }
        }
      }
    }
  }

  // Place puzzle tiles (switches, gates, crumbling floors)
  let puzzleConfig: PuzzleConfig | undefined;
  if (puzzleTiles.length > 0) {
    const switchVariants: Record<string, 'toggle' | 'pressure'> = {};

    if (puzzleTiles.includes('switches_and_gates')) {
      // Pick 1-2 colors for switch/gate pairs
      const shuffledColors = [...PUZZLE_COLORS];
      for (let i = shuffledColors.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [shuffledColors[i], shuffledColors[j]] = [shuffledColors[j], shuffledColors[i]];
      }
      const numColors = rng.next() < 0.5 ? 1 : 2;
      const selectedColors = shuffledColors.slice(0, numColors) as PuzzleColor[];

      for (const color of selectedColors) {
        // Find available empty tiles not in clear zones for switches
        const switchCandidates: Position[] = [];
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            if (tiles[y][x] === 'empty' && !clearCells.has(`${x},${y}`)) {
              switchCandidates.push({ x, y });
            }
          }
        }
        if (switchCandidates.length < 3) continue;

        // Place 1-2 switches
        const numSwitches = rng.next() < 0.4 ? 1 : 2;
        const switchPositions: Position[] = [];
        for (let s = 0; s < numSwitches && switchCandidates.length > 0; s++) {
          const idx = Math.floor(rng.next() * switchCandidates.length);
          const pos = switchCandidates[idx];
          tiles[pos.y][pos.x] = getSwitchTile(color, false);
          switchPositions.push(pos);
          // Assign variant: mostly toggle, sometimes pressure
          const variant = rng.next() < 0.7 ? 'toggle' : 'pressure';
          switchVariants[`${pos.x},${pos.y}`] = variant;
          switchCandidates.splice(idx, 1);
        }

        // Place 1-2 gates at corridor-like positions (tiles adjacent to walls on 2+ sides)
        const gateCandidates: Position[] = [];
        for (let y = 2; y < height - 2; y++) {
          for (let x = 2; x < width - 2; x++) {
            if (tiles[y][x] !== 'empty' || clearCells.has(`${x},${y}`)) continue;
            // Count adjacent walls
            let wallCount = 0;
            if (tiles[y - 1][x] === 'wall') wallCount++;
            if (tiles[y + 1][x] === 'wall') wallCount++;
            if (tiles[y][x - 1] === 'wall') wallCount++;
            if (tiles[y][x + 1] === 'wall') wallCount++;
            if (wallCount >= 2) gateCandidates.push({ x, y });
          }
        }

        // Fallback: use any empty tile if no corridor positions found
        const gatePool =
          gateCandidates.length > 0
            ? gateCandidates
            : switchCandidates.filter(
                (p) =>
                  !switchPositions.some((sp) => sp.x === p.x && sp.y === p.y) &&
                  tiles[p.y][p.x] === 'empty',
              );

        const numGates = Math.min(rng.next() < 0.4 ? 1 : 2, gatePool.length);
        for (let g = 0; g < numGates && gatePool.length > 0; g++) {
          const idx = Math.floor(rng.next() * gatePool.length);
          const pos = gatePool[idx];
          tiles[pos.y][pos.x] = getGateTile(color, false);
          gatePool.splice(idx, 1);
        }
      }
    }

    if (puzzleTiles.includes('crumbling')) {
      // Place a cluster of 3-5 crumbling tiles
      const crumbleCandidates: Position[] = [];
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          if (tiles[y][x] === 'empty' && !clearCells.has(`${x},${y}`)) {
            crumbleCandidates.push({ x, y });
          }
        }
      }
      if (crumbleCandidates.length > 0) {
        const clusterSize = 3 + Math.floor(rng.next() * 3); // 3-5
        const seedIdx = Math.floor(rng.next() * crumbleCandidates.length);
        const seedPos = crumbleCandidates[seedIdx];
        const placed: Position[] = [];
        tiles[seedPos.y][seedPos.x] = 'crumbling' as TileType;
        placed.push(seedPos);

        for (let i = 0; i < clusterSize - 1 && placed.length < clusterSize; i++) {
          const base = placed[Math.floor(rng.next() * placed.length)];
          const dirs = [
            { x: base.x + 1, y: base.y },
            { x: base.x - 1, y: base.y },
            { x: base.x, y: base.y + 1 },
            { x: base.x, y: base.y - 1 },
          ];
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
              tiles[nb.y][nb.x] = 'crumbling' as TileType;
              placed.push(nb);
              break;
            }
          }
        }
      }
    }

    if (Object.keys(switchVariants).length > 0) {
      puzzleConfig = { switchVariants };
    }
  }

  return {
    width,
    height,
    tiles,
    spawnPoints,
    seed: mapSeed,
    puzzleConfig,
    ...(wrapping ? { wrapping: true } : {}),
  };
}

/** Generate evenly distributed spawn points on odd coordinates for wrapping maps */
function generateWrappingSpawns(width: number, height: number): Position[] {
  const spawns: Position[] = [];
  // 4 columns x 4 rows = up to 16 spawns, distributed evenly
  const cols = 4;
  const rows = 4;
  const xSpacing = Math.floor(width / cols);
  const ySpacing = Math.floor(height / rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let px = Math.floor(xSpacing * (col + 0.5));
      let py = Math.floor(ySpacing * (row + 0.5));
      // Ensure odd coordinates to avoid the indestructible wall grid
      if (px % 2 === 0) px = px + 1 < width ? px + 1 : px - 1;
      if (py % 2 === 0) py = py + 1 < height ? py + 1 : py - 1;
      px = wrapX(px, width);
      py = wrapY(py, height);
      // Avoid duplicates
      if (!spawns.some((s) => s.x === px && s.y === py)) {
        spawns.push({ x: px, y: py });
      }
    }
  }
  return spawns;
}
