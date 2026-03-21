import { query, execute } from '../db/connection';
import { DirectMessageRow, CountRow } from '../db/types';
import { DirectMessage, DMConversation, DM_MAX_LENGTH } from '@blast-arena/shared';
import * as friendsService from './friends';

export async function sendMessage(
  senderId: number,
  recipientId: number,
  message: string,
): Promise<DirectMessage> {
  if (senderId === recipientId) {
    throw new Error('Cannot message yourself');
  }

  const friends = await friendsService.areFriends(senderId, recipientId);
  if (!friends) throw new Error('Can only message friends');

  const blocked = await friendsService.isBlocked(senderId, recipientId);
  if (blocked) throw new Error('Cannot message this user');

  const trimmed = message.trim().substring(0, DM_MAX_LENGTH);
  if (!trimmed) throw new Error('Message cannot be empty');

  const result = await execute(
    'INSERT INTO direct_messages (sender_id, recipient_id, message) VALUES (?, ?, ?)',
    [senderId, recipientId, trimmed],
  );

  const rows = await query<DirectMessageRow[]>(
    `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.message, dm.read_at, dm.created_at,
            u.username AS sender_username
     FROM direct_messages dm
     JOIN users u ON u.id = dm.sender_id
     WHERE dm.id = ?`,
    [result.insertId],
  );

  return toDirectMessage(rows[0]);
}

export async function getConversation(
  userId: number,
  otherUserId: number,
  page: number = 1,
  limit: number = 20,
): Promise<{ messages: DirectMessage[]; total: number; page: number; limit: number }> {
  const offset = (page - 1) * limit;

  const rows = await query<DirectMessageRow[]>(
    `SELECT dm.id, dm.sender_id, dm.recipient_id, dm.message, dm.read_at, dm.created_at,
            u.username AS sender_username
     FROM direct_messages dm
     JOIN users u ON u.id = dm.sender_id
     WHERE (dm.sender_id = ? AND dm.recipient_id = ?)
        OR (dm.sender_id = ? AND dm.recipient_id = ?)
     ORDER BY dm.created_at DESC
     LIMIT ? OFFSET ?`,
    [userId, otherUserId, otherUserId, userId, limit, offset],
  );

  const [countRow] = await query<CountRow[]>(
    `SELECT COUNT(*) as total FROM direct_messages
     WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)`,
    [userId, otherUserId, otherUserId, userId],
  );

  return {
    messages: rows.map(toDirectMessage),
    total: countRow.total,
    page,
    limit,
  };
}

export async function getConversationList(userId: number): Promise<DMConversation[]> {
  // Get the latest message for each conversation partner + unread count
  const rows = await query<(DirectMessageRow & { other_id: number; other_username: string; unread_count: number })[]>(
    `SELECT
       sub.other_id,
       sub.other_username,
       dm.message AS message,
       dm.created_at,
       sub.unread_count
     FROM (
       SELECT
         IF(dm2.sender_id = ?, dm2.recipient_id, dm2.sender_id) AS other_id,
         u.username AS other_username,
         MAX(dm2.id) AS latest_id,
         SUM(CASE WHEN dm2.recipient_id = ? AND dm2.read_at IS NULL THEN 1 ELSE 0 END) AS unread_count
       FROM direct_messages dm2
       JOIN users u ON u.id = IF(dm2.sender_id = ?, dm2.recipient_id, dm2.sender_id)
       WHERE dm2.sender_id = ? OR dm2.recipient_id = ?
       GROUP BY other_id, other_username
     ) sub
     JOIN direct_messages dm ON dm.id = sub.latest_id
     ORDER BY dm.created_at DESC`,
    [userId, userId, userId, userId, userId],
  );

  return rows.map((r) => ({
    userId: r.other_id,
    username: r.other_username,
    lastMessage: r.message,
    lastMessageAt: r.created_at.toISOString(),
    unreadCount: Number(r.unread_count),
  }));
}

export async function markRead(recipientId: number, senderId: number): Promise<void> {
  await execute(
    'UPDATE direct_messages SET read_at = NOW() WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL',
    [recipientId, senderId],
  );
}

export async function getUnreadCounts(userId: number): Promise<Record<number, number>> {
  const rows = await query<(CountRow & { sender_id: number })[]>(
    `SELECT sender_id, COUNT(*) as total
     FROM direct_messages
     WHERE recipient_id = ? AND read_at IS NULL
     GROUP BY sender_id`,
    [userId],
  );

  const counts: Record<number, number> = {};
  for (const row of rows) {
    counts[row.sender_id] = row.total;
  }
  return counts;
}

function toDirectMessage(row: DirectMessageRow): DirectMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    senderUsername: row.sender_username ?? '',
    recipientId: row.recipient_id,
    message: row.message,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
