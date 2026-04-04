import {
  GameState as GameStateType,
  TileType,
  TileDiff,
  PlayerInput,
  Position,
  PowerUpType,
  Direction,
  KillCause,
} from '@blast-arena/shared';
import { getExplosionCells } from '@blast-arena/shared';
import {
  DEFAULT_WALL_DENSITY,
  DEFAULT_POWERUP_DROP_RATE,
  TICK_RATE,
  MOVE_COOLDOWN_BASE,
} from '@blast-arena/shared';
import { QUICKSAND_KILL_TICKS, SPIKE_SAFE_TICKS, SPIKE_CYCLE_TICKS } from '@blast-arena/shared';
import { isSlowingTile } from '@blast-arena/shared';
import {
  DEATHMATCH_RESPAWN_TICKS,
  DEATHMATCH_KILL_TARGET,
  KOTH_ZONE_SIZE,
  KOTH_SCORE_TARGET,
  KOTH_POINTS_PER_TICK,
  KOTH_HILL_MOVE_INTERVAL,
  KOTH_HILL_MOVE_WARNING,
} from '@blast-arena/shared';
import { Player } from './Player';
import { Bomb, BombType } from './Bomb';
import { Explosion } from './Explosion';
import { PowerUp } from './PowerUp';
import { CollisionSystem } from './CollisionSystem';
import { BattleRoyaleZone } from './BattleRoyale';
import { generateMap } from './Map';
import { InputBuffer } from './InputBuffer';
import { IBotAI } from './BotAI';
import { getBotAIRegistry } from '../services/botai-registry';
import { GameLogger } from '../utils/gameLogger';

/** Single-pass Map-to-array transform (avoids intermediate Array.from allocation) */
function mapToArray<K, V, R>(map: Map<K, V>, fn: (v: V) => R): R[] {
  const result: R[] = [];
  for (const v of map.values()) result.push(fn(v));
  return result;
}

// Simple seeded random for power-up drops
class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }
}

export interface GameConfig {
  mapWidth: number;
  mapHeight: number;
  mapSeed?: number;
  gameMode?: string;
  hasZone?: boolean;
  roundTime?: number;
  wallDensity?: number;
  enabledPowerUps?: PowerUpType[];
  powerUpDropRate?: number;
  friendlyFire?: boolean;
  botDifficulty?: 'easy' | 'normal' | 'hard';
  reinforcedWalls?: boolean;
  enableMapEvents?: boolean;
  /** Array of enabled map event types (overrides enableMapEvents boolean when set) */
  enabledMapEvents?: string[];
  /** Array of hazard tile types to place on the map */
  hazardTiles?: string[];
  botAiId?: string;
  /** If provided, use this pre-built map instead of generating one */
  customMap?: ReturnType<typeof generateMap>;
}

export class GameStateManager {
  public tick: number = 0;
  public status: 'countdown' | 'playing' | 'finished' = 'countdown';
  public players: Map<number, Player> = new Map();
  public bombs: Map<string, Bomb> = new Map();
  public explosions: Map<string, Explosion> = new Map();
  public powerUps: Map<string, PowerUp> = new Map();
  public map: ReturnType<typeof generateMap>;
  public collisionSystem: CollisionSystem;
  public inputBuffer: InputBuffer = new InputBuffer();
  public zone: BattleRoyaleZone | null = null;
  public winnerId: number | null = null;
  public winnerTeam: number | null = null;
  public roundTime: number;
  /** Positions where random power-up drops are suppressed (campaign hidden power-ups) */
  public reservedPowerUpTiles: Set<string> = new Set();

  // KOTH properties
  public hillZone: { x: number; y: number; width: number; height: number } | null = null;
  public pendingHillZone: { x: number; y: number; width: number; height: number } | null = null;
  public kothScores: Map<number, number> = new Map();
  private nextHillMoveTick: number = 0;

  private rng: SeededRandom;
  private gameMode: string;
  private placementCounter: number = 0;
  private enabledPowerUps: PowerUpType[];
  private powerUpDropRate: number;
  private friendlyFire: boolean;
  private botDifficulty: 'easy' | 'normal' | 'hard';
  private botAiId: string;
  private botAIs: Map<number, IBotAI> = new Map();
  private finishTick: number | null = null;
  public finishReason: string = '';
  public gameLogger: GameLogger | null = null;
  public campaignEnemyPositions: Set<string> | null = null;
  public reinforcedWalls: boolean;
  public enableMapEvents: boolean;
  private static readonly FINISH_DELAY_TICKS = 30; // 1.5s grace period to show final explosions

  // Cached per-tick data (invalidated at start of each processTick)
  private _alivePlayersCache: Player[] | null = null;
  private _processingTick: boolean = false;
  private _hillControllingPlayerId: number | null = null;

  // Per-tick event buffers for discrete event emission
  public tickEvents: {
    explosions: { cells: { x: number; y: number }[]; ownerId: number }[];
    playerDied: { playerId: number; killerId: number | null; cause: KillCause }[];
    powerupCollected: { playerId: number; type: string; position: { x: number; y: number } }[];
    bombThrown: { bombId: string; from: { x: number; y: number }; to: { x: number; y: number } }[];
  } = { explosions: [], playerDied: [], powerupCollected: [], bombThrown: [] };

  // Shuffled spawn indices for fair spawn assignment
  private shuffledSpawnIndices: number[] = [];

  // Map events (dynamic)
  private mapEvents: {
    type: string;
    position?: Position;
    tick: number;
    warningTick?: number;
    direction?: 'row' | 'column';
    index?: number;
    targetPlayerId?: number;
  }[] = [];
  private _mapEventsCache:
    | {
        type:
          | 'meteor'
          | 'powerup_rain'
          | 'wall_collapse'
          | 'freeze_wave'
          | 'bomb_surge'
          | 'hill_move'
          | 'ufo_abduction';
        position?: Position;
        tick: number;
        warningTick?: number;
        direction?: 'row' | 'column';
        index?: number;
        targetPlayerId?: number;
      }[]
    | undefined;
  private _mapEventsDirty = true;
  private nextMeteorTick: number = 0;
  private nextPowerupRainTick: number = 0;
  private nextWallCollapseTick: number = 0;
  private nextFreezeWaveTick: number = 0;
  private nextBombSurgeTick: number = 0;
  private nextUfoTick: number = 0;
  // Freeze wave state: stores original tiles to revert after duration
  private frozenTiles: Map<string, TileType> = new Map();
  private frozenTilesRevertTick: number = 0;
  // Enabled map event types (granular control)
  private enabledMapEventTypes: Set<string> = new Set();

  // Hazard tile state
  private hazardTileTypes: string[] = [];
  private quicksandTimers: Map<number, number> = new Map();
  private iceSliding: Map<number, Direction> = new Map();
  private prevPlayerPositions: Map<number, string> = new Map();
  private spikePositions: Position[] = [];
  private spikePhase: number = 0;

  // Tile diff tracking for delta state broadcasts
  private _dirtyTiles: Map<string, TileDiff> = new Map();

  // Bot AI tick throttling: cache last bot inputs to reuse on skipped ticks
  private _lastBotInputs: Map<number, PlayerInput> = new Map();

  constructor(config: GameConfig) {
    const {
      mapWidth,
      mapHeight,
      mapSeed,
      gameMode = 'ffa',
      hasZone = false,
      roundTime = 180,
      wallDensity = DEFAULT_WALL_DENSITY,
      enabledPowerUps,
      powerUpDropRate = DEFAULT_POWERUP_DROP_RATE,
      friendlyFire = true,
      botDifficulty = 'normal',
      reinforcedWalls = false,
      enableMapEvents = false,
      enabledMapEvents = [],
      hazardTiles = [],
      botAiId = 'builtin',
    } = config;
    this.botAiId = botAiId;

    this.map =
      config.customMap ?? generateMap(mapWidth, mapHeight, mapSeed, wallDensity, hazardTiles);
    this.collisionSystem = new CollisionSystem(
      this.map.tiles,
      this.map.width,
      this.map.height,
      reinforcedWalls,
    );
    this.rng = new SeededRandom(this.map.seed + 1);
    this.gameMode = gameMode;
    this.roundTime = roundTime;
    this.enabledPowerUps = enabledPowerUps ?? ['bomb_up', 'fire_up', 'speed_up', 'shield', 'kick'];
    this.powerUpDropRate = powerUpDropRate;
    this.friendlyFire = friendlyFire;
    this.botDifficulty = botDifficulty;
    this.reinforcedWalls = reinforcedWalls;
    this.hazardTileTypes = hazardTiles;

    // Map events: enabledMapEvents array takes precedence, fall back to boolean toggle
    this.enabledMapEventTypes = new Set(enabledMapEvents.length > 0 ? enabledMapEvents : []);
    this.enableMapEvents = this.enabledMapEventTypes.size > 0 || enableMapEvents;
    if (this.enableMapEvents) {
      // If boolean was used without specific types, enable all classic events
      if (this.enabledMapEventTypes.size === 0) {
        for (const t of ['meteor', 'powerup_rain', 'wall_collapse', 'freeze_wave', 'bomb_surge']) {
          this.enabledMapEventTypes.add(t);
        }
      }
      // Stagger initial event timers only for enabled events
      if (this.enabledMapEventTypes.has('wall_collapse')) {
        this.nextWallCollapseTick = Math.floor((45 + this.rng.next() * 15) * TICK_RATE);
      }
      if (this.enabledMapEventTypes.has('freeze_wave')) {
        this.nextFreezeWaveTick = Math.floor((55 + this.rng.next() * 15) * TICK_RATE);
      }
      if (this.enabledMapEventTypes.has('bomb_surge')) {
        this.nextBombSurgeTick = Math.floor((40 + this.rng.next() * 15) * TICK_RATE);
      }
      if (this.enabledMapEventTypes.has('ufo_abduction')) {
        this.nextUfoTick = Math.floor((35 + this.rng.next() * 15) * TICK_RATE);
      }
    }

    // Scan for spike positions if spikes are enabled
    if (hazardTiles.includes('spikes')) {
      for (let y = 0; y < this.map.height; y++) {
        for (let x = 0; x < this.map.width; x++) {
          if (this.map.tiles[y][x] === 'spikes' || this.map.tiles[y][x] === 'spikes_active') {
            this.spikePositions.push({ x, y });
          }
        }
      }
    }

    // Shuffle spawn point indices using Fisher-Yates for fair spawn assignment (deterministic per seed)
    this.shuffledSpawnIndices = this.map.spawnPoints.map((_, i) => i);
    for (let i = this.shuffledSpawnIndices.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [this.shuffledSpawnIndices[i], this.shuffledSpawnIndices[j]] = [
        this.shuffledSpawnIndices[j],
        this.shuffledSpawnIndices[i],
      ];
    }

    if (this.map.spawnPoints.length === 0) {
      throw new Error('Map has no spawn points');
    }

    if (hasZone) {
      this.zone = new BattleRoyaleZone(mapWidth, mapHeight);
    }

    // KOTH: initialize hill zone
    if (gameMode === 'king_of_the_hill') {
      const hx = Math.floor(mapWidth / 2) - Math.floor(KOTH_ZONE_SIZE / 2);
      const hy = Math.floor(mapHeight / 2) - Math.floor(KOTH_ZONE_SIZE / 2);
      this.hillZone = { x: hx, y: hy, width: KOTH_ZONE_SIZE, height: KOTH_ZONE_SIZE };
      this.nextHillMoveTick = KOTH_HILL_MOVE_INTERVAL;
    }
  }

  addPlayer(
    id: number,
    username: string,
    team: number | null = null,
    isBot: boolean = false,
    isBuddy: boolean = false,
    buddyOwnerId: number | null = null,
  ): Player {
    const spawnIndex =
      this.shuffledSpawnIndices[this.players.size % this.shuffledSpawnIndices.length];
    const spawnPos = this.map.spawnPoints[spawnIndex];
    const player = new Player(id, username, spawnPos, team, isBot, isBuddy, buddyOwnerId);
    this.players.set(id, player);
    this.placementCounter++;
    if (isBot) {
      this.botAIs.set(
        id,
        getBotAIRegistry().createInstance(this.botAiId, this.botDifficulty, {
          width: this.map.width,
          height: this.map.height,
        }),
      );
    }
    return player;
  }

  removePlayer(id: number): void {
    this.inputBuffer.clear(id);
    this.players.delete(id);
    this.botAIs.delete(id);
  }

  /** Spawn a power-up at a specific tile position (used by campaign mode) */
  spawnPowerUpAt(x: number, y: number, type: PowerUpType): void {
    const powerUp = new PowerUp({ x, y }, type);
    this.powerUps.set(powerUp.id, powerUp);
  }

  processTick(): void {
    if (this.status !== 'playing') return;
    this.tick++;
    this._processingTick = true;

    // Clear per-tick event buffers and caches
    this.tickEvents = { explosions: [], playerDied: [], powerupCollected: [], bombThrown: [] };
    this._alivePlayersCache = null;

    // Check if grace period has elapsed
    if (this.finishTick !== null) {
      if (this.tick >= this.finishTick + GameStateManager.FINISH_DELAY_TICKS) {
        this.status = 'finished';
        this._processingTick = false;
        return;
      }
      // During grace period: skip player/bot input, but keep processing explosions and bombs below
    }

    const isFinishing = this.finishTick !== null;

    // Log state at interval based on verbosity
    if (this.gameLogger && this.gameLogger.shouldLogTick(this.tick)) {
      this.gameLogger.logTick(
        this.tick,
        [...this.players.values()],
        [...this.bombs.values()],
        [...this.explosions.values()],
      );
    }

    if (!isFinishing) {
      // 0. Generate bot inputs (throttled: full AI every other tick, reuse last input on off-ticks)
      const runFullBotAI = this.tick % 2 === 0;
      for (const [botId, ai] of this.botAIs) {
        const botPlayer = this.players.get(botId);
        if (botPlayer && botPlayer.alive) {
          if (runFullBotAI) {
            try {
              const input = ai.generateInput(botPlayer, this, this.gameLogger);
              if (input) {
                this.inputBuffer.addInput(botId, input);
                this._lastBotInputs.set(botId, input);
              } else {
                this._lastBotInputs.delete(botId);
              }
            } catch (err: unknown) {
              // Custom AI crashed — replace with built-in fallback
              const msg = err instanceof Error ? err.message : String(err);
              if (this.gameLogger) {
                this.gameLogger.logBotDecision(botId, 'ai_crash', `Custom AI error: ${msg}`);
              }
              this.botAIs.set(
                botId,
                getBotAIRegistry().createInstance('builtin', this.botDifficulty, {
                  width: this.map.width,
                  height: this.map.height,
                }),
              );
            }
          } else {
            // Off-tick: reuse last input (movement continues, no new decisions)
            const lastInput = this._lastBotInputs.get(botId);
            if (lastInput) {
              this.inputBuffer.addInput(botId, {
                ...lastInput,
                seq: lastInput.seq + 1,
                tick: this.tick,
              });
            }
          }
        }
      }

      // Pre-compute shared position data once for all processPlayerInput calls
      const sharedBombPositions: { x: number; y: number }[] = [];
      const bombPosSet = new Set<string>();
      for (const b of this.bombs.values()) {
        sharedBombPositions.push(b.position);
        bombPosSet.add(`${b.position.x},${b.position.y}`);
      }

      const sharedPlayerPositions: { x: number; y: number; id: number; buddyOwnerId?: number }[] =
        [];
      const alivePlayerPosSet = new Set<string>();
      for (const p of this.players.values()) {
        if (p.alive) {
          alivePlayerPosSet.add(`${p.position.x},${p.position.y}`);
          if (!p.frozen) {
            sharedPlayerPositions.push({
              x: p.position.x,
              y: p.position.y,
              id: p.id,
              ...(p.isBuddy && p.buddyOwnerId != null ? { buddyOwnerId: p.buddyOwnerId } : {}),
            });
          }
        }
      }

      // 1. Process inputs
      for (const [playerId, player] of this.players) {
        player.movedThisTick = false;
        if (!player.alive) continue;

        const input = this.inputBuffer.getLatestInput(playerId);
        if (input) {
          this.processPlayerInput(
            player,
            input,
            sharedBombPositions,
            sharedPlayerPositions,
            bombPosSet,
            alivePlayerPosSet,
          );
        }

        player.tick();
      }

      // 1b. Process conveyor belt forced movement
      this.processConveyors(sharedBombPositions, sharedPlayerPositions);

      // 1c. Hazard tile movement slowdown (vine, quicksand, mud)
      if (this.hazardTileTypes.length > 0) {
        for (const player of this.players.values()) {
          if (!player.alive || !player.movedThisTick) continue;
          const tile = this.collisionSystem.getTileAt(player.position.x, player.position.y);
          if (isSlowingTile(tile)) {
            player.moveCooldown += MOVE_COOLDOWN_BASE;
          }
        }
      }
    }

    // 2. Update bomb timers and slide kicked bombs
    // Build position sets for O(1) slide collision checks (only when bombs are sliding)
    let slideBombPosSet: Set<string> | undefined;
    let slidePlayerPosSet: Set<string> | undefined;
    let hasSlidingBombs = false;
    for (const b of this.bombs.values()) {
      if (b.sliding) {
        hasSlidingBombs = true;
        break;
      }
    }
    if (hasSlidingBombs) {
      slideBombPosSet = new Set<string>();
      slidePlayerPosSet = new Set<string>();
      for (const b of this.bombs.values()) slideBombPosSet.add(`${b.position.x},${b.position.y}`);
      for (const p of this.players.values()) {
        if (p.alive) slidePlayerPosSet.add(`${p.position.x},${p.position.y}`);
      }
    }

    const bombsToDetonate: Bomb[] = [];
    for (const bomb of this.bombs.values()) {
      // Slide kicked bombs (sets only built when hasSlidingBombs)
      if (bomb.sliding && slideBombPosSet && slidePlayerPosSet) {
        const dx = bomb.sliding === 'left' ? -1 : bomb.sliding === 'right' ? 1 : 0;
        const dy = bomb.sliding === 'up' ? -1 : bomb.sliding === 'down' ? 1 : 0;
        const nextX = bomb.position.x + dx;
        const nextY = bomb.position.y + dy;
        const nextKey = `${nextX},${nextY}`;

        // Stop if hitting a wall, another bomb, a player, or a campaign enemy
        const blocked =
          !this.collisionSystem.isWalkable(nextX, nextY) ||
          slideBombPosSet.has(nextKey) ||
          slidePlayerPosSet.has(nextKey) ||
          (this.campaignEnemyPositions !== null && this.campaignEnemyPositions.has(nextKey));

        if (blocked) {
          bomb.sliding = null;
        } else {
          // Update position sets to reflect the move
          slideBombPosSet.delete(`${bomb.position.x},${bomb.position.y}`);
          bomb.position = { x: nextX, y: nextY };
          slideBombPosSet.add(nextKey);
        }
      }

      if (bomb.tick()) {
        bombsToDetonate.push(bomb);
      }
    }

    // 3. Process detonations (including chain reactions)
    if (bombsToDetonate.length > 0) {
      // Only snapshot tiles when chain reactions are possible (other bombs exist)
      const tileSnapshot =
        this.bombs.size > bombsToDetonate.length
          ? this.map.tiles.map((row) => [...row])
          : undefined;
      for (const bomb of bombsToDetonate) {
        this.detonateBomb(bomb, tileSnapshot);
      }
    }

    // 4. Update explosion timers
    for (const [id, explosion] of this.explosions) {
      if (explosion.tick()) {
        this.explosions.delete(id);
      }
    }

    // 5. Check player-explosion collisions
    for (const player of this.players.values()) {
      if (!player.alive || player.invulnerableTicks > 0) continue;
      if (player.isBuddy) continue; // Buddy is invulnerable
      // Winner is invulnerable during grace period
      if (isFinishing && this.winnerId === player.id) continue;

      for (const explosion of this.explosions.values()) {
        // Skip damage during fade-out phase (last 3 ticks) — explosion is visually fading
        if (explosion.ticksRemaining <= 3) continue;
        if (explosion.containsCell(player.position.x, player.position.y)) {
          const owner = this.players.get(explosion.ownerId);

          // Friendly fire check: skip damage if FF is off and same team (but self-damage always applies)
          if (
            !this.friendlyFire &&
            owner &&
            owner.id !== player.id &&
            player.team !== null &&
            owner.team === player.team
          ) {
            continue;
          }

          // Buddy bombs never hurt their owner
          if (owner && owner.isBuddy && owner.buddyOwnerId === player.id) {
            continue;
          }

          if (player.hasShield) {
            player.hasShield = false;
            // Brief invulnerability so the same multi-tick explosion
            // doesn't kill the now-unshielded player next tick
            player.invulnerableTicks = 10;
          } else {
            player.die();
            this.invalidateAliveCache();
            this.placementCounter--;
            player.placement = this.getAlivePlayers().length + 1;

            // Credit kill or track self-kill (self-kills subtract 1 from score)
            if (owner && owner.id !== player.id) {
              owner.kills++;
              this.gameLogger?.logKill(owner.id, owner.username, player.id, player.username, false);
              this.tickEvents.playerDied.push({
                playerId: player.id,
                killerId: owner.id,
                cause: 'bomb',
              });
            } else if (owner && owner.id === player.id) {
              owner.selfKills++;
              owner.kills--;
              this.gameLogger?.logKill(owner.id, owner.username, player.id, player.username, true);
              this.tickEvents.playerDied.push({
                playerId: player.id,
                killerId: owner.id,
                cause: 'self',
              });
            } else {
              this.tickEvents.playerDied.push({
                playerId: player.id,
                killerId: null,
                cause: 'bomb',
              });
            }

            // Drop one random collected power-up at death position
            this.dropPowerUpOnDeath(player);
          }
          break;
        }
      }
    }

    // 6. Check power-up pickups
    for (const player of this.players.values()) {
      if (!player.alive) continue;

      for (const [id, powerUp] of this.powerUps) {
        if (powerUp.position.x === player.position.x && powerUp.position.y === player.position.y) {
          this.tickEvents.powerupCollected.push({
            playerId: player.id,
            type: powerUp.type,
            position: { ...powerUp.position },
          });
          // Buddy proxies power-ups to owner
          if (player.isBuddy && player.buddyOwnerId !== null) {
            const owner = this.players.get(player.buddyOwnerId);
            if (owner && owner.alive) {
              owner.applyPowerUp(powerUp.type);
            }
          } else {
            player.applyPowerUp(powerUp.type);
          }
          this.gameLogger?.logPowerupPickup(
            player.id,
            player.username,
            powerUp.type,
            powerUp.position,
          );
          this.powerUps.delete(id);
        }
      }
    }

    // 6.3 Hazard tile processing
    if (this.hazardTileTypes.length > 0 && this.finishTick === null) {
      this.processHazardTiles();
    }

    // 6.5 King of the Hill scoring
    this._hillControllingPlayerId = null;
    if (this.hillZone && this.finishTick === null) {
      // Dynamic hill movement
      if (this.tick >= this.nextHillMoveTick - KOTH_HILL_MOVE_WARNING && !this.pendingHillZone) {
        const newZone = this.pickNewHillZone();
        if (newZone) {
          this.pendingHillZone = newZone;
          this.mapEvents.push({
            type: 'hill_move',
            position: { x: newZone.x, y: newZone.y },
            tick: this.nextHillMoveTick,
            warningTick: this.tick,
          });
          this._mapEventsDirty = true;
        }
      }
      if (this.tick >= this.nextHillMoveTick && this.pendingHillZone) {
        this.hillZone = this.pendingHillZone;
        this.pendingHillZone = null;
        this.nextHillMoveTick = this.tick + KOTH_HILL_MOVE_INTERVAL;
      }

      const playersInZone = this.getAlivePlayers().filter(
        (p) =>
          p.position.x >= this.hillZone!.x &&
          p.position.x < this.hillZone!.x + this.hillZone!.width &&
          p.position.y >= this.hillZone!.y &&
          p.position.y < this.hillZone!.y + this.hillZone!.height,
      );

      // Score only if exactly one player (or one team) controls the zone
      if (playersInZone.length === 1) {
        const controllerId = playersInZone[0].id;
        this._hillControllingPlayerId = controllerId;
        const current = this.kothScores.get(controllerId) || 0;
        this.kothScores.set(controllerId, current + KOTH_POINTS_PER_TICK);

        if (current + KOTH_POINTS_PER_TICK >= KOTH_SCORE_TARGET) {
          this.winnerId = controllerId;
          playersInZone[0].placement = 1;
          this.finishTick = this.tick;
          this.finishReason = `${playersInZone[0].username} controls the hill!`;
        }
      }
    }

    // 6.7 Dynamic map events
    if (this.enableMapEvents && this.finishTick === null) {
      // Meteor strike every 30-45 seconds
      if (this.enabledMapEventTypes.has('meteor') && this.tick >= this.nextMeteorTick) {
        // Find random empty tile
        const emptyTiles: Position[] = [];
        for (let y = 1; y < this.map.height - 1; y++) {
          for (let x = 1; x < this.map.width - 1; x++) {
            if (this.map.tiles[y][x] === 'empty' || this.map.tiles[y][x] === 'spawn') {
              emptyTiles.push({ x, y });
            }
          }
        }
        if (emptyTiles.length > 0) {
          const target = emptyTiles[Math.floor(this.rng.next() * emptyTiles.length)];
          const warningTick = this.tick;
          const impactTick = this.tick + 40; // 2 second warning
          this.mapEvents.push({ type: 'meteor', position: target, tick: impactTick, warningTick });
          this._mapEventsDirty = true;
        }
        this.nextMeteorTick = this.tick + Math.floor((30 + this.rng.next() * 15) * TICK_RATE);
      }

      // Power-up rain every 60 seconds
      if (this.enabledMapEventTypes.has('powerup_rain') && this.tick >= this.nextPowerupRainTick) {
        const emptyTiles: Position[] = [];
        for (let y = 1; y < this.map.height - 1; y++) {
          for (let x = 1; x < this.map.width - 1; x++) {
            if (this.map.tiles[y][x] === 'empty' || this.map.tiles[y][x] === 'spawn') {
              emptyTiles.push({ x, y });
            }
          }
        }
        // Spawn 3-5 random power-ups
        const count = 3 + Math.floor(this.rng.next() * 3);
        for (let i = 0; i < count && emptyTiles.length > 0; i++) {
          const idx = Math.floor(this.rng.next() * emptyTiles.length);
          const pos = emptyTiles.splice(idx, 1)[0];
          const type = this.getRandomEnabledPowerUp();
          const powerUp = new PowerUp(pos, type);
          this.powerUps.set(powerUp.id, powerUp);
        }
        this.mapEvents.push({ type: 'powerup_rain', tick: this.tick });
        this._mapEventsDirty = true;
        this.nextPowerupRainTick = this.tick + 60 * TICK_RATE;
      }

      // Wall collapse every 45-60 seconds
      if (
        this.enabledMapEventTypes.has('wall_collapse') &&
        this.tick >= this.nextWallCollapseTick
      ) {
        // Find 3x3 areas with at least 1 destructible wall
        const candidates: Position[] = [];
        for (let y = 1; y < this.map.height - 4; y++) {
          for (let x = 1; x < this.map.width - 4; x++) {
            let hasDestructible = false;
            for (let dy = 0; dy < 3 && !hasDestructible; dy++) {
              for (let dx = 0; dx < 3 && !hasDestructible; dx++) {
                const tile = this.map.tiles[y + dy][x + dx];
                if (tile === 'destructible' || tile === 'destructible_cracked') {
                  hasDestructible = true;
                }
              }
            }
            if (hasDestructible) candidates.push({ x, y });
          }
        }
        if (candidates.length > 0) {
          const target = candidates[Math.floor(this.rng.next() * candidates.length)];
          const impactTick = this.tick + 40; // 2 second warning
          this.mapEvents.push({
            type: 'wall_collapse',
            position: target,
            tick: impactTick,
            warningTick: this.tick,
          });
          this._mapEventsDirty = true;
        }
        this.nextWallCollapseTick = this.tick + Math.floor((45 + this.rng.next() * 15) * TICK_RATE);
      }

      // Freeze wave every 50-70 seconds
      if (this.enabledMapEventTypes.has('freeze_wave') && this.tick >= this.nextFreezeWaveTick) {
        const isRow = this.rng.next() > 0.5;
        const maxIdx = isRow ? this.map.height - 2 : this.map.width - 2;
        const idx = 1 + Math.floor(this.rng.next() * maxIdx);
        const impactTick = this.tick + 20; // 1 second warning
        this.mapEvents.push({
          type: 'freeze_wave',
          position: isRow ? { x: 0, y: idx } : { x: idx, y: 0 },
          direction: isRow ? 'row' : 'column',
          index: idx,
          tick: impactTick,
          warningTick: this.tick,
        });
        this._mapEventsDirty = true;
        this.nextFreezeWaveTick = this.tick + Math.floor((50 + this.rng.next() * 20) * TICK_RATE);
      }

      // Bomb surge every 40-55 seconds
      if (this.enabledMapEventTypes.has('bomb_surge') && this.tick >= this.nextBombSurgeTick) {
        let bombCount = 0;
        for (const bomb of this.bombs.values()) {
          bomb.ticksRemaining = Math.max(1, bomb.ticksRemaining - 20);
          bombCount++;
        }
        if (bombCount > 0) {
          this.mapEvents.push({ type: 'bomb_surge', tick: this.tick });
          this._mapEventsDirty = true;
        }
        this.nextBombSurgeTick = this.tick + Math.floor((40 + this.rng.next() * 15) * TICK_RATE);
      }

      // UFO abduction every 35-50 seconds
      if (this.enabledMapEventTypes.has('ufo_abduction') && this.tick >= this.nextUfoTick) {
        const alivePlayers = this.getAlivePlayers().filter((p) => p.invulnerableTicks <= 0);
        if (alivePlayers.length > 0) {
          const target = alivePlayers[Math.floor(this.rng.next() * alivePlayers.length)];
          const impactTick = this.tick + 40; // 2 second warning
          this.mapEvents.push({
            type: 'ufo_abduction',
            position: { x: target.position.x, y: target.position.y },
            targetPlayerId: target.id,
            tick: impactTick,
            warningTick: this.tick,
          });
          this._mapEventsDirty = true;
        }
        this.nextUfoTick = this.tick + Math.floor((35 + this.rng.next() * 15) * TICK_RATE);
      }

      // Revert freeze wave tiles when duration expires
      if (this.frozenTiles.size > 0 && this.tick >= this.frozenTilesRevertTick) {
        for (const [key, originalType] of this.frozenTiles) {
          const [xStr, yStr] = key.split(',');
          this.setTileTracked(parseInt(xStr), parseInt(yStr), originalType);
        }
        this.frozenTiles.clear();
      }

      // Process pending meteor impacts
      for (let i = this.mapEvents.length - 1; i >= 0; i--) {
        const event = this.mapEvents[i];
        if (event.type === 'meteor' && event.position && this.tick >= event.tick) {
          // Create explosion at meteor position
          const cells = getExplosionCells(
            event.position.x,
            event.position.y,
            2,
            this.map.width,
            this.map.height,
            this.map.tiles,
          );
          const explosion = new Explosion(cells, -999); // System-owned
          this.explosions.set(explosion.id, explosion);
          // Destroy walls
          for (const cell of cells) {
            this.destroyTileTracked(cell.x, cell.y);
          }
          this.mapEvents.splice(i, 1);
          this._mapEventsDirty = true;
        }

        // Process wall collapse impacts
        if (event.type === 'wall_collapse' && event.position && this.tick >= event.tick) {
          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 3; dx++) {
              this.destroyTileTracked(event.position.x + dx, event.position.y + dy);
            }
          }
          this.mapEvents.splice(i, 1);
          this._mapEventsDirty = true;
        }

        // Process freeze wave impacts
        if (
          event.type === 'freeze_wave' &&
          this.tick >= event.tick &&
          this.frozenTiles.size === 0
        ) {
          const idx = event.index!;
          const isRow = event.direction === 'row';
          const len = isRow ? this.map.width : this.map.height;
          for (let j = 1; j < len - 1; j++) {
            const x = isRow ? j : idx;
            const y = isRow ? idx : j;
            const tile = this.map.tiles[y][x];
            // Only freeze walkable non-special tiles
            if (tile === 'empty' || tile === 'spawn') {
              this.frozenTiles.set(`${x},${y}`, tile);
              this.setTileTracked(x, y, 'ice');
            }
          }
          this.frozenTilesRevertTick = this.tick + 120; // 6 seconds
          this.mapEvents.splice(i, 1);
          this._mapEventsDirty = true;
        }

        // Process UFO abduction impacts
        if (event.type === 'ufo_abduction' && this.tick >= event.tick) {
          if (event.targetPlayerId != null) {
            const player = this.players.get(event.targetPlayerId);
            if (player && player.alive) {
              // Teleport to random walkable tile
              const walkableTiles: Position[] = [];
              for (let y = 1; y < this.map.height - 1; y++) {
                for (let x = 1; x < this.map.width - 1; x++) {
                  const tile = this.map.tiles[y][x];
                  if (
                    (tile === 'empty' || tile === 'spawn') &&
                    !(x === player.position.x && y === player.position.y)
                  ) {
                    walkableTiles.push({ x, y });
                  }
                }
              }
              if (walkableTiles.length > 0) {
                const dest = walkableTiles[Math.floor(this.rng.next() * walkableTiles.length)];
                player.position = { x: dest.x, y: dest.y };
                player.applyMoveCooldown();
                player.invulnerableTicks = 10; // Brief invulnerability after teleport
              }
            }
          }
          this.mapEvents.splice(i, 1);
          this._mapEventsDirty = true;
        }
      }

      // Clean old events
      const prevLen = this.mapEvents.length;
      this.mapEvents = this.mapEvents.filter((e) => this.tick - e.tick < 200);
      if (this.mapEvents.length !== prevLen) this._mapEventsDirty = true;
    }

    // 7. Update Battle Royale zone
    if (this.zone) {
      this.zone.tick(this.tick);

      // Zone damage
      for (const player of this.players.values()) {
        if (!player.alive) continue;
        if (player.isBuddy) continue; // Buddy is immune to zone damage
        if (!this.zone.isInsideZone(player.position.x, player.position.y)) {
          if (player.hasShield) {
            player.hasShield = false;
          } else {
            player.die();
            this.invalidateAliveCache();
            this.placementCounter--;
            player.placement = this.getAlivePlayers().length + 1;
            this.tickEvents.playerDied.push({ playerId: player.id, killerId: null, cause: 'zone' });
            this.dropPowerUpOnDeath(player);
          }
        }
      }
    }

    // 7.5 Deathmatch respawns
    if (this.gameMode === 'deathmatch') {
      for (const player of this.players.values()) {
        if (!player.alive && player.respawnTick === null) {
          player.respawnTick = this.tick + DEATHMATCH_RESPAWN_TICKS;
        }
        if (!player.alive && player.respawnTick !== null && this.tick >= player.respawnTick) {
          // Find a random safe spawn point
          const spawnPoints = this.map.spawnPoints;
          const spawnPos = spawnPoints[Math.floor(this.rng.next() * spawnPoints.length)];
          player.respawn(spawnPos);
          this.invalidateAliveCache();
        }
      }
    }

    // 8. Time limit check (campaign handles its own timer via CampaignGame)
    if (this.finishTick === null && this.gameMode !== 'campaign') {
      const timeElapsed = this.tick / TICK_RATE;
      if (timeElapsed >= this.roundTime && this.status === 'playing') {
        const alive = this.getAlivePlayers();
        if (alive.length === 1) {
          this.winnerId = alive[0].id;
          alive[0].placement = 1;
        }
        this.finishTick = this.tick;
        this.finishReason = "Time's up!";
      }
    }

    // 9. Check win condition
    if (this.finishTick === null) {
      this.checkWinCondition();
    }

    // Track previous player positions for hazard entry detection (ice, dark_rift)
    if (this.hazardTileTypes.length > 0) {
      for (const player of this.players.values()) {
        this.prevPlayerPositions.set(player.id, `${player.position.x},${player.position.y}`);
      }
    }

    this._processingTick = false;
  }

  // --- Hazard tile processing (multiplayer) ---

  private processHazardTiles(): void {
    if (this.hazardTileTypes.includes('quicksand')) this.processQuicksandTiles();
    if (this.hazardTileTypes.includes('ice')) this.processIceSliding();
    if (this.hazardTileTypes.includes('lava')) this.processLavaDetonation();
    if (this.hazardTileTypes.includes('spikes')) this.processSpikeTiles();
    if (this.hazardTileTypes.includes('dark_rift')) this.processDarkRiftTiles();
  }

  private processQuicksandTiles(): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const tile = this.collisionSystem.getTileAt(player.position.x, player.position.y);
      if (tile === 'quicksand') {
        const timer = (this.quicksandTimers.get(player.id) ?? 0) + 1;
        this.quicksandTimers.set(player.id, timer);
        if (timer >= QUICKSAND_KILL_TICKS) {
          if (player.hasShield) {
            player.hasShield = false;
            player.invulnerableTicks = 10;
            this.quicksandTimers.set(player.id, 0);
          } else if (player.invulnerableTicks <= 0) {
            player.die();
            this.invalidateAliveCache();
            this.placementCounter--;
            player.placement = this.getAlivePlayers().length + 1;
            this.tickEvents.playerDied.push({
              playerId: player.id,
              killerId: null,
              cause: 'quicksand',
            });
            this.dropPowerUpOnDeath(player);
            this.quicksandTimers.delete(player.id);
          }
        }
      } else {
        this.quicksandTimers.delete(player.id);
      }
    }
  }

  private processIceSliding(): void {
    const bombPositions = Array.from(this.bombs.values()).map((b) => b.position);

    // Detect players who just moved onto ice
    for (const player of this.players.values()) {
      if (!player.alive || player.frozen) continue;
      if (this.iceSliding.has(player.id)) continue;
      const tile = this.collisionSystem.getTileAt(player.position.x, player.position.y);
      if (tile !== 'ice') continue;
      const prevKey = this.prevPlayerPositions.get(player.id);
      const curKey = `${player.position.x},${player.position.y}`;
      if (prevKey !== curKey) {
        this.iceSliding.set(player.id, player.direction);
      }
    }

    // Process player ice sliding
    for (const [playerId, direction] of this.iceSliding) {
      const player = this.players.get(playerId);
      if (!player || !player.alive) {
        this.iceSliding.delete(playerId);
        continue;
      }

      const playerPositions = Array.from(this.players.values())
        .filter((p) => p.alive && p.id !== playerId)
        .map((p) => p.position);

      const newPos = this.collisionSystem.canMoveTo(
        player.position.x,
        player.position.y,
        direction,
        bombPositions,
        playerPositions,
      );

      if (newPos) {
        player.position = newPos;
        player.applyMoveCooldown();
        const newTile = this.collisionSystem.getTileAt(newPos.x, newPos.y);
        if (newTile !== 'ice') {
          this.iceSliding.delete(playerId);
        }
        this.applyTeleporter(player);
      } else {
        this.iceSliding.delete(playerId);
      }
    }

    // Ice affects kicked bombs: sliding bombs on ice move an extra tile
    for (const bomb of this.bombs.values()) {
      if (!bomb.sliding) continue;
      const tile = this.collisionSystem.getTileAt(bomb.position.x, bomb.position.y);
      if (tile !== 'ice') continue;

      const dx = bomb.sliding === 'left' ? -1 : bomb.sliding === 'right' ? 1 : 0;
      const dy = bomb.sliding === 'up' ? -1 : bomb.sliding === 'down' ? 1 : 0;
      const nextX = bomb.position.x + dx;
      const nextY = bomb.position.y + dy;
      if (this.collisionSystem.isWalkable(nextX, nextY)) {
        let blocked = false;
        for (const other of this.bombs.values()) {
          if (other.id !== bomb.id && other.position.x === nextX && other.position.y === nextY) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          bomb.position = { x: nextX, y: nextY };
        }
      }
    }
  }

  private processLavaDetonation(): void {
    for (const bomb of this.bombs.values()) {
      const { x, y } = bomb.position;
      const adjacent: TileType[] = [
        this.collisionSystem.getTileAt(x - 1, y),
        this.collisionSystem.getTileAt(x + 1, y),
        this.collisionSystem.getTileAt(x, y - 1),
        this.collisionSystem.getTileAt(x, y + 1),
      ];
      if (adjacent.some((t) => t === 'lava')) {
        bomb.ticksRemaining = Math.min(bomb.ticksRemaining, 1);
      }
    }
  }

  private processSpikeTiles(): void {
    if (this.spikePositions.length === 0) return;

    const prevPhase = this.spikePhase;
    this.spikePhase = (this.spikePhase + 1) % SPIKE_CYCLE_TICKS;

    // Transition from safe to lethal
    if (prevPhase < SPIKE_SAFE_TICKS && this.spikePhase >= SPIKE_SAFE_TICKS) {
      for (const pos of this.spikePositions) {
        this.setTileTracked(pos.x, pos.y, 'spikes_active');
      }
    }

    // Transition from lethal to safe
    if (prevPhase >= SPIKE_SAFE_TICKS && this.spikePhase < SPIKE_SAFE_TICKS) {
      for (const pos of this.spikePositions) {
        this.setTileTracked(pos.x, pos.y, 'spikes');
      }
    }

    // Kill players on active spikes
    if (this.spikePhase >= SPIKE_SAFE_TICKS) {
      for (const player of this.players.values()) {
        if (!player.alive || player.invulnerableTicks > 0 || player.frozen) continue;
        const tile = this.collisionSystem.getTileAt(player.position.x, player.position.y);
        if (tile === 'spikes_active') {
          if (player.hasShield) {
            player.hasShield = false;
            player.invulnerableTicks = 10;
          } else {
            player.die();
            this.invalidateAliveCache();
            this.placementCounter--;
            player.placement = this.getAlivePlayers().length + 1;
            this.tickEvents.playerDied.push({
              playerId: player.id,
              killerId: null,
              cause: 'spikes',
            });
            this.dropPowerUpOnDeath(player);
          }
        }
      }
    }
  }

  private processDarkRiftTiles(): void {
    for (const player of this.players.values()) {
      if (!player.alive || player.frozen) continue;
      const tile = this.collisionSystem.getTileAt(player.position.x, player.position.y);
      if (tile !== 'dark_rift') continue;

      const prevKey = this.prevPlayerPositions.get(player.id);
      const curKey = `${player.position.x},${player.position.y}`;
      if (prevKey === curKey) continue;

      const emptyTiles: Position[] = [];
      for (let y = 0; y < this.map.height; y++) {
        for (let x = 0; x < this.map.width; x++) {
          const t = this.collisionSystem.getTileAt(x, y);
          if (
            (t === 'empty' || t === 'spawn') &&
            !(x === player.position.x && y === player.position.y)
          ) {
            emptyTiles.push({ x, y });
          }
        }
      }
      if (emptyTiles.length > 0) {
        const dest = emptyTiles[Math.floor(this.rng.next() * emptyTiles.length)];
        player.position = { x: dest.x, y: dest.y };
        player.applyMoveCooldown();
      }
    }
  }

  /** Cached serialization of mapEvents — rebuilt only when events change */
  private getSerializedMapEvents() {
    if (this._mapEventsDirty) {
      this._mapEventsCache =
        this.mapEvents.length > 0
          ? this.mapEvents.map((e) => ({
              type: e.type as
                | 'meteor'
                | 'powerup_rain'
                | 'wall_collapse'
                | 'freeze_wave'
                | 'bomb_surge'
                | 'hill_move'
                | 'ufo_abduction',
              position: e.position,
              tick: e.tick,
              warningTick: e.warningTick,
              direction: e.direction,
              index: e.index,
              targetPlayerId: e.targetPlayerId,
            }))
          : undefined;
      this._mapEventsDirty = false;
    }
    return this._mapEventsCache;
  }

  /** Set a tile type and track the change for tile diff broadcast */
  setTileTracked(x: number, y: number, type: TileType): void {
    if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height) return;
    this.map.tiles[y][x] = type;
    this._dirtyTiles.set(`${x},${y}`, { x, y, type });
    this.collisionSystem.updateTiles(this.map.tiles);
  }

  /** Destroy a tile and track the change for delta broadcasting */
  private destroyTileTracked(x: number, y: number): boolean {
    const result = this.collisionSystem.destroyTile(x, y);
    // Track tile change regardless of whether it was "destroyed" (cracked counts too)
    if (x >= 0 && x < this.map.width && y >= 0 && y < this.map.height) {
      const currentType = this.map.tiles[y][x];
      const key = `${x},${y}`;
      const existing = this._dirtyTiles.get(key);
      if (!existing || existing.type !== currentType) {
        this._dirtyTiles.set(key, { x, y, type: currentType });
      }
    }
    return result;
  }

  private processPlayerInput(
    player: Player,
    input: PlayerInput,
    sharedBombPositions: { x: number; y: number }[],
    sharedPlayerPositions: { x: number; y: number; id: number; buddyOwnerId?: number }[],
    bombPosSet: Set<string>,
    alivePlayerPosSet: Set<string>,
  ): void {
    // Movement (with cooldown)
    if (input.direction && player.canMove()) {
      player.direction = input.direction;

      let newPos: { x: number; y: number } | null = null;

      if (player.isBuddy) {
        // Buddy passes through destructible walls and bombs, doesn't collide with owner
        newPos = this.collisionSystem.canBuddyMoveTo(
          player.position.x,
          player.position.y,
          input.direction,
        );
      } else {
        // Filter out self and own buddy from player positions
        const otherPlayerPositions = sharedPlayerPositions.filter(
          (sp) => sp.id !== player.id && sp.buddyOwnerId !== player.id,
        );

        newPos = this.collisionSystem.canMoveTo(
          player.position.x,
          player.position.y,
          input.direction,
          sharedBombPositions,
          otherPlayerPositions,
        );
      }

      if (newPos) {
        const from = { x: player.position.x, y: player.position.y };
        player.position = newPos;
        player.applyMoveCooldown();
        this.gameLogger?.logMovement(player.id, player.username, from, newPos, input.direction);
        this.applyTeleporter(player);
      } else if (player.hasKick) {
        // Try to kick a bomb in the movement direction
        const dx = input.direction === 'left' ? -1 : input.direction === 'right' ? 1 : 0;
        const dy = input.direction === 'up' ? -1 : input.direction === 'down' ? 1 : 0;
        const targetX = player.position.x + dx;
        const targetY = player.position.y + dy;

        for (const bomb of this.bombs.values()) {
          if (bomb.position.x === targetX && bomb.position.y === targetY && !bomb.sliding) {
            bomb.sliding = input.direction;
            player.applyMoveCooldown();
            break;
          }
        }
      }
    }

    // Remote bomb detonation
    if (input.action === 'detonate') {
      const remoteBombs: Bomb[] = [];
      for (const bomb of this.bombs.values()) {
        if (bomb.ownerId === player.id && bomb.bombType === 'remote') {
          remoteBombs.push(bomb);
        }
      }
      if (remoteBombs.length > 0) {
        const tileSnapshot = this.map.tiles.map((row) => [...row]);
        if (player.remoteDetonateMode === 'fifo') {
          // Detonate only the oldest bomb (lowest ticksRemaining = placed earliest)
          remoteBombs.sort((a, b) => a.ticksRemaining - b.ticksRemaining);
          this.detonateBomb(remoteBombs[0], tileSnapshot);
        } else {
          for (const bomb of remoteBombs) {
            this.detonateBomb(bomb, tileSnapshot);
          }
        }
      } else if (player.hasRemoteBomb) {
        // No remote bombs placed — toggle detonation mode
        player.remoteDetonateMode = player.remoteDetonateMode === 'all' ? 'fifo' : 'all';
      }
    }

    // Bomb placement
    if (input.action === 'bomb' && player.canPlaceBomb()) {
      // Determine bomb type
      const bombType: BombType = player.hasRemoteBomb
        ? 'remote'
        : player.hasPierceBomb
          ? 'pierce'
          : 'normal';

      if (player.hasLineBomb) {
        // Line bomb: place bombs in the player's facing direction on consecutive empty tiles
        const dir = player.direction;
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;

        // First, place a bomb at current position if possible
        const currentKey = `${player.position.x},${player.position.y}`;
        if (!bombPosSet.has(currentKey)) {
          const bomb = new Bomb(player.position, player.id, player.fireRange, bombType);
          this.bombs.set(bomb.id, bomb);
          bombPosSet.add(currentKey);
          player.bombCount++;
          player.bombsPlaced++;
          this.gameLogger?.logBomb(
            'place',
            player.id,
            player.username,
            player.position,
            player.fireRange,
          );
        }

        // Then place bombs in the facing direction
        let cx = player.position.x + dx;
        let cy = player.position.y + dy;
        while (player.canPlaceBomb()) {
          const tileKey = `${cx},${cy}`;
          // Check if the tile is walkable, has no bomb, and has no player
          if (!this.collisionSystem.isWalkable(cx, cy)) break;
          if (bombPosSet.has(tileKey)) break;
          if (alivePlayerPosSet.has(tileKey)) break;

          const pos: Position = { x: cx, y: cy };
          const bomb = new Bomb(pos, player.id, player.fireRange, bombType);
          this.bombs.set(bomb.id, bomb);
          bombPosSet.add(tileKey);
          player.bombCount++;
          player.bombsPlaced++;
          this.gameLogger?.logBomb('place', player.id, player.username, pos, player.fireRange);

          cx += dx;
          cy += dy;
        }
      } else {
        // Normal single bomb placement
        // Check if there's already a bomb at this position
        const posKey = `${player.position.x},${player.position.y}`;
        if (!bombPosSet.has(posKey)) {
          const bomb = new Bomb(player.position, player.id, player.fireRange, bombType);
          this.bombs.set(bomb.id, bomb);
          bombPosSet.add(posKey);
          player.bombCount++;
          player.bombsPlaced++;
          this.gameLogger?.logBomb(
            'place',
            player.id,
            player.username,
            player.position,
            player.fireRange,
          );
        }
      }
    }

    // Bomb throw: throw a bomb 3 tiles in facing direction, flying over walls
    if (input.action === 'throw' && player.hasBombThrow && player.canPlaceBomb()) {
      const bombType: BombType = player.hasRemoteBomb
        ? 'remote'
        : player.hasPierceBomb
          ? 'pierce'
          : 'normal';

      const dir = player.direction;
      const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
      const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
      const throwRange = 3;

      // Find the landing position: fly over everything, land on last valid tile
      let landPos: Position | null = null;
      for (let i = throwRange; i >= 1; i--) {
        const tx = player.position.x + dx * i;
        const ty = player.position.y + dy * i;
        // Must be in bounds
        if (tx < 0 || tx >= this.map.width || ty < 0 || ty >= this.map.height) continue;
        // Must be walkable (can't land on walls)
        if (!this.collisionSystem.isWalkable(tx, ty)) continue;
        // Must not already have a bomb
        if (bombPosSet.has(`${tx},${ty}`)) continue;
        landPos = { x: tx, y: ty };
        break;
      }

      // Fallback: place at feet if no valid landing position found
      if (!landPos) {
        const posKey = `${player.position.x},${player.position.y}`;
        if (!bombPosSet.has(posKey)) {
          landPos = { ...player.position };
        }
      }

      if (landPos) {
        const bomb = new Bomb(landPos, player.id, player.fireRange, bombType);
        this.bombs.set(bomb.id, bomb);
        bombPosSet.add(`${landPos.x},${landPos.y}`);
        player.bombCount++;
        player.bombsPlaced++;
        this.tickEvents.bombThrown.push({
          bombId: bomb.id,
          from: { ...player.position },
          to: { ...landPos },
        });
        this.gameLogger?.logBomb('place', player.id, player.username, landPos, player.fireRange);
      }
    }
  }

  /** Teleport entity if standing on a teleporter tile (A→B or B→A) */
  applyTeleporter(entity: { position: Position; applyMoveCooldown: () => void }): void {
    const tile = this.collisionSystem.getTileAt(entity.position.x, entity.position.y);
    if (tile !== 'teleporter_a' && tile !== 'teleporter_b') return;

    const targetType: TileType = tile === 'teleporter_a' ? 'teleporter_b' : 'teleporter_a';
    const targets: Position[] = [];
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (this.map.tiles[y][x] === targetType) {
          targets.push({ x, y });
        }
      }
    }
    if (targets.length === 0) return;

    const dest = targets[Math.floor(this.rng.next() * targets.length)];
    entity.position = { x: dest.x, y: dest.y };
    entity.applyMoveCooldown();
  }

  /** Push players and bombs standing on conveyor tiles in the conveyor's direction */
  private processConveyors(
    bombPositions: { x: number; y: number }[],
    playerPositions: { x: number; y: number; id: number; buddyOwnerId?: number }[],
  ): void {
    for (const player of this.players.values()) {
      if (!player.alive || !player.canMove()) continue;

      const tile = this.collisionSystem.getTileAt(player.position.x, player.position.y);
      let dir: Direction | null = null;
      switch (tile) {
        case 'conveyor_up':
          dir = 'up';
          break;
        case 'conveyor_down':
          dir = 'down';
          break;
        case 'conveyor_left':
          dir = 'left';
          break;
        case 'conveyor_right':
          dir = 'right';
          break;
      }
      if (!dir) continue;

      // Filter out self and own buddy from player positions
      const otherPlayerPositions = playerPositions.filter(
        (sp) => sp.id !== player.id && sp.buddyOwnerId !== player.id,
      );

      const newPos = player.isBuddy
        ? this.collisionSystem.canBuddyMoveTo(player.position.x, player.position.y, dir)
        : this.collisionSystem.canMoveTo(
            player.position.x,
            player.position.y,
            dir,
            bombPositions,
            otherPlayerPositions,
          );

      if (newPos) {
        player.position = newPos;
        player.direction = dir;
        player.applyMoveCooldown();
        this.applyTeleporter(player);
      }
    }

    // Push bombs on conveyor tiles
    const bombPosSet = new Set<string>();
    for (const b of this.bombs.values()) bombPosSet.add(`${b.position.x},${b.position.y}`);
    const playerPosSet = new Set<string>();
    for (const p of this.players.values()) {
      if (p.alive) playerPosSet.add(`${p.position.x},${p.position.y}`);
    }

    for (const bomb of this.bombs.values()) {
      const tile = this.collisionSystem.getTileAt(bomb.position.x, bomb.position.y);
      let convDir: Direction | null = null;
      switch (tile) {
        case 'conveyor_up':
          convDir = 'up';
          break;
        case 'conveyor_down':
          convDir = 'down';
          break;
        case 'conveyor_left':
          convDir = 'left';
          break;
        case 'conveyor_right':
          convDir = 'right';
          break;
      }
      if (!convDir) continue;

      // Stop kick-sliding — conveyor takes over at player-like speed
      if (bomb.sliding) {
        bomb.sliding = null;
      }

      // Push bombs with cooldown (same rate as players)
      if (bomb.conveyorCooldown > 0) {
        bomb.conveyorCooldown--;
        continue;
      }

      const dx = convDir === 'left' ? -1 : convDir === 'right' ? 1 : 0;
      const dy = convDir === 'up' ? -1 : convDir === 'down' ? 1 : 0;
      const nextX = bomb.position.x + dx;
      const nextY = bomb.position.y + dy;
      const nextKey = `${nextX},${nextY}`;

      const blocked =
        !this.collisionSystem.isWalkable(nextX, nextY) ||
        bombPosSet.has(nextKey) ||
        playerPosSet.has(nextKey) ||
        (this.campaignEnemyPositions !== null && this.campaignEnemyPositions.has(nextKey));

      if (!blocked) {
        bombPosSet.delete(`${bomb.position.x},${bomb.position.y}`);
        bomb.position = { x: nextX, y: nextY };
        bombPosSet.add(nextKey);
        bomb.conveyorCooldown = MOVE_COOLDOWN_BASE;
      }
    }
  }

  private detonateBomb(bomb: Bomb, tileSnapshot?: TileType[][]): void {
    this.bombs.delete(bomb.id);

    // Return bomb count to player
    const owner = this.players.get(bomb.ownerId);
    if (owner) {
      owner.bombCount = Math.max(0, owner.bombCount - 1);
    }
    this.gameLogger?.logBomb(
      'detonate',
      bomb.ownerId,
      owner?.username || '?',
      bomb.position,
      bomb.fireRange,
    );

    // Calculate explosion cells (pass pierce flag)
    // Use tile snapshot if provided to prevent chain reactions blasting through already-destroyed walls
    const tilesForCalc = tileSnapshot || this.map.tiles;
    const cells = getExplosionCells(
      bomb.position.x,
      bomb.position.y,
      bomb.fireRange,
      this.map.width,
      this.map.height,
      tilesForCalc,
      bomb.isPierce,
    );

    // Create explosion with only non-wall cells — blast stops at walls and destroys them,
    // but fire doesn't linger on those tiles (prevents walk-into-destroyed-wall kills)
    const damageCells = cells.filter((c) => {
      const tile = tilesForCalc[c.y][c.x];
      return tile !== 'destructible' && tile !== 'destructible_cracked';
    });
    const explosion = new Explosion(damageCells, bomb.ownerId);
    this.explosions.set(explosion.id, explosion);
    this.tickEvents.explosions.push({ cells: [...damageCells], ownerId: bomb.ownerId });

    // Destroy walls and possibly spawn power-ups
    let destroyedWalls = 0;
    for (const cell of cells) {
      if (this.destroyTileTracked(cell.x, cell.y)) {
        destroyedWalls++;
        const posKey = `${cell.x},${cell.y}`;
        if (
          !this.reservedPowerUpTiles.has(posKey) &&
          this.enabledPowerUps.length > 0 &&
          this.rng.next() < this.powerUpDropRate
        ) {
          const type = this.getRandomEnabledPowerUp();
          const powerUp = new PowerUp(cell, type);
          this.powerUps.set(powerUp.id, powerUp);
        }
      }
    }

    // Chain reaction: detonate other bombs caught in explosion
    // In FIFO mode, skip chain-detonating other remote bombs from the same player
    const fifoOwner =
      owner && owner.remoteDetonateMode === 'fifo' && bomb.bombType === 'remote' ? owner.id : -1;
    const cellSet = new Set(cells.map((c: { x: number; y: number }) => `${c.x},${c.y}`));
    const chainingBombs: Bomb[] = [];
    for (const otherBomb of this.bombs.values()) {
      if (cellSet.has(`${otherBomb.position.x},${otherBomb.position.y}`)) {
        // Don't chain-detonate own remote bombs in FIFO mode
        if (otherBomb.ownerId === fifoOwner && otherBomb.bombType === 'remote') continue;
        chainingBombs.push(otherBomb);
      }
    }

    this.gameLogger?.logExplosionDetail(
      bomb.ownerId,
      owner?.username || '?',
      bomb.position,
      cells,
      destroyedWalls,
      chainingBombs.length,
    );

    for (const chainBomb of chainingBombs) {
      this.detonateBomb(chainBomb, tileSnapshot);
    }
  }

  private getRandomEnabledPowerUp(): PowerUpType {
    return this.enabledPowerUps[Math.floor(this.rng.next() * this.enabledPowerUps.length)];
  }

  /** Pick a random valid position for the KOTH hill zone, away from current zone */
  private pickNewHillZone(): { x: number; y: number; width: number; height: number } | null {
    const candidates: Position[] = [];
    const curCenterX = this.hillZone!.x + Math.floor(KOTH_ZONE_SIZE / 2);
    const curCenterY = this.hillZone!.y + Math.floor(KOTH_ZONE_SIZE / 2);
    // Find valid positions: zone fits in map, avoids borders by 2 tiles, no indestructible walls in zone
    for (let y = 2; y <= this.map.height - KOTH_ZONE_SIZE - 2; y++) {
      for (let x = 2; x <= this.map.width - KOTH_ZONE_SIZE - 2; x++) {
        const centerX = x + Math.floor(KOTH_ZONE_SIZE / 2);
        const centerY = y + Math.floor(KOTH_ZONE_SIZE / 2);
        // Must be at least 4 tiles from current center
        const dist = Math.abs(centerX - curCenterX) + Math.abs(centerY - curCenterY);
        if (dist < 4) continue;
        // Check no indestructible walls in the zone area
        let hasWall = false;
        for (let dy = 0; dy < KOTH_ZONE_SIZE && !hasWall; dy++) {
          for (let dx = 0; dx < KOTH_ZONE_SIZE && !hasWall; dx++) {
            if (this.map.tiles[y + dy][x + dx] === 'wall') hasWall = true;
          }
        }
        if (!hasWall) candidates.push({ x, y });
      }
    }
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.floor(this.rng.next() * candidates.length)];
    return { x: chosen.x, y: chosen.y, width: KOTH_ZONE_SIZE, height: KOTH_ZONE_SIZE };
  }

  /** Drop one random collected power-up at the player's death position */
  private dropPowerUpOnDeath(player: Player): void {
    const droppable: PowerUpType[] = [];
    for (let i = 0; i < player.maxBombs - 1; i++) droppable.push('bomb_up');
    for (let i = 0; i < player.fireRange - 1; i++) droppable.push('fire_up');
    for (let i = 0; i < player.speed - 1; i++) droppable.push('speed_up');
    if (player.hasKick) droppable.push('kick');
    if (player.hasPierceBomb) droppable.push('pierce_bomb');
    if (player.hasRemoteBomb) droppable.push('remote_bomb');
    if (player.hasLineBomb) droppable.push('line_bomb');
    if (droppable.length > 0) {
      const type = droppable[Math.floor(this.rng.next() * droppable.length)];
      const powerUp = new PowerUp(player.position, type);
      this.powerUps.set(powerUp.id, powerUp);
    }
  }

  private checkWinCondition(): void {
    // Campaign mode handles its own win conditions in CampaignGame
    if (this.gameMode === 'campaign') return;

    const alivePlayers = this.getAlivePlayers();

    // Deathmatch: check kill target
    if (this.gameMode === 'deathmatch') {
      for (const player of this.players.values()) {
        if (player.kills >= DEATHMATCH_KILL_TARGET) {
          this.winnerId = player.id;
          player.placement = 1;
          this.finishTick = this.tick;
          this.finishReason = `${player.username} reached ${DEATHMATCH_KILL_TARGET} kills!`;
          return;
        }
      }
      // Deathmatch never ends on last-alive condition, only on time or kill target
      return;
    }

    if (this.gameMode === 'teams') {
      const aliveTeams = new Set(alivePlayers.map((p) => p.team));
      if (aliveTeams.size <= 1 && alivePlayers.length > 0) {
        this.finishTick = this.tick;
        this.winnerTeam = alivePlayers[0].team;
        const teamName = alivePlayers[0].team === 0 ? 'Red' : 'Blue';
        this.finishReason = `Team ${teamName} wins!`;
      } else if (alivePlayers.length === 0) {
        this.finishTick = this.tick;
        this.finishReason = 'Draw — no survivors!';
      }
    } else {
      if (alivePlayers.length <= 1) {
        this.finishTick = this.tick;
        if (alivePlayers.length === 1) {
          this.winnerId = alivePlayers[0].id;
          alivePlayers[0].placement = 1;
          this.finishReason = `${alivePlayers[0].username} is the last survivor!`;
        } else {
          this.finishReason = 'Draw — no survivors!';
        }
      }
    }
  }

  getAlivePlayers(): Player[] {
    if (this._processingTick && this._alivePlayersCache) {
      return this._alivePlayersCache;
    }
    this._alivePlayersCache = Array.from(this.players.values()).filter((p) => p.alive);
    return this._alivePlayersCache;
  }

  /** Invalidate alive players cache (call after any death/respawn) */
  private invalidateAliveCache(): void {
    this._alivePlayersCache = null;
  }

  /** Kill a player externally (e.g. disconnect timeout). Handles placement and logging. */
  killPlayer(playerId: number, killerId: number | null, cause: KillCause = 'disconnect'): void {
    const player = this.players.get(playerId);
    if (!player?.alive) return;

    player.die();
    this.invalidateAliveCache();
    this.placementCounter--;
    player.placement = this.getAlivePlayers().length + 1;
    this.tickEvents.playerDied.push({ playerId, killerId, cause });
    this.dropPowerUpOnDeath(player);
    this.gameLogger?.logKill(
      killerId ?? playerId,
      killerId ? (this.players.get(killerId)?.username ?? '') : player.username,
      playerId,
      player.username,
      killerId === null || killerId === playerId,
    );
  }

  /** Full state including map tiles — used for game:start, replays, and simulations */
  toState(): GameStateType {
    return {
      tick: this.tick,
      players: mapToArray(this.players, (p) => p.toState()),
      bombs: mapToArray(this.bombs, (b) => b.toState()),
      explosions: mapToArray(this.explosions, (e) => e.toState()),
      powerUps: mapToArray(this.powerUps, (p) => p.toState()),
      map: {
        width: this.map.width,
        height: this.map.height,
        tiles: this.map.tiles,
        spawnPoints: this.map.spawnPoints,
        seed: this.map.seed,
      },
      zone: this.zone?.toState(),
      hillZone: this.hillZone
        ? {
            ...this.hillZone,
            controllingPlayer: this._hillControllingPlayerId,
            controllingTeam: null,
          }
        : undefined,
      pendingHillZone: this.pendingHillZone
        ? {
            ...this.pendingHillZone,
            controllingPlayer: null,
            controllingTeam: null,
          }
        : undefined,
      kothScores: this.hillZone ? Object.fromEntries(this.kothScores) : undefined,
      mapEvents: this.getSerializedMapEvents(),
      status: this.status,
      winnerId: this.winnerId,
      winnerTeam: this.winnerTeam,
      roundTime: this.roundTime,
      timeElapsed: this.tick / TICK_RATE,
    };
  }

  /** Delta state for per-tick broadcasts — omits full tile grid, sends only tile diffs */
  toTickState(): GameStateType {
    const tileDiffs = this._dirtyTiles.size > 0 ? Array.from(this._dirtyTiles.values()) : undefined;
    this._dirtyTiles.clear();

    return {
      tick: this.tick,
      players: mapToArray(this.players, (p) => p.toState()),
      bombs: mapToArray(this.bombs, (b) => b.toState()),
      explosions: mapToArray(this.explosions, (e) => e.toState()),
      powerUps: mapToArray(this.powerUps, (p) => p.toState()),
      map: {
        width: this.map.width,
        height: this.map.height,
        tiles: [], // Empty — client uses stored map from game:start
        spawnPoints: this.map.spawnPoints,
        seed: this.map.seed,
      },
      tileDiffs,
      zone: this.zone?.toState(),
      hillZone: this.hillZone
        ? {
            ...this.hillZone,
            controllingPlayer: this._hillControllingPlayerId,
            controllingTeam: null,
          }
        : undefined,
      pendingHillZone: this.pendingHillZone
        ? {
            ...this.pendingHillZone,
            controllingPlayer: null,
            controllingTeam: null,
          }
        : undefined,
      kothScores: this.hillZone ? Object.fromEntries(this.kothScores) : undefined,
      mapEvents: this.getSerializedMapEvents(),
      status: this.status,
      winnerId: this.winnerId,
      winnerTeam: this.winnerTeam,
      roundTime: this.roundTime,
      timeElapsed: this.tick / TICK_RATE,
    };
  }
}
