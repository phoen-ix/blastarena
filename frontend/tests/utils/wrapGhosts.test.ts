import { describe, it, expect } from 'vitest';
import { wrapGhostOffsets, wrapGhostPositions } from '../../src/utils/wrapGhosts';

// The open world is 51x41 tiles at 48px.
const W = 51 * 48; // 2448
const H = 41 * 48; // 1968

/** A 1280x720 viewport centred on (cx, cy) — matches a camera following the local player. */
const viewAt = (cx: number, cy: number, width = 1280, height = 720) => ({
  x: cx - width / 2,
  y: cy - height / 2,
  width,
  height,
});

/**
 * Geometry note: a ghost is a copy of an entity drawn one world-width/height away. When the camera
 * sits near the LEFT seam its view extends to negative x, which is where entities from the RIGHT
 * edge of the world must be drawn (at px - W). An entity's own ghost is therefore relevant to a
 * camera on the OPPOSITE seam, not to a camera sitting on top of it.
 */
describe('wrapGhostOffsets', () => {
  it('returns nothing for an entity in the middle of the world', () => {
    const cx = W / 2;
    const cy = H / 2;
    expect(wrapGhostOffsets(viewAt(cx, cy), cx, cy, W, H)).toEqual([]);
  });

  // Regression: the old threshold was worldSize / 2, which made `nearLeft || nearRight` true for
  // EVERY px (and likewise vertically), so every entity always produced one horizontal, one
  // vertical and one diagonal ghost no matter where it was. (audit WRAP-GHOST-1)
  it('returns nothing across the interior, wherever the camera is', () => {
    const view = viewAt(W / 2, H / 2);
    let ghosts = 0;
    for (let px = 0; px <= W; px += 97) {
      for (let py = 0; py <= H; py += 89) {
        ghosts += wrapGhostOffsets(view, px, py, W, H).length;
      }
    }
    // A centred camera is nowhere near a seam, so nothing needs mirroring at all.
    expect(ghosts).toBe(0);
  });

  it('draws right-edge entities on the left when the camera is at the left seam', () => {
    const view = viewAt(5, H / 2);
    const offsets = wrapGhostOffsets(view, W - 10, H / 2, W, H);
    expect(offsets).toContainEqual({ ox: -W, oy: 0 });
    expect(offsets.some((o) => o.ox === W)).toBe(false);
  });

  it('draws left-edge entities on the right when the camera is at the right seam', () => {
    const view = viewAt(W - 5, H / 2);
    const offsets = wrapGhostOffsets(view, 10, H / 2, W, H);
    expect(offsets).toContainEqual({ ox: W, oy: 0 });
    expect(offsets.some((o) => o.ox === -W)).toBe(false);
  });

  it('mirrors vertically at the top and bottom seams', () => {
    expect(wrapGhostOffsets(viewAt(W / 2, 5), W / 2, H - 10, W, H)).toContainEqual({
      ox: 0,
      oy: -H,
    });
    expect(wrapGhostOffsets(viewAt(W / 2, H - 5), W / 2, 10, W, H)).toContainEqual({
      ox: 0,
      oy: H,
    });
  });

  it('produces the diagonal copy when the camera sits in a corner', () => {
    const offsets = wrapGhostOffsets(viewAt(5, 5), W - 10, H - 10, W, H);
    expect(offsets).toContainEqual({ ox: -W, oy: 0 });
    expect(offsets).toContainEqual({ ox: 0, oy: -H });
    expect(offsets).toContainEqual({ ox: -W, oy: -H });
    expect(offsets).toHaveLength(3);
  });

  it('never produces more than the three wrapped copies for a normal viewport', () => {
    const view = viewAt(5, 5);
    for (let px = 0; px <= W; px += 61) {
      for (let py = 0; py <= H; py += 59) {
        expect(wrapGhostOffsets(view, px, py, W, H).length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('uses the margin to bring a ghost in slightly before it scrolls into view', () => {
    // Camera at the left seam; this entity's ghost lands just outside the right edge of the view.
    const view = viewAt(5, H / 2);
    const px = W - 700;
    expect(wrapGhostOffsets(view, px, H / 2, W, H, 0)).toEqual([]);
    expect(wrapGhostOffsets(view, px, H / 2, W, H, 200)).toContainEqual({ ox: -W, oy: 0 });
  });

  it('returns nothing for a degenerate world size', () => {
    expect(wrapGhostOffsets(viewAt(0, 0), 0, 0, 0, 0)).toEqual([]);
    expect(wrapGhostOffsets(viewAt(0, 0), 0, 0, -1, -1)).toEqual([]);
  });

  it('handles a camera larger than the world by mirroring both ways', () => {
    const view = { x: -W, y: -H, width: 3 * W, height: 3 * H };
    const offsets = wrapGhostOffsets(view, W / 2, H / 2, W, H);
    expect(offsets).toHaveLength(8); // 2 horizontal + 2 vertical + 4 diagonal
  });
});

describe('wrapGhostPositions', () => {
  it('always includes the canonical position first', () => {
    const positions = wrapGhostPositions(viewAt(W / 2, H / 2), W / 2, H / 2, W, H);
    expect(positions[0]).toEqual({ x: W / 2, y: H / 2 });
    expect(positions).toHaveLength(1);
  });

  it('adds the wrapped copies when the camera is at the opposite seam', () => {
    const positions = wrapGhostPositions(viewAt(5, 5), W - 10, H - 10, W, H);
    expect(positions[0]).toEqual({ x: W - 10, y: H - 10 });
    expect(positions).toHaveLength(4);
    expect(positions).toContainEqual({ x: -10, y: -10 });
  });
});
