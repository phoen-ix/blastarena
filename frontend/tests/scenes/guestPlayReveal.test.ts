import { describe, it, expect, vi } from 'vitest';

/**
 * "Play as Guest" right after the background arena's join ack, while GameScene's launch was still
 * queued, fell through to the lobby flow, which joined the open world a second time and showed
 * "Already in open world" instead of the arena. The click now waits for the arena to be created.
 */

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_config?: unknown) {}
    },
  },
}));
vi.mock('../../src/i18n', () => ({ i18n: { language: 'en' }, t: (key: string) => key }));

import { MenuScene } from '../../src/scenes/MenuScene';

function menu(gameSceneActive: boolean) {
  let created: (() => void) | null = null;
  const scene = new MenuScene() as unknown as Record<string, unknown>;
  const revealArena = vi.fn();
  const enterGuestViaLobby = vi.fn();
  Object.assign(scene, {
    bgArenaStarted: true,
    bgJoinInFlight: false,
    revealArena,
    enterGuestViaLobby,
    scene: {
      isActive: (key: string) => key === 'GameScene' && gameSceneActive,
      get: () => ({ events: { once: (_e: string, fn: () => void) => (created = fn) } }),
    },
  });
  (scene as unknown as { onGuestPlay(): void }).onGuestPlay();
  return { revealArena, enterGuestViaLobby, create: () => created?.() };
}

describe('Play as Guest with the background arena', () => {
  it('reveals the running arena', () => {
    const m = menu(true);
    expect(m.revealArena).toHaveBeenCalledTimes(1);
    expect(m.enterGuestViaLobby).not.toHaveBeenCalled();
  });

  it('waits for an arena whose launch is still queued instead of joining again', () => {
    const m = menu(false);
    expect(m.enterGuestViaLobby).not.toHaveBeenCalled();
    expect(m.revealArena).not.toHaveBeenCalled();
    m.create();
    expect(m.revealArena).toHaveBeenCalledTimes(1);
  });
});
