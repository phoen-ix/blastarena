import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { ReplayData, ReplayListItem } from '@blast-arena/shared';
import { query } from '../db/connection';
import { MatchRow } from '../db/types';
import { logger } from '../utils/logger';

const gunzip = promisify(zlib.gunzip);
const REPLAY_DIR = process.env.REPLAY_DIR || '/app/replays';

export async function listReplays(
  page: number = 1,
  limit: number = 20,
): Promise<{ replays: ReplayListItem[]; total: number }> {
  try {
    await fs.promises.access(REPLAY_DIR);
  } catch {
    return { replays: [], total: 0 };
  }

  const allFiles = await fs.promises.readdir(REPLAY_DIR);
  const files = allFiles.filter((f) => f.endsWith('.replay.json.gz'));

  // Parse match IDs from filenames
  const fileMap = new Map<number, { filename: string; sizeKB: number }>();
  const statPromises: Promise<void>[] = [];
  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (match) {
      const matchId = parseInt(match[1]);
      statPromises.push(
        fs.promises.stat(path.join(REPLAY_DIR, file)).then((stat) => {
          fileMap.set(matchId, { filename: file, sizeKB: Math.round(stat.size / 1024) });
        }),
      );
    }
  }
  await Promise.all(statPromises);

  if (fileMap.size === 0) {
    return { replays: [], total: 0 };
  }

  const matchIds = Array.from(fileMap.keys());
  const placeholders = matchIds.map(() => '?').join(',');

  const rows = await query<MatchRow[]>(
    `SELECT m.id, m.room_code, m.game_mode, m.duration,
            (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id = m.id) as player_count,
            u.username as winner_username, m.started_at
     FROM matches m
     LEFT JOIN users u ON m.winner_id = u.id
     WHERE m.id IN (${placeholders})
     ORDER BY m.started_at DESC`,
    matchIds,
  );

  const total = rows.length;
  const offset = (page - 1) * limit;
  const paged = rows.slice(offset, offset + limit);

  const replays: ReplayListItem[] = paged.map((row) => {
    const file = fileMap.get(row.id)!;
    return {
      matchId: row.id,
      roomCode: row.room_code,
      gameMode: row.game_mode,
      duration: row.duration || 0,
      playerCount: row.player_count,
      winnerName: row.winner_username,
      createdAt:
        row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
      fileSizeKB: file.sizeKB,
    };
  });

  return { replays, total };
}

export async function getReplay(matchId: number): Promise<ReplayData | null> {
  const filePath = findReplayFile(matchId);
  if (!filePath) return null;

  try {
    const compressed = fs.readFileSync(filePath);
    const decompressed = await gunzip(compressed);
    return JSON.parse(decompressed.toString()) as ReplayData;
  } catch (err) {
    logger.error({ err, matchId }, 'Failed to read replay file');
    return null;
  }
}

export function deleteReplay(matchId: number): boolean {
  const filePath = findReplayFile(matchId);
  if (!filePath) return false;

  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    logger.error({ err, matchId }, 'Failed to delete replay file');
    return false;
  }
}

export function hasReplay(matchId: number): boolean {
  return findReplayFile(matchId) !== null;
}

/**
 * Get just the placements from a replay file (lightweight read for match detail).
 * Returns null if no replay exists.
 */
export async function getReplayPlacements(
  matchId: number,
): Promise<ReplayData['gameOver']['placements'] | null> {
  const filePath = findReplayFile(matchId);
  if (!filePath) return null;

  try {
    const compressed = fs.readFileSync(filePath);
    const decompressed = await gunzip(compressed);
    const data = JSON.parse(decompressed.toString()) as ReplayData;
    return data.gameOver?.placements || null;
  } catch (err) {
    logger.error({ err, matchId }, 'Failed to read replay placements');
    return null;
  }
}

function findReplayFile(matchId: number): string | null {
  if (!fs.existsSync(REPLAY_DIR)) return null;

  const files = fs.readdirSync(REPLAY_DIR);
  const prefix = `${matchId}_`;
  const file = files.find((f) => f.startsWith(prefix) && f.endsWith('.replay.json.gz'));
  if (!file) return null;

  return path.join(REPLAY_DIR, file);
}
