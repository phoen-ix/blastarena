import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SocketClient } from '../../src/network/SocketClient';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';

/**
 * LobbyScene builds a new LobbyUI on every return from a room, and each LobbyUI owns a PartyBar
 * (7 socket handlers) and a LobbyChatPanel (2). Only scene shutdown used to destroy the panels,
 * so N room round-trips left N sets of live handlers: N invite toasts per invite, N chat renders
 * per message. hide() now destroys the panels with the rest of the UI. (audit C1)
 *
 * A fake SocketClient counts on()/off() per event; a room→lobby→room→lobby cycle must leave
 * exactly one registration per event while a lobby is shown and none once it is hidden.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: vi.fn(async (path: string) => {
      if (path === '/lobby/rooms') return [];
      if (path === '/admin/announcements/banner') return null;
      if (path === '/user/rank') return { rankTier: 'Bronze', rankColor: '#c60', level: 1 };
      return { mode: 'everyone' };
    }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

/** Counts live listeners per event: +1 on on(), -1 on off() with the matching handler. */
function countingSocket() {
  const live = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    live,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      live.set(event, [...(live.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler?: (...args: unknown[]) => void) => {
      if (!handler) throw new Error(`off('${event}') without a handler removes everyone's`);
      live.set(
        event,
        (live.get(event) ?? []).filter((h) => h !== handler),
      );
    }),
    fire(event: string, ...args: unknown[]) {
      for (const h of live.get(event) ?? []) h(...args);
    },
    liveCount(event: string) {
      return (live.get(event) ?? []).length;
    },
  };
}

/** Socket events the two panels subscribe to, with the number of handlers one lobby holds. */
const PANEL_EVENTS: Record<string, number> = {
  // PartyBar
  'party:state': 1,
  'party:disbanded': 1,
  'party:chat': 1,
  'party:invite': 1,
  // (party:joinRoom is LobbyScene's — PartyBar no longer subscribes; audit PARTY-JOIN-TWICE-1)
  'invite:room': 1,
  // LobbyChatPanel
  'lobby:chat': 1,
  // both
  'admin:settingsChanged': 2,
};

function expectPanels(socket: ReturnType<typeof countingSocket>, shownLobbies: 0 | 1) {
  for (const [ev, perLobby] of Object.entries(PANEL_EVENTS)) {
    expect(socket.liveCount(ev), ev).toBe(perLobby * shownLobbies);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let socket: ReturnType<typeof countingSocket>;
let LobbyUI: typeof import('../../src/ui/LobbyUI').LobbyUI;

const authManager = {
  getUser: () => ({ id: 1, username: 'me', role: 'user' }),
  isGuest: false,
} as unknown as AuthManager;
const notifications = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
} as unknown as NotificationUI;

function makeLobby() {
  return new LobbyUI(socket as unknown as SocketClient, authManager, notifications, () => {});
}

beforeEach(async () => {
  document.body.replaceChildren();
  for (const id of ['ui-overlay', 'toast-container']) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  localStorage.clear();
  socket = countingSocket();
  ({ LobbyUI } = await import('../../src/ui/LobbyUI'));
});

describe('LobbyUI panels', () => {
  it('registers each panel handler exactly once across a room→lobby→room→lobby cycle', async () => {
    // Lobby #1
    const lobby1 = makeLobby();
    lobby1.show('rooms');
    await flush();
    expectPanels(socket, 1);
    expect(socket.liveCount('room:list')).toBe(1);
    expect(socket.emit).toHaveBeenCalledWith('lobby:subscribe');

    // → room (LobbyScene.onJoinRoom hides the lobby; RoomsView's join callback also hides it)
    lobby1.hide();
    lobby1.hide();
    expectPanels(socket, 0);
    expect(socket.liveCount('room:list')).toBe(0);
    expect(socket.emit.mock.calls.filter((c) => c[0] === 'lobby:unsubscribe')).toHaveLength(1);

    // → lobby #2 (LobbyScene.showLobby builds a fresh LobbyUI)
    const lobby2 = makeLobby();
    lobby2.show('rooms');
    await flush();
    expectPanels(socket, 1);

    // → room → lobby #3
    lobby2.hide();
    const lobby3 = makeLobby();
    lobby3.show('rooms');
    await flush();
    expectPanels(socket, 1);

    lobby3.hide();
    expectPanels(socket, 0);
  });

  it('delivers a party invite to exactly one toast after a round-trip', async () => {
    const lobby1 = makeLobby();
    lobby1.show('rooms');
    await flush();
    lobby1.hide();

    const lobby2 = makeLobby();
    lobby2.show('rooms');
    await flush();

    socket.fire('party:invite', {
      inviteId: 'inv-1',
      type: 'party',
      fromUserId: 2,
      fromUsername: 'bob',
    });
    expect(document.querySelectorAll('#toast-container .invite-toast')).toHaveLength(1);
    lobby2.hide();
  });

  it('destroyPanels() is idempotent and show() after hide() re-creates the panels', async () => {
    const lobby = makeLobby();
    lobby.show('rooms');
    await flush();
    lobby.hide();
    lobby.destroyPanels();
    expectPanels(socket, 0);

    lobby.show('rooms');
    await flush();
    expectPanels(socket, 1);
    lobby.hide();
    expectPanels(socket, 0);
  });
});
