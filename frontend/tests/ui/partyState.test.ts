import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SocketClient } from '../../src/network/SocketClient';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';
import type { ViewDeps } from '../../src/ui/views/types';

/**
 * One source of truth for party state (item 4).
 *
 * Every LobbyUI builds a new PartyBar, which started at "no party" until the next party event,
 * and PartyView kept its own copy: creating or leaving in one left the other stale. PartyBar now
 * asks the server ('party:sync') when built, and PartyView reads and changes party state only
 * through it.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: { get: vi.fn(async () => ({ mode: 'everyone' })), post: vi.fn(), put: vi.fn() },
}));

type Handler = (...args: unknown[]) => void;

/** Fake socket: records handlers and answers acknowledged emits from `acks`. */
function fakeSocket(acks: Record<string, (...args: unknown[]) => unknown> = {}) {
  const handlers = new Map<string, Handler[]>();
  const socket = {
    handlers,
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const cb = args.at(-1);
      if (typeof cb === 'function' && acks[event]) {
        (cb as Handler)(acks[event](...args.slice(0, -1)));
      }
    }),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler: Handler) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((h) => h !== handler),
      );
    }),
    reconnectListeners: new Set<() => void>(),
    onReconnect(listener: () => void) {
      socket.reconnectListeners.add(listener);
    },
    offReconnect(listener: () => void) {
      socket.reconnectListeners.delete(listener);
    },
    fire(event: string, ...args: unknown[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
  };
  return socket;
}

const party = {
  id: 'p1',
  leaderId: 1,
  members: [
    { userId: 1, username: 'me' },
    { userId: 2, username: 'bob' },
  ],
  createdAt: '2026-01-01T00:00:00Z',
};

let notifications: {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};
let PartyBar: typeof import('../../src/ui/PartyBar').PartyBar;
let PartyView: typeof import('../../src/ui/views/PartyView').PartyView;

function deps(socket: ReturnType<typeof fakeSocket>): ViewDeps {
  return {
    socketClient: socket as unknown as SocketClient,
    authManager: {
      getUser: () => ({ id: 1, username: 'me', role: 'user' }),
      isGuest: false,
    } as unknown as AuthManager,
    notifications: notifications as unknown as NotificationUI,
  };
}

function makeBar(socket: ReturnType<typeof fakeSocket>) {
  const bar = new PartyBar(
    socket as unknown as SocketClient,
    notifications as unknown as NotificationUI,
    1,
  );
  const host = document.createElement('div');
  document.body.appendChild(host);
  bar.mount(host);
  return { bar, host };
}

beforeEach(async () => {
  document.body.replaceChildren();
  for (const id of ['ui-overlay', 'toast-container']) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  ({ PartyBar } = await import('../../src/ui/PartyBar'));
  ({ PartyView } = await import('../../src/ui/views/PartyView'));
});

describe('PartyBar', () => {
  it('asks for the current party when built and shows it (no waiting for the next event)', () => {
    const socket = fakeSocket({ 'party:sync': () => ({ success: true, party }) });
    const { bar, host } = makeBar(socket);

    expect(socket.emit).toHaveBeenCalledWith('party:sync', expect.any(Function));
    expect(bar.getParty()).toEqual(party);
    const el = host.querySelector<HTMLElement>('.party-bar')!;
    expect(el.style.display).toBe('flex');
    expect(el.textContent).toContain('bob');
    bar.destroy();
  });

  it('stays hidden when the server reports no party', () => {
    const socket = fakeSocket({ 'party:sync': () => ({ success: true, party: null }) });
    const { bar, host } = makeBar(socket);
    expect(bar.getParty()).toBeNull();
    expect(host.querySelector<HTMLElement>('.party-bar')!.style.display).toBe('none');
    bar.destroy();
  });

  it('asks again after a reconnect, and stops listening once destroyed', () => {
    let current: typeof party | null = party;
    const socket = fakeSocket({ 'party:sync': () => ({ success: true, party: current }) });
    const { bar } = makeBar(socket);
    expect(bar.getParty()).toEqual(party);

    // The server left the party for this user's last socket while the connection was down
    current = null;
    for (const listener of socket.reconnectListeners) listener();
    expect(bar.getParty()).toBeNull();

    bar.destroy();
    expect(socket.reconnectListeners.size).toBe(0);
  });
});

describe('PartyView follows the PartyBar', () => {
  it('shows the party the bar already knows about', async () => {
    const socket = fakeSocket({ 'party:sync': () => ({ success: true, party }) });
    const { bar } = makeBar(socket);
    const view = new PartyView(deps(socket), bar);
    const container = document.createElement('div');
    await view.render(container);

    expect(container.querySelectorAll('.party-member-card')).toHaveLength(2);
    view.destroy();
    bar.destroy();
  });

  it('create from the view updates the bar, and leave updates both', async () => {
    const socket = fakeSocket({
      'party:sync': () => ({ success: true, party: null }),
      'party:create': () => ({ success: true, party }),
      'party:leave': () => ({ success: true }),
    });
    const { bar, host } = makeBar(socket);
    const view = new PartyView(deps(socket), bar);
    const container = document.createElement('div');
    await view.render(container);
    expect(container.querySelector('#party-create-btn')).not.toBeNull();

    container.querySelector<HTMLElement>('#party-create-btn')!.click();
    expect(bar.getParty()).toEqual(party);
    expect(container.querySelector('#party-create-btn')).toBeNull();
    expect(container.querySelectorAll('.party-member-card')).toHaveLength(2);
    expect(host.querySelector<HTMLElement>('.party-bar')!.style.display).toBe('flex');

    // Leader: the page offers Disband, which leaves (and so disbands) through the bar
    container.querySelector<HTMLElement>('#party-page-disband')!.click();
    expect(socket.emit.mock.calls.filter((c) => c[0] === 'party:leave')).toHaveLength(1);
    expect(bar.getParty()).toBeNull();
    expect(container.querySelector('#party-create-btn')).not.toBeNull();
    expect(host.querySelector<HTMLElement>('.party-bar')!.style.display).toBe('none');

    view.destroy();
    bar.destroy();
  });

  it('leaving from the bar updates the view; server events reach the view through the bar', async () => {
    const socket = fakeSocket({
      'party:sync': () => ({ success: true, party }),
      'party:leave': () => ({ success: true }),
    });
    const { bar, host } = makeBar(socket);
    const view = new PartyView(deps(socket), bar);
    const container = document.createElement('div');
    await view.render(container);

    host.querySelector<HTMLElement>('#party-leave-btn')!.click();
    expect(container.querySelector('#party-create-btn')).not.toBeNull();

    socket.fire('party:state', party);
    expect(container.querySelectorAll('.party-member-card')).toHaveLength(2);

    socket.fire('party:disbanded');
    expect(container.querySelector('#party-create-btn')).not.toBeNull();
    expect(notifications.info).toHaveBeenCalledWith('ui:party.disbanded');

    // The view no longer listens for party state itself
    expect(socket.handlers.get('party:state')).toHaveLength(1);
    view.destroy();
    socket.fire('party:state', party);
    expect(bar.getParty()).toEqual(party);
    // A destroyed view is unsubscribed: it still shows the state it had
    expect(container.querySelector('#party-create-btn')).not.toBeNull();
    bar.destroy();
  });

  it('does not toast "Party disbanded" at the user who just left', () => {
    const socket = fakeSocket({ 'party:sync': () => ({ success: true, party }) });
    // The server tells the leaver's tabs (party:disbanded) before it acknowledges the leave.
    socket.emit.mockImplementation((event: string, ...args: unknown[]) => {
      const cb = args.at(-1) as Handler | undefined;
      if (event === 'party:sync') cb?.({ success: true, party });
      if (event === 'party:leave') {
        socket.fire('party:disbanded');
        cb?.({ success: true });
      }
    });
    const { bar, host } = makeBar(socket);
    host.querySelector<HTMLElement>('#party-leave-btn')!.click();
    expect(bar.getParty()).toBeNull();
    expect(notifications.info).not.toHaveBeenCalled();
    bar.destroy();
  });
});
