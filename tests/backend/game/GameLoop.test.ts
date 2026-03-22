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

  it('should stop after 10 consecutive tick errors (circuit breaker)', () => {
    const loop = new GameLoop(gameState, onTick, onGameOver, 20, true);
    // Skip countdown so processTick runs immediately
    const processTickSpy = jest.spyOn(gameState, 'processTick').mockImplementation(() => {
      throw new Error('simulated tick failure');
    });

    loop.start();

    // Advance through 9 errors — loop should still be running
    jest.advanceTimersByTime(50 * 9);
    expect(loop.isRunning()).toBe(true);

    // 10th error triggers circuit breaker
    jest.advanceTimersByTime(50);
    expect(loop.isRunning()).toBe(false);
    expect(onGameOver).toHaveBeenCalledTimes(1);

    processTickSpy.mockRestore();
  });

  it('should reset error counter on successful tick', () => {
    const loop = new GameLoop(gameState, onTick, onGameOver, 20, true);
    let callCount = 0;
    const processTickSpy = jest.spyOn(gameState, 'processTick').mockImplementation(() => {
      callCount++;
      // Fail for first 5 calls, then succeed, then fail for 5 more
      if (callCount <= 5 || (callCount > 6 && callCount <= 11)) {
        throw new Error('simulated tick failure');
      }
      // Call 6 succeeds — resets counter
    });

    loop.start();

    // 5 errors + 1 success + 5 errors = 11 ticks, counter never reaches 10
    jest.advanceTimersByTime(50 * 11);
    expect(loop.isRunning()).toBe(true);

    loop.stop();
    processTickSpy.mockRestore();
  });
});
