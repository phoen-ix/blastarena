import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { Season, RankConfig, DEFAULT_RANK_CONFIG, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml, escapeAttr, setHtml } from '../../utils/html';
import { t } from '../../i18n';

export class SeasonsTab {
  private container: HTMLElement;
  private notifications: NotificationUI;
  private seasons: Season[] = [];
  private rankConfig: RankConfig = {
    ...DEFAULT_RANK_CONFIG,
    tiers: [...DEFAULT_RANK_CONFIG.tiers],
  };
  private showCreateForm = false;

  constructor(notifications: NotificationUI) {
    this.container = document.createElement('div');
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = parent;
    await Promise.all([this.loadSeasons(), this.loadRankConfig()]);
    this.renderContent();
  }

  private async loadSeasons(): Promise<void> {
    try {
      this.seasons = await ApiClient.get<Season[]>('/admin/seasons');
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
      this.seasons = [];
    }
  }

  private async loadRankConfig(): Promise<void> {
    try {
      const config = await ApiClient.get<RankConfig>('/admin/settings/rank_tiers');
      this.rankConfig = config;
    } catch {
      this.rankConfig = { ...DEFAULT_RANK_CONFIG, tiers: [...DEFAULT_RANK_CONFIG.tiers] };
    }
  }

  private renderContent(): void {
    setHtml(this.container, '');

    // --- Season Management Section ---
    const seasonSection = document.createElement('div');
    seasonSection.className = 'admin-section';
    setHtml(
      seasonSection,
      `
      <h3>${t('admin:seasons.sectionTitle')}</h3>
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
        <button class="btn btn-primary" id="seasons-create-btn">${t('admin:seasons.createSeason')}</button>
      </div>
      <div id="seasons-create-form"></div>
      <div id="seasons-table-area"></div>
    `,
    );
    this.container.appendChild(seasonSection);

    // Create form toggle
    seasonSection.querySelector('#seasons-create-btn')!.addEventListener('click', () => {
      this.showCreateForm = !this.showCreateForm;
      this.renderCreateForm(seasonSection.querySelector('#seasons-create-form')!);
    });

    this.renderCreateForm(seasonSection.querySelector('#seasons-create-form')!);
    this.renderSeasonsTable(seasonSection.querySelector('#seasons-table-area')!);

    // --- Rank Tier Section ---
    const rankSection = document.createElement('div');
    rankSection.className = 'admin-section';
    setHtml(
      rankSection,
      `<h3>${t('admin:seasons.rankTierTitle')}</h3><div id="rank-tiers-area"></div>`,
    );
    this.container.appendChild(rankSection);

    this.renderRankTiers(rankSection.querySelector('#rank-tiers-area')!);
  }

  // ---- Season Create Form ----

  private renderCreateForm(el: HTMLElement): void {
    if (!this.showCreateForm) {
      setHtml(el, '');
      return;
    }

    setHtml(
      el,
      `
      <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
          <div>
            <label style="display:block;color:var(--text-dim);font-size:12px;margin-bottom:4px;">${t('admin:seasons.form.nameLabel')}</label>
            <input type="text" class="admin-input" id="season-name" placeholder="${escapeAttr(t('admin:seasons.form.namePlaceholder'))}" style="width:100%;">
          </div>
          <div>
            <label style="display:block;color:var(--text-dim);font-size:12px;margin-bottom:4px;">${t('admin:seasons.form.startDateLabel')}</label>
            <input type="date" class="admin-input" id="season-start" style="width:100%;">
          </div>
          <div>
            <label style="display:block;color:var(--text-dim);font-size:12px;margin-bottom:4px;">${t('admin:seasons.form.endDateLabel')}</label>
            <input type="date" class="admin-input" id="season-end" style="width:100%;">
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" id="season-cancel">${t('admin:seasons.form.cancel')}</button>
          <button class="btn btn-primary" id="season-submit">${t('admin:seasons.form.create')}</button>
        </div>
      </div>
    `,
    );

    el.querySelector('#season-cancel')!.addEventListener('click', () => {
      this.showCreateForm = false;
      this.renderCreateForm(el);
    });

    el.querySelector('#season-submit')!.addEventListener('click', async () => {
      const name = (el.querySelector('#season-name') as HTMLInputElement).value.trim();
      const startDate = (el.querySelector('#season-start') as HTMLInputElement).value;
      const endDate = (el.querySelector('#season-end') as HTMLInputElement).value;

      if (!name) {
        this.notifications.error(t('admin:seasons.errors.nameRequired'));
        return;
      }
      if (!startDate || !endDate) {
        this.notifications.error(t('admin:seasons.errors.datesRequired'));
        return;
      }
      if (new Date(endDate) <= new Date(startDate)) {
        this.notifications.error(t('admin:seasons.errors.endAfterStart'));
        return;
      }

      try {
        await ApiClient.post('/admin/seasons', { name, startDate, endDate });
        this.notifications.success(t('admin:seasons.notifications.seasonCreated'));
        this.showCreateForm = false;
        await this.loadSeasons();
        this.renderContent();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  // ---- Seasons Table ----

  private renderSeasonsTable(el: HTMLElement): void {
    if (this.seasons.length === 0) {
      setHtml(
        el,
        `<p style="color:var(--text-dim);font-size:13px;">${t('admin:seasons.table.empty')}</p>`,
      );
      return;
    }

    setHtml(
      el,
      `
      <table class="admin-table">
        <thead>
          <tr>
            <th>${t('admin:seasons.table.name')}</th>
            <th>${t('admin:seasons.table.startDate')}</th>
            <th>${t('admin:seasons.table.endDate')}</th>
            <th>${t('admin:seasons.table.status')}</th>
            <th>${t('admin:seasons.table.actions')}</th>
          </tr>
        </thead>
        <tbody>
          ${this.seasons
            .map(
              (s) => `
            <tr style="${s.isActive ? 'background:rgba(0,212,170,0.08);' : ''}">
              <td>${escapeHtml(s.name)}</td>
              <td>${escapeHtml(this.formatDate(s.startDate))}</td>
              <td>${escapeHtml(this.formatDate(s.endDate))}</td>
              <td>
                ${
                  s.isActive
                    ? `<span style="color:var(--success);font-weight:600;">${t('admin:seasons.table.statusActive')}</span>`
                    : `<span style="color:var(--text-dim);">${t('admin:seasons.table.statusInactive')}</span>`
                }
              </td>
              <td>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${
                    !s.isActive
                      ? `<button class="btn btn-primary" style="font-size:12px;padding:4px 10px;" data-activate="${s.id}">${t('admin:seasons.table.activate')}</button>`
                      : ''
                  }
                  ${
                    s.isActive
                      ? `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px;" data-end="${s.id}">${t('admin:seasons.table.endSeason')}</button>`
                      : ''
                  }
                  <button class="btn btn-danger" style="font-size:12px;padding:4px 10px;" data-delete="${s.id}">${t('admin:seasons.table.delete')}</button>
                </div>
              </td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>
    `,
    );

    // Activate handlers
    el.querySelectorAll<HTMLButtonElement>('[data-activate]').forEach((btn) => {
      btn.addEventListener('click', () => this.activateSeason(Number(btn.dataset.activate)));
    });

    // End season handlers
    el.querySelectorAll<HTMLButtonElement>('[data-end]').forEach((btn) => {
      btn.addEventListener('click', () => this.showEndSeasonDialog(Number(btn.dataset.end), btn));
    });

    // Delete handlers
    el.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteSeason(Number(btn.dataset.delete)));
    });
  }

  private async activateSeason(id: number): Promise<void> {
    try {
      await ApiClient.post(`/admin/seasons/${id}/activate`, {});
      this.notifications.success(t('admin:seasons.notifications.seasonActivated'));
      await this.loadSeasons();
      this.renderContent();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private showEndSeasonDialog(id: number, anchorBtn: HTMLButtonElement): void {
    // Remove any existing dialog
    const existing = this.container.querySelector('.end-season-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.className = 'end-season-dialog';
    dialog.style.cssText =
      'position:absolute;z-index:10;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:220px;';
    setHtml(
      dialog,
      `
      <p style="color:var(--text);font-size:13px;margin:0 0 12px 0;">${t('admin:seasons.endDialog.prompt')}</p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-ghost" id="end-soft" style="font-size:12px;text-align:left;">
          ${t('admin:seasons.endDialog.softReset')}
        </button>
        <button class="btn btn-danger" id="end-hard" style="font-size:12px;text-align:left;">
          ${t('admin:seasons.endDialog.hardReset')}
        </button>
        <button class="btn btn-ghost" id="end-cancel" style="font-size:12px;">${t('admin:seasons.endDialog.cancel')}</button>
      </div>
    `,
    );

    // Insert dialog after the button's row
    const row = anchorBtn.closest('tr');
    if (row && row.parentElement) {
      const wrapper = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.style.cssText = 'position:relative;padding:0;';
      td.appendChild(dialog);
      wrapper.appendChild(td);
      row.after(wrapper);
    } else {
      this.container.appendChild(dialog);
    }

    dialog.querySelector('#end-soft')!.addEventListener('click', async () => {
      dialog.closest('tr')?.remove();
      await this.endSeason(id, 'soft');
    });

    dialog.querySelector('#end-hard')!.addEventListener('click', async () => {
      dialog.closest('tr')?.remove();
      await this.endSeason(id, 'hard');
    });

    dialog.querySelector('#end-cancel')!.addEventListener('click', () => {
      dialog.closest('tr')?.remove();
    });
  }

  private async endSeason(id: number, resetMode: 'hard' | 'soft'): Promise<void> {
    try {
      await ApiClient.post(`/admin/seasons/${id}/end`, { resetMode });
      this.notifications.success(t('admin:seasons.notifications.seasonEnded', { resetMode }));
      await this.loadSeasons();
      this.renderContent();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private async deleteSeason(id: number): Promise<void> {
    const season = this.seasons.find((s) => s.id === id);
    if (season?.isActive) {
      this.notifications.error(t('admin:seasons.errors.cannotDeleteActive'));
      return;
    }
    try {
      await ApiClient.delete(`/admin/seasons/${id}`);
      this.notifications.success(t('admin:seasons.notifications.seasonDeleted'));
      await this.loadSeasons();
      this.renderContent();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  // ---- Rank Tier Configuration ----

  private renderRankTiers(el: HTMLElement): void {
    const tiers = this.rankConfig.tiers;

    setHtml(
      el,
      `
      <div id="rank-tiers-list">
        ${tiers
          .map(
            (tier, i) => `
          <div class="rank-tier-row" data-index="${i}" style="display:grid;grid-template-columns:1fr 100px 100px 60px 40px;gap:8px;align-items:center;margin-bottom:8px;">
            <input type="text" class="admin-input tier-name" value="${escapeAttr(tier.name)}" placeholder="${escapeAttr(t('admin:seasons.rankTiers.tierNamePlaceholder'))}" style="width:100%;">
            <input type="number" class="admin-input tier-min" value="${tier.minElo}" placeholder="${escapeAttr(t('admin:seasons.rankTiers.minPlaceholder'))}" style="width:100%;">
            <input type="number" class="admin-input tier-max" value="${tier.maxElo}" placeholder="${escapeAttr(t('admin:seasons.rankTiers.maxPlaceholder'))}" style="width:100%;">
            <input type="color" class="tier-color" value="${escapeAttr(tier.color)}" style="width:40px;height:36px;border:none;background:none;cursor:pointer;">
            <button class="btn btn-danger tier-remove" data-index="${i}" style="font-size:12px;padding:4px 8px;" title="${escapeAttr(t('admin:seasons.rankTiers.removeTier'))}">&times;</button>
          </div>
        `,
          )
          .join('')}
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap;">
        <button class="btn btn-ghost" id="rank-add-tier" style="font-size:13px;">${t('admin:seasons.rankTiers.addTier')}</button>
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim);font-size:13px;cursor:pointer;margin-left:auto;">
          <input type="checkbox" id="rank-subtiers" ${this.rankConfig.subTiersEnabled ? 'checked' : ''}>
          ${t('admin:seasons.rankTiers.enableSubTiers')}
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px;">
        <button class="btn btn-primary" id="rank-save">${t('admin:seasons.rankTiers.saveConfig')}</button>
      </div>
    `,
    );

    // Add tier
    el.querySelector('#rank-add-tier')!.addEventListener('click', () => {
      const lastTier = tiers[tiers.length - 1];
      const newMin = lastTier ? lastTier.maxElo + 1 : 0;
      this.rankConfig.tiers.push({
        name: '',
        minElo: newMin,
        maxElo: newMin + 199,
        color: '#ffffff',
      });
      this.renderRankTiers(el);
    });

    // Remove tier
    el.querySelectorAll<HTMLButtonElement>('.tier-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.index);
        this.rankConfig.tiers.splice(idx, 1);
        this.renderRankTiers(el);
      });
    });

    // Sync input changes into state on change
    const syncTiers = () => {
      const rows = el.querySelectorAll('.rank-tier-row');
      rows.forEach((row, i) => {
        if (!this.rankConfig.tiers[i]) return;
        this.rankConfig.tiers[i].name = (
          row.querySelector('.tier-name') as HTMLInputElement
        ).value.trim();
        this.rankConfig.tiers[i].minElo = Number(
          (row.querySelector('.tier-min') as HTMLInputElement).value,
        );
        this.rankConfig.tiers[i].maxElo = Number(
          (row.querySelector('.tier-max') as HTMLInputElement).value,
        );
        this.rankConfig.tiers[i].color = (
          row.querySelector('.tier-color') as HTMLInputElement
        ).value;
      });
      this.rankConfig.subTiersEnabled = (
        el.querySelector('#rank-subtiers') as HTMLInputElement
      ).checked;
    };

    // Save
    el.querySelector('#rank-save')!.addEventListener('click', async () => {
      syncTiers();

      // Validate
      for (const tier of this.rankConfig.tiers) {
        if (!tier.name) {
          this.notifications.error(t('admin:seasons.errors.tierNameRequired'));
          return;
        }
        if (tier.minElo > tier.maxElo) {
          this.notifications.error(
            t('admin:seasons.errors.tierMinMaxInvalid', { name: tier.name }),
          );
          return;
        }
      }

      try {
        await ApiClient.put('/admin/settings/rank_tiers', this.rankConfig);
        this.notifications.success(t('admin:seasons.notifications.rankConfigSaved'));
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  // ---- Helpers ----

  private formatDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  destroy(): void {
    // No persistent listeners to clean up
  }
}
