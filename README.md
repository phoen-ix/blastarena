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

Open `http://localhost:8080` (or your configured `APP_EXTERNAL_PORT`). See `.env.example` for all configuration options.

## Game Modes

| Mode | Players | Duration | Description |
|------|---------|----------|-------------|
| **Free for All** | 2-8 | 3 min | Last player standing wins |
| **Teams** | 4-8 | 4 min | Two teams — last team standing. Friendly fire configurable |
| **Battle Royale** | 4-8 | 5 min | Circular danger zone shrinks inward |
| **Sudden Death** | 2-8 | 2 min | Start fully powered, no power-ups, one hit kills |
| **Deathmatch** | 2-8 | 5 min | Respawn after death, first to 10 kills wins |
| **King of the Hill** | 2-8 | 4 min | Control the 3x3 center zone, first to 100 points |

## Controls

| Keyboard | Gamepad | Action |
|----------|---------|--------|
| `WASD` / `Arrow Keys` | D-Pad / Left Stick | Move |
| `Space` | A | Place bomb |
| `E` | B | Detonate remote bombs |
| `1`-`9` | LB / RB | Spectate player (when dead) |

Walk into a bomb with the Kick power-up to send it sliding. Click a player name in the HUD to follow them as spectator.

## Power-Ups

| Icon | Name | Effect |
|------|------|--------|
| 💣 | **Bomb Up** | +1 max bombs (up to 8) |
| 🔥 | **Fire Up** | +1 explosion range (up to 8) |
| ⚡ | **Speed Up** | Faster movement (up to 2 levels) |
| 🛡️ | **Shield** | Absorbs one explosion hit (no time limit, doesn't stack) |
| 👢 | **Kick** | Walk into bombs to kick them |
| 💥 | **Pierce Bomb** | Explosions pass through destructible walls |
| 📡 | **Remote Bomb** | Bombs don't auto-detonate; press E to detonate all (10s safety max) |
| 🧨 | **Line Bomb** | Places a line of bombs in facing direction |

## Map Features

All optional, toggled per-room: **Reinforced Walls** (2-hit destructible walls), **Map Events** (meteor strikes, power-up rain), **Hazard Tiles** (teleporter pairs, conveyor belts).

## Solo Campaign

Single-player campaign with hand-crafted levels grouped into worlds. Defeat enemies (5 movement patterns, boss phases), earn 1-3 stars per level, track progress. Admins create enemy types and levels via a visual editor. Ships with "Training Grounds" (3 levels). See [docs/campaign.md](docs/campaign.md).

## Bot AI

Three difficulty tiers optimized through 20,000+ simulation games:
- **Easy**: Low awareness, shallow escape, intentional mistakes
- **Normal**: BFS pathfinding, dynamic danger assessment, competitive
- **Hard**: Deep search, chain reaction awareness, shield aggression, dominant

Admins can upload custom AI implementations as TypeScript files. See [docs/bot-ai-guide.md](docs/bot-ai-guide.md) for the developer guide and [docs/bot-ai-internals.md](docs/bot-ai-internals.md) for built-in AI details.

## Admin Panel

| Tab | Access | Key Features |
|-----|--------|-------------|
| Dashboard | Admin | Stats, server settings, email/SMTP config, game/simulation defaults |
| Users | Staff | Search, roles, deactivate, delete, password reset |
| Matches | Staff | History, per-player stats, replay viewer, delete |
| Rooms | Staff | Live rooms, spectate, kick, force close |
| Logs | Admin | Audit trail with filters |
| Simulations | Admin | Batch bot-only games (1-1000), fast/realtime, queue |
| AI | Admin | Upload/manage custom bot AI implementations |
| Campaign | Admin | Worlds, levels (visual editor), enemy types |
| Announcements | Staff | Toast broadcasts, persistent banners |

All actions audit-logged. See [docs/admin-and-systems.md](docs/admin-and-systems.md).

## Game Replays

Games recorded as gzipped JSON with video-player controls (play/pause, seek, 0.5-4x speed), synced event log panel, and click-to-follow spectating. Access via Matches tab or Simulations tab. See [docs/replay-system.md](docs/replay-system.md).

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

- **Server-authoritative**: All game logic runs on the server at 20 ticks/sec
- **Grid-based movement**: Players occupy exactly one tile at a time
- **Monorepo**: npm workspaces — `shared/` (types + constants), `backend/` (server), `frontend/` (client)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Phaser 3 + TypeScript + Vite |
| Backend | Node.js + Express + TypeScript |
| Real-time | Socket.io |
| Database | MariaDB 11 + Redis 7 |
| Auth | JWT + bcrypt + httpOnly cookies |
| Validation | Zod |
| Container | Docker Compose |

## Project Structure

```
blast-arena/
├── shared/                  # Shared types, constants, utilities
├── backend/
│   └── src/
│       ├── routes/          # REST endpoints (auth, lobby, user, admin, campaign)
│       ├── game/            # Server game logic (GameLoop, GameState, BotAI, etc.)
│       ├── simulation/      # Bot simulation system
│       ├── db/              # MariaDB connection, migrations, redis
│       ├── services/        # Auth, user, admin, lobby, email, replay, settings
│       └── middleware/       # Auth, rate limiting, staff checks
├── frontend/
│   ├── index.html           # HTML + full CSS design system (INFERNO theme)
│   └── src/
│       ├── scenes/          # Phaser scenes (Boot, Menu, Lobby, Game, HUD, GameOver)
│       ├── ui/              # DOM-based UI (Auth, Lobby, Room, Campaign, Admin)
│       ├── game/            # Client renderers, effects, replay, gamepad
│       └── network/         # ApiClient, SocketClient, AuthManager
├── docs/                    # Detailed documentation (see below)
├── docker-compose.yml       # Production orchestration
└── docker-compose.dev.yml   # Development overrides
```

## Testing & Linting

```bash
npm test                    # Run all test suites (292 tests)
npm run lint                # ESLint across all workspaces
npm run format:check        # Prettier format check
```

## Documentation

- [Bot AI Developer Guide](docs/bot-ai-guide.md) — writing custom bot AIs
- [Bot AI Internals](docs/bot-ai-internals.md) — built-in BotAI decision engine
- [Campaign System](docs/campaign.md) — enemies, levels, editor, progress
- [Admin Panel & Systems](docs/admin-and-systems.md) — admin tabs, simulations, accounts
- [Replay System](docs/replay-system.md) — recording, playback, controls
- [Performance & Internals](docs/performance-and-internals.md) — optimizations, game logging
- [Infrastructure & Security](docs/infrastructure.md) — security, resilience, Docker, migrations
