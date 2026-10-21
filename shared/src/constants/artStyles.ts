/**
 * Art styles a player can pick for the arena. `classic` is the original look and the
 * fallback when no admin default is set. Display names are i18n keys
 * (`ui:settings.artStyles.<id>.name`), not stored here.
 */
export const ART_STYLE_IDS = ['classic', 'neon', 'toy', 'pixel'] as const;
export type ArtStyleId = (typeof ART_STYLE_IDS)[number];
export const DEFAULT_ART_STYLE: ArtStyleId = 'classic';

export function isArtStyleId(value: unknown): value is ArtStyleId {
  return typeof value === 'string' && (ART_STYLE_IDS as readonly string[]).includes(value);
}
