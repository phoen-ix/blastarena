import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: jest.fn(),
}));

import { canUserPlayMap } from '../../../backend/src/services/custom-maps';

describe('custom map access control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * GET /maps/:id allows "owner, or published". The socket paths that resolve a map for a room —
   * room:create for the display name, room:start for the tiles — enforced nothing, so any user
   * could point a room's customMapId at someone else's UNPUBLISHED map and play it.
   * (audit CUSTOMMAP-AUTHZ-1)
   */
  it('allows the owner to play their own unpublished map', async () => {
    mockQuery.mockResolvedValue([{ created_by: 7, is_published: 0 }]);
    expect(await canUserPlayMap(1, 7)).toBe(true);
  });

  it('refuses another user an unpublished map', async () => {
    mockQuery.mockResolvedValue([{ created_by: 7, is_published: 0 }]);
    expect(await canUserPlayMap(1, 8)).toBe(false);
  });

  it('allows anyone a published map', async () => {
    mockQuery.mockResolvedValue([{ created_by: 7, is_published: 1 }]);
    expect(await canUserPlayMap(1, 8)).toBe(true);
  });

  it('refuses a map that does not exist', async () => {
    mockQuery.mockResolvedValue([]);
    expect(await canUserPlayMap(999, 7)).toBe(false);
  });
});

describe('refresh token reaping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Rows were inserted on every login and every rotation and only ever flagged revoked — nothing
  // removed them, despite idx_refresh_tokens_expires existing for the job.
  // (audit REFRESH-TOKEN-REAP-1)
  it('deletes rows that are expired or revoked', async () => {
    mockExecute.mockResolvedValue({ affectedRows: 12 });
    const { cleanupExpiredRefreshTokens } = await import('../../../backend/src/services/auth');

    const removed = await cleanupExpiredRefreshTokens();

    expect(removed).toBe(12);
    const sql = String(mockExecute.mock.calls[0][0]);
    expect(sql).toContain('DELETE FROM refresh_tokens');
    expect(sql).toContain('expires_at < NOW()');
    expect(sql).toContain('revoked = TRUE');
  });

  it('reports zero when the driver omits affectedRows', async () => {
    mockExecute.mockResolvedValue({});
    const { cleanupExpiredRefreshTokens } = await import('../../../backend/src/services/auth');
    expect(await cleanupExpiredRefreshTokens()).toBe(0);
  });
});
