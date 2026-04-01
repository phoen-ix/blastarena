import { describe, it, expect, beforeEach } from '@jest/globals';
import { Player } from '../../../backend/src/game/Player';
import {
  DEFAULT_SPEED,
  DEFAULT_MAX_BOMBS,
  DEFAULT_FIRE_RANGE,
  MAX_SPEED,
  MAX_BOMBS,
  MAX_FIRE_RANGE,
  INVULNERABILITY_TICKS,
  MOVE_COOLDOWN_BASE,
} from '@blast-arena/shared';
import type { PowerUpType, Direction } from '@blast-arena/shared';

describe('Player', () => {
  let player: Player;

  beforeEach(() => {
    player = new Player(1, 'Alice', { x: 3, y: 5 });
  });

  // ───────────────────────────────────────────────
  // 1. Construction
  // ───────────────────────────────────────────────
  describe('constructor', () => {
    it('should create a player with correct initial state', () => {
      expect(player.id).toBe(1);
      expect(player.username).toBe('Alice');
      expect(player.position).toEqual({ x: 3, y: 5 });
      expect(player.alive).toBe(true);
      expect(player.bombCount).toBe(0);
      expect(player.maxBombs).toBe(DEFAULT_MAX_BOMBS);
      expect(player.fireRange).toBe(DEFAULT_FIRE_RANGE);
      expect(player.speed).toBe(DEFAULT_SPEED);
      expect(player.hasShield).toBe(false);
      expect(player.hasKick).toBe(false);
      expect(player.hasPierceBomb).toBe(false);
      expect(player.hasRemoteBomb).toBe(false);
      expect(player.hasLineBomb).toBe(false);
      expect(player.team).toBeNull();
      expect(player.direction).toBe('down');
      expect(player.invulnerableTicks).toBe(INVULNERABILITY_TICKS);
      expect(player.moveCooldown).toBe(0);
      expect(player.isBot).toBe(false);
    });

    it('should assign team when provided', () => {
      const teamPlayer = new Player(2, 'Bob', { x: 1, y: 1 }, 0);
      expect(teamPlayer.team).toBe(0);
    });

    it('should set isBot flag', () => {
      const bot = new Player(-1, 'Bot', { x: 0, y: 0 }, null, true);
      expect(bot.isBot).toBe(true);
    });

    it('should deep copy the spawn position', () => {
      const pos = { x: 10, y: 20 };
      const p = new Player(1, 'Test', pos);
      pos.x = 999;
      expect(p.position.x).toBe(10);
    });

    it('should default team to null and isBot to false', () => {
      const p = new Player(1, 'X', { x: 0, y: 0 });
      expect(p.team).toBeNull();
      expect(p.isBot).toBe(false);
    });

    it('should initialize all stats to zero', () => {
      expect(player.kills).toBe(0);
      expect(player.deaths).toBe(0);
      expect(player.selfKills).toBe(0);
      expect(player.bombsPlaced).toBe(0);
      expect(player.powerupsCollected).toBe(0);
      expect(player.placement).toBeNull();
    });

    it('should initialize respawnTick to null', () => {
      expect(player.respawnTick).toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // 2. applyPowerUp()
  // ───────────────────────────────────────────────
  describe('applyPowerUp', () => {
    it('should increment powerupsCollected for every power-up', () => {
      player.applyPowerUp('bomb_up');
      player.applyPowerUp('fire_up');
      player.applyPowerUp('speed_up');
      expect(player.powerupsCollected).toBe(3);
    });

    describe('bomb_up', () => {
      it('should increase maxBombs by 1', () => {
        const before = player.maxBombs;
        player.applyPowerUp('bomb_up');
        expect(player.maxBombs).toBe(before + 1);
      });

      it('should cap maxBombs at MAX_BOMBS', () => {
        player.maxBombs = MAX_BOMBS;
        player.applyPowerUp('bomb_up');
        expect(player.maxBombs).toBe(MAX_BOMBS);
      });

      it('should cap at MAX_BOMBS even after many pickups', () => {
        for (let i = 0; i < 20; i++) player.applyPowerUp('bomb_up');
        expect(player.maxBombs).toBe(MAX_BOMBS);
      });
    });

    describe('fire_up', () => {
      it('should increase fireRange by 1', () => {
        const before = player.fireRange;
        player.applyPowerUp('fire_up');
        expect(player.fireRange).toBe(before + 1);
      });

      it('should cap fireRange at MAX_FIRE_RANGE', () => {
        player.fireRange = MAX_FIRE_RANGE;
        player.applyPowerUp('fire_up');
        expect(player.fireRange).toBe(MAX_FIRE_RANGE);
      });
    });

    describe('speed_up', () => {
      it('should increase speed by 1', () => {
        const before = player.speed;
        player.applyPowerUp('speed_up');
        expect(player.speed).toBe(before + 1);
      });

      it('should cap speed at MAX_SPEED', () => {
        player.speed = MAX_SPEED;
        player.applyPowerUp('speed_up');
        expect(player.speed).toBe(MAX_SPEED);
      });
    });

    describe('shield', () => {
      it('should grant shield', () => {
        player.applyPowerUp('shield');
        expect(player.hasShield).toBe(true);
      });

      it('should not stack shield (extra pickup consumed but no extra effect)', () => {
        player.applyPowerUp('shield');
        expect(player.hasShield).toBe(true);
        player.applyPowerUp('shield');
        expect(player.hasShield).toBe(true);
        expect(player.powerupsCollected).toBe(2);
      });
    });

    describe('kick', () => {
      it('should grant kick ability', () => {
        player.applyPowerUp('kick');
        expect(player.hasKick).toBe(true);
      });

      it('should remain true on second pickup', () => {
        player.applyPowerUp('kick');
        player.applyPowerUp('kick');
        expect(player.hasKick).toBe(true);
      });
    });

    describe('pierce_bomb', () => {
      it('should grant pierce bomb ability', () => {
        expect(player.hasPierceBomb).toBe(false);
        player.applyPowerUp('pierce_bomb');
        expect(player.hasPierceBomb).toBe(true);
      });
    });

    describe('remote_bomb', () => {
      it('should grant remote bomb ability', () => {
        expect(player.hasRemoteBomb).toBe(false);
        player.applyPowerUp('remote_bomb');
        expect(player.hasRemoteBomb).toBe(true);
      });
    });

    describe('line_bomb', () => {
      it('should grant line bomb ability', () => {
        expect(player.hasLineBomb).toBe(false);
        player.applyPowerUp('line_bomb');
        expect(player.hasLineBomb).toBe(true);
      });
    });

    it('should handle applying all 8 power-up types', () => {
      const allTypes: PowerUpType[] = [
        'bomb_up',
        'fire_up',
        'speed_up',
        'shield',
        'kick',
        'pierce_bomb',
        'remote_bomb',
        'line_bomb',
      ];
      for (const type of allTypes) {
        player.applyPowerUp(type);
      }
      expect(player.powerupsCollected).toBe(8);
      expect(player.maxBombs).toBe(DEFAULT_MAX_BOMBS + 1);
      expect(player.fireRange).toBe(DEFAULT_FIRE_RANGE + 1);
      expect(player.speed).toBe(DEFAULT_SPEED + 1);
      expect(player.hasShield).toBe(true);
      expect(player.hasKick).toBe(true);
      expect(player.hasPierceBomb).toBe(true);
      expect(player.hasRemoteBomb).toBe(true);
      expect(player.hasLineBomb).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // 3. canMove()
  // ───────────────────────────────────────────────
  describe('canMove', () => {
    it('should return true when alive and no cooldown', () => {
      expect(player.canMove()).toBe(true);
    });

    it('should return false when dead', () => {
      player.alive = false;
      expect(player.canMove()).toBe(false);
    });

    it('should return false when on move cooldown', () => {
      player.moveCooldown = 3;
      expect(player.canMove()).toBe(false);
    });

    it('should return false when dead and on cooldown', () => {
      player.alive = false;
      player.moveCooldown = 5;
      expect(player.canMove()).toBe(false);
    });

    it('should return true when cooldown just reached 0', () => {
      player.moveCooldown = 1;
      player.tick();
      expect(player.moveCooldown).toBe(0);
      expect(player.canMove()).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // 4. applyMoveCooldown()
  // ───────────────────────────────────────────────
  describe('applyMoveCooldown', () => {
    it('should apply base cooldown at default speed', () => {
      player.speed = DEFAULT_SPEED;
      player.applyMoveCooldown();
      // MOVE_COOLDOWN_BASE - (speed - 1) = 5 - 0 = 5
      expect(player.moveCooldown).toBe(MOVE_COOLDOWN_BASE);
    });

    it('should reduce cooldown with higher speed', () => {
      player.speed = 2;
      player.applyMoveCooldown();
      // 5 - (2-1) = 4
      expect(player.moveCooldown).toBe(MOVE_COOLDOWN_BASE - 1);
    });

    it('should clamp cooldown to minimum 1', () => {
      player.speed = 100; // absurdly high
      player.applyMoveCooldown();
      expect(player.moveCooldown).toBe(1);
    });

    it('should produce correct cooldown for MAX_SPEED', () => {
      player.speed = MAX_SPEED;
      player.applyMoveCooldown();
      const expected = Math.max(1, MOVE_COOLDOWN_BASE - (MAX_SPEED - 1));
      expect(player.moveCooldown).toBe(expected);
    });
  });

  // ───────────────────────────────────────────────
  // 5. canPlaceBomb()
  // ───────────────────────────────────────────────
  describe('canPlaceBomb', () => {
    it('should return true when alive and bombCount < maxBombs', () => {
      player.bombCount = 0;
      player.maxBombs = 1;
      expect(player.canPlaceBomb()).toBe(true);
    });

    it('should return false when bombCount equals maxBombs', () => {
      player.bombCount = 1;
      player.maxBombs = 1;
      expect(player.canPlaceBomb()).toBe(false);
    });

    it('should return false when dead', () => {
      player.alive = false;
      expect(player.canPlaceBomb()).toBe(false);
    });

    it('should return true with room for more bombs', () => {
      player.maxBombs = 5;
      player.bombCount = 3;
      expect(player.canPlaceBomb()).toBe(true);
    });

    it('should return false when dead even with room for bombs', () => {
      player.alive = false;
      player.maxBombs = 5;
      player.bombCount = 0;
      expect(player.canPlaceBomb()).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 6. die()
  // ───────────────────────────────────────────────
  describe('die', () => {
    it('should set alive to false and increment deaths', () => {
      player.die();
      expect(player.alive).toBe(false);
      expect(player.deaths).toBe(1);
    });

    it('should increment deaths each time die() is called', () => {
      player.die();
      player.alive = true; // force alive for testing
      player.die();
      expect(player.deaths).toBe(2);
    });
  });

  // ───────────────────────────────────────────────
  // 7. respawn()
  // ───────────────────────────────────────────────
  describe('respawn', () => {
    it('should reset all power-ups and stats on respawn', () => {
      // First power up the player and kill them
      player.applyPowerUp('bomb_up');
      player.applyPowerUp('bomb_up');
      player.applyPowerUp('fire_up');
      player.applyPowerUp('speed_up');
      player.applyPowerUp('shield');
      player.applyPowerUp('kick');
      player.applyPowerUp('pierce_bomb');
      player.applyPowerUp('remote_bomb');
      player.applyPowerUp('line_bomb');
      player.kills = 5;
      player.deaths = 2;
      player.bombCount = 3;
      player.moveCooldown = 4;
      player.respawnTick = 100;
      player.direction = 'left';
      player.die();

      // Respawn
      player.respawn({ x: 7, y: 9 });

      expect(player.alive).toBe(true);
      expect(player.position).toEqual({ x: 7, y: 9 });
      expect(player.bombCount).toBe(0);
      expect(player.maxBombs).toBe(DEFAULT_MAX_BOMBS);
      expect(player.fireRange).toBe(DEFAULT_FIRE_RANGE);
      expect(player.speed).toBe(DEFAULT_SPEED);
      expect(player.hasShield).toBe(false);
      expect(player.hasKick).toBe(false);
      expect(player.hasPierceBomb).toBe(false);
      expect(player.hasRemoteBomb).toBe(false);
      expect(player.hasLineBomb).toBe(false);
      expect(player.invulnerableTicks).toBe(INVULNERABILITY_TICKS);
      expect(player.moveCooldown).toBe(0);
      expect(player.respawnTick).toBeNull();
      expect(player.direction).toBe('down');
    });

    it('should preserve kills and deaths after respawn', () => {
      player.kills = 5;
      player.deaths = 3;
      player.die();
      player.respawn({ x: 0, y: 0 });
      expect(player.kills).toBe(5);
      expect(player.deaths).toBe(4); // die() adds 1
    });

    it('should deep copy the respawn position', () => {
      const pos = { x: 7, y: 9 };
      player.die();
      player.respawn(pos);
      pos.x = 999;
      expect(player.position.x).toBe(7);
    });

    it('should grant fresh invulnerability on respawn', () => {
      player.invulnerableTicks = 0;
      player.die();
      player.respawn({ x: 0, y: 0 });
      expect(player.invulnerableTicks).toBe(INVULNERABILITY_TICKS);
    });
  });

  // ───────────────────────────────────────────────
  // 8. tick()
  // ───────────────────────────────────────────────
  describe('tick', () => {
    it('should decrement invulnerableTicks when > 0', () => {
      player.invulnerableTicks = 10;
      player.tick();
      expect(player.invulnerableTicks).toBe(9);
    });

    it('should not decrement invulnerableTicks below 0', () => {
      player.invulnerableTicks = 0;
      player.tick();
      expect(player.invulnerableTicks).toBe(0);
    });

    it('should decrement moveCooldown when > 0', () => {
      player.moveCooldown = 5;
      player.tick();
      expect(player.moveCooldown).toBe(4);
    });

    it('should not decrement moveCooldown below 0', () => {
      player.moveCooldown = 0;
      player.tick();
      expect(player.moveCooldown).toBe(0);
    });

    it('should decrement both timers simultaneously', () => {
      player.invulnerableTicks = 3;
      player.moveCooldown = 2;
      player.tick();
      expect(player.invulnerableTicks).toBe(2);
      expect(player.moveCooldown).toBe(1);
    });

    it('should fully drain invulnerability over INVULNERABILITY_TICKS ticks', () => {
      player.invulnerableTicks = INVULNERABILITY_TICKS;
      for (let i = 0; i < INVULNERABILITY_TICKS; i++) {
        player.tick();
      }
      expect(player.invulnerableTicks).toBe(0);
    });
  });

  // ───────────────────────────────────────────────
  // 9. toState()
  // ───────────────────────────────────────────────
  describe('toState', () => {
    it('should produce correct PlayerState', () => {
      player.direction = 'right';
      player.kills = 3;
      player.deaths = 1;
      player.applyPowerUp('shield');
      player.applyPowerUp('kick');

      const state = player.toState();
      expect(state.id).toBe(1);
      expect(state.username).toBe('Alice');
      expect(state.position).toEqual({ x: 3, y: 5 });
      expect(state.alive).toBe(true);
      expect(state.bombCount).toBe(0);
      expect(state.maxBombs).toBe(DEFAULT_MAX_BOMBS);
      expect(state.fireRange).toBe(DEFAULT_FIRE_RANGE);
      expect(state.speed).toBe(DEFAULT_SPEED);
      expect(state.hasShield).toBe(true);
      expect(state.hasKick).toBe(true);
      expect(state.hasPierceBomb).toBe(false);
      expect(state.hasRemoteBomb).toBe(false);
      expect(state.hasLineBomb).toBe(false);
      expect(state.team).toBeNull();
      expect(state.direction).toBe('right');
      expect(state.isBot).toBe(false);
      expect(state.kills).toBe(3);
      expect(state.deaths).toBe(1);
    });

    it('should deep copy position in toState', () => {
      const state = player.toState();
      state.position.x = 999;
      expect(player.position.x).toBe(3);
    });

    it('should include team in state', () => {
      const teamPlayer = new Player(2, 'Bob', { x: 0, y: 0 }, 1);
      const state = teamPlayer.toState();
      expect(state.team).toBe(1);
    });

    it('should include bot flag in state', () => {
      const bot = new Player(-1, 'Bot1', { x: 0, y: 0 }, null, true);
      const state = bot.toState();
      expect(state.isBot).toBe(true);
    });

    it('should reflect dead state', () => {
      player.die();
      const state = player.toState();
      expect(state.alive).toBe(false);
    });

    it('should reflect all power-ups in state', () => {
      const allTypes: PowerUpType[] = [
        'bomb_up',
        'fire_up',
        'speed_up',
        'shield',
        'kick',
        'pierce_bomb',
        'remote_bomb',
        'line_bomb',
      ];
      for (const type of allTypes) {
        player.applyPowerUp(type);
      }
      const state = player.toState();
      expect(state.maxBombs).toBe(DEFAULT_MAX_BOMBS + 1);
      expect(state.fireRange).toBe(DEFAULT_FIRE_RANGE + 1);
      expect(state.speed).toBe(DEFAULT_SPEED + 1);
      expect(state.hasShield).toBe(true);
      expect(state.hasKick).toBe(true);
      expect(state.hasPierceBomb).toBe(true);
      expect(state.hasRemoteBomb).toBe(true);
      expect(state.hasLineBomb).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // 10. Edge Cases & Interactions
  // ───────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle negative player IDs (bots)', () => {
      const bot = new Player(-1, 'Bot1', { x: 5, y: 5 }, null, true);
      expect(bot.id).toBe(-1);
      expect(bot.isBot).toBe(true);
      expect(bot.toState().id).toBe(-1);
    });

    it('should track selfKills separately from kills', () => {
      player.kills = 5;
      player.selfKills = 2;
      expect(player.kills).toBe(5);
      expect(player.selfKills).toBe(2);
    });

    it('should be able to die and respawn multiple times (deathmatch)', () => {
      player.kills = 3;

      // First death
      player.die();
      expect(player.deaths).toBe(1);
      player.respawn({ x: 1, y: 1 });
      expect(player.alive).toBe(true);

      // Power up again
      player.applyPowerUp('bomb_up');
      player.applyPowerUp('shield');

      // Second death
      player.die();
      expect(player.deaths).toBe(2);
      player.respawn({ x: 5, y: 5 });
      expect(player.alive).toBe(true);
      expect(player.hasShield).toBe(false);
      expect(player.maxBombs).toBe(DEFAULT_MAX_BOMBS);
      expect(player.kills).toBe(3); // preserved
    });

    it('should have correct movement cooldown at speed boundaries', () => {
      // At speed 1 (default): cooldown = MOVE_COOLDOWN_BASE
      player.speed = 1;
      player.applyMoveCooldown();
      expect(player.moveCooldown).toBe(MOVE_COOLDOWN_BASE);

      // At speed MAX_SPEED: shorter cooldown
      player.speed = MAX_SPEED;
      player.applyMoveCooldown();
      expect(player.moveCooldown).toBe(Math.max(1, MOVE_COOLDOWN_BASE - (MAX_SPEED - 1)));
    });

    it('should handle bombCount tracking independently', () => {
      player.maxBombs = 3;
      player.bombCount = 0;
      expect(player.canPlaceBomb()).toBe(true);

      player.bombCount = 1;
      expect(player.canPlaceBomb()).toBe(true);

      player.bombCount = 3;
      expect(player.canPlaceBomb()).toBe(false);

      player.bombCount = 2;
      expect(player.canPlaceBomb()).toBe(true);
    });

    it('should correctly set placement', () => {
      player.placement = 3;
      expect(player.placement).toBe(3);
    });

    it('should correctly set respawnTick', () => {
      player.respawnTick = 60;
      expect(player.respawnTick).toBe(60);
    });
  });

  // ───────────────────────────────────────────────
  // 11. Buddy Mode
  // ───────────────────────────────────────────────
  describe('buddy mode', () => {
    it('should create buddy with isBuddy flag and buddyOwnerId', () => {
      const buddy = new Player(-2001, 'Buddy', { x: 2, y: 2 }, 0, false, true, 1);
      expect(buddy.isBuddy).toBe(true);
      expect(buddy.buddyOwnerId).toBe(1);
    });

    it('should initialize buddy with reduced stats (1 bomb, 1 fire range)', () => {
      const buddy = new Player(-2001, 'Buddy', { x: 2, y: 2 }, 0, false, true, 1);
      expect(buddy.maxBombs).toBe(1);
      expect(buddy.fireRange).toBe(1);
    });

    it('should not die when die() is called (buddy invulnerability)', () => {
      const buddy = new Player(-2001, 'Buddy', { x: 2, y: 2 }, 0, false, true, 1);
      buddy.die();
      expect(buddy.alive).toBe(true);
      expect(buddy.deaths).toBe(0);
    });

    it('should not increment deaths on die() for buddy', () => {
      const buddy = new Player(-2001, 'Buddy', { x: 2, y: 2 }, 0, false, true, 1);
      buddy.die();
      buddy.die();
      buddy.die();
      expect(buddy.deaths).toBe(0);
    });

    it('should include isBuddy and buddyOwnerId in toState()', () => {
      const buddy = new Player(-2001, 'Buddy', { x: 2, y: 2 }, 0, false, true, 1);
      const state = buddy.toState();
      expect(state.isBuddy).toBe(true);
      expect(state.buddyOwnerId).toBe(1);
    });

    it('should not include isBuddy in toState() for normal players', () => {
      const state = player.toState();
      expect(state.isBuddy).toBeUndefined();
      expect(state.buddyOwnerId).toBeUndefined();
    });

    it('should allow buddy to apply power-ups', () => {
      const buddy = new Player(-2001, 'Buddy', { x: 2, y: 2 }, 0, false, true, 1);
      buddy.applyPowerUp('bomb_up');
      buddy.applyPowerUp('fire_up');
      expect(buddy.maxBombs).toBe(2);
      expect(buddy.fireRange).toBe(2);
      expect(buddy.powerupsCollected).toBe(2);
    });
  });

  // ───────────────────────────────────────────────
  // 12. Bomb Throw Power-Up
  // ───────────────────────────────────────────────
  describe('bomb_throw', () => {
    it('should grant hasBombThrow via applyPowerUp', () => {
      expect(player.hasBombThrow).toBe(false);
      player.applyPowerUp('bomb_throw');
      expect(player.hasBombThrow).toBe(true);
    });

    it('should include hasBombThrow in toState()', () => {
      player.applyPowerUp('bomb_throw');
      const state = player.toState();
      expect(state.hasBombThrow).toBe(true);
    });

    it('should reset hasBombThrow on respawn', () => {
      player.applyPowerUp('bomb_throw');
      expect(player.hasBombThrow).toBe(true);
      player.die();
      player.respawn({ x: 0, y: 0 });
      expect(player.hasBombThrow).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 13. Remote Detonation Mode
  // ───────────────────────────────────────────────
  describe('remoteDetonateMode', () => {
    it('should default to all mode', () => {
      expect(player.remoteDetonateMode).toBe('all');
    });

    it('should include remoteDetonateMode in toState() only when hasRemoteBomb', () => {
      const state = player.toState();
      expect(state.remoteDetonateMode).toBeUndefined();

      player.hasRemoteBomb = true;
      const state2 = player.toState();
      expect(state2.remoteDetonateMode).toBe('all');
    });

    it('should reflect fifo mode in toState()', () => {
      player.hasRemoteBomb = true;
      player.remoteDetonateMode = 'fifo';
      const state = player.toState();
      expect(state.remoteDetonateMode).toBe('fifo');
    });

    it('should reset remoteDetonateMode implicitly on respawn (hasRemoteBomb lost)', () => {
      player.hasRemoteBomb = true;
      player.remoteDetonateMode = 'fifo';
      player.die();
      player.respawn({ x: 0, y: 0 });
      expect(player.hasRemoteBomb).toBe(false);
      // remoteDetonateMode value persists but is irrelevant without hasRemoteBomb
      const state = player.toState();
      expect(state.remoteDetonateMode).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────
  // 14. Frozen State (Co-Op)
  // ───────────────────────────────────────────────
  describe('frozen state', () => {
    it('should default frozen to false', () => {
      expect(player.frozen).toBe(false);
    });

    it('should allow setting frozen to true', () => {
      player.frozen = true;
      expect(player.frozen).toBe(true);
    });

    it('should not affect canMove when frozen (frozen is handled externally)', () => {
      player.frozen = true;
      // canMove only checks alive && moveCooldown
      expect(player.canMove()).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // 15. Cosmetics
  // ───────────────────────────────────────────────
  describe('cosmetics', () => {
    it('should default cosmetics to undefined', () => {
      expect(player.cosmetics).toBeUndefined();
    });

    it('should allow setting cosmetics', () => {
      player.cosmetics = {
        colorHex: 0xff0000,
        eyeStyle: 'angry',
      };
      expect(player.cosmetics).toBeDefined();
      expect(player.cosmetics!.colorHex).toBe(0xff0000);
    });

    it('should include cosmetics in toState()', () => {
      const cosmeticData = {
        colorHex: 0x00ff00,
        eyeStyle: 'happy',
        trailConfig: { particleKey: 'fire', tint: 0xff0000, frequency: 100 },
        bombSkinConfig: { baseColor: 0x333333, fuseColor: 0xff8800, label: 'classic' },
      };
      player.cosmetics = cosmeticData;
      const state = player.toState();
      expect(state.cosmetics).toEqual(cosmeticData);
    });
  });

  // ───────────────────────────────────────────────
  // 16. Movement Tracking
  // ───────────────────────────────────────────────
  describe('movedThisTick', () => {
    it('should default movedThisTick to false', () => {
      expect(player.movedThisTick).toBe(false);
    });

    it('should set movedThisTick to true on applyMoveCooldown', () => {
      player.applyMoveCooldown();
      expect(player.movedThisTick).toBe(true);
    });

    it('should not reset movedThisTick in tick()', () => {
      player.applyMoveCooldown();
      expect(player.movedThisTick).toBe(true);
      player.tick();
      // tick() does NOT reset movedThisTick — it is reset at top of processTick externally
      expect(player.movedThisTick).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // 17. All Nine Power-Ups (including bomb_throw)
  // ───────────────────────────────────────────────
  describe('all nine power-ups', () => {
    it('should handle all 9 power-up types correctly', () => {
      const allTypes: PowerUpType[] = [
        'bomb_up',
        'fire_up',
        'speed_up',
        'shield',
        'kick',
        'pierce_bomb',
        'remote_bomb',
        'line_bomb',
        'bomb_throw',
      ];
      for (const type of allTypes) {
        player.applyPowerUp(type);
      }
      expect(player.powerupsCollected).toBe(9);
      expect(player.maxBombs).toBe(DEFAULT_MAX_BOMBS + 1);
      expect(player.fireRange).toBe(DEFAULT_FIRE_RANGE + 1);
      expect(player.speed).toBe(DEFAULT_SPEED + 1);
      expect(player.hasShield).toBe(true);
      expect(player.hasKick).toBe(true);
      expect(player.hasPierceBomb).toBe(true);
      expect(player.hasRemoteBomb).toBe(true);
      expect(player.hasLineBomb).toBe(true);
      expect(player.hasBombThrow).toBe(true);
    });

    it('should reset all 9 power-ups on respawn', () => {
      const allTypes: PowerUpType[] = [
        'bomb_up',
        'fire_up',
        'speed_up',
        'shield',
        'kick',
        'pierce_bomb',
        'remote_bomb',
        'line_bomb',
        'bomb_throw',
      ];
      for (const type of allTypes) {
        player.applyPowerUp(type);
      }
      player.die();
      player.respawn({ x: 0, y: 0 });
      expect(player.maxBombs).toBe(DEFAULT_MAX_BOMBS);
      expect(player.fireRange).toBe(DEFAULT_FIRE_RANGE);
      expect(player.speed).toBe(DEFAULT_SPEED);
      expect(player.hasShield).toBe(false);
      expect(player.hasKick).toBe(false);
      expect(player.hasPierceBomb).toBe(false);
      expect(player.hasRemoteBomb).toBe(false);
      expect(player.hasLineBomb).toBe(false);
      expect(player.hasBombThrow).toBe(false);
    });
  });
});
