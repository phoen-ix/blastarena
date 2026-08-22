import { describe, it, expect } from '@jest/globals';
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard for socket handlers whose `await` escapes their try/catch.
 *
 * socket.io does not inspect the promise a handler returns, so a rejection there becomes an
 * unhandled rejection logged with no socket id and no user id. For a handler that takes an ack the
 * consequence is worse than a lost error: the callback is never invoked, and there is no ack
 * timeout anywhere in the frontend, so the client waits forever. `MessagesView` clears the
 * composer synchronously on send, so a DM disappeared with the connection still showing healthy.
 *
 * This test exists because commit 0ef0df3 claimed one did. Its message reads *"A scan asserts no
 * handler with an await is left unguarded"* — no such scan was ever written, the commit touched
 * only two game tests, and `dmHandlers.ts` was not even in its file list. `dm:send` had exactly
 * this defect for the entire time that claim stood. Writing the scan for real is the fix.
 *
 * The invariant: every `await` inside a `socket.on(...)` handler must be lexically inside a `try`.
 * (audit SOCKET-TRYCATCH-2)
 */

const BACKEND = path.join(__dirname, '../../../backend/src');

const SOURCES = [
  path.join(BACKEND, 'socket.ts'),
  ...fs
    .readdirSync(path.join(BACKEND, 'handlers'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(BACKEND, 'handlers', f)),
];

interface Unguarded {
  file: string;
  event: string;
  line: number;
}

/** Is `node` lexically inside the `try {}` block of a try statement at or below `stopAt`? */
function insideTryBlock(node: ts.Node, stopAt: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  let child: ts.Node = node;
  while (current && current !== stopAt) {
    // Only the try block counts — an await in the catch or finally is still unguarded.
    if (ts.isTryStatement(current) && current.tryBlock === child) return true;
    child = current;
    current = current.parent;
  }
  return false;
}

function unguardedAwaitsIn(file: string): Unguarded[] {
  const source = fs.readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Unguarded[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'on' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'socket' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const event = node.arguments[0].text;
      const handler = node.arguments[1];
      if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
        const body = handler.body;
        const findAwaits = (n: ts.Node) => {
          if (ts.isAwaitExpression(n) && !insideTryBlock(n, body)) {
            found.push({
              file: path.relative(path.join(__dirname, '../../..'), file),
              event,
              line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
            });
          }
          // Do not descend into nested socket.on registrations; they are visited on their own.
          ts.forEachChild(n, findAwaits);
        };
        ts.forEachChild(body, findAwaits);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('socket handler await guarding', () => {
  it('finds the handlers it is meant to be guarding', () => {
    // Without this the file passes vacuously if the scan stops matching — a renamed variable, a
    // moved directory, or handlers registered through a helper instead of `socket.on`.
    expect(SOURCES.length).toBeGreaterThan(4);
    const total = SOURCES.reduce((n, f) => {
      const sf = ts.createSourceFile(f, fs.readFileSync(f, 'utf-8'), ts.ScriptTarget.Latest, true);
      let count = 0;
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'on' &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'socket'
        ) {
          count++;
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return n + count;
    }, 0);
    expect(total).toBeGreaterThanOrEqual(40);
  });

  it('has no await outside a try block in any socket.on handler', () => {
    const offenders = SOURCES.flatMap(unguardedAwaitsIn);
    expect(
      offenders.map((o) => `${o.file}:${o.line} — '${o.event}' awaits before its try`).join('\n'),
    ).toBe('');
  });

  it('registers connection listeners synchronously', () => {
    // A rejection in an async connection callback skips every remaining socket.on registration,
    // including `disconnect` — leaving a connected socket that answers nothing and never cleans
    // up. Restoration work belongs in a fire-and-forget helper with its own catch.
    const source = fs.readFileSync(path.join(BACKEND, 'socket.ts'), 'utf-8');
    expect(source).toContain("io.on('connection', (socket) => {");
    expect(source).not.toContain("io.on('connection', async (socket) => {");
  });
});
