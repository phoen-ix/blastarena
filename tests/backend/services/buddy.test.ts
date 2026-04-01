import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// ── DB mocks ────────────────────────────────────────────────────────────────
const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

import { getBuddySettings, saveBuddySettings } from '../../../backend/src/services/buddy';

describe('Buddy Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── getBuddySettings ──────────────────────────────────────────────────

  describe('getBuddySettings', () => {
    it('should return defaults when no row exists for user', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getBuddySettings(42);

      expect(result).toEqual({
        name: 'Buddy',
        color: '#44aaff',
        size: 0.6,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM buddy_settings WHERE user_id = ?'),
        [42],
      );
    });

    it('should return stored settings when row exists', async () => {
      mockQuery.mockResolvedValue([
        {
          user_id: 42,
          buddy_name: 'Sparky',
          buddy_color: '#ff0000',
          buddy_size: 0.8,
        },
      ]);

      const result = await getBuddySettings(42);

      expect(result).toEqual({
        name: 'Sparky',
        color: '#ff0000',
        size: 0.8,
      });
    });

    it('should convert buddy_size to Number for type safety', async () => {
      mockQuery.mockResolvedValue([
        {
          user_id: 42,
          buddy_name: 'Buddy',
          buddy_color: '#44aaff',
          buddy_size: '0.5', // String from DB driver
        },
      ]);

      const result = await getBuddySettings(42);

      expect(result.size).toBe(0.5);
      expect(typeof result.size).toBe('number');
    });

    it('should return a fresh copy of defaults (not same reference)', async () => {
      mockQuery.mockResolvedValue([]);

      const result1 = await getBuddySettings(1);
      const result2 = await getBuddySettings(2);

      expect(result1).toEqual(result2);
      expect(result1).not.toBe(result2);
    });
  });

  // ── saveBuddySettings ─────────────────────────────────────────────────

  describe('saveBuddySettings', () => {
    it('should merge partial settings with current and upsert', async () => {
      // getBuddySettings returns defaults (no row)
      mockQuery.mockResolvedValue([]);
      mockExecute.mockResolvedValue({});

      await saveBuddySettings(42, { name: 'Rex' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO buddy_settings'),
        [42, 'Rex', '#44aaff', 0.6],
      );
    });

    it('should merge with existing stored settings', async () => {
      mockQuery.mockResolvedValue([
        {
          user_id: 42,
          buddy_name: 'Sparky',
          buddy_color: '#ff0000',
          buddy_size: 0.8,
        },
      ]);
      mockExecute.mockResolvedValue({});

      await saveBuddySettings(42, { color: '#00ff00' });

      // name and size from existing, color overridden
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO buddy_settings'),
        [42, 'Sparky', '#00ff00', 0.8],
      );
    });

    it('should use ON DUPLICATE KEY UPDATE for upsert behavior', async () => {
      mockQuery.mockResolvedValue([]);
      mockExecute.mockResolvedValue({});

      await saveBuddySettings(42, { name: 'Test' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE'),
        expect.any(Array),
      );
    });

    it('should allow updating all settings at once', async () => {
      mockQuery.mockResolvedValue([]);
      mockExecute.mockResolvedValue({});

      await saveBuddySettings(42, {
        name: 'Max',
        color: '#123456',
        size: 0.4,
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO buddy_settings'),
        [42, 'Max', '#123456', 0.4],
      );
    });
  });
});
