import { Server } from 'socket.io';
import { Room, GameState, PlayerInput } from '@blast-arena/shared';
import { COUNTDOWN_SECONDS, TICK_RATE } from '@blast-arena/shared';
import { GAME_MODES } from '@blast-arena/shared';
import { GameStateManager } from './GameState';
import { GameLoop } from './GameLoop';
import { execute } from '../db/connection';
import { logger } from '../utils/logger';
import { GameLogger } from '../utils/gameLogger';
import * as lobbyService from '../services/lobby';

export class GameRoom {
  public readonly code: string;
  private io: Server;
  private room: Room;
  private gameState: GameStateManager;
  private gameLoop: GameLoop;
  private matchId: number | null = null;

  constructor(io: Server, room: Room) {
    this.code = room.code;
    this.io = io;
    this.room = room;

    const modeConfig = GAME_MODES[room.config.gameMode];

    this.gameState = new GameStateManager(
      room.config.mapWidth || modeConfig.defaultMapWidth,
      room.config.mapHeight || modeConfig.defaultMapHeight,
      room.config.mapSeed,
      room.config.gameMode,
      modeConfig.hasZone || false,
      room.config.roundTime || modeConfig.roundTimeSeconds,
      room.config.wallDensity ?? 0.65,
      room.config.enabledPowerUps,
      room.config.powerUpDropRate ?? 0.3,
      room.config.friendlyFire ?? true,
      room.config.botDifficulty ?? 'normal'
    );

    // Add human players
    let playerIndex = 0;
    room.players.forEach((rp: any) => {
      const team = modeConfig.teamsCount ? (playerIndex % modeConfig.teamsCount) : null;
      this.gameState.addPlayer(rp.user.id, rp.user.username, rp.user.displayName, team, false);
      playerIndex++;
    });

    // Add bots (capped so total doesn't exceed maxPlayers)
    const botCount = Math.min(room.config.botCount || 0, room.config.maxPlayers - room.players.length);
    const botNames = ['Bomber Bot', 'Blast Bot', 'Kaboom', 'TNT', 'Dynamite', 'Sparky'];
    for (let i = 0; i < botCount; i++) {
      const botId = -(i + 1); // Negative IDs for bots
      const botName = botNames[i % botNames.length];
      const team = modeConfig.teamsCount ? (playerIndex % modeConfig.teamsCount) : null;
      this.gameState.addPlayer(botId, `bot_${i}`, botName, team, true);
      playerIndex++;
    }

    // Game logger for detailed analysis
    this.gameState.gameLogger = new GameLogger(
      room.code,
      room.config.gameMode,
      room.players.length + botCount,
    );
    // Log player roster
    for (const p of this.gameState.players.values()) {
      this.gameState.gameLogger.log('player', {
        id: p.id, name: p.displayName, isBot: p.isBot, team: p.team,
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
      () => this.onGameOver()
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
        ]
      );
      this.matchId = result.insertId;

      // Insert match_players (skip bots)
      for (const player of this.gameState.players.values()) {
        if (player.isBot) continue;
        await execute(
          'INSERT INTO match_players (match_id, user_id, team) VALUES (?, ?, ?)',
          [this.matchId, player.id, player.team]
        );
      }
    } catch (err) {
      logger.error({ err }, 'Failed to create match record');
    }

    // Broadcast initial state
    const initialState = this.gameState.toState();
    logger.info({
      code: this.code,
      mode: this.room.config.gameMode,
      mapSize: `${initialState.map.width}x${initialState.map.height}`,
      playerCount: initialState.players.length,
      players: initialState.players.map(p => ({ id: p.id, name: p.displayName, pos: p.position, alive: p.alive })),
      hasZone: !!initialState.zone,
      status: initialState.status,
    }, 'Broadcasting game:start');

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
    if (player?.alive) {
      player.die();
    }
  }

  private broadcastState(state: GameState): void {
    this.io.to(`room:${this.code}`).emit('game:state', state);
  }

  private async onGameOver(): Promise<void> {
    const state = this.gameState.toState();

    // Build placements sorted by kills (descending), tiebreak by survival placement
    const placements = Array.from(this.gameState.players.values())
      .map(p => ({
        userId: p.id,
        displayName: p.displayName,
        isBot: p.isBot,
        placement: p.placement || 0,
        kills: p.kills,
        selfKills: p.selfKills,
      }))
      .sort((a, b) => b.kills - a.kills || a.placement - b.placement);

    logger.info({ code: this.code, placements: placements.map(p => ({ name: p.displayName, kills: p.kills, selfKills: p.selfKills, placement: p.placement })) }, 'Game over placements');

    this.gameState.gameLogger?.logGameOver(state.winnerId, placements);

    this.io.to(`room:${this.code}`).emit('game:over', {
      winnerId: state.winnerId,
      winnerTeam: state.winnerTeam,
      placements,
    });

    // Save match results
    if (this.matchId) {
      try {
        const duration = Math.floor(state.timeElapsed);
        // Don't store bot IDs (negative) as winner_id in DB
        const dbWinnerId = state.winnerId && state.winnerId > 0 ? state.winnerId : null;
        await execute(
          `UPDATE matches SET status = 'finished', finished_at = NOW(), duration = ?, winner_id = ? WHERE id = ?`,
          [duration, dbWinnerId, this.matchId]
        );

        // Update match_players (skip bots)
        for (const player of this.gameState.players.values()) {
          if (player.isBot) continue;
          await execute(
            `UPDATE match_players SET placement = ?, kills = ?, deaths = ?, bombs_placed = ?, powerups_collected = ?, survived_seconds = ? WHERE match_id = ? AND user_id = ?`,
            [player.placement, player.kills, player.deaths, player.bombsPlaced, player.powerupsCollected, Math.floor(state.timeElapsed), this.matchId, player.id]
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
              isWinner, isWinner,
              player.id,
            ]
          );
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
}
