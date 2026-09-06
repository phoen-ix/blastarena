import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import {
  SimulationConfig,
  SimulationBatchStatus,
  SimulationGameResult,
  ReplayData,
} from '@blast-arena/shared';
import { SimulationRunner } from './SimulationRunner';
import { getIO } from '../game/registry';
import { logger } from '../utils/logger';

const gunzip = promisify(zlib.gunzip);

const SIM_LOG_DIR = process.env.SIMULATION_LOG_DIR || '/app/simulations';
const MAX_QUEUE_SIZE = 10;
/** How long a scan of the simulations directory is reused before being redone. (audit E3) */
const DISK_INDEX_TTL_MS = 30_000;

interface QueueEntry {
  batchId: string;
  config: SimulationConfig;
  adminId: number;
  queuedAt: Date;
}

/**
 * One batch directory on disk, as far as the history listing needs to know it.
 *
 * `batch_summary.json` is read once, at scan time, and only its headline fields are kept — the
 * file also carries every game result, which getBatchResults re-reads on demand.
 */
interface DiskBatch {
  batchId: string;
  dirPath: string;
  config: SimulationConfig;
  startedAt: string;
  status: SimulationBatchStatus['status'];
  gamesCompleted: number;
  completedAt: string | null;
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * History ordering: queued first in queue order, then running, then everything else newest-first.
 *
 * Shared by both of getHistory's exit paths — they had drifted, and the early one (taken when the
 * simulations directory does not exist yet) ignored status and queuePosition entirely.
 * (audit SIMHISTORY-ORDER-1)
 */
function compareHistoryEntries(a: SimulationBatchStatus, b: SimulationBatchStatus): number {
  const order: Record<string, number> = {
    queued: 0,
    running: 1,
    completed: 2,
    cancelled: 2,
    error: 2,
  };
  const ao = order[a.status] ?? 2;
  const bo = order[b.status] ?? 2;
  if (ao !== bo) return ao - bo;
  if (a.status === 'queued' && b.status === 'queued') {
    return (a.queuePosition ?? 0) - (b.queuePosition ?? 0);
  }
  const byStart = new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  if (byStart !== 0) return byStart;
  // batchId last: getHistory slices this array for pagination, and two batches started in the same
  // millisecond would otherwise fall back to filesystem readdir order — which differs between the
  // separate calls that produce page 1 and page 2. (audit PAGINATION-TOTAL-ORDER-1)
  return a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0;
}

export class SimulationManager {
  private runners: Map<string, SimulationRunner> = new Map();
  private batchCounter: number = 0;
  private queue: QueueEntry[] = [];
  /**
   * Cached scan of SIM_LOG_DIR. Every history page, result lookup, replay load and delete used to
   * walk the whole tree synchronously — `readdirSync` per mode directory, `existsSync` +
   * `readFileSync` + `JSON.parse` per batch — on the thread that also runs every game loop. The
   * tree only changes when a batch finishes or is deleted, and both paths invalidate the cache;
   * the TTL covers files changed behind the process's back. (audit E3)
   */
  private diskIndex: { builtAt: number; batches: Map<string, DiskBatch> } | null = null;
  /** In-flight scan, so concurrent callers share one walk instead of each starting their own. */
  private diskScan: Promise<Map<string, DiskBatch>> | null = null;
  /** Bumped by invalidateDiskIndex so a scan that was in flight at that moment is not cached. */
  private diskGeneration = 0;

  startBatch(
    config: SimulationConfig,
    adminId: number,
  ): { batchId: string; queued?: boolean; queuePosition?: number } | { error: string } {
    const batchId = `sim_${Date.now()}_${++this.batchCounter}`;

    // Check if a batch is already running
    let hasActive = false;
    for (const runner of this.runners.values()) {
      if (runner.isActive()) {
        hasActive = true;
        break;
      }
    }

    if (!hasActive) {
      // Start immediately. The `sim:admin` room broadcast is wired here exactly as it is for a
      // batch started from the queue; immediately-started batches used to rely on socket.ts
      // attaching per-socket listeners instead, which leaked. (audit B6)
      const runner = new SimulationRunner(config, batchId);
      this.runners.set(batchId, runner);
      this.setupRunnerAutoAdvance(runner);
      this.setupRunnerBroadcast(runner, batchId);

      logger.info(
        { batchId, adminId, config: config.gameMode, totalGames: config.totalGames },
        'Simulation batch created',
      );

      runner.run().catch((err) => {
        logger.error({ err, batchId }, 'Simulation runner crashed');
      });

      return { batchId };
    }

    // Queue it
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      return { error: `Queue is full (max ${MAX_QUEUE_SIZE}). Wait for a batch to finish.` };
    }

    this.queue.push({ batchId, config, adminId, queuedAt: new Date() });
    const queuePosition = this.queue.length;

    logger.info(
      { batchId, adminId, queuePosition, config: config.gameMode, totalGames: config.totalGames },
      'Simulation batch queued',
    );

    this.broadcastQueueUpdate();
    return { batchId, queued: true, queuePosition };
  }

  cancelBatch(batchId: string): boolean {
    // Check queue first
    if (this.removeFromQueue(batchId)) {
      return true;
    }
    // Cancel running batch
    const runner = this.runners.get(batchId);
    if (!runner || !runner.isActive()) return false;
    runner.cancel();
    return true;
  }

  removeFromQueue(batchId: string): boolean {
    const idx = this.queue.findIndex((e) => e.batchId === batchId);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    logger.info({ batchId }, 'Simulation batch removed from queue');
    this.broadcastQueueUpdate();
    return true;
  }

  getBatch(batchId: string): SimulationRunner | undefined {
    return this.runners.get(batchId);
  }

  isQueued(batchId: string): boolean {
    return this.queue.some((e) => e.batchId === batchId);
  }

  getActiveBatches(): SimulationBatchStatus[] {
    const statuses: SimulationBatchStatus[] = [];
    for (const runner of this.runners.values()) {
      statuses.push(runner.getStatus());
    }
    return statuses;
  }

  async getHistory(
    page: number = 1,
    limit: number = 20,
  ): Promise<{ batches: SimulationBatchStatus[]; total: number }> {
    const history: SimulationBatchStatus[] = [];

    // Include queued entries
    for (let i = 0; i < this.queue.length; i++) {
      const entry = this.queue[i];
      history.push({
        batchId: entry.batchId,
        config: entry.config,
        status: 'queued',
        queuePosition: i + 1,
        gamesCompleted: 0,
        totalGames: entry.config.totalGames,
        currentGameTick: null,
        currentGameMaxTicks: null,
        startedAt: entry.queuedAt.toISOString(),
        completedAt: null,
      });
    }

    // Include in-memory batches
    for (const runner of this.runners.values()) {
      history.push(runner.getStatus());
    }

    // Past batches known only from disk — served from the cached index. (audit E3)
    const memoryBatchIds = new Set([...this.runners.keys(), ...this.queue.map((e) => e.batchId)]);
    for (const batch of (await this.getDiskIndex()).values()) {
      if (memoryBatchIds.has(batch.batchId)) continue;
      history.push({
        batchId: batch.batchId,
        config: batch.config,
        status: batch.status,
        gamesCompleted: batch.gamesCompleted,
        totalGames: batch.config.totalGames,
        currentGameTick: null,
        currentGameMaxTicks: null,
        startedAt: batch.startedAt,
        completedAt: batch.completedAt,
      });
    }

    // One ordering for every path. This used to have two exit paths that had drifted — the early
    // one (taken when the simulations directory did not exist yet) ignored status and
    // queuePosition entirely. (audit SIMHISTORY-ORDER-1)
    history.sort(compareHistoryEntries);

    return { batches: history.slice((page - 1) * limit, page * limit), total: history.length };
  }

  async getBatchResults(
    batchId: string,
  ): Promise<{ results: SimulationGameResult[]; summary: SimulationBatchStatus } | null> {
    // Check in-memory first
    const runner = this.runners.get(batchId);
    if (runner) {
      return { results: runner.getResults(), summary: runner.getStatus() };
    }

    // Check disk
    const batch = (await this.getDiskIndex()).get(batchId);
    if (!batch) return null;
    const summary = await this.readSummary(batch.dirPath);
    if (!summary) return null;
    return {
      results: (summary.results as SimulationGameResult[] | undefined) || [],
      summary: summary as unknown as SimulationBatchStatus,
    };
  }

  async getSimulationReplay(batchId: string, gameIndex: number): Promise<ReplayData | null> {
    try {
      const batch = (await this.getDiskIndex()).get(batchId);
      if (!batch) return null;

      // Look for the replay file starting with gameIndex_
      const files = await fs.promises.readdir(batch.dirPath);
      const replayFile = files.find(
        (f) => f.startsWith(`${gameIndex}_`) && f.endsWith('.replay.json.gz'),
      );
      if (!replayFile) return null;

      const compressed = await fs.promises.readFile(path.join(batch.dirPath, replayFile));
      const decompressed = await gunzip(compressed);
      return JSON.parse(decompressed.toString()) as ReplayData;
    } catch (err) {
      logger.error({ err, batchId, gameIndex }, 'Failed to load simulation replay');
    }

    return null;
  }

  async deleteBatch(batchId: string): Promise<boolean> {
    // Check queue first — no disk cleanup needed
    if (this.removeFromQueue(batchId)) {
      return true;
    }

    // Remove from memory
    this.runners.delete(batchId);

    // Find and delete from disk
    try {
      const index = await this.getDiskIndex();
      const batch = index.get(batchId);
      if (!batch) return false;
      await fs.promises.rm(batch.dirPath, { recursive: true, force: true });
      // Keep the index in step so a run of deletes costs one scan, not one per delete.
      index.delete(batchId);
      logger.info({ batchId, path: batch.dirPath }, 'Simulation batch deleted from disk');
      return true;
    } catch (err) {
      logger.error({ err, batchId }, 'Failed to delete simulation batch');
    }

    return false;
  }

  /** Drop the cached directory scan so the next lookup re-reads the tree. (audit E3) */
  private invalidateDiskIndex(): void {
    this.diskIndex = null;
    this.diskGeneration++;
  }

  private getDiskIndex(): Promise<Map<string, DiskBatch>> {
    const now = Date.now();
    if (this.diskIndex && now - this.diskIndex.builtAt < DISK_INDEX_TTL_MS) {
      return Promise.resolve(this.diskIndex.batches);
    }
    if (this.diskScan) return this.diskScan;
    const generation = this.diskGeneration;
    this.diskScan = this.scanDisk()
      .then((batches) => {
        // A batch that completed while this walk was running may have been read without its
        // summary; the invalidation bumped the generation, so leave the cache empty and let the
        // next caller rescan.
        if (generation === this.diskGeneration) {
          this.diskIndex = { builtAt: Date.now(), batches };
        }
        return batches;
      })
      .finally(() => {
        this.diskScan = null;
      });
    return this.diskScan;
  }

  /** Walk SIM_LOG_DIR/{gameMode}/{batchDir} once, asynchronously. */
  private async scanDisk(): Promise<Map<string, DiskBatch>> {
    const batches = new Map<string, DiskBatch>();

    let modeDirs: fs.Dirent[];
    try {
      modeDirs = await fs.promises.readdir(SIM_LOG_DIR, { withFileTypes: true });
    } catch (err) {
      // No directory yet means no history — not an error.
      if (!isMissingFile(err)) logger.error({ err }, 'Failed to scan simulation history');
      return batches;
    }

    for (const modeDir of modeDirs) {
      if (!modeDir.isDirectory()) continue;
      const modePath = path.join(SIM_LOG_DIR, modeDir.name);
      let batchDirs: fs.Dirent[];
      try {
        batchDirs = await fs.promises.readdir(modePath, { withFileTypes: true });
      } catch (err) {
        logger.error({ err, modePath }, 'Failed to scan simulation history');
        continue;
      }

      for (const batchDir of batchDirs) {
        if (!batchDir.isDirectory()) continue;
        const dirPath = path.join(modePath, batchDir.name);
        const batch = await this.readDiskBatch(dirPath);
        if (batch) batches.set(batch.batchId, batch);
      }
    }

    return batches;
  }

  /** Read one batch directory's config (+ summary, if finished). Null for a malformed one. */
  private async readDiskBatch(dirPath: string): Promise<DiskBatch | null> {
    let configData: { batchId?: unknown; config?: SimulationConfig; startedAt?: string };
    try {
      configData = JSON.parse(
        await fs.promises.readFile(path.join(dirPath, 'batch_config.json'), 'utf-8'),
      );
    } catch {
      // Missing or malformed batch_config.json — skip the directory
      return null;
    }
    if (typeof configData?.batchId !== 'string' || !configData.config) return null;

    const summary = await this.readSummary(dirPath);
    return {
      batchId: configData.batchId,
      dirPath,
      config: configData.config,
      startedAt: configData.startedAt ?? '',
      status: (summary?.status as SimulationBatchStatus['status'] | undefined) || 'error',
      gamesCompleted: (summary?.totalGamesRun as number | undefined) || 0,
      completedAt: (summary?.completedAt as string | undefined) || null,
    };
  }

  private async readSummary(dirPath: string): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(
        await fs.promises.readFile(path.join(dirPath, 'batch_summary.json'), 'utf-8'),
      );
    } catch {
      // Not finished yet, or malformed
      return null;
    }
  }

  cleanup(): void {
    // Remove finished runners from memory (keep only last 10)
    const entries = Array.from(this.runners.entries());
    const finished = entries.filter(([, r]) => !r.isActive());
    if (finished.length > 10) {
      const toRemove = finished.slice(0, finished.length - 10);
      for (const [id] of toRemove) {
        this.runners.delete(id);
      }
    }
  }

  private setupRunnerAutoAdvance(runner: SimulationRunner): void {
    runner.on('completed', () => {
      // batch_summary.json has just been written — the cached scan is stale. (audit E3)
      this.invalidateDiskIndex();
      this.processQueue();
    });
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;

    // Ensure no runner is still active
    for (const runner of this.runners.values()) {
      if (runner.isActive()) return;
    }

    const entry = this.queue.shift()!;
    const runner = new SimulationRunner(entry.config, entry.batchId);
    this.runners.set(entry.batchId, runner);
    this.setupRunnerAutoAdvance(runner);

    // Broadcast events to all admin sockets
    this.setupRunnerBroadcast(runner, entry.batchId);

    logger.info(
      {
        batchId: entry.batchId,
        adminId: entry.adminId,
        config: entry.config.gameMode,
        totalGames: entry.config.totalGames,
        remainingQueue: this.queue.length,
      },
      'Queued simulation batch started',
    );

    this.broadcastQueueUpdate();

    runner.run().catch((err) => {
      logger.error({ err, batchId: entry.batchId }, 'Queued simulation runner crashed');
    });
  }

  private setupRunnerBroadcast(runner: SimulationRunner, batchId: string): void {
    try {
      const io = getIO();
      runner.on('progress', (status: SimulationBatchStatus) => {
        io.to('sim:admin').emit('sim:progress', status);
      });
      runner.on('gameResult', (gameResult: SimulationGameResult) => {
        io.to('sim:admin').emit('sim:gameResult', { batchId, result: gameResult });
      });
      runner.on('completed', (status: SimulationBatchStatus) => {
        io.to('sim:admin').emit('sim:completed', { batchId, status });
      });
    } catch {
      // IO not available yet
    }
  }

  private broadcastQueueUpdate(): void {
    try {
      const io = getIO();
      const queueStatus = this.queue.map((e, i) => ({
        batchId: e.batchId,
        queuePosition: i + 1,
        config: e.config,
        queuedAt: e.queuedAt.toISOString(),
      }));
      io.to('sim:admin').emit('sim:queueUpdate', { queue: queueStatus });
    } catch {
      // IO not available yet
    }
  }
}
