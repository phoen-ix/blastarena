import { scanAndBuildAI, loadBotAIInSandbox, CompileResult } from './botai-compiler';
import { logger } from '../utils/logger';

const DUMMY_TYPE_CONFIG = {
  speed: 1,
  canPassWalls: false,
  canPassBombs: false,
  canBomb: false,
  contactDamage: false,
  isBoss: false,
  sizeMultiplier: 1,
};

export async function compileEnemyAI(source: string): Promise<CompileResult> {
  // Steps 1-4: shared scan + build
  const buildResult = await scanAndBuildAI(source);
  if (!buildResult.success) return buildResult;

  const compiledCode = buildResult.compiledCode!;

  // 5. Structure validation — run in VM sandbox, check for decide() method
  try {
    const mod = loadBotAIInSandbox(compiledCode);

    // Find the exported class — check default export, then named exports
    let AIClass: unknown = mod.default || mod;
    if (typeof AIClass === 'object' && AIClass !== null) {
      const exportValues = Object.values(mod);
      AIClass = exportValues.find(
        (v) => typeof v === 'function' && v.prototype && typeof v.prototype.decide === 'function',
      );
    }

    if (!AIClass || typeof AIClass !== 'function') {
      return {
        success: false,
        errors: ['No exported class found. The module must export a class (default or named).'],
      };
    }

    if (
      typeof (AIClass as { prototype: Record<string, unknown> }).prototype.decide !== 'function'
    ) {
      return {
        success: false,
        errors: [
          'Exported class does not have a decide() method. ' +
            'The class must implement: decide(context: EnemyAIContext): { direction, placeBomb }',
        ],
      };
    }

    // Try instantiation
    try {
      const Constructor = AIClass as new (difficulty: string, typeConfig: unknown) => unknown;
      const instance = new Constructor('normal', DUMMY_TYPE_CONFIG);
      if (typeof (instance as Record<string, unknown>).decide !== 'function') {
        return {
          success: false,
          errors: ['Instantiated class does not have a decide method on the instance.'],
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

  logger.info('Enemy AI compilation and validation successful');
  return { success: true, compiledCode, errors: [] };
}
