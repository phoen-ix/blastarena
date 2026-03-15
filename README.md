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
| ⚡ | **Speed Up** | Faster movement (up to 5 levels) | Common |
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

- Game mode, max players (2-8), map size (11x11 to 31x31)
- Match time (1-10 min), wall density (30-80%), power-up drop rate (0-80%)
- Which of the 8 power-up types are enabled
- Bot count (0-7) and difficulty (Easy / Normal / Hard)
- Map features: reinforced walls, map events, hazard tiles
- Friendly fire (Teams mode only)

## Bot AI

AI bots fill empty slots and provide singleplayer/practice options. Three difficulty tiers:

- **Easy**: Low awareness, shallow escape planning, slow reactions
- **Normal**: BFS pathfinding, directional wall breaking toward enemies, roaming after 5s idle
- **Hard**: Deep search depth, aggressive hunting, 3s idle roaming, detonates remote bombs tactically

Bots use BFS for escape routes and power-up seeking, hunt enemies with configurable search depth, and prefer breaking walls toward opponents. In King of the Hill mode, bots actively navigate toward the hill zone and hold position once inside.

## Teams

- Host assigns players and bots to Team Red or Team Blue via dropdowns in the waiting room
- Unassigned players fall back to round-robin at game start
- In-game: team-colored player sprites, name labels, and HUD grouping
- When friendly fire is OFF, same-team explosions don't damage teammates (self-damage still applies)

## Spectator Mode

When eliminated, players can:
- Pan the camera freely with WASD / Arrow Keys / D-Pad
- Click a player name in the HUD player list to follow them
- Press `1`-`9` to follow the Nth alive player
- Use LB/RB gamepad bumpers to cycle between alive players

## Admin Panel

Accessible from the lobby header for admin and moderator roles.

| Tab | Access | Features |
|-----|--------|----------|
| **Dashboard** | Admin | 5 stat cards (users, active 24h, matches, rooms, online) with 30s auto-refresh |
| **Users** | Admin + Mod | Search, paginated table, role change, deactivate/reactivate, permanently delete (type-to-confirm), create user |
| **Matches** | Admin + Mod | Paginated match history, click any row for detailed per-player stats modal |
| **Rooms** | Admin + Mod | Active rooms with 5s refresh, spectate, send message, kick player, force close (admin only) |
| **Logs** | Admin | Audit trail of all admin actions with action type filter |
| **Announcements** | Admin + Mod | Toast broadcast (ephemeral notification to all players) + persistent lobby banner (admin only) |

All admin actions are logged to an audit table.

## Account Management

Users can manage their account from the lobby Account modal:

- **Username**: Change anytime. Validated (3-20 chars, alphanumeric + underscore/hyphen), uniqueness-checked (409 if taken)
- **Email**: Two-step flow — submit new address, click confirmation link sent to the new email (24h expiry). Admins skip verification

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
│       │   └── RoomManager.ts # Room creation, joining, cleanup
│       ├── db/              # MariaDB connection + migrations
│       ├── services/        # Auth, user, match, admin services
│       ├── middleware/       # Auth, rate limiting, staff checks
│       └── socket.ts        # Socket.io event routing
├── frontend/
│   ├── index.html           # HTML + full CSS design system (INFERNO theme)
│   └── src/
│       ├── scenes/          # Phaser scenes (Boot, Menu, Lobby, Game, HUD, GameOver)
│       ├── ui/              # DOM-based UI (Auth, Lobby, Room, Admin + 6 admin tabs, extracted modals)
│       ├── game/            # Client renderers (players, bombs, explosions, effects, etc.)
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
- Squash/stretch animation on player movement + dust trails
- Screen shake on nearby explosions (configurable)
- "3, 2, 1, GO!" countdown overlay synced between server and client
- Power-up float animation + collection popup particles

## Connection Resilience

- Socket.io reconnects indefinitely (1-5s backoff) with a "Reconnecting..." overlay
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
| `APP_URL` | `http://localhost:8080` | Public URL (controls secure cookie flag) |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | — | SMTP for email verification (optional) |
| `GAME_TICK_RATE` | `20` | Server game loop ticks per second |
| `MAX_ROOMS` | `50` | Maximum concurrent rooms |
| `POWERUP_DROP_CHANCE` | `0.3` | Default power-up drop rate (0-1) |
| `LOG_LEVEL` | `info` | Server log verbosity |
| `RATE_LIMIT_LOGIN` | `5` | Login attempts per window |

## Docker

- **Production**: `docker compose up --build -d` — only Nginx exposes a port
- **Development**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` — hot reload, DB/Redis ports exposed
- **Data**: Persists in `./data/` via bind mounts (database, game logs)
- **Services**: MariaDB 11, Redis 7, Node.js backend, Nginx (static + proxy)
- Nginx serves `no-cache` headers for `index.html` to prevent stale frontend after deploys

## Game Logging

Detailed JSONL game logs are written to `./data/gamelogs/` for every match:

- Bot decisions, kills, bomb placements/detonations
- Tick snapshots every 5 ticks with full game state
- Filename: `{ISO-timestamp}_{roomCode}_{gameMode}_{playerCount}p.jsonl`

## Testing & Linting

```bash
npm test                    # Run all test suites (92 tests)
npm run lint                # ESLint across all workspaces
npm run format:check        # Prettier format check
```

92 tests across 6 suites covering game state lifecycle, movement, bombs, explosions, death mechanics, shield, chain reactions, win conditions, power-ups, teams, deathmatch, KOTH, and more.

## Database Migrations

Migrations in `backend/src/db/migrations/` run automatically on server start:

1. `001_initial.sql` — Users, matches, match_players tables
2. `002_admin_panel.sql` — Admin actions audit table
3. `003_user_profile.sql` — Pending email change columns
4. `004_remove_ban.sql` — Schema cleanup
