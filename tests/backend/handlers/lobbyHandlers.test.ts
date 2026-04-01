import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockGetLobbyChatMode = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/settings', () => ({
  getLobbyChatMode: mockGetLobbyChatMode,
}));
jest.mock('../../../backend/src/utils/socketRateLimit', () => ({
  createSocketRateLimiter: () => ({
    isAllowed: jest.fn().mockReturnValue(true),
    remove: jest.fn(),
  }),
}));

import {
  setupLobbyHandlers,
  cleanupLobbyLimiters,
} from '../../../backend/src/handlers/lobbyHandlers';
import { LOBBY_CHAT_MAX_LENGTH } from '@blast-arena/shared';

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

describe('lobbyHandlers', () => {
  let socket: ReturnType<typeof createMockSocket>;
  let io: ReturnType<typeof createMockIO>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLobbyChatMode.mockResolvedValue('everyone');
    socket = createMockSocket();
    io = createMockIO();
    setupLobbyHandlers(socket, io);
  });

  describe('lobby:chat', () => {
    it('broadcasts with correct shape when chat is allowed', async () => {
      const handler = socket._handlers['lobby:chat'];
      await handler({ message: 'hello world' });

      expect(io.emit).toHaveBeenCalledWith(
        'lobby:chat',
        expect.objectContaining({
          fromUserId: 1,
          fromUsername: 'alice',
          message: 'hello world',
          role: 'user',
        }),
      );
      // timestamp should be a number
      const payload = io.emit.mock.calls[0][1];
      expect(typeof payload.timestamp).toBe('number');
    });

    it('silently drops when chat mode is disabled', async () => {
      mockGetLobbyChatMode.mockResolvedValue('disabled');

      const handler = socket._handlers['lobby:chat'];
      await handler({ message: 'hello' });

      expect(io.emit).not.toHaveBeenCalled();
    });

    it('drops when mode=admin_only and role=user', async () => {
      mockGetLobbyChatMode.mockResolvedValue('admin_only');

      const handler = socket._handlers['lobby:chat'];
      await handler({ message: 'hello' });

      expect(io.emit).not.toHaveBeenCalled();
    });

    it('drops when mode=staff and role=user', async () => {
      mockGetLobbyChatMode.mockResolvedValue('staff');

      const handler = socket._handlers['lobby:chat'];
      await handler({ message: 'hello' });

      expect(io.emit).not.toHaveBeenCalled();
    });

    it('allows admin when mode=admin_only', async () => {
      mockGetLobbyChatMode.mockResolvedValue('admin_only');
      socket = createMockSocket({ role: 'admin' });
      io = createMockIO();
      setupLobbyHandlers(socket, io);

      const handler = socket._handlers['lobby:chat'];
      await handler({ message: 'admin msg' });

      expect(io.emit).toHaveBeenCalledWith(
        'lobby:chat',
        expect.objectContaining({ message: 'admin msg', role: 'admin' }),
      );
    });

    it('allows moderator when mode=staff', async () => {
      mockGetLobbyChatMode.mockResolvedValue('staff');
      socket = createMockSocket({ role: 'moderator' });
      io = createMockIO();
      setupLobbyHandlers(socket, io);

      const handler = socket._handlers['lobby:chat'];
      await handler({ message: 'mod msg' });

      expect(io.emit).toHaveBeenCalledWith(
        'lobby:chat',
        expect.objectContaining({ message: 'mod msg', role: 'moderator' }),
      );
    });

    it('truncates message to LOBBY_CHAT_MAX_LENGTH', async () => {
      const longMessage = 'x'.repeat(LOBBY_CHAT_MAX_LENGTH + 100);

      const handler = socket._handlers['lobby:chat'];
      await handler({ message: longMessage });

      const payload = io.emit.mock.calls[0][1];
      expect(payload.message).toHaveLength(LOBBY_CHAT_MAX_LENGTH);
    });

    it('drops empty message after trim', async () => {
      const handler = socket._handlers['lobby:chat'];
      await handler({ message: '   ' });

      expect(io.emit).not.toHaveBeenCalled();
    });

    it('drops non-string message', async () => {
      const handler = socket._handlers['lobby:chat'];
      await handler({ message: 123 });

      expect(io.emit).not.toHaveBeenCalled();
    });
  });

  describe('cleanupLobbyLimiters', () => {
    it('does not throw', () => {
      expect(() => cleanupLobbyLimiters('socket-1')).not.toThrow();
    });
  });
});
