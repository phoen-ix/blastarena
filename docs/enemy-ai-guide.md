# Enemy AI Developer Guide

Write custom AI scripts for campaign enemies. Enemy AIs are TypeScript classes that control enemy movement and bomb placement each tick.

## Interface

```typescript
interface IEnemyAI {
  decide(context: EnemyAIContext): { direction: Direction | null; placeBomb: boolean };
}
```

Your class must:
1. Export a class (default or named export)
2. Accept `(difficulty: 'easy' | 'normal' | 'hard', typeConfig)` in the constructor
3. Implement a `decide(context)` method returning `{ direction, placeBomb }`

## Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `difficulty` | `'easy' \| 'normal' \| 'hard'` | Set per enemy type in the admin panel |
| `typeConfig` | object | Enemy abilities: `speed`, `canPassWalls`, `canPassBombs`, `canBomb`, `contactDamage`, `isBoss`, `sizeMultiplier` |

## Context

The `decide()` method receives an `EnemyAIContext` object each tick:

| Field | Type | Description |
|-------|------|-------------|
| `self.position` | `{x, y}` | Enemy's current grid position |
| `self.hp` / `self.maxHp` | number | Current and max health |
| `self.direction` | Direction | Current facing direction |
| `self.typeConfig` | object | Enemy abilities (same as constructor) |
| `self.patrolPath` | Position[] | Waypoints for patrol movement |
| `self.patrolIndex` | number | Current patrol waypoint index |
| `players` | array | Alive players: `{ position, alive }` |
| `tiles` | TileType[][] | Full map tile grid |
| `mapWidth` / `mapHeight` | number | Map dimensions |
| `bombPositions` | Position[] | All bomb locations |
| `otherEnemies` | array | Other alive enemies: `{ position, enemyTypeId, alive }` |
| `tick` | number | Current game tick |
| `rng` | `() => number` | Seeded random (0-1). Use this instead of Math.random() for deterministic replays |

## Return Value

```typescript
{
  direction: 'up' | 'down' | 'left' | 'right' | null,  // null = don't move
  placeBomb: boolean  // true = attempt to place bomb (respects cooldown externally)
}
```

Movement cooldown and bomb cooldown are handled by the game engine. Your AI just says what it *wants* to do each tick.

## Example: Smart Chaser

```typescript
export class SmartChaser {
  private difficulty: string;

  constructor(difficulty: 'easy' | 'normal' | 'hard') {
    this.difficulty = difficulty;
  }

  decide(ctx: any) {
    const { self, players, bombPositions, rng } = ctx;

    // Find nearest player
    let nearest = null;
    let minDist = Infinity;
    for (const p of players) {
      const d = Math.abs(p.position.x - self.position.x) + Math.abs(p.position.y - self.position.y);
      if (d < minDist) { minDist = d; nearest = p; }
    }

    if (!nearest) return { direction: null, placeBomb: false };

    // Chase with some randomness on easy
    const chaseChance = this.difficulty === 'easy' ? 0.5 : this.difficulty === 'normal' ? 0.7 : 0.9;
    let direction = null;

    if (rng() < chaseChance) {
      const dx = nearest.position.x - self.position.x;
      const dy = nearest.position.y - self.position.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        direction = dx > 0 ? 'right' : 'left';
      } else if (dy !== 0) {
        direction = dy > 0 ? 'down' : 'up';
      }
    } else {
      const dirs = ['up', 'down', 'left', 'right'];
      direction = dirs[Math.floor(rng() * dirs.length)];
    }

    // Place bomb when close to player
    const placeBomb = minDist <= 3 && rng() < 0.3;

    return { direction, placeBomb };
  }
}
```

## Sandbox Restrictions

Enemy AI scripts run in the same sandboxed environment as bot AIs:
- No `import`/`require` statements
- No access to `fs`, `process`, `child_process`, etc.
- No `eval()`, `Function()`, or `Proxy`
- 5 second compilation timeout
- 500KB max file size

## Boss Phases

When an enemy with a custom AI is a boss with phases:
- Speed changes from phases still apply (affects movement cooldown)
- Bomb config changes still apply
- Minion spawning still works
- `movementPattern` changes in phases are **ignored** (your AI controls movement)

## Assigning AI to Enemy Types

1. Upload your AI in Admin > AI > Enemy AI Management
2. Edit an enemy type in Admin > Campaign > Enemy Types
3. Select your AI from the "Custom AI" dropdown
4. Choose a difficulty level
5. The movement pattern dropdown is kept but overridden when a custom AI is set

## Export/Import

When exporting an enemy type that uses a custom AI, the AI source code is bundled in the export JSON. On import, you can:
- **Create**: Compile and create the AI as a new entry
- **Use existing**: Point to an existing AI by ID
- **Skip**: Remove the AI reference (enemy falls back to movement pattern)
