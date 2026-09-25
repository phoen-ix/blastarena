import { ZoneState } from '@blast-arena/shared';
import {
  BR_ZONE_INITIAL_DELAY_SECONDS,
  BR_ZONE_SHRINK_AMOUNT,
  BR_ZONE_MIN_RADIUS,
  TICK_RATE,
} from '@blast-arena/shared';

/** The zone reaches its minimum radius at this fraction of the round. */
const SHRINK_COMPLETE_FRACTION = 0.85;
/** The initial grace period never takes more than this fraction of the round. */
const MAX_DELAY_FRACTION = 0.2;

export class BattleRoyaleZone {
  private centerX: number;
  private centerY: number;
  private currentRadius: number;
  private targetRadius: number;
  private shrinkRate: number = 0.1;
  private nextShrinkTick: number;
  private readonly shrinkIntervalTicks: number;

  /**
   * The zone starts at the map's half-diagonal (just enough to cover every tile) and shrinks on a
   * schedule derived from the round length, so it reaches BR_ZONE_MIN_RADIUS at ~85% of the round.
   *
   * It used to start at max(width, height) — a full dimension, about twice the half-diagonal — and
   * shrink one tile every 15 s regardless of round length: on the default 39x31 map the zone first
   * touched the playable corners around 4:30 of a 5:00 round.
   */
  constructor(mapWidth: number, mapHeight: number, roundTimeSeconds: number = 300) {
    this.centerX = Math.floor(mapWidth / 2);
    this.centerY = Math.floor(mapHeight / 2);
    this.currentRadius = Math.ceil(Math.hypot(mapWidth, mapHeight) / 2);
    this.targetRadius = this.currentRadius;

    const delaySeconds = Math.min(
      BR_ZONE_INITIAL_DELAY_SECONDS,
      roundTimeSeconds * MAX_DELAY_FRACTION,
    );
    const shrinkSeconds = roundTimeSeconds * SHRINK_COMPLETE_FRACTION - delaySeconds;
    const steps = Math.max(
      1,
      Math.ceil((this.currentRadius - BR_ZONE_MIN_RADIUS) / BR_ZONE_SHRINK_AMOUNT),
    );
    this.shrinkIntervalTicks = Math.max(1, Math.floor((shrinkSeconds * TICK_RATE) / steps));
    this.nextShrinkTick = Math.round(delaySeconds * TICK_RATE);
  }

  tick(currentTick: number): void {
    // Shrink towards target
    if (this.currentRadius > this.targetRadius) {
      this.currentRadius = Math.max(this.targetRadius, this.currentRadius - this.shrinkRate);
    }

    // Check if it's time for next shrink phase
    if (currentTick >= this.nextShrinkTick && this.targetRadius > BR_ZONE_MIN_RADIUS) {
      this.targetRadius = Math.max(BR_ZONE_MIN_RADIUS, this.targetRadius - BR_ZONE_SHRINK_AMOUNT);
      this.nextShrinkTick = currentTick + this.shrinkIntervalTicks;
    }
  }

  isInsideZone(x: number, y: number): boolean {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    return Math.sqrt(dx * dx + dy * dy) <= this.currentRadius;
  }

  toState(): ZoneState {
    return {
      currentRadius: this.currentRadius,
      targetRadius: this.targetRadius,
      centerX: this.centerX,
      centerY: this.centerY,
      shrinkRate: this.shrinkRate,
      nextShrinkTick: this.nextShrinkTick,
    };
  }
}
