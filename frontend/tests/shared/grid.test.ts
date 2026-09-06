import { describe, it, expect } from 'vitest';
import { getExplosionCells, manhattanDistance } from '@blast-arena/shared';

function makeGrid(width: number, height: number, fill: string = 'empty'): string[][] {
  return Array.from({ length: height }, () => Array(width).fill(fill));
}

describe('manhattanDistance', () => {
  it('same point = 0', () => {
    expect(manhattanDistance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('adjacent = 1', () => {
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(1);
  });

  it('diagonal = 2', () => {
    expect(manhattanDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(2);
  });

  it('arbitrary points', () => {
    expect(manhattanDistance({ x: 3, y: 7 }, { x: 10, y: 2 })).toBe(12);
  });
});

describe('getExplosionCells', () => {
  it('always includes origin', () => {
    const grid = makeGrid(5, 5);
    const cells = getExplosionCells(2, 2, 1, 5, 5, grid as any);
    expect(cells).toContainEqual({ x: 2, y: 2 });
  });

  it('expands in 4 directions up to range', () => {
    const grid = makeGrid(7, 7);
    const cells = getExplosionCells(3, 3, 2, 7, 7, grid as any);
    // Origin + 2 in each of 4 directions = 9 cells
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual({ x: 3, y: 3 }); // origin
    expect(cells).toContainEqual({ x: 3, y: 1 }); // up 2
    expect(cells).toContainEqual({ x: 3, y: 5 }); // down 2
    expect(cells).toContainEqual({ x: 1, y: 3 }); // left 2
    expect(cells).toContainEqual({ x: 5, y: 3 }); // right 2
  });

  it('stops at walls', () => {
    const grid = makeGrid(5, 5);
    grid[2][4] = 'wall'; // wall to the right at (4,2)
    const cells = getExplosionCells(2, 2, 3, 5, 5, grid as any);
    // Right direction: should reach (3,2) but not (4,2)
    expect(cells).toContainEqual({ x: 3, y: 2 });
    expect(cells).not.toContainEqual({ x: 4, y: 2 });
  });

  it('stops at map boundaries', () => {
    const grid = makeGrid(5, 5);
    const cells = getExplosionCells(0, 0, 3, 5, 5, grid as any);
    // From (0,0): up and left are out of bounds immediately
    // Only origin + right (1,0)(2,0)(3,0) + down (0,1)(0,2)(0,3)
    expect(cells).toHaveLength(7);
    expect(cells).not.toContainEqual({ x: -1, y: 0 });
    expect(cells).not.toContainEqual({ x: 0, y: -1 });
  });

  it('stops after first destructible (non-pierce)', () => {
    const grid = makeGrid(7, 7);
    grid[3][4] = 'destructible'; // destructible at (4,3) - one right of origin
    const cells = getExplosionCells(3, 3, 3, 7, 7, grid as any, false);
    // Right: reaches (4,3) but stops -- does not reach (5,3)
    expect(cells).toContainEqual({ x: 4, y: 3 });
    expect(cells).not.toContainEqual({ x: 5, y: 3 });
  });

  it('pierce mode passes through destructible walls', () => {
    const grid = makeGrid(7, 7);
    grid[3][4] = 'destructible'; // destructible at (4,3)
    const cells = getExplosionCells(3, 3, 3, 7, 7, grid as any, true);
    // Right: passes through (4,3) and continues to (5,3) and (6,3)
    expect(cells).toContainEqual({ x: 4, y: 3 });
    expect(cells).toContainEqual({ x: 5, y: 3 });
    expect(cells).toContainEqual({ x: 6, y: 3 });
  });

  it('handles destructible_cracked same as destructible', () => {
    const grid = makeGrid(7, 7);
    grid[3][4] = 'destructible_cracked';
    const cells = getExplosionCells(3, 3, 3, 7, 7, grid as any, false);
    // Right: reaches (4,3) but stops
    expect(cells).toContainEqual({ x: 4, y: 3 });
    expect(cells).not.toContainEqual({ x: 5, y: 3 });

    // With pierce, passes through
    const cellsPierce = getExplosionCells(3, 3, 3, 7, 7, grid as any, true);
    expect(cellsPierce).toContainEqual({ x: 5, y: 3 });
  });
});
