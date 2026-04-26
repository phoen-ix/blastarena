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
- Zod for request validation; `ApiClient` appends field-level `details` from validation errors
- Redis room mutations use atomic Lua scripts. All game constants in `shared/src/constants/`
- Bot players use negative IDs (-(i+1)) to avoid DB conflicts; skipped in DB writes
- Singleplayer: 1 human + 1+ bots is enough to start a game
- Friendly fire config: when OFF, same-team explosions don't damage teammates (self-damage still applies)
- Map dimensions should be odd numbers for proper indestructible wall grid pattern
- Branding: "BLAST" in white, "ARENA" in primary (`--primary`). In sidebar: `<span>BLAST</span>ARENA` where parent is primary and span is text color. In Phaser: two separate text objects via `themeManager.getCanvasColors()`
- All modals use `trapFocus()` from `utils/html.ts`. Game overlays (pause/leave) disable Phaser keyboard captures while open so keys reach DOM buttons

## Frontend Architecture
- **Themes**: 11 palettes in `frontend/src/themes/definitions.ts`. `ThemeManager` reads localStorage → admin default → 'inferno'. `[data-theme]` on `<html>`. Inline `<script>` in `<head>` prevents flash
- **CSS**: All styles in `frontend/index.html` via CSS custom properties. Always use CSS variables (e.g. `var(--primary)` not hardcoded hex). Typography: Chakra Petch (headings) + DM Sans (body). Fonts self-hosted woff2 — no external CDN
- **Sidebar & Views**: `.app-layout` with collapsible sidebar + `.main-content`. `ILobbyView` with `render()`/`destroy()`. All lobby views render in `.main-body`. Views with own sub-header hide `.main-header`
- **UI conventions**: Unified CSS classes: `.panel-header`/`.panel-content`, `.tab-bar`/`.tab-item`, `.data-table`, `.form-grid`/`.form-group`/`.input`/`.select`, `.toggle-switch`, `.setting-row`, `.option-chip`, `.mini-stat`, `.modal-header`/`.modal-body`/`.modal-footer`, `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-sm`
- **Gamepad UI nav**: `UIGamepadNavigator` spatial navigation — new interactive elements need `.sidebar-nav-item`, `.room-card`, or `.messages-conv-item` classes
- **Rendering**: All sprites procedurally generated in `BootScene.generateTextures()` — no external image assets. Power-up icons are procedural Canvas2D (`powerUpIcons.ts`) — no emoji `fillText`
- **Audio**: Web Audio API procedural SFX via `AudioManager` singleton + `SoundGenerator`. No external audio files. Phaser runs with `noAudio: true`
- **HUD**: DOM-based overlay in HUDScene.ts. Minimap maintains its own `minimapTiles` copy (seeded from `initialGameState` registry, updated via `tileDiffs`). Kill feed shows cause icons via `KillCause` type
- **Phaser lifecycle**: `shutdown()` must be registered via `this.events.once('shutdown', this.shutdown, this)` — Phaser does NOT auto-call. Phaser reuses scene instances — constructor runs once, `create()` runs on every scene start. ALL session-specific properties MUST be reset at top of `create()`
- **Real-time lobby**: Room list auto-updates via `room:list` socket broadcast on every room mutation

## Campaign System
Campaign with hand-crafted levels, enemies, and bosses. Solo, online co-op (2 players via party), and local co-op. 9 world themes with per-theme color palettes and themed tile textures.
- `CampaignGame` wraps `GameStateManager` with `customMap`. Enemy-explosion collision runs BEFORE enemy AI movement in `campaignTick()` to prevent enemies dodging same-tick explosions
- Editor supports dual mode: `editorMode: 'campaign' | 'custom_map'`. Custom map mode hides campaign-only tools and uses `/maps` API
- **Co-Op**: Online (party-based, 2 members) or local (guest or logged-in P2, 3 camera modes). Shared life pool, auto-respawn, sequential lock-in
- **Buddy Mode**: P2 is smaller, invulnerable support character. `isBuddy` flag, passes through walls/bombs. `isCoopMode` is false for buddy mode. Campaign retry must preserve `buddyMode` flag — check buddy before localCoop in if/else chain. Buddy ID: `-(2000 + (Date.now() % 10000))`
- **Puzzle Tiles**: Switches (toggle/pressure/oneshot, 4 colors), gates (linked by color, OR logic), crumbling floors. `PuzzleTileProcessor` shared between campaign and multiplayer. Rising-edge: reacts only on first tick of explosion via `prevSwitchBlasted`. Buddy blocked by closed gates and pits

## Custom Maps
User-created maps for multiplayer via `LevelEditorScene`. CRUD API at `/maps/`, validation in `shared/src/utils/mapValidation.ts` (odd dims 9-51, border walls, 2-8 spawns, teleporter pairing). `MatchConfig.customMapId` for room integration. Star ratings (1-5) on published maps.

## Spectator Game Master
Dead players accumulate energy to interact: place_wall, trigger_meteor, drop_powerup, speed_zone. Admin global toggle + per-room `MatchConfig.enableSpectatorActions`. Anti-griefing: rate limited, spawn protection, no targeting allies/occupied tiles.

## Community Map Challenges
Weekly featured community maps with competitive leaderboards. Only one active challenge at a time. `recordChallengeResult()` called after match finish. Map deletion blocked if linked to active/upcoming challenge.

## Progression & Rewards
- **Elo**: K-factor varies by games played. FFA pairwise, Teams average per team
- **Seasons**: Admin-defined, per-user per-season Elo. Hard/soft reset
- **Achievements**: `cumulative`, `per_game`, `mode_specific`, `campaign` conditions. Can reward cosmetics
- **Cosmetics**: `color`, `eyes`, `trail`, `bomb_skin`. In `toState()` (NOT `toTickState()` — static per game). Color priority: cosmetic → team → index-based
- **Rematch voting**: >50% threshold. `humanPlayerIds` filters `id > 0`; solo with bots shows "Play Again"

## Social Features
Friendships (reciprocal, DB-backed), presence (Redis, 120s TTL), parties (Redis, Lua atomic join, leader-follows), DMs (DB, friends only), 12 emotes with radial wheel. All social chat features admin-configurable via `ChatMode`. Each socket joins `user:{userId}` room on connect.

## Admin Panel
Full-screen panel for admin/moderator roles. `staffMiddleware` and `adminOnlyMiddleware` for route protection. All actions audit-logged. `admin_actions.target_id` is `INT NOT NULL` — use `0` for bulk operations. Features: session revocation, account cleanup, TOTP reset, registration toggle. See [docs/admin-and-systems.md](docs/admin-and-systems.md)

## AI Systems
- **Bot AI**: Three-layer sandbox (source scan, esbuild bundle, `vm.runInContext()` with 5s timeout). Crash recovery falls back to built-in. Team-aware. See [docs/bot-ai-guide.md](docs/bot-ai-guide.md)
- **Enemy AI**: Same sandbox pipeline. `IEnemyAI.decide(context)` returns `{ direction, placeBomb }`. See [docs/enemy-ai-guide.md](docs/enemy-ai-guide.md)
- **Simulations**: Admin-only batch runner. See [docs/admin-and-systems.md](docs/admin-and-systems.md#bot-simulation-system)

## Game Architecture
- 20 tick/sec server game loop. processTick order: bot AI → inputs → movement → conveyors → bomb slide → bomb timers → explosions → collisions → power-ups → hazards → puzzle tiles → KOTH → map events → spectator actions → zone → deathmatch respawns → time → win check
- Chain reaction tile snapshot: tiles snapshotted before processing detonations so chained bombs use original wall layout. Chain reactions always propagate regardless of remote detonate mode
- Explosion damage cells exclude wall tiles — blast destroys walls but fire doesn't linger. Pierce bombs still damage through/beyond
- `SocketClient.off()` without a handler removes ALL listeners for that event. Always pass specific handler references
- HUDScene listens for campaign state via Phaser event (`campaignStateUpdate`) — never register HUDScene on socket for `campaign:state`
- Self-kills subtract 1 from kill score. Power-up drop on kill: weighted random from collected stack
- Grace period: 30 ticks after win condition before status='finished'. Mid-game leave: `room:leave` kills immediately, disconnect uses 10s grace
- Game start: `room:start` uses atomic Lua to prevent TOCTOU race

## Open World Mode (WIP)
Persistent bomb arena as default landing experience. Players auto-join on page load.
- **Toroidal map**: Wrapping 51x41 grid (no border walls). `wrapX`/`wrapY` from `shared/src/utils/wrap.ts`. For odd-dimension wrapping maps, last even col/row skipped in wall grid to avoid double-walls at seam
- **Ghost rendering**: 8 offset copies for seamless visual wrapping. Entity renderers create ghost sprites near edges
- **Guest access**: Unauthenticated players via `SocketClient.connectAsGuest()`. Guest IDs start at `OPENWORLD_GUEST_ID_START` (-3000)
- **Backend**: `OpenWorldManager` singleton. Round cycle with configurable duration, freeze period, map regeneration
- **AFK timeout**: Configurable inactivity kick (default 60s, 0 = disabled). Hot-reloadable admin setting
- **Constants**: `shared/src/constants/openworld.ts`. Settings in `server_settings` (keys prefixed `open_world_`)
- **WIP**: HUD round timer/leaderboard

## Game Reference

### Game Modes
FFA (2-8, last standing), Teams (4-8, 2 teams, friendly fire toggle), Battle Royale (4-8, shrinking zone), Sudden Death (2-8, maxed stats, one hit), Deathmatch (2-8, respawn, first to 15 kills), King of the Hill (2-8, control zone, hill moves every 30s)

### Power-Ups (9 types)
bomb_up, fire_up, speed_up, shield, kick, pierce_bomb, remote_bomb (E to detonate, FIFO/ALL toggle), line_bomb, bomb_throw (Q to throw, weight 4 rare)

### Map Features
- **Reinforced walls**: 2 hits — `destructible_cracked` → destroyed
- **Dynamic map events** (individually selectable): meteor, power_up_rain, wall_collapse, freeze_wave, bomb_surge, ufo_abduction
- **Hazard tiles** (individually selectable): teleporters, conveyors, vine/mud, quicksand, ice, lava, spikes, dark_rift. Types in `shared/src/utils/hazard.ts`
- **Covered tiles**: Special tiles hidden under destructible walls via `coveredTiles` array

## Replay System
Gzipped JSON replays with tile diffs. Campaign replays in `campaign_replays` table. See [docs/replay-system.md](docs/replay-system.md)

## SEO & Static Assets
All resources self-hosted — no external CDN. Meta tags (OG, Twitter Card, JSON-LD). CSP: `'self'` only.

## Security
- **Email hashing**: HMAC-SHA256 with `EMAIL_PEPPER`. DB stores `email_hash` + `email_hint`. `backfill-emails.ts` migrates legacy rows on startup
- **Email verification**: Required before game access. Socket + REST middleware enforce. Max 3 resends per account
- **Email enumeration prevention**: Existing email returns generic error + warning email to owner
- **TOTP 2FA**: AES-256-GCM encrypted secrets. Two-step login (challenge token → verify). 10 backup codes
- **Rate limiting**: Nginx (API 30r/s, Socket.io 10r/s, auth 5r/s) + Express middleware + per-socket sliding window limiters
- **Atomic operations**: Refresh token rotation (compare-and-swap), password reset (single UPDATE with token check), room start (Lua script)
- **Socket.io role from DB**: Socket middleware reads role from database (not JWT) on each connection
- **Socket validation**: Zod schemas for room/admin events, manual validation for hot-path `game:input`
- See [docs/infrastructure.md](docs/infrastructure.md)

## Performance
See [docs/performance-and-internals.md](docs/performance-and-internals.md). Key: explosion batching (audio + screen shake coalesced per frame), particle budget caps, cached serialization with dirty flags.

## Internationalization (i18n)
Full-stack i18n via **i18next**. `t('namespace:section.key')` with `{{variable}}` interpolation.
- **Namespaces**: shared (`common`, `game`), frontend-only (`ui`, `auth`, `hud`, `admin`, `campaign`, `help`, `editor`, `errors`), backend-only (`server`, `email`)
- **Locale files**: `{workspace}/src/i18n/locales/{lng}/*.json`
- **Key conventions**: Dots are key separators — never use decimal numbers as JSON keys (use `"low30"` not `"0.3"`)
- **Variable shadowing**: When importing `{ t }` from i18n, lambda parameters named `t` must be renamed
- **Lazy evaluation**: Module-level constants using `t()` must be functions/getters — `t()` returns key before i18n initializes
- **View titles**: Use getter `get title() { return t('ui:...'); }` (not static)
- **Email i18n**: Templates use `getFixedT(language)`. Language threaded from user DB record through services. All 12 languages preloaded at startup

## Code Quality & Tooling
- ESLint v10 + `@typescript-eslint/recommended`; `no-explicit-any` warning, `no-unused-vars` error
- Prettier: single quotes, trailing commas, 100 char width
- Husky + lint-staged pre-commit: ESLint `--fix` + Prettier on staged `.ts`
- All Socket.io types fully parameterized — no `as any` casts
- `getErrorMessage(err: unknown)` from `shared/src/utils/error.ts` in all catch blocks
- Modals: `role="dialog"`, `aria-modal="true"`, `aria-label`, Escape closes. Toggle switches: `role="switch"` + `aria-checked`

## Database Migrations
- Forward: `backend/src/db/migrations/*.sql`, numbered `NNN_description.sql`
- Rollback: `backend/src/db/migrations/down/*.down.sql`
- Runner: `runMigrations()` (auto on startup), `rollbackMigration(steps)`, `getAppliedMigrations()`

## Testing
```bash
npm test                    # Run all workspace tests (backend + frontend)
npx jest --config tests/backend/jest.config.ts  # Backend only (from project root)
cd frontend && npx vitest run                   # Frontend only
```
- See [docs/testing.md](docs/testing.md) for full inventory, mocking patterns, and guide

## Documentation
- [Bot AI Developer Guide](docs/bot-ai-guide.md) — writing custom bot AIs
- [Bot AI Internals](docs/bot-ai-internals.md) — built-in BotAI decision engine
- [Enemy AI Developer Guide](docs/enemy-ai-guide.md) — custom campaign enemy AIs
- [Campaign System](docs/campaign.md) — enemies, levels, editor, progress
- [Admin Panel & Systems](docs/admin-and-systems.md) — admin tabs, simulations, accounts
- [Replay System](docs/replay-system.md) — recording, playback, controls, API
- [Socket.io Events](docs/socket-events.md) — real-time event reference
- [Performance & Internals](docs/performance-and-internals.md) — optimizations, game logging
- [Infrastructure & Security](docs/infrastructure.md) — security, resilience, Docker
- [Testing](docs/testing.md) — test inventory, mocking, writing new tests
- [API Reference](docs/openapi.yaml) — OpenAPI 3.0.3 specification
