import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings, saveSettings } from '../../src/game/Settings';
import {
  COLOR_BLIND_PLAYER_COLORS,
  MARKER_SHAPES,
  STANDARD_PLAYER_COLORS,
  markerShape,
  playerColor,
  teamColor,
  teamColorIndices,
  traceMarker,
} from '../../src/game/playerPalette';

function setColorBlind(on: boolean): void {
  saveSettings({ ...getSettings(), colorBlind: on });
}

describe('player palette', () => {
  beforeEach(() => {
    localStorage.clear();
    setColorBlind(false);
  });

  it('keeps the original colours by default', () => {
    expect(STANDARD_PLAYER_COLORS.map((_, i) => playerColor(i))).toEqual(STANDARD_PLAYER_COLORS);
    expect(teamColor(0)).toBe('#ff4466');
    expect(teamColor(1)).toBe('#448aff');
    // Team underlines stay the team's first player colour, as before
    expect(playerColor(teamColorIndices(0)[0])).toBe(0xe94560);
    expect(playerColor(teamColorIndices(1)[0])).toBe(0x44aaff);
  });

  it('switches every colour with the colour-blind setting', () => {
    setColorBlind(true);
    expect(COLOR_BLIND_PLAYER_COLORS.map((_, i) => playerColor(i))).toEqual(
      COLOR_BLIND_PLAYER_COLORS,
    );
    expect(teamColor(0)).not.toBe('#ff4466');
    // The two teams never share a player colour
    const [a, b] = [teamColorIndices(0), teamColorIndices(1)];
    expect(a.filter((i) => b.includes(i))).toEqual([]);
  });

  it('wraps indices and gives eight distinct shapes', () => {
    expect(playerColor(8)).toBe(playerColor(0));
    expect(playerColor(-1)).toBe(playerColor(7));
    expect(new Set(MARKER_SHAPES.map((_, i) => markerShape(i))).size).toBe(8);
  });

  it('traces every shape as one closed path within its radius', () => {
    for (const shape of MARKER_SHAPES) {
      const calls: string[] = [];
      const points: [number, number][] = [];
      traceMarker(
        {
          beginPath: () => calls.push('begin'),
          moveTo: (x, y) => (calls.push('move'), points.push([x, y])),
          lineTo: (x, y) => (calls.push('line'), points.push([x, y])),
          closePath: () => calls.push('close'),
        },
        shape,
        10,
      );
      expect(calls[0]).toBe('begin');
      expect(calls.filter((c) => c === 'move')).toHaveLength(1);
      expect(calls.at(-1)).toBe('close');
      expect(points.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of points) expect(Math.hypot(x, y)).toBeLessThanOrEqual(13);
    }
  });
});
