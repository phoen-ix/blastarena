import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * Party Lua scripts answer `'ERR:CODE'` strings and the service maps each to an AppError, the way
 * services/lobby.ts does with JOIN_ERROR_MAP.
 *
 * They used to answer `{err = '…'}` tables, which ioredis surfaces as a thrown ReplyError.
 * clientError() only forwards AppError, so "Party is full", "Already in party" and "Only the
 * party leader can kick members" all reached the client as "An unexpected error occurred" — and
 * were logged as server errors. (audit B4)
 *
 * The "already in another party" check moved from a JS GET before the eval into JOIN_PARTY_LUA,
 * so two invites accepted at the same instant can no longer both pass it. (audit B5)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockEval = jest.fn<AnyFn>();
const mockGet = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/redis', () => ({
  getRedis: () => ({ eval: mockEval, get: mockGet, set: jest.fn(), del: jest.fn() }),
}));

jest.mock('uuid', () => ({ v4: () => 'party-uuid' }));

import * as partyService from '../../../backend/src/services/party';
import { AppError } from '../../../backend/src/middleware/errorHandler';

const PARTY_JSON = JSON.stringify({
  id: 'p1',
  leaderId: 1,
  members: [{ userId: 1, username: 'alice' }],
  createdAt: '2026-01-01',
});

async function expectAppError(
  promise: Promise<unknown>,
  expected: { message: string; statusCode: number; code: string },
): Promise<void> {
  try {
    await promise;
    throw new Error('expected a rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject(expected);
  }
}

describe('party service — Lua error mapping (audit B4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createParty', () => {
    it('maps ERR:ALREADY_IN_PARTY to a 409 AppError', async () => {
      mockEval.mockResolvedValue('ERR:ALREADY_IN_PARTY');
      await expectAppError(partyService.createParty(1, 'alice'), {
        message: 'Already in a party',
        statusCode: 409,
        code: 'ALREADY_IN_PARTY',
      });
    });

    it('returns the party on OK', async () => {
      mockEval.mockResolvedValue('OK');
      const party = await partyService.createParty(1, 'alice');
      expect(party).toMatchObject({ id: 'party-uuid', leaderId: 1 });
    });

    it('never sends a Lua error table — every reply is a plain string', () => {
      // Guards the script text itself: an `{err = …}` table would bypass the mapping entirely.
      mockEval.mockResolvedValue('OK');
      return partyService.createParty(1, 'alice').then(() => {
        const script = String(mockEval.mock.calls[0][0]);
        expect(script).not.toMatch(/\{\s*err\s*=/);
        expect(script).toContain("return 'ERR:ALREADY_IN_PARTY'");
      });
    });
  });

  describe('joinParty', () => {
    const cases: Array<[string, { message: string; statusCode: number; code: string }]> = [
      [
        'ERR:PARTY_NOT_FOUND',
        { message: 'Party not found', statusCode: 404, code: 'PARTY_NOT_FOUND' },
      ],
      ['ERR:PARTY_FULL', { message: 'Party is full', statusCode: 409, code: 'PARTY_FULL' }],
      [
        'ERR:ALREADY_IN_PARTY',
        { message: 'Already in a party', statusCode: 409, code: 'ALREADY_IN_PARTY' },
      ],
      [
        'ERR:ALREADY_IN_OTHER_PARTY',
        { message: 'Already in another party', statusCode: 409, code: 'ALREADY_IN_PARTY' },
      ],
    ];

    it.each(cases)('maps %s to an AppError', async (reply, expected) => {
      mockEval.mockResolvedValue(reply);
      await expectAppError(partyService.joinParty('p1', 2, 'bob'), expected);
    });

    it('falls back to a generic 409 for an unknown ERR code', async () => {
      mockEval.mockResolvedValue('ERR:SOMETHING_NEW');
      await expectAppError(partyService.joinParty('p1', 2, 'bob'), {
        message: 'Failed to join party',
        statusCode: 409,
        code: 'PARTY_JOIN_FAILED',
      });
    });

    it('falls back to a generic 409 for a non-string reply', async () => {
      mockEval.mockResolvedValue(null);
      await expectAppError(partyService.joinParty('p1', 2, 'bob'), {
        message: 'Failed to join party',
        statusCode: 409,
        code: 'PARTY_JOIN_FAILED',
      });
    });

    it('parses the party JSON on success', async () => {
      mockEval.mockResolvedValue(PARTY_JSON);
      const party = await partyService.joinParty('p1', 2, 'bob');
      expect(party.id).toBe('p1');
    });

    // (audit B5)
    it('does the exclusivity check inside the script: no GET, and the party id is passed in', async () => {
      mockEval.mockResolvedValue(PARTY_JSON);
      await partyService.joinParty('p1', 2, 'bob');

      expect(mockGet).not.toHaveBeenCalled();
      const [script, numKeys, ...rest] = mockEval.mock.calls[0];
      expect(numKeys).toBe(2);
      expect(rest.slice(0, 2)).toEqual(['party:p1', 'player:party:2']);
      // ARGV: maxSize, userId, username, ttl, partyId
      expect(rest.slice(2)).toEqual([expect.any(Number), '2', 'bob', expect.any(Number), 'p1']);
      expect(String(script)).toContain("return 'ERR:ALREADY_IN_OTHER_PARTY'");
      expect(String(script)).toMatch(/redis\.call\('GET', playerKey\)/);
    });
  });

  describe('kickFromParty', () => {
    const cases: Array<[string, { message: string; statusCode: number; code: string }]> = [
      [
        'ERR:PARTY_NOT_FOUND',
        { message: 'Party not found', statusCode: 404, code: 'PARTY_NOT_FOUND' },
      ],
      [
        'ERR:NOT_LEADER',
        { message: 'Only the party leader can kick members', statusCode: 403, code: 'NOT_LEADER' },
      ],
      [
        'ERR:CANNOT_KICK_SELF',
        { message: 'Cannot kick yourself', statusCode: 400, code: 'CANNOT_KICK_SELF' },
      ],
      [
        'ERR:NOT_IN_PARTY',
        { message: 'User is not in the party', statusCode: 404, code: 'NOT_IN_PARTY' },
      ],
    ];

    it.each(cases)('maps %s to an AppError', async (reply, expected) => {
      mockEval.mockResolvedValue(reply);
      await expectAppError(partyService.kickFromParty('p1', 1, 2), expected);
    });

    it('falls back to a generic 409 for a non-string reply', async () => {
      mockEval.mockResolvedValue(undefined);
      await expectAppError(partyService.kickFromParty('p1', 1, 2), {
        message: 'Failed to kick member',
        statusCode: 409,
        code: 'PARTY_KICK_FAILED',
      });
    });

    it('parses the party JSON on success', async () => {
      mockEval.mockResolvedValue(PARTY_JSON);
      const party = await partyService.kickFromParty('p1', 1, 2);
      expect(party.leaderId).toBe(1);
    });
  });

  it('an ioredis ReplyError (script bug) is still NOT an AppError — it stays masked', async () => {
    // The mapping is for the codes the scripts deliberately return; a genuine script failure must
    // keep surfacing as an internal error.
    mockEval.mockRejectedValue(new Error('ERR Error running script'));
    await expect(partyService.joinParty('p1', 2, 'bob')).rejects.not.toBeInstanceOf(AppError);
  });
});
