import type { RowDataPacket } from 'mysql2';
import { query, execute, withTransaction } from '../db/connection';
import { SeasonRow, CountRow } from '../db/types';
import { Season } from '@blast-arena/shared';
import { AppError } from '../middleware/errorHandler';

function toSeason(row: SeasonRow): Season {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date.toISOString().split('T')[0],
    endDate: row.end_date.toISOString().split('T')[0],
    isActive: !!row.is_active, // TINYINT(1): 0/1 from the driver
  };
}

function notFound(): AppError {
  return new AppError('Season not found', 404, 'NOT_FOUND');
}

function assertDateRange(startDate: string, endDate: string): void {
  if (new Date(endDate) <= new Date(startDate)) {
    throw new AppError('End date must be after start date', 400, 'INVALID_DATE_RANGE');
  }
}

export async function getActiveSeason(): Promise<Season | null> {
  const rows = await query<SeasonRow[]>('SELECT * FROM seasons WHERE is_active = TRUE LIMIT 1');
  return rows.length > 0 ? toSeason(rows[0]) : null;
}

export async function getSeasons(
  page: number = 1,
  limit: number = 20,
): Promise<{ seasons: Season[]; total: number }> {
  const offset = (page - 1) * limit;
  const [rows, countRows] = await Promise.all([
    query<SeasonRow[]>('SELECT * FROM seasons ORDER BY start_date DESC, id DESC LIMIT ? OFFSET ?', [
      limit,
      offset,
    ]),
    query<CountRow[]>('SELECT COUNT(*) as total FROM seasons'),
  ]);
  return { seasons: rows.map(toSeason), total: countRows[0].total };
}

export async function getSeasonById(id: number): Promise<Season | null> {
  const rows = await query<SeasonRow[]>('SELECT * FROM seasons WHERE id = ?', [id]);
  return rows.length > 0 ? toSeason(rows[0]) : null;
}

export async function createSeason(
  name: string,
  startDate: string,
  endDate: string,
): Promise<Season> {
  assertDateRange(startDate, endDate);

  const result = await execute(
    'INSERT INTO seasons (name, start_date, end_date) VALUES (?, ?, ?)',
    [name, startDate, endDate],
  );

  return { id: result.insertId, name, startDate, endDate, isActive: false };
}

export async function updateSeason(
  id: number,
  updates: { name?: string; startDate?: string; endDate?: string },
): Promise<void> {
  const existing = await query<SeasonRow[]>('SELECT * FROM seasons WHERE id = ?', [id]);
  if (existing.length === 0) throw notFound();
  // Either end can move on its own; check it against the stored other end (it wasn't checked)
  if (updates.startDate !== undefined || updates.endDate !== undefined) {
    const current = toSeason(existing[0]);
    assertDateRange(updates.startDate ?? current.startDate, updates.endDate ?? current.endDate);
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    params.push(updates.name);
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
  await execute(`UPDATE seasons SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteSeason(id: number): Promise<void> {
  const rows = await query<SeasonRow[]>('SELECT is_active FROM seasons WHERE id = ?', [id]);
  if (rows.length === 0) throw notFound();
  // Deleting the running season dropped its ratings mid-season and left no season active.
  if (rows[0].is_active) {
    throw new AppError('End the active season before deleting it', 409, 'SEASON_ACTIVE');
  }
  const result = await execute('DELETE FROM seasons WHERE id = ? AND is_active = FALSE', [id]);
  if (result.affectedRows === 0) throw notFound();
}

/**
 * Starts a season. Refused while another season is active (409: end it first, which applies the
 * hard/soft reset — switching straight over used to skip the reset) and for a season whose end
 * date has passed (400: re-activating an ended season resumed it on its stale season_elo rows).
 * Activating the season that is already active changes nothing.
 */
export async function activateSeason(id: number): Promise<void> {
  const todayUtc = new Date().toISOString().slice(0, 10);
  await withTransaction(async (conn) => {
    // Checked before anything changes: an unknown id switched every season off and none on.
    const [found] = await conn.execute<RowDataPacket[]>(
      'SELECT id, is_active, end_date < ? AS has_ended FROM seasons WHERE id = ? FOR UPDATE',
      [todayUtc, id],
    );
    if (found.length === 0) throw notFound();
    if (found[0].is_active) return;
    if (found[0].has_ended) {
      throw new AppError('This season has already ended', 400, 'SEASON_ENDED');
    }
    const [active] = await conn.execute<RowDataPacket[]>(
      'SELECT id FROM seasons WHERE is_active = TRUE FOR UPDATE',
    );
    if (active.length > 0) {
      throw new AppError(
        'Another season is active; end it before activating this one',
        409,
        'SEASON_ALREADY_ACTIVE',
      );
    }
    await conn.execute('UPDATE seasons SET is_active = TRUE WHERE id = ?', [id]);
    // Every player starts the season on their current (already reset) global rating
    await conn.execute(
      `INSERT IGNORE INTO season_elo (user_id, season_id, elo_rating, peak_elo)
       SELECT us.user_id, ?, us.elo_rating, us.elo_rating FROM user_stats us`,
      [id],
    );
  });
}

export async function endSeason(id: number, resetMode: 'hard' | 'soft'): Promise<void> {
  await withTransaction(async (conn) => {
    // Only the active season can end. Ending an unknown or already ended one used to reset every
    // player's Elo all the same.
    const [found] = await conn.execute<RowDataPacket[]>(
      'SELECT is_active FROM seasons WHERE id = ? FOR UPDATE',
      [id],
    );
    if (found.length === 0) throw notFound();
    if (!found[0].is_active) {
      throw new AppError('Only the active season can be ended', 409, 'SEASON_NOT_ACTIVE');
    }
    await conn.execute('UPDATE seasons SET is_active = FALSE WHERE id = ?', [id]);

    if (resetMode === 'hard') {
      await conn.execute('UPDATE user_stats SET elo_rating = 1000');
    } else {
      // Soft reset: compress toward 1000
      await conn.execute(
        'UPDATE user_stats SET elo_rating = ROUND(1000 + (elo_rating - 1000) * 0.5)',
      );
    }
    // No peak_elo update: a reset only moves ratings toward 1000, peak_elo starts at 1000 and
    // never falls below elo_rating, so GREATEST(peak_elo, elo_rating) here could not change a row.
  });
}

export async function getUserSeasonHistory(userId: number): Promise<
  {
    seasonId: number;
    seasonName: string;
    finalElo: number;
    peakElo: number;
    matchesPlayed: number;
  }[]
> {
  const rows = await query<
    (SeasonRow & { elo_rating: number; peak_elo: number; matches_played: number })[]
  >(
    `SELECT s.id, s.name, se.elo_rating, se.peak_elo, se.matches_played
     FROM season_elo se
     JOIN seasons s ON s.id = se.season_id
     WHERE se.user_id = ?
     ORDER BY s.start_date DESC`,
    [userId],
  );

  return rows.map((r) => ({
    seasonId: r.id,
    seasonName: r.name,
    finalElo: r.elo_rating,
    peakElo: r.peak_elo,
    matchesPlayed: r.matches_played,
  }));
}
