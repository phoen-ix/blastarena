import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { UserRole } from '@blast-arena/shared';

export class UsersTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private role: UserRole;
  private page = 1;
  private search = '';
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(notifications: NotificationUI, role: UserRole) {
    this.notifications = notifications;
    this.role = role;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    this.page = 1;
    this.search = '';
    await this.renderContent();
  }

  destroy(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.container?.remove();
    this.container = null;
  }

  private async renderContent(): Promise<void> {
    if (!this.container) return;

    const isAdmin = this.role === 'admin';
    this.container.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;">
        <div class="admin-search" style="flex:1;margin-bottom:0;">
          <input type="text" placeholder="Search by username or email..." id="admin-user-search" value="${this.escapeHtml(this.search)}">
        </div>
        ${isAdmin ? '<button class="btn btn-primary" id="admin-create-user" style="flex-shrink:0;white-space:nowrap;">Create User</button>' : ''}
      </div>
      <div id="admin-users-table">Loading...</div>
      <div id="admin-users-pagination"></div>
    `;

    const searchInput = this.container.querySelector('#admin-user-search') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      if (this.searchTimeout) clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
        this.search = searchInput.value;
        this.page = 1;
        this.loadUsers();
      }, 300);
    });

    this.container.querySelector('#admin-create-user')?.addEventListener('click', () => {
      this.showCreateUserModal();
    });

    await this.loadUsers();
  }

  private async loadUsers(): Promise<void> {
    if (!this.container) return;
    const tableEl = this.container.querySelector('#admin-users-table');
    const pagEl = this.container.querySelector('#admin-users-pagination');
    if (!tableEl || !pagEl) return;

    try {
      const params = new URLSearchParams({ page: String(this.page), limit: '20' });
      if (this.search) params.set('search', this.search);

      const result = await ApiClient.get<any>(`/admin/users?${params}`);
      const isAdmin = this.role === 'admin';

      tableEl.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Matches</th>
              <th>Wins</th>
              <th>Joined</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${result.users.map((u: any) => `
              <tr>
                <td>${this.escapeHtml(u.username)}</td>
                <td>${this.escapeHtml(u.email)}</td>
                <td><span class="badge badge-${u.role}">${u.role}</span></td>
                <td>${this.statusBadge(u)}</td>
                <td>${u.total_matches}</td>
                <td>${u.total_wins}</td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td>${u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
                <td style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
                  ${isAdmin ? `
                    <select class="admin-select" data-action="role" data-id="${u.id}">
                      <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
                      <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>moderator</option>
                      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                    </select>
                    <button class="btn-warn btn-sm" data-action="deactivate" data-id="${u.id}" data-deactivated="${u.is_deactivated}">
                      ${u.is_deactivated ? 'Reactivate' : 'Deactivate'}
                    </button>
                    <button class="btn-danger btn-sm" data-action="delete" data-id="${u.id}" data-username="${this.escapeAttr(u.username)}">Delete</button>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      // Pagination
      const totalPages = Math.ceil(result.total / result.limit);
      pagEl.innerHTML = `
        <div class="admin-pagination">
          <button ${this.page <= 1 ? 'disabled' : ''} data-page="${this.page - 1}">Prev</button>
          <span class="page-info">Page ${this.page} of ${totalPages} (${result.total} users)</span>
          <button ${this.page >= totalPages ? 'disabled' : ''} data-page="${this.page + 1}">Next</button>
        </div>
      `;

      // Event delegation
      this.container!.addEventListener('click', this.handleClick);
      this.container!.addEventListener('change', this.handleChange);

    } catch {
      tableEl.innerHTML = '<div style="color:#e94560;">Failed to load users</div>';
    }
  }

  private handleClick = async (e: Event) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action;
    const id = target.dataset.id;

    if (target.dataset.page) {
      this.page = parseInt(target.dataset.page);
      await this.loadUsers();
      return;
    }

    if (!action || !id) return;

    if (action === 'deactivate') {
      const isDeactivated = target.dataset.deactivated === '1' || target.dataset.deactivated === 'true';
      await this.doDeactivate(parseInt(id), !isDeactivated);
    } else if (action === 'delete') {
      this.showDeleteModal(parseInt(id), target.dataset.username || '');
    }
  };

  private handleChange = async (e: Event) => {
    const target = e.target as HTMLSelectElement;
    if (target.dataset.action === 'role' && target.dataset.id) {
      await this.doRoleChange(parseInt(target.dataset.id), target.value as UserRole);
    }
  };

  private showDeleteModal(userId: number, username: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h2 style="margin-bottom:12px;color:#e94560;">Delete User Permanently</h2>
        <p style="color:#a0a0b0;font-size:14px;">This will permanently delete <strong style="color:#fff;">${this.escapeHtml(username)}</strong> and all their data. This action cannot be undone.</p>
        <p style="color:#a0a0b0;font-size:13px;margin-top:8px;">Type the username to confirm:</p>
        <input type="text" class="confirm-input" id="delete-confirm-input" placeholder="${this.escapeAttr(username)}">
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="delete-cancel">Cancel</button>
          <button class="btn-danger" style="padding:8px 16px;font-size:14px;opacity:0.5;" id="delete-confirm" disabled>Delete</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    const input = modal.querySelector('#delete-confirm-input') as HTMLInputElement;
    const confirmBtn = modal.querySelector('#delete-confirm') as HTMLButtonElement;

    input.addEventListener('input', () => {
      const matches = input.value === username;
      confirmBtn.disabled = !matches;
      confirmBtn.style.opacity = matches ? '1' : '0.5';
    });

    modal.querySelector('#delete-cancel')!.addEventListener('click', () => modal.remove());
    confirmBtn.addEventListener('click', async () => {
      modal.remove();
      await this.doDelete(userId);
    });
  }

  private showCreateUserModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h2 style="margin-bottom:16px;">Create User</h2>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="color:#a0a0b0;font-size:13px;">Username *</label>
            <input type="text" class="admin-input" id="cu-username" placeholder="3-20 chars, alphanumeric, - _" style="margin-top:4px;">
          </div>
          <div>
            <label style="color:#a0a0b0;font-size:13px;">Email *</label>
            <input type="email" class="admin-input" id="cu-email" placeholder="user@example.com" style="margin-top:4px;">
          </div>
          <div>
            <label style="color:#a0a0b0;font-size:13px;">Password *</label>
            <input type="password" class="admin-input" id="cu-password" placeholder="Min 6 characters" style="margin-top:4px;">
          </div>
          <div>
            <label style="color:#a0a0b0;font-size:13px;">Role</label>
            <select class="admin-select" id="cu-role" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              <option value="user" selected>user</option>
              <option value="moderator">moderator</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </div>
        <div id="cu-error" style="color:#e94560;font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="cu-cancel">Cancel</button>
          <button class="btn btn-primary" id="cu-submit">Create</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#cu-cancel')!.addEventListener('click', () => modal.remove());
    modal.querySelector('#cu-submit')!.addEventListener('click', async () => {
      const username = (modal.querySelector('#cu-username') as HTMLInputElement).value.trim();
      const email = (modal.querySelector('#cu-email') as HTMLInputElement).value.trim();
      const password = (modal.querySelector('#cu-password') as HTMLInputElement).value;
      const role = (modal.querySelector('#cu-role') as HTMLSelectElement).value;
      const errorEl = modal.querySelector('#cu-error') as HTMLElement;

      if (!username || !email || !password) {
        errorEl.textContent = 'Username, email, and password are required';
        errorEl.style.display = 'block';
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters';
        errorEl.style.display = 'block';
        return;
      }

      try {
        await ApiClient.post('/admin/users', {
          username, email, password,
          role,
        });
        modal.remove();
        this.notifications.success(`User "${username}" created`);
        await this.loadUsers();
      } catch (err: any) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    });
  }

  private async doRoleChange(userId: number, role: UserRole): Promise<void> {
    try {
      await ApiClient.put(`/admin/users/${userId}/role`, { role });
      this.notifications.success(`Role changed to ${role}`);
      await this.loadUsers();
    } catch (err: any) {
      this.notifications.error(err.message);
    }
  }

  private async doDeactivate(userId: number, deactivated: boolean): Promise<void> {
    try {
      await ApiClient.put(`/admin/users/${userId}/deactivate`, { deactivated });
      this.notifications.success(deactivated ? 'User deactivated' : 'User reactivated');
      await this.loadUsers();
    } catch (err: any) {
      this.notifications.error(err.message);
    }
  }

  private async doDelete(userId: number): Promise<void> {
    try {
      await ApiClient.delete(`/admin/users/${userId}`);
      this.notifications.success('User deleted permanently');
      await this.loadUsers();
    } catch (err: any) {
      this.notifications.error(err.message);
    }
  }

  private statusBadge(u: any): string {
    if (u.is_deactivated) return '<span class="badge badge-deactivated">Deactivated</span>';
    return '<span class="badge badge-active">Active</span>';
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
