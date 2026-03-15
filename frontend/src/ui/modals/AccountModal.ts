import { AuthManager } from '../../network/AuthManager';
import { ApiClient } from '../../network/ApiClient';
import { NotificationUI } from '../NotificationUI';
import { escapeHtml } from '../../utils/html';
import { getErrorMessage } from '@blast-arena/shared';

export interface AccountModalDeps {
  authManager: AuthManager;
  notifications: NotificationUI;
  onUpdate: () => void;
}

export async function showAccountModal(deps: AccountModalDeps): Promise<void> {
  const { authManager, notifications, onUpdate } = deps;

  // Fetch current profile
  let profile: any;
  try {
    profile = await ApiClient.get('/user/profile');
  } catch (err: unknown) {
    notifications.error('Failed to load profile: ' + getErrorMessage(err));
    return;
  }

  const user = authManager.getUser();
  const isAdmin = user?.role === 'admin';

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:420px;">
      <h2>Account Settings</h2>

      <div class="form-group">
        <label>Username</label>
        <input type="text" id="acct-username" value="${escapeHtml(profile.username)}" maxlength="20">
        <div id="acct-username-hint" style="font-size:11px;color:var(--text-muted);margin-top:4px;">Letters, numbers, underscores, hyphens. 3-20 characters.</div>
      </div>

      <div id="acct-profile-status" style="margin-bottom:12px;"></div>

      <div class="modal-actions" style="margin-bottom:20px;">
        <button class="btn btn-primary" id="acct-save-profile">Save</button>
      </div>

      <hr style="border-color:var(--border);margin:16px 0;">

      <div class="form-group">
        <label>Email Address</label>
        <div style="color:var(--text-dim);font-size:13px;margin-bottom:6px;">
          Current: <strong style="color:var(--text);">${escapeHtml(profile.email)}</strong>
          ${profile.emailVerified ? '<span style="color:var(--success);margin-left:6px;">verified</span>' : '<span style="color:var(--warning);margin-left:6px;">unverified</span>'}
        </div>
        ${
          !isAdmin && profile.pendingEmail
            ? `
          <div style="color:var(--warning);font-size:13px;margin-bottom:8px;padding:10px;background:var(--warning-dim);border:1px solid var(--warning);border-radius:8px;">
            Pending change to <strong>${escapeHtml(profile.pendingEmail)}</strong> — check that inbox for the confirmation link.
            <button class="btn btn-secondary" id="acct-cancel-email" style="margin-left:8px;padding:2px 8px;font-size:11px;">Cancel</button>
          </div>
        `
            : ''
        }
        <input type="email" id="acct-new-email" placeholder="New email address" maxlength="255">
      </div>

      <div id="acct-email-status" style="margin-bottom:12px;"></div>

      <div class="modal-actions" style="margin-bottom:8px;">
        <button class="btn btn-primary" id="acct-change-email">${isAdmin ? 'Change Email' : 'Send Confirmation'}</button>
      </div>

      <hr style="border-color:var(--border);margin:16px 0;">

      <div class="modal-actions">
        <button class="btn btn-secondary" id="acct-close">Close</button>
      </div>
    </div>
  `;

  // Save profile (username)
  modal.querySelector('#acct-save-profile')!.addEventListener('click', async () => {
    const statusEl = modal.querySelector('#acct-profile-status')!;
    const newUsername = (modal.querySelector('#acct-username') as HTMLInputElement).value.trim();

    if (!newUsername) {
      statusEl.innerHTML = '<span style="color:var(--danger);">Username cannot be empty.</span>';
      return;
    }

    const updates: any = {};
    if (newUsername !== profile.username) updates.username = newUsername;

    if (Object.keys(updates).length === 0) {
      statusEl.innerHTML = '<span style="color:var(--text-dim);">No changes to save.</span>';
      return;
    }

    try {
      const updated: any = await ApiClient.put('/user/profile', updates);
      profile = updated;
      authManager.updateUser({
        username: updated.username,
      });
      statusEl.innerHTML = '<span style="color:var(--success);">Profile updated!</span>';
      // Re-render lobby header to show new name
      onUpdate();
    } catch (err: unknown) {
      statusEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(getErrorMessage(err))}</span>`;
    }
  });

  // Change email
  modal.querySelector('#acct-change-email')!.addEventListener('click', async () => {
    const statusEl = modal.querySelector('#acct-email-status')!;
    const newEmail = (modal.querySelector('#acct-new-email') as HTMLInputElement).value.trim();

    if (!newEmail) {
      statusEl.innerHTML = '<span style="color:var(--danger);">Enter a new email address.</span>';
      return;
    }
    if (newEmail === profile.email) {
      statusEl.innerHTML =
        '<span style="color:var(--text-dim);">That\'s already your current email.</span>';
      return;
    }

    try {
      const result: any = await ApiClient.post('/user/email', { email: newEmail });
      statusEl.innerHTML = `<span style="color:var(--success);">${escapeHtml(result.message)}</span>`;
      // Clear the input
      (modal.querySelector('#acct-new-email') as HTMLInputElement).value = '';
    } catch (err: unknown) {
      statusEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(getErrorMessage(err))}</span>`;
    }
  });

  // Cancel pending email change
  const cancelEmailBtn = modal.querySelector('#acct-cancel-email');
  if (cancelEmailBtn) {
    cancelEmailBtn.addEventListener('click', async () => {
      try {
        await ApiClient.delete('/user/email');
        notifications.success('Pending email change cancelled');
        modal.remove();
        showAccountModal(deps);
      } catch (err: unknown) {
        notifications.error(getErrorMessage(err));
      }
    });
  }

  modal.querySelector('#acct-close')!.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  document.getElementById('ui-overlay')!.appendChild(modal);
}
