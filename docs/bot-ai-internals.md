# Bot AI Internals

Detailed technical reference for the built-in BotAI decision engine in `backend/src/game/BotAI.ts`. For the external developer guide on writing custom AIs, see [bot-ai-guide.md](bot-ai-guide.md).

## Difficulty Tiers

Three difficulty presets defined in `DIFFICULTY_PRESETS`:

### Easy
- `huntChance=0.15`, `bombCooldown=45-80`, `escapeSearchDepth=2`, `reactionDelay=5`
- `wrongMoveChance=0.25` (flees in wrong direction), `randomBombChance=0.12` (places unsafe bombs bypassing safety checks)
- `enableReachabilityFilter=false`, `huntSearchDepth=6`, `duelStalemateThresholdTicks=0`

### Normal
- `huntChance=0.90`, `bombCooldown=15-25`, `escapeSearchDepth=8`, `dangerTimerThreshold=40`
- `roamAfterIdleTicks=60`, `huntStuckThreshold=3`, `huntStuckMaxTicks=60`
- `stalemateThresholdTicks=100`, `remoteHoldThreshold=40`, `optimalMoveChance=0.8`
- `enableReachabilityFilter=true`, `huntSearchDepth=25`, `duelStalemateThresholdTicks=200`

### Hard
- `huntChance=0.95`, `bombCooldown=5-12`, `escapeSearchDepth=15`, `dangerTimerThreshold=50`
- `chainReactionAwareness=true`, `shieldAggression=true`, `lateGameBombCooldown=3-6`
- `huntSearchDepth=40`, `huntStuckMaxTicks=40`, `stalemateThresholdTicks=60`, `remoteHoldThreshold=60`
- `enableReachabilityFilter=true`, `duelStalemateThresholdTicks=120`

See `DIFFICULTY_PRESETS` in `backend/src/game/BotAI.ts` for the complete config.

## Decision Tree (Priority Order)

1. **Flee** — escape danger zones via BFS
2. **Detonate remote bombs** (priority 2.5) — when enemy in blast zone, near bomb, or movement blocked
3. **Offensive kick** (priority 3.5) — push bombs toward enemies in line-of-sight
4. **KOTH hill-seeking** (priority 4.5) — navigate to 3x3 center zone, hold position once inside
5. **Hunt** — BFS toward nearest enemy, bomb when in range
6. **Power-up seeking** — BFS pathfinding (finds power-ups around corners)
7. **Wall clearing** — bomb destructible walls toward nearest enemy
8. **Roam** — move toward nearest enemy via manhattan heuristic after idle threshold

## Escape & Danger Assessment

- **BFS escape**: Searches through danger cells to find nearest safe cell; active explosion cells (`ticksRemaining > 3`) treated as impassable — never pathed through
- **Escape depth**: Dynamic `max(config.escapeSearchDepth, ceil(maxFireRangeOnMap * 1.5) + 2)` for high-range scenarios
- **`findEscapeDirection`**: Returns `{ dir, depth }` — depth used for time-to-safety check in `canEscapeAfterBomb` (at `fireRange >= 4`, verifies bot can physically reach safe cell before bomb detonates with 10-tick margin)
- **`canEscapeAfterBomb`**: Verifies immediate walkable+non-explosion neighbor AND BFS escape path with full danger awareness (`ignoreDangerThreshold=true`)
- **Danger timer threshold**: Dynamic safe distance based on `floor(ticksRemaining / MOVE_COOLDOWN_BASE)` capped at `fireRange + 2` — replaces fixed manhattan > 2 check
- **Reachability filter**: `getDangerCells()` skips bombs whose blast cells are too far to reach the bot before detonation (`minDist > movesBeforeDetonation + 1`); controlled by `enableReachabilityFilter` config (normal/hard only); bypassed by `ignoreDangerThreshold`
- **Chain reaction awareness**: `canEscapeAfterBomb()` always adds chain-reacting bomb blast cells to future danger; `getDangerCells()` does chain reaction second pass for hard difficulty only
- **Flee stuck-breaker**: Tracks `lastFleePos`/`fleeStuckTicks` — after 5 movable ticks (gated on `canMove()`) stuck at same position, tries alternative directions (prefer non-danger walkable, fall back to any walkable non-explosion)

## Bomb Safety

- Requires `player.canMove()` before placing bombs
- Dead-end check: `walkableDirs >= minWalkableDirs` (min is 3 at `fireRange >= 5`, else 2)
- `hasOwnBombNearby()` prevents sandwich traps within `fireRange+1` tiles of own active bomb
- Movement decisions only run when `player.canMove()` to prevent oscillation between hunt/seek_wall
- Trapped behavior: when completely stuck in danger with no movement options, bots accept their fate (removed `stuck_bomb` — unfair escape from player traps)

## Kick Behavior

- Kick decisions gated on `canMove()` + `kickCooldown` (2 ticks) to prevent kick spam
- `findKickableBomb()` skips own bombs unless `<=15 ticks` remaining (self-defense kick)
- Offensive kick (priority 3.5): `findOffensiveKick()` pushes bombs toward enemies in line-of-sight when not in danger

## Hunt System

- Hunt search depth configurable per difficulty (easy=6, normal=25, hard=40)
- **Hunt persistence**: `huntLockTicks` keeps bot hunting for 15 ticks after finding a path, preventing chain breaks from random `huntChance` gate; `wasHunting` flag continues movement in last direction when BFS loses the path (`hunt_persist`)
- **Close-range bombing**: `bomb_hunt` triggers when hunting within 3 tiles of enemy and enemy is in blast range
- **Hunt oscillation detector (Fix C)**: Tracks `huntPosHistory` (last 10 positions) and `huntWithoutProgressTicks`; triggers `huntStuck` when `<=huntStuckThreshold` unique positions in 8+ entries OR `huntWithoutProgressTicks >= huntStuckMaxTicks` (normal=60, hard=40); forces `bomb_wall`/`seek_wall` toward enemy for 30-tick cooldown then retries

## Wall Clearing

- `bomb_path` (when hunt BFS fails) and `bomb_roam` (while roaming) actively bomb destructible walls toward nearest enemy via `findWallTowardEnemy()` heuristic
- `bomb_roam` suppressed when oscillating (<=2 unique positions in last 4 moves)
- Directional wall clearing: prefers breaking walls toward enemies rather than just the nearest wall
- `findDestructibleWallDirection` skips dead-end destinations (`walkableDirs < 2`) so bots aren't sent to positions where `bomb_wall`'s safety check blocks them

## Roaming

- Tracks `ticksSinceEnemyContact`; after idle threshold (normal=3s, hard=2s, halved in mid-game) bot moves toward nearest enemy via manhattan heuristic

## Game Phase System

Three phases:
- **Early** (<35% round time): Base behavior
- **Mid-game** (35-60%): +0.1 hunt chance, 75% bomb cooldown, halved roam idle threshold
- **Late-game** (>60%): Always hunt, always roam, custom bomb cooldown

**Proximity aggression**: Bomb cooldown reduced to 75% when within 5 tiles of enemy, even in early game.

## Remote Bomb Strategy

- **Strategic hold (Fix B)**: Bots hold remote bombs for `remoteHoldThreshold` ticks (easy=20, normal=40, hard=60) before detonating — prevents wasteful fire-and-forget; `stalemateActive` overrides the hold
- **Detonation triggers**: Enemy in blast zone, near a bomb (manhattan <=2), movement blocked by own remote bomb blast, or after hold threshold at max bombs (priority 2.5)
- **Shield-aware sacrifice**: Detonates even when `selfInBlast` if bot has shield and enemy doesn't; self-damage check skipped if bot has shield; invulnerable enemies (post-shield-break) are ignored
- **Self-unblock detonation**: Computes `ownRemoteBlastCells` from own remote bombs (pierce-aware), checks if any walkable direction leads into both blast set and BFS danger set — detonates (with `!selfInBlast` guard)
- **Delayed self-unblock**: `remoteBlockedTicks` counter requires 10 ticks (0.5s) blocked OR enemy within manhattan 5 before detonating — gives bots time to find alternative paths
- **Pre-placement guard**: `wouldRemoteBombSelfBlock()` checks if placing a remote bomb would block ALL walkable neighbor directions with its blast zone; skips placement when no enemy is in blast range

## Stalemate Breakers

- **Shield stalemate (Fix A)**: Detects mutual shielded bombing loops (both players shielded, within 8 tiles, no kills, late game or <=2 alive); after threshold ticks (normal=100, hard=60) activates `stalemateActive` — bypasses `canEscapeAfterBomb`, reduces `minWalkableDirs` to 1, increases `bomb_hunt` distance to 5, skips `hasOwnBombNearby`; skips bombing invulnerable enemies
- **Duel stalemate**: Detects 1v1 scenarios (<=1 alive enemy) with no kill progress for `duelStalemateThresholdTicks` (normal=200/10s, hard=120/6s); activates `stalemateActive` to escalate aggression; complements shield stalemate which handles the specific mutual-shield case faster

## Anti-Oscillation

- `orderedDirs()` helper iterates `lastDirection` first in all BFS seed steps
- `posHistory` (last 4 positions) with `wouldOscillate()` check filters directions that revisit recent tiles
- Wander has 85% continuation probability and prefers non-oscillating candidates
- `seek_wall` skips entirely when already adjacent to a destructible wall (prevents seek_wall<->wander ping-pong)

## Power-Up Awareness

- **Pierce-aware danger zones**: `getDangerCells()`, `canEscapeAfterBomb()`, `isEnemyInBlastRange()`, and remote bomb detonation check all respect `bomb.isPierce`/`player.hasPierceBomb` — pierce bombs blast through destructible walls, matching `calculateExplosionCells()` in shared/
- **Line bomb escape**: `canEscapeAfterBomb()` simulates full line of bombs in facing direction (using available bomb capacity) — danger zones computed for ALL future bomb positions
- **Shield aggression**: Hard bots skip escape validation when shielded (bomb freely with shield active)

## Map-Size Scaling

Constructor accepts optional `mapSize`, scales `huntSearchDepth`, `escapeSearchDepth`, `roamAfterIdleTicks`, `powerUpVision` relative to reference 15x13 map area using `sqrt(area/referenceArea)` scale factor; capped at sensible maximums (`huntSearchDepth=80`, `escapeSearchDepth=25`, `powerUpVision=40`).

## Performance

- Bot AI runs full `generateInput()` every other tick (even ticks only); odd ticks reuse last input via `_lastBotInputs` cache — halves CPU cost
- `DIR_DELTA_ARRAY` module-level constant replaces 12 `Object.values(DIR_DELTA)` calls per bot per tick
- `aliveEnemies` computed once in `generateInput()` and reused for stalemate detection
