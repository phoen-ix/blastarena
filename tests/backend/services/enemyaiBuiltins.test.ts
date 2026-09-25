import { describe, it, expect, jest } from '@jest/globals';
import type { TileType } from '@blast-arena/shared';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../backend/src/db/connection', () => ({ query: jest.fn(), execute: jest.fn() }));

import { BUILTIN_ENEMY_AIS } from '../../../backend/src/game/enemy-ai-defaults/sources';
import { compileEnemyAI } from '../../../backend/src/services/enemyai-compiler';
import { EnemyAIRegistry } from '../../../backend/src/services/enemyai-registry';
import type { EnemyAIContext } from '../../../backend/src/game/EnemyAI';

/**
 * The real built-in sources, through the real compiler and sandbox — as seedDefaultEnemyAIs loads
 * them at startup. Every source ends with `module.exports = SomeAI`, so the sandbox returns the
 * class itself; the registry only looked for a `default` export or an exported property, found
 * neither, and on the first production start every built-in failed to load ("No class with
 * decide() found") — campaign enemies fell back to the basic patterns. The registry's unit tests
 * mock the sandbox, so they never saw that shape.
 */

const typeConfig: EnemyAIContext['self']['typeConfig'] = {
  speed: 1,
  canPassWalls: false,
  canPassBombs: false,
  canBomb: true,
  contactDamage: true,
  isBoss: false,
  sizeMultiplier: 1,
};

function context(): EnemyAIContext {
  const size = 9;
  const tiles: TileType[][] = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x): TileType => {
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) return 'wall';
      return x % 2 === 0 && y % 2 === 0 ? 'wall' : 'empty';
    }),
  );
  return {
    self: {
      position: { x: 1, y: 1 },
      hp: 1,
      maxHp: 1,
      direction: 'down',
      alive: true,
      typeConfig,
      patrolPath: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
      ],
      patrolIndex: 0,
    },
    players: [{ position: { x: 3, y: 1 }, alive: true }],
    tiles,
    mapWidth: size,
    mapHeight: size,
    bombPositions: [],
    otherEnemies: [],
    tick: 10,
    rng: () => 0.5,
  };
}

describe('built-in enemy AIs load and decide', () => {
  it('there are built-ins to check', () => {
    expect(BUILTIN_ENEMY_AIS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(BUILTIN_ENEMY_AIS.map((def) => [def.key, def] as const))('%s', async (_key, def) => {
    const compiled = await compileEnemyAI(def.source);
    expect(compiled.errors).toEqual([]);

    const registry = new EnemyAIRegistry();
    registry.loadBuiltin(def.key, compiled.compiledCode!);
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const ai = registry.createInstance(def.key, difficulty, typeConfig);
      expect(ai).not.toBeNull();
      const result = ai!.decide(context());
      expect([null, 'up', 'down', 'left', 'right']).toContain(result.direction);
      expect(typeof result.placeBomb).toBe('boolean');
    }
  });
});
