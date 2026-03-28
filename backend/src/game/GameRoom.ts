import { Server } from 'socket.io';
import {
  Room,
  GameState,
  PlayerInput,
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  HAZARD_TILE_TYPES,
  MAP_EVENT_TYPES,
} from '@blast-arena/shared';
import {
  GAME_MODES,
  MAX_SPEED,
  calculateXpGained,
  getLevelForXp,
  getXpForLevel,
  getXpToNextLevel,
  XpUpdateResult,
} from '@blast-arena/shared';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
import { GameStateManager, GameConfig } from './GameState';
import { GameLoop } from './GameLoop';
import { execute, query } from '../db/connection';
import { logger } from '../utils/logger';
import { GameLogger } from '../utils/gameLogger';
import { ReplayRecorder } from '../utils/replayRecorder';
import * as lobbyService from '../services/lobby';
import * as settingsService from '../services/settings';
import * as cosmeticsService from '../services/cosmetics';
import * as eloService from '../services/elo';
import * as achievementsService from '../services/achievements';

const DISCONNECT_GRACE_TICKS = 200; // 10 seconds at 20 tps

export class GameRoom {
  public readonly code: string;
  private io: TypedServer;
  private room: Room;
  private gameState: GameStateManager;
  private gameLoop: GameLoop;
  private matchId: number | null = null;
  private replayRecorder: ReplayRecorder | null = null;
  private disconnectedPlayers: Map<number, number> = new Map(); // playerId -> tick when disconnected

  constructor(io: TypedServer, room: Room, customMap?: GameConfig['customMap']) {
    this.code = room.code;
    this.io = io;
    this.room = room;

    const modeConfig = GAME_MODES[room.config.gameMode];

    this.gameState = new GameStateManager({
      mapWidth: room.config.mapWidth || modeConfig.defaultMapWidth,
      mapHeight: room.config.mapHeight || modeConfig.defaultMapHeight,
      mapSeed: room.config.mapSeed,
      gameMode: room.config.gameMode,
      hasZone: modeConfig.hasZone || false,
      roundTime: room.config.roundTime || modeConfig.roundTimeSeconds,
      wallDensity: room.config.wallDensity ?? 0.65,
      enabledPowerUps: room.config.enabledPowerUps,
      powerUpDropRate: room.config.powerUpDropRate ?? 0.3,
      friendlyFire: room.config.friendlyFire ?? true,
      botDifficulty: room.config.botDifficulty ?? 'normal',
      reinforcedWalls: room.config.reinforcedWalls ?? false,
      enableMapEvents: room.config.enableMapEvents ?? false,
      enabledMapEvents: room.config.enableMapEvents
        ? room.config.selectedMapEvents?.length
          ? room.config.selectedMapEvents
          : [...MAP_EVENT_TYPES]
        : [],
      hazardTiles: room.config.hazardTiles
        ? room.config.selectedHazardTiles?.length
          ? room.config.selectedHazardTiles
          : [...HAZARD_TILE_TYPES]
        : [],
      botAiId: room.config.botAiId,
      customMap,
    });

    // Add human players
    let playerIndex = 0;
    room.players.forEach((rp) => {
      // Use pre-assigned team from lobby if set, otherwise round-robin
      const team = modeConfig.teamsCount
        ? rp.team !== null && rp.team !== undefined
          ? rp.team
          : playerIndex % modeConfig.teamsCount
        : null;
      this.gameState.addPlayer(rp.user.id, rp.user.username, team, false);
      playerIndex++;
    });

    // Add bots (capped so total doesn't exceed maxPlayers)
    const botCount = Math.min(
      room.config.botCount || 0,
      room.config.maxPlayers - room.players.length,
    );
    const botNames = ['Bomber Bot', 'Blast Bot', 'Kaboom', 'TNT', 'Dynamite', 'Sparky'];
    const botTeams = room.config.botTeams || [];
    for (let i = 0; i < botCount; i++) {
      const botId = -(i + 1); // Negative IDs for bots
      const botName = botNames[i % botNames.length];
      // Use pre-assigned bot team if set, otherwise round-robin
      const team = modeConfig.teamsCount
        ? botTeams[i] !== null && botTeams[i] !== undefined
          ? botTeams[i]!
          : playerIndex % modeConfig.teamsCount
        : null;
      this.gameState.addPlayer(botId, botName, team, true);
      playerIndex++;
    }

    // Sudden Death: boost all players with max stats
    if (room.config.gameMode === 'sudden_death') {
      for (const player of this.gameState.players.values()) {
        player.maxBombs = 8;
        player.fireRange = 8;
        player.speed = MAX_SPEED;
        player.hasKick = true;
      }
    }

    // Cosmetics are loaded in start() to ensure they're ready before game:start broadcast

    // Replay recorder for game replay (conditional on room config)
    if (room.config.recordGame !== false) {
      this.replayRecorder = new ReplayRecorder(
        room.code,
        room.config.gameMode,
        this.gameState.toState(),
      );
    }

    // Game logger for detailed analysis
    this.gameState.gameLogger = new GameLogger(
      room.code,
      room.config.gameMode,
      room.players.length + botCount,
    );
    if (this.replayRecorder) {
      this.gameState.gameLogger.replayRecorder = this.replayRecorder;
    }
    // Log player roster
    for (const p of this.gameState.players.values()) {
      this.gameState.gameLogger.log('player', {
        id: p.id,
        name: p.username,
        isBot: p.isBot,
        team: p.team,
        spawn: p.position,
      });
    }
    this.gameState.gameLogger.log('config', {
      mapSize: `${this.gameState.map.width}x${this.gameState.map.height}`,
      seed: this.gameState.map.seed,
      botDifficulty: room.config.botDifficulty ?? 'normal',
      wallDensity: room.config.wallDensity,
      roundTime: room.config.roundTime,
      friendlyFire: room.config.friendlyFire,
    });

    this.gameLoop = new GameLoop(
      this.gameState,
      (state) => this.broadcastState(state),
      () => this.onGameOver(),
    );
  }

  async start(): Promise<void> {
    // Create match record in DB
    try {
      const result = await execute(
        `INSERT INTO matches (room_code, game_mode, map_seed, map_width, map_height, max_players, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'playing', NOW())`,
        [
          this.code,
          this.room.config.gameMode,
          this.gameState.map.seed,
          this.gameState.map.width,
          this.gameState.map.height,
          this.room.config.maxPlayers,
        ],
      );
      this.matchId = result.insertId;
      this.replayRecorder?.setMatchId(this.matchId);

      // Insert match_players (skip bots)
      for (const player of this.gameState.players.values()) {
        if (player.isBot) continue;
        await execute('INSERT INTO match_players (match_id, user_id, team) VALUES (?, ?, ?)', [
          this.matchId,
          player.id,
          player.team,
        ]);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to create match record');
    }

    // Load cosmetics for human players before broadcasting initial state
    try {
      const humanIds = this.room.players.map((rp) => rp.user.id);
      const cosmeticsMap = await cosmeticsService.getPlayerCosmeticsForGame(humanIds);
      for (const [userId, cosmeticData] of cosmeticsMap) {
        const player = this.gameState.players.get(userId);
        if (player) player.cosmetics = cosmeticData;
      }
    } catch (err) {
      logger.error({ err }, 'Failed to load player cosmetics');
    }

    // Broadcast initial state
    const initialState = this.gameState.toState();
    logger.info(
      {
        code: this.code,
        mode: this.room.config.gameMode,
        mapSize: `${initialState.map.width}x${initialState.map.height}`,
        playerCount: initialState.players.length,
        players: initialState.players.map((p) => ({
          id: p.id,
          name: p.username,
          pos: p.position,
          alive: p.alive,
        })),
        hasZone: !!initialState.zone,
        status: initialState.status,
      },
      'Broadcasting game:start',
    );

    // Check how many sockets are in this room
    const roomSockets = this.io.sockets.adapter.rooms.get(`room:${this.code}`);
    logger.info({ code: this.code, socketsInRoom: roomSockets?.size ?? 0 }, 'Room socket count');

    this.io.to(`room:${this.code}`).emit('game:start', initialState);

    // Start game loop
    this.gameLoop.start();
    await lobbyService.updateRoomStatus(this.code, 'playing');
  }

  handleInput(playerId: number, input: PlayerInput): void {
    this.gameState.inputBuffer.addInput(playerId, input);
  }

  handlePlayerDisconnect(playerId: number): void {
    const player = this.gameState.players.get(playerId);
    if (!player?.alive) return;

    // Start grace period instead of instant death
    this.disconnectedPlayers.set(playerId, this.gameState.tick);
    logger.info(
      { code: this.code, playerId, username: player.username },
      'Player disconnected during game, starting grace period',
    );
  }

  handlePlayerReconnect(playerId: number): boolean {
    if (!this.disconnectedPlayers.has(playerId)) return false;
    const player = this.gameState.players.get(playerId);
    if (!player?.alive) return false;

    this.disconnectedPlayers.delete(playerId);
    logger.info(
      { code: this.code, playerId, username: player.username },
      'Player reconnected during grace period',
    );
    return true;
  }

  /** Called each tick from broadcastState to expire disconnect grace periods */
  private checkDisconnectGracePeriods(): void {
    const currentTick = this.gameState.tick;
    let killedByGrace = false;
    for (const [playerId, disconnectTick] of this.disconnectedPlayers) {
      if (currentTick - disconnectTick >= DISCONNECT_GRACE_TICKS) {
        this.gameState.killPlayer(playerId, null);
        logger.info(
          { code: this.code, playerId },
          'Player killed after disconnect grace period expired',
        );
        this.disconnectedPlayers.delete(playerId);
        killedByGrace = true;
      }
    }

    // End game if all humans were killed by disconnect grace expiry (not normal gameplay deaths)
    if (killedByGrace && this.disconnectedPlayers.size === 0) {
      const hasAliveHuman = Array.from(this.gameState.players.values()).some(
        (p) => p.alive && !p.isBot,
      );
      if (!hasAliveHuman && this.gameLoop.isRunning()) {
        logger.info({ code: this.code }, 'No human players alive, ending game');
        this.gameState.status = 'finished';
        this.gameState.finishReason = 'All players disconnected';
      }
    }
  }

  isPlayerDisconnected(playerId: number): boolean {
    return this.disconnectedPlayers.has(playerId);
  }

  getFullState(): GameState {
    return this.gameState.toState();
  }

  private broadcastState(state: GameState): void {
    // Check disconnect grace periods before broadcasting
    this.checkDisconnectGracePeriods();

    const room = `room:${this.code}`;
    this.io.to(room).emit('game:state', state);

    // Emit discrete game events
    const events = this.gameState.tickEvents;
    for (const explosion of events.explosions) {
      this.io.to(room).emit('game:explosion', explosion);
    }
    for (const death of events.playerDied) {
      this.io.to(room).emit('game:playerDied', death);
    }
    for (const pickup of events.powerupCollected) {
      this.io.to(room).emit('game:powerupCollected', pickup);
    }

    // Record frame for replay — pass raw tile grid reference for diff computation
    // (broadcast state has empty tiles for bandwidth savings, but replays need actual tiles)
    if (this.replayRecorder) {
      const replayState =
        state.tileDiffs !== undefined
          ? { ...state, map: { ...state.map, tiles: this.gameState.map.tiles } }
          : state;
      this.replayRecorder.recordTick(replayState, events);
    }
  }

  private async onGameOver(): Promise<void> {
    const state = this.gameState.toState();

    // Build placements sorted by kills (descending), tiebreak by survival placement
    const placements = Array.from(this.gameState.players.values())
      .map((p) => ({
        userId: p.id,
        username: p.username,
        isBot: p.isBot,
        placement: p.placement || 0,
        kills: p.kills,
        selfKills: p.selfKills,
        team: p.team,
        alive: p.alive,
      }))
      .sort((a, b) => b.kills - a.kills || a.placement - b.placement);

    logger.info(
      {
        code: this.code,
        placements: placements.map((p) => ({
          name: p.username,
          kills: p.kills,
          selfKills: p.selfKills,
          placement: p.placement,
        })),
      },
      'Game over placements',
    );

    this.gameState.gameLogger?.logGameOver(state.winnerId, placements);

    const gameOverData = {
      winnerId: state.winnerId,
      winnerTeam: state.winnerTeam,
      placements,
      reason: this.gameState.finishReason || '',
    };

    this.io.to(`room:${this.code}`).emit('game:over', gameOverData);

    // Save replay
    this.replayRecorder?.finalize(gameOverData);

    // Save match results
    if (this.matchId) {
      try {
        const duration = Math.floor(state.timeElapsed);
        // Don't store bot IDs (negative) as winner_id in DB
        const dbWinnerId = state.winnerId && state.winnerId > 0 ? state.winnerId : null;
        const matchStatus =
          this.gameState.finishReason === 'All players disconnected' ? 'aborted' : 'finished';
        await execute(
          `UPDATE matches SET status = ?, finished_at = NOW(), duration = ?, winner_id = ? WHERE id = ?`,
          [matchStatus, duration, dbWinnerId, this.matchId],
        );

        // Update match_players (skip bots)
        for (const player of this.gameState.players.values()) {
          if (player.isBot) continue;
          await execute(
            `UPDATE match_players SET placement = ?, kills = ?, deaths = ?, bombs_placed = ?, powerups_collected = ?, survived_seconds = ? WHERE match_id = ? AND user_id = ?`,
            [
              player.placement,
              player.kills,
              player.deaths,
              player.bombsPlaced,
              player.powerupsCollected,
              Math.floor(state.timeElapsed),
              this.matchId,
              player.id,
            ],
          );
        }

        // Update user_stats (skip bots)
        for (const player of this.gameState.players.values()) {
          if (player.isBot) continue;
          const isWinner = player.id === state.winnerId;
          await execute(
            `UPDATE user_stats SET
              total_matches = total_matches + 1,
              total_wins = total_wins + ?,
              total_kills = total_kills + ?,
              total_deaths = total_deaths + ?,
              total_bombs = total_bombs + ?,
              total_powerups = total_powerups + ?,
              total_playtime = total_playtime + ?,
              win_streak = IF(?, win_streak + 1, 0),
              best_win_streak = GREATEST(best_win_streak, IF(?, win_streak + 1, 0))
            WHERE user_id = ?`,
            [
              isWinner ? 1 : 0,
              player.kills,
              player.deaths,
              player.bombsPlaced,
              player.powerupsCollected,
              Math.floor(state.timeElapsed),
              isWinner,
              isWinner,
              player.id,
            ],
          );
        }

        // Elo calculation (skip aborted matches)
        if (matchStatus !== 'aborted') {
          try {
            const eloPlayers = [...this.gameState.players.values()]
              .filter((p) => !p.isBot)
              .map((p) => ({
                userId: p.id,
                placement: p.placement ?? 999,
                team: p.team,
                isWinner:
                  p.id === state.winnerId ||
                  (state.winnerTeam !== null && p.team === state.winnerTeam),
              }));

            const eloResults = await eloService.processMatchElo(
              this.room.config.gameMode,
              eloPlayers,
              this.matchId!,
            );

            if (eloResults.length > 0) {
              this.io.to(`room:${this.code}`).emit('game:eloUpdate', eloResults);
            }
          } catch (eloErr) {
            logger.error({ err: eloErr }, 'Failed to process Elo');
          }

          // Achievement evaluation for each human player
          for (const player of this.gameState.players.values()) {
            if (player.isBot) continue;
            try {
              const unlocked = await achievementsService.evaluateAfterGame({
                userId: player.id,
                gameMode: this.room.config.gameMode,
                isWinner:
                  player.id === state.winnerId ||
                  (state.winnerTeam !== null && player.team === state.winnerTeam),
                kills: player.kills,
                deaths: player.deaths,
                selfKills: player.selfKills,
                bombsPlaced: player.bombsPlaced,
                powerupsCollected: player.powerupsCollected,
                survivedSeconds: Math.floor(state.timeElapsed),
                placement: player.placement ?? 999,
                playerCount: this.gameState.players.size,
              });

              if (unlocked.achievements.length > 0) {
                this.io.to(`user:${player.id}`).emit('achievement:unlocked', unlocked);
              }
            } catch (achErr) {
              logger.error({ err: achErr, userId: player.id }, 'Failed to evaluate achievements');
            }
          }
        }

        // --- XP & Level ---
        try {
          const xpMultiplier = parseFloat(
            (await settingsService.getSetting('xp_multiplier')) ?? '1',
          );
          const xpResults: XpUpdateResult[] = [];

          for (const p of placements) {
            if (p.isBot || p.userId < 0) continue;

            const [statsRow] = await query<any[]>(
              'SELECT total_xp, level FROM user_stats WHERE user_id = ?',
              [p.userId],
            );
            const currentXp = statsRow?.total_xp ?? 0;
            const oldLevel = statsRow?.level ?? 1;

            const player = this.gameState.players.get(p.userId);
            const xpGained = calculateXpGained(
              {
                kills: p.kills,
                bombsPlaced: player?.bombsPlaced ?? 0,
                powerupsCollected: player?.powerupsCollected ?? 0,
                placement: p.placement,
                isWinner: p.userId === state.winnerId,
              },
              xpMultiplier,
            );

            const newTotalXp = currentXp + xpGained;
            const newLevel = getLevelForXp(newTotalXp);

            await execute('UPDATE user_stats SET total_xp = ?, level = ? WHERE user_id = ?', [
              newTotalXp,
              newLevel,
              p.userId,
            ]);

            if (newLevel > oldLevel) {
              await cosmeticsService.checkLevelMilestoneUnlocks(p.userId, newLevel);
            }

            xpResults.push({
              userId: p.userId,
              xpGained,
              totalXp: newTotalXp,
              oldLevel,
              newLevel,
              xpForNextLevel: getXpToNextLevel(newLevel),
              xpProgress: newTotalXp - getXpForLevel(newLevel),
            });
          }

          if (xpResults.length > 0) {
            this.io.to(`room:${this.code}`).emit('game:xpUpdate', xpResults);
          }
        } catch (xpErr) {
          logger.error({ err: xpErr }, 'Failed to process XP');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to save match results');
      }
    }

    await lobbyService.updateRoomStatus(this.code, 'finished');
    logger.info({ code: this.code, winnerId: state.winnerId }, 'Game over');
  }

  stop(): void {
    this.gameLoop.stop();
  }

  isRunning(): boolean {
    return this.gameLoop.isRunning();
  }

  isPlayerAlive(playerId: number): boolean {
    const player = this.gameState.players.get(playerId);
    return player?.alive ?? false;
  }
}
