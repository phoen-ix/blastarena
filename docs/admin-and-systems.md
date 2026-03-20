# Admin Panel & Systems

## Admin Panel

Full-screen panel accessible from lobby header (Admin button visible for admin and moderator roles).

### Tab Navigation & Permissions

| Tab | Access | Features |
|-----|--------|----------|
| Dashboard | Admin | 5 stat cards (users, active 24h, matches, rooms, online) with 30s auto-refresh. Server Settings: recordings toggle, email/SMTP config, game defaults, simulation defaults |
| Users | Admin + Mod | Search, paginated table, role change, deactivate/reactivate, delete (type-to-confirm), create user, password reset |
| Matches | Admin + Mod | Paginated history, per-player stats modal. Admin delete per row / delete all (cleans up replay files) |
| Rooms | Admin + Mod | Active rooms with 5s refresh, spectate, send message, kick player, force close (admin only) |
| Logs | Admin | Audit trail of all admin actions with action type filter |
| Simulations | Admin | Batch bot-only game simulations (see below) |
| AI | Admin | Upload/manage custom bot AI implementations (see below) |
| Campaign | Admin | Create/edit worlds, levels (visual editor), and enemy types |
| Announcements | Admin + Mod | Toast broadcast (ephemeral) + persistent lobby banner (admin only) |

### Backend Details

- `staffMiddleware` (admin+moderator) and `adminOnlyMiddleware` (admin only) for route protection
- `backend/src/game/registry.ts` — singleton for RoomManager/IO access from admin service
- Admin socket events: `admin:kick`, `admin:closeRoom`, `admin:spectate`, `admin:roomMessage`, `admin:toast`, `admin:banner`, `admin:kicked`
- All admin actions logged to `admin_actions` table for audit. `target_id` is `INT NOT NULL` — use `0` for bulk operations without a specific target
- Deactivated users blocked from login and token refresh
- Self-protection: admins cannot deactivate/delete themselves
- Public endpoint `GET /admin/announcements/banner` (no auth)
- Public endpoint `GET /admin/settings/recordings_enabled` (no auth)
- Admin-only `PUT /admin/settings/recordings_enabled` — updates DB, logs to audit, broadcasts `admin:settingsChanged`
- Match deletion: `DELETE /admin/matches/:id` and `DELETE /admin/matches` — deletes DB records (cascades to match_players) + replay files from disk; both audit-logged

### Server Settings

`server_settings` table: key-value store for server-wide settings. `backend/src/services/settings.ts` provides `getSetting()`, `setSetting()`, `isRecordingEnabled()`, `getGameDefaults()`, `setGameDefaults()`, `getSimulationDefaults()`, `setSimulationDefaults()`, `getEmailSettings()`, `setEmailSettings()`.

**Admin-configurable defaults**: `game_defaults` and `simulation_defaults` stored as JSON blobs. Public `GET /admin/settings/game_defaults`; staff `GET /admin/settings/simulation_defaults`; admin-only PUT for both. Zod-validated with all fields optional — empty `{}` means "use hardcoded defaults". `GameDefaults` and `SimulationDefaults` types in `shared/src/types/settings.ts`.

**Email / SMTP settings**: `email_settings` stored as JSON in `server_settings`. `.env` values serve as fallback defaults; DB values take precedence once saved. Admin-only GET/PUT at `/admin/settings/email_settings`. Password masked in GET responses (`••••••••`); PUT preserves existing password if masked value sent, clears if empty string. `invalidateTransporter()` resets the cached nodemailer transporter on save so new settings take effect immediately. Test email endpoint: `POST /admin/settings/email_settings/test` with `{ to }`. `EmailSettings` type in `shared/src/types/settings.ts`.

---

## Bot AI Management

Admin-only system for managing multiple bot AI implementations.

### Overview
- **AI Tab** in admin panel: list all AIs, upload new ones, activate/deactivate, download source, re-upload, delete (type-name confirmation)
- **Built-in AI**: Default BotAI listed as non-deletable entry (id `'builtin'`); can be deactivated but not deleted/re-uploaded

### Upload Pipeline
Admin uploads `.ts` file -> esbuild transpiles to `.js` -> structure validation (must export class with `generateInput` method) -> dangerous import scan (blocks `fs`, `child_process`, `net`, etc.) -> stored in `data/ai/{uuid}/source.ts` + `compiled.js`

### Key Components
- **IBotAI interface**: `backend/src/game/BotAI.ts` exports `IBotAI` with `generateInput(player, state, logger?): PlayerInput | null`. Constructor signature: `(difficulty: 'easy' | 'normal' | 'hard', mapSize?: { width, height })`
- **BotAIRegistry** (`backend/src/services/botai-registry.ts`): Singleton managing loaded AI constructors; `createInstance(aiId, difficulty, mapSize)` factory with built-in fallback; initialized at server startup
- **BotAI Compiler** (`backend/src/services/botai-compiler.ts`): esbuild transpilation + validation; checks file size (500KB max), dangerous imports, compilation, structure, instantiation
- **CRUD Service** (`backend/src/services/botai.ts`): `listAllAIs()`, `listActiveAIs()`, `uploadAI()`, `updateAI()`, `reuploadAI()`, `deleteAI()`, `downloadSource()`

### Runtime Safety
`GameStateManager.processTick()` wraps `generateInput()` in try/catch; on crash, replaces bot's AI with built-in fallback.

### Per-Room Selection
`botAiId` field in `MatchConfig`, `SimulationConfig`, `GameDefaults`, `SimulationDefaults`. When multiple AIs are active, a "Bot AI" dropdown appears in CreateRoomModal and SimulationsTab config modal.

### Storage & Database
- Files: `./data/ai/{uuid}/source.ts` + `compiled.js`; Docker volume `./data/ai:/app/ai`
- Database: `bot_ais` table (migration `007_bot_ais.sql`) with FK to `users`; `BotAIEntry` type in `shared/src/types/botai.ts`
- Dependencies: `esbuild` (TypeScript transpiler), `multer` (file upload)

### API Endpoints
- Public: `GET /admin/ai/active`
- Admin: `GET /admin/ai`, `POST /admin/ai` (multipart), `PUT /admin/ai/:id`, `PUT /admin/ai/:id/upload` (multipart), `GET /admin/ai/:id/download`, `DELETE /admin/ai/:id`

### Developer Guide
See [bot-ai-guide.md](bot-ai-guide.md) for the full API reference and examples.

---

## Bot Simulation System

Admin-only batch simulation runner for bot-only games — no human players, no DB records.

### Configuration
- **SimulationsTab** in admin panel: game mode, bot count/difficulty, map size, round time, total games (1-1000), speed, log verbosity, all power-up/map options
- **Two speed modes**: Fast (ticks via `setImmediate` batching, ~100 ticks/yield) and Real-time (20 tps with live spectating)
- **Log verbosity**: Normal (5-tick snapshots), Detailed (2-tick + movements/pickups), Full (every tick + pathfinding)

### Live Spectating
- Real-time mode auto-launches GameScene in spectator mode with click-to-follow and mouse drag panning
- Fast mode streams state at ~20fps via capped interval
- GameScene handles `sim:state` events for rendering, `sim:gameTransition` for between-game restarts, `sim:completed` for returning to lobby

### Queue System
When a batch is already running, new batches are queued (max 10) and auto-start when current finishes. Cancelling advances the queue. Queued entries show position in UI with "Remove" button. Admin sockets auto-join `sim:admin` room for queue-started batch broadcasts.

### Backend Components
- `SimulationGame.ts` — headless single-game runner
- `SimulationRunner.ts` — batch orchestrator (EventEmitter)
- `SimulationManager.ts` — singleton, 1 concurrent + queue up to 10

### Replays
Each sim game records a full replay via `ReplayRecorder` (when `recordReplays !== false`), saved as `{gameIndex}_{roomCode}_{gameMode}.replay.json.gz` in the batch directory. Results table has "Replay" button per game.

### Log Structure
`data/simulations/{gameMode}/batch_{timestamp}_{batchId}/` with per-game `sim_NNN.jsonl` files, replay files, `batch_config.json`, `batch_summary.json`.

### Socket Events
- **C->S**: `sim:start`, `sim:cancel`, `sim:spectate`, `sim:unspectate`
- **S->C**: `sim:progress`, `sim:gameResult`, `sim:state`, `sim:gameTransition`, `sim:completed`, `sim:queueUpdate`

### REST Endpoints
`GET/POST /admin/simulations`, `GET/DELETE /admin/simulations/:batchId`, `GET /admin/simulations/:batchId/replay/:gameIndex`

### Other Details
- Bot names pool: AlphaBot through PulseBot (16 distinct names)
- Cancellation preserves completed game logs; 3s pause between realtime games, 0.5s for fast
- Delete batch: removes from memory + disk including replay files
- Spectate button hidden for fast-speed batches
- Results table: paginated (25/page) with sortable columns
- Docker: `./data/simulations:/app/simulations` volume mount

---

## Account Management

### Account Modal
Users manage their account from the lobby Account modal:
- **Username**: Single player name shown everywhere. Validated (3-20 chars, alphanumeric + underscore/hyphen), uniqueness-checked (409 if taken)
- **Email**: Two-step confirmation flow — submit new address, click link sent to new email (24h expiry). Admins skip verification. Pending changes visible in modal with cancel option
- **Password**: Requires current password verification. Zod validation enforces min/max length; client confirms match
- `AuthManager.updateUser()` patches in-memory user state after edits (lobby header updates without refresh)

### Email Change
- Endpoint: `GET /api/user/confirm-email/:token`
- Migration `003_user_profile.sql` adds `pending_email`, `email_change_token`, `email_change_expires` columns

### Password Change
`POST /api/user/password` with `currentPassword` and `newPassword`; bcrypt compare before updating.

### Admin Password Reset
`PUT /admin/users/:id/password` (admin-only) — sets new password, revokes all refresh tokens (forces re-login), audit-logged as `reset_password`. Frontend: "Reset PW" button with new password + confirm fields (min 6 chars).

### Forgot Password
`POST /api/auth/forgot-password` sends reset link (rate limited: 3/15min); response intentionally vague ("If the email exists...") to prevent enumeration. `POST /api/auth/reset-password` accepts token + new password. Tokens stored in `users.password_reset_token`/`users.password_reset_expires`. AuthUI `forgot` mode: email input -> POST -> returns to login with success message.
