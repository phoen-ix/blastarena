# Performance & Internals

Optimizations across the game loop, network layer, and rendering pipeline for low-latency multiplayer.

## Network & Bandwidth

- **Delta tile encoding**: `toTickState()` sends only changed tiles as `tileDiffs` array instead of full `map.tiles` grid every tick — client stores initial tiles from `game:start` and applies diffs in-place. `toState()` still sends full tiles for replays, simulations, and initial state. `TileDiff` type in `shared/src/types/game.ts`
- **Socket.io per-message compression**: `perMessageDeflate` enabled with 256-byte threshold — compresses JSON payloads ~60-70%
- **Room list broadcast debouncing**: `broadcastRoomList()` coalesced via `setImmediate()` — multiple rapid room mutations produce a single broadcast
- **Game input hot path**: `game:input` socket handler uses cached `socket.data.activeRoomCode` instead of Redis `getPlayerRoom()` lookup per input — eliminates ~600 Redis calls/sec per active room. Set on room create/join/reconnect, cleared on leave/disconnect
- `GameRoom.broadcastState()` passes raw `gameState.map.tiles` reference to `ReplayRecorder` (via shallow object spread) so replays get actual tile data while broadcasts send empty tiles array with diffs

## Bot AI Tick Throttling

Bot AI runs full `generateInput()` every other tick (even ticks only); odd ticks reuse last input via `_lastBotInputs` cache — halves bot CPU cost with minimal behavior impact (decisions update every 100ms instead of 50ms).

`_lastBotInputs: Map<number, PlayerInput>` stores each bot's last decision; cleared when bot returns null input.

## Tile Change Tracking

- `_dirtyTiles: Map<string, TileDiff>` in `GameStateManager` tracks tile mutations per tick
- `destroyTileTracked()` wraps `CollisionSystem.destroyTile()` and records the change — used in bomb detonation and meteor impacts
- `toTickState()` drains `_dirtyTiles` into `tileDiffs` array, then clears the map

## Per-Tick Caching

- `getAlivePlayers()` result cached within `processTick()` (guarded by `_processingTick` flag); invalidated via `invalidateAliveCache()` after every death/respawn — eliminates 7+ redundant `Array.from().filter()` per tick
- Bomb slide collision uses pre-built `Set<string>` for bomb and player positions — O(1) lookups instead of O(n) inner loops
- Shared `bombPositions` array built once per tick and passed to all `processPlayerInput()` calls
- Chain reaction bomb lookup uses `Set<string>` of explosion cells — O(1) `has()` instead of O(cells) `Array.some()`
- KOTH hill controlling player cached during scoring step, reused in `toState()`
- Conditional tile snapshot: `map.tiles` deep-copy only when other bombs exist beyond those detonating (chain reactions possible)

## Serialization

- `mapToArray()` helper replaces `Array.from(map.values()).map(fn)` chains in `toState()` — single-pass iteration, halves intermediate allocations
- `DIR_DELTA_ARRAY` module-level constant in BotAI replaces 12 `Object.values(DIR_DELTA)` calls per bot per tick
- BotAI `aliveEnemies` computed once in `generateInput()` and reused for stalemate detection

## Frontend Rendering

- HUD stats bar uses persistent element refs — creates DOM once, updates `textContent`/`opacity` only when values change (no innerHTML rebuild per tick)
- Kill feed tracks individual DOM elements — appends new entries, removes expired ones directly
- Team indicator drawn at Graphics origin, positioned via `setPosition()` — eliminates `clear()` + `fillRoundedRect()` every frame
- Shield graphic drawn at origin with `setPosition()` for positioning
- Dust particle emitter pooled per player — one persistent emitter repositioned and reused
- ReplayLogPanel uses `DocumentFragment` for batch DOM insertion

## Database

- Admin dashboard stats consolidated into single SQL query with subselects (3 queries -> 1)
- Match history uses pre-aggregated JOIN for player count instead of correlated subquery per row

## Game Logging

- JSONL game logs written to `./data/gamelogs/` (bind-mounted from container)
- Logs every bot decision, kill, bomb placement/detonation, and tick snapshots
- Filename format: `{ISO-timestamp}_{roomCode}_{gameMode}_{playerCount}p.jsonl`
- `GameLogger` supports 3 verbosity levels: normal (tick every 5), detailed (tick every 2 + movements/pickups), full (every tick + explosion detail + bot pathfinding)
- `GameLogger` enhanced with `shouldLogTick()`, `logMovement()`, `logPowerupPickup()`, `logExplosionDetail()`, `logBotPathfinding()` — all backward-compatible
- Simulation logs written to `./data/simulations/{gameMode}/batch_*/` with separate directory per game mode
