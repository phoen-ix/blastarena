import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  createSocketRateLimiter,
  createRateLimiters,
} from '../../../backend/src/utils/socketRateLimit';

describe('createSocketRateLimiter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should allow the first call', () => {
    const limiter = createSocketRateLimiter(5);
    expect(limiter.isAllowed('socket-1')).toBe(true);
  });

  it('should allow calls within the rate limit', () => {
    const limiter = createSocketRateLimiter(5);
    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed('socket-1')).toBe(true);
    }
  });

  it('should reject calls exceeding the rate limit', () => {
    const limiter = createSocketRateLimiter(3);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(false);
  });

  it('should reset the window after 1000ms', () => {
    const limiter = createSocketRateLimiter(2);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(false);

    jest.advanceTimersByTime(1000);

    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(false);
  });

  it('should track independent limits per socketId', () => {
    const limiter = createSocketRateLimiter(2);
    expect(limiter.isAllowed('socket-a')).toBe(true);
    expect(limiter.isAllowed('socket-a')).toBe(true);
    expect(limiter.isAllowed('socket-a')).toBe(false);

    // Different socket should have its own limit
    expect(limiter.isAllowed('socket-b')).toBe(true);
    expect(limiter.isAllowed('socket-b')).toBe(true);
    expect(limiter.isAllowed('socket-b')).toBe(false);
  });

  it('should clear limiter state for a socket via remove', () => {
    const limiter = createSocketRateLimiter(2);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(true);
    expect(limiter.isAllowed('socket-1')).toBe(false);

    limiter.remove('socket-1');

    // After removal, socket is treated as new
    expect(limiter.isAllowed('socket-1')).toBe(true);
  });

  it('should remove stale entries older than 2 seconds via cleanup', () => {
    const limiter = createSocketRateLimiter(5);
    limiter.isAllowed('stale-socket');
    limiter.isAllowed('fresh-socket');

    jest.advanceTimersByTime(2500);

    // Make fresh-socket recent so it survives cleanup
    limiter.isAllowed('fresh-socket');

    limiter.cleanup();

    // stale-socket was cleaned up; calling isAllowed creates a fresh entry
    // (first call in a new window is always allowed)
    expect(limiter.isAllowed('stale-socket')).toBe(true);
  });
});

describe('createRateLimiters', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return all expected limiter functions', () => {
    const limiters = createRateLimiters();
    expect(typeof limiters.inputLimiter).toBe('function');
    expect(typeof limiters.createLimiter).toBe('function');
    expect(typeof limiters.joinLimiter).toBe('function');
    expect(typeof limiters.removeSocket).toBe('function');
  });

  it('should allow 30 inputs per second via inputLimiter', () => {
    const { inputLimiter } = createRateLimiters();
    for (let i = 0; i < 30; i++) {
      expect(inputLimiter('socket-1')).toBe(true);
    }
    expect(inputLimiter('socket-1')).toBe(false);
  });

  it('should reject after 2 per second via createLimiter', () => {
    const { createLimiter } = createRateLimiters();
    expect(createLimiter('socket-1')).toBe(true);
    expect(createLimiter('socket-1')).toBe(true);
    expect(createLimiter('socket-1')).toBe(false);
  });

  it('should reject after 5 per second via joinLimiter', () => {
    const { joinLimiter } = createRateLimiters();
    for (let i = 0; i < 5; i++) {
      expect(joinLimiter('socket-1')).toBe(true);
    }
    expect(joinLimiter('socket-1')).toBe(false);
  });

  it('should remove a socket from all limiters via removeSocket', () => {
    const { inputLimiter, createLimiter, joinLimiter, removeSocket } = createRateLimiters();

    // Exhaust limits on all three
    for (let i = 0; i < 30; i++) inputLimiter('socket-1');
    createLimiter('socket-1');
    createLimiter('socket-1');
    for (let i = 0; i < 5; i++) joinLimiter('socket-1');

    expect(inputLimiter('socket-1')).toBe(false);
    expect(createLimiter('socket-1')).toBe(false);
    expect(joinLimiter('socket-1')).toBe(false);

    removeSocket('socket-1');

    // All limiters should now allow again
    expect(inputLimiter('socket-1')).toBe(true);
    expect(createLimiter('socket-1')).toBe(true);
    expect(joinLimiter('socket-1')).toBe(true);
  });
});
