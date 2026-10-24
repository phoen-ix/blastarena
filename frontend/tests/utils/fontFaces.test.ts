import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * The self-hosted fonts were Latin-only subsets, so Turkish ğ ş İ and Polish ą ł ś ż fell back to
 * a system font mid-word. Every face needs a Latin Extended companion for those letters.
 */
const ROOT = join(import.meta.dirname, '../..');
const faces = [
  ...readFileSync(join(ROOT, 'index.html'), 'utf8').matchAll(/@font-face\s*{([^}]*)}/g),
].map(([, body]) => ({
  family: /font-family:\s*'([^']+)'/.exec(body)![1],
  weight: /font-weight:\s*([^;]+);/.exec(body)![1].trim(),
  file: /url\('([^']+)'\)/.exec(body)![1],
  ranges: (/unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? 'U+0-10FFFF').split(',').map((r) =>
    r
      .trim()
      .slice(2)
      .split('-')
      .map((h) => parseInt(h, 16)),
  ),
}));

const covers = (ranges: number[][], ch: string) =>
  ranges.some(([lo, hi = lo]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi);

describe('self-hosted font faces', () => {
  it('have their files in public/', () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const f of faces) expect(existsSync(join(ROOT, 'public', f.file))).toBe(true);
  });

  for (const key of new Set(faces.map((f) => `${f.family} ${f.weight}`))) {
    it(`${key} has a face for Latin Extended letters`, () => {
      const ext = faces.filter(
        (f) => `${f.family} ${f.weight}` === key && f.ranges.length > 1 && covers(f.ranges, 'ğ'),
      );
      expect(ext).toHaveLength(1);
      for (const ch of 'ğşİłąśż') expect(covers(ext[0].ranges, ch)).toBe(true);
    });
  }
});
