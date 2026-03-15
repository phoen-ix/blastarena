import { GameState as GameStateType, TileType, Direction, PlayerInput, Position, PowerUpType, HillZone, MapEvent } from '@blast-arena/shared';
import { getExplosionCells } from '@blast-arena/shared';
import { DEFAULT_WALL_DENSITY, DEFAULT_POWERUP_DROP_RATE, TICK_RATE } from '@blast-arena/shared';
import { DEATHMATCH_RESPAWN_TICKS, DEATHMATCH_KILL_TARGET, KOTH_ZONE_SIZE, KOTH_SCORE_TARGET, KOTH_POINTS_PER_TICK } from '@blast-arena/shared';
import { Player } from './Player';
import { Bomb, BombType } from './Bomb';
import { Explosion } from './Explosion';
import { PowerUp } from './PowerUp';
import { CollisionSystem } from './CollisionSystem';
import { BattleRoyaleZone } from './BattleRoyale';
import { generateMap } from './Map';
import { InputBuffer } from './InputBuffer';
import { BotAI } from './BotAI';
import { GameLogger } from '../utils/gameLogger';

// Simple seeded random for power-up drops
class SeededRandom {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0xffffffff;
    return (this.seed >>> 0) / 0xffffffff;
  }
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

  // KOTH properties
  public hillZone: { x: number; y: number; width: number; height: number } | null = null;
  public kothScores: Map<number, number> = new Map();

  private rng: SeededRandom;
  private gameMode: string;
  private placementCounter: number = 0;
  private enabledPowerUps: PowerUpType[];
  private powerUpDropRate: number;
  private friendlyFire: boolean;
  private botDifficulty: 'easy' | 'normal' | 'hard';
  private botAIs: Map<number, BotAI> = new Map();
  private finishTick: number | null = null;
  public finishReason: string = '';
  public gameLogger: GameLogger | null = null;
  public reinforcedWalls: boolean;
  public enableMapEvents: boolean;
  private static readonly FINISH_DELAY_TICKS = 30; // 1.5s grace period to show final explosions

  // Per-tick event buffers for discrete event emission
  public tickEvents: {
    explosions: { cells: { x: number; y: number }[]; ownerId: number }[];
    playerDied: { playerId: number; killerId: number | null }[];
    powerupCollected: { playerId: number; type: string; position: { x: number; y: number } }[];
  } = { explosions: [], playerDied: [], powerupCollected: [] };

  // Map events (dynamic)
  private mapEvents: { type: string; position?: Position; tick: number; warningTick?: number }[] = [];
  private nextMeteorTick: number = 0;
  private nextPowerupRainTick: number = 0;

  constructor(
    mapWidth: number,
    mapHeight: number,
    mapSeed?: number,
    gameMode: string = 'ffa',
    hasZone: boolean = false,
    roundTime: number = 180,
    wallDensity: number = DEFAULT_WALL_DENSITY,
    enabledPowerUps?: PowerUpType[],
    powerUpDropRate: number = DEFAULT_POWERUP_DROP_RATE,
    friendlyFire: boolean = true,
    botDifficulty: 'easy' | 'normal' | 'hard' = 'normal',
    reinforcedWalls: boolean = false,
    enableMapEvents: boolean = false
  ) {
    this.map = generateMap(mapWidth, mapHeight, mapSeed, wallDensity);
    this.collisionSystem = new CollisionSystem(this.map.tiles, this.map.width, this.map.height, reinforcedWalls);
    this.rng = new SeededRandom(this.map.seed + 1);
    this.gameMode = gameMode;
    this.roundTime = roundTime;
    this.enabledPowerUps = enabledPowerUps ?? ['bomb_up', 'fire_up', 'speed_up', 'shield', 'kick'];
    this.powerUpDropRate = powerUpDropRate;
    this.friendlyFire = friendlyFire;
    this.botDifficulty = botDifficulty;
    this.reinforcedWalls = reinforcedWalls;
    this.enableMapEvents = enableMapEvents;

    if (hasZone) {
      this.zone = new BattleRoyaleZone(mapWidth, mapHeight);
    }

    // KOTH: initialize hill zone
    if (gameMode === 'king_of_the_hill') {
      const hx = Math.floor(mapWidth / 2) - Math.floor(KOTH_ZONE_SIZE / 2);
      const hy = Math.floor(mapHeight / 2) - Math.floor(KOTH_ZONE_SIZE / 2);
      this.hillZone = { x: hx, y: hy, width: KOTH_ZONE_SIZE, height: KOTH_ZONE_SIZE };
    }
  }

  addPlayer(id: number, username: string, displayName: string, team: number | null = null, isBot: boolean = false): Player {
    const spawnIndex = this.players.size % this.map.spawnPoints.length;
    const spawnPos = this.map.spawnPoints[spawnIndex];
    const player = new Player(id, username, displayName, spawnPos, team, isBot);
    this.players.set(id, player);
    this.placementCounter++;
    if (isBot) {
      this.botAIs.set(id, new BotAI(this.botDifficulty));
    }
    return player;
  }

  removePlayer(id: number): void {
    this.inputBuffer.clear(id);
    this.players.delete(id);
    this.botAIs.delete(id);
  }

  processTick(): void {
    if (this.status !== 'playing') return;
    this.tick++;

    // Clear per-tick event buffers
    this.tickEvents = { explosions: [], playerDied: [], powerupCollected: [] };

    // Check if grace period has elapsed
    if (this.finishTick !== null) {
      if (this.tick >= this.finishTick + GameStateManager.FINISH_DELAY_TICKS) {
        this.status = 'finished';
        return;
      }
      // During grace period: skip player/bot input, but keep processing explosions and bombs below
    }

    const isFinishing = this.finishTick !== null;

    // Log state every 5 ticks
    if (this.gameLogger && this.tick % 5 === 0) {
      this.gameLogger.logTick(
        this.tick,
        Array.from(this.players.values()),
        Array.from(this.bombs.values()),
        Array.from(this.explosions.values()),
      );
    }

    if (!isFinishing) {
      // 0. Generate bot inputs
      for (const [botId, ai] of this.botAIs) {
        const botPlayer = this.players.get(botId);
        if (botPlayer && botPlayer.alive) {
          const input = ai.generateInput(botPlayer, this, this.gameLogger);
          if (input) {
            this.inputBuffer.addInput(botId, input);
          }
        }
      }

      // 1. Process inputs
      for (const [playerId, player] of this.players) {
        if (!player.alive) continue;

        const input = this.inputBuffer.getLatestInput(playerId);
        if (input) {
          this.processPlayerInput(player, input);
        }

        player.tick();
      }
    }

    // 2. Update bomb timers and slide kicked bombs
    const bombsToDetonate: Bomb[] = [];
    for (const bomb of this.bombs.values()) {
      // Slide kicked bombs
      if (bomb.sliding) {
        const dx = bomb.sliding === 'left' ? -1 : bomb.sliding === 'right' ? 1 : 0;
        const dy = bomb.sliding === 'up' ? -1 : bomb.sliding === 'down' ? 1 : 0;
        const nextX = bomb.position.x + dx;
        const nextY = bomb.position.y + dy;

        // Stop if hitting a wall, another bomb, or a player
        const blocked = !this.collisionSystem.isWalkable(nextX, nextY)
          || Array.from(this.bombs.values()).some(b => b.id !== bomb.id && b.position.x === nextX && b.position.y === nextY)
          || Array.from(this.players.values()).some(p => p.alive && p.position.x === nextX && p.position.y === nextY);

        if (blocked) {
          bomb.sliding = null;
        } else {
          bomb.position = { x: nextX, y: nextY };
        }
      }

      if (bomb.tick()) {
        bombsToDetonate.push(bomb);
      }
    }

    // 3. Process detonations (including chain reactions)
    // Snapshot tiles before detonations so chain reactions use original wall layout
    const tileSnapshot = this.map.tiles.map(row => [...row]);
    for (const bomb of bombsToDetonate) {
      this.detonateBomb(bomb, tileSnapshot);
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

      for (const explosion of this.explosions.values()) {
        // Skip damage during fade-out phase (last 3 ticks) — explosion is visually fading
        if (explosion.ticksRemaining <= 3) continue;
        if (explosion.containsCell(player.position.x, player.position.y)) {
          const owner = this.players.get(explosion.ownerId);

          // Friendly fire check: skip damage if FF is off and same team (but self-damage always applies)
          if (!this.friendlyFire && owner && owner.id !== player.id &&
              player.team !== null && owner.team === player.team) {
            continue;
          }

          if (player.hasShield) {
            player.hasShield = false;
            // Brief invulnerability so the same multi-tick explosion
            // doesn't kill the now-unshielded player next tick
            player.invulnerableTicks = 10;
          } else {
            player.die();
            this.placementCounter--;
            player.placement = this.getAlivePlayers().length + 1;

            // Credit kill or track self-kill (self-kills subtract 1 from score)
            if (owner && owner.id !== player.id) {
              owner.kills++;
              this.gameLogger?.logKill(owner.id, owner.displayName, player.id, player.displayName, false);
              this.tickEvents.playerDied.push({ playerId: player.id, killerId: owner.id });
            } else if (owner && owner.id === player.id) {
              owner.selfKills++;
              owner.kills--;
              this.gameLogger?.logKill(owner.id, owner.displayName, player.id, player.displayName, true);
              this.tickEvents.playerDied.push({ playerId: player.id, killerId: owner.id });
            } else {
              this.tickEvents.playerDied.push({ playerId: player.id, killerId: null });
            }
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
          player.applyPowerUp(powerUp.type);
          this.powerUps.delete(id);
        }
      }
    }

    // 6.5 King of the Hill scoring
    if (this.hillZone && this.finishTick === null) {
      const playersInZone = this.getAlivePlayers().filter(p =>
        p.position.x >= this.hillZone!.x && p.position.x < this.hillZone!.x + this.hillZone!.width &&
        p.position.y >= this.hillZone!.y && p.position.y < this.hillZone!.y + this.hillZone!.height
      );

      // Score only if exactly one player (or one team) controls the zone
      if (playersInZone.length === 1) {
        const controllerId = playersInZone[0].id;
        const current = this.kothScores.get(controllerId) || 0;
        this.kothScores.set(controllerId, current + KOTH_POINTS_PER_TICK);

        if (current + KOTH_POINTS_PER_TICK >= KOTH_SCORE_TARGET) {
          this.winnerId = controllerId;
          playersInZone[0].placement = 1;
          this.finishTick = this.tick;
          this.finishReason = `${playersInZone[0].displayName} controls the hill!`;
        }
      }
    }

    // 6.7 Dynamic map events
    if (this.enableMapEvents && this.finishTick === null) {
      const currentTime = this.tick / TICK_RATE;

      // Meteor strike every 30-45 seconds
      if (this.tick >= this.nextMeteorTick) {
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
        }
        this.nextMeteorTick = this.tick + Math.floor((30 + this.rng.next() * 15) * TICK_RATE);
      }

      // Power-up rain every 60 seconds
      if (this.tick >= this.nextPowerupRainTick) {
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
        this.nextPowerupRainTick = this.tick + 60 * TICK_RATE;
      }

      // Process pending meteor impacts
      for (let i = this.mapEvents.length - 1; i >= 0; i--) {
        const event = this.mapEvents[i];
        if (event.type === 'meteor' && event.position && this.tick >= event.tick) {
          // Create explosion at meteor position
          const cells = getExplosionCells(event.position.x, event.position.y, 2, this.map.width, this.map.height, this.map.tiles);
          const explosion = new Explosion(cells, -999); // System-owned
          this.explosions.set(explosion.id, explosion);
          // Destroy walls
          for (const cell of cells) {
            this.collisionSystem.destroyTile(cell.x, cell.y);
          }
          this.mapEvents.splice(i, 1);
        }
      }

      // Clean old events
      this.mapEvents = this.mapEvents.filter(e => this.tick - e.tick < 200);
    }

    // 7. Update Battle Royale zone
    if (this.zone) {
      this.zone.tick(this.tick);

      // Zone damage
      for (const player of this.players.values()) {
        if (!player.alive) continue;
        if (!this.zone.isInsideZone(player.position.x, player.position.y)) {
          if (player.hasShield) {
            player.hasShield = false;
          } else {
            player.die();
            this.placementCounter--;
            player.placement = this.getAlivePlayers().length + 1;
            this.tickEvents.playerDied.push({ playerId: player.id, killerId: null });
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
        }
      }
    }

    // 8. Time limit check
    if (this.finishTick === null) {
      const timeElapsed = this.tick / TICK_RATE;
      if (timeElapsed >= this.roundTime && this.status === 'playing') {
        const alive = this.getAlivePlayers();
        if (alive.length === 1) {
          this.winnerId = alive[0].id;
          alive[0].placement = 1;
        }
        this.finishTick = this.tick;
        this.finishReason = 'Time\'s up!';
      }
    }

    // 9. Check win condition
    if (this.finishTick === null) {
      this.checkWinCondition();
    }
  }

  private processPlayerInput(player: Player, input: PlayerInput): void {
    // Movement (with cooldown)
    if (input.direction && player.canMove()) {
      player.direction = input.direction;
      const bombPositions = Array.from(this.bombs.values()).map(b => b.position);

      // Collect other player positions for collision
      const otherPlayerPositions: { x: number; y: number }[] = [];
      for (const other of this.players.values()) {
        if (other.id !== player.id && other.alive) {
          otherPlayerPositions.push(other.position);
        }
      }

      const newPos = this.collisionSystem.canMoveTo(
        player.position.x, player.position.y, input.direction, bombPositions, otherPlayerPositions
      );
      if (newPos) {
        player.position = newPos;
        player.applyMoveCooldown();
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
      const tileSnapshot = this.map.tiles.map(row => [...row]);
      for (const bomb of remoteBombs) {
        this.detonateBomb(bomb, tileSnapshot);
      }
    }

    // Bomb placement
    if (input.action === 'bomb' && player.canPlaceBomb()) {
      // Determine bomb type
      const bombType: BombType = player.hasRemoteBomb ? 'remote'
        : player.hasPierceBomb ? 'pierce'
        : 'normal';

      if (player.hasLineBomb) {
        // Line bomb: place bombs in the player's facing direction on consecutive empty tiles
        const dir = player.direction;
        const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
        const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;

        // First, place a bomb at current position if possible
        const hasBombAtCurrent = Array.from(this.bombs.values()).some(
          b => b.position.x === player.position.x && b.position.y === player.position.y
        );
        if (!hasBombAtCurrent) {
          const bomb = new Bomb(player.position, player.id, player.fireRange, bombType);
          this.bombs.set(bomb.id, bomb);
          player.bombCount++;
          player.bombsPlaced++;
          this.gameLogger?.logBomb('place', player.id, player.displayName, player.position, player.fireRange);
        }

        // Then place bombs in the facing direction
        let cx = player.position.x + dx;
        let cy = player.position.y + dy;
        while (player.canPlaceBomb()) {
          // Check if the tile is walkable, has no bomb, and has no player
          if (!this.collisionSystem.isWalkable(cx, cy)) break;
          const hasBomb = Array.from(this.bombs.values()).some(
            b => b.position.x === cx && b.position.y === cy
          );
          if (hasBomb) break;
          const hasPlayer = Array.from(this.players.values()).some(
            p => p.alive && p.position.x === cx && p.position.y === cy
          );
          if (hasPlayer) break;

          const pos: Position = { x: cx, y: cy };
          const bomb = new Bomb(pos, player.id, player.fireRange, bombType);
          this.bombs.set(bomb.id, bomb);
          player.bombCount++;
          player.bombsPlaced++;
          this.gameLogger?.logBomb('place', player.id, player.displayName, pos, player.fireRange);

          cx += dx;
          cy += dy;
        }
      } else {
        // Normal single bomb placement
        // Check if there's already a bomb at this position
        const hasBomb = Array.from(this.bombs.values()).some(
          b => b.position.x === player.position.x && b.position.y === player.position.y
        );
        if (!hasBomb) {
          const bomb = new Bomb(player.position, player.id, player.fireRange, bombType);
          this.bombs.set(bomb.id, bomb);
          player.bombCount++;
          player.bombsPlaced++;
          this.gameLogger?.logBomb('place', player.id, player.displayName, player.position, player.fireRange);
        }
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
    this.gameLogger?.logBomb('detonate', bomb.ownerId, owner?.displayName || '?', bomb.position, bomb.fireRange);

    // Calculate explosion cells (pass pierce flag)
    // Use tile snapshot if provided to prevent chain reactions blasting through already-destroyed walls
    const cells = getExplosionCells(
      bomb.position.x, bomb.position.y, bomb.fireRange,
      this.map.width, this.map.height, tileSnapshot || this.map.tiles,
      bomb.isPierce
    );

    // Create explosion
    const explosion = new Explosion(cells, bomb.ownerId);
    this.explosions.set(explosion.id, explosion);
    this.tickEvents.explosions.push({ cells: [...cells], ownerId: bomb.ownerId });

    // Destroy walls and possibly spawn power-ups
    for (const cell of cells) {
      if (this.collisionSystem.destroyTile(cell.x, cell.y)) {
        if (this.enabledPowerUps.length > 0 && this.rng.next() < this.powerUpDropRate) {
          const type = this.getRandomEnabledPowerUp();
          const powerUp = new PowerUp(cell, type);
          this.powerUps.set(powerUp.id, powerUp);
        }
      }
    }

    // Chain reaction: detonate other bombs caught in explosion
    const chainingBombs: Bomb[] = [];
    for (const otherBomb of this.bombs.values()) {
      if (cells.some((c: { x: number; y: number }) => c.x === otherBomb.position.x && c.y === otherBomb.position.y)) {
        chainingBombs.push(otherBomb);
      }
    }
    for (const chainBomb of chainingBombs) {
      this.detonateBomb(chainBomb, tileSnapshot);
    }
  }

  private getRandomEnabledPowerUp(): PowerUpType {
    return this.enabledPowerUps[Math.floor(this.rng.next() * this.enabledPowerUps.length)];
  }

  private checkWinCondition(): void {
    const alivePlayers = this.getAlivePlayers();

    // Deathmatch: check kill target
    if (this.gameMode === 'deathmatch') {
      for (const player of this.players.values()) {
        if (player.kills >= DEATHMATCH_KILL_TARGET) {
          this.winnerId = player.id;
          player.placement = 1;
          this.finishTick = this.tick;
          this.finishReason = `${player.displayName} reached ${DEATHMATCH_KILL_TARGET} kills!`;
          return;
        }
      }
      // Deathmatch never ends on last-alive condition, only on time or kill target
      return;
    }

    if (this.gameMode === 'teams') {
      const aliveTeams = new Set(alivePlayers.map(p => p.team));
      if (aliveTeams.size <= 1 && alivePlayers.length > 0) {
        this.finishTick = this.tick;
        this.winnerTeam = alivePlayers[0].team;
        this.finishReason = `Team ${alivePlayers[0].team} wins!`;
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
          this.finishReason = `${alivePlayers[0].displayName} is the last survivor!`;
        } else {
          this.finishReason = 'Draw — no survivors!';
        }
      }
    }
  }

  getAlivePlayers(): Player[] {
    return Array.from(this.players.values()).filter(p => p.alive);
  }

  toState(): GameStateType {
    return {
      tick: this.tick,
      players: Array.from(this.players.values()).map(p => p.toState()),
      bombs: Array.from(this.bombs.values()).map(b => b.toState()),
      explosions: Array.from(this.explosions.values()).map(e => e.toState()),
      powerUps: Array.from(this.powerUps.values()).map(p => p.toState()),
      map: {
        width: this.map.width,
        height: this.map.height,
        tiles: this.map.tiles,
        spawnPoints: this.map.spawnPoints,
        seed: this.map.seed,
      },
      zone: this.zone?.toState(),
      hillZone: this.hillZone ? {
        ...this.hillZone,
        controllingPlayer: (() => {
          const playersInZone = this.getAlivePlayers().filter(p =>
            p.position.x >= this.hillZone!.x && p.position.x < this.hillZone!.x + this.hillZone!.width &&
            p.position.y >= this.hillZone!.y && p.position.y < this.hillZone!.y + this.hillZone!.height
          );
          return playersInZone.length === 1 ? playersInZone[0].id : null;
        })(),
        controllingTeam: null,
      } : undefined,
      kothScores: this.hillZone ? Object.fromEntries(this.kothScores) : undefined,
      mapEvents: this.mapEvents.length > 0 ? this.mapEvents.map(e => ({
        type: e.type as 'meteor' | 'powerup_rain',
        position: e.position,
        tick: e.tick,
        warningTick: e.warningTick,
      })) : undefined,
      status: this.status,
      winnerId: this.winnerId,
      winnerTeam: this.winnerTeam,
      roundTime: this.roundTime,
      timeElapsed: this.tick / TICK_RATE,
    };
  }
}
