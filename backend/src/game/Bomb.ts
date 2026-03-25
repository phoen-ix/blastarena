import { BombState, Position, Direction } from '@blast-arena/shared';
import { BOMB_TIMER_TICKS } from '@blast-arena/shared';
import { v4 as uuidv4 } from 'uuid';

export type BombType = 'normal' | 'remote' | 'pierce';

const REMOTE_BOMB_MAX_TIMER = 200; // 10 seconds safety max

export class Bomb {
  public readonly id: string;
  public position: Position;
  public readonly ownerId: number;
  public readonly fireRange: number;
  public ticksRemaining: number;
  public sliding: Direction | null = null;
  public conveyorCooldown: number = 0;
  public readonly bombType: BombType;

  constructor(
    position: Position,
    ownerId: number,
    fireRange: number,
    bombType: BombType = 'normal',
  ) {
    this.id = uuidv4();
    this.position = { ...position };
    this.ownerId = ownerId;
    this.fireRange = fireRange;
    this.bombType = bombType;
    this.ticksRemaining = bombType === 'remote' ? REMOTE_BOMB_MAX_TIMER : BOMB_TIMER_TICKS;
  }

  tick(): boolean {
    this.ticksRemaining--;
    // Remote bombs only detonate on safety timer expiry (or manual detonation)
    return this.ticksRemaining <= 0;
  }

  get isPierce(): boolean {
    return this.bombType === 'pierce';
  }

  get isRemote(): boolean {
    return this.bombType === 'remote';
  }

  toState(): BombState {
    return {
      id: this.id,
      position: { ...this.position },
      ownerId: this.ownerId,
      fireRange: this.fireRange,
      ticksRemaining: this.ticksRemaining,
      bombType: this.bombType,
    };
  }
}
