import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthManager } from '../../src/network/AuthManager';

/**
 * SocketClient.connect() / connectAsGuest() must not open a second socket while the first one is
 * still connecting. They used to guard on `socket.connected` only, so a call during the in-flight
 * handshake (Play-as-Guest within the first ~100 ms of the background arena) created a second
 * socket and orphaned the first — listeners, reconnection loop and all. (audit C8)
 */

interface FakeSocket {
  active: boolean;
  connected: boolean;
  auth: Record<string, unknown>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
}

const sockets: FakeSocket[] = [];

function makeSocket(): FakeSocket {
  const s: FakeSocket = {
    active: true, // io() with autoConnect starts connecting immediately
    connected: false,
    auth: {},
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(function (this: FakeSocket) {
      this.active = false;
      this.connected = false;
    }),
    removeAllListeners: vi.fn(),
  };
  sockets.push(s);
  return s;
}

const io = vi.fn(() => makeSocket());

vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => io(...args) }));
vi.mock('../../src/i18n', () => ({ i18n: { language: 'en' }, t: (key: string) => key }));

const authManager = { getAccessToken: () => 'token' } as unknown as AuthManager;

let SocketClient: typeof import('../../src/network/SocketClient').SocketClient;

beforeEach(async () => {
  sockets.length = 0;
  io.mockClear();
  ({ SocketClient } = await import('../../src/network/SocketClient'));
});

describe('SocketClient.connect', () => {
  it('opens exactly one socket when called again while the first is still connecting', () => {
    const client = new SocketClient(authManager);
    client.connect();
    expect(io).toHaveBeenCalledTimes(1);
    expect(sockets[0].connected).toBe(false); // handshake still in flight

    client.connect();
    client.connect();
    expect(io).toHaveBeenCalledTimes(1);
    expect(client.getSocket()).toBe(sockets[0]);
  });

  it('still bails out once connected', () => {
    const client = new SocketClient(authManager);
    client.connect();
    sockets[0].connected = true;
    client.connect();
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('discards a stale, inactive socket before opening a new one', () => {
    const client = new SocketClient(authManager);
    client.connect();
    const stale = sockets[0];
    // A server-side disconnect clears `active` without going through disconnect().
    stale.active = false;
    stale.connected = false;

    client.connect();
    expect(io).toHaveBeenCalledTimes(2);
    expect(stale.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(stale.disconnect).toHaveBeenCalledTimes(1);
    expect(client.getSocket()).toBe(sockets[1]);
  });

  it('does not connect without an access token', () => {
    const client = new SocketClient({ getAccessToken: () => null } as unknown as AuthManager);
    client.connect();
    expect(io).not.toHaveBeenCalled();
  });
});

describe('SocketClient.connectAsGuest', () => {
  it('opens exactly one socket while a connection is in flight', () => {
    const client = new SocketClient(authManager);
    client.connectAsGuest();
    client.connectAsGuest();
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('does not open a guest socket on top of an in-flight authenticated one', () => {
    // The MenuScene race: connectAsGuest() for the background arena, then connect() after login
    // (or the other way round) before the first handshake completed.
    const client = new SocketClient(authManager);
    client.connect();
    client.connectAsGuest();
    expect(io).toHaveBeenCalledTimes(1);
  });

  it('replaces a stale socket', () => {
    const client = new SocketClient(authManager);
    client.connectAsGuest();
    sockets[0].active = false;
    client.connectAsGuest();
    expect(io).toHaveBeenCalledTimes(2);
    expect(sockets[0].removeAllListeners).toHaveBeenCalledTimes(1);
  });

  it('disconnect() then connect() opens a fresh socket', () => {
    const client = new SocketClient(authManager);
    client.connectAsGuest();
    client.disconnect();
    expect(sockets[0].disconnect).toHaveBeenCalledTimes(1);
    client.connect();
    expect(io).toHaveBeenCalledTimes(2);
  });
});
