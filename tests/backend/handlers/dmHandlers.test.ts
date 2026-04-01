import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockGetDMMode = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/settings', () => ({
  getDMMode: mockGetDMMode,
}));
const mockSendMessage = jest.fn<AnyFn>();
const mockMarkRead = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/messages', () => ({
  sendMessage: mockSendMessage,
  markRead: mockMarkRead,
}));
jest.mock('../../../backend/src/utils/socketRateLimit', () => ({
  createSocketRateLimiter: () => ({
    isAllowed: jest.fn().mockReturnValue(true),
    remove: jest.fn(),
  }),
}));

import { setupDMHandlers, cleanupDMLimiters } from '../../../backend/src/handlers/dmHandlers';

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

describe('dmHandlers', () => {
  let socket: ReturnType<typeof createMockSocket>;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDMMode.mockResolvedValue('everyone');
    socket = createMockSocket();
    io = createMockIO();
    setupDMHandlers(socket, io);
  });

  describe('dm:send', () => {
    const fakeMsg = { id: 10, fromUserId: 1, toUserId: 2, message: 'hi', createdAt: 'now' };

    it('calls sendMessage and callbacks success with message', async () => {
      mockSendMessage.mockResolvedValue(fakeMsg);
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 'hi' }, callback);

      expect(mockSendMessage).toHaveBeenCalledWith(1, 2, 'hi');
      expect(callback).toHaveBeenCalledWith({ success: true, message: fakeMsg });
    });

    it('emits dm:receive to recipient user room', async () => {
      mockSendMessage.mockResolvedValue(fakeMsg);
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 'hi' }, callback);

      expect(io.to).toHaveBeenCalledWith('user:2');
      expect(io._toEmit).toHaveBeenCalledWith('dm:receive', fakeMsg);
    });

    it('returns error when DM mode is disabled', async () => {
      mockGetDMMode.mockResolvedValue('disabled');
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 'hi' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Direct messages are disabled',
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns error when mode=admin_only and role=user', async () => {
      mockGetDMMode.mockResolvedValue('admin_only');
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 'hi' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Direct messages are restricted',
      });
    });

    it('returns error when mode=staff and role=user', async () => {
      mockGetDMMode.mockResolvedValue('staff');
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 'hi' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Direct messages are restricted',
      });
    });

    it('allows admin when mode=admin_only', async () => {
      mockGetDMMode.mockResolvedValue('admin_only');
      mockSendMessage.mockResolvedValue(fakeMsg);
      socket = createMockSocket({ role: 'admin' });
      io = createMockIO();
      setupDMHandlers(socket, io);
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 'hi' }, callback);

      expect(callback).toHaveBeenCalledWith({ success: true, message: fakeMsg });
    });

    it('returns error for empty message after trim', async () => {
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: '   ' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Message cannot be empty',
      });
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns error for non-string message', async () => {
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 123 }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'Message cannot be empty',
      });
    });

    it('returns error from service exception', async () => {
      mockSendMessage.mockRejectedValue(new Error('DB is down'));
      const callback = jest.fn();

      const handler = socket._handlers['dm:send'];
      await handler({ toUserId: 2, message: 'hi' }, callback);

      expect(callback).toHaveBeenCalledWith({
        success: false,
        error: 'DB is down',
      });
    });
  });

  describe('dm:read', () => {
    it('calls markRead and emits dm:read to sender', async () => {
      mockMarkRead.mockResolvedValue(undefined);

      const handler = socket._handlers['dm:read'];
      await handler({ fromUserId: 5 });

      expect(mockMarkRead).toHaveBeenCalledWith(1, 5);
      expect(io.to).toHaveBeenCalledWith('user:5');
      expect(io._toEmit).toHaveBeenCalledWith(
        'dm:read',
        expect.objectContaining({
          fromUserId: 1,
        }),
      );
      // readAt should be an ISO string
      const payload = io._toEmit.mock.calls[0][1];
      expect(typeof payload.readAt).toBe('string');
    });

    it('silently catches errors without throwing', async () => {
      mockMarkRead.mockRejectedValue(new Error('fail'));

      const handler = socket._handlers['dm:read'];
      // Should not throw
      await expect(handler({ fromUserId: 5 })).resolves.toBeUndefined();
    });
  });

  describe('cleanupDMLimiters', () => {
    it('does not throw', () => {
      expect(() => cleanupDMLimiters('socket-1')).not.toThrow();
    });
  });
});
