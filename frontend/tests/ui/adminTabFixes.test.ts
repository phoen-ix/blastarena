import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NotificationUI } from '../../src/ui/NotificationUI';

/**
 * Admin tab fixes:
 * - Dashboard: the imprint toggle sent the hidden (empty) textarea and wiped the stored text;
 *   one failing settings request reset every setting to its default silently, and a later save
 *   wrote those defaults back; the email reset reloads what the server holds.
 * - Users: account cleanup re-read the days input at execute time, so it could delete far more
 *   accounts than the preview had counted.
 * - Achievements / Campaign: stored config values went into attributes unescaped; the replay
 *   load error went into HTML unescaped.
 * - Campaign: ticking "Can bomb" sent no bombConfig (the enemy never bombed); an enemy import
 *   with a bundled AI got the server's "needs resolution" answer and toasted success anyway.
 */

// Interpolation options are kept in the output, so an unescaped value would become markup.
vi.mock('../../src/i18n', () => ({
  t: (key: string, opts?: Record<string, unknown>) =>
    opts ? `${key} ${Object.values(opts).join(' ')}` : key,
  i18n: { language: 'en' },
}));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));
vi.mock('../../src/main', () => ({
  game: { registry: { get: vi.fn(), set: vi.fn(), remove: vi.fn() }, scene: { getScene: vi.fn() } },
}));
vi.mock('../../src/game/EnemyTextureGenerator', () => ({
  EnemyTextureGenerator: { generatePreview: vi.fn() },
}));

const routes = new Map<string, unknown>();
const apiGet = vi.fn(async (path: string) => {
  if (!routes.has(path)) throw new Error(`no fixture for ${path}`);
  const body = routes.get(path);
  if (body instanceof Error) throw body;
  return structuredClone(body);
});
const apiPut = vi.fn(async (..._args: unknown[]) => ({}));
const apiPost = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({}));
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: (path: string) => apiGet(path),
    put: (...args: unknown[]) => apiPut(...args),
    post: (...args: unknown[]) => apiPost(...args),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

import { DashboardTab } from '../../src/ui/admin/DashboardTab';
import { UsersTab } from '../../src/ui/admin/UsersTab';
import { AchievementsTab } from '../../src/ui/admin/AchievementsTab';
import { CampaignTab } from '../../src/ui/admin/CampaignTab';

const DASHBOARD: Record<string, unknown> = {
  '/admin/stats': {
    totalUsers: 1,
    activeUsers24h: 1,
    totalMatches: 1,
    activeRooms: 0,
    activePlayers: 0,
  },
  '/admin/settings/recordings_enabled': { enabled: true },
  '/admin/settings/registration_enabled': { enabled: true },
  '/admin/settings/party_chat_mode': { mode: 'everyone' },
  '/admin/settings/lobby_chat_mode': { mode: 'everyone' },
  '/admin/settings/dm_mode': { mode: 'everyone' },
  '/admin/settings/emote_mode': { mode: 'everyone' },
  '/admin/settings/spectator_chat_mode': { mode: 'everyone' },
  '/admin/settings/xp_multiplier': { multiplier: 2.5 },
  '/admin/settings/default_theme': { theme: 'inferno' },
  '/admin/settings/default_art_style': { style: 'classic' },
  '/admin/settings/game_defaults': { defaults: { gameMode: 'teams' } },
  '/admin/settings/simulation_defaults': { defaults: {} },
  '/admin/ai/active': { ais: [] },
  // The imprint is off; the admin-only raw endpoint still answers the stored text.
  '/admin/settings/imprint/raw': { enabled: false, text: 'Stored imprint' },
  '/admin/settings/display_github': { enabled: false },
  '/admin/settings/spectator_actions_enabled': { enabled: true },
  '/admin/settings/email_settings': { settings: { smtpHost: 'smtp.example.org' } },
  '/admin/settings/open_world': {
    enabled: true,
    guestAccess: true,
    maxPlayers: 20,
    roundTime: 300,
    mapWidth: 51,
    mapHeight: 41,
    wallDensity: 0.5,
    respawnDelay: 3,
    afkTimeoutSeconds: 60,
  },
};

let notifications: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
let parent: HTMLElement;
const notes = () => notifications as unknown as NotificationUI;
const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);

beforeEach(() => {
  document.body.replaceChildren();
  const overlay = document.createElement('div');
  overlay.id = 'ui-overlay';
  document.body.appendChild(overlay);
  parent = document.createElement('div');
  document.body.appendChild(parent);
  routes.clear();
  apiGet.mockClear();
  apiPut.mockReset().mockResolvedValue({});
  apiPost.mockReset().mockResolvedValue({});
  notifications = { success: vi.fn(), error: vi.fn() };
});

function useDashboardRoutes() {
  for (const [path, body] of Object.entries(DASHBOARD)) routes.set(path, body);
}

describe('DashboardTab', () => {
  it('the imprint toggle sends only the flag and shows the stored text', async () => {
    useDashboardRoutes();
    const tab = new DashboardTab(notes());
    await tab.render(parent);

    const toggle = $<HTMLInputElement>('#toggle-display-imprint')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flush();

    expect(apiPut).toHaveBeenCalledWith('/admin/settings/imprint', { enabled: true });
    expect($<HTMLTextAreaElement>('#input-imprint-text')!.value).toBe('Stored imprint');
    tab.destroy();
  });

  it('a setting that fails to load is named and its save is locked; the rest load', async () => {
    useDashboardRoutes();
    routes.delete('/admin/settings/game_defaults');
    routes.delete('/admin/settings/open_world');
    const tab = new DashboardTab(notes());
    await tab.render(parent);

    expect(notifications.error).toHaveBeenCalledTimes(1);
    const msg = String(notifications.error.mock.calls[0][0]);
    expect(msg).toContain('admin:dashboard.settingsLoadFailed');
    expect(msg).toContain('admin:dashboard.gameCreationDefaults');
    expect(msg).toContain('admin:dashboard.openWorld.title');
    expect(msg).not.toContain('admin:dashboard.xpMultiplier');

    expect($<HTMLButtonElement>('#gd-save')!.disabled).toBe(true);
    expect($<HTMLButtonElement>('#ow-save-btn')!.disabled).toBe(true);
    expect($<HTMLButtonElement>('#sd-save')!.disabled).toBe(false);
    expect($<HTMLButtonElement>('#btn-save-xp-multiplier')!.disabled).toBe(false);
    // Values from the requests that succeeded still arrived.
    expect($<HTMLInputElement>('#input-xp-multiplier')!.value).toBe('2.5');
    tab.destroy();
  });

  it('the email reset sends an empty body and shows the reloaded settings', async () => {
    useDashboardRoutes();
    const tab = new DashboardTab(notes());
    await tab.render(parent);
    expect($<HTMLInputElement>('#email-smtpHost')!.value).toBe('smtp.example.org');

    routes.set('/admin/settings/email_settings', { settings: {} });
    $('#email-reset')!.click();
    await flush();

    expect(apiPut).toHaveBeenCalledWith('/admin/settings/email_settings', {});
    expect($<HTMLInputElement>('#email-smtpHost')!.value).toBe('');
    expect(notifications.success).toHaveBeenCalledWith('admin:dashboard.emailSettingsReset');
    tab.destroy();
  });
});

describe('UsersTab account cleanup', () => {
  async function openCleanup() {
    routes.set('/admin/users?page=1&limit=20', { users: [], total: 0, page: 1, limit: 20 });
    const tab = new UsersTab(notes(), 'admin');
    await tab.render(parent);
    $('#admin-cleanup')!.click();
    return tab;
  }

  async function preview(days: string) {
    const input = $<HTMLInputElement>('#cleanup-days')!;
    input.value = days;
    input.dispatchEvent(new Event('input'));
    apiPost.mockResolvedValueOnce({ count: 3 });
    $('#cleanup-preview')!.click();
    await flush();
  }

  it('executes with the previewed days, not whatever the input holds later', async () => {
    const tab = await openCleanup();
    await preview('30');
    expect(apiPost).toHaveBeenLastCalledWith('/admin/users/cleanup/preview', {
      type: 'unverified',
      days: 30,
    });

    // The value changes without an input event (e.g. a script or a browser quirk).
    $<HTMLInputElement>('#cleanup-days')!.value = '1';
    const confirm = $<HTMLInputElement>('#cleanup-confirm-input')!;
    confirm.value = 'DELETE';
    confirm.dispatchEvent(new Event('input'));
    apiPost.mockResolvedValueOnce({ deleted: 3 });
    $('#cleanup-execute')!.click();
    await flush();

    expect(apiPost).toHaveBeenLastCalledWith('/admin/users/cleanup/execute', {
      type: 'unverified',
      days: 30,
    });
    tab.destroy();
  });

  it('editing the days drops the preview and the delete button', async () => {
    const tab = await openCleanup();
    await preview('30');
    expect($('#cleanup-execute')).not.toBeNull();

    const input = $<HTMLInputElement>('#cleanup-days')!;
    input.value = '1';
    input.dispatchEvent(new Event('input'));

    expect($('#cleanup-execute')).toBeNull();
    expect($('#cleanup-confirm-input')).toBeNull();
    expect($<HTMLInputElement>('#cleanup-days')!.value).toBe('1');
    tab.destroy();
  });
});

const HOSTILE = '"><img src=x id=pwned>';

describe('escaping of stored config values', () => {
  it('achievement condition and cosmetic config values stay attribute values', () => {
    const tab = new AchievementsTab(notes()) as unknown as {
      renderConditionFields(c: HTMLElement, type: string, cfg: Record<string, unknown>): void;
      renderCosmeticConfigFields(c: HTMLElement, type: string, cfg: Record<string, unknown>): void;
    };
    const box = document.createElement('div');
    parent.appendChild(box);

    for (const type of ['cumulative', 'per_game', 'mode_specific', 'campaign']) {
      tab.renderConditionFields(box, type, { threshold: HOSTILE });
      expect(box.querySelector('#pwned')).toBeNull();
    }
    tab.renderConditionFields(box, 'cumulative', { threshold: { nested: true } });
    expect(box.querySelector<HTMLInputElement>('#am-cond-threshold')!.value).toBe('1');
    tab.renderConditionFields(box, 'cumulative', { threshold: 25 });
    expect(box.querySelector<HTMLInputElement>('#am-cond-threshold')!.value).toBe('25');

    tab.renderCosmeticConfigFields(box, 'trail', { frequency: HOSTILE, particleKey: HOSTILE });
    expect(box.querySelector('#pwned')).toBeNull();
  });

  it('enemy sprite colours and numbers from an import stay attribute values', () => {
    const tab = new CampaignTab(notes()) as unknown as {
      showEnemyModal(existing: unknown): void;
    };
    tab.showEnemyModal({
      id: 5,
      name: 'Evil',
      description: '',
      isBoss: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      config: {
        speed: 1,
        movementPattern: 'random_walk',
        canPassWalls: false,
        canPassBombs: false,
        canBomb: false,
        hp: HOSTILE,
        contactDamage: true,
        dropChance: 0,
        dropTable: [],
        isBoss: false,
        sizeMultiplier: 1,
        sprite: {
          bodyShape: 'blob',
          primaryColor: HOSTILE,
          secondaryColor: '#123456',
          eyeStyle: 'round',
          hasTeeth: false,
          hasHorns: false,
        },
      },
    });
    expect($('#pwned')).toBeNull();
    expect($<HTMLInputElement>('#enemy-primary-color')!.value).toBe('#cc3333');
    expect($<HTMLInputElement>('#enemy-secondary-color')!.value).toBe('#123456');
  });

  it('the campaign replay load error is text, not markup', async () => {
    routes.set('/admin/campaign/worlds', { worlds: [] });
    routes.set('/admin/campaign-replays?page=1&limit=20', new Error(HOSTILE));
    const tab = new CampaignTab(notes());
    await tab.render(parent);
    $('#camp-view-replays')!.click();
    await flush();
    expect(parent.textContent).toContain('<img src=x id=pwned>');
    expect($('#pwned')).toBeNull();
    tab.destroy();
  });
});

describe('CampaignTab enemy types', () => {
  beforeEach(() => {
    routes.set('/admin/campaign/worlds', { worlds: [] });
    routes.set('/admin/enemy-ai/active', { ais: [] });
    routes.set('/admin/campaign/enemy-types', { enemyTypes: [] });
  });

  it('ticking "Can bomb" sends a bombConfig the backend can bomb with', async () => {
    const tab = new CampaignTab(notes()) as unknown as { showEnemyModal(e?: unknown): void };
    tab.showEnemyModal();
    $<HTMLInputElement>('#enemy-name')!.value = 'Bomber';
    $<HTMLInputElement>('#enemy-can-bomb')!.checked = true;
    $<HTMLInputElement>('#enemy-boss')!.checked = true;
    $('#enemy-modal-submit')!.click();
    await flush();

    const [path, body] = apiPost.mock.calls[0] as [
      string,
      { config: { canBomb: boolean; isBoss: boolean; bombConfig?: Record<string, unknown> } },
    ];
    expect(path).toBe('/admin/campaign/enemy-types');
    expect(body.config.canBomb).toBe(true);
    expect(body.config.isBoss).toBe(true);
    expect(body.config.bombConfig).toMatchObject({
      fireRange: expect.any(Number),
      cooldownTicks: expect.any(Number),
      trigger: expect.any(String),
    });
  });

  it('an import with a bundled AI asks how to resolve it and toasts only once created', async () => {
    const file = {
      text: async () =>
        JSON.stringify({
          _format: 'blast-arena-enemy-type',
          _version: 1,
          name: 'Smart',
          config: { enemyAiId: 'abc' },
          enemyAiSource: 'export default {}',
          enemyAiName: 'Brain',
        }),
    };
    let picker: HTMLInputElement | null = null;
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      if (this.type === 'file') picker = this;
    });
    const tab = new CampaignTab(notes()) as unknown as { importEnemyType(): void };
    tab.importEnemyType();
    click.mockRestore();
    Object.defineProperty(picker!, 'files', { value: [file] });

    apiPost.mockResolvedValueOnce({
      needsResolution: true,
      conflict: { aiName: 'Brain', existingId: 'ai-7', existingName: '<b>Old</b>' },
    });
    picker!.dispatchEvent(new Event('change'));
    await flush();
    await flush();

    expect(notifications.success).not.toHaveBeenCalled();
    const options = [
      ...document.querySelectorAll<HTMLInputElement>('input[name="enemy-ai-action"]'),
    ].map((o) => o.value);
    expect(options).toEqual(['create', 'use-existing:ai-7', 'skip']);
    expect($('[role="dialog"] b')).toBeNull();

    $<HTMLInputElement>('input[value="use-existing:ai-7"]')!.checked = true;
    apiPost.mockResolvedValueOnce({ id: 12 });
    $('#enemy-ai-conflict-submit')!.click();
    await flush();

    expect(apiPost).toHaveBeenLastCalledWith('/admin/campaign/enemy-types/import', {
      name: 'Smart',
      config: { enemyAiId: 'abc' },
      enemyAiSource: 'export default {}',
      enemyAiName: 'Brain',
      enemyAiAction: 'use-existing:ai-7',
    });
    expect(notifications.success).toHaveBeenCalledWith('admin:campaign.enemies.enemyImported');
    expect($('#enemy-ai-conflict-submit')).toBeNull();
  });
});
