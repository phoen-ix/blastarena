/**
 * Toy Diorama: a tabletop board-game diorama under warm daylight. Raised chunky blocks with soft
 * shadows to the bottom right, round bombers with helmets and waddling feet, puffy cel-shaded
 * cartoon fire, glossy toy tokens. Ported from the approved prototype; see ../../painters/types.ts
 * for the contract.
 */
import type { StylePainters } from '../../painters/types';
import { RAISE, INK } from './common';
import {
  blockShadow,
  crate,
  floor,
  special,
  specialFrames,
  specialLoopSeconds,
  wall,
} from './tiles';
import { enemy, ghost, marker, player, shield } from './actors';
import {
  FLAME_FRAMES,
  FUSE_FRAMES,
  FUSE_TIP,
  POWERUP_FRAMES,
  bomb,
  bombBand,
  chunk,
  flame,
  fx,
  meteor,
  powerUp,
  scorch,
} from './items';

export const toyPainters: StylePainters = {
  id: 'toy',
  bg: '#1b1524',
  blockHeight: RAISE,
  specialFrames,
  specialLoopSeconds,
  flameFrames: FLAME_FRAMES,
  powerUpFrames: POWERUP_FRAMES,
  fuseFrames: FUSE_FRAMES,
  fuseTip: FUSE_TIP,
  palette: {
    flameLight: '#ffa040',
    shock: '#fff0c8',
    dust: '#efe3c8',
    labelText: '#fff8ec',
    labelStroke: INK,
    zoneOutside: '#b0303a',
    zoneEdge: '#ff6b5a',
    hillNeutral: '#ffc24a',
    vignette: '#160b12',
  },
  floor,
  blockShadow,
  wall,
  crate,
  special,
  player,
  ghost,
  enemy,
  bomb,
  bombBand,
  flame,
  powerUp,
  shield,
  fx,
  chunk,
  scorch,
  meteor,
  marker,
};
