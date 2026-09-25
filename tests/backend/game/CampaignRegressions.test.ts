import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { CampaignLevel, EnemyTypeConfig, TileType } from '@blast-arena/shared';
import { TICK_RATE } from '@blast-arena/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../../backend/src/services/botai-registry', () => ({
  getBotAIRegistry: jest.fn().mockReturnValue({
    createInstance: jest.fn().mockReturnValue({ getAction: jest.fn().mockReturnValue(null) }),
  }),
}));

let capturedOnTick: AnyFn | null = null;
jest.mock('../../../backend/src/game/GameLoop', () => ({
  GameLoop: jest.fn<AnyFn>().mockImplementation((_gs: unknown, onTick: AnyFn) => {
    capturedOnTick = onTick;
    let paused = false;
    return {
      start: jest.fn(),
      stop: jest.fn(),
      isRunning: jest.fn().mockReturnValue(true),
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      isPaused: () => paused,
    };
  }),
}));

jest.mock('../../../backend/src/game/EnemyAI', () => ({
  processEnemyAI: jest.fn<AnyFn>().mockReturnValue({ direction: null, placeBomb: false }),
}));

import { CampaignGame, CampaignSessionCallbacks } from '../../../backend/src/game/CampaignGame';
import { CampaignGameManager } from '../../../backend/src/game/CampaignGameManager';
import { Enemy } from '../../../backend/src/game/Enemy';
import { Explosion } from '../../../backend/src/game/Explosion';

function enemyConfig(overrides: Partial<EnemyTypeConfig> = {}): EnemyTypeConfig {
  return {
    speed: 1,
    movementPattern: 'stationary',
    canPassWalls: false,
    canPassBombs: false,
    canBomb: false,
    hp: 1,
    contactDamage: false,
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

function level(overrides: Partial<CampaignLevel> = {}): CampaignLevel {
  const tiles: TileType[][] = [];
  for (let y = 0; y < 7; y++) {
    tiles[y] = [];
    for (let x = 0; x < 7; x++) {
      const border = x === 0 || y === 0 || x === 6 || y === 6;
      tiles[y][x] = border || (x % 2 === 0 && y % 2 === 0) ? 'wall' : 'empty';
    }
  }
  tiles[1][1] = 'spawn';
  tiles[1][3] = 'spawn';
  return {
    id: 1,
    worldId: 1,
    name: 'L',
    description: '',
    sortOrder: 1,
    mapWidth: 7,
    mapHeight: 7,
    tiles,
    fillMode: 'handcrafted',
    wallDensity: 0,
    playerSpawns: [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ],
    enemyPlacements: [],
    powerupPlacements: [],
    winCondition: 'kill_all',
    winConditionConfig: null,
    lives: 3,
    timeLimit: 0,
    parTime: 0,
    carryOverPowerups: false,
    startingPowerups: null,
    availablePowerupTypes: null,
    powerupDropRate: 0,
    reinforcedWalls: false,
    hazardTiles: false,
    coveredTiles: [],
    puzzleConfig: null,
    isPublished: true,
    ...overrides,
  };
}

function callbacks(): CampaignSessionCallbacks & {
  onGameOver: jest.Mock;
  onLevelComplete: jest.Mock;
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

function tick(game: CampaignGame, n: number): void {
  for (let i = 0; i < n; i++) {
    game.getGameState().tick++;
    capturedOnTick!();
  }
}

describe('campaign regressions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Enemy.resetIdCounter();
  });

  it('fails a timed kill-all level when the time limit runs out', () => {
    const cb = callbacks();
    const game = new CampaignGame(
      [1],
      ['p1'],
      level({ timeLimit: 2, enemyPlacements: [{ enemyTypeId: 1, x: 5, y: 5 }] }),
      new Map([[1, enemyConfig()]]),
      cb,
    );
    game.start();
    game.getGameState().status = 'playing';
    tick(game, 2 * TICK_RATE - 1);
    expect(cb.onGameOver).not.toHaveBeenCalled();
    tick(game, 1);
    expect(cb.onGameOver).toHaveBeenCalledWith("Time's up!");
  });

  it('an explosion damages an enemy once, however long it stands in the fire', () => {
    const cb = callbacks();
    const game = new CampaignGame(
      [1],
      ['p1'],
      level({ enemyPlacements: [{ enemyTypeId: 1, x: 5, y: 5 }] }),
      new Map([[1, enemyConfig({ hp: 2 })]]),
      cb,
    );
    game.start();
    game.getGameState().status = 'playing';
    const enemy = [...game.getEnemies().values()][0];
    const blast = new Explosion([{ x: 5, y: 5 }], -999);
    game.getGameState().explosions.set(blast.id, blast);
    tick(game, 5);
    expect(enemy.hp).toBe(1);
    expect(enemy.alive).toBe(true);
  });

  it('a departed co-op partner is not respawned, costs no life and is not waited for', () => {
    const cb = callbacks();
    const tiles = level().tiles.map((r) => [...r]);
    tiles[3][3] = 'goal';
    const game = new CampaignGame(
      [1, 2],
      ['p1', 'p2'],
      level({ tiles, winCondition: 'reach_goal' }),
      new Map(),
      cb,
    );
    game.start();
    game.getGameState().status = 'playing';
    game.removePlayer(2);
    tick(game, 50);
    expect(game.getLives()).toBe(3);
    expect(game.getGameState().players.has(2)).toBe(false);

    const p1 = game.getPlayer(1)!;
    p1.position = { x: 3, y: 3 };
    tick(game, 40);
    expect(cb.onLevelComplete).toHaveBeenCalled();
  });

  it('pausing is idempotent and a partner leaving resumes the level', () => {
    const manager = new CampaignGameManager();
    const game = manager.startLevel([1, 2], ['p1', 'p2'], level(), new Map(), callbacks());
    expect(manager.pauseSession(game.sessionId)).toBe(true);
    expect(manager.pauseSession(game.sessionId)).toBe(true);
    expect(game.isPaused()).toBe(true);
    manager.removePlayer(game.sessionId, 2);
    expect(game.isPaused()).toBe(false);
    expect(game.hasDeparted(2)).toBe(true);
  });
});
