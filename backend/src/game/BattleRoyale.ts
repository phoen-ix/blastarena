import { ZoneState } from '@blast-arena/shared';
import {
  BR_ZONE_INITIAL_DELAY_SECONDS,
  BR_ZONE_SHRINK_INTERVAL_SECONDS,
  BR_ZONE_SHRINK_AMOUNT,
  BR_ZONE_DAMAGE_PER_TICK,
  BR_ZONE_MIN_RADIUS,
  TICK_RATE,
} from '@blast-arena/shared';

export class BattleRoyaleZone {
  private centerX: number;
  private centerY: number;
  private currentRadius: number;
  private targetRadius: number;
  private shrinkRate: number = 0.1;
  private damagePerTick: number = BR_ZONE_DAMAGE_PER_TICK;
  private nextShrinkTick: number;

  constructor(mapWidth: number, mapHeight: number) {
    this.centerX = Math.floor(mapWidth / 2);
    this.centerY = Math.floor(mapHeight / 2);
    this.currentRadius = Math.max(mapWidth, mapHeight);
    this.targetRadius = this.currentRadius;
    this.nextShrinkTick = BR_ZONE_INITIAL_DELAY_SECONDS * TICK_RATE;
  }

  tick(currentTick: number): void {
    // Shrink towards target
    if (this.currentRadius > this.targetRadius) {
      this.currentRadius = Math.max(this.targetRadius, this.currentRadius - this.shrinkRate);
    }

    // Check if it's time for next shrink phase
    if (currentTick >= this.nextShrinkTick && this.targetRadius > BR_ZONE_MIN_RADIUS) {
      this.targetRadius = Math.max(BR_ZONE_MIN_RADIUS, this.targetRadius - BR_ZONE_SHRINK_AMOUNT);
      this.nextShrinkTick = currentTick + BR_ZONE_SHRINK_INTERVAL_SECONDS * TICK_RATE;
    }
  }

  isInsideZone(x: number, y: number): boolean {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    return Math.sqrt(dx * dx + dy * dy) <= this.currentRadius;
  }

  getDamagePerTick(): number {
    return this.damagePerTick;
  }

  toState(): ZoneState {
    return {
      currentRadius: this.currentRadius,
      targetRadius: this.targetRadius,
      centerX: this.centerX,
      centerY: this.centerY,
      shrinkRate: this.shrinkRate,
      damagePerTick: this.damagePerTick,
      nextShrinkTick: this.nextShrinkTick,
    };
  }
}
