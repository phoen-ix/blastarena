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
| `1`-`6` | — | Quick emote (when alive) |
| `Escape` | — | Pause campaign (when in campaign) |
| `1`-`9` | LB / RB | Spectate player (when dead) |

Walk into a bomb with the Kick power-up to send it sliding. Click a player name in the HUD to follow them as spectator.

## Power-Ups

| Icon | Name | Effect |
|------|------|--------|
| 💣 | **Bomb Up** | +1 max bombs (up to 8) |
| 🔥 | **Fire Up** | +1 explosion range (up to 8) |
| ⚡ | **Speed Up** | Faster movement (up to 5 levels) |
| 🛡️ | **Shield** | Absorbs one explosion hit (no time limit, doesn't stack) |
| 👢 | **Kick** | Walk into bombs to kick them |
| 💥 | **Pierce Bomb** | Explosions pass through destructible walls |
| 📡 | **Remote Bomb** | Bombs don't auto-detonate; press E to detonate all (10s safety max) |
| 🧨 | **Line Bomb** | Places a line of bombs in facing direction |

## Map Features

All optional, toggled per-room: **Reinforced Walls** (2-hit destructible walls), **Map Events** (meteor strikes, power-up rain), **Hazard Tiles** (teleporter pairs, conveyor belts).

## Campaign

Campaign with hand-crafted levels grouped into worlds. Defeat enemies (5 built-in movement patterns, boss phases, or custom AI scripts), earn 1-3 stars per level, track progress. Supports solo play, online co-op (2 players via party), local co-op (same keyboard/gamepads), and buddy mode. Local co-op features a setup modal for Player 2 identity (guest with custom name/color, or log in as a registered player with own cosmetics and cookie-based session persistence), control presets (WASD, Arrows, Numpad, Gamepad 1/2), and camera mode: shared auto-zoom, horizontal split-screen, or vertical split-screen. Split-screen auto-zooms to fill each viewport and shows off-screen partner arrows at viewport edges (aligned on the line connecting the two players). **Buddy Mode** is designed for playing with very young or inexperienced players — the buddy is a smaller, permanently invulnerable support character who can pass through destructible walls and bombs, pick up power-ups for P1, and place limited bombs (1 bomb, 1 fire range). Buddy name, color, and size (40-80%) are saved per-account and configurable in Settings > Preferences or the pre-launch modal. 3-2-1-GO countdown, pause menu (Escape key — Continue/Exit), win grace period for smooth transitions, and seamless retry/play-again with full mode preservation. Admins create enemy types and levels via a visual editor with resizable maps, WASD/arrow panning, zoom, and prominent spawn point markers. Enemy types can optionally use custom AI scripts (TypeScript `decide()` method) that override built-in movement patterns — uploaded in the AI tab and assigned per enemy type with a difficulty setting. Ships with 6 default enemy AIs: Hunter (aggressive chaser), Patrol Guard (path follower), Bomber (area denial), Coward (flee + trap), Swarm (coordinated flanking), and Ambusher (wait + rush) — all scaling across easy/normal/hard difficulty. Export/import levels and enemy types as JSON (AI source bundled in exports). Ships with "Training Grounds" (3 levels). See [docs/campaign.md](docs/campaign.md) and [docs/enemy-ai-guide.md](docs/enemy-ai-guide.md).

## Bot AI

Three difficulty tiers optimized through 20,000+ simulation games:
- **Easy**: Low awareness, shallow escape, intentional mistakes
- **Normal**: BFS pathfinding, dynamic danger assessment, competitive
- **Hard**: Deep search, chain reaction awareness, shield aggression, dominant

Admins can upload custom AI implementations as TypeScript files. See [docs/bot-ai-guide.md](docs/bot-ai-guide.md) for the developer guide and [docs/bot-ai-internals.md](docs/bot-ai-internals.md) for built-in AI details.

## Leaderboard & Ranking

Elo-based competitive ranking across all game modes. Standard Elo formula with adaptive K-factor. Seasonal system with admin-defined dates, history archiving, and hard/soft resets. Six rank tiers (Bronze through Champion) with optional sub-tiers (I/II/III) — all admin-configurable. Leaderboard view with season filtering (hidden when no seasons) and clickable profiles leading to full-page profile views. Rank and level badges displayed next to usernames in lobby. Elo deltas and XP gains shown on game-over screen.

## Player XP & Levels

XP-based leveling system separate from Elo. Earn XP from kills, bomb placements, power-up collection, match completion, and placement bonuses. Level curve: each level requires progressively more XP. Level milestones can unlock exclusive cosmetics. Admin-configurable XP multiplier. Level displayed on leaderboard, profiles, lobby, and game-over screen with progress bar.

## Achievements & Cosmetics

Admin-configurable achievement system with four condition types: cumulative stats, per-game feats, mode-specific milestones, and campaign progress. Ships with a default pack of 47 achievements and 25 cosmetic rewards across combat, victory, dedication, mode mastery, and campaign categories. Achievement progress tracking with progress bars on profiles (own profile only). Achievements can reward cosmetics. Four cosmetic types: player colors, eye styles, movement trails, and bomb skins. Unlocked via achievements, campaign stars, level milestones, or by default. Export/import achievements and cosmetics as JSON. Full-page profile views show rank, level, stats grid, season history, achievements, and equipped cosmetics with a privacy toggle.

## Admin Panel

| Tab | Access | Key Features |
|-----|--------|-------------|
| Dashboard | Admin | Stats, server settings (recordings, registration, email/SMTP, chat modes, XP multiplier, default theme, GitHub/imprint display), game/simulation defaults |
| Users | Staff | Search, roles, deactivate, delete, password reset |
| Matches | Staff | History, per-player stats, replay viewer, delete |
| Rooms | Staff | Live rooms, spectate, kick, force close |
| Logs | Admin | Audit trail with filters, click-to-expand detail rows |
| Simulations | Admin | Batch bot-only games (1-1000), fast/realtime, queue |
| AI | Admin | Upload/manage custom bot AI and enemy AI implementations |
| Campaign | Admin | Worlds, levels (visual editor), enemy types, JSON export/import |
| Announcements | Staff | Toast broadcasts, persistent banners |
| Seasons | Admin | Season CRUD, activate/end (hard/soft reset), rank tier config with color pickers |
| Achievements | Admin | Achievement CRUD (4 condition types), cosmetic CRUD (4 types), reward linking, JSON export/import |

All actions audit-logged. See [docs/admin-and-systems.md](docs/admin-and-systems.md).

## Social Features

- **Theme System**: 11 color themes — 5 dark (Inferno, Arctic, Toxic, Crimson, Midnight), 3 vivid light (Daylight, Sakura, Sand), 3 pastel light (Frost, Blossom, Dune). User selects in Settings > Preferences; admin sets global default in Dashboard. Themes affect all UI and Phaser canvas colors.
- **Sidebar Navigation**: Persistent collapsible left sidebar with "ear" toggle tab. All lobby views (Rooms, Friends, Messages, Party, Leaderboard, Settings, Help, Admin, Campaign, Create Room, Profile) render inline in the main content area — no overlays or slide-out panels.
- **Friends**: Full-page view with tabs (Friends/Requests/Blocked), search, friend cards with online status indicators.
- **Online Presence**: See friends' real-time status (online, in lobby, in game, in campaign). Presence tracked via Redis with 120s TTL.
- **Parties**: Full-page view with two states: empty (create party) / active (member cards, chat, invites). When the party leader joins a room, all members auto-follow.
- **Room Invites**: Invite friends directly to your current room. Invite toasts with Accept/Decline buttons (30s auto-dismiss).
- **Lobby Chat**: Global ephemeral chat for all connected lobby users. Collapsible panel bottom-right. Users can hide via Settings > Preferences > Chat toggle.
- **Direct Messages**: Full-page two-column view (conversation sidebar + active conversation). Persistent messages between friends with unread badges, real-time delivery, read receipts.
- **In-Game Emotes**: 6 predefined quick phrases (GG, Help!, Nice!, Oops, Taunt, Thanks) — keys 1-6 during gameplay. Floating bubbles above player sprites with 3s cooldown.
- **Spectator Chat**: Dead players can text chat during live games. Collapsible panel bottom-left, role-colored usernames, 3/sec rate limit.
- **Rematch Voting**: After game over, players vote for rematch. >50% triggers auto-restart with same settings. 30s timeout. Solo games (1 human + bots) show direct "Play Again" button instead of voting.
- **Admin Chat Controls**: All chat features (party chat, lobby chat, DMs, emotes, spectator chat) individually configurable: everyone (default), staff only, admin only, or fully disabled.
- **Imprint & GitHub**: Admin-toggled links displayed on the login page footer and as right-aligned items in the Help tab bar. Imprint text editable in Dashboard; shown as modal on login, inline tab in Help. GitHub link opens repo in new tab.

## Game Replays

Games recorded as gzipped JSON with video-player controls (play/pause, seek, 0.5-4x speed), synced event log panel, and click-to-follow spectating. Access via Matches tab or Simulations tab. See [docs/replay-system.md](docs/replay-system.md).

## In-Game Help & Documentation

Full-page Help view accessible from the lobby sidebar. Seven tabs with role-based filtering:

| Tab | Access | Content |
|-----|--------|---------|
| Getting Started | All | Keyboard + gamepad controls, basic mechanics, spectator mode |
| Power-Ups | All | All 8 power-ups with Canvas2D inline sprites matching in-game textures |
| Game Modes | All | 6 modes with player counts, rules, win conditions |
| Map Features | All | Reinforced walls, dynamic events, hazard tiles with visual previews |
| Guides | All | Rendered markdown docs: Campaign, Replays, Bot AI (collapsible sections) |
| Level Editor | Staff | Campaign level editor documentation |
| Admin Docs | Staff | Admin systems, infrastructure, testing, performance, API reference |

Documentation served via backend API from `docs/` directory (bind-mounted in dev, baked into image for prod). Markdown rendered client-side with `marked`.

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
| Security | HTTP security headers, parameterized queries, rate limiting |
| Validation | Zod |
| Container | Docker Compose |

## Project Structure

```
blast-arena/
├── shared/                  # Shared types, constants, utilities
├── backend/
│   └── src/
│       ├── routes/          # REST endpoints (auth, lobby, user, admin, campaign, friends, messages, leaderboard, cosmetics, docs)
│       ├── game/            # Server game logic (GameLoop, GameState, BotAI, etc.)
│       ├── simulation/      # Bot simulation system
│       ├── db/              # MariaDB connection, migrations, redis
│       ├── services/        # Auth, user, admin, lobby, email, replay, settings, friends, party, presence, messages, elo, season, leaderboard, achievements, cosmetics, buddy
│       └── middleware/       # Auth, rate limiting, staff checks
├── frontend/
│   ├── index.html           # HTML + full CSS design system (5 themes)
│   └── src/
│       ├── scenes/          # Phaser scenes (Boot, Menu, Lobby, Game, HUD, GameOver)
│       ├── ui/              # DOM-based UI (Auth, Lobby, Room, Campaign, Admin, Views)
│       ├── game/            # Client renderers, effects, replay, gamepad
│       └── network/         # ApiClient, SocketClient, AuthManager
├── docs/                    # Detailed documentation (see below)
├── docker-compose.yml       # Production orchestration
└── docker-compose.dev.yml   # Development overrides
```

## Testing & Linting

```bash
npm test                    # Run all test suites (1846 tests)
npm run lint                # ESLint across all workspaces
npm run format:check        # Prettier format check
```

1846 tests across 58 suites: game logic (450), services (721), routes (486), middleware (36), simulation (69), utilities (72), frontend (42). See [docs/testing.md](docs/testing.md) for full test inventory, mocking patterns, and a guide for writing new tests.

## Documentation

- [Bot AI Developer Guide](docs/bot-ai-guide.md) — writing custom bot AIs
- [Bot AI Internals](docs/bot-ai-internals.md) — built-in BotAI decision engine
- [Campaign System](docs/campaign.md) — enemies, levels, editor, progress
- [Admin Panel & Systems](docs/admin-and-systems.md) — admin tabs, simulations, accounts
- [Replay System](docs/replay-system.md) — recording, playback, controls
- [Performance & Internals](docs/performance-and-internals.md) — optimizations, game logging
- [Infrastructure & Security](docs/infrastructure.md) — security, resilience, Docker, migrations
- [Testing](docs/testing.md) — test inventory, mocking patterns, writing new tests
- [API Reference](docs/openapi.yaml) — OpenAPI 3.0.3 specification for all REST endpoints
