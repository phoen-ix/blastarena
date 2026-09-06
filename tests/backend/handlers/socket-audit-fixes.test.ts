import { describe, it, expect } from '@jest/globals';
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

/**
 * Source-level guards for the socket.ts audit fixes. socket.ts wires a live Socket.io server and
 * is not unit-testable in isolation, so — like socket-await-guard.test.ts — this reads the handler
 * bodies out of the AST and pins the properties each fix established:
 *
 *  - A12  admin:kick removes the player immediately (handlePlayerLeave), not with reconnect grace
 *  - A13  campaign:levelComplete is emitted per real user on `user:<id>` with that user's stars
 *  - B2   openworld:join sanitises the guest username before handleJoin
 *  - B6   sim:start attaches no per-socket runner listeners; the cleanup interval reaps runners
 *  - B16  lobby:subscribe/unsubscribe, admin:spectate, admin:roomMessage are rate limited and
 *         admin:spectate validates the room code
 *  - E10  campaignStartLimiter is module-scoped and removed on disconnect; no dynamic import()
 *         inside handlers; no redundant checkCampaignStarUnlocks call
 *  - G7   no spectator:actionApplied broadcast
 */

const SOCKET_TS = path.join(__dirname, '../../../backend/src/socket.ts');
const sf = ts.createSourceFile(
  SOCKET_TS,
  fs.readFileSync(SOCKET_TS, 'utf-8'),
  ts.ScriptTarget.Latest,
  true,
);
// Comments are stripped so the audit notes in socket.ts (which name the old code) cannot
// satisfy or defeat a `toContain` here.
const printer = ts.createPrinter({ removeComments: true });
const source = printer.printFile(sf);

/** Source text (comments stripped) of the handler passed to `socket.on('<event>', …)`. */
function handlerSource(event: string): string {
  let found: string | null = null;
  const visit = (node: ts.Node) => {
    if (
      found === null &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'on' &&
      node.expression.expression.getText() === 'socket' &&
      node.arguments.length >= 2 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === event
    ) {
      found = printer.printNode(ts.EmitHint.Unspecified, node.arguments[1], sf);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (found === null) throw new Error(`no socket.on('${event}') handler in socket.ts`);
  return found;
}

/** Names of `const` declarations at the top level of the module. */
function topLevelConsts(): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
    }
  }
  return names;
}

describe('socket.ts audit fixes', () => {
  it('A12: admin:kick kills the player immediately instead of starting the reconnect grace', () => {
    const kick = handlerSource('admin:kick');
    expect(kick).toContain('handlePlayerLeave(');
    expect(kick).not.toContain('handlePlayerDisconnect(');
  });

  it('A13: campaign:levelComplete goes to each real user with their own stars', () => {
    const start = handlerSource('campaign:start');
    // Emitted inside a loop over the per-user map, on the user room…
    expect(start).toMatch(
      /for \(const \[uid, stars\] of starsByUser\)\s*\{\s*io\.to\(`user:\$\{uid\}`\)\.emit\(['"]campaign:levelComplete['"]/,
    );
    // …and never as one campaign-room broadcast carrying a shared `stars` variable.
    expect(start).not.toMatch(/emitToCampaign\(['"]campaign:levelComplete['"],\s*\{[^}]*\bstars,/);
    // Stars are recorded per user, not overwritten in a loop.
    expect(start).not.toMatch(/let stars = 0;\s*for \(const uid of userIds\)/);
  });

  it('B2: openworld:join sanitises the guest username before it reaches the manager', () => {
    const join = handlerSource('openworld:join');
    expect(join).toContain('sanitizeGuestUsername(_data?.username)');
    expect(join).not.toContain("_data?.username || ''");
  });

  it('B6: sim:start attaches no per-socket runner listeners', () => {
    const simStart = handlerSource('sim:start');
    expect(simStart).not.toContain('runner.on(');
    expect(simStart).not.toMatch(/socket\.emit\(['"]sim:(progress|gameResult|completed)['"]/);
  });

  it('B6: the periodic cleanup interval also reaps finished simulation runners', () => {
    expect(source).toMatch(
      /setInterval\(\(\) => \{\s*roomManager\.cleanup\(\);\s*getSimulationManager\(\)\.cleanup\(\);\s*\},\s*ROOM_CLEANUP_INTERVAL_MS\)/,
    );
  });

  it('B16: lobby:subscribe / lobby:unsubscribe are rate limited', () => {
    expect(handlerSource('lobby:subscribe')).toContain(
      'lobbySubscribeLimiter.isAllowed(socket.id)',
    );
    expect(handlerSource('lobby:unsubscribe')).toContain(
      'lobbySubscribeLimiter.isAllowed(socket.id)',
    );
  });

  it('B16: admin:spectate is rate limited and validates the room code before socket.join', () => {
    const spectate = handlerSource('admin:spectate');
    expect(spectate).toContain('adminRoomLimiter.isAllowed(socket.id)');
    expect(spectate).toContain('validateSocket(adminSpectateSchema, data, callback)');
    expect(spectate).not.toContain('socket.join(`room:${data.roomCode}`)');
    expect(spectate.indexOf('validateSocket(')).toBeLessThan(spectate.indexOf('socket.join('));
  });

  it('B16: admin:roomMessage is rate limited', () => {
    expect(handlerSource('admin:roomMessage')).toContain('adminRoomLimiter.isAllowed(socket.id)');
  });

  it('B16/E10: every per-socket limiter entry is removed on disconnect', () => {
    const disconnect = handlerSource('disconnect');
    for (const limiter of [
      'campaignStartLimiter',
      'lobbySubscribeLimiter',
      'adminRoomLimiter',
      'spectatorChatLimiter',
      'spectatorActionLimiter',
    ]) {
      expect(disconnect).toContain(`${limiter}.remove(socket.id)`);
    }
  });

  it('E10: campaignStartLimiter is module-scoped, like the other limiters', () => {
    const consts = topLevelConsts();
    expect(consts).toContain('campaignStartLimiter');
    expect(consts).toContain('lobbySubscribeLimiter');
    expect(consts).toContain('adminRoomLimiter');
    // Not re-created per connection.
    expect(source.match(/createSocketRateLimiter\(/g)?.length).toBe(
      [...consts].filter((c) => c.endsWith('Limiter')).length,
    );
  });

  it('E10: no dynamic import() inside the campaign:start handler; services resolved once up front', () => {
    const start = handlerSource('campaign:start');
    expect(start).not.toContain('await import(');
    expect(start).toMatch(/Promise\.all\(\[\s*import\(['"]\.\/services\/campaign['"]\)/);
    // getBuddySettings fetched at most once per start.
    expect(start.match(/getBuddySettings\(/g)?.length).toBe(1);
  });

  it('E10: evaluateAfterCampaign is called with two arguments and no duplicate star check', () => {
    const start = handlerSource('campaign:start');
    expect(start).not.toContain('checkCampaignStarUnlocks(');
    expect(start).toMatch(/evaluateAfterCampaign\(\s*uid,\s*totalStars,?\s*\)/);
  });

  it('G7: no spectator:actionApplied broadcast', () => {
    expect(source).not.toContain('spectator:actionApplied');
  });

  it('B17: the campaign cosmetics catch logs instead of swallowing', () => {
    const start = handlerSource('campaign:start');
    expect(start).not.toMatch(/catch\s*\{\s*\}/);
    expect(start).toMatch(/['"]Failed to load campaign cosmetics['"]/);
  });
});
