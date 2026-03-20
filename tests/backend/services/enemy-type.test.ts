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
  listEnemyTypes,
  getEnemyType,
  getEnemyTypeConfigs,
  createEnemyType,
  updateEnemyType,
  deleteEnemyType,
} from '../../../backend/src/services/enemy-type';
import { EnemyTypeConfig } from '@blast-arena/shared';

function makeConfig(overrides: Partial<EnemyTypeConfig> = {}): EnemyTypeConfig {
  return {
    speed: 1,
    movementPattern: 'random',
    canPassWalls: false,
    canPassBombs: false,
    canBomb: false,
    hp: 1,
    contactDamage: true,
    sprite: { shape: 'circle', baseColor: '#ff0000', eyeColor: '#ffffff' },
    dropChance: 0.5,
    dropTable: [],
    isBoss: false,
    sizeMultiplier: 1,
    ...overrides,
  } as EnemyTypeConfig;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  const config = makeConfig();
  return {
    id: 1,
    name: 'Slime',
    description: 'A basic slime enemy',
    config: JSON.stringify(config),
    is_boss: 0,
    created_by: 1,
    created_at: new Date('2026-01-15T10:00:00Z'),
    updated_at: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('Enemy Type Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rowToEntry (tested via public functions)', () => {
    it('should map snake_case row to camelCase entry', async () => {
      const row = makeRow();
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(1);
      expect(result!.name).toBe('Slime');
      expect(result!.description).toBe('A basic slime enemy');
      expect(result!.isBoss).toBe(false);
      expect(result!.createdAt).toBe('2026-01-15T10:00:00.000Z');
    });

    it('should parse JSON config string into object', async () => {
      const config = makeConfig({ speed: 3, hp: 5 });
      const row = makeRow({ config: JSON.stringify(config) });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.config).toEqual(config);
      expect(result!.config.speed).toBe(3);
      expect(result!.config.hp).toBe(5);
    });

    it('should handle config that is already an object (not a string)', async () => {
      const config = makeConfig({ speed: 2 });
      const row = makeRow({ config });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.config).toEqual(config);
      expect(result!.config.speed).toBe(2);
    });

    it('should coerce truthy is_boss to boolean true', async () => {
      const row = makeRow({ is_boss: 1 });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.isBoss).toBe(true);
    });

    it('should coerce falsy is_boss (0) to boolean false', async () => {
      const row = makeRow({ is_boss: 0 });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.isBoss).toBe(false);
    });

    it('should coerce null is_boss to boolean false', async () => {
      const row = makeRow({ is_boss: null });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.isBoss).toBe(false);
    });

    it('should format created_at Date as ISO string', async () => {
      const date = new Date('2026-03-20T15:30:00Z');
      const row = makeRow({ created_at: date });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.createdAt).toBe('2026-03-20T15:30:00.000Z');
    });

    it('should convert non-Date created_at to string', async () => {
      const row = makeRow({ created_at: '2026-06-01 12:00:00' });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.createdAt).toBe('2026-06-01 12:00:00');
    });

    it('should default description to empty string when null', async () => {
      const row = makeRow({ description: null });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(1);

      expect(result!.description).toBe('');
    });
  });

  describe('listEnemyTypes', () => {
    it('should query all enemy types ordered by is_boss ASC then name ASC', async () => {
      mockQuery.mockResolvedValue([]);

      await listEnemyTypes();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY is_boss ASC, name ASC'),
      );
    });

    it('should return mapped entries for all rows', async () => {
      const rows = [
        makeRow({ id: 1, name: 'Alpha', is_boss: 0 }),
        makeRow({ id: 2, name: 'Beta', is_boss: 0 }),
        makeRow({ id: 3, name: 'Dragon', is_boss: 1 }),
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await listEnemyTypes();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Alpha');
      expect(result[1].name).toBe('Beta');
      expect(result[2].name).toBe('Dragon');
      expect(result[2].isBoss).toBe(true);
    });

    it('should return empty array when no enemy types exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await listEnemyTypes();

      expect(result).toEqual([]);
    });
  });

  describe('getEnemyType', () => {
    it('should query by id', async () => {
      mockQuery.mockResolvedValue([makeRow()]);

      await getEnemyType(42);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ?'),
        [42],
      );
    });

    it('should return entry when found', async () => {
      const row = makeRow({ id: 7, name: 'Ghost' });
      mockQuery.mockResolvedValue([row]);

      const result = await getEnemyType(7);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(7);
      expect(result!.name).toBe('Ghost');
    });

    it('should return null when not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getEnemyType(999);

      expect(result).toBeNull();
    });
  });

  describe('getEnemyTypeConfigs', () => {
    it('should return empty Map for empty ids array', async () => {
      const result = await getEnemyTypeConfigs([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should build correct placeholders for single id', async () => {
      mockQuery.mockResolvedValue([]);

      await getEnemyTypeConfigs([5]);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id IN (?)'),
        [5],
      );
    });

    it('should build correct placeholders for multiple ids', async () => {
      mockQuery.mockResolvedValue([]);

      await getEnemyTypeConfigs([1, 2, 3]);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id IN (?,?,?)'),
        [1, 2, 3],
      );
    });

    it('should return Map with id-to-config entries', async () => {
      const config1 = makeConfig({ speed: 1 });
      const config2 = makeConfig({ speed: 3, isBoss: true });
      const rows = [
        makeRow({ id: 10, config: JSON.stringify(config1) }),
        makeRow({ id: 20, config: JSON.stringify(config2) }),
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await getEnemyTypeConfigs([10, 20]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get(10)).toEqual(config1);
      expect(result.get(20)).toEqual(config2);
      expect(result.get(20)!.isBoss).toBe(true);
    });

    it('should handle config that is already an object', async () => {
      const config = makeConfig({ hp: 10 });
      const rows = [makeRow({ id: 5, config })];
      mockQuery.mockResolvedValue(rows);

      const result = await getEnemyTypeConfigs([5]);

      expect(result.get(5)).toEqual(config);
    });

    it('should return Map with only found ids (partial match)', async () => {
      const config = makeConfig();
      const rows = [makeRow({ id: 1, config: JSON.stringify(config) })];
      mockQuery.mockResolvedValue(rows);

      const result = await getEnemyTypeConfigs([1, 2, 3]);

      expect(result.size).toBe(1);
      expect(result.has(1)).toBe(true);
      expect(result.has(2)).toBe(false);
      expect(result.has(3)).toBe(false);
    });
  });

  describe('createEnemyType', () => {
    it('should insert with correct parameters', async () => {
      const config = makeConfig({ speed: 2 });
      mockExecute.mockResolvedValue({ insertId: 42 });

      await createEnemyType('Goblin', 'A sneaky goblin', config, 1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_enemy_types'),
        ['Goblin', 'A sneaky goblin', JSON.stringify(config), false, 1],
      );
    });

    it('should JSON.stringify the config', async () => {
      const config = makeConfig({ speed: 5 });
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createEnemyType('Fast', 'Very fast', config, 2);

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(typeof args[2]).toBe('string');
      expect(JSON.parse(args[2] as string)).toEqual(config);
    });

    it('should extract isBoss from config for the is_boss column', async () => {
      const bossConfig = makeConfig({ isBoss: true });
      mockExecute.mockResolvedValue({ insertId: 10 });

      await createEnemyType('Dragon', 'A mighty dragon', bossConfig, 1);

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[3]).toBe(true);
    });

    it('should set is_boss to false for non-boss config', async () => {
      const config = makeConfig({ isBoss: false });
      mockExecute.mockResolvedValue({ insertId: 11 });

      await createEnemyType('Slime', 'Basic slime', config, 1);

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[3]).toBe(false);
    });

    it('should return the insertId', async () => {
      mockExecute.mockResolvedValue({ insertId: 55 });

      const result = await createEnemyType('Test', '', makeConfig(), 1);

      expect(result).toBe(55);
    });

    it('should pass createdBy as last parameter', async () => {
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createEnemyType('Enemy', 'desc', makeConfig(), 99);

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[4]).toBe(99);
    });
  });

  describe('updateEnemyType', () => {
    it('should update name only', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { name: 'Renamed' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET name = ?'),
        ['Renamed', 5],
      );
    });

    it('should update description only', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { description: 'New desc' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET description = ?'),
        ['New desc', 5],
      );
    });

    it('should update config and set is_boss column', async () => {
      const config = makeConfig({ isBoss: true, speed: 10 });
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { config });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('config = ?'),
        expect.arrayContaining([JSON.stringify(config), true, 5]),
      );
    });

    it('should set is_boss to false when config.isBoss is false', async () => {
      const config = makeConfig({ isBoss: false });
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { config });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args).toContain(false);
    });

    it('should include is_boss in SET clause when config is updated', async () => {
      const config = makeConfig({ isBoss: true });
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { config });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('is_boss = ?'),
        expect.any(Array),
      );
    });

    it('should update multiple fields at once', async () => {
      const config = makeConfig({ isBoss: false });
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { name: 'New', description: 'Desc', config });

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('description = ?');
      expect(sql).toContain('config = ?');
      expect(sql).toContain('is_boss = ?');
      expect(sql).toContain('WHERE id = ?');
    });

    it('should append id as last parameter', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(77, { name: 'Test' });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[args.length - 1]).toBe(77);
    });

    it('should no-op when updates object is empty', async () => {
      await updateEnemyType(5, {});

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should JSON.stringify the config in update', async () => {
      const config = makeConfig({ hp: 50 });
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { config });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      const configArg = args[0] as string;
      expect(typeof configArg).toBe('string');
      expect(JSON.parse(configArg)).toEqual(config);
    });

    it('should handle name and description without config', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateEnemyType(5, { name: 'A', description: 'B' });

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).not.toContain('config = ?');
      expect(sql).not.toContain('is_boss = ?');
      expect(mockExecute).toHaveBeenCalledWith(
        expect.any(String),
        ['A', 'B', 5],
      );
    });
  });

  describe('deleteEnemyType', () => {
    it('should execute DELETE with correct id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await deleteEnemyType(12);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM campaign_enemy_types WHERE id = ?'),
        [12],
      );
    });

    it('should not throw when deleting non-existent id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      await expect(deleteEnemyType(999)).resolves.toBeUndefined();
    });
  });
});
