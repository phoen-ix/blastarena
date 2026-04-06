import { Server } from 'socket.io';
import {
  GameState as GameStateType,
  PlayerInput,
  TICK_RATE,
  OPENWORLD_DEFAULT_ROUND_TIME,
  OPENWORLD_DEFAULT_MAX_PLAYERS,
  OPENWORLD_GUEST_ID_START,
  OPENWORLD_ROUND_FREEZE_TICKS,
  OPENWORLD_JOIN_INVULNERABILITY_TICKS,
  OPENWORLD_STATS_FLUSH_TICKS,
  OPENWORLD_INFO_BROADCAST_TICKS,
  OPENWORLD_MAX_PLAYERS_CAP,
  OpenWorldScoreEntry,
} from '@blast-arena/shared';
import { GameStateManager, GameConfig } from './GameState';
import { GameLoop } from './GameLoop';
import { OpenWorldSettings, getOpenWorldSettings, isOpenWorldEnabled } from '../services/settings';
import { logger } from '../utils/logger';
import { GameLogger } from '../utils/gameLogger';
import { ReplayRecorder } from '../utils/replayRecorder';
import { execute } from '../db/connection';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@blast-arena/shared';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

interface OpenWorldPlayer {
  socketId: string;
  userId: number;
  username: string;
  isGuest: boolean;
  joinTick: number;
  kills: number;
  deaths: number;
  score: number;
}

// Pending stat updates for batched DB writes
interface PendingStats {
  kills: number;
  deaths: number;
  xp: number;
}

const ADJECTIVES = [
  'Swift',
  'Brave',
  'Fiery',
  'Shadow',
  'Storm',
  'Iron',
  'Frost',
  'Blaze',
  'Ghost',
  'Dusk',
  'Dawn',
  'Ember',
  'Thunder',
  'Steel',
  'Wild',
  'Crimson',
];

class OpenWorldManager {
  private io: TypedServer | null = null;
  private gameState: GameStateManager | null = null;
  private gameLoop: GameLoop | null = null;
  private players: Map<number, OpenWorldPlayer> = new Map();
  private socketToPlayer: Map<string, number> = new Map();
  private guestCounter: number = 0;
  private roundNumber: number = 1;
  private settings: OpenWorldSettings | null = null;
  private enabled: boolean = false;
  private freezeTick: number | null = null;

  // Batched stat tracking
  private pendingStats: Map<number, PendingStats> = new Map();
  private lastStatsFlushTick: number = 0;

  // Replay recording (only active ticks)
  private replayRecorder: ReplayRecorder | null = null;
  private lastActivityTick: number = 0;
  private static readonly ACTIVITY_RECORD_WINDOW = 60; // Record 3s after last activity

  async init(io: TypedServer): Promise<void> {
    this.io = io;
    const enabled = await isOpenWorldEnabled();
    if (!enabled) {
      logger.info('Open world disabled by admin setting');
      this.enabled = false;
      return;
    }

    this.settings = await getOpenWorldSettings();
    this.enabled = true;
    this.startNewRound();
    logger.info(
      {
        mapSize: `${this.settings.mapWidth}x${this.settings.mapHeight}`,
        roundTime: this.settings.roundTime,
        maxPlayers: this.settings.maxPlayers,
      },
      'Open world initialized',
    );
  }

  private startNewRound(): void {
    if (!this.settings || !this.io) return;

    const config: GameConfig = {
      mapWidth: this.settings.mapWidth,
      mapHeight: this.settings.mapHeight,
      gameMode: 'open_world',
      roundTime: this.settings.roundTime,
      wallDensity: this.settings.wallDensity,
      wrapping: true,
      isOpenWorld: true,
      enabledPowerUps: [
        'bomb_up',
        'fire_up',
        'speed_up',
        'shield',
        'kick',
        'pierce_bomb',
        'remote_bomb',
        'line_bomb',
        'bomb_throw',
      ],
    };

    this.gameState = new GameStateManager(config);
    this.gameState.status = 'playing';

    if (this.settings.respawnDelay) {
      this.gameState.openWorldRespawnTicks = this.settings.respawnDelay * TICK_RATE;
    }

    // Re-add all connected players to the new game state
    for (const [playerId, playerData] of this.players) {
      const player = this.gameState.addPlayerLive(playerId, playerData.username);
      player.invulnerableTicks = OPENWORLD_JOIN_INVULNERABILITY_TICKS;
      player.remoteDetonateMode = 'fifo';
      // Reset per-round tracking
      playerData.kills = 0;
      playerData.deaths = 0;
      playerData.score = 0;
      playerData.joinTick = 0;
    }

    this.freezeTick = null;
    this.lastStatsFlushTick = 0;
    this.lastActivityTick = 0;

    // Set up replay recording for this round
    const initialState = this.gameState.toState();
    this.replayRecorder = new ReplayRecorder(
      `openworld_r${this.roundNumber}`,
      'open_world',
      initialState,
    );
    this.replayRecorder.setSessionId(`openworld_r${this.roundNumber}_${Date.now()}`);

    const gameLogger = new GameLogger(
      `openworld_r${this.roundNumber}`,
      'open_world',
      this.players.size,
      { verbosity: 'full' },
    );
    gameLogger.replayRecorder = this.replayRecorder;
    this.gameState.gameLogger = gameLogger;

    this.gameLoop = new GameLoop(
      this.gameState,
      (state) => this.onTick(state),
      () => {}, // Open world never calls onGameOver
      TICK_RATE,
      true, // skip countdown
    );
    this.gameLoop.start();
  }

  private onTick(state: GameStateType): void {
    if (!this.gameState || !this.io) return;

    const tick = this.gameState.tick;

    // Broadcast discrete game events for EffectSystem (sounds, screen shake)
    for (const explosion of this.gameState.tickEvents.explosions) {
      this.io.to('openworld').emit('game:explosion', explosion);
    }
    for (const thrown of this.gameState.tickEvents.bombThrown) {
      this.io.to('openworld').emit('game:bombThrown', thrown);
    }
    for (const pickup of this.gameState.tickEvents.powerupCollected) {
      this.io.to('openworld').emit('game:powerupCollected', pickup);
    }

    // Process kill events for live scoring + broadcast
    if (this.gameState.tickEvents.playerDied.length > 0) {
      for (const event of this.gameState.tickEvents.playerDied) {
        // Broadcast kill event for HUD kill feed
        this.io.to('openworld').emit('game:playerDied', event);

        const victim = this.players.get(event.playerId);
        if (victim) {
          victim.deaths++;
          victim.score = Math.max(0, victim.score - 1);
        }
        if (event.killerId !== null && event.killerId !== event.playerId) {
          const killer = this.players.get(event.killerId);
          if (killer) {
            killer.kills++;
            killer.score += 2;
            // Queue stats for registered players
            if (!killer.isGuest && killer.userId > 0) {
              this.queueStatUpdate(killer.userId, 'kill');
            }
          }
        }
        if (victim && !victim.isGuest && victim.userId > 0) {
          this.queueStatUpdate(victim.userId, 'death');
        }
      }
    }

    // Record replay frame when there's activity (inputs update lastActivityTick in handleInput)
    if (this.replayRecorder) {
      // Events (explosions, deaths) also extend the recording window
      const hasEvents =
        this.gameState.tickEvents.explosions.length > 0 ||
        this.gameState.tickEvents.playerDied.length > 0 ||
        this.gameState.tickEvents.powerupCollected.length > 0 ||
        this.gameState.tickEvents.bombThrown.length > 0;

      if (hasEvents) {
        this.lastActivityTick = tick;
      }

      // Record during activity and for a short window after
      if (tick - this.lastActivityTick <= OpenWorldManager.ACTIVITY_RECORD_WINDOW) {
        this.replayRecorder.recordTick(
          { ...state, map: { ...state.map, tiles: this.gameState.map.tiles } },
          this.gameState.tickEvents,
        );
      }
    }

    // Flush stats periodically
    if (tick - this.lastStatsFlushTick >= OPENWORLD_STATS_FLUSH_TICKS) {
      this.flushStats();
      this.lastStatsFlushTick = tick;
    }

    // Check round timer
    const timeElapsed = tick / TICK_RATE;
    if (this.freezeTick === null && this.settings && timeElapsed >= this.settings.roundTime) {
      this.startRoundTransition();
      return;
    }

    // Handle freeze period between rounds
    if (this.freezeTick !== null) {
      if (tick - this.freezeTick >= OPENWORLD_ROUND_FREEZE_TICKS) {
        this.completeRoundTransition();
        return;
      }
      // During freeze, still broadcast state but don't process inputs
      this.io.to('openworld').emit('openworld:state', state);
      return;
    }

    // Broadcast state to all open world players
    this.io.to('openworld').emit('openworld:state', state);

    // Periodic info broadcast
    if (tick % OPENWORLD_INFO_BROADCAST_TICKS === 0) {
      this.broadcastInfo();
    }
  }

  private startRoundTransition(): void {
    if (!this.gameState || !this.io) return;

    this.freezeTick = this.gameState.tick;

    // Build leaderboard
    const leaderboard = this.getLeaderboard();

    this.io.to('openworld').emit('openworld:roundEnd', {
      roundNumber: this.roundNumber,
      leaderboard,
      nextRoundIn: OPENWORLD_ROUND_FREEZE_TICKS / TICK_RATE,
    });

    logger.info(
      { roundNumber: this.roundNumber, players: this.players.size },
      'Open world round ending',
    );
  }

  private completeRoundTransition(): void {
    if (!this.io) return;

    // Flush remaining stats
    this.flushStats();

    // Save replay for this round (if any frames were recorded)
    this.finalizeReplay();

    // Stop old game loop
    this.gameLoop?.stop();

    this.roundNumber++;

    // Start fresh round with all connected players
    this.startNewRound();

    // Broadcast new round state
    if (this.gameState) {
      const fullState = this.gameState.toState();
      this.io.to('openworld').emit('openworld:roundStart', {
        roundNumber: this.roundNumber,
        state: fullState,
      });
    }

    logger.info({ roundNumber: this.roundNumber }, 'Open world new round started');
  }

  handleJoin(
    socketId: string,
    userId: number,
    username: string,
    isGuest: boolean,
  ): {
    success: boolean;
    playerId?: number;
    username?: string;
    state?: GameStateType;
    error?: string;
  } {
    if (!this.enabled || !this.gameState) {
      return { success: false, error: 'Open world is not available' };
    }

    // Check if already in open world
    if (this.socketToPlayer.has(socketId)) {
      return { success: false, error: 'Already in open world' };
    }

    // Check max players
    const maxPlayers = Math.min(
      this.settings?.maxPlayers ?? OPENWORLD_DEFAULT_MAX_PLAYERS,
      OPENWORLD_MAX_PLAYERS_CAP,
    );
    if (this.players.size >= maxPlayers) {
      return { success: false, error: 'Open world is full' };
    }

    // Generate guest identity if needed
    if (isGuest) {
      userId = OPENWORLD_GUEST_ID_START - this.guestCounter++;
      if (!username) {
        username = `Guest_${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}${Math.floor(Math.random() * 100)}`;
      }
    }

    // Check for duplicate userId (reconnection)
    if (this.players.has(userId)) {
      const existing = this.players.get(userId)!;
      // Update socket mapping
      this.socketToPlayer.delete(existing.socketId);
      existing.socketId = socketId;
      this.socketToPlayer.set(socketId, userId);
      const state = this.gameState.toState();
      return { success: true, playerId: userId, username: existing.username, state };
    }

    // Add to game
    const player = this.gameState.addPlayerLive(userId, username);
    player.invulnerableTicks = OPENWORLD_JOIN_INVULNERABILITY_TICKS;
    player.remoteDetonateMode = 'fifo';

    const playerData: OpenWorldPlayer = {
      socketId,
      userId,
      username,
      isGuest,
      joinTick: this.gameState.tick,
      kills: 0,
      deaths: 0,
      score: 0,
    };
    this.players.set(userId, playerData);
    this.socketToPlayer.set(socketId, userId);

    // Notify others
    this.io?.to('openworld').emit('openworld:playerJoined', {
      id: userId,
      username,
      isGuest,
    });

    const state = this.gameState.toState();
    return { success: true, playerId: userId, username, state };
  }

  handleLeave(socketId: string): void {
    const userId = this.socketToPlayer.get(socketId);
    if (userId === undefined) return;

    const playerData = this.players.get(userId);
    if (!playerData) return;

    // Flush stats for this player
    if (!playerData.isGuest && userId > 0) {
      this.flushPlayerStats(userId);
    }

    // Remove from game state
    this.gameState?.removePlayer(userId);
    this.players.delete(userId);
    this.socketToPlayer.delete(socketId);

    // Notify others
    this.io?.to('openworld').emit('openworld:playerLeft', {
      id: userId,
      username: playerData.username,
    });
  }

  handleInput(socketId: string, input: PlayerInput): void {
    const userId = this.socketToPlayer.get(socketId);
    if (userId === undefined || !this.gameState) return;

    // Don't accept inputs during freeze
    if (this.freezeTick !== null) return;

    this.gameState.inputBuffer.addInput(userId, input);

    // Mark activity for replay recording
    this.lastActivityTick = this.gameState.tick;
  }

  async handleSettingsChange(): Promise<void> {
    const settings = await getOpenWorldSettings();
    const wasEnabled = this.enabled;
    this.enabled = settings.enabled;

    if (!wasEnabled && settings.enabled) {
      // Enable open world
      this.settings = settings;
      this.startNewRound();
      logger.info('Open world enabled');
    } else if (wasEnabled && !settings.enabled) {
      // Disable open world
      this.shutdown();
      logger.info('Open world disabled');
    } else if (this.enabled) {
      // Update settings (apply on next round for map changes, immediately for limits)
      this.settings = settings;
      if (this.gameState) {
        this.gameState.roundTime = settings.roundTime;
        this.gameState.openWorldRespawnTicks = settings.respawnDelay * TICK_RATE;
      }
    }
  }

  getStatus(): {
    enabled: boolean;
    playerCount: number;
    maxPlayers: number;
    roundTimeRemaining: number;
    roundNumber: number;
    guestAccess: boolean;
  } {
    const timeElapsed = this.gameState ? this.gameState.tick / TICK_RATE : 0;
    const roundTime = this.settings?.roundTime ?? OPENWORLD_DEFAULT_ROUND_TIME;
    return {
      enabled: this.enabled,
      playerCount: this.players.size,
      maxPlayers: this.settings?.maxPlayers ?? OPENWORLD_DEFAULT_MAX_PLAYERS,
      roundTimeRemaining: Math.max(0, roundTime - timeElapsed),
      roundNumber: this.roundNumber,
      guestAccess: this.settings?.guestAccess ?? true,
    };
  }

  getLeaderboard(): OpenWorldScoreEntry[] {
    return Array.from(this.players.values())
      .sort((a, b) => b.score - a.score || b.kills - a.kills)
      .slice(0, 10)
      .map((p) => ({
        playerId: p.userId,
        username: p.username,
        kills: p.kills,
        deaths: p.deaths,
        score: p.score,
        isGuest: p.isGuest,
      }));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isPlayerInWorld(socketId: string): boolean {
    return this.socketToPlayer.has(socketId);
  }

  getPlayerBySocket(socketId: string): number | undefined {
    return this.socketToPlayer.get(socketId);
  }

  shutdown(): void {
    this.flushStats();
    this.finalizeReplay();
    this.gameLoop?.stop();
    this.gameLoop = null;
    this.gameState = null;
    this.players.clear();
    this.socketToPlayer.clear();
    this.freezeTick = null;
    this.enabled = false;
  }

  private finalizeReplay(): void {
    if (!this.replayRecorder) return;

    const leaderboard = this.getLeaderboard();
    const winner = leaderboard.length > 0 ? leaderboard[0] : null;

    this.replayRecorder.finalize({
      winnerId: winner?.playerId ?? null,
      winnerTeam: null,
      reason: `Round ${this.roundNumber} ended`,
      placements: leaderboard.map((e, i) => ({
        playerId: e.playerId,
        username: e.username,
        placement: i + 1,
        kills: e.kills,
        deaths: e.deaths,
      })),
    });

    this.replayRecorder = null;
    // Close the game logger stream
    this.gameState?.gameLogger?.logGameOver(null, []);
  }

  private broadcastInfo(): void {
    if (!this.io || !this.settings) return;
    const timeElapsed = this.gameState ? this.gameState.tick / TICK_RATE : 0;
    this.io.to('openworld').emit('openworld:info', {
      playerCount: this.players.size,
      maxPlayers: this.settings.maxPlayers,
      roundTimeRemaining: Math.max(0, this.settings.roundTime - timeElapsed),
      roundNumber: this.roundNumber,
    });
  }

  // --- Stat tracking ---

  private queueStatUpdate(userId: number, type: 'kill' | 'death'): void {
    let stats = this.pendingStats.get(userId);
    if (!stats) {
      stats = { kills: 0, deaths: 0, xp: 0 };
      this.pendingStats.set(userId, stats);
    }
    if (type === 'kill') {
      stats.kills++;
      stats.xp += 50; // kills × 50 XP
    } else {
      stats.deaths++;
    }
  }

  private async flushStats(): Promise<void> {
    if (this.pendingStats.size === 0) return;
    const batch = new Map(this.pendingStats);
    this.pendingStats.clear();

    for (const [userId, stats] of batch) {
      try {
        await execute(
          `UPDATE user_stats SET
            total_kills = total_kills + ?,
            total_deaths = total_deaths + ?,
            total_xp = total_xp + ?
          WHERE user_id = ?`,
          [stats.kills, stats.deaths, stats.xp, userId],
        );
      } catch (err) {
        logger.error({ err, userId }, 'Failed to flush open world stats');
      }
    }
  }

  private async flushPlayerStats(userId: number): Promise<void> {
    const stats = this.pendingStats.get(userId);
    if (!stats) return;
    this.pendingStats.delete(userId);
    try {
      await execute(
        `UPDATE user_stats SET
          total_kills = total_kills + ?,
          total_deaths = total_deaths + ?,
          total_xp = total_xp + ?
        WHERE user_id = ?`,
        [stats.kills, stats.deaths, stats.xp, userId],
      );
    } catch (err) {
      logger.error({ err, userId }, 'Failed to flush player stats on leave');
    }
  }
}

// Singleton
export const openWorldManager = new OpenWorldManager();
