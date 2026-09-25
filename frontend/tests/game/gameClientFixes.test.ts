import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PowerUpState, ReplayData } from '@blast-arena/shared';
import { makeFakeScene } from '../helpers/fakeScene';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/i18n', () => ({ i18n: { language: 'en' }, t: (key: string) => key }));

const apiGet = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: { get: (...a: unknown[]) => apiGet(...a) },
}));

import { PowerUpRenderer } from '../../src/game/PowerUpSprite';
import { LocalCoopInput, DEFAULT_LOCAL_COOP_CONFIG } from '../../src/game/LocalCoopInput';
import { GamepadManager } from '../../src/game/GamepadManager';
import { ReplayPlayer } from '../../src/game/ReplayPlayer';
import { clearCampaignRun, localP2StartData } from '../../src/scenes/coopStart';

describe('PowerUpRenderer', () => {
  function powerUp(id: string): PowerUpState {
    return { id, type: 'bomb_up', position: { x: 1, y: 1 } } as PowerUpState;
  }

  it('kills the endless float tween before destroying a collected power-up', () => {
    // Phaser keeps running a tween on a destroyed sprite, so every power-up ever shown used to
    // leave a repeat:-1 tween (and its sprite) behind for the rest of the match.
    const scene = makeFakeScene();
    const killTweensOf = vi.spyOn(scene.tweens, 'killTweensOf');
    const renderer = new PowerUpRenderer(scene as never);

    renderer.update([powerUp('a'), powerUp('b')]);
    expect(scene.tweens.list).toHaveLength(2);
    const spriteA = scene.sprites[0];

    renderer.update([powerUp('b')]);
    expect(killTweensOf).toHaveBeenCalledWith(spriteA);
    expect(spriteA.active).toBe(false);

    renderer.destroy();
    expect(killTweensOf).toHaveBeenCalledTimes(2);
  });
});

describe('LocalCoopInput', () => {
  const gamepad = { pollIndexed: () => ({ direction: null, action: null }) } as never;

  it('releases every held key when the window loses focus', () => {
    // No keyup arrives for a key held while focus leaves the window; the player kept walking.
    const input = new LocalCoopInput(gamepad, DEFAULT_LOCAL_COOP_CONFIG);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Numpad4' }));
    expect(input.pollP1().direction).toBe('up');
    expect(input.pollP2().direction).toBe('left');

    window.dispatchEvent(new Event('blur'));
    expect(input.pollP1().direction).toBeNull();
    expect(input.pollP2().direction).toBeNull();
    input.destroy();
  });

  it('stops listening for blur once destroyed', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const input = new LocalCoopInput(gamepad, DEFAULT_LOCAL_COOP_CONFIG);
    input.destroy();
    expect(remove).toHaveBeenCalledWith('blur', expect.any(Function));
    remove.mockRestore();
  });
});

describe('GamepadManager.suppressHeldButtons', () => {
  function sceneWithPad(pressed: Set<number>) {
    const pad = {
      connected: true,
      buttons: Array.from({ length: 16 }, (_, i) => ({
        get pressed() {
          return pressed.has(i);
        },
      })),
      leftStick: { x: 0, y: 0 },
    };
    return { input: { gamepad: { gamepads: [pad] } } } as never;
  }

  it('does not turn the button that closed a menu into a bomb', () => {
    const pressed = new Set<number>();
    const manager = new GamepadManager(sceneWithPad(pressed));
    expect(manager.poll().action).toBeNull();

    // A pressed to confirm the emote wheel / pause menu, still held on the next gameplay poll
    pressed.add(0);
    manager.suppressHeldButtons();
    expect(manager.poll().action).toBeNull();

    // Released and pressed again: a real bomb
    pressed.delete(0);
    expect(manager.poll().action).toBeNull();
    pressed.add(0);
    expect(manager.poll().action).toBe('bomb');
  });

  it('covers the per-pad state local co-op reads', () => {
    const pressed = new Set<number>([1]);
    const manager = new GamepadManager(sceneWithPad(pressed));
    manager.suppressHeldButtons();
    expect(manager.pollIndexed(0).action).toBeNull();
  });
});

describe('ReplayPlayer.seekToTick', () => {
  function replay(ticks: number[]): ReplayData {
    return {
      map: { tiles: [['empty']] },
      frames: ticks.map((tick) => ({
        tick,
        timeElapsed: tick / 20,
        players: [],
        bombs: [],
        explosions: [],
        powerUps: [],
      })),
    } as unknown as ReplayData;
  }

  it('lands on the frame for a game tick, not on the frame with that index', () => {
    // Frames start after the countdown, so a log entry's tick is not a frame index.
    const onLogUpdate = vi.fn();
    const player = new ReplayPlayer(replay([37, 38, 39, 40, 41]), {
      onFrame: vi.fn(),
      onTickEvents: vi.fn(),
      onLogUpdate,
      onComplete: vi.fn(),
      onStateChange: vi.fn(),
    });

    player.seekToTick(39);
    expect(player.getCurrentFrame()).toBe(2);
    expect(onLogUpdate).toHaveBeenLastCalledWith(39);

    player.seekToTick(10); // before the first frame
    expect(player.getCurrentFrame()).toBe(0);
    player.seekToTick(500); // after the last
    expect(player.getCurrentFrame()).toBe(4);
  });
});

describe('campaign run helpers', () => {
  // Braces matter: a hook that returns a function has it run as a teardown, and mockReset()
  // returns the mock.
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('clearCampaignRun drops every key of the run, buddy mode included', () => {
    const store = new Map<string, unknown>(
      [
        'campaignMode',
        'campaignCoopMode',
        'localCoopMode',
        'localCoopConfig',
        'buddyMode',
        'buddyConfig',
        'campaignTheme',
        'unrelated',
      ].map((k) => [k, true]),
    );
    clearCampaignRun({ remove: (k: string) => store.delete(k) } as never);
    expect([...store.keys()]).toEqual(['unrelated']);
  });

  it('fetches a fresh socket token for a logged-in P2 on every start', async () => {
    // Retry / Next Level / Restart sent no token, so the server played P2 as a guest.
    apiGet.mockResolvedValue({ token: 'tok' });
    const identity = {
      mode: 'loggedIn' as const,
      guestName: '',
      guestColor: 0,
      loggedInUserId: 9,
      loggedInUsername: 'p2',
    };
    expect(await localP2StartData(identity)).toEqual({ userId: 9, username: 'p2', token: 'tok' });
    expect(apiGet).toHaveBeenCalledWith('/local-coop/socket-token');
  });

  it('sends a guest P2 without asking for a token', async () => {
    const identity = { mode: 'guest' as const, guestName: 'Kid', guestColor: 0x44aaff };
    expect(await localP2StartData(identity)).toEqual({ username: 'Kid', guestColor: 0x44aaff });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('still starts when the token request fails (the server then plays P2 as a guest)', async () => {
    apiGet.mockRejectedValue(new Error('401'));
    const identity = {
      mode: 'loggedIn' as const,
      guestName: '',
      guestColor: 0,
      loggedInUserId: 9,
      loggedInUsername: 'p2',
    };
    expect(await localP2StartData(identity)).toEqual({
      userId: 9,
      username: 'p2',
      token: undefined,
    });
  });
});
