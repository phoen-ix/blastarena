import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { ADMIN_AUDIT_ACTIONS } from '@blast-arena/shared';

/**
 * Source scan: the actions `logAdminAction()` is called with, against ADMIN_AUDIT_ACTIONS (the
 * list the Logs tab builds its filter from). The filter used to be a hand-typed list of 7 of the
 * 42 audited actions; the type on `logAdminAction` keeps new actions out of the code until they
 * are listed, and this keeps the list free of actions nothing writes any more.
 */
const SRC = path.join(__dirname, '../../../backend/src');

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? tsFiles(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

/** The string literals an action argument can evaluate to; null for anything else. */
function literals(node: ts.Expression): string[] | null {
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) {
    const a = literals(node.whenTrue);
    const b = literals(node.whenFalse);
    return a && b ? [...a, ...b] : null;
  }
  return null;
}

const written: string[] = [];
const dynamic: string[] = [];
/** Staff socket events (`admin:*`, `sim:*`): event -> does the handler call logAdminAction? */
const staffSocketEvents = new Map<string, boolean>();
for (const file of tsFiles(SRC)) {
  const sf = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf-8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'on' &&
      node.expression.expression.getText(sf) === 'socket' &&
      ts.isStringLiteral(node.arguments[0]) &&
      /^(admin|sim):/.test(node.arguments[0].text) &&
      node.arguments[1]
    ) {
      const body = node.arguments[1].getText(sf);
      staffSocketEvents.set(node.arguments[0].text, body.includes('logAdminAction('));
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'logAdminAction'
    ) {
      const found = literals(node.arguments[1]);
      if (found) written.push(...found);
      else dynamic.push(`${path.relative(SRC, file)}: ${node.arguments[1].getText(sf)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

describe('audited admin actions', () => {
  it('finds the call sites (non-vacuous)', () => {
    expect(written.length).toBeGreaterThan(50);
  });

  it('every call passes a literal action, so the scan sees them all', () => {
    expect(dynamic).toEqual([]);
  });

  it('every written action is listed in ADMIN_AUDIT_ACTIONS', () => {
    const listed = new Set<string>(ADMIN_AUDIT_ACTIONS);
    expect(written.filter((a) => !listed.has(a))).toEqual([]);
  });

  it('every listed action is written somewhere (no dead filter options)', () => {
    const used = new Set(written);
    expect(ADMIN_AUDIT_ACTIONS.filter((a) => !used.has(a))).toEqual([]);
  });

  it('every staff socket event that changes something writes an audit entry', () => {
    // Read-only: they only join or leave a socket room to watch.
    const readOnly = new Set([
      'admin:spectate',
      'admin:unspectate',
      'sim:spectate',
      'sim:unspectate',
    ]);
    expect(staffSocketEvents.size).toBeGreaterThan(readOnly.size);
    const unlogged = [...staffSocketEvents]
      .filter(([event, logs]) => !logs && !readOnly.has(event))
      .map(([event]) => event);
    expect(unlogged).toEqual([]);
  });

  it('lists each action once', () => {
    expect(new Set(ADMIN_AUDIT_ACTIONS).size).toBe(ADMIN_AUDIT_ACTIONS.length);
  });
});
