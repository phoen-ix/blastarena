import { describe, it, expect } from '@jest/globals';
import { toPlayerInput, toEnemyAIResult } from '../../../backend/src/services/IsolatedAIRunner';

describe('AI output normalisation', () => {
  it('keeps well-formed bot inputs and stamps the tick', () => {
    expect(toPlayerInput({ direction: 'up', action: 'bomb', seq: 4, tick: 999 }, 12)).toEqual({
      direction: 'up',
      action: 'bomb',
      seq: 4,
      tick: 12,
    });
  });

  it('drops unknown directions/actions and non-objects', () => {
    expect(toPlayerInput({ direction: 'diagonal', action: 'nuke' }, 1)).toBeNull();
    expect(toPlayerInput({ direction: 'left', action: 'nuke' }, 1)).toEqual({
      direction: 'left',
      action: null,
      seq: 0,
      tick: 1,
    });
    expect(toPlayerInput(null, 1)).toBeNull();
    expect(toPlayerInput('up', 1)).toBeNull();
  });

  it('turns a missing or malformed enemy decision into "do nothing"', () => {
    expect(toEnemyAIResult(undefined)).toEqual({ direction: null, placeBomb: false });
    expect(toEnemyAIResult(null)).toEqual({ direction: null, placeBomb: false });
    expect(toEnemyAIResult({ direction: 'sideways', placeBomb: 'yes' })).toEqual({
      direction: null,
      placeBomb: false,
    });
    expect(toEnemyAIResult({ direction: 'down', placeBomb: true })).toEqual({
      direction: 'down',
      placeBomb: true,
    });
  });
});
