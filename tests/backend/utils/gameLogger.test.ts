import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { GameLogger } from '../../../backend/src/utils/gameLogger';
import type { Player } from '../../../backend/src/game/Player';
import type { Bomb } from '../../../backend/src/game/Bomb';
import type { Explosion } from '../../../backend/src/game/Explosion';

// GameLogger reads its bounds from env at module load, so the prune tests re-import the module
// with different values rather than mutating constants.
type LoadedModule = typeof import('../../../backend/src/utils/gameLogger');

// pruneOldLogs and its throttle are private statics; expose them without reaching for `any`.
interface PrunableGameLogger {
  pruneOldLogs(logDir: string): Promise<void>;
  lastPruneAt: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let tmpDir: string;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gamelogger-test-'));
}

const player = (id: number): Player =>
  ({
    id,
    username: `p${id}`,
    position: { x: 1, y: 1 },
    alive: true,
    kills: 0,
    selfKills: 0,
    direction: 'down',
    hasShield: false,
    hasKick: false,
    fireRange: 2,
    speed: 1,
    moveCooldown: 0,
  }) as unknown as Player;

const bomb = (): Bomb =>
  ({
    id: 'bomb-0001-abcd',
    position: { x: 2, y: 2 },
    ownerId: 1,
    ticksRemaining: 30,
    sliding: false,
  }) as unknown as Bomb;

const explosion = (): Explosion =>
  ({
    id: 'expl-0001-abcd',
    ownerId: 1,
    ticksRemaining: 5,
    cells: [{ x: 2, y: 2 }],
  }) as unknown as Explosion;

/** Flush the write stream, then return every parsed JSONL record. */
async function readEntries(logger: GameLogger, dir: string): Promise<Record<string, unknown>[]> {
  await logger.close();
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.jsonl'));
  if (!file) return [];
  return fs
    .readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const countTicks = (entries: Record<string, unknown>[]): number =>
  entries.filter((e) => e.event === 'tick').length;

/**
 * Poll until `predicate` holds. Used instead of a fixed sleep for things the logger does
 * asynchronously — opening its write stream, in particular — so the test is bounded by the work
 * actually finishing rather than by a guess at how long a loaded machine needs.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met within timeout');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Create a .jsonl of roughly `sizeBytes`, backdated so the prune mtime guard does not skip it. */
function seedLog(dir: string, name: string, ageMs: number, sizeBytes: number): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x'.repeat(sizeBytes));
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

/**
 * Every logger a test creates, so teardown can wait for each one's stream to actually close.
 *
 * Write streams flush asynchronously. Removing tmpDir while one is still open makes it ENOENT —
 * and because Jest runs several test FILES per worker process, that error surfaced in whichever
 * suite ran next in the same worker, not here. This suite was the source of intermittent failures
 * in SimulationManager and isolated-ai-runner. It used to paper over the race with a 50ms sleep,
 * which is exactly as reliable as the machine is idle. close() is awaitable now, so teardown waits
 * for the real thing. (audit GAMELOG-CLOSE-1)
 */
let openLoggers: GameLogger[] = [];

function track(logger: GameLogger): GameLogger {
  openLoggers.push(logger);
  return logger;
}

describe('GameLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = makeTmpDir();
    openLoggers = [];
  });

  afterEach(async () => {
    await Promise.all(openLoggers.map((l) => l.close()));
    openLoggers = [];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('idle gating', () => {
    it('stops writing ticks once an empty room passes the idle window', async () => {
      const gl = track(new GameLogger('room', 'open_world', 0, { logDir: tmpDir }));

      for (let tick = 0; tick <= 200; tick++) {
        gl.logTick(tick, [], [], []);
      }

      const ticks = countTicks(await readEntries(gl, tmpDir));
      // Ticks 0..60 are recorded (the window), everything after is suppressed.
      expect(ticks).toBe(61);
      expect(ticks).toBeLessThan(201);
    });

    it('records the opening ticks of an empty room so game_init has context', async () => {
      const gl = track(new GameLogger('room', 'open_world', 0, { logDir: tmpDir }));

      for (let tick = 0; tick <= 10; tick++) {
        gl.logTick(tick, [], [], []);
      }

      const entries = await readEntries(gl, tmpDir);
      expect(entries[0].event).toBe('game_init');
      expect(countTicks(entries)).toBe(11);
    });

    it('resumes and keeps writing while players are present', async () => {
      const gl = track(new GameLogger('room', 'open_world', 0, { logDir: tmpDir }));

      for (let tick = 0; tick <= 200; tick++) gl.logTick(tick, [], [], []);
      for (let tick = 201; tick <= 260; tick++) gl.logTick(tick, [player(1)], [], []);

      // 61 from the opening window + 60 active ticks
      expect(countTicks(await readEntries(gl, tmpDir))).toBe(121);
    });

    it('treats a bomb with no players as activity', async () => {
      const gl = track(new GameLogger('room', 'open_world', 0, { logDir: tmpDir }));

      for (let tick = 0; tick <= 200; tick++) gl.logTick(tick, [], [], []);
      gl.logTick(201, [], [bomb()], []);

      expect(countTicks(await readEntries(gl, tmpDir))).toBe(62);
    });

    it('treats an explosion with no players as activity', async () => {
      const gl = track(new GameLogger('room', 'open_world', 0, { logDir: tmpDir }));

      for (let tick = 0; tick <= 200; tick++) gl.logTick(tick, [], [], []);
      gl.logTick(201, [], [], [explosion()]);

      expect(countTicks(await readEntries(gl, tmpDir))).toBe(62);
    });

    it('never suppresses ticks in a continuously active room', async () => {
      const gl = track(new GameLogger('room', 'ffa', 2, { logDir: tmpDir }));

      for (let tick = 0; tick <= 300; tick++) {
        gl.logTick(tick, [player(1), player(2)], [], []);
      }

      expect(countTicks(await readEntries(gl, tmpDir))).toBe(301);
    });
  });

  describe('shouldLogTick verbosity mapping', () => {
    it('is unchanged by the idle gate', () => {
      const full = track(new GameLogger('r', 'm', 0, { logDir: tmpDir, verbosity: 'full' }));
      const detailed = track(
        new GameLogger('r', 'm', 0, { logDir: tmpDir, verbosity: 'detailed' }),
      );
      const normal = track(new GameLogger('r', 'm', 0, { logDir: tmpDir, verbosity: 'normal' }));

      expect(full.shouldLogTick(1)).toBe(true);
      expect(full.shouldLogTick(7)).toBe(true);

      expect(detailed.shouldLogTick(2)).toBe(true);
      expect(detailed.shouldLogTick(3)).toBe(false);

      expect(normal.shouldLogTick(5)).toBe(true);
      expect(normal.shouldLogTick(6)).toBe(false);

      full.close();
      detailed.close();
      normal.close();
    });
  });

  describe('pruneOldLogs', () => {
    const loadWith = async (env: Record<string, string>): Promise<PrunableGameLogger> => {
      jest.resetModules();
      Object.assign(process.env, env);
      const mod: LoadedModule = await import('../../../backend/src/utils/gameLogger');
      const prunable = mod.GameLogger as unknown as PrunableGameLogger;
      prunable.lastPruneAt = 0; // defeat the once-per-hour throttle
      return prunable;
    };

    const originalEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('deletes logs past the age limit and keeps newer ones', async () => {
      seedLog(tmpDir, 'old_open_world_0p.jsonl', 5 * DAY_MS, 1024);
      seedLog(tmpDir, 'recent_open_world_0p.jsonl', 2 * HOUR_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '1', GAME_LOG_MAX_TOTAL_MB: '4096' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'old_open_world_0p.jsonl'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'recent_open_world_0p.jsonl'))).toBe(true);
    });

    it('never deletes a file modified inside the prune interval, however small the limits', async () => {
      seedLog(tmpDir, 'active_open_world_0p.jsonl', 0, 1024); // an open stream looks like this
      seedLog(tmpDir, 'stale_open_world_0p.jsonl', 5 * DAY_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '0', GAME_LOG_MAX_TOTAL_MB: '0' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'active_open_world_0p.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'stale_open_world_0p.jsonl'))).toBe(false);
    });

    it('trims oldest-first until the directory is under the size limit', async () => {
      const MB = 1024 * 1024;
      seedLog(tmpDir, 'a-oldest_open_world_0p.jsonl', 4 * HOUR_MS, MB);
      seedLog(tmpDir, 'b-middle_open_world_0p.jsonl', 3 * HOUR_MS, MB);
      seedLog(tmpDir, 'c-newest_open_world_0p.jsonl', 2 * HOUR_MS, MB);

      // 3 MB present, 2 MB allowed, age limit far away -> only the oldest should go.
      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '3650', GAME_LOG_MAX_TOTAL_MB: '2' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'a-oldest_open_world_0p.jsonl'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'b-middle_open_world_0p.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'c-newest_open_world_0p.jsonl'))).toBe(true);
    });

    it('ignores files that are not .jsonl', async () => {
      seedLog(tmpDir, 'keep.txt', 5 * DAY_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '0', GAME_LOG_MAX_TOTAL_MB: '0' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'keep.txt'))).toBe(true);
    });

    it('is throttled to once per interval', async () => {
      seedLog(tmpDir, 'stale_open_world_0p.jsonl', 5 * DAY_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '0', GAME_LOG_MAX_TOTAL_MB: '0' });
      GL.lastPruneAt = Date.now(); // pretend a prune just ran
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'stale_open_world_0p.jsonl'))).toBe(true);
    });

    it('does not throw when the directory is missing', async () => {
      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '1', GAME_LOG_MAX_TOTAL_MB: '1' });
      await expect(GL.pruneOldLogs(path.join(tmpDir, 'nope'))).resolves.toBeUndefined();
    });

    it('never deletes a log that recorded real players, however old or large', async () => {
      seedLog(tmpDir, 'ancient_ffa_4p.jsonl', 400 * DAY_MS, 4 * 1024 * 1024);
      seedLog(tmpDir, 'ancient_open_world_1p.jsonl', 400 * DAY_MS, 4 * 1024 * 1024);
      seedLog(tmpDir, 'ancient_open_world_0p.jsonl', 400 * DAY_MS, 4 * 1024 * 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '0', GAME_LOG_MAX_TOTAL_MB: '0' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'ancient_ffa_4p.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'ancient_open_world_1p.jsonl'))).toBe(true);
      // Only the empty-room log is disposable.
      expect(fs.existsSync(path.join(tmpDir, 'ancient_open_world_0p.jsonl'))).toBe(false);
    });

    // The size cap is a statement about the directory's footprint, so it is measured against
    // every log — including the ones we will never delete. Summing only the deletable subset
    // meant the cap was compared against a fraction of real usage, so once real-player logs
    // dominated the directory it could never trigger at all. Protected logs still count toward
    // the budget without ever becoming candidates. (audit GAMELOG-ACCOUNTING-1)
    it('counts every log toward the size limit, including protected ones', async () => {
      const MB = 1024 * 1024;
      seedLog(tmpDir, 'big_ffa_2p.jsonl', 4 * HOUR_MS, 10 * MB); // protected, but still counted
      seedLog(tmpDir, 'small_open_world_0p.jsonl', 3 * HOUR_MS, MB);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '3650', GAME_LOG_MAX_TOTAL_MB: '5' });
      await GL.pruneOldLogs(tmpDir);

      // 11 MB in the directory against a 5 MB budget: the disposable log is evicted...
      expect(fs.existsSync(path.join(tmpDir, 'small_open_world_0p.jsonl'))).toBe(false);
      // ...and the protected one is still never deleted, even though it is what blew the budget.
      expect(fs.existsSync(path.join(tmpDir, 'big_ffa_2p.jsonl'))).toBe(true);
    });

    it('leaves disposable logs alone while the directory is under the size limit', async () => {
      const MB = 1024 * 1024;
      seedLog(tmpDir, 'small_ffa_2p.jsonl', 4 * HOUR_MS, MB);
      seedLog(tmpDir, 'small_open_world_0p.jsonl', 3 * HOUR_MS, MB);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '3650', GAME_LOG_MAX_TOTAL_MB: '50' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'small_ffa_2p.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'small_open_world_0p.jsonl'))).toBe(true);
    });
  });

  describe('filename finalisation', () => {
    const filenames = (dir: string): string[] =>
      fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));

    it('rewrites the trailing count to the peak player count on close', async () => {
      const gl = track(new GameLogger('openworld_r1', 'open_world', 0, { logDir: tmpDir }));
      await waitFor(() => filenames(tmpDir).length === 1);
      expect(filenames(tmpDir)[0]).toMatch(/_0p\.jsonl$/);

      gl.logTick(1, [player(1), player(2), player(3)], [], []);
      gl.logTick(2, [player(1)], [], []);
      await gl.close();

      // Peak was 3, even though the room opened empty and ended with one player.
      expect(filenames(tmpDir)).toHaveLength(1);
      expect(filenames(tmpDir)[0]).toMatch(/_3p\.jsonl$/);
    });

    it('leaves the name alone for a room that really stayed empty', async () => {
      const gl = track(new GameLogger('openworld_r2', 'open_world', 0, { logDir: tmpDir }));
      gl.logTick(1, [], [], []);
      await gl.close();

      expect(filenames(tmpDir)[0]).toMatch(/_0p\.jsonl$/);
    });

    it('is safe to close twice', async () => {
      const gl = track(new GameLogger('room', 'ffa', 2, { logDir: tmpDir }));
      gl.logTick(1, [player(1), player(2)], [], []);
      const first = gl.close();
      expect(() => gl.close()).not.toThrow();
      await first;
      await gl.close(); // the second close resolves too, rather than hanging

      expect(filenames(tmpDir)).toHaveLength(1);
    });
  });
});
