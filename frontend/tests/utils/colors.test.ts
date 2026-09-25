import { describe, it, expect } from 'vitest';
import { toCssHex, safeCssColor } from '../../src/utils/html';

/**
 * Colour values from the server placed into markup.
 *
 * - Cosmetic colours are stored as '#rrggbb' strings (the admin editor) or 0xRRGGBB numbers. The
 *   settings swatch prefixed '#' to the string form ('##ff0000', an invalid colour) and the
 *   preview crashed on a number. (item 16)
 * - A rank colour goes into a style attribute; only a strict #hex may, anything else could add
 *   its own declarations. (item 9)
 */

describe('toCssHex', () => {
  it.each([
    ['#ff0000', '#ff0000'],
    ['#FF8800', '#ff8800'],
    ['0x44aaff', '#44aaff'],
    ['44aaff', '#44aaff'],
    [0xff0000, '#ff0000'],
    [0x0000ff, '#0000ff'],
    [0, '#000000'],
  ])('%s -> %s', (input, expected) => {
    expect(toCssHex(input)).toBe(expected);
  });

  it.each([['##ff0000'], ['#fff'], ['red'], ['#ff0000;x'], [-1], [0x1000000], [1.5], [null], [{}]])(
    'rejects %s',
    (input) => {
      expect(toCssHex(input)).toBeNull();
    },
  );
});

describe('safeCssColor', () => {
  it('keeps strict hex colours', () => {
    expect(safeCssColor('#fc0', 'var(--primary)')).toBe('#fc0');
    expect(safeCssColor('#ffd700', 'var(--primary)')).toBe('#ffd700');
    expect(safeCssColor('#ffd700cc', 'var(--primary)')).toBe('#ffd700cc');
  });

  it('falls back for anything else', () => {
    for (const bad of ['red', 'red;background:url(x)', '#ffd70', '', null, 42, 'var(--x)']) {
      expect(safeCssColor(bad, 'var(--primary)')).toBe('var(--primary)');
    }
  });
});
