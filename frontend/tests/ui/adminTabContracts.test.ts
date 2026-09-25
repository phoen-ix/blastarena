import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NotificationUI } from '../../src/ui/NotificationUI';
import type { SocketClient } from '../../src/network/SocketClient';

/**
 * Contract fixtures: every admin tab rendered against the response its backend route really
 * sends — the wrapper object, the field names and casing (raw snake_case SQL rows vs. mapped
 * camelCase). Tabs that read the wrong shape rendered nothing, or an error (Challenges and
 * Seasons did). Each fixture names the handler it mirrors; change both together.
 * (adminTabs.test.ts covers Challenges, Seasons, Logs and AI.)
 */

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));
vi.mock('../../src/main', () => ({
  game: { registry: { get: vi.fn(), set: vi.fn(), remove: vi.fn() }, scene: { getScene: vi.fn() } },
}));

const routes = new Map<string, unknown>();
const apiGet = vi.fn(async (path: string) => {
  if (!routes.has(path)) throw new Error(`no fixture for ${path}`);
  return structuredClone(routes.get(path));
});
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: (path: string) => apiGet(path),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

import { DashboardTab } from '../../src/ui/admin/DashboardTab';
import { UsersTab } from '../../src/ui/admin/UsersTab';
import { RoomsTab } from '../../src/ui/admin/RoomsTab';
import { MatchesTab } from '../../src/ui/admin/MatchesTab';
import { AnnouncementsTab } from '../../src/ui/admin/AnnouncementsTab';
import { AchievementsTab } from '../../src/ui/admin/AchievementsTab';
import { CampaignTab } from '../../src/ui/admin/CampaignTab';
import { SimulationsTab } from '../../src/ui/admin/SimulationsTab';

const ai = {
  id: 'builtin',
  name: 'Classic',
  description: 'Built-in bot',
  filename: 'BotAI.ts',
  isBuiltin: true,
  isActive: true,
  uploadedBy: null,
  uploadedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  fileSize: 1024,
};

/** routes/admin.ts — the handler each entry mirrors is named next to it. */
const FIXTURES: Record<string, unknown> = {
  // GET /admin/stats → adminService.getServerStats()
  '/admin/stats': {
    totalUsers: 4211,
    activeUsers24h: 377,
    totalMatches: 9120,
    activeRooms: 6,
    activePlayers: 23,
  },
  // Public settings: each wraps its value in one named field
  '/admin/settings/recordings_enabled': { enabled: true },
  '/admin/settings/registration_enabled': { enabled: false },
  '/admin/settings/party_chat_mode': { mode: 'everyone' },
  '/admin/settings/lobby_chat_mode': { mode: 'staff' },
  '/admin/settings/dm_mode': { mode: 'everyone' },
  '/admin/settings/emote_mode': { mode: 'admin_only' },
  '/admin/settings/spectator_chat_mode': { mode: 'disabled' },
  '/admin/settings/xp_multiplier': { multiplier: 1.5 },
  '/admin/settings/default_theme': { theme: 'inferno' },
  '/admin/settings/game_defaults': { defaults: { gameMode: 'teams', roundTime: 240 } },
  '/admin/settings/simulation_defaults': { defaults: { botCount: 4, totalGames: 10 } },
  '/admin/ai/active': { ais: [ai] },
  '/admin/settings/imprint': { enabled: true, text: 'Imprint text' },
  '/admin/settings/display_github': { enabled: true },
  '/admin/settings/spectator_actions_enabled': { enabled: true },
  // GET /admin/settings/email_settings → { settings }, the password masked
  '/admin/settings/email_settings': {
    settings: {
      smtpHost: 'smtp.example.org',
      smtpPort: 587,
      smtpUser: 'mailer',
      smtpPassword: '••••••••',
      fromEmail: 'noreply@example.org',
      fromName: 'BlastArena',
    },
  },
  // GET /admin/settings/open_world → settingsService.getOpenWorldSettings(), unwrapped
  '/admin/settings/open_world': {
    enabled: true,
    guestAccess: false,
    maxPlayers: 32,
    roundTime: 300,
    mapWidth: 51,
    mapHeight: 41,
    wallDensity: 0.5,
    respawnDelay: 3,
    afkTimeoutSeconds: 60,
  },
  // GET /admin/users → adminService.listUsers(): raw snake_case rows plus paging
  '/admin/users?page=1&limit=20': {
    users: [
      {
        id: 7,
        username: 'zelda',
        email_hint: 'z***@example.org',
        role: 'moderator',
        email_verified: true,
        totp_enabled: true,
        is_deactivated: false,
        deactivated_at: null,
        last_login: '2026-09-20T18:00:00.000Z',
        created_at: '2026-01-02T10:00:00.000Z',
        total_matches: 120,
        total_wins: 31,
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  },
  // GET /admin/rooms → adminService.getActiveRooms(): a bare array
  '/admin/rooms': [
    {
      code: 'QWER',
      name: 'Friday night',
      host: 'ann',
      playerCount: 3,
      maxPlayers: 8,
      gameMode: 'ffa',
      status: 'waiting',
    },
  ],
  // GET /admin/matches → adminService.getMatchHistory(): raw rows plus paging
  '/admin/matches?page=1&limit=20': {
    matches: [
      {
        id: 88,
        room_code: 'ZXCV',
        game_mode: 'deathmatch',
        status: 'finished',
        duration: 245,
        started_at: '2026-09-21T20:00:00.000Z',
        finished_at: '2026-09-21T20:04:05.000Z',
        winner_username: 'bert',
        player_count: 5,
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  },
  // GET /admin/announcements/banner → adminService.getActiveBanner(): the row, or null
  '/admin/announcements/banner': {
    id: 2,
    message: 'Server restart at 22:00',
    admin_username: 'root',
    created_at: '2026-09-20T10:00:00.000Z',
  },
  // GET /admin/achievements → { achievements } (shared Achievement)
  '/admin/achievements': {
    achievements: [
      {
        id: 3,
        name: 'Demolition Expert',
        description: 'Destroy 500 walls',
        icon: '💥',
        category: 'combat',
        conditionType: 'cumulative',
        conditionConfig: { stat: 'total_walls_destroyed', threshold: 500 },
        rewardType: 'none',
        rewardId: null,
        isActive: true,
        sortOrder: 1,
      },
    ],
  },
  // GET /admin/cosmetics → { cosmetics } (shared Cosmetic)
  '/admin/cosmetics': {
    cosmetics: [
      {
        id: 9,
        name: 'Crimson',
        type: 'color',
        config: { hex: '#cc2233' },
        rarity: 'rare',
        unlockType: 'achievement',
        unlockRequirement: null,
        isActive: true,
        sortOrder: 1,
      },
    ],
  },
  // routes/campaign.ts GET /admin/campaign/worlds → { worlds } (shared CampaignWorld)
  '/admin/campaign/worlds': {
    worlds: [
      {
        id: 1,
        name: 'Ember Wastes',
        description: 'Hot',
        sortOrder: 0,
        theme: 'volcano',
        isPublished: true,
        levelCount: 4,
      },
    ],
  },
  // GET /admin/simulations → SimulationManager.getHistory(): { batches, total }
  '/admin/simulations': {
    batches: [
      {
        batchId: 'sim-2026-09-21-abcdef',
        config: {
          gameMode: 'ffa',
          botCount: 4,
          botDifficulty: 'hard',
          mapWidth: 15,
          mapHeight: 13,
          roundTime: 180,
          wallDensity: 0.6,
          enabledPowerUps: [],
          powerUpDropRate: 0.3,
          friendlyFire: false,
          hazardTiles: false,
          reinforcedWalls: false,
          enableMapEvents: false,
          totalGames: 50,
          speed: 'fast',
          logVerbosity: 'normal',
        },
        status: 'completed',
        gamesCompleted: 50,
        totalGames: 50,
        currentGameTick: null,
        currentGameMaxTicks: null,
        startedAt: '2026-09-21T10:00:00.000Z',
        completedAt: '2026-09-21T10:05:00.000Z',
      },
    ],
    total: 1,
  },
};

let notifications: {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};
let parent: HTMLElement;
const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as SocketClient;
const notes = () => notifications as unknown as NotificationUI;

beforeEach(() => {
  document.body.replaceChildren();
  parent = document.createElement('div');
  document.body.appendChild(parent);
  routes.clear();
  for (const [path, body] of Object.entries(FIXTURES)) routes.set(path, body);
  apiGet.mockClear();
  notifications = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
});

function expectRendered(...texts: string[]) {
  expect(notifications.error).not.toHaveBeenCalled();
  const text = parent.textContent ?? '';
  for (const t of texts) expect(text).toContain(t);
}

describe('admin tabs render the backend response shapes', () => {
  it('Dashboard: stats and every settings endpoint', async () => {
    const tab = new DashboardTab(notes());
    await tab.render(parent);
    expectRendered('4211', '377', '9120');
    // Values from the settings responses reached the form
    expect(
      parent.querySelector<HTMLInputElement>('#ow-max-players, [id*="max-players"]')?.value,
    ).toBe('32');
    tab.destroy();
  });

  it('Users', async () => {
    const tab = new UsersTab(notes(), 'admin');
    await tab.render(parent);
    expectRendered('zelda', 'z***@example.org');
    tab.destroy();
  });

  it('Rooms', async () => {
    const tab = new RoomsTab(notes(), socket, 'admin');
    await tab.render(parent);
    expectRendered('QWER', 'Friday night');
    tab.destroy();
  });

  it('Matches', async () => {
    const tab = new MatchesTab(notes(), true);
    await tab.render(parent);
    expectRendered('ZXCV', 'bert');
    tab.destroy();
  });

  it('Announcements: the active banner', async () => {
    const tab = new AnnouncementsTab(notes(), 'admin');
    await tab.render(parent);
    expectRendered('Server restart at 22:00');
    tab.destroy();
  });

  it('Achievements and cosmetics', async () => {
    const tab = new AchievementsTab(notes());
    await tab.render(parent);
    expectRendered('Demolition Expert');
    parent.querySelector<HTMLElement>('#ach-view-cosmetics')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expectRendered('Crimson');
    tab.destroy();
  });

  it('Campaign worlds', async () => {
    const tab = new CampaignTab(notes());
    await tab.render(parent);
    expectRendered('Ember Wastes');
    tab.destroy();
  });

  it('Simulations', async () => {
    const tab = new SimulationsTab(notes(), socket);
    await tab.render(parent);
    expectRendered('50');
    expect(parent.querySelector('[data-batch="sim-2026-09-21-abcdef"]')).not.toBeNull();
    tab.destroy();
  });
});
