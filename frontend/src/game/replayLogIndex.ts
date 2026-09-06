/**
 * Sorted tick index for the replay log panel.
 *
 * `highlightTick` runs on every replay tick (up to 80×/s at 4× speed) and used to walk every
 * rendered row backwards, parsing `dataset.tick` on each, to find the nearest preceding entry.
 * With the rows indexed by tick once at render time, that is two binary searches. Kept free of
 * DOM types so it can be unit-tested directly. (audit F3)
 */

export interface TickIndexed {
  tick: number;
}

/** First index whose tick is >= `tick` (== `index.length` when none is). */
export function lowerBound(index: readonly TickIndexed[], tick: number): number {
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid].tick < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose tick is > `tick` (== `index.length` when none is). */
export function upperBound(index: readonly TickIndexed[], tick: number): number {
  let lo = 0;
  let hi = index.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (index[mid].tick <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface TickRange {
  /** Half-open range [start, end) of entries at exactly `tick`. Empty when none. */
  start: number;
  end: number;
  /** Index of the closest entry at or before `tick`, or -1 when every entry is later. */
  nearest: number;
}

/** Entries at `tick`, plus the nearest preceding entry for scrolling when there are none. */
export function findTickRange(index: readonly TickIndexed[], tick: number): TickRange {
  const end = upperBound(index, tick);
  const start = lowerBound(index, tick);
  return { start, end, nearest: end - 1 };
}

/** Stable sort by tick; the log is chronological already, so this is normally a no-op pass. */
export function sortByTick<T extends TickIndexed>(entries: T[]): T[] {
  return entries.sort((a, b) => a.tick - b.tick);
}
