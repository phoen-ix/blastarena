import {
  Position,
  Direction,
  CampaignEnemyState,
  EnemyTypeConfig,
  BossPhaseConfig,
} from '@blast-arena/shared';
import { MOVE_COOLDOWN_BASE } from '@blast-arena/shared';
import { ENEMY_ID_OFFSET } from '@blast-arena/shared';

export class Enemy {
  public readonly id: number;
  public readonly enemyTypeId: number;
  public position: Position;
  public direction: Direction = 'down';
  public hp: number;
  public readonly maxHp: number;
  public alive: boolean = true;
  public moveCooldown: number = 0;
  public movedThisTick: boolean = false;
  public bombCooldown: number = 0;

  public readonly typeConfig: EnemyTypeConfig;
  public readonly patrolPath: Position[];
  public patrolIndex: number = 0;
  public patrolForward: boolean = true;
  public currentPhase: number = 0;

  private static nextId = 0;

  constructor(
    enemyTypeId: number,
    position: Position,
    typeConfig: EnemyTypeConfig,
    patrolPath: Position[] = [],
  ) {
    this.id = ENEMY_ID_OFFSET - Enemy.nextId++;
    this.enemyTypeId = enemyTypeId;
    this.position = { ...position };
    this.typeConfig = typeConfig;
    this.hp = typeConfig.hp;
    this.maxHp = typeConfig.hp;
    this.patrolPath = patrolPath;
  }

  /**
   * Reset the shared id counter. TEST ONLY.
   *
   * CampaignGame used to call this from its constructor, which meant starting a second campaign
   * session rewound the counter for the first: a boss in the running session would then spawn
   * minions with ids already held by its live enemies, and `enemies.set(minion.id, minion)`
   * silently overwrote them — the overwritten enemy vanished mid-fight and a kill_all objective
   * could become unwinnable. The counter is now monotonic for the process lifetime.
   * (audit ENEMY-ID-1)
   */
  static resetIdCounter(): void {
    Enemy.nextId = 0;
  }

  tick(): void {
    if (this.moveCooldown > 0) this.moveCooldown--;
    if (this.bombCooldown > 0) this.bombCooldown--;
  }

  canMove(): boolean {
    return this.alive && this.moveCooldown <= 0;
  }

  applyMoveCooldown(): void {
    this.moveCooldown = Math.max(
      1,
      Math.round(MOVE_COOLDOWN_BASE / Math.max(0.01, this.typeConfig.speed)),
    );
    this.movedThisTick = true;
  }

  canPlaceBomb(): boolean {
    return (
      this.alive &&
      this.typeConfig.canBomb &&
      this.bombCooldown <= 0 &&
      this.typeConfig.bombConfig != null
    );
  }

  applyBombCooldown(): void {
    if (this.typeConfig.bombConfig) {
      this.bombCooldown = this.typeConfig.bombConfig.cooldownTicks;
    }
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) {
      this.alive = false;
      return true; // died
    }
    return false;
  }

  checkBossPhaseTransition(): BossPhaseConfig | null {
    if (!this.typeConfig.isBoss || !this.typeConfig.bossPhases) return null;

    const hpPercent = this.hp / this.maxHp;
    const phases = this.typeConfig.bossPhases;

    for (let i = phases.length - 1; i >= 0; i--) {
      if (hpPercent <= phases[i].hpThreshold && this.currentPhase <= i) {
        this.currentPhase = i + 1;
        const phase = phases[i];

        // Apply phase changes
        if (phase.speedMultiplier != null) {
          (this.typeConfig as EnemyTypeConfig).speed = Math.max(
            0.01,
            this.typeConfig.speed * phase.speedMultiplier,
          );
        }
        if (phase.movementPattern != null) {
          (this.typeConfig as EnemyTypeConfig).movementPattern = phase.movementPattern;
        }
        if (phase.canBomb != null) {
          (this.typeConfig as EnemyTypeConfig).canBomb = phase.canBomb;
        }
        if (phase.bombConfig != null) {
          (this.typeConfig as EnemyTypeConfig).bombConfig = phase.bombConfig;
        }

        return phase;
      }
    }
    return null;
  }

  toState(): CampaignEnemyState {
    return {
      id: this.id,
      enemyTypeId: this.enemyTypeId,
      position: { ...this.position },
      hp: this.hp,
      maxHp: this.maxHp,
      alive: this.alive,
      direction: this.direction,
      isBoss: this.typeConfig.isBoss,
      currentPhase: this.typeConfig.isBoss ? this.currentPhase : undefined,
    };
  }
}
