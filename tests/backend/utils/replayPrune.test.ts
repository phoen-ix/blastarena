import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pruneOldReplays } from '../../../backend/src/utils/replayRecorder';

/**
 * Replays had no retention policy at all: one gzipped file per finished match, forever, removed
 * only by an explicit admin delete, on a bind mount with no Docker-level rotation. Game logs
 * already had an age+size bound; this mirrors it. (audit REPLAY-RETENTION-1)
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MB = 1024 * 1024;

let tmpDir: string;

// A fake clock: each case starts two hours after the last, so the once-per-hour throttle (module
// state) never carries over and the module is imported only once.
let now = Date.UTC(2026, 0, 1);
const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now);

// Sparse files: stat reports the size, but nothing is written to disk.
function seed(dir: string, name: string, ageMs: number, sizeBytes: number): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '');
  fs.truncateSync(file, sizeBytes);
  const when = new Date(now - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

const exists = (name: string) => fs.existsSync(path.join(tmpDir, name));

describe('pruneOldReplays', () => {
  const originalEnv = { ...process.env };

  const prune = (env: Record<string, string>, dir = tmpDir) => {
    Object.assign(process.env, env);
    return pruneOldReplays(dir);
  };

  beforeEach(() => {
    now += 2 * HOUR_MS;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replayprune-test-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => dateNow.mockRestore());

  it('deletes replays past the age limit and keeps newer ones', async () => {
    seed(tmpDir, '1_old_ffa.replay.json.gz', 5 * DAY_MS, 1024);
    seed(tmpDir, '2_new_ffa.replay.json.gz', 2 * HOUR_MS, 1024);

    await prune({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '4096' });

    expect(exists('1_old_ffa.replay.json.gz')).toBe(false);
    expect(exists('2_new_ffa.replay.json.gz')).toBe(true);
  });

  it('trims oldest-first until the directory is under the size limit', async () => {
    seed(tmpDir, '1_a_ffa.replay.json.gz', 5 * HOUR_MS, 2 * MB);
    seed(tmpDir, '2_b_ffa.replay.json.gz', 4 * HOUR_MS, 2 * MB);
    seed(tmpDir, '3_c_ffa.replay.json.gz', 3 * HOUR_MS, 2 * MB);

    await prune({ REPLAY_MAX_AGE_DAYS: '3650', REPLAY_MAX_TOTAL_MB: '5' });

    // 6 MB against a 5 MB budget: drop the oldest, and stop as soon as it fits.
    expect(exists('1_a_ffa.replay.json.gz')).toBe(false);
    expect(exists('2_b_ffa.replay.json.gz')).toBe(true);
    expect(exists('3_c_ffa.replay.json.gz')).toBe(true);
  });

  // Campaign replays are referenced by rows in campaign_replays and shown in the admin UI, so
  // deleting the file behind a live row would leave a broken entry.
  it('never auto-deletes campaign replays, however old or large', async () => {
    seed(tmpDir, 'campaign_sess-abc.replay.json.gz', 900 * DAY_MS, 50 * MB);
    seed(tmpDir, '1_match_ffa.replay.json.gz', 900 * DAY_MS, 1024);

    await prune({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '1' });

    expect(exists('campaign_sess-abc.replay.json.gz')).toBe(true);
    expect(exists('1_match_ffa.replay.json.gz')).toBe(false);
  });

  it('never deletes a file written inside the prune interval, however small the limits', async () => {
    seed(tmpDir, '1_fresh_ffa.replay.json.gz', 0, 10 * MB);

    await prune({ REPLAY_MAX_AGE_DAYS: '0', REPLAY_MAX_TOTAL_MB: '0' });

    expect(exists('1_fresh_ffa.replay.json.gz')).toBe(true);
  });

  it('ignores files that are not replays', async () => {
    seed(tmpDir, 'notes.txt', 900 * DAY_MS, 1024);
    seed(tmpDir, '1_match_ffa.replay.json.gz', 900 * DAY_MS, 1024);

    await prune({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '4096' });

    expect(exists('notes.txt')).toBe(true);
    expect(exists('1_match_ffa.replay.json.gz')).toBe(false);
  });

  it('is throttled to once per interval', async () => {
    seed(tmpDir, '1_old_ffa.replay.json.gz', 5 * DAY_MS, 1024);
    await prune({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '4096' });
    expect(exists('1_old_ffa.replay.json.gz')).toBe(false);

    // A second call in the same window must not even read the directory again.
    seed(tmpDir, '2_also_old_ffa.replay.json.gz', 5 * DAY_MS, 1024);
    await prune({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '4096' });
    expect(exists('2_also_old_ffa.replay.json.gz')).toBe(true);
  });

  it('does not throw when the directory is missing', async () => {
    await expect(
      prune({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '1' }, path.join(tmpDir, 'nope')),
    ).resolves.toBeUndefined();
  });
});
