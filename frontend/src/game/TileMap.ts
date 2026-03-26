import Phaser from 'phaser';
import { TileType, Position } from '@blast-arena/shared';
import { TILE_SIZE } from '@blast-arena/shared';
import { getSettings } from './Settings';

export class TileMapRenderer {
  private scene: Phaser.Scene;
  private tileSprites: Phaser.GameObjects.Sprite[][] = [];
  private previousTiles: TileType[][] = [];
  private width: number;
  private height: number;
  private theme?: string;

  constructor(
    scene: Phaser.Scene,
    tiles: TileType[][],
    width: number,
    height: number,
    theme?: string,
  ) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.theme = theme;
    this.createTiles(tiles);
  }

  private createTiles(tiles: TileType[][]): void {
    this.tileSprites = [];
    this.previousTiles = [];

    for (let y = 0; y < this.height; y++) {
      this.tileSprites[y] = [];
      this.previousTiles[y] = [];
      for (let x = 0; x < this.width; x++) {
        const tileType = tiles[y][x];
        const textureKey = this.getTileTexture(tileType, x, y);
        const sprite = this.scene.add.sprite(
          x * TILE_SIZE + TILE_SIZE / 2,
          y * TILE_SIZE + TILE_SIZE / 2,
          textureKey,
        );
        this.tileSprites[y][x] = sprite;
        this.previousTiles[y][x] = tileType;
        if (this.isConveyorTile(tileType)) {
          this.playConveyorAnim(sprite, tileType);
        }
      }
    }
  }

  private isConveyorTile(type: TileType | undefined): boolean {
    return (
      type === 'conveyor_up' ||
      type === 'conveyor_down' ||
      type === 'conveyor_left' ||
      type === 'conveyor_right'
    );
  }

  private playConveyorAnim(sprite: Phaser.GameObjects.Sprite, type: TileType): void {
    const settings = getSettings();
    if (!settings.animations) return;
    const prefix = this.theme && this.theme !== 'classic' ? 'themed_' : '';
    const animKey = `${prefix}${type}_anim`;
    if (this.scene.anims.exists(animKey)) {
      sprite.play(animKey);
    }
  }

  private getTileTexture(type: TileType, x: number, y: number): string {
    const themed = this.theme && this.theme !== 'classic';
    switch (type) {
      case 'wall':
        return themed ? 'themed_wall' : 'wall';
      case 'destructible':
        return themed ? 'themed_destructible' : 'destructible';
      case 'destructible_cracked' as TileType:
        return themed ? 'themed_destructible_cracked' : 'destructible_cracked';
      case 'teleporter_a' as TileType:
      case 'teleporter_b' as TileType:
        return themed ? `themed_${type}` : type;
      case 'conveyor_up' as TileType:
      case 'conveyor_down' as TileType:
      case 'conveyor_left' as TileType:
      case 'conveyor_right' as TileType:
        return themed ? `themed_${type}` : type;
      case 'exit' as TileType:
        return themed ? 'themed_exit' : 'exit';
      case 'goal' as TileType:
        return themed ? 'themed_goal' : 'goal';
      // Puzzle tiles
      case 'switch_red' as TileType:
      case 'switch_blue' as TileType:
      case 'switch_green' as TileType:
      case 'switch_yellow' as TileType:
      case 'switch_red_active' as TileType:
      case 'switch_blue_active' as TileType:
      case 'switch_green_active' as TileType:
      case 'switch_yellow_active' as TileType:
      case 'gate_red' as TileType:
      case 'gate_blue' as TileType:
      case 'gate_green' as TileType:
      case 'gate_yellow' as TileType:
      case 'gate_red_open' as TileType:
      case 'gate_blue_open' as TileType:
      case 'gate_green_open' as TileType:
      case 'gate_yellow_open' as TileType:
        return themed ? `themed_${type}` : type;
      case 'crumbling' as TileType:
        return themed ? 'themed_crumbling' : 'crumbling';
      case 'pit' as TileType:
        return type;
      // Hazard tiles — texture key matches tile type name
      case 'vine' as TileType:
      case 'quicksand' as TileType:
      case 'ice' as TileType:
      case 'lava' as TileType:
      case 'mud' as TileType:
      case 'spikes' as TileType:
      case 'spikes_active' as TileType:
      case 'dark_rift' as TileType:
        return type;
      case 'empty':
      case 'spawn':
      default:
        return themed ? `themed_floor_${(x + y) % 4}` : `floor_${(x + y) % 4}`;
    }
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
            const newTexture = this.getTileTexture(newType, x, y);
            const newSprite = this.scene.add.sprite(
              x * TILE_SIZE + TILE_SIZE / 2,
              y * TILE_SIZE + TILE_SIZE / 2,
              newTexture,
            );
            this.tileSprites[y][x] = newSprite;
          } else {
            // No animation: just swap the texture
            const newTexture = this.getTileTexture(newType, x, y);
            this.tileSprites[y][x].setTexture(newTexture);
            this.tileSprites[y][x].setAlpha(1);
            this.tileSprites[y][x].setScale(1);
          }
        } else if (this.isGateOpening(prevType, newType)) {
          // Gate opening: scale down old bars, reveal open gate underneath
          const newTexture = this.getTileTexture(newType, x, y);
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
        } else if (this.isGateClosing(prevType, newType)) {
          // Gate closing: new bars scale up from small to full
          const newTexture = this.getTileTexture(newType, x, y);
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
        } else if (prevType === ('crumbling' as TileType) && newType === ('pit' as TileType)) {
          // Crumbling floor collapses into pit
          const newTexture = this.getTileTexture(newType, x, y);
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
        } else {
          // Non-destructive tile change (e.g. conveyor placed, teleporter toggled,
          // switch state change — simple texture swap)
          const newTexture = this.getTileTexture(newType, x, y);
          const sprite = this.tileSprites[y][x];
          sprite.stop();
          sprite.setTexture(newTexture);
          if (this.isConveyorTile(newType)) {
            this.playConveyorAnim(sprite, newType);
          }
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
    this.tileSprites = [];
    this.previousTiles = [];
  }
}
