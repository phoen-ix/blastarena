import { describe, it, expect, vi } from 'vitest';
import { ReplayPlayer } from '../../src/game/ReplayPlayer';
import type { ReplayData, GameState } from '@blast-arena/shared';

// Frame 0's tile diffs were applied only by a backward seek, so the tiles on screen depended on
// how a frame was reached. (audit N3)

function replay(): ReplayData {
  const frame = (tick: number, tileDiffs?: { x: number; y: number; type: string }[]) => ({
    tick,
    players: [],
    bombs: [],
    explosions: [],
    powerUps: [],
    status: 'playing',
    winnerId: null,
    winnerTeam: null,
    roundTime: 180,
    timeElapsed: tick / 20,
    ...(tileDiffs ? { tileDiffs } : {}),
  });
  return {
    map: { width: 2, height: 1, tiles: [['destructible', 'empty']], spawnPoints: [], seed: 1 },
    frames: [frame(0, [{ x: 0, y: 0, type: 'empty' }]), frame(1), frame(2)],
    log: [],
    totalTicks: 3,
    tickRate: 20,
  } as unknown as ReplayData;
}

describe('ReplayPlayer frame 0', () => {
  it('shows frame 0 tile changes on forward play as well as after a backward seek', () => {
    const states: GameState[] = [];
    const player = new ReplayPlayer(replay(), {
      onFrame: (s) => states.push(s),
      onTickEvents: vi.fn(),
      onLogUpdate: vi.fn(),
      onComplete: vi.fn(),
      onStateChange: vi.fn(),
    });

    player.seekTo(2); // forward from frame 0
    const forward = states[states.length - 1].map.tiles[0][0];
    player.seekTo(1); // backward: rebuilt from the initial grid
    const backward = states[states.length - 1].map.tiles[0][0];

    expect(forward).toBe('empty');
    expect(backward).toBe('empty');
  });
});
