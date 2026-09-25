# Solo Campaign System

Single-player campaign mode: progress through hand-crafted levels grouped into worlds, defeating enemies to advance.

## World/Level Structure

Worlds contain ordered levels. Each level has configurable: win condition, lives, timer, power-up carry-over, starting stats, map dimensions, tile layout.

## Enemy System

### Data-Driven Enemy Types
Admin-created templates stored in DB (`campaign_enemy_types` table). Each type specifies: speed, movement pattern, wall/bomb passability, HP, contact damage, bombing ability, sprite config, drop table, boss phases.

### Movement Patterns
- `random_walk` — 60% continue, random at intersections
- `chase_player` — BFS + 30% random
- `patrol_path` — waypoint reversal
- `wall_follow` — right-hand rule
- `stationary`

### Bomb Triggers
- `timer` — every N ticks
- `proximity` — manhattan distance check
- `random` — 15% chance

### Boss Support
`isBoss` flag on enemy types with `bossPhases` (HP threshold triggers: speed changes, new movement patterns, minion spawns, bomb activation). Visual: `sizeMultiplier` for larger sprites, dedicated HP bar in HUD.

## Win Conditions

| Condition | Description |
|-----------|-------------|
| `kill_all` | All enemies dead |
| `find_exit` | Kill prerequisite count -> exit unlocks -> player steps on it |
| `reach_goal` | Step on goal tile |
| `survive_time` | Elapsed time >= target |

## Lives System

Configurable per level (1-99). On death: respawn at spawn point after 40 ticks with 40 ticks invulnerability. Lives exhausted -> game over.

## Par Time & Star Ratings

Each level has a configurable `parTime` (seconds, 0=none). Stars: 3=zero deaths, 2=completed under par time, 1=completed. Stars only improve, never regress. Level editor exposes par time in settings panel.

## Hidden Power-Ups

Power-ups marked `hidden: true` are placed under destructible walls; revealed when the wall is destroyed. `reservedPowerUpTiles` Set on `GameStateManager` prevents random power-up drops at positions with hidden power-ups.

## Covered Tiles

Special tiles (exit, goal, teleporters, conveyors) can be hidden under destructible walls via the `coveredTiles` array on `CampaignLevel`. In the editor, covered tiles display as overlays at 0.7 alpha on top of the wall sprite. During gameplay, `CampaignGame.campaignTick()` checks destroyed wall positions and restores the covered tile type. Covered tiles are processed before hidden power-ups so both can coexist on the same position.

## Campaign Game Session

`CampaignGame.ts` wraps `GameStateManager` with `customMap` (bypasses `generateMap()`). Each tick, `GameStateManager.processTick()` runs first (player input, movement, bombs, explosions, player deaths), then `campaignTick()`: 60-minute safety cap and the level's own time limit (every win condition except `survive_time`) -> slowing-tile move penalty -> respawns -> enemy-explosion collision (before enemy movement, so enemies cannot dodge a same-tick blast) -> enemy tick, conveyors and AI movement -> slowing tiles for enemies -> enemy-explosion collision again (enemies that walked into fire) -> player-enemy contact -> covered tile reveals -> hidden power-up reveals -> puzzle tiles -> hazard tiles -> boss phases -> win condition check -> post-win grace period. An explosion damages each enemy at most once, so an enemy's HP is the number of blasts it survives.

`GameStateManager.checkWinCondition()` and time limit check skip `campaign` mode — CampaignGame handles its own.

**Countdown**: campaign levels start with the normal 3-2-1-GO countdown. State is broadcast during it (the client shows the overlay) but not recorded to the replay, and level time is counted from the first playing tick.

**Respawn**: On death, player respawns after 40 ticks. Frontend detects `me.alive` flipping back to `true` in campaign mode and exits spectator mode, restoring normal controls.

**Session management**: `CampaignGameManager` singleton — one active session per user. Starting a new level ends existing session.

## Tile Types

- `exit` — trapdoor texture, conditionally walkable (unlocks after prerequisite kills)
- `goal` — gold star texture, always walkable
- `teleporter_a` / `teleporter_b` — stepping on A teleports to a random B tile (and vice versa). Uses seeded RNG. Applies to players and campaign enemies. Movement cooldown applied after teleport
- `conveyor_up/down/left/right` — auto-pushes players in the conveyor's direction when movement cooldown is ready. Processed after player inputs in `processTick()`. Conveyor pushing onto a teleporter triggers the chain effect. Enemies are not affected by conveyors (they use their own AI-driven movement)

Added to `TileType` union, `CollisionSystem.isWalkable()`, `TileMap.getTileTexture()`, `BootScene.generateTextures()`.

## Frontend

- Campaign button in lobby -> `CampaignUI` full-screen overlay with world cards, level selection, progress display, star ratings
- Clicking "Start" fetches level + enemy types, sets `campaignMode` registry flag, emits `campaign:start`
- **GameScene integration**: Detects `campaignMode` -> creates `EnemySpriteRenderer`, listens on `campaign:state` instead of `game:state`, sends `campaign:input`
- **HUD campaign variant**: Lives hearts (top-left), enemy count remaining, boss HP bar (300px, centered). Hides player list and kill feed. Timer hidden when no time limit (`roundTime >= 99999`)
- **Game over variant**: "LEVEL COMPLETE!" (green) or "LEVEL FAILED" (red), stars display, time taken, Next Level / Retry / Campaign buttons. Retry and Next Level directly emit `campaign:start` and transition to GameScene (no lobby round-trip)

## Procedural Enemy Textures

`EnemyTextureGenerator.ts` renders 6 body shapes (blob, spiky, ghost, robot, bug, skull) x 4 eye styles (round, angry, sleepy, crazy) x 4 directions. Features: teeth, horns. Canvas2D preview for admin editor.

`EnemySprite.ts` — campaign enemy sprites with directional textures, HP bars, per-frame position interpolation (`frame(delta)`, the players' 0.45-per-tick speed at any frame rate; a jump of more than 3 tiles is drawn as one), death animation (red tint, scale down, fade), ghost translucency.

## Level Editor

`LevelEditorScene.ts` — full Phaser scene with DOM overlay:
- Tool palette (tiles, hazard tiles, enemies, power-ups), click-to-place, paint mode (drag)
- Hazard section: Teleporter A/B, Conveyor up/down/left/right — placeable directly or under destructible walls (covered tile system)
- Camera viewport offset so toolbar doesn't obscure the map
- Zoom (scroll), pan (right/middle-click drag or WASD/arrow keys)
- Map dimension controls (width/height, odd 7-51) with content-preserving resize
- Undo/redo (Ctrl+Z/Y, 50-state stack, includes dimension changes)
- Save/load via API
- Level settings panel: name, dimensions, lives, time limit, par time, win condition, published toggle
- Admin-only, launched from CampaignTab

## Admin CampaignTab

Two views:
- **Worlds & Levels**: CRUD, reorder, publish/unpublish, edit launches editor
- **Enemy Types**: CRUD with live Canvas2D sprite preview, all config fields

**Admin -> Editor flow**: CampaignTab's "Edit" button sets `editorLevelId` in Phaser registry, awaits `ensureLevelEditorScene(game)` (the editor is a lazy chunk), clears admin UI DOM, and starts `LevelEditorScene` via the scene manager.

## Progress Tracking

- `campaign_progress` table per user per level. Best time tracked
- `campaign_user_state` for current position and carried powerups

## Database

- Migration `008_campaign.sql` — 5 tables: `campaign_enemy_types`, `campaign_worlds`, `campaign_levels`, `campaign_progress`, `campaign_user_state`
- Seed migration `009_campaign_seed.sql` — 3 enemy types + "Training Grounds" world with 3 levels
- Migration `010_campaign_par_time.sql` — adds `par_time` column to `campaign_levels`
- Migration `011_fix_campaign_tile_types.sql` — fixes seed tile types (`'indestructible'` -> `'wall'`)
- Migration `023_covered_tiles.sql` — adds `covered_tiles` JSON column to `campaign_levels`

## API Endpoints

**Player (auth required)**:
- `GET /campaign/worlds`
- `GET /campaign/worlds/:id/levels`
- `GET /campaign/levels/:id`
- `GET /campaign/progress`
- `GET /campaign/enemy-types`

**Admin**: Full CRUD for worlds, levels, enemy types at `/admin/campaign/*`. `POST /admin/campaign/levels` requires `worldId` in body (included in Zod `levelSchema`), returns `{ id }` (not `{ level }`).

## Socket Events

**Client -> Server**: `campaign:start` (levelId, callback), `campaign:input` (PlayerInput; `playerId` lets the session owner drive a local co-op or buddy second player), `campaign:pause` / `campaign:resume` (callback; either co-op player pauses for both), `campaign:quit`

**Server -> Client**: `campaign:gameStart`, `campaign:coopStart` (online co-op partner follows the leader into a level), `campaign:state`, `campaign:playerDied`, `campaign:enemyDied`, `campaign:exitOpened`, `campaign:playerLockedIn`, `campaign:levelComplete`, `campaign:gameOver`, `campaign:partnerLeft`, `campaign:pauseState`

## Buddy Mode

Player 2 as a small, invulnerable support character (`Player.isBuddy`): passes through destructible walls and bombs, picks up power-ups for P1, places limited bombs, and is blocked by closed gates and pits. The host's client drives it through `campaign:input` with `playerId`. Name, colour and size (40-80%) are per-account buddy settings (Settings > Preferences or the launch modal). Buddy runs are not co-op for lives and lock-in (`isCoopMode` is false); Retry and Next Level keep buddy mode, and leaving the run clears it (`clearCampaignRun()`).

## Seed Data — Training Grounds

| # | Level | Size | Lives | Timer | Par | Enemies | Win Condition |
|---|-------|------|-------|-------|-----|---------|---------------|
| 1 | First Steps | 15x13 | 3 | — | 60s | 3 blob enemies, 2 hidden powerups | kill_all |
| 2 | Ghost Town | 19x15 | 3 | 120s | 90s | 2 blobs + 2 ghosts, 3 powerups | find_exit (kill 3) |
| 3 | Bomber's Lair | 21x17 | 5 | 180s | 120s | 3 blobs + 2 ghosts + 1 robot bomber (2 HP), 5 powerups | kill_all |
