import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { UserRole, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml, escapeAttr } from '../../utils/html';
import { t } from '../../i18n';

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
          <input type="text" placeholder="${escapeAttr(t('admin:users.searchPlaceholder'))}" id="admin-user-search" value="${escapeHtml(this.search)}">
        </div>
        ${isAdmin ? `<button class="btn btn-primary" id="admin-create-user" style="flex-shrink:0;white-space:nowrap;">${t('admin:users.createUser')}</button>` : ''}
        ${isAdmin ? `<button class="btn btn-secondary" id="admin-cleanup" style="flex-shrink:0;white-space:nowrap;">${t('admin:users.cleanup.button')}</button>` : ''}
      </div>
      <div id="admin-users-table">${t('admin:users.loading')}</div>
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
    this.container.querySelector('#admin-cleanup')?.addEventListener('click', () => {
      this.showCleanupModal();
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
              <th>${t('admin:users.tableHeaders.username')}</th>
              <th>${t('admin:users.tableHeaders.email')}</th>
              <th>${t('admin:users.tableHeaders.role')}</th>
              <th>${t('admin:users.tableHeaders.status')}</th>
              <th>${t('admin:users.tableHeaders.matches')}</th>
              <th>${t('admin:users.tableHeaders.wins')}</th>
              <th>${t('admin:users.tableHeaders.joined')}</th>
              <th>${t('admin:users.tableHeaders.lastLogin')}</th>
              <th>${t('admin:users.tableHeaders.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${result.users
              .map(
                (u: any) => `
              <tr>
                <td>${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.email_hint)}</td>
                <td><span class="badge badge-${u.role}">${u.role}</span></td>
                <td>${this.statusBadge(u)}</td>
                <td>${u.total_matches}</td>
                <td>${u.total_wins}</td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td>${u.last_login ? new Date(u.last_login).toLocaleDateString() : t('admin:users.lastLoginNever')}</td>
                <td style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
                  ${
                    isAdmin
                      ? `
                    <select class="admin-select" data-action="role" data-id="${u.id}">
                      <option value="user" ${u.role === 'user' ? 'selected' : ''}>${t('admin:users.roles.user')}</option>
                      <option value="moderator" ${u.role === 'moderator' ? 'selected' : ''}>${t('admin:users.roles.moderator')}</option>
                      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>${t('admin:users.roles.admin')}</option>
                    </select>
                    <button class="btn-warn btn-sm" data-action="deactivate" data-id="${u.id}" data-deactivated="${u.is_deactivated}">
                      ${u.is_deactivated ? t('admin:users.reactivate') : t('admin:users.deactivate')}
                    </button>
                    <button class="btn-sm" style="background:var(--accent);color:var(--bg-deep);" data-action="resetpw" data-id="${u.id}" data-username="${escapeAttr(u.username)}">${t('admin:users.resetPw')}</button>
                    <button class="btn-sm" style="background:var(--warning);color:var(--bg-deep);" data-action="revoke-sessions" data-id="${u.id}">${t('admin:users.revokeSessions')}</button>
                    <button class="btn-danger btn-sm" data-action="delete" data-id="${u.id}" data-username="${escapeAttr(u.username)}">${t('admin:users.delete')}</button>
                  `
                      : ''
                  }
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      `;

      // Pagination
      const totalPages = Math.ceil(result.total / result.limit);
      pagEl.innerHTML = `
        <div class="admin-pagination">
          <button ${this.page <= 1 ? 'disabled' : ''} data-page="${this.page - 1}">${t('admin:users.pagination.prev')}</button>
          <span class="page-info">${t('admin:users.pagination.pageInfo', { page: this.page, totalPages, total: result.total })}</span>
          <button ${this.page >= totalPages ? 'disabled' : ''} data-page="${this.page + 1}">${t('admin:users.pagination.next')}</button>
        </div>
      `;

      // Event delegation
      this.container!.addEventListener('click', this.handleClick);
      this.container!.addEventListener('change', this.handleChange);
    } catch {
      tableEl.innerHTML = `<div style="color:var(--danger);">${t('admin:users.loadError')}</div>`;
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
      const isDeactivated =
        target.dataset.deactivated === '1' || target.dataset.deactivated === 'true';
      await this.doDeactivate(parseInt(id), !isDeactivated);
    } else if (action === 'resetpw') {
      this.showResetPasswordModal(parseInt(id), target.dataset.username || '');
    } else if (action === 'revoke-sessions') {
      await this.doRevokeSessions(parseInt(id));
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
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:users.deleteModal.ariaLabel'));
    modal.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h2 style="margin-bottom:12px;color:var(--danger);">${t('admin:users.deleteModal.title')}</h2>
        <p style="color:var(--text-dim);font-size:14px;">${t('admin:users.deleteModal.description', { username: escapeHtml(username) })}</p>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="delete-cancel">${t('admin:users.deleteModal.cancel')}</button>
          <button class="btn-danger" style="padding:8px 16px;font-size:14px;" id="delete-confirm">${t('admin:users.deleteModal.confirm')}</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#delete-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    modal.querySelector('#delete-confirm')!.addEventListener('click', async () => {
      modal.remove();
      await this.doDelete(userId);
    });
  }

  private showCreateUserModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:users.createModal.ariaLabel'));
    modal.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h2 style="margin-bottom:16px;">${t('admin:users.createModal.title')}</h2>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.createModal.usernameLabel')}</label>
            <input type="text" class="admin-input" id="cu-username" placeholder="${escapeAttr(t('admin:users.createModal.usernamePlaceholder'))}" style="margin-top:4px;">
          </div>
          <div>
            <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.createModal.emailLabel')}</label>
            <input type="email" class="admin-input" id="cu-email" placeholder="${escapeAttr(t('admin:users.createModal.emailPlaceholder'))}" style="margin-top:4px;">
          </div>
          <div>
            <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.createModal.passwordLabel')}</label>
            <input type="password" class="admin-input" id="cu-password" placeholder="${escapeAttr(t('admin:users.createModal.passwordPlaceholder'))}" style="margin-top:4px;">
          </div>
          <div>
            <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.createModal.roleLabel')}</label>
            <select class="admin-select" id="cu-role" style="margin-top:4px;width:100%;padding:8px 12px;font-size:14px;">
              <option value="user" selected>${t('admin:users.roles.user')}</option>
              <option value="moderator">${t('admin:users.roles.moderator')}</option>
              <option value="admin">${t('admin:users.roles.admin')}</option>
            </select>
          </div>
        </div>
        <div id="cu-error" style="color:var(--danger);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="cu-cancel">${t('admin:users.createModal.cancel')}</button>
          <button class="btn btn-primary" id="cu-submit">${t('admin:users.createModal.submit')}</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#cu-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    modal.querySelector('#cu-submit')!.addEventListener('click', async () => {
      const username = (modal.querySelector('#cu-username') as HTMLInputElement).value.trim();
      const email = (modal.querySelector('#cu-email') as HTMLInputElement).value.trim();
      const password = (modal.querySelector('#cu-password') as HTMLInputElement).value;
      const role = (modal.querySelector('#cu-role') as HTMLSelectElement).value;
      const errorEl = modal.querySelector('#cu-error') as HTMLElement;

      if (!username || !email || !password) {
        errorEl.textContent = t('admin:users.createModal.errorRequired');
        errorEl.style.display = 'block';
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = t('admin:users.createModal.errorPasswordLength');
        errorEl.style.display = 'block';
        return;
      }

      try {
        await ApiClient.post('/admin/users', {
          username,
          email,
          password,
          role,
        });
        modal.remove();
        this.notifications.success(t('admin:users.createModal.successMessage', { username }));
        await this.loadUsers();
      } catch (err: unknown) {
        errorEl.textContent = getErrorMessage(err);
        errorEl.style.display = 'block';
      }
    });
  }

  private showResetPasswordModal(userId: number, username: string): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:users.resetPasswordModal.ariaLabel'));
    modal.innerHTML = `
      <div class="modal" style="max-width:420px;">
        <h2 style="margin-bottom:12px;">${t('admin:users.resetPasswordModal.title')}</h2>
        <p style="color:var(--text-dim);font-size:14px;">${t('admin:users.resetPasswordModal.description', { username: escapeHtml(username) })}</p>
        <div style="margin-top:12px;">
          <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.resetPasswordModal.newPasswordLabel')}</label>
          <input type="password" class="admin-input" id="rp-password" placeholder="${escapeAttr(t('admin:users.resetPasswordModal.newPasswordPlaceholder'))}" style="margin-top:4px;">
        </div>
        <div style="margin-top:8px;">
          <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.resetPasswordModal.confirmPasswordLabel')}</label>
          <input type="password" class="admin-input" id="rp-confirm" placeholder="${escapeAttr(t('admin:users.resetPasswordModal.confirmPasswordPlaceholder'))}" style="margin-top:4px;">
        </div>
        <div id="rp-error" style="color:var(--danger);font-size:13px;margin-top:8px;display:none;"></div>
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="rp-cancel">${t('admin:users.resetPasswordModal.cancel')}</button>
          <button class="btn btn-primary" id="rp-submit">${t('admin:users.resetPasswordModal.submit')}</button>
        </div>
      </div>
    `;
    document.getElementById('ui-overlay')!.appendChild(modal);

    modal.querySelector('#rp-cancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    modal.querySelector('#rp-submit')!.addEventListener('click', async () => {
      const password = (modal.querySelector('#rp-password') as HTMLInputElement).value;
      const confirm = (modal.querySelector('#rp-confirm') as HTMLInputElement).value;
      const errorEl = modal.querySelector('#rp-error') as HTMLElement;

      if (!password) {
        errorEl.textContent = t('admin:users.resetPasswordModal.errorRequired');
        errorEl.style.display = 'block';
        return;
      }
      if (password.length < 6) {
        errorEl.textContent = t('admin:users.resetPasswordModal.errorPasswordLength');
        errorEl.style.display = 'block';
        return;
      }
      if (password !== confirm) {
        errorEl.textContent = t('admin:users.resetPasswordModal.errorPasswordMismatch');
        errorEl.style.display = 'block';
        return;
      }

      try {
        await ApiClient.put(`/admin/users/${userId}/password`, { password });
        modal.remove();
        this.notifications.success(
          t('admin:users.resetPasswordModal.successMessage', { username }),
        );
      } catch (err: unknown) {
        errorEl.textContent = getErrorMessage(err);
        errorEl.style.display = 'block';
      }
    });
  }

  private showCleanupModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', t('admin:users.cleanup.title'));

    let selectedType: 'unverified' | 'inactive' | 'deactivated' = 'unverified';
    let previewCount: number | null = null;

    const renderModal = () => {
      const needsDays = selectedType !== 'deactivated';
      modal.innerHTML = `
        <div class="modal" style="max-width:480px;">
          <h2 style="margin-bottom:8px;">${t('admin:users.cleanup.title')}</h2>
          <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px;">${t('admin:users.cleanup.description')}</p>
          <div style="margin-bottom:12px;">
            <label style="color:var(--text-dim);font-size:13px;display:block;margin-bottom:6px;">${t('admin:users.cleanup.typeLabel')}</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <button class="option-chip ${selectedType === 'unverified' ? 'active' : ''}" data-cleanup-type="unverified" title="${escapeAttr(t('admin:users.cleanup.typeUnverifiedDesc'))}">${t('admin:users.cleanup.typeUnverified')}</button>
              <button class="option-chip ${selectedType === 'inactive' ? 'active' : ''}" data-cleanup-type="inactive" title="${escapeAttr(t('admin:users.cleanup.typeInactiveDesc'))}">${t('admin:users.cleanup.typeInactive')}</button>
              <button class="option-chip ${selectedType === 'deactivated' ? 'active' : ''}" data-cleanup-type="deactivated" title="${escapeAttr(t('admin:users.cleanup.typeDeactivatedDesc'))}">${t('admin:users.cleanup.typeDeactivated')}</button>
            </div>
          </div>
          <div style="margin-bottom:12px;${needsDays ? '' : 'display:none;'}">
            <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.cleanup.daysLabel')}</label>
            <input type="number" class="admin-input" id="cleanup-days" min="1" placeholder="${escapeAttr(t('admin:users.cleanup.daysPlaceholder'))}" style="margin-top:4px;width:120px;">
          </div>
          <div style="margin-bottom:12px;">
            <button class="btn btn-secondary btn-sm" id="cleanup-preview">${t('admin:users.cleanup.previewButton')}</button>
            <span id="cleanup-preview-result" style="margin-left:8px;font-size:13px;color:var(--text-dim);">${
              previewCount !== null
                ? previewCount > 0
                  ? t('admin:users.cleanup.previewResult', { count: previewCount })
                  : t('admin:users.cleanup.previewNone')
                : ''
            }</span>
          </div>
          ${
            previewCount && previewCount > 0
              ? `
            <div style="margin-bottom:12px;">
              <label style="color:var(--text-dim);font-size:13px;">${t('admin:users.cleanup.confirmPrompt')}</label>
              <input type="text" class="admin-input" id="cleanup-confirm-input" placeholder="${escapeAttr(t('admin:users.cleanup.confirmPlaceholder'))}" aria-label="${escapeAttr(t('admin:users.cleanup.confirmAriaLabel'))}" style="margin-top:4px;width:160px;">
            </div>
          `
              : ''
          }
          <div id="cleanup-error" style="color:var(--danger);font-size:13px;margin-bottom:8px;display:none;"></div>
          <div class="modal-actions" style="margin-top:16px;">
            <button class="btn btn-secondary" id="cleanup-cancel">${t('admin:users.cleanup.cancel')}</button>
            ${
              previewCount && previewCount > 0
                ? `<button class="btn-danger" style="padding:8px 16px;font-size:14px;opacity:0.5;" id="cleanup-execute" disabled>${t('admin:users.cleanup.deleteButton', { count: previewCount })}</button>`
                : ''
            }
          </div>
        </div>
      `;

      // Type chip selection
      modal.querySelectorAll('[data-cleanup-type]').forEach((chip) => {
        chip.addEventListener('click', () => {
          selectedType = (chip as HTMLElement).dataset.cleanupType as typeof selectedType;
          previewCount = null;
          renderModal();
        });
      });

      // Preview
      modal.querySelector('#cleanup-preview')?.addEventListener('click', async () => {
        const errorEl = modal.querySelector('#cleanup-error') as HTMLElement;
        const needsDaysNow = selectedType !== 'deactivated';
        const daysInput = modal.querySelector('#cleanup-days') as HTMLInputElement | null;
        const days = daysInput ? parseInt(daysInput.value) : undefined;

        if (needsDaysNow && (!days || days < 1)) {
          errorEl.textContent = t('admin:users.cleanup.errorDaysRequired');
          errorEl.style.display = 'block';
          return;
        }
        errorEl.style.display = 'none';

        try {
          const body: any = { type: selectedType };
          if (needsDaysNow) body.days = days;
          const result = await ApiClient.post<{ count: number }>(
            '/admin/users/cleanup/preview',
            body,
          );
          previewCount = result.count;
          renderModal();
          // Restore days value after re-render
          const newDaysInput = modal.querySelector('#cleanup-days') as HTMLInputElement | null;
          if (newDaysInput && days) newDaysInput.value = String(days);
        } catch (err: unknown) {
          errorEl.textContent = getErrorMessage(err);
          errorEl.style.display = 'block';
        }
      });

      // Confirm input enables execute button
      const confirmInput = modal.querySelector('#cleanup-confirm-input') as HTMLInputElement | null;
      const executeBtn = modal.querySelector('#cleanup-execute') as HTMLButtonElement | null;
      if (confirmInput && executeBtn) {
        confirmInput.addEventListener('input', () => {
          const matches = confirmInput.value === 'DELETE';
          executeBtn.disabled = !matches;
          executeBtn.style.opacity = matches ? '1' : '0.5';
        });

        executeBtn.addEventListener('click', async () => {
          const errorEl = modal.querySelector('#cleanup-error') as HTMLElement;
          const daysInput = modal.querySelector('#cleanup-days') as HTMLInputElement | null;
          const days = daysInput ? parseInt(daysInput.value) : undefined;

          try {
            const body: any = { type: selectedType };
            if (selectedType !== 'deactivated') body.days = days;
            const result = await ApiClient.post<{ deleted: number }>(
              '/admin/users/cleanup/execute',
              body,
            );
            modal.remove();
            this.notifications.success(
              t('admin:users.cleanup.success', { deleted: result.deleted }),
            );
            await this.loadUsers();
          } catch (err: unknown) {
            errorEl.textContent = getErrorMessage(err);
            errorEl.style.display = 'block';
          }
        });
      }

      // Close handlers
      modal.querySelector('#cleanup-cancel')?.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });
    };

    renderModal();
    document.getElementById('ui-overlay')!.appendChild(modal);
  }

  private async doRoleChange(userId: number, role: UserRole): Promise<void> {
    try {
      await ApiClient.put(`/admin/users/${userId}/role`, { role });
      this.notifications.success(t('admin:users.roleChangeSuccess', { role }));
      await this.loadUsers();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private async doDeactivate(userId: number, deactivated: boolean): Promise<void> {
    try {
      await ApiClient.put(`/admin/users/${userId}/deactivate`, { deactivated });
      this.notifications.success(
        deactivated ? t('admin:users.deactivateSuccess') : t('admin:users.reactivateSuccess'),
      );
      await this.loadUsers();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private async doRevokeSessions(userId: number): Promise<void> {
    try {
      await ApiClient.post(`/admin/users/${userId}/revoke-sessions`, {});
      this.notifications.success(t('admin:users.revokeSessionsSuccess'));
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private async doDelete(userId: number): Promise<void> {
    try {
      await ApiClient.delete(`/admin/users/${userId}`);
      this.notifications.success(t('admin:users.deleteSuccess'));
      await this.loadUsers();
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
  }

  private statusBadge(u: any): string {
    if (u.is_deactivated)
      return `<span class="badge badge-deactivated">${t('admin:users.statusDeactivated')}</span>`;
    return `<span class="badge badge-active">${t('admin:users.statusActive')}</span>`;
  }
}
