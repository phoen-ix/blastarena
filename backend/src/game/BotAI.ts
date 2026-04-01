import { PlayerInput, Direction, Position, TileType, PowerUpType } from '@blast-arena/shared';
import {
  MOVE_COOLDOWN_BASE,
  BOMB_TIMER_TICKS,
  MAX_SPEED,
  MAX_FIRE_RANGE,
  MAX_BOMBS,
} from '@blast-arena/shared';
import { Player } from './Player';
import { GameStateManager } from './GameState';
import { GameLogger } from '../utils/gameLogger';

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const DIR_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
/** Pre-computed direction delta array — avoids Object.values() allocation per call */
const DIR_DELTA_ARRAY = Object.values(DIR_DELTA);

function isDestructibleTile(tile: TileType): boolean {
  return tile === 'destructible' || tile === ('destructible_cracked' as TileType);
}

/** Returns true if two players are on the same team (team mode only) */
function isTeammate(self: Player, other: Player): boolean {
  return self.team !== null && other.team === self.team;
}

/** Score a power-up based on how useful it is to the player (higher = better) */
function scorePowerUp(type: PowerUpType, player: Player): number {
  switch (type) {
    case 'shield':
      return player.hasShield ? 1 : 10;
    case 'speed_up':
      return player.speed >= MAX_SPEED ? 0 : 8;
    case 'kick':
      return player.hasKick ? 0 : 7;
    case 'bomb_throw':
      return player.hasBombThrow ? 0 : 7;
    case 'pierce_bomb':
      return player.hasPierceBomb ? 0 : 6;
    case 'remote_bomb':
      return player.hasRemoteBomb ? 0 : 5;
    case 'line_bomb':
      return player.hasLineBomb ? 0 : 5;
    case 'fire_up':
      return player.fireRange >= MAX_FIRE_RANGE ? 0 : 4;
    case 'bomb_up':
      return player.maxBombs >= MAX_BOMBS ? 0 : 3;
    default:
      return 2;
  }
}

export interface IBotAI {
  generateInput(
    player: Player,
    state: GameStateManager,
    logger?: GameLogger | null,
  ): PlayerInput | null;
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
  huntSearchDepth: number;
  dangerTimerThreshold: number;
  roamAfterIdleTicks: number;
  wrongMoveChance: number;
  randomBombChance: number;
  chainReactionAwareness: boolean;
  shieldAggression: boolean;
  lateGameBombCooldownMin: number;
  lateGameBombCooldownMax: number;
  huntStuckThreshold: number;
  huntStuckMaxTicks: number;
  stalemateBreaker: boolean;
  stalemateThresholdTicks: number;
  remoteHoldThreshold: number;
  enableReachabilityFilter: boolean;
  duelStalemateThresholdTicks: number;
}

const DIFFICULTY_PRESETS: Record<'easy' | 'normal' | 'hard', BotDifficultyConfig> = {
  easy: {
    dangerAwareness: 'fireRange',
    escapeSearchDepth: 2,
    bombCooldownMin: 45,
    bombCooldownMax: 80,
    escapeCheckBeforeBomb: false,
    huntChance: 0.15,
    powerUpVision: 1,
    optimalMoveChance: 0.35,
    useKick: false,
    reactionDelay: 5,
    huntSearchDepth: 6,
    dangerTimerThreshold: 0,
    roamAfterIdleTicks: 0,
    wrongMoveChance: 0.25,
    randomBombChance: 0.12,
    chainReactionAwareness: false,
    shieldAggression: false,
    lateGameBombCooldownMin: 0,
    lateGameBombCooldownMax: 0,
    huntStuckThreshold: 0,
    huntStuckMaxTicks: 0,
    stalemateBreaker: false,
    stalemateThresholdTicks: 0,
    remoteHoldThreshold: 20,
    enableReachabilityFilter: false,
    duelStalemateThresholdTicks: 0,
  },
  normal: {
    dangerAwareness: 99,
    escapeSearchDepth: 8,
    bombCooldownMin: 15,
    bombCooldownMax: 25,
    escapeCheckBeforeBomb: true,
    huntChance: 0.9,
    powerUpVision: 8,
    optimalMoveChance: 0.8,
    useKick: true,
    reactionDelay: 0,
    huntSearchDepth: 25,
    dangerTimerThreshold: 40,
    roamAfterIdleTicks: 60,
    wrongMoveChance: 0,
    randomBombChance: 0,
    chainReactionAwareness: false,
    shieldAggression: false,
    lateGameBombCooldownMin: 0,
    lateGameBombCooldownMax: 0,
    huntStuckThreshold: 3,
    huntStuckMaxTicks: 60,
    stalemateBreaker: true,
    stalemateThresholdTicks: 100,
    remoteHoldThreshold: 40,
    enableReachabilityFilter: true,
    duelStalemateThresholdTicks: 200,
  },
  hard: {
    dangerAwareness: 99,
    escapeSearchDepth: 15,
    bombCooldownMin: 5,
    bombCooldownMax: 12,
    escapeCheckBeforeBomb: true,
    huntChance: 0.95,
    powerUpVision: 15,
    optimalMoveChance: 0.98,
    useKick: true,
    reactionDelay: 0,
    huntSearchDepth: 40,
    dangerTimerThreshold: 50,
    roamAfterIdleTicks: 40,
    wrongMoveChance: 0,
    randomBombChance: 0,
    chainReactionAwareness: true,
    shieldAggression: true,
    lateGameBombCooldownMin: 3,
    lateGameBombCooldownMax: 6,
    huntStuckThreshold: 3,
    huntStuckMaxTicks: 40,
    stalemateBreaker: true,
    stalemateThresholdTicks: 60,
    remoteHoldThreshold: 60,
    enableReachabilityFilter: true,
    duelStalemateThresholdTicks: 120,
  },
};

export class BotAI implements IBotAI {
  private seq: number = 0;
  private lastDirection: Direction = 'down';
  private bombCooldown: number = 0;
  private kickCooldown: number = 0;
  private config: BotDifficultyConfig;
  private reactionDelayRemaining: number = 0;
  private ticksSinceEnemyContact: number = 0;

  // Anti-oscillation: flee stuck detection
  private lastFleePos: string | null = null;
  private fleeStuckTicks: number = 0;

  // Anti-oscillation: position history (last 4 positions)
  private posHistory: string[] = [];

  // Hunt persistence: once hunting, stay in hunt mode for several ticks
  private huntLockTicks: number = 0;
  private huntTargetId: number | null = null;
  private wasHunting: boolean = false;

  // Track max fire range seen on map for dynamic escape depth
  private maxFireRangeOnMap: number = 0;

  // Hunt oscillation detection (Fix C)
  private huntPosHistory: string[] = [];
  private huntWithoutProgressTicks: number = 0;
  private huntStuck: boolean = false;
  private lastHuntKills: number = 0;
  private huntStuckCooldown: number = 0;

  // Shield stalemate breaker (Fix A)
  private stalemateTicks: number = 0;
  private lastStalemateKills: number = 0;
  private stalemateActive: boolean = false;

  // Strategic remote bomb detonation (Fix B)
  private remoteBombHoldTicks: number = 0;

  // Delayed remote self-unblock (Change 5B)
  private remoteBlockedTicks: number = 0;

  // Duel stalemate breaker (Change 3)
  private duelStalemateTicks: number = 0;
  private lastDuelKills: number = 0;

  constructor(
    difficulty: 'easy' | 'normal' | 'hard' = 'normal',
    mapSize?: { width: number; height: number },
  ) {
    this.config = { ...DIFFICULTY_PRESETS[difficulty] };

    // Scale parameters based on map size relative to default 15×13 (Change 4)
    if (mapSize) {
      const referenceArea = 15 * 13;
      const scale = Math.max(1, Math.sqrt((mapSize.width * mapSize.height) / referenceArea));
      this.config.huntSearchDepth = Math.min(80, Math.round(this.config.huntSearchDepth * scale));
      this.config.escapeSearchDepth = Math.min(
        25,
        Math.round(this.config.escapeSearchDepth * scale),
      );
      this.config.roamAfterIdleTicks = Math.max(
        5,
        Math.round(this.config.roamAfterIdleTicks / scale),
      );
      this.config.powerUpVision = Math.min(40, Math.round(this.config.powerUpVision * scale));
    }
  }

  private getAwarenessRange(playerFireRange: number): number {
    if (this.config.dangerAwareness === 'fireRange') return playerFireRange;
    return this.config.dangerAwareness;
  }

  /**
   * Return DIRECTIONS ordered so lastDirection comes first.
   * This gives BFS a stable tie-break without any commitment mechanism.
   */
  private orderedDirs(): Direction[] {
    if (!this.lastDirection) return DIRECTIONS;
    return [this.lastDirection, ...DIRECTIONS.filter((d) => d !== this.lastDirection)];
  }

  /**
   * Check if moving to newPos would revisit a recent position (oscillation).
   */
  private wouldOscillate(newPos: Position): boolean {
    const key = `${newPos.x},${newPos.y}`;
    // Check all entries except the most recent (current position)
    for (let i = 0; i < this.posHistory.length - 1; i++) {
      if (this.posHistory[i] === key) return true;
    }
    return false;
  }

  generateInput(
    player: Player,
    state: GameStateManager,
    logger?: GameLogger | null,
  ): PlayerInput | null {
    if (!player.alive) return null;

    this.seq++;
    if (this.bombCooldown > 0) this.bombCooldown--;
    if (this.kickCooldown > 0) this.kickCooldown--;

    const pos = player.position;

    // Track position history for oscillation prevention
    const posKey = `${pos.x},${pos.y}`;
    if (this.posHistory.length === 0 || this.posHistory[this.posHistory.length - 1] !== posKey) {
      this.posHistory.push(posKey);
      if (this.posHistory.length > 4) this.posHistory.shift();
    }

    const bombPositions = Array.from(state.bombs.values()).map((b) => b.position);
    // Cache alive enemies once — reused for stalemate detection, roaming, etc.
    // In team mode, teammates are excluded from enemies but included in otherPlayers (for collision)
    const aliveEnemies: Player[] = [];
    const otherPlayers: Position[] = [];
    for (const p of state.players.values()) {
      if (p.id !== player.id && p.alive) {
        otherPlayers.push(p.position);
        if (!isTeammate(player, p)) {
          aliveEnemies.push(p);
        }
      }
    }

    // Track max fire range on map for dynamic escape depth scaling
    if (player.fireRange > this.maxFireRangeOnMap) {
      this.maxFireRangeOnMap = player.fireRange;
    }

    // Track enemy proximity for roaming behavior
    const nearestEnemyDist = this.getNearestEnemyManhattan(pos, state, player);
    if (nearestEnemyDist !== null && nearestEnemyDist <= 8) {
      this.ticksSinceEnemyContact = 0;
    } else {
      this.ticksSinceEnemyContact++;
    }

    const awarenessRange = this.getAwarenessRange(player.fireRange);
    const danger = this.getDangerCells(state, awarenessRange, pos);
    const amInDanger = danger.has(`${pos.x},${pos.y}`);
    // Cache explosion cells once per tick — reused in escape, flee, and bomb placement logic
    const explosionCells = this.getActiveExplosionCells(state);

    // Game phase system: mid-game (35%+) and late-game (60%+) for progressive aggression
    const timeElapsed = state.tick / 20; // TICK_RATE = 20
    const timeRatio = timeElapsed / (state.roundTime || 180);
    const midGame = timeRatio >= 0.35;
    const lateGame = timeRatio >= 0.6;

    // === Stalemate detection (Fix A) ===
    if (this.config.stalemateBreaker) {
      let shieldedEnemyNearby = false;
      const alivePlayers = aliveEnemies;
      if (player.hasShield) {
        for (const other of alivePlayers) {
          if (
            other.hasShield &&
            Math.abs(other.position.x - pos.x) + Math.abs(other.position.y - pos.y) <= 8
          ) {
            shieldedEnemyNearby = true;
            break;
          }
        }
      }
      const fewPlayersLeft = alivePlayers.length <= 2;
      if (
        shieldedEnemyNearby &&
        player.kills === this.lastStalemateKills &&
        (lateGame || fewPlayersLeft)
      ) {
        this.stalemateTicks++;
        if (this.stalemateTicks >= this.config.stalemateThresholdTicks) {
          this.stalemateActive = true;
        }
      } else {
        this.stalemateTicks = 0;
        this.lastStalemateKills = player.kills;
        this.stalemateActive = false;
      }
    }

    // === Duel stalemate detection (Change 3) ===
    if (
      !this.stalemateActive &&
      this.config.duelStalemateThresholdTicks > 0 &&
      aliveEnemies.length <= 1
    ) {
      if (player.kills === this.lastDuelKills) {
        this.duelStalemateTicks++;
        if (this.duelStalemateTicks >= this.config.duelStalemateThresholdTicks) {
          this.stalemateActive = true;
        }
      } else {
        this.duelStalemateTicks = 0;
        this.lastDuelKills = player.kills;
      }
    }

    // === Hunt oscillation cooldown tick (Fix C) ===
    if (this.huntStuckCooldown > 0) this.huntStuckCooldown--;
    if (this.huntStuckCooldown <= 0 && this.huntStuck) {
      this.huntStuck = false;
      this.huntPosHistory = [];
      this.huntWithoutProgressTicks = 0;
    }

    const logDecision = (decision: string, details?: any) => {
      logger?.logBotDecision(player.id, player.username, decision, { pos, ...details });
    };

    // === PRIORITY 1: Kick threatening bomb (only when able to move) ===
    if (
      amInDanger &&
      player.hasKick &&
      this.config.useKick &&
      player.canMove() &&
      this.kickCooldown <= 0
    ) {
      const kickDir = this.findKickableBomb(pos, state, player);
      if (kickDir) {
        this.kickCooldown = 2;
        logDecision('kick', { dir: kickDir });
        return { seq: this.seq, direction: kickDir, action: null, tick: state.tick };
      }
    }

    // === PRIORITY 2: Flee from danger ===
    if (amInDanger) {
      if (this.config.reactionDelay > 0) {
        if (this.reactionDelayRemaining > 0) {
          this.reactionDelayRemaining--;
          return null;
        }
      }

      const escapeResult = this.findEscapeDirection(
        pos,
        state,
        danger,
        bombPositions,
        otherPlayers,
        explosionCells,
      );
      if (escapeResult) {
        let escapeDir = escapeResult.dir;

        // Easy bots sometimes flee in wrong direction
        if (this.config.wrongMoveChance > 0 && Math.random() < this.config.wrongMoveChance) {
          const altDirs = DIRECTIONS.filter((d) => d !== escapeDir);
          for (const d of altDirs.sort(() => Math.random() - 0.5)) {
            if (state.collisionSystem.canMoveTo(pos.x, pos.y, d, bombPositions, otherPlayers)) {
              escapeDir = d;
              break;
            }
          }
        }

        const posKey = `${pos.x},${pos.y}`;
        // Detect stuck: same position for 5+ movable ticks — try alternative direction
        // Only count ticks where the bot can actually move (not during movement cooldown)
        if (player.canMove() && this.lastFleePos && posKey === this.lastFleePos) {
          this.fleeStuckTicks++;
          if (this.fleeStuckTicks >= 5) {
            // Two-pass: first try non-danger walkable directions, then any walkable
            const safeDirs: Direction[] = [];
            const anyDirs: Direction[] = [];
            for (const dir of DIRECTIONS) {
              if (dir === escapeDir) continue;
              const unstickPos = state.collisionSystem.canMoveTo(
                pos.x,
                pos.y,
                dir,
                bombPositions,
                otherPlayers,
              );
              if (!unstickPos) continue;
              const unstickKey = `${unstickPos.x},${unstickPos.y}`;
              if (explosionCells.has(unstickKey)) continue;
              anyDirs.push(dir);
              if (!danger.has(unstickKey)) {
                safeDirs.push(dir);
              }
            }
            const candidates = safeDirs.length > 0 ? safeDirs : anyDirs;
            if (candidates.length > 0) {
              const dir = candidates[Math.floor(Math.random() * candidates.length)];
              this.lastDirection = dir;
              this.fleeStuckTicks = 0;
              this.lastFleePos = null;
              logDecision('flee_unstick', { dir });
              return { seq: this.seq, direction: dir, action: null, tick: state.tick };
            }
          }
        } else if (!this.lastFleePos || posKey !== this.lastFleePos) {
          this.lastFleePos = posKey;
          this.fleeStuckTicks = 0;
        }
        this.lastDirection = escapeDir;
        logger?.logBotPathfinding(
          player.id,
          player.username,
          'escape_bfs',
          this.config.escapeSearchDepth,
          null,
        );
        logDecision('flee', { dir: escapeDir });
        return { seq: this.seq, direction: escapeDir, action: null, tick: state.tick };
      }

      // Last resort: any movable direction, but prefer non-explosion cells
      let desperateDir: Direction | null = null;
      for (const dir of DIRECTIONS) {
        const newPos = state.collisionSystem.canMoveTo(
          pos.x,
          pos.y,
          dir,
          bombPositions,
          otherPlayers,
        );
        if (!newPos) continue;
        if (!explosionCells.has(`${newPos.x},${newPos.y}`)) {
          this.lastDirection = dir;
          logDecision('flee_desperate', { dir });
          return { seq: this.seq, direction: dir, action: null, tick: state.tick };
        }
        if (!desperateDir) desperateDir = dir;
      }
      if (desperateDir) {
        this.lastDirection = desperateDir;
        logDecision('flee_desperate', { dir: desperateDir, intoExplosion: true });
        return { seq: this.seq, direction: desperateDir, action: null, tick: state.tick };
      }

      // Completely stuck: accept fate (don't bomb out of traps — feels unfair to human players)
      logDecision('stuck');
      return null;
    } else {
      this.reactionDelayRemaining = this.config.reactionDelay;
      this.lastFleePos = null;
      this.fleeStuckTicks = 0;
    }

    // === PRIORITY 2.5: Detonate remote bombs if enemy is in their blast zone ===
    if (player.hasRemoteBomb) {
      const ownRemoteBombs = Array.from(state.bombs.values()).filter(
        (b) => b.ownerId === player.id && b.bombType === 'remote',
      );
      if (ownRemoteBombs.length > 0) {
        let enemyInBlast = false;
        let enemyInBlastShielded = false;
        for (const bomb of ownRemoteBombs) {
          for (const { dx, dy } of DIR_DELTA_ARRAY) {
            for (let i = 0; i <= bomb.fireRange; i++) {
              const cx = bomb.position.x + dx * i;
              const cy = bomb.position.y + dy * i;
              const tile = state.collisionSystem.getTileAt(cx, cy);
              if (tile === 'wall') break;
              if (isDestructibleTile(tile) && !bomb.isPierce && i > 0) break;
              for (const other of state.players.values()) {
                if (
                  other.id !== player.id &&
                  other.alive &&
                  !isTeammate(player, other) &&
                  other.position.x === cx &&
                  other.position.y === cy
                ) {
                  if (other.invulnerableTicks > 0) continue;
                  enemyInBlast = true;
                  if (other.hasShield) enemyInBlastShielded = true;
                }
              }
              if (enemyInBlast) break;
            }
            if (enemyInBlast) break;
          }
          if (enemyInBlast) break;
        }

        // Proximity check: enemy within manhattan distance 2 of any remote bomb
        let enemyNearBomb = false;
        if (!enemyInBlast) {
          for (const bomb of ownRemoteBombs) {
            for (const other of state.players.values()) {
              if (
                other.id !== player.id &&
                other.alive &&
                !isTeammate(player, other) &&
                other.invulnerableTicks <= 0
              ) {
                const dist =
                  Math.abs(other.position.x - bomb.position.x) +
                  Math.abs(other.position.y - bomb.position.y);
                if (dist <= 2) {
                  enemyNearBomb = true;
                  break;
                }
              }
            }
            if (enemyNearBomb) break;
          }
        }

        // Self-damage check: don't detonate if the bot is in its own blast zone
        let selfInBlast = false;
        if (!player.hasShield) {
          for (const bomb of ownRemoteBombs) {
            if (selfInBlast) break;
            // Check bomb center
            if (bomb.position.x === pos.x && bomb.position.y === pos.y) {
              selfInBlast = true;
              break;
            }
            for (const { dx, dy } of DIR_DELTA_ARRAY) {
              for (let i = 1; i <= bomb.fireRange; i++) {
                const cx = bomb.position.x + dx * i;
                const cy = bomb.position.y + dy * i;
                const tile = state.collisionSystem.getTileAt(cx, cy);
                if (tile === 'wall') break;
                if (isDestructibleTile(tile) && !bomb.isPierce) break;
                if (cx === pos.x && cy === pos.y) {
                  selfInBlast = true;
                  break;
                }
              }
              if (selfInBlast) break;
            }
          }
        }

        // Compute blast cells from own remote bombs to check if they block movement
        const ownRemoteBlastCells = new Set<string>();
        for (const bomb of ownRemoteBombs) {
          ownRemoteBlastCells.add(`${bomb.position.x},${bomb.position.y}`);
          for (const { dx, dy } of DIR_DELTA_ARRAY) {
            for (let i = 1; i <= bomb.fireRange; i++) {
              const cx = bomb.position.x + dx * i;
              const cy = bomb.position.y + dy * i;
              const tile = state.collisionSystem.getTileAt(cx, cy);
              if (tile === 'wall') break;
              ownRemoteBlastCells.add(`${cx},${cy}`);
              if (isDestructibleTile(tile) && !bomb.isPierce) break;
            }
          }
        }

        // Check if any walkable direction is blocked by own remote bomb blast
        let movementBlockedByOwnBomb = false;
        for (const dir of DIRECTIONS) {
          const dest = state.collisionSystem.canMoveTo(
            pos.x,
            pos.y,
            dir,
            bombPositions,
            otherPlayers,
          );
          if (!dest) continue;
          const destKey = `${dest.x},${dest.y}`;
          if (ownRemoteBlastCells.has(destKey) && danger.has(destKey)) {
            movementBlockedByOwnBomb = true;
            break;
          }
        }

        // Track hold time when at max bombs (Fix B)
        if (ownRemoteBombs.length >= player.maxBombs) {
          this.remoteBombHoldTicks++;
        } else {
          this.remoteBombHoldTicks = 0;
        }

        // Shield-aware sacrifice: detonate even when selfInBlast if bot has shield and enemy doesn't
        const shieldSacrifice =
          enemyInBlast && selfInBlast && player.hasShield && !enemyInBlastShielded;

        // Delayed self-unblock: increment counter instead of immediate detonation (Change 5B)
        const nearbyEnemy = nearestEnemyDist !== null && nearestEnemyDist <= 5;
        if (movementBlockedByOwnBomb && !selfInBlast) {
          this.remoteBlockedTicks++;
        } else {
          this.remoteBlockedTicks = 0;
        }
        const delayedSelfUnblock =
          movementBlockedByOwnBomb && !selfInBlast && (this.remoteBlockedTicks > 10 || nearbyEnemy);

        const shouldDetonate =
          (enemyInBlast && !selfInBlast) ||
          shieldSacrifice ||
          enemyNearBomb ||
          delayedSelfUnblock ||
          (ownRemoteBombs.length >= player.maxBombs &&
            !selfInBlast &&
            (this.remoteBombHoldTicks >= this.config.remoteHoldThreshold || this.stalemateActive));

        if (shouldDetonate) {
          this.remoteBombHoldTicks = 0;
          logDecision('detonate_remote', {
            count: ownRemoteBombs.length,
            enemyInBlast,
            enemyNearBomb,
            shieldSacrifice,
            selfBlocked: movementBlockedByOwnBomb,
          });
          return { seq: this.seq, direction: null, action: 'detonate', tick: state.tick };
        }
      }
    }

    // === PRIORITY 3: Bomb placement ===
    // Random bomb placement for easy bots (before safety checks)
    if (
      this.config.randomBombChance > 0 &&
      Math.random() < this.config.randomBombChance &&
      this.bombCooldown <= 0 &&
      player.canPlaceBomb()
    ) {
      this.bombCooldown = this.config.bombCooldownMax;
      logDecision('bomb_random');
      return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
    }

    // Don't place bombs if we can't move yet (cooldown) — we need to flee immediately after
    if (this.bombCooldown <= 0 && player.canPlaceBomb() && player.canMove()) {
      // Remote bomb self-block guard (Change 5A): skip placement if it would trap us
      if (
        player.hasRemoteBomb &&
        !this.isEnemyInBlastRange(pos, state, player) &&
        this.wouldRemoteBombSelfBlock(pos, state, player, bombPositions, otherPlayers)
      ) {
        // Skip bomb placement — let hunt/roam reposition first
      } else {
        // Dead-end check: require more walkable dirs at high fire range
        let walkableDirs = 0;
        for (const dir of DIRECTIONS) {
          if (state.collisionSystem.canMoveTo(pos.x, pos.y, dir, bombPositions, otherPlayers)) {
            walkableDirs++;
          }
        }
        const minWalkableDirs = this.stalemateActive ? 1 : player.fireRange >= 5 ? 3 : 2;

        const canEscape =
          this.stalemateActive ||
          (this.config.shieldAggression && player.hasShield) ||
          (walkableDirs >= minWalkableDirs &&
            !this.hasOwnBombNearby(pos, state, player) &&
            (!this.config.escapeCheckBeforeBomb ||
              this.canEscapeAfterBomb(
                pos,
                state,
                player,
                bombPositions,
                otherPlayers,
                explosionCells,
              )));

        if (canEscape) {
          // Dynamic bomb cooldown based on game phase and proximity
          const nearEnemy = nearestEnemyDist !== null && nearestEnemyDist <= 5;
          let cdMin: number, cdMax: number;
          if (lateGame) {
            cdMin =
              this.config.lateGameBombCooldownMin > 0
                ? this.config.lateGameBombCooldownMin
                : Math.floor(this.config.bombCooldownMin / 2);
            cdMax =
              this.config.lateGameBombCooldownMax > 0
                ? this.config.lateGameBombCooldownMax
                : Math.floor(this.config.bombCooldownMax / 2);
          } else if (nearEnemy || midGame) {
            cdMin = Math.floor(this.config.bombCooldownMin * 0.75);
            cdMax = Math.floor(this.config.bombCooldownMax * 0.75);
          } else {
            cdMin = this.config.bombCooldownMin;
            cdMax = this.config.bombCooldownMax;
          }

          if (this.isEnemyInBlastRange(pos, state, player)) {
            // During stalemate, skip bombing invulnerable enemies (post-shield-break)
            let hasVulnerableTarget = true;
            if (this.stalemateActive) {
              hasVulnerableTarget = false;
              for (const { dx, dy } of DIR_DELTA_ARRAY) {
                for (let i = 1; i <= player.fireRange + 1; i++) {
                  const cx = pos.x + dx * i;
                  const cy = pos.y + dy * i;
                  const tile = state.collisionSystem.getTileAt(cx, cy);
                  if (tile === 'wall' || (isDestructibleTile(tile) && !player.hasPierceBomb)) break;
                  for (const other of state.players.values()) {
                    if (
                      other.id !== player.id &&
                      other.alive &&
                      !isTeammate(player, other) &&
                      other.position.x === cx &&
                      other.position.y === cy &&
                      other.invulnerableTicks <= 0
                    ) {
                      hasVulnerableTarget = true;
                    }
                  }
                }
              }
            }
            if (hasVulnerableTarget) {
              this.bombCooldown = cdMin + Math.floor(Math.random() * (cdMax - cdMin));
              logDecision('bomb_offensive', { cooldown: this.bombCooldown });
              return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
            }
          }

          if (this.isNearDestructible(pos, state)) {
            this.bombCooldown = cdMin + Math.floor(Math.random() * (cdMax - cdMin));
            logDecision('bomb_wall', { cooldown: this.bombCooldown });
            return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
          }
        }
      } // end remote bomb self-block guard else
    }

    // === MOVEMENT DECISIONS: only when player can actually move ===
    if (!player.canMove()) return null;

    // Priority 3.5: Offensive kick — push bombs toward enemies
    if (
      !amInDanger &&
      player.hasKick &&
      this.config.useKick &&
      player.canMove() &&
      this.kickCooldown <= 0
    ) {
      const offKick = this.findOffensiveKick(pos, state, player);
      if (offKick) {
        this.kickCooldown = 2;
        logDecision('kick_offensive', { dir: offKick });
        return { seq: this.seq, direction: offKick, action: null, tick: state.tick };
      }
    }

    // Priority 4: Move toward a power-up (BFS pathfinding)
    const powerUpDir = this.findPowerUpDirection(
      pos,
      state,
      danger,
      bombPositions,
      otherPlayers,
      player,
    );
    if (powerUpDir) {
      this.lastDirection = powerUpDir;
      logDecision('seek_powerup', { dir: powerUpDir });
      return { seq: this.seq, direction: powerUpDir, action: null, tick: state.tick };
    }

    // Priority 4.5: Move toward hill zone in KOTH mode
    if (state.hillZone) {
      const hillDir = this.findHillZoneDirection(
        pos,
        state,
        danger,
        bombPositions,
        otherPlayers,
        explosionCells,
      );
      if (hillDir) {
        this.lastDirection = hillDir;
        logDecision('seek_hill', { dir: hillDir });
        return { seq: this.seq, direction: hillDir, action: null, tick: state.tick };
      }
    }

    // Priority 5: Move toward nearest enemy (BFS pathfinding)
    // Hunt persistence: once hunting, keep hunting for 15 ticks before re-rolling
    if (this.huntLockTicks > 0) this.huntLockTicks--;
    const effectiveHuntChance = midGame
      ? Math.min(this.config.huntChance + 0.1, 1)
      : this.config.huntChance;
    const shouldHunt = this.huntLockTicks > 0 || lateGame || Math.random() < effectiveHuntChance;

    if (shouldHunt) {
      // Hunt oscillation detection (Fix C): detect stuck hunting patterns
      if (this.config.huntStuckMaxTicks > 0 && !this.huntStuck) {
        // Reset on kill progress
        if (player.kills > this.lastHuntKills) {
          this.huntWithoutProgressTicks = 0;
          this.huntPosHistory = [];
          this.lastHuntKills = player.kills;
        }
        // Detect oscillation by checking unique positions in hunt history
        if (this.huntPosHistory.length >= 8) {
          const uniquePositions = new Set(this.huntPosHistory).size;
          if (uniquePositions <= this.config.huntStuckThreshold) {
            this.huntStuck = true;
            this.huntStuckCooldown = 30;
            this.huntLockTicks = 0;
            logDecision('hunt_stuck', { uniquePositions, ticks: this.huntWithoutProgressTicks });
          }
        }
        // Detect prolonged hunting without kills
        if (!this.huntStuck && this.huntWithoutProgressTicks >= this.config.huntStuckMaxTicks) {
          this.huntStuck = true;
          this.huntStuckCooldown = 30;
          this.huntLockTicks = 0;
          logDecision('hunt_stuck_timeout', { ticks: this.huntWithoutProgressTicks });
        }
      }

      if (this.huntStuck) {
        // When hunt-stuck, force wall-bombing / seek_wall toward enemy
        if (
          this.bombCooldown <= 0 &&
          player.canPlaceBomb() &&
          player.canMove() &&
          this.isNearDestructible(pos, state)
        ) {
          const wallDir = this.findWallTowardEnemy(pos, state, player, bombPositions, otherPlayers);
          if (wallDir) {
            const canEscapeWall =
              !this.config.escapeCheckBeforeBomb ||
              this.canEscapeAfterBomb(
                pos,
                state,
                player,
                bombPositions,
                otherPlayers,
                explosionCells,
              );
            if (canEscapeWall) {
              this.bombCooldown = this.config.bombCooldownMin;
              logDecision('bomb_wall_hunt_stuck', { dir: wallDir });
              return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
            }
          }
        }
        // Try seek_wall toward enemy
        const stuckWallDir = this.findDestructibleWallDirection(
          pos,
          state,
          player,
          danger,
          bombPositions,
          otherPlayers,
        );
        if (stuckWallDir) {
          this.lastDirection = stuckWallDir;
          logDecision('seek_wall_hunt_stuck', { dir: stuckWallDir });
          return { seq: this.seq, direction: stuckWallDir, action: null, tick: state.tick };
        }
        // No destructible walls between bots — fall through to roam/wander
        logDecision('hunt_stuck_no_walls');
      } else {
        // Normal hunt logic
        // When close to an enemy, try bombing BEFORE moving
        const huntBombDist = this.stalemateActive ? 5 : 3;
        if (nearestEnemyDist !== null && nearestEnemyDist <= huntBombDist) {
          if (
            this.bombCooldown <= 0 &&
            player.canPlaceBomb() &&
            (this.stalemateActive || !this.hasOwnBombNearby(pos, state, player)) &&
            this.isEnemyInBlastRange(pos, state, player)
          ) {
            const canEscapeBomb =
              this.stalemateActive ||
              !this.config.escapeCheckBeforeBomb ||
              this.canEscapeAfterBomb(
                pos,
                state,
                player,
                bombPositions,
                otherPlayers,
                explosionCells,
              );
            if (canEscapeBomb) {
              this.bombCooldown =
                this.config.bombCooldownMin +
                Math.floor(
                  Math.random() * (this.config.bombCooldownMax - this.config.bombCooldownMin),
                );
              logDecision('bomb_hunt', {
                cooldown: this.bombCooldown,
                enemyDist: nearestEnemyDist,
              });
              return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
            }
          }
        }

        const huntDir = this.findHuntDirection(
          pos,
          state,
          player,
          danger,
          bombPositions,
          otherPlayers,
          lateGame || this.huntLockTicks > 0,
          explosionCells,
        );
        if (huntDir) {
          // Track hunt position for oscillation detection (Fix C)
          this.huntPosHistory.push(posKey);
          if (this.huntPosHistory.length > 10) this.huntPosHistory.shift();
          this.huntWithoutProgressTicks++;

          this.lastDirection = huntDir;
          this.wasHunting = true;
          // Lock into hunt mode for 15 ticks so we don't lose target
          this.huntLockTicks = 15;
          logger?.logBotPathfinding(
            player.id,
            player.username,
            'hunt_bfs',
            this.config.huntSearchDepth,
            null,
          );
          logDecision('hunt', { dir: huntDir, locked: this.huntLockTicks, lateGame });
          return { seq: this.seq, direction: huntDir, action: null, tick: state.tick };
        }
        // Hunt BFS found no path — try continuing in last direction briefly
        this.huntLockTicks = 0;
        if (this.wasHunting && !lateGame) {
          const continuePos = state.collisionSystem.canMoveTo(
            pos.x,
            pos.y,
            this.lastDirection,
            bombPositions,
            otherPlayers,
          );
          if (continuePos && !danger.has(`${continuePos.x},${continuePos.y}`)) {
            logDecision('hunt_persist', { dir: this.lastDirection });
            this.wasHunting = false;
            return {
              seq: this.seq,
              direction: this.lastDirection,
              action: null,
              tick: state.tick,
            };
          }
        }
        this.wasHunting = false;
        if (
          lateGame &&
          nearestEnemyDist !== null &&
          this.bombCooldown <= 0 &&
          player.canPlaceBomb() &&
          player.canMove() &&
          !this.hasOwnBombNearby(pos, state, player)
        ) {
          const bombPathDir = this.findWallTowardEnemy(
            pos,
            state,
            player,
            bombPositions,
            otherPlayers,
          );
          if (bombPathDir) {
            const canEscapePath =
              !this.config.escapeCheckBeforeBomb ||
              this.canEscapeAfterBomb(
                pos,
                state,
                player,
                bombPositions,
                otherPlayers,
                explosionCells,
              );
            if (canEscapePath) {
              this.bombCooldown = this.config.bombCooldownMin;
              logDecision('bomb_path', { dir: bombPathDir });
              return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
            }
          }
        }
      }
    }

    // Priority 5.5: Roam toward enemies when idle too long (or late game with no hunt path)
    const effectiveIdleTicks = midGame
      ? Math.floor(this.config.roamAfterIdleTicks / 2)
      : this.config.roamAfterIdleTicks;
    if (lateGame || (effectiveIdleTicks > 0 && this.ticksSinceEnemyContact >= effectiveIdleTicks)) {
      // While roaming, bomb walls that block the path toward enemy
      // Skip if oscillating (bouncing between ≤2 tiles) — bombing our own path is suicidal
      const isOscillating = this.posHistory.length >= 4 && new Set(this.posHistory).size <= 2;
      if (
        !isOscillating &&
        this.bombCooldown <= 0 &&
        player.canPlaceBomb() &&
        player.canMove() &&
        !this.hasOwnBombNearby(pos, state, player) &&
        this.isNearDestructible(pos, state)
      ) {
        const wallToward = this.findWallTowardEnemy(
          pos,
          state,
          player,
          bombPositions,
          otherPlayers,
        );
        if (wallToward) {
          const canEscapeRoam =
            !this.config.escapeCheckBeforeBomb ||
            this.canEscapeAfterBomb(
              pos,
              state,
              player,
              bombPositions,
              otherPlayers,
              explosionCells,
            );
          if (canEscapeRoam) {
            this.bombCooldown = this.config.bombCooldownMin;
            logDecision('bomb_roam', { dir: wallToward });
            return { seq: this.seq, direction: null, action: 'bomb', tick: state.tick };
          }
        }
      }

      const roamDir = this.findRoamDirection(
        pos,
        state,
        player,
        danger,
        bombPositions,
        otherPlayers,
        explosionCells,
      );
      if (roamDir) {
        this.lastDirection = roamDir;
        logDecision('roam', { dir: roamDir, idleTicks: this.ticksSinceEnemyContact, lateGame });
        return { seq: this.seq, direction: roamDir, action: null, tick: state.tick };
      }
    }

    // Priority 6: Move toward nearest destructible wall
    // Skip if already adjacent to a destructible wall — stay put and wait for bomb cooldown
    // (moving away causes seek_wall <-> wander oscillation)
    this.wasHunting = false;
    if (!this.isNearDestructible(pos, state)) {
      const wallDir = this.findDestructibleWallDirection(
        pos,
        state,
        player,
        danger,
        bombPositions,
        otherPlayers,
      );
      if (wallDir) {
        this.lastDirection = wallDir;
        logDecision('seek_wall', { dir: wallDir });
        return { seq: this.seq, direction: wallDir, action: null, tick: state.tick };
      }
    }

    // Priority 7: Wander
    const wanderDir = this.pickSafeWander(
      pos,
      state,
      danger,
      bombPositions,
      otherPlayers,
      explosionCells,
    );
    if (wanderDir) {
      this.lastDirection = wanderDir;
      logDecision('wander', { dir: wanderDir });
      return { seq: this.seq, direction: wanderDir, action: null, tick: state.tick };
    }

    return null;
  }

  private getNearestEnemyManhattan(
    pos: Position,
    state: GameStateManager,
    player: Player,
  ): number | null {
    let minDist: number | null = null;
    for (const other of state.players.values()) {
      if (other.id !== player.id && other.alive && !isTeammate(player, other)) {
        const dist = Math.abs(other.position.x - pos.x) + Math.abs(other.position.y - pos.y);
        if (minDist === null || dist < minDist) minDist = dist;
      }
    }
    return minDist;
  }

  /**
   * Get cells with active, damaging explosions. These kill on contact
   * and must be treated as impassable in escape/movement BFS.
   */
  private getActiveExplosionCells(state: GameStateManager): Set<string> {
    const cells = new Set<string>();
    for (const exp of state.explosions.values()) {
      // Match the damage check in GameState: ticksRemaining > 3 means still lethal
      if (exp.ticksRemaining > 3) {
        for (const cell of exp.cells) {
          cells.add(`${cell.x},${cell.y}`);
        }
      }
    }
    return cells;
  }

  private getDangerCells(
    state: GameStateManager,
    awarenessRange: number,
    botPos: Position,
    ignoreDangerThreshold: boolean = false,
  ): Set<string> {
    const danger = new Set<string>();

    for (const exp of state.explosions.values()) {
      for (const cell of exp.cells) {
        danger.add(`${cell.x},${cell.y}`);
      }
    }

    for (const bomb of state.bombs.values()) {
      // Track max fire range while iterating bombs (avoids a separate pass)
      if (bomb.fireRange > this.maxFireRangeOnMap) {
        this.maxFireRangeOnMap = bomb.fireRange;
      }
      const manhattanDist =
        Math.abs(bomb.position.x - botPos.x) + Math.abs(bomb.position.y - botPos.y);
      if (manhattanDist > awarenessRange) continue;

      if (
        !ignoreDangerThreshold &&
        this.config.dangerTimerThreshold > 0 &&
        bomb.ticksRemaining > this.config.dangerTimerThreshold
      ) {
        // Dynamic safe distance: how far can bot move before detonation?
        const movesAvailable = Math.floor(bomb.ticksRemaining / MOVE_COOLDOWN_BASE);
        const safeDistance = Math.min(movesAvailable, bomb.fireRange + 2);
        if (manhattanDist > safeDistance) continue;
      }

      // Collect blast cells for this bomb
      const blastCells: string[] = [`${bomb.position.x},${bomb.position.y}`];
      for (const { dx, dy } of DIR_DELTA_ARRAY) {
        for (let i = 1; i <= bomb.fireRange; i++) {
          const cx = bomb.position.x + dx * i;
          const cy = bomb.position.y + dy * i;
          const tile = state.collisionSystem.getTileAt(cx, cy);
          if (tile === 'wall') break;
          blastCells.push(`${cx},${cy}`);
          if (isDestructibleTile(tile) && !bomb.isPierce) break;
        }
      }

      // Reachability filter: skip bombs whose blast can't reach us before detonation
      if (!ignoreDangerThreshold && this.config.enableReachabilityFilter) {
        const movesBeforeDetonation = Math.floor(bomb.ticksRemaining / MOVE_COOLDOWN_BASE);
        let minDist = Infinity;
        for (const cellKey of blastCells) {
          const [cx, cy] = cellKey.split(',');
          const dist = Math.abs(Number(cx) - botPos.x) + Math.abs(Number(cy) - botPos.y);
          if (dist < minDist) minDist = dist;
        }
        if (minDist > movesBeforeDetonation + 1) continue;
      }

      for (const cellKey of blastCells) {
        danger.add(cellKey);
      }
    }

    // Chain reaction awareness (hard difficulty): bombs in danger zones will chain-detonate
    if (this.config.chainReactionAwareness) {
      for (const bomb of state.bombs.values()) {
        const bombKey = `${bomb.position.x},${bomb.position.y}`;
        if (!danger.has(bombKey)) continue;
        // Add blast cells for chain-reacting bombs
        for (const { dx, dy } of DIR_DELTA_ARRAY) {
          for (let i = 1; i <= bomb.fireRange; i++) {
            const cx = bomb.position.x + dx * i;
            const cy = bomb.position.y + dy * i;
            const tile = state.collisionSystem.getTileAt(cx, cy);
            if (tile === 'wall') break;
            danger.add(`${cx},${cy}`);
            if (isDestructibleTile(tile) && !bomb.isPierce) break;
          }
        }
      }
    }

    return danger;
  }

  private findEscapeDirection(
    pos: Position,
    state: GameStateManager,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
    explosionCells?: Set<string>,
  ): { dir: Direction; depth: number } | null {
    // Active explosion cells kill on contact — never path through them
    const lethal = explosionCells ?? this.getActiveExplosionCells(state);
    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier: { pos: Position; firstDir: Direction }[] = [];

    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        bombPositions,
        otherPlayers,
      );
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (lethal.has(key)) continue; // Never enter active explosions
      if (!danger.has(key)) return { dir, depth: 1 };
      frontier.push({ pos: newPos, firstDir: dir });
    }

    // Scale escape depth with fire range — high range needs deeper search
    const escapeDepth = Math.max(
      this.config.escapeSearchDepth,
      Math.ceil(this.maxFireRangeOnMap * 1.5) + 2,
    );

    for (let depth = 0; depth < escapeDepth && frontier.length > 0; depth++) {
      const next: { pos: Position; firstDir: Direction }[] = [];
      for (const entry of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(
            entry.pos.x,
            entry.pos.y,
            dir,
            bombPositions,
            otherPlayers,
          );
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key)) continue;
          visited.add(key);
          if (lethal.has(key)) continue; // Never enter active explosions
          if (!danger.has(key)) return { dir: entry.firstDir, depth: depth + 2 };
          next.push({ pos: newPos, firstDir: entry.firstDir });
        }
      }
      frontier = next;
    }

    return null;
  }

  private countEscapeRoutes(
    pos: Position,
    state: GameStateManager,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
    cachedExplosionCells?: Set<string>,
  ): number {
    const explosionCells = cachedExplosionCells ?? this.getActiveExplosionCells(state);
    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier = [pos];
    let safeCount = 0;

    for (let depth = 0; depth < this.config.escapeSearchDepth && frontier.length > 0; depth++) {
      const next: Position[] = [];
      for (const p of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(
            p.x,
            p.y,
            dir,
            bombPositions,
            otherPlayers,
          );
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key) || explosionCells.has(key)) continue;
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

  private isEnemyInBlastRange(pos: Position, state: GameStateManager, player: Player): boolean {
    for (const { dx, dy } of DIR_DELTA_ARRAY) {
      for (let i = 1; i <= player.fireRange + 1; i++) {
        const cx = pos.x + dx * i;
        const cy = pos.y + dy * i;
        const tile = state.collisionSystem.getTileAt(cx, cy);
        if (tile === 'wall' || (isDestructibleTile(tile) && !player.hasPierceBomb)) break;
        for (const other of state.players.values()) {
          if (
            other.id !== player.id &&
            other.alive &&
            !isTeammate(player, other) &&
            other.position.x === cx &&
            other.position.y === cy
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Before placing a bomb, verify the bot can escape its own blast.
   * Two checks:
   * 1. At least one immediate neighbor is walkable (can move away on next tick)
   * 2. BFS through future danger finds a safe cell reachable from current position
   */
  private canEscapeAfterBomb(
    pos: Position,
    state: GameStateManager,
    player: Player,
    bombPositions: Position[],
    otherPlayers: Position[],
    cachedExplosionCells?: Set<string>,
  ): boolean {
    // Build future bomb positions — line bombs place multiple bombs in facing direction
    const futureBombPositions = [...bombPositions];
    if (player.hasLineBomb) {
      const dir = player.direction || 'down';
      const ddx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
      const ddy = dir === 'down' ? 1 : dir === 'up' ? -1 : 0;
      const availableBombs = player.maxBombs - player.bombCount;
      let placed = 0;
      for (let i = 0; i < availableBombs; i++) {
        const nx = pos.x + ddx * i;
        const ny = pos.y + ddy * i;
        const tile = state.collisionSystem.getTileAt(nx, ny);
        if (!tile || tile === 'wall' || isDestructibleTile(tile)) break;
        let hasBomb = false;
        for (const b of state.bombs.values()) {
          if (b.position.x === nx && b.position.y === ny) {
            hasBomb = true;
            break;
          }
        }
        if (hasBomb || futureBombPositions.some((p) => p.x === nx && p.y === ny)) break;
        futureBombPositions.push({ x: nx, y: ny });
        placed++;
      }
      if (placed === 0) {
        futureBombPositions.push(pos);
      }
    } else {
      futureBombPositions.push(pos);
    }

    // ignoreDangerThreshold=true: escape check must see ALL bombs, not just nearby/imminent ones
    const futureDanger = new Set(this.getDangerCells(state, 999, pos, true));

    // Add danger cells for ALL future bomb positions (not just the player's position)
    for (const bombPos of futureBombPositions) {
      if (bombPositions.some((p) => p.x === bombPos.x && p.y === bombPos.y)) continue;
      futureDanger.add(`${bombPos.x},${bombPos.y}`);
      for (const { dx, dy } of DIR_DELTA_ARRAY) {
        for (let i = 1; i <= player.fireRange; i++) {
          const cx = bombPos.x + dx * i;
          const cy = bombPos.y + dy * i;
          const tile = state.collisionSystem.getTileAt(cx, cy);
          if (tile === 'wall') break;
          futureDanger.add(`${cx},${cy}`);
          if (isDestructibleTile(tile) && !player.hasPierceBomb) break;
        }
      }
    }

    // Chain reaction danger: bombs caught in our blast will chain-detonate
    for (const bomb of state.bombs.values()) {
      const bombKey = `${bomb.position.x},${bomb.position.y}`;
      if (!futureDanger.has(bombKey)) continue;
      for (const { dx, dy } of DIR_DELTA_ARRAY) {
        for (let i = 1; i <= bomb.fireRange; i++) {
          const cx = bomb.position.x + dx * i;
          const cy = bomb.position.y + dy * i;
          const tile = state.collisionSystem.getTileAt(cx, cy);
          if (tile === 'wall') break;
          futureDanger.add(`${cx},${cy}`);
          if (isDestructibleTile(tile) && !bomb.isPierce) break;
        }
      }
    }

    // Active explosions are lethal on contact — can't step into them
    const explosionCells = cachedExplosionCells ?? this.getActiveExplosionCells(state);

    // Must have at least one immediate neighbor that is walkable AND not an active explosion
    let canStepAway = false;
    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        futureBombPositions,
        otherPlayers,
      );
      if (newPos && !explosionCells.has(`${newPos.x},${newPos.y}`)) {
        canStepAway = true;
        break;
      }
    }
    if (!canStepAway) return false;

    const escapeResult = this.findEscapeDirection(
      pos,
      state,
      futureDanger,
      futureBombPositions,
      otherPlayers,
      explosionCells,
    );
    if (!escapeResult) return false;

    // Time-to-safety check: can we reach the safe cell before the bomb goes off?
    if (player.fireRange >= 4) {
      const moveCooldown = Math.max(1, MOVE_COOLDOWN_BASE - (player.speed - 1));
      const ticksToReach = escapeResult.depth * moveCooldown;
      const bombTimer = BOMB_TIMER_TICKS;
      if (ticksToReach >= bombTimer - 10) return false;
    }
    return true;
  }

  /**
   * Check if we have an active bomb nearby that could create a sandwich trap.
   */
  private hasOwnBombNearby(pos: Position, state: GameStateManager, player: Player): boolean {
    const safeDistance = player.fireRange + 1;
    for (const bomb of state.bombs.values()) {
      if (bomb.ownerId === player.id) {
        const dist = Math.abs(bomb.position.x - pos.x) + Math.abs(bomb.position.y - pos.y);
        if (dist <= safeDistance) return true;
      }
    }
    return false;
  }

  /**
   * Check if placing a remote bomb at pos would block ALL walkable neighbor directions
   * with its blast zone, effectively trapping the bot (Change 5A).
   */
  private wouldRemoteBombSelfBlock(
    pos: Position,
    state: GameStateManager,
    player: Player,
    bombPositions: Position[],
    otherPlayers: Position[],
  ): boolean {
    // Compute hypothetical blast cells for a bomb at pos
    const blastCells = new Set<string>();
    blastCells.add(`${pos.x},${pos.y}`);
    for (const { dx, dy } of DIR_DELTA_ARRAY) {
      for (let i = 1; i <= player.fireRange; i++) {
        const cx = pos.x + dx * i;
        const cy = pos.y + dy * i;
        const tile = state.collisionSystem.getTileAt(cx, cy);
        if (tile === 'wall') break;
        blastCells.add(`${cx},${cy}`);
        if (isDestructibleTile(tile) && !player.hasPierceBomb) break;
      }
    }

    // Check each walkable neighbor — if ALL are in the blast zone, placement would trap us
    let safeDirections = 0;
    const futureBombs = [...bombPositions, pos];
    for (const dir of DIRECTIONS) {
      const dest = state.collisionSystem.canMoveTo(pos.x, pos.y, dir, futureBombs, otherPlayers);
      if (!dest) continue;
      if (!blastCells.has(`${dest.x},${dest.y}`)) {
        safeDirections++;
      }
    }
    return safeDirections === 0;
  }

  private isNearDestructible(pos: Position, state: GameStateManager): boolean {
    for (const { dx, dy } of DIR_DELTA_ARRAY) {
      if (isDestructibleTile(state.collisionSystem.getTileAt(pos.x + dx, pos.y + dy))) return true;
    }
    return false;
  }

  /**
   * BFS pathfinding toward the nearest power-up.
   * Uses orderedDirs() so lastDirection is explored first, giving stable tie-breaking.
   * Scores power-ups by value to the player — skips worthless ones and prefers high-value at same depth.
   */
  private findPowerUpDirection(
    pos: Position,
    state: GameStateManager,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
    player: Player,
  ): Direction | null {
    if (state.powerUps.size === 0) return null;

    // Build position → score map; skip power-ups with score 0 (already maxed)
    const powerUpScores = new Map<string, number>();
    for (const pu of state.powerUps.values()) {
      const score = scorePowerUp(pu.type, player);
      if (score > 0) {
        powerUpScores.set(`${pu.position.x},${pu.position.y}`, score);
      }
    }
    if (powerUpScores.size === 0) return null;

    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier: { pos: Position; firstDir: Direction }[] = [];

    // Check immediate neighbors — return best at depth 0
    let bestDir: Direction | null = null;
    let bestScore = 0;
    for (const dir of this.orderedDirs()) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        bombPositions,
        otherPlayers,
      );
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue;
      visited.add(key);
      const score = powerUpScores.get(key);
      if (score !== undefined && score > bestScore) {
        bestScore = score;
        bestDir = dir;
      }
      if (!this.wouldOscillate(newPos)) {
        frontier.push({ pos: newPos, firstDir: dir });
      }
    }
    if (bestDir) return bestDir;

    for (let depth = 0; depth < this.config.powerUpVision && frontier.length > 0; depth++) {
      const next: { pos: Position; firstDir: Direction }[] = [];
      let depthBestDir: Direction | null = null;
      let depthBestScore = 0;
      for (const entry of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(
            entry.pos.x,
            entry.pos.y,
            dir,
            bombPositions,
            [],
          );
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key) || danger.has(key)) continue;
          visited.add(key);
          const score = powerUpScores.get(key);
          if (score !== undefined && score > depthBestScore) {
            depthBestScore = score;
            depthBestDir = entry.firstDir;
          }
          next.push({ pos: newPos, firstDir: entry.firstDir });
        }
      }
      if (depthBestDir) return depthBestDir;
      frontier = next;
    }

    return null;
  }

  private findHillZoneDirection(
    pos: Position,
    state: GameStateManager,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
    explosionCells?: Set<string>,
  ): Direction | null {
    const hill = state.hillZone;
    if (!hill) return null;

    if (
      pos.x >= hill.x &&
      pos.x < hill.x + hill.width &&
      pos.y >= hill.y &&
      pos.y < hill.y + hill.height
    ) {
      return null;
    }

    const targetX = hill.x + Math.floor(hill.width / 2);
    const targetY = hill.y + Math.floor(hill.height / 2);
    const currentDist = Math.abs(pos.x - targetX) + Math.abs(pos.y - targetY);

    const candidates: { dir: Direction; distReduction: number; escape: number }[] = [];
    for (const dir of this.orderedDirs()) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        bombPositions,
        otherPlayers,
      );
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue;
      const escapeCount = this.countEscapeRoutes(
        newPos,
        state,
        danger,
        bombPositions,
        otherPlayers,
        explosionCells,
      );
      if (escapeCount < 1) continue;
      const newDist = Math.abs(newPos.x - targetX) + Math.abs(newPos.y - targetY);
      candidates.push({ dir, distReduction: currentDist - newDist, escape: escapeCount });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.distReduction - a.distReduction || b.escape - a.escape);
    if (candidates[0].distReduction <= 0) return null;
    return candidates[0].dir;
  }

  /**
   * BFS toward nearest enemy. orderedDirs() gives lastDirection priority at seed step.
   * When aggressive=true (late-game), skip oscillation filter and escape route check
   * on seed step to ensure bots keep pursuing even in narrow corridors.
   */
  private findHuntDirection(
    pos: Position,
    state: GameStateManager,
    player: Player,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
    aggressive: boolean = false,
    _explosionCells?: Set<string>,
  ): Direction | null {
    const enemyPositions = new Set<string>();
    for (const other of state.players.values()) {
      if (other.id !== player.id && other.alive && !isTeammate(player, other)) {
        enemyPositions.add(`${other.position.x},${other.position.y}`);
      }
    }
    if (enemyPositions.size === 0) return null;

    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier: { pos: Position; firstDir: Direction }[] = [];

    for (const dir of this.orderedDirs()) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        bombPositions,
        otherPlayers,
      );
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue;
      // In aggressive mode, skip escape route check (accept risk to reach enemy)
      if (!aggressive) {
        const escapeCount = this.countEscapeRoutes(
          newPos,
          state,
          danger,
          bombPositions,
          otherPlayers,
        );
        if (escapeCount < 1) continue;
      }
      visited.add(key);
      if (enemyPositions.has(key)) return dir;
      // In aggressive mode, skip oscillation filter (but not when hunt-stuck)
      if ((aggressive && !this.huntStuck) || !this.wouldOscillate(newPos)) {
        frontier.push({ pos: newPos, firstDir: dir });
      }
    }

    for (let depth = 0; depth < this.config.huntSearchDepth && frontier.length > 0; depth++) {
      const next: { pos: Position; firstDir: Direction }[] = [];
      for (const entry of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(
            entry.pos.x,
            entry.pos.y,
            dir,
            bombPositions,
            [],
          );
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
   * Roam toward nearest enemy using manhattan heuristic.
   * Tie-break with lastDirection for stability.
   */
  private findRoamDirection(
    pos: Position,
    state: GameStateManager,
    player: Player,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
    explosionCells?: Set<string>,
  ): Direction | null {
    let nearestEnemy: Position | null = null;
    let nearestDist = Infinity;
    for (const other of state.players.values()) {
      if (other.id !== player.id && other.alive && !isTeammate(player, other)) {
        const dist = Math.abs(other.position.x - pos.x) + Math.abs(other.position.y - pos.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = other.position;
        }
      }
    }
    if (!nearestEnemy) return null;

    const candidates: { dir: Direction; distReduction: number; escape: number; osc: boolean }[] =
      [];
    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        bombPositions,
        otherPlayers,
      );
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue;
      const escapeCount = this.countEscapeRoutes(
        newPos,
        state,
        danger,
        bombPositions,
        otherPlayers,
        explosionCells,
      );
      if (escapeCount < 1) continue;
      const newDist = Math.abs(newPos.x - nearestEnemy.x) + Math.abs(newPos.y - nearestEnemy.y);
      candidates.push({
        dir,
        distReduction: nearestDist - newDist,
        escape: escapeCount,
        osc: this.wouldOscillate(newPos),
      });
    }

    if (candidates.length === 0) return null;

    const ld = this.lastDirection;
    candidates.sort((a, b) => {
      // Prefer non-oscillating directions
      if (a.osc !== b.osc) return a.osc ? 1 : -1;
      if (a.distReduction !== b.distReduction) return b.distReduction - a.distReduction;
      if (a.escape !== b.escape) return b.escape - a.escape;
      return (a.dir === ld ? 0 : 1) - (b.dir === ld ? 0 : 1);
    });

    return candidates[0].dir;
  }

  /**
   * Check if there's a destructible wall adjacent to us in the direction of the nearest enemy.
   * Used in late-game when hunt BFS fails (walls blocking path) to actively create a path.
   */
  private findWallTowardEnemy(
    pos: Position,
    state: GameStateManager,
    player: Player,
    _bombPositions: Position[],
    _otherPlayers: Position[],
  ): Direction | null {
    let nearestEnemy: Position | null = null;
    let nearestDist = Infinity;
    for (const other of state.players.values()) {
      if (other.id !== player.id && other.alive && !isTeammate(player, other)) {
        const dist = Math.abs(other.position.x - pos.x) + Math.abs(other.position.y - pos.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = other.position;
        }
      }
    }
    if (!nearestEnemy) return null;

    // Check adjacent tiles for destructible walls that are roughly toward the enemy
    let bestDir: Direction | null = null;
    let bestScore = Infinity;
    for (const dir of DIRECTIONS) {
      const { dx, dy } = DIR_DELTA[dir];
      const wallX = pos.x + dx;
      const wallY = pos.y + dy;
      if (!isDestructibleTile(state.collisionSystem.getTileAt(wallX, wallY))) continue;
      // Score: manhattan distance from the wall to the enemy (lower = more toward enemy)
      const distAfter = Math.abs(wallX - nearestEnemy.x) + Math.abs(wallY - nearestEnemy.y);
      if (distAfter < bestScore) {
        bestScore = distAfter;
        bestDir = dir;
      }
    }

    // Only bomb if this wall is actually closer to enemy than we are
    if (bestDir && bestScore < nearestDist) {
      return bestDir;
    }
    return null;
  }

  /**
   * BFS to find direction of nearest reachable destructible wall.
   * Prefers walls toward enemies. Tie-break with lastDirection.
   */
  private findDestructibleWallDirection(
    pos: Position,
    state: GameStateManager,
    player: Player,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
  ): Direction | null {
    let nearestEnemy: Position | null = null;
    let nearestDist = Infinity;
    for (const other of state.players.values()) {
      if (other.id !== player.id && other.alive) {
        const dist = Math.abs(other.position.x - pos.x) + Math.abs(other.position.y - pos.y);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestEnemy = other.position;
        }
      }
    }

    const visited = new Set<string>();
    visited.add(`${pos.x},${pos.y}`);
    let frontier: { pos: Position; firstDir: Direction }[] = [];
    const wallCandidates: { dir: Direction; depth: number; distToEnemy: number }[] = [];

    for (const dir of this.orderedDirs()) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        bombPositions,
        otherPlayers,
      );
      if (!newPos) continue;
      const key = `${newPos.x},${newPos.y}`;
      if (danger.has(key)) continue;
      visited.add(key);

      // Skip dead-end destinations — bot won't be able to bomb there (walkableDirs < 2)
      let destWalkable = 0;
      for (const d of DIRECTIONS) {
        if (state.collisionSystem.canMoveTo(newPos.x, newPos.y, d, bombPositions, otherPlayers)) {
          destWalkable++;
        }
      }
      if (destWalkable < 2) {
        // Still add to frontier for deeper BFS but don't suggest moving here
        if (!this.wouldOscillate(newPos)) {
          frontier.push({ pos: newPos, firstDir: dir });
        }
        continue;
      }

      for (const { dx, dy } of DIR_DELTA_ARRAY) {
        if (isDestructibleTile(state.collisionSystem.getTileAt(newPos.x + dx, newPos.y + dy))) {
          const distToEnemy = nearestEnemy
            ? Math.abs(newPos.x + dx - nearestEnemy.x) + Math.abs(newPos.y + dy - nearestEnemy.y)
            : 0;
          wallCandidates.push({ dir, depth: 0, distToEnemy });
          break;
        }
      }
      if (!this.wouldOscillate(newPos)) {
        frontier.push({ pos: newPos, firstDir: dir });
      }
    }

    for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
      const next: { pos: Position; firstDir: Direction }[] = [];
      for (const entry of frontier) {
        for (const dir of DIRECTIONS) {
          const newPos = state.collisionSystem.canMoveTo(
            entry.pos.x,
            entry.pos.y,
            dir,
            bombPositions,
            otherPlayers,
          );
          if (!newPos) continue;
          const key = `${newPos.x},${newPos.y}`;
          if (visited.has(key) || danger.has(key)) continue;
          visited.add(key);
          for (const { dx, dy } of DIR_DELTA_ARRAY) {
            if (isDestructibleTile(state.collisionSystem.getTileAt(newPos.x + dx, newPos.y + dy))) {
              const distToEnemy = nearestEnemy
                ? Math.abs(newPos.x + dx - nearestEnemy.x) +
                  Math.abs(newPos.y + dy - nearestEnemy.y)
                : 0;
              wallCandidates.push({ dir: entry.firstDir, depth: depth + 1, distToEnemy });
              break;
            }
          }
          next.push({ pos: newPos, firstDir: entry.firstDir });
        }
      }
      frontier = next;
    }

    if (wallCandidates.length === 0) return null;

    const ld = this.lastDirection;
    wallCandidates.sort((a, b) => {
      const tierA = a.depth <= 1 ? 0 : a.depth <= 4 ? 1 : 2;
      const tierB = b.depth <= 1 ? 0 : b.depth <= 4 ? 1 : 2;
      if (tierA !== tierB) return tierA - tierB;
      if (a.distToEnemy !== b.distToEnemy) return a.distToEnemy - b.distToEnemy;
      return (a.dir === ld ? 0 : 1) - (b.dir === ld ? 0 : 1);
    });

    return wallCandidates[0].dir;
  }

  /**
   * Wander in a safe, non-trapping direction.
   * 85% chance to continue lastDirection for stability.
   */
  private pickSafeWander(
    pos: Position,
    state: GameStateManager,
    danger: Set<string>,
    bombPositions: Position[],
    otherPlayers: Position[],
    explosionCells?: Set<string>,
  ): Direction | null {
    const candidates: { dir: Direction; escape: number; osc: boolean }[] = [];

    for (const dir of DIRECTIONS) {
      const newPos = state.collisionSystem.canMoveTo(
        pos.x,
        pos.y,
        dir,
        bombPositions,
        otherPlayers,
      );
      if (!newPos) continue;
      if (danger.has(`${newPos.x},${newPos.y}`)) continue;
      const escapeCount = this.countEscapeRoutes(
        newPos,
        state,
        danger,
        bombPositions,
        otherPlayers,
        explosionCells,
      );
      if (escapeCount >= 1) {
        candidates.push({ dir, escape: escapeCount, osc: this.wouldOscillate(newPos) });
      }
    }

    if (candidates.length === 0) {
      for (const dir of DIRECTIONS) {
        const newPos = state.collisionSystem.canMoveTo(
          pos.x,
          pos.y,
          dir,
          bombPositions,
          otherPlayers,
        );
        if (newPos && !danger.has(`${newPos.x},${newPos.y}`)) return dir;
      }
      return null;
    }

    // Prefer non-oscillating directions, then lastDirection, then random
    const nonOsc = candidates.filter((c) => !c.osc);
    const pool = nonOsc.length > 0 ? nonOsc : candidates;

    const currentDirCandidate = pool.find((c) => c.dir === this.lastDirection);
    if (currentDirCandidate && Math.random() < 0.85) {
      return currentDirCandidate.dir;
    }

    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled[0].dir;
  }

  private findKickableBomb(
    pos: Position,
    state: GameStateManager,
    player: Player,
  ): Direction | null {
    for (const dir of DIRECTIONS) {
      const { dx, dy } = DIR_DELTA[dir];
      const adjX = pos.x + dx;
      const adjY = pos.y + dy;

      for (const bomb of state.bombs.values()) {
        // Skip own bombs UNLESS they're about to explode (self-defense)
        if (bomb.ownerId === player.id && bomb.ticksRemaining > 15) continue;
        if (bomb.position.x === adjX && bomb.position.y === adjY && !bomb.sliding) {
          const behindX = adjX + dx;
          const behindY = adjY + dy;
          if (state.collisionSystem.isWalkable(behindX, behindY)) {
            const blocked =
              Array.from(state.bombs.values()).some(
                (b) => b.id !== bomb.id && b.position.x === behindX && b.position.y === behindY,
              ) ||
              Array.from(state.players.values()).some(
                (p) => p.alive && p.position.x === behindX && p.position.y === behindY,
              );
            if (!blocked) {
              return dir;
            }
          }
        }
      }
    }
    return null;
  }

  private findOffensiveKick(
    pos: Position,
    state: GameStateManager,
    player: Player,
  ): Direction | null {
    for (const dir of DIRECTIONS) {
      const { dx, dy } = DIR_DELTA[dir];
      const adjX = pos.x + dx;
      const adjY = pos.y + dy;

      for (const bomb of state.bombs.values()) {
        if (bomb.position.x !== adjX || bomb.position.y !== adjY || bomb.sliding) continue;
        // Check if bomb can slide in this direction
        const behindX = adjX + dx;
        const behindY = adjY + dy;
        if (!state.collisionSystem.isWalkable(behindX, behindY)) continue;
        if (
          Array.from(state.bombs.values()).some(
            (b) => b.id !== bomb.id && b.position.x === behindX && b.position.y === behindY,
          )
        )
          continue;
        if (
          Array.from(state.players.values()).some(
            (p) => p.alive && p.position.x === behindX && p.position.y === behindY,
          )
        )
          continue;

        // Check if any enemy is in the kick direction's line
        for (let i = 2; i <= bomb.fireRange + 3; i++) {
          const cx = pos.x + dx * i;
          const cy = pos.y + dy * i;
          const tile = state.collisionSystem.getTileAt(cx, cy);
          if (tile === 'wall') break;
          if (isDestructibleTile(tile)) break;
          for (const other of state.players.values()) {
            if (
              other.id !== player.id &&
              other.alive &&
              !isTeammate(player, other) &&
              other.position.x === cx &&
              other.position.y === cy
            ) {
              return dir;
            }
          }
        }
      }
    }
    return null;
  }
}
