import type Phaser from 'phaser';
import { artStyleManager } from './ArtStyleManager';
import { StyleArt } from './StyleArt';
import { textureRatio } from './hidpi';

let current: StyleArt | null = null;

/**
 * The baked art for the current style, or null for Classic (which draws with its own textures).
 * A style switch drops the previous style's textures the next time a scene asks.
 */
export function activeStyleArt(scene: Phaser.Scene): StyleArt | null {
  const style = artStyleManager.style();
  if (!style.painters) {
    if (current) {
      current.release(scene);
      current = null;
    }
    return null;
  }
  if (!current || current.id !== style.id) {
    current?.release(scene);
    current = new StyleArt(style.painters, textureRatio());
  }
  return current;
}
