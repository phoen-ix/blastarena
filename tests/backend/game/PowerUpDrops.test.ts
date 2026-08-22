import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { Player } from '../../../backend/src/game/Player';
import { POWERUP_DEFINITIONS } from '@blast-arena/shared';
import type { PowerUpType } from '@blast-arena/shared';

const ALL_POWER_UPS = Object.keys(POWERUP_DEFINITIONS) as PowerUpType[];
const TOTAL_WEIGHT = ALL_POWER_UPS.reduce((n, t) => n + POWERUP_DEFINITIONS[t].weight, 0);

const BASE_CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 4242,
  gameMode: 'ffa' as const,
  wallDensity: 0.0,
  powerUpDropRate: 0,
};

/** Reach into the private weighted picker — the behaviour under test is its distribution. */
function pick(gs: GameStateManager): PowerUpType | null {
  return (
    gs as unknown as { getRandomEnabledPowerUp(): PowerUpType | null }
  ).getRandomEnabledPowerUp();
}

describe('power-up drop selection', () => {
  // Regression: this used to be a flat `enabled[floor(rng * enabled.length)]`, which ignored
  // POWERUP_DEFINITIONS[].weight entirely. Every enabled type came out equally likely, so the
  // rare ones (remote_bomb/line_bomb, weight 3) dropped ~4x too often and the staples
  // (bomb_up/fire_up, weight 30) ~2.4x too rarely. (audit POWERUP-WEIGHTS-1)
  it('follows the declared weights when all power-ups are enabled', () => {
    const gs = new GameStateManager({ ...BASE_CONFIG, enabledPowerUps: ALL_POWER_UPS });

    const N = 60_000;
    const counts = new Map<PowerUpType, number>();
    for (let i = 0; i < N; i++) {
      const t = pick(gs);
      expect(t).not.toBeNull();
      counts.set(t as PowerUpType, (counts.get(t as PowerUpType) ?? 0) + 1);
    }

    for (const type of ALL_POWER_UPS) {
      const expected = POWERUP_DEFINITIONS[type].weight / TOTAL_WEIGHT;
      const actual = (counts.get(type) ?? 0) / N;
      // Generous tolerance — this is asserting "weights are honoured at all", not RNG quality.
      // A uniform pick would put every type at 1/9 = 0.111, which is far outside this band for
      // every type except shield (0.088), so the staples and the rares both pin it down.
      expect(actual).toBeGreaterThan(expected * 0.85);
      expect(actual).toBeLessThan(expected * 1.15);
    }
  });

  it('makes staples much more common than rares', () => {
    const gs = new GameStateManager({ ...BASE_CONFIG, enabledPowerUps: ALL_POWER_UPS });
    let bombUp = 0;
    let lineBomb = 0;
    for (let i = 0; i < 30_000; i++) {
      const t = pick(gs);
      if (t === 'bomb_up') bombUp++;
      if (t === 'line_bomb') lineBomb++;
    }
    // weight 30 vs weight 3 — an order of magnitude apart. Under the old uniform pick this
    // ratio was ~1.0.
    expect(bombUp / lineBomb).toBeGreaterThan(5);
  });

  it('re-normalises over a restricted enabled set', () => {
    // kick (5) and line_bomb (3) only: expect 5/8 vs 3/8, not 1/2 each.
    const gs = new GameStateManager({
      ...BASE_CONFIG,
      enabledPowerUps: ['kick', 'line_bomb'] as PowerUpType[],
    });
    let kick = 0;
    const N = 40_000;
    for (let i = 0; i < N; i++) if (pick(gs) === 'kick') kick++;
    expect(kick / N).toBeGreaterThan(0.58);
    expect(kick / N).toBeLessThan(0.68);
  });

  it('never returns a power-up that is not enabled', () => {
    const gs = new GameStateManager({
      ...BASE_CONFIG,
      enabledPowerUps: ['shield', 'speed_up'] as PowerUpType[],
    });
    for (let i = 0; i < 500; i++) {
      expect(['shield', 'speed_up']).toContain(pick(gs));
    }
  });

  // (audit POWERUP-EMPTY-ARRAY-1)
  it('returns null when nothing is enabled', () => {
    const gs = new GameStateManager({ ...BASE_CONFIG, enabledPowerUps: [] });
    expect(pick(gs)).toBeNull();
  });
});

describe('drop on death', () => {
  function dropFor(mutate: (p: Player) => void): PowerUpType[] {
    const gs = new GameStateManager(BASE_CONFIG);
    gs.addPlayer(1, 'p1');
    const player = gs.players.get(1) as Player;
    mutate(player);

    const before = new Set(gs.powerUps.keys());
    (gs as unknown as { dropPowerUpOnDeath(p: Player): void }).dropPowerUpOnDeath(player);
    return [...gs.powerUps.entries()]
      .filter(([id]) => !before.has(id))
      .map(([, pu]) => pu.type as PowerUpType);
  }

  // Regression: hasBombThrow was the one permanent pickup missing from the droppable stack, so a
  // player who collected it never returned it to the arena on death, unlike kick / pierce_bomb /
  // remote_bomb / line_bomb.
  it('drops bomb_throw when the player held it', () => {
    expect(
      dropFor((p) => {
        p.hasBombThrow = true;
      }),
    ).toEqual(['bomb_throw']);
  });

  it.each([
    ['hasKick', 'kick'],
    ['hasPierceBomb', 'pierce_bomb'],
    ['hasRemoteBomb', 'remote_bomb'],
    ['hasLineBomb', 'line_bomb'],
  ] as const)('drops %s as %s', (flag, type) => {
    expect(
      dropFor((p) => {
        (p as unknown as Record<string, boolean>)[flag] = true;
      }),
    ).toEqual([type]);
  });

  // Shield is consumed on hit, so by the time a player dies there is nothing to hand back.
  it('does not drop shield', () => {
    expect(
      dropFor((p) => {
        p.hasShield = true;
      }),
    ).toEqual([]);
  });

  it('drops nothing for a player with no collected power-ups', () => {
    expect(dropFor(() => {})).toEqual([]);
  });
});
