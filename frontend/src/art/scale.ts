/**
 * Texture resolution bookkeeping.
 *
 * Art-style textures may be baked at more than one pixel per logical pixel (sharp rendering on
 * high-resolution screens). Phaser 4 ignores a texture source's `resolution` when it sizes and
 * positions a sprite, so instead each baked texture records its scale in
 * `texture.customData.texScale`, and renderers express every scale relative to `base(obj)`.
 * Classic and other legacy textures carry no entry and count as 1, so for them `base()` is 1 and
 * every scale stays exactly what it was before.
 */

/** Phaser types `Texture.customData` as a plain object. */
interface HasTexture {
  texture?: { customData?: object } | null;
}

/** Pixels per logical pixel the object's current texture was baked at. */
export function texScaleOf(obj: HasTexture): number {
  const s = (obj.texture?.customData as { texScale?: unknown } | undefined)?.texScale;
  return typeof s === 'number' && s > 0 ? s : 1;
}

/** The object scale that shows `logical` times the texture's logical (48-unit tile) size. */
export function base(obj: HasTexture, logical = 1): number {
  return logical / texScaleOf(obj);
}

/** Set both axes to `base(obj, logical)`. Call after every `setTexture` on a scalable sprite. */
export function fit<T extends HasTexture & { setScale(x: number, y?: number): unknown }>(
  obj: T,
  logical = 1,
): T {
  obj.setScale(base(obj, logical));
  return obj;
}

/** Record the bake scale on a texture created by an art style. */
export function markTexScale(
  texture: { customData?: object } | null | undefined,
  scale: number,
): void {
  if (!texture) return;
  if (!texture.customData) texture.customData = {};
  (texture.customData as { texScale?: number }).texScale = scale;
}
