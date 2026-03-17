/**
 * Per-socket rate limiter using a sliding window counter.
 * In-memory only — socket state is ephemeral so no persistence needed.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

export function createSocketRateLimiter(maxPerSecond: number) {
  const windows = new Map<string, WindowEntry>();

  function isAllowed(socketId: string): boolean {
    const now = Date.now();
    const entry = windows.get(socketId);

    if (!entry || now - entry.windowStart >= 1000) {
      windows.set(socketId, { count: 1, windowStart: now });
      return true;
    }

    entry.count++;
    if (entry.count > maxPerSecond) {
      return false;
    }

    return true;
  }

  /** Remove entry for a disconnected socket */
  function remove(socketId: string): void {
    windows.delete(socketId);
  }

  /** Remove entries with windowStart older than 2 seconds */
  function cleanup(): void {
    const cutoff = Date.now() - 2000;
    for (const [id, entry] of windows) {
      if (entry.windowStart < cutoff) {
        windows.delete(id);
      }
    }
  }

  return { isAllowed, remove, cleanup };
}

type SocketRateLimiter = ReturnType<typeof createSocketRateLimiter>;

export function createRateLimiters() {
  const inputLimiter = createSocketRateLimiter(30); // game:input — 30/sec (game is 20 tps)
  const createLimiter = createSocketRateLimiter(2); // room:create — 2/sec
  const joinLimiter = createSocketRateLimiter(5); // room:join — 5/sec

  const allLimiters: SocketRateLimiter[] = [inputLimiter, createLimiter, joinLimiter];

  /** Remove a disconnected socket from all limiters */
  function removeSocket(socketId: string): void {
    for (const limiter of allLimiters) {
      limiter.remove(socketId);
    }
  }

  // Periodic cleanup every 60s to catch any missed disconnects
  const cleanupInterval = setInterval(() => {
    for (const limiter of allLimiters) {
      limiter.cleanup();
    }
  }, 60000);
  // Unref so this doesn't keep the process alive
  if (cleanupInterval.unref) cleanupInterval.unref();

  return {
    inputLimiter: inputLimiter.isAllowed,
    createLimiter: createLimiter.isAllowed,
    joinLimiter: joinLimiter.isAllowed,
    removeSocket,
  };
}
