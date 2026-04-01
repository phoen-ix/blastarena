import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

import * as customMapsService from '../../../backend/src/services/custom-maps';

function makeMapRow(
  overrides: Partial<{
    id: number;
    name: string;
    description: string;
    map_width: number;
    map_height: number;
    tiles: string;
    spawn_points: string;
    is_published: boolean;
    created_by: number;
    creator_username: string;
    play_count: number;
    created_at: Date;
    updated_at: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'Test Map',
    description: overrides.description ?? 'A test map',
    map_width: overrides.map_width ?? 11,
    map_height: overrides.map_height ?? 11,
    tiles:
      overrides.tiles ??
      JSON.stringify([
        ['empty', 'wall'],
        ['wall', 'empty'],
      ]),
    spawn_points:
      overrides.spawn_points ??
      JSON.stringify([
        { x: 1, y: 1 },
        { x: 9, y: 9 },
      ]),
    is_published: overrides.is_published ?? false,
    created_by: overrides.created_by ?? 42,
    creator_username: overrides.creator_username ?? 'mapmaker',
    play_count: overrides.play_count ?? 0,
    created_at: overrides.created_at ?? new Date('2026-03-01T10:00:00.000Z'),
    updated_at: overrides.updated_at ?? new Date('2026-03-15T12:00:00.000Z'),
  };
}

describe('Custom Maps Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listMyMaps', () => {
    it('should query maps created by the given userId', async () => {
      mockQuery.mockResolvedValue([]);

      await customMapsService.listMyMaps(42);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE m.created_by = ?'),
        [42],
      );
    });

    it('should order results by updated_at DESC', async () => {
      mockQuery.mockResolvedValue([]);

      await customMapsService.listMyMaps(42);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY m.updated_at DESC'),
        [42],
      );
    });

    it('should map rows to CustomMapSummary with spawnCount', async () => {
      const row = makeMapRow({
        id: 5,
        name: 'Arena',
        map_width: 13,
        map_height: 15,
        spawn_points: JSON.stringify([
          { x: 1, y: 1 },
          { x: 3, y: 3 },
          { x: 5, y: 5 },
        ]),
        is_published: true,
        created_by: 42,
        creator_username: 'alice',
        play_count: 10,
      });
      mockQuery.mockResolvedValue([row]);

      const result = await customMapsService.listMyMaps(42);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 5,
        name: 'Arena',
        mapWidth: 13,
        mapHeight: 15,
        spawnCount: 3,
        isPublished: true,
        createdBy: 42,
        creatorUsername: 'alice',
        playCount: 10,
        avgRating: null,
        ratingCount: 0,
      });
    });

    it('should return empty array when user has no maps', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await customMapsService.listMyMaps(99);

      expect(result).toEqual([]);
    });
  });

  describe('listPublishedMaps', () => {
    it('should query only published maps', async () => {
      mockQuery.mockResolvedValue([]);

      await customMapsService.listPublishedMaps();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE m.is_published = TRUE'),
      );
    });

    it('should order by rating then play_count DESC', async () => {
      mockQuery.mockResolvedValue([]);

      await customMapsService.listPublishedMaps();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY r.avg_rating DESC, m.play_count DESC'),
      );
    });

    it('should return summaries for multiple published maps', async () => {
      const row1 = makeMapRow({ id: 1, name: 'Popular', play_count: 100, is_published: true });
      const row2 = makeMapRow({ id: 2, name: 'New', play_count: 5, is_published: true });
      mockQuery.mockResolvedValue([row1, row2]);

      const result = await customMapsService.listPublishedMaps();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Popular');
      expect(result[1].name).toBe('New');
    });
  });

  describe('getMap', () => {
    it('should query by map id', async () => {
      mockQuery.mockResolvedValue([makeMapRow()]);

      await customMapsService.getMap(7);

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE m.id = ?'), [7]);
    });

    it('should return null when map not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await customMapsService.getMap(999);

      expect(result).toBeNull();
    });

    it('should parse JSON tiles and spawnPoints into full CustomMap', async () => {
      const tiles = [
        ['empty', 'wall'],
        ['destructible', 'empty'],
      ];
      const spawns = [{ x: 1, y: 1 }];
      const row = makeMapRow({
        id: 3,
        name: 'Parsed Map',
        description: 'desc',
        map_width: 11,
        map_height: 13,
        tiles: JSON.stringify(tiles),
        spawn_points: JSON.stringify(spawns),
        is_published: true,
        created_by: 10,
        creator_username: 'bob',
        play_count: 25,
      });
      mockQuery.mockResolvedValue([row]);

      const result = await customMapsService.getMap(3);

      expect(result).toEqual({
        id: 3,
        name: 'Parsed Map',
        description: 'desc',
        mapWidth: 11,
        mapHeight: 13,
        tiles,
        spawnPoints: spawns,
        isPublished: true,
        createdBy: 10,
        creatorUsername: 'bob',
        playCount: 25,
      });
    });

    it('should use empty fallback for invalid JSON tiles', async () => {
      const row = makeMapRow({ tiles: 'not-json', spawn_points: 'also-bad' });
      mockQuery.mockResolvedValue([row]);

      const result = await customMapsService.getMap(1);

      expect(result!.tiles).toEqual([]);
      expect(result!.spawnPoints).toEqual([]);
    });

    it('should convert falsy description to empty string', async () => {
      const row = makeMapRow({ description: '' });
      mockQuery.mockResolvedValue([row]);

      const result = await customMapsService.getMap(1);

      expect(result!.description).toBe('');
    });

    it('should convert is_published to boolean', async () => {
      const row = makeMapRow({ is_published: false });
      mockQuery.mockResolvedValue([row]);

      const result = await customMapsService.getMap(1);

      expect(result!.isPublished).toBe(false);
    });
  });

  describe('createMap', () => {
    it('should INSERT with JSON.stringify for tiles and spawnPoints', async () => {
      const tiles = [['empty']];
      const spawns = [{ x: 1, y: 1 }];
      mockExecute.mockResolvedValue({ insertId: 99, affectedRows: 1 });

      await customMapsService.createMap(
        {
          name: 'New Map',
          description: 'Desc',
          mapWidth: 11,
          mapHeight: 11,
          tiles: tiles as any,
          spawnPoints: spawns,
          isPublished: true,
        },
        42,
      );

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO custom_maps'), [
        'New Map',
        'Desc',
        11,
        11,
        JSON.stringify(tiles),
        JSON.stringify(spawns),
        true,
        42,
      ]);
    });

    it('should return the insertId', async () => {
      mockExecute.mockResolvedValue({ insertId: 77, affectedRows: 1 });

      const id = await customMapsService.createMap(
        {
          name: 'Map',
          mapWidth: 9,
          mapHeight: 9,
          tiles: [] as any,
          spawnPoints: [],
        },
        1,
      );

      expect(id).toBe(77);
    });

    it('should default description to empty string and isPublished to false', async () => {
      mockExecute.mockResolvedValue({ insertId: 1, affectedRows: 1 });

      await customMapsService.createMap(
        {
          name: 'Minimal',
          mapWidth: 9,
          mapHeight: 9,
          tiles: [] as any,
          spawnPoints: [],
        },
        5,
      );

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO custom_maps'), [
        'Minimal',
        '',
        9,
        9,
        '[]',
        '[]',
        false,
        5,
      ]);
    });
  });

  describe('updateMap', () => {
    it('should UPDATE with ownership check', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await customMapsService.updateMap(
        10,
        {
          name: 'Updated',
          description: 'New desc',
          mapWidth: 13,
          mapHeight: 13,
          tiles: [['wall']] as any,
          spawnPoints: [{ x: 0, y: 0 }],
          isPublished: true,
        },
        42,
      );

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND created_by = ?'),
        [
          'Updated',
          'New desc',
          13,
          13,
          JSON.stringify([['wall']]),
          JSON.stringify([{ x: 0, y: 0 }]),
          true,
          10,
          42,
        ],
      );
    });

    it('should return true when update succeeds (affectedRows > 0)', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await customMapsService.updateMap(
        1,
        { name: 'X', mapWidth: 9, mapHeight: 9, tiles: [] as any, spawnPoints: [] },
        42,
      );

      expect(result).toBe(true);
    });

    it('should return false when map not found or not owned', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      const result = await customMapsService.updateMap(
        999,
        { name: 'X', mapWidth: 9, mapHeight: 9, tiles: [] as any, spawnPoints: [] },
        42,
      );

      expect(result).toBe(false);
    });
  });

  describe('deleteMap', () => {
    it('should DELETE with ownership check', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await customMapsService.deleteMap(10, 42);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM custom_maps WHERE id = ? AND created_by = ?'),
        [10, 42],
      );
    });

    it('should return true when delete succeeds', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      const result = await customMapsService.deleteMap(10, 42);

      expect(result).toBe(true);
    });

    it('should return false when map not found or not owned', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      const result = await customMapsService.deleteMap(999, 42);

      expect(result).toBe(false);
    });
  });

  describe('incrementPlayCount', () => {
    it('should execute play_count + 1 for the given id', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 1 });

      await customMapsService.incrementPlayCount(15);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('play_count = play_count + 1'),
        [15],
      );
    });
  });

  describe('getMapName', () => {
    it('should return the map name when found', async () => {
      mockQuery.mockResolvedValue([{ name: 'Cool Arena' }]);

      const result = await customMapsService.getMapName(5);

      expect(result).toBe('Cool Arena');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT name FROM custom_maps WHERE id = ?'),
        [5],
      );
    });

    it('should return null when map not found', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await customMapsService.getMapName(999);

      expect(result).toBeNull();
    });
  });
});
