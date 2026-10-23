# BlastArena

Multiplayer online grid-based explosive arena game. Monorepo with npm workspaces `shared/`, `backend/` (Node 26, Express 5, Socket.io), `frontend/` (Phaser 4 + DOM UI, Vite); MariaDB 12.3 + Redis 8; Docker Compose (db, redis, backend, nginx).

## Commands
```bash
npm ci                                          # install all workspaces
npm test                                        # all tests (backend + shared via Jest, frontend via Vitest)
npx jest --config tests/backend/jest.config.ts  # backend + shared only (from the repo root)
cd frontend && npx vitest run                   # frontend only
npm run lint && npm run format:check            # ESLint, Prettier
docker compose up --build -d                    # production (nginx on 127.0.0.1:8280)
npm run dev                                     # dev stack, hot reload (see Invariants: -p)
bash scripts/docs-screenshots.sh [outdir]       # docs tour: stack -> seed -> PNGs (default docs/screenshots)
```
- `tests/backend/db/migrationLock.test.ts` is the one suite that needs a real MariaDB; CI and fleet set `REQUIRE_DB_TESTS=1` plus `DB_*` (it skips otherwise).
- Docs tour: `e2e/` is its own npm package (Playwright, not a workspace). `scripts/docs-screenshots.sh` builds the prod images, starts `docker-compose.yml` + `docker-compose.e2e.yml` as project `blastarena_docs` on `127.0.0.1:${PORT_BASE:-24200}`, seeds through the API (`e2e/docs/seed.ts`; SQL only to verify/promote the first admin and to backdate rows) and runs `e2e/docs/tour.spec.ts`. Fleet: `fleet check blastarena --with docs`.
- More: [docs/testing.md](docs/testing.md) (inventory, mocking patterns).

## Invariants
**Stacks and ports**
- Production is the canonical run mode on the server (project `blast-arena`, nginx `127.0.0.1:8280` behind a host TLS proxy). Never use the project names `blast-arena` or `blast-arena-dev` for anything but those stacks.
- Dev needs `-p blast-arena-dev` (`npm run dev` passes it). `.env` sets `COMPOSE_PROJECT_NAME=blast-arena`, which outranks `name:` in `docker-compose.dev.yml`; without `-p` Compose adopts and replaces the production containers silently. Dev is isolated: nginx 8285, Vite 5183, DB 3317, Redis 6390, data in `./data-dev` (`tests/backend/utils/composeIsolation.test.ts`).
- Docs/e2e stacks: project `blastarena_docs` / `blastarena_e2e` (the script refuses names not starting with `blastarena_`), ports from the fleet block 24200–24209 only, teardown `down -v --remove-orphans --rmi local`. `container_name` is `${COMPOSE_PROJECT_NAME}-<svc>`, so export the name as well as passing `-p`.
- The backend runs as uid 1000; its five bind mounts (`data/gamelogs simulations replays ai enemy-ai`) must be owned by 1000. Never chown all of `data/`: `data/db` and `data/redis` belong to uid 999.
- Keep all five Node stages (`docker/backend/Dockerfile`, `Dockerfile.dev`, two in `docker/nginx/Dockerfile`) and `.nvmrc` on the same exact `node:<patch>-alpine` tag (`tests/backend/utils/nodeVersion.test.ts`); isolated-vm needs a prebuilt binary for that ABI.

**Files you must not edit in place**
- `backend/src/db/redis.ts` and `backend/src/utils/logger.ts` carry `fleet-copy:` markers (copied from other repos). Report needed changes instead.
- `docs/*.md` are rendered by the in-game Help (`backend/src/routes/docs.ts` allow-lists them): no images there. Screenshots live only in `README.md` and `docs/screenshots/README.md`.

**Frontend**
- CSP is `'self'` with Trusted Types: all HTML goes through `setHtml()`/`insertHtml()` in `frontend/src/utils/html.ts` (raw `innerHTML` is an ESLint error elsewhere). The inline theme `<script>` in `frontend/index.html` is hash-pinned in `docker/nginx/security-headers.conf`: editing it means regenerating that hash. Nothing from external CDNs (fonts are self-hosted woff2).
- Styles live in `frontend/src/styles.css` (imported by `main.ts`); only `@font-face` and the theme script stay inline. Always CSS variables (`var(--primary)`), never hard-coded hex.
- Player colours always from `game/playerPalette.ts` (`playerColor()`, `teamColor()`, `teamColorIndices()`); the colour-blind setting swaps the palette.
- Phaser: register `shutdown()` with `this.events.once('shutdown', this.shutdown, this)` (Phaser does not call it). Scene instances are reused: reset ALL session state at the top of `create()`.
- `SocketClient.off(event)` without a handler removes every listener: always pass the handler reference.
- HUDScene gets campaign state from the Phaser event `campaignStateUpdate`, never from the socket `campaign:state`.
- Drawn art styles: size sprites with `fit()`/`base()` (`art/scale.ts`), never absolute scales; depths from `art/depth.ts`. New textures via `hiResGraphics()`/`bakeGraphics()` (Classic) or at `textureRatio()`. Pointer → world through `cam.getWorldPoint()` (pointer coords are device pixels).
- A full-screen overlay that must not catch clicks needs `#ui-overlay > .its-class { pointer-events: none }` (`#ui-overlay > *` turns them on).
- New interactive lobby elements must match the gamepad navigator's selector list (`LobbyUI.updateGamepadContext`) or extend it. Modals use `trapFocus()`, `role="dialog"`, `aria-modal`, `aria-label`, close on Escape; toggles are `role="switch"` + `aria-checked`.
- Open-world standings: `openworld:info` is authoritative (replace, don't merge); `getLeaderboard()` returns FULL standings (clients rank by index).
- Campaign retry must keep `buddyMode`: check buddy before localCoop in the if/else chain.

**Backend and shared**
- Server-authoritative: the client only renders and sends inputs. All game constants in `shared/src/constants/`.
- Bot players have negative ids (`-(i+1)`), guests from `OPENWORLD_GUEST_ID_START` (-3000), buddies `-(2000 + …)`; negative ids are never written to the DB.
- Map dimensions are odd (pillar grid); custom maps: odd 9–51, border walls, 2–8 spawns, paired teleporters (`shared/src/utils/mapValidation.ts`).
- `admin_actions.target_id` is `INT NOT NULL`: use `0` for bulk actions. Every admin action is audit-logged.
- Socket.io types are fully parameterised (no `as any`); `getErrorMessage(err: unknown)` in every catch.
- Socket middleware reads the role from the DB, not from the JWT.
- Migrations: `backend/src/db/migrations/NNN_description.sql` + `down/NNN_description.down.sql`. MariaDB DDL auto-commits, so write them re-runnable (`IF [NOT] EXISTS`, repeat-safe data changes); from 042 on `tests/backend/db/migrationParity.test.ts` rejects unguarded schema changes.

**i18n**
- New keys go into all 12 locales (`tests/shared/localeParity.test.ts`). Dots are key separators: never decimal numbers as keys (`"low30"`, not `"0.3"`).
- Module-level constants using `t()` must be functions/getters (`t()` returns the key before init); view titles are getters. Rename lambda parameters called `t` where `t` is imported.

## Architecture notes
- **Auth**: JWT access token in memory + httpOnly refresh cookie (`path=/api/auth`, `secure` derived from `APP_URL`, not `NODE_ENV`). `ApiClient.fetchWithAuth()` refreshes on 401 (one cached `refreshPromise`; auth endpoints use `skipAuthRetry`). Email verification is required before game access (REST + socket); emails are stored as HMAC-SHA256 hash + hint (`EMAIL_PEPPER`). Optional TOTP 2FA (AES-256-GCM secrets, `TOTP_ENCRYPTION_KEY` = 64 hex chars, required in production). Without SMTP, emails are only logged (subject/recipient, never the body).
- **Rate limits**: nginx zones (API 30r/s, Socket.io 10r/s, auth 5r/s) are per-IP only via the `real_ip` block in `docker/nginx/nginx.conf`, which relies on Traefik replacing inbound `X-Forwarded-*` ([docs/infrastructure.md](docs/infrastructure.md#nginx-rate-limiting)). Express limiters key `ratelimit:<ip>:<route>` in Redis (login 10, register 3 per 15 min).
- **Lobby rooms**: Redis, mutated by atomic Lua scripts in `services/lobby.ts` (`JOIN_ROOM_LUA`, …, `START_ROOM_LUA`), `ROOM_TTL_SECONDS = 3600`; `room:list` is broadcast on every mutation. LobbyScene's `game:start` listeners are one-shot and only accept a state that includes the user; GameScene keeps one for the match (reconnect resync).
- **Game loop**: 20 ticks/s. processTick order: bot AI → inputs → movement → conveyors → hazard slowdown → bomb timers/slide → detonations → explosion timers → collisions → power-ups → hazard damage → puzzle tiles → KOTH → map events → spectator actions → zone → deathmatch respawns → time → win check. Tiles are snapshotted before detonations (chains use the original layout); explosion damage cells exclude walls. Grace period 30 ticks after a win; `room:leave` kills at once, a disconnect gets 10 s. Self-kills subtract a kill.
- **State size**: cosmetics go out in full `toState()` and only on a player's first `toTickState()`; explosion `cells` once per explosion; tick states carry no `spawnPoints`. `GameScene.hydrateState()` and `ReplayRecorder` fill the gaps from per-id caches.
- **Scenes**: Boot, Menu, Lobby, Game, HUD, GameOver, LevelEditor (a lazy chunk: `await ensureLevelEditorScene(game)` from `scenes/levelEditorLoader.ts` before `scene.start('LevelEditorScene')`). State is handed over through `this.registry`: `initialGameState`; `openWorldMode` + `openWorldPlayerId`; campaign run keys (`campaignMode`, `campaignCoopMode`, `localCoopMode`, `localCoopConfig`, `localCoopP2Identity`, `buddyMode`, `buddyConfig`, `campaignTheme`, `campaignEnemyTypes`; `clearCampaignRun()` drops them together); `replayMode`/`replayData`; `simulationSpectate`; `adminSpectate`; `gameOverData`; `currentRoom`, `openCampaign`, `returnToAdmin`; shared services `socketClient`, `authManager`, `notifications`.
- **Lobby UI**: `.app-layout` with a collapsible sidebar; 15 views (`ui/views/`, `ILobbyView` with `render()`/`destroy()`), each in its own `.view-root` inside `.main-body`. After login the lobby opens the Open World view, which auto-joins the world once per page load. Admin is a view with 12 tabs (`ui/AdminUI.ts`, `ui/admin/`); staff see Users, Matches, Rooms, Announcements, admins all. Shared CSS classes: `.panel-header`/`.panel-content`, `.tab-bar`/`.tab-item`, `.data-table`, `.form-grid`/`.form-group`/`.input`/`.select`, `.toggle-switch`, `.setting-row`, `.option-chip`, `.mini-stat`, `.modal-*`, `.btn*`.
- **Themes and art styles**: 11 palettes (`themes/definitions.ts`; localStorage → admin default → `inferno`, `[data-theme]` on `<html>`). Art styles Classic, Neon Arena, Toy Diorama, Crisp Pixel (`shared/src/constants/artStyles.ts`; localStorage `blast-arena-art-style` → admin `default_art_style` → `classic`); drawn styles are Canvas 2D painters (`art/painters/types.ts`) baked into atlases by `StyleArt` and use `StyledTileMap`; `activeStyleArt(scene)` is null for Classic. The level editor always uses Classic tiles. Admin default changes arrive live via `admin:settingsChanged`.
- **Sharp rendering** (`art/hidpi.ts`): the canvas is CSS size × `renderRatio()` (≤2; 1 when off or quality Low); GameScene multiplies camera zoom by it, UI scenes lay out in CSS pixels via `uiCamera(scene)`. `?dpr=2` forces 2×. Graphics settings in `game/Settings.ts` (`quality`, `sharpRendering`, `colorBlind`, `onSettingsChange()`).
- **Rendering and audio**: no external image or audio assets. Classic sprites in `BootScene.generateTextures()`, power-up icons in `powerUpIcons.ts`, HUD icons in `ui/hudIcons.ts`, kill-feed portraits in `ui/portraits.ts`. Sprites move toward tick targets in `frame(delta)`; a jump of more than 3 tiles is placed directly. SFX are synthesised (`AudioManager`, `SoundGenerator`; Phaser `noAudio: true`; `AudioContext` on first gesture, `ensureResumed()`).
- **HUD**: DOM overlay in `HUDScene.ts`. The minimap keeps its own grid (seeded from GameScene's `liveTiles` or `initialGameState`, updated by `tileDiffs`). Open world swaps `.hud-players` for `.hud-ow-board` + `.hud-round`; guests get the `.hud-auth-bar` login/register bar over the live game.
- **Open world** (WIP): persistent toroidal 51×41 arena, the default landing (guests auto-join behind the menu; the first game key docks the landing, `MenuScene.dockLanding()`). `OpenWorldManager` singleton, round cycle, AFK kick, settings `open_world_*` in `server_settings`, constants in `shared/src/constants/openworld.ts`, wrapping helpers in `shared/src/utils/wrap.ts`. The lobby `OpenWorldView` polls `/admin/settings/open_world/status` every 10 s.
- **Campaign**: `CampaignGame` wraps `GameStateManager` with a `customMap`; enemy/explosion collision runs before enemy AI movement. Solo, online co-op (party of 2), local co-op (3 camera modes), buddy mode (`isBuddy`, invulnerable, `isCoopMode` false). Puzzle tiles (`PuzzleTileProcessor`, shared with multiplayer) react on the rising edge (`prevSwitchBlasted`). Editor `editorMode: 'campaign' | 'custom_map'`; custom maps via `/maps` and `MatchConfig.customMapId`. See [docs/campaign.md](docs/campaign.md).
- **AI**: admin-uploaded bot/enemy AIs are scanned, bundled with esbuild and run in an `isolated-vm` isolate per instance (`IsolatedAIRunner`); only trusted built-ins run via `vm.runInContext()`. Bot decisions are seeded from the map seed, so bot matches replay deterministically. See [docs/bot-ai-guide.md](docs/bot-ai-guide.md), [docs/enemy-ai-guide.md](docs/enemy-ai-guide.md).
- **Progression**: Elo (K by games played; FFA pairwise, teams by average), seasons (per-season Elo, hard/soft reset), achievements (`cumulative`, `per_game`, `mode_specific`, `campaign`), cosmetics (`color`, `eyes`, `trail`, `bomb_skin`; colour priority cosmetic → team → index), rematch vote >50% (solo with bots shows "Play Again").
- **Social**: friendships (DB), presence (Redis, 120 s TTL), parties (Redis, Lua join, leader-follows), DMs (DB, friends only), 12 emotes; every chat feature has an admin `ChatMode`. Each socket joins `user:{userId}`. `SocketClient.onReconnect()` fires after every reconnect and each scene re-joins what it shows ([docs/socket-events.md](docs/socket-events.md#reconnection-to-active-games)).
- **Spectator game master**: dead players spend energy on place_wall, trigger_meteor, drop_powerup, speed_zone (admin toggle + `MatchConfig.enableSpectatorActions`).
- **Replays**: gzipped JSON with tile diffs; campaign replays in `campaign_replays`. Admin tabs start them via `startReplay()` (`ui/admin/replayLauncher.ts`); closing returns to the tab via registry `returnToAdmin`. See [docs/replay-system.md](docs/replay-system.md).
- **i18n**: i18next, namespaces `common`, `game` (shared), `ui`, `auth`, `admin`, `campaign`, `errors` (frontend, at boot), `help`, `editor` (loaded on demand), `server`, `email` (backend). Locale files `{workspace}/src/i18n/locales/{lng}/*.json`; emails use `getFixedT(language)`.
- **Migrations**: `runMigrations()` runs on startup under the advisory lock `GET_LOCK('blast_arena_migrations_<DB_NAME>')`.
- **Tooling**: ESLint 10 + typescript-eslint (`no-explicit-any` warn, `no-unused-vars` error), Prettier (single quotes, trailing commas, width 100), Husky + lint-staged on staged `.ts`.

## Documentation
- [docs/campaign.md](docs/campaign.md), [docs/replay-system.md](docs/replay-system.md), [docs/bot-ai-guide.md](docs/bot-ai-guide.md), [docs/enemy-ai-guide.md](docs/enemy-ai-guide.md) — player/creator guides (also shown in-game)
- [docs/admin-and-systems.md](docs/admin-and-systems.md), [docs/infrastructure.md](docs/infrastructure.md), [docs/testing.md](docs/testing.md), [docs/performance-and-internals.md](docs/performance-and-internals.md), [docs/bot-ai-internals.md](docs/bot-ai-internals.md), [docs/openapi.yaml](docs/openapi.yaml) — staff docs (also shown in-game)
- [docs/socket-events.md](docs/socket-events.md) — Socket.io event reference
- [docs/screenshots/README.md](docs/screenshots/README.md) — screenshot gallery (generated by the docs tour)
