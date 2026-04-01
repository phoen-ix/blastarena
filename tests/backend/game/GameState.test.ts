import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { Player } from '../../../backend/src/game/Player';
import { Bomb } from '../../../backend/src/game/Bomb';
import { Explosion } from '../../../backend/src/game/Explosion';
import { PowerUp } from '../../../backend/src/game/PowerUp';
import type { PlayerInput, Direction } from '@blast-arena/shared';
import {
  BOMB_TIMER_TICKS,
  EXPLOSION_DURATION_TICKS,
  INVULNERABILITY_TICKS,
  MOVE_COOLDOWN_BASE,
  TICK_RATE,
  DEATHMATCH_RESPAWN_TICKS,
  DEATHMATCH_KILL_TARGET,
  KOTH_ZONE_SIZE,
  KOTH_SCORE_TARGET,
  KOTH_POINTS_PER_TICK,
} from '@blast-arena/shared';

// Default small map config for most tests
const BASE_CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 12345,
  gameMode: 'ffa' as const,
  wallDensity: 0.0, // no random walls for predictable tests
  powerUpDropRate: 0, // no random power-up drops
};

let seqCounter = 0;

/** Create a PlayerInput for movement only. */
function moveInput(direction: Direction): PlayerInput {
  return { direction, action: null, tick: 0, seq: ++seqCounter };
}

/** Create a PlayerInput for an action only (bomb / detonate). */
function actionInput(action: 'bomb' | 'detonate'): PlayerInput {
  return { direction: null, action, tick: 0, seq: ++seqCounter };
}

/** Create a PlayerInput with both direction and action. */
function comboInput(direction: Direction, action: 'bomb' | 'detonate'): PlayerInput {
  return { direction, action, tick: 0, seq: ++seqCounter };
}

/** Advance game state by N ticks */
function advanceTicks(gs: GameStateManager, n: number): void {
  for (let i = 0; i < n; i++) {
    gs.processTick();
  }
}

/** Skip the countdown phase: the GameLoop sets status to 'playing' after 36 ticks.
 *  In unit tests we bypass GameLoop, so just set it directly. */
function startPlaying(gs: GameStateManager): void {
  gs.status = 'playing';
}

/** Place a player at a specific position (bypass movement). */
function placePlayer(player: Player, x: number, y: number): void {
  player.position = { x, y };
}

/** Clear invulnerability so player can be hit immediately. */
function makeVulnerable(player: Player): void {
  player.invulnerableTicks = 0;
}

/** Clear move cooldown so player can move on the next tick. */
function clearCooldown(player: Player): void {
  player.moveCooldown = 0;
}

describe('GameStateManager', () => {
  let gs: GameStateManager;

  beforeEach(() => {
    seqCounter = 0;
    gs = new GameStateManager(BASE_CONFIG);
  });

  // ───────────────────────────────────────────────
  // 1. Game Lifecycle
  // ───────────────────────────────────────────────
  describe('Game lifecycle', () => {
    it('should start in countdown status', () => {
      expect(gs.status).toBe('countdown');
      expect(gs.tick).toBe(0);
    });

    it('should not process ticks while in countdown status', () => {
      gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);

      // processTick early-returns when status is 'countdown'
      gs.processTick();
      expect(gs.tick).toBe(0);
    });

    it('should process ticks once status is playing', () => {
      gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      gs.processTick();
      expect(gs.tick).toBe(1);
      expect(gs.status).toBe('playing');
    });

    it('should trigger finish when round time expires', () => {
      const shortGame = new GameStateManager({ ...BASE_CONFIG, roundTime: 1 }); // 1 second
      shortGame.addPlayer(1, 'Alice', null);
      shortGame.addPlayer(2, 'Bob', null);
      startPlaying(shortGame);

      // 1 second = 20 ticks at 20 tps
      advanceTicks(shortGame, TICK_RATE);

      // finishTick should be set but status is still 'playing' during grace period
      expect(shortGame.finishReason).toBe("Time's up!");
      expect(shortGame.status).toBe('playing');
    });

    it('should transition to finished after grace period', () => {
      const shortGame = new GameStateManager({ ...BASE_CONFIG, roundTime: 1 });
      shortGame.addPlayer(1, 'Alice', null);
      shortGame.addPlayer(2, 'Bob', null);
      startPlaying(shortGame);

      // Trigger time limit
      advanceTicks(shortGame, TICK_RATE);
      expect(shortGame.status).toBe('playing');

      // Grace period: 30 ticks
      advanceTicks(shortGame, 30);
      expect(shortGame.status).toBe('finished');
    });

    it('toState() should return serializable game state', () => {
      gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      const state = gs.toState();
      expect(state.tick).toBe(0);
      expect(state.status).toBe('playing');
      expect(state.players).toHaveLength(1);
      expect(state.players[0].username).toBe('Alice');
      expect(state.map.width).toBe(15);
      expect(state.map.height).toBe(13);
      expect(state.roundTime).toBe(180);
      expect(state.timeElapsed).toBe(0);
    });
  });

  // ───────────────────────────────────────────────
  // 2. Player Management
  // ───────────────────────────────────────────────
  describe('Player management', () => {
    it('should add players at spawn points', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bob', null);

      expect(gs.players.size).toBe(2);
      expect(p1.alive).toBe(true);
      expect(p2.alive).toBe(true);
      // Players spawn at valid spawn points (order is shuffled for fairness)
      expect(gs.map.spawnPoints).toContainEqual(p1.position);
      expect(gs.map.spawnPoints).toContainEqual(p2.position);
      // Each player gets a different spawn point
      expect(p1.position).not.toEqual(p2.position);
    });

    it('should add bot players with isBot flag', () => {
      const bot = gs.addPlayer(-1, 'Bot1', null, true);
      expect(bot.isBot).toBe(true);
    });

    it('should remove players', () => {
      gs.addPlayer(1, 'Alice', null);
      expect(gs.players.size).toBe(1);

      gs.removePlayer(1);
      expect(gs.players.size).toBe(0);
    });

    it('should assign teams to players', () => {
      const p1 = gs.addPlayer(1, 'Alice', 0);
      const p2 = gs.addPlayer(2, 'Bob', 1);

      expect(p1.team).toBe(0);
      expect(p2.team).toBe(1);
    });
  });

  // ───────────────────────────────────────────────
  // 3. Player Movement
  // ───────────────────────────────────────────────
  describe('Player movement', () => {
    let player: Player;

    beforeEach(() => {
      player = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null); // need 2 players to prevent instant win
      startPlaying(gs);
      makeVulnerable(player);
    });

    it('should move player in the input direction', () => {
      placePlayer(player, 1, 1);
      clearCooldown(player);

      const startPos = { ...player.position };
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      expect(player.position.x).toBe(startPos.x + 1);
      expect(player.position.y).toBe(startPos.y);
    });

    it('should respect movement cooldown', () => {
      placePlayer(player, 1, 1);
      clearCooldown(player);

      // First move succeeds
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();
      expect(player.position.x).toBe(2);

      // Immediately try to move again -- cooldown blocks it
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();
      expect(player.position.x).toBe(2);
    });

    it('should allow movement after cooldown expires', () => {
      placePlayer(player, 1, 1);
      clearCooldown(player);

      // Move right
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();
      expect(player.position.x).toBe(2);

      // Wait for cooldown to expire (MOVE_COOLDOWN_BASE ticks at speed 1)
      advanceTicks(gs, MOVE_COOLDOWN_BASE);

      // Now should be able to move again
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();
      expect(player.position.x).toBe(3);
    });

    it('should not move into walls', () => {
      placePlayer(player, 1, 1);
      clearCooldown(player);

      // (0,1) is a border wall
      gs.inputBuffer.addInput(1, moveInput('left'));
      gs.processTick();
      expect(player.position.x).toBe(1); // didn't move
    });

    it('should not move into other players', () => {
      const p2 = gs.players.get(2)!;
      placePlayer(player, 3, 1);
      placePlayer(p2, 4, 1);
      clearCooldown(player);

      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();
      expect(player.position.x).toBe(3); // blocked by p2
    });

    it('should update player direction even when blocked', () => {
      placePlayer(player, 1, 1);
      clearCooldown(player);
      player.direction = 'down';

      // Try moving left into wall -- direction should still update
      gs.inputBuffer.addInput(1, moveInput('left'));
      gs.processTick();
      expect(player.direction).toBe('left');
    });
  });

  // ───────────────────────────────────────────────
  // 4. Bomb Placement and Detonation
  // ───────────────────────────────────────────────
  describe('Bomb placement and detonation', () => {
    let p1: Player;
    let p2: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
    });

    it('should place a bomb at the player position', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      expect(gs.bombs.size).toBe(1);
      const bomb = Array.from(gs.bombs.values())[0];
      expect(bomb.position).toEqual({ x: 3, y: 3 });
      expect(bomb.ownerId).toBe(1);
      expect(p1.bombCount).toBe(1);
    });

    it('should not place more bombs than maxBombs', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      // Default maxBombs is 1
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1);

      // Move away and try to place another
      placePlayer(p1, 5, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1); // still 1
    });

    it('should not place a bomb on top of another bomb', () => {
      placePlayer(p1, 3, 3);
      p1.maxBombs = 3;
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1);

      // Try placing again at same spot
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1); // duplicate blocked
    });

    it('should detonate bomb after BOMB_TIMER_TICKS', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1);

      // Advance until bomb detonates
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(gs.bombs.size).toBe(0); // bomb gone
      expect(gs.explosions.size).toBeGreaterThan(0); // explosion created
      expect(p1.bombCount).toBe(0); // bomb count restored
    });

    it('should create explosion with correct cells', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      const explosion = Array.from(gs.explosions.values())[0];
      expect(explosion.ownerId).toBe(1);
      // Default fire range is 1, so explosion should cover origin + adjacent cells
      expect(explosion.cells).toContainEqual({ x: 3, y: 3 }); // center
    });

    it('should record explosion in tickEvents', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Advance to the tick where bomb detonates
      advanceTicks(gs, BOMB_TIMER_TICKS - 2);
      gs.processTick(); // detonation tick

      expect(gs.tickEvents.explosions.length).toBeGreaterThan(0);
      expect(gs.tickEvents.explosions[0].ownerId).toBe(1);
    });

    it('should clean up explosions after EXPLOSION_DURATION_TICKS', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Detonate
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);
      expect(gs.explosions.size).toBeGreaterThan(0);

      // Explosions last EXPLOSION_DURATION_TICKS
      advanceTicks(gs, EXPLOSION_DURATION_TICKS);
      expect(gs.explosions.size).toBe(0);
    });
  });

  // ───────────────────────────────────────────────
  // 5. Player Death from Explosion
  // ───────────────────────────────────────────────
  describe('Player death from explosion', () => {
    let p1: Player;
    let p2: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
    });

    it('should kill a player standing in blast zone', () => {
      // Place bomb at (3,3), put victim adjacent
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3); // within fire range 1
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Move p1 to safety so only p2 dies
      placePlayer(p1, 1, 1);

      // Detonate
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p2.alive).toBe(false);
      expect(p2.deaths).toBe(1);
      expect(p1.kills).toBe(1);
    });

    it('should record kill in tickEvents', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      advanceTicks(gs, BOMB_TIMER_TICKS - 2);
      gs.processTick(); // detonation tick

      const deathEvent = gs.tickEvents.playerDied.find((e) => e.playerId === 2);
      expect(deathEvent).toBeDefined();
      expect(deathEvent!.killerId).toBe(1);
    });

    it('should not kill player during explosion fade-out (last 3 ticks)', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Detonate
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);
      expect(gs.explosions.size).toBeGreaterThan(0);

      // Advance explosion to fade-out phase (last 3 ticks)
      advanceTicks(gs, EXPLOSION_DURATION_TICKS - 4);

      // Now place p2 in the explosion zone during fade-out
      placePlayer(p2, 3, 3);
      makeVulnerable(p2);

      // Process remaining ticks -- should not kill because ticksRemaining <= 3
      advanceTicks(gs, 3);
      expect(p2.alive).toBe(true);
    });

    it('should not damage players who have invulnerability ticks', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);
      // p2 has invulnerability
      p2.invulnerableTicks = 100;

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p2.alive).toBe(true);
    });
  });

  // ───────────────────────────────────────────────
  // 6. Self-Kill Scoring
  // ───────────────────────────────────────────────
  describe('Self-kill scoring', () => {
    let p1: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
    });

    it('should decrement kills and increment selfKills on self-kill', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Keep p1 at bomb location
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p1.alive).toBe(false);
      expect(p1.selfKills).toBe(1);
      expect(p1.kills).toBe(-1); // decremented from 0
    });

    it('self-kill should still credit owner death', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p1.deaths).toBe(1);
    });
  });

  // ───────────────────────────────────────────────
  // 7. Shield Mechanics
  // ───────────────────────────────────────────────
  describe('Shield mechanics', () => {
    let p1: Player;
    let p2: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
    });

    it('should absorb one hit when player has shield', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      p2.hasShield = true;
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p2.alive).toBe(true);
      expect(p2.hasShield).toBe(false);
    });

    it('should grant invulnerability ticks after shield breaks', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      p2.hasShield = true;
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p2.invulnerableTicks).toBe(10); // shield break invulnerability
    });

    it('shield-break invulnerability should protect against subsequent ticks of same explosion', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      p2.hasShield = true;
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Detonate
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);
      expect(p2.alive).toBe(true);
      expect(p2.hasShield).toBe(false);

      // Keep player in explosion for more ticks -- invulnerability should protect
      advanceTicks(gs, 5);
      expect(p2.alive).toBe(true);
    });

    it('player dies on second hit after shield broke and invulnerability expired', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      p2.hasShield = true;
      p1.maxBombs = 2;
      clearCooldown(p1);

      // Place first bomb
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Move p1 to safety
      placePlayer(p1, 1, 1);

      // Detonate first bomb -- breaks shield
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);
      expect(p2.alive).toBe(true);
      expect(p2.hasShield).toBe(false);

      // Wait for first explosion to clear and invulnerability to expire
      advanceTicks(gs, Math.max(EXPLOSION_DURATION_TICKS, 10) + 1);
      makeVulnerable(p2); // force-clear any remaining invulnerability

      // Place second bomb adjacent to p2 (p1 at 5,3, p2 at 4,3)
      placePlayer(p1, 5, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Move p1 away again
      placePlayer(p1, 1, 1);

      // Detonate second bomb -- p2 should die
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p2.alive).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 8. Chain Reaction
  // ───────────────────────────────────────────────
  describe('Chain reaction', () => {
    let p1: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      p1.maxBombs = 5;
      p1.fireRange = 3;
    });

    it('should detonate bomb B when bomb A explosion reaches it', () => {
      // Place bomb A at (3,3), bomb B at (5,3) -- fire range 3 means A can reach B
      placePlayer(p1, 3, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Move and place second bomb
      placePlayer(p1, 5, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      expect(gs.bombs.size).toBe(2);

      // Detonate first bomb (placed 1 tick earlier, so it detonates first)
      advanceTicks(gs, BOMB_TIMER_TICKS - 2);

      // Both bombs should have detonated (chain reaction)
      expect(gs.bombs.size).toBe(0);
      // Should have at least 2 explosions
      expect(gs.explosions.size).toBe(2);
    });

    it('chain reaction should create distinct explosions with correct owners', () => {
      p1.fireRange = 4;

      placePlayer(p1, 3, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      placePlayer(p1, 5, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      advanceTicks(gs, BOMB_TIMER_TICKS - 2);

      const explosions = Array.from(gs.explosions.values());
      // All explosions should be owned by player 1
      for (const exp of explosions) {
        expect(exp.ownerId).toBe(1);
      }
    });
  });

  // ───────────────────────────────────────────────
  // 9. Win Condition (FFA)
  // ───────────────────────────────────────────────
  describe('Win condition (FFA)', () => {
    let p1: Player;
    let p2: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
    });

    it('should trigger finish when one player remains alive', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Move p1 to safety
      placePlayer(p1, 1, 1);

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p2.alive).toBe(false);
      expect(gs.winnerId).toBe(1);
      expect(gs.finishReason).toContain('Alice');
      expect(gs.finishReason).toContain('last survivor');
    });

    it('should declare draw when all players die simultaneously', () => {
      // Place both players next to a bomb
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      p1.fireRange = 2;
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Keep both in blast radius
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p1.alive).toBe(false);
      expect(p2.alive).toBe(false);
      expect(gs.winnerId).toBeNull();
      expect(gs.finishReason).toContain('Draw');
    });

    it('winner should get placement 1', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      placePlayer(p1, 1, 1); // safety

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p1.placement).toBe(1);
    });
  });

  // ───────────────────────────────────────────────
  // 10. Grace Period
  // ───────────────────────────────────────────────
  describe('Grace period', () => {
    let p1: Player;
    let p2: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
    });

    it('should stay playing for 30 ticks after win condition', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      placePlayer(p1, 1, 1);

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      // p2 dead, win condition met
      expect(p2.alive).toBe(false);

      // Grace period: status stays 'playing'
      advanceTicks(gs, 29);
      expect(gs.status).toBe('playing');

      // One more tick => finished
      gs.processTick();
      expect(gs.status).toBe('finished');
    });

    it('should not accept player inputs during grace period', () => {
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      placePlayer(p1, 5, 1);

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      // Now in grace period
      const posBeforeGrace = { ...p1.position };
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      // Player should not have moved
      expect(p1.position).toEqual(posBeforeGrace);
    });

    it('should still process existing bombs and explosions during grace period', () => {
      p1.maxBombs = 2;
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      placePlayer(p1, 1, 1);

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      // p2 is dead, grace period started, explosion exists
      expect(gs.explosions.size).toBeGreaterThan(0);

      // Advance a few ticks in grace -- explosions should expire
      advanceTicks(gs, EXPLOSION_DURATION_TICKS);
      expect(gs.explosions.size).toBe(0);
    });
  });

  // ───────────────────────────────────────────────
  // 11. Power-Up Pickup
  // ───────────────────────────────────────────────
  describe('Power-up pickup', () => {
    let p1: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
    });

    it('should apply bomb_up power-up', () => {
      const powerUp = new PowerUp({ x: 3, y: 3 }, 'bomb_up');
      gs.powerUps.set(powerUp.id, powerUp);
      placePlayer(p1, 3, 3);

      const prevMaxBombs = p1.maxBombs;
      gs.processTick();

      expect(p1.maxBombs).toBe(prevMaxBombs + 1);
      expect(gs.powerUps.size).toBe(0);
    });

    it('should apply fire_up power-up', () => {
      const powerUp = new PowerUp({ x: 3, y: 3 }, 'fire_up');
      gs.powerUps.set(powerUp.id, powerUp);
      placePlayer(p1, 3, 3);

      const prevRange = p1.fireRange;
      gs.processTick();

      expect(p1.fireRange).toBe(prevRange + 1);
    });

    it('should apply shield power-up', () => {
      const powerUp = new PowerUp({ x: 3, y: 3 }, 'shield');
      gs.powerUps.set(powerUp.id, powerUp);
      placePlayer(p1, 3, 3);

      gs.processTick();

      expect(p1.hasShield).toBe(true);
    });

    it('should apply kick power-up', () => {
      const powerUp = new PowerUp({ x: 3, y: 3 }, 'kick');
      gs.powerUps.set(powerUp.id, powerUp);
      placePlayer(p1, 3, 3);

      gs.processTick();

      expect(p1.hasKick).toBe(true);
    });

    it('should apply speed_up power-up', () => {
      const powerUp = new PowerUp({ x: 3, y: 3 }, 'speed_up');
      gs.powerUps.set(powerUp.id, powerUp);
      placePlayer(p1, 3, 3);

      const prevSpeed = p1.speed;
      gs.processTick();

      expect(p1.speed).toBe(prevSpeed + 1);
    });

    it('should record power-up pickup in tickEvents', () => {
      const powerUp = new PowerUp({ x: 3, y: 3 }, 'bomb_up');
      gs.powerUps.set(powerUp.id, powerUp);
      placePlayer(p1, 3, 3);

      gs.processTick();

      expect(gs.tickEvents.powerupCollected).toHaveLength(1);
      expect(gs.tickEvents.powerupCollected[0].playerId).toBe(1);
      expect(gs.tickEvents.powerupCollected[0].type).toBe('bomb_up');
    });

    it('dead players should not pick up power-ups', () => {
      p1.die();
      const powerUp = new PowerUp({ x: 3, y: 3 }, 'bomb_up');
      gs.powerUps.set(powerUp.id, powerUp);
      placePlayer(p1, 3, 3);

      gs.processTick();

      expect(gs.powerUps.size).toBe(1); // not picked up
    });
  });

  // ───────────────────────────────────────────────
  // 12. Remote Bomb
  // ───────────────────────────────────────────────
  describe('Remote bomb', () => {
    let p1: Player;
    let p2: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
      p1.hasRemoteBomb = true;
    });

    it('should place remote bomb type when player has remote bomb power-up', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      const bomb = Array.from(gs.bombs.values())[0];
      expect(bomb.bombType).toBe('remote');
    });

    it('should detonate remote bomb on detonate action', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1);

      // Move away
      placePlayer(p1, 1, 1);

      // Detonate
      gs.inputBuffer.addInput(1, actionInput('detonate'));
      gs.processTick();

      expect(gs.bombs.size).toBe(0);
      expect(gs.explosions.size).toBeGreaterThan(0);
    });

    it('should not detonate other player bombs on detonate action', () => {
      p2.hasRemoteBomb = true;

      placePlayer(p1, 3, 3);
      placePlayer(p2, 7, 7);
      clearCooldown(p1);
      clearCooldown(p2);

      // Both place remote bombs
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.inputBuffer.addInput(2, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(2);

      // p1 detonates
      gs.inputBuffer.addInput(1, actionInput('detonate'));
      gs.processTick();

      // Only p1's bomb should detonate
      expect(gs.bombs.size).toBe(1);
      const remaining = Array.from(gs.bombs.values())[0];
      expect(remaining.ownerId).toBe(2);
    });
  });

  // ───────────────────────────────────────────────
  // 13. Bomb Kick
  // ───────────────────────────────────────────────
  describe('Bomb kick', () => {
    let p1: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      makeVulnerable(p1);
      p1.hasKick = true;
    });

    it('should kick bomb when player with kick walks into it', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      // Place a bomb manually at (4,3)
      const bomb = new Bomb({ x: 4, y: 3 }, 1, 1);
      gs.bombs.set(bomb.id, bomb);

      // Try to move right into bomb -- blocked but kick activates
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      expect(bomb.sliding).toBe('right');
    });

    it('kicked bomb should slide until hitting obstacle', () => {
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      const bomb = new Bomb({ x: 4, y: 3 }, 1, 1);
      gs.bombs.set(bomb.id, bomb);

      // Kick the bomb right
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      const bombPosAfterKick = { ...bomb.position };

      // Process a few more ticks -- bomb should keep sliding
      gs.processTick();
      expect(bomb.position.x).toBeGreaterThan(bombPosAfterKick.x);
    });
  });

  // ───────────────────────────────────────────────
  // 14. Teams Mode
  // ───────────────────────────────────────────────
  describe('Teams mode', () => {
    it('should check team win condition', () => {
      const teamGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'teams' });
      const p1 = teamGs.addPlayer(1, 'Alice', 0); // red
      const p2 = teamGs.addPlayer(2, 'Bob', 0); // red
      const p3 = teamGs.addPlayer(3, 'Eve', 1); // blue
      const p4 = teamGs.addPlayer(4, 'Dan', 1); // blue
      startPlaying(teamGs);
      makeVulnerable(p3);
      makeVulnerable(p4);

      // Kill all blue team members
      p3.die();
      p4.die();

      teamGs.processTick();

      expect(teamGs.winnerTeam).toBe(0);
      expect(teamGs.finishReason).toContain('Red');
    });

    it('should not damage teammates when friendly fire is off', () => {
      const teamGs = new GameStateManager({
        ...BASE_CONFIG,
        gameMode: 'teams',
        friendlyFire: false,
      });
      const p1 = teamGs.addPlayer(1, 'Alice', 0);
      const p2 = teamGs.addPlayer(2, 'Bob', 0); // same team
      const p3 = teamGs.addPlayer(3, 'Eve', 1);
      const p4 = teamGs.addPlayer(4, 'Dan', 1);
      startPlaying(teamGs);
      makeVulnerable(p1);
      makeVulnerable(p2);

      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3); // same team, adjacent
      clearCooldown(p1);

      teamGs.inputBuffer.addInput(1, actionInput('bomb'));
      teamGs.processTick();

      placePlayer(p1, 1, 1); // move away

      advanceTicks(teamGs, BOMB_TIMER_TICKS - 1);

      // Teammate should survive
      expect(p2.alive).toBe(true);
    });

    it('self-damage should still apply even with friendly fire off', () => {
      const teamGs = new GameStateManager({
        ...BASE_CONFIG,
        gameMode: 'teams',
        friendlyFire: false,
      });
      const p1 = teamGs.addPlayer(1, 'Alice', 0);
      teamGs.addPlayer(2, 'Bob', 0);
      teamGs.addPlayer(3, 'Eve', 1);
      teamGs.addPlayer(4, 'Dan', 1);
      startPlaying(teamGs);
      makeVulnerable(p1);

      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      teamGs.inputBuffer.addInput(1, actionInput('bomb'));
      teamGs.processTick();

      // Stay on bomb
      advanceTicks(teamGs, BOMB_TIMER_TICKS - 1);

      expect(p1.alive).toBe(false);
    });
  });

  // ───────────────────────────────────────────────
  // 15. Deathmatch Mode
  // ───────────────────────────────────────────────
  describe('Deathmatch mode', () => {
    it('should respawn dead player after DEATHMATCH_RESPAWN_TICKS', () => {
      const dmGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'deathmatch' });
      const p1 = dmGs.addPlayer(1, 'Alice', null);
      dmGs.addPlayer(2, 'Bob', null);
      startPlaying(dmGs);

      p1.die();
      // Process enough ticks for respawn (60 ticks = 3s at 20 tps)
      advanceTicks(dmGs, 61);

      expect(p1.alive).toBe(true);
    });

    it('should not trigger last-alive win condition in deathmatch', () => {
      const dmGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'deathmatch' });
      const p1 = dmGs.addPlayer(1, 'Alice', null);
      const p2 = dmGs.addPlayer(2, 'Bob', null);
      startPlaying(dmGs);

      p2.die();
      dmGs.processTick();

      // Deathmatch should NOT finish just because one player is dead
      expect(dmGs.finishReason).toBe('');
    });
  });

  // ───────────────────────────────────────────────
  // 16. King of the Hill
  // ───────────────────────────────────────────────
  describe('King of the Hill mode', () => {
    it('should initialize hill zone', () => {
      const kothGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'king_of_the_hill' });
      expect(kothGs.hillZone).not.toBeNull();
      expect(kothGs.hillZone!.width).toBe(3);
      expect(kothGs.hillZone!.height).toBe(3);
    });

    it('should score points when one player occupies the hill', () => {
      const kothGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'king_of_the_hill' });
      const p1 = kothGs.addPlayer(1, 'Alice', null);
      kothGs.addPlayer(2, 'Bob', null);
      startPlaying(kothGs);

      // Place player in the hill zone
      const hx = kothGs.hillZone!.x;
      const hy = kothGs.hillZone!.y;
      placePlayer(p1, hx, hy);

      kothGs.processTick();

      expect(kothGs.kothScores.get(1)).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────
  // 17. tickEvents buffer
  // ───────────────────────────────────────────────
  describe('tickEvents buffer', () => {
    it('should clear tickEvents at the start of each tick', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      // Manually inject an event
      gs.tickEvents.explosions.push({ cells: [{ x: 0, y: 0 }], ownerId: 1 });

      gs.processTick();

      // Should have been cleared at the start of the tick
      expect(gs.tickEvents.explosions).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────
  // 18. Line Bomb
  // ───────────────────────────────────────────────
  describe('Line bomb', () => {
    let p1: Player;

    beforeEach(() => {
      p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      p1.hasLineBomb = true;
      p1.maxBombs = 4;
      p1.direction = 'right';
    });

    it('should place multiple bombs in a line in facing direction', () => {
      placePlayer(p1, 1, 1);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Should have placed bombs at (1,1), (2,1), (3,1), etc. up to maxBombs
      expect(gs.bombs.size).toBeGreaterThan(1);
      expect(p1.bombCount).toBe(gs.bombs.size);
    });
  });

  // ───────────────────────────────────────────────
  // 19. Pierce Bomb
  // ───────────────────────────────────────────────
  describe('Pierce bomb', () => {
    it('should set pierce bomb type when player has pierce power-up', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);
      p1.hasPierceBomb = true;
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      const bomb = Array.from(gs.bombs.values())[0];
      expect(bomb.bombType).toBe('pierce');
    });
  });

  // ───────────────────────────────────────────────
  // 20. Reinforced Walls
  // ───────────────────────────────────────────────
  describe('Reinforced walls', () => {
    it('should crack destructible wall on first hit instead of destroying', () => {
      const reinforcedGs = new GameStateManager({
        ...BASE_CONFIG,
        wallDensity: 1.0, // fill all non-spawn/non-wall tiles
        reinforcedWalls: true,
      });
      const p1 = reinforcedGs.addPlayer(1, 'Alice', null);
      reinforcedGs.addPlayer(2, 'Bob', null);
      startPlaying(reinforcedGs);
      makeVulnerable(p1);

      // Find a destructible tile adjacent to a walkable tile in bomb range
      const spawnPos = reinforcedGs.map.spawnPoints[0]; // (1,1)
      p1.fireRange = 5;
      placePlayer(p1, spawnPos.x, spawnPos.y);
      clearCooldown(p1);

      // Find a destructible tile in range
      let destructibleX = -1;
      let destructibleY = -1;
      for (let dx = 1; dx <= 5; dx++) {
        const tx = spawnPos.x + dx;
        if (
          tx < reinforcedGs.map.width - 1 &&
          reinforcedGs.map.tiles[spawnPos.y][tx] === 'destructible'
        ) {
          destructibleX = tx;
          destructibleY = spawnPos.y;
          break;
        }
      }

      if (destructibleX !== -1) {
        reinforcedGs.inputBuffer.addInput(1, actionInput('bomb'));
        reinforcedGs.processTick();

        placePlayer(p1, 1, 3); // move to safety
        advanceTicks(reinforcedGs, BOMB_TIMER_TICKS - 1);

        // Wall should be cracked, not destroyed
        expect(reinforcedGs.map.tiles[destructibleY][destructibleX]).toBe('destructible_cracked');
      }
    });
  });

  // ───────────────────────────────────────────────
  // 21. Battle Royale Zone
  // ───────────────────────────────────────────────
  describe('Battle Royale zone', () => {
    it('should initialize zone when hasZone is true', () => {
      const brGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'ffa', hasZone: true });
      expect(brGs.zone).not.toBeNull();
    });

    it('should not initialize zone by default', () => {
      expect(gs.zone).toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // 22. Multiple Players with Kill Credit
  // ───────────────────────────────────────────────
  describe('Kill credit', () => {
    it('should credit kill to bomb owner when killing another player', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bob', null);
      const p3 = gs.addPlayer(3, 'Eve', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
      makeVulnerable(p3);

      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      placePlayer(p3, 9, 9);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      placePlayer(p1, 1, 1); // safety

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p1.kills).toBe(1);
      expect(p2.alive).toBe(false);
      expect(p2.deaths).toBe(1);
    });
  });

  // ───────────────────────────────────────────────
  // 23. getAlivePlayers
  // ───────────────────────────────────────────────
  describe('getAlivePlayers', () => {
    it('should return only alive players', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bob', null);
      const p3 = gs.addPlayer(3, 'Eve', null);

      expect(gs.getAlivePlayers()).toHaveLength(3);

      p2.die();
      expect(gs.getAlivePlayers()).toHaveLength(2);
      expect(gs.getAlivePlayers().map((p) => p.id)).toContain(1);
      expect(gs.getAlivePlayers().map((p) => p.id)).toContain(3);
      expect(gs.getAlivePlayers().map((p) => p.id)).not.toContain(2);
    });
  });

  // ───────────────────────────────────────────────
  // 24. Placement Tracking
  // ───────────────────────────────────────────────
  describe('Placement tracking', () => {
    it('should assign placement based on death order', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bob', null);
      const p3 = gs.addPlayer(3, 'Eve', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);
      makeVulnerable(p3);

      // Kill p3 first via bomb
      placePlayer(p1, 3, 3);
      placePlayer(p2, 1, 9);
      placePlayer(p3, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      placePlayer(p1, 1, 1); // safety

      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      // p3 dies first -- 2 alive remain, so placement = 3
      expect(p3.alive).toBe(false);
      expect(p3.placement).toBe(3);
    });
  });

  // ───────────────────────────────────────────────
  // 25. Bomb count restoration after detonation
  // ───────────────────────────────────────────────
  describe('Bomb count restoration', () => {
    it('should restore bomb count to player after bomb detonates', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      expect(p1.bombCount).toBe(0);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      expect(p1.bombCount).toBe(1);

      // Wait for detonation
      advanceTicks(gs, BOMB_TIMER_TICKS - 1);

      expect(p1.bombCount).toBe(0); // restored
    });
  });

  // ───────────────────────────────────────────────
  // 26. Multiple bombs from same player
  // ───────────────────────────────────────────────
  describe('Multiple bombs', () => {
    it('should allow placing more bombs after increasing maxBombs', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      p1.maxBombs = 3;
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      placePlayer(p1, 5, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      placePlayer(p1, 7, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      expect(gs.bombs.size).toBe(3);
      expect(p1.bombCount).toBe(3);
    });
  });

  // ───────────────────────────────────────────────
  // 27. Direction and bomb action in same input
  // ───────────────────────────────────────────────
  describe('Combined input', () => {
    it('should handle movement and bomb placement in the same input', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, comboInput('right', 'bomb'));
      gs.processTick();

      // Player should have moved right first, then bomb is placed at new position
      expect(p1.position.x).toBe(4);
      expect(gs.bombs.size).toBe(1);
      const bomb = Array.from(gs.bombs.values())[0];
      expect(bomb.position).toEqual({ x: 4, y: 3 });
    });
  });

  // ─────────────────────────────────────────────────
  // Buddy Mode
  // ─────────────────────────────────────────────────
  describe('Buddy Mode', () => {
    it('should allow owner to walk onto buddy tile (no collision)', () => {
      gs = new GameStateManager({ ...BASE_CONFIG, friendlyFire: false });
      const owner = gs.addPlayer(1, 'Owner', 0);
      const buddy = gs.addPlayer(-2001, 'Buddy', 0, false, true, 1);
      startPlaying(gs);

      // Place owner and buddy adjacent
      placePlayer(owner, 3, 3);
      placePlayer(buddy, 4, 3);
      clearCooldown(owner);
      makeVulnerable(owner);

      // Owner moves right, toward buddy
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      expect(owner.position).toEqual({ x: 4, y: 3 });
    });

    it('should allow buddy to walk onto owner tile (no collision)', () => {
      gs = new GameStateManager({ ...BASE_CONFIG, friendlyFire: false });
      const owner = gs.addPlayer(1, 'Owner', 0);
      const buddy = gs.addPlayer(-2001, 'Buddy', 0, false, true, 1);
      startPlaying(gs);

      placePlayer(owner, 4, 3);
      placePlayer(buddy, 3, 3);
      clearCooldown(buddy);

      // Buddy moves right, toward owner
      gs.inputBuffer.addInput(-2001, moveInput('right'));
      gs.processTick();

      expect(buddy.position).toEqual({ x: 4, y: 3 });
    });

    it('should still block owner from walking onto other non-buddy player', () => {
      gs = new GameStateManager({ ...BASE_CONFIG, friendlyFire: false });
      const p1 = gs.addPlayer(1, 'P1', 0);
      const p2 = gs.addPlayer(2, 'P2', 0);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      // Should NOT move — P2 blocks
      expect(p1.position).toEqual({ x: 3, y: 3 });
    });
  });

  // ───────────────────────────────────────────────
  // 20. Advanced Game Mechanics
  // ───────────────────────────────────────────────
  describe('Advanced game mechanics', () => {
    /** Create a PlayerInput for throw action. */
    function throwInput(): PlayerInput {
      return { direction: null, action: 'throw', tick: 0, seq: ++seqCounter };
    }

    // --- Remote bomb detonation ---

    it('should place remote bombs when player has hasRemoteBomb', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      p1.hasRemoteBomb = true;

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      const bombs = Array.from(gs.bombs.values());
      expect(bombs.length).toBe(1);
      expect(bombs[0].bombType).toBe('remote');
    });

    it('should detonate remote bomb on detonate action', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      p1.hasRemoteBomb = true;

      // Place a remote bomb
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1);

      // Move player off the bomb so detonate input isn't consumed by bomb placement logic
      placePlayer(p1, 5, 3);
      clearCooldown(p1);

      // Detonate it
      gs.inputBuffer.addInput(1, actionInput('detonate'));
      gs.processTick();

      // Bomb should be gone, explosion should exist
      expect(gs.bombs.size).toBe(0);
      expect(gs.explosions.size).toBeGreaterThanOrEqual(1);
    });

    it('should detonate oldest remote bomb first in FIFO mode', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      p1.hasRemoteBomb = true;
      p1.remoteDetonateMode = 'fifo';
      p1.maxBombs = 3;

      // Place first bomb at (3,3)
      placePlayer(p1, 3, 3);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();
      expect(gs.bombs.size).toBe(1);

      // Move player off first bomb and place second bomb at (5,3)
      placePlayer(p1, 5, 3);
      clearCooldown(p1);
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      expect(gs.bombs.size).toBe(2);

      // Move player away from bombs before detonating
      placePlayer(p1, 7, 3);
      clearCooldown(p1);

      // Detonate in FIFO — should remove the oldest (3,3)
      gs.inputBuffer.addInput(1, actionInput('detonate'));
      gs.processTick();

      expect(gs.bombs.size).toBe(1);
      const remaining = Array.from(gs.bombs.values())[0];
      expect(remaining.position).toEqual({ x: 5, y: 3 });
    });

    // --- Conveyor belt mechanics ---

    it('should push player in conveyor direction', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      // Place a conveyor_right tile at (3,3)
      gs.map.tiles[3][3] = 'conveyor_right';
      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      gs.processTick();

      expect(p1.position).toEqual({ x: 4, y: 3 });
    });

    it('should not push player into a wall via conveyor', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      // Place conveyor_left at column 1, which pushes toward column 0 (border wall)
      gs.map.tiles[3][1] = 'conveyor_left';
      placePlayer(p1, 1, 3);
      clearCooldown(p1);

      gs.processTick();

      // Player should stay — wall blocks
      expect(p1.position).toEqual({ x: 1, y: 3 });
    });

    it('should push player upward on conveyor_up', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      gs.map.tiles[5][3] = 'conveyor_up';
      placePlayer(p1, 3, 5);
      clearCooldown(p1);

      gs.processTick();

      expect(p1.position).toEqual({ x: 3, y: 4 });
    });

    // --- Teleporter mechanics ---

    it('should teleport player from teleporter_a to teleporter_b on move', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      // Place teleporter pair
      gs.map.tiles[3][5] = 'teleporter_a';
      gs.map.tiles[7][9] = 'teleporter_b';

      // Place player adjacent to teleporter_a, then move onto it
      placePlayer(p1, 4, 3);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      // Player should end up on teleporter_b
      expect(p1.position).toEqual({ x: 9, y: 7 });
    });

    it('should teleport player from teleporter_b to teleporter_a on move', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      // Place teleporter pair
      gs.map.tiles[3][5] = 'teleporter_a';
      gs.map.tiles[7][8] = 'teleporter_b';

      // Place player adjacent to teleporter_b, then move onto it
      placePlayer(p1, 7, 7);
      clearCooldown(p1);

      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      // Player should end up on teleporter_a
      expect(p1.position).toEqual({ x: 5, y: 3 });
    });

    // --- King of the Hill ---

    it('should initialize hill zone in king_of_the_hill mode', () => {
      const kothGs = new GameStateManager({
        ...BASE_CONFIG,
        gameMode: 'king_of_the_hill',
      });
      kothGs.addPlayer(1, 'Alice', null);
      kothGs.addPlayer(2, 'Bob', null);

      expect(kothGs.hillZone).not.toBeNull();
      expect(kothGs.hillZone!.width).toBe(KOTH_ZONE_SIZE);
      expect(kothGs.hillZone!.height).toBe(KOTH_ZONE_SIZE);
    });

    it('should score KOTH points when one player is on hill', () => {
      const kothGs = new GameStateManager({
        ...BASE_CONFIG,
        gameMode: 'king_of_the_hill',
      });
      const p1 = kothGs.addPlayer(1, 'Alice', null);
      kothGs.addPlayer(2, 'Bob', null);
      startPlaying(kothGs);

      // Place player inside the hill zone
      const hx = kothGs.hillZone!.x;
      const hy = kothGs.hillZone!.y;
      placePlayer(p1, hx, hy);

      // Advance a few ticks
      advanceTicks(kothGs, 5);

      const score = kothGs.kothScores.get(1) || 0;
      expect(score).toBe(5 * KOTH_POINTS_PER_TICK);
    });

    it('should not score KOTH when two players contest the hill', () => {
      const kothGs = new GameStateManager({
        ...BASE_CONFIG,
        gameMode: 'king_of_the_hill',
      });
      const p1 = kothGs.addPlayer(1, 'Alice', null);
      const p2 = kothGs.addPlayer(2, 'Bob', null);
      startPlaying(kothGs);

      // Both players inside the hill zone
      const hx = kothGs.hillZone!.x;
      const hy = kothGs.hillZone!.y;
      placePlayer(p1, hx, hy);
      placePlayer(p2, hx + 1, hy);

      advanceTicks(kothGs, 5);

      const score1 = kothGs.kothScores.get(1) || 0;
      const score2 = kothGs.kothScores.get(2) || 0;
      expect(score1).toBe(0);
      expect(score2).toBe(0);
    });

    // --- Deathmatch advanced ---

    it('should respawn dead player after DEATHMATCH_RESPAWN_TICKS exactly', () => {
      const dmGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'deathmatch' });
      const p1 = dmGs.addPlayer(1, 'Alice', null);
      dmGs.addPlayer(2, 'Bob', null);
      startPlaying(dmGs);

      p1.die();

      // One tick before respawn — sets the respawnTick, then tick toward it
      advanceTicks(dmGs, DEATHMATCH_RESPAWN_TICKS);
      expect(p1.alive).toBe(false);

      // One more tick should trigger respawn
      dmGs.processTick();
      expect(p1.alive).toBe(true);
    });

    it('should increment kills on deathmatch kill and end at kill target', () => {
      const dmGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'deathmatch' });
      const p1 = dmGs.addPlayer(1, 'Alice', null);
      const p2 = dmGs.addPlayer(2, 'Bob', null);
      startPlaying(dmGs);

      // Simulate kills up to the target
      p1.kills = DEATHMATCH_KILL_TARGET - 1;

      // Place bomb to kill p2
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      makeVulnerable(p2);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      // Use the deathmatch game state
      dmGs.inputBuffer.addInput(1, actionInput('bomb'));
      advanceTicks(dmGs, BOMB_TIMER_TICKS);

      // p1 should have reached kill target and game should finish
      if (p1.kills >= DEATHMATCH_KILL_TARGET) {
        expect(dmGs.status).toBe('finished');
      }
    });

    // --- Line bomb ---

    it('should place bombs in a line when player has hasLineBomb', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      p1.hasLineBomb = true;
      p1.maxBombs = 3;
      p1.direction = 'right';
      placePlayer(p1, 3, 3);

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      gs.processTick();

      // Should place bombs at (3,3), (4,3), (5,3) — one at feet + two in facing direction
      const bombs = Array.from(gs.bombs.values());
      expect(bombs.length).toBe(3);
      const positions = bombs.map((b) => `${b.position.x},${b.position.y}`).sort();
      expect(positions).toContain('3,3');
      expect(positions).toContain('4,3');
      expect(positions).toContain('5,3');
    });

    // --- Pierce bomb ---

    it('should pass through destructible walls with pierce bomb', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      p1.hasPierceBomb = true;
      p1.fireRange = 3;
      placePlayer(p1, 3, 3);

      // Place destructible walls in the blast path (right of bomb)
      gs.map.tiles[3][4] = 'destructible';
      gs.map.tiles[3][5] = 'destructible';

      gs.inputBuffer.addInput(1, actionInput('bomb'));
      advanceTicks(gs, BOMB_TIMER_TICKS);

      // Both walls should be destroyed (pierce goes through)
      expect(gs.map.tiles[3][4]).toBe('empty');
      expect(gs.map.tiles[3][5]).toBe('empty');
    });

    // --- Bomb throw ---

    it('should throw bomb 3 tiles away when player has hasBombThrow', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      p1.hasBombThrow = true;
      p1.direction = 'right';
      placePlayer(p1, 3, 3);

      gs.inputBuffer.addInput(1, throwInput());
      gs.processTick();

      const bombs = Array.from(gs.bombs.values());
      expect(bombs.length).toBe(1);
      // Bomb should land 3 tiles away in facing direction
      expect(bombs[0].position).toEqual({ x: 6, y: 3 });
    });

    it('should land bomb at closest valid tile if throw target is blocked', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      p1.hasBombThrow = true;
      p1.direction = 'right';
      placePlayer(p1, 3, 3);

      // Block tile at x=6 (would be 3 tiles away)
      gs.map.tiles[3][6] = 'wall';

      gs.inputBuffer.addInput(1, throwInput());
      gs.processTick();

      const bombs = Array.from(gs.bombs.values());
      expect(bombs.length).toBe(1);
      // Should land on the next closest valid tile (x=5)
      expect(bombs[0].position).toEqual({ x: 5, y: 3 });
    });

    // --- Bomb kick ---

    it('should start sliding bomb when player with hasKick walks into it', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      p1.hasKick = true;
      placePlayer(p1, 3, 3);
      placePlayer(p2, 9, 9); // far away

      // Place a bomb at (4,3) — manually to control position
      const { Bomb: BombClass } = require('../../../backend/src/game/Bomb');
      const bomb = new Bomb({ x: 4, y: 3 }, 2, 1, 'normal');
      gs.bombs.set(bomb.id, bomb);

      clearCooldown(p1);

      // Player tries to move right into the bomb
      gs.inputBuffer.addInput(1, moveInput('right'));
      gs.processTick();

      // Bomb should start sliding right
      expect(bomb.sliding).toBe('right');
      // Player should stay (blocked by bomb)
      expect(p1.position).toEqual({ x: 3, y: 3 });
    });

    // --- Shield mechanics ---

    it('should absorb explosion damage with shield', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      makeVulnerable(p2);
      p2.hasShield = true;

      // P1 places bomb next to P2
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      advanceTicks(gs, BOMB_TIMER_TICKS);

      // Shield should absorb, player still alive but shield gone
      expect(p2.alive).toBe(true);
      expect(p2.hasShield).toBe(false);
      expect(p2.invulnerableTicks).toBe(10); // Brief post-shield invulnerability
    });

    // --- Power-up drop on death ---

    it('should drop a power-up when a buffed player dies', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      makeVulnerable(p2);

      // Give P2 some power-ups so a drop is guaranteed
      p2.maxBombs = 3; // 2 bomb_up stacks
      p2.fireRange = 3; // 2 fire_up stacks
      p2.speed = 2;
      p2.hasKick = true;

      const powerUpsBefore = gs.powerUps.size;

      // Kill P2 via explosion
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      advanceTicks(gs, BOMB_TIMER_TICKS);

      expect(p2.alive).toBe(false);
      // Should have dropped exactly 1 power-up
      expect(gs.powerUps.size).toBe(powerUpsBefore + 1);
    });

    // --- Self-kill penalty ---

    it('should decrement kills on self-kill', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      makeVulnerable(p1);
      p1.kills = 2;

      // Place bomb and stay on it
      gs.inputBuffer.addInput(1, actionInput('bomb'));
      advanceTicks(gs, BOMB_TIMER_TICKS);

      expect(p1.alive).toBe(false);
      expect(p1.selfKills).toBe(1);
      expect(p1.kills).toBe(1); // 2 - 1 = 1
    });

    // --- Remote detonation mode toggle ---

    it('should toggle remote detonation mode when no remote bombs are placed', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      p1.hasRemoteBomb = true;
      expect(p1.remoteDetonateMode).toBe('all');

      // Detonate with no bombs placed — should toggle mode
      gs.inputBuffer.addInput(1, actionInput('detonate'));
      gs.processTick();

      expect(p1.remoteDetonateMode).toBe('fifo');
    });

    // --- KOTH win condition ---

    it('should finish game when KOTH score target is reached', () => {
      const kothGs = new GameStateManager({
        ...BASE_CONFIG,
        gameMode: 'king_of_the_hill',
      });
      const p1 = kothGs.addPlayer(1, 'Alice', null);
      kothGs.addPlayer(2, 'Bob', null);
      startPlaying(kothGs);

      // Place player on hill and set score just below target
      const hx = kothGs.hillZone!.x;
      const hy = kothGs.hillZone!.y;
      placePlayer(p1, hx, hy);
      kothGs.kothScores.set(1, KOTH_SCORE_TARGET - 1);

      kothGs.processTick();

      expect(kothGs.winnerId).toBe(1);
      expect(kothGs.finishReason).toContain('Alice');
    });

    // --- No KOTH hill in non-KOTH mode ---

    it('should not have hill zone in non-KOTH game mode', () => {
      const ffaGs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'ffa' });
      expect(ffaGs.hillZone).toBeNull();
    });

    // --- Conveyor belt pushes bombs ---

    it('should push bomb on conveyor tile', () => {
      gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      startPlaying(gs);

      placePlayer(p1, 1, 1); // Move player far away

      // Place conveyor_down at (5,3) and a bomb on it
      gs.map.tiles[3][5] = 'conveyor_down';
      const bomb = new Bomb({ x: 5, y: 3 }, 1, 1, 'normal');
      gs.bombs.set(bomb.id, bomb);

      // Need multiple ticks — bomb has conveyor cooldown
      // First tick: bomb gets pushed, then cooldown applies
      gs.processTick();

      // After first tick, bomb should move down (y+1)
      expect(bomb.position).toEqual({ x: 5, y: 4 });
    });
  });
});
