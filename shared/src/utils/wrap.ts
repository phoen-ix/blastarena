/** Wrap x-coordinate for toroidal map */
export function wrapX(x: number, width: number): number {
  return ((x % width) + width) % width;
}

/** Wrap y-coordinate for toroidal map */
export function wrapY(y: number, height: number): number {
  return ((y % height) + height) % height;
}
