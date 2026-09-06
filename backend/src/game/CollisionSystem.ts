import { TileType, Position, Direction, wrapX, wrapY } from '@blast-arena/shared';

/**
 * Walkable tile types as a Set. `isWalkable()` is the single hottest function in the engine — every
 * node expansion of every bot BFS, every move, every bomb slide — and it was a chain of ~30
 * sequential string comparisons whose worst case (all 30 miss) was exactly the common answer in a
 * bomb arena: a wall. One hash lookup now, same membership. `lava` is deliberately absent
 * (impassable like a wall). (audit COLLISION-HOTPATH-1)
 */
const WALKABLE: ReadonlySet<TileType> = new Set<TileType>([
  'empty',
  'spawn',
  'teleporter_a',
  'teleporter_b',
  'conveyor_up',
  'conveyor_down',
  'conveyor_left',
  'conveyor_right',
  'exit',
  'goal',
  'switch_red',
  'switch_blue',
  'switch_green',
  'switch_yellow',
  'switch_red_active',
  'switch_blue_active',
  'switch_green_active',
  'switch_yellow_active',
  'gate_red_open',
  'gate_blue_open',
  'gate_green_open',
  'gate_yellow_open',
  'crumbling',
  // Hazard tiles (campaign only)
  'vine',
  'quicksand',
  'ice',
  'mud',
  'spikes',
  'spikes_active',
  'dark_rift',
]);

/** Tiles the buddy cannot pass: only indestructible terrain. */
const BUDDY_BLOCKING: ReadonlySet<TileType> = new Set<TileType>([
  'wall',
  'pit',
  'lava',
  'gate_red',
  'gate_blue',
  'gate_green',
  'gate_yellow',
]);

/**
 * A blocking occupant: a bare position, or a player entry carrying its id (and, for a buddy, its
 * owner's id) so a mover can be exempted from colliding with itself and its own buddy without the
 * caller allocating a filtered copy of the list per call.
 */
export interface OccupantPosition extends Position {
  id?: number;
  buddyOwnerId?: number;
}

export class CollisionSystem {
  private tiles: TileType[][];
  private width: number;
  private height: number;
  private reinforcedWalls: boolean;
  private wrapping: boolean;

  constructor(
    tiles: TileType[][],
    width: number,
    height: number,
    reinforcedWalls: boolean = false,
    wrapping: boolean = false,
  ) {
    this.tiles = tiles;
    this.width = width;
    this.height = height;
    this.reinforcedWalls = reinforcedWalls;
    this.wrapping = wrapping;
  }

  updateTiles(tiles: TileType[][]): void {
    this.tiles = tiles;
  }

  isWalkable(x: number, y: number): boolean {
    if (this.wrapping) {
      x = wrapX(x, this.width);
      y = wrapY(y, this.height);
    } else if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    return WALKABLE.has(this.tiles[y][x]);
  }

  /**
   * Resolve one step from (fromX, fromY) in `direction`: wrapped/bounds-checked and walkable, or
   * null. Shared by the two canMoveTo variants so they cannot drift apart.
   */
  private step(fromX: number, fromY: number, direction: Direction): Position | null {
    let newX = fromX;
    let newY = fromY;

    switch (direction) {
      case 'up':
        newY--;
        break;
      case 'down':
        newY++;
        break;
      case 'left':
        newX--;
        break;
      case 'right':
        newX++;
        break;
    }

    // Wrap coordinates for toroidal maps
    if (this.wrapping) {
      newX = wrapX(newX, this.width);
      newY = wrapY(newY, this.height);
    }

    if (!this.isWalkable(newX, newY)) return null;
    return { x: newX, y: newY };
  }

  canMoveTo(
    fromX: number,
    fromY: number,
    direction: Direction,
    bombPositions: Position[],
    playerPositions: OccupantPosition[] = [],
    /**
     * The moving player's id. Entries for that player and for its own buddy do not block, so the
     * caller can pass the shared, live occupant list instead of filtering a copy per player per
     * tick. (audit INTRA-TICK-OCCUPANCY-1)
     */
    selfId?: number,
  ): Position | null {
    const next = this.step(fromX, fromY, direction);
    if (!next) return null;
    const { x: newX, y: newY } = next;

    // Check for bombs blocking the path
    for (let i = 0; i < bombPositions.length; i++) {
      const b = bombPositions[i];
      if (b.x === newX && b.y === newY) return null;
    }

    // Check for other players blocking the path
    for (let i = 0; i < playerPositions.length; i++) {
      const p = playerPositions[i];
      if (p.x !== newX || p.y !== newY) continue;
      if (selfId !== undefined && (p.id === selfId || p.buddyOwnerId === selfId)) continue;
      return null;
    }

    return next;
  }

  /**
   * O(1) variant of canMoveTo for search-heavy callers (the bot BFS issues thousands of these per
   * decision): `blocked` holds the "x,y" keys of every bomb and player tile that must not be entered,
   * built once per decision instead of scanned linearly per step. (audit COLLISION-HOTPATH-1)
   */
  canMoveToKeyed(
    fromX: number,
    fromY: number,
    direction: Direction,
    blocked: ReadonlySet<string>,
  ): Position | null {
    const next = this.step(fromX, fromY, direction);
    if (!next) return null;
    if (blocked.has(`${next.x},${next.y}`)) return null;
    return next;
  }

  /** Buddy can pass through destructible walls and bombs, but not indestructible walls or out of bounds */
  canBuddyMoveTo(fromX: number, fromY: number, direction: Direction): Position | null {
    let newX = fromX;
    let newY = fromY;

    switch (direction) {
      case 'up':
        newY--;
        break;
      case 'down':
        newY++;
        break;
      case 'left':
        newX--;
        break;
      case 'right':
        newX++;
        break;
    }

    // Wrap or bounds check
    if (this.wrapping) {
      newX = wrapX(newX, this.width);
      newY = wrapY(newY, this.height);
    } else if (newX < 0 || newX >= this.width || newY < 0 || newY >= this.height) {
      return null;
    }

    // Only indestructible walls block the buddy
    if (BUDDY_BLOCKING.has(this.tiles[newY][newX])) return null;

    return { x: newX, y: newY };
  }

  getTileAt(x: number, y: number): TileType {
    if (this.wrapping) {
      x = wrapX(x, this.width);
      y = wrapY(y, this.height);
    } else if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return 'wall';
    }
    return this.tiles[y][x];
  }

  destroyTile(x: number, y: number): boolean {
    if (this.wrapping) {
      x = wrapX(x, this.width);
      y = wrapY(y, this.height);
    } else if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    const tile = this.tiles[y][x];
    if (tile === 'destructible') {
      if (this.reinforcedWalls) {
        this.tiles[y][x] = 'destructible_cracked' as TileType;
        return false; // Only cracked, not fully destroyed — no power-up drop
      } else {
        this.tiles[y][x] = 'empty';
      }
      return true;
    }
    if ((tile as string) === 'destructible_cracked') {
      this.tiles[y][x] = 'empty';
      return true;
    }
    if (tile === 'vine') {
      this.tiles[y][x] = 'empty';
      return true;
    }
    return false;
  }
}
