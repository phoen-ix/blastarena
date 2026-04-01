import { describe, it, expect } from '@jest/globals';
import {
  isSwitchTile,
  isSwitchActive,
  getSwitchColor,
  getSwitchTile,
  isGateTile,
  isGateClosed,
  isGateOpen,
  getGateColor,
  getGateTile,
  isPuzzleTile,
  PUZZLE_COLORS,
  CRUMBLE_DELAY_TICKS,
  PUZZLE_COLOR_VALUES,
} from '../../shared/src/utils/puzzle';
import { TileType } from '../../shared/src/types/game';

const COLORS = ['red', 'blue', 'green', 'yellow'] as const;

describe('Puzzle Utils', () => {
  describe('isSwitchTile', () => {
    it.each(COLORS)('returns true for inactive switch_%s', (color) => {
      expect(isSwitchTile(`switch_${color}` as TileType)).toBe(true);
    });

    it.each(COLORS)('returns true for active switch_%s_active', (color) => {
      expect(isSwitchTile(`switch_${color}_active` as TileType)).toBe(true);
    });

    it('returns false for non-switch tiles', () => {
      expect(isSwitchTile('empty' as TileType)).toBe(false);
      expect(isSwitchTile('wall' as TileType)).toBe(false);
      expect(isSwitchTile('gate_red' as TileType)).toBe(false);
      expect(isSwitchTile('crumbling' as TileType)).toBe(false);
    });
  });

  describe('isSwitchActive', () => {
    it.each(COLORS)('returns true for switch_%s_active', (color) => {
      expect(isSwitchActive(`switch_${color}_active` as TileType)).toBe(true);
    });

    it.each(COLORS)('returns false for inactive switch_%s', (color) => {
      expect(isSwitchActive(`switch_${color}` as TileType)).toBe(false);
    });
  });

  describe('getSwitchColor', () => {
    it.each(COLORS)('extracts color from switch_%s', (color) => {
      expect(getSwitchColor(`switch_${color}` as TileType)).toBe(color);
    });

    it.each(COLORS)('extracts color from switch_%s_active', (color) => {
      expect(getSwitchColor(`switch_${color}_active` as TileType)).toBe(color);
    });

    it('returns null for non-switch tiles', () => {
      expect(getSwitchColor('empty' as TileType)).toBeNull();
      expect(getSwitchColor('gate_red' as TileType)).toBeNull();
    });
  });

  describe('getSwitchTile', () => {
    it.each(COLORS)('constructs inactive tile for %s', (color) => {
      expect(getSwitchTile(color, false)).toBe(`switch_${color}`);
    });

    it.each(COLORS)('constructs active tile for %s', (color) => {
      expect(getSwitchTile(color, true)).toBe(`switch_${color}_active`);
    });
  });

  describe('isGateTile', () => {
    it.each(COLORS)('returns true for closed gate_%s', (color) => {
      expect(isGateTile(`gate_${color}` as TileType)).toBe(true);
    });

    it.each(COLORS)('returns true for open gate_%s_open', (color) => {
      expect(isGateTile(`gate_${color}_open` as TileType)).toBe(true);
    });

    it('returns false for non-gate tiles', () => {
      expect(isGateTile('empty' as TileType)).toBe(false);
      expect(isGateTile('wall' as TileType)).toBe(false);
      expect(isGateTile('switch_red' as TileType)).toBe(false);
    });
  });

  describe('isGateClosed / isGateOpen', () => {
    it.each(COLORS)('isGateClosed returns true for gate_%s, false for gate_%s_open', (color) => {
      expect(isGateClosed(`gate_${color}` as TileType)).toBe(true);
      expect(isGateClosed(`gate_${color}_open` as TileType)).toBe(false);
    });

    it.each(COLORS)('isGateOpen returns true for gate_%s_open, false for gate_%s', (color) => {
      expect(isGateOpen(`gate_${color}_open` as TileType)).toBe(true);
      expect(isGateOpen(`gate_${color}` as TileType)).toBe(false);
    });
  });

  describe('getGateColor', () => {
    it.each(COLORS)('extracts color from gate_%s', (color) => {
      expect(getGateColor(`gate_${color}` as TileType)).toBe(color);
    });

    it.each(COLORS)('extracts color from gate_%s_open', (color) => {
      expect(getGateColor(`gate_${color}_open` as TileType)).toBe(color);
    });

    it('returns null for non-gate tiles', () => {
      expect(getGateColor('empty' as TileType)).toBeNull();
      expect(getGateColor('switch_red' as TileType)).toBeNull();
    });
  });

  describe('getGateTile', () => {
    it.each(COLORS)('constructs closed gate for %s', (color) => {
      expect(getGateTile(color, false)).toBe(`gate_${color}`);
    });

    it.each(COLORS)('constructs open gate for %s', (color) => {
      expect(getGateTile(color, true)).toBe(`gate_${color}_open`);
    });
  });

  describe('isPuzzleTile', () => {
    it('returns true for switch tiles', () => {
      expect(isPuzzleTile('switch_red' as TileType)).toBe(true);
      expect(isPuzzleTile('switch_blue_active' as TileType)).toBe(true);
    });

    it('returns true for gate tiles', () => {
      expect(isPuzzleTile('gate_green' as TileType)).toBe(true);
      expect(isPuzzleTile('gate_yellow_open' as TileType)).toBe(true);
    });

    it('returns true for crumbling and pit', () => {
      expect(isPuzzleTile('crumbling' as TileType)).toBe(true);
      expect(isPuzzleTile('pit' as TileType)).toBe(true);
    });

    it('returns false for regular tiles', () => {
      expect(isPuzzleTile('empty' as TileType)).toBe(false);
      expect(isPuzzleTile('wall' as TileType)).toBe(false);
      expect(isPuzzleTile('destructible' as TileType)).toBe(false);
      expect(isPuzzleTile('spawn' as TileType)).toBe(false);
      expect(isPuzzleTile('teleporter_a' as TileType)).toBe(false);
    });
  });

  describe('constants', () => {
    it('PUZZLE_COLORS has all 4 colors', () => {
      expect(PUZZLE_COLORS).toHaveLength(4);
      expect(PUZZLE_COLORS).toContain('red');
      expect(PUZZLE_COLORS).toContain('blue');
      expect(PUZZLE_COLORS).toContain('green');
      expect(PUZZLE_COLORS).toContain('yellow');
    });

    it('CRUMBLE_DELAY_TICKS is 10', () => {
      expect(CRUMBLE_DELAY_TICKS).toBe(10);
    });

    it('PUZZLE_COLOR_VALUES has hex values for all 4 colors', () => {
      expect(Object.keys(PUZZLE_COLOR_VALUES)).toHaveLength(4);
      expect(PUZZLE_COLOR_VALUES.red).toBe(0xff4444);
      expect(PUZZLE_COLOR_VALUES.blue).toBe(0x4488ff);
      expect(PUZZLE_COLOR_VALUES.green).toBe(0x44cc66);
      expect(PUZZLE_COLOR_VALUES.yellow).toBe(0xffcc44);
    });
  });
});
