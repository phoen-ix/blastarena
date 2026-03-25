import { TileType, Position, Direction } from '@blast-arena/shared';

export class CollisionSystem {
  private tiles: TileType[][];
  private width: number;
  private height: number;
  private reinforcedWalls: boolean;

  constructor(
    tiles: TileType[][],
    width: number,
    height: number,
    reinforcedWalls: boolean = false,
  ) {
    this.tiles = tiles;
    this.width = width;
    this.height = height;
    this.reinforcedWalls = reinforcedWalls;
  }

  updateTiles(tiles: TileType[][]): void {
    this.tiles = tiles;
  }

  isWalkable(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    const tile = this.tiles[y][x];
    return (
      tile === 'empty' ||
      tile === 'spawn' ||
      tile === 'teleporter_a' ||
      tile === 'teleporter_b' ||
      tile === 'conveyor_up' ||
      tile === 'conveyor_down' ||
      tile === 'conveyor_left' ||
      tile === 'conveyor_right' ||
      tile === 'exit' ||
      tile === 'goal' ||
      tile === 'switch_red' ||
      tile === 'switch_blue' ||
      tile === 'switch_green' ||
      tile === 'switch_yellow' ||
      tile === 'switch_red_active' ||
      tile === 'switch_blue_active' ||
      tile === 'switch_green_active' ||
      tile === 'switch_yellow_active' ||
      tile === 'gate_red_open' ||
      tile === 'gate_blue_open' ||
      tile === 'gate_green_open' ||
      tile === 'gate_yellow_open' ||
      tile === 'crumbling' ||
      // Hazard tiles (campaign only)
      tile === 'vine' ||
      tile === 'quicksand' ||
      tile === 'ice' ||
      tile === 'mud' ||
      tile === 'spikes' ||
      tile === 'spikes_active' ||
      tile === 'dark_rift'
      // Note: 'lava' is intentionally NOT walkable (impassable like wall)
    );
  }

  canMoveTo(
    fromX: number,
    fromY: number,
    direction: Direction,
    bombPositions: Position[],
    playerPositions: Position[] = [],
  ): Position | null {
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

    if (!this.isWalkable(newX, newY)) return null;

    // Check for bombs blocking the path
    const bombBlocking = bombPositions.some((b) => b.x === newX && b.y === newY);
    if (bombBlocking) return null;

    // Check for other players blocking the path
    const playerBlocking = playerPositions.some((p) => p.x === newX && p.y === newY);
    if (playerBlocking) return null;

    return { x: newX, y: newY };
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

    // Out of bounds
    if (newX < 0 || newX >= this.width || newY < 0 || newY >= this.height) return null;

    // Only indestructible walls block the buddy
    const tile = this.tiles[newY][newX];
    if (
      tile === 'wall' ||
      tile === 'pit' ||
      tile === 'lava' ||
      tile === 'gate_red' ||
      tile === 'gate_blue' ||
      tile === 'gate_green' ||
      tile === 'gate_yellow'
    )
      return null;

    return { x: newX, y: newY };
  }

  getTileAt(x: number, y: number): TileType {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 'wall';
    return this.tiles[y][x];
  }

  destroyTile(x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
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
