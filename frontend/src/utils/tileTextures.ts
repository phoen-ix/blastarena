import type { TileType } from '@blast-arena/shared';
/**
 * Tile texture keys, shared by the in-game renderer and the level editor.
 *
 * `getTileTexture` was duplicated verbatim in TileMap and LevelEditorScene — same 30-case switch,
 * same themed_ prefixing, same floor_${(x+y)%4} fallback — and had already started to drift: the
 * editor listed a redundant `case 'spawn'` and TileMap carried dead `as TileType` casts on every
 * arm. They behaved identically for every TileType, but a new tile type had to be added in two
 * places or it silently rendered as floor in one of them. Same story for the conveyor animation
 * key, which was copied four times. (audit TILETEXTURE-DUP-1)
 */

/** `themed_` when a non-classic theme is active, otherwise empty. */
export function themePrefix(theme?: string): string {
  return theme && theme !== 'classic' ? 'themed_' : '';
}

export function isConveyorTile(type: TileType | string | undefined): boolean {
  return (
    type === 'conveyor_up' ||
    type === 'conveyor_down' ||
    type === 'conveyor_left' ||
    type === 'conveyor_right'
  );
}

/** Animation key for a conveyor tile under the given theme. */
export function conveyorAnimKey(type: TileType | string, theme?: string): string {
  return `${themePrefix(theme)}${type}_anim`;
}

/**
 * Texture key for a tile. `x`/`y` only matter for floor variants, which alternate on (x + y) % 4
 * to break up large empty areas.
 */
export function getTileTexture(type: TileType, x: number, y: number, theme?: string): string {
  const themed = themePrefix(theme);

  switch (type) {
    case 'wall':
    case 'destructible':
    case 'destructible_cracked':
    case 'exit':
    case 'goal':
    case 'crumbling':
      return `${themed}${type}`;

    case 'teleporter_a':
    case 'teleporter_b':
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
      return `${themed}${type}`;

    // Puzzle tiles
    case 'switch_red':
    case 'switch_blue':
    case 'switch_green':
    case 'switch_yellow':
    case 'switch_red_active':
    case 'switch_blue_active':
    case 'switch_green_active':
    case 'switch_yellow_active':
    case 'gate_red':
    case 'gate_blue':
    case 'gate_green':
    case 'gate_yellow':
    case 'gate_red_open':
    case 'gate_blue_open':
    case 'gate_green_open':
    case 'gate_yellow_open':
      return `${themed}${type}`;

    // Pit and the hazard tiles have no themed variant — the key is the tile type itself.
    case 'pit':
    case 'vine':
    case 'quicksand':
    case 'ice':
    case 'lava':
    case 'mud':
    case 'spikes':
    case 'spikes_active':
    case 'dark_rift':
      return type;

    case 'empty':
    case 'spawn':
    default:
      return `${themed}floor_${(x + y) % 4}`;
  }
}
