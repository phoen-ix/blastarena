import { RowDataPacket } from 'mysql2';
import { query, execute, withTransaction } from '../db/connection';
import { CountRow } from '../db/types';
import {
  MapChallenge,
  MapChallengeSummary,
  ChallengeScore,
  ChallengeLeaderboardResponse,
  ActiveChallengeInfo,
} from '@blast-arena/shared';

interface ChallengeRow extends RowDataPacket {
  id: number;
  title: string;
  description: string;
  custom_map_id: number;
  game_mode: string;
  start_date: Date;
  end_date: Date;
  is_active: boolean;
  created_by: number;
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
  tiles: string;
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
       ORDER BY mc.start_date DESC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    ),
    query<CountRow[]>('SELECT COUNT(*) as total FROM map_challenges'),
  ]);
  return { challenges: rows.map(toSummary), total: countRows[0].total };
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
  if (new Date(endDate) <= new Date(startDate)) {
    throw new Error('End date must be after start date');
  }
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
    gameMode?: string;
    startDate?: string;
    endDate?: string;
  },
): Promise<void> {
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
  await execute('DELETE FROM map_challenges WHERE id = ?', [id]);
}

export async function activateChallenge(id: number): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.execute('UPDATE map_challenges SET is_active = FALSE');
    await conn.execute('UPDATE map_challenges SET is_active = TRUE WHERE id = ?', [id]);
  });
}

export async function deactivateChallenge(id: number): Promise<void> {
  await execute('UPDATE map_challenges SET is_active = FALSE WHERE id = ?', [id]);
}

export async function getChallengeLeaderboard(
  challengeId: number,
  page: number = 1,
  limit: number = 20,
): Promise<ChallengeLeaderboardResponse> {
  const offset = (page - 1) * limit;
  const [rows, countRows] = await Promise.all([
    query<ScoreRow[]>(
      `SELECT cs.user_id, u.username, cs.wins, cs.kills, cs.deaths, cs.games_played, cs.best_placement
       FROM challenge_scores cs
       JOIN users u ON cs.user_id = u.id
       WHERE cs.challenge_id = ?
       ORDER BY cs.wins DESC, cs.kills DESC, cs.deaths ASC
       LIMIT ? OFFSET ?`,
      [challengeId, limit, offset],
    ),
    query<CountRow[]>('SELECT COUNT(*) as total FROM challenge_scores WHERE challenge_id = ?', [
      challengeId,
    ]),
  ]);
  return {
    scores: rows.map(toScore),
    total: countRows[0].total,
    page,
    limit,
  };
}

export async function recordChallengeResult(
  challengeId: number,
  userId: number,
  isWinner: boolean,
  kills: number,
  deaths: number,
  placement: number,
): Promise<void> {
  await execute(
    `INSERT INTO challenge_scores (challenge_id, user_id, wins, kills, deaths, games_played, best_placement)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       wins = wins + VALUES(wins),
       kills = kills + VALUES(kills),
       deaths = deaths + VALUES(deaths),
       games_played = games_played + 1,
       best_placement = CASE
         WHEN best_placement IS NULL THEN VALUES(best_placement)
         WHEN VALUES(best_placement) < best_placement THEN VALUES(best_placement)
         ELSE best_placement
       END`,
    [challengeId, userId, isWinner ? 1 : 0, kills, deaths, placement],
  );
}

export async function getActiveChallengeInfo(): Promise<ActiveChallengeInfo | null> {
  const challenge = await getActiveChallenge();
  if (!challenge) return null;

  // Get map tiles
  const mapRows = await query<TilesRow[]>('SELECT tiles FROM custom_maps WHERE id = ?', [
    challenge.customMapId,
  ]);
  const mapTiles = mapRows.length > 0 ? (JSON.parse(mapRows[0].tiles) as string[][]) : null;

  // Get top 5 scores
  const topRows = await query<ScoreRow[]>(
    `SELECT cs.user_id, u.username, cs.wins, cs.kills, cs.deaths, cs.games_played, cs.best_placement
     FROM challenge_scores cs
     JOIN users u ON cs.user_id = u.id
     WHERE cs.challenge_id = ?
     ORDER BY cs.wins DESC, cs.kills DESC
     LIMIT 5`,
    [challenge.id],
  );

  return {
    challenge,
    mapTiles,
    topScores: topRows.map(toScore),
  };
}
