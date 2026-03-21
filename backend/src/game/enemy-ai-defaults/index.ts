import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getEnemyAIByName } from '../../services/enemyai';
import { compileEnemyAI } from '../../services/enemyai-compiler';
import { getEnemyAIRegistry } from '../../services/enemyai-registry';
import { execute } from '../../db/connection';
import { logger } from '../../utils/logger';

import { HUNTER_SOURCE } from './hunter';
import { PATROL_GUARD_SOURCE } from './patrol-guard';
import { BOMBER_SOURCE } from './bomber';
import { COWARD_SOURCE } from './coward';
import { SWARM_SOURCE } from './swarm';
import { AMBUSHER_SOURCE } from './ambusher';

interface DefaultEnemyAIDef {
  name: string;
  description: string;
  filename: string;
  source: string;
}

const ENEMY_AI_BASE_DIR = path.join(process.cwd(), 'enemy-ai');

const DEFAULT_ENEMY_AIS: DefaultEnemyAIDef[] = [
  {
    name: 'Hunter',
    description:
      'Aggressive chaser that relentlessly pursues the nearest player using BFS pathfinding. Places bombs when close. Difficulty scales chase accuracy and bomb aggression.',
    filename: 'hunter.ts',
    source: HUNTER_SOURCE,
  },
  {
    name: 'Patrol Guard',
    description:
      'Follows patrol path faithfully, switches to aggressive chase when a player enters detection range. Returns to patrol when player escapes. Difficulty scales detection range and chase intelligence.',
    filename: 'patrol-guard.ts',
    source: PATROL_GUARD_SOURCE,
  },
  {
    name: 'Bomber',
    description:
      'Area denial specialist that prioritizes positions near destructible walls or player chokepoints. Retreats to safety after placing bombs. Difficulty scales bomb frequency and escape planning.',
    filename: 'bomber.ts',
    source: BOMBER_SOURCE,
  },
  {
    name: 'Coward',
    description:
      'Flees from the nearest player while dropping bombs as traps behind it. Creates dangerous corridors. Difficulty scales flee intelligence, bomb frequency, and chokepoint awareness.',
    filename: 'coward.ts',
    source: COWARD_SOURCE,
  },
  {
    name: 'Swarm',
    description:
      'Coordinates with other enemies to surround the player. Moves to flanking positions rather than chasing directly. Difficulty scales coordination quality and bombing triggers.',
    filename: 'swarm.ts',
    source: SWARM_SOURCE,
  },
  {
    name: 'Ambusher',
    description:
      'Waits motionless until a player enters detection range, then rushes aggressively. Returns to hiding after a chase timeout. Difficulty scales detection range, chase duration, and bomb usage.',
    filename: 'ambusher.ts',
    source: AMBUSHER_SOURCE,
  },
];

export async function seedDefaultEnemyAIs(): Promise<void> {
  let seeded = 0;

  for (const def of DEFAULT_ENEMY_AIS) {
    try {
      const existing = await getEnemyAIByName(def.name);
      if (existing) continue;

      const result = await compileEnemyAI(def.source);
      if (!result.success) {
        logger.error(
          { name: def.name, errors: result.errors },
          'Failed to compile default enemy AI',
        );
        continue;
      }

      const id = uuidv4();
      const aiDir = path.join(ENEMY_AI_BASE_DIR, id);
      fs.mkdirSync(aiDir, { recursive: true });
      fs.writeFileSync(path.join(aiDir, 'source.ts'), def.source);
      fs.writeFileSync(path.join(aiDir, 'compiled.js'), result.compiledCode!);

      await execute(
        `INSERT INTO enemy_ais (id, name, description, filename, is_active, uploaded_by, version, file_size)
         VALUES (?, ?, ?, ?, TRUE, NULL, 1, ?)`,
        [id, def.name, def.description, def.filename, Buffer.byteLength(def.source)],
      );

      getEnemyAIRegistry().loadAI(id);
      seeded++;

      logger.info({ aiId: id, name: def.name }, 'Seeded default enemy AI');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ name: def.name, error: msg }, 'Error seeding default enemy AI');
    }
  }

  if (seeded > 0) {
    logger.info({ count: seeded }, 'Seeded default enemy AIs');
  }
}
