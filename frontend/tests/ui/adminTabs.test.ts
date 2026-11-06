import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NotificationUI } from '../../src/ui/NotificationUI';
import type { SocketClient } from '../../src/network/SocketClient';
import { ADMIN_AUDIT_ACTIONS } from '@blast-arena/shared';
import enAdmin from '../../src/i18n/locales/en/admin.json';

/**
 * Admin tabs that read the wrong response shape or stacked listeners:
 * - ChallengesTab: /maps/published answers { maps }; the tab treated it as an array, and the
 *   enabled toggle defaulted to "on" when its setting failed to load. (item 2)
 * - SeasonsTab: /admin/seasons answers { seasons, total }; the tab never rendered. (item 3)
 * - LogsTab: one click listener per page load, so pagination fetched N pages. (item 8)
 * - AITab: downloads now go through ApiClient.download (Bearer token). (item 14)
 * - LogsTab: the action filter listed 7 of the audited actions; it now lists ADMIN_AUDIT_ACTIONS.
 * - RoomsTab: Kick asked for a numeric user id no tab showed; each player now has its own Kick.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));

vi.mock('../../src/main', () => ({
  game: { registry: { get: vi.fn(), set: vi.fn(), remove: vi.fn() }, scene: { getScene: vi.fn() } },
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

describe('LogsTab action filter', () => {
  it('offers every audited action, each with an English label', async () => {
    apiGet.mockResolvedValue({ actions: [], total: 0, page: 1, limit: 20 });
    const { LogsTab } = await import('../../src/ui/admin/LogsTab');
    const tab = new LogsTab();
    await tab.render(parent);
    const options = [...parent.querySelectorAll<HTMLOptionElement>('#action-filter option')];
    expect(options.map((o) => o.value)).toEqual(['', ...ADMIN_AUDIT_ACTIONS]);
    expect(options.slice(1).map((o) => o.textContent)).toEqual(
      ADMIN_AUDIT_ACTIONS.map((a) => `admin:logs.actions.${a}`),
    );
    expect(Object.keys(enAdmin.logs.actions).sort()).toEqual([...ADMIN_AUDIT_ACTIONS].sort());

    // Picking one filters the request by it
    const select = parent.querySelector<HTMLSelectElement>('#action-filter')!;
    select.value = 'challenge_activate';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(apiGet.mock.calls.at(-1)![0]).toContain('action=challenge_activate');
    tab.destroy();
  });
});

describe('RoomsTab players', () => {
  const rooms = [
    {
      code: 'QWER',
      name: 'Friday night',
      host: 'ann',
      playerCount: 2,
      maxPlayers: 4,
      gameMode: 'ffa',
      status: 'waiting',
      players: [
        { id: 41, username: 'ann' },
        { id: 57, username: '<b>bo</b>' },
      ],
    },
  ];

  function fakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const emit = vi.fn();
    const socket = {
      on: vi.fn((event: string, h: (...args: unknown[]) => void) => handlers.set(event, h)),
      off: vi.fn(),
      emit,
    } as unknown as SocketClient;
    return { socket, handlers, emit };
  }

  async function renderTab(role: 'admin' | 'moderator') {
    const overlay = document.createElement('div');
    overlay.id = 'ui-overlay';
    document.body.appendChild(overlay);
    apiGet.mockResolvedValue(structuredClone(rooms));
    const { RoomsTab } = await import('../../src/ui/admin/RoomsTab');
    const fake = fakeSocket();
    const tab = new RoomsTab(notifications as unknown as NotificationUI, fake.socket, role);
    await tab.render(parent);
    return { tab, ...fake };
  }

  it('lists each player by name and id (escaped) and kicks that id', async () => {
    const { tab, emit } = await renderTab('moderator');
    const players = [...parent.querySelectorAll('.admin-room-player')].map((p) =>
      p.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(players).toEqual(['ann #41 admin:rooms.kickBtn', '<b>bo</b> #57 admin:rooms.kickBtn']);
    expect(parent.querySelector('b')).toBeNull();
    // Moderators may kick, not close
    expect(parent.querySelector('[data-action="close"]')).toBeNull();

    parent.querySelector<HTMLElement>('[data-action="kick"][data-user-id="57"]')!.click();
    await flush();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('input[type="number"]')).toBeNull(); // no id to type in
    dialog.querySelector<HTMLInputElement>('#kick-reason')!.value = 'AFK';
    dialog.querySelector<HTMLElement>('#kick-confirm')!.click();
    expect(emit).toHaveBeenCalledWith(
      'admin:kick',
      { roomCode: 'QWER', userId: 57, reason: 'AFK' },
      expect.any(Function),
    );
    tab.destroy();
  });

  it('admins also get Close', async () => {
    const { tab } = await renderTab('admin');
    expect(parent.querySelector('[data-action="close"]')).not.toBeNull();
    tab.destroy();
  });

  it('a room:list broadcast reloads /admin/rooms (the broadcast carries no players)', async () => {
    const { tab, handlers } = await renderTab('admin');
    const calls = apiGet.mock.calls.length;
    handlers.get('room:list')!([]);
    await flush();
    expect(apiGet.mock.calls.length - calls).toBe(1);
    expect(apiGet.mock.calls.at(-1)![0]).toBe('/admin/rooms');
    // Rendered from the reload, not from the (player-less) broadcast
    expect(parent.querySelectorAll('.admin-room-player')).toHaveLength(2);
    tab.destroy();
  });

  it('an older reload that answers last does not overwrite a newer one', async () => {
    const { tab, handlers } = await renderTab('admin');
    let releaseOld!: (v: unknown) => void;
    apiGet.mockImplementationOnce(() => new Promise((r) => (releaseOld = r)));
    apiGet.mockResolvedValueOnce([]);
    handlers.get('room:list')!([]);
    handlers.get('room:list')!([]);
    await flush();
    releaseOld(structuredClone(rooms));
    await flush();
    expect(parent.querySelectorAll('.admin-room-player')).toHaveLength(0);
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
