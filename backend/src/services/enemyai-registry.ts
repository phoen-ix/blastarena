import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { IEnemyAI, EnemyAIContext } from '../game/EnemyAI';
import { query } from '../db/connection';
import { EnemyAIRow } from '../db/types';
import { loadBotAIInSandbox } from './botai-compiler';

type EnemyAIConstructor = new (
  difficulty: 'easy' | 'normal' | 'hard',
  typeConfig: EnemyAIContext['self']['typeConfig'],
) => IEnemyAI;

const ENEMY_AI_BASE_DIR = path.join(process.cwd(), 'enemy-ai');

export class EnemyAIRegistry {
  private loaded: Map<string, EnemyAIConstructor> = new Map();

  async initialize(): Promise<void> {
    fs.mkdirSync(ENEMY_AI_BASE_DIR, { recursive: true });

    const rows = await query<EnemyAIRow[]>('SELECT * FROM enemy_ais WHERE is_active = TRUE');

    for (const row of rows) {
      try {
        this.loadAI(row.id);
        logger.info({ aiId: row.id, name: row.name }, 'Loaded custom EnemyAI');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { aiId: row.id, name: row.name, error: msg },
          'Failed to load custom EnemyAI, skipping',
        );
      }
    }

    logger.info({ count: this.loaded.size }, 'EnemyAI registry initialized');
  }

  createInstance(
    aiId: string,
    difficulty: 'easy' | 'normal' | 'hard',
    typeConfig: EnemyAIContext['self']['typeConfig'],
  ): IEnemyAI | null {
    const Constructor = this.loaded.get(aiId);
    if (!Constructor) {
      logger.warn({ aiId }, 'Requested enemy AI not found, falling back to built-in patterns');
      return null;
    }
    return new Constructor(difficulty, typeConfig);
  }

  loadAI(id: string): void {
    const jsPath = path.join(ENEMY_AI_BASE_DIR, id, 'compiled.js');
    if (!fs.existsSync(jsPath)) {
      throw new Error(`Compiled enemy AI file not found: ${jsPath}`);
    }

    const code = fs.readFileSync(jsPath, 'utf-8');
    const mod = loadBotAIInSandbox(code);

    let AIClass: EnemyAIConstructor | undefined;
    if (typeof mod.default === 'function' && mod.default.prototype?.decide) {
      AIClass = mod.default as EnemyAIConstructor;
    } else {
      for (const val of Object.values(mod)) {
        if (
          typeof val === 'function' &&
          (val as { prototype: Record<string, unknown> }).prototype?.decide
        ) {
          AIClass = val as EnemyAIConstructor;
          break;
        }
      }
    }

    if (!AIClass) {
      throw new Error('No class with decide() found in compiled module');
    }

    this.loaded.set(id, AIClass);
  }

  unloadAI(id: string): void {
    this.loaded.delete(id);
  }

  reloadAI(id: string): void {
    this.unloadAI(id);
    this.loadAI(id);
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  getLoadedIds(): string[] {
    return Array.from(this.loaded.keys());
  }
}

let registry: EnemyAIRegistry | null = null;

export function getEnemyAIRegistry(): EnemyAIRegistry {
  if (!registry) {
    registry = new EnemyAIRegistry();
  }
  return registry;
}
