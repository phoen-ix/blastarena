import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { escapeHtml } from '../../utils/html';
import { t } from '../../i18n';

/** Admin action log row as returned by GET /admin/actions (snake_case DB columns). */
interface AdminActionEntry {
  id: number;
  admin_id: number;
  admin_username: string;
  action: string;
  target_type: string;
  target_id: number;
  details: string | null;
  created_at: string;
}

interface AdminActionsResponse {
  actions: AdminActionEntry[];
  total: number;
  page: number;
  limit: number;
}

export class LogsTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private page = 1;
  private actionFilter = '';

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    this.page = 1;
    this.actionFilter = '';
    await this.loadActions();
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
  }

  private async loadActions(): Promise<void> {
    if (!this.container) return;

    try {
      const params = new URLSearchParams({ page: String(this.page), limit: '20' });
      if (this.actionFilter) params.set('action', this.actionFilter);

      const result = await ApiClient.get<AdminActionsResponse>(`/admin/actions?${params}`);
      const totalPages = Math.ceil(result.total / result.limit);

      this.container.innerHTML = `
        <div class="admin-filters">
          <label style="color:var(--text-dim);font-size:13px;">${t('admin:logs.filterByAction')}</label>
          <select id="action-filter" aria-label="${t('admin:logs.filterByAction')}">
            <option value="">${t('admin:logs.filterAll')}</option>
            <option value="role_change" ${this.actionFilter === 'role_change' ? 'selected' : ''}>${t('admin:logs.filterRoleChange')}</option>
            <option value="deactivate" ${this.actionFilter === 'deactivate' ? 'selected' : ''}>${t('admin:logs.filterDeactivate')}</option>
            <option value="reactivate" ${this.actionFilter === 'reactivate' ? 'selected' : ''}>${t('admin:logs.filterReactivate')}</option>
            <option value="delete" ${this.actionFilter === 'delete' ? 'selected' : ''}>${t('admin:logs.filterDelete')}</option>
            <option value="toast" ${this.actionFilter === 'toast' ? 'selected' : ''}>${t('admin:logs.filterToast')}</option>
            <option value="set_banner" ${this.actionFilter === 'set_banner' ? 'selected' : ''}>${t('admin:logs.filterSetBanner')}</option>
            <option value="clear_banner" ${this.actionFilter === 'clear_banner' ? 'selected' : ''}>${t('admin:logs.filterClearBanner')}</option>
          </select>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>${t('admin:logs.columnDate')}</th>
              <th>${t('admin:logs.columnAdmin')}</th>
              <th>${t('admin:logs.columnAction')}</th>
              <th>${t('admin:logs.columnTargetType')}</th>
              <th>${t('admin:logs.columnTargetId')}</th>
              <th>${t('admin:logs.columnDetails')}</th>
            </tr>
          </thead>
          <tbody>
            ${result.actions
              .map(
                (a: AdminActionEntry, i: number) => `
              <tr class="log-row" data-log-index="${i}" style="cursor:pointer;">
                <td>${new Date(a.created_at).toLocaleString()}</td>
                <td>${escapeHtml(a.admin_username)}</td>
                <td><span class="badge badge-${this.actionBadgeClass(a.action)}">${escapeHtml(a.action)}</span></td>
                <td>${escapeHtml(a.target_type)}</td>
                <td>${a.target_id}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(a.details || '-')}</td>
              </tr>
              <tr class="log-detail-row" data-detail-index="${i}" style="display:none;">
                <td colspan="6" style="padding:12px 16px;background:var(--bg-card);white-space:pre-wrap;word-break:break-word;font-size:13px;color:var(--text-dim);border-top:none;">${escapeHtml(a.details || t('admin:logs.noDetails'))}</td>
              </tr>
            `,
              )
              .join('')}
            ${result.actions.length === 0 ? `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);">${t('admin:logs.noActionsFound')}</td></tr>` : ''}
          </tbody>
        </table>
        <div class="admin-pagination">
          <button ${this.page <= 1 ? 'disabled' : ''} data-page="${this.page - 1}">${t('admin:logs.prevPage')}</button>
          <span class="page-info">${t('admin:logs.pageInfo', { page: this.page, totalPages, total: result.total })}</span>
          <button ${this.page >= totalPages ? 'disabled' : ''} data-page="${this.page + 1}">${t('admin:logs.nextPage')}</button>
        </div>
      `;

      const filterSelect = this.container.querySelector('#action-filter') as HTMLSelectElement;
      filterSelect.addEventListener('change', () => {
        this.actionFilter = filterSelect.value;
        this.page = 1;
        this.loadActions();
      });

      this.container.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.dataset.page) {
          this.page = parseInt(target.dataset.page);
          this.loadActions();
          return;
        }
        const logRow = target.closest('.log-row') as HTMLElement | null;
        if (logRow) {
          const index = logRow.dataset.logIndex;
          const detailRow = this.container!.querySelector(
            `[data-detail-index="${index}"]`,
          ) as HTMLElement | null;
          if (detailRow) {
            const isVisible = detailRow.style.display !== 'none';
            detailRow.style.display = isVisible ? 'none' : 'table-row';
          }
        }
      });
    } catch {
      this.container.innerHTML = `<div style="color:var(--danger);">${t('admin:logs.failedToLoad')}</div>`;
    }
  }

  private actionBadgeClass(action: string): string {
    if (action === 'delete') return 'banned';
    if (action === 'role_change') return 'moderator';
    if (action === 'deactivate') return 'deactivated';
    return 'user';
  }
}
