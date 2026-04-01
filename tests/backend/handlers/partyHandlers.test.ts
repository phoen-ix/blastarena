import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockCreateParty = jest.fn<AnyFn>();
const mockGetParty = jest.fn<AnyFn>();
const mockJoinParty = jest.fn<AnyFn>();
const mockLeaveParty = jest.fn<AnyFn>();
const mockKickFromParty = jest.fn<AnyFn>();
const mockCreateInvite = jest.fn<AnyFn>();
const mockGetInvite = jest.fn<AnyFn>();
const mockRemoveInvite = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/party', () => ({
  createParty: mockCreateParty,
  getParty: mockGetParty,
  joinParty: mockJoinParty,
  leaveParty: mockLeaveParty,
  kickFromParty: mockKickFromParty,
  createInvite: mockCreateInvite,
  getInvite: mockGetInvite,
  removeInvite: mockRemoveInvite,
}));
const mockAreFriends = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/friends', () => ({
  areFriends: mockAreFriends,
}));
const mockGetChatMode = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/settings', () => ({
  getChatMode: mockGetChatMode,
}));
jest.mock('../../../backend/src/utils/socketRateLimit', () => ({
  createSocketRateLimiter: () => ({
    isAllowed: jest.fn().mockReturnValue(true),
    remove: jest.fn(),
  }),
}));
jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import {
  setupPartyHandlers,
  handlePartyDisconnect,
  cleanupPartyLimiters,
} from '../../../backend/src/handlers/partyHandlers';

function createMockSocket(overrides: Record<string, any> = {}) {
  const handlers: Record<string, Function> = {};
  const socket: any = {
    id: 'socket-1',
    data: {
      userId: 1,
      username: 'alice',
      role: 'user',
      activePartyId: undefined,
      activeRoomCode: undefined,
      ...overrides,
    },
    on: jest.fn((event: string, handler: Function) => {
      handlers[event] = handler;
    }),
    join: jest.fn(),
    leave: jest.fn(),
    _handlers: handlers,
  };
  return socket;
}

function createMockIO() {
  const emitFn = jest.fn<AnyFn>();
  const io: any = {
    emit: jest.fn<AnyFn>(),
    to: jest.fn<AnyFn>().mockReturnValue({ emit: emitFn }),
    in: jest.fn<AnyFn>().mockReturnValue({ fetchSockets: jest.fn<AnyFn>().mockResolvedValue([]) }),
    _toEmit: emitFn,
  };
  return io;
}

const fakeParty = {
  id: 'party-abc',
  leaderId: 1,
  members: [{ userId: 1, username: 'alice' }],
};

describe('partyHandlers', () => {
  let socket: ReturnType<typeof createMockSocket>;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetChatMode.mockResolvedValue('everyone');
    socket = createMockSocket();
    io = createMockIO();
    setupPartyHandlers(socket, io);
  });

  describe('party:create', () => {
    it('creates party, sets activePartyId, and joins socket room', async () => {
      mockCreateParty.mockResolvedValue(fakeParty);
      const callback = jest.fn();

      const handler = socket._handlers['party:create'];
      await handler(callback);

      expect(mockCreateParty).toHaveBeenCalledWith(1, 'alice');
      expect(socket.data.activePartyId).toBe('party-abc');
      expect(socket.join).toHaveBeenCalledWith('party:party-abc');
      expect(callback).toHaveBeenCalledWith({ success: true, party: fakeParty });
    });

    it('returns error on failure', async () => {
      mockCreateParty.mockRejectedValue(new Error('Redis error'));
      const callback = jest.fn();

      const handler = socket._handlers['party:create'];
      await handler(callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Redis error',
      });
    });
  });

  describe('party:invite', () => {
    it('creates invite and emits party:invite to target', async () => {
      socket.data.activePartyId = 'party-abc';
      mockGetParty.mockResolvedValue(fakeParty);
      mockAreFriends.mockResolvedValue(true);
      mockCreateInvite.mockResolvedValue('invite-123');
      const callback = jest.fn();

      const handler = socket._handlers['party:invite'];
      await handler({ userId: 2 }, callback);

      expect(mockCreateInvite).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          type: 'party',
          fromUserId: 1,
          fromUsername: 'alice',
          partyId: 'party-abc',
        }),
      );
      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io._toEmit).toHaveBeenCalledWith(
        'party:invite',
        expect.objectContaining({
          inviteId: 'invite-123',
          type: 'party',
          fromUserId: 1,
          fromUsername: 'alice',
          partyId: 'party-abc',
        }),
      );
      expect(callback).toHaveBeenCalledWith({ success: true });
    });

    it('rejects if not in a party', async () => {
      socket.data.activePartyId = undefined;
      const callback = jest.fn();

      const handler = socket._handlers['party:invite'];
      await handler({ userId: 2 }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Not in a party',
      });
    });

    it('rejects if not the leader', async () => {
      socket.data.activePartyId = 'party-abc';
      mockGetParty.mockResolvedValue({ ...fakeParty, leaderId: 99 });
      const callback = jest.fn();

      const handler = socket._handlers['party:invite'];
      await handler({ userId: 2 }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Only the leader can invite',
      });
    });

    it('rejects if not friends', async () => {
      socket.data.activePartyId = 'party-abc';
      mockGetParty.mockResolvedValue(fakeParty);
      mockAreFriends.mockResolvedValue(false);
      const callback = jest.fn();

      const handler = socket._handlers['party:invite'];
      await handler({ userId: 2 }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Can only invite friends',
      });
    });

    it('rejects if target already in party', async () => {
      socket.data.activePartyId = 'party-abc';
      mockGetParty.mockResolvedValue({
        ...fakeParty,
        members: [
          { userId: 1, username: 'alice' },
          { userId: 2, username: 'bob' },
        ],
      });
      mockAreFriends.mockResolvedValue(true);
      const callback = jest.fn();

      const handler = socket._handlers['party:invite'];
      await handler({ userId: 2 }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Already in your party',
      });
    });
  });

  describe('party:acceptInvite', () => {
    it('joins party, sets state, joins room, emits party:state', async () => {
      const updatedParty = {
        ...fakeParty,
        members: [
          { userId: 1, username: 'alice' },
          { userId: 1, username: 'alice' },
        ],
      };
      mockGetInvite.mockResolvedValue({ type: 'party', partyId: 'party-abc' });
      mockJoinParty.mockResolvedValue(updatedParty);
      mockRemoveInvite.mockResolvedValue(undefined);
      const callback = jest.fn();

      const handler = socket._handlers['party:acceptInvite'];
      await handler({ inviteId: 'inv-1' }, callback);

      expect(mockGetInvite).toHaveBeenCalledWith(1, 'inv-1');
      expect(mockJoinParty).toHaveBeenCalledWith('party-abc', 1, 'alice');
      expect(mockRemoveInvite).toHaveBeenCalledWith(1, 'inv-1');
      expect(socket.data.activePartyId).toBe(updatedParty.id);
      expect(socket.join).toHaveBeenCalledWith('party:party-abc');
      expect(io.to).toHaveBeenCalledWith('party:party-abc');
      expect(io._toEmit).toHaveBeenCalledWith('party:state', updatedParty);
      expect(callback).toHaveBeenCalledWith({ success: true, party: updatedParty });
    });

    it('rejects expired invite', async () => {
      mockGetInvite.mockResolvedValue(null);
      const callback = jest.fn();

      const handler = socket._handlers['party:acceptInvite'];
      await handler({ inviteId: 'inv-gone' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Invite expired or not found',
      });
    });
  });

  describe('party:leave', () => {
    it('leaves party, sends updated party:state to remaining', async () => {
      socket.data.activePartyId = 'party-abc';
      mockLeaveParty.mockResolvedValue('updated');
      const remainingParty = {
        id: 'party-abc',
        leaderId: 2,
        members: [{ userId: 2, username: 'bob' }],
      };
      mockGetParty.mockResolvedValue(remainingParty);
      const callback = jest.fn();

      const handler = socket._handlers['party:leave'];
      await handler(callback);

      expect(mockLeaveParty).toHaveBeenCalledWith('party-abc', 1);
      expect(socket.leave).toHaveBeenCalledWith('party:party-abc');
      expect(socket.data.activePartyId).toBeUndefined();
      expect(io.to).toHaveBeenCalledWith('party:party-abc');
      expect(io._toEmit).toHaveBeenCalledWith('party:state', remainingParty);
      expect(callback).toHaveBeenCalledWith({ success: true });
    });

    it('disbands if result==="disbanded", emits party:disbanded, cleans up sockets', async () => {
      socket.data.activePartyId = 'party-abc';
      mockLeaveParty.mockResolvedValue('disbanded');
      // Mock fetchSockets returning one remote socket
      const remoteSock = {
        data: { activePartyId: 'party-abc', userId: 2 },
        leave: jest.fn(),
      };
      io.in = jest.fn<AnyFn>().mockReturnValue({
        fetchSockets: jest.fn<AnyFn>().mockResolvedValue([remoteSock]),
      });
      const callback = jest.fn();

      const handler = socket._handlers['party:leave'];
      await handler(callback);

      expect(io.to).toHaveBeenCalledWith('party:party-abc');
      expect(io._toEmit).toHaveBeenCalledWith('party:disbanded');
      expect(remoteSock.data.activePartyId).toBeUndefined();
      expect(remoteSock.leave).toHaveBeenCalledWith('party:party-abc');
      expect(callback).toHaveBeenCalledWith({ success: true });
    });

    it('rejects if not in a party', async () => {
      socket.data.activePartyId = undefined;
      const callback = jest.fn();

      const handler = socket._handlers['party:leave'];
      await handler(callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Not in a party',
      });
    });
  });

  describe('party:kick', () => {
    it('kicks member, emits party:disbanded to kicked user, emits party:state', async () => {
      socket.data.activePartyId = 'party-abc';
      const updatedParty = {
        id: 'party-abc',
        leaderId: 1,
        members: [{ userId: 1, username: 'alice' }],
      };
      mockKickFromParty.mockResolvedValue(updatedParty);
      // Mock fetchSockets with kicked user's socket
      const kickedSock = {
        data: { activePartyId: 'party-abc', userId: 2 },
        leave: jest.fn(),
      };
      io.in = jest.fn<AnyFn>().mockReturnValue({
        fetchSockets: jest.fn<AnyFn>().mockResolvedValue([kickedSock]),
      });
      const callback = jest.fn();

      const handler = socket._handlers['party:kick'];
      await handler({ userId: 2 }, callback);

      expect(mockKickFromParty).toHaveBeenCalledWith('party-abc', 1, 2);
      // party:disbanded to kicked user's personal room
      expect(io.to).toHaveBeenCalledWith('user:2');
      // Kicked socket cleaned up
      expect(kickedSock.data.activePartyId).toBeUndefined();
      expect(kickedSock.leave).toHaveBeenCalledWith('party:party-abc');
      // Updated state to party room
      expect(io.to).toHaveBeenCalledWith('party:party-abc');
      expect(callback).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('party:chat', () => {
    it('broadcasts to party room with correct shape', async () => {
      socket.data.activePartyId = 'party-abc';

      const handler = socket._handlers['party:chat'];
      await handler({ message: 'hello team' });

      expect(io.to).toHaveBeenCalledWith('party:party-abc');
      expect(io._toEmit).toHaveBeenCalledWith(
        'party:chat',
        expect.objectContaining({
          fromUserId: 1,
          fromUsername: 'alice',
          message: 'hello team',
        }),
      );
      const payload = io._toEmit.mock.calls[0][1];
      expect(typeof payload.timestamp).toBe('number');
    });

    it('drops when chat mode is disabled', async () => {
      socket.data.activePartyId = 'party-abc';
      mockGetChatMode.mockResolvedValue('disabled');

      const handler = socket._handlers['party:chat'];
      await handler({ message: 'hello' });

      expect(io._toEmit).not.toHaveBeenCalled();
    });

    it('drops empty message', async () => {
      socket.data.activePartyId = 'party-abc';

      const handler = socket._handlers['party:chat'];
      await handler({ message: '   ' });

      expect(io._toEmit).not.toHaveBeenCalled();
    });
  });

  describe('invite:room', () => {
    it('creates room invite and emits invite:room to target', async () => {
      socket.data.activeRoomCode = 'ROOM-X';
      mockAreFriends.mockResolvedValue(true);
      mockCreateInvite.mockResolvedValue('rinv-1');
      const callback = jest.fn();

      const handler = socket._handlers['invite:room'];
      await handler({ userId: 3 }, callback);

      expect(mockCreateInvite).toHaveBeenCalledWith(
        3,
        expect.objectContaining({
          type: 'room',
          fromUserId: 1,
          fromUsername: 'alice',
          roomCode: 'ROOM-X',
        }),
      );
      expect(io.to).toHaveBeenCalledWith('user:3');
      expect(io._toEmit).toHaveBeenCalledWith(
        'invite:room',
        expect.objectContaining({
          inviteId: 'rinv-1',
          type: 'room',
          fromUserId: 1,
          fromUsername: 'alice',
          roomCode: 'ROOM-X',
        }),
      );
      expect(callback).toHaveBeenCalledWith({ success: true });
    });

    it('rejects if not in a room', async () => {
      socket.data.activeRoomCode = undefined;
      const callback = jest.fn();

      const handler = socket._handlers['invite:room'];
      await handler({ userId: 3 }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Not in a room',
      });
    });

    it('rejects if not friends', async () => {
      socket.data.activeRoomCode = 'ROOM-X';
      mockAreFriends.mockResolvedValue(false);
      const callback = jest.fn();

      const handler = socket._handlers['invite:room'];
      await handler({ userId: 3 }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Can only invite friends',
      });
    });
  });

  describe('invite:acceptRoom', () => {
    it('removes invite and callbacks success', async () => {
      mockGetInvite.mockResolvedValue({ type: 'room', roomCode: 'ROOM-X' });
      mockRemoveInvite.mockResolvedValue(undefined);
      const callback = jest.fn();

      const handler = socket._handlers['invite:acceptRoom'];
      await handler({ inviteId: 'rinv-1' }, callback);

      expect(mockGetInvite).toHaveBeenCalledWith(1, 'rinv-1');
      expect(mockRemoveInvite).toHaveBeenCalledWith(1, 'rinv-1');
      expect(callback).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('handlePartyDisconnect', () => {
    it('leaves party and broadcasts state or disbands', async () => {
      const disconnectSocket = createMockSocket({ activePartyId: 'party-abc' });
      mockLeaveParty.mockResolvedValue('updated');
      const remainingParty = {
        id: 'party-abc',
        leaderId: 2,
        members: [{ userId: 2, username: 'bob' }],
      };
      mockGetParty.mockResolvedValue(remainingParty);

      await handlePartyDisconnect(disconnectSocket, io);

      expect(mockLeaveParty).toHaveBeenCalledWith('party-abc', 1);
      expect(io.to).toHaveBeenCalledWith('party:party-abc');
      expect(io._toEmit).toHaveBeenCalledWith('party:state', remainingParty);
    });
  });

  describe('cleanupPartyLimiters', () => {
    it('does not throw', () => {
      expect(() => cleanupPartyLimiters('socket-1')).not.toThrow();
    });
  });
});
