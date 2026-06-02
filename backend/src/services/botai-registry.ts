import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { BotAI, IBotAI } from '../game/BotAI';
import { query } from '../db/connection';
import { BotAIRow } from '../db/types';
import { IsolatedBotAI } from './IsolatedAIRunner';

type BotAIConstructor = new (
  difficulty: 'easy' | 'normal' | 'hard',
  mapSize?: { width: number; height: number },
) => IBotAI;

/**
 * A loaded bot AI is either the trusted built-in class (run in-process) or untrusted custom code
 * (run in an `isolated-vm` isolate per instance, created lazily). All DB-loaded bot AIs are
 * untrusted uploads — the built-in is registered directly as a class. (audit C1)
 */
type LoadedBot = { kind: 'class'; ctor: BotAIConstructor } | { kind: 'isolated'; code: string };

const AI_BASE_DIR = path.join(process.cwd(), 'ai');

export class BotAIRegistry {
  private loaded: Map<string, LoadedBot> = new Map();

  constructor() {
    // Always register built-in AI so it's available even without initialize()
    this.loaded.set('builtin', { kind: 'class', ctor: BotAI as unknown as BotAIConstructor });
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
    const entry = this.loaded.get(id);
    if (!entry) {
      logger.warn({ aiId: id }, 'Requested AI not found, falling back to builtin');
      return new BotAI(difficulty, mapSize);
    }
    if (entry.kind === 'class') {
      return new entry.ctor(difficulty, mapSize);
    }
    // Untrusted custom AI — run it in an isolate. If the isolate fails to build/instantiate the
    // class, fall back to the built-in so a broken upload can't break game creation.
    try {
      return new IsolatedBotAI(entry.code, difficulty, mapSize);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { aiId: id, error: msg },
        'Failed to create isolated bot AI, falling back to builtin',
      );
      return new BotAI(difficulty, mapSize);
    }
  }

  loadAI(id: string): void {
    const jsPath = path.join(AI_BASE_DIR, id, 'compiled.js');
    if (!fs.existsSync(jsPath)) {
      throw new Error(`Compiled AI file not found: ${jsPath}`);
    }

    // Custom bot AIs are untrusted: store the compiled code and run it in an isolate when an
    // instance is created (createInstance). The code was already structurally validated at upload
    // time by compileBotAI; we do NOT evaluate it in-process here. (audit C1)
    const code = fs.readFileSync(jsPath, 'utf-8');
    this.loaded.set(id, { kind: 'isolated', code });
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
