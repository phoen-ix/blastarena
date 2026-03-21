import { ApiClient } from '../../network/ApiClient';
import { escapeAttr, escapeHtml } from '../../utils/html';
import { NotificationUI } from '../NotificationUI';
import {
  GameDefaults,
  SimulationDefaults,
  EmailSettings,
  PowerUpType,
  POWERUP_DEFINITIONS,
  BotAIEntry,
  ChatMode,
  THEME_IDS,
  THEME_NAMES,
} from '@blast-arena/shared';
import type { ThemeId } from '@blast-arena/shared';

const ALL_POWER_UPS = Object.values(POWERUP_DEFINITIONS);

export class DashboardTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private recordingsEnabled: boolean = true;
  private registrationEnabled: boolean = true;
  private gameDefaults: GameDefaults = {};
  private simulationDefaults: SimulationDefaults = {};
  private activeAIs: BotAIEntry[] = [];
  private emailSettings: EmailSettings = {};
  private chatMode: ChatMode = 'everyone';
  private lobbyChatMode: ChatMode = 'everyone';
  private dmMode: ChatMode = 'everyone';
  private emoteMode: ChatMode = 'everyone';
  private spectatorChatMode: ChatMode = 'everyone';
  private xpMultiplier: number = 1;
  private defaultTheme: ThemeId = 'inferno';
  private displayImprint: boolean = false;
  private imprintText: string = '';
  private displayGithub: boolean = false;

  constructor(notifications: NotificationUI) {
    this.notifications = notifications;
  }

  async render(parent: HTMLElement): Promise<void> {
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    await this.loadStats();
    await this.loadSettings();
    this.refreshInterval = setInterval(() => this.loadStats(), 30000);
  }

  destroy(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    this.container?.remove();
    this.container = null;
  }

  private async loadSettings(): Promise<void> {
    try {
      const [
        recResp,
        regResp,
        chatResp,
        lobbyResp,
        dmResp,
        emoteResp,
        specChatResp,
        xpResp,
        themeResp,
        gameResp,
        simResp,
        aiResp,
        imprintResp,
        githubResp,
      ] = await Promise.all([
        ApiClient.get<{ enabled: boolean }>('/admin/settings/recordings_enabled'),
        ApiClient.get<{ enabled: boolean }>('/admin/settings/registration_enabled'),
        ApiClient.get<{ mode: ChatMode }>('/admin/settings/party_chat_mode'),
        ApiClient.get<{ mode: ChatMode }>('/admin/settings/lobby_chat_mode'),
        ApiClient.get<{ mode: ChatMode }>('/admin/settings/dm_mode'),
        ApiClient.get<{ mode: ChatMode }>('/admin/settings/emote_mode'),
        ApiClient.get<{ mode: ChatMode }>('/admin/settings/spectator_chat_mode'),
        ApiClient.get<{ multiplier: number }>('/admin/settings/xp_multiplier'),
        ApiClient.get<{ theme: string }>('/admin/settings/default_theme'),
        ApiClient.get<{ defaults: GameDefaults }>('/admin/settings/game_defaults'),
        ApiClient.get<{ defaults: SimulationDefaults }>('/admin/settings/simulation_defaults'),
        ApiClient.get<{ ais: BotAIEntry[] }>('/admin/ai/active'),
        ApiClient.get<{ enabled: boolean; text: string }>('/admin/settings/imprint'),
        ApiClient.get<{ enabled: boolean }>('/admin/settings/display_github'),
      ]);
      this.recordingsEnabled = recResp.enabled;
      this.registrationEnabled = regResp.enabled;
      this.chatMode = chatResp.mode ?? 'everyone';
      this.lobbyChatMode = lobbyResp.mode ?? 'everyone';
      this.dmMode = dmResp.mode ?? 'everyone';
      this.emoteMode = emoteResp.mode ?? 'everyone';
      this.spectatorChatMode = specChatResp.mode ?? 'everyone';
      this.xpMultiplier = xpResp.multiplier ?? 1;
      this.defaultTheme = (themeResp.theme as ThemeId) || 'inferno';
      this.gameDefaults = gameResp.defaults ?? {};
      this.simulationDefaults = simResp.defaults ?? {};
      this.activeAIs = aiResp.ais ?? [];
      this.displayImprint = imprintResp.enabled;
      this.imprintText = imprintResp.text ?? '';
      this.displayGithub = githubResp.enabled;
    } catch {
      // Use defaults on failure
    }
    // Email settings are admin-only; fetch separately to handle non-admin gracefully
    try {
      const emailResp = await ApiClient.get<{ settings: EmailSettings }>(
        '/admin/settings/email_settings',
      );
      this.emailSettings = emailResp.settings ?? {};
    } catch {
      // Non-admin or fetch failure — leave as empty
    }
    this.renderSettingsCard();
  }

  private renderSettingsCard(): void {
    if (!this.container) return;

    // Remove existing settings card if any
    this.container.querySelector('#server-settings-card')?.remove();

    const card = document.createElement('div');
    card.id = 'server-settings-card';
    card.className = 'settings-card';
    card.innerHTML = `
      <h3>Server Settings</h3>
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-recordings" ${this.recordingsEnabled ? 'checked' : ''}>
            <span class="setting-item-label">Match Recordings</span>
          </label>
          <span class="setting-item-desc">Enable replay recording for all new games</span>
        </div>
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-registration" ${this.registrationEnabled ? 'checked' : ''}>
            <span class="setting-item-label">User Registration</span>
          </label>
          <span class="setting-item-desc">Allow new users to create accounts</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Party Chat</span>
          <select id="select-chat-mode" class="admin-select">
            <option value="everyone" ${this.chatMode === 'everyone' ? 'selected' : ''}>Everyone</option>
            <option value="staff" ${this.chatMode === 'staff' ? 'selected' : ''}>Staff Only (Admin + Mod)</option>
            <option value="admin_only" ${this.chatMode === 'admin_only' ? 'selected' : ''}>Admin Only</option>
            <option value="disabled" ${this.chatMode === 'disabled' ? 'selected' : ''}>Disabled</option>
          </select>
          <span class="setting-item-desc">Who can use party chat</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Lobby Chat</span>
          <select id="select-lobby-chat-mode" class="admin-select">
            <option value="everyone" ${this.lobbyChatMode === 'everyone' ? 'selected' : ''}>Everyone</option>
            <option value="staff" ${this.lobbyChatMode === 'staff' ? 'selected' : ''}>Staff Only (Admin + Mod)</option>
            <option value="admin_only" ${this.lobbyChatMode === 'admin_only' ? 'selected' : ''}>Admin Only</option>
            <option value="disabled" ${this.lobbyChatMode === 'disabled' ? 'selected' : ''}>Disabled</option>
          </select>
          <span class="setting-item-desc">Global lobby chat</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Direct Messages</span>
          <select id="select-dm-mode" class="admin-select">
            <option value="everyone" ${this.dmMode === 'everyone' ? 'selected' : ''}>Everyone</option>
            <option value="staff" ${this.dmMode === 'staff' ? 'selected' : ''}>Staff Only (Admin + Mod)</option>
            <option value="admin_only" ${this.dmMode === 'admin_only' ? 'selected' : ''}>Admin Only</option>
            <option value="disabled" ${this.dmMode === 'disabled' ? 'selected' : ''}>Disabled</option>
          </select>
          <span class="setting-item-desc">Friend-to-friend messaging</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">In-Game Emotes</span>
          <select id="select-emote-mode" class="admin-select">
            <option value="everyone" ${this.emoteMode === 'everyone' ? 'selected' : ''}>Everyone</option>
            <option value="staff" ${this.emoteMode === 'staff' ? 'selected' : ''}>Staff Only (Admin + Mod)</option>
            <option value="admin_only" ${this.emoteMode === 'admin_only' ? 'selected' : ''}>Admin Only</option>
            <option value="disabled" ${this.emoteMode === 'disabled' ? 'selected' : ''}>Disabled</option>
          </select>
          <span class="setting-item-desc">Quick emotes during games</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Spectator Chat</span>
          <select id="select-spectator-chat-mode" class="admin-select">
            <option value="everyone" ${this.spectatorChatMode === 'everyone' ? 'selected' : ''}>Everyone</option>
            <option value="staff" ${this.spectatorChatMode === 'staff' ? 'selected' : ''}>Staff Only (Admin + Mod)</option>
            <option value="admin_only" ${this.spectatorChatMode === 'admin_only' ? 'selected' : ''}>Admin Only</option>
            <option value="disabled" ${this.spectatorChatMode === 'disabled' ? 'selected' : ''}>Disabled</option>
          </select>
          <span class="setting-item-desc">Dead player chat during games</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">XP Multiplier</span>
          <input id="input-xp-multiplier" type="number" min="0" max="10" step="0.1" value="${this.xpMultiplier}"
            class="admin-select" style="width:60px;">
          <button id="btn-save-xp-multiplier" class="btn btn-primary btn-sm">Save</button>
          <span class="setting-item-desc">XP earned per match (default: 1.0)</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Default Theme</span>
          <select id="select-default-theme" class="admin-select">
            ${THEME_IDS.map((id) => `<option value="${id}" ${this.defaultTheme === id ? 'selected' : ''}>${THEME_NAMES[id]}</option>`).join('')}
          </select>
          <span class="setting-item-desc">Theme for users without a preference</span>
        </div>
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-display-github" ${this.displayGithub ? 'checked' : ''}>
            <span class="setting-item-label">Display GitHub Link</span>
          </label>
          <span class="setting-item-desc">Show GitHub repo link on login page and in Help</span>
        </div>
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-display-imprint" ${this.displayImprint ? 'checked' : ''}>
            <span class="setting-item-label">Display Imprint</span>
          </label>
          <span class="setting-item-desc">Show imprint link on login page and in Help</span>
        </div>
        <div class="setting-item" id="imprint-text-group" style="${this.displayImprint ? '' : 'display:none;'}">
          <span class="setting-item-label">Imprint Text</span>
          <textarea id="input-imprint-text" class="admin-select" rows="4" style="width:100%;resize:vertical;font-family:var(--font-body);font-size:13px;padding:var(--sp-2) var(--sp-3);background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);">${escapeHtml(this.imprintText)}</textarea>
          <button id="btn-save-imprint" class="btn btn-primary btn-sm" style="margin-top:var(--sp-2);">Save Imprint</button>
        </div>
      </div>

      ${this.renderEmailSettingsSection()}
      ${this.renderDefaultsSection('game')}
      ${this.renderDefaultsSection('simulation')}
    `;
    this.container.appendChild(card);

    card.querySelector('#toggle-recordings')!.addEventListener('change', async (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      try {
        await ApiClient.put('/admin/settings/recordings_enabled', { enabled });
        this.recordingsEnabled = enabled;
        this.notifications.success(`Match recordings ${enabled ? 'enabled' : 'disabled'}`);
      } catch {
        (e.target as HTMLInputElement).checked = !enabled;
        this.notifications.error('Failed to update setting');
      }
    });

    card.querySelector('#toggle-registration')!.addEventListener('change', async (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      try {
        await ApiClient.put('/admin/settings/registration_enabled', { enabled });
        this.registrationEnabled = enabled;
        this.notifications.success(`User registration ${enabled ? 'enabled' : 'disabled'}`);
      } catch {
        (e.target as HTMLInputElement).checked = !enabled;
        this.notifications.error('Failed to update setting');
      }
    });

    const chatModeSelect = card.querySelector('#select-chat-mode') as HTMLSelectElement;
    const prevChatMode = this.chatMode;
    chatModeSelect.addEventListener('change', async () => {
      const mode = chatModeSelect.value as ChatMode;
      try {
        await ApiClient.put('/admin/settings/party_chat_mode', { mode });
        this.chatMode = mode;
        const labels: Record<ChatMode, string> = {
          everyone: 'Everyone',
          staff: 'Staff Only',
          admin_only: 'Admin Only',
          disabled: 'Disabled',
        };
        this.notifications.success(`Party chat set to: ${labels[mode]}`);
      } catch {
        chatModeSelect.value = prevChatMode;
        this.notifications.error('Failed to update setting');
      }
    });

    this.attachChatModeListener(
      card,
      '#select-lobby-chat-mode',
      'lobby_chat_mode',
      'Lobby chat',
      (m) => {
        this.lobbyChatMode = m;
      },
    );
    this.attachChatModeListener(card, '#select-dm-mode', 'dm_mode', 'Direct messages', (m) => {
      this.dmMode = m;
    });
    this.attachChatModeListener(card, '#select-emote-mode', 'emote_mode', 'In-game emotes', (m) => {
      this.emoteMode = m;
    });
    this.attachChatModeListener(
      card,
      '#select-spectator-chat-mode',
      'spectator_chat_mode',
      'Spectator chat',
      (m) => {
        this.spectatorChatMode = m;
      },
    );

    // XP multiplier save
    const xpSaveBtn = card.querySelector('#btn-save-xp-multiplier');
    const xpInput = card.querySelector('#input-xp-multiplier') as HTMLInputElement;
    xpSaveBtn?.addEventListener('click', async () => {
      const val = parseFloat(xpInput.value);
      if (isNaN(val) || val < 0 || val > 10) {
        this.notifications.error('Multiplier must be between 0 and 10');
        return;
      }
      try {
        await ApiClient.put('/admin/settings/xp_multiplier', { multiplier: val });
        this.xpMultiplier = val;
        this.notifications.success(`XP multiplier set to ${val}`);
      } catch {
        this.notifications.error('Failed to update XP multiplier');
      }
    });

    const themeSelect = card.querySelector('#select-default-theme') as HTMLSelectElement;
    themeSelect?.addEventListener('change', async () => {
      const val = themeSelect.value;
      try {
        await ApiClient.put('/admin/settings/default_theme', { theme: val });
        this.defaultTheme = val as ThemeId;
        this.notifications.success(`Default theme set to ${THEME_NAMES[val as ThemeId]}`);
      } catch {
        this.notifications.error('Failed to update default theme');
      }
    });

    // GitHub display toggle
    card.querySelector('#toggle-display-github')!.addEventListener('change', async (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      try {
        await ApiClient.put('/admin/settings/display_github', { enabled });
        this.displayGithub = enabled;
        this.notifications.success(`GitHub link ${enabled ? 'enabled' : 'disabled'}`);
      } catch {
        (e.target as HTMLInputElement).checked = !enabled;
        this.notifications.error('Failed to update setting');
      }
    });

    // Imprint toggle + text
    const imprintToggle = card.querySelector('#toggle-display-imprint') as HTMLInputElement;
    const imprintTextGroup = card.querySelector('#imprint-text-group') as HTMLElement;
    imprintToggle.addEventListener('change', async () => {
      const enabled = imprintToggle.checked;
      const text = (card.querySelector('#input-imprint-text') as HTMLTextAreaElement).value;
      try {
        await ApiClient.put('/admin/settings/imprint', { enabled, text });
        this.displayImprint = enabled;
        this.imprintText = text;
        imprintTextGroup.style.display = enabled ? '' : 'none';
        this.notifications.success(`Imprint ${enabled ? 'enabled' : 'disabled'}`);
      } catch {
        imprintToggle.checked = !enabled;
        this.notifications.error('Failed to update setting');
      }
    });

    card.querySelector('#btn-save-imprint')?.addEventListener('click', async () => {
      const text = (card.querySelector('#input-imprint-text') as HTMLTextAreaElement).value;
      try {
        await ApiClient.put('/admin/settings/imprint', { enabled: this.displayImprint, text });
        this.imprintText = text;
        this.notifications.success('Imprint text saved');
      } catch {
        this.notifications.error('Failed to save imprint text');
      }
    });

    this.attachEmailSettingsListeners(card);
    this.attachDefaultsListeners(card, 'game');
    this.attachDefaultsListeners(card, 'simulation');
  }

  private attachChatModeListener(
    card: HTMLElement,
    selector: string,
    settingKey: string,
    label: string,
    onSuccess: (mode: ChatMode) => void,
  ): void {
    const select = card.querySelector(selector) as HTMLSelectElement;
    if (!select) return;
    const prev = select.value;
    select.addEventListener('change', async () => {
      const mode = select.value as ChatMode;
      try {
        await ApiClient.put(`/admin/settings/${settingKey}`, { mode });
        onSuccess(mode);
        const labels: Record<ChatMode, string> = {
          everyone: 'Everyone',
          staff: 'Staff Only',
          admin_only: 'Admin Only',
          disabled: 'Disabled',
        };
        this.notifications.success(`${label} set to: ${labels[mode]}`);
      } catch {
        select.value = prev;
        this.notifications.error('Failed to update setting');
      }
    });
  }

  private renderEmailSettingsSection(): string {
    const s = this.emailSettings;
    const configured = !!s.smtpHost;
    const statusDot = configured
      ? '<span class="status-indicator active" title="SMTP configured"></span>'
      : '<span class="status-indicator inactive" title="SMTP not configured"></span>';

    return `
      <div class="collapsible-section">
        <button id="email-toggle" class="collapsible-toggle">
          <span>${statusDot}Email / SMTP Settings</span>
          <span id="email-arrow" class="collapsible-arrow">&#9654;</span>
        </button>
        <div id="email-body" class="collapsible-body">
          <div class="form-grid-2col">
            <div class="form-group">
              <label>SMTP Host</label>
              <input type="text" id="email-smtpHost" value="${escapeAttr(s.smtpHost ?? '')}" placeholder="smtp.example.com">
            </div>
            <div class="form-group">
              <label>SMTP Port</label>
              <input type="number" id="email-smtpPort" value="${s.smtpPort ?? ''}" placeholder="587" min="1" max="65535">
            </div>
            <div class="form-group">
              <label>SMTP User</label>
              <input type="text" id="email-smtpUser" value="${escapeAttr(s.smtpUser ?? '')}" placeholder="user@example.com">
            </div>
            <div class="form-group">
              <label>SMTP Password</label>
              <div class="pw-field">
                <input type="password" id="email-smtpPassword" value="${escapeAttr(s.smtpPassword ?? '')}" placeholder="No password set">
                <button id="email-togglePw" type="button" class="pw-toggle">Show</button>
              </div>
            </div>
            <div class="form-group">
              <label>From Email</label>
              <input type="text" id="email-fromEmail" value="${escapeAttr(s.fromEmail ?? '')}" placeholder="noreply@example.com">
            </div>
            <div class="form-group">
              <label>From Name</label>
              <input type="text" id="email-fromName" value="${escapeAttr(s.fromName ?? '')}" placeholder="BlastArena">
            </div>
          </div>

          <div class="flex-row mt-md">
            <button id="email-save" class="btn btn-primary btn-sm">Save</button>
            <button id="email-reset" class="btn btn-secondary btn-sm">Reset to Defaults</button>
            <div class="flex-row ml-auto flex-gap-sm">
              <input type="email" id="email-testAddr" placeholder="test@example.com" class="admin-select" style="width:180px;">
              <button id="email-test" class="btn btn-secondary btn-sm nowrap">Send Test</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private attachEmailSettingsListeners(card: HTMLElement): void {
    const toggle = card.querySelector('#email-toggle') as HTMLElement;
    const body = card.querySelector('#email-body') as HTMLElement;
    const arrow = card.querySelector('#email-arrow') as HTMLElement;
    if (!toggle || !body) return;

    toggle.addEventListener('click', () => {
      const isHidden = getComputedStyle(body).display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      arrow.style.transform = isHidden ? 'rotate(90deg)' : '';
    });

    // Show/hide password
    const pwToggle = card.querySelector('#email-togglePw') as HTMLElement;
    const pwInput = card.querySelector('#email-smtpPassword') as HTMLInputElement;
    pwToggle?.addEventListener('click', () => {
      const show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      pwToggle.textContent = show ? 'Hide' : 'Show';
    });

    // Save
    card.querySelector('#email-save')!.addEventListener('click', async () => {
      const settings: EmailSettings = {};
      const host = (card.querySelector('#email-smtpHost') as HTMLInputElement).value.trim();
      if (host) settings.smtpHost = host;
      const port = (card.querySelector('#email-smtpPort') as HTMLInputElement).value;
      if (port) settings.smtpPort = parseInt(port);
      const user = (card.querySelector('#email-smtpUser') as HTMLInputElement).value.trim();
      if (user) settings.smtpUser = user;
      const password = (card.querySelector('#email-smtpPassword') as HTMLInputElement).value;
      settings.smtpPassword = password; // Send as-is: masked value preserves, empty clears, new value updates
      const fromEmail = (card.querySelector('#email-fromEmail') as HTMLInputElement).value.trim();
      if (fromEmail) settings.fromEmail = fromEmail;
      const fromName = (card.querySelector('#email-fromName') as HTMLInputElement).value.trim();
      if (fromName) settings.fromName = fromName;

      try {
        await ApiClient.put('/admin/settings/email_settings', settings);
        this.notifications.success('Email settings saved');
        // Reload to get masked password back
        const resp = await ApiClient.get<{ settings: EmailSettings }>(
          '/admin/settings/email_settings',
        );
        this.emailSettings = resp.settings ?? {};
        this.renderSettingsCard();
      } catch {
        this.notifications.error('Failed to save email settings');
      }
    });

    // Reset
    card.querySelector('#email-reset')!.addEventListener('click', async () => {
      try {
        await ApiClient.put('/admin/settings/email_settings', {});
        this.notifications.success('Email settings reset to .env defaults');
        const resp = await ApiClient.get<{ settings: EmailSettings }>(
          '/admin/settings/email_settings',
        );
        this.emailSettings = resp.settings ?? {};
        this.renderSettingsCard();
      } catch {
        this.notifications.error('Failed to reset email settings');
      }
    });

    // Test email
    card.querySelector('#email-test')!.addEventListener('click', async () => {
      const addr = (card.querySelector('#email-testAddr') as HTMLInputElement).value.trim();
      if (!addr) {
        this.notifications.error('Enter an email address for the test');
        return;
      }
      try {
        await ApiClient.post('/admin/settings/email_settings/test', { to: addr });
        this.notifications.success(`Test email sent to ${addr}`);
      } catch (err: any) {
        const msg = err?.error || err?.message || 'Failed to send test email';
        this.notifications.error(msg);
      }
    });
  }

  private renderDefaultsSection(type: 'game' | 'simulation'): string {
    const prefix = type === 'game' ? 'gd' : 'sd';
    const title = type === 'game' ? 'Game Creation Defaults' : 'Simulation Defaults';
    const defaults = type === 'game' ? this.gameDefaults : this.simulationDefaults;
    const hasOverrides = Object.keys(defaults).length > 0;

    return `
      <div class="collapsible-section">
        <button id="${prefix}-toggle" class="collapsible-toggle">
          <span>${title} ${hasOverrides ? `<span class="override-badge">(${Object.keys(defaults).length} overrides)</span>` : ''}</span>
          <span id="${prefix}-arrow" class="collapsible-arrow">&#9654;</span>
        </button>
        <div id="${prefix}-body" class="collapsible-body">
          ${this.renderDefaultsForm(prefix, defaults, type, this.activeAIs)}
        </div>
      </div>
    `;
  }

  private renderDefaultsForm(
    prefix: string,
    defaults: SimulationDefaults,
    type: 'game' | 'simulation',
    activeAIs: BotAIEntry[] = [],
  ): string {
    const sel = (
      id: string,
      options: { value: string; label: string }[],
      current?: string | number,
    ) => {
      const val = current !== undefined ? String(current) : '';
      return `<select id="${id}" class="admin-select w-full">
        <option value="">— Default —</option>
        ${options.map((o) => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>`;
    };

    const chk = (id: string, label: string, color: string, value?: boolean) => {
      const checked = value === true ? 'checked' : '';
      const indeterminate = value === undefined;
      return `<label class="option-label">
        <input type="checkbox" id="${id}" ${checked} ${indeterminate ? 'data-indeterminate="true"' : ''} style="accent-color:${color};">
        <span style="color:${color};font-weight:600;">${label}</span>
        ${indeterminate ? '<span class="default-indicator">(default)</span>' : ''}
      </label>`;
    };

    const gameModes = [
      { value: 'ffa', label: 'Free for All' },
      { value: 'teams', label: 'Teams' },
      { value: 'battle_royale', label: 'Battle Royale' },
      { value: 'sudden_death', label: 'Sudden Death' },
      { value: 'deathmatch', label: 'Deathmatch' },
      { value: 'king_of_the_hill', label: 'King of the Hill' },
    ];
    const maxPlayersOpts = [2, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }));
    const roundTimeOpts = [
      { value: '60', label: '1 min' },
      { value: '120', label: '2 min' },
      { value: '180', label: '3 min' },
      { value: '300', label: '5 min' },
      { value: '600', label: '10 min' },
    ];
    const mapSizeOpts = [
      { value: '21', label: '21x21' },
      { value: '31', label: '31x31' },
      { value: '39', label: '39x39' },
      { value: '51', label: '51x51' },
      { value: '61', label: '61x61' },
    ];
    const wallDensityOpts = [
      { value: '0.3', label: '30%' },
      { value: '0.5', label: '50%' },
      { value: '0.65', label: '65%' },
      { value: '0.8', label: '80%' },
    ];
    const powerUpRateOpts = [
      { value: '0', label: 'None' },
      { value: '0.15', label: '15%' },
      { value: '0.3', label: '30%' },
      { value: '0.5', label: '50%' },
      { value: '0.8', label: '80%' },
    ];
    const minBots = type === 'simulation' ? 2 : 0;
    const maxBots = type === 'simulation' ? 8 : 7;
    const botCountOpts = Array.from({ length: maxBots - minBots + 1 }, (_, i) => {
      const n = i + minBots;
      return { value: String(n), label: n === 0 ? 'None' : `${n}` };
    });
    const botDiffOpts = [
      { value: 'easy', label: 'Easy' },
      { value: 'normal', label: 'Normal' },
      { value: 'hard', label: 'Hard' },
    ];

    let simExtra = '';
    if (type === 'simulation') {
      const sd = defaults as SimulationDefaults;
      const speedOpts = [
        { value: 'fast', label: 'Fast' },
        { value: 'realtime', label: 'Real-time' },
      ];
      const verbOpts = [
        { value: 'normal', label: 'Normal' },
        { value: 'detailed', label: 'Detailed' },
        { value: 'full', label: 'Full' },
      ];
      simExtra = `
        <div class="form-group">
          <label>Total Games</label>
          <input type="number" id="${prefix}-totalGames" value="${sd.totalGames ?? ''}" min="1" max="1000" placeholder="Default (10)"
            class="admin-select w-full">
        </div>
        <div class="form-group">
          <label>Speed</label>
          ${sel(`${prefix}-speed`, speedOpts, sd.speed)}
        </div>
        <div class="form-group">
          <label>Log Verbosity</label>
          ${sel(`${prefix}-logVerbosity`, verbOpts, sd.logVerbosity)}
        </div>
      `;
    }

    const enabledSet = defaults.enabledPowerUps ? new Set(defaults.enabledPowerUps) : null;

    return `
      <div class="form-grid">
        <div class="form-group">
          <label>Game Mode</label>
          ${sel(`${prefix}-gameMode`, gameModes, defaults.gameMode)}
        </div>
        ${
          type === 'game'
            ? `<div class="form-group">
          <label>Max Players</label>
          ${sel(`${prefix}-maxPlayers`, maxPlayersOpts, defaults.maxPlayers)}
        </div>`
            : ''
        }
        <div class="form-group">
          <label>Match Time</label>
          ${sel(`${prefix}-roundTime`, roundTimeOpts, defaults.roundTime)}
        </div>
        <div class="form-group">
          <label>Map Size</label>
          ${sel(`${prefix}-mapWidth`, mapSizeOpts, defaults.mapWidth)}
        </div>
        <div class="form-group">
          <label>Wall Density</label>
          ${sel(`${prefix}-wallDensity`, wallDensityOpts, defaults.wallDensity)}
        </div>
        <div class="form-group">
          <label>Power-Up Rate</label>
          ${sel(`${prefix}-powerUpDropRate`, powerUpRateOpts, defaults.powerUpDropRate)}
        </div>
        <div class="form-group">
          <label>Bots</label>
          ${sel(`${prefix}-botCount`, botCountOpts, defaults.botCount)}
        </div>
        <div class="form-group">
          <label>Bot Difficulty</label>
          ${sel(`${prefix}-botDifficulty`, botDiffOpts, defaults.botDifficulty)}
        </div>
        ${
          activeAIs.length > 1
            ? `<div class="form-group">
          <label>Bot AI</label>
          ${sel(
            `${prefix}-botAiId`,
            activeAIs.map((ai) => ({ value: ai.id, label: ai.name })),
            defaults.botAiId,
          )}
        </div>`
            : ''
        }
        ${simExtra}
      </div>

      <div class="flex-wrap mt-sm">
        ${chk(`${prefix}-reinforcedWalls`, 'Reinforced Walls', '#b8884d', defaults.reinforcedWalls)}
        ${chk(`${prefix}-enableMapEvents`, 'Map Events', 'var(--warning)', defaults.enableMapEvents)}
        ${chk(`${prefix}-hazardTiles`, 'Hazard Tiles', 'var(--info)', defaults.hazardTiles)}
        ${chk(`${prefix}-friendlyFire`, 'Friendly Fire', 'var(--danger)', defaults.friendlyFire)}
        ${type === 'simulation' ? chk(`${prefix}-recordReplays`, 'Record Replays', 'var(--accent)', (defaults as SimulationDefaults).recordReplays) : ''}
      </div>

      <div class="mt-sm">
        <div class="subsection-label">Power-Ups</div>
        <div class="flex-wrap flex-gap-sm">
          ${ALL_POWER_UPS.map((pu) => {
            const checked = enabledSet ? enabledSet.has(pu.type) : true;
            const indeterminate = enabledSet === null;
            return `<label class="option-label-sm">
              <input type="checkbox" class="${prefix}-powerup-check" value="${pu.type}" ${checked ? 'checked' : ''} ${indeterminate ? 'data-indeterminate="true"' : ''}
                style="accent-color:${pu.color};">
              <span style="color:${pu.color};font-weight:600;">${pu.name}</span>
            </label>`;
          }).join('')}
        </div>
      </div>

      <div class="flex-row mt-md">
        <button id="${prefix}-save" class="btn btn-primary btn-sm">Save</button>
        <button id="${prefix}-reset" class="btn btn-secondary btn-sm">Reset to Defaults</button>
      </div>
    `;
  }

  private attachDefaultsListeners(card: HTMLElement, type: 'game' | 'simulation'): void {
    const prefix = type === 'game' ? 'gd' : 'sd';
    const endpoint =
      type === 'game' ? '/admin/settings/game_defaults' : '/admin/settings/simulation_defaults';

    // Toggle expand/collapse
    const toggle = card.querySelector(`#${prefix}-toggle`) as HTMLElement;
    const body = card.querySelector(`#${prefix}-body`) as HTMLElement;
    const arrow = card.querySelector(`#${prefix}-arrow`) as HTMLElement;
    toggle.addEventListener('click', () => {
      const isHidden = getComputedStyle(body).display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      arrow.style.transform = isHidden ? 'rotate(90deg)' : '';
    });

    // Save
    card.querySelector(`#${prefix}-save`)!.addEventListener('click', async () => {
      const defaults = this.collectDefaults(card, prefix, type);
      try {
        await ApiClient.put(endpoint, { defaults });
        if (type === 'game') {
          this.gameDefaults = defaults;
        } else {
          this.simulationDefaults = defaults;
        }
        this.notifications.success(`${type === 'game' ? 'Game' : 'Simulation'} defaults saved`);
        // Re-render to update override count
        this.renderSettingsCard();
      } catch {
        this.notifications.error(`Failed to save ${type} defaults`);
      }
    });

    // Reset
    card.querySelector(`#${prefix}-reset`)!.addEventListener('click', async () => {
      try {
        await ApiClient.put(endpoint, { defaults: {} });
        if (type === 'game') {
          this.gameDefaults = {};
        } else {
          this.simulationDefaults = {};
        }
        this.notifications.success(`${type === 'game' ? 'Game' : 'Simulation'} defaults reset`);
        this.renderSettingsCard();
      } catch {
        this.notifications.error(`Failed to reset ${type} defaults`);
      }
    });
  }

  private collectDefaults(
    card: HTMLElement,
    prefix: string,
    type: 'game' | 'simulation',
  ): SimulationDefaults {
    const defaults: SimulationDefaults = {};

    const getSelect = (field: string) => {
      const el = card.querySelector(`#${prefix}-${field}`) as HTMLSelectElement | null;
      return el?.value || '';
    };
    const gameMode = getSelect('gameMode');
    if (gameMode) defaults.gameMode = gameMode as GameDefaults['gameMode'];

    const maxPlayers = getSelect('maxPlayers');
    if (maxPlayers) defaults.maxPlayers = parseInt(maxPlayers);

    const roundTime = getSelect('roundTime');
    if (roundTime) defaults.roundTime = parseInt(roundTime);

    const mapWidth = getSelect('mapWidth');
    if (mapWidth) defaults.mapWidth = parseInt(mapWidth);

    const wallDensity = getSelect('wallDensity');
    if (wallDensity) defaults.wallDensity = parseFloat(wallDensity);

    const powerUpDropRate = getSelect('powerUpDropRate');
    if (powerUpDropRate !== '') defaults.powerUpDropRate = parseFloat(powerUpDropRate);

    const botCount = getSelect('botCount');
    if (botCount) defaults.botCount = parseInt(botCount);

    const botDifficulty = getSelect('botDifficulty');
    if (botDifficulty) defaults.botDifficulty = botDifficulty as GameDefaults['botDifficulty'];

    const botAiId = getSelect('botAiId');
    if (botAiId) defaults.botAiId = botAiId;

    // Checkboxes: only include if not at indeterminate (data-indeterminate means "use default")
    const boolFields = [
      'reinforcedWalls',
      'enableMapEvents',
      'hazardTiles',
      'friendlyFire',
    ] as const;
    for (const field of boolFields) {
      const el = card.querySelector(`#${prefix}-${field}`) as HTMLInputElement | null;
      if (el && !el.dataset.indeterminate) {
        defaults[field] = el.checked;
      }
    }

    // Power-ups: only include if any are unchecked (i.e. user made a deliberate choice)
    const checks = card.querySelectorAll(`.${prefix}-powerup-check`);
    const allChecked = Array.from(checks).every((c) => (c as HTMLInputElement).checked);
    const hasIndeterminate = Array.from(checks).some(
      (c) => (c as HTMLInputElement).dataset.indeterminate,
    );
    if (!allChecked || !hasIndeterminate) {
      defaults.enabledPowerUps = Array.from(checks)
        .filter((c) => (c as HTMLInputElement).checked)
        .map((c) => (c as HTMLInputElement).value as PowerUpType);
    }

    if (type === 'simulation') {
      const totalGames = (card.querySelector(`#${prefix}-totalGames`) as HTMLInputElement)?.value;
      if (totalGames) defaults.totalGames = parseInt(totalGames);

      const speed = getSelect('speed');
      if (speed) defaults.speed = speed as SimulationDefaults['speed'];

      const logVerbosity = getSelect('logVerbosity');
      if (logVerbosity) defaults.logVerbosity = logVerbosity as SimulationDefaults['logVerbosity'];

      const recordEl = card.querySelector(`#${prefix}-recordReplays`) as HTMLInputElement | null;
      if (recordEl && !recordEl.dataset.indeterminate) {
        defaults.recordReplays = recordEl.checked;
      }
    }

    return defaults;
  }

  private async loadStats(): Promise<void> {
    if (!this.container) return;
    try {
      const stats = await ApiClient.get<any>('/admin/stats');

      // Remove existing stats if re-rendering
      this.container.querySelector('.admin-stats')?.remove();

      const statsDiv = document.createElement('div');
      statsDiv.className = 'admin-stats';
      statsDiv.innerHTML = `
        <div class="stat-card">
          <div class="stat-value">${stats.totalUsers}</div>
          <div class="stat-label">Total Users</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activeUsers24h}</div>
          <div class="stat-label">Active (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalMatches}</div>
          <div class="stat-label">Total Matches</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activeRooms}</div>
          <div class="stat-label">Active Rooms</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activePlayers}</div>
          <div class="stat-label">Online Players</div>
        </div>
      `;

      // Insert stats at the top, before settings card
      const settingsCard = this.container.querySelector('#server-settings-card');
      if (settingsCard) {
        this.container.insertBefore(statsDiv, settingsCard);
      } else {
        this.container.appendChild(statsDiv);
      }
    } catch {
      this.notifications.error('Failed to load stats');
    }
  }
}
