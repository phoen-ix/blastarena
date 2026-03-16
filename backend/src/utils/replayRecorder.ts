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
  TICK_RATE,
} from '@blast-arena/shared';
import { logger } from './logger';

const REPLAY_DIR = process.env.REPLAY_DIR || '/app/replays';

interface TickEvents {
  explosions: { cells: { x: number; y: number }[]; ownerId: number }[];
  playerDied: { playerId: number; killerId: number | null }[];
  powerupCollected: {
    playerId: number;
    type: string;
    position: { x: number; y: number };
  }[];
}

export class ReplayRecorder {
  private roomCode: string;
  private gameMode: string;
  private matchId: number = 0;
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
      tickEvents.powerupCollected.length > 0
    ) {
      events = {
        explosions: tickEvents.explosions,
        playerDied: tickEvents.playerDied,
        powerupCollected: tickEvents.powerupCollected,
      };
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

  finalize(gameOverData: {
    winnerId: number | null;
    winnerTeam: number | null;
    reason: string;
    placements: any[];
  }): void {
    if (this.matchId === 0) {
      logger.warn({ roomCode: this.roomCode }, 'ReplayRecorder: matchId not set, skipping save');
      return;
    }

    const replayData: ReplayData = {
      version: 1,
      matchId: this.matchId,
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
    };

    // Write to disk asynchronously
    try {
      if (!fs.existsSync(REPLAY_DIR)) {
        fs.mkdirSync(REPLAY_DIR, { recursive: true });
      }

      const filename = `${this.matchId}_${this.roomCode}_${this.gameMode}.replay.json.gz`;
      const filePath = path.join(REPLAY_DIR, filename);
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
