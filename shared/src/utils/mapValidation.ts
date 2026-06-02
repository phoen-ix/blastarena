import { TileType } from '../types/game';
import { getSwitchColor, getGateColor } from './puzzle';

const ALLOWED_CUSTOM_MAP_TILES: Set<string> = new Set([
  'empty',
  'wall',
  'destructible',
  'spawn',
  'teleporter_a',
  'teleporter_b',
  'conveyor_up',
  'conveyor_down',
  'conveyor_left',
  'conveyor_right',
  // Puzzle tiles
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
]);

export function validateCustomMap(
  tiles: TileType[][],
  width: number,
  height: number,
  spawnPoints?: { x: number; y: number }[],
): string[] {
  const errors: string[] = [];

  // Dimensions must be odd and within range
  if (width < 9 || width > 51) {
    errors.push('Map width must be between 9 and 51');
  }
  if (height < 9 || height > 51) {
    errors.push('Map height must be between 9 and 51');
  }
  if (width % 2 === 0) {
    errors.push('Map width must be an odd number');
  }
  if (height % 2 === 0) {
    errors.push('Map height must be an odd number');
  }

  // Tiles array must match declared dimensions
  if (tiles.length !== height) {
    errors.push(`Tiles array has ${tiles.length} rows but height is ${height}`);
    return errors;
  }
  for (let y = 0; y < height; y++) {
    if (tiles[y].length !== width) {
      errors.push(`Row ${y} has ${tiles[y].length} columns but width is ${width}`);
      return errors;
    }
  }

  // Check tile types and collect spawn/teleporter/puzzle info
  let spawnCount = 0;
  let hasTeleA = false;
  let hasTeleB = false;
  const spawnTiles = new Set<string>();
  const switchColors = new Set<string>();
  const gateColors = new Set<string>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tiles[y][x];

      if (!ALLOWED_CUSTOM_MAP_TILES.has(tile)) {
        errors.push(`Invalid tile type '${tile}' at (${x}, ${y})`);
        continue;
      }

      if (tile === 'spawn') {
        spawnCount++;
        spawnTiles.add(`${x},${y}`);
      }
      if (tile === 'teleporter_a') hasTeleA = true;
      if (tile === 'teleporter_b') hasTeleB = true;
      const sc = getSwitchColor(tile);
      if (sc) switchColors.add(sc);
      const gc = getGateColor(tile);
      if (gc) gateColors.add(gc);

      // Border must be walls
      const isBorder = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      if (isBorder && tile !== 'wall') {
        errors.push(`Border tile at (${x}, ${y}) must be 'wall', got '${tile}'`);
      }
    }
  }

  // Spawn point constraints
  if (spawnCount < 2) {
    errors.push(`Map needs at least 2 spawn points (found ${spawnCount})`);
  }
  if (spawnCount > 8) {
    errors.push(`Map can have at most 8 spawn points (found ${spawnCount})`);
  }

  // Teleporter pairing
  if (hasTeleA && !hasTeleB) {
    errors.push('Teleporter A exists but no Teleporter B found');
  }
  if (hasTeleB && !hasTeleA) {
    errors.push('Teleporter B exists but no Teleporter A found');
  }

  // Gate-switch pairing: gates need at least one switch of the same color, and vice versa —
  // an orphaned switch with no gate is a meaningless (and confusing) map. (audit MAP-VALIDATION-SWITCH-ONLY)
  for (const color of gateColors) {
    if (!switchColors.has(color)) {
      errors.push(`Gate (${color}) exists but no matching switch found`);
    }
  }
  for (const color of switchColors) {
    if (!gateColors.has(color)) {
      errors.push(`Switch (${color}) exists but no matching gate found`);
    }
  }

  // Spawn points must line up with the actual 'spawn' tiles in the grid: one per tile, in-bounds,
  // and on a real spawn tile. Otherwise players spawn at undefined/out-of-bounds positions. (audit MAP-SPAWN-1)
  if (spawnPoints) {
    if (spawnPoints.length !== spawnCount) {
      errors.push(
        `spawnPoints count (${spawnPoints.length}) does not match the number of 'spawn' tiles (${spawnCount})`,
      );
    }
    const seen = new Set<string>();
    for (const sp of spawnPoints) {
      const key = `${sp.x},${sp.y}`;
      if (sp.x < 0 || sp.x >= width || sp.y < 0 || sp.y >= height) {
        errors.push(`Spawn point (${sp.x}, ${sp.y}) is out of bounds`);
      } else if (!spawnTiles.has(key)) {
        errors.push(`Spawn point (${sp.x}, ${sp.y}) is not on a 'spawn' tile`);
      } else if (seen.has(key)) {
        errors.push(`Duplicate spawn point at (${sp.x}, ${sp.y})`);
      }
      seen.add(key);
    }
  }

  return errors;
}
