import { describe, it, expect } from 'vitest';
import { lowerBound, upperBound, findTickRange, sortByTick } from '../../src/game/replayLogIndex';

/**
 * ReplayLogPanel.highlightTick used to scan every rendered row backwards on each replay tick.
 * It now binary-searches a sorted {tick, el} index (audit F3); these pin the search helpers.
 */

const ticks = (values: number[]) => values.map((tick) => ({ tick }));

describe('lowerBound / upperBound', () => {
  const index = ticks([1, 3, 3, 3, 7, 10]);

  it('find the half-open range of an existing tick', () => {
    expect(lowerBound(index, 3)).toBe(1);
    expect(upperBound(index, 3)).toBe(4);
  });

  it('return the insertion point for a tick that is absent', () => {
    expect(lowerBound(index, 5)).toBe(4);
    expect(upperBound(index, 5)).toBe(4);
  });

  it('handle both ends', () => {
    expect(lowerBound(index, 0)).toBe(0);
    expect(upperBound(index, 0)).toBe(0);
    expect(lowerBound(index, 10)).toBe(5);
    expect(upperBound(index, 10)).toBe(6);
    expect(lowerBound(index, 11)).toBe(6);
    expect(upperBound(index, 11)).toBe(6);
  });

  it('work on an empty index', () => {
    expect(lowerBound([], 4)).toBe(0);
    expect(upperBound([], 4)).toBe(0);
  });
});

describe('findTickRange', () => {
  const index = ticks([2, 4, 4, 9]);

  it('returns the entries at the tick and the last of them as the scroll anchor', () => {
    expect(findTickRange(index, 4)).toEqual({ start: 1, end: 3, nearest: 2 });
  });

  it('returns an empty range and the nearest preceding entry when nothing matches', () => {
    expect(findTickRange(index, 6)).toEqual({ start: 3, end: 3, nearest: 2 });
    expect(findTickRange(index, 100)).toEqual({ start: 4, end: 4, nearest: 3 });
  });

  it('reports no preceding entry before the first tick', () => {
    expect(findTickRange(index, 1)).toEqual({ start: 0, end: 0, nearest: -1 });
    expect(findTickRange([], 1)).toEqual({ start: 0, end: 0, nearest: -1 });
  });

  it('agrees with a linear scan for every tick in a range', () => {
    const idx = ticks([0, 0, 2, 5, 5, 5, 8, 13, 13, 21]);
    for (let tick = -1; tick <= 22; tick++) {
      const { start, end, nearest } = findTickRange(idx, tick);
      const linearStart = idx.findIndex((e) => e.tick >= tick);
      const expectedStart = linearStart === -1 ? idx.length : linearStart;
      const linearEnd = idx.findIndex((e) => e.tick > tick);
      const expectedEnd = linearEnd === -1 ? idx.length : linearEnd;
      let expectedNearest = -1;
      for (let i = idx.length - 1; i >= 0; i--) {
        if (idx[i].tick <= tick) {
          expectedNearest = i;
          break;
        }
      }
      expect({ start, end, nearest }).toEqual({
        start: expectedStart,
        end: expectedEnd,
        nearest: expectedNearest,
      });
    }
  });
});

describe('sortByTick', () => {
  it('orders by tick and keeps insertion order for equal ticks', () => {
    const entries = [
      { tick: 5, id: 'a' },
      { tick: 1, id: 'b' },
      { tick: 5, id: 'c' },
      { tick: 3, id: 'd' },
    ];
    expect(sortByTick(entries).map((e) => e.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});
