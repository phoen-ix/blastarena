import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReplayData, ReplayTickEvents } from '@blast-arena/shared';

/**
 * Replays and spectating, seen from the admin panel:
 * - The HUD kill feed only listened to the socket, which carries nothing during a replay.
 * - Closing a replay went to the lobby's default view, not back to the admin tab it came from.
 * - A spectated simulation had no way out before the batch finished (Escape and Start were
 *   switched off, the HUD has no leave button), and leaving never sent `sim:unspectate`.
 */

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      constructor(_config?: unknown) {}
    },
  },
}));
vi.mock('../../src/i18n', () => ({ i18n: { language: 'en' }, t: (key: string) => key }));
vi.mock('../../src/game/Settings', () => ({
  getSettings: () => ({ animations: false, particles: false, minimap: false, lobbyChat: false }),
}));

import { GameScene } from '../../src/scenes/GameScene';
import { HUDScene } from '../../src/scenes/HUDScene';
import { ReplayPlayer } from '../../src/game/ReplayPlayer';

/** Just enough of Phaser's registry. */
function fakeRegistry(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => void values.set(key, value),
    remove: (key: string) => void values.delete(key),
  };
}

/** Just enough of an EventEmitter for scene.events. */
function fakeEmitter() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    handlers,
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(fn);
    },
    once: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
  };
}

function gameScene(registry = fakeRegistry()) {
  const scene = new GameScene() as unknown as Record<string, unknown>;
  const socketClient = { emit: vi.fn(), off: vi.fn() };
  const sceneManager = { stop: vi.fn(), start: vi.fn() };
  const events = fakeEmitter();
  Object.assign(scene, {
    registry,
    socketClient,
    scene: sceneManager,
    events,
    effectSystem: { triggerExplosion: vi.fn(), triggerPlayerDied: vi.fn() },
  });
  return { scene, registry, socketClient, sceneManager, events };
}

describe('replay exit', () => {
  it('reopens the admin tab and view the replay was started from', () => {
    const view = { viewMode: 'replays', page: 3 };
    const { scene, registry, sceneManager } = gameScene(
      fakeRegistry({ replayMode: true, replayReturnTo: { tab: 'campaign', view } }),
    );
    (scene.exitReplay as () => void).call(scene);

    expect(registry.get('returnToAdmin')).toEqual({ tab: 'campaign', view });
    expect(registry.get('replayReturnTo')).toBeUndefined();
    expect(registry.get('replayMode')).toBeUndefined();
    expect(sceneManager.start).toHaveBeenCalledWith('LobbyScene');
  });
});

describe('simulation spectating', () => {
  it('leaves the server-side sim room and reopens the batch', () => {
    const { scene, registry, socketClient, sceneManager } = gameScene(
      fakeRegistry({ simulationSpectate: { batchId: 'b-7' } }),
    );
    (scene.leaveSimulationSpectate as (id: string) => void).call(scene, 'b-7');

    expect(socketClient.emit).toHaveBeenCalledWith('sim:unspectate', { batchId: 'b-7' });
    expect(registry.get('simulationSpectate')).toBeUndefined();
    expect(registry.get('returnToAdmin')).toEqual({
      tab: 'simulations',
      view: { batchId: 'b-7' },
    });
    expect(sceneManager.stop).toHaveBeenCalledWith('HUDScene');
    expect(sceneManager.start).toHaveBeenCalledWith('LobbyScene');
  });
});

describe('replay kill feed', () => {
  it('GameScene hands every recorded death, with its cause, to the HUD', () => {
    const { scene, events } = gameScene();
    const died = vi.fn();
    events.on('replayPlayerDied', died);
    const tickEvents: ReplayTickEvents = {
      explosions: [],
      playerDied: [
        { playerId: 2, killerId: 1, cause: 'bomb' },
        { playerId: 3, killerId: null, cause: 'lava' },
      ],
      powerupCollected: [],
    };
    (scene.handleReplayTickEvents as (e: ReplayTickEvents) => void).call(scene, tickEvents);
    expect(died.mock.calls.map((c) => c[0])).toEqual(tickEvents.playerDied);
  });

  it('the replay player announces a seek before emitting the new position', () => {
    const order: string[] = [];
    const replay = {
      map: { tiles: [['empty']] },
      frames: [0, 1, 2].map((tick) => ({
        tick,
        timeElapsed: tick / 20,
        players: [],
        bombs: [],
        explosions: [],
        powerUps: [],
        events: { explosions: [], playerDied: [], powerupCollected: [] },
      })),
    } as unknown as ReplayData;
    const player = new ReplayPlayer(replay, {
      onFrame: () => order.push('frame'),
      onTickEvents: () => order.push('events'),
      onLogUpdate: vi.fn(),
      onComplete: vi.fn(),
      onStateChange: vi.fn(),
      onSeek: () => order.push('seek'),
    });

    player.seekTo(2);
    expect(order).toEqual(['seek', 'frame', 'events']);

    // Playing on is not a seek
    order.length = 0;
    player.seekTo(0);
    player.play();
    player.tick(50);
    expect(order).toEqual(['seek', 'frame', 'events', 'frame', 'events']);
  });

  describe('HUD', () => {
    let overlay: HTMLElement;
    beforeEach(() => {
      document.body.replaceChildren();
      overlay = document.createElement('div');
      overlay.id = 'ui-overlay';
      document.body.appendChild(overlay);
    });

    function mountHud(registryValues: Record<string, unknown>) {
      const gameEvents = fakeEmitter();
      const game = { events: gameEvents, localId: 1, liveTiles: null };
      const hud = new HUDScene() as unknown as Record<string, unknown>;
      Object.assign(hud, {
        registry: fakeRegistry({
          authManager: { getUser: () => ({ id: 1, role: 'admin' }) },
          ...registryValues,
        }),
        events: fakeEmitter(),
        scene: { get: (key: string) => (key === 'GameScene' ? game : null) },
      });
      (hud.create as () => void).call(hud);
      const players = [
        { id: 1, username: 'Viewer', alive: false, team: null },
        { id: 2, username: 'Ann', alive: true, team: null },
      ];
      gameEvents.emit('stateUpdate', {
        players,
        status: 'playing',
        timeElapsed: 1,
        roundTime: 180,
      });
      return { hud, gameEvents };
    }

    const feed = () => [...document.querySelectorAll('.killfeed-entry')].map((e) => e.textContent);

    it('shows recorded kills during a replay and clears them on a seek', () => {
      const { hud, gameEvents } = mountHud({ replayMode: true });

      gameEvents.emit('replayPlayerDied', { playerId: 1, killerId: 2, cause: 'bomb' });
      expect(feed()).toHaveLength(1);
      // The viewer's own id in a replay of their match is not "you were eliminated"
      expect(document.querySelector('.hud-death-banner')).toBeNull();

      gameEvents.emit('replaySeek');
      expect(feed()).toHaveLength(0);

      (hud.shutdown as () => void).call(hud);
      expect(gameEvents.handlers.get('replayPlayerDied')?.size ?? 0).toBe(0);
      expect(gameEvents.handlers.get('replaySeek')?.size ?? 0).toBe(0);
    });

    it('does not listen for replay events outside a replay', () => {
      const { gameEvents } = mountHud({});
      expect(gameEvents.handlers.get('replayPlayerDied')?.size ?? 0).toBe(0);
    });
  });
});
