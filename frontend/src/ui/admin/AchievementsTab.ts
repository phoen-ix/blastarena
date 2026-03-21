import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import {
  Achievement,
  Cosmetic,
  AchievementConditionType,
  AchievementRewardType,
  CosmeticType,
  CosmeticRarity,
  CosmeticUnlockType,
  getErrorMessage,
} from '@blast-arena/shared';
import { escapeHtml, escapeAttr } from '../../utils/html';

const CONDITION_TYPES: AchievementConditionType[] = [
  'cumulative',
  'per_game',
  'mode_specific',
  'campaign',
];

const CONDITION_LABELS: Record<AchievementConditionType, string> = {
  cumulative: 'Cumulative',
  per_game: 'Per Game',
  mode_specific: 'Mode Specific',
  campaign: 'Campaign',
};

const CUMULATIVE_STATS = [
  'total_kills',
  'total_wins',
  'total_matches',
  'total_bombs_placed',
  'total_powerups',
  'total_playtime',
];

const PER_GAME_STATS = [
  'kills',
  'deaths',
  'bombs_placed',
  'powerups_collected',
  'survived_seconds',
  'placement',
];

const PER_GAME_OPERATORS = ['>=', '<=', '==', '>'];

const GAME_MODES = ['ffa', 'teams', 'battle_royale', 'sudden_death', 'deathmatch', 'koth'];

const CAMPAIGN_SUBTYPES = ['stars_earned', 'levels_completed', 'worlds_completed', 'bosses_beaten'];

const COSMETIC_TYPES: CosmeticType[] = ['color', 'eyes', 'trail', 'bomb_skin'];

const RARITY_OPTIONS: CosmeticRarity[] = ['common', 'rare', 'epic', 'legendary'];

const UNLOCK_TYPES: CosmeticUnlockType[] = ['achievement', 'campaign_stars', 'default'];

const RARITY_COLORS: Record<CosmeticRarity, string> = {
  common: 'var(--text-dim)',
  rare: 'var(--info)',
  epic: '#bb66ff',
  legendary: 'var(--primary)',
};

export class AchievementsTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private currentView: 'achievements' | 'cosmetics' = 'achievements';
  private achievements: Achievement[] = [];
  private cosmetics: Cosmetic[] = [];

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
    this.container = document.createElement('div');
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = parent;
    await this.renderView();
  }

  destroy(): void {
    if (this.container) this.container.innerHTML = '';
    this.achievements = [];
    this.cosmetics = [];
  }

  private async renderView(): Promise<void> {
    if (!this.container) return;

    this.container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="color:var(--text);margin:0;">Achievements &amp; Cosmetics</h3>
        <div style="display:flex;gap:8px;">
          <button class="btn ${this.currentView === 'achievements' ? 'btn-primary' : 'btn-ghost'}" id="ach-view-achievements">Achievements</button>
          <button class="btn ${this.currentView === 'cosmetics' ? 'btn-primary' : 'btn-ghost'}" id="ach-view-cosmetics">Cosmetics</button>
        </div>
      </div>
      <div id="ach-content"></div>
    `;

    this.container.querySelector('#ach-view-achievements')!.addEventListener('click', () => {
      if (this.currentView !== 'achievements') {
        this.currentView = 'achievements';
        this.renderView();
      }
    });
    this.container.querySelector('#ach-view-cosmetics')!.addEventListener('click', () => {
      if (this.currentView !== 'cosmetics') {
        this.currentView = 'cosmetics';
        this.renderView();
      }
    });

    if (this.currentView === 'achievements') {
      await this.loadAchievements();
    } else {
      await this.loadCosmetics();
    }
  }

  // ─── Achievements ────────────────────────────────────────────────────

  private async loadAchievements(): Promise<void> {
    if (!this.container) return;
    const content = this.container.querySelector('#ach-content');
    if (!content) return;

    try {
      const res = await ApiClient.get<{ achievements: Achievement[] }>('/admin/achievements');
      this.achievements = res.achievements;
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      this.achievements = [];
    }

    content.innerHTML = `
      <div class="admin-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <span style="color:var(--text-dim);font-size:13px;">${this.achievements.length} achievement${this.achievements.length !== 1 ? 's' : ''}</span>
          <button class="btn btn-primary" id="ach-create">Create Achievement</button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Icon</th>
              <th>Name</th>
              <th>Description</th>
              <th>Condition</th>
              <th>Reward</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.achievements.map((a) => this.renderAchievementRow(a)).join('')}
          </tbody>
        </table>
      </div>
    `;

    content.querySelector('#ach-create')?.addEventListener('click', () => {
      this.showAchievementModal();
    });
    this.attachAchievementHandlers(content as HTMLElement);
  }

  private renderAchievementRow(a: Achievement): string {
    const statusBadge = a.isActive
      ? '<span style="color:var(--success);font-weight:600;">Active</span>'
      : '<span style="color:var(--text-dim);">Inactive</span>';
    const rewardLabel =
      a.rewardType === 'none'
        ? '<span style="color:var(--text-dim);">None</span>'
        : `<span style="color:var(--accent);">${escapeHtml(a.rewardType)}${a.rewardId ? ` #${a.rewardId}` : ''}</span>`;

    return `
      <tr>
        <td style="font-size:20px;text-align:center;">${escapeHtml(a.icon)}</td>
        <td>${escapeHtml(a.name)}</td>
        <td style="color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(a.description)}</td>
        <td><span class="badge">${escapeHtml(CONDITION_LABELS[a.conditionType] || a.conditionType)}</span></td>
        <td>${rewardLabel}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-sm btn-secondary ach-edit" data-id="${a.id}">Edit</button>
            <button class="btn-sm btn-danger ach-delete" data-id="${a.id}" data-name="${escapeAttr(a.name)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  private attachAchievementHandlers(container: HTMLElement): void {
    container.querySelectorAll('.ach-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt((btn as HTMLElement).dataset.id!);
        const ach = this.achievements.find((a) => a.id === id);
        if (ach) this.showAchievementModal(ach);
      });
    });

    container.querySelectorAll('.ach-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt((btn as HTMLElement).dataset.id!);
        const name = (btn as HTMLElement).dataset.name!;
        this.confirmDelete('achievement', id, name, async () => {
          await ApiClient.delete(`/admin/achievements/${id}`);
          this.notifications.success('Achievement deleted');
          await this.loadAchievements();
        });
      });
    });
  }

  private showAchievementModal(existing?: Achievement): void {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const condCfg = existing?.conditionConfig || {};
    const currentCondType = existing?.conditionType || 'cumulative';

    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;max-height:85vh;overflow-y:auto;">
        <h2 style="margin-bottom:16px;">${isEdit ? 'Edit' : 'Create'} Achievement</h2>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="color:var(--text-dim);font-size:13px;">Name *</label>
            <input type="text" class="admin-input" id="am-name" value="${escapeAttr(existing?.name || '')}" placeholder="Achievement name" style="margin-top:4px;">
          </div>
          <div>
            <label style="color:var(--text-dim);font-size:13px;">Description *</label>
            <input type="text" class="admin-input" id="am-desc" value="${escapeAttr(existing?.description || '')}" placeholder="Short description" style="margin-top:4px;">
          </div>
          <div style="display:flex;gap:12px;">
            <div style="flex:1;">
              <label style="color:var(--text-dim);font-size:13px;">Icon</label>
              <input type="text" class="admin-input" id="am-icon" value="${escapeAttr(existing?.icon || '')}" placeholder="Emoji or text" style="margin-top:4px;">
            </div>
            <div style="flex:1;">
              <label style="color:var(--text-dim);font-size:13px;">Category</label>
              <input type="text" class="admin-input" id="am-category" value="${escapeAttr(existing?.category || '')}" placeholder="e.g. combat, survival" style="margin-top:4px;">
            </div>
          </div>
          <div>
            <label style="color:var(--text-dim);font-size:13px;">Condition Type *</label>
            <select class="admin-select" id="am-condType" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              ${CONDITION_TYPES.map((t) => `<option value="${t}" ${currentCondType === t ? 'selected' : ''}>${CONDITION_LABELS[t]}</option>`).join('')}
            </select>
          </div>
          <div id="am-cond-fields"></div>
          <div style="display:flex;gap:12px;">
            <div style="flex:1;">
              <label style="color:var(--text-dim);font-size:13px;">Reward Type</label>
              <select class="admin-select" id="am-rewardType" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
                <option value="none" ${(!existing || existing.rewardType === 'none') ? 'selected' : ''}>None</option>
                <option value="cosmetic" ${existing?.rewardType === 'cosmetic' ? 'selected' : ''}>Cosmetic</option>
                <option value="title" ${existing?.rewardType === 'title' ? 'selected' : ''}>Title</option>
              </select>
            </div>
            <div style="flex:1;" id="am-reward-id-wrap">
              <label style="color:var(--text-dim);font-size:13px;">Reward Cosmetic ID</label>
              <input type="number" class="admin-input" id="am-rewardId" value="${existing?.rewardId ?? ''}" placeholder="Cosmetic ID" style="margin-top:4px;" min="0">
            </div>
          </div>
          <div>
            <label style="color:var(--text-dim);font-size:13px;">Sort Order</label>
            <input type="number" class="admin-input" id="am-sortOrder" value="${existing?.sortOrder ?? 0}" style="margin-top:4px;" min="0">
          </div>
        </div>
        <div id="am-error" style="color:var(--danger);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="am-cancel">Cancel</button>
          <button class="btn btn-primary" id="am-submit">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    `;

    document.getElementById('ui-overlay')!.appendChild(overlay);

    const condTypeSelect = overlay.querySelector('#am-condType') as HTMLSelectElement;
    const condFieldsEl = overlay.querySelector('#am-cond-fields') as HTMLElement;
    const rewardTypeSelect = overlay.querySelector('#am-rewardType') as HTMLSelectElement;
    const rewardIdWrap = overlay.querySelector('#am-reward-id-wrap') as HTMLElement;

    const updateCondFields = () => {
      this.renderConditionFields(condFieldsEl, condTypeSelect.value as AchievementConditionType, condCfg);
    };

    const updateRewardVisibility = () => {
      const showId = rewardTypeSelect.value === 'cosmetic';
      rewardIdWrap.style.display = showId ? '' : 'none';
    };

    condTypeSelect.addEventListener('change', updateCondFields);
    rewardTypeSelect.addEventListener('change', updateRewardVisibility);
    updateCondFields();
    updateRewardVisibility();

    overlay.querySelector('#am-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#am-submit')!.addEventListener('click', async () => {
      const name = (overlay.querySelector('#am-name') as HTMLInputElement).value.trim();
      const description = (overlay.querySelector('#am-desc') as HTMLInputElement).value.trim();
      const icon = (overlay.querySelector('#am-icon') as HTMLInputElement).value.trim();
      const category = (overlay.querySelector('#am-category') as HTMLInputElement).value.trim();
      const conditionType = condTypeSelect.value as AchievementConditionType;
      const rewardType = rewardTypeSelect.value as AchievementRewardType;
      const rewardIdVal = (overlay.querySelector('#am-rewardId') as HTMLInputElement).value;
      const rewardId = rewardType === 'cosmetic' && rewardIdVal ? parseInt(rewardIdVal) : null;
      const sortOrder = parseInt((overlay.querySelector('#am-sortOrder') as HTMLInputElement).value) || 0;
      const errorEl = overlay.querySelector('#am-error') as HTMLElement;

      if (!name || !description) {
        errorEl.textContent = 'Name and description are required';
        errorEl.style.display = 'block';
        return;
      }

      const conditionConfig = this.readConditionConfig(overlay, conditionType);

      const payload = {
        name,
        description,
        icon,
        category,
        conditionType,
        conditionConfig,
        rewardType,
        rewardId,
        sortOrder,
      };

      try {
        if (isEdit) {
          await ApiClient.put(`/admin/achievements/${existing!.id}`, payload);
          this.notifications.success('Achievement updated');
        } else {
          await ApiClient.post('/admin/achievements', payload);
          this.notifications.success('Achievement created');
        }
        overlay.remove();
        await this.loadAchievements();
      } catch (err: unknown) {
        errorEl.textContent = getErrorMessage(err);
        errorEl.style.display = 'block';
      }
    });
  }

  private renderConditionFields(
    container: HTMLElement,
    type: AchievementConditionType,
    cfg: Record<string, unknown>,
  ): void {
    if (type === 'cumulative') {
      container.innerHTML = `
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Stat</label>
            <select class="admin-select" id="am-cond-stat" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              ${CUMULATIVE_STATS.map((s) => `<option value="${s}" ${cfg.stat === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Threshold</label>
            <input type="number" class="admin-input" id="am-cond-threshold" value="${cfg.threshold ?? 1}" style="margin-top:4px;" min="1">
          </div>
        </div>
      `;
    } else if (type === 'per_game') {
      container.innerHTML = `
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Stat</label>
            <select class="admin-select" id="am-cond-stat" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              ${PER_GAME_STATS.map((s) => `<option value="${s}" ${cfg.stat === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div style="flex:0.5;">
            <label style="color:var(--text-dim);font-size:13px;">Operator</label>
            <select class="admin-select" id="am-cond-operator" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              ${PER_GAME_OPERATORS.map((o) => `<option value="${escapeAttr(o)}" ${cfg.operator === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
          </div>
          <div style="flex:0.5;">
            <label style="color:var(--text-dim);font-size:13px;">Threshold</label>
            <input type="number" class="admin-input" id="am-cond-threshold" value="${cfg.threshold ?? 1}" style="margin-top:4px;" min="0">
          </div>
        </div>
      `;
    } else if (type === 'mode_specific') {
      container.innerHTML = `
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Game Mode</label>
            <select class="admin-select" id="am-cond-mode" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              ${GAME_MODES.map((m) => `<option value="${m}" ${cfg.mode === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Stat</label>
            <select class="admin-select" id="am-cond-stat" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              ${CUMULATIVE_STATS.map((s) => `<option value="${s}" ${cfg.stat === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div style="flex:0.5;">
            <label style="color:var(--text-dim);font-size:13px;">Threshold</label>
            <input type="number" class="admin-input" id="am-cond-threshold" value="${cfg.threshold ?? 1}" style="margin-top:4px;" min="1">
          </div>
        </div>
      `;
    } else if (type === 'campaign') {
      container.innerHTML = `
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Sub-Type</label>
            <select class="admin-select" id="am-cond-subType" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              ${CAMPAIGN_SUBTYPES.map((s) => `<option value="${s}" ${cfg.subType === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Threshold</label>
            <input type="number" class="admin-input" id="am-cond-threshold" value="${cfg.threshold ?? 1}" style="margin-top:4px;" min="1">
          </div>
        </div>
      `;
    }
  }

  private readConditionConfig(
    overlay: HTMLElement,
    type: AchievementConditionType,
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    const stat = (overlay.querySelector('#am-cond-stat') as HTMLSelectElement)?.value;
    const threshold = parseInt(
      (overlay.querySelector('#am-cond-threshold') as HTMLInputElement)?.value || '1',
    );

    if (type === 'cumulative') {
      config.stat = stat;
      config.threshold = threshold;
    } else if (type === 'per_game') {
      config.stat = stat;
      config.operator =
        (overlay.querySelector('#am-cond-operator') as HTMLSelectElement)?.value || '>=';
      config.threshold = threshold;
    } else if (type === 'mode_specific') {
      config.mode = (overlay.querySelector('#am-cond-mode') as HTMLSelectElement)?.value;
      config.stat = stat;
      config.threshold = threshold;
    } else if (type === 'campaign') {
      config.subType =
        (overlay.querySelector('#am-cond-subType') as HTMLSelectElement)?.value;
      config.threshold = threshold;
    }

    return config;
  }

  // ─── Cosmetics ───────────────────────────────────────────────────────

  private async loadCosmetics(): Promise<void> {
    if (!this.container) return;
    const content = this.container.querySelector('#ach-content');
    if (!content) return;

    try {
      const res = await ApiClient.get<{ cosmetics: Cosmetic[] }>('/admin/cosmetics');
      this.cosmetics = res.cosmetics;
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      this.cosmetics = [];
    }

    content.innerHTML = `
      <div class="admin-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <span style="color:var(--text-dim);font-size:13px;">${this.cosmetics.length} cosmetic${this.cosmetics.length !== 1 ? 's' : ''}</span>
          <button class="btn btn-primary" id="cos-create">Create Cosmetic</button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Rarity</th>
              <th>Unlock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.cosmetics.map((c) => this.renderCosmeticRow(c)).join('')}
          </tbody>
        </table>
      </div>
    `;

    content.querySelector('#cos-create')?.addEventListener('click', () => {
      this.showCosmeticModal();
    });
    this.attachCosmeticHandlers(content as HTMLElement);
  }

  private renderCosmeticRow(c: Cosmetic): string {
    const statusBadge = c.isActive
      ? '<span style="color:var(--success);font-weight:600;">Active</span>'
      : '<span style="color:var(--text-dim);">Inactive</span>';
    const rarityColor = RARITY_COLORS[c.rarity] || 'var(--text)';

    return `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td><span class="badge">${escapeHtml(c.type)}</span></td>
        <td><span style="color:${rarityColor};font-weight:600;">${escapeHtml(c.rarity)}</span></td>
        <td style="color:var(--text-dim);">${escapeHtml(c.unlockType)}</td>
        <td>${statusBadge}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-sm btn-secondary cos-edit" data-id="${c.id}">Edit</button>
            <button class="btn-sm btn-danger cos-delete" data-id="${c.id}" data-name="${escapeAttr(c.name)}">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  private attachCosmeticHandlers(container: HTMLElement): void {
    container.querySelectorAll('.cos-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt((btn as HTMLElement).dataset.id!);
        const cos = this.cosmetics.find((c) => c.id === id);
        if (cos) this.showCosmeticModal(cos);
      });
    });

    container.querySelectorAll('.cos-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt((btn as HTMLElement).dataset.id!);
        const name = (btn as HTMLElement).dataset.name!;
        this.confirmDelete('cosmetic', id, name, async () => {
          await ApiClient.delete(`/admin/cosmetics/${id}`);
          this.notifications.success('Cosmetic deleted');
          await this.loadCosmetics();
        });
      });
    });
  }

  private showCosmeticModal(existing?: Cosmetic): void {
    const isEdit = !!existing;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const currentType = existing?.type || 'color';
    const cfg = existing?.config || {};

    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;max-height:85vh;overflow-y:auto;">
        <h2 style="margin-bottom:16px;">${isEdit ? 'Edit' : 'Create'} Cosmetic</h2>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="color:var(--text-dim);font-size:13px;">Name *</label>
            <input type="text" class="admin-input" id="cm-name" value="${escapeAttr(existing?.name || '')}" placeholder="Cosmetic name" style="margin-top:4px;">
          </div>
          <div style="display:flex;gap:12px;">
            <div style="flex:1;">
              <label style="color:var(--text-dim);font-size:13px;">Type *</label>
              <select class="admin-select" id="cm-type" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
                ${COSMETIC_TYPES.map((t) => `<option value="${t}" ${currentType === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1;">
              <label style="color:var(--text-dim);font-size:13px;">Rarity</label>
              <select class="admin-select" id="cm-rarity" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
                ${RARITY_OPTIONS.map((r) => `<option value="${r}" ${existing?.rarity === r ? 'selected' : ''}>${r}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="cm-config-fields"></div>
          <div style="display:flex;gap:12px;">
            <div style="flex:1;">
              <label style="color:var(--text-dim);font-size:13px;">Unlock Type</label>
              <select class="admin-select" id="cm-unlockType" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
                ${UNLOCK_TYPES.map((u) => `<option value="${u}" ${existing?.unlockType === u ? 'selected' : ''}>${u}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1;" id="cm-unlock-req-wrap">
              <label style="color:var(--text-dim);font-size:13px;">Unlock Requirement</label>
              <textarea class="admin-input" id="cm-unlockReq" rows="2" placeholder='{"threshold": 50}' style="margin-top:4px;width:100%;box-sizing:border-box;resize:vertical;font-family:monospace;font-size:12px;">${existing?.unlockRequirement ? JSON.stringify(existing.unlockRequirement, null, 2) : ''}</textarea>
            </div>
          </div>
          <div>
            <label style="color:var(--text-dim);font-size:13px;">Sort Order</label>
            <input type="number" class="admin-input" id="cm-sortOrder" value="${existing?.sortOrder ?? 0}" style="margin-top:4px;" min="0">
          </div>
        </div>
        <div id="cm-error" style="color:var(--danger);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="cm-cancel">Cancel</button>
          <button class="btn btn-primary" id="cm-submit">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    `;

    document.getElementById('ui-overlay')!.appendChild(overlay);

    const typeSelect = overlay.querySelector('#cm-type') as HTMLSelectElement;
    const configFieldsEl = overlay.querySelector('#cm-config-fields') as HTMLElement;
    const unlockTypeSelect = overlay.querySelector('#cm-unlockType') as HTMLSelectElement;
    const unlockReqWrap = overlay.querySelector('#cm-unlock-req-wrap') as HTMLElement;

    const updateConfigFields = () => {
      this.renderCosmeticConfigFields(configFieldsEl, typeSelect.value as CosmeticType, cfg);
    };

    const updateUnlockReqVisibility = () => {
      const show = unlockTypeSelect.value !== 'default';
      unlockReqWrap.style.display = show ? '' : 'none';
    };

    typeSelect.addEventListener('change', updateConfigFields);
    unlockTypeSelect.addEventListener('change', updateUnlockReqVisibility);
    updateConfigFields();
    updateUnlockReqVisibility();

    overlay.querySelector('#cm-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#cm-submit')!.addEventListener('click', async () => {
      const name = (overlay.querySelector('#cm-name') as HTMLInputElement).value.trim();
      const type = typeSelect.value as CosmeticType;
      const rarity = (overlay.querySelector('#cm-rarity') as HTMLSelectElement).value as CosmeticRarity;
      const unlockType = unlockTypeSelect.value as CosmeticUnlockType;
      const sortOrder = parseInt((overlay.querySelector('#cm-sortOrder') as HTMLInputElement).value) || 0;
      const errorEl = overlay.querySelector('#cm-error') as HTMLElement;

      if (!name) {
        errorEl.textContent = 'Name is required';
        errorEl.style.display = 'block';
        return;
      }

      const config = this.readCosmeticConfig(overlay, type);
      if (config === null) {
        errorEl.textContent = 'Invalid config values';
        errorEl.style.display = 'block';
        return;
      }

      let unlockRequirement: Record<string, unknown> | null = null;
      if (unlockType !== 'default') {
        const reqStr = (overlay.querySelector('#cm-unlockReq') as HTMLTextAreaElement).value.trim();
        if (reqStr) {
          try {
            unlockRequirement = JSON.parse(reqStr);
          } catch {
            errorEl.textContent = 'Unlock requirement must be valid JSON';
            errorEl.style.display = 'block';
            return;
          }
        }
      }

      const payload = {
        name,
        type,
        config,
        rarity,
        unlockType,
        unlockRequirement,
        sortOrder,
      };

      try {
        if (isEdit) {
          await ApiClient.put(`/admin/cosmetics/${existing!.id}`, payload);
          this.notifications.success('Cosmetic updated');
        } else {
          await ApiClient.post('/admin/cosmetics', payload);
          this.notifications.success('Cosmetic created');
        }
        overlay.remove();
        await this.loadCosmetics();
      } catch (err: unknown) {
        errorEl.textContent = getErrorMessage(err);
        errorEl.style.display = 'block';
      }
    });
  }

  private renderCosmeticConfigFields(
    container: HTMLElement,
    type: CosmeticType,
    cfg: Record<string, unknown>,
  ): void {
    if (type === 'color') {
      const hex = typeof cfg.hex === 'string' ? cfg.hex : '#ff6b35';
      container.innerHTML = `
        <div>
          <label style="color:var(--text-dim);font-size:13px;">Hex Color</label>
          <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
            <input type="color" id="cm-cfg-hex" value="${escapeAttr(hex)}" style="width:48px;height:36px;border:none;cursor:pointer;">
            <input type="text" class="admin-input" id="cm-cfg-hex-text" value="${escapeAttr(hex)}" placeholder="#ff6b35" style="flex:1;">
          </div>
        </div>
      `;
      const colorPicker = container.querySelector('#cm-cfg-hex') as HTMLInputElement;
      const colorText = container.querySelector('#cm-cfg-hex-text') as HTMLInputElement;
      colorPicker.addEventListener('input', () => {
        colorText.value = colorPicker.value;
      });
      colorText.addEventListener('input', () => {
        if (/^#[0-9a-fA-F]{6}$/.test(colorText.value)) {
          colorPicker.value = colorText.value;
        }
      });
    } else if (type === 'eyes') {
      const style = typeof cfg.style === 'string' ? cfg.style : 'round';
      container.innerHTML = `
        <div>
          <label style="color:var(--text-dim);font-size:13px;">Eye Style</label>
          <input type="text" class="admin-input" id="cm-cfg-style" value="${escapeAttr(style)}" placeholder="e.g. round, angry, cute" style="margin-top:4px;">
        </div>
      `;
    } else if (type === 'trail') {
      container.innerHTML = `
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Particle Key</label>
            <input type="text" class="admin-input" id="cm-cfg-particleKey" value="${escapeAttr(String(cfg.particleKey || 'particle_fire'))}" placeholder="particle_fire" style="margin-top:4px;">
          </div>
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Tint (hex number)</label>
            <input type="text" class="admin-input" id="cm-cfg-tint" value="${cfg.tint != null ? '0x' + (Number(cfg.tint) >>> 0).toString(16).padStart(6, '0') : '0xff6b35'}" placeholder="0xff6b35" style="margin-top:4px;">
          </div>
        </div>
        <div>
          <label style="color:var(--text-dim);font-size:13px;">Frequency</label>
          <input type="number" class="admin-input" id="cm-cfg-frequency" value="${cfg.frequency ?? 100}" style="margin-top:4px;" min="1" max="1000">
        </div>
      `;
    } else if (type === 'bomb_skin') {
      container.innerHTML = `
        <div style="display:flex;gap:12px;">
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Base Color (hex number)</label>
            <input type="text" class="admin-input" id="cm-cfg-baseColor" value="${cfg.baseColor != null ? '0x' + (Number(cfg.baseColor) >>> 0).toString(16).padStart(6, '0') : '0x333333'}" placeholder="0x333333" style="margin-top:4px;">
          </div>
          <div style="flex:1;">
            <label style="color:var(--text-dim);font-size:13px;">Fuse Color (hex number)</label>
            <input type="text" class="admin-input" id="cm-cfg-fuseColor" value="${cfg.fuseColor != null ? '0x' + (Number(cfg.fuseColor) >>> 0).toString(16).padStart(6, '0') : '0xff4400'}" placeholder="0xff4400" style="margin-top:4px;">
          </div>
        </div>
        <div>
          <label style="color:var(--text-dim);font-size:13px;">Label</label>
          <input type="text" class="admin-input" id="cm-cfg-label" value="${escapeAttr(String(cfg.label || ''))}" placeholder="Short label" style="margin-top:4px;">
        </div>
      `;
    }
  }

  private readCosmeticConfig(
    overlay: HTMLElement,
    type: CosmeticType,
  ): Record<string, unknown> | null {
    if (type === 'color') {
      const hex = (overlay.querySelector('#cm-cfg-hex-text') as HTMLInputElement)?.value.trim();
      if (!hex) return null;
      return { hex };
    } else if (type === 'eyes') {
      const style = (overlay.querySelector('#cm-cfg-style') as HTMLInputElement)?.value.trim();
      if (!style) return null;
      return { style };
    } else if (type === 'trail') {
      const particleKey = (overlay.querySelector('#cm-cfg-particleKey') as HTMLInputElement)?.value.trim();
      const tintStr = (overlay.querySelector('#cm-cfg-tint') as HTMLInputElement)?.value.trim();
      const frequency = parseInt((overlay.querySelector('#cm-cfg-frequency') as HTMLInputElement)?.value || '100');
      const tint = parseInt(tintStr, 16) || parseInt(tintStr) || 0;
      if (!particleKey) return null;
      return { particleKey, tint, frequency };
    } else if (type === 'bomb_skin') {
      const baseStr = (overlay.querySelector('#cm-cfg-baseColor') as HTMLInputElement)?.value.trim();
      const fuseStr = (overlay.querySelector('#cm-cfg-fuseColor') as HTMLInputElement)?.value.trim();
      const label = (overlay.querySelector('#cm-cfg-label') as HTMLInputElement)?.value.trim();
      const baseColor = parseInt(baseStr, 16) || parseInt(baseStr) || 0;
      const fuseColor = parseInt(fuseStr, 16) || parseInt(fuseStr) || 0;
      return { baseColor, fuseColor, label: label || '' };
    }
    return {};
  }

  // ─── Shared utilities ────────────────────────────────────────────────

  private confirmDelete(
    entity: string,
    id: number,
    name: string,
    onConfirm: () => Promise<void>,
  ): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h2 style="margin-bottom:12px;color:var(--danger);">Delete ${escapeHtml(entity)}</h2>
        <p style="color:var(--text-dim);font-size:14px;">This will permanently delete <strong style="color:var(--text);">${escapeHtml(name)}</strong>. This action cannot be undone.</p>
        <p style="color:var(--text-dim);font-size:13px;margin-top:8px;">Type the name to confirm:</p>
        <input type="text" class="admin-input" id="del-confirm-input" placeholder="${escapeAttr(name)}" style="margin-top:4px;">
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="del-cancel">Cancel</button>
          <button class="btn-danger" style="padding:8px 16px;font-size:14px;opacity:0.5;" id="del-confirm" disabled>Delete</button>
        </div>
      </div>
    `;

    document.getElementById('ui-overlay')!.appendChild(overlay);

    const input = overlay.querySelector('#del-confirm-input') as HTMLInputElement;
    const confirmBtn = overlay.querySelector('#del-confirm') as HTMLButtonElement;

    input.addEventListener('input', () => {
      const matches = input.value === name;
      confirmBtn.disabled = !matches;
      confirmBtn.style.opacity = matches ? '1' : '0.5';
    });

    overlay.querySelector('#del-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    confirmBtn.addEventListener('click', async () => {
      overlay.remove();
      try {
        await onConfirm();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }
}
