import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NotificationUI } from '../../src/ui/NotificationUI';
import type { SocketClient } from '../../src/network/SocketClient';

/**
 * Closing a replay (or a spectated simulation) used to drop the admin on the lobby's default
 * view. Now it reopens the tab it was started from, at the same page / batch. And "Watch replay"
 * in the match detail modal left the modal's gamepad context on the stack.
 */

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));

const gamepad = vi.hoisted(() => ({ pushContext: vi.fn(), popContext: vi.fn() }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ ...gamepad, clearAll() {}, setActive() {} }),
  },
}));

const apiGet = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: (...args: unknown[]) => apiGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

const registry = new Map<string, unknown>();
const lobbyScene = { scene: { start: vi.fn(), launch: vi.fn() } };
vi.mock('../../src/main', () => ({
  game: {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => registry.set(key, value),
      remove: (key: string) => registry.delete(key),
    },
    scene: { getScene: (key: string) => (key === 'LobbyScene' ? lobbyScene : null) },
  },
}));

import { MatchesTab } from '../../src/ui/admin/MatchesTab';
import { CampaignTab } from '../../src/ui/admin/CampaignTab';
import { SimulationsTab } from '../../src/ui/admin/SimulationsTab';
import { AdminUI } from '../../src/ui/AdminUI';

const flush = () => new Promise((r) => setTimeout(r, 0));

let notifications: NotificationUI;
let parent: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  const overlay = document.createElement('div');
  overlay.id = 'ui-overlay';
  document.body.appendChild(overlay);
  parent = document.createElement('div');
  overlay.appendChild(parent);
  apiGet.mockReset();
  gamepad.pushContext.mockClear();
  gamepad.popContext.mockClear();
  lobbyScene.scene.start.mockClear();
  registry.clear();
  notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() } as unknown as NotificationUI;
});

const replay = {
  matchId: 5,
  map: { width: 9, height: 9, tiles: [['empty']] },
  frames: [
    {
      tick: 0,
      players: [],
      bombs: [],
      explosions: [],
      powerUps: [],
      status: 'playing',
      winnerId: null,
      winnerTeam: null,
      roundTime: 180,
      timeElapsed: 0,
    },
  ],
  log: [],
};

describe('MatchesTab', () => {
  function answer(path: string) {
    if (path.startsWith('/admin/matches?')) {
      return {
        matches: [
          { id: 5, room_code: 'ABCD', game_mode: 'ffa', player_count: 2, status: 'completed' },
        ],
        total: 60,
        page: 3,
        limit: 20,
      };
    }
    if (path === '/admin/rooms') return [];
    if (path === '/admin/matches/5') {
      return {
        id: 5,
        roomCode: 'ABCD',
        gameMode: 'ffa',
        status: 'completed',
        hasReplay: true,
        allPlayers: null,
        players: [],
      };
    }
    if (path === '/admin/replays/5') return replay;
    throw new Error(`unexpected ${path}`);
  }

  it('reopens the page a replay was started from, once', async () => {
    apiGet.mockImplementation(async (path: string) => answer(path));
    const tab = new MatchesTab(notifications);
    tab.restore({ page: 3 });
    await tab.render(parent);
    expect(apiGet).toHaveBeenCalledWith('/admin/matches?page=3&limit=20');

    tab.destroy();
    apiGet.mockClear();
    await tab.render(parent); // switching back to the tab later starts at page 1 again
    expect(apiGet).toHaveBeenCalledWith('/admin/matches?page=1&limit=20');
    tab.destroy();
  });

  it('closes the detail modal properly when its replay starts, and remembers the page', async () => {
    apiGet.mockImplementation(async (path: string) => answer(path));
    const tab = new MatchesTab(notifications);
    tab.restore({ page: 3 });
    await tab.render(parent);

    parent.querySelector<HTMLElement>('tr[data-match-id="5"] td')!.click();
    await flush();
    const modal = document.querySelector('.modal-overlay');
    expect(modal).not.toBeNull();
    expect(gamepad.pushContext).toHaveBeenCalledTimes(1);
    const contextId = gamepad.pushContext.mock.calls[0][0].id;

    document.querySelector<HTMLElement>('#match-watch-replay')!.click();
    await flush();
    expect(gamepad.popContext).toHaveBeenCalledWith(contextId);
    expect(registry.get('replayMode')).toBe(true);
    expect(registry.get('replayReturnTo')).toEqual({ tab: 'matches', view: { page: 3 } });
    expect(lobbyScene.scene.start).toHaveBeenCalledWith('GameScene');
  });
});

describe('CampaignTab', () => {
  it('reopens the replay list at its page', async () => {
    apiGet.mockResolvedValue({ replays: [], total: 0 });
    const tab = new CampaignTab(notifications);
    tab.restore({ viewMode: 'replays', page: 2 });
    await tab.render(parent);
    expect(apiGet).toHaveBeenCalledWith('/admin/campaign-replays?page=2&limit=20');
    tab.destroy();
  });
});

describe('SimulationsTab', () => {
  it('reopens the batch a replay or a spectated game came from, not the list', async () => {
    apiGet.mockImplementation(async (path: string) => {
      if (path === '/admin/simulations/b-7') {
        return {
          results: [],
          summary: {
            batchId: 'b-7',
            status: 'completed',
            gamesCompleted: 1,
            totalGames: 1,
            config: { gameMode: 'ffa', botCount: 2, speed: 'fast' },
          },
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as SocketClient;
    const tab = new SimulationsTab(notifications, socket);
    tab.restore({ batchId: 'b-7' });
    await tab.render(parent);
    expect(apiGet.mock.calls.map((c) => c[0])).toEqual(['/admin/simulations/b-7']);
    expect(notifications.error).not.toHaveBeenCalled();
    tab.destroy();
  });
});

describe('AdminUI', () => {
  it('hands the view to the tab it opens on', async () => {
    const restore = vi.spyOn(CampaignTab.prototype, 'restore');
    const auth = { getUser: () => ({ id: 1, role: 'admin' }) };
    new AdminUI({} as never, auth as never, notifications, 'campaign', { viewMode: 'replays' });
    expect(restore).toHaveBeenCalledWith({ viewMode: 'replays' });
    restore.mockRestore();
  });
});
