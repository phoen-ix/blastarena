import { describe, it, expect } from '@jest/globals';
import { compileBotAI, loadBotAIInSandbox } from '../../../backend/src/services/botai-compiler';

const VALID_AI_SOURCE = `
export class MyAI {
  generateInput(player: any, state: any) {
    return { action: 'bomb', direction: 'up' };
  }
}
`;

describe('Bot AI sandbox security', () => {
  // ── Source-level blocking ──────────────────────────────────────────

  describe('source scan: dangerous imports', () => {
    it('blocks require("fs")', async () => {
      const source = `const fs = require("fs"); export class AI { generateInput() { return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Forbidden import/);
    });

    it('blocks require("child_process")', async () => {
      const source = `const cp = require("child_process"); export class AI { generateInput() { return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Forbidden import/);
    });

    it('blocks node: protocol imports', async () => {
      const source = `import fs from "node:fs"; export class AI { generateInput() { return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Forbidden import/);
    });
  });

  describe('source scan: dangerous globals', () => {
    it('blocks process.env access', async () => {
      const source = `export class AI { generateInput() { return process.env; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/process access/);
    });

    it('blocks process[...] access', async () => {
      const source = `export class AI { generateInput() { return process["env"]; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/process access/);
    });

    it('blocks globalThis', async () => {
      const source = `export class AI { generateInput() { return globalThis; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/globalThis/);
    });

    it('blocks __proto__ access', async () => {
      const source = `export class AI { generateInput() { const o: any = {}; o.__proto__.polluted = true; return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/__proto__/);
    });

    it('blocks Object.defineProperty', async () => {
      const source = `export class AI { generateInput() { Object.defineProperty({}, 'x', {}); return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Object\.defineProperty/);
    });

    it('blocks Object.setPrototypeOf', async () => {
      const source = `export class AI { generateInput() { Object.setPrototypeOf({}, null); return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Object\.setPrototypeOf/);
    });

    it('blocks Reflect access', async () => {
      const source = `export class AI { generateInput() { Reflect.get({}, 'x'); return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Reflect/);
    });

    it('blocks new Proxy()', async () => {
      const source = `export class AI { generateInput() { new Proxy({}, {}); return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/Proxy/);
    });
  });

  // ── Runtime VM sandbox ─────────────────────────────────────────────

  describe('runtime sandbox: loadBotAIInSandbox', () => {
    it('executes valid CJS module and returns exports', () => {
      const code = `module.exports.MyClass = class { generateInput() { return { action: 'bomb' }; } };`;
      const mod = loadBotAIInSandbox(code);
      expect(typeof mod.MyClass).toBe('function');
    });

    it('blocks eval() at runtime', () => {
      const code = `eval("1+1");`;
      expect(() => loadBotAIInSandbox(code)).toThrow(/eval|Code generation from strings/i);
    });

    it('blocks new Function() at runtime', () => {
      const code = `new Function("return 1")();`;
      expect(() => loadBotAIInSandbox(code)).toThrow(/Function|Code generation from strings/i);
    });

    it('does not expose process', () => {
      const code = `module.exports.val = typeof process;`;
      const mod = loadBotAIInSandbox(code);
      expect(mod.val).toBe('undefined');
    });

    it('does not expose require', () => {
      const code = `module.exports.val = typeof require;`;
      const mod = loadBotAIInSandbox(code);
      expect(mod.val).toBe('undefined');
    });

    it('does not expose global', () => {
      // In vm context, `global` is not defined — typeof check should return 'undefined'
      const code = `module.exports.val = typeof global;`;
      const mod = loadBotAIInSandbox(code);
      expect(mod.val).toBe('undefined');
    });

    it('times out on infinite loops', () => {
      const code = `while(true) {}`;
      expect(() => loadBotAIInSandbox(code)).toThrow(/timed out|Script execution timed out/i);
    });
  });

  // ── Sandbox escape: constructor walk ───────────────────────────────

  describe('sandbox escape: constructor walk', () => {
    it('source scan blocks literal .constructor access', async () => {
      const source = `export class AI { generateInput() { return ({} as any).constructor.constructor('return process')(); } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/constructor access/);
    });

    it('runtime sandbox blocks module.constructor.constructor escape', () => {
      // module/exports are created INSIDE the context, so the constructor chain resolves to the
      // context realm where code generation is disabled — host `process` must not be reachable.
      const code = `
        let leaked;
        try { leaked = module.constructor.constructor('return process')(); }
        catch (e) { leaked = 'blocked'; }
        module.exports.val = leaked === 'blocked' ? 'blocked' : typeof leaked;
      `;
      const mod = loadBotAIInSandbox(code);
      expect(mod.val).toBe('blocked');
    });

    it('runtime sandbox does not leak process.env via exports.constructor', () => {
      const code = `
        let env;
        try { env = exports.constructor.constructor('return process')().env; }
        catch (e) { env = undefined; }
        module.exports.val = typeof env;
      `;
      const mod = loadBotAIInSandbox(code);
      expect(mod.val).toBe('undefined');
    });
  });

  // ── esbuild import blocking ────────────────────────────────────────

  describe('esbuild: import blocking plugin', () => {
    it('blocks dynamic require in bundled output', async () => {
      const source = `
        const mod = 'f' + 's';
        const r = require(mod);
        export class AI { generateInput() { return null; } }
      `;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      // esbuild with bundle:true and the blocking plugin rejects all resolution
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('blocks import statements at bundle time', async () => {
      const source = `
        import * as path from 'path';
        export class AI { generateInput() { return null; } }
      `;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      // Caught by both source scan AND esbuild plugin
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  // ── Valid AI still works ───────────────────────────────────────────

  describe('valid AI compilation', () => {
    it('compiles and validates a well-formed AI', async () => {
      const result = await compileBotAI(VALID_AI_SOURCE);
      expect(result.success).toBe(true);
      expect(result.compiledCode).toBeDefined();
      expect(result.errors).toEqual([]);
    });

    it('rejects AI without generateInput method', async () => {
      const source = `export class AI { doSomething() { return null; } }`;
      const result = await compileBotAI(source);
      expect(result.success).toBe(false);
      expect(result.errors[0]).toMatch(/exported class|generateInput/);
    });
  });
});
