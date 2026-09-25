import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ViewDeps } from '../../src/ui/views/types';
import type { SocketClient } from '../../src/network/SocketClient';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';

/**
 * Lobby views render into the persistent `.main-body`, which outlives them. A delegated listener
 * added to it on every render() and never removed in destroy() accumulates one copy per visit,
 * so a click sent the DM / deleted the map / opened the profile N times. (audit C2)
 *
 * Each view is rendered twice into the same container (the language-change path re-renders
 * without destroying), exercised with a real click, then destroyed and clicked again.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/main', () => ({
  game: { registry: { set: vi.fn() }, scene: { getScene: vi.fn(() => null) } },
}));
vi.mock('../../src/scenes/levelEditorLoader', () => ({ ensureLevelEditorScene: vi.fn() }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: vi.fn(),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
}));

/** Fake SocketClient that records handlers so tests can feed server events back in. */
function fakeSocket() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    handlers,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      );
    }),
    onReconnect: vi.fn(),
    offReconnect: vi.fn(),
    fire(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
  };
}

function makeDeps(socket = fakeSocket()): ViewDeps & { socket: ReturnType<typeof fakeSocket> } {
  return {
    socket,
    socketClient: socket as unknown as SocketClient,
    authManager: {
      getUser: () => ({ id: 1, username: 'me', role: 'user' }),
      isGuest: false,
    } as unknown as AuthManager,
    notifications: { success: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as NotificationUI,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let container: HTMLElement;
let uiOverlay: HTMLElement;

/** Net listeners (adds minus removes) the view holds on the persistent container, by type. */
function listenerCounts(el: HTMLElement) {
  const adds = vi.spyOn(el, 'addEventListener');
  const removes = vi.spyOn(el, 'removeEventListener');
  return {
    live: (type: string) =>
      adds.mock.calls.filter((c) => c[0] === type).length -
      removes.mock.calls.filter((c) => c[0] === type).length,
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  uiOverlay = document.createElement('div');
  uiOverlay.id = 'ui-overlay';
  document.body.appendChild(uiOverlay);
  container = document.createElement('div');
  container.className = 'main-body';
  document.body.appendChild(container);
  apiGet.mockReset();
  apiPost.mockReset();
  apiDelete.mockReset();
});

describe('MapsView', () => {
  const maps = [
    {
      id: 7,
      name: 'Arena',
      mapWidth: 15,
      mapHeight: 13,
      spawnCount: 4,
      playCount: 0,
      isPublished: false,
    },
  ];

  it('binds one click handler across two renders and removes it on destroy', async () => {
    apiGet.mockResolvedValue({ maps });
    const { MapsView } = await import('../../src/ui/views/MapsView');
    const { ensureLevelEditorScene } = await import('../../src/scenes/levelEditorLoader');
    const counts = listenerCounts(container);

    const view = new MapsView(makeDeps());
    await view.render(container);
    await view.render(container);
    expect(counts.live('click')).toBe(1);

    container.querySelector<HTMLElement>('.map-edit')!.click();
    await flush();
    expect(ensureLevelEditorScene).toHaveBeenCalledTimes(1);

    view.destroy();
    expect(counts.live('click')).toBe(0);
    container.querySelector<HTMLElement>('.map-edit')!.click();
    await flush();
    expect(ensureLevelEditorScene).toHaveBeenCalledTimes(1);
  });

  it('asks for confirmation in an in-app modal and deletes once', async () => {
    apiGet.mockResolvedValue({ maps });
    apiDelete.mockResolvedValue({});
    const { MapsView } = await import('../../src/ui/views/MapsView');
    const view = new MapsView(makeDeps());
    await view.render(container);
    await view.render(container);

    container.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    const dialogs = uiOverlay.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);
    expect(apiDelete).not.toHaveBeenCalled();

    dialogs[0].querySelector<HTMLElement>('#map-delete-confirm')!.click();
    await flush();
    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(apiDelete).toHaveBeenCalledWith('/maps/7');
    expect(uiOverlay.querySelector('[role="dialog"]')).toBeNull();
    view.destroy();
  });
});

describe('MessagesView', () => {
  it('sends one dm:read per conversation click across two renders, none after destroy', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/messages') {
        return {
          conversations: [
            {
              userId: 2,
              username: 'bob',
              lastMessage: 'hi',
              lastMessageAt: new Date().toISOString(),
              unreadCount: 0,
            },
          ],
        };
      }
      if (path.startsWith('/messages/')) return { messages: [], total: 0, page: 1, limit: 50 };
      return { mode: 'everyone' };
    });
    const { MessagesView } = await import('../../src/ui/views/MessagesView');
    const deps = makeDeps();
    const counts = listenerCounts(container);

    const view = new MessagesView(deps);
    await view.render(container);
    await view.render(container);
    expect(counts.live('click')).toBe(1);
    expect(counts.live('keydown')).toBe(1);

    container.querySelector<HTMLElement>('.messages-conv-item')!.click();
    const dmReads = () => deps.socket.emit.mock.calls.filter((c) => c[0] === 'dm:read').length;
    expect(dmReads()).toBe(1);

    view.destroy();
    expect(counts.live('click')).toBe(0);
    expect(counts.live('keydown')).toBe(0);
    // Socket handlers went too.
    expect(deps.socket.handlers.get('dm:receive')).toEqual([]);
  });
});

describe('FriendsView', () => {
  it('opens a friend conversation once per click across two renders, never after destroy', async () => {
    apiGet.mockResolvedValue({ blocked: [] });
    const { FriendsView } = await import('../../src/ui/views/FriendsView');
    const deps = makeDeps();
    const onMessage = vi.fn();
    const counts = listenerCounts(container);

    const view = new FriendsView(deps, onMessage, vi.fn());
    await view.render(container);
    await view.render(container);
    // click + keydown (search) + keydown (enableKeyboardActions)
    expect(counts.live('click')).toBe(1);
    expect(counts.live('keydown')).toBe(2);

    deps.socket.fire('friend:update', {
      friends: [{ userId: 2, username: 'bob', activity: 'online', status: 'accepted' }],
      incoming: [],
      outgoing: [],
    });
    container.querySelector<HTMLElement>('[data-action="message"]')!.click();
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(2, 'bob');

    view.destroy();
    expect(counts.live('click')).toBe(0);
    expect(counts.live('keydown')).toBe(0);
    container.querySelector<HTMLElement>('[data-action="message"]')!.click();
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it('blocks a user through a confirmation modal and refreshes the lists', async () => {
    apiGet.mockResolvedValue({ blocked: [] });
    const { FriendsView } = await import('../../src/ui/views/FriendsView');
    const deps = makeDeps();
    deps.socket.emit.mockImplementation((event: string, ...rest: unknown[]) => {
      if (event === 'friend:block') (rest[1] as (r: unknown) => void)({ success: true });
    });
    const view = new FriendsView(deps, vi.fn(), vi.fn());
    await view.render(container);
    deps.socket.fire('friend:update', {
      friends: [{ userId: 2, username: 'bob', activity: 'online', status: 'accepted' }],
      incoming: [],
      outgoing: [],
    });

    container.querySelector<HTMLElement>('[data-action="block"]')!.click();
    const dialog = uiOverlay.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    dialog.querySelector<HTMLElement>('#friend-block-confirm')!.click();

    const blockCalls = deps.socket.emit.mock.calls.filter((c) => c[0] === 'friend:block');
    expect(blockCalls).toHaveLength(1);
    expect(blockCalls[0][1]).toEqual({ userId: 2 });
    expect(container.querySelector('[data-action="block"]')).toBeNull(); // bob is gone
    expect(uiOverlay.querySelector('[role="dialog"]')).toBeNull();
    view.destroy();
  });
});

describe('LeaderboardUI (embedded)', () => {
  it('holds one profile-link handler across two renders and drops it on destroy', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/leaderboard/seasons') return { seasons: [], total: 0 };
      return {
        entries: [
          {
            rank: 1,
            userId: 5,
            username: 'ace',
            level: 3,
            eloRating: 1200,
            rankTier: 'Gold',
            rankColor: '#fc0',
            totalWins: 1,
            totalKills: 2,
          },
        ],
        total: 1,
        page: 1,
        limit: 25,
      };
    });
    const { LeaderboardUI } = await import('../../src/ui/LeaderboardUI');
    const onViewProfile = vi.fn();
    const counts = listenerCounts(container);
    const ui = new LeaderboardUI(makeDeps().notifications, onViewProfile);

    await ui.renderEmbedded(container);
    await ui.renderEmbedded(container);
    expect(counts.live('click')).toBe(1);

    container.querySelector<HTMLElement>('.lb-user-link')!.click();
    expect(onViewProfile).toHaveBeenCalledTimes(1);
    expect(onViewProfile).toHaveBeenCalledWith(5);

    ui.destroy();
    expect(counts.live('click')).toBe(0);
    container.querySelector<HTMLElement>('.lb-user-link')!.click();
    expect(onViewProfile).toHaveBeenCalledTimes(1);
  });
});
