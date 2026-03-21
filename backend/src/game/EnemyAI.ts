import { Direction, Position, TileType } from '@blast-arena/shared';
import { manhattanDistance } from '@blast-arena/shared';
import { Enemy } from './Enemy';
import { Player } from './Player';
import { CollisionSystem } from './CollisionSystem';

const DIR_DELTAS: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const ALL_DIRS: Direction[] = ['up', 'down', 'left', 'right'];

const OPPOSITE: Record<Direction, Direction> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export interface EnemyAIResult {
  direction: Direction | null;
  placeBomb: boolean;
}

export interface EnemyAIContext {
  self: {
    position: Position;
    hp: number;
    maxHp: number;
    direction: Direction;
    alive: boolean;
    typeConfig: {
      speed: number;
      canPassWalls: boolean;
      canPassBombs: boolean;
      canBomb: boolean;
      contactDamage: boolean;
      isBoss: boolean;
      sizeMultiplier: number;
    };
    patrolPath: Position[];
    patrolIndex: number;
  };
  players: { position: Position; alive: boolean }[];
  tiles: TileType[][];
  mapWidth: number;
  mapHeight: number;
  bombPositions: Position[];
  otherEnemies: { position: Position; enemyTypeId: number; alive: boolean }[];
  tick: number;
  rng: () => number;
}

export interface IEnemyAI {
  decide(context: EnemyAIContext): EnemyAIResult;
}

export function processEnemyAI(
  enemy: Enemy,
  players: Player[],
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  tiles: TileType[][],
  rng: () => number,
): EnemyAIResult {
  if (!enemy.alive) return { direction: null, placeBomb: false };

  const alivePlayers = players.filter((p) => p.alive);
  if (alivePlayers.length === 0) return { direction: null, placeBomb: false };

  let direction: Direction | null = null;
  let placeBomb = false;

  // Movement decision based on pattern
  if (enemy.canMove()) {
    switch (enemy.typeConfig.movementPattern) {
      case 'random_walk':
        direction = randomWalk(enemy, collisionSystem, bombPositions, tiles, rng);
        break;
      case 'chase_player':
        direction = chasePlayer(enemy, alivePlayers, collisionSystem, bombPositions, tiles, rng);
        break;
      case 'patrol_path':
        direction = patrolPath(enemy, collisionSystem, bombPositions, tiles);
        break;
      case 'wall_follow':
        direction = wallFollow(enemy, collisionSystem, bombPositions, tiles);
        break;
      case 'stationary':
        direction = null;
        break;
    }
  }

  // Bomb decision based on trigger
  if (enemy.canPlaceBomb() && enemy.typeConfig.bombConfig) {
    const config = enemy.typeConfig.bombConfig;
    switch (config.trigger) {
      case 'timer':
        placeBomb = true;
        break;
      case 'proximity': {
        const range = config.proximityRange ?? 3;
        const nearest = findNearestPlayer(enemy.position, alivePlayers);
        if (nearest && manhattanDistance(enemy.position, nearest.position) <= range) {
          placeBomb = true;
        }
        break;
      }
      case 'random':
        if (rng() < 0.15) placeBomb = true;
        break;
    }
  }

  return { direction, placeBomb };
}

function getWalkableDirs(
  pos: Position,
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  tiles: TileType[][],
  canPassWalls: boolean,
  canPassBombs: boolean,
): Direction[] {
  const dirs: Direction[] = [];
  for (const dir of ALL_DIRS) {
    const d = DIR_DELTAS[dir];
    const nx = pos.x + d.dx;
    const ny = pos.y + d.dy;

    if (canPassWalls) {
      // Ghost-type: can walk through destructible walls but not indestructible
      const tile = collisionSystem.getTileAt(nx, ny);
      if (tile === 'wall') continue;
      if (nx < 0 || ny < 0) continue;
    } else {
      if (!collisionSystem.isWalkable(nx, ny)) continue;
    }

    if (!canPassBombs) {
      const bombBlocking = bombPositions.some((b) => b.x === nx && b.y === ny);
      if (bombBlocking) continue;
    }

    dirs.push(dir);
  }
  return dirs;
}

function randomWalk(
  enemy: Enemy,
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  tiles: TileType[][],
  rng: () => number,
): Direction | null {
  const walkable = getWalkableDirs(
    enemy.position,
    collisionSystem,
    bombPositions,
    tiles,
    enemy.typeConfig.canPassWalls,
    enemy.typeConfig.canPassBombs,
  );
  if (walkable.length === 0) return null;

  // 60% continue current direction if possible
  if (rng() < 0.6 && walkable.includes(enemy.direction)) {
    return enemy.direction;
  }

  return walkable[Math.floor(rng() * walkable.length)];
}

function chasePlayer(
  enemy: Enemy,
  players: Player[],
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  tiles: TileType[][],
  rng: () => number,
): Direction | null {
  const nearest = findNearestPlayer(enemy.position, players);
  if (!nearest) return null;

  // 70% follow BFS, 30% random (feels less robotic)
  if (rng() < 0.7) {
    const bfsDir = bfsToTarget(
      enemy.position,
      nearest.position,
      collisionSystem,
      bombPositions,
      tiles,
      enemy.typeConfig.canPassWalls,
      enemy.typeConfig.canPassBombs,
      20,
    );
    if (bfsDir) return bfsDir;
  }

  // Fallback to random
  return randomWalk(enemy, collisionSystem, bombPositions, tiles, rng);
}

function patrolPath(
  enemy: Enemy,
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  tiles: TileType[][],
): Direction | null {
  if (enemy.patrolPath.length === 0) return null;

  const target = enemy.patrolPath[enemy.patrolIndex];
  if (enemy.position.x === target.x && enemy.position.y === target.y) {
    // Reached waypoint, advance to next
    if (enemy.patrolForward) {
      enemy.patrolIndex++;
      if (enemy.patrolIndex >= enemy.patrolPath.length) {
        enemy.patrolForward = false;
        enemy.patrolIndex = Math.max(0, enemy.patrolPath.length - 2);
      }
    } else {
      enemy.patrolIndex--;
      if (enemy.patrolIndex < 0) {
        enemy.patrolForward = true;
        enemy.patrolIndex = Math.min(1, enemy.patrolPath.length - 1);
      }
    }
  }

  const nextTarget = enemy.patrolPath[enemy.patrolIndex];
  return moveToward(
    enemy.position,
    nextTarget,
    collisionSystem,
    bombPositions,
    tiles,
    enemy.typeConfig.canPassWalls,
    enemy.typeConfig.canPassBombs,
  );
}

function wallFollow(
  enemy: Enemy,
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  _tiles: TileType[][],
): Direction | null {
  // Right-hand rule wall following
  const rightOf: Record<Direction, Direction> = {
    up: 'right',
    right: 'down',
    down: 'left',
    left: 'up',
  };

  const dir = enemy.direction;
  const tryOrder: Direction[] = [rightOf[dir], dir, OPPOSITE[rightOf[dir]], OPPOSITE[dir]];

  for (const tryDir of tryOrder) {
    const d = DIR_DELTAS[tryDir];
    const nx = enemy.position.x + d.dx;
    const ny = enemy.position.y + d.dy;
    if (collisionSystem.isWalkable(nx, ny)) {
      const bombBlocking =
        !enemy.typeConfig.canPassBombs && bombPositions.some((b) => b.x === nx && b.y === ny);
      if (!bombBlocking) return tryDir;
    }
  }
  return null;
}

function findNearestPlayer(pos: Position, players: Player[]): Player | null {
  let nearest: Player | null = null;
  let minDist = Infinity;
  for (const p of players) {
    if (!p.alive) continue;
    const dist = manhattanDistance(pos, p.position);
    if (dist < minDist) {
      minDist = dist;
      nearest = p;
    }
  }
  return nearest;
}

function moveToward(
  from: Position,
  to: Position,
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  tiles: TileType[][],
  canPassWalls: boolean,
  canPassBombs: boolean,
): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Prefer axis with greater distance
  const preferDirs: Direction[] = [];
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > 0) preferDirs.push('right');
    else if (dx < 0) preferDirs.push('left');
    if (dy > 0) preferDirs.push('down');
    else if (dy < 0) preferDirs.push('up');
  } else {
    if (dy > 0) preferDirs.push('down');
    else if (dy < 0) preferDirs.push('up');
    if (dx > 0) preferDirs.push('right');
    else if (dx < 0) preferDirs.push('left');
  }

  for (const dir of preferDirs) {
    const d = DIR_DELTAS[dir];
    const nx = from.x + d.dx;
    const ny = from.y + d.dy;

    if (canPassWalls) {
      const tile = collisionSystem.getTileAt(nx, ny);
      if (tile === 'wall') continue;
    } else {
      if (!collisionSystem.isWalkable(nx, ny)) continue;
    }

    if (!canPassBombs && bombPositions.some((b) => b.x === nx && b.y === ny)) continue;

    return dir;
  }
  return null;
}

function bfsToTarget(
  from: Position,
  to: Position,
  collisionSystem: CollisionSystem,
  bombPositions: Position[],
  tiles: TileType[][],
  canPassWalls: boolean,
  canPassBombs: boolean,
  maxDepth: number,
): Direction | null {
  if (from.x === to.x && from.y === to.y) return null;

  const visited = new Set<string>();
  visited.add(`${from.x},${from.y}`);

  interface BFSNode {
    x: number;
    y: number;
    firstDir: Direction;
  }

  const queue: BFSNode[] = [];

  // Seed with all walkable neighbors
  for (const dir of ALL_DIRS) {
    const d = DIR_DELTAS[dir];
    const nx = from.x + d.dx;
    const ny = from.y + d.dy;
    const key = `${nx},${ny}`;
    if (visited.has(key)) continue;

    let walkable = false;
    if (canPassWalls) {
      const tile = collisionSystem.getTileAt(nx, ny);
      walkable = tile !== 'wall';
    } else {
      walkable = collisionSystem.isWalkable(nx, ny);
    }

    if (!walkable) continue;
    if (!canPassBombs && bombPositions.some((b) => b.x === nx && b.y === ny)) continue;

    if (nx === to.x && ny === to.y) return dir;

    visited.add(key);
    queue.push({ x: nx, y: ny, firstDir: dir });
  }

  let depth = 1;
  let levelSize = queue.length;
  let idx = 0;

  while (idx < queue.length && depth < maxDepth) {
    const node = queue[idx++];
    levelSize--;

    for (const dir of ALL_DIRS) {
      const d = DIR_DELTAS[dir];
      const nx = node.x + d.dx;
      const ny = node.y + d.dy;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;

      let walkable = false;
      if (canPassWalls) {
        const tile = collisionSystem.getTileAt(nx, ny);
        walkable = tile !== 'wall';
      } else {
        walkable = collisionSystem.isWalkable(nx, ny);
      }

      if (!walkable) continue;
      if (!canPassBombs && bombPositions.some((b) => b.x === nx && b.y === ny)) continue;

      if (nx === to.x && ny === to.y) return node.firstDir;

      visited.add(key);
      queue.push({ x: nx, y: ny, firstDir: node.firstDir });
    }

    if (levelSize <= 0) {
      depth++;
      levelSize = queue.length - idx;
    }
  }

  return null;
}
