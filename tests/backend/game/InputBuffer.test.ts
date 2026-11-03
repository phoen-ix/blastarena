import { describe, it, expect, beforeEach } from 'vitest';
import { InputBuffer } from '../../../backend/src/game/InputBuffer';
import { PlayerInput } from '@blast-arena/shared';

function makeInput(seq: number, overrides?: Partial<PlayerInput>): PlayerInput {
  return {
    seq,
    direction: 'up',
    action: null,
    tick: seq,
    ...overrides,
  };
}

describe('InputBuffer', () => {
  let buffer: InputBuffer;

  beforeEach(() => {
    buffer = new InputBuffer();
  });

  it('should return all buffered inputs in order via getInputs', () => {
    buffer.addInput(1, makeInput(1, { direction: 'up' }));
    buffer.addInput(1, makeInput(2, { direction: 'down' }));
    buffer.addInput(1, makeInput(3, { direction: 'left' }));

    const inputs = buffer.getInputs(1);
    expect(inputs).toHaveLength(3);
    expect(inputs[0].seq).toBe(1);
    expect(inputs[1].seq).toBe(2);
    expect(inputs[2].seq).toBe(3);
  });

  it('should clear the buffer after getInputs retrieval', () => {
    buffer.addInput(1, makeInput(1));
    buffer.addInput(1, makeInput(2));

    const first = buffer.getInputs(1);
    expect(first).toHaveLength(2);

    const second = buffer.getInputs(1);
    expect(second).toHaveLength(0);
  });

  it('should return empty array for unknown player via getInputs', () => {
    const inputs = buffer.getInputs(999);
    expect(inputs).toEqual([]);
  });

  it('should return only the last input via getLatestInput', () => {
    buffer.addInput(1, makeInput(1, { direction: 'up' }));
    buffer.addInput(1, makeInput(2, { direction: 'down' }));
    buffer.addInput(1, makeInput(3, { direction: 'right' }));

    const latest = buffer.getLatestInput(1);
    expect(latest).not.toBeNull();
    expect(latest!.seq).toBe(3);
    expect(latest!.direction).toBe('right');
  });

  it('should clear the buffer after getLatestInput retrieval', () => {
    buffer.addInput(1, makeInput(1));
    buffer.addInput(1, makeInput(2));

    buffer.getLatestInput(1);

    const remaining = buffer.getInputs(1);
    expect(remaining).toHaveLength(0);
  });

  it('should return null for unknown player via getLatestInput', () => {
    const result = buffer.getLatestInput(999);
    expect(result).toBeNull();
  });

  it('should drop oldest inputs when buffer exceeds 60 entries', () => {
    for (let i = 1; i <= 65; i++) {
      buffer.addInput(1, makeInput(i));
    }

    const inputs = buffer.getInputs(1);
    expect(inputs).toHaveLength(60);
    // Oldest 5 should have been dropped; first remaining is seq 6
    expect(inputs[0].seq).toBe(6);
    expect(inputs[59].seq).toBe(65);
  });

  it('should maintain independent buffers per player', () => {
    buffer.addInput(1, makeInput(10, { direction: 'up' }));
    buffer.addInput(2, makeInput(20, { direction: 'down' }));
    buffer.addInput(1, makeInput(11, { direction: 'left' }));

    const player1 = buffer.getInputs(1);
    const player2 = buffer.getInputs(2);

    expect(player1).toHaveLength(2);
    expect(player1[0].seq).toBe(10);
    expect(player1[1].seq).toBe(11);

    expect(player2).toHaveLength(1);
    expect(player2[0].seq).toBe(20);
  });

  it('should remove a specific player buffer via clear', () => {
    buffer.addInput(1, makeInput(1));
    buffer.addInput(2, makeInput(2));

    buffer.clear(1);

    expect(buffer.getInputs(1)).toHaveLength(0);
    expect(buffer.getInputs(2)).toHaveLength(1);
  });

  it('should remove all buffers via clearAll', () => {
    buffer.addInput(1, makeInput(1));
    buffer.addInput(2, makeInput(2));
    buffer.addInput(3, makeInput(3));

    buffer.clearAll();

    expect(buffer.getInputs(1)).toHaveLength(0);
    expect(buffer.getInputs(2)).toHaveLength(0);
    expect(buffer.getInputs(3)).toHaveLength(0);
  });
});
