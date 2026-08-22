import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { MapChallengeSummary, CustomMapSummary, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml, escapeAttr, setHtml } from '../../utils/html';
import { t } from '../../i18n';

export class ChallengesTab {
  private container: HTMLElement;
  private notifications: NotificationUI;
  private challenges: MapChallengeSummary[] = [];
  private publishedMaps: CustomMapSummary[] = [];
  private showCreateForm = false;
  private challengesEnabled = true;

  constructor(notifications: NotificationUI) {
    this.container = document.createElement('div');
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = parent;
    await this.loadData();
    this.renderContent();
  }

  private async loadData(): Promise<void> {
    try {
      const [challengeRes, mapsRes, enabledRes] = await Promise.all([
        ApiClient.get<{ challenges: MapChallengeSummary[]; total: number }>('/admin/challenges'),
        ApiClient.get<CustomMapSummary[]>('/maps/published'),
        ApiClient.get<{ enabled: boolean }>('/admin/settings/challenges_enabled').catch(() => ({
          enabled: true,
        })),
      ]);
      this.challenges = challengeRes.challenges;
      this.publishedMaps = mapsRes;
      this.challengesEnabled = enabledRes.enabled;
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private renderContent(): void {
    setHtml(this.container, '');

    // Global toggle
    const toggleSection = document.createElement('div');
    toggleSection.className = 'admin-card';
    setHtml(
      toggleSection,
      `
      <div class="admin-card-header">
        <h3>${t('admin:challenges.globalToggle')}</h3>
      </div>
      <div class="admin-card-body">
        <div class="setting-row">
          <span>${t('admin:challenges.enabled')}</span>
          <label class="toggle-switch">
            <input type="checkbox" id="challenges-enabled-toggle" ${this.challengesEnabled ? 'checked' : ''}
              role="switch" aria-checked="${this.challengesEnabled}">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>`,
    );
    this.container.appendChild(toggleSection);

    toggleSection
      .querySelector('#challenges-enabled-toggle')
      ?.addEventListener('change', async (e) => {
        const enabled = (e.target as HTMLInputElement).checked;
        try {
          await ApiClient.put('/admin/settings/challenges_enabled', { enabled });
          this.challengesEnabled = enabled;
          this.notifications.success(t('admin:challenges.toggleSaved'));
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });

    // Create form
    const createSection = document.createElement('div');
    createSection.className = 'admin-card';
    createSection.style.marginTop = '1rem';
    setHtml(
      createSection,
      `
      <div class="admin-card-header" style="display:flex; justify-content:space-between; align-items:center;">
        <h3>${t('admin:challenges.title')}</h3>
        <button class="btn btn-sm btn-primary" id="toggle-create-form">
          ${this.showCreateForm ? t('admin:challenges.cancel') : t('admin:challenges.create')}
        </button>
      </div>
      <div class="admin-card-body">
        ${this.showCreateForm ? this.renderCreateForm() : ''}
        ${this.renderChallengeTable()}
      </div>`,
    );
    this.container.appendChild(createSection);

    // Toggle form
    createSection.querySelector('#toggle-create-form')?.addEventListener('click', () => {
      this.showCreateForm = !this.showCreateForm;
      this.renderContent();
    });

    // Create submit
    createSection.querySelector('#challenge-create-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const title = (form.querySelector('#ch-title') as HTMLInputElement).value;
      const description = (form.querySelector('#ch-desc') as HTMLTextAreaElement).value;
      const customMapId = parseInt((form.querySelector('#ch-map') as HTMLSelectElement).value);
      const gameMode = (form.querySelector('#ch-mode') as HTMLSelectElement).value;
      const startDate = (form.querySelector('#ch-start') as HTMLInputElement).value;
      const endDate = (form.querySelector('#ch-end') as HTMLInputElement).value;

      try {
        await ApiClient.post('/admin/challenges', {
          title,
          description,
          customMapId,
          gameMode,
          startDate,
          endDate,
        });
        this.showCreateForm = false;
        this.notifications.success(t('admin:challenges.created'));
        await this.loadData();
        this.renderContent();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });

    // Table action delegation
    createSection.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      const id = parseInt(btn.dataset.id || '0');
      if (!id) return;

      try {
        if (action === 'activate') {
          await ApiClient.post(`/admin/challenges/${id}/activate`, {});
          this.notifications.success(t('admin:challenges.activated'));
        } else if (action === 'deactivate') {
          await ApiClient.post(`/admin/challenges/${id}/deactivate`, {});
          this.notifications.success(t('admin:challenges.deactivated'));
        } else if (action === 'delete') {
          await ApiClient.delete(`/admin/challenges/${id}`);
          this.notifications.success(t('admin:challenges.deleted'));
        }
        await this.loadData();
        this.renderContent();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  private renderCreateForm(): string {
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    return `
      <form id="challenge-create-form" class="form-grid" style="margin-bottom:1rem;">
        <div class="form-group">
          <label for="ch-title">${t('admin:challenges.titleLabel')}</label>
          <input class="input" id="ch-title" required maxlength="150">
        </div>
        <div class="form-group">
          <label for="ch-desc">${t('admin:challenges.description')}</label>
          <textarea class="input" id="ch-desc" rows="2" maxlength="2000"></textarea>
        </div>
        <div class="form-group">
          <label for="ch-map">${t('admin:challenges.map')}</label>
          <select class="select" id="ch-map" required>
            ${this.publishedMaps.map((m) => `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.creatorUsername ?? 'Unknown')})</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="ch-mode">${t('admin:challenges.gameMode')}</label>
          <select class="select" id="ch-mode">
            <option value="ffa">FFA</option>
            <option value="teams">Teams</option>
            <option value="battle_royale">Battle Royale</option>
            <option value="sudden_death">Sudden Death</option>
            <option value="deathmatch">Deathmatch</option>
            <option value="king_of_the_hill">King of the Hill</option>
          </select>
        </div>
        <div class="form-group">
          <label for="ch-start">${t('admin:challenges.startDate')}</label>
          <input class="input" type="date" id="ch-start" value="${today}" required>
        </div>
        <div class="form-group">
          <label for="ch-end">${t('admin:challenges.endDate')}</label>
          <input class="input" type="date" id="ch-end" value="${nextWeek}" required>
        </div>
        <button class="btn btn-primary" type="submit">${t('admin:challenges.create')}</button>
      </form>`;
  }

  private renderChallengeTable(): string {
    if (this.challenges.length === 0) {
      return `<p style="color:var(--text-muted); text-align:center; padding:1rem;">${t('admin:challenges.none')}</p>`;
    }

    return `
      <table class="data-table" style="width:100%;">
        <thead><tr>
          <th>${t('admin:challenges.titleLabel')}</th>
          <th>${t('admin:challenges.map')}</th>
          <th>${t('admin:challenges.dates')}</th>
          <th>${t('admin:challenges.status')}</th>
          <th>${t('admin:challenges.actions')}</th>
        </tr></thead>
        <tbody>
          ${this.challenges
            .map(
              (c) => `
            <tr>
              <td>${escapeHtml(c.title)}</td>
              <td>${escapeHtml(c.mapName)}</td>
              <td>${c.startDate} — ${c.endDate}</td>
              <td>${
                c.isActive
                  ? '<span style="color:var(--success);">Active</span>'
                  : '<span style="color:var(--text-muted);">Inactive</span>'
              }</td>
              <td style="display:flex; gap:0.25rem;">
                ${
                  c.isActive
                    ? `<button class="btn btn-sm btn-ghost" data-action="deactivate" data-id="${c.id}" title="${escapeAttr(t('admin:challenges.deactivate'))}">&times;</button>`
                    : `<button class="btn btn-sm btn-primary" data-action="activate" data-id="${c.id}" title="${escapeAttr(t('admin:challenges.activate'))}">&#10003;</button>`
                }
                <button class="btn btn-sm btn-ghost" style="color:var(--danger);" data-action="delete" data-id="${c.id}" title="${escapeAttr(t('admin:challenges.deleteBtn'))}">&minus;</button>
              </td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;
  }

  destroy(): void {
    setHtml(this.container, '');
  }
}
