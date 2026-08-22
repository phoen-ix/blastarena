import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * Replays had no retention policy at all: one gzipped file per finished match, forever, removed
 * only by an explicit admin delete, on a bind mount with no Docker-level rotation. Game logs
 * already had an age+size bound; this mirrors it. (audit REPLAY-RETENTION-1)
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MB = 1024 * 1024;

let tmpDir: string;

function seed(dir: string, name: string, ageMs: number, sizeBytes: number): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x'.repeat(sizeBytes));
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

const exists = (name: string) => fs.existsSync(path.join(tmpDir, name));

// Bounds are read from env at module load, and the once-per-hour throttle is module state, so
// each case re-imports the module with the values it needs.
const loadWith = async (env: Record<string, string>) => {
  jest.resetModules();
  Object.assign(process.env, env);
  const mod = await import('../../../backend/src/utils/replayRecorder');
  return mod.pruneOldReplays;
};

describe('pruneOldReplays', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replayprune-test-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('deletes replays past the age limit and keeps newer ones', async () => {
    seed(tmpDir, '1_old_ffa.replay.json.gz', 5 * DAY_MS, 1024);
    seed(tmpDir, '2_new_ffa.replay.json.gz', 2 * HOUR_MS, 1024);

    const prune = await loadWith({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '4096' });
    await prune(tmpDir);

    expect(exists('1_old_ffa.replay.json.gz')).toBe(false);
    expect(exists('2_new_ffa.replay.json.gz')).toBe(true);
  });

  it('trims oldest-first until the directory is under the size limit', async () => {
    seed(tmpDir, '1_a_ffa.replay.json.gz', 5 * HOUR_MS, 2 * MB);
    seed(tmpDir, '2_b_ffa.replay.json.gz', 4 * HOUR_MS, 2 * MB);
    seed(tmpDir, '3_c_ffa.replay.json.gz', 3 * HOUR_MS, 2 * MB);

    const prune = await loadWith({ REPLAY_MAX_AGE_DAYS: '3650', REPLAY_MAX_TOTAL_MB: '5' });
    await prune(tmpDir);

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

    const prune = await loadWith({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '1' });
    await prune(tmpDir);

    expect(exists('campaign_sess-abc.replay.json.gz')).toBe(true);
    expect(exists('1_match_ffa.replay.json.gz')).toBe(false);
  });

  it('never deletes a file written inside the prune interval, however small the limits', async () => {
    seed(tmpDir, '1_fresh_ffa.replay.json.gz', 0, 10 * MB);

    const prune = await loadWith({ REPLAY_MAX_AGE_DAYS: '0', REPLAY_MAX_TOTAL_MB: '0' });
    await prune(tmpDir);

    expect(exists('1_fresh_ffa.replay.json.gz')).toBe(true);
  });

  it('ignores files that are not replays', async () => {
    seed(tmpDir, 'notes.txt', 900 * DAY_MS, 1024);
    seed(tmpDir, '1_match_ffa.replay.json.gz', 900 * DAY_MS, 1024);

    const prune = await loadWith({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '4096' });
    await prune(tmpDir);

    expect(exists('notes.txt')).toBe(true);
    expect(exists('1_match_ffa.replay.json.gz')).toBe(false);
  });

  it('is throttled to once per interval', async () => {
    seed(tmpDir, '1_old_ffa.replay.json.gz', 5 * DAY_MS, 1024);
    const prune = await loadWith({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '4096' });
    await prune(tmpDir);
    expect(exists('1_old_ffa.replay.json.gz')).toBe(false);

    // A second call in the same window must not even read the directory again.
    seed(tmpDir, '2_also_old_ffa.replay.json.gz', 5 * DAY_MS, 1024);
    await prune(tmpDir);
    expect(exists('2_also_old_ffa.replay.json.gz')).toBe(true);
  });

  it('does not throw when the directory is missing', async () => {
    const prune = await loadWith({ REPLAY_MAX_AGE_DAYS: '1', REPLAY_MAX_TOTAL_MB: '1' });
    await expect(prune(path.join(tmpDir, 'nope'))).resolves.toBeUndefined();
  });
});
