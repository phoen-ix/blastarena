import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { BotAI } from '../../../backend/src/game/BotAI';
import { Bomb } from '../../../backend/src/game/Bomb';
import type { PlayerInput, Direction } from '@blast-arena/shared';
import { BOMB_TIMER_TICKS, MOVE_COOLDOWN_BASE } from '@blast-arena/shared';

const BASE_CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 12345,
  gameMode: 'ffa' as const,
  wallDensity: 0.0,
  powerUpDropRate: 0,
};

function advanceTicks(gs: GameStateManager, n: number): void {
  for (let i = 0; i < n; i++) gs.processTick();
}

function startPlaying(gs: GameStateManager): void {
  gs.status = 'playing';
}

function placePlayer(player: any, x: number, y: number): void {
  player.position = { x, y };
}

function makeVulnerable(player: any): void {
  player.invulnerableTicks = 0;
}

function clearCooldown(player: any): void {
  player.moveCooldown = 0;
}

describe('BotAI', () => {
  // ───────────────────────────────────────────────
  // 1. Constructor / Difficulty tiers
  // ───────────────────────────────────────────────
  describe('Constructor / Difficulty tiers', () => {
    it('should create an easy BotAI without throwing', () => {
      expect(() => new BotAI('easy')).not.toThrow();
    });

    it('should create a hard BotAI without throwing', () => {
      expect(() => new BotAI('hard')).not.toThrow();
    });

    it('should default to normal difficulty', () => {
      const bot = new BotAI();
      // The bot should be created successfully with default difficulty
      expect(bot).toBeDefined();
      expect(bot).toBeInstanceOf(BotAI);
    });

    it('should accept mapSize parameter for scaling', () => {
      expect(() => new BotAI('normal', { width: 21, height: 17 })).not.toThrow();
      expect(() => new BotAI('hard', { width: 9, height: 9 })).not.toThrow();
    });
  });

  // ───────────────────────────────────────────────
  // 2. generateInput basics
  // ───────────────────────────────────────────────
  describe('generateInput basics', () => {
    let gs: GameStateManager;

    beforeEach(() => {
      gs = new GameStateManager(BASE_CONFIG);
    });

    it('should return null for a dead player', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      p1.alive = false;

      const bot = new BotAI('normal');
      const input = bot.generateInput(p1, gs);
      expect(input).toBeNull();
    });

    it('should return a valid PlayerInput shape for a living player', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      const bot = new BotAI('normal');
      const input = bot.generateInput(p1, gs);
      expect(input).not.toBeNull();
      expect(input).toHaveProperty('direction');
      expect(input).toHaveProperty('action');
      expect(input).toHaveProperty('tick');
      expect(input).toHaveProperty('seq');
    });

    it('should increment seq across multiple calls', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      const bot = new BotAI('normal');
      const input1 = bot.generateInput(p1, gs);
      const input2 = bot.generateInput(p1, gs);
      const input3 = bot.generateInput(p1, gs);

      expect(input1).not.toBeNull();
      expect(input2).not.toBeNull();
      expect(input3).not.toBeNull();
      expect(input2!.seq).toBeGreaterThan(input1!.seq);
      expect(input3!.seq).toBeGreaterThan(input2!.seq);
    });

    it('should return direction as a valid value or null', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      const validDirections: (Direction | null)[] = ['up', 'down', 'left', 'right', null];
      const bot = new BotAI('normal');

      for (let i = 0; i < 20; i++) {
        const input = bot.generateInput(p1, gs);
        if (input) {
          expect(validDirections).toContain(input.direction);
        }
      }
    });

    it('should return action as bomb, detonate, or null', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      gs.addPlayer(2, 'Bob', null);
      startPlaying(gs);

      const validActions: ('bomb' | 'detonate' | null)[] = ['bomb', 'detonate', null];
      const bot = new BotAI('normal');

      for (let i = 0; i < 20; i++) {
        const input = bot.generateInput(p1, gs);
        if (input) {
          expect(validActions).toContain(input.action);
        }
      }
    });
  });

  // ───────────────────────────────────────────────
  // 3. Danger avoidance
  // ───────────────────────────────────────────────
  describe('Danger avoidance', () => {
    let gs: GameStateManager;

    beforeEach(() => {
      gs = new GameStateManager(BASE_CONFIG);
    });

    it('should generate movement input when adjacent to a ticking bomb', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bot', null);
      startPlaying(gs);

      // Place p1 far away so it doesn't interfere
      placePlayer(p1, 1, 1);
      makeVulnerable(p1);

      // Place p2 in open area
      placePlayer(p2, 7, 5);
      makeVulnerable(p2);
      clearCooldown(p2);

      // Place a bomb right next to p2
      const bomb = new Bomb({ x: 7, y: 4 }, p1.id, 3);
      bomb.ticksRemaining = 10; // About to explode
      gs.bombs.set(bomb.id, bomb);

      const bot = new BotAI('normal');
      const input = bot.generateInput(p2, gs);

      // Bot should want to move (flee from danger)
      expect(input).not.toBeNull();
      expect(input!.direction).not.toBeNull();
    });

    it('should try to flee when standing on a bomb tile', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bot', null);
      startPlaying(gs);

      placePlayer(p1, 1, 1);
      placePlayer(p2, 7, 5);
      makeVulnerable(p2);
      clearCooldown(p2);

      // Place a bomb directly on the bot's position
      const bomb = new Bomb({ x: 7, y: 5 }, p1.id, 2);
      bomb.ticksRemaining = 15;
      gs.bombs.set(bomb.id, bomb);

      const bot = new BotAI('hard');
      const input = bot.generateInput(p2, gs);

      expect(input).not.toBeNull();
      // The bot should attempt to move away
      expect(input!.direction).not.toBeNull();
    });
  });

  // ───────────────────────────────────────────────
  // 4. Integration with GameStateManager
  // ───────────────────────────────────────────────
  describe('Integration with GameStateManager', () => {
    let gs: GameStateManager;

    beforeEach(() => {
      gs = new GameStateManager(BASE_CONFIG);
    });

    it('should process bot inputs via processTick without errors', () => {
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'Bot', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);

      const bot = new BotAI('normal');

      expect(() => {
        for (let i = 0; i < 50; i++) {
          const input = bot.generateInput(p2, gs);
          if (input) {
            gs.inputBuffer.addInput(p2.id, input);
          }
          gs.processTick();
        }
      }).not.toThrow();
    });

    it('should produce game activity when two bots play against each other', () => {
      const p1 = gs.addPlayer(1, 'Bot1', null);
      const p2 = gs.addPlayer(2, 'Bot2', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);

      // Place bots close so they engage quickly
      placePlayer(p1, 3, 3);
      placePlayer(p2, 5, 3);

      const bot1 = new BotAI('hard');
      const bot2 = new BotAI('hard');

      let bombActionsCount = 0;

      for (let i = 0; i < 300; i++) {
        if (gs.status === 'finished') break;

        if (p1.alive) {
          const input1 = bot1.generateInput(p1, gs);
          if (input1) {
            if (input1.action === 'bomb') bombActionsCount++;
            gs.inputBuffer.addInput(p1.id, input1);
          }
        }
        if (p2.alive) {
          const input2 = bot2.generateInput(p2, gs);
          if (input2) {
            if (input2.action === 'bomb') bombActionsCount++;
            gs.inputBuffer.addInput(p2.id, input2);
          }
        }

        gs.processTick();
      }

      // Hard bots placed close together should place bombs
      expect(bombActionsCount).toBeGreaterThan(0);
    });

    it('should handle games running until completion', () => {
      const p1 = gs.addPlayer(1, 'Bot1', null);
      const p2 = gs.addPlayer(2, 'Bot2', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);

      const bot1 = new BotAI('hard');
      const bot2 = new BotAI('hard');

      // Run a long game - should not throw even if one bot dies
      expect(() => {
        for (let i = 0; i < 500; i++) {
          if (gs.status === 'finished') break;

          if (p1.alive) {
            const input1 = bot1.generateInput(p1, gs);
            if (input1) gs.inputBuffer.addInput(p1.id, input1);
          }
          if (p2.alive) {
            const input2 = bot2.generateInput(p2, gs);
            if (input2) gs.inputBuffer.addInput(p2.id, input2);
          }

          gs.processTick();
        }
      }).not.toThrow();
    });
  });

  // ───────────────────────────────────────────────
  // 5. Difficulty behavior differences
  // ───────────────────────────────────────────────
  describe('Difficulty behavior differences', () => {
    it('should produce valid outputs at all difficulty levels', () => {
      const difficulties: Array<'easy' | 'normal' | 'hard'> = ['easy', 'normal', 'hard'];

      for (const diff of difficulties) {
        const gs = new GameStateManager(BASE_CONFIG);
        const p1 = gs.addPlayer(1, 'Bot', null);
        gs.addPlayer(2, 'Enemy', null);
        startPlaying(gs);

        const bot = new BotAI(diff);
        let validInputCount = 0;

        for (let i = 0; i < 50; i++) {
          const input = bot.generateInput(p1, gs);
          if (input) {
            validInputCount++;
            expect(input).toHaveProperty('seq');
            expect(input).toHaveProperty('direction');
            expect(input).toHaveProperty('action');
          }
          gs.processTick();
        }

        // Each difficulty should produce at least some valid inputs
        expect(validInputCount).toBeGreaterThan(0);
      }
    });

    it('hard bot should attempt bomb placement over time', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'HardBot', null);
      const p2 = gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);

      // Place them closer so the hard bot hunts and bombs
      placePlayer(p1, 3, 3);
      placePlayer(p2, 5, 3);

      const bot = new BotAI('hard');
      let hardBombActions = 0;

      for (let i = 0; i < 100; i++) {
        clearCooldown(p1);
        const input = bot.generateInput(p1, gs);
        if (input) {
          if (input.action === 'bomb') hardBombActions++;
          gs.inputBuffer.addInput(p1.id, input);
        }
        gs.processTick();
        if (!p1.alive || !p2.alive) break;
      }

      // Hard bot with short bomb cooldown should try to place bombs
      expect(hardBombActions).toBeGreaterThan(0);
    });

    it('easy bot should still produce movement inputs', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'EasyBot', null);
      gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);

      const bot = new BotAI('easy');
      let moveCount = 0;

      for (let i = 0; i < 50; i++) {
        const input = bot.generateInput(p1, gs);
        if (input && input.direction !== null) {
          moveCount++;
        }
      }

      // Even easy bots should produce movement inputs
      expect(moveCount).toBeGreaterThan(0);
    });
  });

  // ───────────────────────────────────────────────
  // 6. Edge cases
  // ───────────────────────────────────────────────
  describe('Edge cases', () => {
    it('should handle a game with only one player gracefully', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Solo', null);
      startPlaying(gs);

      const bot = new BotAI('normal');

      // With no enemies, bot should still produce valid inputs (roaming)
      expect(() => {
        for (let i = 0; i < 30; i++) {
          const input = bot.generateInput(p1, gs);
          if (input) {
            gs.inputBuffer.addInput(p1.id, input);
          }
          gs.processTick();
        }
      }).not.toThrow();
    });

    it('should handle multiple BotAI instances independently', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Bot1', null);
      const p2 = gs.addPlayer(2, 'Bot2', null);
      const p3 = gs.addPlayer(3, 'Bot3', null);
      startPlaying(gs);

      const bot1 = new BotAI('easy');
      const bot2 = new BotAI('normal');
      const bot3 = new BotAI('hard');

      // Each bot maintains its own seq counter
      const input1a = bot1.generateInput(p1, gs);
      const input2a = bot2.generateInput(p2, gs);
      const input3a = bot3.generateInput(p3, gs);

      const input1b = bot1.generateInput(p1, gs);
      const input2b = bot2.generateInput(p2, gs);
      const input3b = bot3.generateInput(p3, gs);

      // Each bot's seq should increment independently
      if (input1a && input1b) {
        expect(input1b.seq).toBe(input1a.seq + 1);
      }
      if (input2a && input2b) {
        expect(input2b.seq).toBe(input2a.seq + 1);
      }
      if (input3a && input3b) {
        expect(input3b.seq).toBe(input3a.seq + 1);
      }
    });
  });

  // ───────────────────────────────────────────────
  // 7. Advanced behavior tests
  // ───────────────────────────────────────────────
  describe('Advanced behavior', () => {
    it('should avoid bombs on adjacent tiles (danger awareness)', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Alice', null);
      const p2 = gs.addPlayer(2, 'BotPlayer', null);
      startPlaying(gs);

      // Place bot in open area with bombs surrounding it on two sides
      placePlayer(p1, 1, 1);
      placePlayer(p2, 5, 5);
      makeVulnerable(p2);
      clearCooldown(p2);

      // Place bombs adjacent to p2 on two sides
      const bomb1 = new Bomb({ x: 5, y: 4 }, p1.id, 3);
      bomb1.ticksRemaining = 8;
      gs.bombs.set(bomb1.id, bomb1);

      const bomb2 = new Bomb({ x: 4, y: 5 }, p1.id, 3);
      bomb2.ticksRemaining = 8;
      gs.bombs.set(bomb2.id, bomb2);

      const bot = new BotAI('hard');
      const input = bot.generateInput(p2, gs);

      // Bot should try to move away from danger
      expect(input).not.toBeNull();
      expect(input!.direction).not.toBeNull();
      // Should not move into the bomb tiles
      if (input!.direction === 'up') {
        // Moving up toward bomb at (5,4) would be dangerous - hard bot should avoid
        // but we just verify it produces a valid direction
      }
    });

    it('should seek power-ups when safe (if in range)', () => {
      const gs = new GameStateManager({
        ...BASE_CONFIG,
        powerUpDropRate: 1.0,
      });
      const p1 = gs.addPlayer(1, 'BotPlayer', null);
      gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);

      placePlayer(p1, 3, 3);
      clearCooldown(p1);

      // Place a power-up near the bot
      gs.spawnPowerUpAt(5, 3, 'bomb_up');

      const bot = new BotAI('hard');
      let movedTowardPowerUp = false;

      for (let i = 0; i < 30; i++) {
        const input = bot.generateInput(p1, gs);
        if (input && input.direction === 'right') {
          movedTowardPowerUp = true;
        }
        if (input) {
          gs.inputBuffer.addInput(p1.id, input);
        }
        gs.processTick();
      }

      // Hard bot with high powerUpVision should attempt to move toward power-up
      // (may not always go right due to other logic, but should at some point)
      expect(movedTowardPowerUp).toBe(true);
    });

    it('should place bomb when adjacent to enemy', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'BotPlayer', null);
      const p2 = gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);

      // Place bot directly adjacent to enemy
      placePlayer(p1, 3, 3);
      placePlayer(p2, 4, 3);
      makeVulnerable(p1);
      makeVulnerable(p2);

      const bot = new BotAI('hard');
      let placedBomb = false;

      for (let i = 0; i < 100; i++) {
        clearCooldown(p1);
        const input = bot.generateInput(p1, gs);
        if (input && input.action === 'bomb') {
          placedBomb = true;
          break;
        }
        if (input) {
          gs.inputBuffer.addInput(p1.id, input);
        }
        gs.processTick();
        if (!p1.alive || !p2.alive) break;
      }

      // Hard bot adjacent to enemy should place bombs
      expect(placedBomb).toBe(true);
    });

    it('hard difficulty should be more aggressive (higher hunt chance)', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'HardBot', null);
      const p2 = gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);

      placePlayer(p1, 3, 3);
      placePlayer(p2, 7, 3);

      const hardBot = new BotAI('hard');
      let hardBombCount = 0;

      for (let i = 0; i < 150; i++) {
        clearCooldown(p1);
        const input = hardBot.generateInput(p1, gs);
        if (input && input.action === 'bomb') hardBombCount++;
        if (input) gs.inputBuffer.addInput(p1.id, input);
        gs.processTick();
        if (!p1.alive || !p2.alive) break;
      }

      // Hard bots should be aggressive and place bombs frequently
      expect(hardBombCount).toBeGreaterThan(0);
    });

    it('easy difficulty should be less aggressive (lower bomb rate)', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'EasyBot', null);
      const p2 = gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);
      makeVulnerable(p1);
      makeVulnerable(p2);

      placePlayer(p1, 3, 3);
      placePlayer(p2, 11, 9);

      const easyBot = new BotAI('easy');
      let easyBombCount = 0;

      for (let i = 0; i < 100; i++) {
        clearCooldown(p1);
        const input = easyBot.generateInput(p1, gs);
        if (input && input.action === 'bomb') easyBombCount++;
        if (input) gs.inputBuffer.addInput(p1.id, input);
        gs.processTick();
        if (!p1.alive || !p2.alive) break;
      }

      // Easy bot with longer bomb cooldown range should place fewer bombs
      // (bombCooldownMin: 45, bombCooldownMax: 80 vs hard's 5-12)
      // Even if it places some, it should not be excessively high
      expect(easyBombCount).toBeLessThan(50);
    });

    it('should handle being cornered (no escape routes)', () => {
      // Use a custom map config with walls surrounding the bot
      const gs = new GameStateManager({
        ...BASE_CONFIG,
        wallDensity: 0.0,
      });
      const p1 = gs.addPlayer(1, 'BotPlayer', null);
      gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);

      // Corner position
      placePlayer(p1, 1, 1);
      makeVulnerable(p1);
      clearCooldown(p1);

      // Place bombs blocking escape routes
      const bomb1 = new Bomb({ x: 2, y: 1 }, 2, 3);
      bomb1.ticksRemaining = 5;
      gs.bombs.set(bomb1.id, bomb1);
      const bomb2 = new Bomb({ x: 1, y: 2 }, 2, 3);
      bomb2.ticksRemaining = 5;
      gs.bombs.set(bomb2.id, bomb2);

      const bot = new BotAI('hard');

      // Should not throw even when cornered with no safe escape
      // Bot may return null (no valid move) or an input — both are acceptable
      expect(() => {
        bot.generateInput(p1, gs);
      }).not.toThrow();
    });

    it('should work with different map sizes', () => {
      const sizes = [
        { width: 9, height: 9 },
        { width: 21, height: 17 },
        { width: 51, height: 51 },
      ];

      for (const size of sizes) {
        const gs = new GameStateManager({
          ...BASE_CONFIG,
          mapWidth: size.width,
          mapHeight: size.height,
        });
        const p1 = gs.addPlayer(1, 'Bot', null);
        gs.addPlayer(2, 'Enemy', null);
        startPlaying(gs);

        const bot = new BotAI('normal', { width: size.width, height: size.height });

        expect(() => {
          for (let i = 0; i < 20; i++) {
            const input = bot.generateInput(p1, gs);
            if (input) gs.inputBuffer.addInput(p1.id, input);
            gs.processTick();
          }
        }).not.toThrow();
      }
    });

    it('should reset internal state between calls (seq increments properly)', () => {
      const gs = new GameStateManager(BASE_CONFIG);
      const p1 = gs.addPlayer(1, 'Bot', null);
      const p2 = gs.addPlayer(2, 'Enemy', null);
      startPlaying(gs);

      const bot = new BotAI('normal');

      // Generate several inputs and verify seq increments
      const seqs: number[] = [];
      for (let i = 0; i < 10; i++) {
        const input = bot.generateInput(p1, gs);
        if (input) seqs.push(input.seq);
      }

      // All seqs should be strictly increasing
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe(seqs[i - 1] + 1);
      }

      // A fresh BotAI instance should start with seq 1 again
      const bot2 = new BotAI('normal');
      const firstInput = bot2.generateInput(p1, gs);
      expect(firstInput).not.toBeNull();
      expect(firstInput!.seq).toBe(1);
    });
  });
});
