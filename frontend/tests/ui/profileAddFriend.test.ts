import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SocketClient } from '../../src/network/SocketClient';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';
import type { ViewDeps } from '../../src/ui/views/types';

/**
 * ProfileView "Add Friend" (item 5) posted to /friends/search — a lookup that sends nothing — and
 * toasted success regardless. It now emits 'friend:request' with an ack like FriendsView and
 * reports the actual result.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/utils/playerCanvas', () => ({
  drawPlayerSprite: vi.fn(),
  getPlayerColorHex: () => '#ff6b35',
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('../../src/network/ApiClient', () => ({
  ApiClient: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    username: 'rival',
    role: 'moderator',
    createdAt: '2026-01-15T00:00:00Z',
    stats: {
      totalMatches: 10,
      totalWins: 4,
      totalKills: 20,
      totalDeaths: 10,
      eloRating: 1234,
      peakElo: 1300,
      winStreak: 1,
      bestWinStreak: 3,
      level: 5,
      totalXp: 1100,
    },
    rankTier: 'Gold',
    rankColor: '#ffd700',
    seasonHistory: [],
    achievements: [],
    equippedCosmetics: { colorId: null, eyesId: null, trailId: null, bombSkinId: null },
    ...overrides,
  };
}

let emit: ReturnType<typeof vi.fn>;
let notifications: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

function deps(): ViewDeps {
  return {
    socketClient: { emit, on: vi.fn(), off: vi.fn() } as unknown as SocketClient,
    authManager: {
      getUser: () => ({ id: 1, username: 'me', role: 'user' }),
    } as unknown as AuthManager,
    notifications: notifications as unknown as NotificationUI,
  };
}

let container: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement('div');
  document.body.appendChild(container);
  apiGet.mockReset();
  apiPost.mockReset();
  emit = vi.fn();
  notifications = { success: vi.fn(), error: vi.fn() };
});

async function renderProfile(p = profile()) {
  apiGet.mockResolvedValue(p);
  const { ProfileView } = await import('../../src/ui/views/ProfileView');
  const view = new ProfileView(deps(), { userId: 7 });
  await view.render(container);
  return view;
}

describe('ProfileView Add Friend', () => {
  it('sends a real friend request over the socket and reports success', async () => {
    emit.mockImplementation((event: string, _data: unknown, cb: (r: unknown) => void) => {
      if (event === 'friend:request') cb({ success: true });
    });
    const view = await renderProfile();
    const btn = container.querySelector<HTMLButtonElement>('.profile-page-add-friend')!;
    btn.click();
    await flush();

    expect(emit).toHaveBeenCalledWith(
      'friend:request',
      { username: 'rival' },
      expect.any(Function),
    );
    expect(apiPost).not.toHaveBeenCalled(); // no /friends/search
    expect(btn.textContent).toBe('ui:profile.requestSentBtn');
    expect(btn.disabled).toBe(true);
    expect(notifications.success).toHaveBeenCalledWith('ui:profile.requestSent');
    view.destroy();
  });

  it('shows the failure and lets the user try again', async () => {
    emit.mockImplementation((event: string, _data: unknown, cb: (r: unknown) => void) => {
      if (event === 'friend:request') cb({ success: false });
    });
    const view = await renderProfile();
    const btn = container.querySelector<HTMLButtonElement>('.profile-page-add-friend')!;
    btn.click();
    await flush();

    expect(notifications.success).not.toHaveBeenCalled();
    expect(notifications.error).toHaveBeenCalledWith('ui:profile.requestFailed');
    expect(btn.disabled).toBe(false);
    view.destroy();
  });

  it('keeps a hostile rank colour and achievement icon out of the markup (item 9)', async () => {
    const view = await renderProfile(
      profile({
        rankColor: 'red;background:url(//evil)',
        achievements: [
          {
            achievement: {
              id: 1,
              name: 'A',
              description: 'd',
              icon: '<img src=x onerror=alert(1)>',
            },
            unlockedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    const rank = container.querySelector<HTMLElement>('.profile-page-rank-value')!;
    expect(rank.getAttribute('style')).toBe('color:var(--primary)');
    expect(container.querySelector('.profile-page-achievement img')).toBeNull();
    expect(container.querySelector('.profile-page-achievement-icon')!.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
    // Labels are translated, not hard-coded English
    expect(container.textContent).toContain('ui:profile.rank');
    expect(container.textContent).not.toContain('Peak:');
    view.destroy();
  });
});
