import { PlayerInput, CampaignLevel, EnemyTypeConfig, StartingPowerUps } from '@blast-arena/shared';
import { CampaignGame, CampaignSessionCallbacks } from './CampaignGame';
import { logger } from '../utils/logger';

export class CampaignGameManager {
  private sessions: Map<string, CampaignGame> = new Map();
  private playerSessions: Map<number, string> = new Map();

  startLevel(
    userIds: number[],
    usernames: string[],
    level: CampaignLevel,
    enemyTypes: Map<number, EnemyTypeConfig>,
    callbacks: CampaignSessionCallbacks,
    carriedPowerups?: StartingPowerUps | null,
    buddyMode?: boolean,
    theme?: string,
  ): CampaignGame {
    // End any existing session for ALL users
    for (const userId of userIds) {
      const existingSessionId = this.playerSessions.get(userId);
      if (existingSessionId) {
        this.endSession(existingSessionId);
      }
    }

    const game = new CampaignGame(
      userIds,
      usernames,
      level,
      enemyTypes,
      callbacks,
      carriedPowerups,
      buddyMode,
      theme,
    );
    this.sessions.set(game.sessionId, game);

    // Register ALL users in playerSessions
    for (const userId of userIds) {
      this.playerSessions.set(userId, game.sessionId);
    }

    logger.info(
      { userIds, levelId: level.id, sessionId: game.sessionId, coopMode: game.coopMode },
      'Campaign session started',
    );
    return game;
  }

  getSession(sessionId: string): CampaignGame | undefined {
    return this.sessions.get(sessionId);
  }

  getPlayerSession(userId: number): CampaignGame | undefined {
    const sessionId = this.playerSessions.get(userId);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  endSession(sessionId: string): void {
    const game = this.sessions.get(sessionId);
    if (!game) return;

    if (!game.isFinished()) {
      game.stop();
    }

    this.sessions.delete(sessionId);
    // Clean up ALL player references
    for (const userId of game.userIds) {
      this.playerSessions.delete(userId);
    }
    logger.info({ sessionId, userIds: game.userIds }, 'Campaign session ended');
  }

  handleInput(sessionId: string, userId: number, input: PlayerInput): void {
    const game = this.sessions.get(sessionId);
    if (game && !game.isFinished() && !game.isPaused()) {
      game.handleInput(userId, input);
    }
  }

  /** Remove a single player from a co-op session (partner quit/disconnect) */
  removePlayer(sessionId: string, userId: number): void {
    const game = this.sessions.get(sessionId);
    if (!game) return;

    // Remove from playerSessions lookup
    this.playerSessions.delete(userId);

    // Kill the player in-game
    const player = game.getPlayer(userId);
    if (player && player.alive) {
      player.die();
    }

    logger.info({ sessionId, userId }, 'Player removed from campaign session');

    // If no players remain in the lookup, end the session
    const remainingPlayers = game.userIds.filter((id) => this.playerSessions.get(id) === sessionId);
    if (remainingPlayers.length === 0) {
      this.endSession(sessionId);
    }
  }

  pauseSession(sessionId: string): boolean {
    const game = this.sessions.get(sessionId);
    if (!game || game.isFinished() || game.isPaused()) return false;
    game.pause();
    return true;
  }

  resumeSession(sessionId: string): boolean {
    const game = this.sessions.get(sessionId);
    if (!game || game.isFinished() || !game.isPaused()) return false;
    game.resume();
    return true;
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}
