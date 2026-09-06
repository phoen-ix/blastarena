import { query, execute } from '../db/connection';
import { DirectMessageRow, CountRow } from '../db/types';
import { DirectMessage, DMConversation, DM_MAX_LENGTH } from '@blast-arena/shared';
import * as friendsService from './friends';
import { AppError } from '../middleware/errorHandler';

export async function sendMessage(
  senderId: number,
  recipientId: number,
  message: string,
): Promise<DirectMessage> {
  if (senderId === recipientId) {
    throw new AppError('Cannot message yourself', 400, 'INVALID_RECIPIENT');
  }

  const friends = await friendsService.areFriends(senderId, recipientId);
  if (!friends) throw new AppError('Can only message friends', 403, 'NOT_FRIENDS');

  // Defensive, and effectively unreachable in sequence: `blockUser` deletes the friendship in the
  // same transaction as the block, so a blocked pair fails the `areFriends` check above first —
  // verified against the live deployment, where blocking then messaging returns NOT_FRIENDS, not
  // BLOCKED. This still guards the race where a block commits between the two reads, so it stays.
  const blocked = await friendsService.isBlocked(senderId, recipientId);
  if (blocked) throw new AppError('Cannot message this user', 403, 'BLOCKED');

  const trimmed = message.trim().substring(0, DM_MAX_LENGTH);
  if (!trimmed) throw new AppError('Message cannot be empty', 400, 'EMPTY_MESSAGE');

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
     ORDER BY dm.created_at DESC, dm.id DESC
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

// The two halves of the conversation (sent / received) are each an indexed range scan, combined
// with UNION ALL. The previous `WHERE sender_id = ? OR recipient_id = ?` could not use either
// index and scanned the whole DM table per request; there was also no LIMIT. (audit E7)
export async function getConversationList(userId: number): Promise<DMConversation[]> {
  // Get the latest message for each conversation partner + unread count
  const rows = await query<
    (DirectMessageRow & { other_id: number; other_username: string; unread_count: number })[]
  >(
    `SELECT
       sub.other_id,
       sub.other_username,
       dm.message AS message,
       dm.created_at,
       sub.unread_count
     FROM (
       SELECT
         h.other_id,
         u.username AS other_username,
         MAX(h.id) AS latest_id,
         SUM(h.unread) AS unread_count
       FROM (
         SELECT dm2.id, dm2.recipient_id AS other_id, 0 AS unread
         FROM direct_messages dm2 WHERE dm2.sender_id = ?
         UNION ALL
         SELECT dm2.id, dm2.sender_id AS other_id,
                CASE WHEN dm2.read_at IS NULL THEN 1 ELSE 0 END AS unread
         FROM direct_messages dm2 WHERE dm2.recipient_id = ?
       ) h
       JOIN users u ON u.id = h.other_id
       GROUP BY h.other_id, u.username
     ) sub
     JOIN direct_messages dm ON dm.id = sub.latest_id
     ORDER BY dm.created_at DESC, dm.id DESC
     LIMIT 100`,
    [userId, userId],
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
