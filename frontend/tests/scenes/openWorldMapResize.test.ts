import { describe, it, expect, vi } from 'vitest';
import type { GameState, TileType } from '@blast-arena/shared';
import { makeFakeScene } from '../helpers/fakeScene';

/**
 * An admin can change the open-world map size between rounds. The round-start handler reused the
 * tile renderer built for the old size: a smaller map threw inside the socket handler (the grid was
 * indexed with the old dimensions) and froze every client for the rest of the session. (A-H4)
 */

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_config?: unknown) {}
    },
  },
}));
vi.mock('../../src/i18n', () => ({ i18n: { language: 'en' }, t: (key: string) => key }));

import { GameScene } from '../../src/scenes/GameScene';

function grid(width: number, height: number): TileType[][] {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x % 2 === 1 && y % 2 === 1 ? ('wall' as TileType) : ('empty' as TileType),
    ),
  );
}

function state(width: number, height: number): GameState {
  return {
    tick: 1,
    status: 'playing',
    players: [],
    bombs: [],
    explosions: [],
    powerUps: [],
    map: { width, height, tiles: grid(width, height), wrapping: true, spawnPoints: [], seed: 1 },
    roundTime: 300,
    timeElapsed: 0,
  } as unknown as GameState;
}

/** A GameScene wired to the fake scene surface, with the renderers the round handler touches. */
function makeScene() {
  const fake = makeFakeScene();
  const scene = new GameScene() as unknown as Record<string, unknown>;
  const events = { emit: vi.fn() };
  const camera = {
    removeBounds: vi.fn(),
    centerOn: vi.fn(),
    worldView: fake.cameras.main.worldView,
  };
  Object.assign(scene, {
    add: fake.add,
    tweens: fake.tweens,
    anims: fake.anims,
    textures: fake.textures,
    cameras: { main: camera },
    events,
    registry: { get: () => undefined, set: vi.fn(), remove: vi.fn() },
    openWorldMode: true,
  });
  return { scene, fake, events };
}

describe('open world round with a different map size', () => {
  it('rebuilds the tile renderer and wrap sizes instead of indexing the new grid with the old ones', async () => {
    const { TileMapRenderer } = await import('../../src/game/TileMap');
    const { PlayerSpriteRenderer } = await import('../../src/game/PlayerSprite');
    const { scene, events } = makeScene();

    const first = state(51, 41);
    scene.tileMap = new TileMapRenderer(scene as never, first.map.tiles, 51, 41, undefined, true);
    const oldRenderer = scene.tileMap;
    const players = Object.create(PlayerSpriteRenderer.prototype) as {
      wrappingWorldSize: unknown;
      update: () => void;
    };
    players.wrappingWorldSize = { w: 51 * 48, h: 41 * 48 };
    players.update = () => {};
    scene.playerRenderer = players;

    const smaller = state(31, 25);
    const apply = (scene as { applyOpenWorldState: (s: GameState) => void }).applyOpenWorldState;
    expect(() => apply.call(scene, smaller)).not.toThrow();

    expect(scene.tileMap).not.toBe(oldRenderer);
    expect((scene.tileMap as { matches: (w: number, h: number) => boolean }).matches(31, 25)).toBe(
      true,
    );
    expect(players.wrappingWorldSize).toEqual({ w: 31 * 48, h: 25 * 48 });
    expect((scene as { liveTiles: TileType[][] }).liveTiles).toHaveLength(25);
    expect(events.emit).toHaveBeenCalledWith('stateUpdate', smaller);
  });

  it('keeps the renderer when the size is unchanged', async () => {
    const { TileMapRenderer } = await import('../../src/game/TileMap');
    const { scene } = makeScene();
    const first = state(21, 21);
    scene.tileMap = new TileMapRenderer(scene as never, first.map.tiles, 21, 21, undefined, true);
    const renderer = scene.tileMap;

    const apply = (scene as { applyOpenWorldState: (s: GameState) => void }).applyOpenWorldState;
    apply.call(scene, state(21, 21));
    expect(scene.tileMap).toBe(renderer);
  });
});
