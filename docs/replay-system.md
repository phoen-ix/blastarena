# Game Replay System

Games and simulations are recorded as gzipped JSON files when recording is enabled.

## Recording Toggles

- **Global toggle**: `recordings_enabled` in `server_settings` table — controls whether "Record Game" checkbox appears in CreateRoomView
- **Per-room**: `recordGame` field in MatchConfig (default true when recordings enabled)
- **Per-simulation**: `recordReplays` field in SimulationConfig (default true)
- `GameRoom.replayRecorder` and `SimulationGame.replayRecorder` are nullable — only created when recording is active; all usage sites guarded with optional chaining

## Backend Recording

### ReplayRecorder
- Captures full GameState every tick with tile diffs (not full map per frame) for space efficiency
- Deep-copies `initialState.map.tiles` in constructor (game engine mutates tiles in-place as walls are destroyed)
- `finalize()` accepts optional `{ saveDir }` to write to a custom directory (used by simulations)
- `GameLogger` forwards log events (kills, bombs, bot decisions, movements, powerups) to ReplayRecorder with tick numbers
- Countdown ticks are not recorded, but `observe()` reads the player cosmetics they carry (a player's cosmetics are sent only on their first tick). Frames are filled in from per-id caches (cosmetics, explosion cells), so every frame is self-contained for seeking

### File Format
- Regular games: `./data/replays/{matchId}_{roomCode}_{gameMode}.replay.json.gz` (~400-700KB)
- Simulation replays: `./data/simulations/{gameMode}/batch_*/{gameIndex}_{roomCode}_{gameMode}.replay.json.gz`
- Campaign replays: `./data/replays/campaign_{sessionId}.replay.json.gz`, indexed by the `campaign_replays` table (user, level, duration, result, stars, co-op/buddy flags)

### Retention
Match replays are pruned after each save — by age (`REPLAY_MAX_AGE_DAYS`, default 365), then by total size (`REPLAY_MAX_TOTAL_MB`, default 10240), oldest first. Campaign replays are not pruned: their `campaign_replays` rows point at the files.

### API
- `GET /admin/replays` — list all replays
- `GET /admin/replays/:matchId` — fetch replay data
- `DELETE /admin/replays/:matchId` — delete replay
- `GET /admin/simulations/:batchId/replay/:gameIndex` — fetch simulation replay
- `GET /admin/campaign-replays?page&limit&userId&levelId` — list campaign replays (paginated, `limit` up to 100)
- `GET /admin/campaign-replays/:sessionId` — fetch a campaign replay
- `DELETE /admin/campaign-replays/:sessionId` — delete the file and its row (admin only; the others are staff)

## Frontend Playback

### ReplayPlayer
Manages playback: play/pause, speed (0.5x/1x/2x/4x), seek to any frame. Uses Phaser-synced time accumulator (`tick(deltaMs)`) instead of `setInterval` to prevent drift/fast-forward; frame bounds-checked before access.

### ReplayControls
Video-player-like bottom bar with:
- Seek slider + time display
- Speed selector (0.5x / 1x / 2x / 4x)
- Keyboard shortcuts: Space=play/pause, arrows=skip forward/back

Arrow keys are reserved for timeline in replay mode (GameScene skips them); WASD/mouse drag used for camera pan.

### ReplayLogPanel
Collapsible right-side panel (collapsed by default) showing game events synced to replay time:
- Filters by event type (kills, bombs, bot AI, powerups, movement)
- Clickable timestamps seek to the frame at or before that tick (`ReplayPlayer.seekToTick`) — frames start after the countdown, so a tick is not a frame index
- When expanded, shifts `.hud-players` list to `right: 360px` to avoid overlap
- Uses `DocumentFragment` for batch DOM insertion when rebuilding

### GameScene Integration
- Detects `registry.get('replayMode')` and uses ReplayPlayer instead of socket events
- Replay auto-plays on open; clicking game canvas toggles play/pause
- EffectSystem has `triggerExplosion()`/`triggerPlayerDied()` public methods for replay mode (bypasses socket listeners)

### Tile State Reconstruction
Initial tiles stored once, diffs applied forward. Seeking backward rebuilds from initial tiles.

### Access Points
- Matches tab -> click match -> "Watch Replay" button (shows all players including bots via `allPlayers` from `getReplayPlacements()`)
- Simulations tab -> batch detail -> per-game "Replay" button
- Campaign tab -> replays list -> "Watch"
- Viewers stay spectators throughout, even when they played in the recorded match

## Docker
Volume mount: `./data/replays:/app/replays`
