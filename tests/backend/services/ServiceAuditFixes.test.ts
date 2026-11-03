import { describe, it, expect, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = vi.hoisted(() => vi.fn<AnyFn>());
const mockExecute = vi.hoisted(() => vi.fn<AnyFn>());
vi.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
  withTransaction: vi.fn(),
}));

import { canUserPlayMap } from '../../../backend/src/services/custom-maps';
import { cleanupExpiredRefreshTokens } from '../../../backend/src/services/auth';

describe('custom map access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.clearAllMocks();
  });

  // Rows were inserted on every login and every rotation and only ever flagged revoked — nothing
  // removed them, despite idx_refresh_tokens_expires existing for the job.
  // (audit REFRESH-TOKEN-REAP-1)
  // Two indexed predicates, each deleted in bounded chunks, instead of one `expires_at < NOW()
  // OR revoked = TRUE` full scan. The chunk loop itself is covered in auth-refresh-reaper.test.ts.
  // (audit E8)
  it('deletes expired rows and stale revoked rows as two indexed deletes', async () => {
    mockExecute
      .mockResolvedValueOnce({ affectedRows: 12 })
      .mockResolvedValueOnce({ affectedRows: 3 });

    const removed = await cleanupExpiredRefreshTokens();

    expect(removed).toBe(15);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    const expiredSql = String(mockExecute.mock.calls[0][0]);
    expect(expiredSql).toContain('DELETE FROM refresh_tokens');
    expect(expiredSql).toContain('expires_at < NOW()');
    expect(expiredSql).not.toContain(' OR ');
    const revokedSql = String(mockExecute.mock.calls[1][0]);
    expect(revokedSql).toContain('revoked = TRUE AND created_at <');
    expect(revokedSql).not.toContain(' OR ');
  });

  it('reports zero when the driver omits affectedRows', async () => {
    mockExecute.mockResolvedValue({});
    expect(await cleanupExpiredRefreshTokens()).toBe(0);
  });
});
