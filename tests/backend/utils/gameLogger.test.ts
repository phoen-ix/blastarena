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
  logger.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
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

/** Create a .jsonl of roughly `sizeBytes`, backdated so the prune mtime guard does not skip it. */
function seedLog(dir: string, name: string, ageMs: number, sizeBytes: number): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x'.repeat(sizeBytes));
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

describe('GameLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = makeTmpDir();
  });

  afterEach(async () => {
    // Write streams flush asynchronously; removing the directory first makes them ENOENT into
    // whichever test runs next.
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('idle gating', () => {
    it('stops writing ticks once an empty room passes the idle window', async () => {
      const gl = new GameLogger('room', 'open_world', 0, { logDir: tmpDir });

      for (let tick = 0; tick <= 200; tick++) {
        gl.logTick(tick, [], [], []);
      }

      const ticks = countTicks(await readEntries(gl, tmpDir));
      // Ticks 0..60 are recorded (the window), everything after is suppressed.
      expect(ticks).toBe(61);
      expect(ticks).toBeLessThan(201);
    });

    it('records the opening ticks of an empty room so game_init has context', async () => {
      const gl = new GameLogger('room', 'open_world', 0, { logDir: tmpDir });

      for (let tick = 0; tick <= 10; tick++) {
        gl.logTick(tick, [], [], []);
      }

      const entries = await readEntries(gl, tmpDir);
      expect(entries[0].event).toBe('game_init');
      expect(countTicks(entries)).toBe(11);
    });

    it('resumes and keeps writing while players are present', async () => {
      const gl = new GameLogger('room', 'open_world', 0, { logDir: tmpDir });

      for (let tick = 0; tick <= 200; tick++) gl.logTick(tick, [], [], []);
      for (let tick = 201; tick <= 260; tick++) gl.logTick(tick, [player(1)], [], []);

      // 61 from the opening window + 60 active ticks
      expect(countTicks(await readEntries(gl, tmpDir))).toBe(121);
    });

    it('treats a bomb with no players as activity', async () => {
      const gl = new GameLogger('room', 'open_world', 0, { logDir: tmpDir });

      for (let tick = 0; tick <= 200; tick++) gl.logTick(tick, [], [], []);
      gl.logTick(201, [], [bomb()], []);

      expect(countTicks(await readEntries(gl, tmpDir))).toBe(62);
    });

    it('treats an explosion with no players as activity', async () => {
      const gl = new GameLogger('room', 'open_world', 0, { logDir: tmpDir });

      for (let tick = 0; tick <= 200; tick++) gl.logTick(tick, [], [], []);
      gl.logTick(201, [], [], [explosion()]);

      expect(countTicks(await readEntries(gl, tmpDir))).toBe(62);
    });

    it('never suppresses ticks in a continuously active room', async () => {
      const gl = new GameLogger('room', 'ffa', 2, { logDir: tmpDir });

      for (let tick = 0; tick <= 300; tick++) {
        gl.logTick(tick, [player(1), player(2)], [], []);
      }

      expect(countTicks(await readEntries(gl, tmpDir))).toBe(301);
    });
  });

  describe('shouldLogTick verbosity mapping', () => {
    it('is unchanged by the idle gate', () => {
      const full = new GameLogger('r', 'm', 0, { logDir: tmpDir, verbosity: 'full' });
      const detailed = new GameLogger('r', 'm', 0, { logDir: tmpDir, verbosity: 'detailed' });
      const normal = new GameLogger('r', 'm', 0, { logDir: tmpDir, verbosity: 'normal' });

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
      seedLog(tmpDir, 'old.jsonl', 5 * DAY_MS, 1024);
      seedLog(tmpDir, 'recent.jsonl', 2 * HOUR_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '1', GAME_LOG_MAX_TOTAL_MB: '4096' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'old.jsonl'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'recent.jsonl'))).toBe(true);
    });

    it('never deletes a file modified inside the prune interval, however small the limits', async () => {
      seedLog(tmpDir, 'active.jsonl', 0, 1024); // an open stream looks like this
      seedLog(tmpDir, 'stale.jsonl', 5 * DAY_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '0', GAME_LOG_MAX_TOTAL_MB: '0' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'active.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'stale.jsonl'))).toBe(false);
    });

    it('trims oldest-first until the directory is under the size limit', async () => {
      const MB = 1024 * 1024;
      seedLog(tmpDir, 'a-oldest.jsonl', 4 * HOUR_MS, MB);
      seedLog(tmpDir, 'b-middle.jsonl', 3 * HOUR_MS, MB);
      seedLog(tmpDir, 'c-newest.jsonl', 2 * HOUR_MS, MB);

      // 3 MB present, 2 MB allowed, age limit far away -> only the oldest should go.
      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '3650', GAME_LOG_MAX_TOTAL_MB: '2' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'a-oldest.jsonl'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'b-middle.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'c-newest.jsonl'))).toBe(true);
    });

    it('ignores files that are not .jsonl', async () => {
      seedLog(tmpDir, 'keep.txt', 5 * DAY_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '0', GAME_LOG_MAX_TOTAL_MB: '0' });
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'keep.txt'))).toBe(true);
    });

    it('is throttled to once per interval', async () => {
      seedLog(tmpDir, 'stale.jsonl', 5 * DAY_MS, 1024);

      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '0', GAME_LOG_MAX_TOTAL_MB: '0' });
      GL.lastPruneAt = Date.now(); // pretend a prune just ran
      await GL.pruneOldLogs(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'stale.jsonl'))).toBe(true);
    });

    it('does not throw when the directory is missing', async () => {
      const GL = await loadWith({ GAME_LOG_MAX_AGE_DAYS: '1', GAME_LOG_MAX_TOTAL_MB: '1' });
      await expect(GL.pruneOldLogs(path.join(tmpDir, 'nope'))).resolves.toBeUndefined();
    });
  });
});
