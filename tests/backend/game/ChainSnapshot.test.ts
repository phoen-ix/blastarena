import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { Bomb } from '../../../backend/src/game/Bomb';
import { BOMB_TIMER_TICKS } from '@blast-arena/shared';
import type { Position } from '@blast-arena/shared';

const BASE_CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 999,
  gameMode: 'ffa' as const,
  wallDensity: 0.0,
  powerUpDropRate: 0,
};

/**
 * Every bomb detonating on a given tick must resolve its blast against the wall layout as it stood
 * at the START of that tick — not against a grid that earlier bombs in the same batch already
 * carved up.
 *
 * The snapshot that guarantees this used to be taken only when unexpired bombs remained
 * (`bombs.size > bombsToDetonate.length`). When the last N bombs all expired on the SAME tick —
 * exactly what line_bomb produces, placing 3 at once with identical fuses — no snapshot was taken,
 * so the first bomb's wall destruction widened the next bomb's blast within the same loop.
 * (audit CHAIN-SNAPSHOT-1)
 */
describe('chain reaction tile snapshot', () => {
  /** Two players parked well away from row 6, purely so the FFA win condition does not fire. */
  function setup() {
    const gs = new GameStateManager(BASE_CONFIG);
    gs.addPlayer(1, 'Alice');
    gs.addPlayer(2, 'Bob');
    gs.status = 'playing';

    for (let y = 1; y < gs.map.height - 1; y++) {
      for (let x = 1; x < gs.map.width - 1; x++) {
        gs.map.tiles[y][x] = 'empty';
      }
    }
    const [a, b] = [...gs.players.values()];
    a.position = { x: 1, y: 1 };
    b.position = { x: 13, y: 11 };
    return gs;
  }

  /** Cells of the explosion produced by a specific bomb owner on the tick just processed. */
  function cellsOf(gs: GameStateManager, ownerId: number): Position[] {
    return gs.tickEvents.explosions
      .filter((e) => e.ownerId === ownerId)
      .flatMap((e) => e.cells as Position[]);
  }

  const has = (cells: Position[], x: number, y: number) =>
    cells.some((c) => c.x === x && c.y === y);

  it('does not let the first bomb widen the second bomb blast in the same tick', () => {
    const gs = setup();

    // Row 6:   A(x=2) . [wall x=4] . B(x=6)
    // A is inserted first, so it detonates first and destroys the wall. B must STILL be stopped
    // by that wall, because it was intact when the tick began.
    gs.map.tiles[6][4] = 'destructible';

    const a = new Bomb({ x: 2, y: 6 }, 1, 5);
    const b = new Bomb({ x: 6, y: 6 }, 2, 5);
    gs.bombs.set(a.id, a);
    gs.bombs.set(b.id, b);

    for (let i = 0; i < BOMB_TIMER_TICKS; i++) gs.processTick();

    expect(gs.bombs.size).toBe(0);
    const aCells = cellsOf(gs, 1);
    const bCells = cellsOf(gs, 2);
    expect(aCells.length).toBeGreaterThan(0);
    expect(bCells.length).toBeGreaterThan(0);

    // Damage cells exclude wall tiles by design (the blast destroys a wall but does not linger
    // on it), so the wall's own tile is checked on the map rather than in the cell list.
    expect(gs.map.tiles[6][4]).not.toBe('destructible');

    // A spreads right up to the wall and stops.
    expect(has(aCells, 3, 6)).toBe(true);
    expect(has(aCells, 5, 6)).toBe(false);
    expect(has(aCells, 6, 6)).toBe(false);

    // B spreads left up to the wall...
    expect(has(bCells, 5, 6)).toBe(true);
    // ...and this is the regression: B must NOT continue through the gap A just opened.
    expect(has(bCells, 3, 6)).toBe(false);
    expect(has(bCells, 2, 6)).toBe(false);
  });

  it('holds for a simultaneous 3-bomb batch (the line_bomb shape)', () => {
    const gs = setup();

    // Row 6:  L(x=2) . M(x=4) . [wall x=6] . R(x=8)
    gs.map.tiles[6][6] = 'destructible';
    const mid = new Bomb({ x: 4, y: 6 }, 1, 3);
    const right = new Bomb({ x: 8, y: 6 }, 2, 3);
    gs.bombs.set(mid.id, mid);
    gs.bombs.set(right.id, right);

    for (let i = 0; i < BOMB_TIMER_TICKS; i++) gs.processTick();

    const midCells = cellsOf(gs, 1);
    const rightCells = cellsOf(gs, 2);

    expect(gs.map.tiles[6][6]).not.toBe('destructible'); // the wall is destroyed
    expect(has(midCells, 5, 6)).toBe(true); // middle bomb reaches the wall
    expect(has(midCells, 7, 6)).toBe(false); // but does not pass through it
    expect(has(rightCells, 7, 6)).toBe(true);
    expect(has(rightCells, 5, 6)).toBe(false); // nor does the right bomb, in reverse
  });

  it('still snapshots when unexpired bombs remain (the case the old guard did cover)', () => {
    const gs = setup();
    gs.map.tiles[6][4] = 'destructible';

    const a = new Bomb({ x: 2, y: 6 }, 1, 5);
    gs.bombs.set(a.id, a);
    for (let i = 0; i < 5; i++) gs.processTick();

    // Placed later, so it is still ticking when A goes off — bombs.size > bombsToDetonate.length.
    const b = new Bomb({ x: 6, y: 6 }, 2, 5);
    gs.bombs.set(b.id, b);

    for (let i = 0; i < BOMB_TIMER_TICKS; i++) gs.processTick();
    expect(gs.bombs.size).toBe(0);
  });
});
