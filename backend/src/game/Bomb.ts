import { BombState, Position, Direction } from '@blast-arena/shared';
import { BOMB_TIMER_TICKS } from '@blast-arena/shared';
import { v4 as uuidv4 } from 'uuid';

export class Bomb {
  public readonly id: string;
  public position: Position;
  public readonly ownerId: number;
  public readonly fireRange: number;
  public ticksRemaining: number;
  public sliding: Direction | null = null;

  constructor(position: Position, ownerId: number, fireRange: number) {
    this.id = uuidv4();
    this.position = { ...position };
    this.ownerId = ownerId;
    this.fireRange = fireRange;
    this.ticksRemaining = BOMB_TIMER_TICKS;
  }

  tick(): boolean {
    this.ticksRemaining--;
    return this.ticksRemaining <= 0;
  }

  toState(): BombState {
    return {
      id: this.id,
      position: { ...this.position },
      ownerId: this.ownerId,
      fireRange: this.fireRange,
      ticksRemaining: this.ticksRemaining,
    };
  }
}
