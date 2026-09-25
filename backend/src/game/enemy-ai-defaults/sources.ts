import { HUNTER_SOURCE } from './hunter';
import { PATROL_GUARD_SOURCE } from './patrol-guard';
import { BOMBER_SOURCE } from './bomber';
import { COWARD_SOURCE } from './coward';
import { SWARM_SOURCE } from './swarm';
import { AMBUSHER_SOURCE } from './ambusher';

export interface BuiltinEnemyAIDef {
  /** Stable identifier (enemy_ais.builtin_key); names can be edited by admins. */
  key: string;
  name: string;
  description: string;
  filename: string;
  source: string;
}

export const BUILTIN_ENEMY_AIS: BuiltinEnemyAIDef[] = [
  {
    key: 'hunter',
    name: 'Hunter',
    description:
      'Aggressive chaser that relentlessly pursues the nearest player using BFS pathfinding. Places bombs when close. Difficulty scales chase accuracy and bomb aggression.',
    filename: 'hunter.ts',
    source: HUNTER_SOURCE,
  },
  {
    key: 'patrol-guard',
    name: 'Patrol Guard',
    description:
      'Follows patrol path faithfully, switches to aggressive chase when a player enters detection range. Returns to patrol when player escapes. Difficulty scales detection range and chase intelligence.',
    filename: 'patrol-guard.ts',
    source: PATROL_GUARD_SOURCE,
  },
  {
    key: 'bomber',
    name: 'Bomber',
    description:
      'Area denial specialist that prioritizes positions near destructible walls or player chokepoints. Retreats to safety after placing bombs. Difficulty scales bomb frequency and escape planning.',
    filename: 'bomber.ts',
    source: BOMBER_SOURCE,
  },
  {
    key: 'coward',
    name: 'Coward',
    description:
      'Flees from the nearest player while dropping bombs as traps behind it. Creates dangerous corridors. Difficulty scales flee intelligence, bomb frequency, and chokepoint awareness.',
    filename: 'coward.ts',
    source: COWARD_SOURCE,
  },
  {
    key: 'swarm',
    name: 'Swarm',
    description:
      'Coordinates with other enemies to surround the player. Moves to flanking positions rather than chasing directly. Difficulty scales coordination quality and bombing triggers.',
    filename: 'swarm.ts',
    source: SWARM_SOURCE,
  },
  {
    key: 'ambusher',
    name: 'Ambusher',
    description:
      'Waits motionless until a player enters detection range, then rushes aggressively. Returns to hiding after a chase timeout. Difficulty scales detection range, chase duration, and bomb usage.',
    filename: 'ambusher.ts',
    source: AMBUSHER_SOURCE,
  },
];
