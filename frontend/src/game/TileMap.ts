import Phaser from 'phaser';
import { TileType, Position } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { wrapGhostTileSpans, ghostTileSpanKey } from '../utils/wrapGhosts';
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
  private ghostLayoutKey = '';

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

    const spans = wrapGhostTileSpans(cam.worldView, this.width, this.height, TILE_SIZE);
    const key = ghostTileSpanKey(spans);
    if (key === this.ghostLayoutKey) return;
    this.ghostLayoutKey = key;

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

  updateTiles(tiles: TileType[][]): Position[] {
    const destroyedPositions: Position[] = [];
    const settings = getSettings();

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const newType = tiles[y][x];
        const prevType = this.previousTiles[y]?.[x];

        if (newType === prevType) continue;

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
            // Animate destruction: scale down and fade out, then replace
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
    }

    return destroyedPositions;
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
    this.ghostLayoutKey = '';
    this.previousTiles = [];
  }
}
