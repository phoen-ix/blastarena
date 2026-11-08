import { RowDataPacket } from 'mysql2';
import { query, execute, withTransaction } from '../db/connection';
import { CountRow } from '../db/types';
import {
  MapChallenge,
  MapChallengeSummary,
  ChallengeScore,
  ActiveChallengeInfo,
} from '@blast-arena/shared';
import { AppError } from '../middleware/errorHandler';
import * as settingsService from './settings';

interface ChallengeRow extends RowDataPacket {
  id: number;
  title: string;
  description: string;
  custom_map_id: number;
  game_mode: string;
  start_date: Date;
  end_date: Date;
  is_active: boolean;
  /** Null once the creator's account was deleted (migration 047). */
  created_by: number | null;
  created_at: Date;
}

interface ChallengeSummaryRow extends ChallengeRow {
  map_name: string;
  map_creator: string;
}

interface ScoreRow extends RowDataPacket {
  user_id: number;
  username: string;
  wins: number;
  kills: number;
  deaths: number;
  games_played: number;
  best_placement: number | null;
}

interface TilesRow extends RowDataPacket {
  /** JSON column: a string, or already an object depending on driver settings. */
  tiles: string | unknown;
}

/** JSON columns may arrive parsed or as text; same helper as services/custom-maps.ts. (audit B7) */
function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toSummary(row: ChallengeSummaryRow): MapChallengeSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    customMapId: row.custom_map_id,
    mapName: row.map_name,
    mapCreator: row.map_creator,
    gameMode: row.game_mode,
    startDate: row.start_date.toISOString().split('T')[0],
    endDate: row.end_date.toISOString().split('T')[0],
    isActive: !!row.is_active,
  };
}

function toScore(row: ScoreRow): ChallengeScore {
  return {
    userId: row.user_id,
    username: row.username,
    wins: row.wins,
    kills: row.kills,
    deaths: row.deaths,
    gamesPlayed: row.games_played,
    bestPlacement: row.best_placement,
  };
}

export async function getActiveChallenge(): Promise<MapChallengeSummary | null> {
  const rows = await query<ChallengeSummaryRow[]>(
    `SELECT mc.*, cm.name as map_name, u.username as map_creator
     FROM map_challenges mc
     JOIN custom_maps cm ON mc.custom_map_id = cm.id
     JOIN users u ON cm.created_by = u.id
     WHERE mc.is_active = TRUE
     LIMIT 1`,
  );
  return rows.length > 0 ? toSummary(rows[0]) : null;
}

export async function listChallenges(
  page: number = 1,
  limit: number = 20,
): Promise<{ challenges: MapChallengeSummary[]; total: number }> {
  const offset = (page - 1) * limit;
  const [rows, countRows] = await Promise.all([
    query<ChallengeSummaryRow[]>(
      `SELECT mc.*, cm.name as map_name, u.username as map_creator
       FROM map_challenges mc
       JOIN custom_maps cm ON mc.custom_map_id = cm.id
       JOIN users u ON cm.created_by = u.id
       ORDER BY mc.start_date DESC, mc.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    ),
    query<CountRow[]>('SELECT COUNT(*) as total FROM map_challenges'),
  ]);
  return { challenges: rows.map(toSummary), total: countRows[0].total };
}

function assertDateRange(startDate: string, endDate: string): void {
  if (new Date(endDate) <= new Date(startDate)) {
    throw new AppError('End date must be after start date', 400, 'INVALID_DATE_RANGE');
  }
}

/**
 * A challenge is played by creating a room on its map, so the map must exist and be published.
 * An unknown id used to fail the foreign key and answer 500.
 */
async function assertPlayableMap(customMapId: number): Promise<void> {
  const rows = await query<(RowDataPacket & { is_published: number | boolean })[]>(
    'SELECT is_published FROM custom_maps WHERE id = ?',
    [customMapId],
  );
  if (rows.length === 0) throw new AppError('Map not found', 400, 'MAP_NOT_FOUND');
  if (!rows[0].is_published) {
    throw new AppError('The map must be published', 400, 'MAP_NOT_PUBLISHED');
  }
}

function notFound(): AppError {
  return new AppError('Challenge not found', 404, 'NOT_FOUND');
}

export async function createChallenge(
  title: string,
  description: string,
  customMapId: number,
  gameMode: string,
  startDate: string,
  endDate: string,
  createdBy: number,
): Promise<MapChallenge> {
  assertDateRange(startDate, endDate);
  await assertPlayableMap(customMapId);
  const result = await execute(
    `INSERT INTO map_challenges (title, description, custom_map_id, game_mode, start_date, end_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [title, description, customMapId, gameMode, startDate, endDate, createdBy],
  );
  return {
    id: result.insertId,
    title,
    description,
    customMapId,
    gameMode,
    startDate,
    endDate,
    isActive: false,
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

export async function updateChallenge(
  id: number,
  updates: {
    title?: string;
    description?: string;
    customMapId?: number;
    gameMode?: string;
    startDate?: string;
    endDate?: string;
  },
): Promise<void> {
  const existing = await query<ChallengeRow[]>(
    'SELECT start_date, end_date FROM map_challenges WHERE id = ?',
    [id],
  );
  if (existing.length === 0) throw notFound();
  // A partial update can move either end of the range, so check it against the stored other end
  if (updates.startDate !== undefined || updates.endDate !== undefined) {
    assertDateRange(
      updates.startDate ?? existing[0].start_date.toISOString().split('T')[0],
      updates.endDate ?? existing[0].end_date.toISOString().split('T')[0],
    );
  }
  if (updates.customMapId !== undefined) await assertPlayableMap(updates.customMapId);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push('title = ?');
    params.push(updates.title);
  }
  if (updates.description !== undefined) {
    sets.push('description = ?');
    params.push(updates.description);
  }
  // Validated by the route, then dropped here: changing a challenge's map did nothing
  if (updates.customMapId !== undefined) {
    sets.push('custom_map_id = ?');
    params.push(updates.customMapId);
  }
  if (updates.gameMode !== undefined) {
    sets.push('game_mode = ?');
    params.push(updates.gameMode);
  }
  if (updates.startDate !== undefined) {
    sets.push('start_date = ?');
    params.push(updates.startDate);
  }
  if (updates.endDate !== undefined) {
    sets.push('end_date = ?');
    params.push(updates.endDate);
  }

  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE map_challenges SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteChallenge(id: number): Promise<void> {
  const result = await execute('DELETE FROM map_challenges WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw notFound();
}

export async function activateChallenge(id: number): Promise<void> {
  await withTransaction(async (conn) => {
    // Checked before anything changes: an unknown id used to switch off the active challenge and
    // switch on nothing, still answering 200.
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM map_challenges WHERE id = ? FOR UPDATE',
      [id],
    );
    if (rows.length === 0) throw notFound();
    await conn.execute('UPDATE map_challenges SET is_active = FALSE');
    await conn.execute('UPDATE map_challenges SET is_active = TRUE WHERE id = ?', [id]);
  });
}

export async function deactivateChallenge(id: number): Promise<void> {
  const rows = await query<RowDataPacket[]>('SELECT id FROM map_challenges WHERE id = ?', [id]);
  if (rows.length === 0) throw notFound();
  await execute('UPDATE map_challenges SET is_active = FALSE WHERE id = ?', [id]);
}

/**
 * Adds one match to a player's score on a challenge.
 *
 * Nothing is recorded unless challenges are enabled (`challenges_enabled`), the challenge is
 * active, today (UTC) lies within its start and end dates (DATE columns, both days inclusive)
 * and — when `opts.gameMode` is given — the match was played in the challenge's game mode. These
 * were all ignored: a challenge counted every mode on its map, before its start, after its end
 * and while challenges were switched off. Without `opts.gameMode` the mode is not checked (older
 * callers). A placement that is missing or below 1 is not a placement and leaves
 * `best_placement` untouched (the caller's `|| 0` made 0 everyone's best). Bot ids (≤ 0) are never
 * written.
 */
export async function recordChallengeResult(
  challengeId: number,
  userId: number,
  isWinner: boolean,
  kills: number,
  deaths: number,
  placement: number | null | undefined,
  opts?: { gameMode?: string },
): Promise<void> {
  if (userId <= 0) return;
  if ((await settingsService.getSetting('challenges_enabled')) === 'false') return;
  const bestPlacement = placement != null && placement >= 1 ? placement : null;
  const gameMode = opts?.gameMode ?? null;
  const todayUtc = new Date().toISOString().slice(0, 10);
  // The conditions live in the INSERT's SELECT, so a challenge that does not qualify inserts
  // nothing, in one round-trip.
  await execute(
    `INSERT INTO challenge_scores (challenge_id, user_id, wins, kills, deaths, games_played, best_placement)
     SELECT mc.id, ?, ?, ?, ?, 1, ?
     FROM map_challenges mc
     WHERE mc.id = ? AND mc.is_active = TRUE
       AND ? BETWEEN mc.start_date AND mc.end_date
       AND (? IS NULL OR mc.game_mode = ?)
     ON DUPLICATE KEY UPDATE
       wins = wins + VALUES(wins),
       kills = kills + VALUES(kills),
       deaths = deaths + VALUES(deaths),
       games_played = games_played + 1,
       best_placement = CASE
         WHEN VALUES(best_placement) IS NULL THEN best_placement
         WHEN best_placement IS NULL THEN VALUES(best_placement)
         WHEN VALUES(best_placement) < best_placement THEN VALUES(best_placement)
         ELSE best_placement
       END`,
    [
      userId,
      isWinner ? 1 : 0,
      kills,
      deaths,
      bestPlacement,
      challengeId,
      todayUtc,
      gameMode,
      gameMode,
    ],
  );
}

export async function getActiveChallengeInfo(): Promise<ActiveChallengeInfo | null> {
  const challenge = await getActiveChallenge();
  if (!challenge) return null;

  // Get map tiles
  const mapRows = await query<TilesRow[]>('SELECT tiles FROM custom_maps WHERE id = ?', [
    challenge.customMapId,
  ]);
  // mysql2 may hand a JSON column back already parsed (an object), in which case JSON.parse
  // throws — every other service goes through safeJsonParse for this reason. This one sat behind
  // the unauthenticated GET /challenges/active. (audit B7)
  const mapTiles =
    mapRows.length > 0 ? safeJsonParse<string[][] | null>(mapRows[0].tiles, null) : null;

  // Get top 5 scores
  const topRows = await query<ScoreRow[]>(
    `SELECT cs.user_id, u.username, cs.wins, cs.kills, cs.deaths, cs.games_played, cs.best_placement
     FROM challenge_scores cs
     JOIN users u ON cs.user_id = u.id
     WHERE cs.challenge_id = ?
     ORDER BY cs.wins DESC, cs.kills DESC, cs.deaths ASC, cs.id ASC
     LIMIT 5`,
    [challenge.id],
  );

  return {
    challenge,
    mapTiles,
    topScores: topRows.map(toScore),
  };
}
