import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';

/**
 * Message safe to send to a socket client. AppError messages and the services' intentional
 * validation messages pass through, but database (mysql) and network/Redis-connection errors —
 * identified by their driver-specific fields — are masked so schema and internal details don't
 * leak over the socket. (audit ERR-003, ERR-001, ERR-005)
 */
export function clientError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof Error) {
    const e = err as { sqlState?: unknown; syscall?: unknown };
    if (e.sqlState != null || e.syscall != null) return 'An unexpected error occurred';
    return err.message;
  }
  return 'An unexpected error occurred';
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
