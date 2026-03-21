import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { escapeHtml } from '../utils/html';
import { getErrorMessage, Cosmetic, CosmeticType, EquippedCosmetics } from '@blast-arena/shared';
import { getSettings, saveSettings, VisualSettings } from '../game/Settings';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';

interface Tab {
  id: string;
  label: string;
}

export class SettingsUI {
  private container: HTMLElement;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onClose: () => void;
  private activeTabId: string;
  private contentEl: HTMLElement | null = null;
  private tabs: Tab[] = [
    { id: 'account', label: 'Account' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'cosmetics', label: 'Cosmetics' },
  ];

  constructor(
    authManager: AuthManager,
    notifications: NotificationUI,
    onClose: () => void,
    initialTab?: string,
  ) {
    this.authManager = authManager;
    this.notifications = notifications;
    this.onClose = onClose;
    this.container = document.createElement('div');
    this.container.className = 'admin-container';
    this.activeTabId = initialTab && this.tabs.some((t) => t.id === initialTab) ? initialTab : 'account';
  }

  async show(): Promise<void> {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    await this.render();
    this.pushGamepadContext();
  }

  hide(): void {
    UIGamepadNavigator.getInstance().popContext('settings-ui');
    this.container.remove();
  }

  private async render(): Promise<void> {
    this.container.innerHTML = `
      <div class="admin-header">
        <h1 style="color:var(--primary);margin:0;">Settings</h1>
        <button class="btn btn-secondary" id="settings-ui-close">Back to Lobby</button>
      </div>
      <div class="admin-tabs" id="settings-tab-bar">
        ${this.tabs
          .map(
            (t) => `
          <button class="admin-tab ${t.id === this.activeTabId ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>
        `,
          )
          .join('')}
      </div>
      <div class="admin-tab-content" id="settings-tab-content"></div>
    `;

    this.container.querySelector('#settings-ui-close')!.addEventListener('click', () => {
      this.hide();
      this.onClose();
    });

    this.container.querySelector('#settings-tab-bar')!.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.dataset.tab && target.dataset.tab !== this.activeTabId) {
        this.switchTab(target.dataset.tab);
      }
    });

    this.contentEl = this.container.querySelector('#settings-tab-content');
    await this.renderActiveTab();
  }

  private async switchTab(tabId: string): Promise<void> {
    this.activeTabId = tabId;

    const tabBar = this.container.querySelector('#settings-tab-bar');
    if (tabBar) {
      tabBar.querySelectorAll('.admin-tab').forEach((btn) => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tabId);
      });
    }

    if (this.contentEl) {
      this.contentEl.innerHTML = '';
    }
    await this.renderActiveTab();
    this.pushGamepadContext();
  }

  private async renderActiveTab(): Promise<void> {
    if (!this.contentEl) return;

    switch (this.activeTabId) {
      case 'account':
        await this.renderAccountTab();
        break;
      case 'preferences':
        this.renderPreferencesTab();
        break;
      case 'privacy':
        await this.renderPrivacyTab();
        break;
      case 'cosmetics':
        await this.renderCosmeticsTab();
        break;
    }
  }

  private async renderAccountTab(): Promise<void> {
    if (!this.contentEl) return;

    let profile: any;
    try {
      profile = await ApiClient.get('/user/profile');
    } catch (err: unknown) {
      this.contentEl.innerHTML = `<div style="color:var(--danger);padding:20px;">Failed to load profile: ${escapeHtml(getErrorMessage(err))}</div>`;
      return;
    }

    const user = this.authManager.getUser();
    const isAdmin = user?.role === 'admin';

    this.contentEl.innerHTML = `
      <div style="max-width:500px;">
        <div style="margin-bottom:24px;">
          <h3 style="color:var(--text);font-family:var(--font-display);font-weight:700;margin-bottom:16px;">Profile</h3>
          <div class="form-group">
            <label>Username</label>
            <input type="text" id="acct-username" value="${escapeHtml(profile.username)}" maxlength="20"
              style="width:100%;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;color:var(--text);font-size:14px;font-family:var(--font-body);outline:none;">
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Letters, numbers, underscores, hyphens. 3-20 characters.</div>
          </div>
          <div id="acct-profile-status" style="margin:8px 0;"></div>
          <button class="btn btn-primary" id="acct-save-profile">Save Username</button>
        </div>

        <hr style="border-color:var(--border);margin:20px 0;">

        <div style="margin-bottom:24px;">
          <h3 style="color:var(--text);font-family:var(--font-display);font-weight:700;margin-bottom:16px;">Email</h3>
          <div style="color:var(--text-dim);font-size:13px;margin-bottom:10px;">
            Current: <strong style="color:var(--text);">${escapeHtml(profile.email)}</strong>
            ${profile.emailVerified ? '<span style="color:var(--success);margin-left:6px;">verified</span>' : '<span style="color:var(--warning);margin-left:6px;">unverified</span>'}
          </div>
          ${
            !isAdmin && profile.pendingEmail
              ? `
            <div style="color:var(--warning);font-size:13px;margin-bottom:12px;padding:10px;background:var(--warning-dim);border:1px solid var(--warning);border-radius:8px;">
              Pending change to <strong>${escapeHtml(profile.pendingEmail)}</strong> — check that inbox for the confirmation link.
              <button class="btn btn-secondary" id="acct-cancel-email" style="margin-left:8px;padding:2px 8px;font-size:11px;">Cancel</button>
            </div>
          `
              : ''
          }
          <div class="form-group">
            <input type="email" id="acct-new-email" placeholder="New email address" maxlength="255"
              style="width:100%;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;color:var(--text);font-size:14px;font-family:var(--font-body);outline:none;">
          </div>
          <div id="acct-email-status" style="margin:8px 0;"></div>
          <button class="btn btn-primary" id="acct-change-email">${isAdmin ? 'Change Email' : 'Send Confirmation'}</button>
        </div>

        <hr style="border-color:var(--border);margin:20px 0;">

        <div style="margin-bottom:24px;">
          <h3 style="color:var(--text);font-family:var(--font-display);font-weight:700;margin-bottom:16px;">Change Password</h3>
          <div class="form-group" style="display:flex;flex-direction:column;gap:10px;">
            <input type="password" id="acct-current-password" placeholder="Current password" autocomplete="current-password"
              style="width:100%;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;color:var(--text);font-size:14px;font-family:var(--font-body);outline:none;">
            <input type="password" id="acct-new-password" placeholder="New password (min 8 characters)" autocomplete="new-password"
              style="width:100%;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;color:var(--text);font-size:14px;font-family:var(--font-body);outline:none;">
            <input type="password" id="acct-confirm-password" placeholder="Confirm new password" autocomplete="new-password"
              style="width:100%;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;color:var(--text);font-size:14px;font-family:var(--font-body);outline:none;">
          </div>
          <div id="acct-password-status" style="margin:8px 0;"></div>
          <button class="btn btn-primary" id="acct-change-password">Change Password</button>
        </div>
      </div>
    `;

    // Save username
    this.contentEl.querySelector('#acct-save-profile')!.addEventListener('click', async () => {
      const statusEl = this.contentEl!.querySelector('#acct-profile-status')!;
      const newUsername = (this.contentEl!.querySelector('#acct-username') as HTMLInputElement).value.trim();

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
        this.authManager.updateUser({ username: updated.username });
        statusEl.innerHTML = '<span style="color:var(--success);">Profile updated!</span>';
      } catch (err: unknown) {
        statusEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    // Change email
    this.contentEl.querySelector('#acct-change-email')!.addEventListener('click', async () => {
      const statusEl = this.contentEl!.querySelector('#acct-email-status')!;
      const newEmail = (this.contentEl!.querySelector('#acct-new-email') as HTMLInputElement).value.trim();

      if (!newEmail) {
        statusEl.innerHTML = '<span style="color:var(--danger);">Enter a new email address.</span>';
        return;
      }
      if (newEmail === profile.email) {
        statusEl.innerHTML = '<span style="color:var(--text-dim);">That\'s already your current email.</span>';
        return;
      }

      try {
        const result: any = await ApiClient.post('/user/email', { email: newEmail });
        statusEl.innerHTML = `<span style="color:var(--success);">${escapeHtml(result.message)}</span>`;
        (this.contentEl!.querySelector('#acct-new-email') as HTMLInputElement).value = '';
      } catch (err: unknown) {
        statusEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    // Change password
    this.contentEl.querySelector('#acct-change-password')!.addEventListener('click', async () => {
      const statusEl = this.contentEl!.querySelector('#acct-password-status')!;
      const currentPassword = (this.contentEl!.querySelector('#acct-current-password') as HTMLInputElement).value;
      const newPassword = (this.contentEl!.querySelector('#acct-new-password') as HTMLInputElement).value;
      const confirmPassword = (this.contentEl!.querySelector('#acct-confirm-password') as HTMLInputElement).value;

      if (!currentPassword || !newPassword) {
        statusEl.innerHTML = '<span style="color:var(--danger);">Please fill in both password fields.</span>';
        return;
      }
      if (newPassword.length < 8) {
        statusEl.innerHTML = '<span style="color:var(--danger);">New password must be at least 8 characters.</span>';
        return;
      }
      if (newPassword !== confirmPassword) {
        statusEl.innerHTML = '<span style="color:var(--danger);">New passwords do not match.</span>';
        return;
      }

      try {
        const result: any = await ApiClient.post('/user/password', { currentPassword, newPassword });
        statusEl.innerHTML = `<span style="color:var(--success);">${escapeHtml(result.message)}</span>`;
        (this.contentEl!.querySelector('#acct-current-password') as HTMLInputElement).value = '';
        (this.contentEl!.querySelector('#acct-new-password') as HTMLInputElement).value = '';
        (this.contentEl!.querySelector('#acct-confirm-password') as HTMLInputElement).value = '';
      } catch (err: unknown) {
        statusEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    });

    // Cancel pending email
    const cancelEmailBtn = this.contentEl.querySelector('#acct-cancel-email');
    if (cancelEmailBtn) {
      cancelEmailBtn.addEventListener('click', async () => {
        try {
          await ApiClient.delete('/user/email');
          this.notifications.success('Pending email change cancelled');
          if (this.contentEl) {
            this.contentEl.innerHTML = '';
            await this.renderAccountTab();
          }
        } catch (err: unknown) {
          this.notifications.error(getErrorMessage(err));
        }
      });
    }
  }

  private renderPreferencesTab(): void {
    if (!this.contentEl) return;
    const settings = getSettings();

    this.contentEl.innerHTML = `
      <div style="max-width:500px;">
        <h3 style="color:var(--text);font-family:var(--font-display);font-weight:700;margin-bottom:20px;">Visual Settings</h3>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <label style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:background var(--transition);">
            <input type="checkbox" name="animations" ${settings.animations ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">
            <div>
              <div style="font-weight:600;font-size:14px;color:var(--text);">Animations</div>
              <div style="font-size:12px;color:var(--text-muted);">Sprite movement tweens and transitions</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:background var(--transition);">
            <input type="checkbox" name="screenShake" ${settings.screenShake ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">
            <div>
              <div style="font-weight:600;font-size:14px;color:var(--text);">Screen Shake</div>
              <div style="font-size:12px;color:var(--text-muted);">Camera shake on explosions</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;transition:background var(--transition);">
            <input type="checkbox" name="particles" ${settings.particles ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">
            <div>
              <div style="font-weight:600;font-size:14px;color:var(--text);">Particles</div>
              <div style="font-size:12px;color:var(--text-muted);">Fire, smoke, debris, and spark effects</div>
            </div>
          </label>
        </div>
      </div>
    `;

    this.contentEl.addEventListener('change', (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target || target.type !== 'checkbox') return;
      const key = target.name as keyof VisualSettings;
      const current = getSettings();
      (current as any)[key] = target.checked;
      saveSettings(current);
    });
  }

  private async renderPrivacyTab(): Promise<void> {
    if (!this.contentEl) return;

    let profile: any;
    try {
      profile = await ApiClient.get('/user/profile');
    } catch (err: unknown) {
      this.contentEl.innerHTML = `<div style="color:var(--danger);padding:20px;">Failed to load profile: ${escapeHtml(getErrorMessage(err))}</div>`;
      return;
    }

    this.contentEl.innerHTML = `
      <div style="max-width:500px;">
        <h3 style="color:var(--text);font-family:var(--font-display);font-weight:700;margin-bottom:20px;">Privacy Settings</h3>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <label style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;">
            <input type="checkbox" id="privacy-public-profile" ${profile.isProfilePublic ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">
            <div>
              <div style="font-weight:600;font-size:14px;color:var(--text);">Public Profile</div>
              <div style="font-size:12px;color:var(--text-muted);">Allow other players to view your stats, rank, and achievements</div>
            </div>
          </label>
          <label style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;">
            <input type="checkbox" id="privacy-accept-friends" ${profile.acceptFriendRequests ? 'checked' : ''}
              style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">
            <div>
              <div style="font-weight:600;font-size:14px;color:var(--text);">Accept Friend Requests</div>
              <div style="font-size:12px;color:var(--text-muted);">Allow other players to send you friend requests</div>
            </div>
          </label>
        </div>
        <div id="privacy-status" style="margin-top:12px;"></div>
      </div>
    `;

    const savePrivacy = async (field: string, value: boolean) => {
      const statusEl = this.contentEl!.querySelector('#privacy-status')!;
      try {
        await ApiClient.put('/user/privacy', { [field]: value });
        statusEl.innerHTML = '<span style="color:var(--success);">Saved!</span>';
        setTimeout(() => { statusEl.innerHTML = ''; }, 2000);
      } catch (err: unknown) {
        statusEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(getErrorMessage(err))}</span>`;
      }
    };

    this.contentEl.querySelector('#privacy-public-profile')!.addEventListener('change', (e) => {
      savePrivacy('isProfilePublic', (e.target as HTMLInputElement).checked);
    });
    this.contentEl.querySelector('#privacy-accept-friends')!.addEventListener('change', (e) => {
      savePrivacy('acceptFriendRequests', (e.target as HTMLInputElement).checked);
    });
  }

  private async renderCosmeticsTab(): Promise<void> {
    if (!this.contentEl) return;

    let allCosmetics: Cosmetic[] = [];
    let myCosmetics: Cosmetic[] = [];
    let equipped: EquippedCosmetics = { colorId: null, eyesId: null, trailId: null, bombSkinId: null };

    try {
      const [allResp, mineResp, equippedResp] = await Promise.all([
        ApiClient.get<{ cosmetics: Cosmetic[] }>('/cosmetics'),
        ApiClient.get<{ cosmetics: Cosmetic[] }>('/cosmetics/mine'),
        ApiClient.get<EquippedCosmetics>('/cosmetics/equipped'),
      ]);
      allCosmetics = allResp.cosmetics;
      myCosmetics = mineResp.cosmetics;
      equipped = equippedResp;
    } catch (err: unknown) {
      this.contentEl.innerHTML = `<div style="color:var(--danger);padding:20px;">Failed to load cosmetics: ${escapeHtml(getErrorMessage(err))}</div>`;
      return;
    }

    const ownedIds = new Set(myCosmetics.map((c) => c.id));
    const slots: { key: keyof EquippedCosmetics; type: CosmeticType; label: string }[] = [
      { key: 'colorId', type: 'color', label: 'Player Color' },
      { key: 'eyesId', type: 'eyes', label: 'Eye Style' },
      { key: 'trailId', type: 'trail', label: 'Movement Trail' },
      { key: 'bombSkinId', type: 'bomb_skin', label: 'Bomb Skin' },
    ];

    const renderSlot = (slot: typeof slots[0]) => {
      const items = allCosmetics.filter((c) => c.type === slot.type);
      const equippedId = equipped[slot.key];

      return `
        <div style="margin-bottom:24px;">
          <h4 style="color:var(--text);font-family:var(--font-display);font-weight:700;margin-bottom:10px;">${slot.label}</h4>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="cosmetic-item ${equippedId === null ? 'equipped' : ''}" data-slot="${slot.type}" data-cosmetic-id="null"
              style="padding:8px 12px;border-radius:var(--radius-sm);border:2px solid ${equippedId === null ? 'var(--primary)' : 'var(--border)'};background:var(--bg-surface);color:var(--text);cursor:pointer;font-size:12px;">
              None
            </button>
            ${items
              .map((c) => {
                const owned = ownedIds.has(c.id);
                const isEquipped = equippedId === c.id;
                const preview = c.type === 'color' && c.config.hex
                  ? `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${typeof c.config.hex === 'string' ? '#' + (c.config.hex as string).replace('0x', '') : '#fff'};vertical-align:middle;margin-right:4px;"></span>`
                  : '';
                return `
                  <button class="cosmetic-item ${isEquipped ? 'equipped' : ''}" data-slot="${slot.type}" data-cosmetic-id="${c.id}"
                    ${!owned ? 'disabled' : ''}
                    style="padding:8px 12px;border-radius:var(--radius-sm);border:2px solid ${isEquipped ? 'var(--primary)' : 'var(--border)'};background:${owned ? 'var(--bg-surface)' : 'var(--bg-deep)'};color:${owned ? 'var(--text)' : 'var(--text-muted)'};cursor:${owned ? 'pointer' : 'not-allowed'};font-size:12px;opacity:${owned ? '1' : '0.5'};">
                    ${preview}${escapeHtml(c.name)}
                    ${!owned ? '<span style="font-size:10px;color:var(--text-muted);display:block;">Locked</span>' : ''}
                  </button>`;
              })
              .join('')}
          </div>
        </div>
      `;
    };

    this.contentEl.innerHTML = `
      <div style="max-width:600px;">
        <h3 style="color:var(--text);font-family:var(--font-display);font-weight:700;margin-bottom:20px;">Cosmetics</h3>
        ${slots.map(renderSlot).join('')}
        <div id="cosmetics-status" style="margin-top:8px;"></div>
      </div>
    `;

    this.contentEl.querySelectorAll('.cosmetic-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const slot = (btn as HTMLElement).dataset.slot as CosmeticType;
        const cosmeticIdStr = (btn as HTMLElement).dataset.cosmeticId!;
        const cosmeticId = cosmeticIdStr === 'null' ? null : parseInt(cosmeticIdStr);

        const statusEl = this.contentEl!.querySelector('#cosmetics-status')!;
        try {
          const newEquipped = await ApiClient.put<EquippedCosmetics>('/cosmetics/equip', { slot, cosmeticId });
          equipped = newEquipped;
          // Re-render to update visual state
          await this.renderCosmeticsTab();
          this.notifications.success('Cosmetic updated');
        } catch (err: unknown) {
          statusEl.innerHTML = `<span style="color:var(--danger);">${escapeHtml(getErrorMessage(err))}</span>`;
        }
      });
    });
  }

  private pushGamepadContext(): void {
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.popContext('settings-ui');
    gpNav.pushContext({
      id: 'settings-ui',
      elements: () => [
        ...this.container.querySelectorAll<HTMLElement>('#settings-ui-close'),
        ...this.container.querySelectorAll<HTMLElement>('.admin-tab'),
        ...(this.contentEl?.querySelectorAll<HTMLElement>('input, button, .btn') || []),
      ],
      onBack: () => {
        this.hide();
        this.onClose();
      },
    });
  }
}
