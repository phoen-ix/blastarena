import { describe, it, expect, vi } from 'vitest';

/**
 * Behind the landing menu the camera centred the background guest exactly where the BLAST ARENA
 * title and tagline sit, so the guest's sprite and name label covered them. While the landing
 * title is up, the guest is kept a quarter of the screen above the centre.
 */

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_config?: unknown) {}
    },
    Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t },
  },
}));
vi.mock('../../src/i18n', () => ({ i18n: { language: 'en' }, t: (key: string) => key }));

import { GameScene } from '../../src/scenes/GameScene';

/** Follows the guest for enough frames to settle; returns where the guest sits on screen. */
function guestScreenY(registry: Record<string, unknown>, wrapping: boolean): number {
  const cam = { width: 2560, height: 1600, zoom: 2, scrollX: 0, scrollY: 0 };
  const sprite = { x: 1200, y: 900 };
  const scene = new GameScene() as unknown as Record<string, unknown>;
  Object.assign(scene, {
    cameras: { main: cam },
    registry: { get: (key: string) => registry[key] },
    localPlayerId: -3001,
    localPlayerDead: false,
    openWorldMode: true,
    lastGameState: { map: { width: 51, height: 41, wrapping } },
    playerRenderer: { getSprite: () => sprite },
  });
  const update = (scene as unknown as { updateCamera(): void }).updateCamera.bind(scene);
  for (let i = 0; i < 200; i++) update();
  // The camera zooms about its centre: the view's centre is scroll + size / 2.
  const centreY = cam.scrollY + cam.height / 2;
  return cam.height / 2 + (sprite.y - centreY) * cam.zoom;
}

describe('camera behind the landing title', () => {
  for (const wrapping of [true, false]) {
    it(`keeps the guest a quarter screen above the title (wrapping ${wrapping})`, () => {
      expect(guestScreenY({ landingTitle: true }, wrapping)).toBeCloseTo(1600 * 0.25, 0);
    });

    it(`centres the guest once the landing has docked (wrapping ${wrapping})`, () => {
      expect(guestScreenY({}, wrapping)).toBeCloseTo(800, 0);
    });
  }
});
