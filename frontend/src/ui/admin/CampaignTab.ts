import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import {
  CampaignWorld,
  CampaignLevelSummary,
  EnemyTypeEntry,
  EnemyTypeConfig,
  EnemySpriteConfig,
  EnemyBodyShape,
  EnemyEyeStyle,
  EnemyAccessory,
  EnemyMovementPattern,
  CampaignWinCondition,
  PowerUpType,
  ImportConflict,
  ENEMY_BODY_SHAPES,
  ENEMY_EYE_STYLES,
  ENEMY_ACCESSORIES,
  MOVEMENT_PATTERNS,
  EnemyAIEntry,
  CampaignReplayListItem,
  ReplayData,
  GameState,
  getErrorMessage,
} from '@blast-arena/shared';
import { escapeHtml, escapeAttr } from '../../utils/html';
import { EnemyTextureGenerator } from '../../game/EnemyTextureGenerator';
import game from '../../main';

type ViewMode = 'worlds' | 'enemies' | 'replays';

interface WorldWithLevels extends CampaignWorld {
  expanded?: boolean;
  levels?: CampaignLevelSummary[];
}

const THEME_OPTIONS = ['forest', 'desert', 'ice', 'volcano', 'void', 'castle', 'swamp', 'sky'];
const WIN_CONDITION_LABELS: Record<CampaignWinCondition, string> = {
  kill_all: 'Kill All Enemies',
  find_exit: 'Find Exit',
  reach_goal: 'Reach Goal',
  survive_time: 'Survive Time',
};

function defaultEnemyConfig(): EnemyTypeConfig {
  return {
    speed: 1,
    movementPattern: 'random_walk',
    canPassWalls: false,
    canPassBombs: false,
    canBomb: false,
    hp: 1,
    contactDamage: true,
    sprite: {
      bodyShape: 'blob',
      primaryColor: '#cc3333',
      secondaryColor: '#ff6666',
      eyeStyle: 'round',
      hasTeeth: false,
      hasHorns: false,
      hasTail: false,
      hasAura: false,
      hasCrown: false,
      hasScar: false,
      hasWings: false,
      accessory: 'none',
    },
    dropChance: 0.25,
    dropTable: ['bomb_up', 'fire_up'] as PowerUpType[],
    isBoss: false,
    sizeMultiplier: 1,
  };
}

export class CampaignTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private viewMode: ViewMode = 'worlds';
  private worlds: WorldWithLevels[] = [];
  private enemyTypes: EnemyTypeEntry[] = [];

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    await this.renderView();
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
    this.worlds = [];
    this.enemyTypes = [];
  }

  private async renderView(): Promise<void> {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="camp-tab-header">
        <h3>Campaign Manager</h3>
        <div class="flex-row">
          <button class="btn ${this.viewMode === 'worlds' ? 'btn-primary' : 'btn-ghost'}" id="camp-view-worlds">Worlds &amp; Levels</button>
          <button class="btn ${this.viewMode === 'enemies' ? 'btn-primary' : 'btn-ghost'}" id="camp-view-enemies">Enemy Types</button>
          <button class="btn ${this.viewMode === 'replays' ? 'btn-primary' : 'btn-ghost'}" id="camp-view-replays">Replays</button>
        </div>
      </div>
      <div id="camp-content"></div>
    `;

    this.container.querySelector('#camp-view-worlds')!.addEventListener('click', () => {
      if (this.viewMode !== 'worlds') {
        this.viewMode = 'worlds';
        this.renderView();
      }
    });
    this.container.querySelector('#camp-view-enemies')!.addEventListener('click', () => {
      if (this.viewMode !== 'enemies') {
        this.viewMode = 'enemies';
        this.renderView();
      }
    });
    this.container.querySelector('#camp-view-replays')!.addEventListener('click', () => {
      if (this.viewMode !== 'replays') {
        this.viewMode = 'replays';
        this.renderView();
      }
    });

    if (this.viewMode === 'worlds') {
      await this.loadWorlds();
    } else if (this.viewMode === 'enemies') {
      await this.loadEnemyTypes();
    } else {
      await this.loadCampaignReplays();
    }
  }

  // ============================
  // Worlds & Levels View
  // ============================

  private async loadWorlds(): Promise<void> {
    if (!this.container) return;
    const content = this.container.querySelector('#camp-content');
    if (!content) return;

    try {
      const res = await ApiClient.get<{ worlds: CampaignWorld[] }>('/admin/campaign/worlds');
      // Preserve expansion state
      const expandedIds = new Set(this.worlds.filter((w) => w.expanded).map((w) => w.id));
      this.worlds = res.worlds.map((w) => ({
        ...w,
        expanded: expandedIds.has(w.id),
      }));
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      this.worlds = [];
    }

    this.renderWorldsTable(content as HTMLElement);

    // Load levels for expanded worlds
    for (const world of this.worlds) {
      if (world.expanded) {
        await this.loadLevelsForWorld(world);
      }
    }
  }

  private renderWorldsTable(content: HTMLElement): void {
    content.innerHTML = `
      <div class="camp-toolbar">
        <button class="btn btn-primary" id="camp-create-world">Create World</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:30px;"></th>
            <th>Name</th>
            <th>Theme</th>
            <th>Levels</th>
            <th>Published</th>
            <th>Order</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="camp-worlds-body">
          ${this.worlds.length === 0 ? '<tr><td colspan="7" class="camp-empty-cell">No worlds created yet</td></tr>' : this.worlds.map((w) => this.renderWorldRow(w)).join('')}
        </tbody>
      </table>
    `;

    content.querySelector('#camp-create-world')!.addEventListener('click', () => {
      this.showWorldModal();
    });

    this.attachWorldHandlers(content);
  }

  private renderWorldRow(world: WorldWithLevels): string {
    const publishBadge = world.isPublished
      ? '<span class="text-success font-semibold">Published</span>'
      : '<span class="text-dim">Draft</span>';
    const expandIcon = world.expanded ? '&#9660;' : '&#9654;';

    let rows = `
      <tr data-world-id="${world.id}" class="camp-world-row clickable">
        <td class="camp-expand-cell camp-expand">${expandIcon}</td>
        <td><strong>${escapeHtml(world.name)}</strong></td>
        <td><span class="camp-theme-badge">${escapeHtml(world.theme)}</span></td>
        <td>${world.levelCount ?? 0}</td>
        <td>${publishBadge}</td>
        <td>
          <div class="camp-order-cell">
            <button class="btn-sm btn-ghost camp-order-up" data-id="${world.id}" title="Move up">&#9650;</button>
            <span class="camp-order-value">${world.sortOrder}</span>
            <button class="btn-sm btn-ghost camp-order-down" data-id="${world.id}" title="Move down">&#9660;</button>
          </div>
        </td>
        <td>
          <div class="camp-btn-group">
            <button class="btn-sm btn-secondary camp-toggle-pub-world" data-id="${world.id}" data-pub="${world.isPublished}">${world.isPublished ? 'Unpublish' : 'Publish'}</button>
            <button class="btn-sm btn-secondary camp-edit-world" data-id="${world.id}">Edit</button>
            <button class="btn-sm btn-danger camp-delete-world" data-id="${world.id}" data-name="${escapeAttr(world.name)}">Delete</button>
          </div>
        </td>
      </tr>
    `;

    if (world.expanded) {
      rows += `
        <tr class="camp-levels-container" data-world-id="${world.id}">
          <td colspan="7" class="camp-levels-nested">
            <div id="camp-levels-${world.id}" class="camp-levels-inner">
              ${world.levels ? this.renderLevelsSection(world) : '<span class="text-dim">Loading levels...</span>'}
            </div>
          </td>
        </tr>
      `;
    }

    return rows;
  }

  private renderLevelsSection(world: WorldWithLevels): string {
    const levels = world.levels || [];
    return `
      <div class="camp-levels-header">
        <span class="camp-levels-title">Levels in ${escapeHtml(world.name)}</span>
        <div class="camp-btn-group">
          <button class="btn-sm btn-secondary camp-import-level" data-world-id="${world.id}">Import Level</button>
          <button class="btn-sm btn-primary camp-create-level" data-world-id="${world.id}">Add Level</button>
        </div>
      </div>
      ${
        levels.length === 0
          ? '<div class="camp-levels-empty">No levels yet</div>'
          : `<table class="data-table compact">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Map Size</th>
            <th>Win Condition</th>
            <th>Lives</th>
            <th>Timer</th>
            <th>Enemies</th>
            <th>Published</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${levels.map((l) => this.renderLevelRow(l)).join('')}
        </tbody>
      </table>`
      }
    `;
  }

  private renderLevelRow(level: CampaignLevelSummary): string {
    const publishBadge = level.isPublished
      ? '<span class="text-success">Yes</span>'
      : '<span class="text-dim">No</span>';
    const timeStr =
      level.timeLimit > 0
        ? `${Math.floor(level.timeLimit / 60)}:${String(level.timeLimit % 60).padStart(2, '0')}`
        : 'None';
    const winLabel = WIN_CONDITION_LABELS[level.winCondition] || level.winCondition;

    return `
      <tr data-level-id="${level.id}">
        <td>
          <div class="camp-level-order-cell">
            <button class="btn-sm btn-ghost camp-level-order-up camp-level-order-btn" data-id="${level.id}" title="Move up">&#9650;</button>
            <span class="camp-level-order-value">${level.sortOrder}</span>
            <button class="btn-sm btn-ghost camp-level-order-down camp-level-order-btn" data-id="${level.id}" title="Move down">&#9660;</button>
          </div>
        </td>
        <td>${escapeHtml(level.name)}</td>
        <td>${level.mapWidth}x${level.mapHeight}</td>
        <td><span class="text-xs">${escapeHtml(winLabel)}</span></td>
        <td>${level.lives}</td>
        <td>${timeStr}</td>
        <td>${level.enemyCount}</td>
        <td>${publishBadge}</td>
        <td>
          <div class="camp-btn-group">
            <button class="btn-sm btn-primary camp-edit-level" data-id="${level.id}">Edit</button>
            <button class="btn-sm btn-secondary camp-export-level" data-id="${level.id}" data-name="${escapeAttr(level.name)}" title="Export level">Export</button>
            <button class="btn-sm btn-secondary camp-export-bundle" data-id="${level.id}" data-name="${escapeAttr(level.name)}" title="Export level + enemy types">Bundle</button>
            <button class="btn-sm btn-secondary camp-toggle-pub-level" data-id="${level.id}" data-pub="${level.isPublished}">${level.isPublished ? 'Unpublish' : 'Publish'}</button>
            <button class="btn-sm btn-danger camp-delete-level" data-id="${level.id}" data-name="${escapeAttr(level.name)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  private attachWorldHandlers(content: HTMLElement): void {
    // Expand/collapse worlds
    content.querySelectorAll('.camp-world-row').forEach((row) => {
      row.addEventListener('click', async (e: Event) => {
        const target = e.target as HTMLElement;
        // Don't toggle on button clicks
        if (target.closest('button')) return;
        const worldId = Number((row as HTMLElement).dataset.worldId);
        const world = this.worlds.find((w) => w.id === worldId);
        if (!world) return;
        world.expanded = !world.expanded;
        if (world.expanded && !world.levels) {
          await this.loadLevelsForWorld(world);
        }
        this.renderWorldsTable(content);
      });
    });

    // Order up/down for worlds
    content.querySelectorAll('.camp-order-up').forEach((btn) => {
      btn.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        const id = Number((btn as HTMLElement).dataset.id);
        const world = this.worlds.find((w) => w.id === id);
        if (!world || world.sortOrder <= 1) return;
        await this.updateWorldOrder(id, world.sortOrder - 1);
      });
    });
    content.querySelectorAll('.camp-order-down').forEach((btn) => {
      btn.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        const id = Number((btn as HTMLElement).dataset.id);
        const world = this.worlds.find((w) => w.id === id);
        if (!world) return;
        await this.updateWorldOrder(id, world.sortOrder + 1);
      });
    });

    // Toggle publish world
    content.querySelectorAll('.camp-toggle-pub-world').forEach((btn) => {
      btn.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        const id = Number((btn as HTMLElement).dataset.id);
        const isPub = (btn as HTMLElement).dataset.pub === 'true';
        try {
          await ApiClient.put(`/admin/campaign/worlds/${id}`, { isPublished: !isPub });
          this.notifications.success(isPub ? 'World unpublished' : 'World published');
          await this.loadWorlds();
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    });

    // Edit world
    content.querySelectorAll('.camp-edit-world').forEach((btn) => {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const id = Number((btn as HTMLElement).dataset.id);
        const world = this.worlds.find((w) => w.id === id);
        if (world) this.showWorldModal(world);
      });
    });

    // Delete world
    content.querySelectorAll('.camp-delete-world').forEach((btn) => {
      btn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const id = Number((btn as HTMLElement).dataset.id);
        const name = (btn as HTMLElement).dataset.name || '';
        this.showDeleteConfirmation('world', id, name);
      });
    });

    // Level handlers (within expanded rows)
    this.attachLevelHandlers(content);
  }

  private attachLevelHandlers(content: HTMLElement): void {
    // Create level
    content.querySelectorAll('.camp-create-level').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const worldId = Number((btn as HTMLElement).dataset.worldId);
        try {
          const res = await ApiClient.post<{ id: number }>('/admin/campaign/levels', { worldId });
          this.notifications.success('Level created');
          const world = this.worlds.find((w) => w.id === worldId);
          if (world) {
            await this.loadLevelsForWorld(world);
            const contentEl = this.container?.querySelector('#camp-content') as HTMLElement;
            if (contentEl) this.renderWorldsTable(contentEl);
          }
          // Launch editor for the new level
          this.launchLevelEditor(res.id);
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    });

    // Edit level (launch editor)
    content.querySelectorAll('.camp-edit-level').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.id);
        this.launchLevelEditor(id);
      });
    });

    // Export level
    content.querySelectorAll('.camp-export-level').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const name = (btn as HTMLElement).dataset.name || 'level';
        await this.downloadExport(`/admin/campaign/levels/${id}/export`, `level-${name}.json`);
      });
    });

    // Export bundle
    content.querySelectorAll('.camp-export-bundle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const name = (btn as HTMLElement).dataset.name || 'level';
        await this.downloadExport(
          `/admin/campaign/levels/${id}/export-bundle`,
          `level-bundle-${name}.json`,
        );
      });
    });

    // Import level
    content.querySelectorAll('.camp-import-level').forEach((btn) => {
      btn.addEventListener('click', () => {
        const worldId = Number((btn as HTMLElement).dataset.worldId);
        this.showImportLevelModal(worldId);
      });
    });

    // Toggle publish level
    content.querySelectorAll('.camp-toggle-pub-level').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const isPub = (btn as HTMLElement).dataset.pub === 'true';
        try {
          await ApiClient.put(`/admin/campaign/levels/${id}`, { isPublished: !isPub });
          this.notifications.success(isPub ? 'Level unpublished' : 'Level published');
          await this.reloadExpandedLevels();
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    });

    // Delete level
    content.querySelectorAll('.camp-delete-level').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const name = (btn as HTMLElement).dataset.name || '';
        this.showDeleteConfirmation('level', id, name);
      });
    });

    // Level order up/down
    content.querySelectorAll('.camp-level-order-up').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const level = this.findLevel(id);
        if (!level || level.sortOrder <= 1) return;
        await this.updateLevelOrder(id, level.sortOrder - 1);
      });
    });
    content.querySelectorAll('.camp-level-order-down').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const level = this.findLevel(id);
        if (!level) return;
        await this.updateLevelOrder(id, level.sortOrder + 1);
      });
    });
  }

  private findLevel(levelId: number): CampaignLevelSummary | undefined {
    for (const w of this.worlds) {
      const found = w.levels?.find((l) => l.id === levelId);
      if (found) return found;
    }
    return undefined;
  }

  private async loadLevelsForWorld(world: WorldWithLevels): Promise<void> {
    try {
      const res = await ApiClient.get<{ levels: CampaignLevelSummary[] }>(
        `/admin/campaign/levels?worldId=${world.id}`,
      );
      world.levels = res.levels;
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      world.levels = [];
    }

    // Re-render the levels section inline
    const levelsEl = this.container?.querySelector(`#camp-levels-${world.id}`);
    if (levelsEl) {
      levelsEl.innerHTML = this.renderLevelsSection(world);
      const content = this.container?.querySelector('#camp-content') as HTMLElement;
      if (content) this.attachLevelHandlers(content);
    }
  }

  private async reloadExpandedLevels(): Promise<void> {
    for (const world of this.worlds) {
      if (world.expanded) {
        await this.loadLevelsForWorld(world);
      }
    }
    const content = this.container?.querySelector('#camp-content') as HTMLElement;
    if (content) this.renderWorldsTable(content);
  }

  private async updateWorldOrder(id: number, newOrder: number): Promise<void> {
    try {
      await ApiClient.put(`/admin/campaign/worlds/${id}/order`, { sortOrder: newOrder });
      await this.loadWorlds();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private async updateLevelOrder(id: number, newOrder: number): Promise<void> {
    try {
      await ApiClient.put(`/admin/campaign/levels/${id}/order`, { sortOrder: newOrder });
      await this.reloadExpandedLevels();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private launchLevelEditor(levelId: number): void {
    game.registry.set('editorLevelId', levelId);
    game.registry.set('returnToAdmin', 'campaign');

    // Clear admin UI DOM, then start the editor scene
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay) {
      while (uiOverlay.firstChild) uiOverlay.removeChild(uiOverlay.firstChild);
    }
    const lobbyScene = game.scene.getScene('LobbyScene');
    if (lobbyScene) {
      lobbyScene.scene.start('LevelEditorScene');
    }
  }

  private showWorldModal(existing?: CampaignWorld): void {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', isEdit ? 'Edit World' : 'Create World');

    const themeOptions = THEME_OPTIONS.map(
      (t) =>
        `<option value="${t}" ${existing?.theme === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`,
    ).join('');

    overlay.innerHTML = `
      <div class="camp-modal-body md">
        <h3 class="camp-modal-title">${isEdit ? 'Edit World' : 'Create World'}</h3>
        <div class="camp-modal-form">
          <div class="form-group">
            <label class="camp-form-label">Name *</label>
            <input type="text" id="world-name" class="admin-input w-full" value="${escapeAttr(existing?.name || '')}" placeholder="World name" maxlength="100">
          </div>
          <div class="form-group">
            <label class="camp-form-label">Description</label>
            <textarea id="world-desc" class="admin-textarea" placeholder="Optional description..." maxlength="500" rows="2">${escapeHtml(existing?.description || '')}</textarea>
          </div>
          <div class="form-group">
            <label class="camp-form-label">Theme</label>
            <select id="world-theme" class="admin-input w-full">
              ${themeOptions}
            </select>
          </div>
          <div class="camp-modal-actions">
            <button class="btn btn-secondary" id="world-modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="world-modal-submit">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#world-modal-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#world-modal-submit')!.addEventListener('click', async () => {
      const name = (overlay.querySelector('#world-name') as HTMLInputElement).value.trim();
      const description = (
        overlay.querySelector('#world-desc') as HTMLTextAreaElement
      ).value.trim();
      const theme = (overlay.querySelector('#world-theme') as HTMLSelectElement).value;

      if (!name) {
        this.notifications.error('Name is required');
        return;
      }

      try {
        if (isEdit) {
          await ApiClient.put(`/admin/campaign/worlds/${existing!.id}`, {
            name,
            description,
            theme,
          });
          this.notifications.success('World updated');
        } else {
          await ApiClient.post('/admin/campaign/worlds', { name, description, theme });
          this.notifications.success('World created');
        }
        overlay.remove();
        await this.loadWorlds();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  // ============================
  // Enemy Types View
  // ============================

  private async loadEnemyTypes(): Promise<void> {
    if (!this.container) return;
    const content = this.container.querySelector('#camp-content');
    if (!content) return;

    try {
      const res = await ApiClient.get<{ enemyTypes: EnemyTypeEntry[] }>(
        '/admin/campaign/enemy-types',
      );
      this.enemyTypes = res.enemyTypes;
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      this.enemyTypes = [];
    }

    this.renderEnemyTypesTable(content as HTMLElement);
  }

  private renderEnemyTypesTable(content: HTMLElement): void {
    content.innerHTML = `
      <div class="camp-toolbar-multi">
        <button class="btn btn-primary" id="camp-create-enemy">Create Enemy Type</button>
        <button class="btn btn-secondary" id="camp-import-enemy">Import Enemy Type</button>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:60px;">Preview</th>
            <th>Name</th>
            <th>Body Shape</th>
            <th>HP</th>
            <th>Speed</th>
            <th>Movement</th>
            <th>Boss</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="camp-enemies-body">
          ${this.enemyTypes.length === 0 ? '<tr><td colspan="8" class="camp-empty-cell">No enemy types defined</td></tr>' : this.enemyTypes.map((et) => this.renderEnemyRow(et)).join('')}
        </tbody>
      </table>
    `;

    content.querySelector('#camp-create-enemy')!.addEventListener('click', () => {
      this.showEnemyModal();
    });

    content.querySelector('#camp-import-enemy')!.addEventListener('click', () => {
      this.importEnemyType();
    });

    // Generate canvas previews (try/catch so a bad sprite doesn't prevent handler attachment)
    this.enemyTypes.forEach((et) => {
      const canvas = content.querySelector(`#enemy-preview-${et.id}`) as HTMLCanvasElement;
      if (canvas) {
        try {
          EnemyTextureGenerator.generatePreview(canvas, et.config.sprite, 48);
        } catch {
          /* preview fails silently */
        }
      }
    });

    this.attachEnemyHandlers(content);
  }

  private renderEnemyRow(et: EnemyTypeEntry): string {
    const bossBadge = et.isBoss
      ? '<span class="text-warning font-semibold">Boss</span>'
      : '<span class="text-dim">No</span>';
    const patternLabel = et.config.movementPattern.replace(/_/g, ' ');

    return `
      <tr data-enemy-id="${et.id}">
        <td class="col-center">
          <canvas id="enemy-preview-${et.id}" width="48" height="48" class="camp-preview-canvas"></canvas>
        </td>
        <td>
          <strong>${escapeHtml(et.name)}</strong>
          ${et.description ? `<div class="camp-enemy-desc">${escapeHtml(et.description)}</div>` : ''}
        </td>
        <td><span class="text-capitalize">${escapeHtml(et.config.sprite.bodyShape)}</span></td>
        <td>${et.config.hp}</td>
        <td>${et.config.speed}</td>
        <td class="text-capitalize text-xs">${escapeHtml(patternLabel)}</td>
        <td>${bossBadge}</td>
        <td>
          <div class="camp-btn-group">
            <button class="btn-sm btn-secondary camp-edit-enemy" data-id="${et.id}">Edit</button>
            <button class="btn-sm btn-secondary camp-export-enemy" data-id="${et.id}" data-name="${escapeAttr(et.name)}" title="Export enemy type">Export</button>
            <button class="btn-sm btn-danger camp-delete-enemy" data-id="${et.id}" data-name="${escapeAttr(et.name)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  private attachEnemyHandlers(content: HTMLElement): void {
    content.querySelectorAll('.camp-edit-enemy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const et = this.enemyTypes.find((e) => e.id === id);
        if (et) this.showEnemyModal(et);
      });
    });

    content.querySelectorAll('.camp-export-enemy').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const name = (btn as HTMLElement).dataset.name || 'enemy';
        await this.downloadExport(`/admin/campaign/enemy-types/${id}/export`, `enemy-${name}.json`);
      });
    });

    content.querySelectorAll('.camp-delete-enemy').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number((btn as HTMLElement).dataset.id);
        const name = (btn as HTMLElement).dataset.name || '';
        this.showDeleteConfirmation('enemy', id, name);
      });
    });
  }

  private showEnemyModal(existing?: EnemyTypeEntry): void {
    const isEdit = !!existing;
    const config: EnemyTypeConfig = existing ? { ...existing.config } : defaultEnemyConfig();
    const sprite: EnemySpriteConfig = { ...config.sprite };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', isEdit ? 'Edit Enemy Type' : 'Create Enemy Type');

    const bodyShapeOptions = ENEMY_BODY_SHAPES.map(
      (s) =>
        `<option value="${s}" ${sprite.bodyShape === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
    ).join('');
    const eyeStyleOptions = ENEMY_EYE_STYLES.map(
      (s) =>
        `<option value="${s}" ${sprite.eyeStyle === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
    ).join('');
    const accessoryOptions = ENEMY_ACCESSORIES.map(
      (a) =>
        `<option value="${a}" ${(sprite.accessory ?? 'none') === a ? 'selected' : ''}>${a === 'none' ? 'None' : a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</option>`,
    ).join('');
    const movementOptions = MOVEMENT_PATTERNS.map(
      (p) =>
        `<option value="${p}" ${config.movementPattern === p ? 'selected' : ''}>${p.replace(/_/g, ' ')}</option>`,
    ).join('');

    overlay.innerHTML = `
      <div class="camp-modal-body lg">
        <h3 class="camp-modal-title">${isEdit ? 'Edit Enemy Type' : 'Create Enemy Type'}</h3>

        <div class="camp-enemy-columns">
          <!-- Left column: fields -->
          <div class="camp-enemy-left">
            <div class="form-group">
              <label class="camp-form-label">Name *</label>
              <input type="text" id="enemy-name" class="admin-input w-full" value="${escapeAttr(existing?.name || '')}" placeholder="Enemy name" maxlength="100">
            </div>
            <div class="form-group">
              <label class="camp-form-label">Description</label>
              <input type="text" id="enemy-desc" class="admin-input w-full" value="${escapeAttr(existing?.description || '')}" placeholder="Optional" maxlength="200">
            </div>

            <div class="camp-form-row">
              <div class="camp-form-col">
                <label class="camp-form-label">HP</label>
                <input type="number" id="enemy-hp" class="admin-input w-full" value="${config.hp}" min="1" max="100">
              </div>
              <div class="camp-form-col">
                <label class="camp-form-label">Speed</label>
                <input type="number" id="enemy-speed" class="admin-input w-full" value="${config.speed}" min="0.1" max="5" step="0.1">
              </div>
              <div class="camp-form-col">
                <label class="camp-form-label">Size</label>
                <input type="number" id="enemy-size" class="admin-input w-full" value="${config.sizeMultiplier}" min="1" max="3" step="0.1">
              </div>
            </div>

            <div class="form-group">
              <label class="camp-form-label">Movement Pattern</label>
              <select id="enemy-movement" class="admin-input w-full">
                ${movementOptions}
              </select>
            </div>

            <div class="form-group">
              <label class="camp-form-label">Custom AI</label>
              <select id="enemy-ai-select" class="admin-input w-full">
                <option value="">None (use movement pattern)</option>
              </select>
            </div>
            <div class="form-group" id="enemy-difficulty-group" style="display:none">
              <label class="camp-form-label">AI Difficulty</label>
              <select id="enemy-difficulty" class="admin-input w-full">
                <option value="easy">Easy</option>
                <option value="normal" selected>Normal</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            <div class="camp-checkbox-row">
              <label class="camp-checkbox-label">
                <input type="checkbox" id="enemy-boss" ${config.isBoss ? 'checked' : ''}> Boss
              </label>
              <label class="camp-checkbox-label">
                <input type="checkbox" id="enemy-contact-dmg" ${config.contactDamage ? 'checked' : ''}> Contact Damage
              </label>
              <label class="camp-checkbox-label">
                <input type="checkbox" id="enemy-can-bomb" ${config.canBomb ? 'checked' : ''}> Can Bomb
              </label>
              <label class="camp-checkbox-label">
                <input type="checkbox" id="enemy-pass-walls" ${config.canPassWalls ? 'checked' : ''}> Pass Walls
              </label>
              <label class="camp-checkbox-label">
                <input type="checkbox" id="enemy-pass-bombs" ${config.canPassBombs ? 'checked' : ''}> Pass Bombs
              </label>
            </div>

            <div class="camp-form-row">
              <div class="camp-form-col">
                <label class="camp-form-label">Drop Chance</label>
                <input type="number" id="enemy-drop-chance" class="admin-input w-full" value="${config.dropChance}" min="0" max="1" step="0.05">
              </div>
            </div>
          </div>

          <!-- Right column: sprite config + preview -->
          <div class="camp-enemy-right">
            <div class="camp-preview-center">
              <canvas id="enemy-modal-preview" width="80" height="80" class="camp-modal-preview"></canvas>
            </div>

            <div class="form-group">
              <label class="camp-form-label sm">Body Shape</label>
              <select id="enemy-body-shape" class="admin-input w-full text-xs">
                ${bodyShapeOptions}
              </select>
            </div>
            <div class="form-group">
              <label class="camp-form-label sm">Eye Style</label>
              <select id="enemy-eye-style" class="admin-input w-full text-xs">
                ${eyeStyleOptions}
              </select>
            </div>
            <div class="camp-color-row">
              <div class="camp-form-col">
                <label class="camp-form-label sm">Primary</label>
                <input type="color" id="enemy-primary-color" value="${sprite.primaryColor}" class="camp-color-input">
              </div>
              <div class="camp-form-col">
                <label class="camp-form-label sm">Secondary</label>
                <input type="color" id="enemy-secondary-color" value="${sprite.secondaryColor}" class="camp-color-input">
              </div>
            </div>
            <div class="camp-checkbox-row">
              <label class="camp-checkbox-label sm">
                <input type="checkbox" id="enemy-has-teeth" ${sprite.hasTeeth ? 'checked' : ''}> Teeth
              </label>
              <label class="camp-checkbox-label sm">
                <input type="checkbox" id="enemy-has-horns" ${sprite.hasHorns ? 'checked' : ''}> Horns
              </label>
              <label class="camp-checkbox-label sm">
                <input type="checkbox" id="enemy-has-crown" ${sprite.hasCrown ? 'checked' : ''}> Crown
              </label>
            </div>
            <div class="camp-checkbox-row">
              <label class="camp-checkbox-label sm">
                <input type="checkbox" id="enemy-has-tail" ${sprite.hasTail ? 'checked' : ''}> Tail
              </label>
              <label class="camp-checkbox-label sm">
                <input type="checkbox" id="enemy-has-aura" ${sprite.hasAura ? 'checked' : ''}> Aura
              </label>
              <label class="camp-checkbox-label sm">
                <input type="checkbox" id="enemy-has-scar" ${sprite.hasScar ? 'checked' : ''}> Scar
              </label>
              <label class="camp-checkbox-label sm">
                <input type="checkbox" id="enemy-has-wings" ${sprite.hasWings ? 'checked' : ''}> Wings
              </label>
            </div>
            <div class="form-group">
              <label class="camp-form-label sm">Accessory</label>
              <select id="enemy-accessory" class="admin-input w-full text-xs">
                ${accessoryOptions}
              </select>
            </div>
          </div>
        </div>

        <div class="camp-modal-actions mt-md">
          <button class="btn btn-secondary" id="enemy-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="enemy-modal-submit">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Populate enemy AI dropdown
    const aiSelect = overlay.querySelector('#enemy-ai-select') as HTMLSelectElement;
    const diffGroup = overlay.querySelector('#enemy-difficulty-group') as HTMLElement;
    const diffSelect = overlay.querySelector('#enemy-difficulty') as HTMLSelectElement;
    const movementSelect = overlay.querySelector('#enemy-movement') as HTMLSelectElement;

    ApiClient.get<{ ais: EnemyAIEntry[] }>('/admin/enemy-ai/active')
      .then((res) => {
        for (const ai of res.ais) {
          const opt = document.createElement('option');
          opt.value = ai.id;
          opt.textContent = ai.name;
          if (config.enemyAiId === ai.id) opt.selected = true;
          aiSelect.appendChild(opt);
        }
        // Show difficulty if AI is pre-selected
        if (config.enemyAiId) {
          diffGroup.style.display = '';
          diffSelect.value = config.difficulty || 'normal';
          movementSelect.disabled = true;
          movementSelect.style.opacity = '0.5';
          movementSelect.style.cursor = 'not-allowed';
          movementSelect.title = 'Overridden by custom AI';
        }
      })
      .catch(() => {
        /* ignore - dropdown stays with just "None" */
      });

    aiSelect.addEventListener('change', () => {
      if (aiSelect.value) {
        diffGroup.style.display = '';
        movementSelect.disabled = true;
        movementSelect.style.opacity = '0.5';
        movementSelect.style.cursor = 'not-allowed';
        movementSelect.title = 'Overridden by custom AI';
      } else {
        diffGroup.style.display = 'none';
        movementSelect.disabled = false;
        movementSelect.style.opacity = '1';
        movementSelect.style.cursor = '';
        movementSelect.title = '';
      }
    });

    // Initial preview
    const previewCanvas = overlay.querySelector('#enemy-modal-preview') as HTMLCanvasElement;
    this.updateEnemyPreview(overlay, previewCanvas);

    // Live preview updates
    const previewInputs = [
      '#enemy-body-shape',
      '#enemy-eye-style',
      '#enemy-primary-color',
      '#enemy-secondary-color',
      '#enemy-has-teeth',
      '#enemy-has-horns',
      '#enemy-has-tail',
      '#enemy-has-aura',
      '#enemy-has-crown',
      '#enemy-has-scar',
      '#enemy-has-wings',
      '#enemy-accessory',
    ];
    previewInputs.forEach((sel) => {
      overlay.querySelector(sel)?.addEventListener('input', () => {
        this.updateEnemyPreview(overlay, previewCanvas);
      });
      overlay.querySelector(sel)?.addEventListener('change', () => {
        this.updateEnemyPreview(overlay, previewCanvas);
      });
    });

    // Crown/horns mutual exclusion
    const hornsCheck = overlay.querySelector('#enemy-has-horns') as HTMLInputElement;
    const crownCheck = overlay.querySelector('#enemy-has-crown') as HTMLInputElement;
    hornsCheck.addEventListener('change', () => {
      if (hornsCheck.checked) crownCheck.checked = false;
      this.updateEnemyPreview(overlay, previewCanvas);
    });
    crownCheck.addEventListener('change', () => {
      if (crownCheck.checked) hornsCheck.checked = false;
      this.updateEnemyPreview(overlay, previewCanvas);
    });

    overlay.querySelector('#enemy-modal-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#enemy-modal-submit')!.addEventListener('click', async () => {
      const name = (overlay.querySelector('#enemy-name') as HTMLInputElement).value.trim();
      const description = (overlay.querySelector('#enemy-desc') as HTMLInputElement).value.trim();

      if (!name) {
        this.notifications.error('Name is required');
        return;
      }

      const newConfig: EnemyTypeConfig = {
        hp: Number((overlay.querySelector('#enemy-hp') as HTMLInputElement).value) || 1,
        speed: Number((overlay.querySelector('#enemy-speed') as HTMLInputElement).value) || 1,
        sizeMultiplier:
          Number((overlay.querySelector('#enemy-size') as HTMLInputElement).value) || 1,
        movementPattern: (overlay.querySelector('#enemy-movement') as HTMLSelectElement)
          .value as EnemyMovementPattern,
        isBoss: (overlay.querySelector('#enemy-boss') as HTMLInputElement).checked,
        contactDamage: (overlay.querySelector('#enemy-contact-dmg') as HTMLInputElement).checked,
        canBomb: (overlay.querySelector('#enemy-can-bomb') as HTMLInputElement).checked,
        canPassWalls: (overlay.querySelector('#enemy-pass-walls') as HTMLInputElement).checked,
        canPassBombs: (overlay.querySelector('#enemy-pass-bombs') as HTMLInputElement).checked,
        dropChance:
          Number((overlay.querySelector('#enemy-drop-chance') as HTMLInputElement).value) || 0,
        dropTable: config.dropTable,
        bombConfig: config.canBomb ? config.bombConfig : undefined,
        bossPhases: config.isBoss ? config.bossPhases : undefined,
        enemyAiId: aiSelect.value || undefined,
        difficulty: aiSelect.value ? (diffSelect.value as 'easy' | 'normal' | 'hard') : undefined,
        sprite: {
          bodyShape: (overlay.querySelector('#enemy-body-shape') as HTMLSelectElement)
            .value as EnemyBodyShape,
          eyeStyle: (overlay.querySelector('#enemy-eye-style') as HTMLSelectElement)
            .value as EnemyEyeStyle,
          primaryColor: (overlay.querySelector('#enemy-primary-color') as HTMLInputElement).value,
          secondaryColor: (overlay.querySelector('#enemy-secondary-color') as HTMLInputElement)
            .value,
          hasTeeth: (overlay.querySelector('#enemy-has-teeth') as HTMLInputElement).checked,
          hasHorns: (overlay.querySelector('#enemy-has-horns') as HTMLInputElement).checked,
          hasTail: (overlay.querySelector('#enemy-has-tail') as HTMLInputElement).checked,
          hasAura: (overlay.querySelector('#enemy-has-aura') as HTMLInputElement).checked,
          hasCrown: (overlay.querySelector('#enemy-has-crown') as HTMLInputElement).checked,
          hasScar: (overlay.querySelector('#enemy-has-scar') as HTMLInputElement).checked,
          hasWings: (overlay.querySelector('#enemy-has-wings') as HTMLInputElement).checked,
          accessory: (overlay.querySelector('#enemy-accessory') as HTMLSelectElement)
            .value as EnemyAccessory,
        },
      };

      try {
        if (isEdit) {
          await ApiClient.put(`/admin/campaign/enemy-types/${existing!.id}`, {
            name,
            description,
            config: newConfig,
          });
          this.notifications.success('Enemy type updated');
        } else {
          await ApiClient.post('/admin/campaign/enemy-types', {
            name,
            description,
            config: newConfig,
          });
          this.notifications.success('Enemy type created');
        }
        overlay.remove();
        await this.loadEnemyTypes();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  private updateEnemyPreview(overlay: HTMLElement, canvas: HTMLCanvasElement): void {
    const spriteConfig: EnemySpriteConfig = {
      bodyShape: (overlay.querySelector('#enemy-body-shape') as HTMLSelectElement)
        .value as EnemyBodyShape,
      eyeStyle: (overlay.querySelector('#enemy-eye-style') as HTMLSelectElement)
        .value as EnemyEyeStyle,
      primaryColor: (overlay.querySelector('#enemy-primary-color') as HTMLInputElement).value,
      secondaryColor: (overlay.querySelector('#enemy-secondary-color') as HTMLInputElement).value,
      hasTeeth: (overlay.querySelector('#enemy-has-teeth') as HTMLInputElement).checked,
      hasHorns: (overlay.querySelector('#enemy-has-horns') as HTMLInputElement).checked,
      hasTail: (overlay.querySelector('#enemy-has-tail') as HTMLInputElement).checked,
      hasAura: (overlay.querySelector('#enemy-has-aura') as HTMLInputElement).checked,
      hasCrown: (overlay.querySelector('#enemy-has-crown') as HTMLInputElement).checked,
      hasScar: (overlay.querySelector('#enemy-has-scar') as HTMLInputElement).checked,
      hasWings: (overlay.querySelector('#enemy-has-wings') as HTMLInputElement).checked,
      accessory: (overlay.querySelector('#enemy-accessory') as HTMLSelectElement)
        .value as EnemyAccessory,
    };
    EnemyTextureGenerator.generatePreview(canvas, spriteConfig, 80);
  }

  // ============================
  // Export/Import Utilities
  // ============================

  private async downloadExport(url: string, fallbackFilename: string): Promise<void> {
    try {
      const data = await ApiClient.get<Record<string, unknown>>(url);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fallbackFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      this.notifications.success('Export downloaded');
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private importEnemyType(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // Strip format metadata if present
        const { _format, _version, ...rest } = data;
        await ApiClient.post('/admin/campaign/enemy-types/import', rest);
        this.notifications.success('Enemy type imported');
        await this.loadEnemyTypes();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
    input.click();
  }

  private showImportLevelModal(worldId: number): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Import Level');

    overlay.innerHTML = `
      <div class="camp-modal-body md">
        <h3 class="camp-modal-title">Import Level</h3>
        <p class="camp-import-hint">
          Select a level JSON file or a level bundle (level + enemy types).
        </p>
        <div class="camp-import-file-wrap">
          <input type="file" id="import-level-file" accept=".json" class="camp-import-file">
        </div>
        <div id="import-level-status" class="camp-import-status"></div>
        <div class="camp-modal-actions">
          <button class="btn btn-secondary" id="import-level-cancel">Cancel</button>
          <button class="btn btn-primary" id="import-level-submit" disabled>Import</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse result with dynamic format detection
    let parsedData: any = null;

    const fileInput = overlay.querySelector('#import-level-file') as HTMLInputElement;
    const statusEl = overlay.querySelector('#import-level-status') as HTMLElement;
    const submitBtn = overlay.querySelector('#import-level-submit') as HTMLButtonElement;

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        parsedData = JSON.parse(text);

        const format = parsedData._format || parsedData.level?._format || 'unknown';
        if (format === 'blast-arena-level-bundle') {
          const enemyCount = parsedData.enemyTypes?.length || 0;
          statusEl.innerHTML = `<span class="text-success">Bundle detected:</span> level "${escapeHtml(parsedData.level?.name || '?')}" with ${enemyCount} enemy type(s)`;
        } else if (format === 'blast-arena-level') {
          statusEl.innerHTML = `<span class="text-success">Level detected:</span> "${escapeHtml(parsedData.name || '?')}"`;
        } else {
          statusEl.innerHTML = `<span class="text-warning">Unknown format — will attempt import</span>`;
        }
        submitBtn.disabled = false;
      } catch {
        statusEl.innerHTML = `<span class="text-danger">Invalid JSON file</span>`;
        parsedData = null;
        submitBtn.disabled = true;
      }
    });

    overlay
      .querySelector('#import-level-cancel')!
      .addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    submitBtn.addEventListener('click', async () => {
      if (!parsedData) return;
      submitBtn.disabled = true;
      statusEl.textContent = 'Importing...';

      try {
        // Build request body
        let levelPayload: Record<string, unknown>;
        let enemyTypes: Record<string, unknown>[] | undefined;

        if (parsedData._format === 'blast-arena-level-bundle') {
          levelPayload = parsedData.level as Record<string, unknown>;
          enemyTypes = parsedData.enemyTypes as Record<string, unknown>[] | undefined;
        } else if (parsedData._format === 'blast-arena-level') {
          const { _format: _, _version: __, ...rest } = parsedData;
          levelPayload = rest;
        } else {
          levelPayload = parsedData;
        }

        const body = { level: levelPayload, worldId, enemyTypes };
        const res = await ApiClient.post<{ conflicts?: ImportConflict[] }>(
          '/admin/campaign/levels/import',
          body,
        );

        if (res.conflicts && res.conflicts.length > 0) {
          overlay.remove();
          this.showConflictResolutionModal(res.conflicts, levelPayload, enemyTypes, worldId);
        } else {
          this.notifications.success('Level imported successfully');
          overlay.remove();
          await this.loadWorlds();
        }
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
        submitBtn.disabled = false;
        statusEl.textContent = 'Import failed — check file format';
      }
    });
  }

  private showConflictResolutionModal(
    conflicts: ImportConflict[],
    levelData: Record<string, unknown>,
    enemyTypes: Record<string, unknown>[] | undefined,
    worldId: number,
  ): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Resolve Enemy Type Conflicts');

    const conflictRows = conflicts
      .map((c, i) => {
        const existingOption = c.existingId
          ? `<label class="camp-conflict-option">
             <input type="radio" name="conflict-${i}" value="use-existing" data-existing-id="${c.existingId}">
             Use existing: "${escapeHtml(c.existingName || '')}" (ID ${c.existingId})
           </label>`
          : '';

        const createOption = enemyTypes?.find((et) => et.originalId === c.originalId)
          ? `<label class="camp-conflict-option">
             <input type="radio" name="conflict-${i}" value="create" checked>
             Create new "${escapeHtml(c.name)}"
           </label>`
          : '';

        return `
        <div class="camp-conflict-card">
          <div class="camp-conflict-name">${escapeHtml(c.name)} <span class="camp-conflict-orig-id">(original ID ${c.originalId})</span></div>
          <div class="camp-conflict-options">
            ${createOption}
            ${existingOption}
            <label class="camp-conflict-option">
              <input type="radio" name="conflict-${i}" value="skip" ${!createOption && !existingOption ? 'checked' : ''}>
              Skip (remove placements of this enemy)
            </label>
          </div>
        </div>
      `;
      })
      .join('');

    overlay.innerHTML = `
      <div class="camp-modal-body conflict">
        <h3 class="camp-modal-title warning">Resolve Enemy Type Conflicts</h3>
        <p class="camp-import-hint mb-md">
          The imported level references enemy types that need to be resolved.
        </p>
        ${conflictRows}
        <div class="camp-modal-actions mt-sm">
          <button class="btn btn-secondary" id="conflict-cancel">Cancel</button>
          <button class="btn btn-primary" id="conflict-submit">Import</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#conflict-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#conflict-submit')!.addEventListener('click', async () => {
      const enemyIdMap: Record<string, number | 'create' | 'skip'> = {};

      for (let i = 0; i < conflicts.length; i++) {
        const selected = overlay.querySelector(
          `input[name="conflict-${i}"]:checked`,
        ) as HTMLInputElement;
        if (!selected) continue;
        const origId = String(conflicts[i].originalId);

        if (selected.value === 'create') {
          enemyIdMap[origId] = 'create';
        } else if (selected.value === 'use-existing') {
          enemyIdMap[origId] = Number(selected.dataset.existingId);
        } else {
          enemyIdMap[origId] = 'skip';
        }
      }

      try {
        await ApiClient.post('/admin/campaign/levels/import', {
          level: levelData,
          enemyTypes,
          worldId,
          enemyIdMap,
        });
        this.notifications.success('Level imported successfully');
        overlay.remove();
        await this.loadWorlds();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  // ============================
  // Shared: Delete Confirmation
  // ============================

  private showDeleteConfirmation(
    entityType: 'world' | 'level' | 'enemy',
    id: number,
    name: string,
  ): void {
    const labels: Record<string, string> = {
      world: 'World',
      level: 'Level',
      enemy: 'Enemy Type',
    };
    const warnings: Record<string, string> = {
      world: 'This will permanently delete this world and <strong>all its levels</strong>.',
      level: 'This will permanently delete this level.',
      enemy: 'This will permanently delete this enemy type. Levels referencing it may break.',
    };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Delete ${labels[entityType]}`);

    overlay.innerHTML = `
      <div class="camp-modal-body sm">
        <h3 class="camp-modal-title danger">Delete ${labels[entityType]}</h3>
        <p class="camp-delete-confirm-text">${warnings[entityType]} <strong>${escapeHtml(name)}</strong></p>
        <p class="camp-delete-confirm-hint">Type the name to confirm:</p>
        <input type="text" id="camp-delete-confirm" class="admin-input w-full mb-md" placeholder="${escapeAttr(name)}" aria-label="Type name to confirm deletion">
        <div class="camp-modal-actions">
          <button class="btn btn-secondary" id="camp-delete-cancel">Cancel</button>
          <button class="btn btn-danger" id="camp-delete-submit" disabled>Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const confirmInput = overlay.querySelector('#camp-delete-confirm') as HTMLInputElement;
    const deleteBtn = overlay.querySelector('#camp-delete-submit') as HTMLButtonElement;

    confirmInput.addEventListener('input', () => {
      deleteBtn.disabled = confirmInput.value !== name;
    });

    overlay.querySelector('#camp-delete-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    deleteBtn.addEventListener('click', async () => {
      try {
        const endpoints: Record<string, string> = {
          world: `/admin/campaign/worlds/${id}`,
          level: `/admin/campaign/levels/${id}`,
          enemy: `/admin/campaign/enemy-types/${id}`,
        };
        await ApiClient.delete(endpoints[entityType]);
        this.notifications.success(`${labels[entityType]} deleted`);
        overlay.remove();

        if (entityType === 'world' || entityType === 'level') {
          await this.loadWorlds();
        } else {
          await this.loadEnemyTypes();
        }
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  // ============================
  // Campaign Replays View
  // ============================

  private campaignReplaysPage = 1;

  private async loadCampaignReplays(): Promise<void> {
    if (!this.container) return;
    const content = this.container.querySelector('#camp-content');
    if (!content) return;

    try {
      const data = await ApiClient.get<{
        replays: CampaignReplayListItem[];
        total: number;
      }>(`/admin/campaign-replays?page=${this.campaignReplaysPage}&limit=20`);

      const totalPages = Math.ceil(data.total / 20) || 1;

      content.innerHTML = `
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
          <div class="text-dim">${data.total} campaign replay${data.total !== 1 ? 's' : ''}</div>
          <div class="flex-row" style="gap:6px;">
            <button class="btn btn-sm btn-ghost" id="camp-replays-prev" ${this.campaignReplaysPage <= 1 ? 'disabled' : ''}>Prev</button>
            <span class="text-sm text-dim">Page ${this.campaignReplaysPage}/${totalPages}</span>
            <button class="btn btn-sm btn-ghost" id="camp-replays-next" ${this.campaignReplaysPage >= totalPages ? 'disabled' : ''}>Next</button>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Level</th>
              <th>World</th>
              <th>Player</th>
              <th>Result</th>
              <th>Stars</th>
              <th>Duration</th>
              <th>Mode</th>
              <th>Date</th>
              <th>Size</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${data.replays.length === 0 ? '<tr><td colspan="10" style="text-align:center;color:var(--text-dim);padding:16px;">No campaign replays yet</td></tr>' : data.replays.map((r) => this.renderCampaignReplayRow(r)).join('')}
          </tbody>
        </table>
      `;

      content.querySelector('#camp-replays-prev')?.addEventListener('click', () => {
        if (this.campaignReplaysPage > 1) {
          this.campaignReplaysPage--;
          this.loadCampaignReplays();
        }
      });
      content.querySelector('#camp-replays-next')?.addEventListener('click', () => {
        if (this.campaignReplaysPage < totalPages) {
          this.campaignReplaysPage++;
          this.loadCampaignReplays();
        }
      });

      this.attachCampaignReplayHandlers(content as HTMLElement);
    } catch (err: unknown) {
      content.innerHTML = `<div class="text-danger">Failed to load campaign replays: ${getErrorMessage(err)}</div>`;
    }
  }

  private renderCampaignReplayRow(r: CampaignReplayListItem): string {
    const resultClass = r.result === 'completed' ? 'text-success' : 'text-danger';
    const resultLabel = r.result === 'completed' ? 'Completed' : 'Failed';
    const mode = r.buddyMode ? 'Buddy' : r.coopMode ? 'Co-op' : 'Solo';
    const duration =
      r.duration > 0
        ? `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}`
        : '-';
    const date = new Date(r.createdAt).toLocaleDateString();
    const stars =
      r.result === 'completed' ? '\u2605'.repeat(r.stars) + '\u2606'.repeat(3 - r.stars) : '-';

    return `
      <tr>
        <td>${escapeHtml(r.levelName)}</td>
        <td class="text-dim">${escapeHtml(r.worldName)}</td>
        <td>${escapeHtml(r.username)}</td>
        <td><span class="${resultClass}">${resultLabel}</span></td>
        <td class="text-warning">${stars}</td>
        <td>${duration}</td>
        <td class="text-dim">${mode}</td>
        <td class="text-dim">${date}</td>
        <td class="text-dim">${r.fileSizeKB} KB</td>
        <td>
          <div class="camp-btn-group">
            <button class="btn-sm btn-secondary camp-replay-watch" data-session="${escapeAttr(r.sessionId)}">Watch</button>
            <button class="btn-sm btn-danger camp-replay-delete" data-session="${escapeAttr(r.sessionId)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  private attachCampaignReplayHandlers(content: HTMLElement): void {
    content.addEventListener('click', async (e) => {
      const target = e.target as HTMLElement;

      if (target.classList.contains('camp-replay-watch')) {
        const sessionId = target.dataset.session;
        if (sessionId) await this.launchCampaignReplay(sessionId);
      }

      if (target.classList.contains('camp-replay-delete')) {
        const sessionId = target.dataset.session;
        if (sessionId) {
          try {
            await ApiClient.delete(`/admin/campaign-replays/${sessionId}`);
            this.notifications.success('Campaign replay deleted');
            this.loadCampaignReplays();
          } catch (err: unknown) {
            this.notifications.error(getErrorMessage(err));
          }
        }
      }
    });
  }

  private async launchCampaignReplay(sessionId: string): Promise<void> {
    try {
      this.notifications.info('Loading campaign replay...');
      const replayData = await ApiClient.get<ReplayData>(`/admin/campaign-replays/${sessionId}`);

      if (!replayData || !replayData.frames || replayData.frames.length === 0) {
        this.notifications.error('Replay data is empty or corrupted');
        return;
      }

      // Reconstruct initial GameState from first frame + stored map
      const firstFrame = replayData.frames[0];
      const initialState: GameState = {
        tick: firstFrame.tick,
        players: firstFrame.players,
        bombs: firstFrame.bombs,
        explosions: firstFrame.explosions,
        powerUps: firstFrame.powerUps,
        map: replayData.map,
        status: firstFrame.status,
        winnerId: firstFrame.winnerId,
        winnerTeam: firstFrame.winnerTeam,
        roundTime: firstFrame.roundTime,
        timeElapsed: firstFrame.timeElapsed,
      };
      if (firstFrame.zone) initialState.zone = firstFrame.zone;
      if (firstFrame.hillZone) initialState.hillZone = firstFrame.hillZone;
      if (firstFrame.kothScores) initialState.kothScores = firstFrame.kothScores;

      // Clear all DOM overlays
      const uiOverlay = document.getElementById('ui-overlay');
      if (uiOverlay) {
        while (uiOverlay.firstChild) {
          uiOverlay.removeChild(uiOverlay.firstChild);
        }
      }

      // Set registry values for GameScene
      const registry = game.registry;
      registry.set('initialGameState', initialState);
      registry.set('replayMode', true);
      registry.set('replayData', replayData);
      if (replayData.campaign) {
        registry.set('campaignMode', true);
      }

      // Start GameScene and HUDScene
      const activeScene = game.scene.getScene('LobbyScene') || game.scene.getScene('MenuScene');
      if (activeScene) {
        activeScene.scene.start('GameScene');
        activeScene.scene.launch('HUDScene');
      }
    } catch {
      this.notifications.error('Failed to load campaign replay');
    }
  }
}
