import { TICK_RATE } from '@blast-arena/shared';
import { GameStateManager } from './GameState';
import { logger } from '../utils/logger';

// Ticks to wait in countdown before switching to 'playing'
// Matches the frontend CountdownOverlay: "3","2","1" shown at 600ms intervals,
// "GO!" appears at 1800ms — that's when gameplay should begin
const COUNTDOWN_TICKS = Math.round(1.8 * TICK_RATE); // 36 ticks

export class GameLoop {
  private gameState: GameStateManager;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onTick: (state: ReturnType<GameStateManager['toState']>) => void;
  private onGameOver: () => void;
  private tickRate: number;
  private running: boolean = false;
  private countdownTicksRemaining: number = COUNTDOWN_TICKS;

  constructor(
    gameState: GameStateManager,
    onTick: (state: ReturnType<GameStateManager['toState']>) => void,
    onGameOver: () => void,
    tickRate: number = TICK_RATE,
  ) {
    this.gameState = gameState;
    this.onTick = onTick;
    this.onGameOver = onGameOver;
    this.tickRate = tickRate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.countdownTicksRemaining = COUNTDOWN_TICKS;

    const tickMs = 1000 / this.tickRate;

    this.interval = setInterval(() => {
      try {
        // Countdown phase: broadcast state but don't process game ticks
        if (this.countdownTicksRemaining > 0) {
          this.countdownTicksRemaining--;
          if (this.countdownTicksRemaining <= 0) {
            this.gameState.status = 'playing';
          }
          const state = this.gameState.toTickState();
          this.onTick(state);
          return;
        }

        this.gameState.processTick();
        const state = this.gameState.toTickState();
        this.onTick(state);

        if (this.gameState.status === 'finished') {
          this.stop();
          this.onGameOver();
        }
      } catch (err) {
        logger.error({ err }, 'Game loop error');
      }
    }, tickMs);

    logger.info({ tickRate: this.tickRate }, 'Game loop started');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    logger.info('Game loop stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): GameStateManager {
    return this.gameState;
  }
}
