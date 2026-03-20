import { ApiClient } from '../../network/ApiClient';
import { escapeAttr } from '../../utils/html';
import { NotificationUI } from '../NotificationUI';
import {
  GameDefaults,
  SimulationDefaults,
  EmailSettings,
  PowerUpType,
  POWERUP_DEFINITIONS,
  BotAIEntry,
} from '@blast-arena/shared';

const ALL_POWER_UPS = Object.values(POWERUP_DEFINITIONS);

export class DashboardTab {
  private container: HTMLElement | null = null;
  private notifications: NotificationUI;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private recordingsEnabled: boolean = true;
  private gameDefaults: GameDefaults = {};
  private simulationDefaults: SimulationDefaults = {};
  private activeAIs: BotAIEntry[] = [];
  private emailSettings: EmailSettings = {};

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
      const [recResp, gameResp, simResp, aiResp] = await Promise.all([
        ApiClient.get<{ enabled: boolean }>('/admin/settings/recordings_enabled'),
        ApiClient.get<{ defaults: GameDefaults }>('/admin/settings/game_defaults'),
        ApiClient.get<{ defaults: SimulationDefaults }>('/admin/settings/simulation_defaults'),
        ApiClient.get<{ ais: BotAIEntry[] }>('/admin/ai/active'),
      ]);
      this.recordingsEnabled = recResp.enabled;
      this.gameDefaults = gameResp.defaults ?? {};
      this.simulationDefaults = simResp.defaults ?? {};
      this.activeAIs = aiResp.ais ?? [];
    } catch {
      // Use defaults on failure
    }
    // Email settings are admin-only; fetch separately to handle non-admin gracefully
    try {
      const emailResp = await ApiClient.get<{ settings: EmailSettings }>('/admin/settings/email_settings');
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
    card.style.cssText = 'margin-top:20px;';
    card.innerHTML = `
      <h3 style="color:var(--text);font-size:15px;margin-bottom:12px;font-weight:600;">Server Settings</h3>
      <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;
        background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px;">
          <input type="checkbox" id="toggle-recordings" ${this.recordingsEnabled ? 'checked' : ''} style="accent-color:var(--accent);width:16px;height:16px;">
          <span style="color:var(--text);font-weight:600;">Match Recordings</span>
        </label>
        <span style="color:var(--text-dim);font-size:12px;">Enable replay recording for all new games</span>
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

    this.attachEmailSettingsListeners(card);
    this.attachDefaultsListeners(card, 'game');
    this.attachDefaultsListeners(card, 'simulation');
  }

  private renderEmailSettingsSection(): string {
    const s = this.emailSettings;
    const configured = !!s.smtpHost;
    const statusDot = configured
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--success);margin-right:6px;" title="SMTP configured"></span>'
      : '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--danger);margin-right:6px;" title="SMTP not configured"></span>';

    const inputStyle = 'width:100%;background:var(--bg-deep);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:12px;';

    return `
      <div style="margin-top:12px;">
        <button id="email-toggle" style="background:none;border:1px solid var(--border);border-radius:6px;
          padding:8px 14px;cursor:pointer;color:var(--text);font-size:13px;font-weight:600;width:100%;
          text-align:left;display:flex;justify-content:space-between;align-items:center;">
          <span>${statusDot}Email / SMTP Settings</span>
          <span id="email-arrow" style="transition:transform 0.2s;">&#9654;</span>
        </button>
        <div id="email-body" style="display:none;padding:14px 18px;margin-top:4px;
          background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:11px;color:var(--text-dim);">SMTP Host</label>
              <input type="text" id="email-smtpHost" value="${escapeAttr(s.smtpHost ?? '')}" placeholder="smtp.example.com" style="${inputStyle}">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:11px;color:var(--text-dim);">SMTP Port</label>
              <input type="number" id="email-smtpPort" value="${s.smtpPort ?? ''}" placeholder="587" min="1" max="65535" style="${inputStyle}">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:11px;color:var(--text-dim);">SMTP User</label>
              <input type="text" id="email-smtpUser" value="${escapeAttr(s.smtpUser ?? '')}" placeholder="user@example.com" style="${inputStyle}">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:11px;color:var(--text-dim);">SMTP Password</label>
              <div style="position:relative;">
                <input type="password" id="email-smtpPassword" value="${escapeAttr(s.smtpPassword ?? '')}" placeholder="No password set" style="${inputStyle}padding-right:30px;">
                <button id="email-togglePw" type="button" style="position:absolute;right:4px;top:50%;transform:translateY(-50%);
                  background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:11px;padding:2px 4px;">Show</button>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:11px;color:var(--text-dim);">From Email</label>
              <input type="text" id="email-fromEmail" value="${escapeAttr(s.fromEmail ?? '')}" placeholder="noreply@example.com" style="${inputStyle}">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label style="font-size:11px;color:var(--text-dim);">From Name</label>
              <input type="text" id="email-fromName" value="${escapeAttr(s.fromName ?? '')}" placeholder="BlastArena" style="${inputStyle}">
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:14px;align-items:center;">
            <button id="email-save" class="btn btn-primary" style="font-size:12px;padding:6px 16px;">Save</button>
            <button id="email-reset" class="btn btn-secondary" style="font-size:12px;padding:6px 16px;">Reset to Defaults</button>
            <div style="margin-left:auto;display:flex;gap:6px;align-items:center;">
              <input type="email" id="email-testAddr" placeholder="test@example.com" style="${inputStyle}width:180px;">
              <button id="email-test" class="btn btn-secondary" style="font-size:12px;padding:6px 16px;white-space:nowrap;">Send Test</button>
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
      const open = body.style.display === 'none';
      body.style.display = open ? 'block' : 'none';
      arrow.style.transform = open ? 'rotate(90deg)' : '';
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
        const resp = await ApiClient.get<{ settings: EmailSettings }>('/admin/settings/email_settings');
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
        const resp = await ApiClient.get<{ settings: EmailSettings }>('/admin/settings/email_settings');
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
      <div style="margin-top:12px;">
        <button id="${prefix}-toggle" style="background:none;border:1px solid var(--border);border-radius:6px;
          padding:8px 14px;cursor:pointer;color:var(--text);font-size:13px;font-weight:600;width:100%;
          text-align:left;display:flex;justify-content:space-between;align-items:center;">
          <span>${title} ${hasOverrides ? `<span style="color:var(--accent);font-size:11px;">(${Object.keys(defaults).length} overrides)</span>` : ''}</span>
          <span id="${prefix}-arrow" style="transition:transform 0.2s;">&#9654;</span>
        </button>
        <div id="${prefix}-body" style="display:none;padding:14px 18px;margin-top:4px;
          background:var(--bg-card);border:1px solid var(--border);border-radius:8px;">
          ${this.renderDefaultsForm(prefix, defaults, type, this.activeAIs)}
        </div>
      </div>
    `;
  }

  private renderDefaultsForm(prefix: string, defaults: SimulationDefaults, type: 'game' | 'simulation', activeAIs: BotAIEntry[] = []): string {
    const sel = (id: string, options: { value: string; label: string }[], current?: string | number) => {
      const val = current !== undefined ? String(current) : '';
      return `<select id="${id}" style="width:100%;background:var(--bg-deep);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:12px;">
        <option value="">— Default —</option>
        ${options.map((o) => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>`;
    };

    const chk = (id: string, label: string, color: string, value?: boolean) => {
      const checked = value === true ? 'checked' : '';
      const indeterminate = value === undefined;
      return `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;">
        <input type="checkbox" id="${id}" ${checked} ${indeterminate ? 'data-indeterminate="true"' : ''} style="accent-color:${color};">
        <span style="color:${color};font-weight:600;">${label}</span>
        ${indeterminate ? '<span style="color:var(--text-muted);font-size:10px;">(default)</span>' : ''}
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
      { value: '60', label: '1 min' }, { value: '120', label: '2 min' },
      { value: '180', label: '3 min' }, { value: '300', label: '5 min' }, { value: '600', label: '10 min' },
    ];
    const mapSizeOpts = [
      { value: '21', label: '21x21' }, { value: '31', label: '31x31' },
      { value: '39', label: '39x39' }, { value: '51', label: '51x51' }, { value: '61', label: '61x61' },
    ];
    const wallDensityOpts = [
      { value: '0.3', label: '30%' }, { value: '0.5', label: '50%' },
      { value: '0.65', label: '65%' }, { value: '0.8', label: '80%' },
    ];
    const powerUpRateOpts = [
      { value: '0', label: 'None' }, { value: '0.15', label: '15%' },
      { value: '0.3', label: '30%' }, { value: '0.5', label: '50%' }, { value: '0.8', label: '80%' },
    ];
    const minBots = type === 'simulation' ? 2 : 0;
    const maxBots = type === 'simulation' ? 8 : 7;
    const botCountOpts = Array.from({ length: maxBots - minBots + 1 }, (_, i) => {
      const n = i + minBots;
      return { value: String(n), label: n === 0 ? 'None' : `${n}` };
    });
    const botDiffOpts = [
      { value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' },
    ];

    let simExtra = '';
    if (type === 'simulation') {
      const sd = defaults as SimulationDefaults;
      const speedOpts = [{ value: 'fast', label: 'Fast' }, { value: 'realtime', label: 'Real-time' }];
      const verbOpts = [{ value: 'normal', label: 'Normal' }, { value: 'detailed', label: 'Detailed' }, { value: 'full', label: 'Full' }];
      simExtra = `
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Total Games</label>
          <input type="number" id="${prefix}-totalGames" value="${sd.totalGames ?? ''}" min="1" max="1000" placeholder="Default (10)"
            style="width:100%;background:var(--bg-deep);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:12px;">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Speed</label>
          ${sel(`${prefix}-speed`, speedOpts, sd.speed)}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Log Verbosity</label>
          ${sel(`${prefix}-logVerbosity`, verbOpts, sd.logVerbosity)}
        </div>
      `;
    }

    const enabledSet = defaults.enabledPowerUps ? new Set(defaults.enabledPowerUps) : null;

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Game Mode</label>
          ${sel(`${prefix}-gameMode`, gameModes, defaults.gameMode)}
        </div>
        ${type === 'game' ? `<div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Max Players</label>
          ${sel(`${prefix}-maxPlayers`, maxPlayersOpts, defaults.maxPlayers)}
        </div>` : ''}
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Match Time</label>
          ${sel(`${prefix}-roundTime`, roundTimeOpts, defaults.roundTime)}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Map Size</label>
          ${sel(`${prefix}-mapWidth`, mapSizeOpts, defaults.mapWidth)}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Wall Density</label>
          ${sel(`${prefix}-wallDensity`, wallDensityOpts, defaults.wallDensity)}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Power-Up Rate</label>
          ${sel(`${prefix}-powerUpDropRate`, powerUpRateOpts, defaults.powerUpDropRate)}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Bots</label>
          ${sel(`${prefix}-botCount`, botCountOpts, defaults.botCount)}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Bot Difficulty</label>
          ${sel(`${prefix}-botDifficulty`, botDiffOpts, defaults.botDifficulty)}
        </div>
        ${activeAIs.length > 1 ? `<div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:var(--text-dim);">Bot AI</label>
          ${sel(`${prefix}-botAiId`, activeAIs.map((ai) => ({ value: ai.id, label: ai.name })), defaults.botAiId)}
        </div>` : ''}
        ${simExtra}
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;">
        ${chk(`${prefix}-reinforcedWalls`, 'Reinforced Walls', '#b8884d', defaults.reinforcedWalls)}
        ${chk(`${prefix}-enableMapEvents`, 'Map Events', 'var(--warning)', defaults.enableMapEvents)}
        ${chk(`${prefix}-hazardTiles`, 'Hazard Tiles', 'var(--info)', defaults.hazardTiles)}
        ${chk(`${prefix}-friendlyFire`, 'Friendly Fire', 'var(--danger)', defaults.friendlyFire)}
        ${type === 'simulation' ? chk(`${prefix}-recordReplays`, 'Record Replays', 'var(--accent)', (defaults as SimulationDefaults).recordReplays) : ''}
      </div>

      <div style="margin-top:10px;">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;font-weight:600;">Power-Ups</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${ALL_POWER_UPS.map((pu) => {
            const checked = enabledSet ? enabledSet.has(pu.type) : true;
            const indeterminate = enabledSet === null;
            return `<label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;">
              <input type="checkbox" class="${prefix}-powerup-check" value="${pu.type}" ${checked ? 'checked' : ''} ${indeterminate ? 'data-indeterminate="true"' : ''}
                style="accent-color:${pu.color};">
              <span style="color:${pu.color};font-weight:600;">${pu.name}</span>
            </label>`;
          }).join('')}
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="${prefix}-save" class="btn btn-primary" style="font-size:12px;padding:6px 16px;">Save</button>
        <button id="${prefix}-reset" class="btn btn-secondary" style="font-size:12px;padding:6px 16px;">Reset to Defaults</button>
      </div>
    `;
  }

  private attachDefaultsListeners(card: HTMLElement, type: 'game' | 'simulation'): void {
    const prefix = type === 'game' ? 'gd' : 'sd';
    const endpoint = type === 'game' ? '/admin/settings/game_defaults' : '/admin/settings/simulation_defaults';

    // Toggle expand/collapse
    const toggle = card.querySelector(`#${prefix}-toggle`) as HTMLElement;
    const body = card.querySelector(`#${prefix}-body`) as HTMLElement;
    const arrow = card.querySelector(`#${prefix}-arrow`) as HTMLElement;
    toggle.addEventListener('click', () => {
      const open = body.style.display === 'none';
      body.style.display = open ? 'block' : 'none';
      arrow.style.transform = open ? 'rotate(90deg)' : '';
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

  private collectDefaults(card: HTMLElement, prefix: string, type: 'game' | 'simulation'): SimulationDefaults {
    const defaults: SimulationDefaults = {};

    const getSelect = (field: string) => {
      const el = card.querySelector(`#${prefix}-${field}`) as HTMLSelectElement | null;
      return el?.value || '';
    };
    const getCheckbox = (field: string): boolean | undefined => {
      const el = card.querySelector(`#${prefix}-${field}`) as HTMLInputElement | null;
      if (!el) return undefined;
      return el.checked;
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
    const boolFields = ['reinforcedWalls', 'enableMapEvents', 'hazardTiles', 'friendlyFire'] as const;
    for (const field of boolFields) {
      const el = card.querySelector(`#${prefix}-${field}`) as HTMLInputElement | null;
      if (el && !el.dataset.indeterminate) {
        defaults[field] = el.checked;
      }
    }

    // Power-ups: only include if any are unchecked (i.e. user made a deliberate choice)
    const checks = card.querySelectorAll(`.${prefix}-powerup-check`);
    const allChecked = Array.from(checks).every((c) => (c as HTMLInputElement).checked);
    const hasIndeterminate = Array.from(checks).some((c) => (c as HTMLInputElement).dataset.indeterminate);
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
