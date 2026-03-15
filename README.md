# BlastArena

A multiplayer online grid-based explosive arena game. Navigate a grid, place bombs to destroy walls and opponents, collect power-ups, and compete across six game modes with particle effects, screen shake, and animated visuals.

## Quick Start

```bash
# Clone and configure
cp .env.example .env
# Edit .env with your settings (set JWT_SECRET and DB_PASSWORD)

# Development
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Production
docker compose up --build -d
```

Open `http://localhost:8080` in your browser.

## Game Modes

- **Free-for-All**: Last player standing wins (2-8 players, 3 min)
- **Teams**: Two teams compete; last team standing wins (4-8 players, 4 min)
- **Battle Royale**: Shrinking zone forces players together (4-8 players, 5 min)
- **Sudden Death**: All players start maxed out, one hit kills (2-8 players, 2 min)
- **Deathmatch**: Respawn after death, most kills wins (2-8 players, 5 min)
- **King of the Hill**: Control center zone for points, first to 100 wins (2-8 players, 4 min)

## Controls

- **Arrow Keys / WASD**: Move
- **Space**: Place bomb
- **E**: Detonate remote bombs (requires Remote Bomb power-up)
- **Walk into a bomb** (with Kick power-up): Kicks the bomb, sending it sliding until it hits a wall, player, or another bomb
- **1-9** (when dead): Follow the Nth alive player
- **Click player name** (when dead): Follow that player

## Features

- **Singleplayer & Multiplayer**: Play solo against bots or with friends; 1 human + bots is enough to start
- **Configurable rooms**: Map size, match time, wall density, power-up types/rates, hazard tiles, map events, reinforced walls
- **Team management**: Assign players and bots to Team Red or Team Blue in the lobby; team-colored sprites, name labels, and HUD grouping in-game
- **Friendly fire toggle**: Enable or disable teammate damage in Teams mode
- **Bot players**: Add up to 7 AI bots to any room with Easy/Normal/Hard difficulty
- **Bot AI**: BFS pathfinding, escape planning through danger zones, wall-seeking, enemy hunting, power-up collection
- **8 Power-ups**: Bomb Up, Fire Up, Speed Up, Shield, Bomb Kick, Pierce Bomb, Remote Bomb, Line Bomb
- **Visual effects**: Animated explosions with particles, screen shake, fuse sparks, wall debris, shield aura, death particles, dust trails
- **Per-user visual settings**: Toggle animations, screen shake, and particles via lobby Settings button
- **Live HUD**: Countdown timer, player stats bar, kill feed, player list, spectator banner
- **In-game help**: Controls and power-up guide accessible from the lobby Help button
- **Spectator mode**: Dead players can freely pan the camera, click a player name, or press 1-9 to follow alive players
- **Map features**: Reinforced walls (2-hit), dynamic meteor strikes, power-up rain, teleporters, conveyor belts
- **Game over context**: Shows what ended the game (last survivor, time's up, kill target, etc.)
- **Play Again**: Rematch button on the game over screen resets the room
- **Camera follow**: Smooth scrolling camera that follows your player
- **Connection resilience**: Auto-reconnects on connection drops; auto-refreshes on new server builds; custom 502 page during container rebuilds
- **Scoring**: Kills-based ranking; self-kills subtract from your score
- **Persistent sessions**: Login survives container rebuilds via httpOnly refresh token cookies
- **Match history**: Stats tracked per player (kills, deaths, bombs placed, power-ups collected, placements)
- **Game logging**: Detailed JSONL game logs for analysis and debugging
- **Account management**: Users can change their username (uniqueness-checked), display name, and email address from the lobby. Email changes require clicking a confirmation link sent to the new address (24h expiry).
- **Admin panel**: Full-screen admin panel with dashboard stats, user management (role change, deactivate, delete, create), match history browser, active room control (kick/close/spectate/message), admin action audit log, and announcements (toast broadcast + persistent lobby banner). Moderators get limited access.

## Architecture

```
┌─────────┐     ┌──────────┐     ┌─────────┐
│  Nginx   │────>│ Backend  │────>│ MariaDB │
│ (static  │     │ (Express │     └─────────┘
│  + proxy)│     │  +Socket │     ┌─────────┐
└─────────┘     │   .io)   │────>│  Redis   │
                └──────────┘     └─────────┘
```

- **Server-authoritative**: All game logic runs server-side at 20 ticks/sec. Clients send inputs and render state.
- **Grid-based movement**: Players occupy exactly one tile with movement cooldowns (speed power-ups reduce cooldown).
- **Monorepo**: npm workspaces with `shared/`, `backend/`, `frontend/` packages.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express + TypeScript |
| Frontend | Phaser.js + TypeScript + Vite |
| Database | MariaDB 11 |
| Cache/Sessions | Redis 7 |
| Real-time | Socket.io |
| Web server | Nginx (static + reverse proxy) |
| Auth | JWT access tokens + httpOnly refresh cookies + bcrypt |

## Configuration

All settings via `.env` (see `.env.example`). Key variables:

- `JWT_SECRET` - Required, min 16 chars
- `DB_PASSWORD` / `DB_ROOT_PASSWORD` - Database credentials
- `APP_EXTERNAL_PORT` - Nginx port (default 8080)
- `APP_URL` - Public URL (controls secure cookie flag)
