import { describe, it, expect } from '@jest/globals';
import { Explosion } from '../../../backend/src/game/Explosion';
import { EXPLOSION_DURATION_TICKS } from '@blast-arena/shared';
import type { Position } from '@blast-arena/shared';

describe('Explosion', () => {
  // ───────────────────────────────────────────────
  // 1. Construction
  // ───────────────────────────────────────────────
  describe('constructor', () => {
    it('should create an explosion with correct cells and owner', () => {
      const cells: Position[] = [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 4 },
        { x: 6, y: 5 },
        { x: 4, y: 5 },
      ];
      const explosion = new Explosion(cells, 42);

      expect(explosion.cells.length).toBe(5);
      expect(explosion.ownerId).toBe(42);
      expect(explosion.ticksRemaining).toBe(EXPLOSION_DURATION_TICKS);
    });

    it('should assign a unique UUID id', () => {
      const e = new Explosion([{ x: 0, y: 0 }], 1);
      expect(typeof e.id).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should assign unique IDs to different explosions', () => {
      const e1 = new Explosion([{ x: 0, y: 0 }], 1);
      const e2 = new Explosion([{ x: 0, y: 0 }], 1);
      expect(e1.id).not.toBe(e2.id);
    });

    it('should deep copy the cells array', () => {
      const cells = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ];
      const explosion = new Explosion(cells, 1);

      // Mutate original
      cells[0].x = 999;
      cells.push({ x: 5, y: 6 });

      expect(explosion.cells[0].x).toBe(1);
      expect(explosion.cells.length).toBe(2);
    });

    it('should handle single-cell explosion', () => {
      const explosion = new Explosion([{ x: 5, y: 5 }], 1);
      expect(explosion.cells.length).toBe(1);
      expect(explosion.cells[0]).toEqual({ x: 5, y: 5 });
    });

    it('should handle empty cells array', () => {
      const explosion = new Explosion([], 1);
      expect(explosion.cells.length).toBe(0);
    });

    it('should handle large cross-shaped explosion', () => {
      const cells: Position[] = [];
      const center = { x: 10, y: 10 };
      cells.push(center);
      for (let i = 1; i <= 8; i++) {
        cells.push({ x: center.x + i, y: center.y });
        cells.push({ x: center.x - i, y: center.y });
        cells.push({ x: center.x, y: center.y + i });
        cells.push({ x: center.x, y: center.y - i });
      }
      const explosion = new Explosion(cells, 1);
      expect(explosion.cells.length).toBe(33); // center + 4 * 8
    });

    it('should accept negative owner IDs (bots)', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], -3);
      expect(explosion.ownerId).toBe(-3);
    });
  });

  // ───────────────────────────────────────────────
  // 2. tick()
  // ───────────────────────────────────────────────
  describe('tick', () => {
    it('should decrement ticksRemaining by 1', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 1);
      const initial = explosion.ticksRemaining;
      const expired = explosion.tick();
      expect(explosion.ticksRemaining).toBe(initial - 1);
      expect(expired).toBe(false);
    });

    it('should return false while ticksRemaining > 0', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 1);
      // Tick until 1 remaining
      for (let i = 0; i < EXPLOSION_DURATION_TICKS - 1; i++) {
        expect(explosion.tick()).toBe(false);
      }
      expect(explosion.ticksRemaining).toBe(1);
    });

    it('should return true when ticksRemaining reaches 0', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 1);
      for (let i = 0; i < EXPLOSION_DURATION_TICKS - 1; i++) {
        explosion.tick();
      }
      // Last tick brings it to 0
      expect(explosion.tick()).toBe(true);
      expect(explosion.ticksRemaining).toBe(0);
    });

    it('should return true on subsequent ticks after expiry (goes negative)', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 1);
      for (let i = 0; i < EXPLOSION_DURATION_TICKS; i++) {
        explosion.tick();
      }
      // Already at 0, ticking again goes to -1
      expect(explosion.tick()).toBe(true);
      expect(explosion.ticksRemaining).toBe(-1);
    });

    it('should expire after exactly EXPLOSION_DURATION_TICKS ticks', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 1);
      let expired = false;
      let tickCount = 0;
      while (!expired) {
        expired = explosion.tick();
        tickCount++;
      }
      expect(tickCount).toBe(EXPLOSION_DURATION_TICKS);
    });
  });

  // ───────────────────────────────────────────────
  // 3. containsCell()
  // ───────────────────────────────────────────────
  describe('containsCell', () => {
    const cells: Position[] = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 4 },
      { x: 6, y: 5 },
      { x: 4, y: 5 },
    ];

    it('should return true for cells that are in the explosion', () => {
      const explosion = new Explosion(cells, 1);
      expect(explosion.containsCell(5, 5)).toBe(true);
      expect(explosion.containsCell(5, 6)).toBe(true);
      expect(explosion.containsCell(5, 4)).toBe(true);
      expect(explosion.containsCell(6, 5)).toBe(true);
      expect(explosion.containsCell(4, 5)).toBe(true);
    });

    it('should return false for cells not in the explosion', () => {
      const explosion = new Explosion(cells, 1);
      expect(explosion.containsCell(0, 0)).toBe(false);
      expect(explosion.containsCell(6, 6)).toBe(false);
      expect(explosion.containsCell(4, 6)).toBe(false);
      expect(explosion.containsCell(5, 3)).toBe(false);
      expect(explosion.containsCell(7, 5)).toBe(false);
    });

    it('should return false for empty explosion', () => {
      const explosion = new Explosion([], 1);
      expect(explosion.containsCell(0, 0)).toBe(false);
    });

    it('should return false for adjacent but not included cells', () => {
      const explosion = new Explosion([{ x: 5, y: 5 }], 1);
      expect(explosion.containsCell(4, 4)).toBe(false);
      expect(explosion.containsCell(6, 6)).toBe(false);
      expect(explosion.containsCell(4, 6)).toBe(false);
      expect(explosion.containsCell(6, 4)).toBe(false);
    });

    it('should correctly distinguish x and y coordinates', () => {
      const explosion = new Explosion([{ x: 3, y: 7 }], 1);
      expect(explosion.containsCell(3, 7)).toBe(true);
      expect(explosion.containsCell(7, 3)).toBe(false);
    });

    it('should handle cells at the origin', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 1);
      expect(explosion.containsCell(0, 0)).toBe(true);
      expect(explosion.containsCell(1, 0)).toBe(false);
      expect(explosion.containsCell(0, 1)).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 4. toState()
  // ───────────────────────────────────────────────
  describe('toState', () => {
    it('should produce correct ExplosionState', () => {
      const cells: Position[] = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ];
      const explosion = new Explosion(cells, 7);

      const state = explosion.toState();
      expect(state.id).toBe(explosion.id);
      expect(state.cells).toEqual([
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ]);
      expect(state.ownerId).toBe(7);
      expect(state.ticksRemaining).toBe(EXPLOSION_DURATION_TICKS);
    });

    it('should return cells by reference (no deep copy — cells are immutable after construction)', () => {
      const explosion = new Explosion([{ x: 5, y: 5 }], 1);
      const state = explosion.toState();
      // Cells are the same reference — no per-tick copy overhead
      expect(state.cells).toBe(explosion.cells);
    });

    it('should deep copy input cells in constructor', () => {
      const input = [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ];
      const explosion = new Explosion(input, 1);
      input[0].x = 999;
      // Constructor copies, so internal cells are independent from input
      expect(explosion.cells[0].x).toBe(1);
    });

    it('should reflect updated ticksRemaining', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 1);
      explosion.tick();
      explosion.tick();
      const state = explosion.toState();
      expect(state.ticksRemaining).toBe(EXPLOSION_DURATION_TICKS - 2);
    });

    it('should handle empty explosion toState', () => {
      const explosion = new Explosion([], 1);
      const state = explosion.toState();
      expect(state.cells).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────
  // 5. Edge Cases
  // ───────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle explosion with duplicate cell positions', () => {
      const cells: Position[] = [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ];
      const explosion = new Explosion(cells, 1);
      expect(explosion.cells.length).toBe(2);
      expect(explosion.containsCell(5, 5)).toBe(true);
    });

    it('should preserve cell order', () => {
      const cells: Position[] = [
        { x: 3, y: 1 },
        { x: 1, y: 3 },
        { x: 2, y: 2 },
      ];
      const explosion = new Explosion(cells, 1);
      expect(explosion.cells[0]).toEqual({ x: 3, y: 1 });
      expect(explosion.cells[1]).toEqual({ x: 1, y: 3 });
      expect(explosion.cells[2]).toEqual({ x: 2, y: 2 });
    });

    it('should handle owner ID of 0', () => {
      const explosion = new Explosion([{ x: 0, y: 0 }], 0);
      expect(explosion.ownerId).toBe(0);
      expect(explosion.toState().ownerId).toBe(0);
    });

    it('should handle EXPLOSION_DURATION_TICKS constant value', () => {
      // Verify the constant is what we expect (10)
      expect(EXPLOSION_DURATION_TICKS).toBe(10);
    });

    it('containsCell should still work after ticking', () => {
      const cells: Position[] = [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ];
      const explosion = new Explosion(cells, 1);
      explosion.tick();
      explosion.tick();
      expect(explosion.containsCell(1, 1)).toBe(true);
      expect(explosion.containsCell(2, 2)).toBe(true);
      expect(explosion.containsCell(3, 3)).toBe(false);
    });
  });
});
