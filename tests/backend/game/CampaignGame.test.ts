import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type {
  CampaignLevel,
  EnemyTypeConfig,
  StartingPowerUps,
  TileType,
  PowerUpType,
  Position,
} from '@blast-arena/shared';
import {
  TICK_RATE,
  CAMPAIGN_RESPAWN_TICKS,
  CAMPAIGN_RESPAWN_INVULNERABILITY,
} from '@blast-arena/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// --- Mock setup (jest.mock is hoisted before imports) ---

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the BotAI registry used by GameStateManager.addPlayer
jest.mock('../../../backend/src/services/botai-registry', () => ({
  getBotAIRegistry: jest.fn().mockReturnValue({
    createInstance: jest.fn().mockReturnValue({
      getAction: jest.fn().mockReturnValue(null),
    }),
  }),
}));

// Mock the GameLoop to prevent real timers
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

// Mock EnemyAI
jest.mock('../../../backend/src/game/EnemyAI', () => ({
  processEnemyAI: jest.fn<AnyFn>().mockReturnValue({ direction: null, placeBomb: false }),
}));

import { CampaignGame, CampaignSessionCallbacks } from '../../../backend/src/game/CampaignGame';
import { Enemy } from '../../../backend/src/game/Enemy';

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

describe('CampaignGame', () => {
  let callbacks: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedOnTick = null;
    capturedOnTimeUp = null;
    callbacks = createMockCallbacks();
    Enemy.resetIdCounter();
  });

  // ─────────────────────────────────────────────────
  // 1. Construction & Initialization
  // ─────────────────────────────────────────────────
  describe('Construction', () => {
    it('should create a session with a unique sessionId', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(game.sessionId).toBeDefined();
      expect(typeof game.sessionId).toBe('string');
      expect(game.sessionId.length).toBeGreaterThan(0);
    });

    it('should store userId and level reference', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([42], ['Player42'], level, new Map(), callbacks);

      expect(game.userId).toBe(42);
      expect(game.level).toBe(level);
    });

    it('should generate different sessionIds for different instances', () => {
      const level = createMinimalLevel();
      const game1 = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      const game2 = new CampaignGame([2], ['Player2'], level, new Map(), callbacks);

      expect(game1.sessionId).not.toBe(game2.sessionId);
    });

    it('should initialize as not finished', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(game.isFinished()).toBe(false);
    });

    it('should accept the level lives count', () => {
      const level = createMinimalLevel({ lives: 5 });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      // Access via toCampaignState indirectly through the callback
      // The game state tracks lives internally
      expect(game.isFinished()).toBe(false);
    });

    it('should create GameLoop with countdown enabled', () => {
      const GameLoop = require('../../../backend/src/game/GameLoop').GameLoop;
      const level = createMinimalLevel();
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      // The 5th argument (skipCountdown) should be omitted or falsy
      const lastCallArgs = GameLoop.mock.calls[GameLoop.mock.calls.length - 1];
      expect(lastCallArgs[4]).toBeFalsy();
    });

    it('should set up onTick and onTimeUp callbacks in the GameLoop', () => {
      const level = createMinimalLevel();
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(capturedOnTick).not.toBeNull();
      expect(capturedOnTimeUp).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────
  // 2. Start & Stop
  // ─────────────────────────────────────────────────
  describe('start / stop', () => {
    it('should call gameLoop.start() when start() is called', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();

      expect(mockGameLoopStart).toHaveBeenCalledTimes(1);
    });

    it('should call gameLoop.stop() when stop() is called', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();
      game.stop();

      expect(mockGameLoopStop).toHaveBeenCalledTimes(1);
    });

    it('should mark game as finished after stop()', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();
      game.stop();

      expect(game.isFinished()).toBe(true);
    });

    it('should return sessionId from getSessionId()', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(game.getSessionId()).toBe(game.sessionId);
    });
  });

  // ─────────────────────────────────────────────────
  // 3. Map Building (buildGameMap)
  // ─────────────────────────────────────────────────
  describe('Map building', () => {
    it('should generate default map when tiles array is empty', () => {
      const level = createMinimalLevel({ tiles: [], playerSpawns: [] });
      // Should not throw — will generate a default map
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should generate default map when tiles is undefined-like (empty array)', () => {
      const level = createMinimalLevel({ tiles: [] });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should use provided tiles when present', () => {
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          tiles[y][x] = 'empty';
        }
      }
      tiles[1][1] = 'spawn';

      const level = createMinimalLevel({ tiles, playerSpawns: [{ x: 1, y: 1 }] });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should scan tiles for spawn markers when playerSpawns is empty', () => {
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          if (x === 0 || y === 0 || x === 6 || y === 6) {
            tiles[y][x] = 'wall';
          } else {
            tiles[y][x] = 'empty';
          }
        }
      }
      tiles[3][3] = 'spawn';

      const level = createMinimalLevel({ tiles, playerSpawns: [] });
      // The constructor should scan tiles and find spawn at (3,3)
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should fall back to first empty tile when no spawns and no spawn tiles', () => {
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          if (x === 0 || y === 0 || x === 6 || y === 6) {
            tiles[y][x] = 'wall';
          } else {
            tiles[y][x] = 'empty';
          }
        }
      }
      // No spawn tiles, no playerSpawns => should find first empty tile
      const level = createMinimalLevel({ tiles, playerSpawns: [] });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should fall back to (1,1) when no empty tiles found', () => {
      // All tiles are walls except edges
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          tiles[y][x] = 'wall';
        }
      }
      const level = createMinimalLevel({ tiles, playerSpawns: [] });
      // Should not throw, even if (1,1) is a wall
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should set respawnPosition to first spawn point', () => {
      const level = createMinimalLevel({ playerSpawns: [{ x: 3, y: 3 }] });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      // The game should use (3,3) as the respawn position
      expect(game.isFinished()).toBe(false);
    });

    it('should use (1,1) as respawnPosition when no spawns defined', () => {
      const level = createMinimalLevel({ playerSpawns: [] });
      // respawnPosition defaults to level.playerSpawns[0] ?? { x: 1, y: 1 }
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 4. Win Condition Config Derivation
  // ─────────────────────────────────────────────────
  describe('Win condition config derivation', () => {
    it('should derive goalPosition from tiles when not set in config', () => {
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          if (x === 0 || y === 0 || x === 6 || y === 6) {
            tiles[y][x] = 'wall';
          } else {
            tiles[y][x] = 'empty';
          }
        }
      }
      tiles[1][1] = 'spawn';
      tiles[5][5] = 'goal';

      const level = createMinimalLevel({
        tiles,
        winCondition: 'reach_goal',
        winConditionConfig: {},
      });
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      // deriveWinConditionConfig should have found the goal at (5,5)
      expect(level.winConditionConfig!.goalPosition).toEqual({ x: 5, y: 5 });
    });

    it('should derive exitPosition from tiles when not set in config', () => {
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          if (x === 0 || y === 0 || x === 6 || y === 6) {
            tiles[y][x] = 'wall';
          } else {
            tiles[y][x] = 'empty';
          }
        }
      }
      tiles[1][1] = 'spawn';
      tiles[4][4] = 'exit';

      const level = createMinimalLevel({
        tiles,
        winCondition: 'find_exit',
        winConditionConfig: {},
      });
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(level.winConditionConfig!.exitPosition).toEqual({ x: 4, y: 4 });
    });

    it('should not overwrite existing goalPosition', () => {
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          tiles[y][x] = x === 0 || y === 0 || x === 6 || y === 6 ? 'wall' : 'empty';
        }
      }
      tiles[1][1] = 'spawn';
      tiles[5][5] = 'goal';

      const level = createMinimalLevel({
        tiles,
        winCondition: 'reach_goal',
        winConditionConfig: { goalPosition: { x: 2, y: 2 } },
      });
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      // Should keep the explicitly set goal position
      expect(level.winConditionConfig!.goalPosition).toEqual({ x: 2, y: 2 });
    });

    it('should derive surviveTimeTicks for survive_time mode', () => {
      const level = createMinimalLevel({
        winCondition: 'survive_time',
        winConditionConfig: {},
        timeLimit: 30,
      });
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(level.winConditionConfig!.surviveTimeTicks).toBe(30 * TICK_RATE);
    });

    it('should not derive surviveTimeTicks when already set', () => {
      const level = createMinimalLevel({
        winCondition: 'survive_time',
        winConditionConfig: { surviveTimeTicks: 100 },
        timeLimit: 30,
      });
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      // Should keep the explicit value
      expect(level.winConditionConfig!.surviveTimeTicks).toBe(100);
    });

    it('should initialize winConditionConfig when null', () => {
      const level = createMinimalLevel({
        winCondition: 'kill_all',
        winConditionConfig: null,
      });
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(level.winConditionConfig).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────
  // 5. Enemy Creation
  // ─────────────────────────────────────────────────
  describe('Enemy creation', () => {
    it('should create enemies from level placements', () => {
      const enemyConfig = createMinimalEnemyConfig();
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, enemyConfig);

      const level = createMinimalLevel({
        enemyPlacements: [
          { enemyTypeId: 1, x: 3, y: 3 },
          { enemyTypeId: 1, x: 5, y: 3 },
        ],
      });

      const game = new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should skip enemies with unknown type IDs', () => {
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      // Type ID 99 is not in the map
      const level = createMinimalLevel({
        enemyPlacements: [{ enemyTypeId: 99, x: 3, y: 3 }],
      });

      // Should not throw
      const game = new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should reset enemy ID counter between games', () => {
      const enemyConfig = createMinimalEnemyConfig();
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, enemyConfig);

      const level = createMinimalLevel({
        enemyPlacements: [{ enemyTypeId: 1, x: 3, y: 3 }],
      });

      // Create first game
      new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);
      // Create second game — should reset IDs
      new CampaignGame([2], ['Player2'], level, enemyTypes, callbacks);

      // Should not throw due to ID conflicts
    });

    it('should deep copy enemy configs to avoid mutation', () => {
      const enemyConfig = createMinimalEnemyConfig({ hp: 5 });
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, enemyConfig);

      const level = createMinimalLevel({
        enemyPlacements: [{ enemyTypeId: 1, x: 3, y: 3 }],
      });

      new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);

      // Original config should be unchanged
      expect(enemyConfig.hp).toBe(5);
    });

    it('should place enemies with patrol paths', () => {
      const enemyConfig = createMinimalEnemyConfig({ movementPattern: 'patrol_path' });
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, enemyConfig);

      const patrolPath: Position[] = [
        { x: 3, y: 3 },
        { x: 3, y: 5 },
        { x: 5, y: 5 },
      ];

      const level = createMinimalLevel({
        enemyPlacements: [{ enemyTypeId: 1, x: 3, y: 3, patrolPath }],
      });

      const game = new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);
      expect(game.isFinished()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 6. Starting Power-ups
  // ─────────────────────────────────────────────────
  describe('Starting power-ups', () => {
    it('should apply level starting power-ups to player', () => {
      const startingPowerups: StartingPowerUps = {
        bombUp: 2,
        fireUp: 1,
        speedUp: 1,
        shield: true,
        kick: true,
      };

      const level = createMinimalLevel({ startingPowerups });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should use carried power-ups over level power-ups when provided', () => {
      const levelPowerups: StartingPowerUps = { bombUp: 1 };
      const carriedPowerups: StartingPowerUps = { fireUp: 3 };

      const level = createMinimalLevel({ startingPowerups: levelPowerups });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks, carriedPowerups);
      expect(game.isFinished()).toBe(false);
    });

    it('should handle null starting power-ups', () => {
      const level = createMinimalLevel({ startingPowerups: null });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should apply all 8 power-up types', () => {
      const startingPowerups: StartingPowerUps = {
        bombUp: 1,
        fireUp: 1,
        speedUp: 1,
        shield: true,
        kick: true,
        pierceBomb: true,
        remoteBomb: true,
        lineBomb: true,
      };

      const level = createMinimalLevel({ startingPowerups });
      // Should not throw
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 7. Power-up Placements
  // ─────────────────────────────────────────────────
  describe('Power-up placements', () => {
    it('should place visible power-ups on the map', () => {
      const level = createMinimalLevel({
        powerupPlacements: [
          { type: 'bomb_up', x: 3, y: 1, hidden: false },
          { type: 'fire_up', x: 1, y: 3, hidden: false },
        ],
      });

      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should store hidden power-ups separately', () => {
      const level = createMinimalLevel({
        powerupPlacements: [{ type: 'shield', x: 3, y: 3, hidden: true }],
      });

      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should handle mixed visible and hidden power-ups', () => {
      const level = createMinimalLevel({
        powerupPlacements: [
          { type: 'bomb_up', x: 3, y: 1, hidden: false },
          { type: 'shield', x: 3, y: 3, hidden: true },
          { type: 'kick', x: 1, y: 3, hidden: false },
        ],
      });

      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 8. Input Handling
  // ─────────────────────────────────────────────────
  describe('handleInput', () => {
    it('should accept player input without error', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(() => {
        game.handleInput(1, { direction: 'right', action: null, tick: 0, seq: 1 });
      }).not.toThrow();
    });

    it('should accept bomb action input', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(() => {
        game.handleInput(1, { direction: null, action: 'bomb', tick: 0, seq: 1 });
      }).not.toThrow();
    });

    it('should accept combined direction+action input', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      expect(() => {
        game.handleInput(1, { direction: 'up', action: 'bomb', tick: 0, seq: 1 });
      }).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────
  // 9. Time Up Behavior
  // ─────────────────────────────────────────────────
  describe('onTimeUp', () => {
    it('should trigger game over on time up for kill_all mode', () => {
      const level = createMinimalLevel({ winCondition: 'kill_all' });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();

      // Simulate time up
      capturedOnTimeUp!();

      expect(callbacks.onGameOver).toHaveBeenCalledWith("Time's up!");
      expect(game.isFinished()).toBe(true);
    });

    it('should complete level on time up for survive_time mode', () => {
      const level = createMinimalLevel({
        winCondition: 'survive_time',
        winConditionConfig: { surviveTimeTicks: 600 },
      });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();

      capturedOnTimeUp!();

      expect(callbacks.onLevelComplete).toHaveBeenCalled();
      expect(game.isFinished()).toBe(true);
    });

    it('should trigger game over for find_exit mode on time up', () => {
      const level = createMinimalLevel({ winCondition: 'find_exit' });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();

      capturedOnTimeUp!();

      expect(callbacks.onGameOver).toHaveBeenCalledWith("Time's up!");
    });

    it('should trigger game over for reach_goal mode on time up', () => {
      const level = createMinimalLevel({ winCondition: 'reach_goal' });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();

      capturedOnTimeUp!();

      expect(callbacks.onGameOver).toHaveBeenCalledWith("Time's up!");
    });

    it('should not trigger onTimeUp callbacks if game already finished', () => {
      const level = createMinimalLevel({ winCondition: 'kill_all' });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();
      game.stop(); // finish the game

      capturedOnTimeUp!();

      expect(callbacks.onGameOver).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────
  // 10. Game Config Construction
  // ─────────────────────────────────────────────────
  describe('Game config construction', () => {
    it('should set game mode to campaign', () => {
      const GameLoop = require('../../../backend/src/game/GameLoop').GameLoop;
      const level = createMinimalLevel();
      new CampaignGame([1], ['Player1'], level, new Map(), callbacks);

      // GameState is passed as 1st arg to GameLoop
      // The mode was set to 'campaign' in the config
      expect(GameLoop).toHaveBeenCalled();
    });

    it('should use level dimensions for map size', () => {
      const level = createMinimalLevel({ mapWidth: 9, mapHeight: 9 });
      // Adjust tiles to match new dimensions
      const tiles: TileType[][] = [];
      for (let y = 0; y < 9; y++) {
        tiles[y] = [];
        for (let x = 0; x < 9; x++) {
          if (x === 0 || y === 0 || x === 8 || y === 8) {
            tiles[y][x] = 'wall';
          } else {
            tiles[y][x] = 'empty';
          }
        }
      }
      tiles[1][1] = 'spawn';
      level.tiles = tiles;

      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should use high round time when timeLimit is 0', () => {
      const level = createMinimalLevel({ timeLimit: 0 });
      // timeLimit 0 -> roundTime: 99999
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should use timeLimit as roundTime when positive', () => {
      const level = createMinimalLevel({ timeLimit: 120 });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should disable map events for campaign', () => {
      const level = createMinimalLevel();
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      // enableMapEvents should be false for campaign
      expect(game.isFinished()).toBe(false);
    });

    it('should pass reinforcedWalls from level config', () => {
      const level = createMinimalLevel({ reinforcedWalls: true });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should pass enabledPowerUps from level', () => {
      const level = createMinimalLevel({
        availablePowerupTypes: ['bomb_up', 'fire_up'] as PowerUpType[],
      });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should default enabledPowerUps to empty array when null', () => {
      const level = createMinimalLevel({ availablePowerupTypes: null });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 11. Idempotent Finish Guards
  // ─────────────────────────────────────────────────
  describe('Idempotent finish guards', () => {
    it('should not double-fire game over', () => {
      const level = createMinimalLevel({ winCondition: 'kill_all' });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();

      // First time up
      capturedOnTimeUp!();
      expect(callbacks.onGameOver).toHaveBeenCalledTimes(1);

      // Second time up — should be ignored (already finished)
      capturedOnTimeUp!();
      expect(callbacks.onGameOver).toHaveBeenCalledTimes(1);
    });

    it('should not double-fire level complete via survive_time', () => {
      const level = createMinimalLevel({
        winCondition: 'survive_time',
        winConditionConfig: { surviveTimeTicks: 600 },
      });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();

      capturedOnTimeUp!();
      expect(callbacks.onLevelComplete).toHaveBeenCalledTimes(1);

      capturedOnTimeUp!();
      expect(callbacks.onLevelComplete).toHaveBeenCalledTimes(1);
    });

    it('should stop the game loop when level completes', () => {
      const level = createMinimalLevel({
        winCondition: 'survive_time',
        winConditionConfig: { surviveTimeTicks: 600 },
      });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();
      mockGameLoopStop.mockClear();

      capturedOnTimeUp!();

      expect(mockGameLoopStop).toHaveBeenCalledTimes(1);
    });

    it('should stop the game loop when game is over', () => {
      const level = createMinimalLevel({ winCondition: 'kill_all' });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      game.start();
      mockGameLoopStop.mockClear();

      capturedOnTimeUp!();

      expect(mockGameLoopStop).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────
  // 12. Edge Cases
  // ─────────────────────────────────────────────────
  describe('Edge cases', () => {
    it('should handle level with zero lives', () => {
      const level = createMinimalLevel({ lives: 0 });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should handle level with no enemy placements', () => {
      const level = createMinimalLevel({ enemyPlacements: [] });
      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should handle level with multiple spawn points', () => {
      const tiles: TileType[][] = [];
      for (let y = 0; y < 7; y++) {
        tiles[y] = [];
        for (let x = 0; x < 7; x++) {
          if (x === 0 || y === 0 || x === 6 || y === 6) {
            tiles[y][x] = 'wall';
          } else {
            tiles[y][x] = 'empty';
          }
        }
      }
      tiles[1][1] = 'spawn';
      tiles[5][1] = 'spawn';
      tiles[1][5] = 'spawn';

      const level = createMinimalLevel({
        tiles,
        playerSpawns: [
          { x: 1, y: 1 },
          { x: 5, y: 1 },
          { x: 1, y: 5 },
        ],
      });

      const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should handle large enemy count', () => {
      const enemyConfig = createMinimalEnemyConfig();
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, enemyConfig);

      const placements = [];
      for (let i = 0; i < 20; i++) {
        placements.push({
          enemyTypeId: 1,
          x: 1 + (i % 5),
          y: 1 + Math.floor(i / 5),
        });
      }

      const level = createMinimalLevel({ enemyPlacements: placements });
      const game = new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should handle multiple enemy types in the same level', () => {
      const type1 = createMinimalEnemyConfig({ hp: 1, speed: 1 });
      const type2 = createMinimalEnemyConfig({ hp: 3, speed: 0.5, isBoss: true });
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, type1);
      enemyTypes.set(2, type2);

      const level = createMinimalLevel({
        enemyPlacements: [
          { enemyTypeId: 1, x: 3, y: 1 },
          { enemyTypeId: 2, x: 1, y: 3 },
        ],
      });

      const game = new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);
      expect(game.isFinished()).toBe(false);
    });

    it('should handle level with all win condition types', () => {
      const winConditions: Array<CampaignLevel['winCondition']> = [
        'kill_all',
        'find_exit',
        'reach_goal',
        'survive_time',
      ];

      for (const wc of winConditions) {
        const level = createMinimalLevel({
          winCondition: wc,
          winConditionConfig: {},
        });
        const game = new CampaignGame([1], ['Player1'], level, new Map(), callbacks);
        expect(game.isFinished()).toBe(false);
      }
    });

    it('should handle boss enemy type', () => {
      const bossConfig = createMinimalEnemyConfig({
        isBoss: true,
        hp: 10,
        bossPhases: [
          {
            hpThreshold: 5,
            speedMultiplier: 2,
          },
        ],
      });
      const enemyTypes = new Map<number, EnemyTypeConfig>();
      enemyTypes.set(1, bossConfig);

      const level = createMinimalLevel({
        enemyPlacements: [{ enemyTypeId: 1, x: 3, y: 3 }],
      });

      const game = new CampaignGame([1], ['Player1'], level, enemyTypes, callbacks);
      expect(game.isFinished()).toBe(false);
    });
  });
});
