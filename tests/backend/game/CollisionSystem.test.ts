import { describe, it, expect } from '@jest/globals';
import { CollisionSystem } from '../../../backend/src/game/CollisionSystem';
import { TileType } from '@blast-arena/shared';

describe('CollisionSystem', () => {
  function createTestGrid(): TileType[][] {
    // 5x5 grid
    // W W W W W
    // W . . . W
    // W . W . W
    // W . . . W
    // W W W W W
    return [
      ['wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'empty', 'empty', 'empty', 'wall'],
      ['wall', 'empty', 'wall', 'empty', 'wall'],
      ['wall', 'empty', 'empty', 'empty', 'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall'],
    ];
  }

  it('should allow movement to empty cells', () => {
    const cs = new CollisionSystem(createTestGrid(), 5, 5);
    const result = cs.canMoveTo(1, 1, 'right', []);
    expect(result).toEqual({ x: 2, y: 1 });
  });

  it('should block movement into walls', () => {
    const cs = new CollisionSystem(createTestGrid(), 5, 5);
    const result = cs.canMoveTo(1, 1, 'left', []);
    expect(result).toBeNull();
  });

  it('should block movement into indestructible walls', () => {
    const cs = new CollisionSystem(createTestGrid(), 5, 5);
    const result = cs.canMoveTo(1, 2, 'right', []);
    expect(result).toBeNull();
  });

  it('should block movement into bombs', () => {
    const cs = new CollisionSystem(createTestGrid(), 5, 5);
    const result = cs.canMoveTo(1, 1, 'right', [{ x: 2, y: 1 }]);
    expect(result).toBeNull();
  });

  it('should identify walkable tiles', () => {
    const cs = new CollisionSystem(createTestGrid(), 5, 5);
    expect(cs.isWalkable(1, 1)).toBe(true);
    expect(cs.isWalkable(0, 0)).toBe(false);
    expect(cs.isWalkable(2, 2)).toBe(false);
  });

  it('should destroy destructible tiles', () => {
    const tiles: TileType[][] = [
      ['wall', 'wall', 'wall'],
      ['wall', 'destructible', 'wall'],
      ['wall', 'wall', 'wall'],
    ];
    const cs = new CollisionSystem(tiles, 3, 3);

    expect(cs.destroyTile(1, 1)).toBe(true);
    expect(cs.isWalkable(1, 1)).toBe(true);
    expect(cs.destroyTile(0, 0)).toBe(false); // Can't destroy indestructible
  });

  it('should handle out-of-bounds', () => {
    const cs = new CollisionSystem(createTestGrid(), 5, 5);
    expect(cs.isWalkable(-1, 0)).toBe(false);
    expect(cs.isWalkable(0, -1)).toBe(false);
    expect(cs.isWalkable(5, 0)).toBe(false);
    expect(cs.isWalkable(0, 5)).toBe(false);
  });

  describe('isWalkable - tile types', () => {
    function gridWithTile(tile: TileType): TileType[][] {
      return [
        ['wall', 'wall', 'wall'],
        ['wall', tile, 'wall'],
        ['wall', 'wall', 'wall'],
      ];
    }

    it('should treat spawn as walkable', () => {
      const cs = new CollisionSystem(gridWithTile('spawn'), 3, 3);
      expect(cs.isWalkable(1, 1)).toBe(true);
    });

    it('should treat teleporter_a and teleporter_b as walkable', () => {
      const csA = new CollisionSystem(gridWithTile('teleporter_a'), 3, 3);
      expect(csA.isWalkable(1, 1)).toBe(true);

      const csB = new CollisionSystem(gridWithTile('teleporter_b'), 3, 3);
      expect(csB.isWalkable(1, 1)).toBe(true);
    });

    it('should treat all conveyor directions as walkable', () => {
      for (const dir of [
        'conveyor_up',
        'conveyor_down',
        'conveyor_left',
        'conveyor_right',
      ] as TileType[]) {
        const cs = new CollisionSystem(gridWithTile(dir), 3, 3);
        expect(cs.isWalkable(1, 1)).toBe(true);
      }
    });

    it('should treat exit and goal as walkable', () => {
      const csExit = new CollisionSystem(gridWithTile('exit'), 3, 3);
      expect(csExit.isWalkable(1, 1)).toBe(true);

      const csGoal = new CollisionSystem(gridWithTile('goal'), 3, 3);
      expect(csGoal.isWalkable(1, 1)).toBe(true);
    });

    it('should treat crumbling as walkable', () => {
      const cs = new CollisionSystem(gridWithTile('crumbling'), 3, 3);
      expect(cs.isWalkable(1, 1)).toBe(true);
    });

    it('should treat hazard tiles as walkable (vine, quicksand, mud, ice, spikes, spikes_active, dark_rift)', () => {
      const walkableHazards: TileType[] = [
        'vine',
        'quicksand',
        'mud',
        'ice',
        'spikes',
        'spikes_active',
        'dark_rift',
      ];
      for (const tile of walkableHazards) {
        const cs = new CollisionSystem(gridWithTile(tile), 3, 3);
        expect(cs.isWalkable(1, 1)).toBe(true);
      }
    });

    it('should treat lava as NOT walkable', () => {
      const cs = new CollisionSystem(gridWithTile('lava'), 3, 3);
      expect(cs.isWalkable(1, 1)).toBe(false);
    });

    it('should treat pit as NOT walkable', () => {
      const cs = new CollisionSystem(gridWithTile('pit'), 3, 3);
      expect(cs.isWalkable(1, 1)).toBe(false);
    });

    it('should treat switch tiles as walkable (active and inactive)', () => {
      const switchTiles: TileType[] = [
        'switch_red',
        'switch_blue',
        'switch_green',
        'switch_yellow',
        'switch_red_active',
        'switch_blue_active',
        'switch_green_active',
        'switch_yellow_active',
      ];
      for (const tile of switchTiles) {
        const cs = new CollisionSystem(gridWithTile(tile), 3, 3);
        expect(cs.isWalkable(1, 1)).toBe(true);
      }
    });

    it('should treat open gates as walkable and closed gates as NOT walkable', () => {
      const openGates: TileType[] = [
        'gate_red_open',
        'gate_blue_open',
        'gate_green_open',
        'gate_yellow_open',
      ];
      for (const tile of openGates) {
        const cs = new CollisionSystem(gridWithTile(tile), 3, 3);
        expect(cs.isWalkable(1, 1)).toBe(true);
      }

      const closedGates: TileType[] = ['gate_red', 'gate_blue', 'gate_green', 'gate_yellow'];
      for (const tile of closedGates) {
        const cs = new CollisionSystem(gridWithTile(tile), 3, 3);
        expect(cs.isWalkable(1, 1)).toBe(false);
      }
    });
  });

  describe('destroyTile - reinforced walls and vine', () => {
    it('should crack destructible tile with reinforcedWalls enabled', () => {
      const tiles: TileType[][] = [
        ['wall', 'wall', 'wall'],
        ['wall', 'destructible', 'wall'],
        ['wall', 'wall', 'wall'],
      ];
      const cs = new CollisionSystem(tiles, 3, 3, true);
      const dropped = cs.destroyTile(1, 1);
      expect(dropped).toBe(false); // No power-up drop on crack
      expect(cs.getTileAt(1, 1)).toBe('destructible_cracked');
    });

    it('should destroy cracked tile to empty with reinforcedWalls enabled', () => {
      const tiles: TileType[][] = [
        ['wall', 'wall', 'wall'],
        ['wall', 'destructible_cracked' as TileType, 'wall'],
        ['wall', 'wall', 'wall'],
      ];
      const cs = new CollisionSystem(tiles, 3, 3, true);
      const dropped = cs.destroyTile(1, 1);
      expect(dropped).toBe(true);
      expect(cs.getTileAt(1, 1)).toBe('empty');
    });

    it('should destroy vine tile to empty', () => {
      const tiles: TileType[][] = [
        ['wall', 'wall', 'wall'],
        ['wall', 'vine', 'wall'],
        ['wall', 'wall', 'wall'],
      ];
      const cs = new CollisionSystem(tiles, 3, 3);
      const dropped = cs.destroyTile(1, 1);
      expect(dropped).toBe(true);
      expect(cs.getTileAt(1, 1)).toBe('empty');
    });
  });

  describe('getTileAt - out of bounds', () => {
    it('should return wall for negative x coordinate', () => {
      const cs = new CollisionSystem(createTestGrid(), 5, 5);
      expect(cs.getTileAt(-1, 2)).toBe('wall');
    });

    it('should return wall for negative y coordinate', () => {
      const cs = new CollisionSystem(createTestGrid(), 5, 5);
      expect(cs.getTileAt(2, -1)).toBe('wall');
    });

    it('should return wall for x beyond grid width', () => {
      const cs = new CollisionSystem(createTestGrid(), 5, 5);
      expect(cs.getTileAt(5, 2)).toBe('wall');
      expect(cs.getTileAt(100, 0)).toBe('wall');
    });

    it('should return wall for y beyond grid height', () => {
      const cs = new CollisionSystem(createTestGrid(), 5, 5);
      expect(cs.getTileAt(2, 5)).toBe('wall');
      expect(cs.getTileAt(0, 100)).toBe('wall');
    });
  });
});
