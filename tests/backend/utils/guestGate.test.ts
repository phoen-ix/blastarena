import { describe, it, expect, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
  allowGuestPacket,
  GUEST_ALLOWED_EVENTS,
  guestPacketLabel,
  MAX_LOGGED_EVENT_NAME,
} from '../../../backend/src/utils/socketValidation';

/**
 * Guest sockets connect unauthenticated for the open-world landing experience and carry
 * `socket.data.userId = 0` until openworld:join assigns a real negative guest id. Every handler in
 * socket.ts is registered on every socket regardless of auth, so without a packet-level gate a
 * guest could emit room:create / room:join (all guests colliding on `player:0:room`),
 * campaign:start (a full server-side game loop per socket) or game:spectatorChat into any room.
 * (audit GUEST-SCOPE-1)
 */
describe('guest packet gate', () => {
  it('allows the open-world events', () => {
    for (const event of ['openworld:join', 'openworld:leave', 'openworld:input']) {
      expect(allowGuestPacket([event, {}])).toBe(true);
    }
  });

  const forbidden = [
    'room:create',
    'room:join',
    'room:leave',
    'room:start',
    'room:ready',
    'room:setTeam',
    'campaign:start',
    'campaign:input',
    'game:input',
    'game:emote',
    'game:spectatorChat',
    'spectator:action',
    'rematch:vote',
    'admin:kick',
    'admin:closeRoom',
    'sim:start',
    'sim:spectate',
  ];

  it.each(forbidden)('blocks %s', (event) => {
    expect(allowGuestPacket([event, {}])).toBe(false);
  });

  it('answers the ack callback when blocking, so the client does not hang', () => {
    const ack = jest.fn();
    expect(allowGuestPacket(['room:create', { name: 'x' }, ack])).toBe(false);
    expect(ack).toHaveBeenCalledWith({ success: false, error: 'Sign in to use this feature' });
  });

  it('does not invent an ack when the client sent none', () => {
    expect(allowGuestPacket(['game:input', { direction: 'up' }])).toBe(false);
  });

  it('does not treat a trailing ack on an allowed event as a reason to block', () => {
    const ack = jest.fn();
    expect(allowGuestPacket(['openworld:join', {}, ack])).toBe(true);
    expect(ack).not.toHaveBeenCalled();
  });

  it('blocks malformed packets with a non-string event', () => {
    expect(allowGuestPacket([])).toBe(false);
    expect(allowGuestPacket([42])).toBe(false);
    expect(allowGuestPacket([{ toString: () => 'openworld:join' }])).toBe(false);
  });

  // Keeps the allowlist honest: if a new openworld:* handler is added to socket.ts, it must be
  // added here too, or guests silently cannot reach it.
  it('covers exactly the openworld:* handlers registered in socket.ts', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../backend/src/socket.ts'), 'utf-8');
    const registered = new Set(
      [...src.matchAll(/socket\.on\('(openworld:[^']+)'/g)].map((m) => m[1]),
    );
    expect(registered.size).toBeGreaterThan(0);
    expect([...GUEST_ALLOWED_EVENTS].sort()).toEqual([...registered].sort());
  });
});

describe('guestPacketLabel', () => {
  /**
   * The gate logs the event name of every packet it rejects, and guests are unauthenticated. The
   * rejected packet never reaches a handler, so no per-handler limiter runs; nginx's socket.io
   * zone counts HTTP requests, so it sees only the upgrade and never the frames. Unbounded, one
   * connection could write the whole Docker log retention away in seconds. (audit GUEST-LOG-FLOOD-1)
   */
  it('passes a normal event name through unchanged', () => {
    expect(guestPacketLabel('openworld:input')).toBe('openworld:input');
  });

  it('truncates a long name and reports its real length', () => {
    const label = guestPacketLabel('A'.repeat(1_000_000));
    expect(label.length).toBeLessThanOrEqual(MAX_LOGGED_EVENT_NAME + 20);
    expect(label).toContain('(1000000)');
  });

  it('keeps a name exactly at the cap intact', () => {
    const exact = 'B'.repeat(MAX_LOGGED_EVENT_NAME);
    expect(guestPacketLabel(exact)).toBe(exact);
  });

  it.each([
    [{ nested: 'object' }, '<object>'],
    [12345, '<number>'],
    [undefined, '<undefined>'],
    [null, '<object>'],
  ])('describes non-string %p without serialising it', (input, expected) => {
    expect(guestPacketLabel(input)).toBe(expected);
  });
});
