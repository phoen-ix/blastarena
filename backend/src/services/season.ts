import { query, execute, withTransaction } from '../db/connection';
import { SeasonRow, CountRow } from '../db/types';
import { Season } from '@blast-arena/shared';

function toSeason(row: SeasonRow): Season {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date.toISOString().split('T')[0],
    endDate: row.end_date.toISOString().split('T')[0],
    isActive: row.is_active,
  };
}

export async function getActiveSeason(): Promise<Season | null> {
  const rows = await query<SeasonRow[]>(
    'SELECT * FROM seasons WHERE is_active = TRUE LIMIT 1',
  );
  return rows.length > 0 ? toSeason(rows[0]) : null;
}

export async function getSeasons(page: number = 1, limit: number = 20): Promise<{ seasons: Season[]; total: number }> {
  const offset = (page - 1) * limit;
  const [rows, countRows] = await Promise.all([
    query<SeasonRow[]>(
      'SELECT * FROM seasons ORDER BY start_date DESC LIMIT ? OFFSET ?',
      [limit, offset],
    ),
    query<CountRow[]>('SELECT COUNT(*) as total FROM seasons'),
  ]);
  return { seasons: rows.map(toSeason), total: countRows[0].total };
}

export async function getSeasonById(id: number): Promise<Season | null> {
  const rows = await query<SeasonRow[]>('SELECT * FROM seasons WHERE id = ?', [id]);
  return rows.length > 0 ? toSeason(rows[0]) : null;
}

export async function createSeason(name: string, startDate: string, endDate: string): Promise<Season> {
  if (new Date(endDate) <= new Date(startDate)) {
    throw new Error('End date must be after start date');
  }

  const result = await execute(
    'INSERT INTO seasons (name, start_date, end_date) VALUES (?, ?, ?)',
    [name, startDate, endDate],
  );

  return { id: result.insertId, name, startDate, endDate, isActive: false };
}

export async function updateSeason(id: number, updates: { name?: string; startDate?: string; endDate?: string }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.startDate !== undefined) { sets.push('start_date = ?'); params.push(updates.startDate); }
  if (updates.endDate !== undefined) { sets.push('end_date = ?'); params.push(updates.endDate); }

  if (sets.length === 0) return;
  params.push(id);
  await execute(`UPDATE seasons SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteSeason(id: number): Promise<void> {
  await execute('DELETE FROM seasons WHERE id = ?', [id]);
}

export async function activateSeason(id: number): Promise<void> {
  await withTransaction(async (conn) => {
    // Deactivate all seasons
    await conn.execute('UPDATE seasons SET is_active = FALSE');
    // Activate target
    await conn.execute('UPDATE seasons SET is_active = TRUE WHERE id = ?', [id]);
    // Create season_elo rows for all existing users
    await conn.execute(
      `INSERT IGNORE INTO season_elo (user_id, season_id, elo_rating, peak_elo)
       SELECT us.user_id, ?, us.elo_rating, us.elo_rating FROM user_stats us`,
      [id],
    );
  });
}

export async function endSeason(id: number, resetMode: 'hard' | 'soft'): Promise<void> {
  await withTransaction(async (conn) => {
    await conn.execute('UPDATE seasons SET is_active = FALSE WHERE id = ?', [id]);

    if (resetMode === 'hard') {
      await conn.execute('UPDATE user_stats SET elo_rating = 1000');
    } else {
      // Soft reset: compress toward 1000
      await conn.execute(
        'UPDATE user_stats SET elo_rating = ROUND(1000 + (elo_rating - 1000) * 0.5)',
      );
    }

    // Update peak_elo to not be below new rating
    await conn.execute(
      'UPDATE user_stats SET peak_elo = GREATEST(peak_elo, elo_rating)',
    );
  });
}

export async function getUserSeasonHistory(userId: number): Promise<{
  seasonId: number; seasonName: string; finalElo: number; peakElo: number; matchesPlayed: number;
}[]> {
  const rows = await query<(SeasonRow & { elo_rating: number; peak_elo: number; matches_played: number })[]>(
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
