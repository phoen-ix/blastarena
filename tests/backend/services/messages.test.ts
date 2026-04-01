import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

const mockAreFriends = jest.fn<AnyFn>();
const mockIsBlocked = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/friends', () => ({
  areFriends: mockAreFriends,
  isBlocked: mockIsBlocked,
}));

import * as messageService from '../../../backend/src/services/messages';

function makeDmRow(
  overrides: Partial<{
    id: number;
    sender_id: number;
    recipient_id: number;
    message: string;
    read_at: Date | null;
    created_at: Date;
    sender_username: string;
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    sender_id: overrides.sender_id ?? 10,
    recipient_id: overrides.recipient_id ?? 20,
    message: overrides.message ?? 'Hello there',
    read_at:
      overrides.read_at !== undefined ? overrides.read_at : new Date('2026-03-15T12:00:00.000Z'),
    created_at: overrides.created_at ?? new Date('2026-03-15T10:00:00.000Z'),
    sender_username: overrides.sender_username ?? 'alice',
  };
}

describe('Messages Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendMessage', () => {
    it('should throw when senderId equals recipientId', async () => {
      await expect(messageService.sendMessage(5, 5, 'hi')).rejects.toThrow(
        'Cannot message yourself',
      );
      expect(mockAreFriends).not.toHaveBeenCalled();
    });

    it('should throw when users are not friends', async () => {
      mockAreFriends.mockResolvedValue(false);

      await expect(messageService.sendMessage(1, 2, 'hi')).rejects.toThrow(
        'Can only message friends',
      );
      expect(mockAreFriends).toHaveBeenCalledWith(1, 2);
      expect(mockIsBlocked).not.toHaveBeenCalled();
    });

    it('should throw when sender or recipient is blocked', async () => {
      mockAreFriends.mockResolvedValue(true);
      mockIsBlocked.mockResolvedValue(true);

      await expect(messageService.sendMessage(1, 2, 'hi')).rejects.toThrow(
        'Cannot message this user',
      );
      expect(mockIsBlocked).toHaveBeenCalledWith(1, 2);
    });

    it('should throw when message is empty after trimming', async () => {
      mockAreFriends.mockResolvedValue(true);
      mockIsBlocked.mockResolvedValue(false);

      await expect(messageService.sendMessage(1, 2, '   ')).rejects.toThrow(
        'Message cannot be empty',
      );
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it('should throw when message is only whitespace and newlines', async () => {
      mockAreFriends.mockResolvedValue(true);
      mockIsBlocked.mockResolvedValue(false);

      await expect(messageService.sendMessage(1, 2, ' \n\t ')).rejects.toThrow(
        'Message cannot be empty',
      );
    });

    it('should truncate message to DM_MAX_LENGTH (500)', async () => {
      mockAreFriends.mockResolvedValue(true);
      mockIsBlocked.mockResolvedValue(false);

      const longMessage = 'A'.repeat(600);
      const row = makeDmRow({ message: 'A'.repeat(500) });

      mockExecute.mockResolvedValue({ insertId: 99, affectedRows: 1 });
      mockQuery.mockResolvedValue([row]);

      await messageService.sendMessage(1, 2, longMessage);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO direct_messages'),
        [1, 2, 'A'.repeat(500)],
      );
    });

    it('should insert with correct parameters', async () => {
      mockAreFriends.mockResolvedValue(true);
      mockIsBlocked.mockResolvedValue(false);

      const row = makeDmRow({ id: 42, sender_id: 1, recipient_id: 2, message: 'hello' });
      mockExecute.mockResolvedValue({ insertId: 42, affectedRows: 1 });
      mockQuery.mockResolvedValue([row]);

      await messageService.sendMessage(1, 2, '  hello  ');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO direct_messages'),
        [1, 2, 'hello'],
      );
      // Should fetch the inserted row by insertId
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE dm.id = ?'), [42]);
    });

    it('should return formatted DirectMessage with correct field mapping', async () => {
      mockAreFriends.mockResolvedValue(true);
      mockIsBlocked.mockResolvedValue(false);

      const createdAt = new Date('2026-03-15T10:30:00.000Z');
      const readAt = new Date('2026-03-15T11:00:00.000Z');
      const row = makeDmRow({
        id: 7,
        sender_id: 10,
        recipient_id: 20,
        message: 'Test message',
        read_at: readAt,
        created_at: createdAt,
        sender_username: 'bob',
      });

      mockExecute.mockResolvedValue({ insertId: 7, affectedRows: 1 });
      mockQuery.mockResolvedValue([row]);

      const result = await messageService.sendMessage(10, 20, 'Test message');

      expect(result).toEqual({
        id: 7,
        senderId: 10,
        senderUsername: 'bob',
        recipientId: 20,
        message: 'Test message',
        readAt: '2026-03-15T11:00:00.000Z',
        createdAt: '2026-03-15T10:30:00.000Z',
      });
    });

    it('should return null readAt when read_at is null', async () => {
      mockAreFriends.mockResolvedValue(true);
      mockIsBlocked.mockResolvedValue(false);

      const row = makeDmRow({ id: 8, read_at: null });
      mockExecute.mockResolvedValue({ insertId: 8, affectedRows: 1 });
      mockQuery.mockResolvedValue([row]);

      const result = await messageService.sendMessage(10, 20, 'hi');

      expect(result.readAt).toBeNull();
    });
  });

  describe('getConversation', () => {
    it('should return paginated messages with correct offset calculation', async () => {
      const row1 = makeDmRow({ id: 1, message: 'First' });
      const row2 = makeDmRow({ id: 2, message: 'Second' });

      mockQuery
        .mockResolvedValueOnce([row1, row2]) // messages query
        .mockResolvedValueOnce([{ total: 25 }]); // count query

      const result = await messageService.getConversation(10, 20, 3, 10);

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.messages).toHaveLength(2);
      // offset should be (3-1)*10 = 20
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ? OFFSET ?'),
        [10, 20, 20, 10, 10, 20],
      );
    });

    it('should return total count from COUNT query', async () => {
      mockQuery
        .mockResolvedValueOnce([makeDmRow()]) // messages
        .mockResolvedValueOnce([{ total: 42 }]); // count

      const result = await messageService.getConversation(10, 20);

      expect(result.total).toBe(42);
    });

    it('should handle empty conversation', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // no messages
        .mockResolvedValueOnce([{ total: 0 }]); // count

      const result = await messageService.getConversation(10, 20);

      expect(result.messages).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should use default page=1 and limit=20', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // messages
        .mockResolvedValueOnce([{ total: 0 }]); // count

      const result = await messageService.getConversation(10, 20);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      // offset should be (1-1)*20 = 0
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ? OFFSET ?'),
        [10, 20, 20, 10, 20, 0],
      );
    });

    it('should map all rows to DirectMessage format', async () => {
      const createdAt = new Date('2026-03-15T10:00:00.000Z');
      const row = makeDmRow({
        id: 5,
        sender_id: 20,
        recipient_id: 10,
        message: 'Reply',
        read_at: null,
        created_at: createdAt,
        sender_username: 'bob',
      });

      mockQuery.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ total: 1 }]);

      const result = await messageService.getConversation(10, 20);

      expect(result.messages[0]).toEqual({
        id: 5,
        senderId: 20,
        senderUsername: 'bob',
        recipientId: 10,
        message: 'Reply',
        readAt: null,
        createdAt: '2026-03-15T10:00:00.000Z',
      });
    });
  });

  describe('getConversationList', () => {
    it('should return latest message per conversation partner', async () => {
      const rows = [
        {
          other_id: 20,
          other_username: 'bob',
          message: 'Latest from bob',
          created_at: new Date('2026-03-15T12:00:00.000Z'),
          unread_count: 3,
        },
        {
          other_id: 30,
          other_username: 'charlie',
          message: 'Latest from charlie',
          created_at: new Date('2026-03-15T11:00:00.000Z'),
          unread_count: 0,
        },
      ];

      mockQuery.mockResolvedValue(rows);

      const result = await messageService.getConversationList(10);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        userId: 20,
        username: 'bob',
        lastMessage: 'Latest from bob',
        lastMessageAt: '2026-03-15T12:00:00.000Z',
        unreadCount: 3,
      });
      expect(result[1]).toEqual({
        userId: 30,
        username: 'charlie',
        lastMessage: 'Latest from charlie',
        lastMessageAt: '2026-03-15T11:00:00.000Z',
        unreadCount: 0,
      });
    });

    it('should include unread count per conversation', async () => {
      const rows = [
        {
          other_id: 20,
          other_username: 'bob',
          message: 'hi',
          created_at: new Date('2026-03-15T12:00:00.000Z'),
          unread_count: 7,
        },
      ];

      mockQuery.mockResolvedValue(rows);

      const result = await messageService.getConversationList(10);

      expect(result[0].unreadCount).toBe(7);
    });

    it('should return empty array for user with no conversations', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await messageService.getConversationList(10);

      expect(result).toEqual([]);
    });

    it('should pass userId five times to the conversation list query', async () => {
      mockQuery.mockResolvedValue([]);

      await messageService.getConversationList(10);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('direct_messages'),
        [10, 10, 10, 10, 10],
      );
    });
  });

  describe('markRead', () => {
    it('should execute UPDATE with correct recipientId and senderId', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 3 });

      await messageService.markRead(20, 10);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE direct_messages SET read_at'),
        [20, 10],
      );
    });

    it('should only update messages where read_at IS NULL', async () => {
      mockExecute.mockResolvedValue({ affectedRows: 0 });

      await messageService.markRead(20, 10);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('read_at IS NULL'),
        [20, 10],
      );
    });
  });

  describe('getUnreadCounts', () => {
    it('should return count per sender', async () => {
      mockQuery.mockResolvedValue([
        { sender_id: 20, total: 3 },
        { sender_id: 30, total: 1 },
      ]);

      const result = await messageService.getUnreadCounts(10);

      expect(result).toEqual({
        20: 3,
        30: 1,
      });
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('GROUP BY sender_id'), [10]);
    });

    it('should return empty object when no unread messages', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await messageService.getUnreadCounts(10);

      expect(result).toEqual({});
    });
  });
});
