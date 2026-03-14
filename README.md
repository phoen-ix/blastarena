# BlastArena

A multiplayer online grid-based explosive arena game. Navigate a grid, place bombs to destroy walls and opponents, collect power-ups, and compete in Free-for-All, Teams, or Battle Royale modes.

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

- **Free-for-All**: Last player standing wins
- **Teams**: Two teams compete; last team standing wins
- **Battle Royale**: Shrinking zone forces players together

## Controls

- **Arrow Keys / WASD**: Move
- **Space**: Place bomb
- **Walk into a bomb** (with Kick power-up): Kicks the bomb, sending it sliding until it hits a wall, player, or another bomb

## Features

- **Singleplayer & Multiplayer**: Play solo against bots or with friends; 1 human + bots is enough to start
- **Configurable rooms**: Map size (square grids from 11x11 to 31x31), match time, wall density, power-up types and drop rates
- **Friendly fire toggle**: Enable or disable teammate damage in Teams mode
- **Bot players**: Add 1-6 AI bots to any room (auto-capped to fit max players); bots dodge explosions, seek destructible walls, and place bombs strategically
- **Power-ups**: Bomb Up, Fire Up, Speed Up, Shield, Bomb Kick - each individually toggleable per room
- **Live HUD**: Countdown timer, alive player list (dead players removed from view)
- **Camera follow**: Smooth scrolling camera that follows your player on maps larger than the viewport
- **Persistent sessions**: Login survives container rebuilds via httpOnly refresh token cookies
- **Match history**: Stats tracked per player (kills, deaths, bombs placed, power-ups collected, placements)

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
