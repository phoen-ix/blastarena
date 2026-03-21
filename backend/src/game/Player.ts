import { PlayerState, Position, Direction, PowerUpType, PlayerCosmeticData } from '@blast-arena/shared';
import { DEFAULT_SPEED, DEFAULT_MAX_BOMBS, DEFAULT_FIRE_RANGE, MAX_SPEED, MAX_BOMBS, MAX_FIRE_RANGE, INVULNERABILITY_TICKS, MOVE_COOLDOWN_BASE } from '@blast-arena/shared';

export class Player {
  public readonly id: number;
  public readonly username: string;
  public position: Position;
  public alive: boolean = true;
  public bombCount: number = 0;
  public maxBombs: number = DEFAULT_MAX_BOMBS;
  public fireRange: number = DEFAULT_FIRE_RANGE;
  public speed: number = DEFAULT_SPEED;
  public hasShield: boolean = false;
  public hasKick: boolean = false;
  public hasPierceBomb: boolean = false;
  public hasRemoteBomb: boolean = false;
  public hasLineBomb: boolean = false;
  public team: number | null = null;
  public direction: Direction = 'down';
  public invulnerableTicks: number = INVULNERABILITY_TICKS;
  public moveCooldown: number = 0;
  public readonly isBot: boolean;

  // Stats tracking
  public kills: number = 0;
  public deaths: number = 0;
  public selfKills: number = 0;
  public bombsPlaced: number = 0;
  public powerupsCollected: number = 0;
  public placement: number | null = null;

  // Cosmetics (set once at game start, not per-tick)
  public cosmetics?: PlayerCosmeticData;

  // Deathmatch respawn
  public respawnTick: number | null = null;

  constructor(id: number, username: string, spawnPosition: Position, team: number | null = null, isBot: boolean = false) {
    this.id = id;
    this.username = username;
    this.position = { ...spawnPosition };
    this.team = team;
    this.isBot = isBot;
  }

  applyPowerUp(type: PowerUpType): void {
    this.powerupsCollected++;
    switch (type) {
      case 'bomb_up':
        this.maxBombs = Math.min(this.maxBombs + 1, MAX_BOMBS);
        break;
      case 'fire_up':
        this.fireRange = Math.min(this.fireRange + 1, MAX_FIRE_RANGE);
        break;
      case 'speed_up':
        this.speed = Math.min(this.speed + 1, MAX_SPEED);
        break;
      case 'shield':
        if (!this.hasShield) {
          this.hasShield = true;
        }
        break;
      case 'kick':
        this.hasKick = true;
        break;
      case 'pierce_bomb':
        this.hasPierceBomb = true;
        break;
      case 'remote_bomb':
        this.hasRemoteBomb = true;
        break;
      case 'line_bomb':
        this.hasLineBomb = true;
        break;
    }
  }

  canMove(): boolean {
    return this.alive && this.moveCooldown <= 0;
  }

  applyMoveCooldown(): void {
    this.moveCooldown = Math.max(1, MOVE_COOLDOWN_BASE - (this.speed - 1));
  }

  canPlaceBomb(): boolean {
    return this.alive && this.bombCount < this.maxBombs;
  }

  die(): void {
    this.alive = false;
    this.deaths++;
  }

  /** Reset stats for deathmatch respawn (keep kills/deaths/placement) */
  respawn(position: Position): void {
    this.alive = true;
    this.position = { ...position };
    this.bombCount = 0;
    this.maxBombs = DEFAULT_MAX_BOMBS;
    this.fireRange = DEFAULT_FIRE_RANGE;
    this.speed = DEFAULT_SPEED;
    this.hasShield = false;
    this.hasKick = false;
    this.hasPierceBomb = false;
    this.hasRemoteBomb = false;
    this.hasLineBomb = false;
    this.invulnerableTicks = INVULNERABILITY_TICKS;
    this.moveCooldown = 0;
    this.respawnTick = null;
    this.direction = 'down';
  }

  tick(): void {
    if (this.invulnerableTicks > 0) {
      this.invulnerableTicks--;
    }
    if (this.moveCooldown > 0) {
      this.moveCooldown--;
    }
  }

  toState(): PlayerState {
    return {
      id: this.id,
      username: this.username,
      position: { ...this.position },
      alive: this.alive,
      bombCount: this.bombCount,
      maxBombs: this.maxBombs,
      fireRange: this.fireRange,
      speed: this.speed,
      hasShield: this.hasShield,
      hasKick: this.hasKick,
      hasPierceBomb: this.hasPierceBomb,
      hasRemoteBomb: this.hasRemoteBomb,
      hasLineBomb: this.hasLineBomb,
      team: this.team,
      direction: this.direction,
      isBot: this.isBot,
      kills: this.kills,
      deaths: this.deaths,
      cosmetics: this.cosmetics,
    };
  }
}
