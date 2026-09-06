import { ExplosionState, Position } from '@blast-arena/shared';
import { EXPLOSION_DURATION_TICKS } from '@blast-arena/shared';
import { v4 as uuidv4 } from 'uuid';

export class Explosion {
  public readonly id: string;
  public readonly cells: Position[];
  public readonly ownerId: number;
  public ticksRemaining: number;
  private readonly cellSet: Set<string>;
  /** Set once the cell list has gone out in a tick state — see toTickState(). */
  private cellsSent = false;

  constructor(cells: Position[], ownerId: number) {
    this.id = uuidv4();
    this.cells = cells.map((c) => ({ ...c }));
    this.ownerId = ownerId;
    this.ticksRemaining = EXPLOSION_DURATION_TICKS;
    this.cellSet = new Set(this.cells.map((c) => `${c.x},${c.y}`));
  }

  tick(): boolean {
    this.ticksRemaining--;
    return this.ticksRemaining <= 0;
  }

  containsCell(x: number, y: number): boolean {
    return this.cellSet.has(`${x},${y}`);
  }

  toState(): ExplosionState {
    return {
      id: this.id,
      cells: this.cells,
      ownerId: this.ownerId,
      ticksRemaining: this.ticksRemaining,
    };
  }

  /**
   * Per-tick form: the cell list is immutable for the explosion's lifetime, so it is sent once —
   * on the first tick the explosion appears — and as an empty array on the remaining ~9 ticks. A
   * client keeps the cells by id (an explosion always has at least its origin cell, so an empty
   * list is unambiguous). This used to re-send every cell of every live explosion on every tick.
   * (audit TICK-PAYLOAD-1)
   */
  toTickState(): ExplosionState {
    const cells = this.cellsSent ? EMPTY_CELLS : this.cells;
    this.cellsSent = true;
    return {
      id: this.id,
      cells,
      ownerId: this.ownerId,
      ticksRemaining: this.ticksRemaining,
    };
  }
}

const EMPTY_CELLS: Position[] = [];
