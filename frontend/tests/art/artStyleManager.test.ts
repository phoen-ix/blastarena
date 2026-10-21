import { describe, it, expect, beforeEach, vi } from 'vitest';

const apiGet = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({ ApiClient: { get: apiGet } }));

// Pretend this build can draw every style, so the resolution order itself is under test.
vi.mock('../../src/art/registry', () => ({
  isStyleAvailable: (id: string) => ['classic', 'neon', 'toy', 'pixel'].includes(id),
  getStyle: (id: string) => ({ id }),
}));

async function freshManager() {
  vi.resetModules();
  const mod = await import('../../src/art/ArtStyleManager');
  return new mod.ArtStyleManager();
}

describe('ArtStyleManager', () => {
  beforeEach(() => {
    localStorage.clear();
    apiGet.mockReset();
  });

  it('uses Classic until the admin default arrives, then the admin default', async () => {
    apiGet.mockResolvedValue({ style: 'toy' });
    const m = await freshManager();
    const seen: string[] = [];
    m.onChange((s) => seen.push(s));
    expect(m.get()).toBe('classic');
    await m.initialize();
    expect(apiGet).toHaveBeenCalledWith('/admin/settings/default_art_style');
    expect(m.get()).toBe('toy');
    expect(seen).toEqual(['toy']);
  });

  it("prefers the player's own pick over the admin default", async () => {
    localStorage.setItem('blast-arena-art-style', 'pixel');
    apiGet.mockResolvedValue({ style: 'neon' });
    const m = await freshManager();
    await m.initialize();
    expect(m.get()).toBe('pixel');
    expect(m.getPreference()).toBe('pixel');
  });

  it('ignores unknown stored or served values', async () => {
    localStorage.setItem('blast-arena-art-style', 'vaporwave');
    apiGet.mockResolvedValue({ style: 'sepia' });
    const m = await freshManager();
    await m.initialize();
    expect(m.get()).toBe('classic');
    expect(m.getPreference()).toBeNull();
  });

  it('keeps Classic when the default cannot be fetched', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    const m = await freshManager();
    await m.initialize();
    expect(m.get()).toBe('classic');
  });

  it('stores a pick, notifies, and can go back to following the default', async () => {
    apiGet.mockResolvedValue({ style: 'neon' });
    const m = await freshManager();
    await m.initialize();
    const seen: string[] = [];
    m.onChange((s) => seen.push(s));
    m.set('toy');
    expect(localStorage.getItem('blast-arena-art-style')).toBe('toy');
    expect(m.get()).toBe('toy');
    m.set(null);
    expect(localStorage.getItem('blast-arena-art-style')).toBeNull();
    expect(m.get()).toBe('neon');
    expect(seen).toEqual(['toy', 'neon']);
  });

  it('applies an admin broadcast only to players without their own pick', async () => {
    apiGet.mockResolvedValue({ style: 'classic' });
    const m = await freshManager();
    await m.initialize();
    m.handleAdminSettingChanged('default_art_style', 'neon');
    expect(m.get()).toBe('neon');
    m.handleAdminSettingChanged('default_theme', 'toy');
    expect(m.get()).toBe('neon');
    m.set('pixel');
    m.handleAdminSettingChanged('default_art_style', 'toy');
    expect(m.get()).toBe('pixel');
  });

  it('ready() gives up after the timeout when the server is slow', async () => {
    vi.useFakeTimers();
    try {
      apiGet.mockReturnValue(new Promise(() => {}));
      const m = await freshManager();
      const done = vi.fn();
      void m.ready(500).then(done);
      await vi.advanceTimersByTimeAsync(499);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toHaveBeenCalled();
      expect(m.get()).toBe('classic');
    } finally {
      vi.useRealTimers();
    }
  });
});
