import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockGetFriends = jest.fn<AnyFn>();
const mockGetPendingRequests = jest.fn<AnyFn>();
const mockSendFriendRequest = jest.fn<AnyFn>();
const mockAcceptFriendRequest = jest.fn<AnyFn>();
const mockDeclineFriendRequest = jest.fn<AnyFn>();
const mockCancelFriendRequest = jest.fn<AnyFn>();
const mockRemoveFriend = jest.fn<AnyFn>();
const mockBlockUser = jest.fn<AnyFn>();
const mockUnblockUser = jest.fn<AnyFn>();
const mockGetFriendIds = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/friends', () => ({
  getFriends: mockGetFriends,
  getPendingRequests: mockGetPendingRequests,
  sendFriendRequest: mockSendFriendRequest,
  acceptFriendRequest: mockAcceptFriendRequest,
  declineFriendRequest: mockDeclineFriendRequest,
  cancelFriendRequest: mockCancelFriendRequest,
  removeFriend: mockRemoveFriend,
  blockUser: mockBlockUser,
  unblockUser: mockUnblockUser,
  getFriendIds: mockGetFriendIds,
}));
const mockGetPresence = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/presence', () => ({
  getPresence: mockGetPresence,
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
  setupFriendHandlers,
  notifyFriendsOnline,
  notifyFriendsOffline,
  cleanupFriendLimiters,
} from '../../../backend/src/handlers/friendHandlers';

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

describe('friendHandlers', () => {
  let socket: ReturnType<typeof createMockSocket>;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    jest.clearAllMocks();
    socket = createMockSocket();
    io = createMockIO();
    setupFriendHandlers(socket, io);
  });

  describe('friend:list', () => {
    it('returns friends, incoming, and outgoing on success', async () => {
      const friends = [{ userId: 2, username: 'bob' }];
      const pending = {
        incoming: [{ fromUserId: 3, fromUsername: 'charlie' }],
        outgoing: [{ toUserId: 4, toUsername: 'dave' }],
      };
      mockGetFriends.mockResolvedValue(friends);
      mockGetPendingRequests.mockResolvedValue(pending);
      const callback = jest.fn();

      const handler = socket._handlers['friend:list'];
      await handler(callback);

      expect(mockGetFriends).toHaveBeenCalledWith(1);
      expect(mockGetPendingRequests).toHaveBeenCalledWith(1);
      expect(callback).toHaveBeenCalledWith({
        success: true,
        friends,
        incoming: pending.incoming,
        outgoing: pending.outgoing,
      });
    });

    it('returns error on service failure', async () => {
      mockGetFriends.mockRejectedValue(new Error('DB error'));
      const callback = jest.fn();

      const handler = socket._handlers['friend:list'];
      await handler(callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'DB error',
      });
    });
  });

  describe('friend:request', () => {
    it('sends request and emits requestReceived to target', async () => {
      mockSendFriendRequest.mockResolvedValue(42);
      const callback = jest.fn();

      const handler = socket._handlers['friend:request'];
      await handler({ username: 'bob' }, callback);

      expect(mockSendFriendRequest).toHaveBeenCalledWith(1, 'bob');
      expect(io.to).toHaveBeenCalledWith('user:42');
      expect(io._toEmit).toHaveBeenCalledWith(
        'friend:requestReceived',
        expect.objectContaining({
          id: 1,
          fromUserId: 1,
          fromUsername: 'alice',
        }),
      );
      expect(callback).toHaveBeenCalledWith({ success: true });
    });

    it('rejects empty username', async () => {
      const callback = jest.fn();

      const handler = socket._handlers['friend:request'];
      await handler({ username: '' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Username required',
      });
      expect(mockSendFriendRequest).not.toHaveBeenCalled();
    });

    it('returns error on service failure', async () => {
      mockSendFriendRequest.mockRejectedValue(new Error('User not found'));
      const callback = jest.fn();

      const handler = socket._handlers['friend:request'];
      await handler({ username: 'ghost' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'User not found',
      });
    });
  });

  describe('friend:accept', () => {
    it('accepts, sends friend:update to both users', async () => {
      mockAcceptFriendRequest.mockResolvedValue(undefined);
      mockGetFriends.mockResolvedValue([]);
      mockGetPendingRequests.mockResolvedValue({ incoming: [], outgoing: [] });
      mockGetPresence.mockResolvedValue({ status: 'lobby' });
      const callback = jest.fn();

      const handler = socket._handlers['friend:accept'];
      await handler({ fromUserId: 5 }, callback);

      expect(mockAcceptFriendRequest).toHaveBeenCalledWith(1, 5);
      // friend:update emitted to both users (userId=1 and fromUserId=5)
      const toArgs = io.to.mock.calls.map((call: any[]) => call[0]);
      expect(toArgs).toContain('user:1');
      expect(toArgs).toContain('user:5');
      expect(callback).toHaveBeenCalledWith({ success: true });
    });

    it('emits friend:online if presence exists', async () => {
      mockAcceptFriendRequest.mockResolvedValue(undefined);
      mockGetFriends.mockResolvedValue([]);
      mockGetPendingRequests.mockResolvedValue({ incoming: [], outgoing: [] });
      mockGetPresence.mockResolvedValue({ status: 'in_game' });
      const callback = jest.fn();

      const handler = socket._handlers['friend:accept'];
      await handler({ fromUserId: 5 }, callback);

      // The friend:online emit goes to user:5 (the requester)
      const emitCalls = io._toEmit.mock.calls;
      const onlineEmit = emitCalls.find((call: any[]) => call[0] === 'friend:online');
      expect(onlineEmit).toBeDefined();
      expect(onlineEmit![1]).toEqual({ userId: 1, activity: 'in_game' });
    });

    it('skips friend:online if presence is null', async () => {
      mockAcceptFriendRequest.mockResolvedValue(undefined);
      mockGetFriends.mockResolvedValue([]);
      mockGetPendingRequests.mockResolvedValue({ incoming: [], outgoing: [] });
      mockGetPresence.mockResolvedValue(null);
      const callback = jest.fn();

      const handler = socket._handlers['friend:accept'];
      await handler({ fromUserId: 5 }, callback);

      const emitCalls = io._toEmit.mock.calls;
      const onlineEmit = emitCalls.find((call: any[]) => call[0] === 'friend:online');
      expect(onlineEmit).toBeUndefined();
    });
  });

  describe('friend:decline', () => {
    it('calls declineFriendRequest and returns success', async () => {
      mockDeclineFriendRequest.mockResolvedValue(undefined);
      const callback = jest.fn();

      const handler = socket._handlers['friend:decline'];
      await handler({ fromUserId: 7 }, callback);

      expect(mockDeclineFriendRequest).toHaveBeenCalledWith(1, 7);
      expect(callback).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('friend:cancel', () => {
    it('calls cancelFriendRequest and returns success', async () => {
      mockCancelFriendRequest.mockResolvedValue(undefined);
      const callback = jest.fn();

      const handler = socket._handlers['friend:cancel'];
      await handler({ toUserId: 8 }, callback);

      expect(mockCancelFriendRequest).toHaveBeenCalledWith(1, 8);
      expect(callback).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('friend:remove', () => {
    it('removes and emits friend:removed to the other user', async () => {
      mockRemoveFriend.mockResolvedValue(undefined);
      const callback = jest.fn();

      const handler = socket._handlers['friend:remove'];
      await handler({ friendId: 9 }, callback);

      expect(mockRemoveFriend).toHaveBeenCalledWith(1, 9);
      expect(io.to).toHaveBeenCalledWith('user:9');
      expect(io._toEmit).toHaveBeenCalledWith('friend:removed', { userId: 1 });
      expect(callback).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('friend:block', () => {
    it('blocks and emits friend:removed to the blocked user', async () => {
      mockBlockUser.mockResolvedValue(undefined);
      const callback = jest.fn();

      const handler = socket._handlers['friend:block'];
      await handler({ userId: 10 }, callback);

      expect(mockBlockUser).toHaveBeenCalledWith(1, 10);
      expect(io.to).toHaveBeenCalledWith('user:10');
      expect(io._toEmit).toHaveBeenCalledWith('friend:removed', { userId: 1 });
      expect(callback).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('friend:unblock', () => {
    it('calls unblockUser and returns success', async () => {
      mockUnblockUser.mockResolvedValue(undefined);
      const callback = jest.fn();

      const handler = socket._handlers['friend:unblock'];
      await handler({ userId: 11 }, callback);

      expect(mockUnblockUser).toHaveBeenCalledWith(1, 11);
      expect(callback).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('notifyFriendsOnline', () => {
    it('emits friend:online to all friend rooms', async () => {
      mockGetFriendIds.mockResolvedValue([2, 3, 4]);

      await notifyFriendsOnline(io, 1, 'lobby');

      expect(mockGetFriendIds).toHaveBeenCalledWith(1);
      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to).toHaveBeenCalledWith('user:3');
      expect(io.to).toHaveBeenCalledWith('user:4');
      // Each call emits friend:online
      expect(io._toEmit).toHaveBeenCalledTimes(3);
      expect(io._toEmit).toHaveBeenCalledWith('friend:online', {
        userId: 1,
        activity: 'lobby',
      });
    });

    it('handles error gracefully without throwing', async () => {
      mockGetFriendIds.mockRejectedValue(new Error('Redis down'));

      await expect(notifyFriendsOnline(io, 1, 'lobby')).resolves.toBeUndefined();
    });
  });

  describe('notifyFriendsOffline', () => {
    it('emits friend:offline to all friend rooms', async () => {
      mockGetFriendIds.mockResolvedValue([2, 3]);

      await notifyFriendsOffline(io, 1);

      expect(mockGetFriendIds).toHaveBeenCalledWith(1);
      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io.to).toHaveBeenCalledWith('user:3');
      expect(io._toEmit).toHaveBeenCalledTimes(2);
      expect(io._toEmit).toHaveBeenCalledWith('friend:offline', { userId: 1 });
    });

    it('handles error gracefully without throwing', async () => {
      mockGetFriendIds.mockRejectedValue(new Error('Redis down'));

      await expect(notifyFriendsOffline(io, 1)).resolves.toBeUndefined();
    });
  });

  describe('cleanupFriendLimiters', () => {
    it('does not throw', () => {
      expect(() => cleanupFriendLimiters('socket-1')).not.toThrow();
    });
  });
});
