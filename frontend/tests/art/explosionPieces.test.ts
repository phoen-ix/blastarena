import { describe, it, expect } from 'vitest';
import { getExplosionCells } from '@blast-arena/shared';
import { explosionPieces, fuseFraction, fuseFrame } from '../../src/art/explosionPieces';

const key = (p: { x: number; y: number; role: string; dir?: string }) =>
  `${p.x},${p.y}:${p.role}${p.dir ? ':' + p.dir : ''}`;

describe('explosionPieces', () => {
  it('builds a centre, arms and end caps from the server cell order', () => {
    // origin (5,5), range 2 in an open 11x11 field
    const cells = [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ];
    expect(explosionPieces(cells).map(key)).toEqual([
      '5,5:center',
      '5,4:arm:up',
      '5,3:end:up',
      '5,6:arm:down',
      '5,7:end:down',
      '4,5:arm:left',
      '3,5:end:left',
      '6,5:arm:right',
      '7,5:end:right',
    ]);
  });

  it('caps a range-1 arm immediately and handles a lone centre', () => {
    expect(explosionPieces([{ x: 1, y: 1 }]).map(key)).toEqual(['1,1:center']);
    expect(
      explosionPieces([
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ]).map(key),
    ).toEqual(['1,1:center', '2,1:end:right']);
  });

  it('puts an end cap before a pierce gap and restarts after it', () => {
    // right arm with the destructible cell (7,5) removed from the list
    const cells = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
    ];
    expect(explosionPieces(cells).map(key)).toEqual([
      '5,5:center',
      '6,5:end:right',
      '8,5:arm:right',
      '9,5:end:right',
    ]);
  });

  it('follows an arm across the edge of a wrapping map', () => {
    const open = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => 'empty' as const));
    const cells = getExplosionCells(0, 2, 2, 5, 5, open, false, true);
    const pieces = explosionPieces(cells, { w: 5, h: 5 });
    const left = pieces.filter((p) => p.dir === 'left').map(key);
    expect(left).toEqual(['4,2:arm:left', '3,2:end:left']);
  });
});

describe('fuse helpers', () => {
  it('maps ticks to a fraction and remote bombs to a full fuse', () => {
    expect(fuseFraction(60, 'normal')).toBe(1);
    expect(fuseFraction(30, 'pierce')).toBe(0.5);
    expect(fuseFraction(0, 'normal')).toBe(0);
    expect(fuseFraction(-3, 'normal')).toBe(0);
    expect(fuseFraction(150, 'remote')).toBe(1);
  });

  it('picks frames from full to burnt', () => {
    expect(fuseFrame(1, 8)).toBe(0);
    expect(fuseFrame(0.5, 8)).toBe(4);
    expect(fuseFrame(0.01, 8)).toBe(7);
    expect(fuseFrame(0, 8)).toBe(7);
  });
});
