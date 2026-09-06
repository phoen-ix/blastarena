import { Position, TileType } from '../types/game';
import { wrapX, wrapY } from './wrap';

const BLAST_DIRECTIONS = [
  { dx: 0, dy: -1 }, // up
  { dx: 0, dy: 1 }, // down
  { dx: -1, dy: 0 }, // left
  { dx: 1, dy: 0 }, // right
] as const;

export function getExplosionCells(
  originX: number,
  originY: number,
  range: number,
  mapWidth: number,
  mapHeight: number,
  tiles: TileType[][],
  pierce: boolean = false,
  wrapping: boolean = false,
): Position[] {
  const cells: Position[] = [{ x: originX, y: originY }];

  for (const { dx, dy } of BLAST_DIRECTIONS) {
    for (let i = 1; i <= range; i++) {
      let nx = originX + dx * i;
      let ny = originY + dy * i;

      if (wrapping) {
        nx = wrapX(nx, mapWidth);
        ny = wrapY(ny, mapHeight);
        // Cycle detection: explosion wrapped all the way around
        if (nx === originX && ny === originY) break;
      } else {
        if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) break;
      }

      const tile = tiles[ny][nx];
      if (tile === 'wall') break;

      cells.push({ x: nx, y: ny });

      // Pierce bombs pass through destructible walls; normal bombs stop after one
      if (tile === 'destructible' && !pierce) break;
      if (tile === 'destructible_cracked' && !pierce) break;
    }
  }

  return cells;
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
