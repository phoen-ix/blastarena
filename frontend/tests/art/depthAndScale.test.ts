import { describe, it, expect, vi } from 'vitest';
import { DEPTH, WORLD_Y_BASE, Y_BIAS, ySortDepth, setDepthIfChanged } from '../../src/art/depth';
import { base, fit, markTexScale, texScaleOf } from '../../src/art/scale';

/** The depths every classic layer had before the bands were introduced. */
const CLASSIC: Record<string, number> = {
  TILE: 0,
  TILE_DYING: 1,
  METEOR_SHADOW: 1,
  POWERUP: 3,
  BOMB: 5,
  HILL: 5,
  DUST: 5,
  TRAIL: 5,
  WARNING: 7,
  PULSE: 7,
  EXPLOSION: 8,
  BUDDY_GLOW: 8,
  UFO_BEAM: 8,
  EXPLOSION_FX: 9,
  ENEMY: 9,
  TEAM_BAR: 9,
  PLAYER: 10,
  LABEL: 11,
  HP_BAR: 11,
  SHIELD: 12,
  ZONE: 15,
  THROWN_BOMB: 15,
  WARNING_TEXT: 16,
  IMPACT: 18,
  UFO: 19,
  METEOR: 20,
  UFO_TEXT: 20,
  PICKUP_TEXT: 20,
  SURGE: 25,
  EMOTE_BG: 99,
  EMOTE: 100,
  SPECTATOR_FLASH: 120,
};

describe('depth bands', () => {
  it('keep the classic draw order exactly', () => {
    const names = Object.keys(CLASSIC);
    for (const a of names) {
      for (const b of names) {
        const before = Math.sign(CLASSIC[a] - CLASSIC[b]);
        const after = Math.sign(DEPTH[a as keyof typeof DEPTH] - DEPTH[b as keyof typeof DEPTH]);
        expect(`${a} vs ${b}: ${after}`).toBe(`${a} vs ${b}: ${before}`);
      }
    }
  });

  it('y-sort the world between the classic layers and the labels', () => {
    const top = ySortDepth(-3 * 41 * 48, Y_BIAS.BLOCK); // wrap ghosts can sit far above row 0
    const bottom = ySortDepth(3 * 51 * 48, Y_BIAS.PLAYER);
    expect(top).toBeGreaterThan(DEPTH.PLAYER);
    expect(bottom).toBeLessThan(DEPTH.LABEL);
    expect(ySortDepth(100, Y_BIAS.PLAYER)).toBeGreaterThan(ySortDepth(100, Y_BIAS.BLOCK));
    expect(ySortDepth(101, Y_BIAS.BLOCK)).toBeGreaterThan(ySortDepth(100, Y_BIAS.PLAYER));
    expect(ySortDepth(0, 0)).toBe(WORLD_Y_BASE);
  });

  it('only calls setDepth when the depth changes', () => {
    const obj = { depth: 5, setDepth: vi.fn() };
    setDepthIfChanged(obj, 5);
    expect(obj.setDepth).not.toHaveBeenCalled();
    setDepthIfChanged(obj, 6);
    expect(obj.setDepth).toHaveBeenCalledWith(6);
  });
});

describe('texture scale', () => {
  it('treats legacy textures as 1x and baked ones by their recorded scale', () => {
    const legacy = { texture: { customData: {} } };
    expect(texScaleOf(legacy)).toBe(1);
    expect(base(legacy, 0.3)).toBe(0.3);

    const baked = { texture: { customData: {} as object }, setScale: vi.fn() };
    markTexScale(baked.texture, 2);
    expect(texScaleOf(baked)).toBe(2);
    expect(base(baked)).toBe(0.5);
    fit(baked, 1.15);
    expect(baked.setScale).toHaveBeenCalledWith(0.575);
  });

  it('copes with objects that have no texture data at all', () => {
    expect(texScaleOf({})).toBe(1);
    expect(texScaleOf({ texture: null })).toBe(1);
  });
});
