import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

// Mock the DB pool so we can drive rollbackMigration's pre-flight queries.
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  getPool: () => ({ execute: mockExecute }),
}));

import { rollbackMigration } from '../../../backend/src/db/migrations/runner';

describe('rollbackMigration irreversible guard (audit DMIG-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 1st execute: CREATE TABLE IF NOT EXISTS _migrations. 2nd: SELECT last N applied migrations.
    mockExecute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ name: '030_finalize_email_hashing.sql' }]]);
  });

  it('refuses to roll back the irreversible email migration without force', async () => {
    await expect(rollbackMigration(1)).rejects.toThrow(/irreversible migration/i);
    // Guard fires before any down SQL runs: only the CREATE TABLE + SELECT executed.
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});
