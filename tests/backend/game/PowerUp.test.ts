import { describe, it, expect } from 'vitest';
import { PowerUp } from '../../../backend/src/game/PowerUp';
import type { PowerUpType } from '@blast-arena/shared';

describe('PowerUp', () => {
  // ───────────────────────────────────────────────
  // 1. Construction
  // ───────────────────────────────────────────────
  describe('constructor', () => {
    it('should create a power-up with correct position and type', () => {
      const pu = new PowerUp({ x: 5, y: 7 }, 'bomb_up');
      expect(pu.position).toEqual({ x: 5, y: 7 });
      expect(pu.type).toBe('bomb_up');
    });

    it('should assign a unique UUID id', () => {
      const pu = new PowerUp({ x: 0, y: 0 }, 'fire_up');
      expect(typeof pu.id).toBe('string');
      expect(pu.id.length).toBeGreaterThan(0);
      // UUID v4 format check: 8-4-4-4-12 hex
      expect(pu.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should assign unique IDs to different power-ups', () => {
      const pu1 = new PowerUp({ x: 0, y: 0 }, 'bomb_up');
      const pu2 = new PowerUp({ x: 0, y: 0 }, 'bomb_up');
      expect(pu1.id).not.toBe(pu2.id);
    });

    it('should deep copy the position', () => {
      const pos = { x: 3, y: 4 };
      const pu = new PowerUp(pos, 'speed_up');
      pos.x = 999;
      expect(pu.position.x).toBe(3);
    });

    it('should create each power-up type', () => {
      const types: PowerUpType[] = [
        'bomb_up',
        'fire_up',
        'speed_up',
        'shield',
        'kick',
        'pierce_bomb',
        'remote_bomb',
        'line_bomb',
      ];
      for (const type of types) {
        const pu = new PowerUp({ x: 0, y: 0 }, type);
        expect(pu.type).toBe(type);
      }
    });
  });

  // ───────────────────────────────────────────────
  // 2. toState()
  // ───────────────────────────────────────────────
  describe('toState', () => {
    it('should return correct PowerUpState', () => {
      const pu = new PowerUp({ x: 10, y: 20 }, 'shield');
      const state = pu.toState();

      expect(state.id).toBe(pu.id);
      expect(state.position).toEqual({ x: 10, y: 20 });
      expect(state.type).toBe('shield');
    });

    it('should deep copy position in toState', () => {
      const pu = new PowerUp({ x: 5, y: 5 }, 'kick');
      const state = pu.toState();
      state.position.x = 999;
      expect(pu.position.x).toBe(5);
    });

    it('should preserve ID across toState calls', () => {
      const pu = new PowerUp({ x: 0, y: 0 }, 'bomb_up');
      const state1 = pu.toState();
      const state2 = pu.toState();
      expect(state1.id).toBe(state2.id);
    });

    it('should return independent state objects', () => {
      const pu = new PowerUp({ x: 1, y: 2 }, 'fire_up');
      const state1 = pu.toState();
      const state2 = pu.toState();
      state1.position.x = 99;
      expect(state2.position.x).toBe(1);
      expect(pu.position.x).toBe(1);
    });
  });

  // ───────────────────────────────────────────────
  // 3. Readonly properties
  // ───────────────────────────────────────────────
  describe('immutability', () => {
    it('should have readonly id', () => {
      const pu = new PowerUp({ x: 0, y: 0 }, 'bomb_up');
      // TypeScript enforces this at compile time; at runtime we verify
      // the value is stable
      const id = pu.id;
      expect(pu.id).toBe(id);
    });

    it('should have readonly type', () => {
      const pu = new PowerUp({ x: 0, y: 0 }, 'bomb_up');
      expect(pu.type).toBe('bomb_up');
    });

    it('should have readonly position', () => {
      const pu = new PowerUp({ x: 3, y: 4 }, 'bomb_up');
      expect(pu.position).toEqual({ x: 3, y: 4 });
    });
  });

  // ───────────────────────────────────────────────
  // 4. Edge Cases
  // ───────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle position at origin', () => {
      const pu = new PowerUp({ x: 0, y: 0 }, 'bomb_up');
      expect(pu.position).toEqual({ x: 0, y: 0 });
    });

    it('should handle large coordinate values', () => {
      const pu = new PowerUp({ x: 1000, y: 2000 }, 'fire_up');
      expect(pu.position).toEqual({ x: 1000, y: 2000 });
      expect(pu.toState().position).toEqual({ x: 1000, y: 2000 });
    });

    it('should produce many unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const pu = new PowerUp({ x: i, y: i }, 'bomb_up');
        ids.add(pu.id);
      }
      expect(ids.size).toBe(100);
    });
  });
});
