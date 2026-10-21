/**
 * Crisp Pixel: 16-bit pixel art drawn in code. Baked at one art pixel per texel (scale 1/3) and
 * shown with nearest-neighbour filtering. Every painter anchors to its origin and paints whole
 * art pixels (see pixelKit.anchor).
 */
import type { StylePainters } from '../../painters/types';
import { anchor } from './pixelKit';
import {
  floorTile,
  blockShadowTile,
  wallTile,
  crateTile,
  specialTile,
  specialFrameCount,
  specialLoopLength,
  chunkColors,
} from './tiles';
import { playerSprite, ghostSprite, markerSprite, enemySprite } from './actors';
import {
  bombSprite,
  bombBandSprite,
  flameSprite,
  powerUpSprite,
  shieldSprite,
  fxSprite,
  chunkSprite,
  scorchSprite,
  meteorSprite,
  FUSE_TIP,
} from './items';

/** Run `draw` with the origin at (0,0) of the current context, in art pixels. */
function at(g: CanvasRenderingContext2D, draw: () => void): void {
  g.save();
  anchor(g, 0, 0);
  draw();
  g.restore();
}

export const pixelPainters: StylePainters = {
  id: 'pixel',
  bg: '#0d0b14',
  // blocks keep their top and front faces inside their own tile
  blockHeight: 0,
  pixel: 3,
  flameFrames: 10,
  powerUpFrames: 6,
  fuseFrames: 6,
  fuseTip: FUSE_TIP,
  specialFrames: specialFrameCount,
  specialLoopSeconds: specialLoopLength,
  palette: {
    flameLight: '#ff9a3a',
    shock: '#ffe8a0',
    dust: '#cfc6d8',
    labelText: '#ffffff',
    labelStroke: '#120d1a',
    zoneOutside: '#5a1024',
    zoneEdge: '#ff4a5a',
    hillNeutral: '#ffc24a',
    vignette: '#05030a',
  },

  floor: (g, o) => at(g, () => floorTile(g, o.world, o.variant & 7, o.parity)),
  blockShadow: (g) => at(g, () => blockShadowTile(g)),
  wall: (g, o) => at(g, () => wallTile(g, o.world, o.mask, o.border, o.variant)),
  crate: (g, o) => at(g, () => crateTile(g, o.world, o.kind === 'cracked', o.variant)),
  special: (g, o) => at(g, () => specialTile(g, o.world, o.tile, o.phase)),
  player: (g, o) => at(g, () => playerSprite(g, o.color, o.eyes, o.dir, o.pose)),
  ghost: (g, o) => at(g, () => ghostSprite(g, o.color)),
  enemy: (g, o) => at(g, () => enemySprite(g, o.sprite, o.dir, o.frame)),
  bomb: (g, o) => at(g, () => bombSprite(g, o.type, o.fuse, o.spark, o.hot)),
  bombBand: (g, o) => at(g, () => bombBandSprite(g, o.type)),
  flame: (g, o) => at(g, () => flameSprite(g, o.piece, o.dir, o.frame, o.frames, o.pierce)),
  powerUp: (g, o) => at(g, () => powerUpSprite(g, o.type, o.frame, o.frames)),
  shield: (g, o) => at(g, () => shieldSprite(g, o.frame)),
  fx: (g, o) => at(g, () => fxSprite(g, o.kind)),
  chunk: (g, o) =>
    at(g, () => chunkSprite(g, chunkColors(o.world, o.kind === 'cracked'), o.variant)),
  scorch: (g, o) => at(g, () => scorchSprite(g, o.variant)),
  meteor: (g) => at(g, () => meteorSprite(g)),
  marker: (g, o) => at(g, () => markerSprite(g, o.shape, o.color)),
};
