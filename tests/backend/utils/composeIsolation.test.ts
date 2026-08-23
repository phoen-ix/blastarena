import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard: the dev stack must never be able to take over production.
 *
 * Until 2026-08-23 `docker-compose.dev.yml` shared everything with production — the same Compose
 * project name, the same explicit `container_name` on every service, and the same `./data` bind
 * mounts. Running the documented dev command on the production host would not have failed with a
 * port clash: Compose would have *adopted* the running production containers, stopped them, and
 * started dev ones in their place, with the dev backend writing to the live MariaDB data directory
 * in NODE_ENV=development. Silent and complete.
 *
 * Three separate things now keep them apart, and each is checked here because each can be undone
 * independently by an innocent-looking edit:
 *   - the documented command passes `-p blast-arena-dev` (this is the one that actually binds;
 *     .env's COMPOSE_PROJECT_NAME outranks the `name:` field in the file)
 *   - no `container_name` is shared
 *   - no host port and no bind-mount source is shared
 *
 * Reading the YAML textually rather than shelling out to `docker compose config` keeps this a
 * normal unit test — no Docker required in CI. (audit DEV-STACK-ISOLATION-1)
 */

const ROOT = path.join(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const prod = read('docker-compose.yml');
const dev = read('docker-compose.dev.yml');

/** Values of every `container_name:` line, with ${VAR:-default} resolved to its default. */
function containerNames(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*container_name:\s*(.+)$/gm)]
    .map((m) => m[1].trim())
    .map((v) => v.replace(/\$\{[^:}]+:-([^}]*)\}/g, '$1'));
}

/** Host ports from `"127.0.0.1:PORT:CONTAINER"` entries, ${VAR:-default} resolved. */
function hostPorts(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*-\s*"([^"]*:\d+:\d+)"/gm)]
    .map((m) => m[1].replace(/\$\{[^:}]+:-([^}]*)\}/g, '$1'))
    .map((v) => v.split(':').slice(0, -1).join(':')); // drop the container port
}

/** Host-side sources of bind mounts that point into the repo's data directories. */
function dataMounts(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*-\s*(\.\/data[^:]*):/gm)].map((m) => m[1]);
}

describe('dev stack isolation from production', () => {
  it('finds the compose files it is meant to be guarding', () => {
    // Guards against the scan silently matching nothing after a reformat or rename.
    expect(containerNames(prod).length).toBeGreaterThanOrEqual(4);
    expect(containerNames(dev).length).toBeGreaterThanOrEqual(4);
    expect(dataMounts(prod).length).toBeGreaterThanOrEqual(5);
  });

  it('shares no container name with production', () => {
    const shared = containerNames(dev).filter((n) => containerNames(prod).includes(n));
    expect(shared).toEqual([]);
  });

  it('gives every dev container a dev-prefixed name', () => {
    for (const name of containerNames(dev)) {
      expect(name).toMatch(/^blast-arena-dev-/);
    }
  });

  it('publishes no host port that production also publishes', () => {
    const shared = hostPorts(dev).filter((p) => hostPorts(prod).includes(p));
    expect(shared).toEqual([]);
  });

  it('never mounts a production data directory', () => {
    // The severe half of the original defect: dev writing to the live MariaDB and Redis data.
    const leaks = dataMounts(dev).filter((m) => !m.startsWith('./data-dev'));
    expect(leaks).toEqual([]);
  });

  it('overrides ports and volumes rather than appending to them', () => {
    // Compose merges sequences by APPENDING. Without `!override` the dev stack would publish
    // production's 8280 as well as its own, and mount both ./data and ./data-dev onto the same
    // container paths — so the isolation above would be silently undone at merge time.
    for (const block of ['ports', 'volumes']) {
      const plain = new RegExp(`^\\s*${block}:\\s*$`, 'gm');
      expect(dev.match(plain)).toBeNull();
      expect(dev).toMatch(new RegExp(`^\\s*${block}: !override\\s*$`, 'm'));
    }
  });

  it('declares its own project name as defence in depth', () => {
    expect(dev).toMatch(/^name:\s*blast-arena-dev\s*$/m);
  });

  it('documents the dev command with -p everywhere it appears', () => {
    // `name:` above is NOT sufficient on its own — .env sets COMPOSE_PROJECT_NAME=blast-arena,
    // which outranks it. Only `-p` reliably wins, so every documented invocation must carry it.
    for (const file of ['package.json', 'README.md', 'CLAUDE.md', 'docs/infrastructure.md']) {
      const text = read(file);
      for (const line of text.split('\n')) {
        // Only actual invocations — the README also lists the file in a directory tree.
        if (line.includes('docker-compose.dev.yml') && line.includes('docker compose')) {
          expect(`${file}: ${line.trim()}`).toContain('-p blast-arena-dev');
        }
      }
    }
  });
});
