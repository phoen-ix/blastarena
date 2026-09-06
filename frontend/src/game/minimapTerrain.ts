import type { TileDiff, TileType } from '@blast-arena/shared';

/**
 * Offscreen terrain layer for the HUD minimap.
 *
 * The minimap used to repaint every tile with a per-tile `switch` on each redraw — 2,091
 * `fillRect`s five times a second on the open world — although the terrain changes by a handful
 * of cells per tick at most. The terrain is now painted once into its own canvas, patched cell by
 * cell from `tileDiffs`, and the per-redraw cost is a single `drawImage` plus the entities.
 *
 * Deliberately Phaser-free and drawn through the small `MinimapFillContext` interface so the
 * patch logic can be unit-tested with a recording fake in place of a canvas. (audit F1)
 */

export interface MinimapFillContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

export const MINIMAP_DEFAULT_COLOR = '#1a1a2e';

/** Terrain colour per tile type; anything not listed is floor-coloured. */
export const MINIMAP_TILE_COLORS: Partial<Record<TileType, string>> = {
  wall: '#333355',
  destructible: '#886633',
  destructible_cracked: '#776622',
  lava: '#cc3300',
  pit: '#0a0a12',
  ice: '#8ac8e8',
};

export function minimapTileColor(type: TileType): string {
  return MINIMAP_TILE_COLORS[type] ?? MINIMAP_DEFAULT_COLOR;
}

export class MinimapTerrain {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  private readonly ctx: MinimapFillContext;
  /** Our own copy of the grid — tick states omit the full tiles. */
  private tiles: TileType[][];

  constructor(
    ctx: MinimapFillContext,
    tiles: TileType[][],
    width: number,
    height: number,
    tileSize: number,
  ) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.tiles = tiles.map((row) => [...row]);
    this.paintAll();
  }

  /** Whether this layer was built for a map of the given size. */
  matches(width: number, height: number): boolean {
    return this.width === width && this.height === height;
  }

  tileAt(x: number, y: number): TileType | undefined {
    return this.tiles[y]?.[x];
  }

  private paintCell(x: number, y: number, type: TileType): void {
    const ts = this.tileSize;
    this.ctx.fillStyle = minimapTileColor(type);
    this.ctx.fillRect(x * ts, y * ts, ts, ts);
  }

  private paintAll(): void {
    for (let y = 0; y < this.height; y++) {
      const row = this.tiles[y];
      for (let x = 0; x < this.width; x++) {
        this.paintCell(x, y, row[x]);
      }
    }
  }

  /** Patch only the cells a tick's `tileDiffs` names. Returns how many cells were repainted. */
  applyDiffs(diffs: readonly TileDiff[]): number {
    let painted = 0;
    for (const diff of diffs) {
      const row = this.tiles[diff.y];
      if (!row || diff.x < 0 || diff.x >= this.width) continue;
      if (row[diff.x] === diff.type) continue;
      row[diff.x] = diff.type;
      this.paintCell(diff.x, diff.y, diff.type);
      painted++;
    }
    return painted;
  }

  /**
   * Bring the layer in line with a full grid (replays and simulation spectate carry the whole
   * grid every frame). Compares cell by cell and repaints only what differs — a comparison is far
   * cheaper than a fillRect. Returns how many cells were repainted.
   */
  sync(tiles: TileType[][]): number {
    let painted = 0;
    for (let y = 0; y < this.height; y++) {
      const ours = this.tiles[y];
      const theirs = tiles[y];
      if (!theirs) continue;
      for (let x = 0; x < this.width; x++) {
        const type = theirs[x];
        if (type === undefined || ours[x] === type) continue;
        ours[x] = type;
        this.paintCell(x, y, type);
        painted++;
      }
    }
    return painted;
  }
}
