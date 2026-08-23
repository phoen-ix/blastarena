import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard: every Node stage in the repo must run the same major.
 *
 * Until 2026-08-23 the backend built on `node:22-alpine` while the frontend built on
 * `node:20-alpine`, and nothing anywhere recorded that this was unintended. The Dockerfile tags
 * were the only pin — no `engines`, no `.nvmrc`, no CI — so the two halves drifted apart and
 * stayed that way. All five Node stages install from the same root `package-lock.json`, so a
 * split major means one half resolves native prebuilds for an ABI the other half never sees.
 *
 * The specific failure this protects against is quiet, not loud. Neither `isolated-vm` nor
 * `bcrypt` errors when the major moves: `isolated-vm`'s install script is
 * `node-gyp-build || node-gyp rebuild`, so a missing prebuild for the new ABI falls through the
 * `||` to a source build — which cannot succeed, because the images carry no build toolchain
 * (the only `apk add` is wget). Pinning the majors together is what keeps the prebuild resolvable.
 *
 * `engines.node` alone would not have caught the 20-vs-22 drift: without `engine-strict` it is
 * only an `EBADENGINE` warning in a build log. Asserting on the config text is what actually
 * fails. Reading the files textually rather than shelling out to `docker` keeps this a normal
 * unit test — no Docker required in CI. (audit NODE-VERSION-DRIFT-1)
 */

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const EXPECTED_MAJOR = 24;

const DOCKERFILES = [
  'docker/backend/Dockerfile',
  'docker/backend/Dockerfile.dev',
  'docker/nginx/Dockerfile',
];

/** Majors from every `FROM node:<major>...` line, paired with the file they came from. */
function nodeStages(): { file: string; major: number; line: string }[] {
  return DOCKERFILES.flatMap((file) =>
    [...read(file).matchAll(/^FROM\s+node:(\d+)[^\s]*/gm)].map((m) => ({
      file,
      major: Number(m[1]),
      line: m[0],
    })),
  );
}

describe('Node version consistency', () => {
  it('finds the Node stages it is meant to be guarding', () => {
    // Guards against the scan silently matching nothing after a rename or a base-image change
    // (e.g. moving to a digest pin or a distroless base) — which would make every assertion
    // below vacuously pass.
    const stages = nodeStages();
    expect(stages.length).toBe(5);
    for (const file of DOCKERFILES) {
      expect(stages.some((s) => s.file === file)).toBe(true);
    }
  });

  it('builds every Docker stage on the same Node major', () => {
    const stages = nodeStages();
    const offenders = stages.filter((s) => s.major !== EXPECTED_MAJOR);
    expect(offenders.map((s) => `${s.file}: ${s.line} (expected node:${EXPECTED_MAJOR})`)).toEqual(
      [],
    );
  });

  it('declares the same major in the root package.json engines field', () => {
    const engines = JSON.parse(read('package.json')).engines;
    expect(engines?.node).toBeDefined();
    // Accepts ">=24", "^24", "24.x" — only the major has to line up.
    expect(Number(String(engines.node).match(/(\d+)/)?.[1])).toBe(EXPECTED_MAJOR);
  });

  it('declares the same major in .nvmrc', () => {
    expect(Number(read('.nvmrc').trim().replace(/^v/, '').split('.')[0])).toBe(EXPECTED_MAJOR);
  });

  it('targets the same major when bundling uploaded AI code', () => {
    // botai-compiler.ts compiles untrusted bot/enemy AI with esbuild. Its `target` decides which
    // syntax survives into the artifact persisted at data/ai/*/compiled.js, which is read back
    // verbatim with no recompilation — so a target above the runtime major would produce bundles
    // the runtime cannot parse.
    const compiler = read('backend/src/services/botai-compiler.ts');
    const target = compiler.match(/target:\s*'node(\d+)'/);
    expect(target).not.toBeNull();
    expect(Number(target![1])).toBe(EXPECTED_MAJOR);
  });
});
