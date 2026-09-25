import { scanAndBuildAI, checkStructure, CompileResult } from './botai-compiler';
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

  // 5. Structure validation, inside an isolate like every later run of the code
  const structureError = checkStructure('decide', compiledCode, ['normal', DUMMY_TYPE_CONFIG]);
  if (structureError) return { success: false, errors: [structureError] };

  logger.info('Enemy AI compilation and validation successful');
  return { success: true, compiledCode, errors: [] };
}
