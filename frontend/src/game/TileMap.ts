import Phaser from 'phaser';
import { TileType, Position, TileDiff } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { getSettings, VisualSettings } from './Settings';
import { wrapGhostTileSpans } from '../utils/wrapGhosts';
import { getTileTexture, isConveyorTile, conveyorAnimKey } from '../utils/tileTextures';

export class TileMapRenderer {
  private scene: Phaser.Scene;
  private tileSprites: Phaser.GameObjects.Sprite[][] = [];
  private previousTiles: TileType[][] = [];
  private width: number;
  private height: number;
  private theme?: string;
  private wrapping: boolean;

  // Viewport-culled ghost tiles for wrapping maps. A flat pool of Images reused across frames;
  // `ghostsByTile` indexes the live ones by `y * width + x` so a tile texture change can patch
  // its ghosts in O(1). (audit TILE-GHOST-1)
  private ghostPool: Phaser.GameObjects.Image[] = [];
  private ghostsByTile: Map<number, Phaser.GameObjects.Image[]> = new Map();
  /**
   * The camera's visible tile range when the ghosts were last laid out. The span layout is a
   * function of these four ints alone, so comparing them is the whole per-frame cost — no span
   * array or string key is built unless the camera actually crossed a tile boundary. (audit F5)
   */
  private ghostViewX0 = Number.NaN;
  private ghostViewY0 = Number.NaN;
  private ghostViewX1 = Number.NaN;
  private ghostViewY1 = Number.NaN;

  constructor(
    scene: Phaser.Scene,
    tiles: TileType[][],
    width: number,
    height: number,
    theme?: string,
    wrapping: boolean = false,
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.theme = theme;
    this.wrapping = wrapping;
    this.createTiles(tiles);
    if (wrapping) {
      this.updateGhosts();
    }
  }

  /** Whether this renderer was built for a grid of this size. */
  matches(width: number, height: number): boolean {
    return this.width === width && this.height === height;
  }

  private createTiles(tiles: TileType[][]): void {
    this.tileSprites = [];
    this.previousTiles = [];

    for (let y = 0; y < this.height; y++) {
      this.tileSprites[y] = [];
      this.previousTiles[y] = [];
      for (let x = 0; x < this.width; x++) {
        const tileType = tiles[y][x];
        const textureKey = getTileTexture(tileType, x, y, this.theme);
        const sprite = this.scene.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          textureKey,
        );
        this.tileSprites[y][x] = sprite;
        this.previousTiles[y][x] = tileType;
        if (isConveyorTile(tileType)) {
          this.playConveyorAnim(sprite, tileType);
        }
      }
    }
  }

  /**
   * Rebuild the ghost tiles the camera can actually see.
   *
   * The old implementation eagerly built all 8 wrapped copies of the entire map in the
   * constructor: on the 51x41 open world that is 16,728 permanent Images on top of the 2,091
   * canonical tile sprites, of which at most a screenful is ever on camera. This computes, per
   * wrapped copy, the tile range that intersects the camera and draws only that — the same
   * viewport-culling the entity renderers do via wrapGhostOffsets, adapted to a grid.
   *
   * Cheap to call every frame: the layout only changes when the camera scrolls across a tile
   * boundary, so a matching layout key short-circuits before any Phaser work. (audit TILE-GHOST-1)
   */
  updateGhosts(): void {
    if (!this.wrapping) return;
    const cam = this.scene.cameras?.main;
    if (!cam) return;

    // Tile-space bounds of the view. Identical bounds mean identical spans (wrapGhostTileSpans
    // floors these same values); the only exception is a view edge sitting exactly on a tile
    // boundary, where the differing column is the one fully off screen. (audit F5)
    const view = cam.worldView;
    const vx0 = Math.floor(view.x / TILE_SIZE);
    const vy0 = Math.floor(view.y / TILE_SIZE);
    const vx1 = Math.floor((view.x + view.width) / TILE_SIZE);
    const vy1 = Math.floor((view.y + view.height) / TILE_SIZE);
    if (
      vx0 === this.ghostViewX0 &&
      vy0 === this.ghostViewY0 &&
      vx1 === this.ghostViewX1 &&
      vy1 === this.ghostViewY1
    ) {
      return;
    }
    this.ghostViewX0 = vx0;
    this.ghostViewY0 = vy0;
    this.ghostViewX1 = vx1;
    this.ghostViewY1 = vy1;

    const spans = wrapGhostTileSpans(view, this.width, this.height, TILE_SIZE);

    this.ghostsByTile.clear();
    let used = 0;
    for (const span of spans) {
      for (let y = span.y0; y <= span.y1; y++) {
        for (let x = span.x0; x <= span.x1; x++) {
          // The canonical sprite is the source of truth: the animated branches of updateTiles()
          // destroy and re-add it, so ghosts must never hold a stale object reference.
          const textureKey = this.tileSprites[y][x].texture.key;
          let img = this.ghostPool[used];
          if (!img) {
            img = this.scene.add.image(0, 0, textureKey);
            // Explicit, because these are added mid-game — after players, bombs and explosions —
            // and would otherwise draw over them.
            img.setDepth(0);
            this.ghostPool[used] = img;
          } else {
            img.setTexture(textureKey);
            img.setVisible(true);
          }
          img.setPosition(
            x * TILE_SIZE + TILE_SIZE / 2 + span.ox,
            y * TILE_SIZE + TILE_SIZE / 2 + span.oy,
          );

          const tileKey = y * this.width + x;
          const existing = this.ghostsByTile.get(tileKey);
          if (existing) existing.push(img);
          else this.ghostsByTile.set(tileKey, [img]);
          used++;
        }
      }
    }

    for (let i = used; i < this.ghostPool.length; i++) {
      this.ghostPool[i].setVisible(false);
    }
  }

  private playConveyorAnim(sprite: Phaser.GameObjects.Sprite, type: TileType): void {
    const settings = getSettings();
    if (!settings.animations) return;
    const animKey = conveyorAnimKey(type, this.theme);
    if (this.scene.anims.exists(animKey)) {
      sprite.play(animKey);
    }
  }

  /** Sync any on-screen ghosts of this tile with the canonical texture. */
  private updateGhostTexture(x: number, y: number, textureKey: string): void {
    const ghosts = this.ghostsByTile.get(y * this.width + x);
    if (!ghosts) return;
    for (const img of ghosts) img.setTexture(textureKey);
  }

  /**
   * Full-grid sync: every cell is compared against the last known type. Used for the paths that
   * carry the whole grid (initial state, replays, simulations, open-world round start).
   */
  updateTiles(tiles: TileType[][]): Position[] {
    const destroyedPositions: Position[] = [];
    const settings = getSettings();

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const newType = tiles[y][x];
        if (newType === this.previousTiles[y]?.[x]) continue;
        this.applyTileChange(x, y, newType, settings, destroyedPositions);
      }
    }

    return destroyedPositions;
  }

  /**
   * Per-tick sync from the server's `tileDiffs`: only the listed cells are touched. The tick path
   * used to call updateTiles() with the full stored grid, rescanning every cell (2,091 on the open
   * world) to find the two or three a diff had already named. (audit F5)
   */
  applyTileDiffs(diffs: readonly TileDiff[]): Position[] {
    const destroyedPositions: Position[] = [];
    if (diffs.length === 0) return destroyedPositions;
    const settings = getSettings();

    for (const diff of diffs) {
      const { x, y, type } = diff;
      if (y < 0 || y >= this.height || x < 0 || x >= this.width) continue;
      if (type === this.previousTiles[y]?.[x]) continue;
      this.applyTileChange(x, y, type, settings, destroyedPositions);
    }

    return destroyedPositions;
  }

  /** Transition one cell from its last known type to `newType`, animating where appropriate. */
  private applyTileChange(
    x: number,
    y: number,
    newType: TileType,
    settings: VisualSettings,
    destroyedPositions: Position[],
  ): void {
    const prevType = this.previousTiles[y]?.[x];

    // A destructible block was destroyed (changed to empty/spawn)
    const wasDestructible =
      prevType === 'destructible' ||
      prevType === ('destructible_cracked' as TileType) ||
      prevType === ('vine' as TileType);
    const isNowEmpty = newType === 'empty' || newType === 'spawn';

    if (wasDestructible && isNowEmpty) {
      destroyedPositions.push({ x, y });

      if (settings.animations) {
        const oldSprite = this.tileSprites[y][x];
        // Animate destruction: scale down and fade out, then replace. The fading sprite goes one
        // depth above the tiles: the replacement is added later at the same depth and used to
        // cover it, so the animation never showed.
        oldSprite.setDepth(1);
        this.scene.tweens.add({
          targets: oldSprite,
          alpha: 0,
          scaleX: 0.3,
          scaleY: 0.3,
          duration: 300,
          ease: 'Power2',
          onComplete: () => {
            oldSprite.destroy();
          },
        });

        // Create the new floor sprite immediately underneath
        const newTexture = getTileTexture(newType, x, y, this.theme);
        const newSprite = this.scene.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          newTexture,
        );
        this.tileSprites[y][x] = newSprite;
        this.updateGhostTexture(x, y, newTexture);
      } else {
        // No animation: just swap the texture
        const newTexture = getTileTexture(newType, x, y, this.theme);
        this.tileSprites[y][x].setTexture(newTexture);
        this.tileSprites[y][x].setAlpha(1);
        this.tileSprites[y][x].setScale(1);
        this.updateGhostTexture(x, y, newTexture);
      }
    } else if (this.isGateOpening(prevType, newType)) {
      // Gate opening: scale down old bars, reveal open gate underneath
      const newTexture = getTileTexture(newType, x, y, this.theme);
      if (settings.animations) {
        const oldSprite = this.tileSprites[y][x];
        oldSprite.setDepth(1); // above the replacement, see the destruction case
        this.scene.tweens.add({
          targets: oldSprite,
          alpha: 0,
          scaleX: 0.3,
          scaleY: 0.3,
          duration: 200,
          ease: 'Power2',
          onComplete: () => {
            oldSprite.destroy();
          },
        });
        const newSprite = this.scene.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          newTexture,
        );
        this.tileSprites[y][x] = newSprite;
      } else {
        this.tileSprites[y][x].setTexture(newTexture);
        this.tileSprites[y][x].setAlpha(1);
        this.tileSprites[y][x].setScale(1);
      }
      this.updateGhostTexture(x, y, newTexture);
    } else if (this.isGateClosing(prevType, newType)) {
      // Gate closing: new bars scale up from small to full
      const newTexture = getTileTexture(newType, x, y, this.theme);
      if (settings.animations) {
        const oldSprite = this.tileSprites[y][x];
        oldSprite.destroy();
        const newSprite = this.scene.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          newTexture,
        );
        newSprite.setScale(0.3);
        this.scene.tweens.add({
          targets: newSprite,
          scaleX: 1,
          scaleY: 1,
          duration: 200,
          ease: 'Power2',
        });
        this.tileSprites[y][x] = newSprite;
      } else {
        this.tileSprites[y][x].setTexture(newTexture);
        this.tileSprites[y][x].setAlpha(1);
        this.tileSprites[y][x].setScale(1);
      }
      this.updateGhostTexture(x, y, newTexture);
    } else if (prevType === ('crumbling' as TileType) && newType === ('pit' as TileType)) {
      // Crumbling floor collapses into pit
      const newTexture = getTileTexture(newType, x, y, this.theme);
      if (settings.animations) {
        const oldSprite = this.tileSprites[y][x];
        oldSprite.setDepth(1); // above the replacement, see the destruction case
        this.scene.tweens.add({
          targets: oldSprite,
          alpha: 0,
          scaleX: 0.3,
          scaleY: 0.3,
          duration: 300,
          ease: 'Power2',
          onComplete: () => {
            oldSprite.destroy();
          },
        });
        const newSprite = this.scene.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          newTexture,
        );
        this.tileSprites[y][x] = newSprite;
      } else {
        this.tileSprites[y][x].setTexture(newTexture);
        this.tileSprites[y][x].setAlpha(1);
        this.tileSprites[y][x].setScale(1);
      }
      this.updateGhostTexture(x, y, newTexture);
    } else {
      // Non-destructive tile change (e.g. conveyor placed, teleporter toggled,
      // switch state change — simple texture swap)
      const newTexture = getTileTexture(newType, x, y, this.theme);
      const sprite = this.tileSprites[y][x];
      sprite.stop();
      sprite.setTexture(newTexture);
      if (isConveyorTile(newType)) {
        this.playConveyorAnim(sprite, newType);
      }
      this.updateGhostTexture(x, y, newTexture);
    }

    this.previousTiles[y][x] = newType;
  }

  private isGateOpening(prev: TileType | undefined, next: TileType): boolean {
    const closedGates: string[] = ['gate_red', 'gate_blue', 'gate_green', 'gate_yellow'];
    const openGates: string[] = [
      'gate_red_open',
      'gate_blue_open',
      'gate_green_open',
      'gate_yellow_open',
    ];
    return closedGates.includes(prev as string) && openGates.includes(next as string);
  }

  private isGateClosing(prev: TileType | undefined, next: TileType): boolean {
    const closedGates: string[] = ['gate_red', 'gate_blue', 'gate_green', 'gate_yellow'];
    const openGates: string[] = [
      'gate_red_open',
      'gate_blue_open',
      'gate_green_open',
      'gate_yellow_open',
    ];
    return openGates.includes(prev as string) && closedGates.includes(next as string);
  }

  destroy(): void {
    for (let y = 0; y < this.tileSprites.length; y++) {
      for (let x = 0; x < this.tileSprites[y].length; x++) {
        this.tileSprites[y][x]?.destroy();
      }
    }
    for (const img of this.ghostPool) {
      img.destroy();
    }
    this.tileSprites = [];
    this.ghostPool = [];
    this.ghostsByTile.clear();
    this.ghostViewX0 = Number.NaN;
    this.ghostViewY0 = Number.NaN;
    this.ghostViewX1 = Number.NaN;
    this.ghostViewY1 = Number.NaN;
    this.previousTiles = [];
  }
}
