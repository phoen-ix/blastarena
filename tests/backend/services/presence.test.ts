import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const store = new Map<string, string>();
const ttls = new Map<string, number>();

const mockRedis = {
  get: jest.fn<AnyFn>((key: string) => Promise.resolve(store.get(key) || null)),
  set: jest.fn<AnyFn>((...args: unknown[]) => {
    store.set(args[0] as string, args[1] as string);
    if (args[2] === 'EX') ttls.set(args[0] as string, args[3] as number);
    return Promise.resolve('OK');
  }),
  del: jest.fn<AnyFn>((key: string) => {
    store.delete(key);
    ttls.delete(key);
    return Promise.resolve(1);
  }),
  mget: jest.fn<AnyFn>((...keys: string[]) => {
    const values = keys.map((k) => store.get(k) || null);
    return Promise.resolve(values);
  }),
  expire: jest.fn<AnyFn>((key: string, ttl: number) => {
    if (store.has(key)) {
      ttls.set(key, ttl);
      return Promise.resolve(1);
    }
    return Promise.resolve(0);
  }),
};

jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: () => mockRedis,
}));

import * as presenceService from '../../../backend/src/services/presence';

describe('Presence Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    ttls.clear();
  });

  describe('setPresence', () => {
    it('should store presence with TTL', async () => {
      await presenceService.setPresence(1, 'in_lobby');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'presence:1',
        JSON.stringify({ status: 'in_lobby' }),
        'EX',
        120,
      );
      expect(store.get('presence:1')).toBe(JSON.stringify({ status: 'in_lobby' }));
    });

    it('should store presence with extra data', async () => {
      await presenceService.setPresence(1, 'in_game', {
        roomCode: 'ABC123',
        gameMode: 'ffa',
      });

      const stored = JSON.parse(store.get('presence:1')!);
      expect(stored.status).toBe('in_game');
      expect(stored.roomCode).toBe('ABC123');
      expect(stored.gameMode).toBe('ffa');
    });
  });

  describe('getPresence', () => {
    it('should return parsed presence data', async () => {
      store.set('presence:1', JSON.stringify({ status: 'in_lobby' }));

      const result = await presenceService.getPresence(1);
      expect(result).toEqual({ status: 'in_lobby' });
    });

    it('should return null when not found', async () => {
      const result = await presenceService.getPresence(999);
      expect(result).toBeNull();
    });

    it('should return null for corrupt data', async () => {
      store.set('presence:1', 'not-json');

      const result = await presenceService.getPresence(1);
      expect(result).toBeNull();
    });
  });

  describe('getPresenceBatch', () => {
    it('should return map of presences', async () => {
      store.set('presence:1', JSON.stringify({ status: 'in_lobby' }));
      store.set('presence:2', JSON.stringify({ status: 'in_game' }));

      const result = await presenceService.getPresenceBatch([1, 2, 3]);

      expect(result.size).toBe(2);
      expect(result.get(1)).toEqual({ status: 'in_lobby' });
      expect(result.get(2)).toEqual({ status: 'in_game' });
      expect(result.has(3)).toBe(false);
    });

    it('should return empty map for empty input', async () => {
      const result = await presenceService.getPresenceBatch([]);
      expect(result.size).toBe(0);
      expect(mockRedis.mget).not.toHaveBeenCalled();
    });
  });

  describe('removePresence', () => {
    it('should delete presence key', async () => {
      store.set('presence:1', JSON.stringify({ status: 'in_lobby' }));

      await presenceService.removePresence(1);

      expect(store.has('presence:1')).toBe(false);
    });
  });
});
