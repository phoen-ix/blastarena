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
- Movement cooldown system (MOVE_COOLDOWN_BASE ticks, reduced by speed power-ups). Enemy speed uses divisor formula: `Math.round(MOVE_COOLDOWN_BASE / speed)` — speed 0.1 = 50 tick cooldown, speed 1 = 5 ticks, speed 5 = 1 tick
- JWT (access token in memory) + httpOnly cookie (refresh token) auth
- Cookie `secure` flag derived from APP_URL (not NODE_ENV) for HTTP/HTTPS compatibility
- ApiClient 401 interceptor: auto-refreshes token and retries, but auth endpoints (login/register) use `skipAuthRetry` to pass 401 errors through directly — prevents logout side effects from corrupting session state
- Vite `allowedHosts` derived from `APP_URL` env var (hostname extracted at config load time), passed via docker-compose `environment`
- Zod for request validation; `ApiClient` appends field-level `details` from validation errors to the error message
- Redis room join uses atomic Lua script (`JOIN_ROOM_LUA`) to prevent race conditions exceeding maxPlayers
- `listRooms()` uses `SCAN` + `MGET` pipeline instead of blocking `KEYS` + sequential `GET`
- All game constants in shared/src/constants/
- Socket.io listeners use one-shot pattern for game:start to prevent leaks across scene transitions
- Bot players use negative IDs (-(i+1)) to avoid DB conflicts; skipped in DB writes
- Bot count auto-capped to maxPlayers - humanPlayers (both frontend and backend); CreateRoomModal auto-raises maxPlayers when bot count exceeds capacity
- Singleplayer: 1 human + 1+ bots is enough to start a game
- Friendly fire config: when OFF, same-team explosions don't damage teammates (self-damage still applies)
- Map dimensions should be odd numbers for proper indestructible wall grid pattern
- Branding: "BLAST" in white, "ARENA" in orange (`--primary`). In HTML use `<span>BLAST</span>ARENA` where parent is `color: var(--primary)` and `span` is `color: var(--text)`. In Phaser canvas (MenuScene) use two separate text objects side by side
- Game canvas uses `Phaser.Scale.RESIZE` mode to fill the full browser viewport. Camera bounds auto-adjust: small maps are centered, large maps scroll with the player via smooth lerp
- Player sprite interpolation factor is 0.45 (snappy grid movement, not floaty)
- Modal overlay uses `position: fixed` to prevent backdrop-filter repaint flashes from sibling DOM mutations

## Frontend Architecture
- **Design System ("INFERNO")**: All CSS in `frontend/index.html` using CSS custom properties (`:root` vars). Colors: `--primary` (#ff6b35 hot orange), `--accent` (#00d4aa teal), `--danger` (#ff3355), `--success` (#00e676), `--warning` (#ffaa22), `--info` (#448aff). Backgrounds: `--bg-deep` (#080810) through `--bg-hover` (#24243e). Typography: Chakra Petch (display/headings) + DM Sans (body) via Google Fonts. Team colors: `--team-red` (#ff4466), `--team-blue` (#448aff). Always use CSS variables in inline styles (e.g. `var(--primary)` not hardcoded hex) for consistency.
- **Composed rendering**: GameScene.ts delegates to renderer classes in `frontend/src/game/`:
  - `TileMap.ts` — tile grid, floor variants, destruction animation, teleporters/conveyors/cracked walls
  - `PlayerSprite.ts` — directional eyes, shield aura, squash/stretch movement (`activeMoveAnim` Set prevents tween stacking), dust particles, death effects
  - `BombSprite.ts` — pulsing scale tween; remote bombs (blue) add alpha blink; fuse sparks, urgency flash
  - `ExplosionSprite.ts` — expansion wave, sustain pulse, fade phase, fire/smoke particles
  - `PowerUpSprite.ts` — floating animation, distinctive icons per type
  - `ShrinkingZone.ts` — Battle Royale danger zone overlay (Graphics path with circle hole)
  - `HillZone.ts` — KOTH hill overlay (pulsing gold/green fill, corner markers, diamond center)
  - `EffectSystem.ts` — screen shake, debris particles, collection popups via socket events
  - `CountdownOverlay.ts` — animated "3, 2, 1, GO!" countdown
  - `GamepadManager.ts` — gamepad input polling with deadzone, D-pad/stick, just-pressed tracking
  - `Settings.ts` — per-user visual settings (animations, shake, particles) in localStorage
  - `EnemySprite.ts` / `EnemyTextureGenerator.ts` — campaign enemy rendering (see [docs/campaign.md](docs/campaign.md))
- **Procedural textures**: All sprites generated in `BootScene.generateTextures()` — no external image assets. Player textures: 4 directional variants with eyes per color. Power-up textures: Canvas2D emoji icons (💣🔥⚡🛡️👢💥📡🧨) on rounded-rect backgrounds. Enemy textures on-demand via `EnemyTextureGenerator.ts`
- **Particle textures**: `particle_fire`, `particle_smoke`, `particle_spark`, `particle_debris`, `particle_star`, `particle_shield` generated in BootScene
- **HUD**: DOM-based overlay in HUDScene.ts with timer, player list, kill feed, stats bar (bottom-left), spectator banner. KOTH mode: scores sorted descending with crown icon
- Settings and Help are in the lobby header (LobbyUI), not in-game HUD, to avoid overlapping player names
- **SettingsUI** (`frontend/src/ui/SettingsUI.ts`): Full-screen tabbed panel (reuses `admin-container` CSS) with Account tab (username, email, password) and Preferences tab (visual settings). Replaces the old separate Account and Settings modals — single "Settings" button in lobby header. Pattern matches AdminUI (tabs, switchTab, gamepad context).
- **HelpUI** (`frontend/src/ui/HelpUI.ts`): Full-screen tabbed panel (reuses `admin-container` CSS) with 7 tabs: Getting Started, Power-Ups, Game Modes, Map Features, Guides, Level Editor (staff), Admin Docs (staff). Power-Ups tab uses Canvas2D inline `<canvas>` elements via `frontend/src/utils/powerUpCanvas.ts` (same drawing logic as BootScene). Guides/Admin Docs tabs fetch markdown from `GET /api/docs/:filename` and `GET /api/docs/admin/:filename` endpoints, rendered with `marked` library into `.help-markdown` styled containers. Collapsible `<details>` sections for each doc. Role-based tab filtering: regular users see 5 tabs, staff see all 7. Markdown response cache prevents re-fetching on tab revisit.
- Countdown synced between server and client: GameLoop holds `status: 'countdown'` for 36 ticks (1.8s) while CountdownOverlay plays "3, 2, 1" — gameplay starts on "GO!". Both client and server block inputs during countdown.
- **Gamepad support**: Xbox/standard gamepad via Phaser plugin. D-pad/left stick for movement (0.3 deadzone), A=bomb, B=detonate, LB/RB=cycle spectate. Actions latched in `pendingGamepadAction` to survive 50ms tick throttle. Keyboard takes priority.
- **Gamepad UI navigation**: `UIGamepadNavigator` singleton enables full controller navigation of DOM menus. Spatial navigation via `getBoundingClientRect()` (5x cross-axis penalty). Focus context stack for nested UI. Custom `.gp-dropdown` overlay for `<select>`. Disabled during gameplay. See source for full details.
- **Real-time lobby**: Room list auto-updates via `room:list` socket broadcast on every room mutation — no manual refresh needed

## Solo Campaign System
Single-player campaign with hand-crafted levels, enemies, and bosses. Campaign uses `GameLoop` with `skipCountdown: true`. `CampaignGame.ts` wraps `GameStateManager` with `customMap`. `GameStateManager.checkWinCondition()` and time limit check skip `campaign` mode. Frontend detects `campaignMode` registry flag for different socket events (`campaign:state`/`campaign:input`). Level editor: camera viewport offset avoids toolbar overlap, WASD/arrow panning, resizable map dimensions (odd, 7-51) with content-preserving resize and undo support. `initEmptyMap()` places a default spawn tile at (1,1). Spawn tiles rendered with solid dark teal background, bright border, diamond marker, and bold "S" label (`spawnLabels` Text array cleaned up in shutdown/restore). `CampaignGame.buildGameMap()` has multi-layer spawn fallback: level spawns → scan tiles for 'spawn' → first empty tile → (1,1). Empty tiles array also triggers default map generation. Back button from level editor sets `returnToAdmin: 'campaign'` registry flag so LobbyScene re-opens admin panel on Campaign tab. `AdminUI` constructor accepts optional `initialTab` parameter. See [docs/campaign.md](docs/campaign.md) for full details.

## Campaign Export/Import
JSON-based export/import for levels and enemy types. Export formats use `_format` and `_version` fields for validation. Types defined in `shared/src/types/campaign.ts` (`LevelExportData`, `EnemyTypeExportData`, `LevelBundleExportData`).
- **Backend endpoints** (`backend/src/routes/campaign.ts`): `GET .../levels/:id/export` (single level), `GET .../levels/:id/export-bundle` (level + referenced enemy types), `GET .../enemy-types/:id/export`. `POST .../levels/import` (two-phase: first call returns `conflicts` array for unresolved enemy type IDs, second call with `enemyIdMap` resolves via create/use-existing/skip). `POST .../enemy-types/import`.
- **Admin CampaignTab**: Export/Bundle buttons per level row, Export button per enemy type row, Import Level button per world (file picker + conflict resolution modal), Import Enemy Type button (file picker).
- **Level Editor**: Client-side Export button (between Save and Back) serializes current editor state as JSON — no API call needed.
- Download pattern: `Blob` + `createObjectURL` + click anchor (same as AITab).

## Leaderboard, Ranking & Elo
Elo-based ranking system affecting all game modes. Standard Elo formula with K-factor (K=32 for <30 games, K=16 otherwise). FFA modes: pairwise comparison with placement-based actual scores. Teams: average Elo per team, equal delta for all members. Display-only ranks, no matchmaking enforcement.

### Seasons
Admin-defined start/end dates stored in `seasons` table. `season_elo` tracks per-user per-season Elo + peak. `elo_history` records every Elo change. Admin can activate (creates season_elo rows for all users), end with hard reset (to 1000) or soft reset (compress toward 1000 with 0.5 factor). Season history viewable on public profiles.

### Rank Tiers
Admin-configurable via `rank_tiers` JSON in `server_settings`. Default 6 tiers: Bronze(0-999), Silver(1000-1199), Gold(1200-1399), Platinum(1400-1599), Diamond(1600-1799), Champion(1800+). Sub-tiers (I/II/III) split each tier into thirds. `getRankForElo()` pure function in leaderboard service.

### Frontend
- LeaderboardUI: full-screen panel with season selector, paginated table, rank badge pills, clickable usernames → ProfilePanel
- ProfilePanel: slide-out right panel (z-index 202), shows stats/rank/season history/achievements/cosmetics
- LobbyUI: Leaderboard button in header, rank badge next to welcome message
- GameOverScene: Elo delta display (+N green / -N red) next to each player in placements, achievement unlock toasts

## Achievements
Admin-configurable via CRUD. 4 condition types: `cumulative` (checks user_stats), `per_game` (checks match data with operators >=, <=, ==, etc.), `mode_specific` (queries match_players JOIN matches), `campaign` (total_stars, levels_completed, world_complete). Each can reward a cosmetic. Evaluated once after each game-over (`evaluateAfterGame`) and campaign level completion (`evaluateAfterCampaign`). Unlocks emitted via `achievement:unlocked` socket event. Ships with a default pack of 47 achievements + 25 cosmetic rewards (migration 017) covering combat, victory, dedication, mode mastery, and campaign categories.

## Cosmetics
4 types: `color` (player hex), `eyes` (eye style), `trail` (particle emitter config), `bomb_skin` (base/fuse color + label). Unlocked via achievements, campaign stars, level milestones, or default. Equipped in Settings → Cosmetics tab. Cosmetics included in `PlayerState.toState()` (NOT `toTickState()` — static per game). `getPlayerCosmeticsForGame(userIds[])` single JOIN query at game start.

## Player XP & Levels
XP earned per match: kills×50 + bombs×5 + powerups×10 + completion(25) + placement bonus (1st=100, 2nd=50, 3rd=25) + win bonus(100). Level curve: level N→N+1 costs N×100 XP. Constants/math in `shared/src/constants/xp.ts`. Admin `xp_multiplier` setting (default 1.0). Calculated in `GameRoom.onGameOver()` after Elo processing, emitted via `game:xpUpdate` socket event. Level milestone cosmetics: `unlock_type='level_milestone'`, checked via `checkLevelMilestoneUnlocks()`.

## Achievement Progress Tracking
`getAchievementProgress(userId)` in achievements service returns progress for all active achievements. Batch queries for per_game bests (`MAX()` from match_players) and mode-specific counts. Frontend: `GET /achievements/progress` endpoint, rendered as progress bars in ProfilePanel (own profile only). Progress sorted by completion percentage.

## Spectator Chat
In-game text chat for dead players. Admin-controlled via `spectator_chat_mode` (ChatMode). Backend handler validates sender is dead via `GameRoom.isPlayerAlive()`, 3/sec rate limit, broadcasts to room. Frontend: `SpectatorChat.ts` DOM panel (bottom-left, collapsible) mounted by HUDScene when `localPlayerDead` becomes true (not campaign/replay/sim). Admin Dashboard: spectator chat dropdown.

## Rematch Voting
After game over, players vote for rematch instead of manual "Play Again". Server tracks votes per room in `rematchVotes` Map with 30s timeout. >50% threshold triggers auto-restart (same as `room:restart` logic). Emits `rematch:update` (vote tally) and `rematch:triggered`. Frontend: toggle vote button + tally text on GameOverScene. Cleanup on leave/disconnect. Skipped for campaign/replay/sim.

## Achievement & Cosmetic Export/Import
JSON-based export/import following the campaign pattern. Export formats use `_format`/`_version` fields. Types: `AchievementExportData`, `AchievementBundleExportData`, `CosmeticExportData`, `AchievementImportConflict` in `shared/src/types/achievements.ts` and `shared/src/types/cosmetics.ts`.
- **Backend endpoints** (`backend/src/routes/admin.ts`): `GET .../achievements/:id/export` (single), `GET .../achievements/export-all` (bundle with referenced cosmetics), `POST .../achievements/import` (two-phase: first call returns `conflicts` for referenced cosmetics, second call with `cosmeticIdMap` resolves via create/use-existing/skip). `GET .../cosmetics/:id/export`, `POST .../cosmetics/import`.
- **Admin AchievementsTab**: Export All + Import buttons in achievements header, Export button per achievement row. Import Cosmetic button in cosmetics header, Export button per cosmetic row. Import modal with file picker (detects single vs bundle format), conflict resolution modal with radio buttons.
- Download pattern: `Blob` + `createObjectURL` + click anchor (same as CampaignTab/AITab).

### Rendering Pipeline
- BootScene: `generateCustomPlayerTextures(scene, hex, eyeStyle?)` and `generateCustomBombTexture(scene, config)` static methods for on-demand texture generation
- PlayerSprite: color priority: 1) cosmetic colorHex → custom texture, 2) team color, 3) index-based. Trail emitters follow player position.
- BombSprite: `setPlayerCosmetics(map)` checks owner's bomb skin for custom texture
- GameScene: builds cosmeticsMap from initial state, passes to BombSpriteRenderer

## Public Profiles & Privacy
Click usernames in leaderboard/game-over to view public profile. Privacy toggle (`is_profile_public` column on users, default true) hides profile from leaderboard and public endpoint. Friend request accept toggle (`accept_friend_requests` column, default true) checked in `sendFriendRequest`. Settings → Privacy tab for toggles.

## Admin Panel
Full-screen panel for admin/moderator roles. 11 tabs: Dashboard, Users, Matches, Rooms, Logs, Simulations, AI, Campaign, Announcements, Seasons, Achievements. Dashboard includes chat mode dropdowns for Party Chat, Lobby Chat, Direct Messages, In-Game Emotes, and Spectator Chat — each with 4 options (Everyone, Staff Only, Admin Only, Disabled). Also includes XP multiplier setting. `staffMiddleware` (admin+moderator) and `adminOnlyMiddleware` for route protection. All actions audit-logged. Logs tab: rows are click-to-expand — clicking a row toggles a detail row showing the full message text. `admin_actions.target_id` is `INT NOT NULL` — use `0` (not `null`) for bulk operations without a specific target. Dashboard includes email/SMTP settings (admin-only) — stored in DB (`email_settings` key), `.env` values as fallback; password masked in API responses; `invalidateTransporter()` resets cached nodemailer on save. Registration toggle (`registration_enabled` setting) — when disabled, `/auth/register` returns 403 and AuthUI hides the register link. Party chat mode (`party_chat_mode` setting) — `ChatMode` type: `'everyone'` (default), `'staff'` (admin+mod), `'admin_only'`, `'disabled'`. Admin-only PUT; public GET. Backend enforces in `party:chat` handler; frontend hides chat button and auto-closes open chat on mode change. See [docs/admin-and-systems.md](docs/admin-and-systems.md) for full details.

## Bot AI Management
Admin-only system for custom AI upload/management. Built-in AI as fallback. Three-layer sandbox: (1) source scan blocks dangerous module imports and global access patterns (`process`, `globalThis`, `__proto__`, `Reflect`, `Proxy`, etc.), (2) esbuild `bundle: true` with `blockImportsPlugin` rejects ALL import/require at build time, (3) `vm.runInContext()` executes code in isolated context with `codeGeneration: { strings: false }` (blocks `eval`/`Function`) and 5s timeout. `loadBotAIInSandbox()` exported from `botai-compiler.ts` — used by both compiler validation and registry runtime loading. `IBotAI` interface in `BotAI.ts`. Runtime crash recovery falls back to built-in. `botAiId` field in MatchConfig/SimulationConfig. See [docs/admin-and-systems.md](docs/admin-and-systems.md#bot-ai-management) and [docs/bot-ai-guide.md](docs/bot-ai-guide.md).

## Bot Simulation System
Admin-only batch runner for bot-only games. Fast/real-time modes, queue system (max 10), live spectating. `getHistory(page, limit)` returns paginated `{ batches, total }`. See [docs/admin-and-systems.md](docs/admin-and-systems.md#bot-simulation-system).

## Friends + Party System
Social features for the lobby: friend list, online presence, party grouping, and invite system.

### Architecture
- **Friendships**: DB-backed (`friendships` table). One row per pending request, two reciprocal rows on accept (fast `WHERE user_id=?` lookups). `user_blocks` table for blocking.
- **Presence**: Redis ephemeral keys (`presence:{userId}`) with 120s TTL. Statuses: `offline`, `online`, `in_lobby`, `in_game`, `in_campaign`. Batch lookup via MGET pipeline.
- **Parties**: Redis-only (ephemeral). Keys: `party:{partyId}` (party state), `player:party:{userId}` (user→party lookup). 1-hour TTL. Atomic join via Lua script to prevent race conditions.
- **Invites**: Redis with 60s TTL (`invite:{recipientId}:{inviteId}`). Auto-expire.

### Key Patterns
- Each socket joins `user:{userId}` room on connect for targeted friend/party notifications
- Party follows leader: when leader creates/joins a room, all members receive `party:joinRoom` and auto-join
- Socket handlers extracted to `backend/src/handlers/friendHandlers.ts`, `partyHandlers.ts`, `lobbyHandlers.ts`, and `dmHandlers.ts`
- Rate limiters: `friendRequestLimiter` (3/sec), `friendActionLimiter` (5/sec), `partyChatLimiter` (5/sec), `inviteLimiter` (3/sec), `lobbyChatLimiter` (3/sec), `dmLimiter` (5/sec)
- On disconnect: presence removed, friends notified offline, party leave/disband handled

### Frontend
- **FriendsPanel** (`frontend/src/ui/FriendsPanel.ts`): Fixed slide-out panel (right side, z-index 200). Three tabs: Friends (sorted online-first), Requests (incoming+outgoing), Blocked. Search bar with username prefix lookup. Live-updates via socket events.
- **PartyBar** (`frontend/src/ui/PartyBar.ts`): Persistent bar below lobby header when in party. Member chips, chat toggle (hidden when chat disabled for user's role), leave button. Chat window is in-memory ephemeral messages. Fetches `party_chat_mode` on init and listens for `admin:settingsChanged` to update in real-time.
- **Invite toasts**: Action toasts with Accept/Decline buttons, 30s auto-dismiss. Triggered by `party:invite` and `invite:room` socket events.
- **LobbyChatPanel** (`frontend/src/ui/LobbyChatPanel.ts`): Fixed collapsible panel bottom-left (z-index 150). Broadcasts to all users. Role-colored names. Checks `lobby_chat_mode` setting.
- **DMPanel** (`frontend/src/ui/DMPanel.ts`): Slide-out panel right side (z-index 201). Two views: conversation list with unread badges, active conversation with message history. Real-time via `dm:receive`/`dm:read` socket events.
- **EmoteBubbleRenderer** (`frontend/src/game/EmoteBubble.ts`): Phaser composed renderer. Floating text bubbles above players with tween animations (float up + fade out). Follows player positions.
- LobbyUI: Friends, Messages, Party buttons in lobby header. PartyBar and LobbyChatPanel mounted with lobby. DMPanel accessible from Messages button or "Msg" button on friends.

### Services
- `backend/src/services/friends.ts`: sendRequest, accept, decline, cancel, remove, block, unblock, getFriends, getFriendIds, getPending, areFriends, isBlocked, search
- `backend/src/services/presence.ts`: set, get, getBatch (MGET), remove, refresh
- `backend/src/services/party.ts`: create, get, join (Lua), leave, kick, disband, invite CRUD
- `backend/src/services/messages.ts`: sendMessage, getConversation, getConversationList, markRead, getUnreadCounts

### REST Routes (`/api/friends`, `/api/messages`, `/api/docs`)
- `GET /friends` — list friends + pending + blocked (authMiddleware)
- `GET /friends/blocked` — blocked users (authMiddleware)
- `POST /friends/search` — username prefix search (authMiddleware + validate)
- `GET /messages` — conversation list (authMiddleware)
- `GET /messages/unread` — unread counts per sender (authMiddleware)
- `GET /messages/:userId` — paginated conversation history (authMiddleware)
- `PUT /messages/:userId/read` — mark messages as read (authMiddleware)
- `GET /docs/:filename` — public docs: campaign.md, replay-system.md, bot-ai-guide.md (authMiddleware, whitelist-validated)
- `GET /docs/admin/:filename` — staff docs: admin-and-systems.md, infrastructure.md, testing.md, performance-and-internals.md, bot-ai-internals.md, openapi.yaml (authMiddleware + staffMiddleware, whitelist-validated)

### Database
- Migration `013_friends_parties.sql`: `friendships` + `user_blocks` tables
- Migration `014_direct_messages.sql`: `direct_messages` table (sender_id, recipient_id, message, read_at, created_at)
- Row types: `FriendshipRow`, `UserBlockRow`, `DirectMessageRow` in `backend/src/db/types.ts`

## Lobby Chat, Direct Messages & In-Game Emotes
Three additional social features, all admin-configurable with `ChatMode` (`'everyone' | 'staff' | 'admin_only' | 'disabled'`).

### Global Lobby Chat
- Ephemeral, socket-based broadcast to all connected users. Fixed panel bottom-left of lobby (collapsible).
- Backend: `backend/src/handlers/lobbyHandlers.ts`. Rate limit: 3/sec. Broadcasts via `io.emit('lobby:chat')`.
- Frontend: `frontend/src/ui/LobbyChatPanel.ts`. 100-message buffer, role-colored usernames (admin=orange, mod=blue).
- Admin setting: `lobby_chat_mode` (public GET, admin PUT on `/api/admin/settings/lobby_chat_mode`).

### Direct Messages
- Persistent (DB), between friends only. Slide-out panel on right side of lobby (z-index 201, overlays FriendsPanel).
- Backend service: `backend/src/services/messages.ts` — sendMessage (checks areFriends + isBlocked), getConversation (paginated), getConversationList (with unread counts), markRead, getUnreadCounts.
- Socket handlers: `backend/src/handlers/dmHandlers.ts`. Rate limit: 5/sec. `dm:send` with callback, `dm:read` with sender notification.
- REST routes: `GET /messages`, `GET /messages/unread`, `GET /messages/:userId`, `PUT /messages/:userId/read`.
- Frontend: `frontend/src/ui/DMPanel.ts`. Conversation list + active conversation views, real-time delivery, read receipts.
- FriendsPanel: "Msg" button per friend opens DMPanel.openConversation(). LobbyUI: "Messages" button in header.
- Admin setting: `dm_mode`.

### In-Game Quick Emotes
- Ephemeral, predefined phrases rendered as floating bubbles above player sprites. Keys 1-6 during gameplay.
- 6 emotes: GG, Help!, Nice!, Oops, Taunt, Thanks (`shared/src/constants/emotes.ts`).
- Server-side cooldown: 3s per player (`emoteLastUsed` Map). Broadcasts to game room via `game:emote`.
- Frontend: `frontend/src/game/EmoteBubble.ts` (composed renderer). Float-up + fade-out tweens, follows player positions.
- Number keys 1-6 for emotes only fire when `!localPlayerDead` (no conflict with spectator digit keys 1-9).
- Admin setting: `emote_mode`.

## Game Architecture
- 20 tick/sec server game loop (GameLoop.ts -> GameState.ts)
- GameState.processTick(): bot AI -> inputs -> movement -> bomb slide -> bomb timers -> explosions -> collisions -> power-ups -> KOTH scoring -> map events -> zone -> deathmatch respawns -> time check -> win check
- Bomb kick: player with hasKick walking into a bomb sets bomb.sliding direction; sliding bombs advance 1 tile/tick until blocked; kicking applies movement cooldown
- BotAI: 3 difficulty tiers (easy/normal/hard) with BFS pathfinding, game phase system, stalemate breakers, pierce/line/remote bomb awareness. See [docs/bot-ai-internals.md](docs/bot-ai-internals.md)
- Bot difficulty set per-room via MatchConfig.botDifficulty; defaults to 'normal'
- Spawn position randomization: Fisher-Yates shuffle using seeded RNG (`shuffledSpawnIndices`), deterministic for replays
- Self-kills subtract 1 from kill score (owner.kills decremented, owner.selfKills incremented)
- Game over placements sorted by kills descending, tiebreak by survival placement
- Grace period: 30 ticks (1.5s) after win condition before status='finished'; winner invulnerable during grace period
- Dead players enter spectator mode: free camera pan (WASD/arrows/D-pad/mouse drag), click-to-follow, number keys 1-9, LB/RB bumpers
- Mouse drag panning: pointerdown records start, pointermove after 4px threshold pans freeCam; pointerup without drag triggers replay play/pause
- Spectate-follow breaks only on new keydown or mouse drag (not stale keysDown state); blur handler clears keysDown
- HUD spectate click uses mousedown event delegation on stable container (not click — unreliable with innerHTML rebuilds)
- HUDScene forces `localPlayerDead = true` when `simulationSpectate` or `replayMode` registry flags are set
- Camera follows local player with smooth lerp when map exceeds viewport
- Room name auto-generated if left blank (random adjective + noun)
- Play Again: room:restart resets to 'waiting'; other players auto-navigate via room:state listener
- Phaser scene lifecycle: shutdown() must be registered via `this.events.once('shutdown', this.shutdown, this)` — Phaser does NOT auto-call shutdown(). Scenes defensively clean up stale state at top of create().
- `tickEvents` buffer on GameStateManager accumulates per-tick events for fine-grained socket emission in GameRoom
- Chain reaction tile snapshot: tiles snapshotted before processing detonations so chained bombs use original wall layout
- Shield has no time limit — lasts until consumed. After break, 10 ticks invulnerability. Extra pickups consumed but don't stack.
- Game start transitions instantly; room:start guard checks GameRoom existence and room status to prevent duplicate starts
- "Back to Lobby" from game over clears currentRoom registry to prevent stale room UI

## Teams
- Host assigns players/bots to Team Red (0) or Team Blue (1) via dropdowns; unassigned fall back to round-robin
- Bot teams stored in `MatchConfig.botTeams`; bots rendered as placeholders in waiting room
- In-game: team-colored palettes, name labels, underline bars, HUD grouping
- `room:setTeam` and `room:setBotTeam` socket events

## Game Modes
- **Free for All (FFA)**: 2-8 players, last standing, 3 min
- **Teams**: 4-8 players, 2 teams, last team standing, friendly fire toggle, 4 min
- **Battle Royale**: 4-8 players, shrinking circular zone, 5 min
- **Sudden Death**: 2-8 players, all maxed stats, no power-ups, one hit kills, 2 min
- **Deathmatch**: 2-8 players, respawn after 3s, first to 10 kills or most at time, 5 min
- **King of the Hill**: 2-8 players, control 3x3 center zone, first to 100, 4 min

## Power-Ups (8 types)
- bomb_up, fire_up, speed_up, shield, kick (original 5)
- **pierce_bomb**: Explosions pass through destructible walls (still destroys them)
- **remote_bomb**: Bombs don't auto-detonate; press E to detonate all at once (10s safety max)
- **line_bomb**: Places line of bombs in facing direction (up to remaining bomb capacity)

## Map Features
- **Reinforced walls** (optional): 2 hits — first cracks (`destructible_cracked`), second destroys
- **Dynamic map events** (optional): Meteor strikes every 30-45s (2s warning), power-up rain every 60s
- **Hazard tiles** (optional): Teleporter pairs (A/B, instant transport), conveyor belts (force movement)

## Room Configuration
MatchConfig includes: gameMode, maxPlayers, mapWidth/Height, mapSeed, roundTime, wallDensity, enabledPowerUps (all 8), powerUpDropRate, botCount, botDifficulty, botTeams, friendlyFire, hazardTiles, enableMapEvents, reinforcedWalls, recordGame

## Game Replay System
Gzipped JSON replays with tile diffs for space efficiency. `ReplayRecorder` nullable — only created when recording active. Frontend: `ReplayPlayer` with play/pause/seek/speed, `ReplayControls` bottom bar, `ReplayLogPanel` collapsible side panel. See [docs/replay-system.md](docs/replay-system.md).

## Security, Connection Resilience & Docker
See [docs/infrastructure.md](docs/infrastructure.md) for security details, connection resilience (10s disconnect grace period, auto-reconnect, stale room cleanup, 502 page), Docker setup, and database migrations.

## Performance Optimizations
Delta tile encoding, bot AI tick throttling, per-tick caching, efficient serialization, frontend HUD differential updates. See [docs/performance-and-internals.md](docs/performance-and-internals.md).

## Code Quality & Tooling
- ESLint v10 + `@typescript-eslint/recommended` via flat config (`eslint.config.mjs`); `no-explicit-any` as warning, `no-unused-vars` as error
- Prettier with single quotes, trailing commas, 100 char width
- Husky + lint-staged pre-commit hook runs ESLint `--fix` + Prettier on staged `.ts` files
- `prepare` script uses `husky || true` to avoid failures in Docker builds
- Socket rate limiting: `backend/src/utils/socketRateLimit.ts` — in-memory sliding window per socket ID + parallel per-IP rate limiters (`getSocketIp()` extracts IP from `x-real-ip`/`x-forwarded-for`)
- All Socket.io server types fully parameterized — no `as any` casts on socket events
- DB row types in `backend/src/db/types.ts`; all service queries use typed `query<T>()` calls
- `shared/src/utils/error.ts`: `getErrorMessage(err: unknown)` in all catch blocks
- `backend/src/db/connection.ts`: `withTransaction<T>(fn)` helper
- `GameStateManager` constructor takes a `GameConfig` object (not positional parameters)
- `frontend/src/utils/html.ts`: shared `escapeHtml()` and `escapeAttr()` utilities
- `frontend/src/utils/powerUpCanvas.ts`: standalone Canvas2D power-up icon renderer (extracted from BootScene), used by HelpUI for inline `<canvas>` elements
- LobbyUI modals extracted to `frontend/src/ui/modals/` — LobbyUI.ts is thin orchestrator (~200 lines)

## Database Migrations
- Forward migrations in `backend/src/db/migrations/*.sql`, numbered `NNN_description.sql`
- Rollback (DOWN) migrations in `backend/src/db/migrations/down/*.down.sql`
- Runner: `runMigrations()` (auto-runs on startup), `rollbackMigration(steps)`, `getAppliedMigrations()`
- Tracking table: `_migrations` (name + executed_at)

## Testing
```bash
npm test                    # Run all workspace tests (backend + frontend)
npx jest --config tests/backend/jest.config.ts  # Backend only (from project root)
cd frontend && npx vitest run                   # Frontend only
```
- 1846 tests: 1804 backend (Jest, 55 suites) + 42 frontend (Vitest, 3 suites)
- See [docs/testing.md](docs/testing.md) for full inventory, mocking patterns, and guide for writing new tests

## Documentation
Docs are accessible in-app via the Help panel (lobby header → Help button). Player-facing docs (campaign, replays, bot AI guide) appear in the Guides tab for all users. Staff-only docs appear in Level Editor and Admin Docs tabs. Docs are served via `/api/docs/` endpoints from the `docs/` directory (bind-mounted in dev, baked into Docker image for prod).

- [Bot AI Developer Guide](docs/bot-ai-guide.md) — writing custom bot AIs
- [Bot AI Internals](docs/bot-ai-internals.md) — built-in BotAI decision engine details
- [Campaign System](docs/campaign.md) — enemies, levels, editor, progress
- [Admin Panel & Systems](docs/admin-and-systems.md) — admin tabs, bot AI management, simulations, accounts
- [Replay System](docs/replay-system.md) — recording, playback, controls, API
- [Performance & Internals](docs/performance-and-internals.md) — optimizations, game logging
- [Infrastructure & Security](docs/infrastructure.md) — security, resilience, Docker, migrations
- [Testing](docs/testing.md) — test inventory, mocking patterns, writing new tests
- [API Reference](docs/openapi.yaml) — OpenAPI 3.0.3 specification for all REST endpoints
