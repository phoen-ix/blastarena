import { ART_STYLE_IDS, DEFAULT_ART_STYLE } from '@blast-arena/shared';
import type { ArtStyleId } from '@blast-arena/shared';
import type { ArtStyle } from './types';
import { classicStyle } from './styles/classic';

/**
 * Styles this client build can draw. An id the server knows but the client does not (an admin
 * default set by a newer build, say) resolves to Classic.
 */
const STYLES: Partial<Record<ArtStyleId, ArtStyle>> = {
  classic: classicStyle,
};

export function isStyleAvailable(id: string): id is ArtStyleId {
  return Object.prototype.hasOwnProperty.call(STYLES, id);
}

/** Available styles, in the canonical order. */
export function availableStyles(): ArtStyleId[] {
  return ART_STYLE_IDS.filter((id) => isStyleAvailable(id));
}

export function getStyle(id: ArtStyleId): ArtStyle {
  return STYLES[id] ?? STYLES[DEFAULT_ART_STYLE]!;
}
