# Game Replay System

Games and simulations are recorded as gzipped JSON files when recording is enabled.

## Recording Toggles

- **Global toggle**: `recordings_enabled` in `server_settings` table — controls whether "Record Game" checkbox appears in CreateRoomModal
- **Per-room**: `recordGame` field in MatchConfig (default true when recordings enabled)
- **Per-simulation**: `recordReplays` field in SimulationConfig (default true)
- `GameRoom.replayRecorder` and `SimulationGame.replayRecorder` are nullable — only created when recording is active; all usage sites guarded with optional chaining

## Backend Recording

### ReplayRecorder
- Captures full GameState every tick with tile diffs (not full map per frame) for space efficiency
- Deep-copies `initialState.map.tiles` in constructor (game engine mutates tiles in-place as walls are destroyed)
- `finalize()` accepts optional `{ saveDir }` to write to a custom directory (used by simulations)
- `GameLogger` forwards log events (kills, bombs, bot decisions, movements, powerups) to ReplayRecorder with tick numbers

### File Format
- Regular games: `./data/replays/{matchId}_{roomCode}_{gameMode}.replay.json.gz` (~400-700KB)
- Simulation replays: `./data/simulations/{gameMode}/batch_*/{gameIndex}_{roomCode}_{gameMode}.replay.json.gz`

### API
- `GET /admin/replays` — list all replays
- `GET /admin/replays/:matchId` — fetch replay data
- `DELETE /admin/replays/:matchId` — delete replay
- `GET /admin/simulations/:batchId/replay/:gameIndex` — fetch simulation replay

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
- Clickable timestamps for seeking
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

## Docker
Volume mount: `./data/replays:/app/replays`
