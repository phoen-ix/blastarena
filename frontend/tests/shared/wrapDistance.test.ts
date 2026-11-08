import { describe, it, expect } from 'vitest';
import { wrapDistance } from '@blast-arena/shared';

describe('wrapDistance', () => {
  it('is the plain distance when no wrap is shorter', () => {
    expect(wrapDistance(10, 30, 100)).toBe(20);
  });

  it('goes across the edge when that is shorter', () => {
    expect(wrapDistance(5, 95, 100)).toBe(10);
  });

  it('never goes negative for a point beyond the world, unlike min(d, size - d) (audit N1)', () => {
    // Camera centre 2960 on a 2448 px world: the inline formula gave 2448 - 2936 = -488.
    const d = wrapDistance(24, 2960, 2448);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBe(488);
  });
});
