import { describe, it, expect, afterEach, vi } from 'vitest';
import type { BombState, PowerUpState } from '@blast-arena/shared';
import { makeFakeScene } from '../helpers/fakeScene';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/scenes/BootScene', () => ({ BootScene: {} }));

import { BombSpriteRenderer } from '../../src/game/BombSprite';
import { PowerUpRenderer } from '../../src/game/PowerUpSprite';
import { getSettings, saveSettings } from '../../src/game/Settings';

/* Classic art and the Animations setting (off by default under a system "reduce motion"): the
 * power-up float and the bomb pulse are endless tweens and must stop with it, as the drawn
 * styles' bob and pulse do. */

const defaults = { ...getSettings() };
afterEach(() => saveSettings(defaults));

function bomb(id: string, bombType: string): BombState {
  return {
    id,
    bombType,
    ownerId: 1,
    position: { x: 2, y: 2 },
    ticksRemaining: 60,
  } as unknown as BombState;
}
const powerUp = { id: 'p', type: 'bomb_up', position: { x: 1, y: 1 } } as PowerUpState;

describe('classic art and the Animations setting', () => {
  it('floats power-ups and pulses bombs with animations on', () => {
    const scene = makeFakeScene();
    new PowerUpRenderer(scene as never).update([powerUp]);
    new BombSpriteRenderer(scene as never).update([bomb('a', 'normal'), bomb('b', 'remote')]);
    expect(scene.tweens.list).toHaveLength(3);
  });

  it('keeps them still with animations off', () => {
    saveSettings({ ...defaults, animations: false });
    const scene = makeFakeScene();
    new PowerUpRenderer(scene as never).update([powerUp]);
    new BombSpriteRenderer(scene as never).update([bomb('a', 'normal'), bomb('b', 'remote')]);
    expect(scene.tweens.list).toHaveLength(0);
    expect(scene.sprites).toHaveLength(3);
  });
});
