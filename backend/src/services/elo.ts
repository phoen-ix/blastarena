import { query, execute, withTransaction } from '../db/connection';
import { EloResult } from '@blast-arena/shared';
import { SeasonRow } from '../db/types';
import { RowDataPacket } from 'mysql2';

interface PlayerEloInput {
  userId: number;
  placement: number;
  team: number | null;
  isWinner: boolean;
}

interface EloRow extends RowDataPacket {
  elo_rating: number;
  matches_played: number;
}

export function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function getKFactor(matchesPlayed: number): number {
  return matchesPlayed < 30 ? 32 : 16;
}

export function calculateFfaElo(
  players: { userId: number; placement: number; currentElo: number; matchesPlayed: number }[],
): EloResult[] {
  const n = players.length;
  if (n < 2) return [];

  return players.map((player) => {
    const K = getKFactor(player.matchesPlayed);
    let expectedTotal = 0;
    let actualTotal = 0;

    for (const opponent of players) {
      if (opponent.userId === player.userId) continue;
      expectedTotal += calculateExpectedScore(player.currentElo, opponent.currentElo);
      // Better placement = lower number = win against this opponent
      if (player.placement < opponent.placement) {
        actualTotal += 1;
      } else if (player.placement === opponent.placement) {
        actualTotal += 0.5;
      }
    }

    const delta = Math.round(K * (actualTotal - expectedTotal));
    const newElo = Math.max(0, player.currentElo + delta);

    return {
      userId: player.userId,
      oldElo: player.currentElo,
      newElo,
      delta: newElo - player.currentElo,
    };
  });
}

export function calculateTeamElo(
  winners: { userId: number; currentElo: number; matchesPlayed: number }[],
  losers: { userId: number; currentElo: number; matchesPlayed: number }[],
): EloResult[] {
  if (winners.length === 0 || losers.length === 0) return [];

  const avgWinnerElo = winners.reduce((s, p) => s + p.currentElo, 0) / winners.length;
  const avgLoserElo = losers.reduce((s, p) => s + p.currentElo, 0) / losers.length;

  const results: EloResult[] = [];

  for (const player of winners) {
    const K = getKFactor(player.matchesPlayed);
    const expected = calculateExpectedScore(avgWinnerElo, avgLoserElo);
    const delta = Math.round(K * (1 - expected));
    const newElo = Math.max(0, player.currentElo + delta);
    results.push({ userId: player.userId, oldElo: player.currentElo, newElo, delta: newElo - player.currentElo });
  }

  for (const player of losers) {
    const K = getKFactor(player.matchesPlayed);
    const expected = calculateExpectedScore(avgLoserElo, avgWinnerElo);
    const delta = Math.round(K * (0 - expected));
    const newElo = Math.max(0, player.currentElo + delta);
    results.push({ userId: player.userId, oldElo: player.currentElo, newElo, delta: newElo - player.currentElo });
  }

  return results;
}

async function getActiveSeason(): Promise<SeasonRow | null> {
  const rows = await query<SeasonRow[]>(
    'SELECT * FROM seasons WHERE is_active = TRUE LIMIT 1',
  );
  return rows.length > 0 ? rows[0] : null;
}

async function applyEloResults(
  results: EloResult[],
  matchId: number,
  gameMode: string,
  seasonId: number | null,
): Promise<void> {
  if (results.length === 0) return;

  await withTransaction(async (conn) => {
    for (const r of results) {
      // Update global elo + peak
      await conn.execute(
        `UPDATE user_stats SET elo_rating = ?, peak_elo = GREATEST(peak_elo, ?) WHERE user_id = ?`,
        [r.newElo, r.newElo, r.userId],
      );

      // Update season elo if active season
      if (seasonId) {
        await conn.execute(
          `INSERT INTO season_elo (user_id, season_id, elo_rating, peak_elo, matches_played)
           VALUES (?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
             elo_rating = ?,
             peak_elo = GREATEST(peak_elo, ?),
             matches_played = matches_played + 1`,
          [r.userId, seasonId, r.newElo, r.newElo, r.newElo, r.newElo],
        );
      }

      // Record history
      await conn.execute(
        `INSERT INTO elo_history (user_id, match_id, season_id, old_elo, new_elo, delta, game_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [r.userId, matchId, seasonId, r.oldElo, r.newElo, r.delta, gameMode],
      );
    }
  });
}

export async function processMatchElo(
  gameMode: string,
  players: PlayerEloInput[],
  matchId: number,
): Promise<EloResult[]> {
  // Filter out bots (negative IDs)
  const humanPlayers = players.filter((p) => p.userId > 0);
  if (humanPlayers.length < 2) return [];

  // Fetch current Elo for all players
  const userIds = humanPlayers.map((p) => p.userId);
  const placeholders = userIds.map(() => '?').join(',');
  const eloRows = await query<(EloRow & { user_id: number })[]>(
    `SELECT user_id, elo_rating, total_matches as matches_played FROM user_stats WHERE user_id IN (${placeholders})`,
    userIds,
  );

  const eloMap = new Map(eloRows.map((r) => [r.user_id, { elo: r.elo_rating ?? 1000, matches: r.matches_played ?? 0 }]));

  const season = await getActiveSeason();
  let results: EloResult[];

  if (gameMode === 'teams') {
    // Team mode: split into winners and losers by team
    const winnerTeam = humanPlayers.find((p) => p.isWinner)?.team;
    if (winnerTeam == null) return [];

    const winners = humanPlayers
      .filter((p) => p.team === winnerTeam)
      .map((p) => {
        const data = eloMap.get(p.userId) ?? { elo: 1000, matches: 0 };
        return { userId: p.userId, currentElo: data.elo, matchesPlayed: data.matches };
      });
    const losers = humanPlayers
      .filter((p) => p.team !== winnerTeam)
      .map((p) => {
        const data = eloMap.get(p.userId) ?? { elo: 1000, matches: 0 };
        return { userId: p.userId, currentElo: data.elo, matchesPlayed: data.matches };
      });

    results = calculateTeamElo(winners, losers);
  } else {
    // FFA-style modes: pairwise comparison
    const ffaPlayers = humanPlayers.map((p) => {
      const data = eloMap.get(p.userId) ?? { elo: 1000, matches: 0 };
      return { userId: p.userId, placement: p.placement, currentElo: data.elo, matchesPlayed: data.matches };
    });

    results = calculateFfaElo(ffaPlayers);
  }

  await applyEloResults(results, matchId, gameMode, season?.id ?? null);

  return results;
}
