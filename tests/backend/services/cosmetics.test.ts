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
  getAllCosmetics,
  getCosmeticById,
  createCosmetic,
  updateCosmetic,
  deleteCosmetic,
  getUserCosmetics,
  unlockCosmetic,
  getEquippedCosmetics,
  equipCosmetic,
  getPlayerCosmeticsForGame,
  unlockDefaultCosmetics,
  checkCampaignStarUnlocks,
} from '../../../backend/src/services/cosmetics';

function makeCosmeticRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Classic Red',
    type: 'color',
    config: JSON.stringify({ hex: 'ff0000' }),
    rarity: 'common',
    unlock_type: 'default',
    unlock_requirement: null,
    is_active: true,
    sort_order: 0,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('Cosmetics Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllCosmetics', () => {
    it('should return mapped cosmetics', async () => {
      const rows = [
        makeCosmeticRow({ id: 1, name: 'Red', type: 'color' }),
        makeCosmeticRow({ id: 2, name: 'Big Eyes', type: 'eyes', config: JSON.stringify({ style: 'big' }) }),
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await getAllCosmetics();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[0].name).toBe('Red');
      expect(result[0].type).toBe('color');
      expect(result[0].config).toEqual({ hex: 'ff0000' });
      expect(result[0].rarity).toBe('common');
      expect(result[0].unlockType).toBe('default');
      expect(result[0].unlockRequirement).toBeNull();
      expect(result[0].isActive).toBe(true);
      expect(result[0].sortOrder).toBe(0);
      expect(result[1].name).toBe('Big Eyes');
      expect(result[1].type).toBe('eyes');
    });

    it('should query without WHERE when activeOnly is false', async () => {
      mockQuery.mockResolvedValue([]);

      await getAllCosmetics(false);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('WHERE is_active = TRUE');
      expect(sql).toContain('ORDER BY type, sort_order, id');
    });

    it('should query with WHERE is_active = TRUE when activeOnly is true', async () => {
      mockQuery.mockResolvedValue([]);

      await getAllCosmetics(true);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_active = TRUE'),
      );
    });

    it('should return empty array when no cosmetics exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getAllCosmetics();

      expect(result).toEqual([]);
    });

    it('should parse JSON config string into object', async () => {
      const row = makeCosmeticRow({ config: JSON.stringify({ hex: '00ff00' }) });
      mockQuery.mockResolvedValue([row]);

      const result = await getAllCosmetics();

      expect(result[0].config).toEqual({ hex: '00ff00' });
    });

    it('should handle config that is already an object', async () => {
      const row = makeCosmeticRow({ config: { hex: '0000ff' } });
      mockQuery.mockResolvedValue([row]);

      const result = await getAllCosmetics();

      expect(result[0].config).toEqual({ hex: '0000ff' });
    });

    it('should parse JSON unlock_requirement string', async () => {
      const row = makeCosmeticRow({
        unlock_requirement: JSON.stringify({ totalStars: 10 }),
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getAllCosmetics();

      expect(result[0].unlockRequirement).toEqual({ totalStars: 10 });
    });

    it('should handle unlock_requirement that is already an object', async () => {
      const row = makeCosmeticRow({
        unlock_requirement: { totalStars: 5 },
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getAllCosmetics();

      expect(result[0].unlockRequirement).toEqual({ totalStars: 5 });
    });
  });

  describe('getCosmeticById', () => {
    it('should return cosmetic when found', async () => {
      const row = makeCosmeticRow({ id: 42, name: 'Golden Trail' });
      mockQuery.mockResolvedValue([row]);

      const result = await getCosmeticById(42);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(42);
      expect(result!.name).toBe('Golden Trail');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ?'),
        [42],
      );
    });

    it('should return null when not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getCosmeticById(999);

      expect(result).toBeNull();
    });
  });

  describe('createCosmetic', () => {
    it('should INSERT and return the created cosmetic via getCosmeticById', async () => {
      const config = { hex: 'aabbcc' };
      const createdRow = makeCosmeticRow({
        id: 10,
        name: 'New Color',
        type: 'color',
        config: JSON.stringify(config),
      });
      mockExecute.mockResolvedValue({ insertId: 10 });
      mockQuery.mockResolvedValue([createdRow]);

      const result = await createCosmetic({
        name: 'New Color',
        type: 'color',
        config,
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cosmetics'),
        ['New Color', 'color', JSON.stringify(config), 'common', 'achievement', null, 0],
      );
      expect(result.id).toBe(10);
      expect(result.name).toBe('New Color');
    });

    it('should JSON.stringify the config', async () => {
      const config = { style: 'angry' };
      mockExecute.mockResolvedValue({ insertId: 1 });
      mockQuery.mockResolvedValue([makeCosmeticRow()]);

      await createCosmetic({ name: 'Test', type: 'eyes', config });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(typeof args[2]).toBe('string');
      expect(JSON.parse(args[2] as string)).toEqual(config);
    });

    it('should use provided optional fields', async () => {
      const config = { hex: '112233' };
      const unlockReq = { totalStars: 50 };
      mockExecute.mockResolvedValue({ insertId: 5 });
      mockQuery.mockResolvedValue([makeCosmeticRow({ id: 5 })]);

      await createCosmetic({
        name: 'Rare Color',
        type: 'color',
        config,
        rarity: 'epic',
        unlockType: 'campaign_stars',
        unlockRequirement: unlockReq,
        sortOrder: 10,
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO cosmetics'),
        ['Rare Color', 'color', JSON.stringify(config), 'epic', 'campaign_stars', JSON.stringify(unlockReq), 10],
      );
    });

    it('should default rarity to common, unlockType to achievement, sortOrder to 0', async () => {
      mockExecute.mockResolvedValue({ insertId: 1 });
      mockQuery.mockResolvedValue([makeCosmeticRow()]);

      await createCosmetic({ name: 'Basic', type: 'trail', config: {} });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[3]).toBe('common');
      expect(args[4]).toBe('achievement');
      expect(args[5]).toBeNull();
      expect(args[6]).toBe(0);
    });

    it('should call getCosmeticById with the insertId', async () => {
      mockExecute.mockResolvedValue({ insertId: 77 });
      mockQuery.mockResolvedValue([makeCosmeticRow({ id: 77 })]);

      await createCosmetic({ name: 'Test', type: 'color', config: {} });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ?'),
        [77],
      );
    });
  });

  describe('updateCosmetic', () => {
    it('should update name only', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCosmetic(5, { name: 'Renamed' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET name = ?'),
        ['Renamed', 5],
      );
    });

    it('should update type only', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCosmetic(5, { type: 'eyes' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET type = ?'),
        ['eyes', 5],
      );
    });

    it('should update config with JSON.stringify', async () => {
      const config = { hex: 'ff00ff' };
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCosmetic(5, { config });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(typeof args[0]).toBe('string');
      expect(JSON.parse(args[0] as string)).toEqual(config);
    });

    it('should update multiple fields at once', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCosmetic(5, { name: 'New', rarity: 'legendary', isActive: false, sortOrder: 99 });

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('rarity = ?');
      expect(sql).toContain('is_active = ?');
      expect(sql).toContain('sort_order = ?');
      expect(sql).toContain('WHERE id = ?');
    });

    it('should set unlock_requirement to null when value is null', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCosmetic(5, { unlockRequirement: null });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[0]).toBeNull();
    });

    it('should JSON.stringify unlock_requirement when non-null', async () => {
      const req = { totalStars: 20 };
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCosmetic(5, { unlockRequirement: req });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[0]).toBe(JSON.stringify(req));
    });

    it('should no-op when updates object is empty', async () => {
      await updateCosmetic(5, {});

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should append id as last parameter', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateCosmetic(77, { name: 'Test' });

      const args = mockExecute.mock.calls[0][1] as unknown[];
      expect(args[args.length - 1]).toBe(77);
    });
  });

  describe('deleteCosmetic', () => {
    it('should execute DELETE with correct id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await deleteCosmetic(12);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM cosmetics WHERE id = ?'),
        [12],
      );
    });

    it('should not throw when deleting non-existent id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      await expect(deleteCosmetic(999)).resolves.toBeUndefined();
    });
  });

  describe('getUserCosmetics', () => {
    it('should query with JOIN and return mapped cosmetics', async () => {
      const rows = [
        {
          user_id: 1,
          cosmetic_id: 10,
          unlocked_at: new Date(),
          name: 'Red',
          type: 'color',
          config: JSON.stringify({ hex: 'ff0000' }),
          rarity: 'common',
          unlock_type: 'default',
          unlock_requirement: null,
          is_active: true,
          sort_order: 0,
        },
        {
          user_id: 1,
          cosmetic_id: 20,
          unlocked_at: new Date(),
          name: 'Big Eyes',
          type: 'eyes',
          config: JSON.stringify({ style: 'big' }),
          rarity: 'rare',
          unlock_type: 'achievement',
          unlock_requirement: null,
          is_active: true,
          sort_order: 1,
        },
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await getUserCosmetics(1);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(10);
      expect(result[0].name).toBe('Red');
      expect(result[0].type).toBe('color');
      expect(result[0].config).toEqual({ hex: 'ff0000' });
      expect(result[1].id).toBe(20);
      expect(result[1].name).toBe('Big Eyes');
      expect(result[1].type).toBe('eyes');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('JOIN cosmetics'),
        [1],
      );
    });

    it('should handle config that is already an object', async () => {
      const rows = [
        {
          user_id: 1,
          cosmetic_id: 10,
          unlocked_at: new Date(),
          name: 'Blue',
          type: 'color',
          config: { hex: '0000ff' },
          rarity: 'common',
          unlock_type: 'default',
          unlock_requirement: null,
          is_active: true,
          sort_order: 0,
        },
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await getUserCosmetics(1);

      expect(result[0].config).toEqual({ hex: '0000ff' });
    });

    it('should return empty array when user has no cosmetics', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getUserCosmetics(1);

      expect(result).toEqual([]);
    });

    it('should parse JSON unlock_requirement from joined row', async () => {
      const rows = [
        {
          user_id: 1,
          cosmetic_id: 10,
          unlocked_at: new Date(),
          name: 'Star Trail',
          type: 'trail',
          config: JSON.stringify({ particleKey: 'star' }),
          rarity: 'epic',
          unlock_type: 'campaign_stars',
          unlock_requirement: JSON.stringify({ totalStars: 25 }),
          is_active: true,
          sort_order: 0,
        },
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await getUserCosmetics(1);

      expect(result[0].unlockRequirement).toEqual({ totalStars: 25 });
    });
  });

  describe('unlockCosmetic', () => {
    it('should INSERT IGNORE into user_cosmetics', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await unlockCosmetic(1, 42);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE INTO user_cosmetics'),
        [1, 42],
      );
    });

    it('should not throw when cosmetic already unlocked (INSERT IGNORE)', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      await expect(unlockCosmetic(1, 42)).resolves.toBeUndefined();
    });
  });

  describe('getEquippedCosmetics', () => {
    it('should return equipped ids when row exists', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_id: 10,
        eyes_id: 20,
        trail_id: 30,
        bomb_skin_id: 40,
        updated_at: new Date(),
      }]);

      const result = await getEquippedCosmetics(1);

      expect(result).toEqual({
        colorId: 10,
        eyesId: 20,
        trailId: 30,
        bombSkinId: 40,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FROM user_equipped_cosmetics WHERE user_id = ?'),
        [1],
      );
    });

    it('should return all nulls when no row exists', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getEquippedCosmetics(1);

      expect(result).toEqual({
        colorId: null,
        eyesId: null,
        trailId: null,
        bombSkinId: null,
      });
    });

    it('should return partial nulls when some slots are null', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_id: 10,
        eyes_id: null,
        trail_id: null,
        bomb_skin_id: 40,
        updated_at: new Date(),
      }]);

      const result = await getEquippedCosmetics(1);

      expect(result).toEqual({
        colorId: 10,
        eyesId: null,
        trailId: null,
        bombSkinId: 40,
      });
    });
  });

  describe('equipCosmetic', () => {
    it('should equip a cosmetic when owned and type matches', async () => {
      // Ownership check
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }]) // COUNT query
        .mockResolvedValueOnce([makeCosmeticRow({ id: 10, type: 'color' })]); // getCosmeticById
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await equipCosmetic(1, 'color', 10);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_equipped_cosmetics'),
        [1, 10, 10],
      );
    });

    it('should use correct column for color slot', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([makeCosmeticRow({ id: 10, type: 'color' })]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await equipCosmetic(1, 'color', 10);

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('color_id');
    });

    it('should use correct column for eyes slot', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([makeCosmeticRow({ id: 20, type: 'eyes' })]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await equipCosmetic(1, 'eyes', 20);

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('eyes_id');
    });

    it('should use correct column for trail slot', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([makeCosmeticRow({ id: 30, type: 'trail' })]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await equipCosmetic(1, 'trail', 30);

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('trail_id');
    });

    it('should use correct column for bomb_skin slot', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([makeCosmeticRow({ id: 40, type: 'bomb_skin' })]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await equipCosmetic(1, 'bomb_skin', 40);

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('bomb_skin_id');
    });

    it('should throw when user does not own the cosmetic', async () => {
      mockQuery.mockResolvedValueOnce([{ total: 0 }]);

      await expect(equipCosmetic(1, 'color', 10)).rejects.toThrow(
        'You do not own this cosmetic',
      );
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should throw when cosmetic type does not match slot', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([makeCosmeticRow({ id: 10, type: 'eyes' })]); // type is eyes, slot is color

      await expect(equipCosmetic(1, 'color', 10)).rejects.toThrow(
        'Cosmetic type does not match slot',
      );
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should throw when cosmetic not found by id', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([]); // getCosmeticById returns null

      await expect(equipCosmetic(1, 'color', 999)).rejects.toThrow(
        'Cosmetic type does not match slot',
      );
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should skip validation and unequip when cosmeticId is null', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await equipCosmetic(1, 'color', null);

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('color_id'),
        [1, null, null],
      );
    });

    it('should use ON DUPLICATE KEY UPDATE for upsert', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([makeCosmeticRow({ id: 10, type: 'color' })]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await equipCosmetic(1, 'color', 10);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('ON DUPLICATE KEY UPDATE'),
        expect.any(Array),
      );
    });
  });

  describe('getPlayerCosmeticsForGame', () => {
    it('should return empty map for empty userIds array', async () => {
      const result = await getPlayerCosmeticsForGame([]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should build correct placeholders for multiple ids', async () => {
      mockQuery.mockResolvedValue([]);

      await getPlayerCosmeticsForGame([1, 2, 3]);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('IN (?,?,?)'),
        [1, 2, 3],
      );
    });

    it('should map color config hex correctly', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: JSON.stringify({ hex: 'ff6600' }),
        eyes_config: null,
        trail_config: null,
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      expect(result.size).toBe(1);
      const data = result.get(1)!;
      expect(data.colorHex).toBe(parseInt('ff6600', 16));
    });

    it('should map color config with numeric hex', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: JSON.stringify({ hex: 0xff0000 }),
        eyes_config: null,
        trail_config: null,
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      const data = result.get(1)!;
      expect(data.colorHex).toBe(0xff0000);
    });

    it('should map eyes config style correctly', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: JSON.stringify({ style: 'angry' }),
        trail_config: null,
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      const data = result.get(1)!;
      expect(data.eyeStyle).toBe('angry');
    });

    it('should map trail config with defaults', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: null,
        trail_config: JSON.stringify({ particleKey: 'particle_fire' }),
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      const data = result.get(1)!;
      expect(data.trailConfig).toEqual({
        particleKey: 'particle_fire',
        tint: 0xffffff,
        frequency: 50,
      });
    });

    it('should map trail config with custom tint and frequency', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: null,
        trail_config: JSON.stringify({ particleKey: 'particle_star', tint: 0xff0000, frequency: 100 }),
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      const data = result.get(1)!;
      expect(data.trailConfig).toEqual({
        particleKey: 'particle_star',
        tint: 0xff0000,
        frequency: 100,
      });
    });

    it('should map bomb skin config with defaults', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: null,
        trail_config: null,
        bomb_skin_config: JSON.stringify({ baseColor: 0x222222 }),
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      const data = result.get(1)!;
      expect(data.bombSkinConfig).toEqual({
        baseColor: 0x222222,
        fuseColor: 0xff4444,
        label: 'custom',
      });
    });

    it('should map bomb skin config with custom fuseColor and label', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: null,
        trail_config: null,
        bomb_skin_config: JSON.stringify({ baseColor: 0x111111, fuseColor: 0x00ff00, label: 'skull' }),
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      const data = result.get(1)!;
      expect(data.bombSkinConfig).toEqual({
        baseColor: 0x111111,
        fuseColor: 0x00ff00,
        label: 'skull',
      });
    });

    it('should not add entries when all configs are null', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: null,
        trail_config: null,
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      expect(result.size).toBe(0);
    });

    it('should handle multiple users with different cosmetics', async () => {
      mockQuery.mockResolvedValue([
        {
          user_id: 1,
          color_config: JSON.stringify({ hex: 'ff0000' }),
          eyes_config: null,
          trail_config: null,
          bomb_skin_config: null,
        },
        {
          user_id: 2,
          color_config: null,
          eyes_config: JSON.stringify({ style: 'sleepy' }),
          trail_config: null,
          bomb_skin_config: null,
        },
      ]);

      const result = await getPlayerCosmeticsForGame([1, 2]);

      expect(result.size).toBe(2);
      expect(result.get(1)!.colorHex).toBe(parseInt('ff0000', 16));
      expect(result.get(2)!.eyeStyle).toBe('sleepy');
    });

    it('should handle config that is already an object (not string)', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: { hex: 'aabb00' },
        eyes_config: null,
        trail_config: null,
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      expect(result.get(1)!.colorHex).toBe(parseInt('aabb00', 16));
    });

    it('should skip trail entry when particleKey is missing', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: null,
        trail_config: JSON.stringify({ tint: 0xff0000 }),
        bomb_skin_config: null,
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      expect(result.size).toBe(0);
    });

    it('should skip bomb skin entry when baseColor is missing', async () => {
      mockQuery.mockResolvedValue([{
        user_id: 1,
        color_config: null,
        eyes_config: null,
        trail_config: null,
        bomb_skin_config: JSON.stringify({ label: 'test' }),
      }]);

      const result = await getPlayerCosmeticsForGame([1]);

      expect(result.size).toBe(0);
    });
  });

  describe('unlockDefaultCosmetics', () => {
    it('should INSERT IGNORE from cosmetics where unlock_type is default', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 3 });

      await unlockDefaultCosmetics(1);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE INTO user_cosmetics'),
        [1],
      );
      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain("WHERE unlock_type = 'default'");
    });

    it('should pass the userId parameter', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      await unlockDefaultCosmetics(42);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.any(String),
        [42],
      );
    });
  });

  describe('checkCampaignStarUnlocks', () => {
    it('should unlock cosmetics where user has enough stars', async () => {
      mockQuery.mockResolvedValue([
        { id: 10, unlock_requirement: JSON.stringify({ totalStars: 5 }) },
        { id: 20, unlock_requirement: JSON.stringify({ totalStars: 10 }) },
      ]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await checkCampaignStarUnlocks(1, 15);

      expect(result).toEqual([10, 20]);
      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE INTO user_cosmetics'),
        [1, 10],
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT IGNORE INTO user_cosmetics'),
        [1, 20],
      );
    });

    it('should skip cosmetics where user does not have enough stars', async () => {
      mockQuery.mockResolvedValue([
        { id: 10, unlock_requirement: JSON.stringify({ totalStars: 5 }) },
        { id: 20, unlock_requirement: JSON.stringify({ totalStars: 100 }) },
      ]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await checkCampaignStarUnlocks(1, 10);

      expect(result).toEqual([10]);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no qualifying cosmetics', async () => {
      mockQuery.mockResolvedValue([
        { id: 10, unlock_requirement: JSON.stringify({ totalStars: 50 }) },
      ]);

      const result = await checkCampaignStarUnlocks(1, 5);

      expect(result).toEqual([]);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should return empty array when no unowned campaign_stars cosmetics exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await checkCampaignStarUnlocks(1, 100);

      expect(result).toEqual([]);
    });

    it('should query for unowned campaign_stars cosmetics', async () => {
      mockQuery.mockResolvedValue([]);

      await checkCampaignStarUnlocks(1, 10);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("unlock_type = 'campaign_stars'"),
        [1],
      );
      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).toContain('is_active = TRUE');
      expect(sql).toContain('uc.user_id IS NULL');
    });

    it('should handle unlock_requirement that is already an object', async () => {
      mockQuery.mockResolvedValue([
        { id: 10, unlock_requirement: { totalStars: 3 } },
      ]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await checkCampaignStarUnlocks(1, 5);

      expect(result).toEqual([10]);
    });

    it('should unlock when totalStars equals requirement exactly', async () => {
      mockQuery.mockResolvedValue([
        { id: 10, unlock_requirement: JSON.stringify({ totalStars: 10 }) },
      ]);
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await checkCampaignStarUnlocks(1, 10);

      expect(result).toEqual([10]);
    });
  });
});
