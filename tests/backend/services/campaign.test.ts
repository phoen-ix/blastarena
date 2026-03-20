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
  listWorlds,
  listWorldsWithProgress,
  getWorld,
  createWorld,
  updateWorld,
  deleteWorld,
  reorderWorld,
  listLevels,
  listLevelsWithProgress,
  getLevel,
  createLevel,
  updateLevel,
  deleteLevel,
  reorderLevel,
  getNextLevel,
} from '../../../backend/src/services/campaign';

// --- Helper factories ---

function makeWorldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Test World',
    description: 'A test world',
    sort_order: 0,
    theme: 'forest',
    is_published: 1,
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date(),
    level_count: 3,
    completed_count: undefined,
    ...overrides,
  };
}

function makeLevelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    world_id: 1,
    name: 'Level 1',
    description: 'First level',
    sort_order: 0,
    map_width: 15,
    map_height: 13,
    tiles: JSON.stringify([['empty', 'wall'], ['empty', 'empty']]),
    fill_mode: 'handcrafted',
    wall_density: 0.65,
    player_spawns: JSON.stringify([{ x: 1, y: 1 }]),
    enemy_placements: JSON.stringify([
      { enemyTypeId: 1, x: 5, y: 5 },
      { enemyTypeId: 2, x: 7, y: 7 },
    ]),
    powerup_placements: JSON.stringify([{ type: 'bomb_up', x: 3, y: 3, hidden: false }]),
    win_condition: 'kill_all',
    win_condition_config: null,
    lives: 3,
    time_limit: 120,
    par_time: 60,
    carry_over_powerups: 0,
    starting_powerups: null,
    available_powerup_types: null,
    powerup_drop_rate: 0.3,
    reinforced_walls: 0,
    hazard_tiles: 0,
    is_published: 1,
    created_by: 1,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('Campaign Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== WORLDS ====================

  describe('listWorlds', () => {
    it('should return published worlds with level counts', async () => {
      const row = makeWorldRow({ level_count: 5 });
      mockQuery.mockResolvedValue([row]);

      const result = await listWorlds();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 1,
        name: 'Test World',
        description: 'A test world',
        sortOrder: 0,
        theme: 'forest',
        isPublished: true,
        levelCount: 5,
        completedCount: undefined,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_published = TRUE'),
      );
    });

    it('should include unpublished worlds when flag is true', async () => {
      mockQuery.mockResolvedValue([]);

      await listWorlds(true);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('WHERE w.is_published');
    });

    it('should return empty array when no worlds exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await listWorlds();

      expect(result).toEqual([]);
    });

    it('should handle multiple worlds with correct mapping', async () => {
      const rows = [
        makeWorldRow({ id: 1, name: 'World A', sort_order: 0, level_count: 2 }),
        makeWorldRow({ id: 2, name: 'World B', sort_order: 1, level_count: 0, is_published: 0 }),
      ];
      mockQuery.mockResolvedValue(rows);

      const result = await listWorlds(true);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('World A');
      expect(result[0].levelCount).toBe(2);
      expect(result[1].name).toBe('World B');
      expect(result[1].isPublished).toBe(false);
      expect(result[1].levelCount).toBe(0);
    });
  });

  describe('listWorldsWithProgress', () => {
    it('should query with userId and include completed_count', async () => {
      const row = makeWorldRow({ level_count: 4, completed_count: 2 });
      mockQuery.mockResolvedValue([row]);

      const result = await listWorldsWithProgress(42);

      expect(result).toHaveLength(1);
      expect(result[0].levelCount).toBe(4);
      expect(result[0].completedCount).toBe(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('completed_count'),
        [42],
      );
    });

    it('should only return published worlds', async () => {
      mockQuery.mockResolvedValue([]);

      await listWorldsWithProgress(1);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_published = TRUE'),
        [1],
      );
    });

    it('should return empty array when no worlds exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await listWorldsWithProgress(1);

      expect(result).toEqual([]);
    });
  });

  describe('getWorld', () => {
    it('should return a world when found', async () => {
      const row = makeWorldRow({ id: 5, name: 'Lava World', theme: 'lava', level_count: 7 });
      mockQuery.mockResolvedValue([row]);

      const result = await getWorld(5);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(5);
      expect(result!.name).toBe('Lava World');
      expect(result!.theme).toBe('lava');
      expect(result!.levelCount).toBe(7);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE w.id = ?'),
        [5],
      );
    });

    it('should return null when world is not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getWorld(999);

      expect(result).toBeNull();
    });

    it('should coerce is_published to boolean', async () => {
      const row = makeWorldRow({ is_published: 0 });
      mockQuery.mockResolvedValue([row]);

      const result = await getWorld(1);

      expect(result!.isPublished).toBe(false);
    });

    it('should default description to empty string when null', async () => {
      const row = makeWorldRow({ description: null });
      mockQuery.mockResolvedValue([row]);

      const result = await getWorld(1);

      expect(result!.description).toBe('');
    });
  });

  describe('createWorld', () => {
    it('should auto-calculate sortOrder from MAX query', async () => {
      mockQuery.mockResolvedValue([{ total: 2 }]);
      mockExecute.mockResolvedValue({ insertId: 10 });

      const result = await createWorld('New World', 'Desc', 'desert', 1);

      expect(result).toBe(10);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('MAX(sort_order)'),
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_worlds'),
        ['New World', 'Desc', 'desert', 3, 1],
      );
    });

    it('should use sortOrder 0 when no worlds exist (MAX returns -1)', async () => {
      mockQuery.mockResolvedValue([{ total: -1 }]);
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createWorld('First', '', 'forest', 5);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_worlds'),
        ['First', '', 'forest', 0, 5],
      );
    });

    it('should handle null total from MAX query', async () => {
      mockQuery.mockResolvedValue([{ total: null }]);
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createWorld('First', '', 'ice', 1);

      // (null ?? -1) + 1 = 0
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_worlds'),
        ['First', '', 'ice', 0, 1],
      );
    });

    it('should handle undefined maxOrder row', async () => {
      mockQuery.mockResolvedValue([undefined]);
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createWorld('First', '', 'cave', 1);

      // (undefined?.total ?? -1) + 1 = 0
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO campaign_worlds'),
        ['First', '', 'cave', 0, 1],
      );
    });
  });

  describe('updateWorld', () => {
    it('should update only the specified fields', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateWorld(5, { name: 'Updated Name' });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE campaign_worlds SET name = ? WHERE id = ?'),
        ['Updated Name', 5],
      );
    });

    it('should handle multiple fields', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateWorld(3, { name: 'New', description: 'Desc', theme: 'lava', isPublished: true });

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('description = ?');
      expect(sql).toContain('theme = ?');
      expect(sql).toContain('is_published = ?');

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params).toEqual(['New', 'Desc', 'lava', true, 3]);
    });

    it('should no-op when updates is empty', async () => {
      await updateWorld(1, {});

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should update isPublished to false', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateWorld(1, { isPublished: false });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('is_published = ?'),
        [false, 1],
      );
    });
  });

  describe('deleteWorld', () => {
    it('should execute DELETE with the world id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await deleteWorld(7);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM campaign_worlds WHERE id = ?'),
        [7],
      );
    });
  });

  describe('reorderWorld', () => {
    it('should update sort_order for the given world', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await reorderWorld(3, 5);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE campaign_worlds SET sort_order = ? WHERE id = ?'),
        [5, 3],
      );
    });
  });

  // ==================== LEVELS ====================

  describe('listLevels', () => {
    it('should return published level summaries by default', async () => {
      const row = makeLevelRow();
      mockQuery.mockResolvedValue([row]);

      const result = await listLevels(1);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 10,
        worldId: 1,
        name: 'Level 1',
        description: 'First level',
        sortOrder: 0,
        mapWidth: 15,
        mapHeight: 13,
        winCondition: 'kill_all',
        lives: 3,
        timeLimit: 120,
        parTime: 60,
        enemyCount: 2,
        isPublished: true,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_published = TRUE'),
        [1],
      );
    });

    it('should include unpublished levels when flag is true', async () => {
      mockQuery.mockResolvedValue([]);

      await listLevels(1, true);

      const sql = mockQuery.mock.calls[0][0] as string;
      expect(sql).not.toContain('is_published');
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [1]);
    });

    it('should return empty array when no levels exist', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await listLevels(1);

      expect(result).toEqual([]);
    });

    it('should correctly count enemies from placements array', async () => {
      const row = makeLevelRow({
        enemy_placements: JSON.stringify([
          { enemyTypeId: 1, x: 1, y: 1 },
          { enemyTypeId: 2, x: 2, y: 2 },
          { enemyTypeId: 3, x: 3, y: 3 },
        ]),
      });
      mockQuery.mockResolvedValue([row]);

      const result = await listLevels(1);

      expect(result[0].enemyCount).toBe(3);
    });

    it('should return enemyCount 0 when placements is empty array', async () => {
      const row = makeLevelRow({ enemy_placements: JSON.stringify([]) });
      mockQuery.mockResolvedValue([row]);

      const result = await listLevels(1);

      expect(result[0].enemyCount).toBe(0);
    });

    it('should return enemyCount 0 when placements is not an array', async () => {
      const row = makeLevelRow({ enemy_placements: JSON.stringify(null) });
      mockQuery.mockResolvedValue([row]);

      const result = await listLevels(1);

      expect(result[0].enemyCount).toBe(0);
    });

    it('should handle already-parsed enemy_placements object', async () => {
      const row = makeLevelRow({
        enemy_placements: [{ enemyTypeId: 1, x: 1, y: 1 }],
      });
      mockQuery.mockResolvedValue([row]);

      const result = await listLevels(1, true);

      expect(result[0].enemyCount).toBe(1);
    });

    it('should default parTime to 0 when null', async () => {
      const row = makeLevelRow({ par_time: null });
      mockQuery.mockResolvedValue([row]);

      const result = await listLevels(1);

      expect(result[0].parTime).toBe(0);
    });

    it('should default description to empty string when null', async () => {
      const row = makeLevelRow({ description: null });
      mockQuery.mockResolvedValue([row]);

      const result = await listLevels(1);

      expect(result[0].description).toBe('');
    });
  });

  describe('listLevelsWithProgress', () => {
    it('should attach progress to matching summaries', async () => {
      const rows = [
        makeLevelRow({ id: 10 }),
        makeLevelRow({ id: 11, name: 'Level 2', sort_order: 1 }),
      ];
      mockQuery
        .mockResolvedValueOnce(rows) // levels query
        .mockResolvedValueOnce([     // progress query
          {
            level_id: 10,
            completed: 1,
            best_time_seconds: 45,
            stars: 3,
            attempts: 5,
          },
        ]);

      const result = await listLevelsWithProgress(1, 42);

      expect(result).toHaveLength(2);
      expect(result[0].progress).toEqual({
        levelId: 10,
        completed: true,
        bestTimeSeconds: 45,
        stars: 3,
        attempts: 5,
      });
      expect(result[1].progress).toBeUndefined();
    });

    it('should pass userId and levelIds to progress query', async () => {
      const rows = [
        makeLevelRow({ id: 10 }),
        makeLevelRow({ id: 20 }),
      ];
      mockQuery
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([]);

      await listLevelsWithProgress(1, 99);

      // First call: levels query
      expect(mockQuery).toHaveBeenNthCalledWith(1, expect.any(String), [1]);
      // Second call: progress query with userId and level ids
      expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('IN (?,?)'), [99, 10, 20]);
    });

    it('should skip progress query when no levels exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await listLevelsWithProgress(1, 42);

      expect(result).toEqual([]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should coerce progress completed to boolean', async () => {
      const rows = [makeLevelRow({ id: 10 })];
      mockQuery
        .mockResolvedValueOnce(rows)
        .mockResolvedValueOnce([{
          level_id: 10,
          completed: 0,
          best_time_seconds: null,
          stars: 0,
          attempts: 1,
        }]);

      const result = await listLevelsWithProgress(1, 1);

      expect(result[0].progress!.completed).toBe(false);
      expect(result[0].progress!.bestTimeSeconds).toBeNull();
    });
  });

  describe('getLevel', () => {
    it('should return a full level entry when found', async () => {
      const row = makeLevelRow();
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(10);

      expect(result).not.toBeNull();
      expect(result!.id).toBe(10);
      expect(result!.worldId).toBe(1);
      expect(result!.name).toBe('Level 1');
      expect(result!.mapWidth).toBe(15);
      expect(result!.mapHeight).toBe(13);
      expect(result!.tiles).toEqual([['empty', 'wall'], ['empty', 'empty']]);
      expect(result!.playerSpawns).toEqual([{ x: 1, y: 1 }]);
      expect(result!.enemyPlacements).toEqual([
        { enemyTypeId: 1, x: 5, y: 5 },
        { enemyTypeId: 2, x: 7, y: 7 },
      ]);
      expect(result!.powerupPlacements).toEqual([{ type: 'bomb_up', x: 3, y: 3, hidden: false }]);
      expect(result!.winCondition).toBe('kill_all');
      expect(result!.winConditionConfig).toBeNull();
      expect(result!.lives).toBe(3);
      expect(result!.timeLimit).toBe(120);
      expect(result!.parTime).toBe(60);
      expect(result!.fillMode).toBe('handcrafted');
      expect(result!.wallDensity).toBe(0.65);
      expect(result!.powerupDropRate).toBe(0.3);
      expect(result!.carryOverPowerups).toBe(false);
      expect(result!.startingPowerups).toBeNull();
      expect(result!.availablePowerupTypes).toBeNull();
      expect(result!.reinforcedWalls).toBe(false);
      expect(result!.hazardTiles).toBe(false);
      expect(result!.isPublished).toBe(true);
    });

    it('should return null when level is not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await getLevel(999);

      expect(result).toBeNull();
    });

    it('should parse JSON string fields', async () => {
      const row = makeLevelRow({
        tiles: JSON.stringify([['wall']]),
        player_spawns: JSON.stringify([{ x: 0, y: 0 }]),
        enemy_placements: JSON.stringify([]),
        powerup_placements: JSON.stringify([]),
        win_condition_config: JSON.stringify({ exitPosition: { x: 10, y: 10 } }),
        starting_powerups: JSON.stringify({ bombUp: 2, fireUp: 1 }),
        available_powerup_types: JSON.stringify(['bomb_up', 'fire_up']),
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(1);

      expect(result!.tiles).toEqual([['wall']]);
      expect(result!.playerSpawns).toEqual([{ x: 0, y: 0 }]);
      expect(result!.enemyPlacements).toEqual([]);
      expect(result!.powerupPlacements).toEqual([]);
      expect(result!.winConditionConfig).toEqual({ exitPosition: { x: 10, y: 10 } });
      expect(result!.startingPowerups).toEqual({ bombUp: 2, fireUp: 1 });
      expect(result!.availablePowerupTypes).toEqual(['bomb_up', 'fire_up']);
    });

    it('should handle already-parsed objects (not strings)', async () => {
      const row = makeLevelRow({
        tiles: [['empty']],
        player_spawns: [{ x: 1, y: 1 }],
        enemy_placements: [],
        powerup_placements: [],
        win_condition_config: { surviveTimeTicks: 200 },
        starting_powerups: { shield: true },
        available_powerup_types: ['speed_up'],
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(1);

      expect(result!.tiles).toEqual([['empty']]);
      expect(result!.playerSpawns).toEqual([{ x: 1, y: 1 }]);
      expect(result!.winConditionConfig).toEqual({ surviveTimeTicks: 200 });
      expect(result!.startingPowerups).toEqual({ shield: true });
      expect(result!.availablePowerupTypes).toEqual(['speed_up']);
    });

    it('should handle null optional JSON fields', async () => {
      const row = makeLevelRow({
        win_condition_config: null,
        starting_powerups: null,
        available_powerup_types: null,
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(1);

      expect(result!.winConditionConfig).toBeNull();
      expect(result!.startingPowerups).toBeNull();
      expect(result!.availablePowerupTypes).toBeNull();
    });

    it('should coerce boolean fields correctly', async () => {
      const row = makeLevelRow({
        carry_over_powerups: 1,
        reinforced_walls: 1,
        hazard_tiles: 1,
        is_published: 0,
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(1);

      expect(result!.carryOverPowerups).toBe(true);
      expect(result!.reinforcedWalls).toBe(true);
      expect(result!.hazardTiles).toBe(true);
      expect(result!.isPublished).toBe(false);
    });

    it('should convert wall_density and powerup_drop_rate to Number', async () => {
      const row = makeLevelRow({
        wall_density: '0.75',
        powerup_drop_rate: '0.5',
      });
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(1);

      expect(result!.wallDensity).toBe(0.75);
      expect(typeof result!.wallDensity).toBe('number');
      expect(result!.powerupDropRate).toBe(0.5);
      expect(typeof result!.powerupDropRate).toBe('number');
    });

    it('should default parTime to 0 when null', async () => {
      const row = makeLevelRow({ par_time: null });
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(1);

      expect(result!.parTime).toBe(0);
    });

    it('should default description to empty string when null', async () => {
      const row = makeLevelRow({ description: null });
      mockQuery.mockResolvedValue([row]);

      const result = await getLevel(1);

      expect(result!.description).toBe('');
    });
  });

  describe('createLevel', () => {
    it('should auto-calculate sortOrder and return insertId', async () => {
      mockQuery.mockResolvedValue([{ total: 4 }]);
      mockExecute.mockResolvedValue({ insertId: 25 });

      const result = await createLevel(1, { name: 'New Level' }, 5);

      expect(result).toBe(25);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('MAX(sort_order)'),
        [1],
      );
      const params = mockExecute.mock.calls[0][1] as unknown[];
      // sortOrder should be 5 (4 + 1)
      expect(params[3]).toBe(5);
    });

    it('should use sortOrder 0 when no levels exist in the world', async () => {
      mockQuery.mockResolvedValue([{ total: -1 }]);
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createLevel(2, {}, 1);

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params[3]).toBe(0);
    });

    it('should use default values for unspecified fields', async () => {
      mockQuery.mockResolvedValue([{ total: -1 }]);
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createLevel(1, {}, 1);

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe(1);           // worldId
      expect(params[1]).toBe('Untitled Level'); // name default
      expect(params[2]).toBe('');           // description default
      expect(params[4]).toBe(15);          // mapWidth default
      expect(params[5]).toBe(13);          // mapHeight default
      expect(params[6]).toBe('[]');        // tiles default
      expect(params[7]).toBe('handcrafted'); // fillMode default
      expect(params[8]).toBe(0.65);        // wallDensity default
      expect(params[9]).toBe('[]');        // playerSpawns default
      expect(params[10]).toBe('[]');       // enemyPlacements default
      expect(params[11]).toBe('[]');       // powerupPlacements default
      expect(params[12]).toBe('kill_all'); // winCondition default
      expect(params[13]).toBeNull();       // winConditionConfig default
      expect(params[14]).toBe(3);          // lives default
      expect(params[15]).toBe(0);          // timeLimit default
      expect(params[16]).toBe(0);          // parTime default
      expect(params[17]).toBe(false);      // carryOverPowerups default
      expect(params[18]).toBeNull();       // startingPowerups default
      expect(params[19]).toBeNull();       // availablePowerupTypes default
      expect(params[20]).toBe(0.3);        // powerupDropRate default
      expect(params[21]).toBe(false);      // reinforcedWalls default
      expect(params[22]).toBe(false);      // hazardTiles default
      expect(params[23]).toBe(false);      // isPublished default
      expect(params[24]).toBe(1);          // createdBy
    });

    it('should JSON.stringify array/object fields', async () => {
      mockQuery.mockResolvedValue([{ total: 0 }]);
      mockExecute.mockResolvedValue({ insertId: 5 });

      const data = {
        tiles: [['empty', 'wall']] as unknown[][],
        playerSpawns: [{ x: 1, y: 1 }],
        enemyPlacements: [{ enemyTypeId: 1, x: 5, y: 5 }],
        powerupPlacements: [{ type: 'bomb_up' as const, x: 3, y: 3, hidden: false }],
        winConditionConfig: { exitPosition: { x: 10, y: 10 } },
        startingPowerups: { bombUp: 2 },
        availablePowerupTypes: ['bomb_up', 'fire_up'],
      };

      await createLevel(1, data as Record<string, unknown>, 1);

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params[6]).toBe(JSON.stringify(data.tiles));
      expect(params[9]).toBe(JSON.stringify(data.playerSpawns));
      expect(params[10]).toBe(JSON.stringify(data.enemyPlacements));
      expect(params[11]).toBe(JSON.stringify(data.powerupPlacements));
      expect(params[13]).toBe(JSON.stringify(data.winConditionConfig));
      expect(params[18]).toBe(JSON.stringify(data.startingPowerups));
      expect(params[19]).toBe(JSON.stringify(data.availablePowerupTypes));
    });

    it('should handle null optional JSON fields in create', async () => {
      mockQuery.mockResolvedValue([{ total: 0 }]);
      mockExecute.mockResolvedValue({ insertId: 1 });

      await createLevel(1, {
        winConditionConfig: null,
        startingPowerups: null,
        availablePowerupTypes: null,
      } as Record<string, unknown>, 1);

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params[13]).toBeNull(); // winConditionConfig
      expect(params[18]).toBeNull(); // startingPowerups
      expect(params[19]).toBeNull(); // availablePowerupTypes
    });
  });

  describe('updateLevel', () => {
    it('should update only scalar fields that are specified', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateLevel(10, { name: 'Renamed', lives: 5 });

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('lives = ?');
      expect(sql).toContain('WHERE id = ?');

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params).toEqual(['Renamed', 5, 10]);
    });

    it('should handle JSON fields with JSON.stringify', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const tiles = [['empty', 'wall']];
      await updateLevel(10, { tiles } as Record<string, unknown>);

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params[0]).toBe(JSON.stringify(tiles));
      expect(params[1]).toBe(10); // id
    });

    it('should pass null for JSON fields set to null', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateLevel(10, { winConditionConfig: null } as Record<string, unknown>);

      const params = mockExecute.mock.calls[0][1] as unknown[];
      expect(params[0]).toBeNull();
      expect(params[1]).toBe(10);
    });

    it('should no-op when data is empty', async () => {
      await updateLevel(10, {});

      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should handle mix of scalar and JSON fields', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateLevel(10, {
        name: 'Updated',
        mapWidth: 21,
        isPublished: true,
        tiles: [['wall']],
        enemyPlacements: [{ enemyTypeId: 1, x: 1, y: 1 }],
      } as Record<string, unknown>);

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('name = ?');
      expect(sql).toContain('map_width = ?');
      expect(sql).toContain('is_published = ?');
      expect(sql).toContain('tiles = ?');
      expect(sql).toContain('enemy_placements = ?');

      const params = mockExecute.mock.calls[0][1] as unknown[];
      // Scalar fields first, then JSON fields, then id
      expect(params[0]).toBe('Updated');
      expect(params[1]).toBe(21);
      expect(params[2]).toBe(true);
      expect(params[3]).toBe(JSON.stringify([['wall']]));
      expect(params[4]).toBe(JSON.stringify([{ enemyTypeId: 1, x: 1, y: 1 }]));
      expect(params[5]).toBe(10);
    });

    it('should correctly map camelCase to snake_case columns', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateLevel(10, {
        mapWidth: 21,
        mapHeight: 17,
        fillMode: 'hybrid',
        wallDensity: 0.8,
        winCondition: 'survive_time',
        timeLimit: 300,
        parTime: 120,
        carryOverPowerups: true,
        powerupDropRate: 0.5,
        reinforcedWalls: true,
        hazardTiles: true,
        isPublished: false,
      } as Record<string, unknown>);

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('map_width = ?');
      expect(sql).toContain('map_height = ?');
      expect(sql).toContain('fill_mode = ?');
      expect(sql).toContain('wall_density = ?');
      expect(sql).toContain('win_condition = ?');
      expect(sql).toContain('time_limit = ?');
      expect(sql).toContain('par_time = ?');
      expect(sql).toContain('carry_over_powerups = ?');
      expect(sql).toContain('powerup_drop_rate = ?');
      expect(sql).toContain('reinforced_walls = ?');
      expect(sql).toContain('hazard_tiles = ?');
      expect(sql).toContain('is_published = ?');
    });

    it('should handle all JSON field columns', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await updateLevel(10, {
        tiles: [],
        playerSpawns: [],
        enemyPlacements: [],
        powerupPlacements: [],
        winConditionConfig: { killTarget: 5 },
        startingPowerups: { kick: true },
        availablePowerupTypes: ['shield'],
      } as Record<string, unknown>);

      const sql = mockExecute.mock.calls[0][0] as string;
      expect(sql).toContain('tiles = ?');
      expect(sql).toContain('player_spawns = ?');
      expect(sql).toContain('enemy_placements = ?');
      expect(sql).toContain('powerup_placements = ?');
      expect(sql).toContain('win_condition_config = ?');
      expect(sql).toContain('starting_powerups = ?');
      expect(sql).toContain('available_powerup_types = ?');
    });
  });

  describe('deleteLevel', () => {
    it('should execute DELETE with the level id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await deleteLevel(15);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM campaign_levels WHERE id = ?'),
        [15],
      );
    });
  });

  describe('reorderLevel', () => {
    it('should update sort_order for the given level', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await reorderLevel(10, 3);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE campaign_levels SET sort_order = ? WHERE id = ?'),
        [3, 10],
      );
    });
  });

  describe('getNextLevel', () => {
    it('should return the next level id when one exists', async () => {
      mockQuery
        .mockResolvedValueOnce([{ world_id: 1, sort_order: 2 }]) // current level
        .mockResolvedValueOnce([{ id: 15 }]);                     // next level

      const result = await getNextLevel(10);

      expect(result).toBe(15);
      expect(mockQuery).toHaveBeenNthCalledWith(1,
        expect.stringContaining('WHERE id = ?'),
        [10],
      );
      expect(mockQuery).toHaveBeenNthCalledWith(2,
        expect.stringContaining('sort_order > ?'),
        [1, 2],
      );
    });

    it('should return null when current level is not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getNextLevel(999);

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should return null when no next level exists', async () => {
      mockQuery
        .mockResolvedValueOnce([{ world_id: 1, sort_order: 5 }])
        .mockResolvedValueOnce([]);

      const result = await getNextLevel(10);

      expect(result).toBeNull();
    });

    it('should only consider published levels for next', async () => {
      mockQuery
        .mockResolvedValueOnce([{ world_id: 2, sort_order: 0 }])
        .mockResolvedValueOnce([{ id: 20 }]);

      await getNextLevel(10);

      expect(mockQuery).toHaveBeenNthCalledWith(2,
        expect.stringContaining('is_published = TRUE'),
        [2, 0],
      );
    });

    it('should query within the same world_id', async () => {
      mockQuery
        .mockResolvedValueOnce([{ world_id: 3, sort_order: 1 }])
        .mockResolvedValueOnce([]);

      await getNextLevel(10);

      expect(mockQuery).toHaveBeenNthCalledWith(2,
        expect.stringContaining('world_id = ?'),
        [3, 1],
      );
    });

    it('should order by sort_order ASC and LIMIT 1', async () => {
      mockQuery
        .mockResolvedValueOnce([{ world_id: 1, sort_order: 0 }])
        .mockResolvedValueOnce([{ id: 11 }]);

      await getNextLevel(10);

      const sql = mockQuery.mock.calls[1][0] as string;
      expect(sql).toContain('ORDER BY sort_order ASC');
      expect(sql).toContain('LIMIT 1');
    });
  });
});
