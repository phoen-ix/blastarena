import Phaser from 'phaser';
import type { Direction, EnemySpriteConfig, PowerUpType, TileType } from '@blast-arena/shared';
import { bakeAtlas, makeAnim } from './atlas';
import type { FrameSpec } from './atlas';
import { PU_TYPES, intToHex } from './paint';
import type { BombType, EyeStyle, FxKind, StylePainters, World } from './painters/types';
import { SHADOW_FROM_N, SHADOW_FROM_NW, SHADOW_FROM_W, SPECIAL_TILES } from './painters/types';
export { SPECIAL_TILES } from './painters/types';

export const DIRECTIONS: Direction[] = ['down', 'up', 'left', 'right'];
const WORLDS: World[] = [
  'classic',
  'forest',
  'desert',
  'ice',
  'volcano',
  'void',
  'castle',
  'swamp',
  'sky',
];
const FX_KINDS: FxKind[] = [
  'spark',
  'smoke',
  'dust',
  'star',
  'ember',
  'snow',
  'firefly',
  'mote',
  'glow',
  'ring',
  'localRing',
  'teamRing',
];

/** Seconds a flame lives (EXPLOSION_DURATION_TICKS at 20 ticks per second). */
export const FLAME_SECONDS = 0.5;

const FLAME_PIECES: { piece: 'center' | 'arm' | 'end'; dir: Direction }[] = [
  { piece: 'center', dir: 'down' },
  { piece: 'arm', dir: 'right' },
  { piece: 'arm', dir: 'down' },
  { piece: 'end', dir: 'up' },
  { piece: 'end', dir: 'down' },
  { piece: 'end', dir: 'left' },
  { piece: 'end', dir: 'right' },
];

/** Frame box: size and painter origin in logical units. */
interface Box {
  w: number;
  h: number;
  ox: number;
  oy: number;
}

/** Entity frame boxes, in logical units around the tile-centre origin. */
const ENTITY: Box = { w: 64, h: 80, ox: 32, oy: 52 };
const BOMB: Box = { w: 64, h: 64, ox: 32, oy: 36 };
const FLAME: Box = { w: 64, h: 64, ox: 32, oy: 32 };
const TOKEN: Box = { w: 64, h: 64, ox: 32, oy: 34 };
const FX: Box = { w: 48, h: 48, ox: 24, oy: 24 };
const CHUNK: Box = { w: 32, h: 32, ox: 16, oy: 16 };
const DECAL: Box = { w: 64, h: 64, ox: 32, oy: 32 };

/**
 * Bakes and names one drawn art style's textures. Texture keys are global to the Phaser game, so
 * a StyleArt is shared by every scene; it bakes lazily (a world's tiles when a map in that world
 * starts, an atlas per player colour when that colour first appears) and keeps what it baked
 * until the style changes.
 */
export class StyleArt {
  readonly painters: StylePainters;
  readonly scale: number;
  /** Rows above a tile that raised blocks may use, rounded to the art-pixel grid. */
  readonly top: number;
  private baked = new Set<string>();
  private ENTITY: Box;
  private BOMB: Box;
  private FLAME: Box;
  private TOKEN: Box;
  private FX: Box;
  private CHUNK: Box;
  private DECAL: Box;

  constructor(painters: StylePainters, renderScale = 1) {
    this.painters = painters;
    this.scale = painters.pixel ? 1 / painters.pixel : renderScale;
    const grid = painters.pixel ?? 1;
    this.top = Math.ceil((painters.blockHeight + 4) / grid) * grid;
    // Pixel art: frame sizes and origins on whole art pixels, so texels line up with the tiles.
    const snap = (b: Box): Box => ({
      w: Math.ceil(b.w / grid) * grid,
      h: Math.ceil(b.h / grid) * grid,
      ox: Math.round(b.ox / grid) * grid,
      oy: Math.round(b.oy / grid) * grid,
    });
    this.ENTITY = snap(ENTITY);
    this.BOMB = snap(BOMB);
    this.FLAME = snap(FLAME);
    this.TOKEN = snap(TOKEN);
    this.FX = snap(FX);
    this.CHUNK = snap(CHUNK);
    this.DECAL = snap(DECAL);
  }

  get id(): string {
    return this.painters.id;
  }

  private get nearest(): boolean {
    return !!this.painters.pixel;
  }

  private prefix(): string {
    return `art/${this.painters.id}`;
  }

  /* ---------------- tiles ---------------- */

  tilesKey(world: World): string {
    return `${this.prefix()}/tiles/${world}`;
  }

  static floorFrame(variant: number, parity: number, shadow: number): string {
    return `f${variant}p${parity}s${shadow}`;
  }

  static wallFrame(mask: number, border: boolean, variant: number): string {
    return `w${mask}b${border ? 1 : 0}v${variant}`;
  }

  static crateFrame(cracked: boolean, variant: number): string {
    return `c${cracked ? 'k' : 'c'}v${variant}`;
  }

  static specialFrame(tile: TileType, i: number): string {
    return `s:${tile}:${i}`;
  }

  specialAnim(world: World, tile: TileType): string {
    return `${this.tilesKey(world)}/${tile}`;
  }

  specialFrameCount(tile: TileType): number {
    return Math.max(1, Math.floor(this.painters.specialFrames(tile)));
  }

  /** Bake a world's floor, wall, crate and special tiles (once per world and style). */
  ensureTiles(scene: Phaser.Scene, world: World): string {
    const key = this.tilesKey(world);
    if (this.baked.has(key) && scene.textures.exists(key)) return key;
    const P = this.painters;
    const top = this.top;
    const frames: FrameSpec[] = [];
    for (let v = 0; v < 8; v++) {
      for (let parity = 0; parity < 2; parity++) {
        for (let shadow = 0; shadow < 8; shadow++) {
          frames.push({
            name: StyleArt.floorFrame(v, parity, shadow),
            w: 48,
            h: 48,
            ox: 0,
            oy: 0,
            extrude: true,
            paint: (g) => {
              P.floor(g, { world, variant: v, parity: parity as 0 | 1 });
              const from: [number, number, number][] = [
                [SHADOW_FROM_W, -48, 0],
                [SHADOW_FROM_N, 0, -48],
                [SHADOW_FROM_NW, -48, -48],
              ];
              for (const [bit, dx, dy] of from) {
                if (!(shadow & bit)) continue;
                g.save();
                g.translate(dx, dy);
                P.blockShadow(g, { world });
                g.restore();
              }
            },
          });
        }
      }
    }
    for (let mask = 0; mask < 16; mask++) {
      for (const border of [false, true]) {
        for (let variant = 0; variant < 4; variant++) {
          frames.push({
            name: StyleArt.wallFrame(mask, border, variant),
            w: 48,
            h: 48 + top,
            ox: 0,
            oy: top,
            paint: (g) => P.wall(g, { world, mask, border, variant }),
          });
        }
      }
    }
    for (const cracked of [false, true]) {
      for (let variant = 0; variant < 2; variant++) {
        frames.push({
          name: StyleArt.crateFrame(cracked, variant),
          w: 48,
          h: 48 + top,
          ox: 0,
          oy: top,
          paint: (g) => P.crate(g, { world, kind: cracked ? 'cracked' : 'crate', variant }),
        });
      }
    }
    for (const tile of SPECIAL_TILES) {
      const n = this.specialFrameCount(tile);
      for (let i = 0; i < n; i++) {
        frames.push({
          name: StyleArt.specialFrame(tile, i),
          w: 48,
          h: 48 + top,
          ox: 0,
          oy: top,
          paint: (g) => P.special(g, { world, tile, phase: i / n }),
        });
      }
    }
    if (!bakeAtlas(scene, key, frames, this.scale, this.nearest)) return key;
    for (const tile of SPECIAL_TILES) {
      const n = this.specialFrameCount(tile);
      if (n < 2) continue;
      const seconds = Math.max(0.1, P.specialLoopSeconds(tile));
      makeAnim(
        scene,
        this.specialAnim(world, tile),
        key,
        Array.from({ length: n }, (_, i) => StyleArt.specialFrame(tile, i)),
        n / seconds,
      );
    }
    this.baked.add(key);
    return key;
  }

  /* ---------------- effects, bombs, flames, pickups ---------------- */

  fxKey(): string {
    return `${this.prefix()}/fx`;
  }

  static flameFrame(piece: string, dir: Direction, pierce: boolean, i: number): string {
    return `fl:${piece}:${dir}:${pierce ? 1 : 0}:${i}`;
  }

  flameAnim(piece: string, dir: Direction, pierce: boolean): string {
    return `${this.fxKey()}/flame/${piece}/${dir}/${pierce ? 1 : 0}`;
  }

  static bombFrame(type: BombType, fuseIndex: number | 'hot', spark: 0 | 1): string {
    return `b:${type}:${fuseIndex}:${spark}`;
  }

  static bandFrame(type: BombType): string {
    return `bb:${type}`;
  }

  static powerUpFrame(type: PowerUpType, i: number): string {
    return `pu:${type}:${i}`;
  }

  powerUpAnim(type: PowerUpType): string {
    return `${this.fxKey()}/pu/${type}`;
  }

  static fxFrame(kind: FxKind): string {
    return `fx:${kind}`;
  }

  static chunkFrame(world: World, cracked: boolean, v: number): string {
    return `ch:${world}:${cracked ? 'k' : 'c'}:${v}`;
  }

  static scorchFrame(v: number): string {
    return `sc:${v}`;
  }

  static shieldFrame(i: number): string {
    return `sh:${i}`;
  }

  shieldAnim(): string {
    return `${this.fxKey()}/shield`;
  }

  get fuseFrames(): number {
    return Math.max(1, Math.floor(this.painters.fuseFrames));
  }

  ensureFx(scene: Phaser.Scene): string {
    const key = this.fxKey();
    if (this.baked.has(key) && scene.textures.exists(key)) return key;
    const P = this.painters;
    const frames: FrameSpec[] = [];
    const nf = Math.max(1, P.flameFrames);
    for (const { piece, dir } of FLAME_PIECES) {
      for (const pierce of [false, true]) {
        for (let i = 0; i < nf; i++) {
          frames.push({
            ...this.FLAME,
            name: StyleArt.flameFrame(piece, dir, pierce, i),
            paint: (g) => P.flame(g, { piece, dir, frame: i, frames: nf, pierce }),
          });
        }
      }
    }
    const fuse = this.fuseFrames;
    for (const type of ['normal', 'pierce'] as BombType[]) {
      for (let i = 0; i < fuse; i++) {
        for (const spark of [0, 1] as const) {
          frames.push({
            ...this.BOMB,
            name: StyleArt.bombFrame(type, i, spark),
            paint: (g) =>
              P.bomb(g, { type, fuse: fuse > 1 ? 1 - i / (fuse - 1) : 1, spark, hot: false }),
          });
        }
      }
    }
    for (const type of ['normal', 'pierce', 'remote'] as BombType[]) {
      for (const spark of [0, 1] as const) {
        frames.push({
          ...this.BOMB,
          name: StyleArt.bombFrame(type, 'hot', spark),
          paint: (g) => P.bomb(g, { type, fuse: 0.04, spark, hot: true }),
        });
        if (type === 'remote') {
          frames.push({
            ...this.BOMB,
            name: StyleArt.bombFrame(type, 0, spark),
            paint: (g) => P.bomb(g, { type, fuse: 1, spark, hot: false }),
          });
        }
      }
      frames.push({
        ...this.BOMB,
        name: StyleArt.bandFrame(type),
        paint: (g) => P.bombBand(g, { type }),
      });
    }
    const np = Math.max(1, P.powerUpFrames);
    for (const type of PU_TYPES) {
      for (let i = 0; i < np; i++) {
        frames.push({
          ...this.TOKEN,
          name: StyleArt.powerUpFrame(type, i),
          paint: (g) => P.powerUp(g, { type, frame: i, frames: np }),
        });
      }
    }
    for (let i = 0; i < 4; i++) {
      frames.push({
        ...this.ENTITY,
        name: StyleArt.shieldFrame(i),
        paint: (g) => P.shield(g, { frame: i }),
      });
    }
    for (const kind of FX_KINDS) {
      frames.push({
        ...this.FX,
        name: StyleArt.fxFrame(kind),
        paint: (g) => P.fx(g, { kind }),
      });
    }
    for (const world of WORLDS) {
      for (const cracked of [false, true]) {
        for (let v = 0; v < 3; v++) {
          frames.push({
            ...this.CHUNK,
            name: StyleArt.chunkFrame(world, cracked, v),
            paint: (g) =>
              P.chunk(g, { world, kind: cracked ? 'cracked' : 'crate', variant: v as 0 | 1 | 2 }),
          });
        }
      }
    }
    for (let v = 0; v < 4; v++) {
      frames.push({
        ...this.DECAL,
        name: StyleArt.scorchFrame(v),
        paint: (g) => P.scorch(g, { variant: v as 0 | 1 | 2 | 3 }),
      });
    }
    frames.push({ ...this.DECAL, name: 'meteor', paint: (g) => P.meteor(g) });

    if (!bakeAtlas(scene, key, frames, this.scale, this.nearest)) return key;
    for (const { piece, dir } of FLAME_PIECES) {
      for (const pierce of [false, true]) {
        makeAnim(
          scene,
          this.flameAnim(piece, dir, pierce),
          key,
          Array.from({ length: nf }, (_, i) => StyleArt.flameFrame(piece, dir, pierce, i)),
          nf / FLAME_SECONDS,
          0,
        );
      }
    }
    for (const type of PU_TYPES) {
      makeAnim(
        scene,
        this.powerUpAnim(type),
        key,
        Array.from({ length: np }, (_, i) => StyleArt.powerUpFrame(type, i)),
        np / 1.4,
      );
    }
    makeAnim(
      scene,
      this.shieldAnim(),
      key,
      [0, 1, 2, 3].map((i) => StyleArt.shieldFrame(i)),
      6,
    );
    this.baked.add(key);
    return key;
  }

  /* ---------------- players ---------------- */

  playerKey(color: number, eyes: EyeStyle): string {
    return `${this.prefix()}/p/${color.toString(16)}/${eyes}`;
  }

  static playerFrame(dir: Direction, pose: 'i' | 'b' | 'w0' | 'w1' | 'w2' | 'w3'): string {
    return `${dir}:${pose}`;
  }

  walkAnim(key: string, dir: Direction): string {
    return `${key}/walk/${dir}`;
  }

  /** Bake the frames for a player colour (and eye style); returns the texture key. */
  ensurePlayer(scene: Phaser.Scene, color: number, eyes: EyeStyle = 'default'): string {
    const key = this.playerKey(color, eyes);
    if (this.baked.has(key) && scene.textures.exists(key)) return key;
    const P = this.painters;
    const css = intToHex(color);
    const frames: FrameSpec[] = [];
    for (const dir of DIRECTIONS) {
      frames.push({
        ...this.ENTITY,
        name: StyleArt.playerFrame(dir, 'i'),
        paint: (g) => P.player(g, { color: css, eyes, dir, pose: { kind: 'idle', blink: false } }),
      });
      frames.push({
        ...this.ENTITY,
        name: StyleArt.playerFrame(dir, 'b'),
        paint: (g) => P.player(g, { color: css, eyes, dir, pose: { kind: 'idle', blink: true } }),
      });
      for (const step of [0, 1, 2, 3] as const) {
        frames.push({
          ...this.ENTITY,
          name: StyleArt.playerFrame(dir, `w${step}`),
          paint: (g) => P.player(g, { color: css, eyes, dir, pose: { kind: 'walk', step } }),
        });
      }
    }
    frames.push({ ...this.ENTITY, name: 'ghost', paint: (g) => P.ghost(g, { color: css }) });
    if (!bakeAtlas(scene, key, frames, this.scale, this.nearest)) return key;
    for (const dir of DIRECTIONS) {
      makeAnim(
        scene,
        this.walkAnim(key, dir),
        key,
        [0, 1, 2, 3].map((s) => StyleArt.playerFrame(dir, `w${s}` as 'w0')),
        10,
      );
    }
    this.baked.add(key);
    return key;
  }

  /* ---------------- enemies ---------------- */

  enemyKey(typeId: number): string {
    return `${this.prefix()}/e/${typeId}`;
  }

  enemyAnim(typeId: number, dir: Direction): string {
    return `${this.enemyKey(typeId)}/${dir}`;
  }

  ensureEnemy(scene: Phaser.Scene, typeId: number, sprite: EnemySpriteConfig): string {
    const key = this.enemyKey(typeId);
    // Enemy types can be edited between levels, so always rebake when asked.
    const P = this.painters;
    const frames: FrameSpec[] = [];
    for (const dir of DIRECTIONS) {
      for (const frame of [0, 1]) {
        frames.push({
          ...this.ENTITY,
          name: `${dir}:${frame}`,
          paint: (g) => P.enemy(g, { sprite, dir, frame }),
        });
      }
    }
    if (!bakeAtlas(scene, key, frames, this.scale, this.nearest)) return key;
    for (const dir of DIRECTIONS) {
      makeAnim(scene, this.enemyAnim(typeId, dir), key, [`${dir}:0`, `${dir}:1`], 4);
    }
    this.baked.add(key);
    return key;
  }

  /** Drop every texture and animation this style baked (on a style switch). */
  release(scene: Phaser.Scene): void {
    const prefix = this.prefix() + '/';
    for (const key of scene.textures.getTextureKeys()) {
      if (key.startsWith(prefix)) scene.textures.remove(key);
    }
    const anims = scene.anims as unknown as { anims?: { keys?: () => string[] } };
    const animKeys = anims.anims?.keys?.() ?? [];
    for (const key of animKeys) if (key.startsWith(prefix)) scene.anims.remove(key);
    this.baked.clear();
  }
}
