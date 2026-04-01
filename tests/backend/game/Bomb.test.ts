import { describe, it, expect } from '@jest/globals';
import { Bomb } from '../../../backend/src/game/Bomb';
import { BOMB_TIMER_TICKS } from '@blast-arena/shared';

const REMOTE_BOMB_MAX_TIMER = 200;

describe('Bomb', () => {
  it('should create a bomb with correct properties', () => {
    const bomb = new Bomb({ x: 5, y: 3 }, 1, 2);
    expect(bomb.position).toEqual({ x: 5, y: 3 });
    expect(bomb.ownerId).toBe(1);
    expect(bomb.fireRange).toBe(2);
    expect(bomb.ticksRemaining).toBe(BOMB_TIMER_TICKS);
  });

  it('should count down and detonate', () => {
    const bomb = new Bomb({ x: 0, y: 0 }, 1, 1);
    for (let i = 0; i < BOMB_TIMER_TICKS - 1; i++) {
      expect(bomb.tick()).toBe(false);
    }
    expect(bomb.tick()).toBe(true); // Should detonate
  });

  it('should serialize to state correctly', () => {
    const bomb = new Bomb({ x: 3, y: 7 }, 2, 3);
    const state = bomb.toState();
    expect(state.position).toEqual({ x: 3, y: 7 });
    expect(state.ownerId).toBe(2);
    expect(state.fireRange).toBe(3);
    expect(state.ticksRemaining).toBe(BOMB_TIMER_TICKS);
    expect(state.id).toBe(bomb.id);
  });

  describe('bomb types', () => {
    it('should create remote bomb with REMOTE_BOMB_MAX_TIMER', () => {
      const bomb = new Bomb({ x: 1, y: 1 }, 1, 2, 'remote');
      expect(bomb.ticksRemaining).toBe(REMOTE_BOMB_MAX_TIMER);
    });

    it('should create pierce bomb with standard BOMB_TIMER_TICKS', () => {
      const bomb = new Bomb({ x: 1, y: 1 }, 1, 2, 'pierce');
      expect(bomb.ticksRemaining).toBe(BOMB_TIMER_TICKS);
    });

    it('should return isRemote true for remote bombs', () => {
      const bomb = new Bomb({ x: 0, y: 0 }, 1, 1, 'remote');
      expect(bomb.isRemote).toBe(true);
      expect(bomb.isPierce).toBe(false);
    });

    it('should return isPierce true for pierce bombs', () => {
      const bomb = new Bomb({ x: 0, y: 0 }, 1, 1, 'pierce');
      expect(bomb.isPierce).toBe(true);
      expect(bomb.isRemote).toBe(false);
    });

    it('should return isRemote and isPierce both false for normal bombs', () => {
      const bomb = new Bomb({ x: 0, y: 0 }, 1, 1, 'normal');
      expect(bomb.isRemote).toBe(false);
      expect(bomb.isPierce).toBe(false);
    });

    it('should default to normal bomb type when not specified', () => {
      const bomb = new Bomb({ x: 0, y: 0 }, 1, 1);
      expect(bomb.bombType).toBe('normal');
      expect(bomb.ticksRemaining).toBe(BOMB_TIMER_TICKS);
    });

    it('should detonate remote bomb after REMOTE_BOMB_MAX_TIMER ticks', () => {
      const bomb = new Bomb({ x: 0, y: 0 }, 1, 1, 'remote');
      for (let i = 0; i < REMOTE_BOMB_MAX_TIMER - 1; i++) {
        expect(bomb.tick()).toBe(false);
      }
      expect(bomb.tick()).toBe(true);
    });

    it('should include bombType in toState()', () => {
      const remoteBomb = new Bomb({ x: 0, y: 0 }, 1, 1, 'remote');
      expect(remoteBomb.toState().bombType).toBe('remote');

      const pierceBomb = new Bomb({ x: 0, y: 0 }, 1, 1, 'pierce');
      expect(pierceBomb.toState().bombType).toBe('pierce');

      const normalBomb = new Bomb({ x: 0, y: 0 }, 1, 1);
      expect(normalBomb.toState().bombType).toBe('normal');
    });

    it('should default sliding to null', () => {
      const bomb = new Bomb({ x: 0, y: 0 }, 1, 1);
      expect(bomb.sliding).toBeNull();
    });

    it('should default conveyorCooldown to 0', () => {
      const bomb = new Bomb({ x: 0, y: 0 }, 1, 1);
      expect(bomb.conveyorCooldown).toBe(0);
    });
  });
});
