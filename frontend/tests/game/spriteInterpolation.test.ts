import { describe, it, expect, vi } from 'vitest';
import { TILE_SIZE, TICK_MS } from '@blast-arena/shared';
import type { CampaignEnemyState, PlayerState } from '@blast-arena/shared';
import { EnemySpriteRenderer } from '../../src/game/EnemySprite';
import { PlayerSpriteRenderer } from '../../src/game/PlayerSprite';
import { makeFakeScene } from '../helpers/fakeScene';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t },
  },
}));
vi.mock('../../src/game/Settings', () => ({
  getSettings: () => ({ animations: false, particles: false }),
}));

/**
 * Enemies were lerped only when a campaign state arrived, so they moved in 20 Hz steps while the
 * players beside them glided per frame. And every sprite glided to wherever its target went —
 * across the whole map after a teleporter or a replay seek.
 */

const centre = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

function enemy(over: Partial<CampaignEnemyState> = {}): CampaignEnemyState {
  return {
    id: 1,
    enemyTypeId: 7,
    position: { x: 2, y: 3 },
    direction: 'right',
    alive: true,
    hp: 1,
    maxHp: 1,
    isBoss: false,
    ...over,
  } as CampaignEnemyState;
}

function player(x: number, y: number): PlayerState {
  return {
    id: 1,
    username: 'p1',
    position: { x, y },
    direction: 'right',
    alive: true,
    hasShield: false,
    team: null,
  } as unknown as PlayerState;
}

describe('enemy sprites', () => {
  it('move every rendered frame, at the same speed whatever the frame rate', () => {
    const scene = makeFakeScene();
    const renderer = new EnemySpriteRenderer(scene as never);
    renderer.update([enemy()]);
    renderer.update([enemy({ position: { x: 3, y: 3 } })]);
    const sprite = scene.sprites[0];
    expect(sprite.x).toBe(centre(2)); // the state alone no longer moves it

    renderer.frame(TICK_MS);
    expect(sprite.x).toBeCloseTo(centre(2) + TILE_SIZE * 0.45);

    // Two half-length frames cover the same ground as one full one
    const other = makeFakeScene();
    const r2 = new EnemySpriteRenderer(other as never);
    r2.update([enemy()]);
    r2.update([enemy({ position: { x: 3, y: 3 } })]);
    r2.frame(TICK_MS / 2);
    r2.frame(TICK_MS / 2);
    expect(other.sprites[0].x).toBeCloseTo(sprite.x);
  });

  it('jump to a target that moved further than a step, instead of sliding there', () => {
    const scene = makeFakeScene();
    const renderer = new EnemySpriteRenderer(scene as never);
    renderer.update([enemy()]);
    renderer.update([enemy({ position: { x: 9, y: 3 } })]);
    expect(scene.sprites[0].x).toBe(centre(9));
  });

  it('keep the HP bar on the sprite and redraw it only when the HP changes', () => {
    const scene = makeFakeScene();
    const renderer = new EnemySpriteRenderer(scene as never);
    renderer.update([enemy({ hp: 3, maxHp: 3 })]);
    renderer.update([enemy({ hp: 3, maxHp: 3, position: { x: 3, y: 3 } })]);
    renderer.update([enemy({ hp: 3, maxHp: 3, position: { x: 3, y: 3 } })]);
    const bar = scene.graphics[0];
    expect(bar.calls.filter((c) => c === 'clear')).toHaveLength(1);

    renderer.frame(TICK_MS);
    expect(bar.x).toBe(scene.sprites[0].x);
    expect(bar.y).toBe(scene.sprites[0].y);

    renderer.update([enemy({ hp: 2, maxHp: 3, position: { x: 3, y: 3 } })]);
    expect(bar.calls.filter((c) => c === 'clear')).toHaveLength(2);
  });
});

describe('player sprites', () => {
  it('jump through a teleporter instead of sliding across the map', () => {
    const scene = makeFakeScene();
    const renderer = new PlayerSpriteRenderer(scene as never);
    renderer.update([player(1, 1)]);
    renderer.update([player(9, 7)]);
    expect(scene.sprites[0].x).toBe(centre(9));
    expect(scene.sprites[0].y).toBe(centre(7));
  });

  it('never jump while walking, even at a tile per tick with an ice slide on top', () => {
    const scene = makeFakeScene();
    const renderer = new PlayerSpriteRenderer(scene as never);
    renderer.update([player(1, 1)]);
    const sprite = scene.sprites[0];
    // One tile per tick, then a tick that moves two (a step onto ice plus the slide)
    const path = [2, 3, 4, 5, 6, 8, 9, 10];
    for (const x of path) {
      const before = sprite.x;
      renderer.update([player(x, 1)]);
      expect(sprite.x).toBe(before);
      renderer.frame(TICK_MS);
      expect(sprite.x).toBeLessThan(centre(x));
    }
  });

  it('take the short way over the seam of a wrapping map', () => {
    const scene = makeFakeScene();
    const renderer = new PlayerSpriteRenderer(scene as never);
    const width = 51;
    renderer.wrappingWorldSize = { w: width * TILE_SIZE, h: 41 * TILE_SIZE };
    renderer.update([player(0, 5)]);
    renderer.update([player(width - 1, 5)]);
    const sprite = scene.sprites[0];
    expect(sprite.x).toBe(centre(0)); // a one-tile step, not a jump

    renderer.frame(TICK_MS);
    expect(sprite.x).toBeLessThan(centre(0)); // heading left, toward the seam
    renderer.frame(TICK_MS);
    // Over the seam: canonical position between the target and the world's right edge
    expect(sprite.x).toBeGreaterThan(centre(width - 1));
    expect(sprite.x).toBeLessThan(width * TILE_SIZE);
  });
});
