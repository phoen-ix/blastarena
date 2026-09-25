import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { IEnemyAI, EnemyAIContext } from '../game/EnemyAI';
import { query } from '../db/connection';
import { EnemyAIRow } from '../db/types';
import { loadBotAIInSandbox } from './botai-compiler';
import { IsolatedEnemyAI } from './IsolatedAIRunner';

type EnemyAIConstructor = new (
  difficulty: 'easy' | 'normal' | 'hard',
  typeConfig: EnemyAIContext['self']['typeConfig'],
) => IEnemyAI;

/**
 * Built-in enemy AIs (compiled from the repository source, see enemy-ai-defaults) run in-process as
 * a class. Everything uploaded runs in an `isolated-vm` isolate per instance (created lazily).
 */
type LoadedEnemy = { kind: 'class'; ctor: EnemyAIConstructor } | { kind: 'isolated'; code: string };

const ENEMY_AI_BASE_DIR = path.join(process.cwd(), 'enemy-ai');

export class EnemyAIRegistry {
  private loaded: Map<string, LoadedEnemy> = new Map();

  async initialize(): Promise<void> {
    fs.mkdirSync(ENEMY_AI_BASE_DIR, { recursive: true });

    const rows = await query<EnemyAIRow[]>('SELECT * FROM enemy_ais WHERE is_active = TRUE');

    for (const row of rows) {
      // Built-ins are loaded by seedDefaultEnemyAIs from the repository source.
      if (row.builtin_key) continue;
      try {
        this.loadAI(row.id);
        logger.info({ aiId: row.id, name: row.name }, 'Loaded EnemyAI');
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
    const entry = this.loaded.get(aiId);
    if (!entry) {
      logger.warn({ aiId }, 'Requested enemy AI not found, falling back to built-in patterns');
      return null;
    }
    if (entry.kind === 'class') {
      return new entry.ctor(difficulty, typeConfig);
    }
    // Untrusted upload — run in an isolate. On build/instantiation failure, return null so the
    // caller falls back to the built-in patterns.
    try {
      return new IsolatedEnemyAI(entry.code, difficulty, typeConfig);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ aiId, error: msg }, 'Failed to create isolated enemy AI, falling back');
      return null;
    }
  }

  /** An uploaded AI: its compiled code runs in an isolate when an instance is created. */
  loadAI(id: string): void {
    const jsPath = path.join(ENEMY_AI_BASE_DIR, id, 'compiled.js');
    if (!fs.existsSync(jsPath)) {
      throw new Error(`Compiled enemy AI file not found: ${jsPath}`);
    }
    // Already structurally validated at upload time by compileEnemyAI. (audit C1)
    this.loaded.set(id, { kind: 'isolated', code: fs.readFileSync(jsPath, 'utf-8') });
  }

  /** A built-in AI, from code compiled from the repository source — runs in-process. */
  loadBuiltin(id: string, compiledCode: string): void {
    const mod = loadBotAIInSandbox(compiledCode);
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
      throw new Error('No class with decide() found in built-in enemy AI');
    }
    this.loaded.set(id, { kind: 'class', ctor: AIClass });
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
