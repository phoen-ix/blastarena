import { Position, TileType } from '../types/game';
import { TILE_SIZE } from '../constants/game';

export function posToTile(pixelX: number, pixelY: number): Position {
  return {
    x: Math.floor(pixelX / TILE_SIZE),
    y: Math.floor(pixelY / TILE_SIZE),
  };
}

export function tileToPos(tileX: number, tileY: number): Position {
  return {
    x: tileX * TILE_SIZE + TILE_SIZE / 2,
    y: tileY * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function tileToPixelOrigin(tileX: number, tileY: number): Position {
  return {
    x: tileX * TILE_SIZE,
    y: tileY * TILE_SIZE,
  };
}

export function getExplosionCells(
  originX: number,
  originY: number,
  range: number,
  mapWidth: number,
  mapHeight: number,
  tiles: TileType[][],
  pierce: boolean = false,
): Position[] {
  const cells: Position[] = [{ x: originX, y: originY }];
  const directions = [
    { dx: 0, dy: -1 }, // up
    { dx: 0, dy: 1 }, // down
    { dx: -1, dy: 0 }, // left
    { dx: 1, dy: 0 }, // right
  ];

  for (const { dx, dy } of directions) {
    for (let i = 1; i <= range; i++) {
      const nx = originX + dx * i;
      const ny = originY + dy * i;

      if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) break;

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

export function isInBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x < width && y >= 0 && y < height;
}
