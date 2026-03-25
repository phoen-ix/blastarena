import { TileType } from '../types/game';
import { CampaignWorldTheme } from '../constants/campaignThemes';

const HAZARD_TILES: TileType[] = [
  'vine',
  'quicksand',
  'ice',
  'lava',
  'mud',
  'spikes',
  'spikes_active',
  'dark_rift',
];

const SLOWING_TILES: TileType[] = ['vine', 'quicksand', 'mud'];

const HAZARD_THEME_MAP: Record<string, CampaignWorldTheme> = {
  vine: 'forest',
  quicksand: 'desert',
  ice: 'ice',
  lava: 'volcano',
  mud: 'swamp',
  spikes: 'castle',
  spikes_active: 'castle',
  dark_rift: 'void',
};

export function isHazardTile(tile: TileType): boolean {
  return HAZARD_TILES.includes(tile);
}

export function isSlowingTile(tile: TileType): boolean {
  return SLOWING_TILES.includes(tile);
}

export function getHazardTheme(tile: TileType): CampaignWorldTheme | null {
  return HAZARD_THEME_MAP[tile] ?? null;
}
