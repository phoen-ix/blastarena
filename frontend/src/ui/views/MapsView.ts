import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { CustomMapSummary, Position, TileType } from '@blast-arena/shared';
import { escapeHtml, setHtml } from '../../utils/html';
import { createModal } from '../../utils/modal';
import { t } from '../../i18n';
import { game } from '../../main';
import { ensureLevelEditorScene } from '../../scenes/levelEditorLoader';

export class MapsView implements ILobbyView {
  readonly viewId = 'maps';
  get title() {
    return t('ui:maps.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private maps: CustomMapSummary[] = [];
  // Delegated click handler, bound once per render() on the view's container and removed in
  // destroy(). Binding it inside renderContent() stacked one copy per re-render — after two
  // publishes a single Delete click ran three times. (audit C2)
  private clickHandler: ((e: Event) => void) | null = null;
  private boundContainer: HTMLElement | null = null;

  constructor(deps: ViewDeps) {
    this.deps = deps;
  }

  getHeaderActions(): string {
    return `<button class="btn btn-primary btn-sm" id="create-map-btn">${t('ui:maps.create')}</button>`;
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    this.bindEvents();
    await this.loadMaps();
    this.renderContent();
  }

  destroy(): void {
    this.unbindEvents();
    this.container = null;
  }

  private unbindEvents(): void {
    if (this.boundContainer && this.clickHandler) {
      this.boundContainer.removeEventListener('click', this.clickHandler);
    }
    this.boundContainer = null;
    this.clickHandler = null;
  }

  private async loadMaps(): Promise<void> {
    try {
      const resp = await ApiClient.get<{ maps: CustomMapSummary[] }>('/maps/mine');
      this.maps = resp.maps ?? [];
    } catch {
      this.maps = [];
    }
  }

  private renderContent(): void {
    if (!this.container) return;

    if (this.maps.length === 0) {
      setHtml(
        this.container,
        `
        <div style="text-align:center;padding:40px 20px;color:var(--text-dim);">
          <div style="font-size:48px;margin-bottom:16px;">&#9638;</div>
          <h3 style="margin:0 0 8px 0;color:var(--text);">${t('ui:maps.noMapsYet')}</h3>
          <p style="margin:0 0 16px 0;">${t('ui:maps.emptyDescription')}</p>
          <button class="btn btn-primary" id="empty-create-map">${t('ui:maps.createFirst')}</button>
        </div>
      `,
      );
      this.container.querySelector('#empty-create-map')?.addEventListener('click', () => {
        void this.launchEditor(null);
      });
      return;
    }

    setHtml(
      this.container,
      `
      <table class="data-table">
        <thead>
          <tr>
            <th>${t('ui:maps.name')}</th>
            <th>${t('ui:maps.size')}</th>
            <th>${t('ui:maps.spawns')}</th>
            <th>${t('ui:maps.plays')}</th>
            <th>${t('ui:maps.published')}</th>
            <th>${t('ui:maps.actions')}</th>
          </tr>
        </thead>
        <tbody>
          ${this.maps
            .map(
              (m) => `
            <tr>
              <td>${escapeHtml(m.name)}</td>
              <td>${m.mapWidth}x${m.mapHeight}</td>
              <td>${m.spawnCount}</td>
              <td>${m.playCount}</td>
              <td>${m.isPublished ? `<span style="color:var(--primary);">${t('ui:maps.yes')}</span>` : `<span style="color:var(--text-dim);">${t('ui:maps.no')}</span>`}</td>
              <td style="display:flex;gap:4px;">
                <button class="btn btn-sm btn-ghost map-edit" data-id="${m.id}">${t('ui:maps.edit')}</button>
                <button class="btn btn-sm btn-ghost map-toggle-pub" data-id="${m.id}" data-published="${m.isPublished}">${m.isPublished ? t('ui:maps.unpublish') : t('ui:maps.publish')}</button>
                <button class="btn btn-sm btn-ghost" style="color:var(--danger);" data-id="${m.id}" data-action="delete">${t('ui:maps.delete')}</button>
              </td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    `,
    );
  }

  private bindEvents(): void {
    if (!this.container || this.boundContainer === this.container) return;
    this.unbindEvents();
    this.boundContainer = this.container;

    // Event delegation
    this.clickHandler = async (e: Event) => {
      const target = e.target as HTMLElement;

      if (target.classList.contains('map-edit')) {
        const id = parseInt(target.dataset.id!, 10);
        void this.launchEditor(id);
        return;
      }

      if (target.classList.contains('map-toggle-pub')) {
        const id = parseInt(target.dataset.id!, 10);
        const isPublished = target.dataset.published === 'true';
        await this.togglePublish(id, !isPublished);
        return;
      }

      if (target.dataset.action === 'delete') {
        const id = parseInt(target.dataset.id!, 10);
        this.deleteMap(id);
        return;
      }
    };
    this.container.addEventListener('click', this.clickHandler);
  }

  private async launchEditor(mapId: number | null): Promise<void> {
    game.registry.set('editorMode', 'custom_map');
    game.registry.set('customMapId', mapId);
    // The editor scene is a lazy chunk, added to the game on first use. (audit F9)
    await ensureLevelEditorScene(game);
    const lobbyScene = game.scene.getScene('LobbyScene');
    if (lobbyScene) lobbyScene.scene.start('LevelEditorScene');
  }

  private async togglePublish(id: number, publish: boolean): Promise<void> {
    const map = this.maps.find((m) => m.id === id);
    if (!map) return;

    try {
      // Need to load the full map to update it
      const resp = await ApiClient.get<{
        map: {
          tiles: TileType[][];
          spawnPoints: Position[];
          name: string;
          description: string;
          mapWidth: number;
          mapHeight: number;
        };
      }>(`/maps/${id}`);
      const full = resp.map;
      await ApiClient.put(`/maps/${id}`, {
        name: full.name,
        description: full.description || '',
        mapWidth: full.mapWidth,
        mapHeight: full.mapHeight,
        tiles: full.tiles,
        spawnPoints: full.spawnPoints,
        isPublished: publish,
      });
      this.deps.notifications.success(
        publish ? t('ui:maps.mapPublished') : t('ui:maps.mapUnpublished'),
      );
      await this.loadMaps();
      this.renderContent();
    } catch (err) {
      this.deps.notifications.error(t('ui:maps.failedUpdate', { error: (err as Error).message }));
    }
  }

  private deleteMap(id: number): void {
    const map = this.maps.find((m) => m.id === id);
    if (!map) return;

    // In-app confirmation instead of the native confirm(): focus-trapped, Escape closes, and it
    // renders in the app's theme like every other modal. (audit G12)
    const { overlay, content, close } = createModal({
      ariaLabel: t('ui:maps.delete'),
      style: 'max-width:420px;',
      parent: document.getElementById('ui-overlay') ?? document.body,
    });
    setHtml(
      content,
      `
      <h2 class="text-danger">${t('ui:maps.delete')}</h2>
      <p class="modal-desc">${escapeHtml(t('ui:maps.confirmDeleteNamed', { name: map.name }))}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="map-delete-cancel">${t('common:actions.cancel')}</button>
        <button class="btn btn-danger" id="map-delete-confirm">${t('common:actions.delete')}</button>
      </div>
    `,
    );
    overlay.querySelector('#map-delete-cancel')!.addEventListener('click', close);
    overlay.querySelector('#map-delete-confirm')!.addEventListener('click', async () => {
      close();
      try {
        await ApiClient.delete(`/maps/${id}`);
        this.deps.notifications.success(t('ui:maps.mapDeleted'));
        await this.loadMaps();
        this.renderContent();
      } catch (err) {
        this.deps.notifications.error(t('ui:maps.failedDelete', { error: (err as Error).message }));
      }
    });
  }
}
