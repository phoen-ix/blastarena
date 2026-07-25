import { query, execute } from '../db/connection';
import { AppError } from '../middleware/errorHandler';
import { UserRole, RoomListItem, ReplayData } from '@blast-arena/shared';
import { getRoomManager, getIO } from '../game/registry';
import { hashPassword, hashEmail, generateEmailHint } from '../utils/crypto';
import { getConfig } from '../config';
import { hasReplay, getReplayPlacements } from './replay';
import * as lobbyService from './lobby';
import {
  CountRow,
  IdRow,
  AdminUserRow,
  MatchRow,
  MatchPlayerRow,
  AdminActionRow,
} from '../db/types';

export async function createUser(
  adminId: number,
  username: string,
  email: string,
  password: string,
  role?: UserRole,
): Promise<{ id: number; username: string }> {
  const config = getConfig();
  const normalizedEmail = email.toLowerCase();
  const emailHash = hashEmail(normalizedEmail, config.EMAIL_PEPPER);
  const emailHint = generateEmailHint(normalizedEmail);

  const existing = await query<IdRow[]>(
    'SELECT id FROM users WHERE username = ? OR email_hash = ?',
    [username, emailHash],
  );
  if (existing.length > 0) {
    throw new AppError('Username or email already taken', 409, 'CONFLICT');
  }

  const passwordHash = await hashPassword(password);
  const userRole = role || 'user';

  const result = await execute(
    'INSERT INTO users (username, email_hash, email_hint, password_hash, role, email_verified) VALUES (?, ?, ?, ?, ?, TRUE)',
    [username, emailHash, emailHint, passwordHash, userRole],
  );

  await execute('INSERT INTO user_stats (user_id) VALUES (?)', [result.insertId]);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'create_user', 'user', result.insertId, `${username} (${userRole})`],
  );

  return { id: result.insertId, username };
}

export async function listUsers(page: number = 1, limit: number = 20, search?: string) {
  const config = getConfig();
  const offset = (page - 1) * limit;
  let sql = `
    SELECT u.id, u.username, u.email_hint, u.role, u.email_verified,
           u.totp_enabled, u.is_deactivated, u.deactivated_at,
           u.last_login, u.created_at,
           COALESCE(s.total_matches, 0) as total_matches,
           COALESCE(s.total_wins, 0) as total_wins
    FROM users u
    LEFT JOIN user_stats s ON s.user_id = u.id
  `;
  const params: (string | number)[] = [];

  if (search) {
    if (search.includes('@')) {
      // Exact email lookup via hash
      const searchHash = hashEmail(search.toLowerCase().trim(), config.EMAIL_PEPPER);
      sql += ' WHERE u.email_hash = ?';
      params.push(searchHash);
    } else {
      sql += ' WHERE u.username LIKE ?';
      params.push(`%${search}%`);
    }
  }

  sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await query<AdminUserRow[]>(sql, params);

  let countSql = 'SELECT COUNT(*) as total FROM users';
  const countParams: (string | number)[] = [];
  if (search) {
    if (search.includes('@')) {
      const searchHash = hashEmail(search.toLowerCase().trim(), config.EMAIL_PEPPER);
      countSql += ' WHERE email_hash = ?';
      countParams.push(searchHash);
    } else {
      countSql += ' WHERE username LIKE ?';
      countParams.push(`%${search}%`);
    }
  }
  const countRows = await query<CountRow[]>(countSql, countParams);
  const total = countRows[0].total;

  return { users: rows, total, page, limit };
}

export async function changeUserRole(
  adminId: number,
  userId: number,
  role: UserRole,
): Promise<void> {
  if (adminId === userId) {
    throw new AppError('Cannot change your own role', 400, 'SELF_ACTION');
  }

  await execute('UPDATE users SET role = ? WHERE id = ?', [role, userId]);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'role_change', 'user', userId, role],
  );
}

export async function deactivateUser(
  adminId: number,
  userId: number,
  deactivated: boolean,
): Promise<void> {
  if (adminId === userId) {
    throw new AppError('Cannot deactivate yourself', 400, 'SELF_ACTION');
  }

  await execute('UPDATE users SET is_deactivated = ?, deactivated_at = ? WHERE id = ?', [
    deactivated,
    deactivated ? new Date() : null,
    userId,
  ]);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, deactivated ? 'deactivate' : 'reactivate', 'user', userId, null],
  );

  if (deactivated) {
    await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [userId]);
    // Force-disconnect active sockets immediately
    try {
      getIO().in(`user:${userId}`).disconnectSockets(true);
    } catch {
      // Socket server may not be available in tests
    }
  }
}

export async function revokeUserSessions(adminId: number, userId: number): Promise<void> {
  if (adminId === userId) {
    throw new AppError('Cannot revoke your own sessions', 400, 'SELF_ACTION');
  }

  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [userId]);

  let socketCount = 0;
  try {
    const io = getIO();
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    socketCount = sockets.length;
    io.in(`user:${userId}`).disconnectSockets(true);
  } catch {
    // Socket server may not be available in tests
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'revoke_sessions', 'user', userId, JSON.stringify({ socketCount })],
  );
}

export async function revokeAllSessions(adminId: number): Promise<void> {
  // Revoke all refresh tokens except the admin's own
  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id != ?', [adminId]);

  let socketCount = 0;
  try {
    const io = getIO();
    const allSockets = await io.fetchSockets();
    for (const s of allSockets) {
      if (s.data.userId !== adminId) {
        socketCount++;
        s.disconnect(true);
      }
    }
  } catch {
    // Socket server may not be available in tests
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'revoke_all_sessions', 'system', 0, JSON.stringify({ socketCount })],
  );
}

export async function deleteUser(adminId: number, userId: number): Promise<void> {
  if (adminId === userId) {
    throw new AppError('Cannot delete yourself', 400, 'SELF_ACTION');
  }

  // Check user exists
  const rows = await query<AdminUserRow[]>('SELECT id, username FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const username = rows[0].username;

  // Log action before deletion (FK cascade would remove the log if admin is the target)
  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'delete', 'user', userId, username],
  );

  // Hard delete — FK cascades handle refresh_tokens, user_stats, match_players
  await execute('DELETE FROM users WHERE id = ?', [userId]);
}

export async function resetUserPassword(
  adminId: number,
  userId: number,
  newPassword: string,
): Promise<void> {
  const rows = await query<AdminUserRow[]>('SELECT id, username FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const passwordHash = await hashPassword(newPassword);
  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

  // Revoke all refresh tokens so user must re-login
  await execute('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [userId]);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'reset_password', 'user', userId, rows[0].username],
  );
}

export async function resetUserTotp(adminId: number, userId: number): Promise<void> {
  const rows = await query<AdminUserRow[]>(
    'SELECT id, username, totp_enabled FROM users WHERE id = ?',
    [userId],
  );
  if (rows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }
  if (!rows[0].totp_enabled) {
    throw new AppError('User does not have 2FA enabled', 400, 'TOTP_NOT_ENABLED');
  }

  await execute(
    'UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = ?',
    [userId],
  );

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'reset_totp', 'user', userId, rows[0].username],
  );
}

export async function getServerStats() {
  // Single query with subselects instead of 3 separate round-trips
  const [stats] = (await query<CountRow[]>(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE is_deactivated = FALSE) as totalUsers,
      (SELECT COUNT(*) FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 24 HOUR)) as activeUsers24h,
      (SELECT COUNT(*) FROM matches) as totalMatches`,
  )) as unknown as [{ totalUsers: number; activeUsers24h: number; totalMatches: number }];

  let activeRooms = 0;
  let activePlayers = 0;
  try {
    const rm = getRoomManager();
    activeRooms = rm.getActiveRoomCount();
    const rooms = rm.getAllRooms();
    activePlayers = rooms.reduce((sum, room) => {
      // Count sockets in the room's socket.io room
      const io = getIO();
      const socketRoom = io.sockets.adapter.rooms.get(`room:${room.code}`);
      return sum + (socketRoom ? socketRoom.size : 0);
    }, 0);
  } catch {
    // Registry not yet initialized
  }

  return {
    totalUsers: stats.totalUsers,
    activeUsers24h: stats.activeUsers24h,
    totalMatches: stats.totalMatches,
    activeRooms,
    activePlayers,
  };
}

export async function getMatchHistory(page: number = 1, limit: number = 20) {
  const offset = (page - 1) * limit;
  const rows = await query<MatchRow[]>(
    `SELECT m.id, m.room_code, m.game_mode, m.status, m.duration,
            m.started_at, m.finished_at,
            u.username as winner_username,
            COALESCE(pc.player_count, 0) as player_count
     FROM matches m
     LEFT JOIN users u ON u.id = m.winner_id
     LEFT JOIN (SELECT match_id, COUNT(*) as player_count FROM match_players GROUP BY match_id) pc ON pc.match_id = m.id
     ORDER BY m.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  const [countRow] = await query<CountRow[]>('SELECT COUNT(*) as total FROM matches');
  return { matches: rows, total: countRow.total, page, limit };
}

export async function getMatchDetail(matchId: number) {
  const matchRows = await query<MatchRow[]>(
    `SELECT m.id, m.room_code, m.game_mode, m.map_seed, m.map_width, m.map_height,
            m.max_players, m.status, m.duration, m.winner_id, m.started_at, m.finished_at
     FROM matches m WHERE m.id = ?`,
    [matchId],
  );

  if (matchRows.length === 0) {
    throw new AppError('Match not found', 404, 'NOT_FOUND');
  }

  const match = matchRows[0];

  const players = await query<MatchPlayerRow[]>(
    `SELECT mp.user_id, u.username, mp.team, mp.placement, mp.kills, mp.deaths,
            mp.bombs_placed, mp.powerups_collected, mp.survived_seconds
     FROM match_players mp
     JOIN users u ON u.id = mp.user_id
     WHERE mp.match_id = ?
     ORDER BY mp.placement ASC`,
    [matchId],
  );

  const replayExists = hasReplay(match.id);

  // If replay exists, use its placements (includes bots + more stats)
  let allPlayers: ReplayData['gameOver']['placements'] | null = null;
  if (replayExists) {
    allPlayers = await getReplayPlacements(match.id);
  }

  return {
    id: match.id,
    roomCode: match.room_code,
    gameMode: match.game_mode,
    mapSeed: match.map_seed,
    mapWidth: match.map_width,
    mapHeight: match.map_height,
    maxPlayers: match.max_players,
    status: match.status,
    duration: match.duration,
    winnerId: match.winner_id,
    startedAt: match.started_at,
    finishedAt: match.finished_at,
    hasReplay: replayExists,
    allPlayers: allPlayers,
    players: players.map((p) => ({
      userId: p.user_id,
      username: p.username,
      team: p.team,
      placement: p.placement,
      kills: p.kills,
      deaths: p.deaths,
      bombsPlaced: p.bombs_placed,
      powerupsCollected: p.powerups_collected,
      survivedSeconds: p.survived_seconds,
    })),
  };
}

export async function getAdminActions(page: number = 1, limit: number = 20, action?: string) {
  const offset = (page - 1) * limit;
  let sql = `
    SELECT a.id, a.admin_id, u.username as admin_username, a.action,
           a.target_type, a.target_id, a.details, a.created_at
    FROM admin_actions a
    JOIN users u ON u.id = a.admin_id
  `;
  const params: (string | number)[] = [];

  if (action) {
    sql += ' WHERE a.action = ?';
    params.push(action);
  }

  sql += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await query<AdminActionRow[]>(sql, params);

  let countSql = 'SELECT COUNT(*) as total FROM admin_actions';
  const countParams: (string | number)[] = [];
  if (action) {
    countSql += ' WHERE action = ?';
    countParams.push(action);
  }
  const [countRow] = await query<CountRow[]>(countSql, countParams);

  return { actions: rows, total: countRow.total, page, limit };
}

export async function getActiveRooms() {
  try {
    const rooms = await lobbyService.listRooms();
    return rooms.map((r: RoomListItem) => ({
      code: r.code,
      name: r.name,
      host: r.host,
      playerCount: r.playerCount,
      maxPlayers: r.maxPlayers,
      gameMode: r.gameMode,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

export async function sendToast(adminId: number, message: string): Promise<void> {
  try {
    const io = getIO();
    io.emit('admin:toast', { message });
  } catch {
    throw new AppError('Socket server not available', 500);
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'toast', 'broadcast', 0, message],
  );
}

export async function setBanner(adminId: number, message: string): Promise<void> {
  // Deactivate existing banners
  await execute(
    "UPDATE announcements SET is_active = FALSE, dismissed_at = NOW() WHERE is_active = TRUE AND type = 'banner'",
  );

  // Insert new banner
  await execute("INSERT INTO announcements (admin_id, type, message) VALUES (?, 'banner', ?)", [
    adminId,
    message,
  ]);

  try {
    const io = getIO();
    io.emit('admin:banner', { message });
  } catch {
    // Socket not available, banner still saved in DB
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'set_banner', 'broadcast', 0, message],
  );
}

export async function clearBanner(adminId: number): Promise<void> {
  await execute(
    "UPDATE announcements SET is_active = FALSE, dismissed_at = NOW() WHERE is_active = TRUE AND type = 'banner'",
  );

  try {
    const io = getIO();
    io.emit('admin:banner', { message: null });
  } catch {
    // Socket not available
  }

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'clear_banner', 'broadcast', 0, null],
  );
}

export async function getActiveBanner() {
  const rows = await query(
    `SELECT a.id, a.message, u.username as admin_username, a.created_at
     FROM announcements a
     JOIN users u ON u.id = a.admin_id
     WHERE a.is_active = TRUE AND a.type = 'banner'
     ORDER BY a.created_at DESC LIMIT 1`,
  );
  return rows.length > 0 ? rows[0] : null;
}

// --- Account Cleanup ---

export type CleanupType = 'unverified' | 'inactive' | 'deactivated';

function buildCleanupWhere(
  type: CleanupType,
  days?: number,
  adminId?: number,
): { where: string; params: (string | number)[] } {
  const conditions: string[] = ["role = 'user'"];
  const params: (string | number)[] = [];

  if (adminId) {
    conditions.push('id != ?');
    params.push(adminId);
  }

  switch (type) {
    case 'unverified':
      conditions.push('email_verified = FALSE');
      conditions.push('created_at < NOW() - INTERVAL ? DAY');
      params.push(days!);
      break;
    case 'inactive':
      conditions.push(
        '((last_login IS NOT NULL AND last_login < NOW() - INTERVAL ? DAY) OR (last_login IS NULL AND created_at < NOW() - INTERVAL ? DAY))',
      );
      params.push(days!, days!);
      break;
    case 'deactivated':
      conditions.push('is_deactivated = TRUE');
      break;
  }

  return { where: conditions.join(' AND '), params };
}

export async function previewCleanup(type: CleanupType, days?: number): Promise<{ count: number }> {
  const { where, params } = buildCleanupWhere(type, days);
  const [row] = await query<CountRow[]>(
    `SELECT COUNT(*) as total FROM users WHERE ${where}`,
    params,
  );
  return { count: row.total };
}

export async function executeCleanup(
  adminId: number,
  type: CleanupType,
  days?: number,
): Promise<{ deleted: number }> {
  const { where, params } = buildCleanupWhere(type, days, adminId);

  // Get IDs of users to delete (for socket disconnect)
  const rows = await query<IdRow[]>(`SELECT id FROM users WHERE ${where}`, params);
  if (rows.length === 0) {
    return { deleted: 0 };
  }

  const userIds = rows.map((r) => r.id);

  // Audit log before deletion (FK cascade would remove if admin is in the set)
  const details = JSON.stringify({ type, days: days ?? null, count: userIds.length });
  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'bulk_delete', 'user', 0, details],
  );

  // Disconnect sockets for affected users
  try {
    const io = getIO();
    for (const id of userIds) {
      io.in(`user:${id}`).disconnectSockets(true);
    }
  } catch {
    // Socket server may not be available
  }

  // Bulk delete — FK CASCADE handles related tables
  const placeholders = userIds.map(() => '?').join(',');
  await execute(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);

  return { deleted: userIds.length };
}
