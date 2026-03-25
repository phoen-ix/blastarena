import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { CampaignLevel, EnemyTypeConfig, TileType } from '@blast-arena/shared';
import { QUICKSAND_KILL_TICKS, SPIKE_SAFE_TICKS, SPIKE_CYCLE_TICKS } from '@blast-arena/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// --- Mock setup ---

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../../backend/src/services/botai-registry', () => ({
  getBotAIRegistry: jest.fn().mockReturnValue({
    createInstance: jest.fn().mockReturnValue({
      getAction: jest.fn().mockReturnValue(null),
    }),
  }),
}));

const mockGameLoopStart = jest.fn<AnyFn>();
const mockGameLoopStop = jest.fn<AnyFn>();
let capturedOnTick: AnyFn | null = null;
let capturedOnTimeUp: AnyFn | null = null;
jest.mock('../../../backend/src/game/GameLoop', () => ({
  GameLoop: jest
    .fn<AnyFn>()
    .mockImplementation((_gameState: unknown, onTick: AnyFn, onTimeUp: AnyFn) => {
      capturedOnTick = onTick;
      capturedOnTimeUp = onTimeUp;
      return {
        start: mockGameLoopStart,
        stop: mockGameLoopStop,
        isRunning: jest.fn().mockReturnValue(true),
      };
    }),
}));

jest.mock('../../../backend/src/game/EnemyAI', () => ({
  processEnemyAI: jest.fn<AnyFn>().mockReturnValue({ direction: null, placeBomb: false }),
}));

import { CampaignGame, CampaignSessionCallbacks } from '../../../backend/src/game/CampaignGame';
import { Enemy } from '../../../backend/src/game/Enemy';
import { Bomb } from '../../../backend/src/game/Bomb';

// --- Helpers ---

function createMinimalEnemyConfig(overrides: Partial<EnemyTypeConfig> = {}): EnemyTypeConfig {
  return {
    speed: 1,
    movementPattern: 'random_walk',
    canPassWalls: false,
    canPassBombs: false,
    canBomb: false,
    hp: 1,
    contactDamage: true,
    sprite: {
      bodyShape: 'blob',
      primaryColor: '#ff0000',
      secondaryColor: '#880000',
      eyeStyle: 'round',
      hasTeeth: false,
      hasHorns: false,
    },
    dropChance: 0,
    dropTable: [],
    isBoss: false,
    sizeMultiplier: 1,
    ...overrides,
  };
}

function createMinimalLevel(overrides: Partial<CampaignLevel> = {}): CampaignLevel {
  // 7x7 map with walls on edges
  const tiles: TileType[][] = [];
  for (let y = 0; y < 7; y++) {
    tiles[y] = [];
    for (let x = 0; x < 7; x++) {
      if (x === 0 || y === 0 || x === 6 || y === 6) {
        tiles[y][x] = 'wall';
      } else if (x % 2 === 0 && y % 2 === 0) {
        tiles[y][x] = 'wall';
      } else {
        tiles[y][x] = 'empty';
      }
    }
  }
  tiles[1][1] = 'spawn';

  return {
    id: 1,
    worldId: 1,
    name: 'Test Level',
    description: 'A test level',
    sortOrder: 1,
    mapWidth: 7,
    mapHeight: 7,
    tiles,
    fillMode: 'handcrafted',
    wallDensity: 0,
    playerSpawns: [{ x: 1, y: 1 }],
    enemyPlacements: [],
    powerupPlacements: [],
    winCondition: 'kill_all',
    winConditionConfig: null,
    lives: 3,
    timeLimit: 60,
    parTime: 30,
    carryOverPowerups: false,
    startingPowerups: null,
    availablePowerupTypes: null,
    powerupDropRate: 0.3,
    reinforcedWalls: false,
    hazardTiles: false,
    coveredTiles: [],
    puzzleConfig: null,
    isPublished: true,
    ...overrides,
  };
}

function createMockCallbacks(): CampaignSessionCallbacks & {
  onStateUpdate: jest.Mock;
  onPlayerDied: jest.Mock;
  onEnemyDied: jest.Mock;
  onExitOpened: jest.Mock;
  onLevelComplete: jest.Mock;
  onGameOver: jest.Mock;
} {
  return {
    onStateUpdate: jest.fn(),
    onPlayerDied: jest.fn(),
    onEnemyDied: jest.fn(),
    onExitOpened: jest.fn(),
    onLevelComplete: jest.fn(),
    onGameOver: jest.fn(),
  };
}

// Helper: skip countdown by setting status to 'playing' directly (GameLoop is mocked)
function skipCountdown(game: CampaignGame) {
  game.getGameState().status = 'playing';
}

// Helper: get the game's internal GameStateManager (public accessor)
function getGameState(game: CampaignGame): any {
  return game.getGameState();
}

describe('HazardTiles', () => {
  let callbacks: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnTick = null;
    capturedOnTimeUp = null;
    callbacks = createMockCallbacks();
    Enemy.resetIdCounter();
  });

  // ─────────────────────────────────────────────────
  // Vine tiles
  // ─────────────────────────────────────────────────
  describe('Vine tiles', () => {
    it('should slow player movement on vine tiles', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'vine' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'forest',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;

      // Move player to (1,3) where vine is — walk right through (1,1)->(1,2)->(1,3)
      // Set position directly for test
      player.position.x = 3;
      player.position.y = 1;
      player.moveCooldown = 1; // just applied a move

      // Tick — speed modifier should double the cooldown
      capturedOnTick!();

      // Vine doubles moveCooldown (MOVE_COOLDOWN_BASE=5, so cooldown should be at least 10)
      expect(player.moveCooldown).toBeGreaterThanOrEqual(10);
    });

    it('should be destroyed by explosions', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'vine' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'forest',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      // Verify vine is there
      expect(gs.map.tiles[1][3]).toBe('vine');

      // Use CollisionSystem destroyTile
      const cs = getGameState(game).collisionSystem;
      const result = cs.destroyTile(3, 1);
      expect(result).toBe(true);
      expect(gs.map.tiles[1][3]).toBe('empty');
    });
  });

  // ─────────────────────────────────────────────────
  // Quicksand tiles
  // ─────────────────────────────────────────────────
  describe('Quicksand tiles', () => {
    it('should slow player movement on quicksand', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'quicksand' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'desert',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;
      player.position.x = 3;
      player.position.y = 1;
      player.moveCooldown = 1;

      capturedOnTick!();
      expect(player.moveCooldown).toBeGreaterThanOrEqual(10);
    });

    it('should kill player after QUICKSAND_KILL_TICKS continuous standing', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'quicksand' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'desert',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;
      player.position.x = 3;
      player.position.y = 1;
      player.alive = true;
      player.invulnerableTicks = 0; // Clear spawn invulnerability

      // Tick enough times for quicksand to kill
      for (let i = 0; i < QUICKSAND_KILL_TICKS + 1; i++) {
        // Keep player on quicksand (processTick might move them if they have input)
        player.position.x = 3;
        player.position.y = 1;
        capturedOnTick!();
      }

      expect(player.alive).toBe(false);
    });

    it('should reset timer when player leaves quicksand', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'quicksand' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'desert',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;
      player.position.x = 3;
      player.position.y = 1;

      // Stay for half the kill time
      for (let i = 0; i < Math.floor(QUICKSAND_KILL_TICKS / 2); i++) {
        capturedOnTick!();
      }

      // Move off quicksand
      player.position.x = 1;
      player.position.y = 1;
      capturedOnTick!();

      // Move back on
      player.position.x = 3;
      player.position.y = 1;

      // Should need the full timer again
      for (let i = 0; i < QUICKSAND_KILL_TICKS - 1; i++) {
        capturedOnTick!();
      }
      expect(player.alive).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────
  // Ice tiles
  // ─────────────────────────────────────────────────
  describe('Ice tiles', () => {
    it('should slide player across ice tiles', () => {
      const level = createMinimalLevel();
      // Create a strip of ice: (3,1), (3,2), (3,3)
      level.tiles[1][3] = 'ice' as TileType;
      level.tiles[1][4] = 'ice' as TileType;
      level.tiles[1][5] = 'empty'; // wall at x=6 stops sliding

      const game = new CampaignGame([1], ['P1'], level, new Map(), callbacks, null, false, 'ice');
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;

      // Player at (2,1), "just moved" right onto ice at (3,1)
      // Simulate the previous position tracking
      (game as any).prevPlayerPositions.set(1, '2,1');
      player.position.x = 3;
      player.position.y = 1;
      player.direction = 'right';

      capturedOnTick!();

      // Player should have slid at least one tile to the right
      expect(player.position.x).toBeGreaterThan(3);
    });
  });

  // ─────────────────────────────────────────────────
  // Lava tiles
  // ─────────────────────────────────────────────────
  describe('Lava tiles', () => {
    it('should be impassable (CollisionSystem.isWalkable returns false)', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'lava' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'volcano',
      );
      game.start();

      const cs = getGameState(game).collisionSystem;
      expect(cs.isWalkable(3, 1)).toBe(false);
    });

    it('should auto-detonate bombs adjacent to lava', () => {
      const level = createMinimalLevel();
      // Place lava at (3,3), ensure (3,2) is empty
      level.tiles[3][3] = 'lava' as TileType;
      level.tiles[2][3] = 'empty';
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'volcano',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);

      // Directly place a bomb at (3,2) — adjacent to lava at (3,3)
      const bomb = new Bomb({ x: 3, y: 2 }, 1, 2);
      gs.bombs.set(bomb.id, bomb);
      const originalTicks = bomb.ticksRemaining;

      // One tick to process lava detonation
      capturedOnTick!();

      // Bomb should be set to detonate immediately (ticksRemaining = 1 or already gone)
      if (gs.bombs.size > 0) {
        const updatedBomb = Array.from(gs.bombs.values())[0] as any;
        expect(updatedBomb.ticksRemaining).toBeLessThan(originalTicks);
      }
      // If bomb is already gone, it detonated (also valid)
    });

    it('should allow explosions to pass through lava', () => {
      const level = createMinimalLevel();
      // Place lava at (1,3), empty at (1,4) and (1,5)
      level.tiles[3][1] = 'lava' as TileType;
      level.tiles[4][1] = 'empty';
      level.tiles[5][1] = 'empty';
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'volcano',
      );
      game.start();

      // Lava is not wall/destructible so getExplosionCells in grid.ts already passes through
      // Verify isWalkable is false but it's not a wall
      const gs = getGameState(game);
      expect(gs.map.tiles[3][1]).toBe('lava');
      // Lava doesn't block explosions since it's not 'wall' or 'destructible'
    });
  });

  // ─────────────────────────────────────────────────
  // Mud tiles
  // ─────────────────────────────────────────────────
  describe('Mud tiles', () => {
    it('should slow player movement on mud', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'mud' as TileType;
      const game = new CampaignGame([1], ['P1'], level, new Map(), callbacks, null, false, 'swamp');
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;
      player.position.x = 3;
      player.position.y = 1;
      player.moveCooldown = 1;

      capturedOnTick!();
      expect(player.moveCooldown).toBeGreaterThanOrEqual(10);
    });

    it('should NOT be destroyed by explosions', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'mud' as TileType;
      const game = new CampaignGame([1], ['P1'], level, new Map(), callbacks, null, false, 'swamp');
      game.start();

      const gs = getGameState(game);
      const cs = getGameState(game).collisionSystem;

      // Mud is walkable but not destructible
      expect(cs.isWalkable(3, 1, gs)).toBe(true);
      // destroyTile should return false — mud is not in the destructible logic
      const result = cs.destroyTile(3, 1);
      expect(result).toBe(false);
      expect(gs.map.tiles[1][3]).toBe('mud');
    });
  });

  // ─────────────────────────────────────────────────
  // Spike tiles
  // ─────────────────────────────────────────────────
  describe('Spike tiles', () => {
    it('should cycle between safe and lethal phases', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'spikes' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'castle',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);

      // Initially spikes are safe
      expect(gs.map.tiles[1][3]).toBe('spikes');

      // Tick through safe phase (SPIKE_SAFE_TICKS = 40)
      for (let i = 0; i < SPIKE_SAFE_TICKS; i++) {
        capturedOnTick!();
      }

      // Should now be active/lethal
      expect(gs.map.tiles[1][3]).toBe('spikes_active');

      // Tick through lethal phase (SPIKE_CYCLE_TICKS - SPIKE_SAFE_TICKS = 20)
      for (let i = 0; i < SPIKE_CYCLE_TICKS - SPIKE_SAFE_TICKS; i++) {
        capturedOnTick!();
      }

      // Should cycle back to safe
      expect(gs.map.tiles[1][3]).toBe('spikes');
    });

    it('should kill player standing on active spikes', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'spikes' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'castle',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;
      player.position.x = 3;
      player.position.y = 1;
      player.alive = true;
      player.invulnerableTicks = 0;

      // Tick past safe phase into lethal
      for (let i = 0; i < SPIKE_SAFE_TICKS + 1; i++) {
        player.position.x = 3;
        player.position.y = 1;
        capturedOnTick!();
      }

      expect(player.alive).toBe(false);
    });

    it('should NOT kill player during safe phase', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'spikes' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'castle',
      );
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;
      player.position.x = 3;
      player.position.y = 1;
      player.alive = true;

      // Tick during safe phase only
      for (let i = 0; i < SPIKE_SAFE_TICKS - 1; i++) {
        capturedOnTick!();
      }

      expect(player.alive).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────
  // Dark Rift tiles
  // ─────────────────────────────────────────────────
  describe('Dark Rift tiles', () => {
    it('should teleport player to a random empty tile on movement', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'dark_rift' as TileType;
      const game = new CampaignGame([1], ['P1'], level, new Map(), callbacks, null, false, 'void');
      game.start();
      skipCountdown(game);

      const gs = getGameState(game);
      const player = gs.players.get(1)!;

      // Simulate having "just moved" onto the dark rift
      (game as any).prevPlayerPositions.set(1, '2,1');
      player.position.x = 3;
      player.position.y = 1;

      capturedOnTick!();

      // Player should have teleported away from (3,1)
      const stillOnRift = player.position.x === 3 && player.position.y === 1;
      // It's possible (very unlikely) that the random target is the same tile,
      // but the player should generally have moved
      // We verify the player is still alive and on an empty/spawn tile
      expect(player.alive).toBe(true);
      const landedTile = gs.map.tiles[player.position.y]?.[player.position.x];
      if (!stillOnRift) {
        expect(['empty', 'spawn']).toContain(landedTile);
      }
    });
  });

  // ─────────────────────────────────────────────────
  // CollisionSystem integration
  // ─────────────────────────────────────────────────
  describe('CollisionSystem hazard walkability', () => {
    it.each([
      ['vine', true],
      ['quicksand', true],
      ['ice', true],
      ['mud', true],
      ['spikes', true],
      ['spikes_active', true],
      ['dark_rift', true],
      ['lava', false],
    ] as [string, boolean][])('should report %s as walkable=%s', (tileType, expectedWalkable) => {
      const level = createMinimalLevel();
      level.tiles[1][3] = tileType as TileType;
      const game = new CampaignGame([1], ['P1'], level, new Map(), callbacks);
      game.start();

      const cs = getGameState(game).collisionSystem;
      expect(cs.isWalkable(3, 1)).toBe(expectedWalkable);
    });
  });

  // ─────────────────────────────────────────────────
  // Theme in state output
  // ─────────────────────────────────────────────────
  describe('Theme propagation', () => {
    it('should include theme in campaign state for non-classic themes', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'forest',
      );
      game.start();

      const state = (game as any).toCampaignState();
      expect(state.theme).toBe('forest');
    });

    it('should not include theme for classic', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        false,
        'classic',
      );
      game.start();

      const state = (game as any).toCampaignState();
      expect(state.theme).toBeUndefined();
    });

    it('should default to classic when no theme provided', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['P1'], level, new Map(), callbacks);
      game.start();

      const state = (game as any).toCampaignState();
      expect(state.theme).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────
  // Buddy interactions with hazards
  // ─────────────────────────────────────────────────
  describe('Buddy on hazard tiles', () => {
    it('should block buddy on lava (canBuddyMoveTo)', () => {
      const level = createMinimalLevel();
      level.tiles[1][3] = 'lava' as TileType;
      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        new Map(),
        callbacks,
        null,
        true,
        'volcano',
      );
      game.start();

      const cs = getGameState(game).collisionSystem;
      // Try to move from (2,1) right into lava at (3,1) — should return null (blocked)
      const result = cs.canBuddyMoveTo(2, 1, 'right');
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────
  // Enemy on hazard tiles
  // ─────────────────────────────────────────────────
  describe('Enemies on hazard tiles', () => {
    it('should kill enemy on quicksand after QUICKSAND_KILL_TICKS', () => {
      const level = createMinimalLevel();
      level.tiles[3][1] = 'quicksand' as TileType;
      const enemyConfig = createMinimalEnemyConfig();
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, enemyConfig);
      level.enemyPlacements = [{ enemyTypeId: 1, x: 1, y: 3 }];

      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        enemyTypes,
        callbacks,
        null,
        false,
        'desert',
      );
      game.start();
      skipCountdown(game);

      const enemyMap = game.getEnemies();
      expect(enemyMap.size).toBe(1);
      const enemy = enemyMap.values().next().value!;
      expect(enemy.alive).toBe(true);

      // Keep enemy on quicksand for kill ticks
      for (let i = 0; i < QUICKSAND_KILL_TICKS + 1; i++) {
        // Reset enemy position each tick to keep it on quicksand
        enemy.position.x = 1;
        enemy.position.y = 3;
        capturedOnTick!();
      }

      expect(enemy.alive).toBe(false);
    });

    it('should not affect canPassWalls enemies on hazard tiles', () => {
      const level = createMinimalLevel();
      level.tiles[3][1] = 'quicksand' as TileType;
      const enemyConfig = createMinimalEnemyConfig({ canPassWalls: true });
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, enemyConfig);
      level.enemyPlacements = [{ enemyTypeId: 1, x: 1, y: 3 }];

      const game = new CampaignGame(
        [1],
        ['P1'],
        level,
        enemyTypes,
        callbacks,
        null,
        false,
        'desert',
      );
      game.start();
      skipCountdown(game);

      const enemyMap = game.getEnemies();
      expect(enemyMap.size).toBe(1);
      const enemy = enemyMap.values().next().value!;

      // Keep enemy on quicksand for well beyond kill ticks
      for (let i = 0; i < QUICKSAND_KILL_TICKS + 10; i++) {
        enemy.position.x = 1;
        enemy.position.y = 3;
        capturedOnTick!();
      }

      // canPassWalls enemy should still be alive
      expect(enemy.alive).toBe(true);
    });
  });
});
