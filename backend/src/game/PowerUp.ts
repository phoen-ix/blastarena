import { PowerUpState, Position, PowerUpType } from '@blast-arena/shared';
import { randomUUID } from 'crypto';

export class PowerUp {
  public readonly id: string;
  public readonly position: Position;
  public readonly type: PowerUpType;

  constructor(position: Position, type: PowerUpType) {
    this.id = randomUUID();
    this.position = { ...position };
    this.type = type;
  }

  toState(): PowerUpState {
    return {
      id: this.id,
      position: { ...this.position },
      type: this.type,
    };
  }
}
