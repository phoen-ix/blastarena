import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Room } from '@blast-arena/shared';
import type { SocketClient } from '../../src/network/SocketClient';
import type { AuthManager } from '../../src/network/AuthManager';
import type { NotificationUI } from '../../src/ui/NotificationUI';

/**
 * The waiting room's Room Settings panel showed the generator's map size and wall density
 * (31x31, 65 %) for a room on a custom map and never named the map.
 */

vi.mock('../../src/i18n', () => ({ t: (key: string) => key, i18n: { language: 'en' } }));
vi.mock('../../src/game/UIGamepadNavigator', () => ({
  UIGamepadNavigator: {
    getInstance: () => ({ pushContext() {}, popContext() {}, clearAll() {}, setActive() {} }),
  },
}));

import { RoomUI } from '../../src/ui/RoomUI';

function room(extra: Partial<Room>, config: Record<string, unknown> = {}): Room {
  const host = { id: 1, username: 'host', role: 'user' };
  return {
    code: 'K7Q2WD',
    name: 'Friday Night Blast',
    host,
    players: [{ user: host, ready: true, team: null }],
    config: {
      gameMode: 'ffa',
      maxPlayers: 4,
      mapWidth: 31,
      mapHeight: 31,
      roundTime: 60,
      ...config,
    },
    status: 'waiting',
    createdAt: new Date(),
    ...extra,
  } as unknown as Room;
}

function panelText(r: Room): string {
  document.body.innerHTML = '<div id="ui-overlay"></div>';
  const ui = new RoomUI(
    { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as SocketClient,
    { getUser: () => ({ id: 1, username: 'host', role: 'user' }) } as unknown as AuthManager,
    {} as NotificationUI,
    r,
    () => {},
  );
  ui.show();
  return document.getElementById('ui-overlay')!.textContent ?? '';
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('waiting room settings panel', () => {
  it('names the custom map instead of the generator size and wall density', () => {
    const text = panelText(room({ customMapName: 'Crossfire Courtyard' }, { customMapId: 3 }));
    expect(text).toContain('ui:createRoom.map');
    expect(text).toContain('Crossfire Courtyard');
    expect(text).not.toContain('ui:room.mapSize');
    expect(text).not.toContain('ui:room.wallDensity');
  });

  it('keeps size and wall density for a generated map', () => {
    const text = panelText(room({}));
    expect(text).toContain('ui:room.mapSize');
    expect(text).toContain('ui:room.wallDensity');
    expect(text).not.toContain('ui:createRoom.map');
  });
});
