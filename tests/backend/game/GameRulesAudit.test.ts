import { describe, it, expect } from 'vitest';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { Bomb } from '../../../backend/src/game/Bomb';
import {
  DEATHMATCH_KILL_TARGET,
  DEATHMATCH_RESPAWN_TICKS,
  calculateXpGained,
} from '@blast-arena/shared';

// Regressions for the Phase 2 game-rule fixes (audit G2, G3, G5, G8, G10).

const BASE_CONFIG = {
  mapWidth: 15,
  mapHeight: 13,
  mapSeed: 12345,
  wallDensity: 0,
  powerUpDropRate: 0,
};

function game(gameMode: 'ffa' | 'teams' | 'deathmatch', extra: object = {}): GameStateManager {
  const gs = new GameStateManager({ ...BASE_CONFIG, gameMode, ...extra });
  return gs;
}

describe('game rules (audit fixes)', () => {
  it('a deathmatch kill-target win ranks every player, not only the winner (G2)', () => {
    const gs = game('deathmatch');
    const a = gs.addPlayer(1, 'Alice', null);
    const b = gs.addPlayer(2, 'Bob', null);
    const c = gs.addPlayer(3, 'Cara', null);
    gs.status = 'playing';
    a.kills = DEATHMATCH_KILL_TARGET;
    b.kills = 7;
    c.kills = 2;

    gs.processTick();

    expect(gs.winnerId).toBe(1);
    expect([a.placement, b.placement, c.placement]).toEqual([1, 2, 3]);
  });

  it('a player who left is not respawned in deathmatch (G3)', () => {
    const gs = game('deathmatch');
    const a = gs.addPlayer(1, 'Alice', null);
    gs.addPlayer(2, 'Bob', null);
    gs.status = 'playing';

    gs.killPlayer(1, null);
    gs.markDeparted(1);
    for (let i = 0; i < DEATHMATCH_RESPAWN_TICKS + 5; i++) gs.processTick();

    expect(a.alive).toBe(false);
  });

  it('a returning player respawns again (G3)', () => {
    const gs = game('deathmatch');
    const a = gs.addPlayer(1, 'Alice', null);
    gs.addPlayer(2, 'Bob', null);
    gs.status = 'playing';

    gs.killPlayer(1, null);
    gs.markDeparted(1);
    gs.markReturned(1);
    for (let i = 0; i < DEATHMATCH_RESPAWN_TICKS + 5; i++) gs.processTick();

    expect(a.alive).toBe(true);
  });

  it('a death caused between ticks reaches the next tick events (G5)', () => {
    const gs = game('ffa');
    gs.addPlayer(1, 'Alice', null);
    gs.addPlayer(2, 'Bob', null);
    gs.addPlayer(3, 'Cara', null);
    gs.status = 'playing';
    gs.processTick();

    gs.killPlayer(2, null); // a voluntary leave, outside the tick
    gs.processTick();

    expect(gs.tickEvents.playerDied.map((d) => d.playerId)).toContain(2);
  });

  it('killing a teammate credits no kill (G10)', () => {
    const gs = game('teams', { friendlyFire: true });
    const a = gs.addPlayer(1, 'Alice', 0);
    const b = gs.addPlayer(2, 'Bob', 0);
    gs.addPlayer(3, 'Cara', 1);
    gs.status = 'playing';
    gs.processTick();

    // Alice's bomb at (3,1) catches her teammate Bob at (4,1); Alice stands clear below.
    a.position = { x: 3, y: 3 };
    b.position = { x: 4, y: 1 };
    b.invulnerableTicks = 0;
    const bomb = new Bomb({ x: 3, y: 1 }, a.id, 2);
    bomb.ticksRemaining = 1;
    gs.bombs.set(bomb.id, bomb);
    gs.processTick();

    expect(b.alive).toBe(false);
    expect(a.kills).toBe(0);
  });

  it('a match never costs XP, whatever the self-kills (G8)', () => {
    const xp = calculateXpGained({
      kills: -3,
      bombsPlaced: 0,
      powerupsCollected: 0,
      placement: 4,
      isWinner: false,
    });
    expect(xp).toBeGreaterThanOrEqual(0);
  });
});

describe('campaign puzzle tiles (audit G1)', () => {
  // A level with a switch and its gate. The campaign runs its own processor with the level's
  // switch variants; a second one inside GameStateManager toggled the same tiles again.
  function puzzleMap(): {
    width: number;
    height: number;
    tiles: import('@blast-arena/shared').TileType[][];
    spawnPoints: { x: number; y: number }[];
    seed: number;
  } {
    const width = 9;
    const height = 9;
    const tiles = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) =>
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 'wall' : 'empty',
      ),
    ) as import('@blast-arena/shared').TileType[][];
    tiles[1][3] = 'switch_red';
    tiles[1][5] = 'gate_red';
    return { width, height, tiles, spawnPoints: [{ x: 1, y: 1 }], seed: 1 };
  }

  it('GameStateManager runs no puzzle processor of its own in a campaign', () => {
    const gs = new GameStateManager({
      ...BASE_CONFIG,
      gameMode: 'campaign',
      customMap: puzzleMap(),
    } as never);
    expect((gs as unknown as { puzzleProcessor: unknown }).puzzleProcessor).toBeNull();
  });

  it('still runs it for a custom map outside the campaign', () => {
    const gs = new GameStateManager({ ...BASE_CONFIG, gameMode: 'ffa', customMap: puzzleMap() });
    expect((gs as unknown as { puzzleProcessor: unknown }).puzzleProcessor).not.toBeNull();
  });
});
