import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for un-interpolated TypeScript constants inside Redis Lua scripts.
 *
 * `JOIN_ROOM_LUA` in services/lobby.ts shipped `'EX', ROOM_TTL_SECONDS` instead of
 * `'EX', ${ROOM_TTL_SECONDS}`. `ROOM_TTL_SECONDS` is a TS constant, so Redis saw an undeclared
 * Lua global and aborted the script:
 *
 *   ERR ... Script attempted to access nonexistent global variable 'ROOM_TTL_SECONDS'
 *
 * Every `room:join` therefore failed. The seven sibling scripts in the same file interpolated
 * correctly, so this was invisible on inspection, and services/lobby.test.ts mocks `redis.eval`,
 * so the script body was never executed by Redis.
 *
 * This scans the Lua source of every `*_LUA` template literal and fails on any bare SCREAMING_CASE
 * identifier — the shape a leaked TS constant always takes — outside a `${...}` expression.
 */

// The only SCREAMING_CASE globals Redis actually provides to a script.
const LUA_PROVIDED_GLOBALS = new Set(['KEYS', 'ARGV']);

const SERVICE_DIR = path.join(__dirname, '../../../backend/src/services');

function luaScriptsIn(source: string): { name: string; body: string }[] {
  const scripts: { name: string; body: string }[] = [];
  // const SOMETHING_LUA = `...`;
  const re = /const\s+(\w*LUA)\s*=\s*`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    scripts.push({ name: m[1], body: m[2] });
  }
  return scripts;
}

function bareIdentifiers(luaBody: string): string[] {
  const stripped = luaBody
    // drop interpolated expressions — those are TS, evaluated before Redis ever sees them
    .replace(/\$\{[^}]*\}/g, ' ')
    // drop Lua string literals, which legitimately contain things like 'ERR:ROOM_FULL'
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')
    // drop comments
    .replace(/--[^\n]*/g, ' ');

  const found = new Set<string>();
  for (const tok of stripped.match(/\b[A-Z][A-Z0-9_]{2,}\b/g) ?? []) {
    if (!LUA_PROVIDED_GLOBALS.has(tok)) found.add(tok);
  }
  return [...found];
}

const serviceFiles = fs
  .readdirSync(SERVICE_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(SERVICE_DIR, f))
  .filter((p) => /const\s+\w*LUA\s*=/.test(fs.readFileSync(p, 'utf-8')));

describe('Redis Lua scripts', () => {
  it('finds the Lua scripts it is meant to be guarding', () => {
    expect(serviceFiles.length).toBeGreaterThan(0);
    const total = serviceFiles.reduce(
      (n, p) => n + luaScriptsIn(fs.readFileSync(p, 'utf-8')).length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  for (const file of serviceFiles) {
    const rel = path.relative(path.join(__dirname, '../../..'), file);
    const scripts = luaScriptsIn(fs.readFileSync(file, 'utf-8'));

    for (const { name, body } of scripts) {
      it(`${rel} → ${name} has no un-interpolated constants`, () => {
        expect(bareIdentifiers(body)).toEqual([]);
      });
    }
  }
});
