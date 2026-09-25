import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NotificationUI } from '../../src/ui/NotificationUI';

/**
 * Admin tabs that read the wrong response shape or stacked listeners:
 * - ChallengesTab: /maps/published answers { maps }; the tab treated it as an array, and the
 *   enabled toggle defaulted to "on" when its setting failed to load. (item 2)
 * - SeasonsTab: /admin/seasons answers { seasons, total }; the tab never rendered. (item 3)
 * - LogsTab: one click listener per page load, so pagination fetched N pages. (item 8)
 * - AITab: downloads now go through ApiClient.download (Bearer token). (item 14)
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));

const apiGet = vi.fn();
const apiPut = vi.fn();
const apiDownload = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    put: (...args: unknown[]) => apiPut(...args),
    delete: vi.fn(),
    download: (...args: unknown[]) => apiDownload(...args),
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

let notifications: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
let parent: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  parent = document.createElement('div');
  document.body.appendChild(parent);
  apiGet.mockReset();
  apiPut.mockReset();
  apiDownload.mockReset();
  notifications = { success: vi.fn(), error: vi.fn() };
});

const published = [
  { id: 3, name: 'Crossfire', creatorUsername: 'ann', mapWidth: 15, mapHeight: 13 },
  { id: 4, name: 'Maze', creatorUsername: null, mapWidth: 21, mapHeight: 21 },
];

describe('ChallengesTab', () => {
  it('reads published maps from { maps } and lists them in the create form', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/admin/challenges') return { challenges: [], total: 0 };
      if (path === '/maps/published') return { maps: published };
      if (path === '/admin/settings/challenges_enabled') return { enabled: false };
      throw new Error(`unexpected ${path}`);
    });
    const { ChallengesTab } = await import('../../src/ui/admin/ChallengesTab');
    const tab = new ChallengesTab(notifications as unknown as NotificationUI);
    await tab.render(parent);

    expect(notifications.error).not.toHaveBeenCalled();
    const toggle = parent.querySelector<HTMLInputElement>('#challenges-enabled-toggle')!;
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    parent.querySelector<HTMLElement>('#toggle-create-form')!.click();
    const options = [...parent.querySelectorAll<HTMLOptionElement>('#ch-map option')];
    expect(options.map((o) => o.value)).toEqual(['3', '4']);
    expect(options[0].textContent).toContain('Crossfire');
    // Mode options are the recorded ids, labelled through gameModeName()
    const modes = [...parent.querySelectorAll<HTMLOptionElement>('#ch-mode option')];
    expect(modes.map((o) => o.value)).toContain('king_of_the_hill');
    tab.destroy();
  });

  it('shows an error instead of assuming "enabled" when the setting fails to load', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/admin/challenges') return { challenges: [], total: 0 };
      if (path === '/maps/published') return { maps: [] };
      throw new Error('boom');
    });
    const { ChallengesTab } = await import('../../src/ui/admin/ChallengesTab');
    const tab = new ChallengesTab(notifications as unknown as NotificationUI);
    await tab.render(parent);

    expect(parent.querySelector('#challenges-enabled-toggle')).toBeNull();
    expect(parent.textContent).toContain('admin:challenges.toggleLoadFailed');
    expect(notifications.error).toHaveBeenCalledWith('admin:challenges.toggleLoadFailed');
    tab.destroy();
  });

  it('keeps aria-checked in step with the switch, and reverts it when saving fails', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/admin/challenges') return { challenges: [], total: 0 };
      if (path === '/maps/published') return { maps: [] };
      return { enabled: true };
    });
    apiPut.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('nope'));
    const { ChallengesTab } = await import('../../src/ui/admin/ChallengesTab');
    const tab = new ChallengesTab(notifications as unknown as NotificationUI);
    await tab.render(parent);

    const toggle = parent.querySelector<HTMLInputElement>('#challenges-enabled-toggle')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await flush();
    expect(apiPut).toHaveBeenCalledWith('/admin/settings/challenges_enabled', { enabled: false });

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flush();
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    tab.destroy();
  });
});

describe('SeasonsTab', () => {
  it('renders the seasons from the paged { seasons, total } response', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/seasons')) {
        return {
          seasons: [
            {
              id: 1,
              name: 'Spring',
              startDate: '2026-03-01',
              endDate: '2026-05-31',
              isActive: true,
            },
            {
              id: 2,
              name: 'Summer',
              startDate: '2026-06-01',
              endDate: '2026-08-31',
              isActive: false,
            },
          ],
          total: 2,
        };
      }
      throw new Error('no rank config');
    });
    const { SeasonsTab } = await import('../../src/ui/admin/SeasonsTab');
    const tab = new SeasonsTab(notifications as unknown as NotificationUI);
    await tab.render(parent);

    const rows = parent.querySelectorAll('.admin-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Spring');
    expect(rows[1].textContent).toContain('Summer');
    expect(notifications.error).not.toHaveBeenCalled();
    tab.destroy();
  });

  it('keeps unsaved tier edits when a tier is added', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/seasons')) return { seasons: [], total: 0 };
      return {
        tiers: [{ name: 'Bronze', minElo: 0, maxElo: 999, color: '#cd7f32' }],
        subTiersEnabled: false,
      };
    });
    const { SeasonsTab } = await import('../../src/ui/admin/SeasonsTab');
    const tab = new SeasonsTab(notifications as unknown as NotificationUI);
    await tab.render(parent);

    parent.querySelector<HTMLInputElement>('.tier-name')!.value = 'Copper';
    parent.querySelector<HTMLElement>('#rank-add-tier')!.click();
    const names = [...parent.querySelectorAll<HTMLInputElement>('.tier-name')].map((i) => i.value);
    expect(names).toEqual(['Copper', '']);
    tab.destroy();
  });
});

describe('LogsTab', () => {
  const page = (n: number) => ({
    actions: [
      {
        id: n,
        admin_id: 1,
        admin_username: 'root',
        action: 'role_change',
        target_type: 'user',
        target_id: 5,
        details: `page ${n}`,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    total: 60,
    page: n,
    limit: 20,
  });

  it('keeps one click listener across page loads: one fetch and one toggle per click', async () => {
    apiGet.mockImplementation(async (path: string) => {
      const n = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      return page(n);
    });
    const { LogsTab } = await import('../../src/ui/admin/LogsTab');
    const tab = new LogsTab();
    const adds = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    await tab.render(parent);

    // Page forward twice: each click must fetch exactly one page
    for (const expected of [2, 3]) {
      const calls = apiGet.mock.calls.length;
      parent.querySelector<HTMLElement>(`[data-page="${expected}"]`)!.click();
      await flush();
      expect(apiGet.mock.calls.length - calls).toBe(1);
      expect(apiGet.mock.calls.at(-1)![0]).toContain(`page=${expected}`);
    }
    const container = parent.firstElementChild as HTMLElement;
    const clickAdds = adds.mock.calls.filter(
      (c, i) => c[0] === 'click' && adds.mock.contexts[i] === container,
    );
    expect(clickAdds).toHaveLength(1);
    adds.mockRestore();

    // A row click toggles its detail row exactly once (N listeners toggled it N times)
    const detail = parent.querySelector<HTMLElement>('[data-detail-index="0"]')!;
    expect(detail.style.display).toBe('none');
    parent.querySelector<HTMLElement>('.log-row td')!.click();
    expect(detail.style.display).toBe('table-row');
    tab.destroy();
  });
});

describe('AITab downloads', () => {
  it('downloads through ApiClient.download (authenticated), not a bare fetch', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/admin/ai') {
        return {
          ais: [
            {
              id: 'bot-1',
              name: 'Sneaky',
              description: '',
              isActive: true,
              isBuiltin: false,
              version: 1,
              uploadedBy: 'root',
              filename: 'Sneaky.ts',
              fileSize: 2048,
            },
          ],
        };
      }
      return { ais: [] };
    });
    apiDownload.mockResolvedValue(
      new Response('code', { headers: { 'Content-Disposition': 'attachment; filename="S.ts"' } }),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const createUrl = vi.fn(() => 'blob:x');
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { AITab } = await import('../../src/ui/admin/AITab');
    const tab = new AITab(notifications as unknown as NotificationUI);
    await tab.render(parent);
    parent.querySelector<HTMLElement>('.bot-ai-download')!.click();
    await flush();
    await flush();

    expect(apiDownload).toHaveBeenCalledWith('/admin/ai/bot-1/download');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(notifications.error).not.toHaveBeenCalled();
    anchorClick.mockRestore();
    vi.unstubAllGlobals();
    tab.destroy();
  });
});
