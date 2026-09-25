import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthManager } from '../../src/network/AuthManager';

/**
 * After a dropped connection nothing re-synced: `auth` was a static object holding the login-time
 * access token (15 min lifetime), so every later reconnect was refused, and nothing told the scenes
 * that the server had forgotten their socket rooms. (audit A-H1)
 */

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  active: boolean;
  connected: boolean;
  handlers: Map<string, Handler[]>;
  on: (event: string, handler: Handler) => void;
  off: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
  fire: (event: string, ...args: unknown[]) => void;
}

const sockets: FakeSocket[] = [];
const ioOptions: { auth: (cb: (data: Record<string, unknown>) => void) => void }[] = [];

function makeSocket(): FakeSocket {
  const handlers = new Map<string, Handler[]>();
  const s: FakeSocket = {
    active: true,
    connected: false,
    handlers,
    on(event, handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    off: vi.fn(),
    connect: vi.fn(function (this: FakeSocket) {
      this.active = true;
    }),
    disconnect: vi.fn(function (this: FakeSocket) {
      this.active = false;
      this.connected = false;
    }),
    removeAllListeners: vi.fn(),
    fire(event, ...args) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
  };
  sockets.push(s);
  return s;
}

vi.mock('socket.io-client', () => ({
  io: (_url: string, options: (typeof ioOptions)[number]) => {
    ioOptions.push(options);
    return makeSocket();
  },
}));
vi.mock('../../src/i18n', () => ({ i18n: { language: 'en' }, t: (key: string) => key }));

let SocketClient: typeof import('../../src/network/SocketClient').SocketClient;

function authData(index = 0): Record<string, unknown> {
  let data: Record<string, unknown> = {};
  ioOptions[index].auth((d) => (data = d));
  return data;
}

beforeEach(async () => {
  sockets.length = 0;
  ioOptions.length = 0;
  document.body.replaceChildren();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, json: async () => ({}) })),
  );
  ({ SocketClient } = await import('../../src/network/SocketClient'));
});

describe('SocketClient handshake auth', () => {
  it('sends the access token current at each (re)connect, not the login-time one', () => {
    let token = 'first';
    const auth = {
      getAccessToken: () => token,
      refresh: vi.fn(),
    } as unknown as AuthManager;
    const client = new SocketClient(auth);
    client.connect();
    expect(authData()).toEqual({ token: 'first', locale: 'en' });

    token = 'refreshed';
    expect(authData()).toEqual({ token: 'refreshed', locale: 'en' });
  });

  it('refreshes an expired token and connects again, since socket.io will not retry a refusal', async () => {
    let token = 'expired';
    const refresh = vi.fn(async () => {
      token = 'fresh';
      return true;
    });
    const client = new SocketClient({
      getAccessToken: () => token,
      refresh,
    } as unknown as AuthManager);
    client.connect();
    const socket = sockets[0];
    socket.active = false; // a middleware refusal leaves the socket inactive

    socket.fire('connect_error', new Error('Invalid token'));
    expect(refresh).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(authData()).toEqual({ token: 'fresh', locale: 'en' });
  });

  it('does not reconnect when the refresh fails', async () => {
    const refresh = vi.fn(async () => false);
    const client = new SocketClient({
      getAccessToken: () => 'expired',
      refresh,
    } as unknown as AuthManager);
    client.connect();
    sockets[0].active = false;
    sockets[0].fire('connect_error', new Error('Invalid token'));
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets[0].connect).not.toHaveBeenCalled();
  });
});

describe('SocketClient.onReconnect', () => {
  const auth = { getAccessToken: () => 't', refresh: vi.fn() } as unknown as AuthManager;

  it('fires on every connect after the first, not on the first', () => {
    const client = new SocketClient(auth);
    const listener = vi.fn();
    client.onReconnect(listener);
    client.connect();

    sockets[0].fire('connect');
    expect(listener).not.toHaveBeenCalled();

    sockets[0].fire('disconnect', 'transport close');
    sockets[0].fire('connect');
    expect(listener).toHaveBeenCalledTimes(1);
    sockets[0].fire('connect');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('treats the first connect of a new socket as a first connect again', () => {
    const client = new SocketClient(auth);
    const listener = vi.fn();
    client.onReconnect(listener);
    client.connect();
    sockets[0].fire('connect');
    client.disconnect();

    client.connectAsGuest();
    sockets[1].fire('connect');
    expect(listener).not.toHaveBeenCalled();
    sockets[1].fire('connect');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops calling a listener once removed', () => {
    const client = new SocketClient(auth);
    const listener = vi.fn();
    client.onReconnect(listener);
    client.connect();
    sockets[0].fire('connect');
    client.offReconnect(listener);
    sockets[0].fire('connect');
    expect(listener).not.toHaveBeenCalled();
  });
});
