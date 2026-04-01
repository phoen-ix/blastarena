import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { compileEnemyAI } from '../../../backend/src/services/enemyai-compiler';
import { logger } from '../../../backend/src/utils/logger';

// ── Source fixtures ────────────────────────────────────────────────────────

const VALID_ENEMY_AI = `
export class TestEnemy {
  decide(context: any) {
    return { direction: 'none', placeBomb: false };
  }
}
`;

const VALID_ENEMY_AI_DEFAULT = `
export default class TestEnemy {
  decide(context: any) {
    return { direction: 'none', placeBomb: false };
  }
}
`;

const NO_DECIDE_METHOD = `
export class TestEnemy {
  update(context: any) {
    return { direction: 'none', placeBomb: false };
  }
}
`;

const ONLY_FUNCTION_EXPORT = `
export function decide(context: any) {
  return { direction: 'none', placeBomb: false };
}
`;

const ONLY_PRIMITIVE_EXPORTS = `
export const name = 'enemy';
export const speed = 5;
export const active = true;
`;

const CONSTRUCTOR_THROWS = `
export class TestEnemy {
  constructor(difficulty: string, typeConfig: any) {
    throw new Error('Constructor kaboom');
  }
  decide(context: any) {
    return { direction: 'none', placeBomb: false };
  }
}
`;

const USES_TYPE_CONFIG = `
export class TestEnemy {
  private speed: number;
  constructor(difficulty: string, typeConfig: any) {
    this.speed = typeConfig.speed;
    if (typeof this.speed !== 'number') {
      throw new Error('typeConfig.speed must be a number');
    }
  }
  decide(context: any) {
    return { direction: 'none', placeBomb: false };
  }
}
`;

describe('compileEnemyAI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Success cases ──────────────────────────────────────────────────────

  it('succeeds for valid class with decide() method via named export', async () => {
    const result = await compileEnemyAI(VALID_ENEMY_AI);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('succeeds for valid class with decide() method via default export', async () => {
    const result = await compileEnemyAI(VALID_ENEMY_AI_DEFAULT);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns compiledCode on success', async () => {
    const result = await compileEnemyAI(VALID_ENEMY_AI);
    expect(result.success).toBe(true);
    expect(result.compiledCode).toBeDefined();
    expect(typeof result.compiledCode).toBe('string');
    expect(result.compiledCode!.length).toBeGreaterThan(0);
  });

  it('logs info message on success', async () => {
    await compileEnemyAI(VALID_ENEMY_AI);
    expect(logger.info).toHaveBeenCalledWith('Enemy AI compilation and validation successful');
  });

  // ── Structure validation failures ──────────────────────────────────────

  it('fails when class has no decide() method', async () => {
    const result = await compileEnemyAI(NO_DECIDE_METHOD);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/class|decide/);
  });

  it('fails when no class is exported (only a function)', async () => {
    const result = await compileEnemyAI(ONLY_FUNCTION_EXPORT);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/No exported class found/);
  });

  it('fails when module exports only primitive values', async () => {
    const result = await compileEnemyAI(ONLY_PRIMITIVE_EXPORTS);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/No exported class found/);
  });

  // ── Constructor failures ───────────────────────────────────────────────

  it('fails when class constructor throws', async () => {
    const result = await compileEnemyAI(CONSTRUCTOR_THROWS);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/Class instantiation failed/);
  });

  it('error includes the constructor exception message', async () => {
    const result = await compileEnemyAI(CONSTRUCTOR_THROWS);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Constructor kaboom');
  });

  // ── scanAndBuildAI propagation ─────────────────────────────────────────

  it('propagates scanAndBuildAI errors for oversized source', async () => {
    const oversized = 'x'.repeat(501 * 1024);
    const result = await compileEnemyAI(oversized);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/exceeds maximum size/);
  });

  it('propagates scanAndBuildAI errors for dangerous imports', async () => {
    const source = `
      const fs = require('fs');
      export class TestEnemy {
        decide(context: any) { return { direction: 'none', placeBomb: false }; }
      }
    `;
    const result = await compileEnemyAI(source);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/Forbidden import/);
  });

  // ── Constructor receives both arguments ────────────────────────────────

  it('constructor receives both difficulty and typeConfig arguments', async () => {
    const result = await compileEnemyAI(USES_TYPE_CONFIG);
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
