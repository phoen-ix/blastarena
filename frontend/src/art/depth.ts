/**
 * Draw depths for the game world, in four bands:
 *
 *   GROUND       0–99        floor, scorch decals, contact shadows, light pools
 *   WORLD        classic 0–10, or 10000 + foot y for y-sorted art styles
 *   ABOVE_WORLD  50000 + n   name labels, shields, health bars
 *   OVERLAY      100000 + n  zones, meteors, flashes, emotes, countdown, arrows
 *
 * The classic values map monotonically onto these bands (n is the old depth), so Classic draws
 * in exactly the order it always did. Styles with raised blocks interleave blocks and entities by
 * the y of their feet (`ySortDepth`), which stays between 10000 and 50000 on any map.
 */

const ABOVE = 50000;
const OVER = 100000;

export const DEPTH = {
  // GROUND band (y-sorted styles); classic tiles keep depth 0
  FLOOR: 0,
  DECAL: 2,
  SHADOW: 4,
  LIGHT_POOL: 6,

  // WORLD band, classic layer values
  TILE: 0,
  TILE_DYING: 1,
  METEOR_SHADOW: 1,
  POWERUP: 3,
  BOMB: 5,
  HILL: 5,
  DUST: 5,
  TRAIL: 5,
  WARNING: 7,
  PULSE: 7,
  EXPLOSION: 8,
  BUDDY_GLOW: 8,
  UFO_BEAM: 8,
  EXPLOSION_FX: 9,
  ENEMY: 9,
  TEAM_BAR: 9,
  PLAYER: 10,

  // ABOVE_WORLD band
  LABEL: ABOVE + 11,
  HP_BAR: ABOVE + 11,
  SHIELD: ABOVE + 12,

  // OVERLAY band
  ZONE: OVER + 15,
  THROWN_BOMB: OVER + 15,
  WARNING_TEXT: OVER + 16,
  IMPACT: OVER + 18,
  UFO: OVER + 19,
  METEOR: OVER + 20,
  UFO_TEXT: OVER + 20,
  PICKUP_TEXT: OVER + 20,
  SURGE: OVER + 25,
  EMOTE_BG: OVER + 99,
  EMOTE: OVER + 100,
  SPECTATOR_FLASH: OVER + 120,
  PARTNER_ARROW: OVER + 9998,
  SPLIT_DIVIDER: OVER + 9999,
} as const;

/** Base of the y-sorted part of the WORLD band. */
export const WORLD_Y_BASE = 10000;

/** Tie-breakers for objects whose feet share a y (blocks first, players last). */
export const Y_BIAS = {
  BLOCK: 0,
  FLAME: 0.1,
  POWERUP: 0.2,
  BOMB: 0.3,
  ENEMY: 0.4,
  PLAYER: 0.5,
} as const;

/** Depth for an object in a y-sorted art style, from the displayed y of its feet. */
export function ySortDepth(footY: number, bias: number): number {
  return WORLD_Y_BASE + Math.round(footY) + bias;
}

/** Phaser re-sorts the display list on every setDepth call, even an unchanged one. */
export function setDepthIfChanged(
  obj: { depth?: number; setDepth(d: number): unknown },
  d: number,
): void {
  if (obj.depth !== d) obj.setDepth(d);
}
