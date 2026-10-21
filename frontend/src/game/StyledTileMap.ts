import Phaser from 'phaser';
import { TILE_SIZE } from '@blast-arena/shared';
import type { Position, TileDiff, TileType } from '@blast-arena/shared';
import { getSettings } from './Settings';
import { wrapGhostTileSpans } from '../utils/wrapGhosts';
import { DEPTH, Y_BIAS, setDepthIfChanged, ySortDepth } from '../art/depth';
import { fit } from '../art/scale';
import { hash2 } from '../art/paint';
import { StyleArt } from '../art/StyleArt';
import {
  MASK_E,
  MASK_N,
  MASK_S,
  MASK_W,
  SHADOW_FROM_N,
  SHADOW_FROM_NW,
  SHADOW_FROM_W,
  isBlockTile,
  isSpecialTile,
} from '../art/painters/types';
import type { World } from '../art/painters/types';

/** What GameScene needs from a tile map, whichever art style draws it. */
export interface TileMapLike {
  matches(width: number, height: number): boolean;
  updateTiles(tiles: TileType[][]): Position[];
  applyTileDiffs(diffs: readonly TileDiff[]): Position[];
  updateGhosts(): void;
  destroy(): void;
}

const GROUND_SPECIAL_DEPTH = DEPTH.FLOOR + 1;

function isDestructible(t: TileType | undefined): boolean {
  return t === 'destructible' || t === 'destructible_cracked';
}

/**
 * Tile map for the drawn art styles. Unlike the classic renderer (one sprite per cell), every
 * cell has a floor image — with the shadows of the blocks to its west, north and north-west
 * baked into its frame — plus, where needed, an overlay: a raised block (wall, crate, closed
 * gate) y-sorted with the players, or a ground-level special tile (hazard, switch, teleporter…).
 */
export class StyledTileMap implements TileMapLike {
  private scene: Phaser.Scene;
  private art: StyleArt;
  private key: string;
  private world: World;
  private width: number;
  private height: number;
  private wrapping: boolean;
  private tiles: TileType[] = [];
  private floors: Phaser.GameObjects.Image[] = [];
  private overlays: (Phaser.GameObjects.Sprite | null)[] = [];

  private ghostFloorPool: Phaser.GameObjects.Image[] = [];
  private ghostOverPool: Phaser.GameObjects.Image[] = [];
  private ghostViewKey = '';

  constructor(
    scene: Phaser.Scene,
    art: StyleArt,
    tiles: TileType[][],
    width: number,
    height: number,
    theme?: string,
    wrapping = false,
  ) {
    this.scene = scene;
    this.art = art;
    this.width = width;
    this.height = height;
    this.wrapping = wrapping;
    this.world = (theme as World) || 'classic';
    this.key = art.ensureTiles(scene, this.world);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) this.tiles[y * width + x] = tiles[y][x];
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const floor = fit(
          scene.add.image(x * TILE_SIZE, y * TILE_SIZE, this.key, this.floorFrame(x, y)),
        );
        floor.setDepth(DEPTH.FLOOR);
        this.floors[y * width + x] = floor;
        this.overlays[y * width + x] = this.makeOverlay(x, y, false);
      }
    }
    if (wrapping) this.updateGhosts();
  }

  matches(width: number, height: number): boolean {
    return this.width === width && this.height === height;
  }

  /* ---------------- cell helpers ---------------- */

  private tileAt(x: number, y: number): TileType | undefined {
    if (this.wrapping) {
      x = ((x % this.width) + this.width) % this.width;
      y = ((y % this.height) + this.height) % this.height;
    } else if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return undefined;
    }
    return this.tiles[y * this.width + x];
  }

  private blockAt(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return t !== undefined && isBlockTile(t);
  }

  private floorFrame(x: number, y: number): string {
    const variant = Math.floor(hash2(x, y, 11) * 8);
    let shadow = 0;
    if (this.blockAt(x - 1, y)) shadow |= SHADOW_FROM_W;
    if (this.blockAt(x, y - 1)) shadow |= SHADOW_FROM_N;
    if (this.blockAt(x - 1, y - 1)) shadow |= SHADOW_FROM_NW;
    return StyleArt.floorFrame(variant, (x + y) & 1, shadow);
  }

  private wallMask(x: number, y: number): number {
    let m = 0;
    if (this.tileAt(x, y - 1) === 'wall') m |= MASK_N;
    if (this.tileAt(x + 1, y) === 'wall') m |= MASK_E;
    if (this.tileAt(x, y + 1) === 'wall') m |= MASK_S;
    if (this.tileAt(x - 1, y) === 'wall') m |= MASK_W;
    return m;
  }

  /** Frame (or animation) for the overlay of a cell, or null for plain floor. */
  private overlayLook(x: number, y: number): { frame: string; anim?: string } | null {
    const t = this.tileAt(x, y);
    if (!t || t === 'empty' || t === 'spawn') return null;
    if (t === 'wall') {
      const border =
        !this.wrapping && (x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1);
      return {
        frame: StyleArt.wallFrame(this.wallMask(x, y), border, Math.floor(hash2(x, y, 12) * 4)),
      };
    }
    if (isDestructible(t)) {
      return {
        frame: StyleArt.crateFrame(t === 'destructible_cracked', Math.floor(hash2(x, y, 13) * 2)),
      };
    }
    if (isSpecialTile(t)) {
      const n = this.art.specialFrameCount(t);
      const anim = n > 1 ? this.art.specialAnim(this.world, t) : undefined;
      return { frame: StyleArt.specialFrame(t, 0), anim };
    }
    return null;
  }

  private overlayDepth(y: number, t: TileType | undefined): number {
    return t && isBlockTile(t)
      ? ySortDepth((y + 1) * TILE_SIZE, Y_BIAS.BLOCK)
      : GROUND_SPECIAL_DEPTH;
  }

  private makeOverlay(x: number, y: number, animateIn: boolean): Phaser.GameObjects.Sprite | null {
    const look = this.overlayLook(x, y);
    if (!look) return null;
    const t = this.tileAt(x, y);
    const sprite = fit(this.scene.add.sprite(x * TILE_SIZE, y * TILE_SIZE, this.key, look.frame));
    sprite.setDepth(this.overlayDepth(y, t));
    if (look.anim && getSettings().animations && this.scene.anims.exists(look.anim)) {
      sprite.play({ key: look.anim, startFrame: Math.floor(hash2(x, y, 14) * 4) });
    }
    if (animateIn && getSettings().animations && t && isBlockTile(t)) {
      // Drop in from above with a little squash on landing.
      const sx = sprite.scaleX;
      const sy = sprite.scaleY;
      sprite.y -= 36;
      sprite.setAlpha(0);
      this.scene.tweens.add({
        targets: sprite,
        y: y * TILE_SIZE,
        alpha: 1,
        duration: 260,
        ease: 'Quad.In',
        onComplete: () => {
          this.scene.tweens.add({
            targets: sprite,
            scaleX: sx * 1.08,
            scaleY: sy * 0.9,
            duration: 70,
            yoyo: true,
            ease: 'Sine.easeOut',
          });
        },
      });
    }
    return sprite;
  }

  /** Re-pick the floor frame of a cell and its shadow-receiving neighbours. */
  private refreshFloorsAround(x: number, y: number): void {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      let nx = x + dx;
      let ny = y + dy;
      if (this.wrapping) {
        nx = ((nx % this.width) + this.width) % this.width;
        ny = ((ny % this.height) + this.height) % this.height;
      } else if (nx >= this.width || ny >= this.height) continue;
      this.floors[ny * this.width + nx]?.setFrame(this.floorFrame(nx, ny));
    }
  }

  /** Walls connect to neighbouring walls; refresh the four around a changed cell. */
  private refreshWallsAround(x: number, y: number): void {
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.tileAt(nx, ny) !== 'wall') continue;
      const wx = this.wrapping ? ((nx % this.width) + this.width) % this.width : nx;
      const wy = this.wrapping ? ((ny % this.height) + this.height) % this.height : ny;
      const look = this.overlayLook(wx, wy);
      const o = this.overlays[wy * this.width + wx];
      if (o && look) o.setFrame(look.frame);
    }
  }

  /* ---------------- updates ---------------- */

  updateTiles(tiles: TileType[][]): Position[] {
    const destroyed: Position[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const t = tiles[y]?.[x];
        if (t === undefined || t === this.tiles[y * this.width + x]) continue;
        this.applyChange(x, y, t, destroyed);
      }
    }
    return destroyed;
  }

  applyTileDiffs(diffs: readonly TileDiff[]): Position[] {
    const destroyed: Position[] = [];
    for (const { x, y, type } of diffs) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
      if (type === this.tiles[y * this.width + x]) continue;
      this.applyChange(x, y, type, destroyed);
    }
    return destroyed;
  }

  private applyChange(x: number, y: number, next: TileType, destroyed: Position[]): void {
    const i = y * this.width + x;
    const prev = this.tiles[i];
    this.tiles[i] = next;
    const animations = getSettings().animations;
    const old = this.overlays[i];
    const wasBlock = isBlockTile(prev);
    const isBlock = isBlockTile(next);
    const nowEmpty = next === 'empty' || next === 'spawn';

    if ((isDestructible(prev) || prev === 'vine') && nowEmpty) destroyed.push({ x, y });

    // A reinforced block cracking: same sprite, new frame, plus a white hit flash.
    if (prev === 'destructible' && next === 'destructible_cracked' && old) {
      const look = this.overlayLook(x, y);
      if (look) old.setFrame(look.frame);
      if (animations) this.flash(old);
      return;
    }

    if (old) {
      this.overlays[i] = null;
      if (animations && (wasBlock || prev === 'crumbling' || prev === 'vine')) {
        // Blocks pop and shrink away (the chunks come from EffectSystem); gates and crumbling
        // floors sink.
        old.setDepth(old.depth + 0.05);
        this.scene.tweens.add({
          targets: old,
          alpha: 0,
          scaleX: old.scaleX * (isDestructible(prev) ? 1.12 : 0.6),
          scaleY: old.scaleY * (isDestructible(prev) ? 0.7 : 0.6),
          y: old.y + (isDestructible(prev) ? 6 : 10),
          duration: isDestructible(prev) ? 140 : 220,
          ease: 'Quad.In',
          onComplete: () => old.destroy(),
        });
      } else {
        old.destroy();
      }
    }
    this.overlays[i] = this.makeOverlay(x, y, animations && isBlock && !wasBlock);

    if (wasBlock !== isBlock) this.refreshFloorsAround(x, y);
    if (prev === 'wall' || next === 'wall') this.refreshWallsAround(x, y);
    this.ghostViewKey = '';
  }

  private flash(sprite: Phaser.GameObjects.Sprite): void {
    sprite.setTint(0xffffff);
    sprite.setTintMode(Phaser.TintModes.FILL);
    this.scene.time.delayedCall(70, () => {
      if (!sprite.active) return;
      sprite.clearTint();
      sprite.setTintMode(Phaser.TintModes.MULTIPLY);
    });
  }

  /* ---------------- wrap ghosts ---------------- */

  updateGhosts(): void {
    if (!this.wrapping) return;
    const cam = this.scene.cameras?.main;
    if (!cam) return;
    const view = cam.worldView;
    const vx0 = Math.floor(view.x / TILE_SIZE);
    const vy0 = Math.floor(view.y / TILE_SIZE);
    const vx1 = Math.floor((view.x + view.width) / TILE_SIZE);
    const vy1 = Math.floor((view.y + view.height) / TILE_SIZE);
    const viewKey = `${vx0},${vy0},${vx1},${vy1}`;
    if (viewKey === this.ghostViewKey) return;
    this.ghostViewKey = viewKey;

    const spans = wrapGhostTileSpans(view, this.width, this.height, TILE_SIZE);
    let floorsUsed = 0;
    let oversUsed = 0;
    for (const span of spans) {
      for (let y = span.y0; y <= span.y1; y++) {
        for (let x = span.x0; x <= span.x1; x++) {
          const i = y * this.width + x;
          const px = x * TILE_SIZE + span.ox;
          const py = y * TILE_SIZE + span.oy;
          const floor = this.floors[i];
          let fimg = this.ghostFloorPool[floorsUsed];
          if (!fimg) {
            fimg = this.scene.add.image(0, 0, this.key, floor.frame.name);
            fimg.setDepth(DEPTH.FLOOR);
            this.ghostFloorPool[floorsUsed] = fimg;
          }
          fimg.setFrame(floor.frame.name).setVisible(true).setPosition(px, py);
          fit(fimg);
          floorsUsed++;

          const over = this.overlays[i];
          if (over) {
            let oimg = this.ghostOverPool[oversUsed];
            if (!oimg) {
              oimg = this.scene.add.image(0, 0, this.key, over.frame.name);
              this.ghostOverPool[oversUsed] = oimg;
            }
            oimg.setFrame(over.frame.name).setVisible(true).setPosition(px, py);
            fit(oimg);
            const t = this.tiles[i];
            setDepthIfChanged(
              oimg,
              t && isBlockTile(t) ? ySortDepth(py + TILE_SIZE, Y_BIAS.BLOCK) : GROUND_SPECIAL_DEPTH,
            );
            oversUsed++;
          }
        }
      }
    }
    for (let i = floorsUsed; i < this.ghostFloorPool.length; i++) {
      this.ghostFloorPool[i].setVisible(false);
    }
    for (let i = oversUsed; i < this.ghostOverPool.length; i++) {
      this.ghostOverPool[i].setVisible(false);
    }
  }

  destroy(): void {
    for (const f of this.floors) f?.destroy();
    for (const o of this.overlays) o?.destroy();
    for (const g of this.ghostFloorPool) g.destroy();
    for (const g of this.ghostOverPool) g.destroy();
    this.floors = [];
    this.overlays = [];
    this.ghostFloorPool = [];
    this.ghostOverPool = [];
    this.tiles = [];
    this.ghostViewKey = '';
  }
}
