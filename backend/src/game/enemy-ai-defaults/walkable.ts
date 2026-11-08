import { WALKABLE } from '../CollisionSystem';

/**
 * Tiles the engine lets an enemy stand on but that kill or trap it. The built-in AIs path around
 * them on purpose; everything else the engine accepts is fair game.
 */
const AVOIDED = new Set(['quicksand', 'spikes', 'spikes_active', 'dark_rift']);

/**
 * The `walkable(tile, ghost)` helper every built-in enemy AI source embeds. It is generated from
 * CollisionSystem's walkable set: the six hand-written copies accepted only empty, spawn, exit,
 * goal, teleporters and conveyors, so the AIs could not path across switches, open gates,
 * crumbling floor or slowing hazards that the engine lets them walk on. (audit AI8)
 */
export const WALKABLE_FN_SOURCE = `var WALKABLE_TILES = ${JSON.stringify(
  [...WALKABLE].filter((t) => !AVOIDED.has(t)),
)};
function walkable(tile, ghost) {
  if (!tile) return false;
  if (tile === 'wall') return false;
  if (ghost) return true;
  return WALKABLE_TILES.indexOf(tile) !== -1;
}`;
