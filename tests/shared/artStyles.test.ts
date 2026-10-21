import { describe, it, expect } from '@jest/globals';
import {
  ART_STYLE_IDS,
  DEFAULT_ART_STYLE,
  isArtStyleId,
} from '../../shared/src/constants/artStyles';

describe('art style ids', () => {
  it('keeps classic as the built-in default', () => {
    expect(DEFAULT_ART_STYLE).toBe('classic');
    expect(ART_STYLE_IDS).toContain(DEFAULT_ART_STYLE);
  });

  it('accepts every listed style and nothing else', () => {
    for (const id of ART_STYLE_IDS) expect(isArtStyleId(id)).toBe(true);
    for (const bad of ['', 'Classic', 'vaporwave', null, undefined, 3, {}]) {
      expect(isArtStyleId(bad)).toBe(false);
    }
  });
});
