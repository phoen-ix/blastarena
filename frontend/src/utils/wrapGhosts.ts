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

/** A wrapped copy of the map, and the tile range within it that the camera can see. */
export interface GhostTileSpan {
  /** World-pixel offset of this copy from the canonical map. */
  ox: number;
  oy: number;
  /** Inclusive tile bounds within the map grid. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The grid counterpart to `wrapGhostOffsets`.
 *
 * Entity renderers ghost a single point, so an offset is either needed or not. A tile map is a
 * whole grid, and near a seam the camera sees a *slice* of a wrapped copy — so this returns, for
 * each of the 8 surrounding copies the camera overlaps, the inclusive tile range to draw. The
 * canonical copy (0,0) is excluded: real tile sprites cover it.
 *
 * The returned ranges are disjoint in screen space, so their total tile count is bounded by the
 * number of tiles on screen — not by the map size. (audit TILE-GHOST-1)
 */
export function wrapGhostTileSpans(
  view: ViewRect,
  cols: number,
  rows: number,
  tileSize: number,
): GhostTileSpan[] {
  const worldW = cols * tileSize;
  const worldH = rows * tileSize;
  if (worldW <= 0 || worldH <= 0 || view.width <= 0 || view.height <= 0) return [];

  const spans: GhostTileSpan[] = [];
  for (let oy = -worldH; oy <= worldH; oy += worldH) {
    for (let ox = -worldW; ox <= worldW; ox += worldW) {
      if (ox === 0 && oy === 0) continue;

      // Intersect the camera with this copy's world rectangle.
      const left = Math.max(view.x, ox);
      const right = Math.min(view.x + view.width, ox + worldW);
      const top = Math.max(view.y, oy);
      const bottom = Math.min(view.y + view.height, oy + worldH);
      if (right <= left || bottom <= top) continue;

      spans.push({
        ox,
        oy,
        x0: Math.max(0, Math.floor((left - ox) / tileSize)),
        x1: Math.min(cols - 1, Math.floor((right - ox) / tileSize)),
        y0: Math.max(0, Math.floor((top - oy) / tileSize)),
        y1: Math.min(rows - 1, Math.floor((bottom - oy) / tileSize)),
      });
    }
  }
  return spans;
}

/** Stable identity of a span layout, so callers can skip rebuilds when nothing moved. */
export function ghostTileSpanKey(spans: GhostTileSpan[]): string {
  return spans.map((s) => `${s.ox},${s.oy},${s.x0},${s.y0},${s.x1},${s.y1}`).join('|');
}
