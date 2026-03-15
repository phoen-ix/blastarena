import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { GameLoop } from '../../../backend/src/game/GameLoop';

describe('GameLoop', () => {
  let gameState: GameStateManager;
  let onTick: jest.Mock;
  let onGameOver: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    gameState = new GameStateManager({
      mapWidth: 15,
      mapHeight: 13,
      mapSeed: 12345,
      gameMode: 'ffa',
    });
    gameState.addPlayer(1, 'player1', null);
    gameState.addPlayer(2, 'player2', null);
    onTick = jest.fn();
    onGameOver = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should start and stop the game loop', () => {
    const loop = new GameLoop(gameState, onTick, onGameOver);
    expect(loop.isRunning()).toBe(false);

    loop.start();
    expect(loop.isRunning()).toBe(true);
    expect(gameState.status).toBe('countdown');

    loop.stop();
    expect(loop.isRunning()).toBe(false);
  });

  it('should call onTick at each tick', () => {
    const loop = new GameLoop(gameState, onTick, onGameOver, 20);
    loop.start();

    jest.advanceTimersByTime(50); // 1 tick at 20 tps
    expect(onTick).toHaveBeenCalled();

    jest.advanceTimersByTime(200); // 4 more ticks
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(4);

    loop.stop();
  });
});
