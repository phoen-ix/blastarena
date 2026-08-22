import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import type { Player } from '../../../backend/src/game/Player';
import type { PlayerInput } from '@blast-arena/shared';

interface Internals {
  tick: number;
  _lastBotInputs: Map<number, PlayerInput>;
  inputBuffer: { addInput(playerId: number, input: PlayerInput): void };
}

const CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 4242,
  gameMode: 'ffa' as const,
  wallDensity: 0,
  powerUpDropRate: 0,
};

/**
 * Bot AI runs every other tick; on off-ticks the previous input is re-buffered so movement keeps
 * flowing. It used to be replayed verbatim — including `action`, which is a one-shot side effect
 * with no "already consumed" guard, so a decision the AI made once was executed twice.
 * (audit BOT-REPLAY-ACTION-1)
 *
 * processTick() increments `tick` BEFORE testing `tick % 2 === 0`, so seeding an even tick lands
 * on the odd (replay) branch. Getting that parity wrong makes these tests silently vacuous.
 */
describe('bot input replay on throttled ticks', () => {
  function botGame() {
    const gs = new GameStateManager(CONFIG);
    gs.addPlayer(-1, 'Bot1', null, true);
    gs.addPlayer(-2, 'Bot2', null, true);
    gs.status = 'playing';
    return gs;
  }

  /** Run exactly one off-tick, capturing everything buffered for `botId` during it. */
  function runReplayTick(gs: GameStateManager, botId: number, seeded: PlayerInput): PlayerInput[] {
    const internals = gs as unknown as Internals;
    internals._lastBotInputs.set(botId, seeded);
    internals.tick = 0; // -> becomes 1 -> odd -> replay branch

    const captured: PlayerInput[] = [];
    const real = internals.inputBuffer.addInput.bind(internals.inputBuffer);
    internals.inputBuffer.addInput = (id: number, input: PlayerInput) => {
      if (id === botId) captured.push({ ...input });
      real(id, input);
    };

    gs.processTick();
    expect(internals.tick % 2).toBe(1); // the branch under test really did run
    return captured;
  }

  it('strips the action when replaying a bomb decision', () => {
    const gs = botGame();
    const captured = runReplayTick(gs, -1, { seq: 1, direction: 'up', action: 'bomb', tick: 0 });

    expect(captured).toHaveLength(1);
    expect(captured[0].action).toBeNull();
  });

  it('still replays the direction, so movement continues', () => {
    const gs = botGame();
    const captured = runReplayTick(gs, -1, { seq: 5, direction: 'right', action: null, tick: 0 });

    expect(captured).toHaveLength(1);
    expect(captured[0].direction).toBe('right');
    expect(captured[0].seq).toBe(6);
  });

  it('does not place a bomb the AI never decided on', () => {
    const gs = botGame();
    const bot = gs.players.get(-1) as Player;
    bot.maxBombs = 3;
    const before = gs.bombs.size;

    runReplayTick(gs, -1, { seq: 1, direction: null, action: 'bomb', tick: 0 });

    // Bot2 still runs its own AI on this tick, so count only bombs owned by the replayed bot.
    const placedByBot1 = [...gs.bombs.values()].filter((b) => b.ownerId === -1).length;
    expect(placedByBot1).toBe(0);
    expect(gs.bombs.size).toBeGreaterThanOrEqual(before);
  });

  it('does not flip remoteDetonateMode without a fresh detonate decision', () => {
    const gs = botGame();
    const bot = gs.players.get(-1) as Player;
    bot.hasRemoteBomb = true;
    bot.remoteDetonateMode = 'fifo';

    runReplayTick(gs, -1, { seq: 1, direction: null, action: 'detonate', tick: 0 });

    expect(bot.remoteDetonateMode).toBe('fifo');
  });
});
