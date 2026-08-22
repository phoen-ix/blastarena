import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { logger } from './logger';
import { getErrorMessage } from '@blast-arena/shared';

/** Longest message we will hand to a socket client. */
const MAX_CLIENT_ERROR_LENGTH = 200;

const GENERIC_CLIENT_ERROR = 'An unexpected error occurred';

/**
 * Message safe to send to a socket client.
 *
 * An allow-list: only an `AppError` — which a service constructs deliberately, for the client to
 * read — passes through. Everything else is masked.
 *
 * This used to be a deny-list, forwarding any `Error` whose shape wasn't recognisably a driver
 * error (it checked only `sqlState` and `syscall`). That let through, verbatim: ioredis
 * `ReplyError` messages naming the Lua script SHA, its line number and internal key names;
 * `MaxRetriesPerRequestError`, which announces that the backing store is Redis and how it is
 * tuned; `'Database pool not initialized. Call createPool() first.'`; and any `TypeError` from a
 * bug inside a handler's `try` — free source-level reconnaissance for anyone with a socket.
 *
 * Flipping the default is only safe because the services reachable from socket handlers now throw
 * `AppError` for every message that was meant for a user — messages.ts, friends.ts and party.ts
 * were converted alongside this change. A bare `Error` reaching here is, by construction, an
 * internal failure. (audit CLIENT-ERROR-ALLOWLIST-1)
 */
export function clientError(err: unknown): string {
  if (err instanceof AppError) return err.message.slice(0, MAX_CLIENT_ERROR_LENGTH);

  // Log here rather than at the ~28 call sites. Under the old deny-list the real message at least
  // reached the client, so nothing was silently lost; now that it is masked, dropping it entirely
  // would trade an information leak for a blind spot. The handlers that call this answer an ack
  // and do not log, so this is the only place that still holds the original.
  logger.error({ err: getErrorMessage(err) }, 'Socket handler error (masked for client)');
  return GENERIC_CLIENT_ERROR;
}

// Socket event payload schemas — runtime validation for untyped client data

export const rematchVoteSchema = z.object({
  vote: z.boolean(),
});

export const setBotTeamSchema = z.object({
  botIndex: z.number().int().min(0),
  team: z.union([z.number().int().min(0).max(1), z.null()]),
});

export const setTeamSchema = z.object({
  userId: z.number().int().positive(),
  team: z.union([z.number().int().min(0).max(1), z.null()]),
});

export const userIdSchema = z.object({
  userId: z.number().int().positive(),
});

export const inviteIdSchema = z.object({
  inviteId: z.string().uuid(),
});

export const dmReadSchema = z.object({
  fromUserId: z.number().int().positive(),
});

export const readySchema = z.object({
  ready: z.boolean(),
});

export const adminKickSchema = z.object({
  roomCode: z.string().min(1).max(20),
  userId: z.number().int().positive(),
  reason: z.string().max(200).optional(),
});

export const adminCloseRoomSchema = z.object({
  roomCode: z.string().min(1).max(20),
});

/**
 * Validate socket event data against a Zod schema.
 * Returns parsed data on success, or null on failure.
 * If a callback is provided, sends an error response on failure.
 */
export function validateSocket<T>(
  schema: z.ZodType<T>,
  data: unknown,
  callback?: (response: { success: boolean; error?: string }) => void,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    if (callback) {
      callback({ success: false, error: 'Invalid input' });
    }
    return null;
  }
  return result.data;
}

/**
 * Runtime validation for the hot-path PlayerInput payload (game:input, openworld:input).
 * Manual (not Zod) to keep the per-tick path cheap. Shared so every input entry point validates
 * identically. (audit OWRLD-1)
 */
export function isValidPlayerInput(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const i = input as Record<string, unknown>;
  return (
    typeof i.seq === 'number' &&
    Number.isFinite(i.seq) &&
    i.seq >= 0 &&
    typeof i.tick === 'number' &&
    Number.isFinite(i.tick) &&
    i.tick >= 0 &&
    (i.direction === null ||
      i.direction === 'up' ||
      i.direction === 'down' ||
      i.direction === 'left' ||
      i.direction === 'right') &&
    (i.action === null || i.action === 'bomb' || i.action === 'detonate' || i.action === 'throw')
  );
}

/**
 * The only events an unauthenticated guest socket may emit.
 *
 * Guest sockets are open-world participants. They carry `socket.data.userId = 0` until
 * `openworld:join` assigns a real negative guest id, and every handler in socket.ts is registered
 * on every socket regardless of auth. Without this allowlist a guest could emit room:create /
 * room:join (all guests colliding on the Redis key `player:0:room`), campaign:start (spinning up a
 * full server-side game loop per socket) or game:spectatorChat into any room — as user 0, with no
 * verified email. (audit GUEST-SCOPE-1)
 */
export const GUEST_ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'openworld:join',
  'openworld:leave',
  'openworld:input',
]);

/**
 * Longest event name we will put in a log line.
 *
 * Socket.io's default `maxHttpBufferSize` is 1 MB and permessage-deflate is enabled, so a client
 * can send a ~1 KB compressed frame whose event name inflates to ~1 MB — roughly 1000:1
 * amplification into the log. See `guestPacketLabel`. (audit GUEST-LOG-FLOOD-1)
 */
export const MAX_LOGGED_EVENT_NAME = 64;

/**
 * A bounded, safe label for an event name that came off the wire.
 *
 * The guest gate logs the event name of every packet it rejects, and that name is entirely
 * attacker-chosen: guests are unauthenticated, the gate deliberately does not call `next()` so no
 * handler-level rate limiter ever runs, and nginx's socket.io zone counts HTTP requests so it sees
 * only the WebSocket upgrade, never the frames. Unbounded, one connection could churn the whole
 * 500 MB Docker log retention in seconds — destroying prior log history — while the synchronous
 * serialisation stalled the event loop that also runs the 20 tick/sec game loop.
 * (audit GUEST-LOG-FLOOD-1)
 */
export function guestPacketLabel(event: unknown): string {
  if (typeof event !== 'string') return `<${typeof event}>`;
  return event.length > MAX_LOGGED_EVENT_NAME
    ? `${event.slice(0, MAX_LOGGED_EVENT_NAME)}…(${event.length})`
    : event;
}

/**
 * Decide whether a guest socket's incoming packet may reach its handler.
 *
 * Returns true to allow. When it blocks, it answers the packet's ack callback (if the client
 * supplied one) so the caller fails fast instead of hanging on a dropped packet.
 */
export function allowGuestPacket(packet: unknown[]): boolean {
  const event = packet[0];
  if (typeof event === 'string' && GUEST_ALLOWED_EVENTS.has(event)) return true;

  const ack = packet[packet.length - 1];
  if (typeof ack === 'function') {
    (ack as (res: { success: false; error: string }) => void)({
      success: false,
      error: 'Sign in to use this feature',
    });
  }
  return false;
}
