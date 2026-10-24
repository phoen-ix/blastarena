# Testing

BlastArena's tests cover the full stack: game logic, backend services, API routes, socket handlers, middleware, database migrations, utilities, shared code, config guards, and frontend.

| Stack | Framework | Location |
|-------|-----------|----------|
| Backend (incl. `tests/shared`) | Jest + ts-jest | `tests/backend/`, `tests/shared/` |
| Frontend | Vitest + jsdom | `frontend/tests/` |

`npm test` prints the current counts.

## Running Tests

```bash
npm test                                                      # All workspaces
npx jest --config tests/backend/jest.config.ts                # Backend only (from project root)
cd frontend && npx vitest run                                 # Frontend only
npx jest --config tests/backend/jest.config.ts -- <file>      # Single backend file
npx jest --config tests/backend/jest.config.ts --watch        # Backend watch mode
cd frontend && npx vitest                                     # Frontend watch mode
```

## Test Configuration

**Backend** (`tests/backend/jest.config.ts`):
- Preset: `ts-jest`; the transform compiles with `backend/tsconfig.json`
- Environment: `node`
- Root dir: the repository root (`rootDir: '../../'`)
- Test match: `tests/backend/**/*.test.ts` + `tests/shared/**/*.test.ts`
- Module alias: `@blast-arena/shared` → `<rootDir>/shared/src`
- Diagnostic override (`diagnostics.ignoreCodes`): TS1378 (top-level await) and TS6133/6192/6196 (unused locals and imports). The workspace tsconfigs enable `noUnusedLocals`/`noUnusedParameters` for `src/`, and test files are exempt so a leftover import cannot fail a suite

**Frontend** (`frontend/vitest.config.ts`):
- Environment: `jsdom` (spec-compliant DOM; DOMPurify 3.4 mis-sanitises under happy-dom)
- Test include: `tests/**/*.test.ts` (relative to `frontend/`, so `tests/helpers/*.ts` are not collected as tests)
- Module aliases: `@shared` and `@blast-arena/shared` → `../shared/src`

## Test Organization

```
tests/
├── backend/
│   ├── game/           core game logic, engine/campaign regressions, bot determinism, open world
│   ├── services/       business logic layer, AI sandbox/isolates, built-in enemy AIs, AI guide examples, TOTP, Lua/pagination source scans
│   ├── routes/         API endpoint handlers, admin validation, route mounting, JSON 404 + headers
│   ├── handlers/       Socket.io event handlers, socket.ts AST guards
│   ├── middleware/     auth, validation, rate limiting, errors, body parsing, email, locale
│   ├── db/             SQL statement parser, migration up/down parity, rollback guard, migration lock (real MariaDB)
│   ├── simulation/     batch bot simulation manager and runner
│   ├── utils/          crypto, rate limiting, log/replay pruning, guest gate, nginx/Compose/Node config guards
│   └── shared/         XP math
└── shared/              locale parity, map validation, puzzle helpers, validation (run by backend Jest)

frontend/tests/
├── art/                 drawn-style painters, art style resolution, explosion pieces
├── game/                entity/tile/minimap renderers, sprite interpolation, noise buffer, replay log index, settings, client fixes
├── network/             ApiClient, auth refresh, SocketClient connect/reconnect
├── scenes/              open-world map resize, scene listener lifecycle, replay/spectator exits
├── shared/              grid utilities
├── ui/                 lobby views/panels, HUD player list, admin tabs + response contracts, admin return, auth/co-op modals, party state, i18n
├── utils/               HTML escaping/sanitising, Trusted Types, focus trap, colors, tile textures, wrap ghosts
└── helpers/             shared fakes, not tests: fakeScene.ts (Phaser scene stand-in), htmlLiterals.ts (HTML literal corpus)
```

## Test Inventory

Backend paths are relative to `tests/backend/`, frontend paths to `frontend/`. Counts are `it`/`test` cases as the runner reports them, so each `it.each` case and each test generated in a loop (one per locale file, migration, Lua script, paginated query or nginx location) counts individually.

### Game Logic

Core game mechanics — most of these drive the server-authoritative game state directly, without mocks; the room/session wrappers (`GameRoom`, `RoomManager`, `OpenWorldManager`, campaign) mock the DB, `GameLoop` and AI registries around the real engine.

| File | Coverage |
|------|----------|
| `game/GameState.test.ts` | Full lifecycle, time-up ranking, movement, bombs, explosions, chain reactions, power-ups, FFA/teams/deathmatch/KOTH (+ zone init), grace period, conveyors, teleporters, remote/pierce/line bombs, bomb throw/kick, shield, self-kill, buddy collision |
| `game/Player.test.ts` | State management, movement cooldowns, all 9 power-up effects, shield, death, respawn, buddy mode, remote detonation, frozen state, cosmetics, spawn invulnerability in toState() |
| `game/CampaignGame.test.ts` | Map building, spawn fallback chains, enemy spawning, starting/carried power-ups, time-up per win condition, idempotent finish, buddy mode, hazard tiles, boss enemies, puzzle tiles, covered tiles |
| `game/Enemy.test.ts` | ID allocation clear of user/bot/buddy/guest ranges, cooldowns, speed divisor formula, bomb config, HP/damage, boss phase transitions, toState() |
| `game/EnemyAI.test.ts` | 5 movement patterns (stationary, random_walk, chase_player, patrol_path, wall_follow), BFS pathfinding, canPassWalls/canPassBombs, bomb triggers (timer/proximity/random) |
| `game/RoomManager.test.ts` | Create/get/remove rooms, active count, cleanup reaps stopped rooms and stops them (releases AI isolates + log stream) |
| `game/BotAI.test.ts` | Difficulty tiers, input shape/seq, danger avoidance, bombing next to enemies, power-up seeking + value scoring, aggression by difficulty, cornered case, team awareness, GameStateManager integration |
| `game/Explosion.test.ts` | Construction (UUID ids, cell deep copy), tick countdown and expiry at EXPLOSION_DURATION_TICKS, containsCell, toState(), pierce flag, edge cases |
| `game/HazardTiles.test.ts` | Vine/quicksand/mud slowdown, quicksand kill timer, ice sliding, lava (impassable, detonates adjacent bombs), spike cycling, dark rift teleport, walkability of 8 hazard tiles, campaign theme in state, buddy/enemy interaction |
| `game/GameRoom.test.ts` | Start flow (match record, human-only match_players, game:start), negative bot IDs, reconnect, isAbandoned rules, game-over persistence (two batched transactions, Elo before stats, achievements, never rejects on DB failure), bots-only speed-up in respawn modes |
| `game/CollisionSystem.test.ts` | Blocking by walls/bombs, walkability of every special tile (hazards, lava/pit, switches, gates), reinforced-wall cracking, vine destruction, out-of-bounds reads as wall |
| `game/AuditEngineFixes.test.ts` | KOTH hill relocation re-arms its timer, intra-tick occupancy, finish grace (zone kills, respawns), SeededRandom bounds, per-bot AI seed, collision helper parity, trimmed toTickState payload, ReplayRecorder re-hydration |
| `game/BattleRoyale.test.ts` | Round-length-fitted shrink schedule (starts at the half-diagonal, reaches min radius before the round ends, touches the corners early), initial delay, min-radius floor, inside/boundary checks, center stability, asymmetric maps, toState() |
| `game/Map.test.ts` | Map generation, seed determinism, border + indestructible wall grid pattern, spawn clearing, min/max sizes, wallDensity, hazard placement |
| `game/PowerUp.test.ts` | Construction for 8 types (not bomb_throw), UUID ids, position deep copy, toState(), readonly fields |
| `game/Bomb.test.ts` | Bomb creation, countdown, detonation, remote/pierce types, REMOTE_BOMB_MAX_TIMER, sliding/conveyor defaults, toState() (incl. slide direction) |
| `game/EngineRegressions.test.ts` | Room config arrays survive the cjson round trip, time-up ranking (deathmatch/KOTH/teams), spectator meteor + wall refund, shared placement for same-tick deaths, meteor chains bombs, freeze-wave ice, InputBuffer action merge (first pending action kept, later ones on following ticks) |
| `game/PowerUpDrops.test.ts` | Weighted drop pick honours POWERUP_DEFINITIONS weights (re-normalised over the enabled set, null when none); death drops every permanent pickup incl. bomb_throw, never shield |
| `game/GameLoop.test.ts` | Tick timing, game state progression, circuit breaker, double-start, onGameOver, setTickRate |
| `game/InputBuffer.test.ts` | Ordered getInputs with clear-on-read, getLatestInput returns the newest direction, 60-entry cap drops oldest, per-player buffers, clear/clearAll (action merging is pinned in `EngineRegressions`) |
| `game/OpenWorldManager.test.ts` | Full leaderboard (score, then kills, never truncated), broadcastInfo incl. on leave, kill/self-kill score updates, score floored at 0, getStatus carries standings |
| `game/BotDeterminism.test.ts` | Seeded bot matches replay identically, differ across seeds, per-bot RNG streams; SeededRandom.shuffle unbiased and reproducible |
| `game/ModeEdgeCases.test.ts` | KOTH hill and BR zone sized to custom map dimensions, deathmatch respawn avoids live bombs + re-derives bombCount, cracked spectator walls revert |
| `game/BotInputReplay.test.ts` | Throttled-tick replay of bot decisions keeps the direction but strips bomb/detonate actions (no phantom bombs, no remote-mode flips) |
| `game/CampaignRegressions.test.ts` | Timed kill-all fails at time-up, one hit per explosion per enemy, departed co-op partner not respawned/charged/awaited, idempotent pause |
| `game/MapEventPrune.test.ts` | Map events expire with dynamic events on or off, in-window events kept, list stays bounded over long matches |
| `game/ChainSnapshot.test.ts` | Chained detonations use the pre-detonation tile snapshot (a first blast cannot widen the second), incl. a 3-bomb line batch and with unexpired bombs left |

### Services

Business logic layer — DB/Redis-backed services are tested with mocked database and Redis; the AI compiler, sandbox and isolate suites run the real compilers and isolates. The `lua-interpolation` and `pagination-total-order` suites scan the service sources instead, and `aiGuideExamples` compiles the code samples in the AI guides.

| File | Coverage |
|------|----------|
| `services/campaign.test.ts` | Worlds/levels CRUD (level create with an unknown world → 400 WORLD_NOT_FOUND, not a foreign-key 500), reorder, summary queries skip heavy JSON columns, batched progress lookup (two queries for any number of worlds), next-level logic, JSON field mapping |
| `services/email.test.ts` | SMTP config, send verification/reset/change/test emails, transporter caching, env vs DB config priority |
| `services/cosmetics.test.ts` | CRUD, equip/unequip, batch game fetch, default unlock, campaign star unlocks, getPlayerCosmeticsForGame |
| `services/admin.test.ts` | User CRUD (duplicate-entry race → 409), role change and deactivation (unknown user → 404, nothing changed or logged), password reset, server stats, match history/detail, audit log, toasts/banners, account cleanup preview/execute |
| `services/achievements.test.ts` | CRUD, all 4 condition types (cumulative/per-game/mode-specific/campaign), unlock + reward flow, bounded query volume |
| `services/botai.test.ts` | Upload, compile, update, reupload, delete, registry lifecycle, built-in protection, source download |
| `services/elo.test.ts` | Expected score, K-factor scaling, FFA pairwise calc, team calc, processMatchElo, bot filtering |
| `services/enemyai.test.ts` | Full CRUD, file upload/download, compilation on upload, registry load/unload on activate/deactivate, built-in handling, audit logging |
| `services/replay.test.ts` | List (paginate before stat)/read/delete/placements, gzip decompression, file discovery, cached async directory index with TTL, campaign replay delete |
| `services/enemy-type.test.ts` | CRUD, bulk config fetch, JSON config parsing, isBoss extraction |
| `services/leaderboard.test.ts` | Pagination (limit cap 100), season vs all-time Elo source, privacy filtering, getRankForElo with/without sub-tiers, public profile, user rank |
| `services/campaign-progress.test.ts` | User state, level progress, star calculation, attempt/completion recording |
| `services/friends.test.ts` | Send (MAX_FRIENDS, mutual request auto-accepts, deadlock → 409)/accept/decline/cancel/remove/block/unblock, getFriends with presence, isBlocked, search |
| `services/auth.test.ts` | Register (uniform response, no email enumeration), login, refresh rotation (lost CAS or reuse revokes all), logout, verify email, resend limit, forgot/reset password, token-type separation (2FA challenge, local co-op) |
| `services/season.test.ts` | CRUD (unknown ids → 404, a single moved date checked against the stored other end), activate (unknown id → 404, nothing changed), end with hard/soft reset (unknown → 404, already ended → 409 SEASON_NOT_ACTIVE, no Elo reset), boolean isActive, user history |
| `services/custom-maps.test.ts` | Full CRUD, JSON parsing with safeJsonParse fallback, snake_case→camelCase mapping, ownership enforcement, delete blocked by an active challenge |
| `services/botai-sandbox.test.ts` | Source scan, global access blocking, vm sandbox, import blocking, eval/Function blocking, constructor-walk escapes, infinite-loop timeout |
| `services/lobby.test.ts` | Room CRUD via Redis, room index (no keyspace SCAN, self-heals expired keys), join (atomic Lua) errors, leave + host transfer, ready toggle, single-DEL delete |
| `services/party.test.ts` | Create/join/leave/kick/disband, Lua script atomic join with the exclusivity check inside the script, invite CRUD |
| `services/settings.test.ts` | Get/set, recording toggle, game/simulation defaults JSON, rank config fallback, getSetting read cache (misses cached, writes visible immediately) |
| `services/user.test.ts` | Profile (real booleans for the 0/1 TINYINT columns), username change (duplicate race → 409), email change request/confirm/cancel (no enumeration, token expiry), direct email update, password change revokes all refresh tokens |
| `services/messages.test.ts` | sendMessage (friendship/block checks, empty input, truncation), getConversation (pagination), getConversationList (unread counts, capped), markRead |
| `services/party-errors.test.ts` | Lua reply → AppError mapping for create/join/kick, generic 409 fallback, plain-string replies only, exclusivity check inside the script, ReplyError stays masked |
| `services/botai-compiler.test.ts` | scanAndBuildAI (file size, esbuild errors), compileBotAI (class finding, method validation), sandbox execution |
| `services/botai-registry.test.ts` | Built-in always registered, initialize loads active uploads (skips missing files), uploads kept for the isolate (no in-process eval), isolate-backed createInstance with built-in fallback, unload/reload |
| `services/enemyai-registry.test.ts` | Initialize, loadAI trusted (built-in, in-process) vs untrusted (isolate only, whoever uploaded it), createInstance, unload/reload |
| `services/enemyai-compiler.test.ts` | compileEnemyAI with decide() validation, DUMMY_TYPE_CONFIG passed to the constructor, export patterns, scan errors propagated |
| `services/lua-interpolation.test.ts` | Source scan: no `*_LUA` script in `services/` contains an un-interpolated TS constant (one test per script + a non-vacuity check) |
| `services/pagination-total-order.test.ts` | Source scan: every `LIMIT ? OFFSET ?` query in `services/` ends its ORDER BY on a unique key (one test per query + a non-vacuity check) |
| `services/isolated-ai-runner.test.ts` | IsolatedAIRunner: constructor-walk escape blocked, infinite loops time out (bot + enemy), live-object API fidelity + canMoveTo parity, seeded enemy RNG, disposal (the many-runners smoke test tolerates a cold-call timeout on a loaded machine), incremental tile sync |
| `services/buddy.test.ts` | getBuddySettings defaults, saveBuddySettings UPSERT with partial merge |
| `services/presence.test.ts` | Set with TTL, get (corrupt data → null), getBatch via MGET (skipped for empty input), remove |
| `services/challenges.test.ts` | Admin challenges: unknown ids → 404 with nothing changed (activate/update/delete/deactivate), activate switches the others off, update applies a new map and checks a partial date change against the stored end, missing/unpublished map → 400 |
| `services/enemyaiBuiltins.test.ts` | Every built-in enemy AI source through the real compiler and sandbox, loaded by the registry (`module.exports = Class` shape) and deciding at each difficulty |
| `services/achievements-progress.test.ts` | getAchievementProgress: one GROUP BY query for mode-specific stats, one for campaign totals, aggregates skipped when unneeded or already unlocked, bounded query count, locked per-game goals other than `>=` show no progress |
| `services/ServiceAuditFixes.test.ts` | canUserPlayMap (owner, published, unpublished, missing), refresh-token reaping as two indexed deletes |
| `services/auth-refresh-reaper.test.ts` | cleanupExpiredRefreshTokens: two indexed deletes (no OR), chunked loop until a short chunk, missing affectedRows → 0, driver errors propagate |
| `services/aiGuideExamples.test.ts` | Every example class in `docs/bot-ai-guide.md` and `docs/enemy-ai-guide.md` compiles through the real upload compilers (compileBotAI/compileEnemyAI) |
| `services/totpBackupCodes.test.ts` | Backup-code shape guard accepts every generated code, rejects 6-digit TOTP codes and junk before the bcrypt loop |
| `services/ai-output.test.ts` | toPlayerInput/toEnemyAIResult: well-formed bot input kept + tick stamped, unknown directions/actions dropped, malformed enemy decision → no-op |
| `services/totp-verify.test.ts` | verifyCode: a code is accepted once per time step, lockout (429) after repeated failures, success clears the failure count |

### Routes / API

HTTP endpoint tests — Express route handlers tested with mocked services and pass-through middleware. `route-mounting` and `notFound` instead send real HTTP requests to the mounted routers on an ephemeral port.

| File | Coverage |
|------|----------|
| `routes/admin.test.ts` | Public settings/banner/active-AI endpoints, settings (registration, recordings, game/simulation defaults, default art style, email + test send), users, matches (incl. bulk delete; unknown match → 404, nothing deleted or logged), rooms, audit log, announcements, replays, simulations, bot-ai, account cleanup, staff vs admin middleware |
| `routes/campaign.test.ts` | Worlds/levels/enemies CRUD, reorder, progress, import/export with conflict resolution (an enemy-type use-existing AI must exist: 400 AI_NOT_FOUND; a level import checks the world before creating anything), param validation, middleware presence, router completeness |
| `routes/auth.test.ts` | Register (uniform result, registration toggle), login, logout, refresh, verify email, forgot/reset password, cookie flags from APP_URL, local co-op P2 login (incl. 2FA), rate-limit/validation middleware |
| `routes/user.test.ts` | Profile CRUD, email change (admin direct vs confirmation), password validation, confirm-email public endpoint (redirect, rate limited), TOTP route rate limiters |
| `routes/custom-maps.test.ts` | CRUD endpoints, validateCustomMap integration, Zod schema enforcement, ownership checks, auth + email-verified middleware |
| `routes/leaderboard.test.ts` | Leaderboard/season pagination with clamping, rank tiers, public profile (400/404), user rank (auth required) |
| `routes/adminValidation.test.ts` | Zod validation on admin season/achievement/cosmetic/challenge updates: partial bodies, malformed fields → 400, unknown fields stripped, non-numeric :id → 400 INVALID_ID; unknown achievement/cosmetic id → 404 (nothing updated or logged), cosmetics accept the level_milestone unlock type |
| `routes/cosmetics.test.ts` | Cosmetics list, user cosmetics/equipped, equip/unequip, achievements list + user achievements, auth/validation middleware |
| `routes/messages.test.ts` | Conversation list, paginated history (limit cap 50, param clamping), mark read, non-numeric userId → 400, auth + email-verified middleware |
| `routes/docs.test.ts` | Public/staff doc serving, path traversal prevention, whitelist enforcement, middleware presence |
| `routes/notFound.test.ts` | Real app over HTTP: unmatched routes get a JSON 404 (no HTML page, no finalhandler CSP), admin gate still answers 401, security headers left to nginx (both configs set them, dev has no CSP/HSTS) |
| `routes/route-mounting.test.ts` | Mounted routers over HTTP: public paths reachable without a token, the admin gate does not swallow later routers, admin paths still require auth |
| `routes/friends.test.ts` | Friends list (incoming/outgoing/blocked), blocked users, search, middleware checks |
| `routes/health.test.ts` | 200 with buildId/timestamp, 503 on DB/Redis failure without leaking details, failed dependency logged, silent healthy path |
| `routes/lobby.test.ts` | Room list, no POST route (rooms are created over the socket), auth + email-verified middleware |

### Socket Handlers

Socket.io event handler tests — handlers tested with mock socket/io objects and captured callback invocations. `socket.ts` itself is guarded by AST scans (`socket-audit-fixes`, `socket-await-guard`).

| File | Coverage |
|------|----------|
| `handlers/partyHandlers.test.ts` | Party lifecycle (create/invite/accept/leave/kick/chat), room invites, disconnect cleanup, multi-tab membership + party:sync |
| `handlers/friendHandlers.test.ts` | All 8 friend:* events (internal errors masked), notifyFriendsOnline/Offline, limiter cleanup |
| `handlers/dmHandlers.test.ts` | dm:send (mode/role checks, validation, dm:receive emission, always acks incl. failed lookup and rate limit), dm:read (mark read, read receipt) |
| `handlers/socket-audit-fixes.test.ts` | AST guards on `socket.ts`: admin:kick leaves immediately, per-user campaign:levelComplete, guest name sanitising, sim runner cleanup, rate limits on lobby/admin events, limiter cleanup on disconnect, no dynamic import() |
| `handlers/lobbyHandlers.test.ts` | lobby:chat mode enforcement (disabled/admin_only/staff), message truncation, empty/non-string messages dropped |
| `handlers/socket-await-guard.test.ts` | AST scan of `socket.ts` + `handlers/`: no `await` outside a `try` in any socket.on handler, connection listeners registered synchronously |

### Middleware

| File | Coverage |
|------|----------|
| `middleware/errorHandler.test.ts` | AppError default codes derived from the status (incl. 409/429/500), log level by status (4xx kept out of error/warn), body-parser faults (400 INVALID_JSON, 413), multer upload errors (413/400, not 500), no library-internal messages echoed, opaque 500s, headers-sent handoff |
| `middleware/auth-and-admin.test.ts` | JWT verification with token-type check, staff/admin-only role read from the DB (not the JWT claim), deactivated accounts refused, one role lookup per request |
| `middleware/emailVerified.test.ts` | 401/403/500 paths, DB query verification, next() never called on error, the token's emailVerified claim skips the DB (legacy tokens fall back) |
| `middleware/rateLimiter.test.ts` | Redis-backed rate limiting (atomic Lua, 429 + Retry-After), in-memory fallback, keys per IP and per route pattern (all ids of a parameterised route such as `/admin/replays/:matchId` share one budget) |
| `middleware/locale.test.ts` | x-language priority, accept-language fallback, base language extraction, default 'en' |
| `middleware/validation.test.ts` | Zod validation of body/query/params, parsed output replaces the input (extra fields stripped), field-level error details, non-Zod errors forwarded |
| `middleware/bodyParserErrors.test.ts` | Real Express stack: malformed JSON → 400 INVALID_JSON (body not reflected), corrupt gzip → 4xx, oversized → 413, unsupported charset → 415 |

### Database

Migration tooling — the SQL statement splitter and the migration files themselves, checked without a database, and the runner's advisory lock against a real MariaDB. `migrationLock.test.ts` is the only backend suite that is not mocked: it runs when `REQUIRE_DB_TESTS=1` (CI and fleet set it, with a MariaDB service and the `DB_*` settings) and is skipped otherwise.

| File | Coverage |
|------|----------|
| `db/sqlStatementParser.test.ts` | parseSqlStatements: comments (`--`, `#`, block, version-gated), quoting and escapes, statement splitting; plus one parse check per repository migration file (up and down) |
| `db/migrationParity.test.ts` | Every up migration has a down file and vice versa, numbering unique and gap-free from 001, no empty files, up/down symmetry for 030 (re-applicable after rollback), 040 and 041; 046 drops only the index 035 added, which 008's composite index covers; from 042 on every schema change, up and down, is guarded with `IF [NOT] EXISTS` so an interrupted migration can run again |
| `db/migrationRunner.test.ts` | rollbackMigration refuses to roll back the irreversible email migration without force |
| `db/migrationLock.test.ts` | Two concurrent runMigrations() calls apply each (throwaway, non-idempotent) migration exactly once; a run waits while another session holds the lock; the lock is released before its connection goes back to the pool |

### Simulation

| File | Coverage |
|------|----------|
| `simulation/SimulationManager.test.ts` | Batch lifecycle, queue management (max 10), sim:admin broadcast wiring, getHistory pagination + ordering, cached async disk scan, batch results/replays/deletion, finished-runner cleanup |
| `simulation/SimulationRunner.test.ts` | Game (and AI isolate) disposal after normal completion, a runFast throw, a mid-batch failure, and realtime batches |

### Utilities & Shared

Backend utilities, config guards (nginx, Compose, Node version) and the shared-package tests. `shared/` rows are `tests/backend/shared/`; `../shared/` rows are the top-level `tests/shared/`, which the backend Jest config also runs.

| File | Coverage |
|------|----------|
| `../shared/localeParity.test.ts` | Every non-en locale (11 languages × 11 namespaces across shared/backend/frontend) has exactly en's keys (language-specific plural forms allowed) and keeps every `{{placeholder}}` |
| `../shared/puzzle.test.ts` | All switch/gate helpers (4 colors): tile checks, active/open state, color extraction, tile construction; constants |
| `utils/guestGate.test.ts` | Guest socket packet gate: openworld:* allowed, 17 other events blocked (ack still answered), malformed packets blocked, allowlist matches `socket.ts`; guestPacketLabel truncation |
| `utils/nginxHeaders.test.ts` | Parses prod + dev nginx configs: every location includes the security headers, no duplicate Content-Type on `return`, error_page 502 paired with 429; prod enforces Trusted Types, dev has no CSP/HSTS |
| `shared/xp.test.ts` | XP calculation, level-from-XP math, level-for-XP inverse, placement bonuses, multiplier |
| `../shared/mapValidation.test.ts` | Dimension limits, odd enforcement, tile validity, border walls, spawn counts, spawnPoints vs spawn tiles, teleporter pairing, switch/gate pairing |
| `utils/gameLogger.test.ts` | Idle gating of empty-room tick logs, verbosity mapping, pruneOldLogs (age/size limits, logs with real players protected, throttled), peak-player filename on close |
| `utils/crypto.test.ts` | Password hashing/comparison, token generation/hashing, scrubEmailError (addresses removed, message capped) |
| `utils/socketRateLimit.test.ts` | Per-socket sliding window (1s reset, stale-entry cleanup), createRateLimiters presets (input 30/s, create 2/s, join 5/s), removeSocket |
| `utils/guestUsername.test.ts` | sanitizeGuestUsername (strips/trims/caps, result always USERNAME_REGEX-valid), adminSpectateSchema room-code shape |
| `../shared/validation.test.ts` | Username, password, email validation rules |
| `../shared/artStyles.test.ts` | Art style ids: Classic is the built-in default, isArtStyleId accepts the listed styles only |
| `utils/composeIsolation.test.ts` | Dev compose stack cannot adopt prod: no shared container names, host ports or data mounts, overrides instead of appends, own project name, documented dev command always passes `-p` |
| `utils/replayPrune.test.ts` | pruneOldReplays: age/size limits oldest-first, campaign replays never auto-deleted, fresh files kept, throttled, missing directory tolerated |
| `utils/totpKeyValidation.test.ts` | isValidTotpKey requires exactly 64 hex chars; TOTP secret encryption round-trips, rejects invalid keys, cannot decrypt with another key |
| `utils/nodeVersion.test.ts` | Same Node major across Docker stages, package.json engines, .nvmrc and the AI bundle target |

### Frontend

All frontend tests run on Vitest + jsdom. Paths are relative to `frontend/`.

| File | Coverage |
|------|----------|
| `tests/utils/colors.test.ts` | toCssHex (number/string → #rrggbb, malformed or out-of-range → null), safeCssColor strict-hex fallback, contrastText picks black or white text for a rank colour |
| `tests/utils/html.test.ts` | escapeHtml, escapeAttr — XSS prevention |
| `tests/utils/trapFocus.test.ts` | Arrow-key focus movement (text fields and radios keep their arrows), Tab wrap, cleanup; createModal gamepad context push/pop, Back closes, confirmModal result; focus returns to the opener on close (never taken from an element outside the modal) |
| `tests/ui/hudPlayerList.test.ts` | HUD player list: keyed DOM reuse (no writes when unchanged), alive-first order, click-to-spectate only while dead, team headers, live KOTH reorder + crown icon, username escaping, bot/buddy tags, colour-blind shape markers, reset() |
| `tests/utils/wrapGhosts.test.ts` | wrapGhostOffsets/wrapGhostPositions: ghost copies only near the seams (edges, corners, margin), at most 3 copies, degenerate and oversized worlds |
| `tests/art/painters.test.ts` | Every drawn-style painter (Toy, Neon, Pixel) over every world, tile, character, bomb, flame, pickup and effect draws something without throwing, against a fake 2D context; deterministic output; sane frame counts and palettes |
| `tests/shared/grid.test.ts` | manhattanDistance, getExplosionCells (range, walls, bounds, first destructible stops the blast, pierce, cracked walls) |
| `tests/utils/tileTexture.test.ts` | themePrefix, getTileTexture (themed/unthemed keys, classic = no theme, floor variation, unknown-tile fallback), conveyor helpers |
| `tests/game/gameClientFixes.test.ts` | PowerUpRenderer kills its float tween, LocalCoopInput releases keys on blur, GamepadManager.suppressHeldButtons, ReplayPlayer.seekToTick by game tick, campaign run helpers (P2 socket token, guest P2) |
| `tests/game/Settings.test.ts` | getSettings defaults (graphics quality by pointer type, reduced motion, sharp rendering, colour-blind)/merge/invalid-JSON or array fallback/caching, saveSettings persists and updates the cache |
| `tests/game/replayLogIndex.test.ts` | lowerBound/upperBound, findTickRange (range + scroll anchor, agrees with a linear scan), stable sortByTick |
| `tests/utils/wrapGhostTileSpans.test.ts` | Ghost tile spans for the wrapping map: only past a seam (never the canonical copy), corner copies, clamped to grid and screen, stable layout key |
| `tests/network/apiClient.test.ts` | ApiError code/status + validation details, 401 handling (guest not logged out, one retry after refresh, logout when refresh fails, wrong-password 401 not retried), authenticated download |
| `tests/utils/reconcileChildren.test.ts` | Keyed DOM reorder without recreating nodes: append, no-op, removal, adoption, node state preserved, arbitrary permutations |
| `tests/network/socketClientConnect.test.ts` | connect/connectAsGuest open exactly one socket while one is in flight, replace stale sockets, no token → no connect, disconnect then connect opens a fresh socket |
| `tests/ui/lobbyNavigation.test.ts` | No /user/rank request for guests, navigation token discards superseded views, destroyed views stop writing to `.main-body` (ChallengeView, OpenWorldView), each view renders into its own root (late renders and container listeners go with it), on a phone the sidebar drawer starts closed and closes after a pick |
| `tests/ui/adminTabContracts.test.ts` | Dashboard, Users, Rooms, Matches, Announcements, Achievements/cosmetics, Campaign and Simulations tabs render fixtures shaped like their backend handlers' responses, with no error |
| `tests/game/spriteInterpolation.test.ts` | Enemies move per rendered frame at a frame-rate-independent speed, HP bar follows and redraws only on HP change; enemies and players jump (not slide) when the target moves further than a step, never while walking fast; short way over the open-world seam; Classic spawn-protection flicker; a player's look is kept through a knockout |
| `tests/scenes/replayAndSpectatorExits.test.ts` | Closing a replay reopens its admin tab/view, leaving a spectated simulation sends sim:unspectate and reopens the batch, replay deaths (with cause) feed the HUD kill feed, a seek clears it, listeners removed on shutdown |
| `tests/ui/adminTabs.test.ts` | ChallengesTab ({ maps } shape, load error, aria-checked revert on failed save), SeasonsTab paging + unsaved tier edits, LogsTab single listener, AITab authenticated download |
| `tests/ui/partyState.test.ts` | PartyBar fetches the current party on build and after reconnect, PartyView follows the bar (create/leave sync both ways), no disband toast for the leaver |
| `tests/game/styledTileMap.test.ts` | Drawn-style tile map: floor frames carry the shadows of W/N/NW blocks, wall frames connect to neighbours, tile diffs destroy (reported, shadows cleared), crack in place and drop in crates, blocks y-sort, animated hazards stay on the ground, gates switch between block and ground |
| `tests/art/artStyleManager.test.ts` | Art style resolution: Classic until the admin default arrives, the player's own pick wins, unknown values ignored, fetch failure keeps Classic, picks stored and cleared, admin broadcasts only reach players without a pick, ready() times out |
| `tests/ui/authResetMode.test.ts` | Password-reset form: token + password posted with skipAuthRetry, Enter submits, local validation, rejected/missing token offers a new link |
| `tests/ui/i18nPlurals.test.ts` | Plural keys with real i18next (en/de, Polish few/many), 61x61 map size gone, AuthUI translates server error codes (message fallback), form links are buttons |
| `tests/game/minimapTerrain.test.ts` | minimapTileColor fallback, MinimapTerrain paints once then repaints only changed cells (applyDiffs/sync), no grid aliasing, ragged grids tolerated |
| `tests/utils/sanitizerFidelity.test.ts` | setHtml builds the same DOM as the innerHTML it replaced for every HTML literal in `src/` (table fragments, CSS custom properties), still strips what it should |
| `tests/network/socketClientReconnect.test.ts` | Handshake sends the current access token, refreshes an expired one and reconnects (not after a failed refresh), onReconnect fires only after the first connect |
| `tests/game/tileMapApplyDiffs.test.ts` | TileMapRenderer.applyTileDiffs swaps only listed cells, ignores no-op/out-of-grid diffs, matches updateTiles(), idempotent, consistent with a later full sync |
| `tests/ui/viewListenerLifecycle.test.ts` | MapsView/MessagesView/FriendsView/embedded LeaderboardUI keep one handler across re-renders and none after destroy; in-app confirm modals for delete/block |
| `tests/art/explosionPieces.test.ts` | Flame pieces from the server's cell order (centre, arms, end caps, range 1, pierce gaps, wrapping maps); fuse fraction and frame helpers |
| `tests/ui/adminReturn.test.ts` | Matches/Campaign/Simulations tabs reopen the page, replay list or batch a replay came from (once); Watch replay closes its modal and pops its gamepad context; AdminUI hands the view to the tab |
| `tests/utils/trustedTypesEnforcement.test.ts` | Under enforced Trusted Types: raw assignment throws, setHtml/insertHtml insert every HTML literal without touching a sink, HUD player list renders, escapeHtml still works |
| `tests/game/enemySpriteDying.test.ts` | Enemy death tween starts once per enemy, tracked per enemy, guard cleared on removal/destroy; bosses drawn at their size multiplier (kept when they turn); ghost-bodied enemies translucent |
| `tests/art/depthAndScale.test.ts` | Depth bands keep Classic's draw order and y-sort the drawn styles between it and the labels; setDepth only on change; texture bake scale bookkeeping |
| `tests/art/hidpi.test.ts` | Render ratio from the screen density (capped at 2), 1 with Sharp rendering off or at Low quality, `?dpr=` override; canvas sized in device pixels; UI cameras lay out in CSS pixels |
| `tests/ui/localCoopTotp.test.ts` | LocalCoopModal 2FA: code step after the challenge, wrong code/expired challenge handling, 6-digit check before any request, one gamepad context |
| `tests/scenes/sceneListenerLifecycle.test.ts` | AST scan of `src/scenes`: no blanket socketClient.off(event), every socket subscription unsubscribed, shutdown registered explicitly |
| `tests/game/playerPalette.test.ts` | Standard colours unchanged; colour-blind player and team colours follow the setting (teams never share a colour); index wrapping; eight marker shapes traced as closed paths |
| `tests/network/authRefresh.test.ts` | AuthManager.refresh shares one request between concurrent callers, starts fresh afterwards, runs inside a Web Lock across tabs |
| `tests/ui/lobbyPanels.test.ts` | Panel handlers registered once across room↔lobby cycles, one toast per party invite, idempotent destroyPanels() |
| `tests/ui/profileAddFriend.test.ts` | ProfileView Add Friend over the socket (success, retry after failure), hostile rank colour/achievement icon kept out of the markup |
| `tests/scenes/openWorldMapResize.test.ts` | A new open-world round with a different map size rebuilds the tile renderer and wrap sizes; the same size keeps the renderer |
| `tests/scenes/landingCamera.test.ts` | Behind the landing title the camera keeps the background guest a quarter screen above the centre; centred once the landing docks |
| `tests/ui/roomSettingsPanel.test.ts` | The waiting room's Room Settings name a custom map instead of the generator's size and wall density |
| `tests/game/soundNoise.test.ts` | Noise bursts share one cached buffer and each plays a random slice as long as the burst |
| `tests/game/explosionEmitters.test.ts` | Classic explosion particle emitters are counted down once, also when the explosion ends before an emitter's own timer |
| `tests/game/splitScreenOverlay.test.ts` | Split-screen divider per mode, partner arrows shown only when placed, overlay removed on destroy |

## Mocking Patterns

### 1. Database Mocking

All service tests mock the database connection module. Mocks must be declared **before** importing the module under test (Jest hoists `jest.mock()` calls but the mock factory runs at import time).

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();

jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: jest.fn<AnyFn>((fn: any) => fn({ query: mockQuery, execute: mockExecute })),
}));

// NOW import the service under test
import { someFunction } from '../../../backend/src/services/someService';

beforeEach(() => {
  jest.clearAllMocks();
});

it('queries the database', async () => {
  mockQuery.mockResolvedValueOnce([{ id: 1, name: 'test' }]);
  const result = await someFunction();
  expect(mockQuery).toHaveBeenCalledWith('SELECT ...', [expectedArgs]);
  expect(result).toEqual({ id: 1, name: 'test' });
});
```

### 2. Redis Mocking

Services that use Redis (lobby, presence, party) use an in-memory `Map` to simulate Redis operations:

```typescript
const store = new Map<string, string>();
const mockRedis = {
  get: jest.fn<AnyFn>((key: string) => Promise.resolve(store.get(key) || null)),
  set: jest.fn<AnyFn>((...args: unknown[]) => {
    store.set(args[0] as string, args[1] as string);
    return Promise.resolve('OK');
  }),
  del: jest.fn<AnyFn>((key: string) => { store.delete(key); return Promise.resolve(1); }),
  scan: jest.fn<AnyFn>((_cursor, _matchKw, pattern) => {
    const prefix = pattern.replace('*', '');
    const matched = [...store.keys()].filter(k => k.startsWith(prefix));
    return Promise.resolve(['0', matched]);
  }),
  mget: jest.fn<AnyFn>((...keys: string[]) =>
    Promise.resolve(keys.map(k => store.get(k) || null))
  ),
  eval: jest.fn<AnyFn>(),
};

jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: () => mockRedis,
}));
```

### 3. Service Mocking (for Route Tests)

Route tests mock entire service modules to isolate HTTP handler logic:

```typescript
const mockCreateRoom = jest.fn<AnyFn>();
const mockListRooms = jest.fn<AnyFn>();

jest.mock('../../../backend/src/services/lobby', () => ({
  createRoom: mockCreateRoom,
  listRooms: mockListRooms,
}));
```

### 4. Middleware Pass-Through

Route tests skip auth/validation to test handler logic in isolation:

```typescript
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => {
    _req.user = { userId: 1, username: 'testuser', role: 'admin' };
    next();
  }),
}));

jest.mock('../../../backend/src/middleware/admin', () => ({
  staffMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
  adminOnlyMiddleware: jest.fn((_req: any, _res: any, next: any) => next()),
}));
```

### 5. Route Handler Extraction

Route tests extract Express handlers from the router stack rather than using supertest. The few suites that need the mounted app (`routes/route-mounting`, `routes/notFound`, `middleware/bodyParserErrors`) instead start a real `http` server on an ephemeral port and call it with `fetch`.

```typescript
import router from '../../../backend/src/routes/lobby';

// Extract the handler for a specific route
function findHandler(method: string, path: string) {
  for (const layer of (router as any).stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      const handlers = layer.route.stack.map((s: any) => s.handle);
      return handlers[handlers.length - 1]; // last handler (after middleware)
    }
  }
  throw new Error(`Handler not found: ${method} ${path}`);
}

// Create mock request/response
function mockReqRes(body = {}, params = {}, query = {}) {
  const req: any = { body, params, query, user: { userId: 1 } };
  const res: any = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}
```

### 6. Socket Handler Mocking

Socket handler tests use mock socket/io objects with handler capture via `socket.on()`:

```typescript
function createMockSocket(overrides: Record<string, unknown> = {}) {
  const handlers: Record<string, AnyFn> = {};
  return {
    id: 'socket-1',
    data: { userId: 1, username: 'testuser', role: 'user', ...overrides },
    on: jest.fn((event: string, handler: AnyFn) => { handlers[event] = handler; }),
    join: jest.fn(),
    leave: jest.fn(),
    _handlers: handlers,  // access captured handlers for direct invocation
  };
}

function createMockIO() {
  const emitFn = jest.fn();
  return {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: emitFn }),
    in: jest.fn().mockReturnValue({ fetchSockets: jest.fn().mockResolvedValue([]) }),
    _emitFn: emitFn,
  };
}

// Register handlers, then invoke directly:
registerHandlers(io as any, socket as any);
await socket._handlers['event:name'](data, callback);
```

## Writing New Tests

### File Naming
Place tests in the matching category directory:
```
tests/backend/services/myNewService.test.ts
tests/backend/routes/myNewRoute.test.ts
tests/backend/handlers/myNewHandler.test.ts
tests/backend/game/MyNewGameFeature.test.ts
```

### Template for a Service Test

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// 1. Declare mocks BEFORE imports
const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();

jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

// 2. Mock any other dependencies
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// 3. Import the module under test AFTER mocks
import { myFunction } from '../../../backend/src/services/myService';

// 4. Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});

describe('myFunction', () => {
  it('returns expected result', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1 }]);
    const result = await myFunction(1);
    expect(result).toEqual({ id: 1 });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('throws on not found', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(myFunction(999)).rejects.toThrow('Not found');
  });
});
```

### Template for a Route Test

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock services
const mockGetItems = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/myService', () => ({
  getItems: mockGetItems,
}));

// Pass-through middleware
jest.mock('../../../backend/src/middleware/auth', () => ({
  authMiddleware: jest.fn((_req: any, _res: any, next: any) => {
    _req.user = { userId: 1, username: 'test', role: 'user' };
    next();
  }),
}));

import router from '../../../backend/src/routes/myRoute';

// Helper to extract handler and create mock req/res
// ... (see Route Handler Extraction pattern above)

beforeEach(() => jest.clearAllMocks());

describe('GET /my-route', () => {
  it('returns items', async () => {
    mockGetItems.mockResolvedValueOnce([{ id: 1 }]);
    const { req, res, next } = mockReqRes();
    await findHandler('get', '/my-route')(req, res, next);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 1 }] });
  });
});
```

### Game Logic Tests

Game tests typically instantiate real `GameStateManager` objects rather than mocking. Inputs go through the manager's `inputBuffer`, exactly as socket input does, and `processTick()` advances one tick:

```typescript
import { it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import type { Direction, PlayerInput } from '@blast-arena/shared';

// Small, predictable map: no random walls, no random power-up drops
const BASE_CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 12345,
  gameMode: 'ffa' as const,
  wallDensity: 0.0,
  powerUpDropRate: 0,
};

let seq = 0;
function moveInput(direction: Direction): PlayerInput {
  return { direction, action: null, tick: 0, seq: ++seq };
}

it('player moves correctly', () => {
  const gs = new GameStateManager(BASE_CONFIG);
  const player = gs.addPlayer(1, 'Alice', null);
  gs.addPlayer(2, 'Bob', null); // a lone player would win on the first tick
  gs.status = 'playing'; // no GameLoop here, so skip the countdown by hand

  player.position = { x: 1, y: 1 };
  player.moveCooldown = 0;
  gs.inputBuffer.addInput(1, moveInput('right'));
  gs.processTick();

  expect(player.position).toEqual({ x: 2, y: 1 });
});
```

## Frontend Testing

Frontend tests use Vitest with `jsdom` for DOM APIs. They come in four kinds:

- **Pure functions** (HTML escaping, colors, grid math, wrap ghosts, replay index): plain imports, no mocking.
- **UI and view tests** render real views, modals and HUD pieces into jsdom's `document`. They `vi.mock` the modules around the view (typically `i18n`, `UIGamepadNavigator` and `ApiClient`) and pass small fakes for the `SocketClient`/`AuthManager` dependencies.
- **Renderer and scene tests** drive the real renderer classes (and `GameScene`) against `tests/helpers/fakeScene.ts` (`makeFakeScene()`), a minimal stand-in for the parts of `Phaser.Scene` they touch, with `vi.mock('phaser', ...)` so Phaser itself never boots. Fake sprites record their frame, depth, tint and the animation they play; `time.delayedCall` runs at once (replace it on the scene to hold timers back), and `add.particles` returns a fake emitter that counts `explode()` and records `destroy()`.
- **Art style painters** run against a Proxy that accepts any Canvas 2D call (`tests/art/painters.test.ts`); jsdom has no 2D canvas, so `getContext` is mocked to null and the painters' sprite caches draw directly. They check that every painter draws without errors and deterministically; the look itself is checked by eye.
- **Source scans** parse `src/` with the TypeScript compiler API: `sceneListenerLifecycle` checks socket listener cleanup in every scene, and `sanitizerFidelity`/`trustedTypesEnforcement` share the HTML-literal corpus from `tests/helpers/htmlLiterals.ts`.

```typescript
import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../../src/utils/html';

describe('escapeHtml', () => {
  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
});
```

For modules with module-level state (like `Settings`, which caches what it read from `localStorage`), reset the module registry and re-import in `beforeEach`:

```typescript
import { it, expect, vi, beforeEach } from 'vitest';

let getSettings: typeof import('../../src/game/Settings').getSettings;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  ({ getSettings } = await import('../../src/game/Settings'));
});

it('returns defaults when localStorage is empty', () => {
  expect(getSettings().animations).toBe(true);
});
```
