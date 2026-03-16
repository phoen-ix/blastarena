import { query, execute } from '../db/connection';
import { AppError } from '../middleware/errorHandler';
import { UserRole, RoomListItem } from '@blast-arena/shared';
import { getRoomManager, getIO } from '../game/registry';
import { hashPassword } from '../utils/crypto';
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
  const existing = await query<IdRow[]>('SELECT id FROM users WHERE username = ? OR email = ?', [
    username,
    email,
  ]);
  if (existing.length > 0) {
    throw new AppError('Username or email already taken', 409, 'CONFLICT');
  }

  const passwordHash = await hashPassword(password);
  const userRole = role || 'user';

  const result = await execute(
    'INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, TRUE)',
    [username, email, passwordHash, userRole],
  );

  await execute('INSERT INTO user_stats (user_id) VALUES (?)', [result.insertId]);

  await execute(
    'INSERT INTO admin_actions (admin_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)',
    [adminId, 'create_user', 'user', result.insertId, `${username} (${userRole})`],
  );

  return { id: result.insertId, username };
}

export async function listUsers(page: number = 1, limit: number = 20, search?: string) {
  const offset = (page - 1) * limit;
  let sql = `
    SELECT u.id, u.username, u.email, u.role, u.email_verified,
           u.is_deactivated, u.deactivated_at,
           u.last_login, u.created_at,
           COALESCE(s.total_matches, 0) as total_matches,
           COALESCE(s.total_wins, 0) as total_wins
    FROM users u
    LEFT JOIN user_stats s ON s.user_id = u.id
  `;
  const params: (string | number)[] = [];

  if (search) {
    sql += ' WHERE u.username LIKE ? OR u.email LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await query<AdminUserRow[]>(sql, params);

  let countSql = 'SELECT COUNT(*) as total FROM users';
  const countParams: (string | number)[] = [];
  if (search) {
    countSql += ' WHERE username LIKE ? OR email LIKE ?';
    countParams.push(`%${search}%`, `%${search}%`);
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
  }
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

export async function getServerStats() {
  const [userCount] = await query<CountRow[]>(
    'SELECT COUNT(*) as total FROM users WHERE is_deactivated = FALSE',
  );
  const [activeCount] = await query<CountRow[]>(
    'SELECT COUNT(*) as total FROM users WHERE last_login > DATE_SUB(NOW(), INTERVAL 24 HOUR)',
  );
  const [matchCount] = await query<CountRow[]>('SELECT COUNT(*) as total FROM matches');

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
    totalUsers: userCount.total,
    activeUsers24h: activeCount.total,
    totalMatches: matchCount.total,
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
            (SELECT COUNT(*) FROM match_players WHERE match_id = m.id) as player_count
     FROM matches m
     LEFT JOIN users u ON u.id = m.winner_id
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
  let allPlayers: any[] | null = null;
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
