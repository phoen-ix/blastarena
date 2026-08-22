import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { BotAIEntry, EnemyAIEntry, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml, setHtml } from '../../utils/html';
import { API_URL } from '../../config';
import { t } from '../../i18n';

export class AITab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    await this.loadList();
  }

  destroy(): void {
    this.container?.remove();
    this.container = null;
  }

  private async loadList(): Promise<void> {
    if (!this.container) return;

    let botAIs: BotAIEntry[] = [];
    let enemyAIs: EnemyAIEntry[] = [];
    try {
      const botRes = await ApiClient.get<{ ais: BotAIEntry[] }>('/admin/ai');
      botAIs = botRes.ais;
    } catch (err: unknown) {
      this.notifications.error(getErrorMessage(err));
    }
    try {
      const enemyRes = await ApiClient.get<{ ais: EnemyAIEntry[] }>('/admin/enemy-ai');
      enemyAIs = enemyRes.ais;
    } catch {
      /* enemy AI endpoint may not exist yet */
    }

    setHtml(
      this.container,
      `
      <div class="admin-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">${t('admin:ai.botManagement')}</h3>
          <button class="btn btn-primary" id="bot-ai-upload-btn">${t('admin:ai.uploadNew')}</button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>${t('admin:ai.tableHeaders.name')}</th>
              <th>${t('admin:ai.tableHeaders.description')}</th>
              <th>${t('admin:ai.tableHeaders.status')}</th>
              <th>${t('admin:ai.tableHeaders.version')}</th>
              <th>${t('admin:ai.tableHeaders.uploadedBy')}</th>
              <th>${t('admin:ai.tableHeaders.file')}</th>
              <th>${t('admin:ai.tableHeaders.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${botAIs.map((ai) => this.renderBotRow(ai)).join('')}
          </tbody>
        </table>
      </div>

      <div class="admin-section" style="margin-top:32px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">${t('admin:ai.enemyManagement')}</h3>
          <button class="btn btn-primary" id="enemy-ai-upload-btn">${t('admin:ai.uploadNewEnemy')}</button>
        </div>
        <p style="color:var(--text-dim);font-size:13px;margin:0 0 12px;">${t('admin:ai.enemyDescription')}</p>
        <table class="admin-table">
          <thead>
            <tr>
              <th>${t('admin:ai.tableHeaders.name')}</th>
              <th>${t('admin:ai.tableHeaders.description')}</th>
              <th>${t('admin:ai.tableHeaders.status')}</th>
              <th>${t('admin:ai.tableHeaders.version')}</th>
              <th>${t('admin:ai.tableHeaders.uploadedBy')}</th>
              <th>${t('admin:ai.tableHeaders.file')}</th>
              <th>${t('admin:ai.tableHeaders.actions')}</th>
            </tr>
          </thead>
          <tbody>
            ${enemyAIs.length === 0 ? `<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:16px;">${t('admin:ai.noEnemyAIs')}</td></tr>` : enemyAIs.map((ai) => this.renderEnemyRow(ai)).join('')}
          </tbody>
        </table>
      </div>
    `,
    );

    this.container.querySelector('#bot-ai-upload-btn')?.addEventListener('click', () => {
      this.showUploadModal('bot');
    });
    this.container.querySelector('#enemy-ai-upload-btn')?.addEventListener('click', () => {
      this.showUploadModal('enemy');
    });

    this.attachBotRowHandlers(botAIs);
    this.attachEnemyRowHandlers(enemyAIs);
  }

  // --- Bot AI rows ---

  private renderBotRow(ai: BotAIEntry): string {
    const statusBadge = ai.isActive
      ? `<span style="color:var(--success);font-weight:600;">${t('admin:ai.status.active')}</span>`
      : `<span style="color:var(--text-dim);">${t('admin:ai.status.inactive')}</span>`;
    const builtinBadge = ai.isBuiltin
      ? ` <span style="background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:11px;color:var(--text-dim);">${t('admin:ai.builtIn')}</span>`
      : '';
    const uploadedBy = ai.uploadedBy ? escapeHtml(ai.uploadedBy) : '—';
    const fileSize = ai.fileSize > 0 ? `${(ai.fileSize / 1024).toFixed(1)}KB` : '—';

    return `
      <tr data-bot-ai-id="${escapeHtml(ai.id)}">
        <td>${escapeHtml(ai.name)}${builtinBadge}</td>
        <td style="color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ai.description || '—')}</td>
        <td>${statusBadge}</td>
        <td>v${ai.version}</td>
        <td>${uploadedBy}</td>
        <td>${escapeHtml(ai.filename)} (${fileSize})</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-sm btn-secondary bot-ai-toggle" data-id="${escapeHtml(ai.id)}" data-active="${ai.isActive}">${ai.isActive ? t('admin:ai.deactivate') : t('admin:ai.activate')}</button>
            <button class="btn-sm btn-secondary bot-ai-download" data-id="${escapeHtml(ai.id)}">${t('admin:ai.download')}</button>
            ${!ai.isBuiltin ? `<button class="btn-sm btn-secondary bot-ai-reupload" data-id="${escapeHtml(ai.id)}">${t('admin:ai.reupload')}</button>` : ''}
            ${!ai.isBuiltin ? `<button class="btn-sm btn-secondary bot-ai-edit" data-id="${escapeHtml(ai.id)}">${t('admin:ai.edit')}</button>` : ''}
            ${!ai.isBuiltin ? `<button class="btn-sm btn-danger bot-ai-delete" data-id="${escapeHtml(ai.id)}" data-name="${escapeHtml(ai.name)}">${t('admin:ai.delete')}</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }

  private attachBotRowHandlers(ais: BotAIEntry[]): void {
    if (!this.container) return;

    this.container.querySelectorAll('.bot-ai-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const isActive = (btn as HTMLElement).dataset.active === 'true';
        try {
          await ApiClient.put(`/admin/ai/${id}`, { isActive: !isActive });
          this.notifications.success(
            isActive ? t('admin:ai.aiDeactivated') : t('admin:ai.aiActivated'),
          );
          await this.loadList();
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    });

    this.container.querySelectorAll('.bot-ai-download').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        try {
          const response = await fetch(`${API_URL}/admin/ai/${id}/download`, {
            credentials: 'include',
          });
          if (!response.ok) throw new Error(t('admin:ai.downloadFailed'));
          const blob = await response.blob();
          const disposition = response.headers.get('Content-Disposition');
          const filenameMatch = disposition?.match(/filename="(.+)"/);
          const filename = filenameMatch ? filenameMatch[1] : 'BotAI.ts';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    });

    this.container.querySelectorAll('.bot-ai-reupload').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.showReuploadModal('bot', id);
      });
    });

    this.container.querySelectorAll('.bot-ai-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const ai = ais.find((a) => a.id === id);
        if (ai) this.showEditModal('bot', ai);
      });
    });

    this.container.querySelectorAll('.bot-ai-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const name = (btn as HTMLElement).dataset.name!;
        this.showDeleteConfirmation('bot', id, name);
      });
    });
  }

  // --- Enemy AI rows ---

  private renderEnemyRow(ai: EnemyAIEntry): string {
    const statusBadge = ai.isActive
      ? `<span style="color:var(--success);font-weight:600;">${t('admin:ai.status.active')}</span>`
      : `<span style="color:var(--text-dim);">${t('admin:ai.status.inactive')}</span>`;
    const uploadedBy = ai.uploadedBy ? escapeHtml(ai.uploadedBy) : '—';
    const fileSize = ai.fileSize > 0 ? `${(ai.fileSize / 1024).toFixed(1)}KB` : '—';

    return `
      <tr data-enemy-ai-id="${escapeHtml(ai.id)}">
        <td>${escapeHtml(ai.name)}</td>
        <td style="color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(ai.description || '—')}</td>
        <td>${statusBadge}</td>
        <td>v${ai.version}</td>
        <td>${uploadedBy}</td>
        <td>${escapeHtml(ai.filename)} (${fileSize})</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-sm btn-secondary enemy-ai-toggle" data-id="${escapeHtml(ai.id)}" data-active="${ai.isActive}">${ai.isActive ? t('admin:ai.deactivate') : t('admin:ai.activate')}</button>
            <button class="btn-sm btn-secondary enemy-ai-download" data-id="${escapeHtml(ai.id)}">${t('admin:ai.download')}</button>
            <button class="btn-sm btn-secondary enemy-ai-reupload" data-id="${escapeHtml(ai.id)}">${t('admin:ai.reupload')}</button>
            <button class="btn-sm btn-secondary enemy-ai-edit" data-id="${escapeHtml(ai.id)}">${t('admin:ai.edit')}</button>
            <button class="btn-sm btn-danger enemy-ai-delete" data-id="${escapeHtml(ai.id)}" data-name="${escapeHtml(ai.name)}">${t('admin:ai.delete')}</button>
          </div>
        </td>
      </tr>
    `;
  }

  private attachEnemyRowHandlers(ais: EnemyAIEntry[]): void {
    if (!this.container) return;

    this.container.querySelectorAll('.enemy-ai-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const isActive = (btn as HTMLElement).dataset.active === 'true';
        try {
          await ApiClient.put(`/admin/enemy-ai/${id}`, { isActive: !isActive });
          this.notifications.success(
            isActive ? t('admin:ai.enemyAiDeactivated') : t('admin:ai.enemyAiActivated'),
          );
          await this.loadList();
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    });

    this.container.querySelectorAll('.enemy-ai-download').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        try {
          const response = await fetch(`${API_URL}/admin/enemy-ai/${id}/download`, {
            credentials: 'include',
          });
          if (!response.ok) throw new Error(t('admin:ai.downloadFailed'));
          const blob = await response.blob();
          const disposition = response.headers.get('Content-Disposition');
          const filenameMatch = disposition?.match(/filename="(.+)"/);
          const filename = filenameMatch ? filenameMatch[1] : 'EnemyAI.ts';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    });

    this.container.querySelectorAll('.enemy-ai-reupload').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        this.showReuploadModal('enemy', id);
      });
    });

    this.container.querySelectorAll('.enemy-ai-edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn as HTMLElement).dataset.id!;
        const ai = ais.find((a) => a.id === id);
        if (ai) this.showEditModal('enemy', ai);
      });
    });

    this.container.querySelectorAll('.enemy-ai-delete').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = (btn as HTMLElement).dataset.id!;
        const name = (btn as HTMLElement).dataset.name!;
        this.showDeleteConfirmation('enemy', id, name);
      });
    });
  }

  // --- Shared modals ---

  private showUploadModal(type: 'bot' | 'enemy'): void {
    const isEnemy = type === 'enemy';
    const title = isEnemy ? t('admin:ai.uploadEnemyTitle') : t('admin:ai.uploadTitle');
    const endpoint = isEnemy ? '/admin/enemy-ai' : '/admin/ai';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    setHtml(
      overlay,
      `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:500px;max-width:90vw;">
        <h3 style="margin:0 0 16px;color:var(--primary);">${title}</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">${t('admin:ai.nameLabel')}</label>
            <input type="text" id="ai-upload-name" class="admin-input" placeholder="${t('admin:ai.namePlaceholder')}" maxlength="100" style="width:100%;box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">${t('admin:ai.descriptionLabel')}</label>
            <textarea id="ai-upload-desc" class="admin-input" placeholder="${t('admin:ai.descriptionPlaceholder')}" maxlength="500" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;"></textarea>
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">${t('admin:ai.fileLabel')}</label>
            <input type="file" id="ai-upload-file" accept=".ts" style="color:var(--text);">
          </div>
          ${isEnemy ? `<p style="color:var(--text-dim);font-size:12px;margin:0;">${t('admin:ai.enemyClassHint')}</p>` : ''}
          <div id="ai-upload-errors" style="display:none;background:var(--bg-deep);border:1px solid var(--danger);border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;"></div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">
            <button class="btn btn-secondary" id="ai-upload-cancel">${t('admin:ai.cancel')}</button>
            <button class="btn btn-primary" id="ai-upload-submit">${t('admin:ai.uploadAndCompile')}</button>
          </div>
        </div>
      </div>
    `,
    );

    document.body.appendChild(overlay);

    overlay.querySelector('#ai-upload-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#ai-upload-submit')?.addEventListener('click', async () => {
      const nameInput = overlay.querySelector('#ai-upload-name') as HTMLInputElement;
      const descInput = overlay.querySelector('#ai-upload-desc') as HTMLTextAreaElement;
      const fileInput = overlay.querySelector('#ai-upload-file') as HTMLInputElement;
      const errorsDiv = overlay.querySelector('#ai-upload-errors') as HTMLElement;
      const submitBtn = overlay.querySelector('#ai-upload-submit') as HTMLButtonElement;

      const name = nameInput.value.trim();
      if (!name) {
        this.notifications.error(t('admin:ai.nameRequired'));
        return;
      }
      if (!fileInput.files || fileInput.files.length === 0) {
        this.notifications.error(t('admin:ai.selectFileError'));
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('admin:ai.compiling');
      errorsDiv.style.display = 'none';

      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', descInput.value.trim());
      formData.append('file', fileInput.files[0]);

      try {
        await ApiClient.postForm(endpoint, formData);
        this.notifications.success(
          isEnemy ? t('admin:ai.uploadEnemySuccess') : t('admin:ai.uploadSuccess'),
        );
        overlay.remove();
        await this.loadList();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        errorsDiv.style.display = 'block';
        setHtml(
          errorsDiv,
          `
          <p style="color:var(--danger);font-weight:600;margin:0 0 8px;">${t('admin:ai.compilationFailed')}</p>
          <pre style="color:var(--text-dim);margin:0;white-space:pre-wrap;font-size:12px;">${escapeHtml(msg)}</pre>
        `,
        );
        submitBtn.disabled = false;
        submitBtn.textContent = t('admin:ai.uploadAndCompile');
      }
    });
  }

  private showReuploadModal(type: 'bot' | 'enemy', id: string): void {
    const isEnemy = type === 'enemy';
    const endpoint = isEnemy ? `/admin/enemy-ai/${id}/upload` : `/admin/ai/${id}/upload`;
    const title = isEnemy ? t('admin:ai.reuploadEnemyTitle') : t('admin:ai.reuploadTitle');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    setHtml(
      overlay,
      `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:400px;max-width:90vw;">
        <h3 style="margin:0 0 16px;color:var(--primary);">${title}</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">${t('admin:ai.fileLabel')}</label>
            <input type="file" id="ai-reupload-file" accept=".ts" style="color:var(--text);">
          </div>
          <div id="ai-reupload-errors" style="display:none;background:var(--bg-deep);border:1px solid var(--danger);border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;"></div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">
            <button class="btn btn-secondary" id="ai-reupload-cancel">${t('admin:ai.cancel')}</button>
            <button class="btn btn-primary" id="ai-reupload-submit">${t('admin:ai.uploadAndCompile')}</button>
          </div>
        </div>
      </div>
    `,
    );

    document.body.appendChild(overlay);

    overlay.querySelector('#ai-reupload-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#ai-reupload-submit')?.addEventListener('click', async () => {
      const fileInput = overlay.querySelector('#ai-reupload-file') as HTMLInputElement;
      const errorsDiv = overlay.querySelector('#ai-reupload-errors') as HTMLElement;
      const submitBtn = overlay.querySelector('#ai-reupload-submit') as HTMLButtonElement;

      if (!fileInput.files || fileInput.files.length === 0) {
        this.notifications.error(t('admin:ai.selectFileError'));
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('admin:ai.compiling');
      errorsDiv.style.display = 'none';

      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      try {
        await ApiClient.putForm(endpoint, formData);
        this.notifications.success(
          isEnemy ? t('admin:ai.reuploadEnemySuccess') : t('admin:ai.reuploadSuccess'),
        );
        overlay.remove();
        await this.loadList();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        errorsDiv.style.display = 'block';
        setHtml(
          errorsDiv,
          `
          <p style="color:var(--danger);font-weight:600;margin:0 0 8px;">${t('admin:ai.compilationFailed')}</p>
          <pre style="color:var(--text-dim);margin:0;white-space:pre-wrap;font-size:12px;">${escapeHtml(msg)}</pre>
        `,
        );
        submitBtn.disabled = false;
        submitBtn.textContent = t('admin:ai.uploadAndCompile');
      }
    });
  }

  private showEditModal(type: 'bot' | 'enemy', ai: BotAIEntry | EnemyAIEntry): void {
    const isEnemy = type === 'enemy';
    const endpoint = isEnemy ? `/admin/enemy-ai/${ai.id}` : `/admin/ai/${ai.id}`;
    const title = isEnemy ? t('admin:ai.editEnemyTitle') : t('admin:ai.editTitle');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    setHtml(
      overlay,
      `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:400px;max-width:90vw;">
        <h3 style="margin:0 0 16px;color:var(--primary);">${title}</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">${t('admin:ai.nameLabel')}</label>
            <input type="text" id="ai-edit-name" class="admin-input" value="${escapeHtml(ai.name)}" maxlength="100" style="width:100%;box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">${t('admin:ai.descriptionLabel')}</label>
            <textarea id="ai-edit-desc" class="admin-input" maxlength="500" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;">${escapeHtml(ai.description)}</textarea>
          </div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">
            <button class="btn btn-secondary" id="ai-edit-cancel">${t('admin:ai.cancel')}</button>
            <button class="btn btn-primary" id="ai-edit-submit">${t('admin:ai.save')}</button>
          </div>
        </div>
      </div>
    `,
    );

    document.body.appendChild(overlay);

    overlay.querySelector('#ai-edit-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('#ai-edit-submit')?.addEventListener('click', async () => {
      const nameInput = overlay.querySelector('#ai-edit-name') as HTMLInputElement;
      const descInput = overlay.querySelector('#ai-edit-desc') as HTMLTextAreaElement;
      const name = nameInput.value.trim();
      if (!name) {
        this.notifications.error(t('admin:ai.nameRequired'));
        return;
      }
      try {
        await ApiClient.put(endpoint, {
          name,
          description: descInput.value.trim(),
        });
        this.notifications.success(
          isEnemy ? t('admin:ai.enemyAiUpdated') : t('admin:ai.aiUpdated'),
        );
        overlay.remove();
        await this.loadList();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }

  private showDeleteConfirmation(type: 'bot' | 'enemy', id: string, name: string): void {
    const isEnemy = type === 'enemy';
    const endpoint = isEnemy ? `/admin/enemy-ai/${id}` : `/admin/ai/${id}`;
    const title = isEnemy ? t('admin:ai.deleteEnemyTitle') : t('admin:ai.deleteTitle');
    const fallbackMsg = isEnemy
      ? t('admin:ai.deleteFallbackEnemy')
      : t('admin:ai.deleteFallbackBot');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    setHtml(
      overlay,
      `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:400px;max-width:90vw;">
        <h3 style="margin:0 0 12px;color:var(--danger);">${title}</h3>
        <p style="color:var(--text-dim);margin:0 0 12px;">${t('admin:ai.deleteConfirmMessage', { name: escapeHtml(name), fallbackMessage: fallbackMsg })}</p>
        <p style="color:var(--text-dim);margin:0 0 16px;font-size:13px;">${t('admin:ai.deleteTypeToConfirm')}</p>
        <input type="text" id="ai-delete-confirm" class="admin-input" placeholder="${escapeHtml(name)}" aria-label="${t('admin:ai.deleteConfirmAriaLabel')}" style="width:100%;box-sizing:border-box;margin-bottom:16px;">
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="ai-delete-cancel">${t('admin:ai.cancel')}</button>
          <button class="btn btn-danger" id="ai-delete-submit" disabled>${t('admin:ai.delete')}</button>
        </div>
      </div>
    `,
    );

    document.body.appendChild(overlay);

    const confirmInput = overlay.querySelector('#ai-delete-confirm') as HTMLInputElement;
    const deleteBtn = overlay.querySelector('#ai-delete-submit') as HTMLButtonElement;

    confirmInput.addEventListener('input', () => {
      deleteBtn.disabled = confirmInput.value !== name;
    });

    overlay.querySelector('#ai-delete-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    deleteBtn.addEventListener('click', async () => {
      try {
        await ApiClient.delete(endpoint);
        this.notifications.success(
          isEnemy ? t('admin:ai.enemyAiDeleted') : t('admin:ai.aiDeleted'),
        );
        overlay.remove();
        await this.loadList();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }
}
