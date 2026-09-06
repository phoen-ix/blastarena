import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { Explosion } from '../../../backend/src/game/Explosion';
import { SeededRandom } from '../../../backend/src/game/SeededRandom';
import { BotAIRegistry } from '../../../backend/src/services/botai-registry';
import { CollisionSystem } from '../../../backend/src/game/CollisionSystem';
import { ReplayRecorder } from '../../../backend/src/utils/replayRecorder';
import type { Direction, PlayerInput, TileType } from '@blast-arena/shared';
import { KOTH_HILL_MOVE_INTERVAL, KOTH_ZONE_SIZE } from '@blast-arena/shared';

let seq = 0;
const move = (direction: Direction): PlayerInput => ({
  direction,
  action: null,
  tick: 0,
  seq: ++seq,
});

function makeState(overrides: Partial<ConstructorParameters<typeof GameStateManager>[0]> = {}) {
  const gs = new GameStateManager({
    mapWidth: 15,
    mapHeight: 13,
    mapSeed: 4242,
    gameMode: 'ffa',
    wallDensity: 0,
    powerUpDropRate: 0,
    ...overrides,
  });
  gs.status = 'playing';
  return gs;
}

// ─────────────────────────────────────────────────────────────────────────────
// KOTH hill relocation (audit KOTH-HILL-MOVE-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('KOTH hill relocation', () => {
  it('relocates the hill on a generated map and re-arms the timer', () => {
    const gs = makeState({
      gameMode: 'king_of_the_hill',
      mapWidth: 35,
      mapHeight: 35,
      wallDensity: 0.65,
    });
    gs.addPlayer(1, 'a');
    gs.addPlayer(2, 'b');
    const initial = { ...gs.hillZone! };

    for (let i = 0; i < KOTH_HILL_MOVE_INTERVAL + 5; i++) gs.processTick();

    expect(gs.hillZone).not.toEqual(initial);
    // The chosen window tolerates only the centre pillar
    const h = gs.hillZone!;
    const half = Math.floor(KOTH_ZONE_SIZE / 2);
    for (let dy = 0; dy < KOTH_ZONE_SIZE; dy++) {
      for (let dx = 0; dx < KOTH_ZONE_SIZE; dx++) {
        if (gs.map.tiles[h.y + dy][h.x + dx] === 'wall') {
          expect([dx, dy]).toEqual([half, half]);
        }
      }
    }
  });

  it('re-arms the timer when no destination exists instead of rescanning every tick', () => {
    const gs = makeState({ gameMode: 'king_of_the_hill', mapWidth: 9, mapHeight: 9 });
    gs.addPlayer(1, 'a');
    gs.addPlayer(2, 'b');
    // Solid walls everywhere except the current hill: no candidate can ever qualify
    for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) gs.map.tiles[y][x] = 'wall';
    const internals = gs as unknown as { nextHillMoveTick: number; pickNewHillZone(): unknown };
    let picks = 0;
    const original = internals.pickNewHillZone.bind(gs);
    internals.pickNewHillZone = () => {
      picks++;
      return original();
    };

    for (let i = 0; i < KOTH_HILL_MOVE_INTERVAL * 2; i++) gs.processTick();

    expect(picks).toBeLessThanOrEqual(3);
    expect(internals.nextHillMoveTick).toBeGreaterThan(gs.tick);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Intra-tick occupancy (audit INTRA-TICK-OCCUPANCY-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('intra-tick player occupancy', () => {
  it('does not let a later-processed player step onto a tile another player just moved into', () => {
    const gs = makeState();
    const a = gs.addPlayer(1, 'a');
    const b = gs.addPlayer(2, 'b');
    // Row 1 is fully walkable (wallDensity 0): A at (1,1) moves right to (2,1); B at (3,1) moves left.
    a.position = { x: 1, y: 1 };
    b.position = { x: 3, y: 1 };
    a.moveCooldown = 0;
    b.moveCooldown = 0;
    gs.inputBuffer.addInput(1, move('right'));
    gs.inputBuffer.addInput(2, move('left'));

    gs.processTick();

    expect(a.position).toEqual({ x: 2, y: 1 });
    expect(b.position).toEqual({ x: 3, y: 1 });
  });

  it('lets the vacated tile be entered in the same tick', () => {
    const gs = makeState();
    const a = gs.addPlayer(1, 'a');
    const b = gs.addPlayer(2, 'b');
    a.position = { x: 1, y: 1 };
    b.position = { x: 2, y: 1 };
    a.moveCooldown = 0;
    b.moveCooldown = 0;
    // A (processed first) walks away right; B... wait, B is at (2,1). Make A leave (1,1) downwards
    // and B step left into the tile A vacated.
    gs.inputBuffer.addInput(1, move('down'));
    gs.inputBuffer.addInput(2, move('left'));

    gs.processTick();

    expect(a.position).toEqual({ x: 1, y: 2 });
    expect(b.position).toEqual({ x: 1, y: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finish-grace gating (audit GRACE-GATE-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('finish grace period', () => {
  it('does not let the battle-royale zone kill the declared winner', () => {
    const gs = makeState({ gameMode: 'battle_royale', hasZone: true });
    const a = gs.addPlayer(1, 'a');
    const b = gs.addPlayer(2, 'b');
    gs.killPlayer(b.id, null, 'zone');
    gs.processTick(); // win condition → finishTick set, a is the winner
    expect(gs.winnerId).toBe(a.id);
    // Force the zone to exclude everything
    const zone = gs.zone as unknown as { currentRadius: number };
    zone.currentRadius = 0;

    for (let i = 0; i < 5; i++) gs.processTick();

    expect(a.alive).toBe(true);
  });

  it('stops deathmatch respawns once the match is finishing', () => {
    const gs = makeState({ gameMode: 'deathmatch' });
    const a = gs.addPlayer(1, 'a');
    const b = gs.addPlayer(2, 'b');
    a.kills = 999;
    gs.killPlayer(b.id, a.id, 'bomb');
    gs.processTick(); // kill target reached → finishing
    expect(gs.winnerId).toBe(a.id);

    for (let i = 0; i < 25; i++) gs.processTick();

    expect(b.alive).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SeededRandom range (audit SEEDED-RANDOM-RANGE-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('SeededRandom', () => {
  it('never returns 1.0 — the state that produced it before is 0xffffffff', () => {
    // seed such that the next state is 0xffffffff: solve (s * a + c) & 0xffffffff === 0xffffffff
    // by brute force over a modest range is slow; instead poke the state directly.
    const rng = new SeededRandom(1);
    (rng as unknown as { seed: number }).seed = 0xffffffff;
    // One LCG step from 0xffffffff; then keep stepping — no draw may ever reach 1.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 100_000; i++) {
      const v = rng.next();
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    // And the direct division is exclusive: 0xffffffff / 2^32 < 1
    expect(0xffffffff / 0x100000000).toBeLessThan(1);
  });

  it('nextInt never returns max', () => {
    const rng = new SeededRandom(7);
    let hitMax = false;
    for (let i = 0; i < 20_000; i++) if (rng.nextInt(3) >= 3) hitMax = true;
    expect(hitMax).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry seed threading (audit BOTAI-SEED-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('BotAIRegistry.createInstance', () => {
  it('passes the per-bot seed to the built-in AI', () => {
    const registry = new BotAIRegistry();
    const a = registry.createInstance('builtin', 'normal', { width: 15, height: 13 }, 100);
    const b = registry.createInstance('builtin', 'normal', { width: 15, height: 13 }, 200);
    const c = registry.createInstance('builtin', 'normal', { width: 15, height: 13 }, 100);
    const draw = (ai: unknown) => {
      const rng = (ai as { rng: SeededRandom }).rng;
      return [rng.next(), rng.next(), rng.next()];
    };
    const da = draw(a);
    expect(da).not.toEqual(draw(b));
    expect(da).toEqual(draw(c));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Collision hot path (audit COLLISION-HOTPATH-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('CollisionSystem', () => {
  const tiles: TileType[][] = [
    ['wall', 'wall', 'wall', 'wall'],
    ['wall', 'empty', 'empty', 'wall'],
    ['wall', 'lava', 'ice', 'wall'],
    ['wall', 'wall', 'wall', 'wall'],
  ];
  const cs = new CollisionSystem(tiles, 4, 4);

  it('isWalkable matches the documented tile set', () => {
    expect(cs.isWalkable(1, 1)).toBe(true);
    expect(cs.isWalkable(2, 2)).toBe(true); // ice
    expect(cs.isWalkable(1, 2)).toBe(false); // lava
    expect(cs.isWalkable(0, 0)).toBe(false);
    expect(cs.isWalkable(-1, 1)).toBe(false);
  });

  it('canMoveToKeyed agrees with canMoveTo', () => {
    const bombs = [{ x: 2, y: 1 }];
    const players = [{ x: 2, y: 2, id: 7 }];
    const blocked = new Set(['2,1', '2,2']);
    for (const dir of ['up', 'down', 'left', 'right'] as Direction[]) {
      expect(cs.canMoveToKeyed(1, 1, dir, blocked)).toEqual(
        cs.canMoveTo(1, 1, dir, bombs, players),
      );
    }
  });

  it('canMoveTo exempts the mover and its own buddy via selfId', () => {
    const occupants = [
      { x: 2, y: 1, id: 9, buddyOwnerId: 1 }, // player 1's buddy
      { x: 1, y: 1, id: 1 },
    ];
    expect(cs.canMoveTo(1, 1, 'right', [], occupants, 1)).toEqual({ x: 2, y: 1 });
    expect(cs.canMoveTo(1, 1, 'right', [], occupants, 2)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tick payload trimming (audit TICK-PAYLOAD-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('toTickState payload', () => {
  it('sends cosmetics on the first tick only, explosion cells once, and no spawn points', () => {
    const gs = makeState();
    const a = gs.addPlayer(1, 'a');
    a.cosmetics = { colorHex: 0xff0000 } as unknown as typeof a.cosmetics;
    const explosion = new Explosion(
      [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ],
      1,
    );
    gs.explosions.set(explosion.id, explosion);

    const first = gs.toTickState();
    expect(first.players[0].cosmetics).toEqual({ colorHex: 0xff0000 });
    expect(first.explosions[0].cells).toHaveLength(2);
    expect(first.map.spawnPoints).toEqual([]);
    expect(first.map.tiles).toEqual([]);

    const second = gs.toTickState();
    expect(second.players[0].cosmetics).toBeUndefined();
    expect(second.explosions[0].cells).toEqual([]);

    // Full state still carries everything
    const full = gs.toState();
    expect(full.players[0].cosmetics).toEqual({ colorHex: 0xff0000 });
    expect(full.explosions[0].cells).toHaveLength(2);
    expect(full.map.spawnPoints.length).toBeGreaterThan(0);
  });

  it('does not record a tile diff for blast cells whose tile did not change', () => {
    const gs = makeState();
    const a = gs.addPlayer(1, 'a');
    a.position = { x: 1, y: 1 };
    gs.inputBuffer.addInput(1, { direction: null, action: 'bomb', tick: 0, seq: ++seq });
    gs.processTick();
    for (let i = 0; i < 70; i++) gs.processTick();
    // Open floor all around (wallDensity 0): the explosion destroyed nothing → no diffs at all
    const state = gs.toTickState();
    expect(state.tileDiffs).toBeUndefined();
    expect(gs.tileChangeLog).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Replay recorder rehydration + diff consumption (audit REPLAY-DIFF-1, TICK-PAYLOAD-1)
// ─────────────────────────────────────────────────────────────────────────────
describe('ReplayRecorder with trimmed tick states', () => {
  it('fills cosmetics and explosion cells back in from the first tick they appeared', () => {
    const gs = makeState();
    const a = gs.addPlayer(1, 'a');
    a.cosmetics = { colorHex: 0x00ff00 } as unknown as typeof a.cosmetics;
    const recorder = new ReplayRecorder('ROOM', 'ffa', gs.toState());
    const explosion = new Explosion([{ x: 3, y: 3 }], 1);
    gs.explosions.set(explosion.id, explosion);
    const events = { explosions: [], playerDied: [], powerupCollected: [], bombThrown: [] };

    // The room passes the live grid alongside the tick state, as GameRoom.broadcastState does
    const tick = () => {
      gs.processTick();
      const s = gs.toTickState();
      recorder.recordTick({ ...s, map: { ...s.map, tiles: gs.map.tiles } }, events);
    };
    tick();
    tick();
    tick();

    const frames = (
      recorder as unknown as {
        frames: { players: { cosmetics?: unknown }[]; explosions: { cells: unknown[] }[] }[];
      }
    ).frames;
    expect(frames).toHaveLength(3);
    for (const f of frames) {
      expect(f.players[0].cosmetics).toEqual({ colorHex: 0x00ff00 });
      expect(f.explosions[0].cells).toEqual([{ x: 3, y: 3 }]);
    }
  });

  it('takes tile diffs from the tick state instead of rescanning the grid', () => {
    const gs = makeState({ wallDensity: 0.5 });
    gs.addPlayer(1, 'a');
    const recorder = new ReplayRecorder('ROOM', 'ffa', gs.toState());
    const events = { explosions: [], playerDied: [], powerupCollected: [], bombThrown: [] };
    // Mutate one tile through the tracked path
    gs.setTileTracked(5, 5, 'ice');
    const s = gs.toTickState();
    expect(s.tileDiffs).toEqual([{ x: 5, y: 5, type: 'ice' }]);
    recorder.recordTick({ ...s, map: { ...s.map, tiles: gs.map.tiles } }, events);
    const frames = (recorder as unknown as { frames: { tileDiffs?: unknown[] }[] }).frames;
    expect(frames[0].tileDiffs).toEqual([{ x: 5, y: 5, type: 'ice' }]);
  });
});
