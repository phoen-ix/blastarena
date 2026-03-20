import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const mockQuery = jest.fn<AnyFn>();
const mockExecute = jest.fn<AnyFn>();
jest.mock('../../../backend/src/db/connection', () => ({
  query: mockQuery,
  execute: mockExecute,
}));

const mockHashPassword = jest.fn<AnyFn>();
jest.mock('../../../backend/src/utils/crypto', () => ({
  hashPassword: mockHashPassword,
}));

const mockGetRoomManager = jest.fn<AnyFn>();
const mockGetIO = jest.fn<AnyFn>();
jest.mock('../../../backend/src/game/registry', () => ({
  getRoomManager: mockGetRoomManager,
  getIO: mockGetIO,
}));

const mockHasReplay = jest.fn<AnyFn>();
const mockGetReplayPlacements = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/replay', () => ({
  hasReplay: mockHasReplay,
  getReplayPlacements: mockGetReplayPlacements,
}));

const mockListRooms = jest.fn<AnyFn>();
jest.mock('../../../backend/src/services/lobby', () => ({
  listRooms: mockListRooms,
}));

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

import {
  createUser,
  listUsers,
  changeUserRole,
  deactivateUser,
  deleteUser,
  resetUserPassword,
  getServerStats,
  getMatchHistory,
  getMatchDetail,
  getAdminActions,
  getActiveRooms,
  sendToast,
  setBanner,
  clearBanner,
  getActiveBanner,
} from '../../../backend/src/services/admin';
import { AppError } from '../../../backend/src/middleware/errorHandler';

describe('admin service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── createUser ──────────────────────────────────────────────────────

  describe('createUser', () => {
    it('creates a user with default role and returns id + username', async () => {
      mockQuery.mockResolvedValueOnce([]); // no existing user
      mockHashPassword.mockResolvedValueOnce('hashed_pw');
      mockExecute.mockResolvedValueOnce({ insertId: 42 }); // INSERT user
      mockExecute.mockResolvedValueOnce({}); // INSERT user_stats
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      const result = await createUser(1, 'newuser', 'new@example.com', 'password123');

      expect(result).toEqual({ id: 42, username: 'newuser' });
      expect(mockHashPassword).toHaveBeenCalledWith('password123');
      expect(mockExecute).toHaveBeenCalledTimes(3);
      // Verify user insert includes default 'user' role
      expect(mockExecute.mock.calls[0][1]).toEqual([
        'newuser',
        'new@example.com',
        'hashed_pw',
        'user',
      ]);
    });

    it('creates a user with a specified role', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockHashPassword.mockResolvedValueOnce('hashed_pw');
      mockExecute.mockResolvedValueOnce({ insertId: 43 });
      mockExecute.mockResolvedValueOnce({});
      mockExecute.mockResolvedValueOnce({});

      const result = await createUser(1, 'moduser', 'mod@example.com', 'pass', 'moderator');

      expect(result).toEqual({ id: 43, username: 'moduser' });
      expect(mockExecute.mock.calls[0][1]).toEqual([
        'moduser',
        'mod@example.com',
        'hashed_pw',
        'moderator',
      ]);
    });

    it('throws 409 CONFLICT if username or email already exists', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 5 }]);

      try {
        await createUser(1, 'taken', 'taken@example.com', 'pass');
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(409);
        expect((err as AppError).code).toBe('CONFLICT');
      }
    });

    it('inserts user_stats row for the new user', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockHashPassword.mockResolvedValueOnce('hashed_pw');
      mockExecute.mockResolvedValueOnce({ insertId: 10 });
      mockExecute.mockResolvedValueOnce({});
      mockExecute.mockResolvedValueOnce({});

      await createUser(1, 'u', 'u@x.com', 'p');

      // Second execute call is user_stats insert
      expect(mockExecute.mock.calls[1][1]).toEqual([10]);
    });

    it('logs an admin audit action for user creation', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockHashPassword.mockResolvedValueOnce('hashed_pw');
      mockExecute.mockResolvedValueOnce({ insertId: 7 });
      mockExecute.mockResolvedValueOnce({});
      mockExecute.mockResolvedValueOnce({});

      await createUser(99, 'bob', 'bob@x.com', 'p', 'admin');

      // Third execute call is audit log
      expect(mockExecute.mock.calls[2][1]).toEqual([
        99,
        'create_user',
        'user',
        7,
        'bob (admin)',
      ]);
    });
  });

  // ── listUsers ───────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('returns paginated user list without search', async () => {
      const userRows = [
        { id: 1, username: 'alice', email: 'alice@x.com' },
        { id: 2, username: 'bob', email: 'bob@x.com' },
      ];
      mockQuery.mockResolvedValueOnce(userRows); // user rows
      mockQuery.mockResolvedValueOnce([{ total: 25 }]); // count

      const result = await listUsers(2, 10);

      expect(result).toEqual({ users: userRows, total: 25, page: 2, limit: 10 });
      // Check offset calculation: (2-1)*10 = 10
      expect(mockQuery.mock.calls[0][1]).toEqual([10, 10]);
    });

    it('applies search filter to both username and email', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([{ total: 0 }]);

      await listUsers(1, 20, 'alice');

      // User query should include LIKE params
      expect(mockQuery.mock.calls[0][1]).toEqual(['%alice%', '%alice%', 20, 0]);
      // Count query should also include LIKE params
      expect(mockQuery.mock.calls[1][1]).toEqual(['%alice%', '%alice%']);
    });

    it('uses default page=1 and limit=20', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([{ total: 0 }]);

      const result = await listUsers();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      // offset = (1-1)*20 = 0
      expect(mockQuery.mock.calls[0][1]).toEqual([20, 0]);
    });
  });

  // ── changeUserRole ──────────────────────────────────────────────────

  describe('changeUserRole', () => {
    it('updates role and logs audit action', async () => {
      mockExecute.mockResolvedValueOnce({}); // UPDATE users
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      await changeUserRole(1, 5, 'moderator');

      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(mockExecute.mock.calls[0][1]).toEqual(['moderator', 5]);
      expect(mockExecute.mock.calls[1][1]).toEqual([1, 'role_change', 'user', 5, 'moderator']);
    });

    it('throws 400 SELF_ACTION when admin tries to change own role', async () => {
      try {
        await changeUserRole(3, 3, 'user');
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('SELF_ACTION');
      }
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── deactivateUser ──────────────────────────────────────────────────

  describe('deactivateUser', () => {
    it('deactivates a user, revokes tokens, and logs audit action', async () => {
      mockExecute.mockResolvedValueOnce({}); // UPDATE users
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions
      mockExecute.mockResolvedValueOnce({}); // UPDATE refresh_tokens

      await deactivateUser(1, 5, true);

      expect(mockExecute).toHaveBeenCalledTimes(3);
      // Verify deactivation update
      expect(mockExecute.mock.calls[0][1][0]).toBe(true);
      expect(mockExecute.mock.calls[0][1][2]).toBe(5);
      // Verify audit action is 'deactivate'
      expect(mockExecute.mock.calls[1][1][1]).toBe('deactivate');
      // Verify token revocation
      expect(mockExecute.mock.calls[2][1]).toEqual([5]);
    });

    it('reactivates a user without revoking tokens', async () => {
      mockExecute.mockResolvedValueOnce({}); // UPDATE users
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      await deactivateUser(1, 5, false);

      expect(mockExecute).toHaveBeenCalledTimes(2);
      // Verify reactivation update passes null for deactivated_at
      expect(mockExecute.mock.calls[0][1][0]).toBe(false);
      expect(mockExecute.mock.calls[0][1][1]).toBeNull();
      // Verify audit action is 'reactivate'
      expect(mockExecute.mock.calls[1][1][1]).toBe('reactivate');
    });

    it('throws 400 SELF_ACTION when admin tries to deactivate self', async () => {
      try {
        await deactivateUser(3, 3, true);
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('SELF_ACTION');
      }
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── deleteUser ──────────────────────────────────────────────────────

  describe('deleteUser', () => {
    it('deletes user, logging audit action before deletion', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 5, username: 'victim' }]); // SELECT user
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions
      mockExecute.mockResolvedValueOnce({}); // DELETE FROM users

      await deleteUser(1, 5);

      expect(mockExecute).toHaveBeenCalledTimes(2);
      // Audit log before delete includes username
      expect(mockExecute.mock.calls[0][1]).toEqual([1, 'delete', 'user', 5, 'victim']);
      // Delete call
      expect(mockExecute.mock.calls[1][1]).toEqual([5]);
    });

    it('throws 404 NOT_FOUND if user does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      try {
        await deleteUser(1, 999);
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(404);
        expect((err as AppError).code).toBe('NOT_FOUND');
      }
    });

    it('throws 400 SELF_ACTION when admin tries to delete self', async () => {
      try {
        await deleteUser(3, 3);
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
        expect((err as AppError).code).toBe('SELF_ACTION');
      }
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // ── resetUserPassword ───────────────────────────────────────────────

  describe('resetUserPassword', () => {
    it('resets password, revokes tokens, and logs audit action', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 5, username: 'alice' }]);
      mockHashPassword.mockResolvedValueOnce('new_hashed_pw');
      mockExecute.mockResolvedValueOnce({}); // UPDATE password
      mockExecute.mockResolvedValueOnce({}); // UPDATE refresh_tokens
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      await resetUserPassword(1, 5, 'newpass123');

      expect(mockHashPassword).toHaveBeenCalledWith('newpass123');
      expect(mockExecute).toHaveBeenCalledTimes(3);
      // Password update
      expect(mockExecute.mock.calls[0][1]).toEqual(['new_hashed_pw', 5]);
      // Token revocation
      expect(mockExecute.mock.calls[1][1]).toEqual([5]);
      // Audit log includes username
      expect(mockExecute.mock.calls[2][1]).toEqual([1, 'reset_password', 'user', 5, 'alice']);
    });

    it('throws 404 NOT_FOUND if user does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      try {
        await resetUserPassword(1, 999, 'newpass');
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(404);
        expect((err as AppError).code).toBe('NOT_FOUND');
      }
    });
  });

  // ── getServerStats ──────────────────────────────────────────────────

  describe('getServerStats', () => {
    it('returns DB stats combined with active room/player counts', async () => {
      mockQuery.mockResolvedValueOnce([
        { totalUsers: 100, activeUsers24h: 15, totalMatches: 500 },
      ]);

      const mockEmit = jest.fn();
      const mockRoomsGet = jest.fn<AnyFn>();
      mockGetIO.mockReturnValue({
        emit: mockEmit,
        sockets: {
          adapter: {
            rooms: { get: mockRoomsGet },
          },
        },
      });

      const room1 = { code: 'ABC123' };
      const room2 = { code: 'DEF456' };
      mockGetRoomManager.mockReturnValue({
        getActiveRoomCount: () => 2,
        getAllRooms: () => [room1, room2],
      });

      // Socket room sizes
      mockRoomsGet.mockReturnValueOnce(new Set(['s1', 's2', 's3'])); // room:ABC123 has 3
      mockRoomsGet.mockReturnValueOnce(new Set(['s4'])); // room:DEF456 has 1

      const stats = await getServerStats();

      expect(stats).toEqual({
        totalUsers: 100,
        activeUsers24h: 15,
        totalMatches: 500,
        activeRooms: 2,
        activePlayers: 4,
      });
    });

    it('returns 0 for rooms/players when registry is not initialized', async () => {
      mockQuery.mockResolvedValueOnce([
        { totalUsers: 50, activeUsers24h: 5, totalMatches: 200 },
      ]);

      mockGetRoomManager.mockImplementation(() => {
        throw new Error('RoomManager not initialized');
      });

      const stats = await getServerStats();

      expect(stats).toEqual({
        totalUsers: 50,
        activeUsers24h: 5,
        totalMatches: 200,
        activeRooms: 0,
        activePlayers: 0,
      });
    });

    it('handles rooms with no sockets (undefined from rooms.get)', async () => {
      mockQuery.mockResolvedValueOnce([
        { totalUsers: 10, activeUsers24h: 1, totalMatches: 3 },
      ]);

      const mockRoomsGet = jest.fn<AnyFn>();
      mockGetIO.mockReturnValue({
        sockets: {
          adapter: {
            rooms: { get: mockRoomsGet },
          },
        },
      });

      mockGetRoomManager.mockReturnValue({
        getActiveRoomCount: () => 1,
        getAllRooms: () => [{ code: 'EMPTY1' }],
      });

      mockRoomsGet.mockReturnValueOnce(undefined); // no sockets in room

      const stats = await getServerStats();

      expect(stats.activePlayers).toBe(0);
      expect(stats.activeRooms).toBe(1);
    });
  });

  // ── getMatchHistory ─────────────────────────────────────────────────

  describe('getMatchHistory', () => {
    it('returns paginated match list', async () => {
      const matchRows = [
        {
          id: 1,
          room_code: 'ABC',
          game_mode: 'ffa',
          status: 'finished',
          duration: 120,
          started_at: new Date(),
          finished_at: new Date(),
          winner_username: 'alice',
          player_count: 4,
        },
      ];
      mockQuery.mockResolvedValueOnce(matchRows); // matches
      mockQuery.mockResolvedValueOnce([{ total: 50 }]); // count

      const result = await getMatchHistory(3, 10);

      expect(result).toEqual({ matches: matchRows, total: 50, page: 3, limit: 10 });
      // offset = (3-1)*10 = 20
      expect(mockQuery.mock.calls[0][1]).toEqual([10, 20]);
    });

    it('uses default page=1 and limit=20', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([{ total: 0 }]);

      const result = await getMatchHistory();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  // ── getMatchDetail ──────────────────────────────────────────────────

  describe('getMatchDetail', () => {
    const baseMatch = {
      id: 10,
      room_code: 'XYZ',
      game_mode: 'ffa',
      map_seed: 42,
      map_width: 13,
      map_height: 11,
      max_players: 4,
      status: 'finished',
      duration: 180,
      winner_id: 1,
      started_at: new Date('2025-06-01'),
      finished_at: new Date('2025-06-01'),
    };

    const playerRows = [
      {
        user_id: 1,
        username: 'alice',
        team: null,
        placement: 1,
        kills: 5,
        deaths: 0,
        bombs_placed: 20,
        powerups_collected: 8,
        survived_seconds: 180,
      },
      {
        user_id: 2,
        username: 'bob',
        team: null,
        placement: 2,
        kills: 2,
        deaths: 1,
        bombs_placed: 10,
        powerups_collected: 3,
        survived_seconds: 120,
      },
    ];

    it('returns match detail without replay', async () => {
      mockQuery.mockResolvedValueOnce([baseMatch]); // match
      mockQuery.mockResolvedValueOnce(playerRows); // players
      mockHasReplay.mockReturnValue(false);

      const result = await getMatchDetail(10);

      expect(result.id).toBe(10);
      expect(result.roomCode).toBe('XYZ');
      expect(result.gameMode).toBe('ffa');
      expect(result.hasReplay).toBe(false);
      expect(result.allPlayers).toBeNull();
      expect(result.players).toHaveLength(2);
      expect(result.players[0]).toEqual({
        userId: 1,
        username: 'alice',
        team: null,
        placement: 1,
        kills: 5,
        deaths: 0,
        bombsPlaced: 20,
        powerupsCollected: 8,
        survivedSeconds: 180,
      });
      expect(mockGetReplayPlacements).not.toHaveBeenCalled();
    });

    it('returns match detail with replay placements', async () => {
      mockQuery.mockResolvedValueOnce([baseMatch]);
      mockQuery.mockResolvedValueOnce(playerRows);
      mockHasReplay.mockReturnValue(true);
      const replayPlacements = [
        { userId: 1, username: 'alice', placement: 1, kills: 5 },
        { userId: -1, username: 'Bot1', placement: 3, kills: 1 },
      ];
      mockGetReplayPlacements.mockResolvedValueOnce(replayPlacements);

      const result = await getMatchDetail(10);

      expect(result.hasReplay).toBe(true);
      expect(result.allPlayers).toEqual(replayPlacements);
      expect(mockGetReplayPlacements).toHaveBeenCalledWith(10);
    });

    it('throws 404 NOT_FOUND if match does not exist', async () => {
      mockQuery.mockResolvedValueOnce([]);

      try {
        await getMatchDetail(999);
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(404);
        expect((err as AppError).code).toBe('NOT_FOUND');
      }
    });

    it('maps player rows to camelCase fields', async () => {
      mockQuery.mockResolvedValueOnce([baseMatch]);
      mockQuery.mockResolvedValueOnce([playerRows[1]]);
      mockHasReplay.mockReturnValue(false);

      const result = await getMatchDetail(10);

      expect(result.players[0].bombsPlaced).toBe(10);
      expect(result.players[0].powerupsCollected).toBe(3);
      expect(result.players[0].survivedSeconds).toBe(120);
    });
  });

  // ── getAdminActions ─────────────────────────────────────────────────

  describe('getAdminActions', () => {
    it('returns paginated admin actions without filter', async () => {
      const actionRows = [
        {
          id: 1,
          admin_id: 1,
          admin_username: 'admin',
          action: 'create_user',
          target_type: 'user',
          target_id: 5,
          details: 'newuser (user)',
          created_at: new Date(),
        },
      ];
      mockQuery.mockResolvedValueOnce(actionRows);
      mockQuery.mockResolvedValueOnce([{ total: 30 }]);

      const result = await getAdminActions(1, 20);

      expect(result).toEqual({ actions: actionRows, total: 30, page: 1, limit: 20 });
    });

    it('filters by action type when provided', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([{ total: 0 }]);

      await getAdminActions(1, 20, 'role_change');

      // Action query should include WHERE clause param
      expect(mockQuery.mock.calls[0][1]).toEqual(['role_change', 20, 0]);
      // Count query should also filter
      expect(mockQuery.mock.calls[1][1]).toEqual(['role_change']);
    });

    it('calculates correct offset for pagination', async () => {
      mockQuery.mockResolvedValueOnce([]);
      mockQuery.mockResolvedValueOnce([{ total: 0 }]);

      await getAdminActions(5, 10);

      // offset = (5-1)*10 = 40
      expect(mockQuery.mock.calls[0][1]).toEqual([10, 40]);
    });
  });

  // ── getActiveRooms ──────────────────────────────────────────────────

  describe('getActiveRooms', () => {
    it('returns mapped room list from lobby service', async () => {
      const rooms = [
        {
          code: 'ABC123',
          name: 'Fun Room',
          host: 'alice',
          playerCount: 3,
          maxPlayers: 4,
          gameMode: 'ffa',
          status: 'waiting' as const,
        },
      ];
      mockListRooms.mockResolvedValueOnce(rooms);

      const result = await getActiveRooms();

      expect(result).toEqual([
        {
          code: 'ABC123',
          name: 'Fun Room',
          host: 'alice',
          playerCount: 3,
          maxPlayers: 4,
          gameMode: 'ffa',
          status: 'waiting',
        },
      ]);
    });

    it('returns empty array when lobby service throws', async () => {
      mockListRooms.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await getActiveRooms();

      expect(result).toEqual([]);
    });

    it('returns empty array when no rooms exist', async () => {
      mockListRooms.mockResolvedValueOnce([]);

      const result = await getActiveRooms();

      expect(result).toEqual([]);
    });
  });

  // ── sendToast ───────────────────────────────────────────────────────

  describe('sendToast', () => {
    it('emits toast event and logs audit action', async () => {
      const mockEmit = jest.fn();
      mockGetIO.mockReturnValue({ emit: mockEmit });
      mockExecute.mockResolvedValueOnce({});

      await sendToast(1, 'Server maintenance in 10 minutes');

      expect(mockEmit).toHaveBeenCalledWith('admin:toast', {
        message: 'Server maintenance in 10 minutes',
      });
      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute.mock.calls[0][1]).toEqual([
        1,
        'toast',
        'broadcast',
        0,
        'Server maintenance in 10 minutes',
      ]);
    });

    it('throws 500 when IO is not available', async () => {
      mockGetIO.mockImplementation(() => {
        throw new Error('Socket.io server not initialized');
      });

      try {
        await sendToast(1, 'test');
        fail('Expected AppError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(500);
      }
      expect(mockExecute).not.toHaveBeenCalled();
    });
  });

  // ── setBanner ───────────────────────────────────────────────────────

  describe('setBanner', () => {
    it('deactivates existing banners, inserts new, emits, and logs', async () => {
      mockExecute.mockResolvedValueOnce({}); // UPDATE deactivate existing
      mockExecute.mockResolvedValueOnce({}); // INSERT new banner
      const mockEmit = jest.fn();
      mockGetIO.mockReturnValue({ emit: mockEmit });
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      await setBanner(1, 'Scheduled downtime tonight');

      expect(mockExecute).toHaveBeenCalledTimes(3);
      // First call: deactivate existing banners
      expect(mockExecute.mock.calls[0][0]).toContain('UPDATE announcements SET is_active = FALSE');
      // Second call: insert new banner
      expect(mockExecute.mock.calls[1][1]).toEqual([1, 'Scheduled downtime tonight']);
      // Socket emit
      expect(mockEmit).toHaveBeenCalledWith('admin:banner', {
        message: 'Scheduled downtime tonight',
      });
      // Audit log
      expect(mockExecute.mock.calls[2][1]).toEqual([
        1,
        'set_banner',
        'broadcast',
        0,
        'Scheduled downtime tonight',
      ]);
    });

    it('still saves banner and logs even if IO is not available', async () => {
      mockExecute.mockResolvedValueOnce({}); // UPDATE deactivate
      mockExecute.mockResolvedValueOnce({}); // INSERT banner
      mockGetIO.mockImplementation(() => {
        throw new Error('Socket.io server not initialized');
      });
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      await setBanner(1, 'test banner');

      // Should still have 3 execute calls (deactivate, insert, audit)
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });
  });

  // ── clearBanner ─────────────────────────────────────────────────────

  describe('clearBanner', () => {
    it('deactivates banners, emits null message, and logs', async () => {
      mockExecute.mockResolvedValueOnce({}); // UPDATE deactivate
      const mockEmit = jest.fn();
      mockGetIO.mockReturnValue({ emit: mockEmit });
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      await clearBanner(1);

      expect(mockExecute).toHaveBeenCalledTimes(2);
      // Deactivate existing banners
      expect(mockExecute.mock.calls[0][0]).toContain('UPDATE announcements SET is_active = FALSE');
      // Socket emit with null message
      expect(mockEmit).toHaveBeenCalledWith('admin:banner', { message: null });
      // Audit log
      expect(mockExecute.mock.calls[1][1]).toEqual([
        1,
        'clear_banner',
        'broadcast',
        0,
        null,
      ]);
    });

    it('still logs audit action even if IO is not available', async () => {
      mockExecute.mockResolvedValueOnce({}); // UPDATE deactivate
      mockGetIO.mockImplementation(() => {
        throw new Error('Socket.io server not initialized');
      });
      mockExecute.mockResolvedValueOnce({}); // INSERT admin_actions

      await clearBanner(1);

      expect(mockExecute).toHaveBeenCalledTimes(2);
      expect(mockExecute.mock.calls[1][1]).toEqual([
        1,
        'clear_banner',
        'broadcast',
        0,
        null,
      ]);
    });
  });

  // ── getActiveBanner ─────────────────────────────────────────────────

  describe('getActiveBanner', () => {
    it('returns active banner when one exists', async () => {
      const bannerRow = {
        id: 5,
        message: 'Welcome!',
        admin_username: 'admin',
        created_at: new Date('2025-06-01'),
      };
      mockQuery.mockResolvedValueOnce([bannerRow]);

      const result = await getActiveBanner();

      expect(result).toEqual(bannerRow);
    });

    it('returns null when no active banner exists', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await getActiveBanner();

      expect(result).toBeNull();
    });
  });
});
