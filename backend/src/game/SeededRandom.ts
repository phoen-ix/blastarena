/**
 * Deterministic PRNG (linear congruential) used across the game engine.
 *
 * The engine is deterministic by design: the same map seed must reproduce the same match, which is
 * what makes replays faithful and simulation batches comparable. This class was copy-pasted into
 * Map.ts, GameState.ts and CampaignGame.ts and exported from none of them, so BotAI — the one
 * place with no obvious access to a generator — reached for Math.random() instead and quietly
 * broke that guarantee. One definition, exported. (audit BOTAI-DETERMINISM-1)
 */
export class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** Next value in [0, 1). */
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }

  /** Random integer in [0, max). */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /**
   * Fisher-Yates shuffle, in place.
   *
   * Note for anyone tempted by `arr.sort(() => rng.next() - 0.5)`: that idiom does NOT produce a
   * uniform permutation — the result depends on the sort implementation and is heavily biased
   * toward the original order. Two call sites in BotAI used it.
   */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}
