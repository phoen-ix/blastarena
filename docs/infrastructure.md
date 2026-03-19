# Infrastructure & Security

## Security

### CORS & CSP
- CORS restricted to `APP_URL` origin for both Express and Socket.io (not `origin: true`)
- Content-Security-Policy header in nginx: `default-src 'self'`, inline scripts/styles allowed, fonts from Google, WebSocket connections

### XSS Prevention
- All user-generated content (usernames) escaped via `escapeHtml()` before innerHTML insertion (HUD kill feed, player list)
- No inline `onclick` handlers — all event handlers use `addEventListener` for CSP compatibility
- Admin `roomMessage` server-side sanitization: type check, empty check, 500-char length limit

### Rate Limiting
- Socket rate limiter: in-memory sliding window per socket ID (game:input 30/sec, room:create 2/sec, room:join 5/sec)
- Cleanup: entries removed on socket disconnect + periodic 60s sweep of stale entries (prevents memory leak)
- HTTP rate limiter in-memory fallback: when Redis is unavailable, continues via in-memory sliding window instead of failing open

### Input Validation
- Zod schemas on all HTTP routes
- Runtime validation on `game:input` socket payload: direction, action, seq, tick fields validated at runtime (TypeScript types are compile-time only)

### Authentication
- JWT access tokens in-memory only, refresh token in httpOnly sameSite:strict cookie with secure flag derived from APP_URL
- Password hashing: bcrypt with 12 salt rounds
- Refresh token rotation with reuse detection
- JWT_SECRET minimum 16 chars enforced via Zod config validation

### Database Security
- All queries use parameterized statements via mysql2 (SQL injection prevention)

### Admin Security
- All admin actions logged to `admin_actions` table for audit trail
- `staffMiddleware` and `adminOnlyMiddleware` for route protection
- Deactivated users blocked from login and token refresh
- Self-protection: admins cannot deactivate/delete themselves

---

## Connection Resilience

### Reconnection
- Socket.io reconnects indefinitely (1-5s backoff) with "Reconnecting..." overlay
- Overlay starts health polling (`/api/health` every 3s) — when backend responds, page auto-reloads (handles stale Socket.io state, expired tokens, nginx DNS cache)
- On reconnect, client fetches `/api/health` and compares `buildId` (server start timestamp). If different, page auto-refreshes

### Disconnect Grace Period
- Players get 10 seconds (200 ticks) to reconnect during a game before being killed
- `GameRoom.disconnectedPlayers` tracks pending disconnects; `checkDisconnectGracePeriods()` runs each tick
- On reconnect, `handlePlayerReconnect()` cancels the grace timer and player resumes
- During grace period, player is NOT removed from the lobby room — only on grace expiry or game end

### Game Reconnection
- Server auto-detects if player was in an active game (`isPlayerDisconnected()`) and rejoins them to socket room
- Emits `game:start` with full state so client can initialize GameScene directly
- LobbyScene registers early `game:start` listener in `create()` — if server sends game state on connect, client skips lobby

### Stale Room Cleanup
- `room:create` and `room:join` handlers check for existing room membership and clean up before creating/joining — prevents zombie games

### Bot-Only Game Termination
After all disconnect grace periods resolve, if no human players remain alive, game ends with `finishReason = 'All players disconnected'` and match status saved as `'aborted'`.

`GameState.killPlayer()` handles disconnect-timeout deaths with proper placement tracking, kill logging, and tickEvents emission.

### 502 Page
- Nginx serves custom 502 page (`docker/nginx/502.html`) during container rebuilds
- Auto-polls and refreshes when app is back (detects real app by checking for `game-container` in response)

---

## Docker

### Commands
- **Production**: `docker compose up --build -d` — only Nginx exposes a port (`APP_EXTERNAL_PORT`, default 8080)
- **Development**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build` — hot reload, DB/Redis ports exposed

### Services
MariaDB 11, Redis 7, Node.js backend, Nginx (static + reverse proxy)

### Data Persistence
All data persists in `./data/` via bind mounts:
- `./data/gamelogs:/app/gamelogs`
- `./data/replays:/app/replays`
- `./data/simulations:/app/simulations`
- `./data/ai:/app/ai`
- MariaDB and Redis data volumes

### Other
- Nginx serves `no-cache` headers for `index.html` to prevent stale frontend after deploys
- `prepare` script uses `husky || true` to avoid failures in Docker builds

---

## Database Migrations

Migrations in `backend/src/db/migrations/` run automatically on server start:

1. `001_initial.sql` — Users, refresh_tokens, login_attempts, matches, match_players, user_stats, admin_actions
2. `002_admin_panel.sql` — User soft-delete, game_mode ENUM expansion (6 modes), announcements
3. `003_user_profile.sql` — Pending email change columns
4. `004_remove_ban.sql` — Drop legacy ban/display_name columns
5. `005_server_settings.sql` — Server settings key-value table
6. `006_default_settings.sql` — Game creation and simulation default settings
7. `007_bot_ais.sql` — Bot AI management table
8. `008_campaign.sql` — Campaign tables (enemy types, worlds, levels, progress, user state)
9. `009_campaign_seed.sql` — Seed data: 3 enemy types + "Training Grounds" world with 3 levels
10. `010_campaign_par_time.sql` — Par time column for campaign levels
11. `011_fix_campaign_tile_types.sql` — Fix seed tile types
