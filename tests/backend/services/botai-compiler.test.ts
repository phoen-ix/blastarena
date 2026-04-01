import { describe, it, expect, jest } from '@jest/globals';
import {
  compileBotAI,
  scanAndBuildAI,
  loadBotAIInSandbox,
} from '../../../backend/src/services/botai-compiler';

jest.mock('../../../backend/src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('botai-compiler', () => {
  // ── scanAndBuildAI ──────────────────────────────────────────────────

  describe('scanAndBuildAI', () => {
    it('rejects source exceeding 500KB', async () => {
      const oversized = 'x'.repeat(500 * 1024 + 1);
      const result = await scanAndBuildAI(oversized);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/exceeds maximum size of 500KB/);
    });

    it('accepts source just under the 500KB limit', async () => {
      // Pad a valid class to just under the limit
      const cls = `export class AI { generateInput() { return null; } }`;
      const padding = '// ' + 'a'.repeat(500 * 1024 - Buffer.byteLength(cls) - 5);
      const source = cls + '\n' + padding;
      expect(Buffer.byteLength(source)).toBeLessThanOrEqual(500 * 1024);

      const result = await scanAndBuildAI(source);
      expect(result.success).toBe(true);
      expect(result.compiledCode).toBeDefined();
    });

    it('returns success with compiledCode for valid TypeScript', async () => {
      const source = `
        interface Input { direction: string; }
        export class Bot {
          private diff: string;
          constructor(difficulty: string) { this.diff = difficulty; }
          generateInput(player: any, state: any): Input | null {
            return { direction: 'up' };
          }
        }
      `;
      const result = await scanAndBuildAI(source);
      expect(result.success).toBe(true);
      expect(result.compiledCode).toBeDefined();
      expect(result.compiledCode!.length).toBeGreaterThan(0);
      expect(result.errors).toEqual([]);
    });

    it('returns errors when esbuild cannot parse invalid syntax', async () => {
      const source = `export class AI { generateInput( { return null } }`;
      const result = await scanAndBuildAI(source);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/compilation failed/i);
    });
  });

  // ── compileBotAI structure validation ───────────────────────────────

  describe('compileBotAI structure validation', () => {
    it('succeeds for valid class via export class', async () => {
      const source = `export class MyBot {
        generateInput(player: any, state: any) { return null; }
      }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(true);
      expect(result.compiledCode).toBeDefined();
      expect(result.errors).toEqual([]);
    });

    it('succeeds for valid class via export default class', async () => {
      const source = `export default class {
        generateInput(player: any, state: any) { return { direction: 'down' }; }
      }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(true);
      expect(result.compiledCode).toBeDefined();
    });

    it('succeeds for valid named export class', async () => {
      const source = `export class SuperBot {
        private level: number;
        constructor(difficulty: string) { this.level = difficulty === 'hard' ? 2 : 1; }
        generateInput(player: any, state: any) { return null; }
      }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(true);
    });

    it('fails when module exports only a function (no class)', async () => {
      const source = `export function generateInput(player: any, state: any) { return null; }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/No exported class found/);
    });

    it('fails when exported class has no generateInput method', async () => {
      // Named export without generateInput — the class finder skips it,
      // resulting in "No exported class found"
      const source = `export class Bot {
        decide(player: any, state: any) { return null; }
      }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/No exported class found/);
    });

    it('fails when default-exported class has no generateInput method', async () => {
      // Default export is found as AIClass directly (mod.default), hitting the
      // prototype check at line 195 rather than the "No exported class" path
      const source = `export default class Bot {
        decide(player: any, state: any) { return null; }
      }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/does not have a generateInput\(\) method/);
    });

    it('fails when class constructor throws during instantiation', async () => {
      const source = `export class Bot {
        constructor(difficulty: string) {
          throw new Error('Config file not found');
        }
        generateInput(player: any, state: any) { return null; }
      }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Class instantiation failed/);
    });

    it('includes actual exception text in instantiation error', async () => {
      const source = `export class Bot {
        constructor(difficulty: string) {
          throw new Error('missing required field: apiKey');
        }
        generateInput(player: any, state: any) { return null; }
      }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('missing required field: apiKey');
    });

    it("returns 'No exported class found' when module exports only primitives", async () => {
      const source = `
        export const name = 'bot';
        export const version = 42;
        export const active = true;
      `;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/No exported class found/);
    });
  });

  // ── loadBotAIInSandbox ─────────────────────────────────────────────

  describe('loadBotAIInSandbox', () => {
    it('returns module exports for valid CJS code', () => {
      const code = `
        class Bot { generateInput() { return { direction: 'left' }; } }
        module.exports.Bot = Bot;
        module.exports.VERSION = 2;
      `;
      const mod = loadBotAIInSandbox(code);
      expect(typeof mod.Bot).toBe('function');
      expect(mod.VERSION).toBe(2);
    });

    it('code cannot access require (not defined in sandbox)', () => {
      const code = `module.exports.val = typeof require;`;
      const mod = loadBotAIInSandbox(code);
      expect(mod.val).toBe('undefined');
    });

    it('frozen console does not throw when called', () => {
      const code = `
        console.log('test');
        console.warn('test');
        console.error('test');
        console.info('test');
        console.debug('test');
        module.exports.ok = true;
      `;
      const mod = loadBotAIInSandbox(code);
      expect(mod.ok).toBe(true);
    });
  });
});
