import { describe, it, expect, vi } from 'vitest';
import type { CampaignEnemyState } from '@blast-arena/shared';
import { EnemySpriteRenderer } from '../../src/game/EnemySprite';
import { makeFakeScene } from '../helpers/fakeScene';

vi.mock('phaser', () => ({ default: {} }));

/**
 * A dead enemy stays in the campaign state for several ticks after it dies, and its sprite is
 * still `visible` until the shrink/fade tween completes. The renderer used to treat every one of
 * those ticks as a fresh death — re-tinting and stacking another tween each time. (audit C5)
 */

function enemy(over: Partial<CampaignEnemyState> = {}): CampaignEnemyState {
  return {
    id: 1,
    enemyTypeId: 7,
    position: { x: 2, y: 3 },
    direction: 'down',
    alive: true,
    hp: 1,
    maxHp: 1,
    isBoss: false,
    ...over,
  } as CampaignEnemyState;
}

describe('EnemySpriteRenderer death animation', () => {
  it('starts the death tween exactly once per enemy, however many ticks it stays dead', () => {
    const scene = makeFakeScene();
    const renderer = new EnemySpriteRenderer(scene as never);

    renderer.update([enemy()]);
    expect(scene.sprites).toHaveLength(1);
    expect(scene.tweens.list).toHaveLength(0);
    expect(renderer.isDying(1)).toBe(false);

    // The tween has not completed, so the sprite is still visible on every one of these ticks
    for (let tick = 0; tick < 6; tick++) {
      renderer.update([enemy({ alive: false })]);
    }

    expect(scene.tweens.list).toHaveLength(1);
    expect(scene.sprites[0].tint).toBe(0xff0000);
    expect(renderer.isDying(1)).toBe(true);
  });

  it('tracks each enemy separately', () => {
    const scene = makeFakeScene();
    const renderer = new EnemySpriteRenderer(scene as never);

    renderer.update([enemy({ id: 1 }), enemy({ id: 2, position: { x: 4, y: 4 } })]);
    renderer.update([enemy({ id: 1, alive: false }), enemy({ id: 2, position: { x: 4, y: 4 } })]);
    renderer.update([enemy({ id: 1, alive: false }), enemy({ id: 2, position: { x: 4, y: 4 } })]);

    expect(scene.tweens.list).toHaveLength(1);
    expect(renderer.isDying(1)).toBe(true);
    expect(renderer.isDying(2)).toBe(false);
  });

  it('forgets the guard when the enemy leaves the state or the renderer is destroyed', () => {
    const scene = makeFakeScene();
    const renderer = new EnemySpriteRenderer(scene as never);

    renderer.update([enemy()]);
    renderer.update([enemy({ alive: false })]);
    expect(renderer.isDying(1)).toBe(true);

    renderer.update([]);
    expect(renderer.isDying(1)).toBe(false);

    renderer.update([enemy()]);
    renderer.update([enemy({ alive: false })]);
    expect(renderer.isDying(1)).toBe(true);
    renderer.destroy();
    expect(renderer.isDying(1)).toBe(false);
  });
});
