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
});
