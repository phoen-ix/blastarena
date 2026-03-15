import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';

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

      const result = await ApiClient.get<any>(`/admin/actions?${params}`);
      const totalPages = Math.ceil(result.total / result.limit);

      this.container.innerHTML = `
        <div class="admin-filters">
          <label style="color:#a0a0b0;font-size:13px;">Filter by action:</label>
          <select id="action-filter">
            <option value="">All</option>
            <option value="role_change" ${this.actionFilter === 'role_change' ? 'selected' : ''}>Role Change</option>
            <option value="deactivate" ${this.actionFilter === 'deactivate' ? 'selected' : ''}>Deactivate</option>
            <option value="reactivate" ${this.actionFilter === 'reactivate' ? 'selected' : ''}>Reactivate</option>
            <option value="delete" ${this.actionFilter === 'delete' ? 'selected' : ''}>Delete</option>
            <option value="toast" ${this.actionFilter === 'toast' ? 'selected' : ''}>Toast</option>
            <option value="set_banner" ${this.actionFilter === 'set_banner' ? 'selected' : ''}>Set Banner</option>
            <option value="clear_banner" ${this.actionFilter === 'clear_banner' ? 'selected' : ''}>Clear Banner</option>
          </select>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Target Type</th>
              <th>Target ID</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            ${result.actions.map((a: any) => `
              <tr>
                <td>${new Date(a.created_at).toLocaleString()}</td>
                <td>${this.escapeHtml(a.admin_username)}</td>
                <td><span class="badge badge-${this.actionBadgeClass(a.action)}">${this.escapeHtml(a.action)}</span></td>
                <td>${this.escapeHtml(a.target_type)}</td>
                <td>${a.target_id}</td>
                <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.escapeAttr(a.details || '')}">${this.escapeHtml(a.details || '-')}</td>
              </tr>
            `).join('')}
            ${result.actions.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:#a0a0b0;">No actions found</td></tr>' : ''}
          </tbody>
        </table>
        <div class="admin-pagination">
          <button ${this.page <= 1 ? 'disabled' : ''} data-page="${this.page - 1}">Prev</button>
          <span class="page-info">Page ${this.page} of ${totalPages} (${result.total} actions)</span>
          <button ${this.page >= totalPages ? 'disabled' : ''} data-page="${this.page + 1}">Next</button>
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
        }
      });
    } catch {
      this.container.innerHTML = '<div style="color:#e94560;">Failed to load admin actions</div>';
    }
  }

  private actionBadgeClass(action: string): string {
    if (action === 'delete') return 'banned';
    if (action === 'role_change') return 'moderator';
    if (action === 'deactivate') return 'deactivated';
    return 'user';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeAttr(text: string): string {
    return text.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
