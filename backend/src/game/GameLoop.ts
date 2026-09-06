import { TICK_RATE, GameState as GameStateType } from '@blast-arena/shared';
import { GameStateManager } from './GameState';
import { logger } from '../utils/logger';

// Ticks to wait in countdown before switching to 'playing'
// Matches the frontend CountdownOverlay: "3","2","1" shown at 600ms intervals,
// "GO!" appears at 1800ms — that's when gameplay should begin
const COUNTDOWN_TICKS = Math.round(1.8 * TICK_RATE); // 36 ticks

const MAX_CONSECUTIVE_ERRORS = 10;

export class GameLoop {
  private gameState: GameStateManager;
  private interval: ReturnType<typeof setInterval> | null = null;
  /**
   * Receives a serializer rather than a state: consumers that run their own per-tick logic after
   * processTick (the campaign) serialize once, afterwards, instead of discarding the state built
   * here and building a second, full one. toTickState() also drains the tile-diff buffer, so it
   * must run exactly once per tick — by whoever consumes it. (audit CAMPAIGN-DOUBLE-SERIALIZE-1)
   */
  private onTick: (serialize: () => GameStateType) => void;
  private onGameOver: () => unknown;
  private tickRate: number;
  private running: boolean = false;
  private countdownTicksRemaining: number = COUNTDOWN_TICKS;
  private skipCountdown: boolean = false;
  private consecutiveErrors: number = 0;

  constructor(
    gameState: GameStateManager,
    onTick: (serialize: () => GameStateType) => void,
    onGameOver: () => unknown,
    tickRate: number = TICK_RATE,
    skipCountdown: boolean = false,
  ) {
    this.gameState = gameState;
    this.onTick = onTick;
    this.onGameOver = onGameOver;
    this.tickRate = tickRate;
    this.skipCountdown = skipCountdown;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.countdownTicksRemaining = this.skipCountdown ? 0 : COUNTDOWN_TICKS;
    if (this.skipCountdown) {
      this.gameState.status = 'playing';
    }

    this.schedule();
    logger.info({ tickRate: this.tickRate }, 'Game loop started');
  }

  private readonly serialize = (): GameStateType => this.gameState.toTickState();

  /** Arm the interval. start()/resume()/setTickRate() used to carry three identical copies of the tick body. */
  private schedule(): void {
    this.interval = setInterval(() => this.runTick(), 1000 / this.tickRate);
  }

  /** One tick: countdown or simulation step, then broadcast; trips the circuit breaker on repeated errors. */
  private runTick(): void {
    try {
      // Countdown phase: broadcast state but don't process game ticks
      if (this.countdownTicksRemaining > 0) {
        this.countdownTicksRemaining--;
        if (this.countdownTicksRemaining <= 0) {
          this.gameState.status = 'playing';
        }
        this.onTick(this.serialize);
        return;
      }

      this.gameState.processTick();
      this.onTick(this.serialize);
      this.consecutiveErrors = 0;

      if (this.gameState.status === 'finished') {
        this.stop();
        this.fireGameOver();
      }
    } catch (err) {
      this.consecutiveErrors++;
      logger.error({ err, consecutiveErrors: this.consecutiveErrors }, 'Game loop error');
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error('Game loop circuit breaker tripped — stopping game');
        this.stop();
        this.fireGameOver();
      }
    }
  }

  /**
   * The game-over callback is async in GameRoom (DB writes, Elo, achievements). It was typed
   * `() => void` and its promise discarded, so a rejection surfaced as an unhandled rejection.
   * (audit GAME-OVER-ASYNC-1)
   */
  private fireGameOver(): void {
    try {
      const result = this.onGameOver();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch((err) =>
          logger.error({ err }, 'Game over handler failed'),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Game over handler failed');
    }
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

  pause(): void {
    if (!this.running || !this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    logger.info('Game loop paused');
  }

  resume(): void {
    if (!this.running || this.interval) return;
    this.schedule();
    logger.info('Game loop resumed');
  }

  setTickRate(newRate: number): void {
    this.tickRate = newRate;
    if (this.running && this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      this.resume();
    }
  }

  getTickRate(): number {
    return this.tickRate;
  }

  isPaused(): boolean {
    return this.running && this.interval === null;
  }

  isRunning(): boolean {
    return this.running;
  }
}
