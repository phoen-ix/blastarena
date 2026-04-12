import { ApiClient } from '../../network/ApiClient';
import { escapeAttr, escapeHtml } from '../../utils/html';
import { createModal } from '../../utils/modal';
import { t } from '../../i18n';
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
  private owSettings: {
    enabled: boolean;
    guestAccess: boolean;
    maxPlayers: number;
    roundTime: number;
    mapWidth: number;
    mapHeight: number;
    wallDensity: number;
    respawnDelay: number;
    afkTimeoutSeconds: number;
  } = {
    enabled: true,
    guestAccess: true,
    maxPlayers: 32,
    roundTime: 300,
    mapWidth: 51,
    mapHeight: 41,
    wallDensity: 0.5,
    respawnDelay: 3,
    afkTimeoutSeconds: 60,
  };

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
    // Open world settings
    try {
      const owResp = await ApiClient.get<typeof this.owSettings>('/admin/settings/open_world');
      this.owSettings = owResp;
    } catch {
      // Leave defaults
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
      <h3>${t('admin:dashboard.serverSettings')}</h3>
      <div class="settings-grid">
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-recordings" ${this.recordingsEnabled ? 'checked' : ''}>
            <span class="setting-item-label">${t('admin:dashboard.matchRecordings')}</span>
          </label>
          <span class="setting-item-desc">${t('admin:dashboard.matchRecordingsDesc')}</span>
        </div>
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-registration" ${this.registrationEnabled ? 'checked' : ''}>
            <span class="setting-item-label">${t('admin:dashboard.userRegistration')}</span>
          </label>
          <span class="setting-item-desc">${t('admin:dashboard.userRegistrationDesc')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">${t('admin:dashboard.partyChat')}</span>
          <select id="select-chat-mode" class="admin-select" aria-label="${t('admin:dashboard.partyChat')}">
            <option value="everyone" ${this.chatMode === 'everyone' ? 'selected' : ''}>${t('admin:dashboard.chatModeEveryone')}</option>
            <option value="staff" ${this.chatMode === 'staff' ? 'selected' : ''}>${t('admin:dashboard.chatModeStaff')}</option>
            <option value="admin_only" ${this.chatMode === 'admin_only' ? 'selected' : ''}>${t('admin:dashboard.chatModeAdminOnly')}</option>
            <option value="disabled" ${this.chatMode === 'disabled' ? 'selected' : ''}>${t('admin:dashboard.chatModeDisabled')}</option>
          </select>
          <span class="setting-item-desc">${t('admin:dashboard.partyChatDesc')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">${t('admin:dashboard.lobbyChat')}</span>
          <select id="select-lobby-chat-mode" class="admin-select" aria-label="${t('admin:dashboard.lobbyChat')}">
            <option value="everyone" ${this.lobbyChatMode === 'everyone' ? 'selected' : ''}>${t('admin:dashboard.chatModeEveryone')}</option>
            <option value="staff" ${this.lobbyChatMode === 'staff' ? 'selected' : ''}>${t('admin:dashboard.chatModeStaff')}</option>
            <option value="admin_only" ${this.lobbyChatMode === 'admin_only' ? 'selected' : ''}>${t('admin:dashboard.chatModeAdminOnly')}</option>
            <option value="disabled" ${this.lobbyChatMode === 'disabled' ? 'selected' : ''}>${t('admin:dashboard.chatModeDisabled')}</option>
          </select>
          <span class="setting-item-desc">${t('admin:dashboard.lobbyChatDesc')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">${t('admin:dashboard.directMessages')}</span>
          <select id="select-dm-mode" class="admin-select" aria-label="${t('admin:dashboard.directMessages')}">
            <option value="everyone" ${this.dmMode === 'everyone' ? 'selected' : ''}>${t('admin:dashboard.chatModeEveryone')}</option>
            <option value="staff" ${this.dmMode === 'staff' ? 'selected' : ''}>${t('admin:dashboard.chatModeStaff')}</option>
            <option value="admin_only" ${this.dmMode === 'admin_only' ? 'selected' : ''}>${t('admin:dashboard.chatModeAdminOnly')}</option>
            <option value="disabled" ${this.dmMode === 'disabled' ? 'selected' : ''}>${t('admin:dashboard.chatModeDisabled')}</option>
          </select>
          <span class="setting-item-desc">${t('admin:dashboard.directMessagesDesc')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">${t('admin:dashboard.inGameEmotes')}</span>
          <select id="select-emote-mode" class="admin-select" aria-label="${t('admin:dashboard.inGameEmotes')}">
            <option value="everyone" ${this.emoteMode === 'everyone' ? 'selected' : ''}>${t('admin:dashboard.chatModeEveryone')}</option>
            <option value="staff" ${this.emoteMode === 'staff' ? 'selected' : ''}>${t('admin:dashboard.chatModeStaff')}</option>
            <option value="admin_only" ${this.emoteMode === 'admin_only' ? 'selected' : ''}>${t('admin:dashboard.chatModeAdminOnly')}</option>
            <option value="disabled" ${this.emoteMode === 'disabled' ? 'selected' : ''}>${t('admin:dashboard.chatModeDisabled')}</option>
          </select>
          <span class="setting-item-desc">${t('admin:dashboard.inGameEmotesDesc')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">${t('admin:dashboard.spectatorChat')}</span>
          <select id="select-spectator-chat-mode" class="admin-select" aria-label="${t('admin:dashboard.spectatorChat')}">
            <option value="everyone" ${this.spectatorChatMode === 'everyone' ? 'selected' : ''}>${t('admin:dashboard.chatModeEveryone')}</option>
            <option value="staff" ${this.spectatorChatMode === 'staff' ? 'selected' : ''}>${t('admin:dashboard.chatModeStaff')}</option>
            <option value="admin_only" ${this.spectatorChatMode === 'admin_only' ? 'selected' : ''}>${t('admin:dashboard.chatModeAdminOnly')}</option>
            <option value="disabled" ${this.spectatorChatMode === 'disabled' ? 'selected' : ''}>${t('admin:dashboard.chatModeDisabled')}</option>
          </select>
          <span class="setting-item-desc">${t('admin:dashboard.spectatorChatDesc')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">${t('admin:dashboard.xpMultiplier')}</span>
          <input id="input-xp-multiplier" type="number" min="0" max="10" step="0.1" value="${this.xpMultiplier}"
            class="admin-select" style="width:60px;" aria-label="${t('admin:dashboard.xpMultiplier')}">
          <button id="btn-save-xp-multiplier" class="btn btn-primary btn-sm">${t('admin:dashboard.save')}</button>
          <span class="setting-item-desc">${t('admin:dashboard.xpMultiplierDesc')}</span>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">${t('admin:dashboard.defaultTheme')}</span>
          <select id="select-default-theme" class="admin-select" aria-label="${t('admin:dashboard.defaultTheme')}">
            ${THEME_IDS.map((id) => `<option value="${id}" ${this.defaultTheme === id ? 'selected' : ''}>${THEME_NAMES[id]}</option>`).join('')}
          </select>
          <span class="setting-item-desc">${t('admin:dashboard.defaultThemeDesc')}</span>
        </div>
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-display-github" ${this.displayGithub ? 'checked' : ''}>
            <span class="setting-item-label">${t('admin:dashboard.displayGithubLink')}</span>
          </label>
          <span class="setting-item-desc">${t('admin:dashboard.displayGithubLinkDesc')}</span>
        </div>
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="toggle-display-imprint" ${this.displayImprint ? 'checked' : ''}>
            <span class="setting-item-label">${t('admin:dashboard.displayImprint')}</span>
          </label>
          <span class="setting-item-desc">${t('admin:dashboard.displayImprintDesc')}</span>
        </div>
        <div class="setting-item" id="imprint-text-group" style="${this.displayImprint ? '' : 'display:none;'}">
          <span class="setting-item-label">${t('admin:dashboard.imprintText')}</span>
          <textarea id="input-imprint-text" class="admin-select" rows="4" aria-label="${t('admin:dashboard.imprintText')}" style="width:100%;resize:vertical;font-family:var(--font-body);font-size:13px;padding:var(--sp-2) var(--sp-3);background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);">${escapeHtml(this.imprintText)}</textarea>
          <button id="btn-save-imprint" class="btn btn-primary btn-sm" style="margin-top:var(--sp-2);">${t('admin:dashboard.saveImprint')}</button>
        </div>
      </div>

      <h3 style="margin-top:var(--sp-4);">Open World</h3>
      <div class="settings-grid" id="ow-settings-grid">
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="ow-enabled" ${this.owSettings.enabled ? 'checked' : ''}>
            <span class="setting-item-label">Enabled</span>
          </label>
        </div>
        <div class="setting-item">
          <label class="setting-item-checkbox">
            <input type="checkbox" id="ow-guest-access" ${this.owSettings.guestAccess ? 'checked' : ''}>
            <span class="setting-item-label">Guest Access</span>
          </label>
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Max Players</span>
          <input id="ow-max-players" type="number" min="2" max="50" value="${this.owSettings.maxPlayers}" class="admin-select" style="width:70px;">
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Round Time (s)</span>
          <input id="ow-round-time" type="number" min="60" max="3600" value="${this.owSettings.roundTime}" class="admin-select" style="width:80px;">
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Map Width</span>
          <input id="ow-map-width" type="number" min="21" max="101" step="2" value="${this.owSettings.mapWidth}" class="admin-select" style="width:70px;">
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Map Height</span>
          <input id="ow-map-height" type="number" min="21" max="101" step="2" value="${this.owSettings.mapHeight}" class="admin-select" style="width:70px;">
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Wall Density</span>
          <input id="ow-wall-density" type="number" min="0.1" max="0.9" step="0.1" value="${this.owSettings.wallDensity}" class="admin-select" style="width:70px;">
        </div>
        <div class="setting-item">
          <span class="setting-item-label">Respawn Delay (s)</span>
          <input id="ow-respawn-delay" type="number" min="1" max="30" value="${this.owSettings.respawnDelay}" class="admin-select" style="width:70px;">
        </div>
        <div class="setting-item">
          <span class="setting-item-label">AFK Timeout (s)</span>
          <input id="ow-afk-timeout" type="number" min="0" max="600" value="${this.owSettings.afkTimeoutSeconds}" class="admin-select" style="width:70px;" title="0 = disabled">
        </div>
        <div class="setting-item">
          <button id="ow-save-btn" class="btn btn-primary" style="padding:6px 16px;font-size:13px;">Save Open World Settings</button>
        </div>
      </div>

      <div class="danger-zone">
        <h4 style="color:var(--danger);margin-bottom:var(--sp-2);">${t('admin:dashboard.dangerZone')}</h4>
        <div class="setting-item" style="border:1px solid var(--danger);border-radius:var(--radius-sm);padding:var(--sp-3);">
          <div style="flex:1;">
            <span class="setting-item-label">${t('admin:dashboard.revokeAllSessions')}</span>
            <span class="setting-item-desc">${t('admin:dashboard.revokeAllDescription')}</span>
          </div>
          <button id="btn-revoke-all-sessions" class="btn-danger" style="padding:6px 12px;font-size:13px;white-space:nowrap;">${t('admin:dashboard.revokeAllSessions')}</button>
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
        this.notifications.success(
          t('admin:dashboard.recordingsToggled', {
            status: enabled ? t('admin:dashboard.enabled') : t('admin:dashboard.disabled'),
          }),
        );
      } catch {
        (e.target as HTMLInputElement).checked = !enabled;
        this.notifications.error(t('admin:dashboard.failedUpdateSetting'));
      }
    });

    card.querySelector('#toggle-registration')!.addEventListener('change', async (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      try {
        await ApiClient.put('/admin/settings/registration_enabled', { enabled });
        this.registrationEnabled = enabled;
        this.notifications.success(
          t('admin:dashboard.registrationToggled', {
            status: enabled ? t('admin:dashboard.enabled') : t('admin:dashboard.disabled'),
          }),
        );
      } catch {
        (e.target as HTMLInputElement).checked = !enabled;
        this.notifications.error(t('admin:dashboard.failedUpdateSetting'));
      }
    });

    card.querySelector('#btn-revoke-all-sessions')!.addEventListener('click', () => {
      this.showRevokeAllModal();
    });

    // Open World save
    card.querySelector('#ow-save-btn')?.addEventListener('click', async () => {
      const settings = {
        enabled: (card.querySelector('#ow-enabled') as HTMLInputElement).checked,
        guestAccess: (card.querySelector('#ow-guest-access') as HTMLInputElement).checked,
        maxPlayers: parseInt((card.querySelector('#ow-max-players') as HTMLInputElement).value),
        roundTime: parseInt((card.querySelector('#ow-round-time') as HTMLInputElement).value),
        mapWidth: parseInt((card.querySelector('#ow-map-width') as HTMLInputElement).value),
        mapHeight: parseInt((card.querySelector('#ow-map-height') as HTMLInputElement).value),
        wallDensity: parseFloat((card.querySelector('#ow-wall-density') as HTMLInputElement).value),
        respawnDelay: parseInt((card.querySelector('#ow-respawn-delay') as HTMLInputElement).value),
        afkTimeoutSeconds: parseInt(
          (card.querySelector('#ow-afk-timeout') as HTMLInputElement).value,
        ),
      };
      try {
        await ApiClient.put('/admin/settings/open_world', settings);
        this.owSettings = settings;
        this.notifications.success('Open World settings saved');
      } catch {
        this.notifications.error('Failed to save Open World settings');
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
          everyone: t('admin:dashboard.chatModeEveryone'),
          staff: t('admin:dashboard.chatModeStaffShort'),
          admin_only: t('admin:dashboard.chatModeAdminOnly'),
          disabled: t('admin:dashboard.chatModeDisabled'),
        };
        this.notifications.success(t('admin:dashboard.partyChatSetTo', { mode: labels[mode] }));
      } catch {
        chatModeSelect.value = prevChatMode;
        this.notifications.error(t('admin:dashboard.failedUpdateSetting'));
      }
    });

    this.attachChatModeListener(
      card,
      '#select-lobby-chat-mode',
      'lobby_chat_mode',
      t('admin:dashboard.lobbyChatLabel'),
      (m) => {
        this.lobbyChatMode = m;
      },
    );
    this.attachChatModeListener(
      card,
      '#select-dm-mode',
      'dm_mode',
      t('admin:dashboard.directMessagesLabel'),
      (m) => {
        this.dmMode = m;
      },
    );
    this.attachChatModeListener(
      card,
      '#select-emote-mode',
      'emote_mode',
      t('admin:dashboard.inGameEmotesLabel'),
      (m) => {
        this.emoteMode = m;
      },
    );
    this.attachChatModeListener(
      card,
      '#select-spectator-chat-mode',
      'spectator_chat_mode',
      t('admin:dashboard.spectatorChatLabel'),
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
        this.notifications.error(t('admin:dashboard.xpMultiplierRange'));
        return;
      }
      try {
        await ApiClient.put('/admin/settings/xp_multiplier', { multiplier: val });
        this.xpMultiplier = val;
        this.notifications.success(t('admin:dashboard.xpMultiplierSet', { value: val }));
      } catch {
        this.notifications.error(t('admin:dashboard.failedUpdateXpMultiplier'));
      }
    });

    const themeSelect = card.querySelector('#select-default-theme') as HTMLSelectElement;
    themeSelect?.addEventListener('change', async () => {
      const val = themeSelect.value;
      try {
        await ApiClient.put('/admin/settings/default_theme', { theme: val });
        this.defaultTheme = val as ThemeId;
        this.notifications.success(
          t('admin:dashboard.defaultThemeSet', { theme: THEME_NAMES[val as ThemeId] }),
        );
      } catch {
        this.notifications.error(t('admin:dashboard.failedUpdateDefaultTheme'));
      }
    });

    // GitHub display toggle
    card.querySelector('#toggle-display-github')!.addEventListener('change', async (e) => {
      const enabled = (e.target as HTMLInputElement).checked;
      try {
        await ApiClient.put('/admin/settings/display_github', { enabled });
        this.displayGithub = enabled;
        this.notifications.success(
          t('admin:dashboard.githubLinkToggled', {
            status: enabled ? t('admin:dashboard.enabled') : t('admin:dashboard.disabled'),
          }),
        );
      } catch {
        (e.target as HTMLInputElement).checked = !enabled;
        this.notifications.error(t('admin:dashboard.failedUpdateSetting'));
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
        this.notifications.success(
          t('admin:dashboard.imprintToggled', {
            status: enabled ? t('admin:dashboard.enabled') : t('admin:dashboard.disabled'),
          }),
        );
      } catch {
        imprintToggle.checked = !enabled;
        this.notifications.error(t('admin:dashboard.failedUpdateSetting'));
      }
    });

    card.querySelector('#btn-save-imprint')?.addEventListener('click', async () => {
      const text = (card.querySelector('#input-imprint-text') as HTMLTextAreaElement).value;
      try {
        await ApiClient.put('/admin/settings/imprint', { enabled: this.displayImprint, text });
        this.imprintText = text;
        this.notifications.success(t('admin:dashboard.imprintTextSaved'));
      } catch {
        this.notifications.error(t('admin:dashboard.failedSaveImprintText'));
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
        const modeLabels: Record<ChatMode, string> = {
          everyone: t('admin:dashboard.chatModeEveryone'),
          staff: t('admin:dashboard.chatModeStaffShort'),
          admin_only: t('admin:dashboard.chatModeAdminOnly'),
          disabled: t('admin:dashboard.chatModeDisabled'),
        };
        this.notifications.success(
          t('admin:dashboard.chatModeSetTo', { label, mode: modeLabels[mode] }),
        );
      } catch {
        select.value = prev;
        this.notifications.error(t('admin:dashboard.failedUpdateSetting'));
      }
    });
  }

  private showRevokeAllModal(): void {
    const { overlay, content, close } = createModal({
      ariaLabel: t('admin:dashboard.revokeAllSessions'),
      style: 'max-width:420px;',
      parent: document.getElementById('ui-overlay')!,
    });
    content.innerHTML = `
        <h2 style="margin-bottom:12px;color:var(--danger);">${t('admin:dashboard.revokeAllSessions')}</h2>
        <p style="color:var(--text-dim);font-size:14px;">${t('admin:dashboard.revokeAllDescription')}</p>
        <p style="color:var(--text-dim);font-size:13px;margin-top:8px;">${t('admin:dashboard.revokeAllConfirmPrompt')}</p>
        <input type="text" class="confirm-input" id="revoke-all-confirm-input" placeholder="CONFIRM" aria-label="${escapeAttr(t('admin:dashboard.revokeAllConfirmPrompt'))}">
        <div class="modal-actions" style="margin-top:16px;">
          <button class="btn btn-secondary" id="revoke-all-cancel">${t('admin:dashboard.revokeAllCancel')}</button>
          <button class="btn-danger" style="padding:8px 16px;font-size:14px;opacity:0.5;" id="revoke-all-confirm" disabled>${t('admin:dashboard.revokeAllConfirm')}</button>
        </div>
    `;

    const input = overlay.querySelector('#revoke-all-confirm-input') as HTMLInputElement;
    const confirmBtn = overlay.querySelector('#revoke-all-confirm') as HTMLButtonElement;

    input.addEventListener('input', () => {
      const matches = input.value === 'CONFIRM';
      confirmBtn.disabled = !matches;
      confirmBtn.style.opacity = matches ? '1' : '0.5';
    });

    overlay.querySelector('#revoke-all-cancel')!.addEventListener('click', close);
    confirmBtn.addEventListener('click', async () => {
      close();
      try {
        await ApiClient.post('/admin/revoke-all-sessions', {});
        this.notifications.success(t('admin:dashboard.revokeAllSuccess'));
      } catch {
        this.notifications.error(t('admin:dashboard.failedUpdateSetting'));
      }
    });
  }

  private renderEmailSettingsSection(): string {
    const s = this.emailSettings;
    const configured = !!s.smtpHost;
    const statusDot = configured
      ? `<span class="status-indicator active" title="${escapeAttr(t('admin:dashboard.smtpConfigured'))}"></span>`
      : `<span class="status-indicator inactive" title="${escapeAttr(t('admin:dashboard.smtpNotConfigured'))}"></span>`;

    return `
      <div class="collapsible-section">
        <button id="email-toggle" class="collapsible-toggle">
          <span>${statusDot}${t('admin:dashboard.emailSmtpSettings')}</span>
          <span id="email-arrow" class="collapsible-arrow">&#9654;</span>
        </button>
        <div id="email-body" class="collapsible-body">
          <div class="form-grid-2col">
            <div class="form-group">
              <label>${t('admin:dashboard.smtpHost')}</label>
              <input type="text" id="email-smtpHost" value="${escapeAttr(s.smtpHost ?? '')}" placeholder="${escapeAttr(t('admin:dashboard.smtpHostPlaceholder'))}">
            </div>
            <div class="form-group">
              <label>${t('admin:dashboard.smtpPort')}</label>
              <input type="number" id="email-smtpPort" value="${s.smtpPort ?? ''}" placeholder="587" min="1" max="65535">
            </div>
            <div class="form-group">
              <label>${t('admin:dashboard.smtpUser')}</label>
              <input type="text" id="email-smtpUser" value="${escapeAttr(s.smtpUser ?? '')}" placeholder="${escapeAttr(t('admin:dashboard.smtpUserPlaceholder'))}">
            </div>
            <div class="form-group">
              <label>${t('admin:dashboard.smtpPassword')}</label>
              <div class="pw-field">
                <input type="password" id="email-smtpPassword" value="${escapeAttr(s.smtpPassword ?? '')}" placeholder="${escapeAttr(t('admin:dashboard.noPasswordSet'))}">
                <button id="email-togglePw" type="button" class="pw-toggle">${t('admin:dashboard.showPassword')}</button>
              </div>
            </div>
            <div class="form-group">
              <label>${t('admin:dashboard.fromEmail')}</label>
              <input type="text" id="email-fromEmail" value="${escapeAttr(s.fromEmail ?? '')}" placeholder="${escapeAttr(t('admin:dashboard.fromEmailPlaceholder'))}">
            </div>
            <div class="form-group">
              <label>${t('admin:dashboard.fromName')}</label>
              <input type="text" id="email-fromName" value="${escapeAttr(s.fromName ?? '')}" placeholder="${escapeAttr(t('admin:dashboard.fromNamePlaceholder'))}">
            </div>
          </div>

          <div class="flex-row mt-md">
            <button id="email-save" class="btn btn-primary btn-sm">${t('admin:dashboard.save')}</button>
            <button id="email-reset" class="btn btn-secondary btn-sm">${t('admin:dashboard.resetToDefaults')}</button>
            <div class="flex-row ml-auto flex-gap-sm">
              <input type="email" id="email-testAddr" placeholder="${escapeAttr(t('admin:dashboard.testEmailPlaceholder'))}" class="admin-select" style="width:180px;">
              <button id="email-test" class="btn btn-secondary btn-sm nowrap">${t('admin:dashboard.sendTest')}</button>
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
      pwToggle.textContent = show
        ? t('admin:dashboard.hidePassword')
        : t('admin:dashboard.showPassword');
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
        this.notifications.success(t('admin:dashboard.emailSettingsSaved'));
        // Reload to get masked password back
        const resp = await ApiClient.get<{ settings: EmailSettings }>(
          '/admin/settings/email_settings',
        );
        this.emailSettings = resp.settings ?? {};
        this.renderSettingsCard();
      } catch {
        this.notifications.error(t('admin:dashboard.failedSaveEmailSettings'));
      }
    });

    // Reset
    card.querySelector('#email-reset')!.addEventListener('click', async () => {
      try {
        await ApiClient.put('/admin/settings/email_settings', {});
        this.notifications.success(t('admin:dashboard.emailSettingsReset'));
        const resp = await ApiClient.get<{ settings: EmailSettings }>(
          '/admin/settings/email_settings',
        );
        this.emailSettings = resp.settings ?? {};
        this.renderSettingsCard();
      } catch {
        this.notifications.error(t('admin:dashboard.failedResetEmailSettings'));
      }
    });

    // Test email
    card.querySelector('#email-test')!.addEventListener('click', async () => {
      const addr = (card.querySelector('#email-testAddr') as HTMLInputElement).value.trim();
      if (!addr) {
        this.notifications.error(t('admin:dashboard.enterTestEmailAddress'));
        return;
      }
      try {
        await ApiClient.post('/admin/settings/email_settings/test', { to: addr });
        this.notifications.success(t('admin:dashboard.testEmailSent', { address: addr }));
      } catch (err: any) {
        const msg = err?.error || err?.message || t('admin:dashboard.failedSendTestEmail');
        this.notifications.error(msg);
      }
    });
  }

  private renderDefaultsSection(type: 'game' | 'simulation'): string {
    const prefix = type === 'game' ? 'gd' : 'sd';
    const title =
      type === 'game'
        ? t('admin:dashboard.gameCreationDefaults')
        : t('admin:dashboard.simulationDefaults');
    const defaults = type === 'game' ? this.gameDefaults : this.simulationDefaults;
    const hasOverrides = Object.keys(defaults).length > 0;

    return `
      <div class="collapsible-section">
        <button id="${prefix}-toggle" class="collapsible-toggle">
          <span>${title} ${hasOverrides ? `<span class="override-badge">${t('admin:dashboard.overridesCount', { count: Object.keys(defaults).length })}</span>` : ''}</span>
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
        <option value="">${t('admin:dashboard.defaultOption')}</option>
        ${options.map((o) => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>`;
    };

    const chk = (id: string, label: string, color: string, value?: boolean) => {
      const checked = value === true ? 'checked' : '';
      const indeterminate = value === undefined;
      return `<label class="option-label">
        <input type="checkbox" id="${id}" ${checked} ${indeterminate ? 'data-indeterminate="true"' : ''} style="accent-color:${color};">
        <span style="color:${color};font-weight:600;">${label}</span>
        ${indeterminate ? `<span class="default-indicator">${t('admin:dashboard.defaultIndicator')}</span>` : ''}
      </label>`;
    };

    const gameModes = [
      { value: 'ffa', label: t('admin:dashboard.gameModeFfa') },
      { value: 'teams', label: t('admin:dashboard.gameModeTeams') },
      { value: 'battle_royale', label: t('admin:dashboard.gameModeBattleRoyale') },
      { value: 'sudden_death', label: t('admin:dashboard.gameModeSuddenDeath') },
      { value: 'deathmatch', label: t('admin:dashboard.gameModeDeathmatch') },
      { value: 'king_of_the_hill', label: t('admin:dashboard.gameModeKoth') },
    ];
    const maxPlayersOpts = [2, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }));
    const roundTimeOpts = [
      { value: '60', label: t('admin:dashboard.roundTime1min') },
      { value: '120', label: t('admin:dashboard.roundTime2min') },
      { value: '180', label: t('admin:dashboard.roundTime3min') },
      { value: '300', label: t('admin:dashboard.roundTime5min') },
      { value: '600', label: t('admin:dashboard.roundTime10min') },
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
      { value: '0', label: t('admin:dashboard.none') },
      { value: '0.15', label: '15%' },
      { value: '0.3', label: '30%' },
      { value: '0.5', label: '50%' },
      { value: '0.8', label: '80%' },
    ];
    const minBots = type === 'simulation' ? 2 : 0;
    const maxBots = type === 'simulation' ? 8 : 7;
    const botCountOpts = Array.from({ length: maxBots - minBots + 1 }, (_, i) => {
      const n = i + minBots;
      return { value: String(n), label: n === 0 ? t('admin:dashboard.none') : `${n}` };
    });
    const botDiffOpts = [
      { value: 'easy', label: t('admin:dashboard.botDiffEasy') },
      { value: 'normal', label: t('admin:dashboard.botDiffNormal') },
      { value: 'hard', label: t('admin:dashboard.botDiffHard') },
    ];

    let simExtra = '';
    if (type === 'simulation') {
      const sd = defaults as SimulationDefaults;
      const speedOpts = [
        { value: 'fast', label: t('admin:dashboard.speedFast') },
        { value: 'realtime', label: t('admin:dashboard.speedRealtime') },
      ];
      const verbOpts = [
        { value: 'normal', label: t('admin:dashboard.verbosityNormal') },
        { value: 'detailed', label: t('admin:dashboard.verbosityDetailed') },
        { value: 'full', label: t('admin:dashboard.verbosityFull') },
      ];
      simExtra = `
        <div class="form-group">
          <label>${t('admin:dashboard.totalGames')}</label>
          <input type="number" id="${prefix}-totalGames" value="${sd.totalGames ?? ''}" min="1" max="1000" placeholder="${escapeAttr(t('admin:dashboard.totalGamesPlaceholder'))}"
            class="admin-select w-full">
        </div>
        <div class="form-group">
          <label>${t('admin:dashboard.speed')}</label>
          ${sel(`${prefix}-speed`, speedOpts, sd.speed)}
        </div>
        <div class="form-group">
          <label>${t('admin:dashboard.logVerbosity')}</label>
          ${sel(`${prefix}-logVerbosity`, verbOpts, sd.logVerbosity)}
        </div>
      `;
    }

    const enabledSet = defaults.enabledPowerUps ? new Set(defaults.enabledPowerUps) : null;

    return `
      <div class="form-grid">
        <div class="form-group">
          <label>${t('admin:dashboard.gameMode')}</label>
          ${sel(`${prefix}-gameMode`, gameModes, defaults.gameMode)}
        </div>
        ${
          type === 'game'
            ? `<div class="form-group">
          <label>${t('admin:dashboard.maxPlayers')}</label>
          ${sel(`${prefix}-maxPlayers`, maxPlayersOpts, defaults.maxPlayers)}
        </div>`
            : ''
        }
        <div class="form-group">
          <label>${t('admin:dashboard.matchTime')}</label>
          ${sel(`${prefix}-roundTime`, roundTimeOpts, defaults.roundTime)}
        </div>
        <div class="form-group">
          <label>${t('admin:dashboard.mapSize')}</label>
          ${sel(`${prefix}-mapWidth`, mapSizeOpts, defaults.mapWidth)}
        </div>
        <div class="form-group">
          <label>${t('admin:dashboard.wallDensity')}</label>
          ${sel(`${prefix}-wallDensity`, wallDensityOpts, defaults.wallDensity)}
        </div>
        <div class="form-group">
          <label>${t('admin:dashboard.powerUpRate')}</label>
          ${sel(`${prefix}-powerUpDropRate`, powerUpRateOpts, defaults.powerUpDropRate)}
        </div>
        <div class="form-group">
          <label>${t('admin:dashboard.bots')}</label>
          ${sel(`${prefix}-botCount`, botCountOpts, defaults.botCount)}
        </div>
        <div class="form-group">
          <label>${t('admin:dashboard.botDifficulty')}</label>
          ${sel(`${prefix}-botDifficulty`, botDiffOpts, defaults.botDifficulty)}
        </div>
        ${
          activeAIs.length > 1
            ? `<div class="form-group">
          <label>${t('admin:dashboard.botAi')}</label>
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
        ${chk(`${prefix}-reinforcedWalls`, t('admin:dashboard.reinforcedWalls'), '#b8884d', defaults.reinforcedWalls)}
        ${chk(`${prefix}-enableMapEvents`, t('admin:dashboard.mapEvents'), 'var(--warning)', defaults.enableMapEvents)}
        ${chk(`${prefix}-hazardTiles`, t('admin:dashboard.hazardTiles'), 'var(--info)', defaults.hazardTiles)}
        ${chk(`${prefix}-puzzleTiles`, t('admin:dashboard.puzzleTiles'), 'var(--success)', defaults.puzzleTiles)}
        ${chk(`${prefix}-enableSpectatorActions`, t('admin:dashboard.spectatorActions'), 'var(--accent)', defaults.enableSpectatorActions)}
        ${chk(`${prefix}-friendlyFire`, t('admin:dashboard.friendlyFire'), 'var(--danger)', defaults.friendlyFire)}
        ${type === 'simulation' ? chk(`${prefix}-recordReplays`, t('admin:dashboard.recordReplays'), 'var(--accent)', (defaults as SimulationDefaults).recordReplays) : ''}
      </div>

      <div class="mt-sm">
        <div class="subsection-label">${t('admin:dashboard.powerUps')}</div>
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
        <button id="${prefix}-save" class="btn btn-primary btn-sm">${t('admin:dashboard.save')}</button>
        <button id="${prefix}-reset" class="btn btn-secondary btn-sm">${t('admin:dashboard.resetToDefaults')}</button>
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
        this.notifications.success(
          type === 'game'
            ? t('admin:dashboard.gameDefaultsSaved')
            : t('admin:dashboard.simulationDefaultsSaved'),
        );
        // Re-render to update override count
        this.renderSettingsCard();
      } catch {
        this.notifications.error(
          type === 'game'
            ? t('admin:dashboard.failedSaveGameDefaults')
            : t('admin:dashboard.failedSaveSimDefaults'),
        );
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
        this.notifications.success(
          type === 'game'
            ? t('admin:dashboard.gameDefaultsReset')
            : t('admin:dashboard.simulationDefaultsReset'),
        );
        this.renderSettingsCard();
      } catch {
        this.notifications.error(
          type === 'game'
            ? t('admin:dashboard.failedResetGameDefaults')
            : t('admin:dashboard.failedResetSimDefaults'),
        );
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
      'puzzleTiles',
      'enableSpectatorActions',
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
          <div class="stat-label">${t('admin:dashboard.statTotalUsers')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activeUsers24h}</div>
          <div class="stat-label">${t('admin:dashboard.statActive24h')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalMatches}</div>
          <div class="stat-label">${t('admin:dashboard.statTotalMatches')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activeRooms}</div>
          <div class="stat-label">${t('admin:dashboard.statActiveRooms')}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.activePlayers}</div>
          <div class="stat-label">${t('admin:dashboard.statOnlinePlayers')}</div>
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
      this.notifications.error(t('admin:dashboard.failedLoadStats'));
    }
  }
}
