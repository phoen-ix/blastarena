import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

/**
 * Regression guard: every socket handler that takes an ack makes it safe to call first.
 *
 * Socket.io passes an ack only when the client asked for one. A handler that called
 * `callback(...)` unconditionally threw an uncaught TypeError for any client that emitted without
 * one — logged as fatal, and before the rate limiter, so it cost nothing to repeat. Each handler
 * now starts with `callback = ackOf(callback)` (or `const ack = ackOf(callback)`), so every path,
 * including the rate-limited early returns, answers through a function. (audit K1)
 */

const BACKEND = path.join(__dirname, '../../../backend/src');

const SOURCES = [
  path.join(BACKEND, 'socket.ts'),
  ...fs
    .readdirSync(path.join(BACKEND, 'handlers'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(BACKEND, 'handlers', f)),
];

const SAFE_FIRST_STATEMENT = /^(callback = ackOf\(callback\)|const ack = ackOf\(callback\));$/;

interface AckHandler {
  where: string;
  firstStatement: string;
}

function ackHandlersIn(file: string): AckHandler[] {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: AckHandler[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'on' &&
      node.expression.expression.getText(sf) === 'socket' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const handler = node.arguments[1];
      if (
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) &&
        handler.parameters.some((p) => p.name.getText(sf) === 'callback')
      ) {
        const body = handler.body;
        const first = ts.isBlock(body) ? body.statements[0] : undefined;
        found.push({
          where: `${path.basename(file)} ${node.arguments[0].text}`,
          firstStatement: first ? first.getText(sf) : '<no block body>',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('socket handler acks', () => {
  const handlers = SOURCES.flatMap(ackHandlersIn);

  it('finds the handlers that take an ack (guards the scan itself)', () => {
    expect(handlers.length).toBeGreaterThanOrEqual(33);
  });

  it('every one wraps its ack with ackOf() before anything else', () => {
    const unsafe = handlers
      .filter((h) => !SAFE_FIRST_STATEMENT.test(h.firstStatement))
      .map((h) => `${h.where}: ${h.firstStatement.split('\n')[0]}`);
    expect(unsafe).toEqual([]);
  });
});
