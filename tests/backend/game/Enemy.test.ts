import { describe, it, expect, beforeEach } from '@jest/globals';
import { Enemy } from '../../../backend/src/game/Enemy';
import { MOVE_COOLDOWN_BASE, ENEMY_ID_OFFSET } from '@blast-arena/shared';
import type { EnemyTypeConfig, BossPhaseConfig } from '@blast-arena/shared';

/** Minimal enemy type config for tests */
function makeConfig(overrides: Partial<EnemyTypeConfig> = {}): EnemyTypeConfig {
  return {
    speed: 1,
    movementPattern: 'random_walk',
    canPassWalls: false,
    canPassBombs: false,
    canBomb: false,
    hp: 3,
    contactDamage: true,
    sprite: {
      bodyShape: 'blob',
      primaryColor: '#ff0000',
      secondaryColor: '#880000',
      eyeStyle: 'round',
      hasTeeth: false,
      hasHorns: false,
    },
    dropChance: 0.5,
    dropTable: ['bomb_up'],
    isBoss: false,
    sizeMultiplier: 1,
    ...overrides,
  };
}

describe('Enemy', () => {
  beforeEach(() => {
    Enemy.resetIdCounter();
  });

  // ───────────────────────────────────────────────
  // 1. Construction & ID Generation
  // ───────────────────────────────────────────────
  describe('constructor', () => {
    it('should create an enemy with correct initial state', () => {
      const config = makeConfig({ hp: 5, speed: 2 });
      const enemy = new Enemy(42, { x: 3, y: 7 }, config, []);

      expect(enemy.enemyTypeId).toBe(42);
      expect(enemy.position).toEqual({ x: 3, y: 7 });
      expect(enemy.hp).toBe(5);
      expect(enemy.maxHp).toBe(5);
      expect(enemy.alive).toBe(true);
      expect(enemy.direction).toBe('down');
      expect(enemy.moveCooldown).toBe(0);
      expect(enemy.bombCooldown).toBe(0);
      expect(enemy.patrolIndex).toBe(0);
      expect(enemy.patrolForward).toBe(true);
      expect(enemy.currentPhase).toBe(0);
      expect(enemy.typeConfig).toBe(config);
    });

    // Enemy ids share a namespace with bomb ownerIds, which GameState.detonateBomb resolves
    // against `players` — keyed by real DB user id. While the offset was +1000, an account with
    // id >= 1000 would have an enemy's bomb decrement its bombCount and be blamed for the kill.
    // (audit ENEMY-ID-1)
    it('should never assign an id that could belong to a user account', () => {
      Enemy.resetIdCounter();
      for (let i = 0; i < 500; i++) {
        const e = new Enemy(1, { x: 0, y: 0 }, makeConfig());
        expect(e.id).toBeLessThan(0);
      }
    });

    it('should not collide with bot, buddy or open-world guest id ranges', () => {
      Enemy.resetIdCounter();
      for (let i = 0; i < 500; i++) {
        const e = new Enemy(1, { x: 0, y: 0 }, makeConfig());
        expect(e.id).toBeLessThan(-12000); // clear of bots (-1..-8), buddy and guests
      }
    });

    // Regression: CampaignGame reset this shared counter in its constructor, so starting a second
    // session rewound ids for the first — a boss could then spawn minions over its own live
    // enemies, silently removing them from the map. (audit ENEMY-ID-1)
    it('should keep ids unique across concurrent sessions', () => {
      Enemy.resetIdCounter();
      const sessionA = [0, 1, 2].map(() => new Enemy(1, { x: 0, y: 0 }, makeConfig()).id);
      // A second session starting up must not rewind the counter.
      const sessionB = [0, 1, 2].map(() => new Enemy(1, { x: 0, y: 0 }, makeConfig()).id);
      expect(new Set([...sessionA, ...sessionB]).size).toBe(6);
    });

    it('should assign sequential IDs with ENEMY_ID_OFFSET', () => {
      const config = makeConfig();
      const e1 = new Enemy(1, { x: 0, y: 0 }, config);
      const e2 = new Enemy(2, { x: 1, y: 1 }, config);
      const e3 = new Enemy(3, { x: 2, y: 2 }, config);

      // Enemy ids count DOWN from the (negative) offset, so they can never collide with the
      // positive id space real user accounts are allocated from. (audit ENEMY-ID-1)
      expect(e1.id).toBe(ENEMY_ID_OFFSET - 0);
      expect(e2.id).toBe(ENEMY_ID_OFFSET - 1);
      expect(e3.id).toBe(ENEMY_ID_OFFSET - 2);
    });

    it('should reset ID counter', () => {
      const config = makeConfig();
      new Enemy(1, { x: 0, y: 0 }, config);
      new Enemy(2, { x: 1, y: 1 }, config);

      Enemy.resetIdCounter();

      const e = new Enemy(3, { x: 2, y: 2 }, config);
      expect(e.id).toBe(ENEMY_ID_OFFSET - 0);
    });

    it('should deep copy the spawn position', () => {
      const pos = { x: 5, y: 10 };
      const enemy = new Enemy(1, pos, makeConfig());
      pos.x = 99;
      expect(enemy.position.x).toBe(5);
    });

    it('should store patrol path when provided', () => {
      const path = [
        { x: 1, y: 1 },
        { x: 3, y: 1 },
        { x: 3, y: 3 },
      ];
      const enemy = new Enemy(1, { x: 1, y: 1 }, makeConfig(), path);
      expect(enemy.patrolPath).toBe(path);
      expect(enemy.patrolPath.length).toBe(3);
    });

    it('should default patrol path to empty array', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      expect(enemy.patrolPath).toEqual([]);
    });
  });

  // ───────────────────────────────────────────────
  // 2. tick()
  // ───────────────────────────────────────────────
  describe('tick', () => {
    it('should decrement moveCooldown when > 0', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      enemy.moveCooldown = 5;
      enemy.tick();
      expect(enemy.moveCooldown).toBe(4);
    });

    it('should decrement bombCooldown when > 0', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      enemy.bombCooldown = 3;
      enemy.tick();
      expect(enemy.bombCooldown).toBe(2);
    });

    it('should not go below 0 for either cooldown', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      enemy.moveCooldown = 0;
      enemy.bombCooldown = 0;
      enemy.tick();
      expect(enemy.moveCooldown).toBe(0);
      expect(enemy.bombCooldown).toBe(0);
    });

    it('should decrement both cooldowns simultaneously', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      enemy.moveCooldown = 10;
      enemy.bombCooldown = 7;
      for (let i = 0; i < 5; i++) enemy.tick();
      expect(enemy.moveCooldown).toBe(5);
      expect(enemy.bombCooldown).toBe(2);
    });
  });

  // ───────────────────────────────────────────────
  // 3. canMove()
  // ───────────────────────────────────────────────
  describe('canMove', () => {
    it('should return true when alive and cooldown is 0', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      expect(enemy.canMove()).toBe(true);
    });

    it('should return false when dead', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      enemy.alive = false;
      expect(enemy.canMove()).toBe(false);
    });

    it('should return false when moveCooldown > 0', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      enemy.moveCooldown = 1;
      expect(enemy.canMove()).toBe(false);
    });

    it('should return false when both dead and on cooldown', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig());
      enemy.alive = false;
      enemy.moveCooldown = 3;
      expect(enemy.canMove()).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 4. applyMoveCooldown() — divisor formula
  // ───────────────────────────────────────────────
  describe('applyMoveCooldown', () => {
    it('should apply MOVE_COOLDOWN_BASE / speed formula for speed 1', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ speed: 1 }));
      enemy.applyMoveCooldown();
      // Math.round(5 / 1) = 5
      expect(enemy.moveCooldown).toBe(Math.round(MOVE_COOLDOWN_BASE / 1));
    });

    it('should produce shorter cooldown for higher speed', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ speed: 5 }));
      enemy.applyMoveCooldown();
      // Math.round(5 / 5) = 1
      expect(enemy.moveCooldown).toBe(1);
    });

    it('should produce longer cooldown for speed 0.1', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ speed: 0.1 }));
      enemy.applyMoveCooldown();
      // Math.round(5 / 0.1) = 50
      expect(enemy.moveCooldown).toBe(50);
    });

    it('should clamp speed to minimum 0.01 to avoid division by zero', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ speed: 0 }));
      enemy.applyMoveCooldown();
      // Math.max(0.01, 0) = 0.01 => Math.round(5 / 0.01) = 500
      expect(enemy.moveCooldown).toBe(Math.round(MOVE_COOLDOWN_BASE / 0.01));
    });

    it('should clamp negative speed to 0.01', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ speed: -5 }));
      enemy.applyMoveCooldown();
      expect(enemy.moveCooldown).toBe(Math.round(MOVE_COOLDOWN_BASE / 0.01));
    });

    it('should always produce at least 1 tick cooldown', () => {
      // Even with absurdly high speed, minimum is 1
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ speed: 9999 }));
      enemy.applyMoveCooldown();
      expect(enemy.moveCooldown).toBeGreaterThanOrEqual(1);
    });

    it('should round to nearest integer', () => {
      // speed 3 => Math.round(5/3) = Math.round(1.667) = 2
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ speed: 3 }));
      enemy.applyMoveCooldown();
      expect(enemy.moveCooldown).toBe(2);
    });
  });

  // ───────────────────────────────────────────────
  // 5. canPlaceBomb()
  // ───────────────────────────────────────────────
  describe('canPlaceBomb', () => {
    it('should return false when canBomb is false in config', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ canBomb: false }));
      expect(enemy.canPlaceBomb()).toBe(false);
    });

    it('should return false when bombConfig is null/undefined', () => {
      const enemy = new Enemy(
        1,
        { x: 0, y: 0 },
        makeConfig({ canBomb: true, bombConfig: undefined }),
      );
      expect(enemy.canPlaceBomb()).toBe(false);
    });

    it('should return true when alive, canBomb, has bombConfig, and no cooldown', () => {
      const enemy = new Enemy(
        1,
        { x: 0, y: 0 },
        makeConfig({
          canBomb: true,
          bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'timer' },
        }),
      );
      expect(enemy.canPlaceBomb()).toBe(true);
    });

    it('should return false when on bomb cooldown', () => {
      const enemy = new Enemy(
        1,
        { x: 0, y: 0 },
        makeConfig({
          canBomb: true,
          bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'timer' },
        }),
      );
      enemy.bombCooldown = 5;
      expect(enemy.canPlaceBomb()).toBe(false);
    });

    it('should return false when dead even with valid bomb config', () => {
      const enemy = new Enemy(
        1,
        { x: 0, y: 0 },
        makeConfig({
          canBomb: true,
          bombConfig: { fireRange: 2, cooldownTicks: 20, trigger: 'timer' },
        }),
      );
      enemy.alive = false;
      expect(enemy.canPlaceBomb()).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 6. applyBombCooldown()
  // ───────────────────────────────────────────────
  describe('applyBombCooldown', () => {
    it('should set bombCooldown from bombConfig.cooldownTicks', () => {
      const enemy = new Enemy(
        1,
        { x: 0, y: 0 },
        makeConfig({
          canBomb: true,
          bombConfig: { fireRange: 2, cooldownTicks: 30, trigger: 'timer' },
        }),
      );
      enemy.applyBombCooldown();
      expect(enemy.bombCooldown).toBe(30);
    });

    it('should not change bombCooldown when bombConfig is undefined', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ canBomb: false }));
      enemy.bombCooldown = 0;
      enemy.applyBombCooldown();
      expect(enemy.bombCooldown).toBe(0);
    });
  });

  // ───────────────────────────────────────────────
  // 7. takeDamage()
  // ───────────────────────────────────────────────
  describe('takeDamage', () => {
    it('should reduce HP by the damage amount', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ hp: 10 }));
      const died = enemy.takeDamage(3);
      expect(enemy.hp).toBe(7);
      expect(died).toBe(false);
      expect(enemy.alive).toBe(true);
    });

    it('should kill the enemy when HP reaches 0', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ hp: 5 }));
      const died = enemy.takeDamage(5);
      expect(enemy.hp).toBe(0);
      expect(died).toBe(true);
      expect(enemy.alive).toBe(false);
    });

    it('should kill the enemy when damage exceeds HP (overkill)', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ hp: 3 }));
      const died = enemy.takeDamage(100);
      expect(enemy.hp).toBe(0);
      expect(died).toBe(true);
      expect(enemy.alive).toBe(false);
    });

    it('should return false and do nothing when already dead', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ hp: 5 }));
      enemy.alive = false;
      const died = enemy.takeDamage(3);
      expect(died).toBe(false);
      // hp unchanged since already dead
      expect(enemy.hp).toBe(5);
    });

    it('should handle taking 0 damage', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ hp: 5 }));
      const died = enemy.takeDamage(0);
      expect(enemy.hp).toBe(5);
      expect(died).toBe(false);
    });

    it('should not allow HP to go negative (clamped to 0)', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ hp: 1 }));
      enemy.takeDamage(999);
      expect(enemy.hp).toBe(0);
    });

    it('should handle multiple hits until death', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ hp: 5 }));
      expect(enemy.takeDamage(2)).toBe(false);
      expect(enemy.hp).toBe(3);
      expect(enemy.takeDamage(2)).toBe(false);
      expect(enemy.hp).toBe(1);
      expect(enemy.takeDamage(2)).toBe(true);
      expect(enemy.hp).toBe(0);
      expect(enemy.alive).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 8. checkBossPhaseTransition()
  // ───────────────────────────────────────────────
  describe('checkBossPhaseTransition', () => {
    it('should return null for non-boss enemies', () => {
      const enemy = new Enemy(1, { x: 0, y: 0 }, makeConfig({ isBoss: false }));
      expect(enemy.checkBossPhaseTransition()).toBeNull();
    });

    it('should return null for boss with no phases defined', () => {
      const enemy = new Enemy(
        1,
        { x: 0, y: 0 },
        makeConfig({ isBoss: true, bossPhases: undefined }),
      );
      expect(enemy.checkBossPhaseTransition()).toBeNull();
    });

    it('should return null when HP is above all thresholds', () => {
      const phases: BossPhaseConfig[] = [
        { hpThreshold: 0.5, speedMultiplier: 2 },
        { hpThreshold: 0.25, speedMultiplier: 3 },
      ];
      const enemy = new Enemy(
        1,
        { x: 0, y: 0 },
        makeConfig({ isBoss: true, hp: 100, bossPhases: phases }),
      );
      // At full HP (100/100 = 1.0), no phase triggers
      expect(enemy.checkBossPhaseTransition()).toBeNull();
    });

    it('should trigger phase 1 when HP drops below first threshold', () => {
      const phases: BossPhaseConfig[] = [{ hpThreshold: 0.5, speedMultiplier: 2 }];
      const config = makeConfig({ isBoss: true, hp: 10, speed: 1, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      enemy.takeDamage(6); // HP = 4, 4/10 = 0.4 <= 0.5
      const phase = enemy.checkBossPhaseTransition();

      expect(phase).not.toBeNull();
      expect(phase!.hpThreshold).toBe(0.5);
      expect(enemy.currentPhase).toBe(1);
      expect(enemy.typeConfig.speed).toBe(2); // 1 * 2
    });

    it('should trigger later phases as HP drops further', () => {
      const phases: BossPhaseConfig[] = [
        { hpThreshold: 0.75, speedMultiplier: 1.5 },
        { hpThreshold: 0.5, speedMultiplier: 2 },
        { hpThreshold: 0.25, speedMultiplier: 3 },
      ];
      const config = makeConfig({ isBoss: true, hp: 100, speed: 1, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      // Drop to 70% — triggers phase 0 (hpThreshold 0.75)
      enemy.takeDamage(30);
      let phase = enemy.checkBossPhaseTransition();
      expect(phase).not.toBeNull();
      expect(enemy.currentPhase).toBe(1);
      expect(config.speed).toBe(1.5);

      // Drop to 40% — triggers phase 1 (hpThreshold 0.5)
      enemy.takeDamage(30);
      phase = enemy.checkBossPhaseTransition();
      expect(phase).not.toBeNull();
      expect(enemy.currentPhase).toBe(2);
      expect(config.speed).toBe(3); // 1.5 * 2

      // Drop to 10% — triggers phase 2 (hpThreshold 0.25)
      enemy.takeDamage(30);
      phase = enemy.checkBossPhaseTransition();
      expect(phase).not.toBeNull();
      expect(enemy.currentPhase).toBe(3);
      expect(config.speed).toBe(9); // 3 * 3
    });

    it('should not re-trigger an already-passed phase', () => {
      const phases: BossPhaseConfig[] = [{ hpThreshold: 0.5, speedMultiplier: 2 }];
      const config = makeConfig({ isBoss: true, hp: 10, speed: 1, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      enemy.takeDamage(6);
      enemy.checkBossPhaseTransition(); // triggers phase
      expect(enemy.currentPhase).toBe(1);

      // Calling again at same HP shouldn't trigger again
      const phase = enemy.checkBossPhaseTransition();
      expect(phase).toBeNull();
    });

    it('should apply movementPattern change', () => {
      const phases: BossPhaseConfig[] = [{ hpThreshold: 0.5, movementPattern: 'chase_player' }];
      const config = makeConfig({
        isBoss: true,
        hp: 10,
        movementPattern: 'random_walk',
        bossPhases: phases,
      });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      enemy.takeDamage(6);
      enemy.checkBossPhaseTransition();
      expect(config.movementPattern).toBe('chase_player');
    });

    it('should apply canBomb change', () => {
      const phases: BossPhaseConfig[] = [{ hpThreshold: 0.5, canBomb: true }];
      const config = makeConfig({ isBoss: true, hp: 10, canBomb: false, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      enemy.takeDamage(6);
      enemy.checkBossPhaseTransition();
      expect(config.canBomb).toBe(true);
    });

    it('should apply bombConfig change', () => {
      const newBombConfig = { fireRange: 4, cooldownTicks: 10, trigger: 'proximity' as const };
      const phases: BossPhaseConfig[] = [{ hpThreshold: 0.5, bombConfig: newBombConfig }];
      const config = makeConfig({ isBoss: true, hp: 10, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      enemy.takeDamage(6);
      enemy.checkBossPhaseTransition();
      expect(config.bombConfig).toBe(newBombConfig);
    });

    it('should handle phase with no stat modifiers (only spawnEnemies)', () => {
      const phases: BossPhaseConfig[] = [
        {
          hpThreshold: 0.5,
          spawnEnemies: [{ enemyTypeId: 1, count: 2 }],
        },
      ];
      const config = makeConfig({ isBoss: true, hp: 10, speed: 1, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);
      const origSpeed = config.speed;

      enemy.takeDamage(6);
      const phase = enemy.checkBossPhaseTransition();
      expect(phase).not.toBeNull();
      expect(config.speed).toBe(origSpeed); // unchanged
    });

    it('should clamp speed to minimum 0.01 after speedMultiplier', () => {
      const phases: BossPhaseConfig[] = [{ hpThreshold: 0.5, speedMultiplier: 0 }];
      const config = makeConfig({ isBoss: true, hp: 10, speed: 1, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      enemy.takeDamage(6);
      enemy.checkBossPhaseTransition();
      expect(config.speed).toBe(0.01);
    });

    it('should trigger the highest applicable phase when HP drops through multiple thresholds at once', () => {
      const phases: BossPhaseConfig[] = [
        { hpThreshold: 0.75, speedMultiplier: 1.5 },
        { hpThreshold: 0.25, speedMultiplier: 3 },
      ];
      const config = makeConfig({ isBoss: true, hp: 100, speed: 1, bossPhases: phases });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);

      // Drop from 100 to 20 (0.2) — crosses both thresholds
      enemy.takeDamage(80);
      const phase = enemy.checkBossPhaseTransition();
      expect(phase).not.toBeNull();
      // The loop iterates from end, so it should find phase index 1 first (hpThreshold 0.25)
      // and since currentPhase (0) <= 1, it triggers. currentPhase set to 2.
      expect(enemy.currentPhase).toBe(2);
    });
  });

  // ───────────────────────────────────────────────
  // 9. toState()
  // ───────────────────────────────────────────────
  describe('toState', () => {
    it('should produce correct CampaignEnemyState', () => {
      const config = makeConfig({ hp: 10, isBoss: false });
      const enemy = new Enemy(7, { x: 4, y: 6 }, config);
      enemy.direction = 'left';
      enemy.takeDamage(3);

      const state = enemy.toState();
      expect(state.id).toBe(enemy.id);
      expect(state.enemyTypeId).toBe(7);
      expect(state.position).toEqual({ x: 4, y: 6 });
      expect(state.hp).toBe(7);
      expect(state.maxHp).toBe(10);
      expect(state.alive).toBe(true);
      expect(state.direction).toBe('left');
      expect(state.isBoss).toBe(false);
      expect(state.currentPhase).toBeUndefined();
    });

    it('should include currentPhase for boss enemies', () => {
      const config = makeConfig({ isBoss: true, hp: 10, bossPhases: [] });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);
      enemy.currentPhase = 2;

      const state = enemy.toState();
      expect(state.isBoss).toBe(true);
      expect(state.currentPhase).toBe(2);
    });

    it('should deep copy position in toState', () => {
      const enemy = new Enemy(1, { x: 5, y: 5 }, makeConfig());
      const state = enemy.toState();
      state.position.x = 99;
      expect(enemy.position.x).toBe(5);
    });

    it('should reflect dead state correctly', () => {
      const config = makeConfig({ hp: 1 });
      const enemy = new Enemy(1, { x: 0, y: 0 }, config);
      enemy.takeDamage(1);

      const state = enemy.toState();
      expect(state.alive).toBe(false);
      expect(state.hp).toBe(0);
    });
  });
});
