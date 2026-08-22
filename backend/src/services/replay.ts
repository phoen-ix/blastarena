import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { ReplayData, ReplayListItem, CampaignReplayListItem } from '@blast-arena/shared';
import { query, execute } from '../db/connection';
import { MatchRow, CountRow } from '../db/types';
import { RowDataPacket } from 'mysql2';
import { logger } from '../utils/logger';

const gunzip = promisify(zlib.gunzip);
const REPLAY_DIR = process.env.REPLAY_DIR || '/app/replays';

export async function listReplays(
  page: number = 1,
  limit: number = 20,
): Promise<{ replays: ReplayListItem[]; total: number }> {
  // Previously this stat()ed EVERY file in the directory via Promise.all and built a
  // `WHERE m.id IN (?,?,…)` with one placeholder per replay before slicing to the requested page —
  // thousands of concurrent filesystem calls and a thousands-parameter prepared statement to
  // return twenty rows. Match ids are auto-increment, so ordering by id descending matches the
  // previous `ORDER BY m.started_at DESC`; paginate first, then touch only the page.
  // (audit REPLAY-LIST-1)
  const { byMatchId } = await getReplayIndex();
  if (byMatchId.size === 0) return { replays: [], total: 0 };

  const matchIds = [...byMatchId.keys()].sort((a, b) => b - a);
  const total = matchIds.length;

  const offset = Math.max(0, (page - 1) * limit);
  const pageIds = matchIds.slice(offset, offset + limit);
  if (pageIds.length === 0) return { replays: [], total };

  const placeholders = pageIds.map(() => '?').join(',');
  const rows = await query<MatchRow[]>(
    `SELECT m.id, m.room_code, m.game_mode, m.duration,
            (SELECT COUNT(*) FROM match_players mp WHERE mp.match_id = m.id) as player_count,
            u.username as winner_username, m.started_at
     FROM matches m
     LEFT JOIN users u ON m.winner_id = u.id
     WHERE m.id IN (${placeholders})
     ORDER BY m.id DESC`,
    pageIds,
  );

  // Stat only the page's files, not the whole directory.
  const sizes = new Map<number, number>();
  await Promise.all(
    rows.map(async (row) => {
      const name = byMatchId.get(row.id);
      if (!name) return;
      try {
        const st = await fs.promises.stat(path.join(REPLAY_DIR, name));
        sizes.set(row.id, Math.round(st.size / 1024));
      } catch {
        // Raced with a delete or a prune; report it as unknown size rather than failing the list.
      }
    }),
  );

  const replays: ReplayListItem[] = rows.map((row) => ({
    matchId: row.id,
    roomCode: row.room_code,
    gameMode: row.game_mode,
    duration: row.duration || 0,
    playerCount: row.player_count,
    winnerName: row.winner_username,
    createdAt:
      row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
    fileSizeKB: sizes.get(row.id) ?? 0,
  }));

  return { replays, total };
}

export async function getReplay(matchId: number): Promise<ReplayData | null> {
  const filePath = await findReplayFile(matchId);
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

export async function deleteReplay(matchId: number): Promise<boolean> {
  const index = await getReplayIndex();
  const name = index.byMatchId.get(matchId);
  if (!name) return false;

  try {
    await fs.promises.unlink(path.join(REPLAY_DIR, name));
    // Keep the cached listing in step, so deleting N matches costs one directory read, not N.
    index.byMatchId.delete(matchId);
    return true;
  } catch (err) {
    logger.error({ err, matchId }, 'Failed to delete replay file');
    index.byMatchId.delete(matchId);
    return false;
  }
}

export async function hasReplay(matchId: number): Promise<boolean> {
  return (await findReplayFile(matchId)) !== null;
}

/**
 * Get just the placements from a replay file (lightweight read for match detail).
 * Returns null if no replay exists.
 */
export async function getReplayPlacements(
  matchId: number,
): Promise<ReplayData['gameOver']['placements'] | null> {
  const filePath = await findReplayFile(matchId);
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

/**
 * Cached index of the replay directory.
 *
 * Replay lookups used to call `fs.readdirSync(REPLAY_DIR)` on EVERY call — a synchronous read of
 * the whole directory (5.5k entries on a modest deployment) on the single thread that also runs
 * the 20Hz game loop for every active room. `DELETE /admin/matches` made that quadratic: it pulls
 * up to 100k matches and calls deleteReplay per match, i.e. one full blocking scan each. One admin
 * cleanup froze every live game.
 *
 * The listing is now read asynchronously, once, and reused for a short window. Deletes update the
 * index in place so a bulk delete never re-reads the directory. (audit REPLAY-SCAN-1)
 */
const REPLAY_INDEX_TTL_MS = 5000;

interface ReplayIndex {
  builtAt: number;
  /** matchId -> filename, for `{matchId}_{roomCode}_{gameMode}.replay.json.gz` */
  byMatchId: Map<number, string>;
  /** sessionId -> filename, for `campaign_{sessionId}.replay.json.gz` */
  byCampaignSession: Map<string, string>;
}

let replayIndex: ReplayIndex | null = null;

/** Drop the cached listing so the next lookup re-reads the directory. */
export function invalidateReplayIndex(): void {
  replayIndex = null;
}

async function getReplayIndex(): Promise<ReplayIndex> {
  const now = Date.now();
  if (replayIndex && now - replayIndex.builtAt < REPLAY_INDEX_TTL_MS) return replayIndex;

  const byMatchId = new Map<number, string>();
  const byCampaignSession = new Map<string, string>();

  try {
    const names = await fs.promises.readdir(REPLAY_DIR);
    for (const name of Array.isArray(names) ? names : []) {
      if (!name.endsWith('.replay.json.gz')) continue;
      const campaign = /^campaign_(.+)\.replay\.json\.gz$/.exec(name);
      if (campaign) {
        byCampaignSession.set(campaign[1], name);
        continue;
      }
      const match = /^(\d+)_/.exec(name);
      if (match) byMatchId.set(parseInt(match[1], 10), name);
    }
  } catch {
    // Directory missing or unreadable — an empty index is the right answer, not an error.
  }

  replayIndex = { builtAt: now, byMatchId, byCampaignSession };
  return replayIndex;
}

async function findReplayFile(matchId: number): Promise<string | null> {
  const { byMatchId } = await getReplayIndex();
  const file = byMatchId.get(matchId);
  return file ? path.join(REPLAY_DIR, file) : null;
}

// --- Campaign Replays ---

export async function saveCampaignReplayRecord(record: {
  sessionId: string;
  userId: number;
  levelId: number;
  duration: number;
  result: 'completed' | 'failed';
  stars: number;
  coopMode: boolean;
  buddyMode: boolean;
  filename: string;
}): Promise<void> {
  await execute(
    `INSERT INTO campaign_replays (session_id, user_id, level_id, duration, result, stars, coop_mode, buddy_mode, filename)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.sessionId,
      record.userId,
      record.levelId,
      record.duration,
      record.result,
      record.stars,
      record.coopMode,
      record.buddyMode,
      record.filename,
    ],
  );
}

interface CampaignReplayRow extends RowDataPacket {
  session_id: string;
  level_id: number;
  level_name: string;
  world_name: string;
  user_id: number;
  username: string;
  coop_mode: boolean | number;
  buddy_mode: boolean | number;
  duration: number;
  result: 'completed' | 'failed';
  stars: number;
  filename: string;
  created_at: Date | string;
}

export async function listCampaignReplays(
  page: number = 1,
  limit: number = 20,
  userId?: number,
  levelId?: number,
): Promise<{ replays: CampaignReplayListItem[]; total: number }> {
  const conditions: string[] = [];
  const params: (number | string)[] = [];

  if (userId) {
    conditions.push('cr.user_id = ?');
    params.push(userId);
  }
  if (levelId) {
    conditions.push('cr.level_id = ?');
    params.push(levelId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRows = await query<CountRow[]>(
    `SELECT COUNT(*) as total FROM campaign_replays cr ${where}`,
    params,
  );
  const total = countRows[0]?.total ?? 0;

  const offset = (page - 1) * limit;
  const rows = await query<CampaignReplayRow[]>(
    `SELECT cr.session_id, cr.level_id, cl.name as level_name, cw.name as world_name,
            cr.user_id, u.username, cr.coop_mode, cr.buddy_mode, cr.duration,
            cr.result, cr.stars, cr.filename, cr.created_at
     FROM campaign_replays cr
     JOIN campaign_levels cl ON cr.level_id = cl.id
     JOIN campaign_worlds cw ON cl.world_id = cw.id
     JOIN users u ON cr.user_id = u.id
     ${where}
     ORDER BY cr.created_at DESC, cr.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  // Look up file sizes
  const replays: CampaignReplayListItem[] = [];
  for (const row of rows) {
    let fileSizeKB = 0;
    try {
      const stat = await fs.promises.stat(path.join(REPLAY_DIR, row.filename));
      fileSizeKB = Math.round(stat.size / 1024);
    } catch {
      // File may have been deleted
    }
    replays.push({
      sessionId: row.session_id,
      levelId: row.level_id,
      levelName: row.level_name,
      worldName: row.world_name,
      userId: row.user_id,
      username: row.username,
      coopMode: !!row.coop_mode,
      buddyMode: !!row.buddy_mode,
      duration: row.duration,
      result: row.result,
      stars: row.stars,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      fileSizeKB,
    });
  }

  return { replays, total };
}

export async function getCampaignReplay(sessionId: string): Promise<ReplayData | null> {
  const filePath = await findCampaignReplayFile(sessionId);
  if (!filePath) return null;

  try {
    const compressed = await fs.promises.readFile(filePath);
    const decompressed = await gunzip(compressed);
    return JSON.parse(decompressed.toString()) as ReplayData;
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to read campaign replay file');
    return null;
  }
}

export async function deleteCampaignReplay(sessionId: string): Promise<boolean> {
  const filePath = await findCampaignReplayFile(sessionId);
  if (filePath) {
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to delete campaign replay file');
    }
  }
  await execute(`DELETE FROM campaign_replays WHERE session_id = ?`, [sessionId]);
  return true;
}

async function findCampaignReplayFile(sessionId: string): Promise<string | null> {
  const { byCampaignSession } = await getReplayIndex();
  const file = byCampaignSession.get(sessionId);
  return file ? path.join(REPLAY_DIR, file) : null;
}
