import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for nginx locations that serve a response without the security headers.
 *
 * nginx does not inherit `add_header` into a location that defines its own, and this config gives
 * every location its own `include /etc/nginx/security-headers.conf`. Two were missed:
 * `location = /502.html` and `location @rate_limited`, so every 502/503/504 and every 429 shipped
 * with no CSP, no HSTS, no nosniff and no frame-ancestors at all. The 502 page's inline <script>
 * only ran *because* no CSP reached it.
 *
 * The same inheritance rule bit a second time: `error_page` is taken from the server level only
 * when the current level declares none, so the three proxy locations declaring
 * `error_page 429 @rate_limited` silently shadowed the server-level
 * `error_page 502 503 504 /502.html` — and since `location /` serves from disk and never 502s, the
 * custom page had no path to being rendered at all.
 *
 * Both are invisible in review and neither shows up in a normal request. So: parse the config.
 *
 * Runs over BOTH configs. `nginx.dev.conf` was previously untested entirely, which is how it went
 * unnoticed that it carried no security headers at all — Express was the only source in the dev
 * stack, so moving header ownership to nginx would have silently left dev with none.
 * (audit NGINX-ERRORPAGE-HEADERS-1, HEADER-OWNERSHIP-1)
 */

interface NginxConfig {
  label: string;
  file: string;
  include: string;
  /** Location count below which the scan is assumed broken rather than the config clean. */
  minLocations: number;
  /** Only production maps 429 to a named location, so only it needs the error_page pairing. */
  expectsErrorPagePairing: boolean;
}

const CONFIGS: NginxConfig[] = [
  {
    label: 'production',
    file: 'docker/nginx/nginx.conf',
    include: 'include /etc/nginx/security-headers.conf;',
    minLocations: 10,
    expectsErrorPagePairing: true,
  },
  {
    label: 'development',
    file: 'docker/nginx/nginx.dev.conf',
    // A deliberately CSP-free and HSTS-free subset — Vite's HMR client uses inline scripts, eval
    // and a WebSocket, all of which the production policy would break.
    include: 'include /etc/nginx/security-headers-dev.conf;',
    minLocations: 4,
    expectsErrorPagePairing: false,
  },
];

interface Block {
  name: string;
  body: string;
}

/** Strip `#` comments — this file's own prose mentions `location`, and would match otherwise. */
function stripComments(conf: string): string {
  return conf
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n');
}

/** Every `location ... { ... }` block, with brace matching so nested blocks stay intact. */
function locationBlocks(source: string): Block[] {
  const conf = stripComments(source);
  const blocks: Block[] = [];
  const re = /location\s+([^{]+?)\s*\{/g;
  for (const m of conf.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < conf.length; i++) {
      if (conf[i] === '{') depth++;
      else if (conf[i] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    blocks.push({ name: m[1].trim(), body: conf.slice(open + 1, i) });
  }
  return blocks;
}

for (const cfg of CONFIGS) {
  const conf = fs.readFileSync(path.join(__dirname, '../../..', cfg.file), 'utf-8');
  const blocks = locationBlocks(conf);

  describe(`nginx security headers — ${cfg.label} (${cfg.file})`, () => {
    it('finds the location blocks it is meant to be guarding', () => {
      // Without this the file passes vacuously if the parse ever stops matching.
      expect(blocks.length).toBeGreaterThanOrEqual(cfg.minLocations);
    });

    it.each(blocks.map((b) => [b.name, b.body]))(
      'location %s includes the security headers',
      (_name, body) => {
        expect(body).toContain(cfg.include);
      },
    );

    it('never sets Content-Type via add_header next to a `return`, which duplicates it', () => {
      // `return` emits default_type BEFORE add_header appends, so the response carries two
      // Content-Type headers and clients use the first — a JSON body labelled octet-stream.
      for (const block of blocks) {
        if (/\breturn\s+\d{3}/.test(block.body)) {
          expect(block.body).not.toMatch(/add_header\s+Content-Type/i);
        }
      }
    });

    it('declares error_page 502 in every location that declares any other error_page', () => {
      // error_page is inherited only when the current level declares none.
      for (const block of blocks) {
        if (/error_page\s+429/.test(block.body)) {
          expect(cfg.expectsErrorPagePairing).toBe(true);
          expect(block.body).toMatch(/error_page\s+502\s+503\s+504/);
        }
      }
    });
  });
}

describe('security-headers include files', () => {
  const prodHeaders = fs.readFileSync(
    path.join(__dirname, '../../../docker/nginx/security-headers.conf'),
    'utf-8',
  );
  const devHeaders = fs.readFileSync(
    path.join(__dirname, '../../../docker/nginx/security-headers-dev.conf'),
    'utf-8',
  );
  const directives = (text: string) =>
    text
      .split('\n')
      .filter((l) => l.trim().startsWith('add_header'))
      .join('\n');

  it('production enforces Trusted Types', () => {
    expect(directives(prodHeaders)).toMatch(/require-trusted-types-for 'script'/);
    expect(directives(prodHeaders)).toMatch(/trusted-types dompurify/);
  });

  it('development sets no CSP and no HSTS, so Vite HMR survives', () => {
    // The only header class that breaks HMR is CSP; HSTS on a plain-HTTP dev host would pin the
    // browser to https and is sticky and confusing to undo.
    expect(directives(devHeaders)).not.toMatch(/Content-Security-Policy/i);
    expect(directives(devHeaders)).not.toMatch(/Strict-Transport-Security/i);
  });

  it('both set the four headers Express stopped setting', () => {
    for (const header of [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]) {
      expect(prodHeaders).toContain(`add_header ${header}`);
      expect(devHeaders).toContain(`add_header ${header}`);
    }
  });
});
