import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { BotAI } from '../../../backend/src/game/BotAI';
import { SeededRandom } from '../../../backend/src/game/SeededRandom';

/**
 * The engine is deterministic off the map seed — that is what makes a replay reproduce the match
 * it recorded and a simulation batch comparable run to run. BotAI used Math.random() in ten
 * places, so any match containing bots diverged the moment a bot made a random choice.
 * (audit BOTAI-DETERMINISM-1)
 */
describe('bot determinism', () => {
  function runMatch(seed: number, ticks = 200) {
    const gs = new GameStateManager({
      mapWidth: 15,
      mapHeight: 13,
      mapSeed: seed,
      gameMode: 'ffa',
      wallDensity: 0.4,
      powerUpDropRate: 0.3,
      botDifficulty: 'normal',
    });
    gs.addPlayer(-1, 'Bot1', null, true);
    gs.addPlayer(-2, 'Bot2', null, true);
    gs.addPlayer(-3, 'Bot3', null, true);
    gs.status = 'playing';

    for (let i = 0; i < ticks; i++) gs.processTick();

    return [...gs.players.values()].map((p) => ({
      id: p.id,
      x: p.position.x,
      y: p.position.y,
      kills: p.kills,
      alive: p.alive,
      bombsPlaced: p.bombsPlaced,
    }));
  }

  it('replays a bot match identically from the same seed', () => {
    expect(runMatch(12345)).toEqual(runMatch(12345));
  });

  it('produces different matches from different seeds', () => {
    // Not a correctness requirement so much as proof the seed is actually wired through: if the
    // seed were ignored, these would be identical.
    const a = runMatch(1000);
    const b = runMatch(999);
    expect(a).not.toEqual(b);
  });

  it('gives each bot its own stream rather than identical decisions', () => {
    const a = new BotAI('normal', { width: 15, height: 13 }, 100);
    const b = new BotAI('normal', { width: 15, height: 13 }, 200);
    const draw = (bot: BotAI) =>
      Array.from({ length: 10 }, () => (bot as unknown as { rng: SeededRandom }).rng.next());
    expect(draw(a)).not.toEqual(draw(b));
  });

  it('is reproducible for a single bot given the same seed', () => {
    const draw = (seed: number) => {
      const bot = new BotAI('hard', { width: 15, height: 13 }, seed);
      return Array.from({ length: 20 }, () => (bot as unknown as { rng: SeededRandom }).rng.next());
    };
    expect(draw(77)).toEqual(draw(77));
  });
});

describe('SeededRandom.shuffle', () => {
  // `arr.sort(() => rng.next() - 0.5)` — the idiom BotAI used in two places — is not a uniform
  // shuffle: it leaves elements near their original positions far more often than chance.
  it('is not biased toward the original order', () => {
    const rng = new SeededRandom(5);
    let firstStayedFirst = 0;
    const RUNS = 2000;
    for (let i = 0; i < RUNS; i++) {
      const shuffled = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
      if (shuffled[0] === 0) firstStayedFirst++;
    }
    // Uniform would be 1/8 = 12.5%. Allow a generous band; the biased sort idiom lands far above.
    const rate = firstStayedFirst / RUNS;
    expect(rate).toBeGreaterThan(0.08);
    expect(rate).toBeLessThan(0.18);
  });

  it('preserves the elements', () => {
    const rng = new SeededRandom(9);
    const shuffled = rng.shuffle([1, 2, 3, 4, 5]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('is reproducible from the same seed', () => {
    expect(new SeededRandom(3).shuffle([1, 2, 3, 4, 5, 6])).toEqual(
      new SeededRandom(3).shuffle([1, 2, 3, 4, 5, 6]),
    );
  });
});
