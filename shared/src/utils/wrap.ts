/** Wrap x-coordinate for toroidal map */
export function wrapX(x: number, width: number): number {
  return ((x % width) + width) % width;
}

/** Wrap y-coordinate for toroidal map */
export function wrapY(y: number, height: number): number {
  return ((y % height) + height) % height;
}

/**
 * Shortest distance between two coordinates on a ring of `size` (a toroidal axis), always in
 * [0, size / 2]. The inline `Math.min(d, size - d)` goes negative once `d` exceeds `size`, which a
 * camera position outside [0, size) easily produces.
 */
export function wrapDistance(a: number, b: number, size: number): number {
  const d = wrapX(a - b, size);
  return Math.min(d, size - d);
}
