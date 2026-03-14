import { GameState as GameStateType, TileType, Direction, PlayerInput, Position, PowerUpType } from '@blast-arena/shared';
import { getExplosionCells } from '@blast-arena/shared';
import { DEFAULT_WALL_DENSITY, DEFAULT_POWERUP_DROP_RATE, TICK_RATE } from '@blast-arena/shared';
import { Player } from './Player';
import { Bomb } from './Bomb';
import { Explosion } from './Explosion';
import { PowerUp } from './PowerUp';
import { CollisionSystem } from './CollisionSystem';
import { BattleRoyaleZone } from './BattleRoyale';
import { generateMap } from './Map';
import { InputBuffer } from './InputBuffer';
import { BotAI } from './BotAI';

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

  private rng: SeededRandom;
  private gameMode: string;
  private placementCounter: number = 0;
  private enabledPowerUps: PowerUpType[];
  private powerUpDropRate: number;
  private friendlyFire: boolean;
  private botAIs: Map<number, BotAI> = new Map();

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
    friendlyFire: boolean = true
  ) {
    this.map = generateMap(mapWidth, mapHeight, mapSeed, wallDensity);
    this.collisionSystem = new CollisionSystem(this.map.tiles, this.map.width, this.map.height);
    this.rng = new SeededRandom(this.map.seed + 1);
    this.gameMode = gameMode;
    this.roundTime = roundTime;
    this.enabledPowerUps = enabledPowerUps ?? ['bomb_up', 'fire_up', 'speed_up', 'shield', 'kick'];
    this.powerUpDropRate = powerUpDropRate;
    this.friendlyFire = friendlyFire;

    if (hasZone) {
      this.zone = new BattleRoyaleZone(mapWidth, mapHeight);
    }
  }

  addPlayer(id: number, username: string, displayName: string, team: number | null = null, isBot: boolean = false): Player {
    const spawnIndex = this.players.size % this.map.spawnPoints.length;
    const spawnPos = this.map.spawnPoints[spawnIndex];
    const player = new Player(id, username, displayName, spawnPos, team, isBot);
    this.players.set(id, player);
    this.placementCounter++;
    if (isBot) {
      this.botAIs.set(id, new BotAI());
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

    // 0. Generate bot inputs
    for (const [botId, ai] of this.botAIs) {
      const botPlayer = this.players.get(botId);
      if (botPlayer && botPlayer.alive) {
        const input = ai.generateInput(botPlayer, this);
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
    for (const bomb of bombsToDetonate) {
      this.detonateBomb(bomb);
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
        if (explosion.containsCell(player.position.x, player.position.y)) {
          const owner = this.players.get(explosion.ownerId);

          // Friendly fire check: skip damage if FF is off and same team (but self-damage always applies)
          if (!this.friendlyFire && owner && owner.id !== player.id &&
              player.team !== null && owner.team === player.team) {
            continue;
          }

          if (player.hasShield) {
            player.hasShield = false;
            player.shieldTicksRemaining = 0;
          } else {
            player.die();
            this.placementCounter--;
            player.placement = this.getAlivePlayers().length + 1;

            // Credit kill
            if (owner && owner.id !== player.id) {
              owner.kills++;
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
          player.applyPowerUp(powerUp.type);
          this.powerUps.delete(id);
        }
      }
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
          }
        }
      }
    }

    // 8. Time limit check
    const timeElapsed = this.tick / TICK_RATE;
    if (timeElapsed >= this.roundTime && this.status === 'playing') {
      this.status = 'finished';
      const alive = this.getAlivePlayers();
      if (alive.length === 1) {
        this.winnerId = alive[0].id;
        alive[0].placement = 1;
      }
    }

    // 9. Check win condition
    this.checkWinCondition();
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
            break;
          }
        }
      }
    }

    // Bomb placement
    if (input.action === 'bomb' && player.canPlaceBomb()) {
      // Check if there's already a bomb at this position
      const hasBomb = Array.from(this.bombs.values()).some(
        b => b.position.x === player.position.x && b.position.y === player.position.y
      );
      if (!hasBomb) {
        const bomb = new Bomb(player.position, player.id, player.fireRange);
        this.bombs.set(bomb.id, bomb);
        player.bombCount++;
        player.bombsPlaced++;
      }
    }
  }

  private detonateBomb(bomb: Bomb): void {
    this.bombs.delete(bomb.id);

    // Return bomb count to player
    const owner = this.players.get(bomb.ownerId);
    if (owner) {
      owner.bombCount = Math.max(0, owner.bombCount - 1);
    }

    // Calculate explosion cells
    const cells = getExplosionCells(
      bomb.position.x, bomb.position.y, bomb.fireRange,
      this.map.width, this.map.height, this.map.tiles
    );

    // Create explosion
    const explosion = new Explosion(cells, bomb.ownerId);
    this.explosions.set(explosion.id, explosion);

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
      this.detonateBomb(chainBomb);
    }
  }

  private getRandomEnabledPowerUp(): PowerUpType {
    return this.enabledPowerUps[Math.floor(this.rng.next() * this.enabledPowerUps.length)];
  }

  private checkWinCondition(): void {
    const alivePlayers = this.getAlivePlayers();

    if (this.gameMode === 'teams') {
      const aliveTeams = new Set(alivePlayers.map(p => p.team));
      if (aliveTeams.size <= 1 && alivePlayers.length > 0) {
        this.status = 'finished';
        this.winnerTeam = alivePlayers[0].team;
      } else if (alivePlayers.length === 0) {
        this.status = 'finished';
      }
    } else {
      if (alivePlayers.length <= 1) {
        this.status = 'finished';
        if (alivePlayers.length === 1) {
          this.winnerId = alivePlayers[0].id;
          alivePlayers[0].placement = 1;
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
      status: this.status,
      winnerId: this.winnerId,
      winnerTeam: this.winnerTeam,
      roundTime: this.roundTime,
      timeElapsed: this.tick / TICK_RATE,
    };
  }
}
