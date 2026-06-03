import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import { CustomMapSummary } from '@blast-arena/shared';
import { escapeHtml } from '../../utils/html';
import { t } from '../../i18n';
import { game } from '../../main';

export class MapsView implements ILobbyView {
  readonly viewId = 'maps';
  get title() {
    return t('ui:maps.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private maps: CustomMapSummary[] = [];

  constructor(deps: ViewDeps) {
    this.deps = deps;
  }

  getHeaderActions(): string {
    return `<button class="btn btn-primary btn-sm" id="create-map-btn">${t('ui:maps.create')}</button>`;
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    await this.loadMaps();
    this.renderContent();
  }

  destroy(): void {
    this.container = null;
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
      this.container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--text-dim);">
          <div style="font-size:48px;margin-bottom:16px;">&#9638;</div>
          <h3 style="margin:0 0 8px 0;color:var(--text);">${t('ui:maps.noMapsYet')}</h3>
          <p style="margin:0 0 16px 0;">${t('ui:maps.emptyDescription')}</p>
          <button class="btn btn-primary" id="empty-create-map">${t('ui:maps.createFirst')}</button>
        </div>
      `;
      this.container.querySelector('#empty-create-map')?.addEventListener('click', () => {
        this.launchEditor(null);
      });
      return;
    }

    this.container.innerHTML = `
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
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    if (!this.container) return;

    // Event delegation
    this.container.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      if (target.classList.contains('map-edit')) {
        const id = parseInt(target.dataset.id!, 10);
        this.launchEditor(id);
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
        await this.deleteMap(id);
        return;
      }
    });
  }

  private launchEditor(mapId: number | null): void {
    game.registry.set('editorMode', 'custom_map');
    game.registry.set('customMapId', mapId);
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
          tiles: any;
          spawnPoints: any;
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

  private async deleteMap(id: number): Promise<void> {
    const map = this.maps.find((m) => m.id === id);
    if (!map) return;

    if (!confirm(t('ui:maps.confirmDeleteNamed', { name: map.name }))) return;

    try {
      await ApiClient.delete(`/maps/${id}`);
      this.deps.notifications.success(t('ui:maps.mapDeleted'));
      await this.loadMaps();
      this.renderContent();
    } catch (err) {
      this.deps.notifications.error(t('ui:maps.failedDelete', { error: (err as Error).message }));
    }
  }
}
