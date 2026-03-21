import { PlayerInput, CampaignLevel, EnemyTypeConfig, StartingPowerUps } from '@blast-arena/shared';
import { CampaignGame, CampaignSessionCallbacks } from './CampaignGame';
import { logger } from '../utils/logger';

export class CampaignGameManager {
  private sessions: Map<string, CampaignGame> = new Map();
  private playerSessions: Map<number, string> = new Map();

  startLevel(
    userId: number,
    level: CampaignLevel,
    enemyTypes: Map<number, EnemyTypeConfig>,
    callbacks: CampaignSessionCallbacks,
    carriedPowerups?: StartingPowerUps | null,
  ): CampaignGame {
    // End any existing session for this user
    const existingSessionId = this.playerSessions.get(userId);
    if (existingSessionId) {
      this.endSession(existingSessionId);
    }

    const game = new CampaignGame(userId, level, enemyTypes, callbacks, carriedPowerups);
    this.sessions.set(game.sessionId, game);
    this.playerSessions.set(userId, game.sessionId);

    logger.info(
      { userId, levelId: level.id, sessionId: game.sessionId },
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
    this.playerSessions.delete(game.userId);
    logger.info({ sessionId, userId: game.userId }, 'Campaign session ended');
  }

  handleInput(sessionId: string, input: PlayerInput): void {
    const game = this.sessions.get(sessionId);
    if (game && !game.isFinished() && !game.isPaused()) {
      game.handleInput(input);
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
