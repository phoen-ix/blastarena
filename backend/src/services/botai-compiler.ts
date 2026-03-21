import * as esbuild from 'esbuild';
import vm from 'vm';
import { logger } from '../utils/logger';

const MAX_FILE_SIZE = 500 * 1024; // 500KB
const VM_TIMEOUT_MS = 5000;

const DANGEROUS_MODULES = [
  'fs',
  'child_process',
  'net',
  'http',
  'https',
  'dgram',
  'cluster',
  'worker_threads',
  'vm',
  'os',
  'dns',
  'tls',
  'readline',
  'path',
  'crypto',
  'stream',
  'zlib',
  'util',
  'events',
  'buffer',
  'assert',
  'perf_hooks',
  'async_hooks',
  'v8',
  'inspector',
];

const DANGEROUS_IMPORT_PATTERNS = DANGEROUS_MODULES.flatMap((mod) => [
  new RegExp(`require\\s*\\(\\s*['"\`]${mod}['"\`]\\s*\\)`, 'g'),
  new RegExp(`from\\s+['"\`]${mod}['"\`]`, 'g'),
  new RegExp(`from\\s+['"\`]node:${mod}['"\`]`, 'g'),
  new RegExp(`require\\s*\\(\\s*['"\`]node:${mod}['"\`]\\s*\\)`, 'g'),
]);

const DANGEROUS_GLOBAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /process[.[]/g, label: 'process access' },
  { pattern: /globalThis/g, label: 'globalThis access' },
  { pattern: /__proto__/g, label: '__proto__ access' },
  { pattern: /Object\.defineProperty/g, label: 'Object.defineProperty' },
  { pattern: /Object\.setPrototypeOf/g, label: 'Object.setPrototypeOf' },
  { pattern: /Reflect\./g, label: 'Reflect access' },
  { pattern: /new\s+Proxy\s*\(/g, label: 'Proxy constructor' },
];

const blockImportsPlugin: esbuild.Plugin = {
  name: 'block-imports',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      return {
        errors: [{ text: `Imports are not allowed in bot AI code: "${args.path}"` }],
      };
    });
  },
};

export interface CompileResult {
  success: boolean;
  compiledCode?: string;
  errors: string[];
}

export function loadBotAIInSandbox(code: string): Record<string, unknown> {
  const moduleObj = { exports: {} as Record<string, unknown> };
  const frozenConsole = Object.freeze({
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {},
    debug: () => {},
  });

  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    console: frozenConsole,
  };

  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  vm.runInContext(code, context, { timeout: VM_TIMEOUT_MS });

  return moduleObj.exports;
}

/**
 * Shared scan + build pipeline (steps 1-4). Used by both bot AI and enemy AI compilers.
 */
export async function scanAndBuildAI(source: string): Promise<CompileResult> {
  const errors: string[] = [];

  // 1. File size check
  if (Buffer.byteLength(source) > MAX_FILE_SIZE) {
    return {
      success: false,
      errors: [`Source file exceeds maximum size of ${MAX_FILE_SIZE / 1024}KB`],
    };
  }

  // 2. Dangerous import scan
  for (const pattern of DANGEROUS_IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      errors.push(`Forbidden import detected: ${match[0]}`);
    }
  }
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // 3. Dangerous global access scan
  for (const { pattern, label } of DANGEROUS_GLOBAL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(source);
    if (match) {
      errors.push(`Forbidden pattern detected (${label}): ${match[0]}`);
    }
  }
  if (errors.length > 0) {
    return { success: false, errors };
  }

  // 4. esbuild transpilation (bundle: true with import blocking plugin)
  let compiledCode: string;
  try {
    const result = await esbuild.build({
      stdin: {
        contents: source,
        loader: 'ts',
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      write: false,
      plugins: [blockImportsPlugin],
    });

    if (result.errors.length > 0) {
      return {
        success: false,
        errors: result.errors.map((e) => `${e.text} (line ${e.location?.line ?? '?'})`),
      };
    }

    compiledCode = result.outputFiles![0].text;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`TypeScript compilation failed: ${msg}`] };
  }

  return { success: true, compiledCode, errors: [] };
}

export async function compileBotAI(source: string): Promise<CompileResult> {
  // Steps 1-4: shared scan + build
  const buildResult = await scanAndBuildAI(source);
  if (!buildResult.success) return buildResult;

  const compiledCode = buildResult.compiledCode!;

  // 5. Structure validation — run in VM sandbox, check exports
  try {
    const mod = loadBotAIInSandbox(compiledCode);

    // Find the exported class — check default export, then named exports
    let AIClass: unknown = mod.default || mod;
    if (typeof AIClass === 'object' && AIClass !== null) {
      // Look for a class in named exports
      const exportValues = Object.values(mod);
      AIClass = exportValues.find(
        (v) =>
          typeof v === 'function' && v.prototype && typeof v.prototype.generateInput === 'function',
      );
    }

    if (!AIClass || typeof AIClass !== 'function') {
      return {
        success: false,
        errors: ['No exported class found. The module must export a class (default or named).'],
      };
    }

    if (
      typeof (AIClass as { prototype: Record<string, unknown> }).prototype.generateInput !==
      'function'
    ) {
      return {
        success: false,
        errors: [
          'Exported class does not have a generateInput() method. ' +
            'The class must implement: generateInput(player, state, logger?): PlayerInput | null',
        ],
      };
    }

    // Try instantiation
    try {
      const Constructor = AIClass as new (difficulty: string) => unknown;
      const instance = new Constructor('normal');
      if (typeof (instance as Record<string, unknown>).generateInput !== 'function') {
        return {
          success: false,
          errors: ['Instantiated class does not have a generateInput method on the instance.'],
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        errors: [`Class instantiation failed with difficulty="normal": ${msg}`],
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`Structure validation failed: ${msg}`] };
  }

  logger.info('Bot AI compilation and validation successful');
  return { success: true, compiledCode, errors: [] };
}
