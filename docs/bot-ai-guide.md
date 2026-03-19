# Custom Bot AI Developer Guide

This guide explains how to write, upload, and run custom bot AI implementations for BlastArena.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [The IBotAI Interface](#the-ibotai-interface)
- [Game State API Reference](#game-state-api-reference)
  - [Player](#player)
  - [GameStateManager](#gamestatemanager)
  - [Bomb](#bomb)
  - [Explosion](#explosion)
  - [PowerUp](#powerup)
  - [CollisionSystem](#collisionsystem)
  - [Map](#map)
- [Types Reference](#types-reference)
- [Constants](#constants)
- [Utility Functions](#utility-functions)
- [Difficulty System](#difficulty-system)
- [Game Modes](#game-modes)
- [Logging](#logging)
- [Upload and Validation](#upload-and-validation)
- [Runtime Behavior](#runtime-behavior)
- [Complete Example](#complete-example)
- [Tips and Best Practices](#tips-and-best-practices)

---

## Overview

A custom bot AI is a TypeScript class that controls bot players during gameplay. The game engine calls your AI 20 times per second for each bot, passing the current game state. Your AI decides what each bot should do: move in a direction, place a bomb, detonate remote bombs, or do nothing.

**How it works:**

1. Write a TypeScript file exporting a class with a `generateInput()` method
2. Upload it via the Admin Panel > AI tab
3. The server compiles it with esbuild and validates the structure
4. Activate the AI to make it selectable in room creation and simulations
5. When a game starts with your AI selected, the engine instantiates your class per bot

The built-in AI (BotAI.ts) is always available as a reference implementation and fallback. You can download it from the AI tab.

---

## Quick Start

Here's the minimal AI that compiles, validates, and runs:

```typescript
import { PlayerInput, Direction } from '@blast-arena/shared';
import { Player } from './Player';
import { GameStateManager } from './GameState';
import { GameLogger } from '../utils/gameLogger';

export class MyBot {
  private seq = 0;

  constructor(
    difficulty: 'easy' | 'normal' | 'hard' = 'normal',
    mapSize?: { width: number; height: number },
  ) {
    // Use difficulty and mapSize to tune your AI behavior
  }

  generateInput(
    player: Player,
    state: GameStateManager,
    logger?: GameLogger | null,
  ): PlayerInput | null {
    if (!player.alive) return null;

    return {
      seq: ++this.seq,
      direction: null,  // No movement
      action: null,     // No action
      tick: state.tick,
    };
  }
}
```

This bot does nothing — it just stands still. But it compiles, passes validation, and won't crash. Build from here.

---

## The IBotAI Interface

Your class must satisfy this interface (you don't need to explicitly write `implements IBotAI` — the upload validator checks the structure):

```typescript
interface IBotAI {
  generateInput(
    player: Player,
    state: GameStateManager,
    logger?: GameLogger | null,
  ): PlayerInput | null;
}
```

### Constructor

Your constructor must accept these parameters:

```typescript
constructor(
  difficulty: 'easy' | 'normal' | 'hard',
  mapSize?: { width: number; height: number },
)
```

- **`difficulty`** — The difficulty selected by the room creator. Use this to scale your AI's behavior (reaction time, aggression, search depth, etc.)
- **`mapSize`** — The map dimensions. Larger maps may need deeper pathfinding or longer vision ranges. `undefined` in some contexts, so handle both cases.

One instance is created per bot player. State persists across ticks for that bot.

### Return Value

Return `null` to skip this tick (no input). Otherwise return a `PlayerInput`:

```typescript
interface PlayerInput {
  seq: number;                          // Increment each call
  direction: Direction | null;          // 'up' | 'down' | 'left' | 'right' | null
  action: 'bomb' | 'detonate' | null;  // Place bomb, detonate remotes, or nothing
  tick: number;                         // state.tick
}
```

- **`direction`** — Which way to move. `null` = stay still. Movement respects cooldowns (`player.canMove()` tells you if you can move this tick).
- **`action`** — `'bomb'` places a bomb at the player's current position. `'detonate'` triggers all of the player's active remote bombs. `null` = no action.

---

## Game State API Reference

### Player

The first parameter to `generateInput()`. Represents your bot.

**Identity:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` | Unique ID. Bots have negative IDs (-(i+1)) |
| `username` | `string` | Display name |
| `isBot` | `boolean` | Always `true` for your bot |
| `team` | `number \| null` | `0` = Red, `1` = Blue, `null` = no team |

**Position and Status:**

| Field | Type | Description |
|-------|------|-------------|
| `position` | `{ x, y }` | Current grid coordinates |
| `alive` | `boolean` | Whether the player is alive |
| `direction` | `Direction` | Current facing direction |
| `moveCooldown` | `number` | Ticks until next move allowed |
| `invulnerableTicks` | `number` | Remaining invulnerability ticks (after spawn/shield break) |

**Abilities:**

| Field | Type | Description |
|-------|------|-------------|
| `maxBombs` | `number` | Max simultaneous bombs (1-8) |
| `bombCount` | `number` | Currently placed bombs |
| `fireRange` | `number` | Explosion range (1-8) |
| `speed` | `number` | Movement speed (1-2). Speed 2 = faster cooldown |
| `hasShield` | `boolean` | Has shield (absorbs one explosion) |
| `hasKick` | `boolean` | Can kick bombs by walking into them |
| `hasPierceBomb` | `boolean` | Explosions pass through destructible walls |
| `hasRemoteBomb` | `boolean` | Bombs don't auto-detonate; use `'detonate'` action |
| `hasLineBomb` | `boolean` | Places a line of bombs in facing direction |

**Stats:**

| Field | Type | Description |
|-------|------|-------------|
| `kills` | `number` | Kill count |
| `deaths` | `number` | Death count |
| `selfKills` | `number` | Self-kill count (subtracted from score) |

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `canMove()` | `boolean` | `true` if alive and movement cooldown is 0 |
| `canPlaceBomb()` | `boolean` | `true` if alive and `bombCount < maxBombs` |

### GameStateManager

The second parameter. The entire game state.

**Core State:**

| Field | Type | Description |
|-------|------|-------------|
| `tick` | `number` | Current tick (increments each frame, 20/sec) |
| `status` | `string` | `'countdown'`, `'playing'`, or `'finished'` |
| `players` | `Map<number, Player>` | All players (alive and dead) by ID |
| `bombs` | `Map<string, Bomb>` | All active bombs by UUID |
| `explosions` | `Map<string, Explosion>` | All active explosions by UUID |
| `powerUps` | `Map<string, PowerUp>` | All uncollected power-ups by UUID |
| `map` | `Map object` | The game map (see [Map](#map)) |
| `collisionSystem` | `CollisionSystem` | Walkability and collision checks |

**Game Mode State:**

| Field | Type | Description |
|-------|------|-------------|
| `zone` | `BattleRoyaleZone \| null` | The shrinking zone (Battle Royale mode only) |
| `hillZone` | `{ x, y, width, height } \| null` | Center zone (KOTH mode only, 3x3) |
| `kothScores` | `Map<number, number>` | KOTH scores per player ID |
| `winnerId` | `number \| null` | Winner's player ID (null while playing) |
| `winnerTeam` | `number \| null` | Winning team (null if not decided/not teams) |
| `roundTime` | `number` | Round duration in seconds |

**Configuration:**

| Field | Type | Description |
|-------|------|-------------|
| `reinforcedWalls` | `boolean` | Destructible walls take 2 hits |
| `enableMapEvents` | `boolean` | Meteor strikes and power-up rain events active |

**Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `getAlivePlayers()` | `Player[]` | All currently alive players |

### Bomb

Represents an active bomb on the map.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique UUID |
| `position` | `{ x, y }` | Grid position |
| `ownerId` | `number` | Player ID of who placed it |
| `fireRange` | `number` | Blast radius (1-8) |
| `ticksRemaining` | `number` | Ticks until detonation. Normal: starts at 60 (3s). Remote: starts at 200 (10s safety max) |
| `sliding` | `Direction \| null` | Direction if being kicked, `null` if stationary |
| `bombType` | `string` | `'normal'`, `'remote'`, or `'pierce'` |
| `isPierce` | `boolean` | (getter) Whether bomb blasts through destructible walls |
| `isRemote` | `boolean` | (getter) Whether bomb requires manual detonation |

### Explosion

Represents an active explosion on the map.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique UUID |
| `cells` | `{ x, y }[]` | All cells affected by this explosion |
| `ownerId` | `number` | Player ID of bomb owner |
| `ticksRemaining` | `number` | Ticks until explosion fades (starts at 10 = 0.5s) |

| Method | Returns | Description |
|--------|---------|-------------|
| `containsCell(x, y)` | `boolean` | Whether a position is in this explosion |

### PowerUp

Represents an uncollected power-up on the map.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique UUID |
| `position` | `{ x, y }` | Grid position |
| `type` | `PowerUpType` | One of: `bomb_up`, `fire_up`, `speed_up`, `shield`, `kick`, `pierce_bomb`, `remote_bomb`, `line_bomb` |

### CollisionSystem

Accessed via `state.collisionSystem`. Handles map-level walkability checks.

| Method | Returns | Description |
|--------|---------|-------------|
| `isWalkable(x, y)` | `boolean` | Whether a tile can be walked on (doesn't check bombs/players) |
| `getTileAt(x, y)` | `TileType` | Tile type at position. Returns `'wall'` if out of bounds |

### Map

Accessed via `state.map`.

| Field | Type | Description |
|-------|------|-------------|
| `width` | `number` | Map width in tiles (always odd) |
| `height` | `number` | Map height in tiles (always odd) |
| `tiles` | `TileType[][]` | 2D array of tiles. Access as `tiles[y][x]` (row-major) |
| `spawnPoints` | `{ x, y }[]` | Player spawn positions |
| `seed` | `number` | Map generation seed |

---

## Types Reference

### Direction

```typescript
type Direction = 'up' | 'down' | 'left' | 'right';
```

Direction deltas on the grid:

| Direction | dx | dy |
|-----------|----|----|
| `'up'` | 0 | -1 |
| `'down'` | 0 | +1 |
| `'left'` | -1 | 0 |
| `'right'` | +1 | 0 |

### Position

```typescript
interface Position {
  x: number;
  y: number;
}
```

### TileType

```typescript
type TileType =
  | 'empty'              // Walkable open tile
  | 'wall'               // Indestructible wall (blocks movement and explosions)
  | 'destructible'       // Destructible wall (can be blown up)
  | 'destructible_cracked' // Cracked wall (reinforced mode: one more hit to destroy)
  | 'spawn'              // Spawn point (walkable)
  | 'teleporter_a'       // Teleporter A (instant transport to matching B)
  | 'teleporter_b'       // Teleporter B (instant transport to matching A)
  | 'conveyor_up'        // Conveyor belt (forces movement upward)
  | 'conveyor_down'      // Conveyor belt (forces movement downward)
  | 'conveyor_left'      // Conveyor belt (forces movement left)
  | 'conveyor_right';    // Conveyor belt (forces movement right)
```

Walkable tiles: `empty`, `spawn`, `teleporter_a`, `teleporter_b`, `conveyor_*`

### PowerUpType

```typescript
type PowerUpType =
  | 'bomb_up'      // +1 max bombs
  | 'fire_up'      // +1 fire range
  | 'speed_up'     // +1 speed (max 2)
  | 'shield'       // Absorbs one explosion hit
  | 'kick'         // Walk into bombs to kick them
  | 'pierce_bomb'  // Explosions pass through destructible walls
  | 'remote_bomb'  // Bombs don't auto-detonate; use 'detonate' action
  | 'line_bomb';   // Place a line of bombs in facing direction
```

---

## Constants

These are the key timing and gameplay constants from `shared/src/constants/game.ts`:

### Tick Rate

| Constant | Value | Description |
|----------|-------|-------------|
| `TICK_RATE` | `20` | Ticks per second |
| `TICK_MS` | `50` | Milliseconds per tick |

### Movement

| Constant | Value | Description |
|----------|-------|-------------|
| `MOVE_COOLDOWN_BASE` | `5` | Ticks between moves at speed 1 (4 moves/sec) |
| | `4` | At speed 2 (5 moves/sec) — calculated as `MOVE_COOLDOWN_BASE - speed + 1` |

### Bombs and Explosions

| Constant | Value | Description |
|----------|-------|-------------|
| `BOMB_TIMER_TICKS` | `60` | Ticks before auto-detonation (3 seconds) |
| `EXPLOSION_DURATION_TICKS` | `10` | Ticks explosions stay active (0.5 seconds) |
| `INVULNERABILITY_TICKS` | `40` | Invulnerability after spawn/shield break (2 seconds) |

### Player Limits

| Constant | Value | Description |
|----------|-------|-------------|
| `DEFAULT_MAX_BOMBS` | `1` | Starting bomb capacity |
| `DEFAULT_FIRE_RANGE` | `1` | Starting fire range |
| `DEFAULT_SPEED` | `1` | Starting speed |
| `MAX_BOMBS` | `8` | Maximum bomb capacity |
| `MAX_FIRE_RANGE` | `8` | Maximum fire range |
| `MAX_SPEED` | `2` | Maximum speed |

### Game Mode Specific

| Constant | Value | Description |
|----------|-------|-------------|
| `DEATHMATCH_RESPAWN_TICKS` | `60` | 3 seconds respawn delay |
| `DEATHMATCH_KILL_TARGET` | `10` | Kills to win deathmatch |
| `KOTH_ZONE_SIZE` | `3` | 3x3 center zone |
| `KOTH_SCORE_TARGET` | `100` | Points to win KOTH |
| `KOTH_POINTS_PER_TICK` | `1` | Points per tick while controlling hill |

---

## Utility Functions

These are available from `@blast-arena/shared` and useful for AI decision-making:

### getExplosionCells

Calculate which cells a bomb explosion would affect:

```typescript
import { getExplosionCells } from '@blast-arena/shared';

const cells = getExplosionCells(
  bombX,        // Origin X
  bombY,        // Origin Y
  fireRange,    // Blast radius
  map.width,    // Map width
  map.height,   // Map height
  map.tiles,    // 2D tile array
  pierce,       // Whether explosion passes through destructible walls
);
// Returns: { x: number, y: number }[]
```

The explosion expands in 4 cardinal directions up to `range` tiles. It always includes the origin. Stops at indestructible walls. Normal bombs stop at destructible walls; pierce bombs pass through them (but still destroy them).

### manhattanDistance

```typescript
import { manhattanDistance } from '@blast-arena/shared';

const dist = manhattanDistance(
  { x: 1, y: 2 },
  { x: 4, y: 6 },
); // Returns 7
```

### isInBounds

```typescript
import { isInBounds } from '@blast-arena/shared';

const valid = isInBounds(x, y, map.width, map.height); // Returns boolean
```

---

## Difficulty System

Your constructor receives a `difficulty` parameter (`'easy'`, `'normal'`, or `'hard'`). Use this to adjust your AI's behavior — the room creator or simulation admin chooses the difficulty.

**Suggested scaling by difficulty:**

| Behavior | Easy | Normal | Hard |
|----------|------|--------|------|
| Reaction time | Slow (add delays) | Medium | Instant |
| Search depth | Shallow (2-6) | Medium (8-25) | Deep (15-40) |
| Bomb placement | Conservative, random mistakes | Calculated | Aggressive, optimal |
| Power-up seeking | Short range | Medium range | Long range |
| Enemy hunting | Rarely (15%) | Often (90%) | Almost always (95%) |
| Escape planning | Poor | Good | Perfect with chain reactions |
| Deliberate mistakes | ~25% wrong moves | None | None |

The `mapSize` parameter lets you scale search depths for larger maps. The built-in AI scales proportionally to the ratio of map area vs the 15x13 reference:

```typescript
const referenceArea = 15 * 13;
const scale = Math.max(1, Math.sqrt((mapSize.width * mapSize.height) / referenceArea));
// Then multiply search depths by scale
```

---

## Game Modes

Your AI should adapt its strategy to the current game mode. You can detect the mode by observing the game state:

| Mode | Detection | Strategy Notes |
|------|-----------|----------------|
| **Free for All** | No zone, no hillZone, no respawns | Last one standing. Balance offense/defense |
| **Teams** | Players have non-null `team` values | Coordinate with teammates, don't kill allies |
| **Battle Royale** | `state.zone` is not null | Stay inside the shrinking zone. Zone damage kills |
| **Sudden Death** | All players start maxed (8 bombs, 8 range, max speed, kick) | One hit kills. Be extremely careful |
| **Deathmatch** | Players respawn after death | Maximize kills, don't worry about dying. First to 10 wins |
| **King of the Hill** | `state.hillZone` is not null | Control the 3x3 center zone for points. First to 100 wins |

**Detecting teams:** Check `player.team !== null`. Teammates have the same `team` value. Avoid killing teammates (when friendly fire is off, your bombs won't damage them anyway, but you still waste bombs).

**Detecting Sudden Death:** All players start with `maxBombs = 8`, `fireRange = 8`, `speed = MAX_SPEED`, `hasKick = true`. No power-ups spawn.

---

## Logging

The optional `logger` parameter lets you log bot decisions for debugging. Logs appear in game log files and replay log panels.

```typescript
generateInput(player, state, logger) {
  // Log a decision
  logger?.logBotDecision(
    player.id,
    'hunt',           // Decision category (arbitrary string)
    'Moving toward enemy at (5,3)',  // Description
  );

  // Log pathfinding
  logger?.logBotPathfinding(
    player.id,
    'bfs',            // Algorithm name
    12,               // Path length
    { x: 5, y: 3 },  // Target position (or null)
  );
}
```

**Available logging methods:**

| Method | Parameters | When to Use |
|--------|-----------|-------------|
| `logBotDecision(botId, decision, details)` | `number, string, string` | Log any AI decision |
| `logBotPathfinding(botId, algorithm, pathLength, target)` | `number, string, number, Position \| null` | Log pathfinding results |
| `logMovement(playerId, playerName, from, to, direction)` | Movement events (auto-logged by engine) |
| `logBomb(event, ownerId, ownerName, pos, fireRange?)` | Bomb events (auto-logged by engine) |

Log verbosity is configured per game/simulation:
- **Normal** — Only tick snapshots every 5 ticks
- **Detailed** — Tick snapshots every 2 ticks + movements + pickups
- **Full** — Every tick + explosion detail + bot pathfinding + your logBotDecision calls

---

## Upload and Validation

When you upload a `.ts` file via the admin panel, the server runs this pipeline:

### 1. File Size Check
Maximum **500KB** source file.

### 2. Dangerous Import Scan
The following Node.js modules are **forbidden** (both `require()` and `import` syntax):

`fs`, `child_process`, `net`, `http`, `https`, `dgram`, `cluster`, `worker_threads`, `vm`, `os`, `dns`, `tls`, `readline`

This is defense-in-depth — only admins can upload, but these modules have no legitimate use in a bot AI.

### 3. TypeScript Compilation
The server uses esbuild to transpile your TypeScript to JavaScript. Any syntax errors or type errors that esbuild catches will be reported back.

### 4. Structure Validation
The compiled code is loaded and checked:
- Must export a class (default export or named export)
- The class prototype must have a `generateInput` method
- The class must be instantiable with `new YourClass('normal')` without throwing

If any step fails, you get the error details in the upload modal.

### What You Can Import

You **can** import from:
- `@blast-arena/shared` — Types, constants, utility functions

You **cannot** import from:
- Node.js built-in modules (blocked list above)
- External npm packages (not available at runtime)
- Other project files (your AI runs in isolation)

In practice, most AI logic is self-contained. Use the types from `@blast-arena/shared` for type safety, and implement your algorithms inline.

---

## Runtime Behavior

### Execution
- `generateInput()` is called **once per tick** (20 times per second) for each bot using your AI
- Each bot gets its own class instance — state is not shared between bots
- The function should return quickly. Long-running computations block the game tick for all players.

### Error Handling
If your `generateInput()` throws an exception:
1. The error is logged to the game logger
2. That specific bot is **immediately replaced** with the built-in AI (normal difficulty)
3. The game continues without interruption
4. The replacement is permanent for that game — your AI won't be retried

### Memory
Your class instance persists for the entire game. You can store state across ticks (position history, cooldown timers, pathfinding caches, etc.) as instance fields.

### No Side Effects
Your AI has no access to the filesystem, network, or other system resources. It can only read game state and return input decisions.

---

## Complete Example

Here's a functional bot AI with danger avoidance, enemy hunting, power-up collection, and bomb placement:

```typescript
import {
  PlayerInput,
  Direction,
  Position,
  TileType,
  getExplosionCells,
} from '@blast-arena/shared';
import { Player } from './Player';
import { GameStateManager } from './GameState';
import { GameLogger } from '../utils/gameLogger';

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export class ExampleBot {
  private seq = 0;
  private bombCooldown = 0;
  private huntDepth: number;
  private escapeDepth: number;

  constructor(
    difficulty: 'easy' | 'normal' | 'hard' = 'normal',
    mapSize?: { width: number; height: number },
  ) {
    // Scale search depth by difficulty and map size
    const baseHunt = difficulty === 'easy' ? 6 : difficulty === 'normal' ? 20 : 35;
    const baseEscape = difficulty === 'easy' ? 3 : difficulty === 'normal' ? 8 : 15;
    const scale = mapSize
      ? Math.max(1, Math.sqrt((mapSize.width * mapSize.height) / (15 * 13)))
      : 1;
    this.huntDepth = Math.round(baseHunt * scale);
    this.escapeDepth = Math.round(baseEscape * scale);
  }

  generateInput(
    player: Player,
    state: GameStateManager,
    logger?: GameLogger | null,
  ): PlayerInput | null {
    if (!player.alive) return null;

    this.seq++;
    if (this.bombCooldown > 0) this.bombCooldown--;

    const { x, y } = player.position;
    let direction: Direction | null = null;
    let action: 'bomb' | 'detonate' | null = null;

    // Step 1: Get danger cells (tiles that will explode soon)
    const dangerCells = this.getDangerCells(state, player.fireRange);

    // Step 2: If we're in danger, flee!
    const myKey = `${x},${y}`;
    if (dangerCells.has(myKey)) {
      direction = this.findSafeDirection(player, state, dangerCells);
      logger?.logBotDecision(player.id, 'flee', `Fleeing ${direction || 'stuck'}`);
      return { seq: this.seq, direction, action: null, tick: state.tick };
    }

    // Step 3: Look for nearby power-ups
    const powerUpDir = this.findPowerUp(player, state, dangerCells);
    if (powerUpDir) {
      direction = powerUpDir;
      logger?.logBotDecision(player.id, 'powerup', `Seeking power-up ${direction}`);
      return { seq: this.seq, direction, action: null, tick: state.tick };
    }

    // Step 4: Hunt enemies
    const enemies = state.getAlivePlayers().filter(
      (p) => p.id !== player.id && (player.team === null || p.team !== player.team),
    );

    if (enemies.length > 0) {
      // Find nearest enemy
      const nearest = enemies.reduce((best, e) => {
        const dist = Math.abs(e.position.x - x) + Math.abs(e.position.y - y);
        const bestDist = Math.abs(best.position.x - x) + Math.abs(best.position.y - y);
        return dist < bestDist ? e : best;
      });

      const dist = Math.abs(nearest.position.x - x) + Math.abs(nearest.position.y - y);

      // If close enough, consider placing a bomb
      if (dist <= player.fireRange + 1 && this.bombCooldown <= 0 && player.canPlaceBomb()) {
        // Check if enemy is in blast range
        const blastCells = getExplosionCells(
          x, y, player.fireRange,
          state.map.width, state.map.height, state.map.tiles,
          player.hasPierceBomb,
        );
        const enemyInBlast = blastCells.some(
          (c) => c.x === nearest.position.x && c.y === nearest.position.y,
        );

        if (enemyInBlast && this.canEscapeAfterBomb(player, state, dangerCells)) {
          action = 'bomb';
          this.bombCooldown = 20;
          logger?.logBotDecision(player.id, 'bomb_hunt', `Bombing near enemy at ${dist} tiles`);
        }
      }

      // Move toward enemy using BFS
      direction = this.bfsToward(player, state, nearest.position, dangerCells);
      if (direction) {
        logger?.logBotDecision(player.id, 'hunt', `Hunting toward (${nearest.position.x},${nearest.position.y})`);
      }
    }

    // Step 5: If no direction found, wander
    if (!direction) {
      direction = this.randomSafeDirection(player, state, dangerCells);
    }

    // Step 6: Remote bomb detonation
    if (player.hasRemoteBomb && action !== 'bomb') {
      const ownRemoteBombs = Array.from(state.bombs.values()).filter(
        (b) => b.ownerId === player.id && b.isRemote,
      );
      if (ownRemoteBombs.length > 0) {
        // Detonate if any enemy is in blast range of our remote bombs
        for (const bomb of ownRemoteBombs) {
          const blast = getExplosionCells(
            bomb.position.x, bomb.position.y, bomb.fireRange,
            state.map.width, state.map.height, state.map.tiles,
            bomb.isPierce,
          );
          const enemyHit = enemies.some((e) =>
            blast.some((c) => c.x === e.position.x && c.y === e.position.y),
          );
          if (enemyHit) {
            action = 'detonate';
            break;
          }
        }
      }
    }

    return { seq: this.seq, direction, action, tick: state.tick };
  }

  /** Collect all cells that are in bomb blast zones */
  private getDangerCells(
    state: GameStateManager,
    fireRange: number,
  ): Set<string> {
    const danger = new Set<string>();

    // Active explosions
    for (const exp of state.explosions.values()) {
      for (const cell of exp.cells) {
        danger.add(`${cell.x},${cell.y}`);
      }
    }

    // Bomb blast zones
    for (const bomb of state.bombs.values()) {
      const cells = getExplosionCells(
        bomb.position.x, bomb.position.y, bomb.fireRange,
        state.map.width, state.map.height, state.map.tiles,
        bomb.isPierce,
      );
      for (const cell of cells) {
        danger.add(`${cell.x},${cell.y}`);
      }
    }

    return danger;
  }

  /** BFS to find a safe direction away from danger */
  private findSafeDirection(
    player: Player,
    state: GameStateManager,
    danger: Set<string>,
  ): Direction | null {
    const { x, y } = player.position;

    // Try each direction, pick one that leads to a safe cell
    const safeDirs: Direction[] = [];
    for (const dir of DIRECTIONS) {
      const nx = x + DIR_DELTA[dir].dx;
      const ny = y + DIR_DELTA[dir].dy;
      if (
        state.collisionSystem.isWalkable(nx, ny) &&
        !this.hasBombAt(state, nx, ny) &&
        !danger.has(`${nx},${ny}`)
      ) {
        safeDirs.push(dir);
      }
    }

    if (safeDirs.length > 0) {
      return safeDirs[Math.floor(Math.random() * safeDirs.length)];
    }

    // No immediately safe direction — move to any walkable tile
    for (const dir of DIRECTIONS) {
      const nx = x + DIR_DELTA[dir].dx;
      const ny = y + DIR_DELTA[dir].dy;
      if (state.collisionSystem.isWalkable(nx, ny) && !this.hasBombAt(state, nx, ny)) {
        return dir;
      }
    }

    return null;
  }

  /** BFS pathfinding toward a target position */
  private bfsToward(
    player: Player,
    state: GameStateManager,
    target: Position,
    danger: Set<string>,
  ): Direction | null {
    const { x, y } = player.position;
    const queue: { x: number; y: number; firstDir: Direction }[] = [];
    const visited = new Set<string>();
    visited.add(`${x},${y}`);

    for (const dir of DIRECTIONS) {
      const nx = x + DIR_DELTA[dir].dx;
      const ny = y + DIR_DELTA[dir].dy;
      const key = `${nx},${ny}`;
      if (
        state.collisionSystem.isWalkable(nx, ny) &&
        !this.hasBombAt(state, nx, ny) &&
        !danger.has(key) &&
        !visited.has(key)
      ) {
        if (nx === target.x && ny === target.y) return dir;
        visited.add(key);
        queue.push({ x: nx, y: ny, firstDir: dir });
      }
    }

    let depth = 0;
    let i = 0;
    while (i < queue.length && depth < this.huntDepth) {
      const { x: cx, y: cy, firstDir } = queue[i++];
      depth++;

      for (const dir of DIRECTIONS) {
        const nx = cx + DIR_DELTA[dir].dx;
        const ny = cy + DIR_DELTA[dir].dy;
        const key = `${nx},${ny}`;
        if (
          state.collisionSystem.isWalkable(nx, ny) &&
          !visited.has(key) &&
          !danger.has(key)
        ) {
          if (nx === target.x && ny === target.y) return firstDir;
          visited.add(key);
          queue.push({ x: nx, y: ny, firstDir });
        }
      }
    }

    return null;
  }

  /** Find direction to nearest power-up within range */
  private findPowerUp(
    player: Player,
    state: GameStateManager,
    danger: Set<string>,
  ): Direction | null {
    const { x, y } = player.position;
    let bestDir: Direction | null = null;
    let bestDist = Infinity;

    for (const pu of state.powerUps.values()) {
      const dist = Math.abs(pu.position.x - x) + Math.abs(pu.position.y - y);
      if (dist < bestDist && dist <= 8) {
        const dir = this.bfsToward(player, state, pu.position, danger);
        if (dir) {
          bestDir = dir;
          bestDist = dist;
        }
      }
    }

    return bestDir;
  }

  /** Check if we can escape after placing a bomb at current position */
  private canEscapeAfterBomb(
    player: Player,
    state: GameStateManager,
    existingDanger: Set<string>,
  ): boolean {
    const { x, y } = player.position;

    // Simulate our own bomb's blast zone
    const newBlast = getExplosionCells(
      x, y, player.fireRange,
      state.map.width, state.map.height, state.map.tiles,
      player.hasPierceBomb,
    );
    const combinedDanger = new Set(existingDanger);
    for (const cell of newBlast) {
      combinedDanger.add(`${cell.x},${cell.y}`);
    }

    // Check if any adjacent walkable cell is safe
    for (const dir of DIRECTIONS) {
      const nx = x + DIR_DELTA[dir].dx;
      const ny = y + DIR_DELTA[dir].dy;
      if (
        state.collisionSystem.isWalkable(nx, ny) &&
        !this.hasBombAt(state, nx, ny) &&
        !combinedDanger.has(`${nx},${ny}`)
      ) {
        return true;
      }
    }

    return false;
  }

  /** Pick a random safe walkable direction */
  private randomSafeDirection(
    player: Player,
    state: GameStateManager,
    danger: Set<string>,
  ): Direction | null {
    const { x, y } = player.position;
    const options: Direction[] = [];

    for (const dir of DIRECTIONS) {
      const nx = x + DIR_DELTA[dir].dx;
      const ny = y + DIR_DELTA[dir].dy;
      if (
        state.collisionSystem.isWalkable(nx, ny) &&
        !this.hasBombAt(state, nx, ny) &&
        !danger.has(`${nx},${ny}`)
      ) {
        options.push(dir);
      }
    }

    return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : null;
  }

  /** Check if there's a bomb at a position */
  private hasBombAt(state: GameStateManager, x: number, y: number): boolean {
    for (const bomb of state.bombs.values()) {
      if (bomb.position.x === x && bomb.position.y === y) return true;
    }
    return false;
  }
}
```

This example AI:
- Flees from danger (active explosions and bomb blast zones)
- Seeks nearby power-ups using BFS pathfinding
- Hunts the nearest enemy using BFS
- Places bombs when enemies are in blast range (with escape verification)
- Detonates remote bombs when enemies are in range
- Scales search depth by difficulty and map size
- Respects team membership (doesn't target teammates)
- Falls back to random safe movement when nothing else to do

It's simpler than the built-in AI (which has 2000+ lines of logic), but demonstrates all the core patterns.

---

## Tips and Best Practices

### Performance
- `generateInput()` runs on the game thread. Keep it under 1ms per call.
- Avoid allocating large arrays every tick. Cache and reuse data structures.
- BFS with a depth limit is better than unlimited graph search.
- Pre-compute danger zones once per tick, not per-decision.

### Common Patterns
- **Danger avoidance** comes first. Always check if you're in a blast zone before anything else.
- **Bomb placement safety**: Always verify you can escape before placing a bomb. Use `getExplosionCells()` to simulate your own bomb's blast, then check for safe adjacent tiles.
- **Movement cooldown**: `player.canMove()` tells you if input will actually move the bot. You can still return a direction when on cooldown — the engine will buffer it.
- **Sequence numbers**: Increment `seq` every call. The engine uses it for input ordering.

### Difficulty Scaling
- **Easy bots should lose**. Add deliberate mistakes: random wrong directions, unnecessary bombs, delayed reactions.
- **Normal bots should be competitive** but beatable. Good pathfinding, decent danger avoidance, some aggression.
- **Hard bots should be challenging**. Deep search, chain reaction awareness, optimal bomb placement, no wasted moves.

### Debugging
- Download the built-in AI from the admin panel as reference — it covers every edge case.
- Use `logger?.logBotDecision()` liberally during development. Set simulation log verbosity to "Full" to see all logs.
- Run simulations in real-time mode to visually observe your bot's behavior.
- If your AI crashes, check the game logs for the error message. The fallback to builtin means the game won't break, but you'll want to fix the bug.

### Things to Watch Out For
- **Tiles are `tiles[y][x]`**, not `tiles[x][y]`. Row-major order.
- **Bomb positions can change** if a bomb is being kicked (`bomb.sliding !== null`).
- **Dead players are still in `state.players`** — filter by `player.alive` when looking for enemies.
- **Remote bombs** have a 10-second safety max timer (200 ticks). They'll auto-detonate eventually.
- **Shield** has no time limit but only absorbs one hit. After breaking, the player gets 10 ticks of invulnerability.
- **Reinforced walls** need two bomb hits. First hit changes tile to `'destructible_cracked'`.
- **Line bombs** place multiple bombs in the facing direction. Plan escape accordingly.
