import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExplosionState } from '@blast-arena/shared';
import { makeFakeScene } from '../helpers/fakeScene';

vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 1 } } }));

const { ExplosionRenderer } = await import('../../src/game/ExplosionSprite');

/**
 * The classic explosion counts its particle emitters to cap them. An emitter used to be counted
 * down twice when its explosion ended before the emitter's own timer: once by the explosion's
 * teardown and once more by the timer, so the count drifted low and the caps stopped working.
 */
describe('ExplosionRenderer emitter count', () => {
  beforeEach(() => localStorage.clear());

  function blast(id: string): ExplosionState {
    return {
      id,
      cells: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      ticksRemaining: 10,
      ownerId: 1,
    } as ExplosionState;
  }

  it('counts each emitter down once, whichever ends first', () => {
    const scene = makeFakeScene();
    const timers: (() => void)[] = [];
    scene.time.delayedCall = (_ms: number, fn: () => void) => {
      timers.push(fn);
    };
    const renderer = new ExplosionRenderer(scene as never);
    const count = () => (renderer as unknown as { activeEmitterCount: number }).activeEmitterCount;

    renderer.update([blast('a')]);
    const first = scene.emitters.length;
    expect(first).toBeGreaterThan(0);
    expect(count()).toBe(first);
    const firstTimers = timers.splice(0, timers.length);

    // Explosion a ends before its emitters' timers and tears them down itself.
    renderer.update([]);
    expect(count()).toBe(0);

    // A new explosion is burning when a's timers finally fire: they must leave its count alone.
    renderer.update([blast('b')]);
    const second = scene.emitters.length - first;
    expect(count()).toBe(second);
    for (const fire of firstTimers) fire();
    expect(count()).toBe(second);

    // b's own timers end b's emitters.
    for (const fire of timers.splice(0, timers.length)) fire();
    expect(count()).toBe(0);
  });
});
