import { describe, it, expect } from '@jest/globals';
import { GameStateManager } from '../../../backend/src/game/GameState';
import { Explosion } from '../../../backend/src/game/Explosion';
import { Bomb } from '../../../backend/src/game/Bomb';
import { InputBuffer } from '../../../backend/src/game/InputBuffer';
import { parseRoom } from '../../../backend/src/services/lobby';
import type { Direction, PlayerInput, PowerUpType } from '@blast-arena/shared';
import { SPECTATOR_WALL_COST, TICK_RATE } from '@blast-arena/shared';

let seq = 0;
const input = (direction: Direction | null, action: PlayerInput['action'] = null): PlayerInput => ({
  direction,
  action,
  tick: 0,
  seq: ++seq,
});

function makeState(overrides: Partial<ConstructorParameters<typeof GameStateManager>[0]> = {}) {
  const gs = new GameStateManager({
    mapWidth: 15,
    mapHeight: 13,
    mapSeed: 4242,
    gameMode: 'ffa',
    wallDensity: 0,
    powerUpDropRate: 0,
    ...overrides,
  });
  gs.status = 'playing';
  return gs;
}

type Internals = {
  mapEvents: { type: string; position?: { x: number; y: number }; tick: number }[];
  frozenTiles: Map<string, string>;
  frozenTilesRevertTick: number;
  spectatorEnergy: Map<number, number>;
  kothScores: Map<number, number>;
};
const internals = (gs: GameStateManager) => gs as unknown as Internals;

describe('room config arrays survive the Redis round trip', () => {
  it('restores arrays that cjson encoded as {}', () => {
    const room = parseRoom(
      JSON.stringify({
        code: 'ABC123',
        players: [{ user: { id: 1 }, ready: false, team: null }],
        config: { enabledPowerUps: {}, botTeams: {}, selectedHazardTiles: ['lava'] },
      }),
    );
    expect(room.config.enabledPowerUps).toEqual([]);
    expect(room.config.botTeams).toEqual([]);
    expect(room.config.selectedHazardTiles).toEqual(['lava']);
  });

  it('keeps a no-power-ups match running through power-up rain', () => {
    const gs = makeState({
      enabledPowerUps: {} as unknown as PowerUpType[],
      enabledMapEvents: ['powerup_rain'],
    });
    gs.addPlayer(1, 'a');
    gs.addPlayer(2, 'b');
    for (let i = 0; i < 61 * TICK_RATE; i++) gs.processTick();
    expect(gs.powerUps.size).toBe(0);
  });
});

describe('time-up ranking', () => {
  it('deathmatch: the kill leader wins even while waiting to respawn', () => {
    const gs = makeState({ gameMode: 'deathmatch', roundTime: 1 });
    const leader = gs.addPlayer(1, 'leader');
    const other = gs.addPlayer(2, 'other');
    leader.kills = 5;
    other.kills = 1;
    for (let i = 0; i < TICK_RATE - 1; i++) gs.processTick();
    leader.alive = false; // mid-respawn at the buzzer
    gs.processTick();
    expect(gs.winnerId).toBe(1);
    expect(leader.placement).toBe(1);
    expect(other.placement).toBe(2);
  });

  it('KOTH: ranks by hill score, not kills', () => {
    const gs = makeState({ gameMode: 'king_of_the_hill', roundTime: 1 });
    const holder = gs.addPlayer(1, 'holder');
    const fighter = gs.addPlayer(2, 'fighter');
    fighter.kills = 3;
    internals(gs).kothScores.set(1, 40);
    internals(gs).kothScores.set(2, 10);
    for (let i = 0; i < TICK_RATE; i++) gs.processTick();
    expect(gs.winnerId).toBe(1);
    expect(holder.placement).toBe(1);
  });

  it('teams: counts every member, not only survivors', () => {
    const gs = makeState({ gameMode: 'teams', roundTime: 1 });
    const a = gs.addPlayer(1, 'a', 0);
    gs.addPlayer(2, 'b', 0);
    const c = gs.addPlayer(3, 'c', 1);
    gs.addPlayer(4, 'd', 1);
    a.kills = 5;
    c.kills = 1;
    for (let i = 0; i < TICK_RATE - 1; i++) gs.processTick();
    a.alive = false;
    gs.processTick();
    expect(gs.winnerTeam).toBe(0);
  });
});

describe('spectator Game Master', () => {
  it('lands a spectator meteor with map events off', () => {
    const gs = makeState({ enableSpectatorActions: true });
    const spectator = gs.addPlayer(1, 'ghost');
    gs.addPlayer(2, 'b');
    gs.addPlayer(3, 'c');
    spectator.alive = false;
    internals(gs).spectatorEnergy.set(1, 100);
    const target = { x: 7, y: 5 };
    expect(gs.addSpectatorAction(1, 'trigger_meteor', target).success).toBe(true);
    let landed = false;
    for (let i = 0; i < 3 * TICK_RATE && !landed; i++) {
      gs.processTick();
      landed = [...gs.explosions.values()].some((e) => e.containsCell(target.x, target.y));
    }
    expect(landed).toBe(true);
  });

  it('refunds a wall whose tile became occupied before it was applied', () => {
    const gs = makeState({ enableSpectatorActions: true });
    const spectator = gs.addPlayer(1, 'ghost');
    const walker = gs.addPlayer(2, 'b');
    gs.addPlayer(3, 'c');
    spectator.alive = false;
    internals(gs).spectatorEnergy.set(1, 100);
    const target = { x: 7, y: 5 };
    expect(gs.addSpectatorAction(1, 'place_wall', target).success).toBe(true);
    walker.position = { ...target };
    gs.processTick();
    expect(gs.map.tiles[target.y][target.x]).not.toBe('destructible');
    // 100 - cost at request, +1 regen, +cost refund, capped at 100
    expect(internals(gs).spectatorEnergy.get(1)).toBe(100);
    expect(SPECTATOR_WALL_COST).toBeGreaterThan(1);
  });
});

describe('blast consistency', () => {
  it('players killed in the same tick share a placement', () => {
    const gs = makeState();
    const a = gs.addPlayer(1, 'a');
    const b = gs.addPlayer(2, 'b');
    const survivor = gs.addPlayer(3, 'c');
    for (const p of [a, b, survivor]) p.invulnerableTicks = 0;
    a.position = { x: 3, y: 3 };
    b.position = { x: 5, y: 3 };
    survivor.position = { x: 11, y: 9 };
    const blast = new Explosion(
      [
        { x: 3, y: 3 },
        { x: 5, y: 3 },
      ],
      -999,
    );
    gs.explosions.set(blast.id, blast);
    gs.processTick();
    expect(a.alive || b.alive).toBe(false);
    expect(a.placement).toBe(2);
    expect(b.placement).toBe(2);
    expect(gs.winnerId).toBe(3);
  });

  it('a meteor chains bombs in its blast', () => {
    const gs = makeState();
    gs.addPlayer(1, 'a');
    gs.addPlayer(2, 'b');
    const bomb = new Bomb({ x: 7, y: 3 }, 1, 1);
    gs.bombs.set(bomb.id, bomb);
    internals(gs).mapEvents.push({ type: 'meteor', position: { x: 7, y: 5 }, tick: 1 });
    gs.processTick();
    expect(gs.bombs.has(bomb.id)).toBe(false);
  });
});

describe('freeze-wave ice', () => {
  it('slides without the ice hazard enabled', () => {
    const gs = makeState();
    const p = gs.addPlayer(1, 'a');
    gs.addPlayer(2, 'b');
    p.position = { x: 1, y: 1 };
    p.moveCooldown = 0;
    for (const x of [2, 3]) {
      gs.map.tiles[1][x] = 'ice';
      internals(gs).frozenTiles.set(`${x},1`, 'empty');
    }
    internals(gs).frozenTilesRevertTick = 10_000;
    gs.inputBuffer.addInput(1, input('right'));
    gs.processTick();
    gs.processTick();
    expect(p.position.x).toBeGreaterThanOrEqual(3);
  });
});

describe('input buffer', () => {
  it('keeps an earlier action when a later input in the same tick has none', () => {
    const buf = new InputBuffer();
    buf.addInput(1, input('up', 'bomb'));
    buf.addInput(1, input('left'));
    const merged = buf.getLatestInput(1)!;
    expect(merged.action).toBe('bomb');
    expect(merged.direction).toBe('left');
  });

  it('applies two actions from one tick on consecutive ticks', () => {
    const buf = new InputBuffer();
    buf.addInput(1, input(null, 'bomb'));
    buf.addInput(1, input(null, 'detonate'));
    expect(buf.getLatestInput(1)!.action).toBe('bomb');
    expect(buf.getLatestInput(1)!.action).toBe('detonate');
    expect(buf.getLatestInput(1)).toBeNull();
  });
});
