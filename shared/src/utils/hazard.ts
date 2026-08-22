import { TileType } from '../types/game';

export const SLOWING_TILES: TileType[] = ['vine', 'quicksand', 'mud'];

export function isSlowingTile(tile: TileType): boolean {
  return SLOWING_TILES.includes(tile);
}
