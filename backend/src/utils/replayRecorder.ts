import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import {
  GameState,
  TileType,
  ReplayData,
  ReplayFrame,
  ReplayLogEntry,
  ReplayLogEventType,
  ReplayTileDiff,
  ReplayTickEvents,
  CampaignReplayMeta,
  CampaignEnemyState,
  TICK_RATE,
} from '@blast-arena/shared';
import { logger } from './logger';

const REPLAY_DIR = process.env.REPLAY_DIR || '/app/replays';

// Retention bounds for the replay directory.
//
// Game logs gained an age+size bound (see gameLogger), but replays had none: one gzipped file was
// written per finished match, forever, removed only by an explicit admin delete, and the
// data/replays bind mount has no Docker-level rotation either. A modest deployment had already
// accumulated 5.5k files. Deliberately generous — a safety net against unbounded growth, not an
// archiving policy. (audit REPLAY-RETENTION-1)
const REPLAY_MAX_TOTAL_MB = Number(process.env.REPLAY_MAX_TOTAL_MB ?? 10240);
const REPLAY_MAX_AGE_DAYS = Number(process.env.REPLAY_MAX_AGE_DAYS ?? 365);
const REPLAY_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

// Only multiplayer match replays are prunable. Campaign replays (`campaign_<sessionId>...`) are
// referenced by rows in campaign_replays and surfaced in the admin UI, so deleting the file behind
// a live row would leave a broken entry — those are removed through deleteCampaignReplay only.
const MATCH_REPLAY_RE = /^\d+_.*\.replay\.json\.gz$/;

let lastReplayPruneAt = 0;

/**
 * Bound the replay directory by age, then by total size, oldest first.
 * Housekeeping must never take a game down, so every failure here is swallowed.
 */
export async function pruneOldReplays(dir: string): Promise<void> {
  const now = Date.now();
  if (now - lastReplayPruneAt < REPLAY_PRUNE_INTERVAL_MS) return;
  lastReplayPruneAt = now;

  try {
    const names = await fs.promises.readdir(dir);
    const entries: { file: string; mtimeMs: number; size: number }[] = [];

    for (const name of names) {
      if (!MATCH_REPLAY_RE.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = await fs.promises.stat(file);
        if (!st.isFile()) continue;
        // Anything just written may still be in flight.
        if (now - st.mtimeMs < REPLAY_PRUNE_INTERVAL_MS) continue;
        entries.push({ file, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // Raced with a delete; skip it.
      }
    }

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

    let total = entries.reduce((sum, e) => sum + e.size, 0);
    const maxTotalBytes = REPLAY_MAX_TOTAL_MB * 1024 * 1024;
    const maxAgeMs = REPLAY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    let removed = 0;
    let freed = 0;
    for (const entry of entries) {
      const tooOld = now - entry.mtimeMs > maxAgeMs;
      const overSize = total > maxTotalBytes;
      if (!tooOld && !overSize) break; // sorted oldest-first, so nothing later qualifies on age

      try {
        await fs.promises.unlink(entry.file);
        total -= entry.size;
        freed += entry.size;
        removed++;
      } catch {
        // Already gone; keep going.
      }
    }

    if (removed > 0) {
      logger.info({ removed, freedMB: Math.round(freed / 1024 / 1024), dir }, 'Pruned old replays');
    }
  } catch (err) {
    logger.warn({ err, dir }, 'Replay pruning failed');
  }
}

/**
 * Placement entries differ by game type (multiplayer, campaign, simulation, open world),
 * so the recorder accepts any JSON-serializable placement objects.
 */
type ReplayGameOverData = Omit<ReplayData['gameOver'], 'placements'> & {
  placements: Record<string, unknown>[];
};

type RecordedReplayData = Omit<ReplayData, 'gameOver'> & { gameOver: ReplayGameOverData };

interface TickEvents {
  explosions: { cells: { x: number; y: number }[]; ownerId: number }[];
  playerDied: { playerId: number; killerId: number | null }[];
  powerupCollected: {
    playerId: number;
    type: string;
    position: { x: number; y: number };
  }[];
  bombThrown: {
    bombId: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
  }[];
}

export class ReplayRecorder {
  private roomCode: string;
  private gameMode: string;
  private matchId: number = 0;
  private sessionId?: string;
  private campaignMeta?: CampaignReplayMeta;
  private initialState: GameState;
  private previousTiles: TileType[][];
  private frames: ReplayFrame[] = [];
  private logEntries: ReplayLogEntry[] = [];
  private currentTick: number = 0;

  constructor(roomCode: string, gameMode: string, initialState: GameState) {
    this.roomCode = roomCode;
    this.gameMode = gameMode;

    // Deep copy the initial state's map so we preserve the original tiles
    // (the game engine mutates tiles in-place as walls are destroyed)
    this.initialState = {
      ...initialState,
      map: {
        ...initialState.map,
        tiles: initialState.map.tiles.map((row) => [...row]),
        spawnPoints: [...initialState.map.spawnPoints],
      },
    };

    // Deep copy initial tiles for diff tracking
    this.previousTiles = initialState.map.tiles.map((row) => [...row]);
  }

  setMatchId(id: number): void {
    this.matchId = id;
  }

  setSessionId(id: string): void {
    this.sessionId = id;
  }

  setCampaignMeta(meta: CampaignReplayMeta): void {
    this.campaignMeta = meta;
  }

  getFilename(): string {
    return this.matchId === 0 && this.sessionId
      ? `campaign_${this.sessionId}.replay.json.gz`
      : `${this.matchId}_${this.roomCode}_${this.gameMode}.replay.json.gz`;
  }

  recordCampaignData(data: {
    enemies?: CampaignEnemyState[];
    lives?: number;
    exitOpen?: boolean;
  }): void {
    if (this.frames.length === 0) return;
    const lastFrame = this.frames[this.frames.length - 1];
    if (data.enemies) lastFrame.enemies = data.enemies;
    if (data.lives !== undefined) lastFrame.lives = data.lives;
    if (data.exitOpen !== undefined) lastFrame.exitOpen = data.exitOpen;
  }

  recordTick(state: GameState, tickEvents: TickEvents): void {
    this.currentTick = state.tick;

    // Compute tile diffs
    let tileDiffs: ReplayTileDiff[] | undefined;
    const currentTiles = state.map.tiles;
    for (let y = 0; y < currentTiles.length; y++) {
      for (let x = 0; x < currentTiles[y].length; x++) {
        if (currentTiles[y][x] !== this.previousTiles[y][x]) {
          if (!tileDiffs) tileDiffs = [];
          tileDiffs.push({ x, y, type: currentTiles[y][x] });
          this.previousTiles[y][x] = currentTiles[y][x];
        }
      }
    }

    // Build tick events if any occurred
    let events: ReplayTickEvents | undefined;
    if (
      tickEvents.explosions.length > 0 ||
      tickEvents.playerDied.length > 0 ||
      tickEvents.powerupCollected.length > 0 ||
      tickEvents.bombThrown.length > 0
    ) {
      events = {
        explosions: tickEvents.explosions,
        playerDied: tickEvents.playerDied,
        powerupCollected: tickEvents.powerupCollected,
      };
      if (tickEvents.bombThrown.length > 0) {
        events.bombThrown = tickEvents.bombThrown;
      }
    }

    const frame: ReplayFrame = {
      tick: state.tick,
      players: state.players,
      bombs: state.bombs,
      explosions: state.explosions,
      powerUps: state.powerUps,
      status: state.status,
      winnerId: state.winnerId,
      winnerTeam: state.winnerTeam,
      roundTime: state.roundTime,
      timeElapsed: state.timeElapsed,
    };

    if (state.zone) frame.zone = state.zone;
    if (state.hillZone) frame.hillZone = state.hillZone;
    if (state.kothScores) frame.kothScores = state.kothScores;
    if (state.mapEvents) frame.mapEvents = state.mapEvents;
    if (tileDiffs) frame.tileDiffs = tileDiffs;
    if (events) frame.events = events;

    this.frames.push(frame);
  }

  addLogEntry(event: ReplayLogEventType, data: Record<string, unknown>): void {
    this.logEntries.push({
      tick: this.currentTick,
      event,
      data,
    });
  }

  finalize(gameOverData: ReplayGameOverData, options?: { saveDir?: string }): void {
    const saveDir = options?.saveDir;

    if (!saveDir && this.matchId === 0 && !this.sessionId) {
      logger.warn(
        { roomCode: this.roomCode },
        'ReplayRecorder: matchId/sessionId not set, skipping save',
      );
      return;
    }

    const replayData: RecordedReplayData = {
      version: 1,
      matchId: this.matchId,
      sessionId: this.sessionId,
      roomCode: this.roomCode,
      gameMode: this.gameMode,
      config: {
        mapWidth: this.initialState.map.width,
        mapHeight: this.initialState.map.height,
        roundTime: this.initialState.roundTime,
      },
      gameOver: gameOverData,
      map: this.initialState.map,
      totalTicks: this.frames.length > 0 ? this.frames[this.frames.length - 1].tick : 0,
      tickRate: TICK_RATE,
      frames: this.frames,
      log: this.logEntries,
      campaign: this.campaignMeta,
    };

    // Write to disk asynchronously
    try {
      const dir = saveDir || REPLAY_DIR;
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const filename =
        this.matchId === 0 && this.sessionId
          ? `campaign_${this.sessionId}.replay.json.gz`
          : `${this.matchId}_${this.roomCode}_${this.gameMode}.replay.json.gz`;
      const filePath = path.join(dir, filename);
      const frameCount = this.frames.length;
      const json = JSON.stringify(replayData);

      zlib.gzip(Buffer.from(json), (err, compressed) => {
        if (err) {
          logger.error({ err, matchId: this.matchId }, 'Failed to compress replay');
          return;
        }
        fs.writeFile(filePath, compressed, (writeErr) => {
          if (writeErr) {
            logger.error({ err: writeErr, matchId: this.matchId }, 'Failed to write replay file');
          } else {
            const sizeKB = Math.round(compressed.length / 1024);
            logger.info(
              { matchId: this.matchId, filePath, sizeKB, frames: frameCount },
              'Replay saved',
            );
            // Bound the directory. Rate-limited internally, and never blocks the write.
            setImmediate(() => void pruneOldReplays(dir));
          }
        });
      });
    } catch (err) {
      logger.error({ err, matchId: this.matchId }, 'Failed to save replay');
    }

    // Free memory
    this.frames = [];
    this.logEntries = [];
  }
}
