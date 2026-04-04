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
  // Per-socket limiters
  const inputLimiter = createSocketRateLimiter(30); // game:input — 30/sec (game is 20 tps)
  const createLimiter = createSocketRateLimiter(2); // room:create — 2/sec
  const joinLimiter = createSocketRateLimiter(5); // room:join — 5/sec

  // Per-IP limiters (higher limits — multiple legitimate users can share an IP)
  const ipInputLimiter = createSocketRateLimiter(100); // game:input — 100/sec per IP
  const ipCreateLimiter = createSocketRateLimiter(5); // room:create — 5/sec per IP
  const ipJoinLimiter = createSocketRateLimiter(10); // room:join — 10/sec per IP

  const perSocketLimiters: SocketRateLimiter[] = [inputLimiter, createLimiter, joinLimiter];
  const allLimiters: SocketRateLimiter[] = [
    ...perSocketLimiters,
    ipInputLimiter,
    ipCreateLimiter,
    ipJoinLimiter,
  ];

  /** Remove a disconnected socket from per-socket limiters (IP entries expire naturally) */
  function removeSocket(socketId: string): void {
    for (const limiter of perSocketLimiters) {
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
    ipInputLimiter: ipInputLimiter.isAllowed,
    ipCreateLimiter: ipCreateLimiter.isAllowed,
    ipJoinLimiter: ipJoinLimiter.isAllowed,
    removeSocket,
  };
}
