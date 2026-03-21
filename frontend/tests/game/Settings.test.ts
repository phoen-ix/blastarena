import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Settings', () => {
  let getSettings: typeof import('../../src/game/Settings').getSettings;
  let saveSettings: typeof import('../../src/game/Settings').saveSettings;
  let updateSetting: typeof import('../../src/game/Settings').updateSetting;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    const mod = await import('../../src/game/Settings');
    getSettings = mod.getSettings;
    saveSettings = mod.saveSettings;
    updateSetting = mod.updateSetting;
  });

  describe('getSettings', () => {
    it('returns defaults when localStorage is empty', () => {
      const settings = getSettings();
      expect(settings).toEqual({
        animations: true,
        screenShake: true,
        particles: true,
        lobbyChat: true,
      });
    });

    it('merges stored values with defaults', () => {
      localStorage.setItem('blast-arena-settings', JSON.stringify({ animations: false }));
      // Re-import to clear cache
      return (
        vi.resetModules(),
        import('../../src/game/Settings').then((mod) => {
          const settings = mod.getSettings();
          expect(settings).toEqual({
            animations: false,
            screenShake: true,
            particles: true,
            lobbyChat: true,
          });
        })
      );
    });

    it('returns defaults when stored value is invalid JSON', () => {
      localStorage.setItem('blast-arena-settings', 'not-json!!!');
      return (
        vi.resetModules(),
        import('../../src/game/Settings').then((mod) => {
          const settings = mod.getSettings();
          expect(settings).toEqual({
            animations: true,
            screenShake: true,
            particles: true,
            lobbyChat: true,
          });
        })
      );
    });

    it('returns defaults when stored value is an array (not object)', () => {
      localStorage.setItem('blast-arena-settings', JSON.stringify([1, 2, 3]));
      return (
        vi.resetModules(),
        import('../../src/game/Settings').then((mod) => {
          const settings = mod.getSettings();
          expect(settings).toEqual({
            animations: true,
            screenShake: true,
            particles: true,
            lobbyChat: true,
          });
        })
      );
    });

    it('caches result (second call returns same ref)', () => {
      const first = getSettings();
      const second = getSettings();
      expect(first).toBe(second);
    });
  });

  describe('saveSettings', () => {
    it('stores to localStorage', () => {
      const settings = { animations: false, screenShake: false, particles: true };
      saveSettings(settings);
      const stored = JSON.parse(localStorage.getItem('blast-arena-settings')!);
      expect(stored).toEqual(settings);
    });

    it('updates cache (getSettings reflects change)', () => {
      const settings = { animations: false, screenShake: true, particles: false };
      saveSettings(settings);
      const result = getSettings();
      expect(result).toEqual(settings);
    });
  });

  describe('updateSetting', () => {
    it('updates a single key', () => {
      updateSetting('animations', false);
      const result = getSettings();
      expect(result.animations).toBe(false);
    });

    it('preserves other keys', () => {
      updateSetting('screenShake', false);
      const result = getSettings();
      expect(result.animations).toBe(true);
      expect(result.particles).toBe(true);
      expect(result.screenShake).toBe(false);
    });
  });
});
