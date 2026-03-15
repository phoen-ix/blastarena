import { PlayerInput, Direction, Position, TileType } from '@blast-arena/shared';
import { Player } from './Player';
import { GameStateManager } from './GameState';
import { Bomb } from './Bomb';
import { GameLogger } from '../utils/gameLogger';

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

function isDestructibleTile(tile: TileType): boolean {
  return tile === 'destructible' || tile === ('destructible_cracked' as TileType);
}

export interface BotDifficultyConfig {
  dangerAwareness: number | 'fireRange';
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
    dangerAwareness: 'fireRange',
    escapeSearchDepth: 3,
    bombCooldownMin: 40,
    bombCooldownMax: 70,
    escapeCheckBeforeBomb: false,
    huntChance: 0.2,
    powerUpVision: 2,
    optimalMoveChance: 0.4,
    useKick: false,
    reactionDelay: 3,
  },
  normal: {
    dangerAwareness: 99,
    escapeSearchDepth: 5,
    bombCooldownMin: 15,
    bombCooldownMax: 30,
    escapeCheckBeforeBomb: true,
    huntChance: 0.5,
    powerUpVision: 5,
    optimalMoveChance: 0.7,
    useKick: true,
    reactionDelay: 0,
  },
  hard: {
    dangerAwareness: 99,
    escapeSearchDepth: 8,
    bombCooldownMin: 8,
    bombCooldownMax: 18,
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
  private kickCooldown: number = 0;
  private config: BotDifficultyConfig;
  private reactionDelayRemaining: number = 0;

  constructor(difficulty: 'easy' | 'normal' | 'hard' = 'normal') {
    this.config = DIFFICULTY_PRESETS[difficulty];
  }

  private getAwarenessRange(playerFireRange: number): number {
    if (this.config.dangerAwareness === 'fireRange') return playerFireRange;
    return this.config.dangerAwareness;
  }

  generateInput(player: Player, state: GameStateManager, logger?: GameLogger | null): PlayerInput | null {
    if (!player.alive) return null;

    this.seq++;
    if (this.bombCooldown > 0) this.bombCooldown--;
    if (this.kickCooldown > 0) this.kickCooldown--;

    const pos = player.position;
    const bombPositions = Array.from(state.bombs.values()).map(b => b.position);
    const otherPlayers = Array.from(state.players.values())
      .filter(p => p.id !== player.id && p.alive)
      .map(p => p.position);

    const awarenessRange = this.getAwarenessRange(player.fireRange);
    const danger = this.getDangerCells(state, awarenessRange, pos);
    const amInDanger = danger.has(`${pos.x},${pos.y}`);

    const logDecision = (decision: string, details?: any) => {
      logger?.logBotDecision(player.id, player.displayName, decision, { pos, ...details });
    };

    // === PRIORITY 1: Kick threatening bomb (only when able to move) ===
    if (amInDanger && player.hasKick && this.config.useKick && player.canMove() && this.kickCooldown <= 0) {
      const kickDir = this.findKickableBomb(pos, state);
      if (kickDir) {
        this.kickCooldown = 3; // Prevent re-kicking for a few ticks
        logDecision('kick', { dir: kickDir });
        return { seq: this.seq, direction: kickDir, action: null, tick: state.tick };
      }
    }

    // === PRIORITY 2: Flee from danger (always check) ===
    if (amInDanger) {
      if (this.config.reactionDelay > 0) {
        if (this.reactionDelayRemaining > 0) {
          this.reactionDelayRemaining--;
          return null;
        }
      }

      // BFS escape: navigate THROUGH danger cells to reach nearest safe cell
      const escapeDir = this.findEscapeDirection(pos, state, danger, bombPositions, otherPlayers);
      if (escapeDir) {
        this.lastDirection = escapeDir;
        logDecision('flee', { dir: escapeDir });
        return { seq: this.seq, direction: escapeDir, action: null, tick: state.tick };
      }

      // Last resort: any movable direction (even into danger)
      for (const dir of DIRECTIONS) {
        if (state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers)) {
          this.lastDirection = dir;
          logDecision('flee_desperate', { dir });
          return { seq: this.seq, direction: dir, action: null, tick: state.tick };
        }
      }
      logDecision('stuck');
      return null;
    } else {
      this.reactionDelayRemaining = this.config.reactionDelay;
    }

    // === PRIORITY 2.5: Detonate remote bombs if enemy is in their blast zone ===
    if (player.hasRemoteBomb) {
      const ownRemoteBombs = Array.from(state.bombs.values())
        .filter(b => b.ownerId === player.id && b.bombType === 'remote');
      if (ownRemoteBombs.length > 0) {
        // Check if any enemy is in the blast zone of any of our remote bombs
        let enemyInBlast = false;
        for (const bomb of ownRemoteBombs) {
          for (const { dx, dy } of Object.values(DIR_DELTA)) {
            for (let i = 0; i <= bomb.fireRange; i++) {
              const cx = bomb.position.x + dx * i;
              const cy = bomb.position.y + dy * i;
              const tile = state.collisionSystem.getTileAt(cx, cy);
              if (tile === 'wall') break;
              if (isDestructibleTile(tile) && i > 0) break;
              for (const other of state.players.values()) {
                if (other.id !== player.id && other.alive &&
                    other.position.x === cx && other.position.y === cy) {
                  enemyInBlast = true;
                }
              }
              if (enemyInBlast) break;
            }
            if (enemyInBlast) break;
          }
          if (enemyInBlast) break;
        }
        // Also detonate if we've placed max bombs and need to free up slots
        const shouldDetonate = enemyInBlast || ownRemoteBombs.length >= player.maxBombs;
        if (shouldDetonate) {
          logDecision('detonate_remote', { count: ownRemoteBombs.length });
          return { seq: this.seq, direction: null, action: 'detonate', tick: state.tick };
        }
      }
    }

    // === PRIORITY 3: Bomb placement (check even when can't move) ===
    if (this.bombCooldown <= 0 && player.canPlaceBomb()) {
      const canEscape = !this.config.escapeCheckBeforeBomb ||
        this.canEscapeAfterBomb(pos, state, player, bombPositions, otherPlayers);

      if (canEscape) {
        // Offensive bomb: enemy in direct blast line
        if (this.isEnemyInBlastRange(pos, state, player)) {
          this.bombCooldown = this.config.bombCooldownMin +
            Math.floor(Math.random() * (this.config.bombCooldownMax - this.config.bombCooldownMin));
          logDecision('bomb_offensive', { cooldown: this.bombCooldown });
          return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
        }

        // Wall bomb: destructible wall adjacent
        if (this.isNearDestructible(pos, state)) {
          this.bombCooldown = this.config.bombCooldownMin +
            Math.floor(Math.random() * (this.config.bombCooldownMax - this.config.bombCooldownMin));
          logDecision('bomb_wall', { cooldown: this.bombCooldown });
          return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
        }
      }
    }

    // === MOVEMENT DECISIONS: only when player can actually move (prevents oscillation) ===
    if (!player.canMove()) return null;

    // Priority 4: Move toward a visible power-up
    const powerUpDir = this.findPowerUpDirection(pos, state, danger, bombPositions, otherPlayers);
    if (powerUpDir) {
      this.lastDirection = powerUpDir;
      logDecision('seek_powerup', { dir: powerUpDir });
      return { seq: this.seq, direction: powerUpDir, action: null, tick: state.tick };
    }

    // Priority 5: Move toward nearest enemy (BFS pathfinding)
    if (Math.random() < this.config.huntChance) {
      const huntDir = this.findHuntDirection(pos, state, player, danger, bombPositions, otherPlayers);
      if (huntDir) {
        this.lastDirection = huntDir;
        logDecision('hunt', { dir: huntDir });
        return { seq: this.seq, direction: huntDir, action: null, tick: state.tick };
      }
    }

    // Priority 6: Move toward nearest destructible wall to open the map
    const wallDir = this.findDestructibleWallDirection(pos, state, danger, bombPositions, otherPlayers);
    if (wallDir) {
      this.lastDirection = wallDir;
      logDecision('seek_wall', { dir: wallDir });
      return { seq: this.seq, direction: wallDir, action: null, tick: state.tick };
    }

    // Priority 7: Wander — pick a safe, non-trapping direction
    const wanderDir = this.pickSafeWander(pos, state, danger, bombPositions, otherPlayers);
    if (wanderDir) {
      this.lastDirection = wanderDir;
      logDecision('wander', { dir: wanderDir });
      return { seq: this.seq, direction: wanderDir, action: null, tick: state.tick };
    }

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
      const manhattanDist = Math.abs(bomb.position.x - botPos.x) + Math.abs(bomb.position.y - botPos.y);
      if (manhattanDist > awarenessRange) continue;

      danger.add(`${bomb.position.x},${bomb.position.y}`);

      for (const { dx, dy } of Object.values(DIR_DELTA)) {
        for (let i = 1; i <= bomb.fireRange; i++) {
          const cx = bomb.position.x + dx * i;
          const cy = bomb.position.y + dy * i;
          const tile = state.collisionSystem.getTileAt(cx, cy);
          if (tile === 'wall') break;
          danger.add(`${cx},${cy}`);
          if (isDestructibleTile(tile)) break;
        }
      }
    }

    return danger;
  }

  /**
   * BFS escape: navigate THROUGH danger cells to find the nearest safe cell.
   * This ensures the bot follows the same escape path that canEscapeAfterBomb validated.
   * Unlike the old findSafeDirection which skipped danger cells (causing the bot to
   * take a different, often dead-end path), this explores danger cells in the BFS.
   */
  private findEscapeDirection(
    pos: Position, state: GameStateManager, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): Direction | null {
    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier: { pos: Position; firstDir: Direction }[] = [];

    // Seed with immediate neighbors
    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      // If this cell is already safe, return immediately
      if (!danger.has(key)) return dir;

      frontier.push({ pos: newPos, firstDir: dir });
    }

    // BFS through danger cells to find safety
    for (let depth = 0; depth < this.config.escapeSearchDepth && frontier.length > 0; depth++) {
      const next: { pos: Position; firstDir: Direction }[] = [];
      for (const entry of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(entry.pos.x, entry.pos.y, dir, bombPositions, otherPlayers);
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key)) continue;
          visited.add(key);

          if (!danger.has(key)) return entry.firstDir; // Safe cell found!

          next.push({ pos: newPos, firstDir: entry.firstDir });
        }
      }
      frontier = next;
    }

    return null;
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
   * Check if any enemy player is in direct blast line (line of sight along
   * cardinal directions, respecting walls). Only checks actual blast range.
   */
  private isEnemyInBlastRange(pos: Position, state: GameStateManager, player: Player): boolean {
    for (const { dx, dy } of Object.values(DIR_DELTA)) {
      for (let i = 1; i <= player.fireRange + 1; i++) {
        const cx = pos.x + dx * i;
        const cy = pos.y + dy * i;
        const tile = state.collisionSystem.getTileAt(cx, cy);
        if (tile === 'wall' || isDestructibleTile(tile)) break;

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
   * Uses findEscapeDirection with simulated future danger to ensure the bot
   * can actually reach a safe cell via the same BFS it uses to flee.
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
        if (isDestructibleTile(tile)) break;
      }
    }

    // Use the same BFS escape logic as findEscapeDirection
    return this.findEscapeDirection(pos, state, futureDanger, futureBombPositions, otherPlayers) !== null;
  }

  /**
   * Check if any adjacent tile is a destructible wall.
   */
  private isNearDestructible(pos: Position, state: GameStateManager): boolean {
    for (const { dx, dy } of Object.values(DIR_DELTA)) {
      if (isDestructibleTile(state.collisionSystem.getTileAt(pos.x + dx, pos.y + dy))) return true;
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
        if (tile === 'wall' || isDestructibleTile(tile)) break;

        for (const pu of state.powerUps.values()) {
          if (pu.position.x === cx && pu.position.y === cy && i < bestDist) {
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
   * BFS pathfinding toward nearest enemy. Navigates around walls and obstacles.
   * Returns the first-step direction to walk toward the closest reachable enemy.
   */
  private findHuntDirection(
    pos: Position, state: GameStateManager, player: Player, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): Direction | null {
    const enemyPositions = new Set<string>();
    for (const other of state.players.values()) {
      if (other.id !== player.id && other.alive) {
        enemyPositions.add(`${other.position.x},${other.position.y}`);
      }
    }
    if (enemyPositions.size === 0) return null;

    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier: { pos: Position; firstDir: Direction }[] = [];

    // Seed with immediate neighbors (use real collision for first step)
    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue;

      // Avoid walking into traps
      const escapeCount = this.countEscapeRoutes(newPos, state, danger, bombPositions, otherPlayers);
      if (escapeCount < 1) continue;

      visited.add(key);

      // Check if this cell IS an enemy position
      if (enemyPositions.has(key)) return dir;

      frontier.push({ pos: newPos, firstDir: dir });
    }

    // BFS up to 15 steps — relax player blocking (enemies move)
    for (let depth = 0; depth < 15 && frontier.length > 0; depth++) {
      const next: { pos: Position; firstDir: Direction }[] = [];
      for (const entry of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(entry.pos.x, entry.pos.y, dir, bombPositions, []);
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key) || danger.has(key)) continue;
          visited.add(key);

          if (enemyPositions.has(key)) return entry.firstDir;

          next.push({ pos: newPos, firstDir: entry.firstDir });
        }
      }
      frontier = next;
    }

    return null;
  }

  /**
   * BFS to find the direction of the nearest reachable destructible wall.
   * Returns the first-step direction to walk toward it.
   */
  private findDestructibleWallDirection(
    pos: Position, state: GameStateManager, danger: Set<string>,
    bombPositions: Position[], otherPlayers: Position[]
  ): Direction | null {
    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier: { pos: Position; firstDir: Direction }[] = [];

    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers);
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue;
      visited.add(key);
      // Check if this step is already adjacent to a destructible wall
      for (const { dx, dy } of Object.values(DIR_DELTA)) {
        if (isDestructibleTile(state.collisionSystem.getTileAt(newPos.x + dx, newPos.y + dy))) {
          return dir;
        }
      }
      frontier.push({ pos: newPos, firstDir: dir });
    }

    // BFS up to 10 steps
    for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
      const next: { pos: Position; firstDir: Direction }[] = [];
      for (const entry of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(entry.pos.x, entry.pos.y, dir, bombPositions, otherPlayers);
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key) || danger.has(key)) continue;
          visited.add(key);
          for (const { dx, dy } of Object.values(DIR_DELTA)) {
            if (isDestructibleTile(state.collisionSystem.getTileAt(newPos.x + dx, newPos.y + dy))) {
              return entry.firstDir;
            }
          }
          next.push({ pos: newPos, firstDir: entry.firstDir });
        }
      }
      frontier = next;
    }

    return null;
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

    const shuffled = candidates.sort(() => Math.random() - 0.5);
    return shuffled[0].dir;
  }

  /**
   * If a bomb is adjacent and we have kick, find the direction to kick it.
   */
  private findKickableBomb(pos: Position, state: GameStateManager): Direction | null {
    for (const dir of DIRECTIONS) {
      const { dx, dy } = DIR_DELTA[dir];
      const adjX = pos.x + dx;
      const adjY = pos.y + dy;

      for (const bomb of state.bombs.values()) {
        if (bomb.position.x === adjX && bomb.position.y === adjY && !bomb.sliding) {
          const behindX = adjX + dx;
          const behindY = adjY + dy;
          if (state.collisionSystem.isWalkable(behindX, behindY)) {
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
