import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  ackOf,
  validateSocket,
  createRoomRequestSchema,
} from '../../../backend/src/utils/socketValidation';

type Ack = (res: { success: boolean; error?: string }) => void;

/**
 * Socket.io passes an ack only when the client asked for one. Handlers called `callback(...)`
 * unconditionally, so a client emitting without an ack (or with a non-function in that position)
 * raised an uncaught TypeError, even before the rate limiter. (audit K1)
 */
describe('ackOf', () => {
  it('returns the client ack when there is one', () => {
    const cb = vi.fn<Ack>();
    ackOf(cb)({ success: true });
    expect(cb).toHaveBeenCalledWith({ success: true });
  });

  it.each([undefined, null, 'str', 42, {}])('turns %s into a callable no-op', (value) => {
    const ack = ackOf(value as unknown as Ack | undefined);
    expect(() => ack({ success: false })).not.toThrow();
  });
});

describe('validateSocket', () => {
  const schema = z.object({ n: z.number() });

  it('answers the ack on invalid input', () => {
    const cb = vi.fn<Ack>();
    expect(validateSocket(schema, { n: 'x' }, cb)).toBeNull();
    expect(cb).toHaveBeenCalledWith({ success: false, error: 'Invalid input' });
  });

  it('does not throw when the "callback" the client sent is not a function', () => {
    expect(validateSocket(schema, {}, 'not-a-function' as unknown as Ack)).toBeNull();
  });
});

describe('createRoomRequestSchema map size', () => {
  const request = (mapWidth: number, mapHeight: number) => ({
    name: 'Room',
    config: { gameMode: 'ffa', maxPlayers: 4, mapWidth, mapHeight, roundTime: 180 },
  });

  it('accepts odd sizes from 9 to 51', () => {
    for (const size of [9, 21, 31, 39, 51]) {
      expect(createRoomRequestSchema.safeParse(request(size, size)).success).toBe(true);
    }
  });

  // Maps are a pillar grid with border walls, so both dimensions must be odd, as
  // validateCustomMap() in shared mapValidation requires. (audit K11)
  it.each([
    [10, 11],
    [11, 10],
    [50, 51],
    [7, 9],
    [53, 51],
  ])('rejects %i x %i', (w, h) => {
    expect(createRoomRequestSchema.safeParse(request(w, h)).success).toBe(false);
  });
});
