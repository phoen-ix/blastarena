import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
const mockWithTransaction = jest.fn<AnyFn>();

jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: mockWithTransaction,
}));

import {
  calculateExpectedScore,
  getKFactor,
  calculateFfaElo,
  calculateTeamElo,
  processMatchElo,
} from '../../../backend/src/services/elo';

describe('Elo Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: AnyFn) => {
      const conn = {
        execute: jest.fn<AnyFn>().mockResolvedValue([{ affectedRows: 1 }]),
      };
      return fn(conn);
    });
  });

  // ── calculateExpectedScore ──────────────────────────────────────────

  describe('calculateExpectedScore', () => {
    it('should return 0.5 for equal ratings', () => {
      const result = calculateExpectedScore(1000, 1000);
      expect(result).toBe(0.5);
    });

    it('should return 0.5 for any equal rating pair', () => {
      expect(calculateExpectedScore(1500, 1500)).toBe(0.5);
      expect(calculateExpectedScore(800, 800)).toBe(0.5);
    });

    it('should return >0.5 when player A is higher rated', () => {
      const result = calculateExpectedScore(1200, 1000);
      expect(result).toBeGreaterThan(0.5);
    });

    it('should return <0.5 when player A is lower rated', () => {
      const result = calculateExpectedScore(1000, 1200);
      expect(result).toBeLessThan(0.5);
    });

    it('should return approximately 0.76 for 200 point advantage', () => {
      const result = calculateExpectedScore(1200, 1000);
      expect(result).toBeCloseTo(0.7597, 3);
    });

    it('should return approximately 0.24 for 200 point disadvantage', () => {
      const result = calculateExpectedScore(1000, 1200);
      expect(result).toBeCloseTo(0.2403, 3);
    });

    it('should be symmetric (sum to 1) for two players', () => {
      const scoreA = calculateExpectedScore(1400, 1000);
      const scoreB = calculateExpectedScore(1000, 1400);
      expect(scoreA + scoreB).toBeCloseTo(1.0, 10);
    });

    it('should return close to 1 for very large rating difference', () => {
      const result = calculateExpectedScore(2000, 1000);
      expect(result).toBeGreaterThan(0.99);
    });

    it('should return close to 0 for very large rating disadvantage', () => {
      const result = calculateExpectedScore(1000, 2000);
      expect(result).toBeLessThan(0.01);
    });
  });

  // ── getKFactor ──────────────────────────────────────────────────────

  describe('getKFactor', () => {
    it('should return 32 for players with fewer than 30 matches', () => {
      expect(getKFactor(0)).toBe(32);
      expect(getKFactor(1)).toBe(32);
      expect(getKFactor(15)).toBe(32);
      expect(getKFactor(29)).toBe(32);
    });

    it('should return 16 for players with 30 or more matches', () => {
      expect(getKFactor(30)).toBe(16);
      expect(getKFactor(31)).toBe(16);
      expect(getKFactor(100)).toBe(16);
      expect(getKFactor(500)).toBe(16);
    });

    it('should have boundary at exactly 30', () => {
      expect(getKFactor(29)).toBe(32);
      expect(getKFactor(30)).toBe(16);
    });
  });

  // ── calculateFfaElo ────────────────────────────────────────────────

  describe('calculateFfaElo', () => {
    it('should return [] for fewer than 2 players', () => {
      const result = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 10 },
      ]);
      expect(result).toEqual([]);
    });

    it('should return [] for empty array', () => {
      expect(calculateFfaElo([])).toEqual([]);
    });

    it('should give winner positive delta in 2-player game', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 10 },
        { userId: 2, placement: 2, currentElo: 1000, matchesPlayed: 10 },
      ]);

      expect(results).toHaveLength(2);
      const winner = results.find((r) => r.userId === 1)!;
      const loser = results.find((r) => r.userId === 2)!;

      expect(winner.delta).toBeGreaterThan(0);
      expect(loser.delta).toBeLessThan(0);
    });

    it('should preserve oldElo correctly', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1200, matchesPlayed: 5 },
        { userId: 2, placement: 2, currentElo: 800, matchesPlayed: 5 },
      ]);

      const p1 = results.find((r) => r.userId === 1)!;
      const p2 = results.find((r) => r.userId === 2)!;

      expect(p1.oldElo).toBe(1200);
      expect(p2.oldElo).toBe(800);
    });

    it('should compute newElo as oldElo + delta', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 10 },
        { userId: 2, placement: 2, currentElo: 1000, matchesPlayed: 10 },
      ]);

      for (const r of results) {
        expect(r.newElo).toBe(r.oldElo + r.delta);
      }
    });

    it('should give 1st place the most gain in 4-player game', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 10 },
        { userId: 2, placement: 2, currentElo: 1000, matchesPlayed: 10 },
        { userId: 3, placement: 3, currentElo: 1000, matchesPlayed: 10 },
        { userId: 4, placement: 4, currentElo: 1000, matchesPlayed: 10 },
      ]);

      expect(results).toHaveLength(4);

      const sorted = [...results].sort((a, b) => a.delta - b.delta);
      // 1st place should have highest delta
      expect(sorted[sorted.length - 1].userId).toBe(1);
      // Last place should have lowest delta
      expect(sorted[0].userId).toBe(4);
    });

    it('should give last place the most loss in 4-player game', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 10 },
        { userId: 2, placement: 2, currentElo: 1000, matchesPlayed: 10 },
        { userId: 3, placement: 3, currentElo: 1000, matchesPlayed: 10 },
        { userId: 4, placement: 4, currentElo: 1000, matchesPlayed: 10 },
      ]);

      const last = results.find((r) => r.userId === 4)!;
      expect(last.delta).toBeLessThan(0);

      // Last place loses more than 2nd or 3rd
      const second = results.find((r) => r.userId === 2)!;
      const third = results.find((r) => r.userId === 3)!;
      expect(last.delta).toBeLessThan(third.delta);
      expect(last.delta).toBeLessThan(second.delta);
    });

    it('should floor elo at 0 (never go negative)', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1500, matchesPlayed: 10 },
        { userId: 2, placement: 2, currentElo: 5, matchesPlayed: 10 },
      ]);

      const loser = results.find((r) => r.userId === 2)!;
      expect(loser.newElo).toBeGreaterThanOrEqual(0);
    });

    it('should floor elo at 0 for player with 0 elo losing', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 10 },
        { userId: 2, placement: 2, currentElo: 0, matchesPlayed: 10 },
      ]);

      const loser = results.find((r) => r.userId === 2)!;
      expect(loser.newElo).toBe(0);
      // delta is adjusted to reflect the floor
      expect(loser.delta).toBe(0);
    });

    it('should use higher K factor for newer players', () => {
      // New player (K=32) vs veteran (K=16), equal elo, both win/lose equally
      const resultsNewWins = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 5 },
        { userId: 2, placement: 2, currentElo: 1000, matchesPlayed: 50 },
      ]);

      const newPlayer = resultsNewWins.find((r) => r.userId === 1)!;
      const veteran = resultsNewWins.find((r) => r.userId === 2)!;

      // New player gains more than veteran loses (different K factors)
      expect(Math.abs(newPlayer.delta)).toBeGreaterThan(Math.abs(veteran.delta));
    });

    it('should handle tied placements as draws', () => {
      const results = calculateFfaElo([
        { userId: 1, placement: 1, currentElo: 1000, matchesPlayed: 10 },
        { userId: 2, placement: 1, currentElo: 1000, matchesPlayed: 10 },
      ]);

      // Equal rating + draw = 0 delta
      const p1 = results.find((r) => r.userId === 1)!;
      const p2 = results.find((r) => r.userId === 2)!;
      expect(p1.delta).toBe(0);
      expect(p2.delta).toBe(0);
    });
  });

  // ── calculateTeamElo ───────────────────────────────────────────────

  describe('calculateTeamElo', () => {
    it('should return [] when winners array is empty', () => {
      expect(
        calculateTeamElo([], [{ userId: 2, currentElo: 1000, matchesPlayed: 10 }]),
      ).toEqual([]);
    });

    it('should return [] when losers array is empty', () => {
      expect(
        calculateTeamElo([{ userId: 1, currentElo: 1000, matchesPlayed: 10 }], []),
      ).toEqual([]);
    });

    it('should return [] when both arrays are empty', () => {
      expect(calculateTeamElo([], [])).toEqual([]);
    });

    it('should give winners positive delta and losers negative delta', () => {
      const results = calculateTeamElo(
        [{ userId: 1, currentElo: 1000, matchesPlayed: 10 }],
        [{ userId: 2, currentElo: 1000, matchesPlayed: 10 }],
      );

      expect(results).toHaveLength(2);

      const winner = results.find((r) => r.userId === 1)!;
      const loser = results.find((r) => r.userId === 2)!;

      expect(winner.delta).toBeGreaterThan(0);
      expect(loser.delta).toBeLessThan(0);
    });

    it('should preserve oldElo for all players', () => {
      const results = calculateTeamElo(
        [
          { userId: 1, currentElo: 1100, matchesPlayed: 20 },
          { userId: 2, currentElo: 900, matchesPlayed: 20 },
        ],
        [
          { userId: 3, currentElo: 1050, matchesPlayed: 20 },
          { userId: 4, currentElo: 950, matchesPlayed: 20 },
        ],
      );

      expect(results.find((r) => r.userId === 1)!.oldElo).toBe(1100);
      expect(results.find((r) => r.userId === 2)!.oldElo).toBe(900);
      expect(results.find((r) => r.userId === 3)!.oldElo).toBe(1050);
      expect(results.find((r) => r.userId === 4)!.oldElo).toBe(950);
    });

    it('should compute newElo as oldElo + delta', () => {
      const results = calculateTeamElo(
        [{ userId: 1, currentElo: 1000, matchesPlayed: 10 }],
        [{ userId: 2, currentElo: 1000, matchesPlayed: 10 }],
      );

      for (const r of results) {
        expect(r.newElo).toBe(r.oldElo + r.delta);
      }
    });

    it('should give less gain when higher rated team wins', () => {
      // Strong team beats weak team — expected, so less elo change
      const resultsExpected = calculateTeamElo(
        [{ userId: 1, currentElo: 1400, matchesPlayed: 10 }],
        [{ userId: 2, currentElo: 1000, matchesPlayed: 10 }],
      );

      // Weak team beats strong team — upset, so more elo change
      const resultsUpset = calculateTeamElo(
        [{ userId: 3, currentElo: 1000, matchesPlayed: 10 }],
        [{ userId: 4, currentElo: 1400, matchesPlayed: 10 }],
      );

      const expectedWinnerDelta = resultsExpected.find((r) => r.userId === 1)!.delta;
      const upsetWinnerDelta = resultsUpset.find((r) => r.userId === 3)!.delta;

      expect(upsetWinnerDelta).toBeGreaterThan(expectedWinnerDelta);
    });

    it('should handle multi-player teams', () => {
      const results = calculateTeamElo(
        [
          { userId: 1, currentElo: 1000, matchesPlayed: 10 },
          { userId: 2, currentElo: 1000, matchesPlayed: 10 },
        ],
        [
          { userId: 3, currentElo: 1000, matchesPlayed: 10 },
          { userId: 4, currentElo: 1000, matchesPlayed: 10 },
        ],
      );

      expect(results).toHaveLength(4);

      const winners = results.filter((r) => r.userId <= 2);
      const losers = results.filter((r) => r.userId >= 3);

      winners.forEach((w) => expect(w.delta).toBeGreaterThan(0));
      losers.forEach((l) => expect(l.delta).toBeLessThan(0));
    });

    it('should floor elo at 0 for losers', () => {
      const results = calculateTeamElo(
        [{ userId: 1, currentElo: 1500, matchesPlayed: 10 }],
        [{ userId: 2, currentElo: 0, matchesPlayed: 10 }],
      );

      const loser = results.find((r) => r.userId === 2)!;
      expect(loser.newElo).toBeGreaterThanOrEqual(0);
    });
  });

  // ── processMatchElo ────────────────────────────────────────────────

  describe('processMatchElo', () => {
    it('should filter out bots (negative IDs) and return [] if fewer than 2 humans', async () => {
      const players = [
        { userId: 1, placement: 1, team: null, isWinner: true },
        { userId: -1, placement: 2, team: null, isWinner: false },
        { userId: -2, placement: 3, team: null, isWinner: false },
      ];

      const results = await processMatchElo('ffa', players, 100);

      expect(results).toEqual([]);
      // Should not query DB at all
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should return [] when all players are bots', async () => {
      const players = [
        { userId: -1, placement: 1, team: null, isWinner: true },
        { userId: -2, placement: 2, team: null, isWinner: false },
      ];

      const results = await processMatchElo('ffa', players, 100);

      expect(results).toEqual([]);
    });

    it('should return [] for a single human player', async () => {
      const players = [{ userId: 1, placement: 1, team: null, isWinner: true }];

      const results = await processMatchElo('ffa', players, 100);

      expect(results).toEqual([]);
    });

    it('should fetch elo from DB and call FFA calc for non-teams mode', async () => {
      // First query: fetch user_stats
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1000, matches_played: 10 },
          { user_id: 2, elo_rating: 1000, matches_played: 10 },
        ])
        // Second query: getActiveSeason
        .mockResolvedValueOnce([]);

      const players = [
        { userId: 1, placement: 1, team: null, isWinner: true },
        { userId: 2, placement: 2, team: null, isWinner: false },
      ];

      const results = await processMatchElo('ffa', players, 100);

      expect(results).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT user_id, elo_rating'),
        [1, 2],
      );

      const winner = results.find((r) => r.userId === 1)!;
      const loser = results.find((r) => r.userId === 2)!;
      expect(winner.delta).toBeGreaterThan(0);
      expect(loser.delta).toBeLessThan(0);
    });

    it('should call team calc for teams mode', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1000, matches_played: 10 },
          { user_id: 2, elo_rating: 1000, matches_played: 10 },
        ])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: 0, isWinner: true },
        { userId: 2, placement: 2, team: 1, isWinner: false },
      ];

      const results = await processMatchElo('teams', players, 100);

      expect(results).toHaveLength(2);

      const winner = results.find((r) => r.userId === 1)!;
      const loser = results.find((r) => r.userId === 2)!;
      expect(winner.delta).toBeGreaterThan(0);
      expect(loser.delta).toBeLessThan(0);
    });

    it('should use team mode splitting by winner team', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1200, matches_played: 20 },
          { user_id: 2, elo_rating: 1100, matches_played: 15 },
          { user_id: 3, elo_rating: 1000, matches_played: 10 },
          { user_id: 4, elo_rating: 900, matches_played: 5 },
        ])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: 0, isWinner: true },
        { userId: 2, placement: 1, team: 0, isWinner: true },
        { userId: 3, placement: 2, team: 1, isWinner: false },
        { userId: 4, placement: 2, team: 1, isWinner: false },
      ];

      const results = await processMatchElo('teams', players, 200);

      expect(results).toHaveLength(4);

      // Team 0 (winners) should gain
      const t0p1 = results.find((r) => r.userId === 1)!;
      const t0p2 = results.find((r) => r.userId === 2)!;
      expect(t0p1.delta).toBeGreaterThan(0);
      expect(t0p2.delta).toBeGreaterThan(0);

      // Team 1 (losers) should lose
      const t1p1 = results.find((r) => r.userId === 3)!;
      const t1p2 = results.find((r) => r.userId === 4)!;
      expect(t1p1.delta).toBeLessThan(0);
      expect(t1p2.delta).toBeLessThan(0);
    });

    it('should return [] in teams mode when no winner found', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1000, matches_played: 10 },
          { user_id: 2, elo_rating: 1000, matches_played: 10 },
        ])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: 0, isWinner: false },
        { userId: 2, placement: 2, team: 1, isWinner: false },
      ];

      const results = await processMatchElo('teams', players, 100);

      expect(results).toEqual([]);
    });

    it('should use FFA calc for battle_royale mode', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1100, matches_played: 20 },
          { user_id: 2, elo_rating: 900, matches_played: 20 },
        ])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: null, isWinner: true },
        { userId: 2, placement: 2, team: null, isWinner: false },
      ];

      const results = await processMatchElo('battle_royale', players, 100);

      expect(results).toHaveLength(2);
    });

    it('should use FFA calc for deathmatch mode', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1000, matches_played: 10 },
          { user_id: 2, elo_rating: 1000, matches_played: 10 },
        ])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: null, isWinner: true },
        { userId: 2, placement: 2, team: null, isWinner: false },
      ];

      const results = await processMatchElo('deathmatch', players, 100);

      expect(results).toHaveLength(2);
    });

    it('should default to 1000 elo for players not found in DB', async () => {
      // Only return data for user 1, user 2 is missing from DB
      mockQuery
        .mockResolvedValueOnce([{ user_id: 1, elo_rating: 1200, matches_played: 40 }])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: null, isWinner: true },
        { userId: 2, placement: 2, team: null, isWinner: false },
      ];

      const results = await processMatchElo('ffa', players, 100);

      expect(results).toHaveLength(2);
      const p2 = results.find((r) => r.userId === 2)!;
      // oldElo should be the default 1000
      expect(p2.oldElo).toBe(1000);
    });

    it('should call withTransaction to apply results', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1000, matches_played: 10 },
          { user_id: 2, elo_rating: 1000, matches_played: 10 },
        ])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: null, isWinner: true },
        { userId: 2, placement: 2, team: null, isWinner: false },
      ];

      await processMatchElo('ffa', players, 100);

      expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    });

    it('should filter bots but process remaining humans', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { user_id: 1, elo_rating: 1000, matches_played: 10 },
          { user_id: 2, elo_rating: 1000, matches_played: 10 },
        ])
        .mockResolvedValueOnce([]); // getActiveSeason

      const players = [
        { userId: 1, placement: 1, team: null, isWinner: true },
        { userId: -1, placement: 2, team: null, isWinner: false },
        { userId: 2, placement: 3, team: null, isWinner: false },
        { userId: -2, placement: 4, team: null, isWinner: false },
      ];

      const results = await processMatchElo('ffa', players, 100);

      // Only 2 humans processed
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.userId > 0)).toBe(true);

      // DB query should only contain human IDs
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('user_id IN'), [1, 2]);
    });
  });
});
