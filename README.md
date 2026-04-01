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
| **Deathmatch** | 2-8 | 5 min | Respawn after death, first to 15 kills wins |
| **King of the Hill** | 2-8 | 4 min | Control the 3x3 zone (moves every 30s with warning), 2 pts/tick, first to 100 points |

## Controls

| Keyboard | Gamepad | Action |
|----------|---------|--------|
| `WASD` / `Arrow Keys` | D-Pad / Left Stick | Move |
| `Space` | A | Place bomb |
| `E` | B | Detonate remote bombs / Toggle FIFO mode |
| `Q` | Y | Throw bomb (with Bomb Throw power-up) |
| `1`-`6` | — | Quick emote (when alive) |
| `` ` `` (backtick) | — | Open emote wheel (all 12 emotes) |
| `Escape` | — | Pause (campaign) / Leave game (multiplayer) |
| `1`-`9` | LB / RB | Spectate player (when dead) |

Walk into a bomb with the Kick power-up to send it sliding. Click a player name in the HUD to follow them as spectator. Press Escape during a multiplayer game to open the leave confirmation menu — leaving kills your player immediately and returns you to the lobby. If all human players leave, the remaining bot match speeds up to 5x and the room is removed from the lobby.

## Power-Ups

| Name | Effect |
|------|--------|
| **Bomb Up** | +1 max bombs (up to 8) |
| **Fire Up** | +1 explosion range (up to 8) |
| **Speed Up** | Faster movement (up to 3 levels) |
| **Shield** | Absorbs one hit from any source (no time limit, doesn't stack) |
| **Kick** | Walk into bombs to kick them |
| **Pierce Bomb** | Explosions pass through destructible walls |
| **Remote Bomb** | Bombs don't auto-detonate; press E to detonate all (10s safety max). Toggle FIFO mode (oldest first) by pressing E with no bombs placed |
| **Line Bomb** | Places a line of bombs in facing direction |
| **Bomb Throw** | Press Q to throw a bomb 3 tiles in facing direction, flying over walls and obstacles |

Killed players drop one random collected power-up at their death position. All power-up icons are procedurally drawn (no emoji) for consistent rendering across all platforms.

## Map Features

All optional, toggled per-room with individually selectable types: **Reinforced Walls** (2-hit destructible walls), **Map Events** (choose which events can occur — meteor strikes with 2-second visual warning, pulsing crosshair, exclamation mark, growing shadow followed by a falling meteor animation with screen shake and particle effects; power-up rain every 60s; wall collapse destroys a 3x3 area with dust warning; freeze wave converts a row or column to ice temporarily; bomb surge reduces all bomb fuse timers with a screen pulse; UFO abduction teleports a random player to a new location with tractor beam warning and brief invulnerability), **Hazard Tiles** (choose which hazard types appear — teleporter pairs with random A↔B transport, conveyor belts with animated moving stripes that auto-push players and bombs, vine slows movement, quicksand slows and kills over time, ice causes sliding momentum, lava kills instantly and detonates adjacent bombs, mud slows movement, spikes cycle between safe and lethal phases, dark rift teleports to a random tile). Hazard tiles are placed as clustered groups on the map. Special tiles and power-ups can be hidden under destructible walls — revealed when the wall is destroyed. **Puzzle Tiles** (campaign only): color-coded switches (toggle, pressure plate, one-shot) that open/close matching gates (explosions pass through gates in both states), and crumbling floors that collapse into pits after being stepped on — enables environmental puzzle design with bomb-triggered switches, timed pressure plate rushes, and path-planning challenges.

## Campaign

Campaign with hand-crafted levels grouped into themed worlds (9 themes: classic, forest, desert, ice, volcano, void, castle, swamp, sky — each with unique color palettes and tile textures). Defeat enemies (5 built-in movement patterns, boss phases, or custom AI scripts), earn 1-3 stars per level, track progress. Supports solo play, online co-op (2 players via party), local co-op (same keyboard/gamepads), and buddy mode. Local co-op features a setup modal for Player 2 identity (guest with custom name/color, or log in as a registered player with own cosmetics and cookie-based session persistence), control presets (WASD, Arrows, Numpad, Gamepad 1/2), and camera mode: shared auto-zoom, horizontal split-screen, or vertical split-screen. Split-screen auto-zooms to fill each viewport and shows off-screen partner arrows at viewport edges (aligned on the line connecting the two players). **Buddy Mode** is designed for playing with very young or inexperienced players — the buddy is a smaller, permanently invulnerable support character who can pass through destructible walls and bombs, pick up power-ups for P1, and place limited bombs (1 bomb, 1 fire range). Buddy name, color, and size (40-80%) are saved per-account and configurable in Settings > Preferences or the pre-launch modal. Selecting a level shows a themed pixel-art map preview. 3-2-1-GO countdown, pause menu (Escape key — Continue/Exit), win grace period for smooth transitions, and seamless retry/play-again with full mode preservation. Admins create enemy types and levels via a visual editor with resizable maps, WASD/arrow panning, zoom, and prominent spawn point markers. Enemy types are fully customizable: 6 body shapes (blob, spiky, ghost, robot, bug, skull), 4 eye styles, 8 visual addons (teeth, horns, tail, aura, crown, scar, wings, accessories like bow tie/monocle/bandana), primary/secondary colors, and size multiplier — all with live preview. Enemy types can optionally use custom AI scripts (TypeScript `decide()` method) that override built-in movement patterns — uploaded in the AI tab and assigned per enemy type with a difficulty setting. Ships with 6 default enemy AIs: Hunter (aggressive chaser), Patrol Guard (path follower), Bomber (area denial), Coward (flee + trap), Swarm (coordinated flanking), and Ambusher (wait + rush) — all scaling across easy/normal/hard difficulty. Export/import levels and enemy types as JSON (AI source bundled in exports). Ships with "Training Grounds" (3 intro levels) plus 8 tutorial worlds (21 levels) covering every power-up, hazard tile, special tile, and puzzle mechanic. See [docs/campaign.md](docs/campaign.md) and [docs/enemy-ai-guide.md](docs/enemy-ai-guide.md).

## Custom Maps

Create and share custom maps for multiplayer rooms. The built-in map editor (adapted from the campaign level editor) lets any authenticated user design maps with walls, destructible blocks, spawn points, teleporter pairs, and conveyor belts. Maps can be published for the community or kept private.

- **My Maps** sidebar view: list, edit, publish/unpublish, delete your maps
- **Map picker** in room creation: choose from your own maps or community-published maps (grouped in dropdown). Selecting a custom map auto-disables map size and wall density settings and shows a pixel-art map preview
- **Validation**: Maps must have odd dimensions (9-51), wall borders, 2-8 spawn points, and valid tile types. Validated both client-side and server-side
- **Play count tracking**: Each game played on a custom map increments its play counter
- **Community ratings**: Players can rate published maps 1-5 stars. Maps sorted by average rating on the community listing. Star ratings shown in room creation dropdown

## Bot AI

Three difficulty tiers optimized through 20,000+ simulation games:
- **Easy**: Low awareness, shallow escape, intentional mistakes
- **Normal**: BFS pathfinding, dynamic danger assessment, competitive
- **Hard**: Deep search, chain reaction awareness, shield aggression, dominant

All bots feature team awareness (won't hunt, bomb, or kick teammates in team mode) and smart power-up value scoring (prioritize shield > speed > kick/throw > pierce > remote/line > fire > bomb; skip already-maxed power-ups). Admins can upload custom AI implementations as TypeScript files. See [docs/bot-ai-guide.md](docs/bot-ai-guide.md) for the developer guide and [docs/bot-ai-internals.md](docs/bot-ai-internals.md) for built-in AI details.

## Leaderboard & Ranking

Elo-based competitive ranking across all game modes. Standard Elo formula with adaptive K-factor. Seasonal system with admin-defined dates, history archiving, and hard/soft resets. Six rank tiers (Bronze through Champion) with optional sub-tiers (I/II/III) — all admin-configurable. Leaderboard view with season filtering (hidden when no seasons) and clickable profiles leading to full-page profile views. Rank and level badges displayed next to usernames in lobby. Elo deltas and XP gains shown on game-over screen. **Match History** sidebar view shows recent matches with mode, result, K/D, placement, duration, and per-mode stat breakdown (win rate, avg kills) with pagination.

## Player XP & Levels

XP-based leveling system separate from Elo. Earn XP from kills, bomb placements, power-up collection, match completion, and placement bonuses. Level curve: each level requires progressively more XP. Level milestones can unlock exclusive cosmetics. Admin-configurable XP multiplier. Level displayed on leaderboard, profiles, lobby, and game-over screen with progress bar.

## Achievements & Cosmetics

Admin-configurable achievement system with four condition types: cumulative stats, per-game feats, mode-specific milestones, and campaign progress. Ships with a default pack of 47 achievements and 25 cosmetic rewards across combat, victory, dedication, mode mastery, and campaign categories. Achievement progress tracking with progress bars on profiles (own profile only). Achievements can reward cosmetics. Four cosmetic types: player colors, eye styles, movement trails, and bomb skins. Unlocked via achievements, campaign stars, level milestones, or by default. Live preview panel in settings shows equipped player sprite, bomb, and trail. Export/import achievements and cosmetics as JSON. Full-page profile views show rank, level, stats grid, season history, achievements, and equipped cosmetics with a privacy toggle.

## Admin Panel

| Tab | Access | Key Features |
|-----|--------|-------------|
| Dashboard | Admin | Stats, server settings (recordings, registration, email/SMTP, chat modes, XP multiplier, default theme, GitHub/imprint display), game/simulation defaults, revoke all sessions |
| Users | Staff | Search, roles, deactivate, delete, password reset, revoke sessions |
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
- **Sidebar Navigation**: Persistent collapsible left sidebar with "ear" toggle tab. All lobby views (Rooms, Campaign, My Maps, Friends, Messages, Party, Leaderboard, Settings, Help, Admin, Create Room, Profile) render inline in the main content area — no overlays or slide-out panels.
- **Friends**: Full-page view with tabs (Friends/Requests/Blocked), search, friend cards with online status indicators.
- **Online Presence**: See friends' real-time status (online, in lobby, in game, in campaign). Presence tracked via Redis with 120s TTL.
- **Parties**: Full-page view with two states: empty (create party) / active (member cards, chat, invites). When the party leader joins a room, all members auto-follow.
- **Room Invites**: Invite friends directly to your current room. Invite toasts with Accept/Decline buttons (30s auto-dismiss).
- **Lobby Chat**: Global ephemeral chat for all connected lobby users. Collapsible panel bottom-right. Users can hide via Settings > Preferences > Chat toggle.
- **Direct Messages**: Full-page two-column view (conversation sidebar + active conversation). Persistent messages between friends with unread badges, real-time delivery, read receipts.
- **In-Game Emotes**: 12 emotes (GG, Help!, Nice!, Oops, Taunt, Thanks, Wow, Sorry, Let's Go!, No!, Wait, Boom!) — keys 1-6 for quick emotes, backtick (`) opens radial emote wheel for all 12. Floating bubbles above player sprites with 3s cooldown.
- **Spectator Chat**: Dead players can text chat during live games. Collapsible panel bottom-left, role-colored usernames, 3/sec rate limit.
- **Rematch Voting**: After game over, players vote for rematch. >50% triggers auto-restart with same settings. 30s timeout. Solo games (1 human + bots) show direct "Play Again" button instead of voting.
- **Admin Chat Controls**: All chat features (party chat, lobby chat, DMs, emotes, spectator chat) individually configurable: everyone (default), staff only, admin only, or fully disabled.
- **Imprint & GitHub**: Admin-toggled links displayed on the login page footer and as right-aligned items in the Help tab bar. Imprint text editable in Dashboard; shown as modal on login, inline tab in Help. GitHub link opens repo in new tab.
- **Account Deletion**: Self-service account deletion in Settings > Account. Password confirmation required. Permanently removes all user data (stats, replays, maps, messages, friends). Admin accounts are protected from self-deletion.

## Game Replays

Games recorded as gzipped JSON with video-player controls (play/pause, seek, 0.5-4x speed), synced event log panel, and click-to-follow spectating. Access via Matches tab or Simulations tab. Campaign games also record replays (with enemy rendering) when recordings are enabled — access via Campaign tab Replays sub-view. See [docs/replay-system.md](docs/replay-system.md).

## In-Game Help & Documentation

Full-page Help view accessible from the lobby sidebar. Seven tabs with role-based filtering:

| Tab | Access | Content |
|-----|--------|---------|
| Getting Started | All | Keyboard + gamepad controls, basic mechanics, spectator mode |
| Power-Ups | All | All 9 power-ups with Canvas2D inline sprites matching in-game textures |
| Game Modes | All | 6 modes with player counts, rules, win conditions |
| Map Features | All | Reinforced walls, dynamic events, hazard tiles with Canvas2D tile previews, theme variant showcase (all 9 campaign themes) |
| Guides | All | Rendered markdown docs: Campaign, Replays, Bot AI (collapsible sections) |
| Level Editor | Staff | Visual tile reference (27 tile types with Canvas2D icons) + campaign system docs |
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
- **Procedural audio**: All SFX synthesized via Web Audio API (explosions, bombs, power-ups, death, countdown, victory/defeat) — no external audio files. Volume controls in Settings
- **In-game minimap**: Canvas2D overlay showing tiles, players, bombs, explosions, zone boundaries, and KOTH hill. Toggleable in settings
- **Kill feed with cause**: Death causes tracked (bomb, zone, lava, quicksand, spikes, dark rift, self, disconnect) with icons in kill feed and death banner
- **Monorepo**: npm workspaces — `shared/` (types + constants), `backend/` (server), `frontend/` (client)
- **Self-hosted assets**: All fonts, sounds, and static resources served locally — no external CDN dependencies

## Internationalization

Full i18n support via [i18next](https://www.i18next.com/). All UI strings are extracted into JSON locale files — no hardcoded text in source code.

| Language   | Code | Status |
|------------|------|--------|
| English    | `en` | Complete |
| German     | `de` | Complete |
| French     | `fr` | Complete |
| Spanish    | `es` | Complete |
| Italian    | `it` | Complete |
| Portuguese | `pt` | Complete |
| Polish     | `pl` | Complete |
| Dutch      | `nl` | Complete |
| Turkish    | `tr` | Complete |
| Swedish    | `sv` | Complete |
| Norwegian  | `nb` | Complete |
| Danish     | `da` | Complete |

- **Language selection**: Flag dropdown on login screen + Settings > Preferences dropdown. Auto-detects browser language on first visit
- **12 namespaces** organize translations: `ui`, `admin`, `auth`, `campaign`, `editor`, `help`, `game`, `common`, `errors`, `hud`, `server`, `email`
- **Email i18n**: All transactional emails (verification, password reset, email change, warnings, test) sent in the user's preferred language
- **Adding a new language**: Create translated JSON files in `frontend/src/i18n/locales/{code}/`, `shared/src/i18n/locales/{code}/`, and `backend/src/i18n/locales/{code}/`, then register the language code in the i18n config files
- **RTL ready**: Document direction attribute set dynamically for RTL languages

## SEO & Web Standards

- Meta tags: description, keywords, Open Graph, Twitter Card for social media previews
- JSON-LD structured data (`VideoGame` schema) for rich search results
- Self-hosted fonts (Chakra Petch + DM Sans) as woff2 in `frontend/public/fonts/`, critical fonts preloaded
- SVG favicon, web app manifest (PWA-ready), robots.txt, sitemap.xml
- Noscript fallback with branded content for JS-disabled crawlers
- Full security header suite: CSP (with Trusted Types, script hashes, frame-ancestors), HSTS, COOP, X-Frame-Options, Permissions-Policy — all self-hosted, no external domains
- Nginx rate limiting: API (30r/s), Socket.io (10r/s), auth (5r/s) — defense-in-depth with Express middleware
- Modal focus trapping for WCAG 2.1 AA accessibility, keyboard-navigable interactive lists

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Phaser 3 + TypeScript + Vite |
| Backend | Node.js + Express + TypeScript |
| Real-time | Socket.io |
| Database | MariaDB 11 + Redis 7 |
| Auth | JWT + bcrypt + httpOnly cookies, HMAC-SHA256 email hashing, email verification enforcement, email enumeration prevention |
| Security | CSP + HSTS + COOP + Trusted Types, parameterized queries, nginx + Express rate limiting, Zod socket event validation, DOMPurify, email verification on REST + socket, atomic token operations, role-from-DB socket auth |
| Validation | Zod |
| Container | Docker Compose |

## Project Structure

```
blast-arena/
├── shared/                  # Shared types, constants, utilities
├── backend/
│   └── src/
│       ├── routes/          # REST endpoints (auth, lobby, user, admin, campaign, custom-maps, friends, messages, leaderboard, cosmetics, docs)
│       ├── game/            # Server game logic (GameLoop, GameState, BotAI, etc.)
│       ├── simulation/      # Bot simulation system
│       ├── db/              # MariaDB connection, migrations, redis
│       ├── services/        # Auth, user, admin, lobby, email, replay, settings, friends, party, presence, messages, elo, season, leaderboard, achievements, cosmetics, buddy, custom-maps
│       └── middleware/       # Auth, rate limiting, staff checks
├── frontend/
│   ├── index.html           # HTML + full CSS design system (11 themes)
│   ├── public/              # Static assets (favicon, fonts, robots.txt, sitemap, manifest)
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
npm test                    # Run all test suites (2385 tests)
npm run lint                # ESLint across all workspaces
npm run format:check        # Prettier format check
```

2385 tests across 78 suites: game logic (599), services (854), routes (537), handlers (62), middleware (55), simulation (69), utilities (165), frontend (42). See [docs/testing.md](docs/testing.md) for full test inventory, mocking patterns, and a guide for writing new tests.

## Documentation

- [Bot AI Developer Guide](docs/bot-ai-guide.md) — writing custom bot AIs
- [Bot AI Internals](docs/bot-ai-internals.md) — built-in BotAI decision engine
- [Enemy AI Developer Guide](docs/enemy-ai-guide.md) — writing custom campaign enemy AIs
- [Campaign System](docs/campaign.md) — enemies, levels, editor, progress
- [Admin Panel & Systems](docs/admin-and-systems.md) — admin tabs, simulations, accounts
- [Replay System](docs/replay-system.md) — recording, playback, controls
- [Socket.io Events](docs/socket-events.md) — real-time event reference (86 events)
- [Performance & Internals](docs/performance-and-internals.md) — optimizations, game logging
- [Infrastructure & Security](docs/infrastructure.md) — security, resilience, Docker, migrations
- [Testing](docs/testing.md) — test inventory, mocking patterns, writing new tests
- [API Reference](docs/openapi.yaml) — OpenAPI 3.0.3 specification for all REST endpoints

## License

MIT License. See [LICENSE](LICENSE) for details.
