import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

import {
  clearSettingCache,
  getSetting,
  getRankConfig,
  setSetting,
  isRecordingEnabled,
  getGameDefaults,
  setGameDefaults,
  getSimulationDefaults,
  setSimulationDefaults,
} from '../../../backend/src/services/settings';
import { DEFAULT_RANK_CONFIG } from '@blast-arena/shared';
import type { RankConfig } from '@blast-arena/shared';

describe('Settings Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // getSetting caches for a few seconds so chat/emote hot paths do not hit the DB per event;
    // each test needs a clean slate. (audit SETTINGS-CACHE-1)
    clearSettingCache();
  });

  describe('getSetting', () => {
    it('should return value when setting exists', async () => {
      mockQuery.mockResolvedValue([{ setting_value: 'some-value' }]);

      const result = await getSetting('test_key');

      expect(result).toBe('some-value');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT setting_value FROM server_settings'),
        ['test_key'],
      );
    });

    it('should return null when setting does not exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getSetting('nonexistent_key');

      expect(result).toBeNull();
    });
  });

  describe('setSetting', () => {
    it('should call execute with INSERT...ON DUPLICATE KEY UPDATE', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await setSetting('my_key', 'my_value');

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('ON DUPLICATE KEY UPDATE'), [
        'my_key',
        'my_value',
        'my_value',
      ]);
    });
  });

  describe('isRecordingEnabled', () => {
    it('should return true when setting is null (default)', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await isRecordingEnabled();

      expect(result).toBe(true);
    });

    it('should return true when setting is not "false"', async () => {
      mockQuery.mockResolvedValue([{ setting_value: 'true' }]);

      const result = await isRecordingEnabled();

      expect(result).toBe(true);
    });

    it('should return false when setting is "false"', async () => {
      mockQuery.mockResolvedValue([{ setting_value: 'false' }]);

      const result = await isRecordingEnabled();

      expect(result).toBe(false);
    });
  });

  describe('getGameDefaults', () => {
    it('should return parsed JSON object', async () => {
      const defaults = { wallDensity: 0.8, roundTime: 120 };
      mockQuery.mockResolvedValue([{ setting_value: JSON.stringify(defaults) }]);

      const result = await getGameDefaults();

      expect(result).toEqual(defaults);
    });

    it('should return empty object when setting is null', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getGameDefaults();

      expect(result).toEqual({});
    });

    it('should return empty object on invalid JSON', async () => {
      mockQuery.mockResolvedValue([{ setting_value: '{not valid json' }]);

      const result = await getGameDefaults();

      expect(result).toEqual({});
    });
  });

  describe('setGameDefaults', () => {
    it('should JSON.stringify and store via setSetting', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });
      const defaults = { wallDensity: 0.5 };

      await setGameDefaults(defaults);

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('ON DUPLICATE KEY UPDATE'), [
        'game_defaults',
        JSON.stringify(defaults),
        JSON.stringify(defaults),
      ]);
    });
  });

  describe('getSimulationDefaults', () => {
    it('should return parsed JSON object', async () => {
      const defaults = { botCount: 4, botDifficulty: 'hard' };
      mockQuery.mockResolvedValue([{ setting_value: JSON.stringify(defaults) }]);

      const result = await getSimulationDefaults();

      expect(result).toEqual(defaults);
    });

    it('should return empty object when setting is null', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getSimulationDefaults();

      expect(result).toEqual({});
    });
  });

  describe('setSimulationDefaults', () => {
    it('should JSON.stringify and store via setSetting', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });
      const defaults = { botCount: 6 };

      await setSimulationDefaults(defaults);

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('ON DUPLICATE KEY UPDATE'), [
        'simulation_defaults',
        JSON.stringify(defaults),
        JSON.stringify(defaults),
      ]);
    });
  });

  // ── getRankConfig ──────────────────────────────────────────────────
  // Moved here from leaderboard.test.ts: getRankConfig was implemented byte-identically in both
  // services, so routes/leaderboard and routes/admin could have drifted apart. It now lives here
  // and leaderboard re-exports it. (audit RANKCONFIG-DUP-1)

  describe('getRankConfig', () => {
    it('should return parsed JSON from settings when valid', async () => {
      const customConfig: RankConfig = {
        tiers: [{ name: 'Custom', minElo: 0, maxElo: 5000, color: '#123456' }],
        subTiersEnabled: false,
      };
      mockQuery.mockResolvedValue([{ setting_value: JSON.stringify(customConfig) }]);

      expect(await getRankConfig()).toEqual(customConfig);
    });

    it('should return DEFAULT_RANK_CONFIG when the setting is missing', async () => {
      mockQuery.mockResolvedValue([]);
      expect(await getRankConfig()).toEqual(DEFAULT_RANK_CONFIG);
    });

    it('should return DEFAULT_RANK_CONFIG on invalid JSON', async () => {
      mockQuery.mockResolvedValue([{ setting_value: '{not valid json!!!' }]);
      expect(await getRankConfig()).toEqual(DEFAULT_RANK_CONFIG);
    });

    it('should return DEFAULT_RANK_CONFIG when the setting is an empty string', async () => {
      mockQuery.mockResolvedValue([{ setting_value: '' }]);
      expect(await getRankConfig()).toEqual(DEFAULT_RANK_CONFIG);
    });
  });

  // ── caching ────────────────────────────────────────────────────────
  // Chat modes, the emote mode and the spectator toggles are read on the hot path — every message,
  // emote and spectator action did a SELECT before the rate-limit outcome was even used.
  // (audit SETTINGS-CACHE-1)

  describe('getSetting caching', () => {
    it('reads the database once for repeated reads of the same key', async () => {
      mockQuery.mockResolvedValue([{ setting_value: 'enabled' }]);

      for (let i = 0; i < 50; i++) {
        expect(await getSetting('emote_mode')).toBe('enabled');
      }

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('caches a missing setting too, rather than re-querying every time', async () => {
      mockQuery.mockResolvedValue([]);

      expect(await getSetting('never_set')).toBeNull();
      expect(await getSetting('never_set')).toBeNull();

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('keeps keys independent', async () => {
      mockQuery.mockResolvedValueOnce([{ setting_value: 'a' }]);
      mockQuery.mockResolvedValueOnce([{ setting_value: 'b' }]);

      expect(await getSetting('key_a')).toBe('a');
      expect(await getSetting('key_b')).toBe('b');
      expect(await getSetting('key_a')).toBe('a');

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('reflects a write immediately, so admin changes are not delayed by the TTL', async () => {
      mockQuery.mockResolvedValue([{ setting_value: 'disabled' }]);
      expect(await getSetting('emote_mode')).toBe('disabled');

      mockExecute.mockResolvedValue({});
      await setSetting('emote_mode', 'enabled');

      // No further query: the write refreshed the cache in place.
      const callsBefore = mockQuery.mock.calls.length;
      expect(await getSetting('emote_mode')).toBe('enabled');
      expect(mockQuery.mock.calls.length).toBe(callsBefore);
    });

    it('re-reads after the cache is cleared', async () => {
      mockQuery.mockResolvedValue([{ setting_value: 'one' }]);
      await getSetting('k');
      clearSettingCache('k');
      await getSetting('k');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});
