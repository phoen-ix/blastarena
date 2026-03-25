import type { TileType } from '../types/game';

// --- Campaign World Theme Types ---

export type CampaignWorldTheme =
  | 'classic'
  | 'forest'
  | 'desert'
  | 'ice'
  | 'volcano'
  | 'void'
  | 'castle'
  | 'swamp'
  | 'sky';

export const CAMPAIGN_WORLD_THEMES: readonly CampaignWorldTheme[] = [
  'classic',
  'forest',
  'desert',
  'ice',
  'volcano',
  'void',
  'castle',
  'swamp',
  'sky',
] as const;

export const CAMPAIGN_THEME_NAMES: Record<CampaignWorldTheme, string> = {
  classic: 'Classic',
  forest: 'Forest',
  desert: 'Desert',
  ice: 'Ice',
  volcano: 'Volcano',
  void: 'Void',
  castle: 'Castle',
  swamp: 'Swamp',
  sky: 'Sky',
};

// --- Theme Color Palettes ---

export interface CampaignThemePalette {
  wall: number;
  wallAccent: number;
  destructible: number;
  destructibleAccent: number;
  floor: number;
  floorAccent: number;
}

export const CAMPAIGN_THEME_PALETTES: Record<CampaignWorldTheme, CampaignThemePalette> = {
  classic: {
    wall: 0x333355,
    wallAccent: 0x444466,
    destructible: 0x886633,
    destructibleAccent: 0x997744,
    floor: 0x2a2a3e,
    floorAccent: 0x323248,
  },
  forest: {
    wall: 0x2d5a1e,
    wallAccent: 0x3a6e28,
    destructible: 0x6b4423,
    destructibleAccent: 0x7d5530,
    floor: 0x1a3a12,
    floorAccent: 0x224518,
  },
  desert: {
    wall: 0x8b6b3d,
    wallAccent: 0x9e7d4e,
    destructible: 0xc4a054,
    destructibleAccent: 0xd4b064,
    floor: 0x5c4a2a,
    floorAccent: 0x6a5632,
  },
  ice: {
    wall: 0x3a5577,
    wallAccent: 0x4a6888,
    destructible: 0x7aaabb,
    destructibleAccent: 0x8dbbcc,
    floor: 0x2a3f55,
    floorAccent: 0x344d66,
  },
  volcano: {
    wall: 0x2a1a1a,
    wallAccent: 0x3a2222,
    destructible: 0x553322,
    destructibleAccent: 0x664433,
    floor: 0x1a1010,
    floorAccent: 0x221515,
  },
  void: {
    wall: 0x2a1a3a,
    wallAccent: 0x38224d,
    destructible: 0x4a2a66,
    destructibleAccent: 0x5a3a77,
    floor: 0x150d22,
    floorAccent: 0x1d1530,
  },
  castle: {
    wall: 0x4a4a50,
    wallAccent: 0x5a5a62,
    destructible: 0x6e6e72,
    destructibleAccent: 0x808084,
    floor: 0x353538,
    floorAccent: 0x3e3e42,
  },
  swamp: {
    wall: 0x2a3a1e,
    wallAccent: 0x364828,
    destructible: 0x4a5530,
    destructibleAccent: 0x5a6640,
    floor: 0x1a2a14,
    floorAccent: 0x22331a,
  },
  sky: {
    wall: 0x5577aa,
    wallAccent: 0x6688bb,
    destructible: 0x88aacc,
    destructibleAccent: 0x99bbdd,
    floor: 0x3a5577,
    floorAccent: 0x446688,
  },
};

// --- Hazard Tile Constants ---

export const QUICKSAND_KILL_TICKS = 40; // 2 seconds at 20 tps
export const SPIKE_SAFE_TICKS = 40; // 2 seconds safe phase
export const SPIKE_LETHAL_TICKS = 20; // 1 second lethal phase
export const SPIKE_CYCLE_TICKS = SPIKE_SAFE_TICKS + SPIKE_LETHAL_TICKS; // 60 ticks total

// --- Hazard Tiles per Theme ---

export const HAZARD_TILES_BY_THEME: Record<CampaignWorldTheme, TileType[]> = {
  classic: [],
  forest: ['vine'],
  desert: ['quicksand'],
  ice: ['ice'],
  volcano: ['lava'],
  void: ['dark_rift'],
  castle: ['spikes'],
  swamp: ['mud'],
  sky: [],
};

export const HAZARD_TILE_NAMES: Record<string, string> = {
  vine: 'Vine',
  quicksand: 'Quicksand',
  ice: 'Ice',
  lava: 'Lava',
  mud: 'Mud',
  spikes: 'Spikes',
  dark_rift: 'Dark Rift',
};
