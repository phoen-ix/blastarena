import { TileType } from '../types/game';
import { PuzzleColor } from '../types/campaign';

// --- Constants ---

export const PUZZLE_COLORS: readonly PuzzleColor[] = ['red', 'blue', 'green', 'yellow'] as const;
export const CRUMBLE_DELAY_TICKS = 10; // 0.5s delay after stepping off before collapsing to pit

export const PUZZLE_COLOR_VALUES: Record<PuzzleColor, number> = {
  red: 0xff4444,
  blue: 0x4488ff,
  green: 0x44cc66,
  yellow: 0xffcc44,
};

// --- Switch tile helpers ---

const SWITCH_TILES: TileType[] = ['switch_red', 'switch_blue', 'switch_green', 'switch_yellow'];

const SWITCH_ACTIVE_TILES: TileType[] = [
  'switch_red_active',
  'switch_blue_active',
  'switch_green_active',
  'switch_yellow_active',
];

export function isSwitchTile(tile: TileType): boolean {
  return SWITCH_TILES.includes(tile) || SWITCH_ACTIVE_TILES.includes(tile);
}

export function isSwitchActive(tile: TileType): boolean {
  return SWITCH_ACTIVE_TILES.includes(tile);
}

export function getSwitchColor(tile: TileType): PuzzleColor | null {
  const match = tile.match(/^switch_(red|blue|green|yellow)(_active)?$/);
  return match ? (match[1] as PuzzleColor) : null;
}

export function getSwitchTile(color: PuzzleColor, active: boolean): TileType {
  return (active ? `switch_${color}_active` : `switch_${color}`) as TileType;
}

// --- Gate tile helpers ---

const GATE_CLOSED_TILES: TileType[] = ['gate_red', 'gate_blue', 'gate_green', 'gate_yellow'];

const GATE_OPEN_TILES: TileType[] = [
  'gate_red_open',
  'gate_blue_open',
  'gate_green_open',
  'gate_yellow_open',
];

export function isGateTile(tile: TileType): boolean {
  return GATE_CLOSED_TILES.includes(tile) || GATE_OPEN_TILES.includes(tile);
}

export function isGateClosed(tile: TileType): boolean {
  return GATE_CLOSED_TILES.includes(tile);
}

export function isGateOpen(tile: TileType): boolean {
  return GATE_OPEN_TILES.includes(tile);
}

export function getGateColor(tile: TileType): PuzzleColor | null {
  const match = tile.match(/^gate_(red|blue|green|yellow)(_open)?$/);
  return match ? (match[1] as PuzzleColor) : null;
}

export function getGateTile(color: PuzzleColor, open: boolean): TileType {
  return (open ? `gate_${color}_open` : `gate_${color}`) as TileType;
}
