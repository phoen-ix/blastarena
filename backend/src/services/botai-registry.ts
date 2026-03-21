import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { BotAI, IBotAI } from '../game/BotAI';
import { query } from '../db/connection';
import { BotAIRow } from '../db/types';
import { loadBotAIInSandbox } from './botai-compiler';

type BotAIConstructor = new (
  difficulty: 'easy' | 'normal' | 'hard',
  mapSize?: { width: number; height: number },
) => IBotAI;

const AI_BASE_DIR = path.join(process.cwd(), 'ai');

export class BotAIRegistry {
  private loaded: Map<string, BotAIConstructor> = new Map();

  constructor() {
    // Always register built-in AI so it's available even without initialize()
    this.loaded.set('builtin', BotAI as unknown as BotAIConstructor);
  }

  async initialize(): Promise<void> {
    // Ensure AI directory exists
    fs.mkdirSync(AI_BASE_DIR, { recursive: true });
    logger.info('Registered built-in BotAI');

    // Load active custom AIs from DB
    const rows = await query<BotAIRow[]>(
      'SELECT * FROM bot_ais WHERE is_active = TRUE AND is_builtin = FALSE',
    );

    for (const row of rows) {
      try {
        this.loadAI(row.id);
        logger.info({ aiId: row.id, name: row.name }, 'Loaded custom BotAI');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { aiId: row.id, name: row.name, error: msg },
          'Failed to load custom BotAI, skipping',
        );
      }
    }

    logger.info({ count: this.loaded.size }, 'BotAI registry initialized');
  }

  createInstance(
    aiId: string | undefined,
    difficulty: 'easy' | 'normal' | 'hard',
    mapSize?: { width: number; height: number },
  ): IBotAI {
    const id = aiId || 'builtin';
    const Constructor = this.loaded.get(id);
    if (!Constructor) {
      logger.warn({ aiId: id }, 'Requested AI not found, falling back to builtin');
      return new BotAI(difficulty, mapSize);
    }
    return new Constructor(difficulty, mapSize);
  }

  loadAI(id: string): void {
    const jsPath = path.join(AI_BASE_DIR, id, 'compiled.js');
    if (!fs.existsSync(jsPath)) {
      throw new Error(`Compiled AI file not found: ${jsPath}`);
    }

    const code = fs.readFileSync(jsPath, 'utf-8');
    const mod = loadBotAIInSandbox(code);

    // Find the AI class in exports
    let AIClass: BotAIConstructor | undefined;
    if (typeof mod.default === 'function' && mod.default.prototype?.generateInput) {
      AIClass = mod.default as BotAIConstructor;
    } else if (
      typeof mod === 'function' &&
      (mod as unknown as { prototype: Record<string, unknown> }).prototype?.generateInput
    ) {
      // Handle module.exports = Class (mod itself is the constructor)
      AIClass = mod as unknown as BotAIConstructor;
    } else {
      for (const val of Object.values(mod)) {
        if (
          typeof val === 'function' &&
          (val as { prototype: Record<string, unknown> }).prototype?.generateInput
        ) {
          AIClass = val as BotAIConstructor;
          break;
        }
      }
    }

    if (!AIClass) {
      throw new Error('No class with generateInput() found in compiled module');
    }

    this.loaded.set(id, AIClass);
  }

  unloadAI(id: string): void {
    if (id === 'builtin') return;
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

let registry: BotAIRegistry | null = null;

export function getBotAIRegistry(): BotAIRegistry {
  if (!registry) {
    registry = new BotAIRegistry();
  }
  return registry;
}
