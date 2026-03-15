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
  - `BombSprite.ts` — bomb sprites with pulsing tween (normal) or alpha blink (remote, blue texture), fuse spark particles, and last-second urgency flashing
  - `ExplosionSprite.ts` — animated explosions with expansion wave, sustain pulse, fade phase, and fire/smoke particles
  - `PowerUpSprite.ts` — power-up sprites with floating animation and distinctive icons per type
  - `ShrinkingZone.ts` — Battle Royale danger zone overlay using Graphics path with circle hole
  - `EffectSystem.ts` — subscribes to `game:explosion`, `game:playerDied`, `game:powerupCollected` socket events for screen shake, debris particles, and collection popups
  - `CountdownOverlay.ts` — animated "3, 2, 1, GO!" countdown at game start
  - `GamepadManager.ts` — gamepad/controller input polling with deadzone, D-pad/stick direction, just-pressed action tracking
  - `Settings.ts` — per-user visual settings (animations, screen shake, particles) stored in localStorage
- **Procedural textures**: All sprites generated in `BootScene.generateTextures()` — no external image assets. Player textures include 4 directional variants with eyes per color.
- **Particle textures**: `particle_fire`, `particle_smoke`, `particle_spark`, `particle_debris`, `particle_star`, `particle_shield` generated in BootScene
- **HUD**: DOM-based overlay in HUDScene.ts with timer, player list, kill feed, stats bar (bottom-left), spectator banner
- Settings and Help are in the lobby header (LobbyUI), not in-game HUD, to avoid overlapping player names
- Help modal covers: controls (keyboard + gamepad), all 8 power-ups (with in-game tile preview + HUD emoji), all 6 game modes, map features (reinforced walls, map events, hazard tiles with visual previews), and core mechanics
- Countdown synced between server and client: GameLoop holds `status: 'countdown'` for 36 ticks (1.8s) while CountdownOverlay plays "3, 2, 1" — gameplay starts on "GO!". Both client and server block inputs during countdown.
- **Gamepad support**: Xbox/standard gamepad via Phaser gamepad plugin (`input: { gamepad: true }` in config). D-pad/left stick for movement (0.3 deadzone, dominant-axis), A=bomb, B=detonate, LB/RB=cycle spectate. GamepadManager polls each frame; actions latched in `pendingGamepadAction` to survive 50ms tick throttle. Keyboard takes priority when both active.
- **Real-time lobby**: Room list auto-updates via `room:list` socket broadcast on every room mutation (create/join/leave/start/restart/disconnect) — no manual refresh needed

## Admin Panel
- Full-screen panel accessible from lobby header (Admin button visible for admin and moderator roles)
- **Top-tab navigation**: Dashboard, Users, Matches, Rooms, Logs, Announcements (role-filtered)
- **Permission matrix**: Admin sees all 6 tabs; Moderator sees Users, Matches, Rooms, Announcements only
- **Dashboard**: 5 stat cards (total users, active 24h, total matches, active rooms, online players) with 30s auto-refresh
- **Users**: Paginated table with search, role change dropdown, deactivate (soft delete), delete permanently (type-username confirmation), create user modal
- **Matches**: Paginated table, click row for detail modal with per-player stats
- **Rooms**: Active rooms with 5s auto-refresh, kick player, force close (admin only), spectate, send message — all via socket events
- **Logs**: Admin action audit trail with action type filter, paginated
- **Announcements**: Toast broadcast (ephemeral notification to all players) + persistent banner (shows at top of lobby until cleared)
- Backend: `staffMiddleware` (admin+moderator) and `adminOnlyMiddleware` (admin only) for route protection
- `backend/src/game/registry.ts` — singleton for RoomManager/IO access from admin service
- Admin socket events: `admin:kick`, `admin:closeRoom`, `admin:spectate`, `admin:roomMessage`, `admin:toast`, `admin:banner`, `admin:kicked`
- All admin actions logged to `admin_actions` table for audit
- Deactivated users blocked from login and token refresh
- Self-protection: admins cannot deactivate/delete themselves
- Public endpoint `GET /admin/announcements/banner` for lobby banner display (no auth required)

## Account Management
- **Account modal** in lobby header lets users edit their username and email
- Username is the single player name shown everywhere (no separate display name)
- Username change: server validates format (3-20 chars, alphanumeric + underscore/hyphen) and checks uniqueness; returns 409 CONFLICT if taken
- Email change: two-step confirmation flow — user submits new email, server sends a confirmation link to the new address (24h expiry), email only swaps when the link is clicked
- Admins skip email verification — email changes take effect immediately
- Pending email changes visible in Account modal with a cancel option
- Email change confirmation endpoint: `GET /api/user/confirm-email/:token`
- Migration `003_user_profile.sql` adds `pending_email`, `email_change_token`, `email_change_expires` columns to users table
- `AuthManager.updateUser()` patches in-memory user state after profile edits so the lobby header updates without a page refresh

## Teams
- Team assignment: host can assign players and bots to Team Red (0) or Team Blue (1) via dropdowns in RoomUI waiting room
- Unassigned players/bots fall back to round-robin at game start
- Bot team assignments stored in `MatchConfig.botTeams` array; bots rendered as placeholder entries in waiting room player list
- **In-game visual distinction**: Team-based color palettes (Red team: red/orange/yellow; Blue team: blue/cyan/purple), team-colored name labels, colored underline bar beneath sprites
- **HUD**: Player list grouped by team with "Team Red"/"Team Blue" headers and colored dots
- **Game over**: Team column in results, dead players shown with strikethrough and dimmed colors, finish reason uses team names ("Team Red wins!")
- `room:setTeam` and `room:setBotTeam` socket events for lobby team assignment

## Game Architecture
- 20 tick/sec server game loop (GameLoop.ts -> GameState.ts)
- GameState.processTick(): bot AI -> inputs -> movement -> bomb slide -> bomb timers -> explosions -> collisions -> power-ups -> KOTH scoring -> map events -> zone -> deathmatch respawns -> time check -> win check
- Bomb kick: player with hasKick walking into a bomb sets bomb.sliding direction; sliding bombs advance 1 tile/tick until blocked; kicking applies movement cooldown
- BotAI: difficulty-aware (easy/normal/hard) with configurable awareness, aggression, escape depth, reaction delay, and kick usage
- BotAI kick decisions gated on canMove() + kickCooldown to prevent kick spam (standing still retrying kicks for multiple ticks)
- Bot difficulty set per-room via MatchConfig.botDifficulty; defaults to 'normal'; UI dropdown always visible but disabled when bots = 0
- BotAI escape logic: BFS through danger cells to find nearest safe cell; canEscapeAfterBomb and flee use the same findEscapeDirection BFS so the bot follows the validated escape path
- BotAI movement decisions only run when player.canMove() to prevent oscillation between hunt/seek_wall
- BotAI power-up seeking uses BFS pathfinding (not line-of-sight) so bots find power-ups around corners
- BotAI hunt search depth is configurable per difficulty (easy=10, normal=25, hard=35) to handle large/dense maps
- BotAI roaming: tracks ticksSinceEnemyContact; after idle threshold (normal=5s, hard=3s) bot moves toward nearest enemy via manhattan heuristic
- BotAI directional wall clearing: prefers breaking walls toward enemies rather than just the nearest wall
- BotAI danger timer threshold: normal/hard bots ignore bombs with many ticks remaining (>30/40) unless within 2 tiles, reducing unnecessary fleeing from fresh bombs
- Self-kills subtract 1 from kill score (owner.kills decremented, owner.selfKills incremented)
- Game over placements sorted by kills descending, tiebreak by survival placement
- Grace period: 30 ticks (1.5s) after win condition before status='finished' to show final explosions
- Dead players enter spectator mode with free camera pan (WASD/arrows/D-pad), click-to-follow on HUD player list, number keys 1-9, or LB/RB gamepad bumpers
- Spectate-follow breaks only on new keydown (not stale keysDown state); blur handler clears keysDown to prevent stuck keys
- HUD spectate click uses mousedown event delegation on stable container (not click, which is unreliable with innerHTML rebuilds)
- Camera follows local player with smooth lerp when map exceeds viewport
- Room name auto-generated if left blank (random adjective + noun)
- Play Again: room:restart socket event resets room to 'waiting' so all players can rematch; other players auto-navigate via room:state listener
- Phaser scene lifecycle: shutdown() must be registered via `this.events.once('shutdown', this.shutdown, this)` — Phaser does NOT auto-call shutdown() methods. Scenes also defensively clean up stale state at the top of create() in case shutdown wasn't called.
- `tickEvents` buffer on GameStateManager accumulates per-tick events (explosions, deaths, power-up pickups) for fine-grained socket emission in GameRoom
- Chain reaction tile snapshot: before processing detonations, tiles are snapshotted so chained bombs calculate blast cells against original wall layout (prevents blasts going through walls destroyed by earlier bombs in the same tick)
- Shield has no time limit — lasts until consumed by an explosion. After shield breaks, player gets 10 ticks of invulnerability to escape the explosion area. Extra shield pickups are consumed but don't stack.
- BotAI detonates remote bombs when an enemy is in their blast zone, or when all bomb slots are full (priority 2.5 in decision tree)
- Game over screen shows context message (e.g., "Time's up!", "PlayerX is the last survivor!", "Draw — no survivors!")
- Game start transitions instantly to game scene; room:start guard checks both GameRoom existence and room status to prevent duplicate starts
- "Back to Lobby" from game over clears currentRoom registry to prevent stale room UI

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
MatchConfig includes: gameMode, maxPlayers, mapWidth/Height, mapSeed, roundTime, wallDensity, enabledPowerUps (all 8), powerUpDropRate, botCount, botDifficulty, botTeams, friendlyFire, hazardTiles, enableMapEvents, reinforcedWalls

## Game Logging
- JSONL game logs written to ./data/gamelogs/ (bind-mounted from container)
- Logs every bot decision, kill, bomb placement/detonation, and tick snapshots (every 5 ticks)
- Filename format: `{ISO-timestamp}_{roomCode}_{gameMode}_{playerCount}p.jsonl`

## Testing
```bash
npm test
```

## Connection Resilience
- Socket.io reconnects indefinitely (1-5s backoff) with a "Reconnecting..." overlay when disconnected
- On reconnect, client fetches `/api/health` and compares `buildId` (server start timestamp). If different, the page auto-refreshes to load new frontend.
- Nginx serves a custom 502 page (`docker/nginx/502.html`) during container rebuilds that auto-polls and refreshes when the app is back
- The 502 page detects the real app by checking for `game-container` in the response body

## Docker
- Production: `docker compose up --build -d`
- Only nginx exposes a port (APP_EXTERNAL_PORT, default 8080)
- Data persists in ./data/ (bind mounts)
- Nginx serves no-cache headers for index.html to prevent stale frontend after deploys
