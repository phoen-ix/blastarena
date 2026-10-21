import type { StylePainters } from '../../painters/types';
import { blockShadow, crate, floor, wall } from './tiles';
import { special, specialFrames, specialLoopSeconds } from './specials';
import { enemy, ghost, player, shield } from './actors';
import { bomb, bombBand, chunk, flame, fx, meteor, powerUp, scorch } from './items';

/**
 * Neon Arena: a night-time arena of dark glass and emissive light. Flat (no raised blocks):
 * depth comes from bevels, glowing edges and the drop shadows the blocks throw onto the floor.
 */
export const neonPainters: StylePainters = {
  id: 'neon',
  bg: '#05060d',
  blockHeight: 0,
  specialFrames,
  specialLoopSeconds,
  flameFrames: 10,
  powerUpFrames: 6,
  fuseFrames: 8,
  // the spark sits at the top of the timer ring while the fuse is full
  fuseTip: { x: 0, y: -17 },
  palette: {
    flameLight: '#ff7040',
    shock: '#ffb08a',
    dust: '#7d8bbd',
    labelText: '#e8fbff',
    labelStroke: '#05060d',
    zoneOutside: '#7a0a28',
    zoneEdge: '#ff4f7a',
    hillNeutral: '#ffc24a',
    vignette: '#000005',
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
};
