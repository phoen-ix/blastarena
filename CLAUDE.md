# BlastArena

Multiplayer online grid-based explosive arena game.

## Project Structure
- Monorepo with npm workspaces: `shared/`, `backend/`, `frontend/`
- Docker Compose for orchestration (MariaDB, Redis, Node.js backend, Nginx)

## Development
```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Tech Stack
- Backend: Node.js + Express + TypeScript + Socket.io
- Frontend: Phaser.js + TypeScript + Vite
- Database: MariaDB 11 + Redis 7
- Shared types between frontend/backend via workspace

## Key Patterns
- Server-authoritative game logic; client only renders + sends inputs
- Grid-based movement: players occupy exactly one tile at a time
- Movement cooldown system (MOVE_COOLDOWN_BASE ticks, reduced by speed power-ups)
- JWT (access token in memory) + httpOnly cookie (refresh token) auth
- Cookie `secure` flag derived from APP_URL (not NODE_ENV) for HTTP/HTTPS compatibility
- Zod for request validation
- All game constants in shared/src/constants/
- Socket.io listeners use one-shot pattern for game:start to prevent leaks across scene transitions
- Bot players use negative IDs (-(i+1)) to avoid DB conflicts; skipped in DB writes
- Bot count auto-capped to maxPlayers - humanPlayers (both frontend and backend)
- Singleplayer: 1 human + 1+ bots is enough to start a game
- Friendly fire config: when OFF, same-team explosions don't damage teammates (self-damage still applies)
- Map dimensions should be odd numbers for proper indestructible wall grid pattern

## Game Architecture
- 20 tick/sec server game loop (GameLoop.ts -> GameState.ts)
- GameState.processTick(): bot AI -> inputs -> movement -> bomb slide -> bomb timers -> explosions -> collisions -> power-ups -> zone -> win check
- Bomb kick: player with hasKick walking into a bomb sets bomb.sliding direction; sliding bombs advance 1 tile/tick until blocked
- BotAI: difficulty-aware (easy/normal/hard) with configurable awareness, aggression, escape depth, reaction delay, and kick usage
- Bot difficulty set per-room via MatchConfig.botDifficulty; defaults to 'normal'; UI dropdown hidden when bots = 0
- BotAI escape logic: BFS through danger cells to find nearest safe cell; canEscapeAfterBomb and flee use the same findEscapeDirection BFS so the bot follows the validated escape path
- BotAI movement decisions only run when player.canMove() to prevent oscillation between hunt/seek_wall
- Self-kills subtract 1 from kill score (owner.kills decremented, owner.selfKills incremented)
- Game over placements sorted by kills descending, tiebreak by survival placement
- Grace period: 30 ticks (1.5s) after win condition before status='finished' to show final explosions
- Dead players enter spectator mode with free camera pan (WASD/arrows)
- Camera follows local player with smooth lerp when map exceeds viewport

## Game Logging
- JSONL game logs written to ./data/gamelogs/ (bind-mounted from container)
- Logs every bot decision, kill, bomb placement/detonation, and tick snapshots (every 5 ticks)
- Filename format: `{ISO-timestamp}_{roomCode}_{gameMode}_{playerCount}p.jsonl`

## Testing
```bash
npm test
```

## Docker
- Production: `docker compose up --build -d`
- Only nginx exposes a port (APP_EXTERNAL_PORT, default 8080)
- Data persists in ./data/ (bind mounts)
- Nginx serves no-cache headers for index.html to prevent stale frontend after deploys
