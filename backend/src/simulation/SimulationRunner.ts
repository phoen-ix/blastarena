import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { SimulationConfig, SimulationBatchStatus, SimulationGameResult } from '@blast-arena/shared';
import { SimulationGame } from './SimulationGame';
import { getIO } from '../game/registry';
import { logger } from '../utils/logger';

const SIM_LOG_DIR = process.env.SIMULATION_LOG_DIR || '/app/simulations';

export class SimulationRunner extends EventEmitter {
  readonly batchId: string;
  private config: SimulationConfig;
  private logDir: string;
  private gamesCompleted: number = 0;
  private currentGame: SimulationGame | null = null;
  private cancelled: boolean = false;
  private status: 'running' | 'completed' | 'cancelled' | 'error' = 'running';
  private results: SimulationGameResult[] = [];
  private startedAt: Date;
  private completedAt: Date | null = null;
  private baseSeed: number;
  private error: string | undefined;

  constructor(config: SimulationConfig, batchId: string) {
    super();
    this.batchId = batchId;
    this.config = config;
    this.startedAt = new Date();
    this.baseSeed = Date.now();

    // Create log directory: data/simulations/{gameMode}/batch_{timestamp}_{batchId}/
    const ts = this.startedAt.toISOString().replace(/[:.]/g, '-');
    this.logDir = path.join(SIM_LOG_DIR, config.gameMode, `batch_${ts}_${batchId}`);

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Write batch config
    fs.writeFileSync(
      path.join(this.logDir, 'batch_config.json'),
      JSON.stringify(
        {
          batchId,
          config,
          startedAt: this.startedAt.toISOString(),
          baseSeed: this.baseSeed,
        },
        null,
        2,
      ),
    );
  }

  async run(): Promise<void> {
    logger.info(
      { batchId: this.batchId, totalGames: this.config.totalGames },
      'Simulation batch started',
    );

    try {
      for (let i = 0; i < this.config.totalGames; i++) {
        if (this.cancelled) {
          this.status = 'cancelled';
          break;
        }

        const mapSeed = this.baseSeed + i;
        this.currentGame = new SimulationGame(this.config, i, this.logDir, mapSeed);

        // Set up spectate streaming
        this.currentGame.setStateCallback((state) => {
          try {
            const io = getIO();
            const room = `sim:${this.batchId}`;
            const roomSockets = io.sockets.adapter.rooms.get(room);
            if (roomSockets && roomSockets.size > 0) {
              io.to(room).emit('sim:state', { batchId: this.batchId, state });
            }
          } catch {
            // IO not available, skip broadcast
          }
        });

        // Run the game
        const result =
          this.config.speed === 'fast'
            ? await this.currentGame.runFast()
            : await this.currentGame.runRealtime();

        this.results.push(result);
        this.gamesCompleted = i + 1;
        this.currentGame.dispose(); // free isolated custom bot AIs before the next game (audit C1)
        this.currentGame = null;

        // Emit progress and result
        this.emit('gameResult', result);
        this.emit('progress', this.getStatus());

        logger.debug(
          {
            batchId: this.batchId,
            game: i + 1,
            winner: result.winnerName,
            duration: result.durationSeconds,
          },
          'Simulation game completed',
        );

        // Notify spectators of game transition (if more games remain)
        if (i + 1 < this.config.totalGames && !this.cancelled) {
          try {
            const io = getIO();
            const room = `sim:${this.batchId}`;
            io.to(room).emit('sim:gameTransition', {
              batchId: this.batchId,
              gameIndex: i + 1,
              totalGames: this.config.totalGames,
              lastResult: result,
            });
          } catch {
            // IO not available
          }

          // Brief pause between games so spectators see the transition
          if (this.config.speed === 'realtime') {
            await new Promise<void>((resolve) => setTimeout(resolve, 3000));
          } else {
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
          }
        }
      }

      if (this.status === 'running') {
        this.status = 'completed';
      }
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      logger.error({ err, batchId: this.batchId }, 'Simulation batch error');
    }

    this.completedAt = new Date();
    this.currentGame = null;

    // Write summary
    this.writeSummary();

    const finalStatus = this.getStatus();
    this.emit('completed', finalStatus);

    // Also broadcast to spectators in the socket room
    try {
      const io = getIO();
      io.to(`sim:${this.batchId}`).emit('sim:completed', {
        batchId: this.batchId,
        status: finalStatus,
      });
    } catch {
      // IO not available
    }

    logger.info(
      {
        batchId: this.batchId,
        status: this.status,
        gamesCompleted: this.gamesCompleted,
        totalGames: this.config.totalGames,
      },
      'Simulation batch finished',
    );
  }

  cancel(): void {
    this.cancelled = true;
    this.currentGame?.cancel();
  }

  getStatus(): SimulationBatchStatus {
    return {
      batchId: this.batchId,
      config: this.config,
      status: this.status,
      gamesCompleted: this.gamesCompleted,
      totalGames: this.config.totalGames,
      currentGameTick: this.currentGame?.getTick() ?? null,
      currentGameMaxTicks: this.currentGame?.getMaxTicks() ?? null,
      startedAt: this.startedAt.toISOString(),
      completedAt: this.completedAt?.toISOString() ?? null,
      error: this.error,
    };
  }

  getResults(): SimulationGameResult[] {
    return this.results;
  }

  getCurrentGameState(): ReturnType<SimulationGame['getState']> | null {
    return this.currentGame?.getState() ?? null;
  }

  isActive(): boolean {
    return this.status === 'running';
  }

  private writeSummary(): void {
    try {
      // Build win distribution
      const winCounts: Record<string, number> = {};
      let totalDuration = 0;
      let totalKills = 0;
      let totalGames = 0;

      for (const result of this.results) {
        totalGames++;
        totalDuration += result.durationSeconds;
        if (result.winnerName) {
          winCounts[result.winnerName] = (winCounts[result.winnerName] || 0) + 1;
        }
        for (const p of result.placements) {
          totalKills += p.kills;
        }
      }

      const summary = {
        batchId: this.batchId,
        config: this.config,
        status: this.status,
        startedAt: this.startedAt.toISOString(),
        completedAt: this.completedAt?.toISOString(),
        totalGamesRun: totalGames,
        totalGamesPlanned: this.config.totalGames,
        averageDurationSeconds: totalGames > 0 ? Math.round(totalDuration / totalGames) : 0,
        averageKillsPerGame: totalGames > 0 ? Math.round((totalKills / totalGames) * 10) / 10 : 0,
        winDistribution: winCounts,
        results: this.results,
      };

      fs.writeFileSync(
        path.join(this.logDir, 'batch_summary.json'),
        JSON.stringify(summary, null, 2),
      );
    } catch (err) {
      logger.error({ err, batchId: this.batchId }, 'Failed to write batch summary');
    }
  }
}
