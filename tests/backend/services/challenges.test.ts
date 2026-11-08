import { describe, it, expect, vi, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockQuery = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>());
const mockExecute = vi.hoisted(() => vi.fn<(...args: any[]) => Promise<any>>());
// Transaction connection: mysql2 promise shape, `[rows, fields]`
const mockConnExecute = vi.fn<(...args: any[]) => Promise<any>>();
const mockWithTransaction = vi.hoisted(() =>
  vi.fn<(...args: any[]) => Promise<any>>(async (fn) => fn({ execute: mockConnExecute })),
);
vi.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: mockWithTransaction,
}));

const mockGetSetting = vi.hoisted(() => vi.fn<(key: string) => Promise<string | null>>());
vi.mock('../../../backend/src/services/settings', () => ({ getSetting: mockGetSetting }));

import {
  activateChallenge,
  createChallenge,
  deactivateChallenge,
  deleteChallenge,
  recordChallengeResult,
  updateChallenge,
} from '../../../backend/src/services/challenges';

beforeEach(() => {
  mockQuery.mockReset();
  mockExecute.mockReset();
  mockConnExecute.mockReset();
  mockGetSetting.mockReset().mockResolvedValue('true');
});

describe('challenge admin service', () => {
  it('activating an unknown id changes nothing and answers 404', async () => {
    // It used to switch the active challenge off and nothing on, answering 200.
    mockConnExecute.mockResolvedValueOnce([[], []]);
    await expect(activateChallenge(99)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockConnExecute).toHaveBeenCalledTimes(1);
    expect(mockConnExecute.mock.calls[0][0]).toContain('SELECT');
  });

  it('activating a known id switches the others off and this one on', async () => {
    mockConnExecute.mockResolvedValueOnce([[{ id: 3 }], []]).mockResolvedValue([{}, []]);
    await activateChallenge(3);
    expect(mockConnExecute.mock.calls.map((c) => c[0])).toEqual([
      'SELECT id FROM map_challenges WHERE id = ? FOR UPDATE',
      'UPDATE map_challenges SET is_active = FALSE',
      'UPDATE map_challenges SET is_active = TRUE WHERE id = ?',
    ]);
  });

  it('applies a new map on update, once the map is published', async () => {
    // The map id was validated by the route and then dropped by the service.
    mockQuery
      .mockResolvedValueOnce([
        { start_date: new Date('2026-10-01'), end_date: new Date('2026-10-08') },
      ])
      .mockResolvedValueOnce([{ is_published: 1 }]);
    mockExecute.mockResolvedValue({ affectedRows: 1 });

    await updateChallenge(4, { customMapId: 12 });
    expect(mockExecute).toHaveBeenCalledWith(
      'UPDATE map_challenges SET custom_map_id = ? WHERE id = ?',
      [12, 4],
    );
  });

  it('checks a partial date change against the stored other end', async () => {
    mockQuery.mockResolvedValueOnce([
      { start_date: new Date('2026-10-01'), end_date: new Date('2026-10-08') },
    ]);
    await expect(updateChallenge(4, { startDate: '2026-10-10' })).rejects.toMatchObject({
      code: 'INVALID_DATE_RANGE',
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('updating an unknown id answers 404', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(updateChallenge(4, { title: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('refuses a map that does not exist or is not published (it used to be a 500)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(
      createChallenge('t', '', 7, 'ffa', '2026-10-01', '2026-10-08', 1),
    ).rejects.toMatchObject({ statusCode: 400, code: 'MAP_NOT_FOUND' });

    mockQuery.mockResolvedValueOnce([{ is_published: 0 }]);
    await expect(
      createChallenge('t', '', 7, 'ffa', '2026-10-01', '2026-10-08', 1),
    ).rejects.toMatchObject({ statusCode: 400, code: 'MAP_NOT_PUBLISHED' });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('delete and deactivate answer 404 for an unknown id', async () => {
    mockExecute.mockResolvedValueOnce({ affectedRows: 0 });
    await expect(deleteChallenge(5)).rejects.toMatchObject({ statusCode: 404 });

    mockQuery.mockResolvedValueOnce([]);
    await expect(deactivateChallenge(5)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockExecute).toHaveBeenCalledTimes(1); // only the DELETE above
  });
});

describe('recordChallengeResult', () => {
  it('only records for an active challenge, inside its dates, in its game mode', async () => {
    // The challenge's mode and dates were ignored: every match on the map counted, any time
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    await recordChallengeResult(3, 7, true, 2, 1, 1, { gameMode: 'teams' });

    const [sql, params] = mockExecute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO challenge_scores[\s\S]*SELECT[\s\S]*FROM map_challenges mc/);
    expect(sql).toContain('mc.is_active = TRUE');
    expect(sql).toContain('? BETWEEN mc.start_date AND mc.end_date');
    expect(sql).toContain('(? IS NULL OR mc.game_mode = ?)');
    const today = new Date().toISOString().slice(0, 10);
    expect(params).toEqual([7, 1, 2, 1, 1, 3, today, 'teams', 'teams']);
  });

  it('without a game mode the mode is not checked', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    await recordChallengeResult(3, 7, false, 0, 1, 2);
    expect(mockExecute.mock.calls[0][1].slice(-2)).toEqual([null, null]);
  });

  it('records nothing while challenges are disabled', async () => {
    mockGetSetting.mockResolvedValue('false');
    await recordChallengeResult(3, 7, true, 2, 1, 1, { gameMode: 'ffa' });
    expect(mockGetSetting).toHaveBeenCalledWith('challenges_enabled');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('a placement of 0 or none is not a best placement', async () => {
    // GameRoom's `placement || 0` made 0 everyone's best placement
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    await recordChallengeResult(3, 7, false, 0, 1, 0);
    await recordChallengeResult(3, 7, false, 0, 1, null);
    for (const [sql, params] of mockExecute.mock.calls) {
      expect(params[4]).toBeNull();
      // and a NULL leaves the stored best as it was
      expect(sql).toContain('WHEN VALUES(best_placement) IS NULL THEN best_placement');
    }
  });

  it('never writes a bot id', async () => {
    await recordChallengeResult(3, -1, true, 2, 1, 1);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
