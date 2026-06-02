# Infrastructure & Security

## Security

### CORS & CSP
- CORS restricted to `APP_URL` origin for both Express and Socket.io (not `origin: true`)
- Content-Security-Policy header in nginx: `default-src 'self'`, inline styles allowed, WebSocket connections. All fonts self-hosted (no external CDN)

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
- Admin announcement endpoints (toast/banner) rate-limited to 10 req/min
- `admin:settingsChanged` broadcasts scoped to `role:staff` room (not all sockets)

### Email Security
- Emails never stored in plaintext — HMAC-SHA256 with `EMAIL_PEPPER` env var (min 32 chars)
- DB stores `email_hash` (for lookups) + `email_hint` (masked display like `j***@g***.com`)
- Same pattern for `pending_email_hash`/`pending_email_hint` during email change
- `backfill-emails.ts` runs on startup to migrate any legacy plaintext rows
- Admin email search: exact match only (hashed) when query contains `@`

### Email Verification Enforcement
- Socket.io middleware queries DB for `email_verified` and rejects unverified users (`EMAIL_NOT_VERIFIED`)
- REST endpoints protected by `emailVerifiedMiddleware` (DB check, applied after `authMiddleware`)
- Exceptions: `GET /user/profile`, `PUT /user/language`, all auth routes

### Email Enumeration Prevention
- Registration with an existing email returns generic 400 (not 409) and sends a warning email to the existing account owner
- Email change with a taken address silently succeeds (no DB update) and sends a warning
- Username conflicts remain explicit (usernames are public)

### Nginx Rate Limiting
- `limit_req_zone` for API (30r/s), Socket.io (10r/s), auth (5r/s) — defense-in-depth alongside Express middleware

### Socket.io Auth Hardening
- Socket middleware reads `role` from database (not JWT) on each connection — demoted admins lose privileges immediately
- Sockets join `role:staff` room for scoped admin broadcasts
- Atomic password reset: single `UPDATE ... WHERE token = ? AND expires > NOW()` with `LAST_INSERT_ID(id)` — prevents TOCTOU race
- Refresh token rotation: atomic compare-and-swap (`UPDATE ... WHERE revoked = FALSE` + `affectedRows` check)
- Local co-op P2 validation: `campaign:start` requires short-lived socket token for positive P2 userIds

### Content Sanitization
- `DOMPurify.sanitize()` wraps all `marked.parse()` output in HelpUI
- `escapeHtml()` and `escapeAttr()` utilities for all user-generated content in DOM

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
- **Production**: `docker compose up --build -d` — Nginx binds to `127.0.0.1:8280` (loopback only) and is fronted by a host-level reverse proxy (TLS termination + forwarding). It is intentionally not exposed on all interfaces, so it must be reached via that proxy (or an SSH/port forward to `127.0.0.1:8280`).
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
12. `012_campaign_indexes.sql` — Campaign foreign key indexes (progress, user_state)
13. `013_friends_parties.sql` — Friendships, friend requests, user_blocks, party tables
14. `014_direct_messages.sql` — Direct messages table
15. `015_leaderboard_seasons.sql` — Seasons and season_elo tables for Elo tracking
16. `016_achievements_cosmetics.sql` — Cosmetics, achievements, user_cosmetics, user_achievements tables
17. `017_default_achievements.sql` — Seed data: 25 cosmetics + 47 default achievements
18. `018_player_xp_levels.sql` — XP and level columns on user_stats, level_milestone cosmetic unlock type
19. `019_enemy_ais.sql` — Enemy AI management table
20. `020_buddy_settings.sql` — Buddy mode settings per user (name, color, size)
21. `021_campaign_query_indexes.sql` — Indexes for campaign level/progress query patterns
22. `022_friendships_user_status_index.sql` — Composite index on friendships(user_id, status)
23. `023_covered_tiles.sql` — covered_tiles JSON column on campaign_levels
24. `024_puzzle_tiles.sql` — puzzle_config JSON column on campaign_levels
25. `025_campaign_replays.sql` — campaign_replays table for campaign replay storage
26. `026_custom_maps.sql` — custom_maps table for user-created maps
27. `027_user_language.sql` — language column on users for i18n preference
28. `028_tutorial_levels_seed.sql` — Tutorial campaign: 8 worlds, 21 levels
29. `029_email_hashing.sql` — email_hash, email_hint columns for HMAC-SHA256 storage
30. `030_finalize_email_hashing.sql` — Drop plaintext email columns, enforce NOT NULL on email_hash
