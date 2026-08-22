/** A camera's visible world rectangle. Matches the shape of Phaser's `camera.worldView`. */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which wrapped copies of an entity need to be drawn for a seamless toroidal map.
 *
 * The open world wraps, so an entity near the left edge must also appear off the right edge and
 * vice versa. Every renderer decided this with `threshold = worldSize / 2`:
 *
 *   const nearLeft  = px < w / 2;
 *   const nearRight = px > w - w / 2;   // === px > w / 2
 *
 * Those two are exhaustive — for any px one of them is true — and the same held vertically, so
 * EVERY entity always produced one horizontal, one vertical and one diagonal ghost, regardless of
 * where it actually was. In the open world that meant ~3 ghost sprites per player at 32 players,
 * each with its own name label, team indicator and shield Graphics redrawn every frame, for copies
 * that were nearly always off screen.
 *
 * A ghost is only worth drawing if it would actually land inside the camera's view, which is what
 * this computes. Far from a seam it returns an empty array. (audit WRAP-GHOST-1)
 *
 * @param margin extra slack around the view, so a ghost appears just before it scrolls in
 *               (pass the entity's display size).
 */
export function wrapGhostOffsets(
  view: ViewRect,
  px: number,
  py: number,
  worldWidth: number,
  worldHeight: number,
  margin = 0,
): { ox: number; oy: number }[] {
  if (worldWidth <= 0 || worldHeight <= 0) return [];

  const left = view.x - margin;
  const right = view.x + view.width + margin;
  const top = view.y - margin;
  const bottom = view.y + view.height + margin;

  const dxs: number[] = [];
  if (px + worldWidth >= left && px + worldWidth <= right) dxs.push(worldWidth);
  if (px - worldWidth >= left && px - worldWidth <= right) dxs.push(-worldWidth);

  const dys: number[] = [];
  if (py + worldHeight >= top && py + worldHeight <= bottom) dys.push(worldHeight);
  if (py - worldHeight >= top && py - worldHeight <= bottom) dys.push(-worldHeight);

  const offsets: { ox: number; oy: number }[] = [];
  for (const ox of dxs) offsets.push({ ox, oy: 0 });
  for (const oy of dys) offsets.push({ ox: 0, oy });
  for (const ox of dxs) for (const oy of dys) offsets.push({ ox, oy });
  return offsets;
}

/** Positions (not offsets) at which a wrapped entity should be drawn, canonical position first. */
export function wrapGhostPositions(
  view: ViewRect,
  px: number,
  py: number,
  worldWidth: number,
  worldHeight: number,
  margin = 0,
): { x: number; y: number }[] {
  const positions = [{ x: px, y: py }];
  for (const { ox, oy } of wrapGhostOffsets(view, px, py, worldWidth, worldHeight, margin)) {
    positions.push({ x: px + ox, y: py + oy });
  }
  return positions;
}
