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

  return function isAllowed(socketId: string): boolean {
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
  };
}

/**
 * Cleanup stale entries from a rate limiter's internal map.
 * Call periodically (e.g. every 60s) to prevent memory growth from disconnected sockets.
 */
export function createRateLimiters() {
  const inputLimiter = createSocketRateLimiter(30); // game:input — 30/sec (game is 20 tps)
  const createLimiter = createSocketRateLimiter(2); // room:create — 2/sec
  const joinLimiter = createSocketRateLimiter(5); // room:join — 5/sec

  return { inputLimiter, createLimiter, joinLimiter };
}
