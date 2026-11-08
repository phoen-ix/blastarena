import { describe, it, expect } from 'vitest';
import vm from 'vm';
import { PATROL_GUARD_SOURCE } from '../../../backend/src/game/enemy-ai-defaults/patrol-guard';
import { HUNTER_SOURCE } from '../../../backend/src/game/enemy-ai-defaults/hunter';
import type { EnemyAIContext } from '../../../backend/src/game/EnemyAI';
import type { TileType } from '../../../shared/src/types/game';

/** Evaluate a built-in source the way the trusted loader does: CommonJS module.exports. */
function load(source: string): new (
  difficulty: string,
  typeConfig: unknown,
) => {
  decide(ctx: EnemyAIContext): { direction: string | null; placeBomb: boolean };
} {
  const sandbox = { module: { exports: {} as unknown } };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports as never;
}

const typeConfig = {
  speed: 1,
  canPassWalls: false,
  canPassBombs: false,
  canBomb: false,
  contactDamage: true,
  isBoss: false,
  sizeMultiplier: 1,
};

/** A one-row corridor between walls: [wall, ...row, wall] padded with wall rows. */
function corridor(row: TileType[]): TileType[][] {
  const width = row.length + 2;
  const wallRow = Array<TileType>(width).fill('wall');
  return [wallRow, ['wall', ...row, 'wall'], wallRow];
}

function ctx(
  tiles: TileType[][],
  self: Partial<EnemyAIContext['self']>,
  players: EnemyAIContext['players'] = [],
): EnemyAIContext {
  return {
    self: {
      position: { x: 1, y: 1 },
      hp: 1,
      maxHp: 1,
      direction: 'right',
      alive: true,
      typeConfig,
      patrolPath: [],
      patrolIndex: 0,
      ...self,
    },
    players,
    tiles,
    mapWidth: tiles[0].length,
    mapHeight: tiles.length,
    bombPositions: [],
    otherEnemies: [],
    tick: 1,
    rng: () => 0, // always take the first choice
  };
}

describe('built-in enemy AIs', () => {
  it('Patrol Guard moves on from its first waypoint (ctx.patrolIndex never advances)', () => {
    const PatrolGuard = load(PATROL_GUARD_SOURCE);
    const ai = new PatrolGuard('normal', typeConfig);
    const tiles = corridor(['empty', 'empty', 'empty']);
    const path = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ];
    // Standing on waypoint 0: it must head for waypoint 1, not stay put.
    expect(ai.decide(ctx(tiles, { position: { x: 1, y: 1 }, patrolPath: path })).direction).toBe(
      'right',
    );
    // At waypoint 1 it turns back toward waypoint 0.
    expect(ai.decide(ctx(tiles, { position: { x: 3, y: 1 }, patrolPath: path })).direction).toBe(
      'left',
    );
  });

  it('paths across tiles the engine lets enemies walk on (switches, open gates)', () => {
    const Hunter = load(HUNTER_SOURCE);
    const ai = new Hunter('hard', typeConfig);
    const tiles = corridor(['empty', 'switch_red', 'gate_red_open', 'empty']);
    const target = [{ position: { x: 4, y: 1 }, alive: true }];
    expect(ai.decide(ctx(tiles, { position: { x: 1, y: 1 } }, target)).direction).toBe('right');
  });

  it('still avoids lethal hazards', () => {
    const Hunter = load(HUNTER_SOURCE);
    const ai = new Hunter('hard', typeConfig);
    const tiles = corridor(['empty', 'quicksand', 'empty']);
    const target = [{ position: { x: 3, y: 1 }, alive: true }];
    expect(ai.decide(ctx(tiles, { position: { x: 1, y: 1 } }, target)).direction).toBeNull();
  });
});
