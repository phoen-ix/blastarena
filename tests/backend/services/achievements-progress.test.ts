import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * getAchievementProgress used to run a query INSIDE its loop for every locked mode_specific and
 * campaign achievement (five call sites) — dozens of round-trips per GET /achievements/progress.
 * It now pre-aggregates per-mode totals with one GROUP BY game_mode query and campaign totals
 * with one query, lazily, and evaluates the loop in memory. The numbers must be identical to what
 * the per-achievement queries produced. (audit E2)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

jest.mock('../../../backend/src/services/cosmetics', () => ({
  unlockCosmetic: jest.fn(),
  getCosmeticById: jest.fn(),
  checkCampaignStarUnlocks: jest.fn(),
}));

import { getAchievementProgress } from '../../../backend/src/services/achievements';

function achievementRow(
  id: number,
  conditionType: string,
  conditionConfig: Record<string, unknown>,
) {
  return {
    id,
    name: `A${id}`,
    description: 'd',
    icon: '🏆',
    category: 'general',
    condition_type: conditionType,
    condition_config: JSON.stringify(conditionConfig),
    reward_type: 'none',
    reward_id: null,
    is_active: true,
    sort_order: id,
  };
}

/**
 * Route each SQL text to a canned result, in the order the service issues them, without caring
 * about call order — that is exactly what the refactor changed.
 */
function routeQueries(routes: Array<[RegExp, unknown[]]>): void {
  mockQuery.mockImplementation(async (sql: string) => {
    for (const [pattern, rows] of routes) {
      if (pattern.test(sql)) return rows;
    }
    throw new Error(`unexpected query: ${sql}`);
  });
}

describe('getAchievementProgress (audit E2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const baseRoutes: Array<[RegExp, unknown[]]> = [
    [/FROM user_achievements/, []],
    [/FROM user_stats/, [{ total_kills: 7 }]],
    [/MAX\(kills\)/, [{ best_kills: 3, best_placement: 2 }]],
  ];

  it('issues ONE GROUP BY game_mode query for any number of mode_specific achievements', async () => {
    routeQueries([
      [
        /FROM achievements/,
        [
          achievementRow(1, 'mode_specific', { mode: 'ffa', stat: 'wins', threshold: 10 }),
          achievementRow(2, 'mode_specific', { mode: 'ffa', stat: 'matches', threshold: 50 }),
          achievementRow(3, 'mode_specific', { mode: 'ffa', stat: 'kills', threshold: 100 }),
          achievementRow(4, 'mode_specific', { mode: 'teams', stat: 'wins', threshold: 5 }),
          achievementRow(5, 'mode_specific', { mode: 'koth', stat: 'kills', threshold: 5 }),
        ],
      ],
      ...baseRoutes,
      [
        /GROUP BY m\.game_mode/,
        [
          // SUM() comes back from mysql2 as a DECIMAL string; COUNT(*) as a number.
          { game_mode: 'ffa', matches: 40, wins: '12', kills: '88' },
          { game_mode: 'teams', matches: 3, wins: '1', kills: '4' },
        ],
      ],
    ]);

    const progress = await getAchievementProgress(9);

    const byId = new Map(progress.map((p) => [p.achievementId, p]));
    expect(byId.get(1)!.current).toBe(10); // 12 wins capped at threshold 10
    expect(byId.get(2)!.current).toBe(40);
    expect(byId.get(3)!.current).toBe(88);
    expect(byId.get(4)!.current).toBe(1);
    expect(byId.get(5)!.current).toBe(0); // no koth rows at all

    const modeQueries = mockQuery.mock.calls.filter(([sql]) => /GROUP BY m\.game_mode/.test(sql));
    expect(modeQueries).toHaveLength(1);
    expect(modeQueries[0][1]).toEqual([9]);
    // The old per-achievement shape is gone.
    expect(mockQuery.mock.calls.some(([sql]) => /m\.game_mode = \?/.test(sql))).toBe(false);
  });

  it('issues ONE query for campaign totals covering both sub-types', async () => {
    routeQueries([
      [
        /FROM achievements/,
        [
          achievementRow(1, 'campaign', { subType: 'total_stars', threshold: 30 }),
          achievementRow(2, 'campaign', { subType: 'levels_completed', threshold: 20 }),
          achievementRow(3, 'campaign', { subType: 'total_stars', threshold: 5 }),
        ],
      ],
      ...baseRoutes,
      [/total_stars/, [{ total_stars: 12, levels_completed: 6 }]],
    ]);

    const progress = await getAchievementProgress(9);

    expect(progress.map((p) => p.current)).toEqual([12, 6, 5]);
    const campaignQueries = mockQuery.mock.calls.filter(([sql]) => /total_stars/.test(sql));
    expect(campaignQueries).toHaveLength(1);
    expect(campaignQueries[0][1]).toEqual([9, 9]);
  });

  it('treats a missing campaign_user_state row as zero', async () => {
    routeQueries([
      [
        /FROM achievements/,
        [achievementRow(1, 'campaign', { subType: 'total_stars', threshold: 30 })],
      ],
      ...baseRoutes,
      [/total_stars/, [{ total_stars: null, levels_completed: 0 }]],
    ]);

    const [p] = await getAchievementProgress(9);
    expect(p.current).toBe(0);
  });

  it('does not run the aggregate queries at all when nothing needs them', async () => {
    routeQueries([
      [
        /FROM achievements/,
        [
          achievementRow(1, 'cumulative', { stat: 'total_kills', threshold: 100 }),
          achievementRow(2, 'per_game', { stat: 'kills', threshold: 5 }),
        ],
      ],
      ...baseRoutes,
    ]);

    const progress = await getAchievementProgress(9);

    expect(progress.map((p) => p.current)).toEqual([7, 3]);
    expect(mockQuery.mock.calls.some(([sql]) => /GROUP BY m\.game_mode/.test(sql))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /total_stars/.test(sql))).toBe(false);
  });

  it('skips the aggregates for achievements that are already unlocked', async () => {
    routeQueries([
      [
        /FROM achievements/,
        [achievementRow(1, 'mode_specific', { mode: 'ffa', stat: 'wins', threshold: 10 })],
      ],
      [/FROM user_achievements/, [{ user_id: 9, achievement_id: 1, unlocked_at: new Date() }]],
      [/FROM user_stats/, []],
      [/MAX\(kills\)/, []],
    ]);

    const [p] = await getAchievementProgress(9);

    expect(p.unlocked).toBe(true);
    expect(p.current).toBe(10);
    expect(mockQuery.mock.calls.some(([sql]) => /GROUP BY m\.game_mode/.test(sql))).toBe(false);
  });

  it('runs a bounded number of queries however many achievements exist', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0
        ? achievementRow(i + 1, 'mode_specific', { mode: `m${i % 5}`, stat: 'kills', threshold: 9 })
        : achievementRow(i + 1, 'campaign', { subType: 'levels_completed', threshold: 9 }),
    );
    routeQueries([
      [/FROM achievements/, many],
      ...baseRoutes,
      [/GROUP BY m\.game_mode/, []],
      [/total_stars/, [{ total_stars: 0, levels_completed: 2 }]],
    ]);

    const progress = await getAchievementProgress(9);

    expect(progress).toHaveLength(40);
    // achievements + user_achievements + user_stats + bests + modes + campaign
    expect(mockQuery).toHaveBeenCalledTimes(6);
  });
});
