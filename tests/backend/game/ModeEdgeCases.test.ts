import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { Bomb } from '../../../backend/src/game/Bomb';
import { KOTH_ZONE_SIZE, DEATHMATCH_RESPAWN_TICKS, TILE_SIZE } from '@blast-arena/shared';
import type { TileType } from '@blast-arena/shared';

function emptyTiles(w: number, h: number): TileType[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      x === 0 || y === 0 || x === w - 1 || y === h - 1 ? 'wall' : 'empty',
    ),
  );
}

/** A hand-built custom map whose dimensions differ from any mode default. */
function customMap(w: number, h: number) {
  return {
    width: w,
    height: h,
    tiles: emptyTiles(w, h),
    spawnPoints: [
      { x: 1, y: 1 },
      { x: w - 2, y: h - 2 },
      { x: 1, y: h - 2 },
      { x: w - 2, y: 1 },
    ],
    seed: 0,
  };
}

describe('custom map dimensions', () => {
  // Regression: the zone and the hill were sized from config.mapWidth/mapHeight, which stay at the
  // room's (or the mode's default) values while a custom map carries its own size from the DB. On
  // a small custom map the hill landed outside the grid — KOTH could never be scored — and the
  // battle royale zone shrank toward a centre outside the map. (audit CUSTOMMAP-DIMS-1)
  it('places the KOTH hill inside a custom map, not at the configured size', () => {
    const gs = new GameStateManager({
      mapWidth: 35, // the KOTH default, deliberately larger than the map below
      mapHeight: 35,
      mapSeed: 1,
      gameMode: 'king_of_the_hill',
      customMap: customMap(15, 13),
    });

    const hill = (gs as unknown as { hillZone: { x: number; y: number } }).hillZone;
    expect(hill).not.toBeNull();
    expect(hill.x).toBeGreaterThanOrEqual(0);
    expect(hill.y).toBeGreaterThanOrEqual(0);
    expect(hill.x + KOTH_ZONE_SIZE).toBeLessThanOrEqual(15);
    expect(hill.y + KOTH_ZONE_SIZE).toBeLessThanOrEqual(13);
  });

  it('sizes the battle royale zone to the custom map', () => {
    const gs = new GameStateManager({
      mapWidth: 35,
      mapHeight: 35,
      mapSeed: 1,
      gameMode: 'battle_royale',
      hasZone: true,
      customMap: customMap(15, 13),
    });

    const zone = (
      gs as unknown as {
        zone: { toState(): { centerX: number; centerY: number; currentRadius: number } };
      }
    ).zone;
    const state = zone.toState();
    // The zone shrinks toward its centre, so the centre must be a tile inside the custom map.
    expect(state.centerX).toBeGreaterThanOrEqual(0);
    expect(state.centerX).toBeLessThan(15);
    expect(state.centerY).toBeGreaterThanOrEqual(0);
    expect(state.centerY).toBeLessThan(13);
  });
});

describe('deathmatch respawn safety', () => {
  function dmGame() {
    const gs = new GameStateManager({
      mapWidth: 15,
      mapHeight: 13,
      mapSeed: 5,
      gameMode: 'deathmatch',
      wallDensity: 0,
      powerUpDropRate: 0,
    });
    gs.status = 'playing';
    return gs;
  }

  // Regression: deathmatch picked a raw spawn point at random with no occupancy check, unlike the
  // open-world path beside it. (audit RESPAWN-SAFETY-1)
  it('does not respawn a player onto a tile holding a live bomb', () => {
    const gs = dmGame();
    const a = gs.addPlayer(1, 'Alice');
    gs.addPlayer(2, 'Bob');

    // Cover every spawn point but one with a live bomb.
    const [free, ...blocked] = gs.map.spawnPoints;
    for (const sp of blocked) {
      const bomb = new Bomb({ x: sp.x, y: sp.y }, 2, 1);
      gs.bombs.set(bomb.id, bomb);
    }

    a.alive = false;
    a.respawnTick = null;
    (gs as unknown as { invalidateAliveCache(): void }).invalidateAliveCache();
    for (let i = 0; i < DEATHMATCH_RESPAWN_TICKS + 2; i++) gs.processTick();

    expect(a.alive).toBe(true);
    const onBomb = [...gs.bombs.values()].some(
      (b) => b.position.x === a.position.x && b.position.y === a.position.y,
    );
    expect(onBomb).toBe(false);
    expect({ x: a.position.x, y: a.position.y }).toEqual({ x: free.x, y: free.y });
  });

  // Regression: respawn() zeroed bombCount while the player's pre-death bombs were still ticking.
  // Each detonation then decremented the counter (clamped at 0), letting the player hold more live
  // bombs than maxBombs. (audit RESPAWN-BOMBCOUNT-1)
  it('re-derives bombCount from the bombs still on the field', () => {
    const gs = dmGame();
    const a = gs.addPlayer(1, 'Alice');
    gs.addPlayer(2, 'Bob');

    // Long fuses, so the bombs are still on the field when the player comes back — the respawn
    // delay and the default bomb fuse are both 60 ticks, so default bombs would have gone off.
    for (let i = 0; i < 3; i++) {
      const bomb = new Bomb({ x: 5 + i, y: 5 }, a.id, 1);
      bomb.ticksRemaining = 500;
      gs.bombs.set(bomb.id, bomb);
    }
    a.bombCount = 3;
    a.alive = false;
    a.respawnTick = null;
    (gs as unknown as { invalidateAliveCache(): void }).invalidateAliveCache();

    for (let i = 0; i < DEATHMATCH_RESPAWN_TICKS + 2; i++) {
      gs.processTick();
      if (a.alive) break;
    }

    expect(a.alive).toBe(true);
    const live = [...gs.bombs.values()].filter((b) => b.ownerId === a.id).length;
    expect(live).toBe(3); // the bombs really are still ticking
    expect(a.bombCount).toBe(live);
  });
});

describe('temporary spectator walls', () => {
  // Regression: the revert only matched the exact tile 'destructible'. With reinforcedWalls on,
  // one bomb turns it into 'destructible_cracked' — still a standing wall — so the revert was
  // skipped while the bookkeeping entry was deleted, stranding the tile as a cracked wall on top
  // of whatever it had replaced. (audit TEMPWALL-CRACKED-1)
  it('reverts a wall that a bomb only cracked', () => {
    const gs = new GameStateManager({
      mapWidth: 15,
      mapHeight: 13,
      mapSeed: 3,
      gameMode: 'ffa',
      wallDensity: 0,
      powerUpDropRate: 0,
      reinforcedWalls: true,
      enableSpectatorActions: true,
    });
    gs.addPlayer(1, 'Alice');
    gs.addPlayer(2, 'Bob');
    gs.status = 'playing';

    const target = { x: 6, y: 6 };
    const originalType: TileType = 'teleporter_a';
    gs.map.tiles[target.y][target.x] = originalType;

    const temporaryWalls = (
      gs as unknown as {
        temporaryWalls: Map<string, { originalType: TileType; revertTick: number }>;
      }
    ).temporaryWalls;
    gs.map.tiles[target.y][target.x] = 'destructible';
    temporaryWalls.set(`${target.x},${target.y}`, { originalType, revertTick: gs.tick + 5 });

    // A bomb cracks it rather than destroying it.
    gs.map.tiles[target.y][target.x] = 'destructible_cracked';

    for (let i = 0; i < 10; i++) gs.processTick();

    expect(gs.map.tiles[target.y][target.x]).toBe(originalType);
    expect(temporaryWalls.has(`${target.x},${target.y}`)).toBe(false);
  });
});

// Silence the unused-import lint for TILE_SIZE if it drifts out of use.
void TILE_SIZE;
