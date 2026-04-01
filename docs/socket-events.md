# Socket.io Events Reference

Comprehensive reference for all Socket.io events in BlastArena. All events are fully typed via `ClientToServerEvents` and `ServerToClientEvents` generics in `shared/src/types/socket-events.ts`. The server uses `SocketData` to attach per-socket metadata.

## Overview

- **Transport**: Socket.io with per-message deflate (threshold 256 bytes), ping interval 25s, ping timeout 60s
- **Auth**: JWT access token passed in `socket.handshake.auth.token`; locale in `socket.handshake.auth.locale`
- **CORS**: Origin restricted to `APP_URL`
- **Rate limiting**: Per-socket and per-IP sliding window counters (see [Rate Limits](#rate-limits))
- **Typing**: `Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>` -- no `as any` casts

## Connection Lifecycle

### Auth Middleware

Every connection passes through JWT verification middleware before the `connection` event fires:

1. Verify `socket.handshake.auth.token` with `JWT_SECRET`
2. Query database for the user row (`email_verified`, `is_deactivated`, `role`)
3. Reject if: no token, invalid token, user not found, account deactivated, email not verified (`EMAIL_NOT_VERIFIED`)
4. On success, populate `socket.data` fields from the JWT payload and DB row

### Auto-Join Rooms on Connect

| Room | Condition |
|------|-----------|
| `user:{userId}` | Always -- used for friend/party/DM notifications and admin session revocation |
| `role:staff` | When `role` is `admin` or `moderator` -- scoped admin broadcasts |
| `sim:admin` | When `role` is `admin` -- simulation progress broadcasts |
| `party:{partyId}` | When user has an existing party (restored on reconnect) |

### Reconnection to Active Games

On connect, the server checks if the user was in an active game room (via Redis). If the user is marked as disconnected in a running game:

1. Socket rejoins `room:{roomCode}`
2. `socket.data.activeRoomCode` is set
3. `handlePlayerReconnect()` cancels the 10-second disconnect grace period
4. Full game state is sent via `game:start` so the client can resume rendering

### Disconnect Cleanup

On disconnect, the server:

1. Removes per-socket rate limiter entries
2. Cleans up emote cooldowns and rematch votes
3. Removes presence and notifies friends offline
4. Handles party disconnect (leave or disband)
5. Handles campaign session cleanup (co-op: notify partner; solo: end session)
6. If in a running game: starts 10-second disconnect grace period (200 ticks). If not in a game: leaves room normally and broadcasts updated state

## Client-to-Server Events

### Room Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `room:create` | `{ name: string, config: MatchConfig }` + callback | Create a new room. Config validated via Zod schema. Party members auto-notified via `party:joinRoom` | 2/s per socket, 5/s per IP |
| `room:join` | `{ code: string }` + callback | Join an existing room by code. Cleans up any stale room membership first | 5/s per socket, 10/s per IP |
| `room:leave` | _(none)_ | Leave current room. If game is running, player is killed immediately (no grace period) | -- |
| `room:ready` | `{ ready: boolean }` | Toggle ready state in the room lobby | -- |
| `room:start` | _(none)_ | Start the game. Host-only. Requires all players ready and minimum 2 participants (or 1 + bots). Uses atomic Lua script to prevent double-start | -- |
| `room:restart` | callback | Reset room to `waiting` after game finishes. Clears rematch votes, removes finished GameRoom | -- |
| `room:setTeam` | `{ userId: number, team: number \| null }` | Assign a player to a team (0 = Red, 1 = Blue, null = unassigned). Host-only, teams mode | -- |
| `room:setBotTeam` | `{ botIndex: number, team: number }` | Assign a bot to a team by index. Host-only, teams mode | -- |

**Callback shape** (create/join/restart): `{ success: boolean; room?: Room; error?: string }`

### Game Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `game:input` | `PlayerInput` (`{ seq: number, tick: number, direction: Direction \| null, action: Action \| null }`) | Send player input during a game. Hot path -- uses cached `activeRoomCode` to skip Redis lookup. Runtime-validated (direction/action enums) | 30/s per socket, 100/s per IP |
| `game:emote` | `{ emoteId: EmoteId }` | Trigger an in-game emote (keys 1-6). EmoteId 0-5. Subject to admin chat mode setting | 3s cooldown per player |
| `game:spectatorChat` | `{ message: string }` | Send a chat message as a dead player or admin spectator. Max 200 chars. Only allowed when sender is dead or spectating | 3/s per socket |

### Campaign Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `campaign:start` | `{ levelId: number, coopMode?: boolean, localCoopMode?: boolean, localP2?: LocalP2Data, buddyMode?: boolean }` + callback | Start a campaign level. Supports solo, online co-op (party-based), local co-op, and buddy mode. Ends any existing campaign session first | 1/s per socket |
| `campaign:input` | `PlayerInput & { playerId?: number }` | Send input during campaign. `playerId` used for local co-op/buddy mode; defaults to socket's userId for solo/online co-op. Validated against session player list | -- |
| `campaign:pause` | callback | Pause the campaign game. Either co-op player can pause | -- |
| `campaign:resume` | callback | Resume a paused campaign game. Either co-op player can resume | -- |
| `campaign:quit` | _(none)_ | Quit the campaign. Co-op: removes player and notifies partner. Solo: ends session | -- |

**`LocalP2Data`**: `{ userId?: number, username: string, guestColor?: number, token?: string }` -- token required for positive userId (verified via `verifyLocalCoopSocketToken`)

### Admin Events

| Event | Payload | Description | Auth |
|-------|---------|-------------|------|
| `admin:kick` | `{ roomCode: string, userId: number, reason?: string }` + callback | Kick a player from a room. Target receives `admin:kicked` | admin, moderator |
| `admin:closeRoom` | `{ roomCode: string }` + callback | Force-close a room. All players receive `admin:kicked`, room is deleted | admin only |
| `admin:spectate` | `{ roomCode: string }` + callback | Join a room as a spectator. Admin socket joins `room:{roomCode}` to receive game state | admin, moderator |
| `admin:roomMessage` | `{ roomCode: string, message: string }` | Send a system message to a room. Requires admin to have joined the room (spectating). Max 500 chars | admin, moderator |

### Simulation Events

| Event | Payload | Description | Auth |
|-------|---------|-------------|------|
| `sim:start` | `SimulationConfig` + callback | Start a simulation batch. May be queued if another is running. Events forwarded to requesting socket | admin only |
| `sim:cancel` | `{ batchId: string }` + callback | Cancel a running simulation batch | admin only |
| `sim:spectate` | `{ batchId: string }` + callback | Start spectating a simulation. Socket joins `sim:{batchId}`, receives current game state immediately | admin only |
| `sim:unspectate` | `{ batchId: string }` | Stop spectating a simulation. Socket leaves `sim:{batchId}` | admin only |

**Start callback**: `{ success: boolean; batchId?: string; queued?: boolean; queuePosition?: number; error?: string }`

### Friend Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `friend:list` | callback | Fetch friends list with incoming and outgoing requests | 5/s (friendAction) |
| `friend:request` | `{ username: string }` + callback | Send a friend request by username. Target notified via `friend:requestReceived` | 3/s (friendRequest) |
| `friend:accept` | `{ fromUserId: number }` + callback | Accept an incoming friend request. Both parties receive `friend:update` | 5/s (friendAction) |
| `friend:decline` | `{ fromUserId: number }` + callback | Decline an incoming friend request | 5/s (friendAction) |
| `friend:cancel` | `{ toUserId: number }` + callback | Cancel an outgoing friend request | 5/s (friendAction) |
| `friend:remove` | `{ friendId: number }` + callback | Remove a friend. Target notified via `friend:removed` | 5/s (friendAction) |
| `friend:block` | `{ userId: number }` + callback | Block a user. Also removes friendship. Target sees it as removal (`friend:removed`) | 5/s (friendAction) |
| `friend:unblock` | `{ userId: number }` + callback | Unblock a previously blocked user | 5/s (friendAction) |

**Callback shape** (all except list): `{ success: boolean; error?: string }`

**List callback**: `{ success: boolean; friends?: Friend[]; incoming?: FriendRequest[]; outgoing?: FriendRequest[]; error?: string }`

### Party Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `party:create` | callback | Create a new party. Creator becomes leader. Socket joins `party:{partyId}` | -- |
| `party:invite` | `{ userId: number }` + callback | Invite a friend to the party. Leader-only. Target must be a friend | 3/s (invite) |
| `party:acceptInvite` | `{ inviteId: string }` + callback | Accept a party invite. Socket joins `party:{partyId}`. All members receive `party:state` | -- |
| `party:declineInvite` | `{ inviteId: string }` | Decline a party invite. No callback | -- |
| `party:leave` | callback | Leave the party. If leader leaves, party is disbanded (`party:disbanded` sent to all) | -- |
| `party:kick` | `{ userId: number }` + callback | Kick a member from the party. Leader-only. Kicked user receives `party:disbanded` | -- |
| `party:chat` | `{ message: string }` | Send a chat message to the party. Max 200 chars (`PARTY_CHAT_MAX_LENGTH`). Subject to admin chat mode | 5/s (partyChat) |

**Create/accept callback**: `{ success: boolean; party?: Party; error?: string }`

### Invite Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `invite:room` | `{ userId: number }` + callback | Invite a friend to your current room. Must be friends. Target receives `invite:room` (server-to-client) | 3/s (invite) |
| `invite:acceptRoom` | `{ inviteId: string }` + callback | Accept a room invite. Client handles the actual `room:join` separately | -- |
| `invite:declineRoom` | `{ inviteId: string }` | Decline a room invite. No callback | -- |

### Chat Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `lobby:chat` | `{ message: string }` | Send a message to the global lobby chat. Max 200 chars (`LOBBY_CHAT_MAX_LENGTH`). Subject to admin lobby chat mode | 3/s (lobbyChat) |
| `dm:send` | `{ toUserId: number, message: string }` + callback | Send a direct message. Max 500 chars (`DM_MAX_LENGTH`). Requires friendship. Subject to admin DM mode | 5/s (dmChat) |
| `dm:read` | `{ fromUserId: number }` | Mark messages from a user as read. Sender notified via `dm:read` (server-to-client). Silent failure on error | -- |

### Rematch Events

| Event | Payload | Description | Rate Limit |
|-------|---------|-------------|------------|
| `rematch:vote` | `{ vote: boolean }` + callback | Vote for or against a rematch after game ends. Only human players (id > 0) can vote. 30-second timeout. If >50% vote yes, room resets to waiting and `rematch:triggered` is broadcast | -- |

## Server-to-Client Events

### Room Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `room:state` | `Room` | `room:{code}` | Full room state update (after join, leave, ready, team change, restart) |
| `room:playerJoined` | `RoomPlayer` (`{ user: PublicUser, ready: boolean, team: number \| null }`) | `room:{code}` | A new player joined the room |
| `room:playerLeft` | `number` (userId) | `room:{code}` | A player left the room |
| `room:playerReady` | `{ userId: number, ready: boolean }` | `room:{code}` | A player toggled their ready state |
| `room:list` | `RoomListItem[]` | broadcast (all) | Updated room list. Broadcast on every room mutation (create, join, leave, start, delete) via coalesced `setImmediate` |

### Game Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `game:start` | `GameState` | `room:{code}` | Initial game state when game starts or player reconnects to active game |
| `game:state` | `GameState` | `room:{code}` | Game state update every tick (20 ticks/sec) |
| `game:explosion` | `{ cells: { x: number, y: number }[], ownerId: number }` | `room:{code}` | Bomb explosion with affected cell coordinates and owner |
| `game:powerupCollected` | `{ playerId: number, type: string, position: { x: number, y: number } }` | `room:{code}` | A player collected a power-up |
| `game:playerDied` | `{ playerId: number, killerId: number \| null }` | `room:{code}` | A player was killed. `killerId` is null for environmental/self deaths |
| `game:over` | `{ winnerId: number \| null, winnerTeam: number \| null, reason: string, placements: Placement[] }` | `room:{code}` | Game ended. Placements include userId, username, isBot, placement rank, kills, selfKills, team, alive status |
| `game:emote` | `{ playerId: number, emoteId: EmoteId }` | `room:{code}` | A player triggered an emote |
| `game:spectatorChat` | `{ fromUserId: number, fromUsername: string, role: UserRole, message: string, timestamp: number }` | `room:{code}` | Chat message from a dead player or spectating admin |
| `game:eloUpdate` | `EloResult[]` | `room:{code}` | Elo rating changes for all players after a ranked game |
| `game:xpUpdate` | `XpUpdateResult[]` | `room:{code}` | XP gains and level-ups for all players after a game |

### Campaign Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `campaign:gameStart` | `{ state: CampaignGameState, level: CampaignLevelSummary }` | initiating socket | Initial campaign state and level metadata for P1 |
| `campaign:coopStart` | `CoopStartData` (`{ state, level, enemyTypes }`) | partner socket | Initial campaign state sent to the online co-op partner |
| `campaign:state` | `CampaignGameState` | `campaign:{userId}` | Campaign state update every tick. Includes game state, enemies, lives, exit status |
| `campaign:playerDied` | `{ playerId: number, livesRemaining: number, respawnPosition: Position }` | `campaign:{userId}` | A player died with remaining lives and respawn location |
| `campaign:enemyDied` | `{ enemyId: number, position: Position, isBoss: boolean }` | `campaign:{userId}` | An enemy was killed |
| `campaign:exitOpened` | `{ position: Position }` | `campaign:{userId}` | The exit tile has opened (win condition met) |
| `campaign:playerLockedIn` | `{ playerId: number, position: Position }` | `campaign:{userId}` | A player reached the exit and is frozen in place (sequential lock-in) |
| `campaign:levelComplete` | `{ levelId: number, timeSeconds: number, stars: number, nextLevelId: number \| null }` | `campaign:{userId}` | Level completed with completion time, star rating, and next level ID |
| `campaign:gameOver` | `{ levelId: number, reason: string }` | `campaign:{userId}` | Campaign game over (all lives lost or time expired) |
| `campaign:partnerLeft` | `{ reason: string }` | `campaign:{userId}` | Co-op partner left (reason: `'quit'` or `'disconnected'`). Game continues solo |

### Admin Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `admin:toast` | `{ message: string }` | broadcast (all) | Admin announcement displayed as a toast notification |
| `admin:banner` | `{ message: string \| null }` | broadcast (all) | Admin banner message. `null` to clear |
| `admin:kicked` | `{ reason: string }` | target socket | Player was kicked from a room (or room was force-closed) |
| `admin:roomMessage` | `{ message: string, from: string }` | `room:{code}` | System message from an admin spectating the room |
| `admin:settingsChanged` | `{ key: string, value?: unknown }` | `role:staff` | A server setting was changed by an admin (scoped to staff only) |

### Simulation Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `sim:progress` | `SimulationBatchStatus` | requesting socket | Batch progress update (games completed, win rates, etc.) |
| `sim:gameResult` | `{ batchId: string, result: SimulationGameResult }` | requesting socket | Individual game result within a batch |
| `sim:state` | `{ batchId: string, state: GameState }` | `sim:{batchId}` | Live game state for spectating a simulation game |
| `sim:gameTransition` | `{ batchId: string, gameIndex: number, totalGames: number, lastResult: SimulationGameResult \| null }` | `sim:{batchId}` | Transition between games in a batch (for spectator scene reset) |
| `sim:completed` | `{ batchId: string, status: SimulationBatchStatus }` | requesting socket | Batch simulation completed with final status |
| `sim:queueUpdate` | `{ queue: QueueEntry[] }` | broadcast (all admins) | Updated simulation queue status. `QueueEntry`: `{ batchId, queuePosition, config, queuedAt }` |

### Friend Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `friend:update` | `{ friends: Friend[], incoming: FriendRequest[], outgoing: FriendRequest[] }` | `user:{userId}` | Full friend list refresh (sent after accept/remove to both parties) |
| `friend:requestReceived` | `FriendRequest` (`{ id, fromUserId, fromUsername, createdAt }`) | `user:{targetUserId}` | Incoming friend request notification |
| `friend:removed` | `{ userId: number }` | `user:{targetUserId}` | A friend was removed (also sent when blocked -- target sees it as removal) |
| `friend:online` | `{ userId: number, activity: ActivityStatus }` | `user:{friendId}` | A friend came online or changed activity status |
| `friend:offline` | `{ userId: number }` | `user:{friendId}` | A friend went offline |

### Party Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `party:state` | `Party` | `party:{partyId}` | Full party state update (after join, kick, leave) |
| `party:disbanded` | _(none)_ | `party:{partyId}` or `user:{kickedUserId}` | Party was disbanded (leader left) or user was kicked |
| `party:invite` | `PartyInvite` (`{ inviteId, type, fromUserId, fromUsername, partyId, createdAt }`) | `user:{targetUserId}` | Incoming party invite notification |
| `party:chat` | `PartyChatMessage` (`{ fromUserId, fromUsername, message, timestamp }`) | `party:{partyId}` | Party chat message |
| `party:joinRoom` | `{ roomCode: string }` | `party:{partyId}` (excluding leader) | Party leader created or joined a room -- members should follow |

### Invite Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `invite:room` | `PartyInvite` (with `type: 'room'`, `roomCode`) | `user:{targetUserId}` | Incoming room invite notification |

### DM Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `dm:receive` | `DirectMessage` | `user:{recipientUserId}` | Real-time delivery of a new direct message |
| `dm:read` | `{ fromUserId: number, readAt: string }` | `user:{senderUserId}` | Read receipt -- the sender is notified that recipient read their messages |

### Progression Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `achievement:unlocked` | `AchievementUnlockEvent` | `user:{userId}` | One or more achievements unlocked (after game or campaign completion) |

### Rematch Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `rematch:update` | `{ votes: { userId, username, vote }[], threshold: number, totalPlayers: number }` | `room:{code}` | Updated rematch vote tally. `threshold` is `floor(totalPlayers / 2) + 1` |
| `rematch:triggered` | _(none)_ | `room:{code}` | Rematch threshold met -- room is resetting to waiting state |

### Error Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `error` | `{ message: string, code?: string }` | target socket | Generic error notification (validation failures, permission errors, game start issues) |

### Lobby Chat Events

| Event | Payload | Scope | Description |
|-------|---------|-------|-------------|
| `lobby:chat` | `LobbyChatMessage` (`{ fromUserId, fromUsername, message, timestamp, role }`) | broadcast (all) | Global lobby chat message |

## Rate Limits

### Per-Socket Limits

| Limiter | Events | Max Rate | Purpose |
|---------|--------|----------|---------|
| inputLimiter | `game:input` | 30/s | Game runs at 20 tps; allows headroom |
| createLimiter | `room:create` | 2/s | Prevent room spam |
| joinLimiter | `room:join` | 5/s | Prevent join spam |
| friendRequestLimiter | `friend:request` | 3/s | Prevent friend request spam |
| friendActionLimiter | `friend:list`, `friend:accept`, `friend:decline`, `friend:cancel`, `friend:remove`, `friend:block`, `friend:unblock` | 5/s | General friend action throttle |
| partyChatLimiter | `party:chat` | 5/s | Party chat throttle |
| inviteLimiter | `party:invite`, `invite:room` | 3/s | Invite spam prevention |
| lobbyChatLimiter | `lobby:chat` | 3/s | Lobby chat throttle |
| dmChatLimiter | `dm:send` | 5/s | DM throttle |
| spectatorChatLimiter | `game:spectatorChat` | 3/s | Spectator chat throttle (per-socket instance) |
| campaignStartLimiter | `campaign:start` | 1/s | Prevent rapid campaign restarts |

### Per-IP Limits

These are higher limits applied by IP address, providing defense-in-depth against users sharing an IP:

| Limiter | Events | Max Rate |
|---------|--------|----------|
| ipInputLimiter | `game:input` | 100/s |
| ipCreateLimiter | `room:create` | 5/s |
| ipJoinLimiter | `room:join` | 10/s |

### Special Cooldowns

| Cooldown | Duration | Scope | Description |
|----------|----------|-------|-------------|
| Emote cooldown | 3000ms | Per player (userId) | Prevents emote spam during games |
| Rematch vote timeout | 30000ms | Per room | Vote tally expires if threshold not met within 30 seconds |

### Implementation

Rate limiters use a sliding window counter pattern (`createSocketRateLimiter`). Each limiter tracks `{ count, windowStart }` per socket/IP. The window resets after 1 second. Limiter entries are removed on disconnect (per-socket) or expire naturally (per-IP). A periodic cleanup runs every 60 seconds to sweep stale entries.

IP extraction uses `x-real-ip` header (from Nginx) with `x-forwarded-for` as fallback.

## SocketData Fields

Fields attached to each socket instance via `socket.data`, populated during auth middleware and connection lifecycle:

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `number` | Authenticated user's database ID |
| `username` | `string` | Authenticated user's display name |
| `role` | `UserRole` (`'user' \| 'moderator' \| 'admin'`) | User's role, read from database (not JWT) on each connection |
| `locale` | `string` | User's preferred locale for i18n (from `socket.handshake.auth.locale`, default `'en'`) |
| `activeRoomCode` | `string \| undefined` | Cached room code for fast `game:input` dispatch (avoids Redis lookup per input) |
| `activeCampaignSession` | `string \| undefined` | Active campaign session ID for fast `campaign:input` dispatch |
| `activePartyId` | `string \| undefined` | Active party ID, restored on reconnect if party still exists |

## Socket Room Naming Conventions

| Room Pattern | Purpose |
|-------------|---------|
| `user:{userId}` | Per-user notifications (friends, party invites, DMs, admin session revocation) |
| `role:staff` | Admin + moderator scoped broadcasts (settings changes) |
| `sim:admin` | Admin-only simulation broadcasts |
| `room:{roomCode}` | Game room -- all players + admin spectators |
| `party:{partyId}` | Party members -- state updates, chat, room follow |
| `campaign:{userId}` | Campaign session -- P1's userId used as room identifier (both co-op players join) |
| `sim:{batchId}` | Simulation spectators -- live game state during batch |

## Chat Mode Restrictions

All chat features (lobby, party, DMs, emotes, spectator chat) respect admin-configurable `ChatMode` settings:

| Mode | Who Can Send |
|------|-------------|
| `everyone` | All authenticated users |
| `staff` | Admin and moderator only |
| `admin_only` | Admin only |
| `disabled` | Nobody |

Each chat type has its own independent mode setting. When a mode restriction blocks a message, it is silently dropped (no error callback).
