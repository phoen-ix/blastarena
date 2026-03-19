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
  EnemyMovementPattern,
  CampaignWinCondition,
  PowerUpType,
  ENEMY_BODY_SHAPES,
  ENEMY_EYE_STYLES,
  MOVEMENT_PATTERNS,
  getErrorMessage,
} from '@blast-arena/shared';
import { escapeHtml, escapeAttr } from '../../utils/html';
import { EnemyTextureGenerator } from '../../game/EnemyTextureGenerator';
import game from '../../main';

type ViewMode = 'worlds' | 'enemies';

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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="color:var(--text);margin:0;">Campaign Manager</h3>
        <div style="display:flex;gap:8px;">
          <button class="btn ${this.viewMode === 'worlds' ? 'btn-primary' : 'btn-ghost'}" id="camp-view-worlds">Worlds &amp; Levels</button>
          <button class="btn ${this.viewMode === 'enemies' ? 'btn-primary' : 'btn-ghost'}" id="camp-view-enemies">Enemy Types</button>
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

    if (this.viewMode === 'worlds') {
      await this.loadWorlds();
    } else {
      await this.loadEnemyTypes();
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
      <div style="margin-bottom:12px;">
        <button class="btn btn-primary" id="camp-create-world">Create World</button>
      </div>
      <table class="admin-table">
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
          ${this.worlds.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px;">No worlds created yet</td></tr>' : this.worlds.map((w) => this.renderWorldRow(w)).join('')}
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
      ? '<span style="color:var(--success);font-weight:600;">Published</span>'
      : '<span style="color:var(--text-dim);">Draft</span>';
    const expandIcon = world.expanded ? '&#9660;' : '&#9654;';

    let rows = `
      <tr data-world-id="${world.id}" class="camp-world-row" style="cursor:pointer;">
        <td style="text-align:center;font-size:11px;" class="camp-expand">${expandIcon}</td>
        <td><strong>${escapeHtml(world.name)}</strong></td>
        <td><span style="background:var(--bg-hover);padding:2px 8px;border-radius:4px;font-size:12px;">${escapeHtml(world.theme)}</span></td>
        <td>${world.levelCount ?? 0}</td>
        <td>${publishBadge}</td>
        <td>
          <div style="display:flex;gap:4px;align-items:center;">
            <button class="btn-sm btn-ghost camp-order-up" data-id="${world.id}" title="Move up">&#9650;</button>
            <span style="min-width:24px;text-align:center;">${world.sortOrder}</span>
            <button class="btn-sm btn-ghost camp-order-down" data-id="${world.id}" title="Move down">&#9660;</button>
          </div>
        </td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
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
          <td colspan="7" style="padding:0 0 0 32px;background:var(--bg-deep);">
            <div id="camp-levels-${world.id}" style="padding:12px 0;">
              ${world.levels ? this.renderLevelsSection(world) : '<span style="color:var(--text-dim);">Loading levels...</span>'}
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
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <span style="color:var(--text-dim);font-size:13px;font-weight:600;">Levels in ${escapeHtml(world.name)}</span>
        <button class="btn-sm btn-primary camp-create-level" data-world-id="${world.id}">Add Level</button>
      </div>
      ${
        levels.length === 0
          ? '<div style="color:var(--text-dim);padding:12px;text-align:center;">No levels yet</div>'
          : `<table class="admin-table" style="margin:0;">
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
      ? '<span style="color:var(--success);">Yes</span>'
      : '<span style="color:var(--text-dim);">No</span>';
    const timeStr = level.timeLimit > 0 ? `${Math.floor(level.timeLimit / 60)}:${String(level.timeLimit % 60).padStart(2, '0')}` : 'None';
    const winLabel = WIN_CONDITION_LABELS[level.winCondition] || level.winCondition;

    return `
      <tr data-level-id="${level.id}">
        <td>
          <div style="display:flex;gap:2px;align-items:center;">
            <button class="btn-sm btn-ghost camp-level-order-up" data-id="${level.id}" title="Move up" style="padding:0 2px;font-size:10px;">&#9650;</button>
            <span style="min-width:18px;text-align:center;">${level.sortOrder}</span>
            <button class="btn-sm btn-ghost camp-level-order-down" data-id="${level.id}" title="Move down" style="padding:0 2px;font-size:10px;">&#9660;</button>
          </div>
        </td>
        <td>${escapeHtml(level.name)}</td>
        <td>${level.mapWidth}x${level.mapHeight}</td>
        <td><span style="font-size:12px;">${escapeHtml(winLabel)}</span></td>
        <td>${level.lives}</td>
        <td>${timeStr}</td>
        <td>${level.enemyCount}</td>
        <td>${publishBadge}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-sm btn-primary camp-edit-level" data-id="${level.id}">Edit</button>
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
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    const themeOptions = THEME_OPTIONS.map(
      (t) =>
        `<option value="${t}" ${existing?.theme === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`,
    ).join('');

    overlay.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:480px;max-width:90vw;">
        <h3 style="margin:0 0 16px;color:var(--primary);">${isEdit ? 'Edit World' : 'Create World'}</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Name *</label>
            <input type="text" id="world-name" class="admin-input" value="${escapeAttr(existing?.name || '')}" placeholder="World name" maxlength="100" style="width:100%;box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Description</label>
            <textarea id="world-desc" class="admin-input" placeholder="Optional description..." maxlength="500" rows="2" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;">${escapeHtml(existing?.description || '')}</textarea>
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Theme</label>
            <select id="world-theme" class="admin-input" style="width:100%;box-sizing:border-box;">
              ${themeOptions}
            </select>
          </div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">
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
      const description = (overlay.querySelector('#world-desc') as HTMLTextAreaElement).value.trim();
      const theme = (overlay.querySelector('#world-theme') as HTMLSelectElement).value;

      if (!name) {
        this.notifications.error('Name is required');
        return;
      }

      try {
        if (isEdit) {
          await ApiClient.put(`/admin/campaign/worlds/${existing!.id}`, { name, description, theme });
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
      const res = await ApiClient.get<{ enemyTypes: EnemyTypeEntry[] }>('/admin/campaign/enemy-types');
      this.enemyTypes = res.enemyTypes;
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      this.enemyTypes = [];
    }

    this.renderEnemyTypesTable(content as HTMLElement);
  }

  private renderEnemyTypesTable(content: HTMLElement): void {
    content.innerHTML = `
      <div style="margin-bottom:12px;">
        <button class="btn btn-primary" id="camp-create-enemy">Create Enemy Type</button>
      </div>
      <table class="admin-table">
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
          ${this.enemyTypes.length === 0 ? '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px;">No enemy types defined</td></tr>' : this.enemyTypes.map((et) => this.renderEnemyRow(et)).join('')}
        </tbody>
      </table>
    `;

    content.querySelector('#camp-create-enemy')!.addEventListener('click', () => {
      this.showEnemyModal();
    });

    // Generate canvas previews
    this.enemyTypes.forEach((et) => {
      const canvas = content.querySelector(`#enemy-preview-${et.id}`) as HTMLCanvasElement;
      if (canvas) {
        EnemyTextureGenerator.generatePreview(canvas, et.config.sprite, 48);
      }
    });

    this.attachEnemyHandlers(content);
  }

  private renderEnemyRow(et: EnemyTypeEntry): string {
    const bossBadge = et.isBoss
      ? '<span style="color:var(--warning);font-weight:600;">Boss</span>'
      : '<span style="color:var(--text-dim);">No</span>';
    const patternLabel = et.config.movementPattern.replace(/_/g, ' ');

    return `
      <tr data-enemy-id="${et.id}">
        <td style="text-align:center;">
          <canvas id="enemy-preview-${et.id}" width="48" height="48" style="border-radius:4px;background:var(--bg-deep);"></canvas>
        </td>
        <td>
          <strong>${escapeHtml(et.name)}</strong>
          ${et.description ? `<div style="color:var(--text-dim);font-size:12px;margin-top:2px;">${escapeHtml(et.description)}</div>` : ''}
        </td>
        <td><span style="text-transform:capitalize;">${escapeHtml(et.config.sprite.bodyShape)}</span></td>
        <td>${et.config.hp}</td>
        <td>${et.config.speed}</td>
        <td style="text-transform:capitalize;font-size:12px;">${escapeHtml(patternLabel)}</td>
        <td>${bossBadge}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-sm btn-secondary camp-edit-enemy" data-id="${et.id}">Edit</button>
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
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;overflow-y:auto;';

    const bodyShapeOptions = ENEMY_BODY_SHAPES.map(
      (s) => `<option value="${s}" ${sprite.bodyShape === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
    ).join('');
    const eyeStyleOptions = ENEMY_EYE_STYLES.map(
      (s) => `<option value="${s}" ${sprite.eyeStyle === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
    ).join('');
    const movementOptions = MOVEMENT_PATTERNS.map(
      (p) =>
        `<option value="${p}" ${config.movementPattern === p ? 'selected' : ''}>${p.replace(/_/g, ' ')}</option>`,
    ).join('');

    overlay.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:600px;max-width:95vw;max-height:90vh;overflow-y:auto;margin:20px 0;">
        <h3 style="margin:0 0 16px;color:var(--primary);">${isEdit ? 'Edit Enemy Type' : 'Create Enemy Type'}</h3>

        <div style="display:flex;gap:24px;">
          <!-- Left column: fields -->
          <div style="flex:1;display:flex;flex-direction:column;gap:10px;">
            <div>
              <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Name *</label>
              <input type="text" id="enemy-name" class="admin-input" value="${escapeAttr(existing?.name || '')}" placeholder="Enemy name" maxlength="100" style="width:100%;box-sizing:border-box;">
            </div>
            <div>
              <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Description</label>
              <input type="text" id="enemy-desc" class="admin-input" value="${escapeAttr(existing?.description || '')}" placeholder="Optional" maxlength="200" style="width:100%;box-sizing:border-box;">
            </div>

            <div style="display:flex;gap:8px;">
              <div style="flex:1;">
                <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">HP</label>
                <input type="number" id="enemy-hp" class="admin-input" value="${config.hp}" min="1" max="100" style="width:100%;box-sizing:border-box;">
              </div>
              <div style="flex:1;">
                <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Speed</label>
                <input type="number" id="enemy-speed" class="admin-input" value="${config.speed}" min="0.1" max="5" step="0.1" style="width:100%;box-sizing:border-box;">
              </div>
              <div style="flex:1;">
                <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Size</label>
                <input type="number" id="enemy-size" class="admin-input" value="${config.sizeMultiplier}" min="0.5" max="3" step="0.1" style="width:100%;box-sizing:border-box;">
              </div>
            </div>

            <div>
              <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Movement Pattern</label>
              <select id="enemy-movement" class="admin-input" style="width:100%;box-sizing:border-box;">
                ${movementOptions}
              </select>
            </div>

            <div style="display:flex;gap:12px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:13px;cursor:pointer;">
                <input type="checkbox" id="enemy-boss" ${config.isBoss ? 'checked' : ''}> Boss
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:13px;cursor:pointer;">
                <input type="checkbox" id="enemy-contact-dmg" ${config.contactDamage ? 'checked' : ''}> Contact Damage
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:13px;cursor:pointer;">
                <input type="checkbox" id="enemy-can-bomb" ${config.canBomb ? 'checked' : ''}> Can Bomb
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:13px;cursor:pointer;">
                <input type="checkbox" id="enemy-pass-walls" ${config.canPassWalls ? 'checked' : ''}> Pass Walls
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:13px;cursor:pointer;">
                <input type="checkbox" id="enemy-pass-bombs" ${config.canPassBombs ? 'checked' : ''}> Pass Bombs
              </label>
            </div>

            <div style="display:flex;gap:8px;">
              <div style="flex:1;">
                <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Drop Chance</label>
                <input type="number" id="enemy-drop-chance" class="admin-input" value="${config.dropChance}" min="0" max="1" step="0.05" style="width:100%;box-sizing:border-box;">
              </div>
            </div>
          </div>

          <!-- Right column: sprite config + preview -->
          <div style="width:180px;display:flex;flex-direction:column;gap:10px;">
            <div style="text-align:center;margin-bottom:4px;">
              <canvas id="enemy-modal-preview" width="80" height="80" style="border-radius:8px;background:var(--bg-deep);border:1px solid var(--border);"></canvas>
            </div>

            <div>
              <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:12px;">Body Shape</label>
              <select id="enemy-body-shape" class="admin-input" style="width:100%;box-sizing:border-box;font-size:12px;">
                ${bodyShapeOptions}
              </select>
            </div>
            <div>
              <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:12px;">Eye Style</label>
              <select id="enemy-eye-style" class="admin-input" style="width:100%;box-sizing:border-box;font-size:12px;">
                ${eyeStyleOptions}
              </select>
            </div>
            <div style="display:flex;gap:6px;">
              <div style="flex:1;">
                <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:12px;">Primary</label>
                <input type="color" id="enemy-primary-color" value="${sprite.primaryColor}" style="width:100%;height:28px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:transparent;">
              </div>
              <div style="flex:1;">
                <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:12px;">Secondary</label>
                <input type="color" id="enemy-secondary-color" value="${sprite.secondaryColor}" style="width:100%;height:28px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:transparent;">
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:12px;cursor:pointer;">
                <input type="checkbox" id="enemy-has-teeth" ${sprite.hasTeeth ? 'checked' : ''}> Teeth
              </label>
              <label style="display:flex;align-items:center;gap:4px;color:var(--text-dim);font-size:12px;cursor:pointer;">
                <input type="checkbox" id="enemy-has-horns" ${sprite.hasHorns ? 'checked' : ''}> Horns
              </label>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px;">
          <button class="btn btn-secondary" id="enemy-modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="enemy-modal-submit">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

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
    ];
    previewInputs.forEach((sel) => {
      overlay.querySelector(sel)?.addEventListener('input', () => {
        this.updateEnemyPreview(overlay, previewCanvas);
      });
      overlay.querySelector(sel)?.addEventListener('change', () => {
        this.updateEnemyPreview(overlay, previewCanvas);
      });
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
    };
    EnemyTextureGenerator.generatePreview(canvas, spriteConfig, 80);
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
      world:
        'This will permanently delete this world and <strong>all its levels</strong>.',
      level: 'This will permanently delete this level.',
      enemy:
        'This will permanently delete this enemy type. Levels referencing it may break.',
    };

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    overlay.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:420px;max-width:90vw;">
        <h3 style="margin:0 0 12px;color:var(--danger);">Delete ${labels[entityType]}</h3>
        <p style="color:var(--text-dim);margin:0 0 12px;">${warnings[entityType]} <strong style="color:var(--text);">${escapeHtml(name)}</strong></p>
        <p style="color:var(--text-dim);margin:0 0 16px;font-size:13px;">Type the name to confirm:</p>
        <input type="text" id="camp-delete-confirm" class="admin-input" placeholder="${escapeAttr(name)}" style="width:100%;box-sizing:border-box;margin-bottom:16px;">
        <div style="display:flex;gap:12px;justify-content:flex-end;">
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

    overlay.querySelector('#camp-delete-cancel')!.addEventListener('click', () =>
      overlay.remove(),
    );
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
}
