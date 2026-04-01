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
- Movement cooldown system (MOVE_COOLDOWN_BASE ticks, reduced by speed power-ups). Enemy speed uses divisor formula: `Math.round(MOVE_COOLDOWN_BASE / speed)`
- JWT (access token in memory) + httpOnly cookie (refresh token) auth. Cookie `secure` flag derived from APP_URL (not NODE_ENV)
- ApiClient 401 interceptor auto-refreshes via `fetchWithAuth()`; auth endpoints use `skipAuthRetry`. Cached `refreshPromise` prevents concurrent refresh calls
- Zod for request validation; `ApiClient` appends field-level `details` from validation errors
- Redis room mutations use atomic Lua scripts (`JOIN_ROOM_LUA`, `LEAVE_ROOM_LUA`, `SET_READY_LUA`, `SET_TEAM_LUA`, `START_ROOM_LUA`). `ROOM_TTL_SECONDS = 3600`
- All game constants in shared/src/constants/
- Socket.io listeners use one-shot pattern for game:start to prevent leaks across scene transitions
- Bot players use negative IDs (-(i+1)) to avoid DB conflicts; skipped in DB writes
- Singleplayer: 1 human + 1+ bots is enough to start a game
- Friendly fire config: when OFF, same-team explosions don't damage teammates (self-damage still applies)
- Map dimensions should be odd numbers for proper indestructible wall grid pattern
- Branding: "BLAST" in white, "ARENA" in primary (`--primary`). In sidebar: `<span>BLAST</span>ARENA` where parent is primary and span is text color. In Phaser: two separate text objects via `themeManager.getCanvasColors()`
- Modal overlay uses `position: fixed` to prevent backdrop-filter repaint flashes from sibling DOM mutations. All modals use `trapFocus()` from `utils/html.ts` — returns a cleanup function called in `closeModal()`

## Frontend Architecture
- **Themes**: 11 palettes in `frontend/src/themes/definitions.ts`. `ThemeManager` reads localStorage → admin default → 'inferno'. `[data-theme]` on `<html>`. Inline `<script>` in `<head>` prevents flash. Phaser uses `themeManager.getCanvasColors()`
- **CSS**: All styles in `frontend/index.html` via CSS custom properties. Always use CSS variables (e.g. `var(--primary)` not hardcoded hex). Typography: Chakra Petch (headings) + DM Sans (body). Fonts self-hosted woff2 — no external CDN
- **Sidebar & Views**: `.app-layout` with collapsible sidebar + `.main-content`. `ILobbyView` with `render()`/`destroy()`. All lobby views render in `.main-body`. Views with own sub-header hide `.main-header`
- **UI conventions**: Unified CSS classes: `.panel-header`/`.panel-content`, `.tab-bar`/`.tab-item`, `.data-table`, `.form-grid`/`.form-group`/`.input`/`.select`, `.toggle-switch`, `.setting-row`, `.option-chip`, `.mini-stat`, `.modal-header`/`.modal-body`/`.modal-footer`, `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-sm`
- **Gamepad UI nav**: `UIGamepadNavigator` spatial navigation — new interactive elements need `.sidebar-nav-item` or `.room-card` classes
- **Rendering**: All sprites procedurally generated in `BootScene.generateTextures()` — no external image assets. `activeMoveAnim` Set on PlayerSprite prevents tween stacking. Conveyor belts use Phaser spritesheet animations (4 frames × 4 directions, 8fps); respects `settings.animations` flag. Power-up icons are procedural Canvas2D (`powerUpIcons.ts`) shared between BootScene and UI — no emoji `fillText`. Enemy addon fields on `EnemySpriteConfig` are optional with `?? false` / `?? 'none'` fallbacks
- **Audio**: Web Audio API procedural SFX via `AudioManager` singleton + `SoundGenerator`. No external audio files — all sounds synthesized from oscillators and noise buffers. Lazy `AudioContext` init on first user gesture (browser autoplay policy). Phaser runs with `noAudio: true`. Volume controls (master, SFX, mute) in Settings preferences tab, persisted to localStorage key `blast-arena-audio`
- **HUD**: DOM-based overlay in HUDScene.ts. Timer counts up for campaign levels with no time limit (`roundTime >= 99999`), counts down otherwise. In-game minimap (Canvas2D, 120×120px, bottom-right) shows tiles, players, bombs, explosions, zone/hill. Toggleable via settings, throttled to every 4 ticks. Kill feed shows cause icons (bomb, zone, hazard type, self, disconnect). Death banner for local player with killer info
- **Kill feed**: `KillCause` type (`bomb|zone|lava|quicksand|spikes|dark_rift|disconnect|self`) tracks death source through `tickEvents.playerDied`. Cause icons in kill feed, `.hud-death-banner` overlay for local player deaths
- **Countdown**: Synced server/client — 36 ticks (1.8s). Both block inputs during countdown
- **Gamepad**: `pendingGamepadAction` latching survives 50ms tick throttle. Keyboard takes priority
- **Input edge-detection**: Keyboard bomb/detonate/throw use `Phaser.Input.Keyboard.JustDown()` (fires once per press). Gamepad uses `bombDown && !prevBomb`. Local co-op uses same edge-detection pattern
- **Real-time lobby**: Room list auto-updates via `room:list` socket broadcast on every room mutation

## Campaign System
Campaign with hand-crafted levels, enemies, and bosses. Solo, online co-op (2 players via party), and local co-op. 9 world themes with per-theme color palettes and themed tile textures. Theme stored on `CampaignGameState.theme` and `CampaignReplayMeta.theme`.
- `CampaignGame` wraps `GameStateManager` with `customMap`. `checkWinCondition()`/time limit skip `campaign` mode
- 3-2-1-GO countdown (36 ticks) and 30-tick grace period after win. `startTick` set on first 'playing' tick. Hard 60-minute safety cap for levels with no time limit
- Pause: `campaign:pause`/`campaign:resume` events; input blocked while paused; pause blocked during countdown
- Spawn fallback: empty/null tiles → default map. Otherwise: level spawns → scan for 'spawn' → first empty tile → (1,1); co-op spiral search for P2
- Editor supports dual mode: `editorMode: 'campaign' | 'custom_map'`. Custom map mode hides campaign-only tools and uses `/maps` API
- **Tutorial worlds** (migration 028): 8 worlds, 21 levels — Power-Up Academy (12 levels covering all 9 power-ups + teleporters, conveyors, reinforced walls), 6 themed hazard worlds (forest/desert/ice/volcano/castle/void), Puzzle Chambers (3 levels: toggle switches, pressure switches, crumbling floors). All 11x11 handcrafted maps

### Co-Op
- **Online**: Party-based (exactly 2 members, leader starts). Both sockets join `campaign:{sessionId}` room
- **Local**: P2 can be guest (negative temp ID) or logged-in (isolated cookie auth via `/api/local-coop`). 3 camera modes: Shared, Split Horizontal, Split Vertical
- **Shared mechanics**: Shared life pool, auto-respawn with invulnerability. Team 0 + `friendlyFire: false`. Sequential lock-in (`player.frozen = true`). Partner quit: game continues solo

### Buddy Mode
Campaign modifier — P2 is a smaller, invulnerable support character for young/new players.
- Buddy is a `Player` instance with `isBuddy` flag. Invulnerable (die() guarded), passes through walls/bombs. Power-ups apply to P1 via `buddyOwnerId`
- Excluded from lock-in checks and alive player counts — only P1 needs to complete objectives
- `isCoopMode` is false for buddy mode. Campaign retry must preserve `buddyMode` flag — check buddy before localCoop in if/else chain
- Buddy ID: `-(2000 + (Date.now() % 10000))`. Sprite size enforced every frame to survive texture swaps/tweens

### Puzzle Tiles (Campaign Only)
18 tile types: switches (4 colors × 2 states), gates (4 colors × 2 states), crumbling floors.
- **Switches**: 3 variants in `puzzleConfig.switchVariants` — `toggle` (flips on step/blast, rising-edge), `pressure` (active while occupied), `oneshot` (permanent on first trigger). Rising-edge: reacts only on first tick of explosion via `prevSwitchBlasted`
- **Gates**: linked by color (OR logic: any active switch → gates open). Explosions pass through gates in both states; only movement blocked when closed
- **Crumbling floor**: `crumbling` → `pit` after entity steps off (10-tick delay). Enemies trigger crumbling (unless `canPassWalls`), buddy does NOT
- `GameStateManager.setTileTracked(x, y, type)` for puzzle state changes (records tileDiff + updates collision)
- `CampaignGame.processPuzzleTiles()` runs in campaignTick between hidden power-up reveals and boss phases
- Switches/gates can be covered tiles (hidden under destructible walls). Buddy blocked by closed gates and pits
- Editor: puzzle palette with color/variant selectors, link mode. `drawPuzzleLinks()` shows colored lines. Dirty state tracking with unsaved changes modal

### Export/Import
- Two-phase conflict resolution with `_format`/`_version` validation. See [docs/campaign.md](docs/campaign.md) for full details

## Custom Maps
User-created maps for multiplayer. `LevelEditorScene` with `editorMode: 'custom_map'` hides campaign-only tools.
- **DB**: `custom_maps` table (migration 026), `created_by` FK, `is_published` flag, `play_count`
- **API**: CRUD at `/maps/mine`, `/maps/published`, `/maps/:id`. Validation via `shared/src/utils/mapValidation.ts` (odd dims 9-51, border walls, 2-8 spawns, teleporter pairing)
- **Room integration**: `MatchConfig.customMapId` validated in `room:create`. `selectedHazardTiles`/`selectedMapEvents` specify active types (all enabled by default). Map loaded from DB on `room:start`, passed to `GameStateManager`
- **Frontend**: `MapsView` for listing. Room creation shows map dropdown, disables size/density when custom map selected

## Progression & Rewards
- **Elo**: K=32 for <30 games, K=16 otherwise. FFA: pairwise with placement-based scores. Teams: average Elo per team
- **Seasons**: Admin-defined start/end. `season_elo` per-user per-season. Hard/soft reset options
- **Achievements**: 4 condition types: `cumulative`, `per_game`, `mode_specific`, `campaign`. Each can reward a cosmetic
- **Cosmetics**: 4 types: `color`, `eyes`, `trail`, `bomb_skin`. In `PlayerState.toState()` (NOT `toTickState()` — static per game). Color priority: cosmetic → team → index-based. Settings cosmetics tab has live preview panel: `drawPlayerSprite()` + `drawBombSprite()` from `playerCanvas.ts` (Canvas2D), trail shown as colored dot + name
- **XP**: kills×50 + bombs×5 + powerups×10 + completion(25) + placement + win(100). Level N→N+1 costs N×100 XP
- **Rematch voting**: >50% threshold. `humanPlayerIds` filters `id > 0` (excludes bots); solo with bots shows "Play Again" instead
- **Account deletion**: `DELETE /user/account` with password confirmation. Hard delete with FK CASCADE. Admin accounts cannot self-delete

## Social Features
- **Friendships**: DB-backed, reciprocal rows on accept. `user_blocks` table for blocking
- **Presence**: Redis ephemeral keys (`presence:{userId}`) with 120s TTL, batch MGET pipeline
- **Parties**: Redis-only (1hr TTL). Atomic join via Lua script. Party follows leader into rooms
- **DMs**: Persistent (DB), between friends only. Unread counts per sender
- **Emotes**: Keys 1-6 during gameplay (only when `!localPlayerDead` — no conflict with spectator digit keys 1-9)
- **All social chat features** admin-configurable via `ChatMode` (`'everyone' | 'staff' | 'admin_only' | 'disabled'`)
- Each socket joins `user:{userId}` room on connect. Lobby chat toggle via `lobbychat-toggle` window event

## Admin Panel
Full-screen panel for admin/moderator roles. `staffMiddleware` (admin+moderator) and `adminOnlyMiddleware` for route protection. All actions audit-logged.
- `admin_actions.target_id` is `INT NOT NULL` — use `0` (not `null`) for bulk operations
- `registration_enabled` setting — when disabled, `/auth/register` returns 403 and AuthUI hides register link
- `/admin/settings/public` batched endpoint returns `registrationEnabled`, `imprint`, `imprintText`, `displayGithub` in one request
- **Session revocation**: Per-user (`POST /admin/users/:id/revoke-sessions`) and global nuke (`POST /admin/revoke-all-sessions`). Both revoke refresh tokens + force-disconnect sockets via `user:{userId}` rooms. Global nuke excludes the admin performing the action. Deactivation also disconnects sockets immediately
- See [docs/admin-and-systems.md](docs/admin-and-systems.md) for full details

## AI Systems
- **Bot AI**: Three-layer sandbox (source scan, esbuild bundle, `vm.runInContext()` with 5s timeout). Crash recovery falls back to built-in. See [docs/bot-ai-guide.md](docs/bot-ai-guide.md)
- **Enemy AI**: Same sandbox pipeline. `IEnemyAI.decide(context)` returns `{ direction, placeBomb }`. Crash recovery falls back to built-in `processEnemyAI()`. See [docs/enemy-ai-guide.md](docs/enemy-ai-guide.md)
- **Simulations**: Admin-only batch runner. See [docs/admin-and-systems.md](docs/admin-and-systems.md#bot-simulation-system)

## Game Architecture
- 20 tick/sec server game loop (GameLoop.ts → GameState.ts)
- GameState.processTick(): bot AI → inputs → movement → conveyors → bomb slide → bomb timers → explosions → collisions → power-ups → hazards → KOTH scoring → map events → zone → deathmatch respawns → time check → win check
- Bomb kick: player with hasKick walking into bomb sets bomb.sliding; advances 1 tile/tick until blocked
- Spawn position randomization: Fisher-Yates shuffle using seeded RNG, deterministic for replays
- Self-kills subtract 1 from kill score (owner.kills decremented, owner.selfKills incremented)
- Power-up drop on kill: dying players drop one random collected power-up. Weighted by stacked amounts
- Grace period: 30 ticks after win condition before status='finished'; winner invulnerable
- **Mid-game leave**: Escape opens overlay in multiplayer. `room:leave` kills player immediately (no grace). Disconnect uses 10s grace (`DISCONNECT_GRACE_TICKS = 200`). Bot-only speedup: `checkBotOnlySpeedup()` → 5x tick rate, `onBotsOnly` removes room from lobby
- Phaser scene lifecycle: `shutdown()` must be registered via `this.events.once('shutdown', this.shutdown, this)` — Phaser does NOT auto-call. Phaser reuses scene instances — constructor runs once, `create()` runs on every scene start. ALL session-specific properties MUST be reset at top of create()
- HUDScene listens for campaign state via Phaser event (`campaignStateUpdate`) — never register HUDScene on socket for `campaign:state` (GameScene's blanket `off()` cleanup would remove it)
- `SocketClient.off()` without a handler removes ALL listeners for that event. Always pass specific handler references
- Chain reaction tile snapshot: tiles snapshotted before processing detonations so chained bombs use original wall layout
- Explosion damage cells exclude wall tiles — blast destroys walls but fire doesn't linger (prevents walk-into-destroyed-wall kills). Pierce bombs still damage through/beyond
- Shield: no time limit, lasts until consumed. After break, 10 ticks invulnerability. Absorbs all damage sources
- Game start: `room:start` uses atomic `START_ROOM_LUA` to prevent TOCTOU race. Cosmetics awaited before `game:start` broadcast
- Play Again: `room:restart` resets to 'waiting'; other players auto-navigate via `room:state` listener

## Game Reference

### Teams
- Host assigns players/bots to Team Red (0) or Team Blue (1) via dropdowns; unassigned fall back to round-robin
- Bot teams stored in `MatchConfig.botTeams`; `room:setTeam` and `room:setBotTeam` socket events

### Game Modes
FFA (2-8, last standing), Teams (4-8, 2 teams, friendly fire toggle), Battle Royale (4-8, shrinking zone), Sudden Death (2-8, maxed stats, one hit), Deathmatch (2-8, respawn, first to 15 kills), King of the Hill (2-8, control zone, 2 pts/tick to 100; hill moves every 30s with 5s warning, `pendingHillZone` ghost outline)

### Power-Ups (9 types)
bomb_up, fire_up, speed_up, shield, kick, pierce_bomb (through destructibles), remote_bomb (E to detonate, FIFO/ALL toggle), line_bomb (line in facing direction), bomb_throw (Q to throw 3 tiles over obstacles, weight 4 rare)

### Map Features
- **Reinforced walls** (optional): 2 hits — first cracks (`destructible_cracked`), second destroys
- **Dynamic map events** (optional, individually selectable via `selectedMapEvents`): meteor, power_up_rain, wall_collapse, freeze_wave, bomb_surge, ufo_abduction. `ownerId: -999` for system explosions. `enabledMapEventTypes` Set on GameState. `MapEventRenderer` in frontend. Shared types: `MapEventType`, `MAP_EVENT_TYPES`, `MapEvent` (includes `targetPlayerId` for UFO)
- **Hazard tiles** (optional, individually selectable via `selectedHazardTiles`): teleporter pairs (A↔B), conveyors (push players/bombs/enemies; kicked bombs ignore conveyors; conveyors push before enemy AI), vine/mud (slow), quicksand (slow + kill), ice (sliding momentum), lava (instant kill, detonates adjacent bombs), spikes (cycling damage), dark_rift (random teleport). Slowing tiles use `movedThisTick` flag — applied once per move, not every tick. ~4% of empty tiles in multiplayer maps. Types/constants in `shared/src/utils/hazard.ts`
- **Covered tiles**: Special tiles hidden under destructible walls via `coveredTiles` array. `reservedPowerUpTiles` Set prevents drops at hidden power-up positions
- **Puzzle tiles** (campaign only): See Campaign System → Puzzle Tiles

## Replay System
Gzipped JSON replays with tile diffs. See [docs/replay-system.md](docs/replay-system.md). `GameLogger` and `ReplayRecorder` log leave/disconnect events. Campaign replays stored in `campaign_replays` table, recorded via `ReplayRecorder` in `CampaignGame` (controlled by `recordings_enabled`). `ReplayFrame.enemies` for enemy states during playback.

## SEO & Static Assets
- All resources self-hosted — no external CDN calls
- Meta tags: Open Graph, Twitter Card, `theme-color`, canonical link. JSON-LD `VideoGame` schema
- CSP: all sources `'self'` only. `style-src` includes `'unsafe-inline'`
- OG image (`og-image.png`) deferred — meta tags reference it but file not yet created

## Security, Connection Resilience & Docker
- HTTP security headers in `docker/nginx/security-headers.conf` (included per-location to avoid Nginx inheritance issues): CSP, HSTS, COOP, X-Frame-Options, X-Content-Type-Options
- **Email hashing**: Emails never stored in plaintext. HMAC-SHA256 with `EMAIL_PEPPER` (env var, min 32 chars). DB stores `email_hash` (for lookups) + `email_hint` (masked display like `j***@g***.com`). Same pattern for `pending_email_hash`/`pending_email_hint`. Password reset and email change flows receive plaintext from user request, hash for DB lookup, send to provided address, then discard. `backfill-emails.ts` runs on startup to migrate any legacy plaintext rows. Admin email search: exact match only (hashed) when query contains `@`
- **Email verification enforcement**: Users must verify email before accessing game features. Socket middleware queries DB for `email_verified` and rejects unverified users (`EMAIL_NOT_VERIFIED`). REST endpoints protected by `emailVerifiedMiddleware` (DB check, applied after `authMiddleware`). Exceptions: `GET /user/profile`, `PUT /user/language`, all auth routes. `PublicUser.emailVerified` field propagated through auth responses. `VerificationUI` shows pending screen with resend button (requires email input, validated against stored hash), auto-polls every 15s. `POST /auth/resend-verification` rate-limited endpoint. `GET /auth/verify-email/:token` redirects to `APP_URL?emailVerified=true`
- **Email enumeration prevention**: Registration with an existing email returns generic 400 (not 409) and sends a warning email to the existing account owner. Email change with a taken address silently succeeds (no DB update) and sends a warning. Username conflicts remain explicit (usernames are public). Warning emails: `sendEmailTakenRegistrationWarning`, `sendEmailTakenChangeWarning`
- **Nginx rate limiting**: `limit_req_zone` for API (30r/s), Socket.io (10r/s), auth (5r/s) — defense-in-depth alongside Express middleware
- **Refresh token rotation**: Atomic compare-and-swap (`UPDATE ... WHERE revoked = FALSE` + `affectedRows` check) prevents concurrent refresh race
- **Atomic password reset**: Single `UPDATE ... WHERE password_reset_token = ? AND password_reset_expires > NOW()` with `LAST_INSERT_ID(id)` trick to capture userId — prevents TOCTOU race on concurrent token use
- **Socket.io role from DB**: Socket middleware reads `role` from database (not JWT) on each connection, ensuring demoted admins lose privileges immediately. Sockets join `role:staff` room for scoped admin broadcasts
- **Local co-op P2 validation**: `campaign:start` requires a short-lived socket token (`local-coop-socket` purpose, 5min expiry) for positive P2 userIds. `GET /local-coop/socket-token` endpoint converts httpOnly cookie to JS-readable token. Invalid tokens fall back to guest (negative ID)
- **Admin announcement rate limiting**: Toast/banner endpoints rate-limited to 10 req/min
- **Markdown sanitization**: `DOMPurify.sanitize()` wraps all `marked.parse()` output in HelpUI
- `room:create` validates `MatchConfig` via Zod schema
- Health poll checks for `game-container` in body before triggering reload — prevents landing on 502.html during partial restarts
- Game loop circuit breaker: stops after 10 consecutive tick failures
- Frontend views use event delegation instead of per-render listener attachment
- See [docs/infrastructure.md](docs/infrastructure.md)

## Performance Optimizations
- `processPlayerInput()` receives shared position data pre-computed once per tick — never rebuild per player
- `Explosion.toState()` returns cells by reference — cells are immutable after construction
- `mapEvents` serialization cached with dirty flag — only rebuilt when events change
- Bomb slide position Sets only built when `hasSlidingBombs` is true (~5% of ticks)
- See [docs/performance-and-internals.md](docs/performance-and-internals.md)

## Internationalization (i18n)
Full-stack i18n via **i18next**. Frontend: `i18next-http-backend` + `i18next-browser-languagedetector`; backend: `i18next-fs-backend`.
- **Pattern**: `t('namespace:section.key')` with `{{variable}}` interpolation. Import `t` from `frontend/src/i18n/index.ts` or `backend/src/i18n/index.ts`
- **Namespaces**: shared (`common`, `game`), frontend-only (`ui`, `auth`, `hud`, `admin`, `campaign`, `help`, `editor`, `errors`), backend-only (`server`, `email`)
- **Locale files**: `{workspace}/src/i18n/locales/{lng}/*.json`. Build scripts merge shared + workspace-specific locales
- **Key conventions**: Dots are key separators — never use decimal numbers as JSON keys (use `"low30"` not `"0.3"`). View titles use getter: `get title() { return t('ui:...'); }` (not static)
- **Variable shadowing**: When importing `{ t }` from i18n, lambda parameters named `t` must be renamed (e.g., `(tab) =>`)
- **Lazy evaluation**: Module-level constants using `t()` must be functions/getters — `t()` returns key before i18n initializes
- **Adding a language**: Create `{lng}/` dirs in all 3 locale paths, translate all JSONs (1:1 key parity with `en/`), add to `supportedLngs` in both init files, add to `SUPPORTED_LANGUAGES` in `routes/user.ts`, add to `SettingsUI` + `AuthUI` selectors
- **Frontend init**: `await initI18n()` in `main.ts` before Phaser. Detection: localStorage → navigator → `en`
- **Email i18n**: All 6 email templates use `getFixedT(language)` for translated content. Language threaded from `req.locale` (new users) or `users.language` (existing users) through services to email functions. Warning emails to existing users query their stored language. All 12 languages preloaded at startup
- **DB**: `users.language` column (migration 027). Synced on login via `i18n.changeLanguage(user.language)`

## Code Quality & Tooling
- ESLint v10 + `@typescript-eslint/recommended` flat config; `no-explicit-any` warning, `no-unused-vars` error
- Prettier: single quotes, trailing commas, 100 char width
- Husky + lint-staged pre-commit runs ESLint `--fix` + Prettier on staged `.ts`. `prepare` uses `husky || true` for Docker
- All Socket.io types fully parameterized — no `as any` casts. `SocketClient` uses typed generics
- `shared/src/utils/error.ts`: `getErrorMessage(err: unknown)` in all catch blocks
- `GameStateManager` constructor takes a `GameConfig` object (not positional parameters)
- `frontend/src/utils/html.ts`: `escapeHtml()` and `escapeAttr()` utilities
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-label`, Escape closes, `for` on labels. Toggle switches: `role="switch"` + `aria-checked`

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
- 2379 tests: 2337 backend (Jest, 75 suites) + 42 frontend (Vitest, 3 suites)
- See [docs/testing.md](docs/testing.md) for full inventory, mocking patterns, and guide for writing new tests

## Documentation
- [Bot AI Developer Guide](docs/bot-ai-guide.md) — writing custom bot AIs
- [Bot AI Internals](docs/bot-ai-internals.md) — built-in BotAI decision engine details
- [Enemy AI Developer Guide](docs/enemy-ai-guide.md) — writing custom campaign enemy AIs
- [Campaign System](docs/campaign.md) — enemies, levels, editor, progress
- [Admin Panel & Systems](docs/admin-and-systems.md) — admin tabs, bot AI management, simulations, accounts
- [Replay System](docs/replay-system.md) — recording, playback, controls, API
- [Socket.io Events](docs/socket-events.md) — real-time event reference (86 events, rate limits, room patterns)
- [Performance & Internals](docs/performance-and-internals.md) — optimizations, game logging
- [Infrastructure & Security](docs/infrastructure.md) — security, resilience, Docker, migrations
- [Testing](docs/testing.md) — test inventory, mocking patterns, writing new tests
- [API Reference](docs/openapi.yaml) — OpenAPI 3.0.3 specification for all REST endpoints
