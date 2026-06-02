import { describe, it, expect } from '@jest/globals';
import {
  IsolatedBotAI,
  IsolatedEnemyAI,
  disposeAI,
} from '../../../backend/src/services/IsolatedAIRunner';
import { CollisionSystem } from '../../../backend/src/game/CollisionSystem';
import type { Direction, TileType } from '../../../shared/src/types/game';

// CJS strings mimic esbuild's `module.exports = ...` output for an uploaded AI.

const BOT_ESCAPE = `module.exports = class {
  generateInput(p, s) {
    let leaked;
    try { leaked = p['cons'+'tructor']['cons'+'tructor']('return process')().env; } catch (e) { leaked = undefined; }
    // signal escape success via action; must stay null because process must be unreachable
    return { seq: 1, tick: s.tick, direction: null, action: (typeof leaked === 'object' && leaked) ? 'bomb' : null };
  }
};`;

const BOT_LOOP = `module.exports = class { generateInput() { while (true) {} } };`;

// Returns the first direction that is walkable from the player's position (exercises canMoveTo).
const BOT_FIRST_MOVE = `module.exports = class {
  generateInput(player, state) {
    const dirs = ['up','down','left','right'];
    let dir = null;
    for (const d of dirs) {
      if (state.collisionSystem.canMoveTo(player.position.x, player.position.y, d, [], [])) { dir = d; break; }
    }
    return { seq: 1, tick: state.tick, direction: dir, action: null };
  }
};`;

// Exercises the reconstructed live-object API: Maps, getters, methods.
const BOT_LIVE_API = `module.exports = class {
  generateInput(player, state) {
    const players = [...state.players.values()];
    const bombs = [...state.bombs.values()];
    const pierce = bombs.some((b) => b.isPierce);
    const tile = state.collisionSystem.getTileAt(0, 0);
    return {
      seq: players.length,
      tick: state.tick,
      direction: tile === 'wall' ? 'up' : null,
      action: player.canPlaceBomb() && pierce ? 'bomb' : null,
    };
  }
};`;

const ENEMY_RNG = `module.exports = class {
  constructor(d, tc) {}
  decide(ctx) { return { direction: ctx.rng() > 0.5 ? 'up' : 'down', placeBomb: ctx.rng() > 0.9 }; }
};`;

function makeMap(): { tiles: TileType[][]; width: number; height: number } {
  const width = 9;
  const height = 9;
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    tiles[y] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      // checkerboard indestructible walls on even/even interior cells (classic arena pattern)
      const pillar = x % 2 === 0 && y % 2 === 0;
      tiles[y][x] = border || pillar ? 'wall' : 'empty';
    }
  }
  return { tiles, width, height };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function makeState(tiles: TileType[][], width: number, height: number, pos = { x: 1, y: 1 }): any {
  const self = {
    id: 1,
    username: 'bot',
    position: pos,
    alive: true,
    direction: 'down',
    bombCount: 0,
    maxBombs: 1,
    fireRange: 1,
    speed: 1,
    hasShield: false,
    hasKick: false,
    hasPierceBomb: false,
    hasRemoteBomb: false,
    hasLineBomb: false,
    hasBombThrow: false,
    team: null,
    invulnerableTicks: 0,
    moveCooldown: 0,
    kills: 0,
    deaths: 0,
    selfKills: 0,
  };
  const players = new Map([[1, self]]);
  return {
    self,
    state: {
      tick: 10,
      roundTime: 180,
      hillZone: null,
      reinforcedWalls: false,
      map: { width, height, tiles, wrapping: false },
      players,
      bombs: new Map(),
      explosions: new Map(),
      powerUps: new Map(),
    },
  };
}

describe('IsolatedAIRunner — security', () => {
  it('blocks the constructor-walk escape (process unreachable)', () => {
    const { tiles, width, height } = makeMap();
    const { self, state } = makeState(tiles, width, height);
    const ai = new IsolatedBotAI(BOT_ESCAPE, 'normal');
    try {
      const out = ai.generateInput(self, state);
      // process was unreachable in the isolate, so the escape produced no object → action stays null
      expect(out?.action).toBeNull();
    } finally {
      ai.dispose();
    }
  });

  it('terminates an infinite-loop generateInput within the per-call timeout and throws', () => {
    const { tiles, width, height } = makeMap();
    const { self, state } = makeState(tiles, width, height);
    const ai = new IsolatedBotAI(BOT_LOOP, 'normal');
    const start = Date.now();
    expect(() => ai.generateInput(self, state)).toThrow(/timed out/i);
    expect(Date.now() - start).toBeLessThan(2000); // killed quickly, not hung
    ai.dispose();
  });

  it('terminates an infinite-loop enemy decide and throws', () => {
    const ai = new IsolatedEnemyAI(
      `module.exports = class { constructor(){} decide() { while(true){} } };`,
      'normal',
      {
        speed: 1,
        canPassWalls: false,
        canPassBombs: false,
        canBomb: true,
        contactDamage: false,
        isBoss: false,
        sizeMultiplier: 1,
      },
    );
    const ctx: any = {
      self: {
        position: { x: 1, y: 1 },
        hp: 1,
        maxHp: 1,
        direction: 'down',
        alive: true,
        typeConfig: {},
      },
      players: [],
      tiles: [[]],
      mapWidth: 9,
      mapHeight: 9,
      bombPositions: [],
      otherEnemies: [],
      tick: 1,
      rng: () => 0.5,
    };
    expect(() => ai.decide(ctx)).toThrow(/timed out/i);
    ai.dispose();
  });
});

describe('IsolatedAIRunner — API fidelity', () => {
  it('reconstructs the live-object API (Maps, getters, methods)', () => {
    const { tiles, width, height } = makeMap();
    const { self, state } = makeState(tiles, width, height);
    // add a pierce bomb so bomb.isPierce is exercised
    state.bombs.set('b1', {
      id: 'b1',
      position: { x: 3, y: 1 },
      ownerId: 2,
      fireRange: 2,
      ticksRemaining: 30,
      sliding: null,
      bombType: 'pierce',
    });
    const ai = new IsolatedBotAI(BOT_LIVE_API, 'normal', { width, height });
    const out = ai.generateInput(self, state);
    expect(out).not.toBeNull();
    expect(out!.seq).toBe(1); // one player in the Map
    expect(out!.direction).toBe('up'); // getTileAt(0,0) === 'wall'
    expect(out!.action).toBe('bomb'); // canPlaceBomb() && a pierce bomb exists
    ai.dispose();
  });

  it('guest CollisionSystem.canMoveTo matches the host across positions (parity)', () => {
    const { tiles, width, height } = makeMap();
    const host = new CollisionSystem(tiles, width, height, false, false);
    const dirs: Direction[] = ['up', 'down', 'left', 'right'];
    const probes = [
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 3, y: 3 },
      { x: 7, y: 7 },
      { x: 1, y: 7 },
      { x: 5, y: 1 },
      { x: 3, y: 5 },
    ];
    for (const pos of probes) {
      const expected = dirs.find((d) => host.canMoveTo(pos.x, pos.y, d, [], [])) ?? null;
      const { self, state } = makeState(tiles, width, height, pos);
      const ai = new IsolatedBotAI(BOT_FIRST_MOVE, 'normal');
      try {
        const out = ai.generateInput(self, state);
        expect(out!.direction).toBe(expected);
      } finally {
        ai.dispose();
      }
    }
  });
});

describe('IsolatedAIRunner — enemy rng determinism', () => {
  it('draws from the host seeded RNG sequence (same seed → same decisions)', () => {
    const typeConfig = {
      speed: 1,
      canPassWalls: false,
      canPassBombs: false,
      canBomb: true,
      contactDamage: false,
      isBoss: false,
      sizeMultiplier: 1,
    };
    const baseCtx = () => ({
      self: {
        position: { x: 1, y: 1 },
        hp: 1,
        maxHp: 1,
        direction: 'down',
        alive: true,
        typeConfig: {},
      },
      players: [],
      tiles: [[]],
      mapWidth: 9,
      mapHeight: 9,
      bombPositions: [],
      otherEnemies: [],
      tick: 1,
    });
    // deterministic seeded sequence
    function seeded() {
      let s = 12345;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
      };
    }
    const runOnce = () => {
      const ai = new IsolatedEnemyAI(ENEMY_RNG, 'normal', typeConfig as any);
      const rng = seeded();
      const results = [];
      for (let i = 0; i < 5; i++) results.push(ai.decide({ ...baseCtx(), rng } as any));
      ai.dispose();
      return results;
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

describe('IsolatedAIRunner — lifecycle', () => {
  it('disposes the isolate (subsequent invoke throws) and disposeAI is a no-op on built-ins', () => {
    const { tiles, width, height } = makeMap();
    const { self, state } = makeState(tiles, width, height);
    const ai = new IsolatedBotAI(BOT_FIRST_MOVE, 'normal');
    ai.generateInput(self, state); // works
    ai.dispose();
    expect(() => ai.generateInput(self, state)).toThrow(/disposed/i);
    // disposeAI tolerates built-ins (no dispose method) and undefined
    expect(() => disposeAI({ generateInput() {} })).not.toThrow();
    expect(() => disposeAI(undefined)).not.toThrow();
  });

  it('creates and disposes many runners without error (no-leak smoke)', () => {
    const { tiles, width, height } = makeMap();
    const { self, state } = makeState(tiles, width, height);
    for (let i = 0; i < 25; i++) {
      const ai = new IsolatedBotAI(BOT_FIRST_MOVE, 'normal');
      ai.generateInput(self, state);
      ai.dispose();
    }
    expect(true).toBe(true);
  });
});
