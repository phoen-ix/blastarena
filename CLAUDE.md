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
- Movement cooldown system (MOVE_COOLDOWN_BASE ticks, reduced by speed power-ups). Enemy speed uses divisor formula: `Math.round(MOVE_COOLDOWN_BASE / speed)` — speed 0.1 = 50 tick cooldown, speed 1 = 5 ticks, speed 5 = 1 tick
- JWT (access token in memory) + httpOnly cookie (refresh token) auth
- Cookie `secure` flag derived from APP_URL (not NODE_ENV) for HTTP/HTTPS compatibility
- ApiClient 401 interceptor: auto-refreshes token and retries via `fetchWithAuth()` (single source of truth for retry logic), but auth endpoints (login/register) use `skipAuthRetry` to pass 401 errors through directly. Cached `refreshPromise` prevents concurrent 401s from triggering multiple refresh calls
- Vite `allowedHosts` derived from `APP_URL` env var (hostname extracted at config load time), passed via docker-compose `environment`
- Zod for request validation; `ApiClient` appends field-level `details` from validation errors to the error message
- Redis room mutations use atomic Lua scripts to prevent race conditions: `JOIN_ROOM_LUA`, `LEAVE_ROOM_LUA`, `SET_READY_LUA`, `SET_TEAM_LUA`, `START_ROOM_LUA`. Named constant `ROOM_TTL_SECONDS = 3600`
- `listRooms()` uses `SCAN` + `MGET` pipeline instead of blocking `KEYS` + sequential `GET`
- All game constants in shared/src/constants/
- Socket.io listeners use one-shot pattern for game:start to prevent leaks across scene transitions
- Bot players use negative IDs (-(i+1)) to avoid DB conflicts; skipped in DB writes
- Bot count auto-capped to maxPlayers - humanPlayers (both frontend and backend); CreateRoomView auto-raises maxPlayers when bot count exceeds capacity
- Singleplayer: 1 human + 1+ bots is enough to start a game
- Friendly fire config: when OFF, same-team explosions don't damage teammates (self-damage still applies)
- Map dimensions should be odd numbers for proper indestructible wall grid pattern
- Branding: "BLAST" in white, "ARENA" in primary (`--primary`). In sidebar brand use `<span>BLAST</span>ARENA` where parent is `color: var(--primary)` and `span` is `color: var(--text)`. In Phaser canvas use two separate text objects via `themeManager.getCanvasColors()`
- Game canvas uses `Phaser.Scale.RESIZE` mode to fill the full browser viewport. Camera bounds auto-adjust: small maps are centered, large maps scroll with the player via smooth lerp
- Player sprite interpolation factor is 0.45 (snappy grid movement, not floaty)
- Modal overlay uses `position: fixed` to prevent backdrop-filter repaint flashes from sibling DOM mutations

## Frontend Architecture
- **Themes**: 11 palettes defined in `frontend/src/themes/definitions.ts`. `ThemeManager` singleton reads localStorage → admin default → 'inferno'. Applies via `[data-theme]` attribute on `<html>`. Flash prevention: inline `<script>` in `<head>` sets attribute before CSS loads. Phaser scenes use `themeManager.getCanvasColors()`
- **CSS**: All styles in `frontend/index.html` using CSS custom properties. Always use CSS variables (e.g. `var(--primary)` not hardcoded hex) for theme compatibility. Typography: Chakra Petch (display/headings) + DM Sans (body). Fonts self-hosted as woff2 in `frontend/public/fonts/` with `@font-face` declarations — no external CDN dependencies. Critical fonts (DM Sans, Chakra Petch 700) preloaded via `<link rel="preload">` to avoid CSS-parse discovery delay
- **Sidebar & Views**: `.app-layout` with collapsible left sidebar + `.main-content`. `ILobbyView` interface with `render()`/`destroy()`. `LobbyUI.createView()` factory with dynamic imports. Wrapper views delegate via `renderEmbedded()`. All lobby views render inline in `.main-body` — sidebar stays persistent. Views with own sub-header hide `.main-header`
- **UI conventions**: Full-screen tabbed panels (Admin, Settings, Help) reuse `admin-container` CSS class. Unified CSS classes: `.panel-header`/`.panel-content`, `.tab-bar`/`.tab-item`, `.data-table`, `.form-grid`/`.form-group`/`.input`/`.select`, `.toggle-switch`, `.setting-row`, `.option-chip`, `.mini-stat`, `.modal-header`/`.modal-body`/`.modal-footer`, `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-sm`
- **Gamepad UI nav**: `UIGamepadNavigator` uses spatial navigation — new interactive elements need `.sidebar-nav-item` or `.room-card` classes or gamepad navigation will skip them
- **Rendering**: GameScene delegates to renderer classes in `frontend/src/game/`. `activeMoveAnim` Set on PlayerSprite prevents tween stacking. All sprites procedurally generated in `BootScene.generateTextures()` — no external image assets. Conveyor belts use Phaser spritesheet animations (4 frames × 4 directions, `conveyor_{dir}_anim` keys, 8fps looping) — the only tile type using `sprite.play()`; respects `settings.animations` flag in gameplay, always-on in editor. Power-up icons are procedural Canvas2D drawings (`powerUpIcons.ts`) shared between BootScene (in-game textures) and `powerUpCanvas.ts` (UI previews) — no emoji `fillText`, guaranteed cross-platform. `MapEventRenderer` handles meteor warnings (pulsing crosshair + exclamation + growing shadow) and impact animations (falling meteor sprite + flash + particles + screen shake). Enemy textures on-demand via `EnemyTextureGenerator`. Enemy sprite addons: 6 body shapes × 4 eye styles × 8 visual addons (teeth, horns, tail, aura, crown, scar, wings) + accessory dropdown (none/bow_tie/monocle/bandana). Crown and horns are mutually exclusive. All addons rendered in both Phaser Graphics (directional, 48x48) and Canvas2D (preview). New fields on `EnemySpriteConfig` are optional with `?? false` / `?? 'none'` fallbacks for backward compatibility
- **HUD**: DOM-based overlay in HUDScene.ts. Settings and Help are in sidebar navigation, not in-game HUD. Timer counts up (elapsed) for campaign levels with no time limit (`roundTime >= 99999`), counts down otherwise
- **Countdown**: Synced between server and client — GameLoop holds `status: 'countdown'` for 36 ticks (1.8s). Both client and server block inputs during countdown
- **Gamepad**: `pendingGamepadAction` latching survives 50ms tick throttle. Keyboard takes priority
- **Real-time lobby**: Room list auto-updates via `room:list` socket broadcast on every room mutation

## Campaign System
Campaign with hand-crafted levels, enemies, and bosses. Supports solo, online co-op (2 players via party), and local co-op (same keyboard/gamepads). 9 world themes (classic, forest, desert, ice, volcano, void, castle, swamp, sky) with per-theme color palettes and themed tile textures generated in `frontend/src/utils/campaignThemes.ts`. Themed textures cover all tile types: walls, destructibles, floors, teleporters, conveyors (with themed animations), switches, gates, crumbling, exit, and goal tiles. Theme stored on `CampaignGameState.theme` and `CampaignReplayMeta.theme`.
- `CampaignGame` wraps `GameStateManager` with `customMap`. `checkWinCondition()`/time limit skip `campaign` mode. Frontend uses `campaignMode` registry flag for `campaign:state`/`campaign:input` events
- Has 3-2-1-GO countdown (36 ticks) and 30-tick grace period after win condition. `startTick` set on first 'playing' tick so countdown doesn't count toward level time. Hard 60-minute safety cap (`3600s` from `startTick`) terminates via `gameOverInternal()` for levels with no time limit
- Pause: `campaign:pause`/`campaign:resume` events; input blocked while paused; pause blocked during countdown. Pause menu: Continue, Restart Level (quits + re-launches same level via `restartCampaignLevel()`), Exit Level
- Spawn fallback: empty/null tiles array triggers default map generation. Otherwise: level spawns → scan tiles for 'spawn' → first empty tile → (1,1); co-op adds P2 spawn via spiral search if only 1 exists
- Editor back button: `returnToAdmin: 'campaign'` registry flag. `AdminUI` accepts optional `initialTab`

### Co-Op
- **Online**: Party-based (exactly 2 members, leader starts). Both sockets join `campaign:{sessionId}` room
- **Local**: P2 can be guest (negative temp ID, no DB writes) or logged-in (isolated cookie auth via `/api/local-coop` path). 3 camera modes: Shared, Split Horizontal, Split Vertical
- **Shared mechanics**: Shared life pool, auto-respawn with invulnerability at own spawn point. Team 0 + `friendlyFire: false`
- **Sequential lock-in**: `player.frozen = true`, excluded from collision in `processTick()`. Level completes when all alive players locked in. `lockedInPlayers: Set<number>` on CampaignGame
- **Partner quit**: `CampaignGameManager.removePlayer()` kills leaving player, game continues solo

### Buddy Mode
Campaign modifier — P2 is a smaller, invulnerable support character for young/new players.
- Buddy is a `Player` instance with `isBuddy` flag (not a separate class). All existing infrastructure with guard conditions
- Invulnerable (die() guarded), passes through walls/bombs via `CollisionSystem.canBuddyMoveTo()`. Buddy and owner don't block each other
- Power-ups collected by buddy apply to P1's stats via `buddyOwnerId`. Buddy has fixed 1 bomb, 1 fire range
- Excluded from lock-in checks and alive player counts — only P1 needs to complete objectives
- `isCoopMode` is false for buddy mode (no shared lives, no partner quit handling)
- Campaign retry (GameOverScene) must preserve and re-send `buddyMode` flag — check buddy before localCoop in the if/else chain since buddy mode is exclusive with co-op
- Buddy ID: `-(2000 + (Date.now() % 10000))`. Sprite size enforced every frame to survive texture swaps and tweens

### Puzzle Tiles (Campaign Only)
Environmental puzzle system with switches, gates, and crumbling floors. 18 new tile types, campaign-only.
- **Switches** (4 colors × 2 states): `switch_red` / `switch_red_active` etc. Three variants stored in `puzzleConfig.switchVariants` (key="x,y"):
  - `toggle`: flips on step-on or blast (rising-edge detection — reacts only on first tick of explosion via `prevSwitchBlasted` set)
  - `pressure`: active while occupied by player/bomb; blast activates on first tick only
  - `oneshot`: activates permanently on first step-on or blast (rising-edge)
- **Gates** (4 colors × 2 states): `gate_red` (closed, impassable like wall) / `gate_red_open` (walkable). Linked to switches by color (OR logic: any active switch of color → gates open). Explosions pass through gates in both states (only movement is blocked when closed)
- **Crumbling floor**: `crumbling` → `pit` after entity steps off (10-tick delay). Enemies trigger crumbling (unless `canPassWalls`), buddy does NOT trigger
- `GameStateManager.setTileTracked(x, y, type)` for puzzle tile state changes (records tileDiff + updates collision)
- `CampaignGame.processPuzzleTiles()` runs in campaignTick between hidden power-up reveals and boss phases
- Editor: Puzzle palette section with color selector, variant selector (toggle/pressure/oneshot), link mode (switch → gate). `drawPuzzleLinks()` shows colored lines between linked switches/gates. Color/variant buttons use `.puzzle-color-btn`/`.puzzle-variant-btn` classes to survive `highlightActiveTool()` resets
- Editor map resize: `resizeMap()` clears old perimeter `wall` tiles that become interior when growing, then enforces new perimeter walls
- Editor save uses non-blocking `showToast()` (fade-in/out, 2s) instead of `alert()` — green for success, red for errors
- Editor tracks dirty state (`isDirty` flag) — unsaved changes prompt a modal (Save & Exit / Discard / Cancel) on back navigation; `beforeunload` handler warns on browser close/refresh
- `PuzzleConfig` stored in `campaign_levels.puzzle_config` JSON column (migration 024). `shared/src/utils/puzzle.ts` exports helpers: `isSwitchTile`, `isGateTile`, `isGateClosed`, `getSwitchColor`, `getGateColor`, `getSwitchTile`, `getGateTile`, `PUZZLE_COLORS`, `PUZZLE_COLOR_VALUES`, `CRUMBLE_DELAY_TICKS`
- Switches/gates can be covered tiles (hidden under destructible walls). Buddy blocked by closed gates and pits

### Export/Import
- Two-phase conflict resolution: first call returns `conflicts` array, second call with ID map resolves via create/use-existing/skip. `_format`/`_version` fields for validation. Download via `Blob` + `createObjectURL` + click anchor. Same pattern used for achievements/cosmetics export/import
- See [docs/campaign.md](docs/campaign.md) for full details

## Progression & Rewards
- **Elo**: Standard formula, K=32 for <30 games, K=16 otherwise. FFA: pairwise comparison with placement-based scores. Teams: average Elo per team, equal delta. Display-only ranks, no matchmaking enforcement
- **Seasons**: Admin-defined start/end dates. `season_elo` tracks per-user per-season Elo + peak. Hard reset (to 1000) or soft reset (compress toward 1000 with 0.5 factor)
- **Rank Tiers**: Admin-configurable via `rank_tiers` JSON in `server_settings`. `getRankForElo()` pure function. Sub-tiers (I/II/III) split each tier into thirds
- **Achievements**: 4 condition types: `cumulative` (user_stats), `per_game` (match data with operators), `mode_specific` (match_players JOIN), `campaign` (stars/levels/world). Each can reward a cosmetic. Evaluated via `evaluateAfterGame` and `evaluateAfterCampaign`
- **Cosmetics**: 4 types: `color`, `eyes`, `trail`, `bomb_skin`. Included in `PlayerState.toState()` (NOT `toTickState()` — static per game). `getPlayerCosmeticsForGame(userIds[])` single JOIN query at game start. Rendering: `BootScene.generateCustomPlayerTextures(scene, hex, eyeStyle?)` and `generateCustomBombTexture(scene, config)` for on-demand textures. PlayerSprite color priority: 1) cosmetic → custom texture, 2) team color, 3) index-based. `BombSpriteRenderer.setPlayerCosmetics(map)` for bomb skins
- **XP**: kills×50 + bombs×5 + powerups×10 + completion(25) + placement bonus + win bonus(100). Level N→N+1 costs N×100 XP. Admin `xp_multiplier` setting
- **Rematch voting**: >50% threshold triggers auto-restart. `humanPlayerIds` filters to `id > 0` (excludes bots); solo with bots shows direct "Play Again" instead of vote UI
- **Profiles**: Click usernames for public profile. `is_profile_public` toggle hides from leaderboard. `accept_friend_requests` toggle checked in `sendFriendRequest`

## Social Features
- **Friendships**: DB-backed (`friendships` table), reciprocal rows on accept. `user_blocks` table for blocking
- **Presence**: Redis ephemeral keys (`presence:{userId}`) with 120s TTL. Batch lookup via MGET pipeline
- **Parties**: Redis-only (ephemeral, 1hr TTL). Atomic join via Lua script. Party follows leader into rooms (`party:joinRoom`)
- **Invites**: Redis with 60s TTL. Action toasts with Accept/Decline, 30s auto-dismiss
- **DMs**: Persistent (DB), between friends only. Unread counts tracked per sender
- **Lobby Chat**: Ephemeral socket broadcast. 100-message buffer, role-colored names
- **Emotes**: Keys 1-6 during gameplay (only when `!localPlayerDead` — no conflict with spectator digit keys 1-9). 3s server-side cooldown
- **All social chat features** admin-configurable via `ChatMode` (`'everyone' | 'staff' | 'admin_only' | 'disabled'`)
- Each socket joins `user:{userId}` room on connect for targeted notifications. On disconnect: presence removed, friends notified, party leave/disband handled
- Lobby chat toggle: dispatches `lobbychat-toggle` window event from Settings; LobbyUI listens to refresh panel visibility

## Admin Panel
Full-screen panel for admin/moderator roles. 11 tabs: Dashboard, Users, Matches, Rooms, Logs, Simulations, AI, Campaign, Announcements, Seasons, Achievements. `staffMiddleware` (admin+moderator) and `adminOnlyMiddleware` for route protection. All actions audit-logged.
- `admin_actions.target_id` is `INT NOT NULL` — use `0` (not `null`) for bulk operations without a specific target
- Email/SMTP settings stored in DB (`email_settings` key), `.env` values as fallback. `invalidateTransporter()` resets cached nodemailer on save. Password masked in API responses
- `registration_enabled` setting — when disabled, `/auth/register` returns 403 and AuthUI hides register link
- `/admin/settings/public` batched endpoint returns `registrationEnabled`, `imprint`, `imprintText`, `displayGithub` in one request (used by AuthUI + HelpUI to reduce critical request chain)
- See [docs/admin-and-systems.md](docs/admin-and-systems.md) for full details

## AI Systems
- **Bot AI**: Admin-only custom AI upload. Three-layer sandbox: (1) source scan blocks dangerous imports/globals, (2) esbuild bundles with `blockImportsPlugin`, (3) `vm.runInContext()` with `codeGeneration: { strings: false }` and 5s timeout. `loadBotAIInSandbox()` in `botai-compiler.ts` used by both compiler and registry. Runtime crash recovery falls back to built-in. See [docs/bot-ai-guide.md](docs/bot-ai-guide.md)
- **Enemy AI**: Custom AI for campaign enemies, same sandbox pipeline. `IEnemyAI.decide(context)` returns `{ direction, placeBomb }`. Registry `loadAI()` handles both `module.exports = Class` and `exports.default = Class` patterns. CampaignGame `enemyAIs` Map with try/catch crash recovery (on error: delete from map, fall back to built-in `processEnemyAI()`). Custom AI assigned to enemy type disables movement pattern dropdown. Spawned minions also get AI instances. 6 default AIs auto-seeded on startup. See [docs/enemy-ai-guide.md](docs/enemy-ai-guide.md)
- **Simulations**: Admin-only batch runner for bot-only games. See [docs/admin-and-systems.md](docs/admin-and-systems.md#bot-simulation-system)

## Game Architecture
- 20 tick/sec server game loop (GameLoop.ts → GameState.ts)
- GameState.processTick(): bot AI → inputs → movement → conveyors → bomb slide → bomb timers → explosions → collisions → power-ups → KOTH scoring → map events → zone → deathmatch respawns → time check → win check
- Bomb kick: player with hasKick walking into a bomb sets bomb.sliding direction; sliding bombs advance 1 tile/tick until blocked; kicking applies movement cooldown
- Spawn position randomization: Fisher-Yates shuffle using seeded RNG (`shuffledSpawnIndices`), deterministic for replays
- Self-kills subtract 1 from kill score (owner.kills decremented, owner.selfKills incremented)
- Game over placements sorted by kills descending, tiebreak by survival placement
- Grace period: 30 ticks (1.5s) after win condition before status='finished'; winner invulnerable during grace period
- Dead players enter spectator mode: free camera pan, click-to-follow, number keys 1-9, LB/RB bumpers
- Mouse drag panning: pointerdown records start, pointermove after 4px threshold pans freeCam; pointerup without drag triggers replay play/pause
- Spectate-follow breaks only on new keydown or mouse drag (not stale keysDown state); blur handler clears keysDown
- HUD spectate click uses mousedown event delegation on stable container (not click — unreliable with innerHTML rebuilds)
- HUDScene forces `localPlayerDead = true` when `simulationSpectate` or `replayMode` registry flags are set
- Phaser scene lifecycle: shutdown() must be registered via `this.events.once('shutdown', this.shutdown, this)` — Phaser does NOT auto-call shutdown(). Phaser reuses scene instances — constructor runs once, `create()` runs on every scene start. ALL session-specific instance properties (caches, dirty-check values, DOM refs) MUST be reset at top of create() or they carry stale values from the previous game
- HUDScene listens for campaign state via Phaser event (`campaignStateUpdate`) emitted by GameScene — never register HUDScene directly on the socket for `campaign:state`, because GameScene's blanket `off('campaign:state')` cleanup would remove HUDScene's listener too
- SocketClient.off() without a handler removes all listeners for that event (Socket.io component-emitter `arguments.length === 1` check). Always store and pass specific handler references for targeted removal
- `tickEvents` buffer on GameStateManager accumulates per-tick events for fine-grained socket emission in GameRoom
- Chain reaction tile snapshot: tiles snapshotted before processing detonations so chained bombs use original wall layout
- Explosion damage cells exclude wall tiles — blast destroys walls but fire doesn't linger on those tiles (prevents walk-into-destroyed-wall kills). Pierce bombs still damage through/beyond walls
- Shield has no time limit — lasts until consumed. After break, 10 ticks invulnerability. Extra pickups consumed but don't stack
- Game start transitions instantly; `room:start` uses atomic `START_ROOM_LUA` script to prevent TOCTOU race (concurrent starts). Cosmetics are awaited before `game:start` broadcast to prevent visual flicker
- "Back to Lobby" from game over clears currentRoom registry to prevent stale room UI
- Play Again: room:restart resets to 'waiting'; other players auto-navigate via room:state listener
- Campaign game over button: "Play Again" on success, "Retry" on failure. When next level exists, 3-button layout (Play Again | Next Level | Campaign) with wider spacing; otherwise 2-button layout

## Game Reference

### Teams
- Host assigns players/bots to Team Red (0) or Team Blue (1) via dropdowns; unassigned fall back to round-robin
- Bot teams stored in `MatchConfig.botTeams`; `room:setTeam` and `room:setBotTeam` socket events

### Game Modes
- **Free for All (FFA)**: 2-8 players, last standing, 3 min
- **Teams**: 4-8 players, 2 teams, last team standing, friendly fire toggle, 4 min
- **Battle Royale**: 4-8 players, shrinking circular zone, 5 min
- **Sudden Death**: 2-8 players, all maxed stats, no power-ups, one hit kills, 2 min
- **Deathmatch**: 2-8 players, respawn after 3s, first to 10 kills or most at time, 5 min
- **King of the Hill**: 2-8 players, control 3x3 center zone, first to 100, 4 min

### Power-Ups (8 types)
- bomb_up, fire_up, speed_up, shield, kick (original 5)
- **pierce_bomb**: Explosions pass through destructible walls (still destroys them)
- **remote_bomb**: Bombs don't auto-detonate; press E to detonate all at once (10s safety max)
- **line_bomb**: Places line of bombs in facing direction (up to remaining bomb capacity)

### Map Features
- **Reinforced walls** (optional): 2 hits — first cracks (`destructible_cracked`), second destroys
- **Dynamic map events** (optional): Meteor strikes every 30-45s (40-tick/2s warning with crosshair reticle, exclamation mark, growing shadow; impact triggers falling meteor animation, flash, debris/fire/spark particles, screen shake). `ownerId: -999` for system-owned meteor explosions (2-tile blast radius). Power-up rain every 60s. `MapEventRenderer` in `frontend/src/game/MapEventRenderer.ts`
- **Hazard tiles** (optional): Teleporter pairs (A↔B, seeded-RNG destination selection, works for players and campaign enemies), conveyor belts (auto-push players, bombs, and campaign enemies in direction when movement cooldown ready, chain into teleporters, animated moving stripes via 4-frame Phaser spritesheet animation at 8fps). Bombs on conveyors use `MOVE_COOLDOWN_BASE` tick cooldown between pushes; kicked bombs (already sliding) ignore conveyors. Conveyor belts also push campaign enemies (except `canPassWalls` enemies) — processed before AI so conveyor consumes the move cooldown and AI skips that tick. Campaign-only hazard tiles: vine (slows movement), quicksand (slows + kills after `QUICKSAND_KILL_TICKS`), ice (sliding momentum), lava (instant kill), mud (slows movement), spikes/spikes_active (cycling damage via `SPIKE_SAFE_TICKS`/`SPIKE_CYCLE_TICKS`), dark_rift (teleports to random empty tile). Hazard tile types, constants, and theme mappings in `shared/src/utils/hazard.ts` and `shared/src/constants/campaignThemes.ts`
- **Covered tiles**: Special tiles (exit, goal, teleporters, conveyors, switches, gates) hidden under destructible walls via `coveredTiles` array. Editor shows overlay at 0.7 alpha; gameplay reveals tile type when wall destroyed. `reservedPowerUpTiles` Set prevents random power-up drops at positions with hidden power-ups
- **Puzzle tiles** (campaign only): Switches (4 colors × 3 variants), gates (4 colors), crumbling floors. See Campaign System → Puzzle Tiles section

## Replay System
Gzipped JSON replays with tile diffs. See [docs/replay-system.md](docs/replay-system.md).
- **Campaign replays**: Recorded via `ReplayRecorder` in `CampaignGame`, controlled by `recordings_enabled` setting. Stores enemy states per frame in optional `ReplayFrame.enemies` field. `CampaignReplayMeta` on `ReplayData.campaign` carries level info + `EnemyTypeEntry[]` for texture generation during playback. Files named `campaign_{sessionId}.replay.json.gz`. DB table `campaign_replays` (migration 025) tracks metadata. Admin API: `GET/DELETE /admin/campaign-replays`. Frontend: Campaign tab "Replays" sub-view with watch/delete; `ReplayPlayer.onCampaignFrame` callback feeds `EnemySpriteRenderer` during playback

## SEO & Static Assets
- All resources self-hosted — no external CDN calls (fonts, images, scripts all served locally)
- Meta tags in `index.html`: description, keywords, Open Graph (`og:title/description/image`), Twitter Card (`summary_large_image`), `theme-color`, `color-scheme`, canonical link
- `frontend/public/` contains static assets copied to dist root by Vite: `favicon.svg` (bomb icon), `robots.txt`, `sitemap.xml`, `manifest.json`, `fonts/` directory
- JSON-LD structured data (`VideoGame` schema) in `index.html` head
- Noscript fallback with branded content for JS-disabled crawlers
- Nginx serves SEO files (`robots.txt`, `sitemap.xml`, `manifest.json`) with 24h cache; fonts with 1-year immutable cache
- CSP header: all sources `'self'` only (no external domains). `style-src` includes `'unsafe-inline'` for inline styles
- OG image (`og-image.png`) deferred — meta tags reference it but file not yet created

## Security, Connection Resilience & Docker
- HTTP security headers (in `docker/nginx/security-headers.conf`, included per-location to avoid Nginx `add_header` inheritance issues): CSP (with script hash for inline theme loader, `frame-ancestors 'self'`), HSTS (1yr + includeSubDomains), COOP (`same-origin`), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (restrictive)
- Email addresses normalized to lowercase on register and email change
- Campaign JSON fields (`enemy_placements`, `powerup_placements`, `starting_powerups`) parsed via `safeJsonParse()` with fallback to empty arrays
- `room:create` socket event validates `MatchConfig` via Zod schema (game mode, map dimensions, player count, power-ups, etc.)
- Nginx proxy timeouts set to 300s for `/api/` to tolerate slow backend starts during rebuilds
- Health poll verifies full page loads (checks for `game-container` in body) before triggering reload — prevents landing on 502.html during partial restarts
- Backend healthcheck `start_period: 300s` accommodates long Docker rebuilds
- Game loop circuit breaker: stops after 10 consecutive tick failures to prevent infinite error spam
- `admin:closeRoom` clears rematch vote timeouts to prevent orphaned timer leaks
- `room:leave` handler wrapped in try-catch to prevent unhandled promise rejections
- Stale room cleanup extracted to `cleanupStaleRoom()` helper — shared by room:create and room:join
- Frontend views (RoomUI, RoomsView, FriendsView, MessagesView) use event delegation instead of per-render listener attachment
- See [docs/infrastructure.md](docs/infrastructure.md)

## Performance Optimizations
- `processPlayerInput()` receives shared position data (bomb positions, player positions, Sets) pre-computed once per tick — never rebuild per player
- `Explosion.toState()` returns cells by reference (no deep copy) — cells are immutable after construction
- Bomb slide position Sets only built when `hasSlidingBombs` is true (~5% of ticks)
- `mapEvents` serialization cached with dirty flag — only rebuilt when events change (~1-2 times/min)
- Frontend renderers (BombSprite, PowerUpSprite, emote positions) reuse class-level Sets/Maps instead of allocating per frame
- `listReplays()` uses async `fs.promises` API — never blocks event loop
- Presence updates use `setPresenceBatch()` for batched Redis pipeline (1 round-trip instead of N)
- Socket room handlers use `socket.data.activeRoomCode` instead of `getPlayerRoom()` Redis lookup
- Connection pool `queueLimit: 50` prevents unbounded queue under sustained DB pressure
- `friendships(user_id, status)` composite index for friend queries
- See [docs/performance-and-internals.md](docs/performance-and-internals.md)

## Code Quality & Tooling
- ESLint v10 + `@typescript-eslint/recommended` via flat config (`eslint.config.mjs`); `no-explicit-any` as warning, `no-unused-vars` as error
- Prettier with single quotes, trailing commas, 100 char width
- Husky + lint-staged pre-commit hook runs ESLint `--fix` + Prettier on staged `.ts` files. `prepare` script uses `husky || true` to avoid failures in Docker builds
- Socket rate limiting: `backend/src/utils/socketRateLimit.ts` — in-memory sliding window per socket ID + parallel per-IP rate limiters
- All Socket.io types fully parameterized on both server and client — no `as any` casts on socket events. `SocketClient` uses typed generics for `emit<E>`, `on<E>`, `off<E>`
- DB row types in `backend/src/db/types.ts`; all service queries use typed `query<T>()` calls
- `shared/src/utils/error.ts`: `getErrorMessage(err: unknown)` in all catch blocks
- `backend/src/db/connection.ts`: `withTransaction<T>(fn)` helper
- `GameStateManager` constructor takes a `GameConfig` object (not positional parameters)
- `frontend/src/utils/html.ts`: shared `escapeHtml()` and `escapeAttr()` utilities
- LobbyUI modals in `frontend/src/ui/modals/`, views in `frontend/src/ui/views/` — LobbyUI.ts is thin orchestrator
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-label`, Escape key closes, `for` attributes on `<label>` elements. Toggle switches use `role="switch"` + `aria-checked`
- Graceful shutdown: room cleanup `setInterval` handle stored and cleared on SIGTERM/SIGINT
- Presence update failures logged via `logger.warn` (not silently swallowed)

## Database Migrations
- Forward migrations in `backend/src/db/migrations/*.sql`, numbered `NNN_description.sql`
- Rollback (DOWN) migrations in `backend/src/db/migrations/down/*.down.sql`
- Runner: `runMigrations()` (auto-runs on startup), `rollbackMigration(steps)`, `getAppliedMigrations()`
- Tracking table: `_migrations` (name + executed_at)

## Testing
```bash
npm test                    # Run all workspace tests (backend + frontend)
npx jest --config tests/backend/jest.config.ts  # Backend only (from project root)
cd frontend && npx vitest run                   # Frontend only
```
- 1851 tests: 1809 backend (Jest, 55 suites) + 42 frontend (Vitest, 3 suites)
- See [docs/testing.md](docs/testing.md) for full inventory, mocking patterns, and guide for writing new tests

## Documentation
- [Bot AI Developer Guide](docs/bot-ai-guide.md) — writing custom bot AIs
- [Bot AI Internals](docs/bot-ai-internals.md) — built-in BotAI decision engine details
- [Enemy AI Developer Guide](docs/enemy-ai-guide.md) — writing custom campaign enemy AIs
- [Campaign System](docs/campaign.md) — enemies, levels, editor, progress
- [Admin Panel & Systems](docs/admin-and-systems.md) — admin tabs, bot AI management, simulations, accounts
- [Replay System](docs/replay-system.md) — recording, playback, controls, API
- [Performance & Internals](docs/performance-and-internals.md) — optimizations, game logging
- [Infrastructure & Security](docs/infrastructure.md) — security, resilience, Docker, migrations
- [Testing](docs/testing.md) — test inventory, mocking patterns, writing new tests
- [API Reference](docs/openapi.yaml) — OpenAPI 3.0.3 specification for all REST endpoints
