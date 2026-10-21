import type {
  ArtStyleId,
  CampaignWorldTheme,
  Direction,
  EnemySpriteConfig,
  PowerUpType,
  TileType,
} from '@blast-arena/shared';

/**
 * Painter contract for the drawn art styles (neon, toy, pixel).
 *
 * A painter draws ONE frame onto a Canvas 2D context. The art layer bakes every frame it needs
 * into texture atlases once (at match start, or when a new player colour or enemy type appears),
 * so painters can afford to be detailed but must be:
 *   - pure: the same options always produce the same pixels (no Math.random, no Date; use
 *     `hash2` from ../paint for variation),
 *   - self-contained: leave the context's state as found (save/restore),
 *   - in logical units: the context is already scaled so 1 unit = 1 logical pixel and a tile is
 *     48 units. The bake scale may be 1, 2 (high-resolution screens) or 1/3 (pixel art).
 *
 * Origins (where (0,0) is when the painter is called):
 *   - tile painters (floor, wall, crate, special, blockShadow): the tile's TOP-LEFT corner. The
 *     tile covers (0,0)-(48,48). Raised styles may draw up to `blockHeight` units above it
 *     (y < 0); blockShadow may spill up to 32 units to the right and below.
 *   - entity painters (player, ghost, enemy, bomb, bombBand, powerUp, shield, flame, fx): the
 *     CENTRE of the entity's tile. Keep entity art within x in [-32, 32], y in [-48, 32].
 *
 * Animation is expressed as discrete frames: the art layer asks for frame `i` of `frames` (or a
 * phase in [0, 1) over a loop) and plays them back with Phaser animations. Movement (bobbing,
 * squash, drop-in, fading, rising ghosts, swelling bombs) is applied by the renderer at runtime,
 * so painters draw static poses.
 */

export type World = CampaignWorldTheme;
export type EyeStyle = 'default' | 'angry' | 'cyclops' | 'dot';
export type CrateKind = 'crate' | 'cracked';
export type BombType = 'normal' | 'pierce' | 'remote';
export type FlamePiece = 'center' | 'arm' | 'end';
export type MarkerShape =
  'circle' | 'triangle' | 'square' | 'diamond' | 'star' | 'plus' | 'hex' | 'heart';

/** Neighbour bits for wall connectivity: set when that neighbour is an indestructible wall. */
export const MASK_N = 1;
export const MASK_E = 2;
export const MASK_S = 4;
export const MASK_W = 8;

/** Which neighbours throw a block shadow onto a floor tile (light comes from the top left). */
export const SHADOW_FROM_W = 1;
export const SHADOW_FROM_N = 2;
export const SHADOW_FROM_NW = 4;

export interface FloorOpts {
  world: World;
  /** 0..7, picked per cell from a hash of its position. */
  variant: number;
  /** (x + y) & 1, for checkerboard patterns. */
  parity: 0 | 1;
}

export interface BlockShadowOpts {
  world: World;
}

export interface WallOpts {
  world: World;
  /** MASK_* bits for neighbouring indestructible walls. */
  mask: number;
  /** On the outer ring of a non-wrapping map. */
  border: boolean;
  /** 0..3, per cell. */
  variant: number;
}

export interface CrateOpts {
  world: World;
  /** `cracked` is a reinforced block that has taken one hit (tile `destructible_cracked`). */
  kind: CrateKind;
  /** 0..1, per cell. */
  variant: number;
}

/**
 * Every tile type that is neither floor, wall nor crate: teleporters, conveyors, exit, goal,
 * switches, gates, crumbling floor, pit and hazards. Loops use `phase` in [0, 1).
 */
export interface SpecialOpts {
  world: World;
  tile: TileType;
  phase: number;
}

export type PlayerPose =
  | { kind: 'idle'; blink: boolean }
  /** step 0..3: contact, passing, contact (other foot), passing. */
  | { kind: 'walk'; step: 0 | 1 | 2 | 3 };

export interface PlayerOpts {
  /** CSS hex colour, e.g. '#e94560'. */
  color: string;
  eyes: EyeStyle;
  dir: Direction;
  pose: PlayerPose;
}

export interface GhostOpts {
  color: string;
}

export interface EnemyOpts {
  sprite: EnemySpriteConfig;
  dir: Direction;
  /** 0 or 1, a two-frame idle/step cycle. */
  frame: number;
}

export interface BombOpts {
  type: BombType;
  /** Fuse left, 1 (just placed) to 0. Remote bombs are always 1. */
  fuse: number;
  /** Alternates 0/1 for the spark (or the remote bomb's LED). */
  spark: 0 | 1;
  /** Last-second look (red hot). */
  hot: boolean;
}

export interface FlameOpts {
  piece: FlamePiece;
  /** arm: 'right' for horizontal, 'down' for vertical. end/center: direction it points. */
  dir: Direction;
  /** Frame i of `frames` across the flame's whole life (0 = just ignited). */
  frame: number;
  frames: number;
  pierce: boolean;
}

export interface PowerUpOpts {
  type: PowerUpType;
  /** Frame i of `frames` of the idle loop (glint, shimmer). */
  frame: number;
  frames: number;
}

/** Small effect textures, all drawn around the origin. */
export type FxKind =
  | 'spark'
  | 'smoke'
  | 'dust'
  | 'star'
  | 'ember'
  | 'snow'
  | 'firefly'
  | 'mote'
  /** White radial falloff, tinted at runtime for light pools. */
  | 'glow'
  /** White ring, tinted and scaled at runtime for shockwaves. */
  | 'ring'
  /** Ground ring under the local player (white, tinted). */
  | 'localRing'
  /** Ground ring for team colours (white, tinted). */
  | 'teamRing';

export interface FxOpts {
  kind: FxKind;
}

export interface ChunkOpts {
  world: World;
  /** Material of the broken block. */
  kind: 'crate' | 'cracked';
  variant: 0 | 1 | 2;
}

export interface ScorchOpts {
  variant: 0 | 1 | 2 | 3;
}

/** Colours the runtime effects use with this style. */
export interface StylePalette {
  /** Tint for light pools under flames. */
  flameLight: string;
  /** Tint for shockwave rings. */
  shock: string;
  /** Dust puffs under footsteps and landings. */
  dust: string;
  /** Pickup label text and its outline. */
  labelText: string;
  labelStroke: string;
  /** Battle-royale zone: tinted outside area and the energy wall. */
  zoneOutside: string;
  zoneEdge: string;
  /** King of the Hill when nobody holds it. */
  hillNeutral: string;
  /** Vignette colour. */
  vignette: string;
}

export interface StylePainters {
  id: Exclude<ArtStyleId, 'classic'>;
  /** Colour behind the map. */
  bg: string;
  /** Logical units a block's top face is raised above its tile; 0 for flat styles. */
  blockHeight: number;
  /** Units per art pixel for pixel art (baked at 1/pixel scale, nearest filtering). */
  pixel?: number;
  /** Frames to bake for each animated special tile (static tiles get 1). */
  specialFrames(tile: TileType): number;
  /** Seconds one loop of an animated special tile lasts. */
  specialLoopSeconds(tile: TileType): number;
  /** Frames per flame piece across its life, and per power-up loop. */
  flameFrames: number;
  powerUpFrames: number;
  /** Fuse frames to bake per bomb type (remote bombs use 1). */
  fuseFrames: number;
  /** Where the fuse spark sits relative to the bomb's origin, for the spark particles. */
  fuseTip: { x: number; y: number };
  palette: StylePalette;

  floor(g: CanvasRenderingContext2D, o: FloorOpts): void;
  /** Shadow a block casts onto the floor around it (drawn on the floor layer, under blocks). */
  blockShadow(g: CanvasRenderingContext2D, o: BlockShadowOpts): void;
  wall(g: CanvasRenderingContext2D, o: WallOpts): void;
  crate(g: CanvasRenderingContext2D, o: CrateOpts): void;
  special(g: CanvasRenderingContext2D, o: SpecialOpts): void;
  player(g: CanvasRenderingContext2D, o: PlayerOpts): void;
  /** The little ghost that floats up after a knockout. */
  ghost(g: CanvasRenderingContext2D, o: GhostOpts): void;
  enemy(g: CanvasRenderingContext2D, o: EnemyOpts): void;
  bomb(g: CanvasRenderingContext2D, o: BombOpts): void;
  /** Owner-colour stripe for a bomb, drawn in WHITE; the renderer tints it per owner. */
  bombBand(g: CanvasRenderingContext2D, o: { type: BombType }): void;
  flame(g: CanvasRenderingContext2D, o: FlameOpts): void;
  powerUp(g: CanvasRenderingContext2D, o: PowerUpOpts): void;
  /** Shield bubble around a player; frame i of 4 for a shimmer loop. */
  shield(g: CanvasRenderingContext2D, o: { frame: number }): void;
  fx(g: CanvasRenderingContext2D, o: FxOpts): void;
  chunk(g: CanvasRenderingContext2D, o: ChunkOpts): void;
  scorch(g: CanvasRenderingContext2D, o: ScorchOpts): void;
  meteor(g: CanvasRenderingContext2D): void;
  /** Optional marker drawing; the art layer falls back to a generic shape badge. */
  marker?(g: CanvasRenderingContext2D, o: { shape: MarkerShape; color: string }): void;
}

/** Map tile types that are drawn as blocks (raised, y-sorted) in the new styles. */
export function isBlockTile(tile: TileType): boolean {
  return (
    tile === 'wall' ||
    tile === 'destructible' ||
    tile === 'destructible_cracked' ||
    tile === 'gate_red' ||
    tile === 'gate_blue' ||
    tile === 'gate_green' ||
    tile === 'gate_yellow'
  );
}

/** Tiles drawn by `special()` (everything except plain floor and the block kinds). */
export function isSpecialTile(tile: TileType): boolean {
  return (
    tile !== 'empty' &&
    tile !== 'spawn' &&
    tile !== 'wall' &&
    tile !== 'destructible' &&
    tile !== 'destructible_cracked'
  );
}

/** Every tile type a special-tile painter draws. */
export const SPECIAL_TILES: TileType[] = [
  'teleporter_a',
  'teleporter_b',
  'conveyor_up',
  'conveyor_down',
  'conveyor_left',
  'conveyor_right',
  'exit',
  'goal',
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
  'pit',
  'vine',
  'quicksand',
  'ice',
  'lava',
  'mud',
  'spikes',
  'spikes_active',
  'dark_rift',
];
