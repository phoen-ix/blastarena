import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Settings', () => {
  let getSettings: typeof import('../../src/game/Settings').getSettings;
  let saveSettings: typeof import('../../src/game/Settings').saveSettings;

  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    const mod = await import('../../src/game/Settings');
    getSettings = mod.getSettings;
    saveSettings = mod.saveSettings;
  });

  describe('getSettings', () => {
    it('returns defaults when localStorage is empty', () => {
      const settings = getSettings();
      expect(settings).toEqual({
        animations: true,
        screenShake: true,
        particles: true,
        sound: true,
        lobbyChat: true,
        minimap: true,
        quality: 'high',
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
            sound: true,
            lobbyChat: true,
            minimap: true,
            quality: 'high',
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
            sound: true,
            lobbyChat: true,
            minimap: true,
            quality: 'high',
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
            sound: true,
            lobbyChat: true,
            minimap: true,
            quality: 'high',
          });
        })
      );
    });

    it('replaces an unknown stored quality with the default', () => {
      localStorage.setItem('blast-arena-settings', JSON.stringify({ quality: 'ultra' }));
      return (
        vi.resetModules(),
        import('../../src/game/Settings').then((mod) => {
          expect(mod.getSettings().quality).toBe('high');
        })
      );
    });

    it('follows a system reduce-motion preference until the player saves settings', () => {
      const original = window.matchMedia;
      window.matchMedia = ((q: string) => ({
        matches: q === '(prefers-reduced-motion: reduce)',
      })) as unknown as typeof window.matchMedia;
      return (
        vi.resetModules(),
        import('../../src/game/Settings')
          .then((mod) => {
            const s = mod.getSettings();
            expect(s.animations).toBe(false);
            expect(s.screenShake).toBe(false);
            expect(s.quality).toBe('high');
          })
          .finally(() => {
            window.matchMedia = original;
          })
      );
    });

    it('starts touch-first devices at medium quality', () => {
      const original = window.matchMedia;
      window.matchMedia = ((q: string) => ({
        matches: q === '(pointer: coarse)',
      })) as unknown as typeof window.matchMedia;
      return (
        vi.resetModules(),
        import('../../src/game/Settings')
          .then((mod) => {
            expect(mod.getSettings().quality).toBe('medium');
            expect(mod.qualityAtLeast('medium')).toBe(true);
            expect(mod.qualityAtLeast('high')).toBe(false);
          })
          .finally(() => {
            window.matchMedia = original;
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
});
