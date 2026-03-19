# BlastArena

A multiplayer online grid-based explosive arena game built with Phaser.js and Node.js. Navigate a destructible grid, place bombs strategically, collect power-ups, and compete across six distinct game modes. Supports 2-8 players with AI bots, real-time spectating, team play, and full admin tools.

## Quick Start

```bash
# Clone and configure
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and DB_PASSWORD

# Development (hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Production
docker compose up --build -d
```

Open `http://localhost:8080` (or your configured `APP_EXTERNAL_PORT`).

## Game Modes

| Mode | Players | Duration | Description |
|------|---------|----------|-------------|
| **Free for All** | 2-8 | 3 min | Last player standing wins |
| **Teams** | 4-8 | 4 min | Two teams — last team standing. Friendly fire configurable |
| **Battle Royale** | 4-8 | 5 min | Circular danger zone shrinks inward, damaging players outside |
| **Sudden Death** | 2-8 | 2 min | Everyone starts fully powered (8 bombs, 8 range, max speed, kick). No power-ups spawn. One hit kills |
| **Deathmatch** | 2-8 | 5 min | Respawn 3s after death with reset stats. First to 10 kills or most kills when time runs out |
| **King of the Hill** | 2-8 | 4 min | Stand in the 3x3 center zone to score. First to 100 points wins. Zone highlighted with pulsing overlay; HUD shows live scores |

## Controls

### Keyboard

| Key | Action |
|-----|--------|
| `WASD` / `Arrow Keys` | Move |
| `Space` | Place bomb |
| `E` | Detonate remote bombs |
| `1`-`9` | Spectate Nth player (when dead) |

### Gamepad (Xbox / Standard)

| Input | Action |
|-------|--------|
| D-Pad / Left Stick | Move |
| A | Place bomb |
| B | Detonate remote bombs |
| LB / RB | Cycle spectate target (when dead) |

### Other

- **Walk into a bomb** (with Kick power-up): Sends it sliding until it hits an obstacle
- **Click a player name in the HUD** (when dead): Follow that player as spectator

## Power-Ups

Power-ups drop when destructible walls are destroyed. Walk over the floating tile to collect.

| Icon | Name | Effect | Rarity |
|------|------|--------|--------|
| 💣 | **Bomb Up** | +1 max bombs (up to 8) | Common |
| 🔥 | **Fire Up** | +1 explosion range (up to 8) | Common |
| ⚡ | **Speed Up** | Faster movement (up to 2 levels) | Common |
| 🛡️ | **Shield** | Absorbs one explosion hit. No time limit, doesn't stack | Uncommon |
| 👢 | **Kick** | Walk into bombs to kick them across the map | Rare |
| 💥 | **Pierce Bomb** | Explosions pass through destructible walls (still destroys them) | Rare |
| 📡 | **Remote Bomb** | Bombs don't auto-detonate. Press `E` to detonate all at once (10s safety max) | Rare |
| 🧨 | **Line Bomb** | Places a line of bombs in your facing direction (uses remaining bomb capacity) | Rare |

The same emoji icons appear on both the in-game power-up tiles and the HUD stats bar for consistency.

## Map Features

All optional — toggled per-room when creating:

- **Reinforced Walls**: Destructible walls take 2 hits. First hit cracks them visually, second destroys
- **Map Events**: Meteor strikes hit random tiles every 30-45s (2s warning reticle). Power-up rain drops items across the map every 60s
- **Hazard Tiles**: Teleporter pairs (blue/orange glowing pads — step on one to warp to the other) and Conveyor Belts (force movement in arrow direction)

## Room Configuration

When creating a room, the host can configure:

- Game mode, max players (2-8), map size (21x21 / 31x31 / 39x39 / 51x51 / 61x61)
- Match time (1-10 min), wall density (30-80%), power-up drop rate (0-80%)
- Which of the 8 power-up types are enabled
- Bot count (0-7) and difficulty (Easy / Normal / Hard)
- Map features: reinforced walls, map events, hazard tiles
- Friendly fire (Teams mode only)
- Record Game toggle (visible when admin has enabled recordings globally)

## Bot AI

AI bots fill empty slots and provide singleplayer/practice options. Three strongly differentiated difficulty tiers:

- **Easy**: Low awareness, shallow escape (depth 2), slow reactions (5-tick delay), 25% chance to flee in wrong direction, 12% random unsafe bomb placement — clearly weaker than human players
- **Normal**: BFS pathfinding, directional wall breaking, 90% hunt chance, dynamic danger assessment, roaming after 3s idle — competitive opponent
- **Hard**: Deep escape search (depth 15), near-always hunts (95%), chain reaction awareness, shield-based aggression (ignores escape checks when shielded), near-zero late-game bomb cooldown (3-6 ticks) — dominant and oppressive

Bots use BFS for escape routes, power-up seeking, and enemy hunting with configurable search depth. Optimized through data-driven analysis of 20,000+ simulation games:

- **Bomb safety**: Dead-end detection (3+ walkable dirs required at high fire range), sandwich prevention, time-to-safety check (verifies bot can physically reach safe cell before bomb detonates), chain reaction danger in escape planning, remote bomb self-damage check
- **Offensive kick**: Priority 3.5 — bots kick bombs toward enemies in line-of-sight; defensive kick allows kicking own bombs when about to explode (<=15 ticks)
- **Pierce bomb awareness**: Danger zone calculations correctly extend through destructible walls for pierce bombs
- **Line bomb awareness**: Escape validation simulates the full line of bombs (not just one) before placing
- **Hunt persistence**: Locks on for 15 ticks after finding a path; continues in last direction when BFS loses the path
- **Game phase system**: Three phases — early (<35%), mid-game (35-60%, +10% hunt chance, 75% bomb cooldown, halved roam threshold), late-game (>60%, always hunt/roam, custom cooldowns)
- **Proximity aggression**: Bomb cooldown reduced to 75% when within 5 tiles of enemy, even in early game
- **Dynamic danger assessment**: Safe distance calculated from moves-available-before-detonation (not fixed distance), reducing unnecessary fleeing from far-away fresh bombs
- **Reachability filter**: Bombs whose blast can't physically reach the bot before detonation are excluded from danger calculations, dramatically reducing unnecessary flee decisions
- **Map-size scaling**: Hunt depth, escape depth, roam thresholds, and power-up vision auto-scale with map area — bots on large maps (e.g. 61×61) search proportionally deeper
- **Spawn randomization**: Spawn point assignment is shuffled per game seed via Fisher-Yates, eliminating positional win-rate bias across repeated games
- **Anti-oscillation**: Position history tracking prevents bots from bouncing between the same tiles
- **Hunt oscillation detector**: Detects bots stuck oscillating during hunt mode (≤3 unique positions in 10-entry history or prolonged hunting without kills) — forces wall-bombing toward enemy to break through
- **Smart flee recovery**: Flee stuck-breaker only triggers during movable ticks, prefers non-danger directions
- **Shield stalemate breaker**: Detects mutual shielded bombing loops (no kills, both shielded, late game) — escalates aggression by bypassing safety checks to break the deadlock
- **Duel stalemate breaker**: Detects 1v1 endgame situations with no kill progress (10s normal, 6s hard) — activates aggressive mode to prevent timeout draws
- **Strategic remote detonation**: Bots hold remote bombs instead of wasteful immediate detonation; proximity trigger (enemy within 2 tiles of bomb); shield-aware sacrifice (detonates when bot is shielded but enemy isn't); delayed self-unblock (waits 0.5s or enemy nearby before detonating remote bombs that block movement); pre-placement guard prevents placing remote bombs that would self-trap
- **KOTH awareness**: Bots navigate toward the hill zone and hold position once inside

## Teams

- Host assigns players and bots to Team Red or Team Blue via dropdowns in the waiting room
- Unassigned players fall back to round-robin at game start
- In-game: team-colored player sprites, name labels, and HUD grouping
- When friendly fire is OFF, same-team explosions don't damage teammates (self-damage still applies)

## Spectator Mode

When eliminated, players can:
- Pan the camera freely with WASD / Arrow Keys / D-Pad / mouse drag
- Click a player name in the HUD player list to follow them
- Press `1`-`9` to follow the Nth alive player
- Use LB/RB gamepad bumpers to cycle between alive players

Spectator controls also work when watching simulations or replays, including click-to-follow and mouse drag panning.

## Admin Panel

Accessible from the lobby header for admin and moderator roles.

| Tab | Access | Features |
|-----|--------|----------|
| **Dashboard** | Admin | 5 stat cards (users, active 24h, matches, rooms, online) with 30s auto-refresh. Server Settings: match recordings toggle, game creation defaults, simulation defaults |
| **Users** | Admin + Mod | Search, paginated table, role change, deactivate/reactivate, permanently delete (type-to-confirm), create user, admin password reset |
| **Matches** | Admin + Mod | Paginated match history, click any row for detailed per-player stats modal |
| **Rooms** | Admin + Mod | Active rooms with 5s refresh, spectate, send message, kick player, force close (admin only) |
| **Logs** | Admin | Audit trail of all admin actions with action type filter |
| **Simulations** | Admin | Batch bot-only game simulations for AI analysis (see below) |
| **AI** | Admin | Upload, manage, and switch between custom bot AI implementations (see below) |
| **Announcements** | Admin + Mod | Toast broadcast (ephemeral notification to all players) + persistent lobby banner (admin only) |

All admin actions are logged to an audit table.

## Bot AI Management

Admins can upload custom bot AI implementations as TypeScript files, which are compiled and validated server-side.

- **Upload**: Upload a `.ts` file that exports a class with `generateInput(player, state, logger?): PlayerInput | null`. Server validates syntax, dangerous imports, structure, and instantiation
- **Built-in AI**: The default BotAI is always listed and cannot be deleted — serves as a downloadable reference implementation and fallback
- **Activate/Deactivate**: Multiple AIs can be active simultaneously. When more than one is active, a "Bot AI" dropdown appears in room creation and simulation config
- **Per-room selection**: Each room or simulation batch can use a different AI via the `botAiId` config field
- **Runtime safety**: If a custom AI crashes during gameplay, the bot silently falls back to the built-in default
- **Storage**: Source and compiled files in `data/ai/{uuid}/`, metadata in `bot_ais` database table
- **Developer guide**: See [docs/bot-ai-guide.md](docs/bot-ai-guide.md) for the full API reference and examples

## Bot Simulation System

Admins can run batch bot-only game simulations to collect AI behavior data for analysis and optimization.

- **Configure**: Game mode, bot count/difficulty, map size, round time, wall density, power-ups, total games (1-1000), record replays toggle
- **Two speed modes**: Fast (ticks as fast as possible) or Real-time (20 tps with live spectating in-browser)
- **Log verbosity**: Normal (5-tick snapshots), Detailed (2-tick + movements/pickups), Full (every tick + pathfinding)
- **Results**: Paginated table with sortable columns, win distribution chart, per-game stats with replay button
- **Queue system**: Start a new simulation while one is running — it queues (up to 10) and auto-starts when the current batch finishes. Queue position shown in the UI with a "Remove" option
- **Management**: Cancel running batches (queue auto-advances), delete completed batches (removes logs from disk)
- **Logs**: JSONL files in `data/simulations/{gameMode}/batch_*/` with `batch_config.json` and `batch_summary.json`
- **Replays**: Every sim game is recorded as a gzipped replay in the batch directory — watchable with the same replay viewer (controls, log panel, seeking, speed). Cleaned up automatically when the batch is deleted
- **Live spectating**: Real-time simulations play in the browser like a normal game in spectator mode, with automatic game-to-game transitions

## Account Management

Users can manage their account from the lobby Account modal:

- **Username**: Change anytime. Validated (3-20 chars, alphanumeric + underscore/hyphen), uniqueness-checked (409 if taken)
- **Email**: Two-step flow — submit new address, click confirmation link sent to the new email (24h expiry). Admins skip verification
- **Password**: Change from the Account modal. Requires current password verification before updating. Minimum 8 characters, confirmation field must match
- **Forgot Password**: "Forgot password?" link on the login screen. Enter your email to receive a reset link. Token-based reset flow; response is intentionally vague to prevent email enumeration
- **Admin Password Reset**: Admins can reset any user's password from the Users tab. Sets a new password directly (min 6 chars), revokes all sessions (forces re-login), and logs the action to the audit trail

## Architecture

```
                    ┌──────────────────┐
                    │      Nginx       │
                    │  (static files   │
                    │   + reverse      │
                    │     proxy)       │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
       ┌───────────│     Backend      │───────────┐
       │           │  Express + TS    │           │
       │           │  Socket.io       │           │
       │           │  20 tick/s loop  │           │
       │           └──────────────────┘           │
       │                                          │
┌──────▼──────┐                          ┌────────▼────────┐
│   MariaDB   │                          │      Redis      │
│  (users,    │                          │  (sessions,     │
│   matches,  │                          │   rate limits)  │
│   actions)  │                          │                 │
└─────────────┘                          └─────────────────┘
```

- **Server-authoritative**: All game logic runs on the server at 20 ticks/sec. Clients only send inputs and render received state
- **Grid-based movement**: Players occupy exactly one tile at a time with movement cooldowns
- **Monorepo**: npm workspaces — `shared/` (types + constants), `backend/` (server), `frontend/` (client)
- **Real-time**: Socket.io for game state, room events, admin actions
- **Auth**: JWT access tokens (in memory) + httpOnly refresh cookies (survive restarts)

## Security

- **CORS**: Restricted to `APP_URL` origin (both Express and Socket.io)
- **CSP**: Content-Security-Policy header via Nginx — limits scripts, styles, fonts, and connections
- **XSS**: All user-generated content escaped via `escapeHtml()` before DOM insertion; no inline `onclick` handlers
- **Rate limiting**: Redis-backed HTTP rate limiting with in-memory fallback when Redis is unavailable; per-socket sliding window rate limiting with disconnect cleanup
- **Input validation**: Zod schemas on all HTTP routes + runtime validation on `game:input` socket payloads
- **Auth**: JWT access tokens (in-memory only) + httpOnly sameSite:strict refresh cookies with secure flag; bcrypt password hashing (12 rounds); refresh token rotation with reuse detection
- **SQL injection**: All queries parameterized via mysql2
- **Admin**: All admin actions audit-logged; admin messages sanitized + length-limited server-side

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Phaser 3 + TypeScript + Vite |
| Backend | Node.js + Express + TypeScript |
| Real-time | Socket.io |
| Database | MariaDB 11 |
| Cache | Redis 7 |
| Web Server | Nginx (static + reverse proxy) |
| Auth | JWT + bcrypt + httpOnly cookies |
| Validation | Zod |
| Container | Docker Compose |

## Project Structure

```
blast-arena/
├── shared/                  # Shared types, constants, utilities
│   └── src/
│       ├── types/           # TypeScript interfaces (GameState, Room, Player, etc.)
│       ├── constants/       # Game constants, power-up definitions, game modes
│       └── utils/           # Shared utilities
├── backend/
│   └── src/
│       ├── routes/          # REST endpoints (auth, lobby, user, admin, health)
│       ├── game/            # Server game logic
│       │   ├── GameLoop.ts  # 20 tick/sec game loop
│       │   ├── GameState.ts # Tick processing (movement, bombs, explosions, etc.)
│       │   ├── GameRoom.ts  # Room lifecycle + socket event emission
│       │   ├── BotAI.ts     # AI bot decision engine
│       │   ├── Map.ts       # Procedural map generation
│       │   ├── Player.ts    # Player state + movement
│       │   ├── Bomb.ts      # Bomb placement, timers, kicking, sliding
│       │   ├── Explosion.ts # Blast calculation, chain reactions
│       │   ├── PowerUp.ts   # Power-up drops and collection
│       │   ├── CollisionSystem.ts # Collision detection helpers
│       │   ├── BattleRoyale.ts    # BR shrinking zone logic
│       │   ├── InputBuffer.ts     # Input queuing
│       │   └── RoomManager.ts # Room creation, joining, cleanup
│       ├── simulation/      # Bot simulation system
│       │   ├── SimulationGame.ts    # Headless single-game runner
│       │   ├── SimulationRunner.ts  # Batch orchestrator
│       │   └── SimulationManager.ts # Singleton manager
│       ├── db/              # MariaDB connection, migrations, redis
│       ├── services/        # Auth, user, admin, lobby, email, replay, settings
│       ├── middleware/       # Auth, rate limiting, staff checks
│       └── socket.ts        # Socket.io event routing
├── frontend/
│   ├── index.html           # HTML + full CSS design system (INFERNO theme)
│   └── src/
│       ├── scenes/          # Phaser scenes (Boot, Menu, Lobby, Game, HUD, GameOver)
│       ├── ui/              # DOM-based UI (Auth, Lobby, Room, Notifications, Admin + 6 admin tabs)
│       │   └── modals/      # AccountModal, CreateRoomModal, SettingsModal, HelpModal
│       ├── game/            # Client renderers (players, bombs, explosions, effects, replay, gamepad)
│       └── network/         # ApiClient, SocketClient, AuthManager
├── docker-compose.yml       # Production orchestration
├── docker-compose.dev.yml   # Development overrides (hot reload, exposed ports)
└── docker/
    └── nginx/               # Nginx config + custom 502 page
```

## Frontend Design

The UI uses the **INFERNO** design system — a high-energy arcade-industrial aesthetic:

- **Typography**: Chakra Petch (headings) + DM Sans (body) via Google Fonts
- **Colors**: Hot orange primary (#ff6b35), teal accent (#00d4aa), deep dark backgrounds
- **All CSS** lives in `frontend/index.html` using CSS custom properties (`:root` variables)
- **All sprites** are procedurally generated in `BootScene` — no external image assets
- **Power-up tiles** use emoji icons (💣🔥⚡🛡️👢💥📡🧨) rendered via Canvas2D for visual consistency with the HUD
- **DOM-based UI** overlays for lobby, waiting room, admin panel, HUD, modals — all via innerHTML templates
- **Phaser 3** handles the game canvas with composed renderer classes (TileMap, PlayerSprite, BombSprite, ExplosionSprite, etc.)

## Visual Effects

- Animated explosions with expansion wave, sustain pulse, and fade
- Fire and smoke particle emitters on explosions
- Fuse spark particles on bombs with last-second urgency flashing
- Wall debris particles on destruction
- Shield aura glow on protected players + break particles
- Squash/stretch animation on player movement (deduplicated via active tween tracking) + dust trails
- Screen shake on nearby explosions (configurable)
- "3, 2, 1, GO!" countdown overlay synced between server and client
- Power-up float animation + collection popup particles

## Game Replay System

Games are recorded when recording is enabled (controlled via admin Dashboard toggle and per-room/per-simulation checkboxes):

- **Full recording**: Every tick's game state saved as gzipped JSON in `./data/replays/`
- **Video player controls**: Play/pause (click canvas or Space), seek slider, speed (0.5x / 1x / 2x / 4x), skip forward/back (arrow keys), mouse drag to pan camera. Arrow keys are reserved for timeline control in replay mode; use WASD or mouse drag to pan
- **Live game log panel**: Collapsible side panel showing kills, bombs, bot decisions, power-ups in sync with replay playback. Filter by event type, click any entry to seek to that moment
- **Admin access**: Matches tab → click match → "Watch Replay" button. Simulations tab → batch detail → per-game "Replay" button. Shows all players including bots
- **Space efficient**: Tile diffs instead of full map per frame, gzip compression (~400-700KB per game)
- **Replay API**: `GET /admin/replays` (list), `GET /admin/replays/:matchId` (fetch), `DELETE /admin/replays/:matchId` (delete), `GET /admin/simulations/:batchId/replay/:gameIndex` (sim replay)

## Connection Resilience

- Socket.io reconnects indefinitely (1-5s backoff) with a "Reconnecting..." overlay that also polls `/api/health` every 3s — auto-reloads the page as soon as the backend is back
- **Disconnect grace period**: Players get 10 seconds to reconnect during a game before being killed — prevents unfair deaths from brief network blips
- On reconnect, server auto-detects active game and rejoins the player seamlessly
- On reconnect, client checks server `buildId` — auto-refreshes if the server restarted
- Nginx serves a custom 502 page during container rebuilds that auto-polls and refreshes when the app is back
- Persistent sessions via httpOnly refresh cookies survive server restarts

## Configuration

All settings via `.env` (copy `.env.example` to get started):

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | — | **Required**. Random string, min 16 chars |
| `DB_PASSWORD` | `change_me_in_production` | MariaDB user password |
| `DB_ROOT_PASSWORD` | `change_root_password` | MariaDB root password |
| `APP_EXTERNAL_PORT` | `8080` | Port Nginx listens on |
| `APP_URL` | `http://localhost:8080` | Public URL (controls secure cookie flag + Vite allowed host) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | — | SMTP for email verification (optional) |
| `GAME_TICK_RATE` | `20` | Server game loop ticks per second |
| `MAX_ROOMS` | `50` | Maximum concurrent rooms |
| `POWERUP_DROP_CHANCE` | `0.3` | Default power-up drop rate (0-1) |
| `LOG_LEVEL` | `info` | Server log verbosity |
| `NODE_ENV` | `development` | Environment mode |
| `RATE_LIMIT_LOGIN` | `5` | Login attempts per window |
| `RATE_LIMIT_REGISTER` | `3` | Registration attempts per window |
| `RATE_LIMIT_API` | `100` | General API requests per window |
| `MAX_PLAYERS_PER_ROOM` | `8` | Maximum players per room |
| `BOMB_TIMER_SECONDS` | `3` | Default bomb fuse time |
| `JWT_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime |

See `.env.example` for the complete list including SMTP and dev-only port variables.

## Docker

- **Production**: `docker compose up --build -d` — only Nginx exposes a port
- **Development**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` — hot reload, DB/Redis ports exposed
- **Data**: Persists in `./data/` via bind mounts (database, game logs, simulation logs, replays)
- **Services**: MariaDB 11, Redis 7, Node.js backend, Nginx (static + proxy)
- Nginx serves `no-cache` headers for `index.html` to prevent stale frontend after deploys

## Game Logging

Detailed JSONL game logs are written to `./data/gamelogs/` for every match:

- Bot decisions, kills, bomb placements/detonations, movements, power-up pickups
- Tick snapshots at configurable intervals (verbosity: normal=5 ticks, detailed=2, full=every tick)
- Explosion detail and bot pathfinding logs at full verbosity
- Filename: `{ISO-timestamp}_{roomCode}_{gameMode}_{playerCount}p.jsonl`
- Simulation logs: `./data/simulations/{gameMode}/batch_*/sim_NNN.jsonl`
- Simulation replays: `./data/simulations/{gameMode}/batch_*/{gameIndex}_sim_NNN_{gameMode}.replay.json.gz`

## Performance Optimizations

The game loop and rendering pipeline are optimized for low-latency multiplayer with multiple bots:

- **Per-tick caching**: Alive player list, bomb/player position sets, and KOTH hill control cached within each tick — eliminates redundant `Array.from().filter()` and enables O(1) collision lookups
- **Efficient serialization**: Single-pass `mapToArray()` for state broadcast, conditional tile snapshots (only when chain reactions are possible)
- **BotAI**: Pre-computed direction deltas, deduplicated enemy/bomb array creation, cached explosion cells — reduces per-bot overhead significantly
- **Frontend HUD**: Stats bar and kill feed use persistent DOM elements with differential updates instead of innerHTML rebuilds every tick
- **Sprite rendering**: Team indicators use `setPosition()` instead of per-frame clear/redraw; dust particle emitters pooled per player
- **Database**: Admin dashboard uses consolidated single-query stats; match lists use pre-aggregated JOINs instead of correlated subqueries

## Testing & Linting

```bash
npm test                    # Run all test suites (117 tests)
npm run lint                # ESLint across all workspaces
npm run format:check        # Prettier format check
```

117 tests across 8 suites covering game state lifecycle, movement, bombs, explosions, death mechanics, shield, chain reactions, win conditions, power-ups, teams, deathmatch, KOTH, auth, input validation, grid utilities, and more.

## Database Migrations

Migrations in `backend/src/db/migrations/` run automatically on server start:

1. `001_initial.sql` — Users, refresh_tokens, login_attempts, matches, match_players, user_stats, admin_actions tables
2. `002_admin_panel.sql` — User soft-delete columns, game_mode ENUM expansion (6 modes), announcements table
3. `003_user_profile.sql` — Pending email change columns
4. `004_remove_ban.sql` — Drop legacy ban/display_name columns
5. `005_server_settings.sql` — Server settings key-value table (recordings toggle)
6. `006_default_settings.sql` — Game creation and simulation default settings
