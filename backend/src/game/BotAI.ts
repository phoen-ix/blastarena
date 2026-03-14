import { PlayerInput, Direction, Position, TileType } from '@blast-arena/shared';
import { Player } from './Player';
import { GameStateManager } from './GameState';
import { Bomb } from './Bomb';

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export interface BotDifficultyConfig {
  dangerAwareness: number | 'fireRange' | 'fireRange+2';
  escapeSearchDepth: number;
  bombCooldownMin: number;
  bombCooldownMax: number;
  escapeCheckBeforeBomb: boolean;
  huntChance: number;
  powerUpVision: number;
  optimalMoveChance: number;
  useKick: boolean;
  reactionDelay: number;
}

const DIFFICULTY_PRESETS: Record<'easy' | 'normal' | 'hard', BotDifficultyConfig> = {
  easy: {
    dangerAwareness: 2,
    escapeSearchDepth: 2,
    bombCooldownMin: 50,
    bombCooldownMax: 80,
    escapeCheckBeforeBomb: false,
    huntChance: 0.2,
    powerUpVision: 2,
    optimalMoveChance: 0.4,
    useKick: false,
    reactionDelay: 3,
  },
  normal: {
    dangerAwareness: 'fireRange',
    escapeSearchDepth: 4,
    bombCooldownMin: 25,
    bombCooldownMax: 45,
    escapeCheckBeforeBomb: true,
    huntChance: 0.5,
    powerUpVision: 5,
    optimalMoveChance: 0.7,
    useKick: true,
    reactionDelay: 0,
  },
  hard: {
    dangerAwareness: 'fireRange+2',
    escapeSearchDepth: 6,
    bombCooldownMin: 12,
    bombCooldownMax: 25,
    escapeCheckBeforeBomb: true,
    huntChance: 0.8,
    powerUpVision: 8,
    optimalMoveChance: 0.95,
    useKick: true,
    reactionDelay: 0,
  },
};

export class BotAI {
  private seq: number = 0;
  private lastDirection: Direction = 'down';
  private bombCooldown: number = 0;
  private config: BotDifficultyConfig;
  private reactionDelayRemaining: number = 0;

  constructor(difficulty: 'easy' | 'normal' | 'hard' = 'normal') {
    this.config = DIFFICULTY_PRESETS[difficulty];
  }

  private getAwarenessRange(playerFireRange: number): number {
    if (this.config.dangerAwareness === 'fireRange') return playerFireRange;
    if (this.config.dangerAwareness === 'fireRange+2') return playerFireRange + 2;
    return this.config.dangerAwareness;
  }

  generateInput(player: Player, state: GameStateManager): PlayerInput | null {
    if (!player.alive) return null;

    this.seq++;
    if (this.bombCooldown > 0) this.bombCooldown--;

    const pos = player.position;
    const bombPositions = Array.from(state.bombs.values()).map(b => b.position);
    const otherPlayers = Array.from(state.players.values())
      .filter(p => p.id !== player.id && p.alive)
      .map(p => p.position);

    const awarenessRange = this.getAwarenessRange(player.fireRange);
    const danger = this.getDangerCells(state, awarenessRange, pos);
    const amInDanger = danger.has(`${pos.x},${pos.y}`);

    // Priority 1: If in danger and have kick, try to kick a threatening bomb away
    if (amInDanger && player.hasKick && this.config.useKick) {
      const kickDir = this.findKickableBomb(pos, state);
      if (kickDir) {
        return { seq: this.seq, direction: kickDir, action: null, tick: state.tick };
      }
    }

    // Priority 2: Flee from danger (with reaction delay for easy bots)
    if (amInDanger) {
      if (this.config.reactionDelay > 0) {
        if (this.reactionDelayRemaining > 0) {
          this.reactionDelayRemaining--;
          return null; // Still reacting, do nothing
        }
        // Reaction delay already elapsed, proceed to flee
      }

      const fleeDir = this.findSafeDirection(pos, state, danger, bombPositions, otherPlayers);
      if (fleeDir) {
        this.lastDirection = fleeDir;
        return { seq: this.seq, direction: fleeDir, action: null, tick: state.tick };
      }
      // No safe direction — try any movable direction as last resort
      for (const dir of DIRECTIONS) {
        if (state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers)) {
          this.lastDirection = dir;
          return { seq: this.seq, direction: dir, action: null, tick: state.tick };
        }
      }
      return null; // Completely stuck
    } else {
      // Reset reaction delay when safe
      this.reactionDelayRemaining = this.config.reactionDelay;
    }

    // Priority 3: Place bomb offensively near an enemy (if we can escape after)
    if (this.bombCooldown <= 0 && player.canPlaceBomb()) {
      const enemyAdjacent = this.isEnemyInBlastRange(pos, state, player);
      const canEscape = !this.config.escapeCheckBeforeBomb || this.canEscapeAfterBomb(pos, state, player, bombPositions, otherPlayers);
      if (enemyAdjacent && canEscape) {
        this.bombCooldown = this.config.bombCooldownMin + Math.floor(Math.random() * (this.config.bombCooldownMax - this.config.bombCooldownMin));
        return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
      }
    }

    // Priority 4: Place bomb near destructible wall (if we can escape after)
    if (this.bombCooldown <= 0 && player.canPlaceBomb()) {
      const canEscape = !this.config.escapeCheckBeforeBomb || this.canEscapeAfterBomb(pos, state, player, bombPositions, otherPlayers);
      if (this.isNearDestructible(pos, state) && canEscape) {
        this.bombCooldown = this.config.bombCooldownMin + Math.floor(Math.random() * (this.config.bombCooldownMax - this.config.bombCooldownMin));
        return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
      }
    }

    // Priority 5: Move toward a visible power-up
    const powerUpDir = this.findPowerUpDirection(pos, state, danger, bombPositions, otherPlayers);
    if (powerUpDir) {
      this.lastDirection = powerUpDir;
      return { seq: this.seq, direction: powerUpDir, action: null, tick: state.tick };
    }

    // Priority 6: Move toward nearest enemy (based on huntChance)
    if (Math.random() < this.config.huntChance) {
      const huntDir = this.findHuntDirection(pos, state, player, danger, bombPositions, otherPlayers);
      if (huntDir) {
        this.lastDirection = huntDir;
        return { seq: this.seq, direction: huntDir, action: null, tick: state.tick };
      }
    }

    // Priority 7: Wander — pick a safe, non-trapping direction
    const wanderDir = this.pickSafeWander(pos, state, danger, bombPositions, otherPlayers);
    if (wanderDir) {
      this.lastDirection = wanderDir;
      return { seq: this.seq, direction: wanderDir, action: null, tick: state.tick };
    }

    // Stay put if nothing safe
    return null;
  }

  /**
   * Build a set of cells that are in the blast zone of any bomb,
   * filtered by the bot's awareness range (manhattan distance from bot position).
   */
  private getDangerCells(state: GameStateManager, awarenessRange: number, botPos: Position): Set<string> {
    const danger = new Set<string>();

    // Active explosions
    for (const exp of state.explosions.values()) {
      for (const cell of exp.cells) {
        danger.add(`${cell.x},${cell.y}`);
      }
    }

    // Bombs — trace blast lines respecting walls
    for (const bomb of state.bombs.values()) {
      // Only be aware of bombs within our awareness range (manhattan distance from bot)
      const manhattanDist = Math.abs(bomb.position.x - botPos.x) + Math.abs(bomb.position.y - botPos.y);
      if (manhattanDist > awarenessRange) continue;

      // Center cell
      danger.add(`${bomb.position.x},${bomb.position.y}`);

      // Trace each direction, stopping at walls
      for (const { dx, dy } of Object.values(DIR_DELTA)) {
        for (let i = 1; i <= bomb.fireRange; i++) {
          const cx = bomb.position.x + dx * i;
          const cy = bomb.position.y + dy * i;
          const tile = state.collisionSystem.getTileAt(cx, cy);
          if (tile === 'wall') break;
          danger.add(`${cx},${cy}`);
          if (tile === 'destructible') break;
        }
      }
    }

    return danger;
  }

  /**
   * Find a direction to move that leads to a safe cell and doesn't trap us.
   */
  private findSafeDirection(
    pos: Position, state: GameStateManager, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): Direction | null {
    const candidates: { dir: Direction; escape: number }[] = [];

    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
      if (!newPos) continue;

      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue; // Don't move into another danger zone

      // Check how many escape routes exist from this new position (anti-trap)
      const escapeCount = this.countEscapeRoutes(newPos, state, danger, bombPositions, otherPlayers);
      if (escapeCount > 0 || !danger.has(key)) {
        candidates.push({ dir, escape: escapeCount });
      }
    }

    if (candidates.length === 0) return null;

    // Prefer directions with more escape routes
    candidates.sort((a, b) => b.escape - a.escape);
    return candidates[0].dir;
  }

  /**
   * Count how many safe cells are reachable from a position via BFS,
   * depth limited by config.escapeSearchDepth.
   */
  private countEscapeRoutes(
    pos: Position, state: GameStateManager, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): number {
    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier = [pos];
    let safeCount = 0;
    const maxDepth = this.config.escapeSearchDepth;

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: Position[] = [];
      for (const p of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(p.x, p.y, dir, bombPositions, otherPlayers);
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key)) continue;
          visited.add(key);
          if (!danger.has(key)) {
            safeCount++;
            next.push(newPos);
          }
        }
      }
      frontier = next;
    }

    return safeCount;
  }

  /**
   * Check if any enemy player is within our blast range along a cardinal direction
   * (line of sight, respecting walls).
   */
  private isEnemyInBlastRange(pos: Position, state: GameStateManager, player: Player): boolean {
    for (const { dx, dy } of Object.values(DIR_DELTA)) {
      for (let i = 1; i <= player.fireRange; i++) {
        const cx = pos.x + dx * i;
        const cy = pos.y + dy * i;
        const tile = state.collisionSystem.getTileAt(cx, cy);
        if (tile === 'wall' || tile === 'destructible') break;

        for (const other of state.players.values()) {
          if (other.id !== player.id && other.alive &&
              other.position.x === cx && other.position.y === cy) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Before placing a bomb, verify the bot can escape its own blast.
   * Simulates adding a bomb at pos and checks if any adjacent cell is safe.
   */
  private canEscapeAfterBomb(
    pos: Position, state: GameStateManager, player: Player,
    bombPositions: Position[], otherPlayers: Position[]
  ): boolean {
    // Simulate danger with a new bomb at our position
    const futureBombPositions = [...bombPositions, pos];
    const futureDanger = new Set(this.getDangerCells(state, 999, pos));

    // Add our own would-be bomb blast
    futureDanger.add(`${pos.x},${pos.y}`);
    for (const { dx, dy } of Object.values(DIR_DELTA)) {
      for (let i = 1; i <= player.fireRange; i++) {
        const cx = pos.x + dx * i;
        const cy = pos.y + dy * i;
        const tile = state.collisionSystem.getTileAt(cx, cy);
        if (tile === 'wall') break;
        futureDanger.add(`${cx},${cy}`);
        if (tile === 'destructible') break;
      }
    }

    // Check if we can reach a safe cell
    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, futureBombPositions, otherPlayers);
      if (!newPos) continue;
      if (!futureDanger.has(`${newPos.x},${newPos.y}`)) return true;

      // Check one more step deep
      for (const dir2 of DIRECTIONS) {
        const newPos2 = state.collisionSystem.canMoveTo(newPos.x, newPos.y, dir2, futureBombPositions, otherPlayers);
        if (!newPos2) continue;
        if (!futureDanger.has(`${newPos2.x},${newPos2.y}`)) return true;
      }
    }

    return false;
  }

  /**
   * Check if any adjacent tile is a destructible wall.
   */
  private isNearDestructible(pos: Position, state: GameStateManager): boolean {
    for (const { dx, dy } of Object.values(DIR_DELTA)) {
      if (state.collisionSystem.getTileAt(pos.x + dx, pos.y + dy) === 'destructible') return true;
    }
    return false;
  }

  /**
   * Look in cardinal directions for a visible power-up (not blocked by walls)
   * and return the direction to move toward it.
   */
  private findPowerUpDirection(
    pos: Position, state: GameStateManager, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): Direction | null {
    let bestDir: Direction | null = null;
    let bestDist = Infinity;

    for (const dir of DIRECTIONS) {
      const { dx, dy } = DIR_DELTA[dir];
      for (let i = 1; i <= this.config.powerUpVision; i++) {
        const cx = pos.x + dx * i;
        const cy = pos.y + dy * i;
        const tile = state.collisionSystem.getTileAt(cx, cy);
        if (tile === 'wall' || tile === 'destructible') break;

        // Check for power-up at this cell
        for (const pu of state.powerUps.values()) {
          if (pu.position.x === cx && pu.position.y === cy && i < bestDist) {
            // Only go if the first step is safe and not trapping
            const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
            if (newPos && !danger.has(`${newPos.x},${newPos.y}`)) {
              bestDist = i;
              bestDir = dir;
            }
          }
        }
      }
    }

    return bestDir;
  }

  /**
   * Try to move generally toward the nearest enemy player, but only if safe.
   */
  private findHuntDirection(
    pos: Position, state: GameStateManager, player: Player, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): Direction | null {
    // Find nearest enemy
    let nearestDist = Infinity;
    let nearestPos: Position | null = null;
    for (const other of state.players.values()) {
      if (other.id === player.id || !other.alive) continue;
      const dist = Math.abs(other.position.x - pos.x) + Math.abs(other.position.y - pos.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPos = other.position;
      }
    }

    if (!nearestPos || nearestDist <= 1) return null; // Already adjacent or no enemies

    // Rank directions by which reduces distance to enemy
    const ranked: { dir: Direction; dist: number; escape: number }[] = [];
    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
      if (!newPos) continue;
      if (danger.has(`${newPos.x},${newPos.y}`)) continue;

      const escapeCount = this.countEscapeRoutes(newPos, state, danger, bombPositions, otherPlayers);
      if (escapeCount < 1) continue; // Don't walk into traps

      const newDist = Math.abs(nearestPos.x - newPos.x) + Math.abs(nearestPos.y - newPos.y);
      ranked.push({ dir, dist: newDist, escape: escapeCount });
    }

    if (ranked.length === 0) return null;

    // Prefer directions that get closer to enemy, with randomness based on optimalMoveChance
    ranked.sort((a, b) => a.dist - b.dist);

    if (Math.random() < this.config.optimalMoveChance || ranked.length === 1) {
      return ranked[0].dir;
    }
    return ranked[Math.floor(Math.random() * ranked.length)].dir;
  }

  /**
   * Wander in a safe, non-trapping direction.
   */
  private pickSafeWander(
    pos: Position, state: GameStateManager, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): Direction | null {
    const candidates: { dir: Direction; escape: number }[] = [];

    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
      if (!newPos) continue;
      if (danger.has(`${newPos.x},${newPos.y}`)) continue;

      const escapeCount = this.countEscapeRoutes(newPos, state, danger, bombPositions, otherPlayers);
      if (escapeCount >= 1) {
        candidates.push({ dir, escape: escapeCount });
      }
    }

    if (candidates.length === 0) {
      // Fallback: any movable non-danger direction
      for (const dir of DIRECTIONS) {
        const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
        if (newPos && !danger.has(`${newPos.x},${newPos.y}`)) return dir;
      }
      return null;
    }

    // Prefer continuing in the same direction if it's safe (less jittery movement)
    const currentDirCandidate = candidates.find(c => c.dir === this.lastDirection);
    if (currentDirCandidate && Math.random() < 0.6) {
      return currentDirCandidate.dir;
    }

    // Otherwise pick randomly from safe candidates, weighted by escape routes
    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled[0].dir;
  }

  /**
   * If a bomb is adjacent and we have kick, find the direction to kick it.
   * Only kick bombs that are threatening us (from another player).
   */
  private findKickableBomb(pos: Position, state: GameStateManager): Direction | null {
    for (const dir of DIRECTIONS) {
      const { dx, dy } = DIR_DELTA[dir];
      const adjX = pos.x + dx;
      const adjY = pos.y + dy;

      for (const bomb of state.bombs.values()) {
        if (bomb.position.x === adjX && bomb.position.y === adjY && !bomb.sliding) {
          // Check if the bomb can slide (next cell after bomb is clear)
          const behindX = adjX + dx;
          const behindY = adjY + dy;
          if (state.collisionSystem.isWalkable(behindX, behindY)) {
            // Check no other bomb or player blocking the slide path
            const blocked = Array.from(state.bombs.values()).some(b => b.id !== bomb.id && b.position.x === behindX && b.position.y === behindY)
              || Array.from(state.players.values()).some(p => p.alive && p.position.x === behindX && p.position.y === behindY);
            if (!blocked) {
              return dir;
            }
          }
        }
      }
    }
    return null;
  }
}
