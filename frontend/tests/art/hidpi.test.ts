import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSettings, saveSettings } from '../../src/game/Settings';

vi.mock('phaser', () => ({
  default: {
    Scale: { NONE: 0, CENTER_BOTH: 1 },
    GameObjects: {
      GameObjectFactory: { prototype: { text: () => null } },
      GameObjectCreator: { prototype: { text: () => null } },
    },
  },
}));

const hidpi = await import('../../src/art/hidpi');

function setDpr(v: number): void {
  Object.defineProperty(window, 'devicePixelRatio', { value: v, configurable: true });
}

describe('render ratio', () => {
  beforeEach(() => {
    localStorage.clear();
    saveSettings({ ...getSettings(), sharpRendering: true, quality: 'high' });
    window.history.replaceState({}, '', '/');
  });
  afterEach(() => setDpr(1));

  it('follows the screen density, capped at 2', () => {
    setDpr(1);
    expect(hidpi.computeRenderRatio()).toBe(1);
    setDpr(1.5);
    expect(hidpi.computeRenderRatio()).toBe(1.5);
    setDpr(3);
    expect(hidpi.computeRenderRatio()).toBe(2);
  });

  it('is 1 with Sharp rendering off or at Low quality', () => {
    setDpr(2);
    saveSettings({ ...getSettings(), sharpRendering: false });
    expect(hidpi.computeRenderRatio()).toBe(1);
    saveSettings({ ...getSettings(), sharpRendering: true, quality: 'low' });
    expect(hidpi.computeRenderRatio()).toBe(1);
  });

  it('can be forced with ?dpr= for testing on an ordinary screen', () => {
    setDpr(1);
    window.history.replaceState({}, '', '/?dpr=2');
    expect(hidpi.computeRenderRatio()).toBe(2);
    window.history.replaceState({}, '', '/?dpr=nonsense');
    expect(hidpi.computeRenderRatio()).toBe(1);
  });

  it('sizes the canvas in device pixels shown at CSS size', () => {
    setDpr(2);
    const config = hidpi.scaleConfig();
    expect(config.width).toBe(window.innerWidth * 2);
    expect(config.height).toBe(window.innerHeight * 2);
    expect(config.zoom).toBe(0.5);
    expect(hidpi.renderRatio()).toBe(2);
  });

  it('lays UI scenes out in CSS pixels', () => {
    setDpr(2);
    hidpi.scaleConfig();
    const cam = {
      width: 1600,
      height: 900,
      setOrigin: vi.fn(),
      setZoom: vi.fn(),
    };
    expect(hidpi.uiCamera({ cameras: { main: cam } } as never)).toEqual({
      width: 800,
      height: 450,
    });
    expect(cam.setOrigin).toHaveBeenCalledWith(0, 0);
    expect(cam.setZoom).toHaveBeenCalledWith(2);
  });
});
