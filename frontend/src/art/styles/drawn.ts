import type { ArtStyle, StyleFeatures } from '../types';
import type { StylePainters } from '../painters/types';
import { drawStylePreview } from '../preview';

/** Feature set shared by the drawn styles; each style adjusts what differs. */
export function drawnFeatures(
  painters: StylePainters,
  extra: Partial<StyleFeatures> = {},
): StyleFeatures {
  return {
    ySort: true,
    blockHeight: painters.blockHeight,
    flamePieces: true,
    fuseFrames: true,
    ownerStripe: true,
    shadows: true,
    lights: true,
    scorch: true,
    shockwave: true,
    crateChunks: true,
    spawnDrop: true,
    knockoutGhost: true,
    localRing: true,
    teamRims: true,
    ambient: true,
    bloom: false,
    hitPause: true,
    animatedHazards: true,
    pixelSnap: !!painters.pixel,
    ...extra,
  };
}

export function drawnStyle(painters: StylePainters, extra: Partial<StyleFeatures> = {}): ArtStyle {
  return {
    id: painters.id,
    painters,
    features: drawnFeatures(painters, extra),
    drawPreview: (canvas) => drawStylePreview(painters, canvas),
  };
}
