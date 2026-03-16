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
- ApiClient 401 interceptor: auto-refreshes token and retries, but auth endpoints (login/register) use `skipAuthRetry` to pass 401 errors through directly — prevents logout side effects from corrupting session state
- Vite `allowedHosts` derived from `APP_URL` env var (hostname extracted at config load time), passed via docker-compose `environment`
- Zod for request validation
- All game constants in shared/src/constants/
- Socket.io listeners use one-shot pattern for game:start to prevent leaks across scene transitions
- Bot players use negative IDs (-(i+1)) to avoid DB conflicts; skipped in DB writes
- Bot count auto-capped to maxPlayers - humanPlayers (both frontend and backend)
- Singleplayer: 1 human + 1+ bots is enough to start a game
- Friendly fire config: when OFF, same-team explosions don't damage teammates (self-damage still applies)
- Map dimensions should be odd numbers for proper indestructible wall grid pattern
- Branding: "BLAST" in white, "ARENA" in orange (`--primary`). In HTML use `<span>BLAST</span>ARENA` where parent is `color: var(--primary)` and `span` is `color: var(--text)`. In Phaser canvas (MenuScene) use two separate text objects side by side
- Game canvas uses `Phaser.Scale.RESIZE` mode to fill the full browser viewport. Camera bounds auto-adjust: small maps are centered, large maps scroll with the player via smooth lerp
- Player sprite interpolation factor is 0.45 (snappy grid movement, not floaty)
- Modal overlay uses `position: fixed` to prevent backdrop-filter repaint flashes from sibling DOM mutations

## Frontend Architecture
- **Design System ("INFERNO")**: All CSS in `frontend/index.html` using CSS custom properties (`:root` vars). Colors: `--primary` (#ff6b35 hot orange), `--accent` (#00d4aa teal), `--danger` (#ff3355), `--success` (#00e676), `--warning` (#ffaa22), `--info` (#448aff). Backgrounds: `--bg-deep` (#080810) through `--bg-hover` (#24243e). Typography: Chakra Petch (display/headings) + DM Sans (body) via Google Fonts. Team colors: `--team-red` (#ff4466), `--team-blue` (#448aff). Always use CSS variables in inline styles (e.g. `var(--primary)` not hardcoded hex) for consistency.
- **Composed rendering**: GameScene.ts is a thin orchestrator that delegates to dedicated renderer classes in `frontend/src/game/`:
  - `TileMap.ts` — tile grid rendering with floor variants, destruction animation, and support for new tile types (teleporters, conveyors, cracked walls)
  - `PlayerSprite.ts` — player sprites with directional eyes, shield aura, squash/stretch movement (guarded by `activeMoveAnim` Set to prevent tween stacking), dust particles, and death effects
  - `BombSprite.ts` — bomb sprites with pulsing tween (normal) or alpha blink (remote, blue texture), fuse spark particles, and last-second urgency flashing
  - `ExplosionSprite.ts` — animated explosions with expansion wave, sustain pulse, fade phase, and fire/smoke particles
  - `PowerUpSprite.ts` — power-up sprites with floating animation and distinctive icons per type
  - `ShrinkingZone.ts` — Battle Royale danger zone overlay using Graphics path with circle hole
  - `HillZone.ts` — KOTH hill zone overlay with pulsing gold fill (green when controlled), corner markers, diamond center icon
  - `EffectSystem.ts` — subscribes to `game:explosion`, `game:playerDied`, `game:powerupCollected` socket events for screen shake, debris particles, and collection popups
  - `CountdownOverlay.ts` — animated "3, 2, 1, GO!" countdown at game start
  - `GamepadManager.ts` — gamepad/controller input polling with deadzone, D-pad/stick direction, just-pressed action tracking
  - `Settings.ts` — per-user visual settings (animations, screen shake, particles) stored in localStorage
- **Procedural textures**: All sprites generated in `BootScene.generateTextures()` — no external image assets. Player textures include 4 directional variants with eyes per color. Power-up textures use Canvas2D with emoji icons (💣🔥⚡🛡️👢💥📡🧨) on colored rounded-rect backgrounds instead of abstract geometric shapes, matching the HUD stats display for visual consistency.
- **Particle textures**: `particle_fire`, `particle_smoke`, `particle_spark`, `particle_debris`, `particle_star`, `particle_shield` generated in BootScene
- **HUD**: DOM-based overlay in HUDScene.ts with timer, player list, kill feed, stats bar (bottom-left), spectator banner. In KOTH mode, player list shows scores sorted descending with crown icon for the controlling player
- Settings and Help are in the lobby header (LobbyUI), not in-game HUD, to avoid overlapping player names
- Help modal covers: controls (keyboard + gamepad), all 8 power-ups (with in-game tile preview + HUD emoji), all 6 game modes, map features (reinforced walls, map events, hazard tiles with visual previews), and core mechanics
- Countdown synced between server and client: GameLoop holds `status: 'countdown'` for 36 ticks (1.8s) while CountdownOverlay plays "3, 2, 1" — gameplay starts on "GO!". Both client and server block inputs during countdown.
- **Gamepad support**: Xbox/standard gamepad via Phaser gamepad plugin (`input: { gamepad: true }` in config). D-pad/left stick for movement (0.3 deadzone, dominant-axis), A=bomb, B=detonate, LB/RB=cycle spectate. GamepadManager polls each frame; actions latched in `pendingGamepadAction` to survive 50ms tick throttle. Keyboard takes priority when both active.
- **Gamepad UI navigation**: `UIGamepadNavigator` singleton (`frontend/src/game/UIGamepadNavigator.ts`) enables full controller navigation of all DOM menus. Uses browser `navigator.getGamepads()` (not Phaser plugin) with its own rAF polling loop. D-pad/stick navigates between focusable elements, A=confirm, B=back/close. Spatial navigation via `getBoundingClientRect()` with heavy cross-axis penalty (5x) so same-row/column neighbors always win over diagonal ones. Focus context stack handles nested UI (lobby → modal): each screen pushes a context on show and pops on hide. Custom dropdown overlay (`.gp-dropdown`) for `<select>` elements — A opens, up/down navigates options, A confirms, B cancels. Mouse movement auto-hides the `.gp-focus` ring; next D-pad input restores it. Disabled during gameplay (`setActive(false)` in GameScene) to avoid conflict with GamepadManager. GameOverScene has its own inline gamepad polling (Phaser text objects, not DOM). Out of scope: AdminUI, AuthUI, ChatUI (keyboard-dependent).
- **Real-time lobby**: Room list auto-updates via `room:list` socket broadcast on every room mutation (create/join/leave/start/restart/disconnect) — no manual refresh needed

## Admin Panel
- Full-screen panel accessible from lobby header (Admin button visible for admin and moderator roles)
- **Top-tab navigation**: Dashboard, Users, Matches, Rooms, Logs, Simulations, Announcements (role-filtered)
- **Permission matrix**: Admin sees all 7 tabs (Simulations is admin-only); Moderator sees Users, Matches, Rooms, Announcements only
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

## Bot Simulation System
- Admin-only batch simulation runner for bot-only games — no human players, no DB records
- **SimulationsTab** in admin panel: configure game mode, bot count/difficulty, map size, round time, total games (1-1000), speed, log verbosity, all power-up/map options
- **Two speed modes**: Fast (ticks as fast as possible via `setImmediate` batching, ~100 ticks/yield) and Real-time (20 tps like normal games)
- **Live spectating**: Real-time mode auto-launches GameScene in spectator mode; Fast mode streams state at ~20fps via capped interval
- GameScene handles `sim:state` events for rendering, `sim:gameTransition` for between-game scene restarts, `sim:completed` for returning to lobby
- **Log directory structure**: `data/simulations/{gameMode}/batch_{timestamp}_{batchId}/` with per-game `sim_NNN.jsonl` files, `batch_config.json`, and `batch_summary.json`
- **Log verbosity levels**: Normal (5-tick snapshots), Detailed (2-tick + movements + pickups), Full (every tick + explosion detail + bot pathfinding)
- `GameLogger` enhanced with `shouldLogTick()`, `logMovement()`, `logPowerupPickup()`, `logExplosionDetail()`, `logBotPathfinding()` — all backward-compatible
- Backend: `SimulationGame.ts` (headless game runner), `SimulationRunner.ts` (batch orchestrator, EventEmitter), `SimulationManager.ts` (singleton, max 1 concurrent batch)
- Socket events: `sim:start`, `sim:cancel`, `sim:spectate`, `sim:unspectate` (C→S); `sim:progress`, `sim:gameResult`, `sim:state`, `sim:gameTransition`, `sim:completed` (S→C)
- REST endpoints: `GET/POST /admin/simulations`, `GET/DELETE /admin/simulations/:batchId`
- Bot names pool: AlphaBot through PulseBot (16 distinct names)
- Cancellation preserves completed game logs; 3s pause between realtime games, 0.5s for fast
- Delete batch: removes from memory + disk (`SimulationManager.deleteBatch()`); delete button shown for completed/cancelled batches
- Spectate button hidden for fast-speed batches (only shown for realtime)
- Results table: paginated (25/page) with sortable columns (click #/Winner/Duration/Kill Leader/Reason)
- Docker: `./data/simulations:/app/simulations` volume mount in both compose files

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
- BotAI escape logic: BFS through danger cells to find nearest safe cell; canEscapeAfterBomb verifies immediate walkable neighbor AND BFS escape path
- BotAI bomb safety: requires `player.canMove()` before placing bombs (prevents bombing during movement cooldown); dead-end check (`walkableDirs >= 2`); `hasOwnBombNearby()` prevents sandwich traps within `fireRange+1` tiles of own active bomb
- BotAI movement decisions only run when player.canMove() to prevent oscillation between hunt/seek_wall
- BotAI power-up seeking uses BFS pathfinding (not line-of-sight) so bots find power-ups around corners
- BotAI hunt search depth is configurable per difficulty (easy=10, normal=25, hard=35) to handle large/dense maps
- BotAI hunt persistence: `huntLockTicks` keeps bot hunting for 15 ticks after finding a path, preventing chain breaks from random huntChance gate
- BotAI close-range bombing: `bomb_hunt` triggers when hunting within 3 tiles of enemy and enemy is in blast range
- BotAI late-game aggression (>60% round time): always hunt (no random gate), always roam (no idle threshold), halved bomb cooldown, aggressive hunt mode skips escape/oscillation checks on BFS seed step
- BotAI wall path-clearing: `bomb_path` (when hunt BFS fails) and `bomb_roam` (while roaming) actively bomb destructible walls toward nearest enemy via `findWallTowardEnemy()` heuristic
- BotAI roaming: tracks ticksSinceEnemyContact; after idle threshold (normal=5s, hard=3s) bot moves toward nearest enemy via manhattan heuristic
- BotAI directional wall clearing: prefers breaking walls toward enemies rather than just the nearest wall
- BotAI danger timer threshold: normal/hard bots ignore bombs with many ticks remaining (>30/40) unless within 2 tiles, reducing unnecessary fleeing from fresh bombs
- BotAI KOTH hill-seeking: priority 4.5 in decision tree, bots navigate toward the 3x3 center zone using manhattan distance heuristic; once inside they stay put rather than wandering off
- BotAI anti-oscillation: `orderedDirs()` helper iterates `lastDirection` first in all BFS seed steps; `posHistory` (last 4 positions) with `wouldOscillate()` check filters directions that revisit recent tiles; wander has 85% continuation probability and prefers non-oscillating candidates. `seek_wall` skips entirely when already adjacent to a destructible wall (prevents seek_wall↔wander ping-pong). `findDestructibleWallDirection` skips dead-end destinations (walkableDirs < 2) so bots aren't sent to positions where bomb_wall's safety check blocks them.
- BotAI flee stuck-breaker: tracks `lastFleePos`/`fleeStuckTicks` — after 3 ticks stuck at same position while fleeing, tries alternative directions (logged as `flee_unstick`)
- BotAI trapped behavior: when completely stuck in danger with no movement options, bots accept their fate instead of placing bombs to blow open walls (removed `stuck_bomb` — unfair escape from player traps)
- BotAI normal difficulty: huntChance=0.7, bombCooldown=25-45 ticks (data-driven tuning from 5000+ simulation games)
- Self-kills subtract 1 from kill score (owner.kills decremented, owner.selfKills incremented)
- Game over placements sorted by kills descending, tiebreak by survival placement
- Grace period: 30 ticks (1.5s) after win condition before status='finished' to show final explosions; winner is invulnerable during grace period
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
- **Sudden Death**: 2-8 players, all start maxed (8 bombs, 8 range, max speed, kick), no power-ups, one hit kills, 2 min
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
- Logs every bot decision, kill, bomb placement/detonation, and tick snapshots (frequency depends on verbosity)
- Filename format: `{ISO-timestamp}_{roomCode}_{gameMode}_{playerCount}p.jsonl`
- `GameLogger` supports 3 verbosity levels: normal (tick every 5), detailed (tick every 2 + movements/pickups), full (every tick + explosion detail + bot pathfinding)
- Simulation logs written to `./data/simulations/{gameMode}/batch_*/` with separate directory per game mode

## Game Replay System
- Every completed game is recorded as a gzipped JSON replay file in `./data/replays/`
- `ReplayRecorder` (backend) captures full GameState every tick, with tile diffs (not full map per frame) for space efficiency
- `GameLogger` forwards log events (kills, bombs, bot decisions, movements, powerups) to ReplayRecorder with tick numbers for synchronized display
- Replay files: `{matchId}_{roomCode}_{gameMode}.replay.json.gz` (~400-700KB per game)
- Admin API: `GET /admin/replays` (list), `GET /admin/replays/:matchId` (fetch), `DELETE /admin/replays/:matchId` (delete)
- Match detail modal shows "Watch Replay" button when `hasReplay: true`
- `ReplayPlayer` (frontend) manages playback: play/pause, speed (0.5x/1x/2x/4x), seek to any frame. Uses Phaser-synced time accumulator (`tick(deltaMs)`) instead of `setInterval` to prevent drift/fast-forward; frame bounds-checked before access
- `ReplayControls` — video-player-like bottom bar with slider, time display, speed selector, keyboard shortcuts (Space=play/pause, arrows=skip)
- `ReplayLogPanel` — collapsible right-side panel showing game events synced to replay time, with filters by event type (kills, bombs, bot AI, powerups, movement), clickable timestamps for seeking
- GameScene detects `registry.get('replayMode')` and uses ReplayPlayer instead of socket events; clicking the game canvas toggles play/pause
- EffectSystem has `triggerExplosion()`/`triggerPlayerDied()` public methods for replay mode (bypasses socket listeners)
- `ReplayRecorder` deep-copies `initialState.map.tiles` in constructor (game engine mutates tiles in-place as walls are destroyed)
- Tile state reconstruction: initial tiles stored once, diffs applied forward; seeking backward rebuilds from initial
- Match detail modal shows all players (including bots) when replay exists via `allPlayers` field from `getReplayPlacements()`
- Docker volume: `./data/replays:/app/replays`

## Code Quality & Tooling
- ESLint v10 + `@typescript-eslint/recommended` via flat config (`eslint.config.mjs`); `no-explicit-any` as warning, `no-unused-vars` as error
- Prettier with single quotes, trailing commas, 100 char width
- Husky + lint-staged pre-commit hook runs ESLint `--fix` + Prettier on staged `.ts` files
- `prepare` script uses `husky || true` to avoid failures in Docker builds where husky isn't installed
- Socket rate limiting: `backend/src/utils/socketRateLimit.ts` — in-memory sliding window per socket ID (game:input 30/sec, room:create 2/sec, room:join 5/sec)
- All Socket.io server types fully parameterized: `RoomManager`, `registry.ts`, `GameRoom` use `Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>` — no `as any` casts on socket events
- DB row types in `backend/src/db/types.ts`: `UserRow`, `CountRow`, `IdRow`, `MatchRow`, `MatchPlayerRow`, `AdminActionRow`, etc. — all service queries use typed `query<T>()` calls
- `shared/src/utils/error.ts`: `getErrorMessage(err: unknown)` helper used in all `catch` blocks instead of `catch (err: any)`
- `backend/src/db/connection.ts`: `withTransaction<T>(fn)` helper for multi-statement DB operations
- `GameStateManager` constructor takes a `GameConfig` object instead of 13 positional parameters
- `frontend/src/utils/html.ts`: shared `escapeHtml()` and `escapeAttr()` utilities (extracted from 9+ files)
- LobbyUI modals extracted to `frontend/src/ui/modals/`: `CreateRoomModal.ts`, `AccountModal.ts`, `SettingsModal.ts`, `HelpModal.ts` — LobbyUI.ts is a thin orchestrator (~200 lines)
- `GameState.processTick()` optimizations: conditional tile snapshot (only when bombs detonate), `hasBombAt()`/`hasAlivePlayerAt()` helpers replace repeated `Array.from().some()`, `for...of` with early break on bomb slide collision

## Testing
```bash
npm test                    # Run all test suites
npx jest --config tests/backend/jest.config.ts  # Run from project root
```
- 92 tests across 6 suites (GameState integration, GameLoop, Bomb, Map, CollisionSystem, validation/grid)
- GameState tests cover: lifecycle, movement, bombs, explosions, death, self-kills, shield, chain reactions, win conditions, grace period, power-ups, remote bombs, bomb kick, teams, deathmatch, KOTH, line/pierce bombs, reinforced walls, battle royale zone

## Connection Resilience
- Socket.io reconnects indefinitely (1-5s backoff) with a "Reconnecting..." overlay when disconnected
- **Disconnect grace period**: when a player's socket disconnects during a game, they get 10 seconds (200 ticks) to reconnect before being killed. `GameRoom.disconnectedPlayers` tracks pending disconnects; `checkDisconnectGracePeriods()` runs each tick. On reconnect, `handlePlayerReconnect()` cancels the grace timer and the player resumes playing.
- During disconnect grace period, the player is NOT removed from the lobby room — only on grace expiry or game end
- On reconnect, server auto-detects if player was in an active game (`isPlayerDisconnected()`) and rejoins them to the socket room
- `GameState.killPlayer()` handles disconnect-timeout deaths with proper placement tracking, kill logging, and tickEvents emission
- On reconnect, client fetches `/api/health` and compares `buildId` (server start timestamp). If different, the page auto-refreshes to load new frontend.
- Nginx serves a custom 502 page (`docker/nginx/502.html`) during container rebuilds that auto-polls and refreshes when the app is back
- The 502 page detects the real app by checking for `game-container` in the response body

## Docker
- Production: `docker compose up --build -d`
- Only nginx exposes a port (APP_EXTERNAL_PORT, default 8080)
- Data persists in ./data/ (bind mounts)
- Nginx serves no-cache headers for index.html to prevent stale frontend after deploys
