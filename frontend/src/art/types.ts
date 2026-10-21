import type { ArtStyleId } from '@blast-arena/shared';

/**
 * What an art style changes beyond its textures. Renderers branch on these flags instead of on
 * the style id, so a style opts into each behaviour. Classic turns everything off, which keeps
 * the original look and code paths.
 */
export interface StyleFeatures {
  /** Interleave blocks and entities by the y of their feet (raised 3/4-view blocks). */
  ySort: boolean;
  /** Logical pixels a block's top face is raised above its tile (0 for flat styles). */
  blockHeight: number;
  /** Explosions drawn from centre/arm/end pieces instead of one blob per cell. */
  flamePieces: boolean;
  /** Bombs show a fuse that burns down with the timer. */
  fuseFrames: boolean;
  /** Bombs carry a stripe in their owner's colour. */
  ownerStripe: boolean;
  shadows: boolean;
  lights: boolean;
  scorch: boolean;
  shockwave: boolean;
  crateChunks: boolean;
  spawnDrop: boolean;
  knockoutGhost: boolean;
  localRing: boolean;
  teamRims: boolean;
  ambient: boolean;
  bloom: boolean;
  hitPause: boolean;
  animatedHazards: boolean;
  /** Snap sprites to whole texels and use nearest-neighbour filtering. */
  pixelSnap: boolean;
}

export interface ArtStyle {
  id: ArtStyleId;
  features: StyleFeatures;
  /** Paint a small scene for the settings picker onto `canvas` (its own pixel size). */
  drawPreview?(canvas: HTMLCanvasElement): void;
}

export const CLASSIC_FEATURES: StyleFeatures = Object.freeze({
  ySort: false,
  blockHeight: 0,
  flamePieces: false,
  fuseFrames: false,
  ownerStripe: false,
  shadows: false,
  lights: false,
  scorch: false,
  shockwave: false,
  crateChunks: false,
  spawnDrop: false,
  knockoutGhost: false,
  localRing: false,
  teamRims: false,
  ambient: false,
  bloom: false,
  hitPause: false,
  animatedHazards: false,
  pixelSnap: false,
});
