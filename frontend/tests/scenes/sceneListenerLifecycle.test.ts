import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression guard for Phaser scene listener lifecycle.
 *
 * Two bugs in this audit came from the same place, and neither is visible on inspection:
 *
 *  - `SocketClient.off(event)` with no handler removes EVERY listener for that event, by design.
 *    GameScene used the blanket form for `sim:state` and `sim:completed`, which also removed
 *    SimulationsTab's listeners — so spectating a second batch from the admin panel silently hung.
 *  - Phaser reuses scene instances: `create()` runs again on every scene start while the
 *    constructor runs once. A listener registered in `create()` and not removed in `shutdown()`
 *    accumulates one copy per scene transition.
 *
 * So: parse every scene, and require that each socket event it subscribes to is also unsubscribed,
 * with a handler reference.
 */

const SCENES_DIR = 'src/scenes';

interface SceneFacts {
  file: string;
  on: Map<string, number>;
  offWithHandler: Set<string>;
  offBlanket: string[];
  hasShutdown: boolean;
  registersShutdown: boolean;
}

/** `this.socketClient.<method>(...)` — the calls we care about. */
function isSocketClientCall(node: ts.CallExpression, method: string): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== method) return false;
  const target = callee.expression;
  return ts.isPropertyAccessExpression(target) && target.name.text === 'socketClient';
}

function literalEvent(node: ts.Expression | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function analyse(file: string): SceneFacts {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

  const facts: SceneFacts = {
    file,
    on: new Map(),
    offWithHandler: new Set(),
    offBlanket: [],
    hasShutdown: /^\s{2}(private\s+)?shutdown\s*\(/m.test(source),
    registersShutdown: /events\.once\(\s*['"]shutdown['"]/.test(source),
  };

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (isSocketClientCall(node, 'on')) {
        const event = literalEvent(node.arguments[0]);
        if (event) facts.on.set(event, (facts.on.get(event) ?? 0) + 1);
      } else if (isSocketClientCall(node, 'off')) {
        const event = literalEvent(node.arguments[0]);
        if (event) {
          if (node.arguments.length >= 2) facts.offWithHandler.add(event);
          else facts.offBlanket.push(event);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return facts;
}

const scenes = readdirSync(SCENES_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => analyse(join(SCENES_DIR, f)));

describe('scene listener lifecycle', () => {
  it('finds the scenes (guards against the scan silently breaking)', () => {
    expect(scenes.length).toBeGreaterThanOrEqual(5);
    expect(scenes.some((s) => s.on.size > 0)).toBe(true);
  });

  it('never calls socketClient.off(event) without a handler reference', () => {
    const offenders = scenes
      .filter((s) => s.offBlanket.length > 0)
      .map((s) => `${s.file}: ${[...new Set(s.offBlanket)].sort().join(', ')}`);
    expect(
      offenders.join('\n'),
      'off(event) with no handler removes every listener for that event, including other ' +
        "modules'. Store the handler and pass it to off().",
    ).toBe('');
  });

  it('unsubscribes from every socket event it subscribes to', () => {
    const offenders: string[] = [];
    for (const scene of scenes) {
      const leaked = [...scene.on.keys()].filter((e) => !scene.offWithHandler.has(e));
      if (leaked.length) offenders.push(`${scene.file}: ${leaked.sort().join(', ')}`);
    }
    expect(
      offenders.join('\n'),
      'Phaser reuses scene instances, so a listener added in create() and not removed in ' +
        'shutdown() accumulates one copy per scene transition.',
    ).toBe('');
  });

  it('registers shutdown explicitly in any scene that defines it', () => {
    // Phaser does NOT call shutdown() for you — it has to be wired to the scene event.
    const offenders = scenes
      .filter((s) => s.hasShutdown && !s.registersShutdown)
      .map((s) => s.file);
    expect(offenders.join('\n')).toBe('');
  });
});
