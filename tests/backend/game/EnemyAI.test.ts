import { describe, it, expect, beforeEach } from '@jest/globals';
import { processEnemyAI } from '../../../backend/src/game/EnemyAI';
import { Enemy } from '../../../backend/src/game/Enemy';
import { Player } from '../../../backend/src/game/Player';
import { CollisionSystem } from '../../../backend/src/game/CollisionSystem';
import type { TileType, Position, Direction, EnemyTypeConfig } from '@blast-arena/shared';

/** Minimal enemy type config for tests */
function makeConfig(overrides: Partial<EnemyTypeConfig> = {}): EnemyTypeConfig {
  return {
    speed: 1,
    movementPattern: 'random_walk',
    canPassWalls: false,
    canPassBombs: false,
    canBomb: false,
    hp: 3,
    contactDamage: true,
    sprite: {
      bodyShape: 'blob',
      primaryColor: '#ff0000',
      secondaryColor: '#880000',
      eyeStyle: 'round',
      hasTeeth: false,
      hasHorns: false,
    },
    dropChance: 0.5,
    dropTable: ['bomb_up'],
    isBoss: false,
    sizeMultiplier: 1,
    ...overrides,
  };
}

/**
 * Create a simple tile grid. All 'empty' by default, with 'wall' borders.
 */
function makeEmptyMap(width: number, height: number): TileType[][] {
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x++) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row.push('wall');
      } else {
        row.push('empty');
      }
    }
    tiles.push(row);
  }
  return tiles;
}

/** Deterministic RNG that always returns a fixed value */
function fixedRng(value: number): () => number {
  return () => value;
}

/** Sequence of RNG values */
function seqRng(values: number[]): () => number {
  let idx = 0;
  return () => {
    const val = values[idx % values.length];
    idx++;
    return val;
  };
}

describe('EnemyAI — processEnemyAI', () => {
  let tiles: TileType[][];
  let collision: CollisionSystem;
  const mapWidth = 11;
  const mapHeight = 11;

  beforeEach(() => {
    Enemy.resetIdCounter();
    tiles = makeEmptyMap(mapWidth, mapHeight);
    collision = new CollisionSystem(tiles, mapWidth, mapHeight);
  });

  // ───────────────────────────────────────────────
  // 1. Dead Enemy / No Players
  // ───────────────────────────────────────────────
  describe('early exits', () => {
    it('should return no action for dead enemy', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig());
      enemy.alive = false;
      const player = new Player(1, 'Alice', { x: 3, y: 3 });
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
      expect(result.placeBomb).toBe(false);
    });

    it('should return no action when no players are alive', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig());
      const deadPlayer = new Player(1, 'Alice', { x: 3, y: 3 });
      deadPlayer.alive = false;
      const result = processEnemyAI(enemy, [deadPlayer], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
      expect(result.placeBomb).toBe(false);
    });

    it('should return no action when players array is empty', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig());
      const result = processEnemyAI(enemy, [], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
      expect(result.placeBomb).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 2. Movement Cooldown
  // ───────────────────────────────────────────────
  describe('movement cooldown', () => {
    it('should not move when on cooldown', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig());
      enemy.moveCooldown = 3;
      const player = new Player(1, 'Alice', { x: 3, y: 3 });
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
    });

    it('should move when cooldown is 0', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig());
      enemy.moveCooldown = 0;
      const player = new Player(1, 'Alice', { x: 3, y: 3 });
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).not.toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // 3. Stationary Pattern
  // ───────────────────────────────────────────────
  describe('stationary pattern', () => {
    it('should never move when pattern is stationary', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'stationary' }));
      const player = new Player(1, 'Alice', { x: 3, y: 3 });

      for (let i = 0; i < 20; i++) {
        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(Math.random()));
        expect(result.direction).toBeNull();
      }
    });
  });

  // ───────────────────────────────────────────────
  // 4. Random Walk Pattern
  // ───────────────────────────────────────────────
  describe('random_walk pattern', () => {
    it('should pick a walkable direction', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'random_walk' }));
      const player = new Player(1, 'Alice', { x: 3, y: 3 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).not.toBeNull();
      expect(['up', 'down', 'left', 'right']).toContain(result.direction);
    });

    it('should continue current direction 60% of the time when possible', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'random_walk' }));
      enemy.direction = 'right';
      const player = new Player(1, 'Alice', { x: 3, y: 3 });

      // rng < 0.6 => continue current direction
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.3));
      expect(result.direction).toBe('right');
    });

    it('should pick random direction when rng >= 0.6', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'random_walk' }));
      enemy.direction = 'right';
      const player = new Player(1, 'Alice', { x: 3, y: 3 });

      // rng >= 0.6 => pick random from walkable
      // With rng=0.7 for the first call, then rng=0.0 for floor() => picks first walkable dir
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.7));
      expect(result.direction).not.toBeNull();
    });

    it('should return null when completely boxed in', () => {
      // Place enemy at (1,1) and surround with walls
      tiles[0][1] = 'wall'; // above
      tiles[2][1] = 'wall'; // below
      tiles[1][0] = 'wall'; // left (already border)
      tiles[1][2] = 'wall'; // right
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(1, { x: 1, y: 1 }, makeConfig({ movementPattern: 'random_walk' }));
      const player = new Player(1, 'Alice', { x: 5, y: 5 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
    });

    it('should avoid bomb positions when canPassBombs is false', () => {
      // Enemy at (5,5), bombs surround on 3 sides, one opening
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'random_walk', canPassBombs: false }),
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const bombs: Position[] = [
        { x: 5, y: 4 }, // up
        { x: 5, y: 6 }, // down
        { x: 4, y: 5 }, // left
      ];
      // Only right is open
      // Use rng=0.7 (skip continue-direction) and rng=0.0 (pick first walkable)
      const result = processEnemyAI(enemy, [player], collision, bombs, fixedRng(0.7));
      expect(result.direction).toBe('right');
    });

    it('should allow passing bombs when canPassBombs is true', () => {
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'random_walk', canPassBombs: true }),
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const bombs: Position[] = [
        { x: 5, y: 4 }, // up
        { x: 5, y: 6 }, // down
        { x: 4, y: 5 }, // left
      ];
      // All 4 dirs are walkable since canPassBombs
      const result = processEnemyAI(enemy, [player], collision, bombs, seqRng([0.7, 0.0]));
      expect(result.direction).not.toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // 5. Chase Player Pattern
  // ───────────────────────────────────────────────
  describe('chase_player pattern', () => {
    it('should chase the nearest player via BFS (70% of the time)', () => {
      // Enemy at (5,5), player at (5,3) — directly above
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      const player = new Player(1, 'Alice', { x: 5, y: 3 });

      // rng < 0.7 => follow BFS
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      expect(result.direction).toBe('up');
    });

    it('should chase the closest player when multiple are present', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      const farPlayer = new Player(1, 'Alice', { x: 9, y: 9 });
      const nearPlayer = new Player(2, 'Bob', { x: 5, y: 3 });

      const result = processEnemyAI(enemy, [farPlayer, nearPlayer], collision, [], fixedRng(0.1));
      // Should chase Bob (closer), direction = up
      expect(result.direction).toBe('up');
    });

    it('should chase horizontally when player is to the side', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      const player = new Player(1, 'Alice', { x: 8, y: 5 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      expect(result.direction).toBe('right');
    });

    it('should fall back to random walk when rng >= 0.7', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      const player = new Player(1, 'Alice', { x: 5, y: 3 });

      // rng >= 0.7 => random walk fallback
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.8));
      // Should still return some valid direction
      expect(result.direction).not.toBeNull();
    });

    it('should ignore dead players in nearest calculation', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      const deadPlayer = new Player(1, 'Alice', { x: 5, y: 4 }); // very close
      deadPlayer.alive = false;
      const alivePlayer = new Player(2, 'Bob', { x: 5, y: 3 }); // farther

      const result = processEnemyAI(enemy, [deadPlayer, alivePlayer], collision, [], fixedRng(0.1));
      expect(result.direction).toBe('up');
    });

    it('should navigate around obstacles via BFS', () => {
      // Place a wall between enemy and player
      // Enemy at (5,5), wall at (5,4), player at (5,3)
      tiles[4][5] = 'wall';
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      const player = new Player(1, 'Alice', { x: 5, y: 3 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      // Can't go up directly, BFS should route around (left or right)
      expect(result.direction).not.toBeNull();
      expect(result.direction).not.toBe('up');
    });
  });

  // ───────────────────────────────────────────────
  // 6. Patrol Path Pattern
  // ───────────────────────────────────────────────
  describe('patrol_path pattern', () => {
    it('should return null for empty patrol path', () => {
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'patrol_path' }),
        [], // empty path
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
    });

    it('should move toward next patrol waypoint', () => {
      const patrolPath = [
        { x: 5, y: 5 },
        { x: 7, y: 5 },
      ];
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'patrol_path' }),
        patrolPath,
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      // Start at waypoint 0, which is (5,5). At that waypoint already, advance to next.
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // After advancing, target is (7,5), so should move right
      expect(result.direction).toBe('right');
    });

    it('should reverse direction at end of patrol path', () => {
      const patrolPath = [
        { x: 3, y: 5 },
        { x: 5, y: 5 },
        { x: 7, y: 5 },
      ];
      const enemy = new Enemy(
        1,
        { x: 7, y: 5 },
        makeConfig({ movementPattern: 'patrol_path' }),
        patrolPath,
      );
      enemy.patrolIndex = 2; // at the last waypoint
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      // At waypoint 2 (7,5) which is end. Should reverse to forward=false and go to index 1.
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(enemy.patrolForward).toBe(false);
      // Target is now patrolPath[1] = (5,5), should move left
      expect(result.direction).toBe('left');
    });

    it('should reverse direction at start of patrol path (going backward)', () => {
      const patrolPath = [
        { x: 3, y: 5 },
        { x: 5, y: 5 },
        { x: 7, y: 5 },
      ];
      const enemy = new Enemy(
        1,
        { x: 3, y: 5 },
        makeConfig({ movementPattern: 'patrol_path' }),
        patrolPath,
      );
      enemy.patrolIndex = 0;
      enemy.patrolForward = false;
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      // At waypoint 0 going backward. Should reverse to forward=true and go to index 1.
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(enemy.patrolForward).toBe(true);
      // Target is patrolPath[1] = (5,5), should move right
      expect(result.direction).toBe('right');
    });

    it('should handle single-waypoint patrol path', () => {
      const patrolPath = [{ x: 5, y: 5 }];
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'patrol_path' }),
        patrolPath,
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      // At the only waypoint — forward advance wraps, reverse wraps back
      // This tests the edge case behavior
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // With single waypoint, after reaching it the index stays clamped at 0
      expect(result.direction).toBeNull(); // at target, no movement needed
    });
  });

  // ───────────────────────────────────────────────
  // 7. Wall Follow Pattern
  // ───────────────────────────────────────────────
  describe('wall_follow pattern', () => {
    it('should follow right-hand rule', () => {
      const enemy = new Enemy(1, { x: 1, y: 1 }, makeConfig({ movementPattern: 'wall_follow' }));
      enemy.direction = 'down'; // facing down, right of down = left
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // Try order for facing down: left, down, right, up
      // (1,1) — left would be (0,1) = wall, down = (1,2) = empty
      expect(result.direction).toBe('down');
    });

    it('should try right-of-current first', () => {
      // Facing up, right of up = right
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'wall_follow' }));
      enemy.direction = 'up';
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // right of up = right. (6,5) is empty, so should go right
      expect(result.direction).toBe('right');
    });

    it('should avoid bombs when canPassBombs is false', () => {
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'wall_follow', canPassBombs: false }),
      );
      enemy.direction = 'up';
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      // Block right (the preferred right-hand direction)
      const bombs: Position[] = [{ x: 6, y: 5 }];
      const result = processEnemyAI(enemy, [player], collision, bombs, fixedRng(0.5));
      // right blocked by bomb, try current (up), which is (5,4) = empty
      expect(result.direction).toBe('up');
    });

    it('should return null when completely surrounded', () => {
      tiles[4][5] = 'wall'; // up
      tiles[6][5] = 'wall'; // down
      tiles[5][4] = 'wall'; // left
      tiles[5][6] = 'wall'; // right
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'wall_follow' }));
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
    });

    it('should navigate a corridor using wall follow', () => {
      // Create a narrow horizontal corridor at y=5
      for (let x = 1; x < mapWidth - 1; x++) {
        tiles[4][x] = 'wall'; // wall above corridor
        tiles[6][x] = 'wall'; // wall below corridor
      }
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(1, { x: 3, y: 5 }, makeConfig({ movementPattern: 'wall_follow' }));
      enemy.direction = 'right';
      const player = new Player(1, 'Alice', { x: 9, y: 5 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // Facing right, right-of-right = down. Down (3,6) is wall. Try current = right (4,5) = empty.
      expect(result.direction).toBe('right');
    });
  });

  // ───────────────────────────────────────────────
  // 8. Ghost (canPassWalls) Movement
  // ───────────────────────────────────────────────
  describe('canPassWalls', () => {
    it('should walk through destructible walls when canPassWalls is true', () => {
      // Place destructible walls around enemy
      tiles[4][5] = 'destructible';
      tiles[6][5] = 'destructible';
      tiles[5][4] = 'destructible';
      tiles[5][6] = 'destructible';
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'random_walk', canPassWalls: true }),
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      // rng >= 0.6 => random pick. With rng=0.7 and floor(0.7*4)=2, picks 3rd direction
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.7));
      expect(result.direction).not.toBeNull();
    });

    it('should not walk through indestructible walls even with canPassWalls', () => {
      // Surround with indestructible walls
      tiles[4][5] = 'wall';
      tiles[6][5] = 'wall';
      tiles[5][4] = 'wall';
      tiles[5][6] = 'wall';
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'random_walk', canPassWalls: true }),
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
    });

    it('should work with chase_player and BFS through destructible walls', () => {
      // Wall between enemy and player, but destructible
      tiles[4][5] = 'destructible';
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'chase_player', canPassWalls: true }),
      );
      const player = new Player(1, 'Alice', { x: 5, y: 3 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      // BFS with canPassWalls should go through destructible, so direction = up
      expect(result.direction).toBe('up');
    });
  });

  // ───────────────────────────────────────────────
  // 9. Bomb Placement Decisions
  // ───────────────────────────────────────────────
  describe('bomb triggers', () => {
    it('should not place bomb when canBomb is false', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ canBomb: false }));
      const player = new Player(1, 'Alice', { x: 5, y: 6 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.placeBomb).toBe(false);
    });

    it('should not place bomb when on bombCooldown', () => {
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({
          canBomb: true,
          bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'timer' },
        }),
      );
      enemy.bombCooldown = 10;
      const player = new Player(1, 'Alice', { x: 5, y: 6 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.placeBomb).toBe(false);
    });

    describe('timer trigger', () => {
      it('should always place bomb with timer trigger when ready', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'timer' },
          }),
        );
        const player = new Player(1, 'Alice', { x: 9, y: 9 });

        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
        expect(result.placeBomb).toBe(true);
      });
    });

    describe('proximity trigger', () => {
      it('should place bomb when player is within proximity range', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: {
              fireRange: 2,
              cooldownTicks: 20,
              trigger: 'proximity',
              proximityRange: 3,
            },
          }),
        );
        // Manhattan distance from (5,5) to (5,7) = 2, within range 3
        const player = new Player(1, 'Alice', { x: 5, y: 7 });

        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
        expect(result.placeBomb).toBe(true);
      });

      it('should not place bomb when player is outside proximity range', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: {
              fireRange: 2,
              cooldownTicks: 20,
              trigger: 'proximity',
              proximityRange: 2,
            },
          }),
        );
        // Manhattan distance from (5,5) to (9,9) = 8, outside range 2
        const player = new Player(1, 'Alice', { x: 9, y: 9 });

        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
        expect(result.placeBomb).toBe(false);
      });

      it('should use default proximity range of 3 when not specified', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'proximity' },
          }),
        );
        // Distance = 3, exactly at boundary
        const player = new Player(1, 'Alice', { x: 5, y: 8 });

        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
        expect(result.placeBomb).toBe(true);
      });

      it('should not place bomb when player is just outside default range', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'proximity' },
          }),
        );
        // Distance = 4, outside default range 3
        const player = new Player(1, 'Alice', { x: 5, y: 9 });

        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
        expect(result.placeBomb).toBe(false);
      });

      it('should check nearest alive player for proximity', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: {
              fireRange: 2,
              cooldownTicks: 20,
              trigger: 'proximity',
              proximityRange: 2,
            },
          }),
        );
        const farPlayer = new Player(1, 'Alice', { x: 9, y: 9 });
        const nearPlayer = new Player(2, 'Bob', { x: 5, y: 6 }); // distance 1

        const result = processEnemyAI(enemy, [farPlayer, nearPlayer], collision, [], fixedRng(0.5));
        expect(result.placeBomb).toBe(true);
      });
    });

    describe('random trigger', () => {
      it('should place bomb when rng < 0.15', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'random' },
          }),
        );
        const player = new Player(1, 'Alice', { x: 9, y: 9 });

        // Need rng for movement decision first, then for bomb decision
        // The bomb trigger rng() call is separate from the movement ones
        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
        expect(result.placeBomb).toBe(true);
      });

      it('should not place bomb when rng >= 0.15', () => {
        const enemy = new Enemy(
          1,
          { x: 5, y: 5 },
          makeConfig({
            canBomb: true,
            bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'random' },
          }),
        );
        const player = new Player(1, 'Alice', { x: 9, y: 9 });

        const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
        expect(result.placeBomb).toBe(false);
      });
    });
  });

  // ───────────────────────────────────────────────
  // 10. Combined Movement and Bomb
  // ───────────────────────────────────────────────
  describe('combined movement and bomb', () => {
    it('should return both movement direction and placeBomb simultaneously', () => {
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({
          movementPattern: 'chase_player',
          canBomb: true,
          bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'proximity', proximityRange: 5 },
        }),
      );
      const player = new Player(1, 'Alice', { x: 5, y: 3 }); // distance 2

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      expect(result.direction).toBe('up');
      expect(result.placeBomb).toBe(true);
    });

    it('should move without bombing when canBomb is false', () => {
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'random_walk', canBomb: false }),
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).not.toBeNull();
      expect(result.placeBomb).toBe(false);
    });

    it('should bomb without moving when on moveCooldown', () => {
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({
          canBomb: true,
          bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'timer' },
        }),
      );
      enemy.moveCooldown = 5;
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
      expect(result.placeBomb).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // 11. BFS Edge Cases
  // ───────────────────────────────────────────────
  describe('BFS pathfinding', () => {
    it('should return null when enemy is already at the target', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      // Player at same position
      const player = new Player(1, 'Alice', { x: 5, y: 5 });

      // rng < 0.7 => follow BFS, BFS returns null when from === to
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      // BFS returns null, falls through to random walk fallback
      // Random walk with rng(0.1) < 0.6 => continue current direction (down)
      // (5,6) is empty, so should return 'down'
      expect(result.direction).not.toBeNull();
    });

    it('should find adjacent target immediately', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'chase_player' }));
      const player = new Player(1, 'Alice', { x: 6, y: 5 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      expect(result.direction).toBe('right');
    });

    it('should respect maxDepth BFS limit', () => {
      // Create a very long maze (though BFS maxDepth is 20 by default)
      // This tests that BFS doesn't go too deep. Hard to force failure with 11x11 map.
      const enemy = new Enemy(1, { x: 1, y: 1 }, makeConfig({ movementPattern: 'chase_player' }));
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.1));
      // Should still find a path (distance < 20 on 11x11 map)
      expect(result.direction).not.toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // 12. Special Tile Handling
  // ───────────────────────────────────────────────
  describe('special tiles', () => {
    it('should walk on spawn tiles', () => {
      tiles[4][5] = 'spawn';
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig({ movementPattern: 'random_walk' }));
      enemy.direction = 'up';
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      // rng < 0.6 => continue current direction (up to spawn tile)
      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.3));
      expect(result.direction).toBe('up');
    });

    it('should not walk on destructible walls without canPassWalls', () => {
      tiles[4][5] = 'destructible';
      tiles[6][5] = 'destructible';
      tiles[5][4] = 'destructible';
      tiles[5][6] = 'destructible';
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'random_walk', canPassWalls: false }),
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      expect(result.direction).toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // 13. moveToward (tested via patrol_path)
  // ───────────────────────────────────────────────
  describe('moveToward logic', () => {
    it('should prefer axis with greater distance', () => {
      // Enemy at (3,5), target at (7,3) — dx=4, dy=-2 => prefer horizontal (right)
      const patrolPath = [
        { x: 3, y: 5 },
        { x: 7, y: 3 },
      ];
      const enemy = new Enemy(
        1,
        { x: 3, y: 5 },
        makeConfig({ movementPattern: 'patrol_path' }),
        patrolPath,
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // At waypoint 0, advance to 1. Target is (7,3). dx=4 > dy=2, prefer right
      expect(result.direction).toBe('right');
    });

    it('should prefer vertical when dy > dx', () => {
      const patrolPath = [
        { x: 5, y: 3 },
        { x: 6, y: 8 },
      ];
      const enemy = new Enemy(
        1,
        { x: 5, y: 3 },
        makeConfig({ movementPattern: 'patrol_path' }),
        patrolPath,
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // Target is (6,8). dy=5 > dx=1, prefer down
      expect(result.direction).toBe('down');
    });

    it('should fall through to second preferred direction when first is blocked', () => {
      // Enemy at (5,5), target at (8,3). dx=3 > dy=2 => prefer right, then up
      // Block right with wall
      tiles[5][6] = 'wall';
      collision = new CollisionSystem(tiles, mapWidth, mapHeight);

      const patrolPath = [
        { x: 5, y: 5 },
        { x: 8, y: 3 },
      ];
      const enemy = new Enemy(
        1,
        { x: 5, y: 5 },
        makeConfig({ movementPattern: 'patrol_path' }),
        patrolPath,
      );
      const player = new Player(1, 'Alice', { x: 9, y: 9 });

      const result = processEnemyAI(enemy, [player], collision, [], fixedRng(0.5));
      // Right is blocked, should go up (second preferred)
      expect(result.direction).toBe('up');
    });
  });
});
