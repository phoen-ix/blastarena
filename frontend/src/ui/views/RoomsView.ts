import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import {
  RoomListItem,
  Room,
  GameDefaults,
  BotAIEntry,
  CustomMapSummary,
  getErrorMessage,
} from '@blast-arena/shared';
import { escapeHtml, escapeAttr } from '../../utils/html';
import { showCreateRoomModal } from '../modals/CreateRoomModal';
import { t } from '../../i18n';

export class RoomsView implements ILobbyView {
  readonly viewId = 'rooms';
  get title() {
    return t('ui:rooms.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private onJoinRoom: (room: Room) => void;
  private cachedRooms: RoomListItem[] | null = null;

  constructor(deps: ViewDeps, onJoinRoom: (room: Room) => void) {
    this.deps = deps;
    this.onJoinRoom = onJoinRoom;
  }

  getHeaderActions(): string {
    return `<button class="btn btn-primary btn-sm" id="create-room-btn">${t('ui:rooms.create')}</button>`;
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    container.innerHTML = `
      <div id="lobby-banner-area" style="padding:0 var(--sp-6);"></div>
      <div class="room-list empty" id="room-list">
        <div class="room-list-empty-state">${t('ui:rooms.loading')}</div>
      </div>
    `;

    // Delegated click + keyboard handler on room list — set up once per render()
    const list = container.querySelector('#room-list')!;
    list.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest('.room-card') as HTMLElement | null;
      if (card?.dataset.code) {
        this.joinRoom(card.dataset.code);
      }
    });
    list.addEventListener('keydown', (ev) => {
      const e = ev as KeyboardEvent;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = (e.target as HTMLElement).closest('.room-card') as HTMLElement | null;
      if (card?.dataset.code) {
        e.preventDefault();
        this.joinRoom(card.dataset.code);
      }
    });

    this.loadBanner();

    if (this.cachedRooms) {
      this.renderRooms(this.cachedRooms);
    } else {
      this.loadRooms();
    }
  }

  destroy(): void {
    this.container = null;
  }

  /** Called by LobbyUI when room:list event fires */
  updateRooms(rooms: RoomListItem[]): void {
    this.cachedRooms = rooms;
    if (this.container) {
      this.renderRooms(rooms);
    }
  }

  private async loadRooms(): Promise<void> {
    try {
      const rooms = await ApiClient.get<RoomListItem[]>('/lobby/rooms');
      this.cachedRooms = rooms;
      this.renderRooms(rooms);
    } catch (err: unknown) {
      this.deps.notifications.error(t('ui:rooms.loadFailed', { error: getErrorMessage(err) }));
    }
  }

  private renderRooms(rooms: RoomListItem[]): void {
    const list = this.container?.querySelector('#room-list');
    if (!list) return;

    if (rooms.length === 0) {
      list.classList.add('empty');
      list.innerHTML = `<div class="room-list-empty-state">${t('ui:rooms.empty')}</div>`;
      return;
    }

    list.classList.remove('empty');
    list.innerHTML = rooms
      .map(
        (room) => `
      <div class="room-card ${room.status === 'waiting' ? 'waiting' : 'playing'}" data-code="${escapeAttr(room.code)}" tabindex="0" role="button">
        <h3>${escapeHtml(room.name)}</h3>
        <div class="room-info">
          <span>${t('ui:rooms.players', { current: room.playerCount, max: room.maxPlayers })}</span>
          <span class="room-mode">${room.gameMode.replace('_', ' ').toUpperCase()}</span>
        </div>
        <div class="room-info" style="margin-top:6px;">
          <span>${t('ui:rooms.host', { name: escapeHtml(room.host) })}</span>
          <span style="color:${room.status === 'playing' ? 'var(--warning)' : 'var(--success)'};">${room.status}</span>
        </div>
      </div>
    `,
      )
      .join('');
  }

  private async joinRoom(code: string): Promise<void> {
    this.deps.socketClient.emit('room:join', { code }, (response: any) => {
      if (response.success && response.room) {
        this.deps.notifications.success(t('ui:rooms.joined', { name: response.room.name }));
        this.onJoinRoom(response.room);
      } else {
        this.deps.notifications.error(response.error || t('ui:rooms.joinFailed'));
      }
    });
  }

  private async loadBanner(): Promise<void> {
    try {
      const banner = await ApiClient.get<any>('/admin/announcements/banner');
      const area = this.container?.querySelector('#lobby-banner-area');
      if (area && banner && banner.message) {
        area.innerHTML = `
          <div class="admin-banner">
            <span>${escapeHtml(banner.message)}</span>
            <button class="banner-close">&times;</button>
          </div>
        `;
        area.querySelector('.banner-close')?.addEventListener('click', () => {
          area.innerHTML = '';
        });
      }
    } catch {
      // No banner — ignore
    }
  }

  private async showCreateRoomModal(): Promise<void> {
    let recordingsEnabled = false;
    let gameDefaults: GameDefaults = {};
    let activeAIs: BotAIEntry[] = [];
    let customMaps: CustomMapSummary[] = [];
    try {
      const [recResp, defResp, aiResp, myMapsResp, pubMapsResp] = await Promise.all([
        ApiClient.get<{ enabled: boolean }>('/admin/settings/recordings_enabled'),
        ApiClient.get<{ defaults: GameDefaults }>('/admin/settings/game_defaults'),
        ApiClient.get<{ ais: BotAIEntry[] }>('/admin/ai/active'),
        ApiClient.get<{ maps: CustomMapSummary[] }>('/maps/mine').catch(() => ({ maps: [] })),
        ApiClient.get<{ maps: CustomMapSummary[] }>('/maps/published').catch(() => ({ maps: [] })),
      ]);
      recordingsEnabled = recResp.enabled;
      gameDefaults = defResp.defaults ?? {};
      activeAIs = aiResp.ais ?? [];
      // Merge and deduplicate
      const myIds = new Set((myMapsResp.maps ?? []).map((m) => m.id));
      customMaps = [
        ...(myMapsResp.maps ?? []),
        ...(pubMapsResp.maps ?? []).filter((m) => !myIds.has(m.id)),
      ];
    } catch {
      // defaults
    }
    showCreateRoomModal({
      socketClient: this.deps.socketClient,
      notifications: this.deps.notifications,
      onRoomCreated: (room) => this.onJoinRoom(room),
      generateRoomName: () => this.generateRoomName(),
      recordingsEnabled,
      gameDefaults,
      activeAIs,
      customMaps,
    });
  }

  private generateRoomName(): string {
    const adjectives = [
      'Explosive',
      'Chaotic',
      'Blazing',
      'Fiery',
      'Reckless',
      'Volatile',
      'Scorched',
      'Molten',
      'Infernal',
      'Savage',
    ];
    const nouns = [
      'Arena',
      'Warzone',
      'Blitz',
      'Showdown',
      'Brawl',
      'Mayhem',
      'Rumble',
      'Frenzy',
      'Clash',
      'Carnage',
    ];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
  }
}
