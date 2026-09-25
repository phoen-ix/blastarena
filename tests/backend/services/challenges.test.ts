import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();
// Transaction connection: mysql2 promise shape, `[rows, fields]`
const mockConnExecute = jest.fn<(...args: any[]) => Promise<any>>();
const mockWithTransaction = jest.fn<(...args: any[]) => Promise<any>>(async (fn) =>
  fn({ execute: mockConnExecute }),
);
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: mockWithTransaction,
}));

import {
  activateChallenge,
  createChallenge,
  deactivateChallenge,
  deleteChallenge,
  updateChallenge,
} from '../../../backend/src/services/challenges';

beforeEach(() => {
  mockQuery.mockReset();
  mockExecute.mockReset();
  mockConnExecute.mockReset();
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
