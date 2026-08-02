import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { LogVerbosity, Position } from '@blast-arena/shared';
import { logger } from './logger';
import type { ReplayRecorder } from './replayRecorder';
import type { Player } from '../game/Player';
import type { Bomb } from '../game/Bomb';
import type { Explosion } from '../game/Explosion';

const LOG_DIR = process.env.GAME_LOG_DIR || '/app/gamelogs';

// Persistent rooms (open world) keep ticking with nobody in them. Without a gate they write a
// full tick stream 24/7 — historically 92% of this directory was telemetry for empty rooms.
// Mirrors OpenWorldManager.ACTIVITY_RECORD_WINDOW, which already gates the replay recorder.
const IDLE_LOG_WINDOW_TICKS = Number(process.env.GAME_LOG_IDLE_WINDOW_TICKS ?? 60); // 3s @ 20Hz

// Retention bounds. Deliberately generous: this is a safety net against unbounded growth, not an
// archiving policy. Automatic pruning only ever touches logs where nobody played (see
// EMPTY_ROOM_LOG_RE) — a log with real gameplay in it is never deleted on our own initiative.
const MAX_TOTAL_MB = Number(process.env.GAME_LOG_MAX_TOTAL_MB ?? 20480);
const MAX_AGE_DAYS = Number(process.env.GAME_LOG_MAX_AGE_DAYS ?? 365);
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

// Only "0 peak players" logs are prunable. The trailing count is rewritten on close to reflect the
// peak seen during the round, so this suffix means "nobody ever played", not merely "the room was
// empty when it opened" — persistent open-world rooms always open empty and fill up later.
const EMPTY_ROOM_LOG_RE = /_0p\.jsonl$/;

export interface GameLoggerOptions {
  logDir?: string;
  filename?: string;
  verbosity?: LogVerbosity;
}

export class GameLogger {
  private stream: fs.WriteStream;
  private roomCode: string;
  private filename: string;
  private verbosity: LogVerbosity;
  private lastActivityTick = 0;
  private logDir: string;
  private peakPlayerCount: number;
  private closed = false;
  private static lastPruneAt = 0;
  public replayRecorder: ReplayRecorder | null = null;

  constructor(
    roomCode: string,
    gameMode: string,
    playerCount: number,
    options?: GameLoggerOptions,
  ) {
    this.roomCode = roomCode;
    this.verbosity = options?.verbosity ?? 'normal';
    this.peakPlayerCount = playerCount;

    const logDir = options?.logDir ?? LOG_DIR;
    this.logDir = logDir;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    this.filename = options?.filename ?? `${ts}_${roomCode}_${gameMode}_${playerCount}p.jsonl`;

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.stream = fs.createWriteStream(path.join(logDir, this.filename), { flags: 'a' });

    this.log('game_init', { roomCode, gameMode, playerCount, verbosity: this.verbosity });

    // Never block room creation on housekeeping.
    setImmediate(() => void GameLogger.pruneOldLogs(logDir));
  }

  /**
   * Bound the log directory by age, then by total size (oldest first).
   *
   * Throttled to once per PRUNE_INTERVAL_MS per process, and never touches a file modified within
   * that same interval — which is what keeps every currently-open stream, including this room's
   * own file, safe from deletion.
   */
  private static async pruneOldLogs(logDir: string): Promise<void> {
    const now = Date.now();
    if (now - GameLogger.lastPruneAt < PRUNE_INTERVAL_MS) return;
    GameLogger.lastPruneAt = now;

    try {
      const names = await fsp.readdir(logDir);
      const entries: { file: string; mtimeMs: number; size: number }[] = [];

      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        // Never auto-delete a log that had players in it. Only empty rooms are disposable.
        if (!EMPTY_ROOM_LOG_RE.test(name)) continue;
        const file = path.join(logDir, name);
        try {
          const st = await fsp.stat(file);
          if (!st.isFile()) continue;
          // Anything touched recently may still be an open stream.
          if (now - st.mtimeMs < PRUNE_INTERVAL_MS) continue;
          entries.push({ file, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // Raced with another prune or a rotation; skip it.
        }
      }

      entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

      let total = entries.reduce((sum, e) => sum + e.size, 0);
      const maxTotalBytes = MAX_TOTAL_MB * 1024 * 1024;
      const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

      let removed = 0;
      let freed = 0;

      for (const entry of entries) {
        const tooOld = now - entry.mtimeMs > maxAgeMs;
        const overSize = total > maxTotalBytes;
        if (!tooOld && !overSize) break; // sorted oldest-first, so nothing later qualifies on age

        try {
          await fsp.unlink(entry.file);
          total -= entry.size;
          freed += entry.size;
          removed++;
        } catch {
          // Already gone; keep going.
        }
      }

      if (removed > 0) {
        logger.info(
          { removed, freedMB: Math.round(freed / 1024 / 1024), logDir },
          'Pruned old game logs',
        );
      }
    } catch (err) {
      // Housekeeping must never take a game down.
      logger.warn({ err, logDir }, 'Game log pruning failed');
    }
  }

  shouldLogTick(tick: number): boolean {
    if (this.verbosity === 'full') return true;
    if (this.verbosity === 'detailed') return tick % 2 === 0;
    return tick % 5 === 0;
  }

  log(event: string, data: Record<string, unknown>): void {
    const entry = { t: Date.now(), event, ...data };
    this.stream.write(JSON.stringify(entry) + '\n');
  }

  logTick(tick: number, players: Player[], bombs: Bomb[], explosions: Explosion[]): void {
    // Rooms can fill up after opening empty, so the peak drives the filename we settle on.
    if (players.length > this.peakPlayerCount) {
      this.peakPlayerCount = players.length;
    }

    // Persistent rooms keep ticking when empty. Record during activity and for a short window
    // after, then fall silent until something happens again.
    const active = players.length > 0 || bombs.length > 0 || explosions.length > 0;
    if (active) {
      this.lastActivityTick = tick;
    } else if (tick - this.lastActivityTick > IDLE_LOG_WINDOW_TICKS) {
      return;
    }

    const tickData = {
      t: Date.now(),
      event: 'tick',
      tick,
      players: players.map((p) => ({
        id: p.id,
        name: p.username,
        pos: p.position,
        alive: p.alive,
        kills: p.kills,
        selfKills: p.selfKills,
        dir: p.direction,
        shield: p.hasShield,
        kick: p.hasKick,
        fireRange: p.fireRange,
        speed: p.speed,
        cooldown: p.moveCooldown,
      })),
      bombs: bombs.map((b) => ({
        id: b.id.slice(0, 8),
        pos: b.position,
        owner: b.ownerId,
        fuse: b.ticksRemaining,
        slide: b.sliding,
      })),
      explosions: explosions.map((e) => ({
        id: e.id.slice(0, 8),
        owner: e.ownerId,
        fuse: e.ticksRemaining,
        cells: this.verbosity === 'full' ? e.cells : e.cells.length,
      })),
    };
    this.stream.write(JSON.stringify(tickData) + '\n');
  }

  logBotDecision(
    botId: number,
    botName: string,
    decision: string,
    details?: Record<string, unknown>,
  ): void {
    this.stream.write(
      JSON.stringify({
        t: Date.now(),
        event: 'bot_decision',
        botId,
        botName,
        decision,
        ...details,
      }) + '\n',
    );
    this.replayRecorder?.addLogEntry('bot_decision', {
      botId,
      botName,
      decision,
      ...details,
    });
  }

  logKill(
    killerId: number,
    killerName: string,
    victimId: number,
    victimName: string,
    selfKill: boolean,
  ): void {
    this.stream.write(
      JSON.stringify({
        t: Date.now(),
        event: 'kill',
        killerId,
        killerName,
        victimId,
        victimName,
        selfKill,
      }) + '\n',
    );
    this.replayRecorder?.addLogEntry('kill', {
      killerId,
      killerName,
      victimId,
      victimName,
      selfKill,
    });
  }

  logBomb(
    event: 'place' | 'detonate',
    ownerId: number,
    ownerName: string,
    pos: Position,
    fireRange?: number,
  ): void {
    this.stream.write(
      JSON.stringify({
        t: Date.now(),
        event: `bomb_${event}`,
        ownerId,
        ownerName,
        pos,
        fireRange,
      }) + '\n',
    );
    this.replayRecorder?.addLogEntry(event === 'place' ? 'bomb_place' : 'bomb_detonate', {
      ownerId,
      ownerName,
      pos,
      fireRange,
    });
  }

  logMovement(
    playerId: number,
    playerName: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    direction: string,
  ): void {
    // Always record movement in replay log regardless of verbosity
    this.replayRecorder?.addLogEntry('movement', {
      playerId,
      playerName,
      from,
      to,
      direction,
    });
    if (this.verbosity === 'normal') return;
    this.stream.write(
      JSON.stringify({
        t: Date.now(),
        event: 'movement',
        playerId,
        playerName,
        from,
        to,
        direction,
      }) + '\n',
    );
  }

  logPowerupPickup(
    playerId: number,
    playerName: string,
    type: string,
    position: { x: number; y: number },
  ): void {
    this.replayRecorder?.addLogEntry('powerup_pickup', {
      playerId,
      playerName,
      type,
      position,
    });
    if (this.verbosity === 'normal') return;
    this.stream.write(
      JSON.stringify({
        t: Date.now(),
        event: 'powerup_pickup',
        playerId,
        playerName,
        type,
        position,
      }) + '\n',
    );
  }

  logExplosionDetail(
    ownerId: number,
    ownerName: string,
    pos: { x: number; y: number },
    cells: { x: number; y: number }[],
    destroyedWalls: number,
    chainedBombs: number,
  ): void {
    this.replayRecorder?.addLogEntry('explosion_detail', {
      ownerId,
      ownerName,
      pos,
      cellCount: cells.length,
      destroyedWalls,
      chainedBombs,
    });
    if (this.verbosity !== 'full') return;
    this.stream.write(
      JSON.stringify({
        t: Date.now(),
        event: 'explosion_detail',
        ownerId,
        ownerName,
        pos,
        cells,
        destroyedWalls,
        chainedBombs,
      }) + '\n',
    );
  }

  logBotPathfinding(
    botId: number,
    botName: string,
    algorithm: string,
    pathLength: number,
    target: { x: number; y: number } | null,
  ): void {
    if (this.verbosity !== 'full') return;
    this.stream.write(
      JSON.stringify({
        t: Date.now(),
        event: 'bot_pathfinding',
        botId,
        botName,
        algorithm,
        pathLength,
        target,
      }) + '\n',
    );
  }

  logPlayerLeave(playerId: number, playerName: string): void {
    this.log('player_leave', { playerId, playerName });
    this.replayRecorder?.addLogEntry('player_leave', { playerId, playerName });
  }

  logPlayerDisconnect(playerId: number, playerName: string): void {
    this.log('player_disconnect', { playerId, playerName });
    this.replayRecorder?.addLogEntry('player_disconnect', { playerId, playerName });
  }

  logPlayerDisconnectKill(playerId: number, playerName: string): void {
    this.log('player_disconnect_kill', { playerId, playerName });
    this.replayRecorder?.addLogEntry('player_disconnect_kill', { playerId, playerName });
  }

  logGameOver(winnerId: number | null, placements: Record<string, unknown>[]): void {
    this.log('game_over', { winnerId, placements });
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stream.end(() => this.finalizeFilename());
  }

  /**
   * The filename records the player count at room creation, but persistent rooms open empty and
   * fill up later. Rewrite the trailing count to the peak actually observed, so that `_0p` really
   * does mean "nobody ever played" — which is the guarantee pruneOldLogs relies on.
   */
  private finalizeFilename(): void {
    const target = this.filename.replace(/_(\d+)p\.jsonl$/, `_${this.peakPlayerCount}p.jsonl`);
    if (target === this.filename) return;

    const from = path.join(this.logDir, this.filename);
    const to = path.join(this.logDir, target);
    fs.rename(from, to, (err) => {
      if (err) {
        logger.warn({ err, from: this.filename, to: target }, 'Could not finalize game log name');
        return;
      }
      this.filename = target;
    });
  }
}
