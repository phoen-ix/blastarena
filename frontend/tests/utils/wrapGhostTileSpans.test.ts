import { describe, it, expect } from 'vitest';
import { wrapGhostTileSpans, ghostTileSpanKey } from '../../src/utils/wrapGhosts';

const TILE = 32;
const COLS = 51;
const ROWS = 41;
const W = COLS * TILE; // 1632
const H = ROWS * TILE; // 1312

const view = (x: number, y: number, width = 640, height = 480) => ({ x, y, width, height });

/** Every world pixel the camera can see, expressed as its canonical tile after wrapping. */
function coveredTiles(v: ReturnType<typeof view>): Set<string> {
  const spans = wrapGhostTileSpans(v, COLS, ROWS, TILE);
  const out = new Set<string>();
  for (const s of spans) {
    for (let y = s.y0; y <= s.y1; y++) {
      for (let x = s.x0; x <= s.x1; x++) out.add(`${x},${y}`);
    }
  }
  return out;
}

/** Which tiles a *seamless* renderer would have to paint for this view, by brute force. */
function expectedTiles(v: ReturnType<typeof view>, ghostsOnly: boolean): Set<string> {
  const out = new Set<string>();
  for (let py = v.y; py < v.y + v.height; py += TILE / 2) {
    for (let px = v.x; px < v.x + v.width; px += TILE / 2) {
      // Which copy of the map is this pixel in?
      const cx = Math.floor(px / W) * W;
      const cy = Math.floor(py / H) * H;
      if (ghostsOnly && cx === 0 && cy === 0) continue;
      if (Math.abs(cx) > W || Math.abs(cy) > H) continue; // beyond the 8 neighbours
      out.add(`${Math.floor((px - cx) / TILE)},${Math.floor((py - cy) / TILE)}`);
    }
  }
  return out;
}

describe('wrapGhostTileSpans', () => {
  it('returns nothing when the camera sits well inside the canonical map', () => {
    expect(wrapGhostTileSpans(view(400, 400), COLS, ROWS, TILE)).toEqual([]);
  });

  it('returns nothing for a degenerate map or view', () => {
    expect(wrapGhostTileSpans(view(0, 0), 0, ROWS, TILE)).toEqual([]);
    expect(wrapGhostTileSpans(view(0, 0), COLS, 0, TILE)).toEqual([]);
    expect(wrapGhostTileSpans(view(0, 0, 0, 0), COLS, ROWS, TILE)).toEqual([]);
  });

  it('never includes the canonical copy — real tile sprites cover it', () => {
    const spans = wrapGhostTileSpans(view(-100, -100), COLS, ROWS, TILE);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.ox === 0 && s.oy === 0)).toBe(false);
  });

  it('draws the copy to the left when the camera crosses the left seam', () => {
    const spans = wrapGhostTileSpans(view(-160, 400), COLS, ROWS, TILE);
    expect(spans).toHaveLength(1);
    expect(spans[0].ox).toBe(-W);
    expect(spans[0].oy).toBe(0);
    // -160..0 of the left copy is its rightmost 5 tile columns.
    expect(spans[0].x1).toBe(COLS - 1);
    expect(spans[0].x0).toBe(COLS - 5);
  });

  it('draws three copies at a corner seam', () => {
    const spans = wrapGhostTileSpans(view(-64, -64), COLS, ROWS, TILE);
    const offsets = spans.map((s) => `${s.ox},${s.oy}`).sort();
    expect(offsets).toEqual([`${-W},0`, `${-W},${-H}`, `0,${-H}`].sort());
  });

  it('clamps tile bounds to the grid', () => {
    for (const v of [view(-2000, -2000, 5000, 5000), view(-10, -10), view(W - 10, H - 10)]) {
      for (const s of wrapGhostTileSpans(v, COLS, ROWS, TILE)) {
        expect(s.x0).toBeGreaterThanOrEqual(0);
        expect(s.y0).toBeGreaterThanOrEqual(0);
        expect(s.x1).toBeLessThanOrEqual(COLS - 1);
        expect(s.y1).toBeLessThanOrEqual(ROWS - 1);
        expect(s.x0).toBeLessThanOrEqual(s.x1);
        expect(s.y0).toBeLessThanOrEqual(s.y1);
      }
    }
  });

  it('covers every ghost tile a seamless render needs, at every seam', () => {
    // Pan across both seams and the corner; a gap here is a visible tear in the open world.
    const views = [
      view(-320, 400),
      view(-1, 400),
      view(W - 640, 400),
      view(W - 1, 400),
      view(400, -320),
      view(400, H - 1),
      view(-320, -320),
      view(W - 100, H - 100),
      view(-5, -5, 1920, 1080),
    ];
    for (const v of views) {
      const covered = coveredTiles(v);
      for (const tile of expectedTiles(v, true)) {
        expect(covered, `missing ${tile} for view ${JSON.stringify(v)}`).toContain(tile);
      }
    }
  });

  it('stays bounded by the screen, not the map', () => {
    // The whole point: 8 full copies would be 8 * 51 * 41 = 16,728 tiles.
    const spans = wrapGhostTileSpans(view(-320, -320, 1920, 1080), COLS, ROWS, TILE);
    const total = spans.reduce((n, s) => n + (s.x1 - s.x0 + 1) * (s.y1 - s.y0 + 1), 0);
    expect(total).toBeLessThan(1200);
  });

  it('produces a stable key that changes only when the layout does', () => {
    const a = wrapGhostTileSpans(view(-160, 400), COLS, ROWS, TILE);
    const b = wrapGhostTileSpans(view(-159, 400), COLS, ROWS, TILE);
    const c = wrapGhostTileSpans(view(-200, 400), COLS, ROWS, TILE);
    expect(ghostTileSpanKey(a)).toBe(ghostTileSpanKey(b)); // sub-tile scroll: no rebuild
    expect(ghostTileSpanKey(a)).not.toBe(ghostTileSpanKey(c)); // crossed a tile: rebuild
    expect(ghostTileSpanKey([])).toBe('');
  });
});
