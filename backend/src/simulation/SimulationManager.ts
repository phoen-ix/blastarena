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

interface QueueEntry {
  batchId: string;
  config: SimulationConfig;
  adminId: number;
  queuedAt: Date;
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
      // Start immediately
      const runner = new SimulationRunner(config, batchId);
      this.runners.set(batchId, runner);
      this.setupRunnerAutoAdvance(runner);

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

  getHistory(
    page: number = 1,
    limit: number = 20,
  ): { batches: SimulationBatchStatus[]; total: number } {
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

    // Scan disk for past batches not in memory
    const memoryBatchIds = new Set([...this.runners.keys(), ...this.queue.map((e) => e.batchId)]);
    try {
      if (!fs.existsSync(SIM_LOG_DIR)) {
        // Same ordering as the main path below. This used to sort by startedAt alone, so before
        // any batch had been written to disk the queue came back newest-first instead of in queue
        // order — queuePosition 2 ahead of 1 whenever two batches were queued in different
        // milliseconds, and in queue order whenever they happened to land in the same one. That
        // is a real ordering bug in the admin history view, and the reason the test covering it
        // failed intermittently. (audit SIMHISTORY-ORDER-1)
        history.sort(compareHistoryEntries);
        return { batches: history.slice((page - 1) * limit, page * limit), total: history.length };
      }

      const gameModes = fs.readdirSync(SIM_LOG_DIR, { withFileTypes: true });
      for (const modeDir of gameModes) {
        if (!modeDir.isDirectory()) continue;
        const modePath = path.join(SIM_LOG_DIR, modeDir.name);
        const batchDirs = fs.readdirSync(modePath, { withFileTypes: true });

        for (const batchDir of batchDirs) {
          if (!batchDir.isDirectory()) continue;
          const configPath = path.join(modePath, batchDir.name, 'batch_config.json');
          const summaryPath = path.join(modePath, batchDir.name, 'batch_summary.json');

          if (!fs.existsSync(configPath)) continue;

          try {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            const diskBatchId = configData.batchId;

            // Skip if already in memory
            if (memoryBatchIds.has(diskBatchId)) continue;

            let status: SimulationBatchStatus['status'] = 'error';
            let gamesCompleted = 0;
            let completedAt: string | null = null;

            if (fs.existsSync(summaryPath)) {
              const summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
              status = summaryData.status || 'completed';
              gamesCompleted = summaryData.totalGamesRun || 0;
              completedAt = summaryData.completedAt || null;
            }

            history.push({
              batchId: diskBatchId,
              config: configData.config,
              status,
              gamesCompleted,
              totalGames: configData.config.totalGames,
              currentGameTick: null,
              currentGameMaxTicks: null,
              startedAt: configData.startedAt,
              completedAt,
            });
          } catch {
            // Skip malformed config files
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to scan simulation history');
    }

    history.sort(compareHistoryEntries);

    return { batches: history.slice((page - 1) * limit, page * limit), total: history.length };
  }

  getBatchResults(
    batchId: string,
  ): { results: SimulationGameResult[]; summary: SimulationBatchStatus } | null {
    // Check in-memory first
    const runner = this.runners.get(batchId);
    if (runner) {
      return { results: runner.getResults(), summary: runner.getStatus() };
    }

    // Check disk
    try {
      if (!fs.existsSync(SIM_LOG_DIR)) return null;

      const gameModes = fs.readdirSync(SIM_LOG_DIR, { withFileTypes: true });
      for (const modeDir of gameModes) {
        if (!modeDir.isDirectory()) continue;
        const modePath = path.join(SIM_LOG_DIR, modeDir.name);
        const batchDirs = fs.readdirSync(modePath, { withFileTypes: true });

        for (const batchDir of batchDirs) {
          if (!batchDir.isDirectory()) continue;
          const summaryPath = path.join(modePath, batchDir.name, 'batch_summary.json');
          if (!fs.existsSync(summaryPath)) continue;

          try {
            const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
            if (summary.batchId === batchId) {
              return { results: summary.results || [], summary };
            }
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // Not found
    }

    return null;
  }

  async getSimulationReplay(batchId: string, gameIndex: number): Promise<ReplayData | null> {
    // Find the batch directory on disk
    try {
      if (!fs.existsSync(SIM_LOG_DIR)) return null;

      const gameModes = fs.readdirSync(SIM_LOG_DIR, { withFileTypes: true });
      for (const modeDir of gameModes) {
        if (!modeDir.isDirectory()) continue;
        const modePath = path.join(SIM_LOG_DIR, modeDir.name);
        const batchDirs = fs.readdirSync(modePath, { withFileTypes: true });

        for (const batchDir of batchDirs) {
          if (!batchDir.isDirectory()) continue;
          const configPath = path.join(modePath, batchDir.name, 'batch_config.json');
          if (!fs.existsSync(configPath)) continue;

          try {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (configData.batchId !== batchId) continue;

            // Found the batch dir — look for replay file starting with gameIndex_
            const batchPath = path.join(modePath, batchDir.name);
            const files = fs.readdirSync(batchPath);
            const replayFile = files.find(
              (f) => f.startsWith(`${gameIndex}_`) && f.endsWith('.replay.json.gz'),
            );
            if (!replayFile) return null;

            const compressed = fs.readFileSync(path.join(batchPath, replayFile));
            const decompressed = await gunzip(compressed);
            return JSON.parse(decompressed.toString()) as ReplayData;
          } catch {
            // Skip malformed
          }
        }
      }
    } catch (err) {
      logger.error({ err, batchId, gameIndex }, 'Failed to load simulation replay');
    }

    return null;
  }

  deleteBatch(batchId: string): boolean {
    // Check queue first — no disk cleanup needed
    if (this.removeFromQueue(batchId)) {
      return true;
    }

    // Remove from memory
    this.runners.delete(batchId);

    // Find and delete from disk
    try {
      if (!fs.existsSync(SIM_LOG_DIR)) return false;

      const gameModes = fs.readdirSync(SIM_LOG_DIR, { withFileTypes: true });
      for (const modeDir of gameModes) {
        if (!modeDir.isDirectory()) continue;
        const modePath = path.join(SIM_LOG_DIR, modeDir.name);
        const batchDirs = fs.readdirSync(modePath, { withFileTypes: true });

        for (const batchDir of batchDirs) {
          if (!batchDir.isDirectory()) continue;
          const configPath = path.join(modePath, batchDir.name, 'batch_config.json');
          if (!fs.existsSync(configPath)) continue;

          try {
            const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (configData.batchId === batchId) {
              const dirPath = path.join(modePath, batchDir.name);
              fs.rmSync(dirPath, { recursive: true, force: true });
              logger.info({ batchId, path: dirPath }, 'Simulation batch deleted from disk');
              return true;
            }
          } catch {
            // Skip malformed
          }
        }
      }
    } catch (err) {
      logger.error({ err, batchId }, 'Failed to delete simulation batch');
    }

    return false;
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
