import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * The inline theme <script> in frontend/index.html runs only because its sha256 is whitelisted
 * in the CSP (docker/nginx/security-headers.conf). Edit one without the other and production
 * silently blocks the theme bootstrap: a CSP violation is no page error, so neither the e2e suite
 * nor the docs tour notices.
 */
const root = path.resolve(__dirname, '../../..');

function inlineScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1] ?? '';
    if (/\bsrc=/.test(attrs) || /type="application\/ld\+json"/.test(attrs)) continue;
    bodies.push(m[2]);
  }
  return bodies;
}

describe('CSP inline script hash', () => {
  it('whitelists the exact inline script of index.html', () => {
    const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf-8');
    const csp = fs.readFileSync(path.join(root, 'docker/nginx/security-headers.conf'), 'utf-8');
    const bodies = inlineScriptBodies(html);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      const hash = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
      expect(csp).toContain(`'sha256-${hash}'`);
    }
  });
});
