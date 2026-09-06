import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { SimulationConfig, SimulationBatchStatus } from '@blast-arena/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// --- Mock setup (jest.mock is hoisted before imports) ---

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the IO registry
jest.mock('../../../backend/src/game/registry', () => ({
  getIO: jest.fn().mockReturnValue({
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  }),
}));

// gunzip is promisified at module load; mock the promisified form directly.
const mockGunzip = jest.fn<AnyFn>();
jest.mock('util', () => ({
  ...jest.requireActual<typeof import('util')>('util'),
  promisify: () => mockGunzip,
}));

// Mock fs module. The manager reads the simulations directory through fs.promises only
// (audit E3); the sync functions stay mocked so a regression to them is caught (they would
// return nothing useful).
const mockReaddirSync = jest.fn<AnyFn>().mockReturnValue([]);
const mockReadFileSync = jest.fn<AnyFn>().mockReturnValue('{}');
const mockExistsSync = jest.fn<AnyFn>().mockReturnValue(false);
const mockRmSync = jest.fn<AnyFn>();
const mockReaddir = jest.fn<AnyFn>();
const mockReadFile = jest.fn<AnyFn>();
const mockRm = jest.fn<AnyFn>();

const enoent = () =>
  Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });

jest.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  promises: {
    readdir: (...args: unknown[]) => mockReaddir(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    rm: (...args: unknown[]) => mockRm(...args),
  },
}));

/**
 * Describe a simulations directory: { gameMode: { batchDirName: { 'batch_config.json': {...},
 * 'batch_summary.json'?: {...}, other files... } } }. Missing SIM_LOG_DIR = pass `null`.
 */
type FakeTree = Record<string, Record<string, Record<string, unknown>>> | null;
function mockDisk(tree: FakeTree): void {
  mockReaddir.mockImplementation(async (dirPath: string, opts?: { withFileTypes?: boolean }) => {
    const dir = String(dirPath);
    if (tree === null) throw enoent();
    const segments = dir.split('/');
    const asDirents = (names: string[], dirs: Set<string>) =>
      opts?.withFileTypes
        ? names.map((name) => ({ name, isDirectory: () => dirs.has(name) }))
        : names;
    if (dir.endsWith('simulations')) {
      return asDirents(Object.keys(tree), new Set(Object.keys(tree)));
    }
    const mode = segments[segments.length - 1];
    if (tree[mode]) {
      return asDirents(Object.keys(tree[mode]), new Set(Object.keys(tree[mode])));
    }
    const batch = segments[segments.length - 1];
    const modeOfBatch = segments[segments.length - 2];
    const files = tree[modeOfBatch]?.[batch];
    if (files) return asDirents(Object.keys(files), new Set());
    throw enoent();
  });
  mockReadFile.mockImplementation(async (filePath: string) => {
    if (tree === null) throw enoent();
    const segments = String(filePath).split('/');
    const [mode, batch, file] = segments.slice(-3);
    const content = tree[mode]?.[batch]?.[file];
    if (content === undefined) throw enoent();
    return typeof content === 'string' ? content : JSON.stringify(content);
  });
}

// Mock SimulationRunner
const mockRunnerRun = jest.fn<AnyFn>().mockResolvedValue(undefined);
const mockRunnerCancel = jest.fn<AnyFn>();
const mockRunnerIsActive = jest.fn<AnyFn>().mockReturnValue(true);
const mockRunnerGetStatus = jest.fn<AnyFn>();
const mockRunnerGetResults = jest.fn<AnyFn>().mockReturnValue([]);
const mockRunnerOn = jest.fn<AnyFn>();

jest.mock('../../../backend/src/simulation/SimulationRunner', () => ({
  SimulationRunner: jest
    .fn<AnyFn>()
    .mockImplementation((config: SimulationConfig, batchId: string) => {
      const status: SimulationBatchStatus = {
        batchId,
        config,
        status: 'running',
        gamesCompleted: 0,
        totalGames: config.totalGames,
        currentGameTick: null,
        currentGameMaxTicks: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
      };
      mockRunnerGetStatus.mockReturnValue(status);
      return {
        batchId,
        run: mockRunnerRun,
        cancel: mockRunnerCancel,
        isActive: mockRunnerIsActive,
        getStatus: mockRunnerGetStatus,
        getResults: mockRunnerGetResults,
        on: mockRunnerOn,
        emit: jest.fn(),
      };
    }),
}));

import { SimulationManager } from '../../../backend/src/simulation/SimulationManager';

// --- Helpers ---

function createSimConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return {
    gameMode: 'ffa',
    botCount: 4,
    botDifficulty: 'normal',
    mapWidth: 15,
    mapHeight: 13,
    roundTime: 180,
    wallDensity: 0.65,
    enabledPowerUps: ['bomb_up', 'fire_up', 'speed_up'],
    powerUpDropRate: 0.3,
    friendlyFire: true,
    hazardTiles: false,
    reinforcedWalls: false,
    enableMapEvents: false,
    totalGames: 5,
    speed: 'fast',
    logVerbosity: 'normal',
    ...overrides,
  } as SimulationConfig;
}

describe('SimulationManager', () => {
  let manager: SimulationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new SimulationManager();
    // Default: no runner is active, and no simulations directory on disk yet
    mockRunnerIsActive.mockReturnValue(false);
    mockDisk(null);
    mockRm.mockResolvedValue(undefined);
  });

  // ─────────────────────────────────────────────────
  // 1. startBatch
  // ─────────────────────────────────────────────────
  describe('startBatch', () => {
    it('should start a batch immediately when no active batch exists', () => {
      mockRunnerIsActive.mockReturnValue(false);
      const config = createSimConfig();
      const result = manager.startBatch(config, 1);

      expect(result).toHaveProperty('batchId');
      expect(result).not.toHaveProperty('error');
      expect(result).not.toHaveProperty('queued');
    });

    it('should generate a unique batchId', () => {
      const config = createSimConfig();
      const result1 = manager.startBatch(config, 1) as { batchId: string };
      // The second batch will be queued since the first runner mock is active
      mockRunnerIsActive.mockReturnValue(true);
      const result2 = manager.startBatch(config, 1) as { batchId: string };

      expect(result1.batchId).toBeDefined();
      expect(result2.batchId).toBeDefined();
      expect(result1.batchId).not.toBe(result2.batchId);
    });

    it('should include sim_ prefix in batchId', () => {
      const config = createSimConfig();
      const result = manager.startBatch(config, 1) as { batchId: string };

      expect(result.batchId).toMatch(/^sim_/);
    });

    it('should call runner.run() for immediate start', () => {
      const config = createSimConfig();
      manager.startBatch(config, 1);

      expect(mockRunnerRun).toHaveBeenCalledTimes(1);
    });

    it('should queue batch when another is running', () => {
      // First batch starts immediately
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      // Now mock runner as active for subsequent calls
      mockRunnerIsActive.mockReturnValue(true);
      const result = manager.startBatch(createSimConfig(), 2);

      expect(result).toHaveProperty('queued', true);
      expect(result).toHaveProperty('queuePosition', 1);
    });

    it('should assign correct queue positions', () => {
      // First batch starts immediately
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      // Queue subsequent batches
      mockRunnerIsActive.mockReturnValue(true);
      const q1 = manager.startBatch(createSimConfig(), 2) as { queuePosition: number };
      const q2 = manager.startBatch(createSimConfig(), 3) as { queuePosition: number };
      const q3 = manager.startBatch(createSimConfig(), 4) as { queuePosition: number };

      expect(q1.queuePosition).toBe(1);
      expect(q2.queuePosition).toBe(2);
      expect(q3.queuePosition).toBe(3);
    });

    it('should reject when queue is full (max 10)', () => {
      // First batch immediate
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      // Fill queue to max
      mockRunnerIsActive.mockReturnValue(true);
      for (let i = 0; i < 10; i++) {
        const result = manager.startBatch(createSimConfig(), 100 + i);
        expect(result).toHaveProperty('queued', true);
      }

      // 11th should fail
      const overflow = manager.startBatch(createSimConfig(), 999);
      expect(overflow).toHaveProperty('error');
      expect((overflow as { error: string }).error).toContain('Queue is full');
    });

    it('should not call runner.run() for queued batches', () => {
      // Start first batch
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerRun.mockClear();

      // Queue second batch
      mockRunnerIsActive.mockReturnValue(true);
      manager.startBatch(createSimConfig(), 2);

      // runner.run() should NOT have been called for the queued batch
      expect(mockRunnerRun).not.toHaveBeenCalled();
    });

    it('should set up auto-advance on completed event', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      // Runner.on should have been called with 'completed'
      expect(mockRunnerOn).toHaveBeenCalledWith('completed', expect.any(Function));
    });

    // (audit B6) — socket.ts used to attach three per-socket listeners for immediately-started
    // batches that were never removed; the manager now wires the sim:admin room broadcast for
    // every batch, started immediately or from the queue.
    it('wires the sim:admin broadcast for an immediately-started batch', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      const events = mockRunnerOn.mock.calls.map((c) => c[0]);
      expect(events).toEqual(expect.arrayContaining(['progress', 'gameResult', 'completed']));
      // 'completed' twice: auto-advance + broadcast
      expect(events.filter((e) => e === 'completed')).toHaveLength(2);
    });

    it('wires the same broadcast for a batch started from the queue', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      const completedHandlers = mockRunnerOn.mock.calls
        .filter(([event]) => event === 'completed')
        .map(([, handler]) => handler as AnyFn);
      mockRunnerIsActive.mockReturnValue(true);
      manager.startBatch(createSimConfig(), 2);
      mockRunnerOn.mockClear();

      // First runner finishes → the queued batch starts with its own listeners.
      mockRunnerIsActive.mockReturnValue(false);
      for (const h of completedHandlers) h(mockRunnerGetStatus());

      const events = mockRunnerOn.mock.calls.map((c) => c[0]);
      expect(events).toEqual(expect.arrayContaining(['progress', 'gameResult', 'completed']));
      expect(events.filter((e) => e === 'completed')).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────
  // 2. cancelBatch
  // ─────────────────────────────────────────────────
  describe('cancelBatch', () => {
    it('should cancel a running batch', () => {
      mockRunnerIsActive.mockReturnValue(false);
      const result = manager.startBatch(createSimConfig(), 1) as { batchId: string };
      mockRunnerIsActive.mockReturnValue(true);

      const cancelled = manager.cancelBatch(result.batchId);

      expect(cancelled).toBe(true);
      expect(mockRunnerCancel).toHaveBeenCalledTimes(1);
    });

    it('should return false for non-existent batch', () => {
      const cancelled = manager.cancelBatch('nonexistent_batch');
      expect(cancelled).toBe(false);
    });

    it('should remove a queued batch from the queue', () => {
      // Start first batch
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      // Queue a second batch
      mockRunnerIsActive.mockReturnValue(true);
      const queued = manager.startBatch(createSimConfig(), 2) as { batchId: string };

      const cancelled = manager.cancelBatch(queued.batchId);
      expect(cancelled).toBe(true);
      expect(manager.isQueued(queued.batchId)).toBe(false);
    });

    it('should return false for an inactive (completed) runner', () => {
      mockRunnerIsActive.mockReturnValue(false);
      const result = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      // Runner is now inactive (completed)
      mockRunnerIsActive.mockReturnValue(false);

      const cancelled = manager.cancelBatch(result.batchId);
      expect(cancelled).toBe(false);
    });

    it('should not call runner.cancel() when removing from queue', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      mockRunnerIsActive.mockReturnValue(true);
      const queued = manager.startBatch(createSimConfig(), 2) as { batchId: string };

      mockRunnerCancel.mockClear();
      manager.cancelBatch(queued.batchId);

      // cancel was called on queue removal path, not runner.cancel
      expect(mockRunnerCancel).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────
  // 3. removeFromQueue
  // ─────────────────────────────────────────────────
  describe('removeFromQueue', () => {
    it('should remove a queued batch by batchId', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      const queued = manager.startBatch(createSimConfig(), 2) as { batchId: string };

      const removed = manager.removeFromQueue(queued.batchId);
      expect(removed).toBe(true);
    });

    it('should return false if batchId not found in queue', () => {
      const removed = manager.removeFromQueue('ghost_batch');
      expect(removed).toBe(false);
    });

    it('should not remove running batches (only queued)', () => {
      mockRunnerIsActive.mockReturnValue(false);
      const running = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      // The running batch is not in the queue
      const removed = manager.removeFromQueue(running.batchId);
      expect(removed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 4. getBatch
  // ─────────────────────────────────────────────────
  describe('getBatch', () => {
    it('should return the runner for an existing batch', () => {
      mockRunnerIsActive.mockReturnValue(false);
      const result = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      const runner = manager.getBatch(result.batchId);
      expect(runner).toBeDefined();
    });

    it('should return undefined for non-existent batch', () => {
      const runner = manager.getBatch('nonexistent');
      expect(runner).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────
  // 5. isQueued
  // ─────────────────────────────────────────────────
  describe('isQueued', () => {
    it('should return true for a queued batch', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      const queued = manager.startBatch(createSimConfig(), 2) as { batchId: string };

      expect(manager.isQueued(queued.batchId)).toBe(true);
    });

    it('should return false for a running batch', () => {
      mockRunnerIsActive.mockReturnValue(false);
      const running = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      expect(manager.isQueued(running.batchId)).toBe(false);
    });

    it('should return false for a non-existent batch', () => {
      expect(manager.isQueued('nope')).toBe(false);
    });

    it('should return false after a queued batch is removed', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      const queued = manager.startBatch(createSimConfig(), 2) as { batchId: string };
      expect(manager.isQueued(queued.batchId)).toBe(true);

      manager.removeFromQueue(queued.batchId);
      expect(manager.isQueued(queued.batchId)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 6. getActiveBatches
  // ─────────────────────────────────────────────────
  describe('getActiveBatches', () => {
    it('should return empty array when no batches exist', () => {
      expect(manager.getActiveBatches()).toEqual([]);
    });

    it('should return statuses for all runners', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      const batches = manager.getActiveBatches();
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveProperty('batchId');
      expect(batches[0]).toHaveProperty('status');
    });

    it('should return multiple runner statuses', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      // Manually simulate the first becoming inactive so the second starts
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 2);

      const batches = manager.getActiveBatches();
      expect(batches).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────
  // 7. getHistory (pagination)
  // ─────────────────────────────────────────────────
  describe('getHistory', () => {
    it('should return empty history when no batches exist and no disk data', async () => {
      const result = await manager.getHistory();
      expect(result.batches).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should include queued entries in history', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);
      manager.startBatch(createSimConfig(), 2);

      const result = await manager.getHistory();
      // Should include 1 runner + 1 queued
      expect(result.total).toBe(2);
    });

    it('should include in-memory runner batches', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      const result = await manager.getHistory();
      expect(result.total).toBeGreaterThanOrEqual(1);
    });

    it('should paginate results correctly (page 1)', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      // Create several batches
      for (let i = 0; i < 5; i++) {
        mockRunnerIsActive.mockReturnValue(false);
        manager.startBatch(createSimConfig(), 100 + i);
      }

      const result = await manager.getHistory(1, 2);
      expect(result.batches).toHaveLength(2);
      expect(result.total).toBe(5);
    });

    it('should paginate results correctly (page 2)', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      for (let i = 0; i < 5; i++) {
        mockRunnerIsActive.mockReturnValue(false);
        manager.startBatch(createSimConfig(), 100 + i);
      }

      const result = await manager.getHistory(2, 2);
      expect(result.batches).toHaveLength(2);
      expect(result.total).toBe(5);
    });

    it('should handle last page with fewer items', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      for (let i = 0; i < 5; i++) {
        mockRunnerIsActive.mockReturnValue(false);
        manager.startBatch(createSimConfig(), 100 + i);
      }

      const result = await manager.getHistory(3, 2);
      expect(result.batches).toHaveLength(1);
      expect(result.total).toBe(5);
    });

    it('should return empty batches for out-of-range page', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      const result = await manager.getHistory(99, 10);
      expect(result.batches).toEqual([]);
      expect(result.total).toBe(1);
    });

    it('should default to page 1 and limit 20', async () => {
      const result = await manager.getHistory();
      expect(result.batches).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should scan disk for past batches', async () => {
      mockDisk({
        ffa: {
          'batch_2026-01-01_sim_1': {
            'batch_config.json': {
              batchId: 'sim_disk_1',
              config: createSimConfig(),
              startedAt: '2026-01-01T00:00:00.000Z',
            },
            'batch_summary.json': {
              status: 'completed',
              totalGamesRun: 5,
              completedAt: '2026-01-01T00:01:00.000Z',
            },
          },
        },
      });

      const result = await manager.getHistory();
      expect(result.total).toBe(1);
      expect(result.batches[0].batchId).toBe('sim_disk_1');
      expect(result.batches[0].status).toBe('completed');
      expect(result.batches[0].gamesCompleted).toBe(5);
      expect(result.batches[0].completedAt).toBe('2026-01-01T00:01:00.000Z');
    });

    it('never touches the synchronous fs API (audit E3)', async () => {
      mockDisk({
        ffa: {
          batch_a: {
            'batch_config.json': { batchId: 'a', config: createSimConfig(), startedAt: 't' },
          },
        },
      });
      await manager.getHistory();
      expect(mockReaddirSync).not.toHaveBeenCalled();
      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockExistsSync).not.toHaveBeenCalled();
    });

    it('caches the directory scan across pages instead of rewalking the tree (audit E3)', async () => {
      mockDisk({
        ffa: {
          batch_a: {
            'batch_config.json': {
              batchId: 'a',
              config: createSimConfig(),
              startedAt: '2026-01-02T00:00:00.000Z',
            },
          },
          batch_b: {
            'batch_config.json': {
              batchId: 'b',
              config: createSimConfig(),
              startedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      });

      const page1 = await manager.getHistory(1, 1);
      const page2 = await manager.getHistory(2, 1);
      expect(page1.batches.map((b) => b.batchId)).toEqual(['a']);
      expect(page2.batches.map((b) => b.batchId)).toEqual(['b']);

      // One walk: root readdir + one mode readdir; two config reads.
      expect(mockReaddir).toHaveBeenCalledTimes(2);
      expect(
        mockReadFile.mock.calls.filter(([f]) => String(f).endsWith('batch_config.json')),
      ).toHaveLength(2);
    });

    it('coalesces concurrent callers into a single scan', async () => {
      mockDisk({
        ffa: {
          batch_a: {
            'batch_config.json': { batchId: 'a', config: createSimConfig(), startedAt: 't' },
          },
        },
      });
      await Promise.all([
        manager.getHistory(),
        manager.getHistory(),
        manager.getBatchResults('zzz'),
      ]);
      expect(
        mockReaddir.mock.calls.filter(([d]) => String(d).endsWith('simulations')),
      ).toHaveLength(1);
    });

    it('rescans after a batch completes, so the fresh summary is picked up', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      const started = manager.startBatch(createSimConfig(), 1) as { batchId: string };
      const completedHandlers = mockRunnerOn.mock.calls
        .filter(([event]) => event === 'completed')
        .map(([, handler]) => handler as AnyFn);

      mockDisk({ ffa: {} });
      await manager.getHistory();
      expect(
        mockReaddir.mock.calls.filter(([d]) => String(d).endsWith('simulations')),
      ).toHaveLength(1);

      // Batch finishes: summary written, runner reports itself inactive, cleanup evicts it.
      mockDisk({
        ffa: {
          batch_x: {
            'batch_config.json': {
              batchId: started.batchId,
              config: createSimConfig(),
              startedAt: 't',
            },
            'batch_summary.json': { status: 'completed', totalGamesRun: 5, completedAt: 'c' },
          },
        },
      });
      for (const h of completedHandlers) h(mockRunnerGetStatus());
      (manager as unknown as { runners: Map<string, unknown> }).runners.clear();

      const result = await manager.getHistory();
      expect(
        mockReaddir.mock.calls.filter(([d]) => String(d).endsWith('simulations')),
      ).toHaveLength(2);
      expect(result.batches[0]).toMatchObject({ batchId: started.batchId, status: 'completed' });
    });

    it('should skip disk batches that are already in memory', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      const started = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      // Disk data with same batchId as the in-memory runner
      mockDisk({
        ffa: {
          batch_dup: {
            'batch_config.json': {
              batchId: started.batchId,
              config: createSimConfig(),
              startedAt: new Date().toISOString(),
            },
          },
        },
      });

      const result = await manager.getHistory();
      // Should only count the in-memory one, not the duplicate on disk
      expect(result.total).toBe(1);
    });

    it('should handle missing SIM_LOG_DIR gracefully', async () => {
      mockDisk(null);

      const result = await manager.getHistory();
      expect(result.batches).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should skip malformed config files on disk', async () => {
      mockDisk({ ffa: { batch_bad: { 'batch_config.json': 'not valid json{{{' } } });

      // Should not throw
      const result = await manager.getHistory();
      expect(result.total).toBe(0);
    });

    it('should sort queued entries first, then running, then completed', async () => {
      // Create a running batch
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);

      // Queue two more
      mockRunnerIsActive.mockReturnValue(true);
      manager.startBatch(createSimConfig(), 2);
      manager.startBatch(createSimConfig(), 3);

      const result = await manager.getHistory();
      // Queued entries should come first in sorted order
      const statuses = result.batches.map((b) => b.status);
      // queued < running < completed
      for (let i = 0; i < statuses.length - 1; i++) {
        const order: Record<string, number> = {
          queued: 0,
          running: 1,
          completed: 2,
          cancelled: 2,
          error: 2,
        };
        expect(order[statuses[i]]).toBeLessThanOrEqual(order[statuses[i + 1]]);
      }
    });

    it('should include queuePosition in queued history entries', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);
      manager.startBatch(createSimConfig(), 2);
      manager.startBatch(createSimConfig(), 3);

      const result = await manager.getHistory();
      const queued = result.batches.filter((b) => b.status === 'queued');
      expect(queued.length).toBe(2);
      expect(queued[0].queuePosition).toBe(1);
      expect(queued[1].queuePosition).toBe(2);
    });

    // Regression: getHistory has two exit paths, and the early one — taken when the simulations
    // directory does not exist yet, which is this suite's default — sorted by startedAt alone.
    // Queue order therefore held only while two batches happened to be queued in the SAME
    // millisecond; the moment the clock ticked between them they came back reversed. That made
    // the test above pass or fail depending on machine speed, and it was a genuine ordering bug in
    // the admin history view. Forcing the timestamps apart pins it. (audit SIMHISTORY-ORDER-1)
    it('orders queued entries by queue position even when they were queued milliseconds apart', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      manager.startBatch(createSimConfig(), 2);
      manager.startBatch(createSimConfig(), 3);
      manager.startBatch(createSimConfig(), 4);

      // Spread the queuedAt stamps so a startedAt-descending sort would invert them.
      const queueEntries = (manager as unknown as { queue: { queuedAt: Date }[] }).queue;
      expect(queueEntries).toHaveLength(3);
      queueEntries.forEach((entry, i) => {
        entry.queuedAt = new Date(Date.now() + i * 1000);
      });

      const queued = (await manager.getHistory()).batches.filter((b) => b.status === 'queued');
      expect(queued.map((b) => b.queuePosition)).toEqual([1, 2, 3]);
    });

    it('puts queued entries ahead of the running one regardless of timestamps', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);
      manager.startBatch(createSimConfig(), 2);

      const queueEntries = (manager as unknown as { queue: { queuedAt: Date }[] }).queue;
      // Queued long ago: a startedAt-descending sort would push it behind the running batch.
      queueEntries.forEach((entry) => {
        entry.queuedAt = new Date(Date.now() - 60_000);
      });

      const statuses = (await manager.getHistory()).batches.map((b) => b.status);
      expect(statuses[0]).toBe('queued');
    });

    it('should handle disk batches without summary file', async () => {
      mockDisk({
        ffa: {
          batch_nosummary: {
            'batch_config.json': {
              batchId: 'sim_nosummary_1',
              config: createSimConfig(),
              startedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        },
      });

      const result = await manager.getHistory();
      expect(result.total).toBe(1);
      // Without summary, status defaults to 'error'
      expect(result.batches[0].status).toBe('error');
      expect(result.batches[0].gamesCompleted).toBe(0);
    });

    it('should skip non-directory entries in game mode scan', async () => {
      mockReaddir.mockImplementation(async (dirPath: string) => {
        const dir = String(dirPath);
        if (dir.endsWith('simulations')) {
          return [
            { name: 'ffa', isDirectory: () => true },
            { name: 'readme.txt', isDirectory: () => false },
          ];
        }
        return [];
      });

      const result = await manager.getHistory();
      expect(result.total).toBe(0); // No actual batch dirs found
      // readme.txt was never descended into
      expect(mockReaddir.mock.calls.some(([d]) => String(d).endsWith('readme.txt'))).toBe(false);
    });

    it('should skip non-directory entries in batch dir scan', async () => {
      mockReaddir.mockImplementation(async (dirPath: string) => {
        const dir = String(dirPath);
        if (dir.endsWith('simulations')) {
          return [{ name: 'ffa', isDirectory: () => true }];
        }
        if (dir.endsWith('ffa')) {
          return [{ name: 'some_file.txt', isDirectory: () => false }];
        }
        return [];
      });

      const result = await manager.getHistory();
      expect(result.total).toBe(0);
      expect(mockReadFile).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────
  // 8. getBatchResults
  // ─────────────────────────────────────────────────
  describe('getBatchResults', () => {
    it('should return results from in-memory runner', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      const started = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      mockRunnerGetResults.mockReturnValue([{ gameIndex: 0, winnerId: -1, winnerName: 'BotA' }]);

      const results = await manager.getBatchResults(started.batchId);
      expect(results).not.toBeNull();
      expect(results!.results).toHaveLength(1);
      expect(results!.summary).toBeDefined();
      expect(mockReaddir).not.toHaveBeenCalled();
    });

    it('should return null for non-existent batch (no disk)', async () => {
      mockDisk(null);

      const results = await manager.getBatchResults('nonexistent');
      expect(results).toBeNull();
    });

    it('should search disk for batch results when not in memory', async () => {
      mockDisk({
        ffa: {
          batch_disk: {
            'batch_config.json': {
              batchId: 'sim_disk_results',
              config: createSimConfig(),
              startedAt: 't',
            },
            'batch_summary.json': {
              batchId: 'sim_disk_results',
              status: 'completed',
              results: [{ gameIndex: 0, winnerId: -1 }],
            },
          },
        },
      });

      const results = await manager.getBatchResults('sim_disk_results');
      expect(results).not.toBeNull();
      expect(results!.results).toHaveLength(1);
      expect(results!.summary).toMatchObject({ batchId: 'sim_disk_results', status: 'completed' });
    });

    it('should return null when disk search finds no matching batch', async () => {
      mockDisk({
        ffa: {
          batch_other: {
            'batch_config.json': { batchId: 'other_id', config: createSimConfig(), startedAt: 't' },
            'batch_summary.json': { batchId: 'other_id', results: [] },
          },
        },
      });

      const results = await manager.getBatchResults('wrong_id');
      expect(results).toBeNull();
    });

    it('should return null for a batch on disk whose summary is malformed', async () => {
      mockDisk({
        ffa: {
          batch_bad: {
            'batch_config.json': { batchId: 'whatever', config: createSimConfig(), startedAt: 't' },
            'batch_summary.json': '{{broken json',
          },
        },
      });

      const results = await manager.getBatchResults('whatever');
      expect(results).toBeNull();
    });

    it('should return null for a batch on disk that has no summary yet', async () => {
      mockDisk({
        ffa: {
          batch_running: {
            'batch_config.json': { batchId: 'r1', config: createSimConfig(), startedAt: 't' },
          },
        },
      });

      expect(await manager.getBatchResults('r1')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────
  // 9. getSimulationReplay
  // ─────────────────────────────────────────────────
  describe('getSimulationReplay', () => {
    it('should return null when SIM_LOG_DIR does not exist', async () => {
      mockDisk(null);

      const result = await manager.getSimulationReplay('batch1', 0);
      expect(result).toBeNull();
    });

    it('should return null when batch is not found on disk', async () => {
      mockDisk({
        ffa: {
          batch_nope: {
            'batch_config.json': {
              batchId: 'other_batch',
              config: createSimConfig(),
              startedAt: 't',
            },
          },
        },
      });

      const result = await manager.getSimulationReplay('batch1', 0);
      expect(result).toBeNull();
    });

    it('should return null when replay file is not found', async () => {
      mockDisk({
        ffa: {
          batch_found: {
            'batch_config.json': {
              batchId: 'target_batch',
              config: createSimConfig(),
              startedAt: 't',
            },
            'batch_summary.json': {},
          },
        },
      });

      const result = await manager.getSimulationReplay('target_batch', 0);
      expect(result).toBeNull();
    });

    it('reads the matching replay file for the game index', async () => {
      mockDisk({
        ffa: {
          batch_found: {
            'batch_config.json': {
              batchId: 'target_batch',
              config: createSimConfig(),
              startedAt: 't',
            },
            '0_ABCDEF_ffa.replay.json.gz': 'gz0',
            '1_ABCDEF_ffa.replay.json.gz': 'gz1',
          },
        },
      });
      mockGunzip.mockResolvedValue(Buffer.from(JSON.stringify({ matchId: 1, frames: [] })));

      const result = await manager.getSimulationReplay('target_batch', 1);

      expect(result).toEqual({ matchId: 1, frames: [] });
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('1_ABCDEF_ffa.replay.json.gz'),
      );
      expect(mockGunzip).toHaveBeenCalledWith('gz1');
    });

    it('should handle errors gracefully', async () => {
      mockReaddir.mockRejectedValue(new Error('Disk error'));

      const result = await manager.getSimulationReplay('batch1', 0);
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────
  // 10. deleteBatch
  // ─────────────────────────────────────────────────
  describe('deleteBatch', () => {
    it('should delete a queued batch (no disk cleanup needed)', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      const queued = manager.startBatch(createSimConfig(), 2) as { batchId: string };

      const deleted = await manager.deleteBatch(queued.batchId);
      expect(deleted).toBe(true);
      expect(manager.isQueued(queued.batchId)).toBe(false);
      expect(mockRm).not.toHaveBeenCalled();
    });

    it('should remove runner from memory and delete from disk', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      const started = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      mockDisk({
        ffa: {
          batch_dir: {
            'batch_config.json': {
              batchId: started.batchId,
              config: createSimConfig(),
              startedAt: 't',
            },
          },
        },
      });

      const deleted = await manager.deleteBatch(started.batchId);
      expect(deleted).toBe(true);

      // Should have been removed from memory
      expect(manager.getBatch(started.batchId)).toBeUndefined();

      // Async rm, never rmSync (audit E3)
      expect(mockRm).toHaveBeenCalledWith(
        expect.stringContaining('batch_dir'),
        expect.objectContaining({ recursive: true, force: true }),
      );
      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('drops a deleted batch from the cached index without rescanning', async () => {
      mockDisk({
        ffa: {
          batch_a: {
            'batch_config.json': { batchId: 'a', config: createSimConfig(), startedAt: 't' },
          },
          batch_b: {
            'batch_config.json': { batchId: 'b', config: createSimConfig(), startedAt: 't' },
          },
        },
      });

      expect((await manager.getHistory()).total).toBe(2);
      expect(await manager.deleteBatch('a')).toBe(true);
      const after = await manager.getHistory();
      expect(after.batches.map((b) => b.batchId)).toEqual(['b']);
      expect(
        mockReaddir.mock.calls.filter(([d]) => String(d).endsWith('simulations')),
      ).toHaveLength(1);
      // A second delete of the same id is a miss, still without a rescan.
      expect(await manager.deleteBatch('a')).toBe(false);
      expect(
        mockReaddir.mock.calls.filter(([d]) => String(d).endsWith('simulations')),
      ).toHaveLength(1);
    });

    it('should return false when batch not found anywhere', async () => {
      mockDisk(null);
      const deleted = await manager.deleteBatch('ghost_batch');
      expect(deleted).toBe(false);
    });

    it('should return false when SIM_LOG_DIR does not exist', async () => {
      mockDisk(null);

      const deleted = await manager.deleteBatch('no_dir_batch');
      expect(deleted).toBe(false);
    });

    it('should handle disk errors gracefully', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      const started = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      mockReaddir.mockRejectedValue(new Error('Disk read error'));

      const deleted = await manager.deleteBatch(started.batchId);
      // Returns false because disk lookup failed
      expect(deleted).toBe(false);
    });

    it('returns false and logs when the removal itself fails', async () => {
      mockDisk({
        ffa: {
          batch_a: {
            'batch_config.json': { batchId: 'a', config: createSimConfig(), startedAt: 't' },
          },
        },
      });
      mockRm.mockRejectedValue(new Error('EACCES'));

      expect(await manager.deleteBatch('a')).toBe(false);
    });

    it('should skip malformed configs on disk during delete', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      const started = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      mockDisk({ ffa: { batch_bad: { 'batch_config.json': 'not json' } } });

      const deleted = await manager.deleteBatch(started.batchId);
      // Malformed config means no match found
      expect(deleted).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────
  // 11. cleanup
  // ─────────────────────────────────────────────────
  describe('cleanup', () => {
    it('should not throw when no runners exist', () => {
      expect(() => manager.cleanup()).not.toThrow();
    });

    it('should keep active runners', () => {
      mockRunnerIsActive.mockReturnValue(true);
      // Need to start without an active check first
      const origIsActive = mockRunnerIsActive.getMockImplementation();
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      manager.cleanup();

      // Runner should still be there
      expect(manager.getActiveBatches().length).toBe(1);
    });

    it('should keep last 10 finished runners and remove excess', () => {
      mockRunnerIsActive.mockReturnValue(false);

      // Create 15 finished runners
      for (let i = 0; i < 15; i++) {
        mockRunnerIsActive.mockReturnValue(false);
        manager.startBatch(createSimConfig(), 100 + i);
      }

      // All 15 should be there before cleanup
      expect(manager.getActiveBatches().length).toBe(15);

      // Ensure isActive returns false for all (they're "finished")
      mockRunnerIsActive.mockReturnValue(false);

      manager.cleanup();

      // Should keep only last 10
      expect(manager.getActiveBatches().length).toBe(10);
    });

    it('should not remove runners when under 10 finished', () => {
      mockRunnerIsActive.mockReturnValue(false);

      for (let i = 0; i < 8; i++) {
        mockRunnerIsActive.mockReturnValue(false);
        manager.startBatch(createSimConfig(), 100 + i);
      }

      mockRunnerIsActive.mockReturnValue(false);
      manager.cleanup();

      // All 8 should remain
      expect(manager.getActiveBatches().length).toBe(8);
    });

    it('should not remove exactly 10 finished runners', () => {
      mockRunnerIsActive.mockReturnValue(false);

      for (let i = 0; i < 10; i++) {
        mockRunnerIsActive.mockReturnValue(false);
        manager.startBatch(createSimConfig(), 100 + i);
      }

      mockRunnerIsActive.mockReturnValue(false);
      manager.cleanup();

      // All 10 should remain
      expect(manager.getActiveBatches().length).toBe(10);
    });
  });

  // ─────────────────────────────────────────────────
  // 12. Queue management edge cases
  // ─────────────────────────────────────────────────
  describe('Queue management', () => {
    it('should track queue size accurately after add/remove', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      const q1 = manager.startBatch(createSimConfig(), 2) as { batchId: string };
      const q2 = manager.startBatch(createSimConfig(), 3) as { batchId: string };
      const q3 = manager.startBatch(createSimConfig(), 4) as { batchId: string };

      expect(manager.isQueued(q1.batchId)).toBe(true);
      expect(manager.isQueued(q2.batchId)).toBe(true);
      expect(manager.isQueued(q3.batchId)).toBe(true);

      // Remove middle entry
      manager.removeFromQueue(q2.batchId);

      expect(manager.isQueued(q1.batchId)).toBe(true);
      expect(manager.isQueued(q2.batchId)).toBe(false);
      expect(manager.isQueued(q3.batchId)).toBe(true);
    });

    it('should handle rapid queue/cancel operations', async () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      for (let i = 0; i < 5; i++) {
        const result = manager.startBatch(createSimConfig(), 10 + i) as { batchId: string };
        manager.removeFromQueue(result.batchId);
      }

      // Queue should be empty after all removes
      const history = await manager.getHistory();
      const queued = history.batches.filter((b) => b.status === 'queued');
      expect(queued).toHaveLength(0);
    });

    it('should properly count queue space after removals', () => {
      mockRunnerIsActive.mockReturnValue(false);
      manager.startBatch(createSimConfig(), 1);
      mockRunnerIsActive.mockReturnValue(true);

      // Fill queue
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        const result = manager.startBatch(createSimConfig(), 10 + i) as { batchId: string };
        ids.push(result.batchId);
      }

      // Should be full
      const overflow = manager.startBatch(createSimConfig(), 99);
      expect(overflow).toHaveProperty('error');

      // Remove one
      manager.removeFromQueue(ids[0]);

      // Should now accept one more
      const newEntry = manager.startBatch(createSimConfig(), 100);
      expect(newEntry).toHaveProperty('queued', true);
    });
  });

  // ─────────────────────────────────────────────────
  // 13. Integration scenarios
  // ─────────────────────────────────────────────────
  describe('Integration scenarios', () => {
    it('should handle full batch lifecycle', async () => {
      // Start a batch
      mockRunnerIsActive.mockReturnValue(false);
      const result = manager.startBatch(createSimConfig(), 1) as { batchId: string };
      expect(result.batchId).toBeDefined();

      // Get its status
      const batch = manager.getBatch(result.batchId);
      expect(batch).toBeDefined();

      // Get history
      const history = await manager.getHistory();
      expect(history.total).toBeGreaterThanOrEqual(1);

      // Simulate completion — cancel the batch
      mockRunnerIsActive.mockReturnValue(true);
      manager.cancelBatch(result.batchId);
      expect(mockRunnerCancel).toHaveBeenCalled();
    });

    it('should handle batch with all config options', () => {
      const fullConfig = createSimConfig({
        gameMode: 'teams' as any,
        botCount: 8,
        botDifficulty: 'hard',
        mapWidth: 21,
        mapHeight: 17,
        roundTime: 300,
        wallDensity: 0.8,
        enabledPowerUps: [
          'bomb_up',
          'fire_up',
          'speed_up',
          'shield',
          'kick',
          'pierce_bomb',
          'remote_bomb',
          'line_bomb',
        ] as any[],
        powerUpDropRate: 0.5,
        friendlyFire: false,
        hazardTiles: true,
        reinforcedWalls: true,
        enableMapEvents: true,
        totalGames: 100,
        speed: 'realtime',
        logVerbosity: 'full',
        botTeams: [0, 0, 0, 0, 1, 1, 1, 1],
        recordReplays: true,
      });

      mockRunnerIsActive.mockReturnValue(false);
      const result = manager.startBatch(fullConfig, 1);
      expect(result).toHaveProperty('batchId');
    });

    it('should handle interleaved start, cancel, and delete', () => {
      // Start batch 1
      mockRunnerIsActive.mockReturnValue(false);
      const b1 = manager.startBatch(createSimConfig(), 1) as { batchId: string };

      // Queue batch 2
      mockRunnerIsActive.mockReturnValue(true);
      const b2 = manager.startBatch(createSimConfig(), 2) as { batchId: string };

      // Cancel running batch 1
      manager.cancelBatch(b1.batchId);

      // Delete queued batch 2
      manager.deleteBatch(b2.batchId);
      expect(manager.isQueued(b2.batchId)).toBe(false);

      // Cleanup
      mockRunnerIsActive.mockReturnValue(false);
      manager.cleanup();
    });
  });
});
