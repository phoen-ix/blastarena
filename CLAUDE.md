# BlastArena

Multiplayer online grid-based explosive arena game.

## Project Structure
- Monorepo with npm workspaces: `shared/`, `backend/`, `frontend/`
- Docker Compose for orchestration (MariaDB, Redis, Node.js backend, Nginx)

## Development
```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Tech Stack
- Backend: Node.js + Express + TypeScript + Socket.io
- Frontend: Phaser.js + TypeScript + Vite
- Database: MariaDB 11 + Redis 7
- Shared types between frontend/backend via workspace

## Key Patterns
- Server-authoritative game logic; client only renders + sends inputs
- Grid-based movement: players occupy exactly one tile at a time
- Movement cooldown system (MOVE_COOLDOWN_BASE ticks, reduced by speed power-ups)
- JWT (access token in memory) + httpOnly cookie (refresh token) auth
- Cookie `secure` flag derived from APP_URL (not NODE_ENV) for HTTP/HTTPS compatibility
- Zod for request validation
- All game constants in shared/src/constants/
- Socket.io listeners use one-shot pattern for game:start to prevent leaks across scene transitions
- Bot players use negative IDs (-(i+1)) to avoid DB conflicts; skipped in DB writes
- Bot count auto-capped to maxPlayers - humanPlayers (both frontend and backend)
- Singleplayer: 1 human + 1+ bots is enough to start a game
- Friendly fire config: when OFF, same-team explosions don't damage teammates (self-damage still applies)
- Map dimensions should be odd numbers for proper indestructible wall grid pattern

## Frontend Architecture
- **Composed rendering**: GameScene.ts is a thin orchestrator that delegates to dedicated renderer classes in `frontend/src/game/`:
  - `TileMap.ts` — tile grid rendering with floor variants, destruction animation, and support for new tile types (teleporters, conveyors, cracked walls)
  - `PlayerSprite.ts` — player sprites with directional eyes, shield aura, squash/stretch movement, dust particles, and death effects
  - `BombSprite.ts` — bomb sprites with pulsing tween, fuse spark particles, and last-second urgency flashing
  - `ExplosionSprite.ts` — animated explosions with expansion wave, sustain pulse, fade phase, and fire/smoke particles
  - `PowerUpSprite.ts` — power-up sprites with floating animation and distinctive icons per type
  - `ShrinkingZone.ts` — Battle Royale danger zone overlay using Graphics path with circle hole
  - `EffectSystem.ts` — subscribes to `game:explosion`, `game:playerDied`, `game:powerupCollected` socket events for screen shake, debris particles, and collection popups
  - `CountdownOverlay.ts` — animated "3, 2, 1, GO!" countdown at game start
  - `Settings.ts` — per-user visual settings (animations, screen shake, particles) stored in localStorage
- **Procedural textures**: All sprites generated in `BootScene.generateTextures()` — no external image assets. Player textures include 4 directional variants with eyes per color.
- **Particle textures**: `particle_fire`, `particle_smoke`, `particle_spark`, `particle_debris`, `particle_star`, `particle_shield` generated in BootScene
- **HUD**: DOM-based overlay in HUDScene.ts with timer, player list, kill feed, stats bar (bottom-left), spectator banner
- Settings and Help are in the lobby header (LobbyUI), not in-game HUD, to avoid overlapping player names

## Game Architecture
- 20 tick/sec server game loop (GameLoop.ts -> GameState.ts)
- GameState.processTick(): bot AI -> inputs -> movement -> bomb slide -> bomb timers -> explosions -> collisions -> power-ups -> KOTH scoring -> map events -> zone -> deathmatch respawns -> time check -> win check
- Bomb kick: player with hasKick walking into a bomb sets bomb.sliding direction; sliding bombs advance 1 tile/tick until blocked; kicking applies movement cooldown
- BotAI: difficulty-aware (easy/normal/hard) with configurable awareness, aggression, escape depth, reaction delay, and kick usage
- BotAI kick decisions gated on canMove() + kickCooldown to prevent kick spam (standing still retrying kicks for multiple ticks)
- Bot difficulty set per-room via MatchConfig.botDifficulty; defaults to 'normal'; UI dropdown hidden when bots = 0
- BotAI escape logic: BFS through danger cells to find nearest safe cell; canEscapeAfterBomb and flee use the same findEscapeDirection BFS so the bot follows the validated escape path
- BotAI movement decisions only run when player.canMove() to prevent oscillation between hunt/seek_wall
- Self-kills subtract 1 from kill score (owner.kills decremented, owner.selfKills incremented)
- Game over placements sorted by kills descending, tiebreak by survival placement
- Grace period: 30 ticks (1.5s) after win condition before status='finished' to show final explosions
- Dead players enter spectator mode with free camera pan (WASD/arrows), click-to-follow on HUD player list, or number keys 1-9
- Spectate-follow breaks only on new keydown (not stale keysDown state); blur handler clears keysDown to prevent stuck keys
- HUD spectate click uses mousedown event delegation on stable container (not click, which is unreliable with innerHTML rebuilds)
- Camera follows local player with smooth lerp when map exceeds viewport
- Room name auto-generated if left blank (random adjective + noun)
- Play Again: room:restart socket event resets room to 'waiting' so all players can rematch; other players auto-navigate via room:state listener
- Phaser scene lifecycle: shutdown() must be registered via `this.events.once('shutdown', this.shutdown, this)` — Phaser does NOT auto-call shutdown() methods. Scenes also defensively clean up stale state at the top of create() in case shutdown wasn't called.
- `tickEvents` buffer on GameStateManager accumulates per-tick events (explosions, deaths, power-up pickups) for fine-grained socket emission in GameRoom
- Chain reaction tile snapshot: before processing detonations, tiles are snapshotted so chained bombs calculate blast cells against original wall layout (prevents blasts going through walls destroyed by earlier bombs in the same tick)
- Shield has no time limit — lasts until consumed by an explosion. Extra shield pickups are consumed but don't stack.

## Game Modes
- **Free for All (FFA)**: 2-8 players, last player standing wins, 3 min
- **Teams**: 4-8 players, 2 teams, last team standing wins, friendly fire toggle, 4 min
- **Battle Royale**: 4-8 players, shrinking circular zone, 5 min
- **Sudden Death**: 2-8 players, all start maxed (8 bombs, 8 range, 5 speed, kick), no power-ups, one hit kills, 2 min
- **Deathmatch**: 2-8 players, respawn after 3s with reset stats, first to 10 kills or most kills at time wins, 5 min
- **King of the Hill**: 2-8 players, control 3x3 center zone for points, first to 100 wins, 4 min

## Power-Ups (8 types)
- bomb_up, fire_up, speed_up, shield, kick (original 5)
- **pierce_bomb**: Explosions pass through destructible walls (still destroys them)
- **remote_bomb**: Bombs don't auto-detonate; press E key to detonate all remote bombs at once (10s safety max timer)
- **line_bomb**: Places a line of bombs in facing direction (up to remaining bomb capacity)

## Map Features
- **Reinforced walls** (optional): Destructible walls take 2 hits — first hit cracks (`destructible_cracked`), second hit destroys
- **Dynamic map events** (optional): Meteor strikes every 30-45s (2s warning reticle), power-up rain every 60s
- **Hazard tiles** (optional): Teleporter pairs (A/B, instant transport), conveyor belts (force movement in direction)

## Room Configuration
MatchConfig includes: gameMode, maxPlayers, mapWidth/Height, mapSeed, roundTime, wallDensity, enabledPowerUps (all 8), powerUpDropRate, botCount, botDifficulty, friendlyFire, hazardTiles, enableMapEvents, reinforcedWalls

## Game Logging
- JSONL game logs written to ./data/gamelogs/ (bind-mounted from container)
- Logs every bot decision, kill, bomb placement/detonation, and tick snapshots (every 5 ticks)
- Filename format: `{ISO-timestamp}_{roomCode}_{gameMode}_{playerCount}p.jsonl`

## Testing
```bash
npm test
```

## Docker
- Production: `docker compose up --build -d`
- Only nginx exposes a port (APP_EXTERNAL_PORT, default 8080)
- Data persists in ./data/ (bind mounts)
- Nginx serves no-cache headers for index.html to prevent stale frontend after deploys
