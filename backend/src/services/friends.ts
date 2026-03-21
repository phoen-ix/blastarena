import { query, execute, withTransaction } from '../db/connection';
import { FriendshipRow, UserBlockRow, CountRow, UserRow } from '../db/types';
import { Friend, FriendRequest, MAX_FRIENDS, ActivityStatus } from '@blast-arena/shared';
import { RowDataPacket } from 'mysql2';
import * as presenceService from './presence';

interface UserSearchRow extends RowDataPacket {
  id: number;
  username: string;
}

export async function sendFriendRequest(fromUserId: number, toUsername: string): Promise<number> {
  // Look up target user
  const [targetUser] = await query<UserRow[]>(
    'SELECT id, username, accept_friend_requests FROM users WHERE username = ? AND is_deactivated = 0',
    [toUsername],
  );
  if (!targetUser) {
    throw new Error('User not found');
  }
  if (targetUser.id === fromUserId) {
    throw new Error('Cannot send friend request to yourself');
  }

  // Check if target accepts friend requests
  if (targetUser.accept_friend_requests === false || targetUser.accept_friend_requests === 0) {
    throw new Error('This user is not accepting friend requests');
  }

  // Check blocks both directions
  const blocked = await isBlockedEither(fromUserId, targetUser.id);
  if (blocked) {
    throw new Error('Cannot send friend request to this user');
  }

  // Check existing friendship
  const [existing] = await query<FriendshipRow[]>(
    'SELECT id, status FROM friendships WHERE user_id = ? AND friend_id = ?',
    [fromUserId, targetUser.id],
  );
  if (existing) {
    if (existing.status === 'accepted') throw new Error('Already friends');
    throw new Error('Friend request already sent');
  }

  // Check if they already sent us a request — auto-accept
  const [incoming] = await query<FriendshipRow[]>(
    'SELECT id FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?',
    [targetUser.id, fromUserId, 'pending'],
  );
  if (incoming) {
    await acceptFriendRequest(fromUserId, targetUser.id);
    return targetUser.id;
  }

  // Check max friends
  const [countRow] = await query<CountRow[]>(
    'SELECT COUNT(*) as total FROM friendships WHERE user_id = ? AND status = ?',
    [fromUserId, 'accepted'],
  );
  if (countRow.total >= MAX_FRIENDS) {
    throw new Error('Friend list is full');
  }

  // Insert pending request
  await execute(
    'INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)',
    [fromUserId, targetUser.id, 'pending'],
  );
  return targetUser.id;
}

export async function acceptFriendRequest(userId: number, fromUserId: number): Promise<void> {
  await withTransaction(async (conn) => {
    // Verify pending request exists
    const [rows] = await conn.query<FriendshipRow[]>(
      'SELECT id FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?',
      [fromUserId, userId, 'pending'],
    );
    if (rows.length === 0) {
      throw new Error('No pending friend request found');
    }

    // Update to accepted
    await conn.execute(
      'UPDATE friendships SET status = ? WHERE user_id = ? AND friend_id = ?',
      ['accepted', fromUserId, userId],
    );

    // Insert reciprocal accepted row
    await conn.execute(
      'INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?',
      [userId, fromUserId, 'accepted', 'accepted'],
    );
  });
}

export async function declineFriendRequest(userId: number, fromUserId: number): Promise<void> {
  const result = await execute(
    'DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?',
    [fromUserId, userId, 'pending'],
  );
  if (result.affectedRows === 0) {
    throw new Error('No pending friend request found');
  }
}

export async function cancelFriendRequest(userId: number, toUserId: number): Promise<void> {
  const result = await execute(
    'DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?',
    [userId, toUserId, 'pending'],
  );
  if (result.affectedRows === 0) {
    throw new Error('No pending friend request found');
  }
}

export async function removeFriend(userId: number, friendId: number): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.execute(
      'DELETE FROM friendships WHERE user_id = ? AND friend_id = ?',
      [userId, friendId],
    );
    await conn.execute(
      'DELETE FROM friendships WHERE user_id = ? AND friend_id = ?',
      [friendId, userId],
    );
  });
}

export async function blockUser(blockerId: number, blockedId: number): Promise<void> {
  if (blockerId === blockedId) {
    throw new Error('Cannot block yourself');
  }

  const [targetUser] = await query<UserRow[]>(
    'SELECT id FROM users WHERE id = ? AND is_deactivated = 0',
    [blockedId],
  );
  if (!targetUser) {
    throw new Error('User not found');
  }

  await withTransaction(async (conn) => {
    // Remove any existing friendship
    await conn.execute(
      'DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [blockerId, blockedId, blockedId, blockerId],
    );
    // Insert block
    await conn.execute(
      'INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)',
      [blockerId, blockedId],
    );
  });
}

export async function unblockUser(blockerId: number, blockedId: number): Promise<void> {
  await execute(
    'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?',
    [blockerId, blockedId],
  );
}

export async function getFriends(userId: number): Promise<Friend[]> {
  const rows = await query<FriendshipRow[]>(
    `SELECT f.friend_id, f.status, f.created_at, u.username
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? AND f.status = ?`,
    [userId, 'accepted'],
  );

  // Batch presence lookup
  const friendIds = rows.map((r) => r.friend_id);
  const presenceMap = await presenceService.getPresenceBatch(friendIds);

  return rows.map((r) => {
    const presence = presenceMap.get(r.friend_id);
    return {
      userId: r.friend_id,
      username: r.username!,
      status: 'accepted' as const,
      direction: null,
      activity: (presence?.status ?? 'offline') as ActivityStatus,
      roomCode: presence?.roomCode,
      gameMode: presence?.gameMode,
      since: r.created_at.toISOString(),
    };
  });
}

export async function getFriendIds(userId: number): Promise<number[]> {
  const rows = await query<FriendshipRow[]>(
    'SELECT friend_id FROM friendships WHERE user_id = ? AND status = ?',
    [userId, 'accepted'],
  );
  return rows.map((r) => r.friend_id);
}

export async function getPendingRequests(
  userId: number,
): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
  const incomingRows = await query<FriendshipRow[]>(
    `SELECT f.user_id as friend_id, f.created_at, u.username
     FROM friendships f
     JOIN users u ON u.id = f.user_id
     WHERE f.friend_id = ? AND f.status = ?`,
    [userId, 'pending'],
  );

  const outgoingRows = await query<FriendshipRow[]>(
    `SELECT f.friend_id, f.created_at, u.username
     FROM friendships f
     JOIN users u ON u.id = f.friend_id
     WHERE f.user_id = ? AND f.status = ?`,
    [userId, 'pending'],
  );

  return {
    incoming: incomingRows.map((r) => ({
      id: r.friend_id,
      fromUserId: r.friend_id,
      fromUsername: r.username!,
      createdAt: r.created_at.toISOString(),
    })),
    outgoing: outgoingRows.map((r) => ({
      id: r.friend_id,
      fromUserId: r.friend_id,
      fromUsername: r.username!,
      createdAt: r.created_at.toISOString(),
    })),
  };
}

export async function areFriends(userId1: number, userId2: number): Promise<boolean> {
  const [row] = await query<FriendshipRow[]>(
    'SELECT id FROM friendships WHERE user_id = ? AND friend_id = ? AND status = ?',
    [userId1, userId2, 'accepted'],
  );
  return !!row;
}

export async function isBlocked(blockerId: number, blockedId: number): Promise<boolean> {
  const [row] = await query<UserBlockRow[]>(
    'SELECT id FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?',
    [blockerId, blockedId],
  );
  return !!row;
}

async function isBlockedEither(userId1: number, userId2: number): Promise<boolean> {
  const [row] = await query<UserBlockRow[]>(
    'SELECT id FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
    [userId1, userId2, userId2, userId1],
  );
  return !!row;
}

export async function getBlockedUsers(
  userId: number,
): Promise<{ userId: number; username: string }[]> {
  const rows = await query<UserBlockRow[]>(
    `SELECT b.blocked_id, u.username
     FROM user_blocks b
     JOIN users u ON u.id = b.blocked_id
     WHERE b.blocker_id = ?`,
    [userId],
  );
  return rows.map((r) => ({ userId: r.blocked_id, username: r.username! }));
}

export async function getFriendCount(userId: number): Promise<number> {
  const [row] = await query<CountRow[]>(
    'SELECT COUNT(*) as total FROM friendships WHERE user_id = ? AND status = ?',
    [userId, 'accepted'],
  );
  return row.total;
}

export async function searchUsers(
  searchQuery: string,
  excludeUserId: number,
): Promise<{ id: number; username: string }[]> {
  const trimmed = searchQuery.trim();
  if (trimmed.length < 2) return [];

  const rows = await query<UserSearchRow[]>(
    `SELECT u.id, u.username FROM users u
     WHERE u.username LIKE ? AND u.id != ? AND u.is_deactivated = 0
     AND u.id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
     AND u.id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = ?)
     LIMIT 10`,
    [`${trimmed}%`, excludeUserId, excludeUserId, excludeUserId],
  );
  return rows.map((r) => ({ id: r.id, username: r.username }));
}
