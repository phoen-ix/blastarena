import type { TileType } from '@blast-arena/shared';
import type { CampaignThemePalette } from '@blast-arena/shared';

export interface MapPreviewOptions {
  palette?: CampaignThemePalette;
  maxCanvasSize?: number;
}

/** Convert a 0xRRGGBB number to a CSS hex string */
function hexNumToCSS(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function darkenHex(n: number, factor: number): string {
  const r = Math.round(((n >> 16) & 0xff) * factor);
  const g = Math.round(((n >> 8) & 0xff) * factor);
  const b = Math.round((n & 0xff) * factor);
  return `rgb(${r},${g},${b})`;
}

const PUZZLE_COLORS: Record<string, string> = {
  red: '#ff4444',
  blue: '#4488ff',
  green: '#44cc66',
  yellow: '#ffcc44',
};

const PUZZLE_COLORS_DARK: Record<string, string> = {
  red: '#992222',
  blue: '#224488',
  green: '#227733',
  yellow: '#887722',
};

function getTileColor(type: TileType, palette: CampaignThemePalette): string {
  switch (type) {
    case 'empty':
      return hexNumToCSS(palette.floor);
    case 'wall':
      return hexNumToCSS(palette.wall);
    case 'destructible':
    case 'destructible_cracked':
      return hexNumToCSS(palette.destructible);
    case 'spawn':
      return '#44cc44';
    case 'teleporter_a':
      return '#44aaff';
    case 'teleporter_b':
      return '#ff8844';
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
      return '#555577';
    case 'exit':
      return '#22cc66';
    case 'goal':
      return '#ffcc00';
    case 'crumbling':
      return darkenHex(palette.floor, 0.7);
    case 'pit':
      return '#0a0a12';

    // Puzzle switches
    case 'switch_red':
    case 'switch_red_active':
      return PUZZLE_COLORS.red;
    case 'switch_blue':
    case 'switch_blue_active':
      return PUZZLE_COLORS.blue;
    case 'switch_green':
    case 'switch_green_active':
      return PUZZLE_COLORS.green;
    case 'switch_yellow':
    case 'switch_yellow_active':
      return PUZZLE_COLORS.yellow;

    // Puzzle gates
    case 'gate_red':
      return PUZZLE_COLORS_DARK.red;
    case 'gate_blue':
      return PUZZLE_COLORS_DARK.blue;
    case 'gate_green':
      return PUZZLE_COLORS_DARK.green;
    case 'gate_yellow':
      return PUZZLE_COLORS_DARK.yellow;
    case 'gate_red_open':
    case 'gate_blue_open':
    case 'gate_green_open':
    case 'gate_yellow_open':
      return hexNumToCSS(palette.floor);

    // Hazard tiles
    case 'vine':
      return '#3a7a22';
    case 'quicksand':
      return '#8b7a4a';
    case 'ice':
      return '#8ac8e8';
    case 'lava':
      return '#cc3300';
    case 'mud':
      return '#4a4030';
    case 'spikes':
      return '#3a3a40';
    case 'spikes_active':
      return '#cc3333';
    case 'dark_rift':
      return '#2a1a4a';

    default:
      return hexNumToCSS(palette.floor);
  }
}

const CLASSIC_PALETTE: CampaignThemePalette = {
  wall: 0x333355,
  wallAccent: 0x444466,
  destructible: 0x886633,
  destructibleAccent: 0x997744,
  floor: 0x2a2a3e,
  floorAccent: 0x323248,
};

/**
 * Render a tile grid as a small minimap canvas.
 * Each tile is drawn as a single colored square.
 */
export function renderMapPreview(
  tiles: TileType[][],
  options?: MapPreviewOptions,
): HTMLCanvasElement {
  const palette = options?.palette ?? CLASSIC_PALETTE;
  const maxSize = options?.maxCanvasSize ?? 200;
  const mapHeight = tiles.length;
  const mapWidth = mapHeight > 0 ? tiles[0].length : 0;

  const tileSize = Math.max(2, Math.floor(maxSize / Math.max(mapWidth, mapHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = mapWidth * tileSize;
  canvas.height = mapHeight * tileSize;
  canvas.style.imageRendering = 'pixelated';

  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      ctx.fillStyle = getTileColor(tiles[y][x], palette);
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    }
  }

  return canvas;
}
