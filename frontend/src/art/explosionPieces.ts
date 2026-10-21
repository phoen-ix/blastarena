import { BOMB_TIMER_TICKS } from '@blast-arena/shared';
import type { Direction, Position } from '@blast-arena/shared';

export type FlameRole = 'center' | 'arm' | 'end';

export interface FlamePiece {
  x: number;
  y: number;
  role: FlameRole;
  /** Which way the arm points, outward from the centre (undefined for the centre). */
  dir?: Direction;
}

const STEP: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Shortest signed difference on a ring of `size` cells (plain difference when not wrapping). */
function delta(from: number, to: number, size: number | undefined): number {
  let d = to - from;
  if (size) {
    if (d > size / 2) d -= size;
    else if (d < -size / 2) d += size;
  }
  return d;
}

function dirFrom(dx: number, dy: number): Direction | undefined {
  if (dx === 0 && dy === 0) return undefined;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

function wrapCoord(v: number, size: number | undefined): number {
  return size ? ((v % size) + size) % size : v;
}

/**
 * Turn an explosion's cell list into drawable pieces: a centre, straight arm segments and an end
 * cap at the tip of each arm. Relies on the server's order (shared `getExplosionCells`): origin
 * first, then each arm outward, nearest cell first. Destructible cells are filtered out of the
 * list, so a pierce blast can have gaps; the cell before a gap gets an end cap.
 *
 * `wrap` gives the map size on toroidal maps, where an arm can cross the edge.
 */
export function explosionPieces(
  cells: readonly Position[],
  wrap?: { w: number; h: number },
): FlamePiece[] {
  if (cells.length === 0) return [];
  const center = cells[0];
  const pieces: FlamePiece[] = [{ x: center.x, y: center.y, role: 'center' }];
  const dirs: (Direction | undefined)[] = [undefined];

  for (let i = 1; i < cells.length; i++) {
    const c = cells[i];
    const prev = cells[i - 1];
    const px = delta(prev.x, c.x, wrap?.w);
    const py = delta(prev.y, c.y, wrap?.h);
    // Continuing an arm (adjacent to the previous cell, away from the centre) keeps its direction;
    // otherwise (first cell of an arm, or after a pierce gap) the direction comes from the centre.
    let dir: Direction | undefined;
    if (i > 1 && Math.abs(px) + Math.abs(py) === 1 && dirs[i - 1] === dirFrom(px, py)) {
      dir = dirs[i - 1];
    } else {
      dir = dirFrom(delta(center.x, c.x, wrap?.w), delta(center.y, c.y, wrap?.h));
    }
    dirs.push(dir);
    pieces.push({ x: c.x, y: c.y, role: 'arm', dir });
  }

  // An arm cell is the tip when the next listed cell does not continue it.
  for (let i = 1; i < pieces.length; i++) {
    const p = pieces[i];
    const next = cells[i + 1];
    const step = p.dir ? STEP[p.dir] : undefined;
    const continues =
      !!next &&
      !!step &&
      dirs[i + 1] === p.dir &&
      wrapCoord(p.x + step.x, wrap?.w) === next.x &&
      wrapCoord(p.y + step.y, wrap?.h) === next.y;
    if (!continues) p.role = 'end';
  }
  return pieces;
}

/** Remaining fuse as a fraction (1 = just placed, 0 = about to blow). Remote bombs have none. */
export function fuseFraction(ticksRemaining: number, bombType: string): number {
  if (bombType === 'remote') return 1;
  return Math.max(0, Math.min(1, ticksRemaining / BOMB_TIMER_TICKS));
}

/** Pick one of `frames` fuse frames (0 = full fuse) for a fraction from fuseFraction(). */
export function fuseFrame(fraction: number, frames: number): number {
  return Math.max(0, Math.min(frames - 1, Math.floor((1 - fraction) * frames)));
}
