import { describe, it, expect, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { compileBotAI } from '../../../backend/src/services/botai-compiler';
import { compileEnemyAI } from '../../../backend/src/services/enemyai-compiler';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * The AI guides' example classes go through the same compiler as an admin upload. The bot guide's
 * "Complete Example" imported getExplosionCells from @blast-arena/shared, which the upload bundler
 * rejects ("Imports are not allowed in bot AI code") — the documented example could not be used.
 */
function exampleClasses(doc: string, method: string): [number, string][] {
  const src = fs.readFileSync(path.join(__dirname, '../../../docs', doc), 'utf8');
  return [...src.matchAll(/```(?:typescript|ts)\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((code) => /\bclass\s+\w+/.test(code) && code.includes(`${method}(`))
    .map((code, i) => [i, code]);
}

describe('AI guide examples compile like an upload', () => {
  const bots = exampleClasses('bot-ai-guide.md', 'generateInput');
  const enemies = exampleClasses('enemy-ai-guide.md', 'decide');

  it('finds the examples', () => {
    expect(bots.length).toBeGreaterThanOrEqual(2);
    expect(enemies.length).toBeGreaterThanOrEqual(1);
  });

  it.each(bots)('bot-ai-guide example %i', async (_i, code) => {
    const result = await compileBotAI(code);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });

  it.each(enemies)('enemy-ai-guide example %i', async (_i, code) => {
    const result = await compileEnemyAI(code);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
  });
});
