import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';

interface WithMapEvents {
  mapEvents: { type: string; tick: number }[];
}

const BASE_CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 7,
  gameMode: 'ffa' as const,
  wallDensity: 0.0,
  powerUpDropRate: 0,
};

/**
 * `mapEvents` is emptied by an expiry filter that used to live INSIDE
 * `if (this.enableMapEvents && …)`. But spectator Game Master actions and the KOTH hill_move push
 * into the same array unconditionally, so a room with spectator actions on and dynamic map events
 * off never expired anything: the array grew for the whole match and was re-serialized into every
 * game:state frame sent to every client. (audit MAPEVENT-PRUNE-1)
 */
describe('map event expiry', () => {
  function makeGame(enableMapEvents: boolean) {
    const gs = new GameStateManager({ ...BASE_CONFIG, enableMapEvents });
    gs.addPlayer(1, 'Alice');
    gs.addPlayer(2, 'Bob');
    gs.status = 'playing';
    return gs;
  }

  function seedEvent(gs: GameStateManager) {
    (gs as unknown as WithMapEvents).mapEvents.push({ type: 'hill_move', tick: gs.tick });
  }

  const count = (gs: GameStateManager) => (gs as unknown as WithMapEvents).mapEvents.length;

  it('expires events even when dynamic map events are disabled', () => {
    const gs = makeGame(false);
    seedEvent(gs);
    expect(count(gs)).toBe(1);

    for (let i = 0; i < 205; i++) gs.processTick();

    expect(count(gs)).toBe(0);
  });

  it('expires events when dynamic map events are enabled', () => {
    const gs = makeGame(true);
    seedEvent(gs);

    for (let i = 0; i < 205; i++) gs.processTick();

    expect(count(gs)).toBe(0);
  });

  it('keeps events that are still within the display window', () => {
    const gs = makeGame(false);
    seedEvent(gs);

    for (let i = 0; i < 50; i++) gs.processTick();

    expect(count(gs)).toBe(1);
  });

  it('does not accumulate unboundedly across a long match', () => {
    const gs = makeGame(false);
    // One event per second for 60s, as a spectator acting at the rate limit would produce.
    for (let i = 0; i < 1200; i++) {
      if (i % 20 === 0) seedEvent(gs);
      gs.processTick();
    }
    // Only the last ~200 ticks' worth may remain, not all 60.
    expect(count(gs)).toBeLessThanOrEqual(10);
  });
});
