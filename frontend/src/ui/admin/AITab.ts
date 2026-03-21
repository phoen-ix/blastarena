import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { BotAIEntry, EnemyAIEntry, getErrorMessage } from '@blast-arena/shared';
import { escapeHtml } from '../../utils/html';
import { API_URL } from '../../config';

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

    this.container.innerHTML = `
      <div class="admin-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">Bot AI Management</h3>
          <button class="btn btn-primary" id="bot-ai-upload-btn">Upload New AI</button>
        </div>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
              <th>Version</th>
              <th>Uploaded By</th>
              <th>File</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${botAIs.map((ai) => this.renderBotRow(ai)).join('')}
          </tbody>
        </table>
      </div>

      <div class="admin-section" style="margin-top:32px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h3 style="margin:0;">Enemy AI Management</h3>
          <button class="btn btn-primary" id="enemy-ai-upload-btn">Upload New Enemy AI</button>
        </div>
        <p style="color:var(--text-dim);font-size:13px;margin:0 0 12px;">Custom AI scripts for campaign enemies. Assign to enemy types in the Campaign tab.</p>
        <table class="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Status</th>
              <th>Version</th>
              <th>Uploaded By</th>
              <th>File</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${enemyAIs.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:16px;">No enemy AIs uploaded yet</td></tr>' : enemyAIs.map((ai) => this.renderEnemyRow(ai)).join('')}
          </tbody>
        </table>
      </div>
    `;

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
      ? '<span style="color:var(--success);font-weight:600;">Active</span>'
      : '<span style="color:var(--text-dim);">Inactive</span>';
    const builtinBadge = ai.isBuiltin
      ? ' <span style="background:var(--bg-card);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:11px;color:var(--text-dim);">Built-in</span>'
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
            <button class="btn-sm btn-secondary bot-ai-toggle" data-id="${escapeHtml(ai.id)}" data-active="${ai.isActive}">${ai.isActive ? 'Deactivate' : 'Activate'}</button>
            <button class="btn-sm btn-secondary bot-ai-download" data-id="${escapeHtml(ai.id)}">Download</button>
            ${!ai.isBuiltin ? `<button class="btn-sm btn-secondary bot-ai-reupload" data-id="${escapeHtml(ai.id)}">Re-upload</button>` : ''}
            ${!ai.isBuiltin ? `<button class="btn-sm btn-secondary bot-ai-edit" data-id="${escapeHtml(ai.id)}">Edit</button>` : ''}
            ${!ai.isBuiltin ? `<button class="btn-sm btn-danger bot-ai-delete" data-id="${escapeHtml(ai.id)}" data-name="${escapeHtml(ai.name)}">Delete</button>` : ''}
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
          this.notifications.success(isActive ? 'AI deactivated' : 'AI activated');
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
          if (!response.ok) throw new Error('Download failed');
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
      ? '<span style="color:var(--success);font-weight:600;">Active</span>'
      : '<span style="color:var(--text-dim);">Inactive</span>';
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
            <button class="btn-sm btn-secondary enemy-ai-toggle" data-id="${escapeHtml(ai.id)}" data-active="${ai.isActive}">${ai.isActive ? 'Deactivate' : 'Activate'}</button>
            <button class="btn-sm btn-secondary enemy-ai-download" data-id="${escapeHtml(ai.id)}">Download</button>
            <button class="btn-sm btn-secondary enemy-ai-reupload" data-id="${escapeHtml(ai.id)}">Re-upload</button>
            <button class="btn-sm btn-secondary enemy-ai-edit" data-id="${escapeHtml(ai.id)}">Edit</button>
            <button class="btn-sm btn-danger enemy-ai-delete" data-id="${escapeHtml(ai.id)}" data-name="${escapeHtml(ai.name)}">Delete</button>
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
          this.notifications.success(isActive ? 'Enemy AI deactivated' : 'Enemy AI activated');
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
          if (!response.ok) throw new Error('Download failed');
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
    const title = isEnemy ? 'Upload New Enemy AI' : 'Upload New Bot AI';
    const endpoint = isEnemy ? '/admin/enemy-ai' : '/admin/ai';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    overlay.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:500px;max-width:90vw;">
        <h3 style="margin:0 0 16px;color:var(--primary);">${title}</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Name *</label>
            <input type="text" id="ai-upload-name" class="admin-input" placeholder="My Custom AI" maxlength="100" style="width:100%;box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Description</label>
            <textarea id="ai-upload-desc" class="admin-input" placeholder="Optional description..." maxlength="500" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;"></textarea>
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">TypeScript File (.ts) *</label>
            <input type="file" id="ai-upload-file" accept=".ts" style="color:var(--text);">
          </div>
          ${isEnemy ? '<p style="color:var(--text-dim);font-size:12px;margin:0;">The class must implement: <code>decide(context: EnemyAIContext): { direction, placeBomb }</code></p>' : ''}
          <div id="ai-upload-errors" style="display:none;background:var(--bg-deep);border:1px solid var(--danger);border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;"></div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">
            <button class="btn btn-secondary" id="ai-upload-cancel">Cancel</button>
            <button class="btn btn-primary" id="ai-upload-submit">Upload &amp; Compile</button>
          </div>
        </div>
      </div>
    `;

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
        this.notifications.error('Name is required');
        return;
      }
      if (!fileInput.files || fileInput.files.length === 0) {
        this.notifications.error('Please select a TypeScript file');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Compiling...';
      errorsDiv.style.display = 'none';

      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', descInput.value.trim());
      formData.append('file', fileInput.files[0]);

      try {
        await ApiClient.postForm(endpoint, formData);
        this.notifications.success(
          `${isEnemy ? 'Enemy AI' : 'AI'} uploaded and compiled successfully`,
        );
        overlay.remove();
        await this.loadList();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        errorsDiv.style.display = 'block';
        errorsDiv.innerHTML = `
          <p style="color:var(--danger);font-weight:600;margin:0 0 8px;">Compilation/Validation Failed</p>
          <pre style="color:var(--text-dim);margin:0;white-space:pre-wrap;font-size:12px;">${escapeHtml(msg)}</pre>
        `;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Upload & Compile';
      }
    });
  }

  private showReuploadModal(type: 'bot' | 'enemy', id: string): void {
    const isEnemy = type === 'enemy';
    const endpoint = isEnemy ? `/admin/enemy-ai/${id}/upload` : `/admin/ai/${id}/upload`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    overlay.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:400px;max-width:90vw;">
        <h3 style="margin:0 0 16px;color:var(--primary);">Re-upload ${isEnemy ? 'Enemy ' : ''}AI Source</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">TypeScript File (.ts) *</label>
            <input type="file" id="ai-reupload-file" accept=".ts" style="color:var(--text);">
          </div>
          <div id="ai-reupload-errors" style="display:none;background:var(--bg-deep);border:1px solid var(--danger);border-radius:8px;padding:12px;max-height:200px;overflow-y:auto;"></div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">
            <button class="btn btn-secondary" id="ai-reupload-cancel">Cancel</button>
            <button class="btn btn-primary" id="ai-reupload-submit">Upload &amp; Compile</button>
          </div>
        </div>
      </div>
    `;

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
        this.notifications.error('Please select a TypeScript file');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Compiling...';
      errorsDiv.style.display = 'none';

      const formData = new FormData();
      formData.append('file', fileInput.files[0]);

      try {
        await ApiClient.putForm(endpoint, formData);
        this.notifications.success(
          `${isEnemy ? 'Enemy AI' : 'AI'} re-uploaded and compiled successfully`,
        );
        overlay.remove();
        await this.loadList();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        errorsDiv.style.display = 'block';
        errorsDiv.innerHTML = `
          <p style="color:var(--danger);font-weight:600;margin:0 0 8px;">Compilation/Validation Failed</p>
          <pre style="color:var(--text-dim);margin:0;white-space:pre-wrap;font-size:12px;">${escapeHtml(msg)}</pre>
        `;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Upload & Compile';
      }
    });
  }

  private showEditModal(type: 'bot' | 'enemy', ai: BotAIEntry | EnemyAIEntry): void {
    const isEnemy = type === 'enemy';
    const endpoint = isEnemy ? `/admin/enemy-ai/${ai.id}` : `/admin/ai/${ai.id}`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    overlay.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:400px;max-width:90vw;">
        <h3 style="margin:0 0 16px;color:var(--primary);">Edit ${isEnemy ? 'Enemy ' : ''}AI</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Name</label>
            <input type="text" id="ai-edit-name" class="admin-input" value="${escapeHtml(ai.name)}" maxlength="100" style="width:100%;box-sizing:border-box;">
          </div>
          <div>
            <label style="display:block;margin-bottom:4px;color:var(--text-dim);font-size:13px;">Description</label>
            <textarea id="ai-edit-desc" class="admin-input" maxlength="500" rows="3" style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;">${escapeHtml(ai.description)}</textarea>
          </div>
          <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:8px;">
            <button class="btn btn-secondary" id="ai-edit-cancel">Cancel</button>
            <button class="btn btn-primary" id="ai-edit-submit">Save</button>
          </div>
        </div>
      </div>
    `;

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
        this.notifications.error('Name is required');
        return;
      }
      try {
        await ApiClient.put(endpoint, {
          name,
          description: descInput.value.trim(),
        });
        this.notifications.success(`${isEnemy ? 'Enemy AI' : 'AI'} updated`);
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
    const fallbackMsg = isEnemy
      ? 'Enemies using this AI will fall back to their movement pattern.'
      : 'Active games using this AI will fall back to the built-in default.';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:1000;';

    overlay.innerHTML = `
      <div class="modal-content" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:24px;width:400px;max-width:90vw;">
        <h3 style="margin:0 0 12px;color:var(--danger);">Delete ${isEnemy ? 'Enemy ' : ''}AI</h3>
        <p style="color:var(--text-dim);margin:0 0 12px;">This will permanently delete <strong style="color:var(--text);">${escapeHtml(name)}</strong> and its source files. ${fallbackMsg}</p>
        <p style="color:var(--text-dim);margin:0 0 16px;font-size:13px;">Type the AI name to confirm:</p>
        <input type="text" id="ai-delete-confirm" class="admin-input" placeholder="${escapeHtml(name)}" style="width:100%;box-sizing:border-box;margin-bottom:16px;">
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button class="btn btn-secondary" id="ai-delete-cancel">Cancel</button>
          <button class="btn btn-danger" id="ai-delete-submit" disabled>Delete</button>
        </div>
      </div>
    `;

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
        this.notifications.success(`${isEnemy ? 'Enemy AI' : 'AI'} deleted`);
        overlay.remove();
        await this.loadList();
      } catch (err: unknown) {
        this.notifications.error(getErrorMessage(err));
      }
    });
  }
}
