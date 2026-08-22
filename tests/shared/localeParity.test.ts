import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Every locale must carry exactly the keys `en` carries.
 *
 * The TOTP/2FA feature shipped English-only: 42 keys were missing from each of the 11 non-English
 * locales — 462 strings — so users on de/fr/es/it/nl/pl/pt/sv/da/nb/tr saw raw English throughout
 * 2FA setup, the login challenge and the admin reset modal. One locale also carried a stale
 * admin key that no longer existed in `en`. Nothing caught either, because a missing key silently
 * falls back to English at runtime. (audit I18N-PARITY-1)
 */
const ROOT = path.join(__dirname, '../..');
const WORKSPACES = ['shared', 'backend', 'frontend'];

type Flat = Record<string, string>;

function flatten(obj: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v as Record<string, unknown>, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

function localesDir(workspace: string): string | null {
  const dir = path.join(ROOT, workspace, 'src/i18n/locales');
  return fs.existsSync(dir) ? dir : null;
}

/** Placeholders like {{username}} must survive translation, or interpolation breaks silently. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
}

describe('locale parity', () => {
  for (const workspace of WORKSPACES) {
    const dir = localesDir(workspace);
    if (!dir) continue;

    const languages = fs.readdirSync(dir).filter((l) => l !== 'en');
    const namespaces = fs.readdirSync(path.join(dir, 'en')).filter((f) => f.endsWith('.json'));

    describe(workspace, () => {
      it('has an en locale with namespaces to compare against', () => {
        expect(namespaces.length).toBeGreaterThan(0);
        expect(languages.length).toBeGreaterThan(0);
      });

      for (const ns of namespaces) {
        const en = flatten(
          JSON.parse(fs.readFileSync(path.join(dir, 'en', ns), 'utf-8')),
        );

        for (const lang of languages) {
          const file = path.join(dir, lang, ns);

          it(`${lang}/${ns} has exactly the keys en has`, () => {
            expect(fs.existsSync(file)).toBe(true);
            const other = flatten(JSON.parse(fs.readFileSync(file, 'utf-8')));

            const missing = Object.keys(en).filter((k) => !(k in other));
            const extra = Object.keys(other).filter((k) => !(k in en));

            expect({ missing, extra }).toEqual({ missing: [], extra: [] });
          });

          it(`${lang}/${ns} keeps every {{placeholder}}`, () => {
            const other = flatten(JSON.parse(fs.readFileSync(file, 'utf-8')));
            const mismatched: string[] = [];
            for (const [key, value] of Object.entries(en)) {
              if (!(key in other)) continue;
              const expected = placeholders(value);
              const actual = placeholders(other[key]);
              if (expected.join(',') !== actual.join(',')) mismatched.push(key);
            }
            expect(mismatched).toEqual([]);
          });
        }
      }
    });
  }
});
