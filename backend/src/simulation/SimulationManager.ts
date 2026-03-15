import * as fs from 'fs';
import * as path from 'path';
import { SimulationConfig, SimulationBatchStatus } from '@blast-arena/shared';
import { SimulationRunner } from './SimulationRunner';
import { logger } from '../utils/logger';

const SIM_LOG_DIR = process.env.SIMULATION_LOG_DIR || '/app/simulations';

export class SimulationManager {
  private runners: Map<string, SimulationRunner> = new Map();
  private batchCounter: number = 0;

  startBatch(config: SimulationConfig, adminId: number): { batchId: string } | { error: string } {
    // Guard: max 1 active batch
    for (const runner of this.runners.values()) {
      if (runner.isActive()) {
        return { error: 'A simulation batch is already running. Cancel it first.' };
      }
    }

    const batchId = `sim_${Date.now()}_${++this.batchCounter}`;
    const runner = new SimulationRunner(config, batchId);
    this.runners.set(batchId, runner);

    logger.info(
      { batchId, adminId, config: config.gameMode, totalGames: config.totalGames },
      'Simulation batch created',
    );

    // Run asynchronously (don't await)
    runner.run().catch((err) => {
      logger.error({ err, batchId }, 'Simulation runner crashed');
    });

    return { batchId };
  }

  cancelBatch(batchId: string): boolean {
    const runner = this.runners.get(batchId);
    if (!runner || !runner.isActive()) return false;
    runner.cancel();
    return true;
  }

  getBatch(batchId: string): SimulationRunner | undefined {
    return this.runners.get(batchId);
  }

  getActiveBatches(): SimulationBatchStatus[] {
    const statuses: SimulationBatchStatus[] = [];
    for (const runner of this.runners.values()) {
      statuses.push(runner.getStatus());
    }
    return statuses;
  }

  getHistory(): SimulationBatchStatus[] {
    const history: SimulationBatchStatus[] = [];

    // Include in-memory batches
    for (const runner of this.runners.values()) {
      history.push(runner.getStatus());
    }

    // Scan disk for past batches not in memory
    const memoryBatchIds = new Set(this.runners.keys());
    try {
      if (!fs.existsSync(SIM_LOG_DIR)) return history;

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
            const batchId = configData.batchId;

            // Skip if already in memory
            if (memoryBatchIds.has(batchId)) continue;

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
              batchId,
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

    // Sort by startedAt descending
    history.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return history;
  }

  getBatchResults(batchId: string): { results: any[]; summary: any } | null {
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

  deleteBatch(batchId: string): boolean {
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
}
