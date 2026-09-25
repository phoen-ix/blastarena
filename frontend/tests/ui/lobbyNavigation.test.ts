import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SocketClient } from '../../src/network/SocketClient';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';
import type { ViewDeps } from '../../src/ui/views/types';

/**
 * Lobby navigation races and guests.
 *
 * - navigateTo() awaited createView() and render() with no token: a second click while the first
 *   view was still loading left the first one installed or rendering into the shared .main-body.
 *   (item 11)
 * - Views that await and then write into .main-body must stop once destroyed; OpenWorldView also
 *   registered a socket listener and a 1 s interval after destroy. (item 11)
 * - Guests: the sidebar badges fetched /user/rank, whose 401 ended in logout(). (item 6)
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));

const gamepad = { pushContext: vi.fn(), popContext: vi.fn(), clearAll() {}, setActive() {} };
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: { getInstance: () => gamepad },
}));

const apiGet = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('../../src/main', () => ({
  game: { registry: { set: vi.fn() }, scene: { getScene: vi.fn(() => null) } },
}));

/** A promise with its resolve function, to hold an await open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// Fake lazily-imported views whose render() is held open by the test.
const slowRender = { gate: deferred<void>() };
const created: Array<{
  id: string;
  render: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}> = [];
function fakeView(id: string) {
  return class {
    readonly viewId = id;
    readonly title = id;
    render = vi.fn(async (container: HTMLElement) => {
      if (id === 'matchHistory') await slowRender.gate.promise;
      container.textContent = `view:${id}`;
    });
    destroy = vi.fn();
    constructor() {
      created.push({ id, render: this.render, destroy: this.destroy });
    }
  };
}
vi.mock('../../src/ui/views/MatchHistoryView', () => ({
  MatchHistoryView: fakeView('matchHistory'),
}));
vi.mock('../../src/ui/views/MapsView', () => ({ MapsView: fakeView('maps') }));

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeSocket() {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn(), getSocket: vi.fn(() => null) };
}

const notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

function authManager(guest: boolean, token: string | null): AuthManager {
  return {
    getUser: () => ({ id: guest ? -3001 : 1, username: guest ? 'Guest1' : 'me', role: 'user' }),
    getAccessToken: () => token,
    isGuest: guest,
  } as unknown as AuthManager;
}

beforeEach(() => {
  document.body.replaceChildren();
  for (const id of ['ui-overlay', 'toast-container']) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  localStorage.clear();
  apiGet.mockReset();
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/lobby/rooms') return [];
    if (path === '/user/rank') return { rankTier: 'Gold', rankColor: '#ffd700', level: 3 };
    return null;
  });
  gamepad.pushContext.mockClear();
  created.length = 0;
  slowRender.gate = deferred<void>();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LobbyUI guests (item 6)', () => {
  it('does not request /user/rank for a guest', async () => {
    const { LobbyUI } = await import('../../src/ui/LobbyUI');
    const lobby = new LobbyUI(
      fakeSocket() as unknown as SocketClient,
      authManager(true, null),
      notifications as unknown as NotificationUI,
      () => {},
    );
    lobby.show('rooms');
    await flush();
    await flush();
    expect(apiGet.mock.calls.map((c) => c[0])).not.toContain('/user/rank');
    lobby.hide();
  });

  it('still loads the badges for a signed-in user', async () => {
    const { LobbyUI } = await import('../../src/ui/LobbyUI');
    const lobby = new LobbyUI(
      fakeSocket() as unknown as SocketClient,
      authManager(false, 'token'),
      notifications as unknown as NotificationUI,
      () => {},
    );
    lobby.show('rooms');
    await flush();
    await flush();
    expect(apiGet.mock.calls.map((c) => c[0])).toContain('/user/rank');
    lobby.hide();
  });
});

describe('LobbyUI navigation token (item 11)', () => {
  it('a view superseded while rendering is destroyed and never takes the gamepad context', async () => {
    const { LobbyUI } = await import('../../src/ui/LobbyUI');
    const lobby = new LobbyUI(
      fakeSocket() as unknown as SocketClient,
      authManager(false, 'token'),
      notifications as unknown as NotificationUI,
      () => {},
    );
    lobby.show('rooms');
    await flush();

    lobby.showView('matchHistory'); // render held open by the gate
    await flush();
    const slow = created.find((v) => v.id === 'matchHistory')!;
    expect(slow.render).toHaveBeenCalledTimes(1);
    const lobbyPushes = () =>
      gamepad.pushContext.mock.calls.filter((c) => c[0].id === 'lobby').length;
    const pushesBefore = lobbyPushes();

    lobby.showView('maps');
    await flush();
    const maps = created.find((v) => v.id === 'maps')!;
    expect(slow.destroy).toHaveBeenCalledTimes(1);
    expect(maps.render).toHaveBeenCalledTimes(1);
    expect(lobbyPushes()).toBe(pushesBefore + 1);

    // The slow render finishes late: no second context push for it
    slowRender.gate.resolve();
    await flush();
    expect(lobbyPushes()).toBe(pushesBefore + 1);
    expect(maps.destroy).not.toHaveBeenCalled();
    lobby.hide();
  });

  it('a view superseded before it was created is released without rendering', async () => {
    const { LobbyUI } = await import('../../src/ui/LobbyUI');
    const lobby = new LobbyUI(
      fakeSocket() as unknown as SocketClient,
      authManager(false, 'token'),
      notifications as unknown as NotificationUI,
      () => {},
    );
    lobby.show('rooms');
    await flush();

    // Two clicks in the same tick: the first view's chunk is still "loading"
    lobby.showView('maps');
    lobby.showView('matchHistory');
    slowRender.gate.resolve();
    await flush();
    await flush();

    const maps = created.find((v) => v.id === 'maps')!;
    const history = created.find((v) => v.id === 'matchHistory')!;
    expect(maps.render).not.toHaveBeenCalled();
    expect(maps.destroy).toHaveBeenCalledTimes(1);
    expect(history.render).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.main-body')!.textContent).toBe('view:matchHistory');
    lobby.hide();
  });
});

function deps(socket = fakeSocket()): ViewDeps & { socket: ReturnType<typeof fakeSocket> } {
  return {
    socket,
    socketClient: socket as unknown as SocketClient,
    authManager: authManager(false, 'token'),
    notifications: notifications as unknown as NotificationUI,
  };
}

describe('views stop writing to .main-body once destroyed (item 11)', () => {
  it('ChallengeView', async () => {
    const pending = deferred<unknown>();
    apiGet.mockImplementation(() => pending.promise);
    const { ChallengeView } = await import('../../src/ui/views/ChallengeView');
    const container = document.createElement('div');
    const view = new ChallengeView(deps(), vi.fn());
    const rendering = view.render(container);

    view.destroy();
    container.textContent = 'next view';
    pending.resolve({ challenge: null });
    await rendering;
    expect(container.textContent).toBe('next view');
  });

  it('OpenWorldView: no socket listener or interval after destroy', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending.promise),
    );
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const { OpenWorldView } = await import('../../src/ui/views/OpenWorldView');
    const d = deps();
    const shell = document.createElement('div');
    shell.className = 'app-layout';
    const container = document.createElement('div');
    shell.appendChild(container);
    document.body.appendChild(shell);

    const view = new OpenWorldView(d);
    const rendering = view.render(container);
    view.destroy();
    container.textContent = 'next view';
    pending.resolve(
      new Response(
        JSON.stringify({
          enabled: true,
          playerCount: 1,
          maxPlayers: 32,
          roundTimeRemaining: 100,
          roundNumber: 1,
          guestAccess: true,
        }),
        { status: 200 },
      ),
    );
    await rendering;

    expect(d.socket.on).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(container.textContent).toBe('next view');
    // The auto-join path hides the shell while joining; a destroyed view must not leave it hidden
    expect(shell.style.display).toBe('');
    intervalSpy.mockRestore();
  });
});
