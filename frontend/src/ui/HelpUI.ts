import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { POWERUP_DEFINITIONS, GAME_MODES, UserRole } from '@blast-arena/shared';
import { renderPowerUpCanvas } from '../utils/powerUpCanvas';
import { marked } from 'marked';

interface HelpTab {
  id: string;
  label: string;
  staffOnly: boolean;
}

const ALL_TABS: HelpTab[] = [
  { id: 'getting-started', label: 'Getting Started', staffOnly: false },
  { id: 'power-ups', label: 'Power-Ups', staffOnly: false },
  { id: 'game-modes', label: 'Game Modes', staffOnly: false },
  { id: 'map-features', label: 'Map Features', staffOnly: false },
  { id: 'guides', label: 'Guides', staffOnly: false },
  { id: 'level-editor', label: 'Level Editor', staffOnly: true },
  { id: 'admin-docs', label: 'Admin Docs', staffOnly: true },
];

const POWERUP_DETAILS: Record<string, string> = {
  bomb_up:
    'Increases your maximum bomb count by 1 (caps at 8). Place more bombs simultaneously to trap enemies and create chain reactions.',
  fire_up:
    'Extends your explosion range by 1 tile in each direction (caps at 8). Longer reach means more area denial and easier kills.',
  speed_up:
    'Boosts your movement speed (up to 5 levels). Move faster to dodge explosions, chase enemies, and grab power-ups first.',
  shield:
    'Creates a protective aura that absorbs one explosion hit, then breaks. After breaking, you get brief invulnerability to escape. Does not stack — extra pickups are consumed with no effect. No time limit.',
  kick: 'Walk into a bomb to kick it sliding across the map. Kicked bombs travel until hitting a wall, another bomb, or a player. Applies a short movement cooldown after kicking.',
  pierce_bomb:
    'Your explosions pass through destructible walls instead of stopping. Walls are still destroyed, but the blast continues beyond them. Devastating for clearing large areas.',
  remote_bomb:
    'Your bombs no longer auto-detonate on a timer. Press <span class="help-key">E</span> (or <span class="help-key">B</span> on gamepad) to detonate all your remote bombs at once. Safety auto-detonation after 10 seconds. Bombs appear blue with a blinking effect.',
  line_bomb:
    'Places a line of bombs in your facing direction, using up to your remaining bomb capacity. Great for cutting off escape routes or triggering massive chain reactions.',
};

const MODE_DETAILS: Record<string, string> = {
  ffa: '2–8 players. Classic elimination — be the last one standing. 3 minute rounds.',
  teams:
    '4–8 players split into Team Red and Team Blue. Last team with a surviving member wins. Friendly fire is configurable by the host. 4 minute rounds.',
  battle_royale:
    '4–8 players. A circular danger zone shrinks from the edges over time. Standing outside the zone deals damage every tick. Stay inside and outlast everyone. 5 minute rounds.',
  sudden_death:
    '2–8 players. Everyone starts fully maxed out (8 bombs, 8 range, max speed, kick). No power-ups spawn. One hit kills — pure skill. 2 minute rounds.',
  deathmatch:
    '2–8 players. Respawn 3 seconds after death with reset stats. First to 10 kills wins, or whoever has the most kills when time runs out. 5 minute rounds.',
  king_of_the_hill:
    '2–8 players. A glowing 3×3 zone appears in the center of the map. Stand in it to score points. First to 100 points wins. 4 minute rounds.',
};

const GUIDE_DOCS = [
  { filename: 'campaign.md', title: 'Campaign Guide' },
  { filename: 'replay-system.md', title: 'Replay System' },
  { filename: 'bot-ai-guide.md', title: 'Bot AI Guide' },
  { filename: 'enemy-ai-guide.md', title: 'Enemy AI Guide' },
];

const STAFF_DOCS = [
  { filename: 'admin-and-systems.md', title: 'Admin Panel & Systems' },
  { filename: 'infrastructure.md', title: 'Infrastructure & Security' },
  { filename: 'testing.md', title: 'Testing' },
  { filename: 'performance-and-internals.md', title: 'Performance & Internals' },
  { filename: 'bot-ai-internals.md', title: 'Bot AI Internals' },
  { filename: 'openapi.yaml', title: 'API Reference (OpenAPI)' },
];

export class HelpUI {
  private container: HTMLElement;
  private authManager: AuthManager;
  private notifications: NotificationUI;
  private onClose: () => void;
  private activeTabId: string;
  private contentEl: HTMLElement | null = null;
  private tabs: HelpTab[];
  private markdownCache: Map<string, string> = new Map();
  private displayGithub = false;
  private displayImprint = false;

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

    const role = (authManager.getUser()?.role || 'user') as UserRole;
    const isStaff = role === 'admin' || role === 'moderator';
    this.tabs = isStaff ? [...ALL_TABS] : ALL_TABS.filter((t) => !t.staffOnly);
    this.activeTabId =
      initialTab && this.tabs.some((t) => t.id === initialTab) ? initialTab : 'getting-started';
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
    UIGamepadNavigator.getInstance().popContext('help-ui');
    this.container.remove();
  }

  private async render(): Promise<void> {
    await this.loadFooterSettings();

    const rightLinks: string[] = [];
    if (this.displayGithub) {
      rightLinks.push(
        '<a class="admin-tab help-external-link" href="https://github.com/phoen-ix/blastarena/" target="_blank" rel="noopener">GitHub</a>',
      );
    }
    if (this.displayImprint) {
      rightLinks.push(
        '<button class="admin-tab help-external-link" data-tab="imprint">Imprint</button>',
      );
    }

    this.container.innerHTML = `
      <div class="admin-header">
        <h1>Help</h1>
        <button class="btn btn-secondary" id="help-ui-close">Back to Lobby</button>
      </div>
      <div class="admin-tabs" id="help-tab-bar">
        ${this.tabs
          .map(
            (t) =>
              `<button class="admin-tab ${t.id === this.activeTabId ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`,
          )
          .join('')}
        ${rightLinks.length > 0 ? `<span class="help-tab-spacer"></span>${rightLinks.join('')}` : ''}
      </div>
      <div class="admin-tab-content" id="help-tab-content"></div>
    `;

    this.container.querySelector('#help-ui-close')!.addEventListener('click', () => {
      this.hide();
      this.onClose();
    });

    this.container.querySelector('#help-tab-bar')!.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const tabId = target.getAttribute('data-tab');
      if (tabId === 'imprint') {
        this.showImprintTab();
        return;
      }
      if (tabId && tabId !== this.activeTabId) {
        this.switchTab(tabId);
      }
    });

    this.contentEl = this.container.querySelector('#help-tab-content');
    await this.renderActiveTab();
  }

  private async switchTab(tabId: string): Promise<void> {
    this.activeTabId = tabId;
    this.container.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    if (this.contentEl) {
      this.contentEl.innerHTML = '';
    }
    await this.renderActiveTab();
    this.pushGamepadContext();
  }

  private async renderActiveTab(): Promise<void> {
    if (!this.contentEl) return;

    switch (this.activeTabId) {
      case 'getting-started':
        this.renderGettingStartedTab();
        break;
      case 'power-ups':
        this.renderPowerUpsTab();
        break;
      case 'game-modes':
        this.renderGameModesTab();
        break;
      case 'map-features':
        this.renderMapFeaturesTab();
        break;
      case 'guides':
        await this.renderGuidesTab();
        break;
      case 'level-editor':
        await this.renderLevelEditorTab();
        break;
      case 'admin-docs':
        await this.renderAdminDocsTab();
        break;
    }
  }

  private renderGettingStartedTab(): void {
    this.contentEl!.innerHTML = `
      <div class="help-section">
        <div class="help-heading">Keyboard Controls</div>
        <div class="help-row"><span class="help-key">WASD</span> / <span class="help-key">Arrow Keys</span> Move your character</div>
        <div class="help-row"><span class="help-key">Space</span> Place a bomb at your current position</div>
        <div class="help-row"><span class="help-key">E</span> Detonate all your remote bombs</div>
        <div class="help-row"><span class="help-key">1</span>–<span class="help-key">6</span> Send a quick emote (GG, Help!, Nice!, Oops, Taunt, Thanks)</div>
        <div class="help-row"><span class="help-key">1</span>–<span class="help-key">9</span> Spectate the Nth player (when dead)</div>
      </div>

      <div class="help-section">
        <div class="help-heading">Gamepad Controls (Xbox / Standard)</div>
        <div class="help-tip">Any standard-mapped controller works. Just plug in and play.</div>
        <div class="help-row"><span class="help-key">D-Pad</span> / <span class="help-key">Left Stick</span> Move your character</div>
        <div class="help-row"><span class="help-key">A</span> Place bomb</div>
        <div class="help-row"><span class="help-key">B</span> Detonate remote bombs</div>
        <div class="help-row"><span class="help-key">LB</span> / <span class="help-key">RB</span> Cycle spectate target (when dead)</div>
        <div class="help-heading help-heading-spaced">Menu Navigation</div>
        <div class="help-row"><span class="help-key">D-Pad</span> / <span class="help-key">Left Stick</span> Navigate menus</div>
        <div class="help-row"><span class="help-key">A</span> Confirm / Select</div>
        <div class="help-row"><span class="help-key">B</span> Back / Close</div>
      </div>

      <div class="help-section">
        <div class="help-heading">Basic Mechanics</div>
        <div class="help-row"><b>Bombs</b> explode after 3 seconds in 4 cardinal directions up to their fire range</div>
        <div class="help-row"><b>Chain reactions</b> — bombs caught in an explosion detonate instantly, creating devastating combos</div>
        <div class="help-row"><b>Kicked bombs</b> slide until hitting a wall, bomb, or player</div>
        <div class="help-row"><b>Shield break</b> — after your shield absorbs a hit, you get 10 ticks of invulnerability to escape</div>
        <div class="help-row"><b>Spawn invulnerability</b> — 2 seconds of protection after spawning or respawning</div>
        <div class="help-row"><b>Self-kills</b> subtract 1 from your kill score</div>
        <div class="help-row"><b>Grace period</b> — 1.5 seconds after win condition before the game ends; winner is invulnerable</div>
      </div>

      <div class="help-section">
        <div class="help-heading">Spectator Mode</div>
        <div class="help-tip">When you die, you enter spectator mode to watch the remaining players.</div>
        <div class="help-row"><span class="help-key">WASD</span> / <span class="help-key">Arrows</span> / <span class="help-key">Mouse Drag</span> Free camera panning</div>
        <div class="help-row"><span class="help-key">Click</span> a player to follow them</div>
        <div class="help-row"><span class="help-key">1</span>–<span class="help-key">9</span> Jump to the Nth player</div>
        <div class="help-row">Press any movement key or drag to break follow and return to free camera</div>
      </div>
    `;
  }

  private renderPowerUpsTab(): void {
    if (!this.contentEl) return;

    const wrapper = document.createElement('div');

    const tip = document.createElement('div');
    tip.className = 'help-tip';
    tip.textContent =
      'Dropped when breakable walls are destroyed. Walk over floating tiles to collect. Your HUD (bottom-left) shows your current stats.';
    wrapper.appendChild(tip);

    for (const [type, def] of Object.entries(POWERUP_DEFINITIONS)) {
      const row = document.createElement('div');
      row.className = 'help-powerup-row';

      const canvas = renderPowerUpCanvas(def.color, type, 48);
      canvas.className = 'help-powerup-icon';
      row.appendChild(canvas);

      const info = document.createElement('div');
      info.className = 'help-powerup-info';
      info.innerHTML = `
        <div class="help-powerup-name" style="color:${def.color}">${def.name}</div>
        <div class="help-powerup-desc">${POWERUP_DETAILS[type] || def.description}</div>
      `;
      row.appendChild(info);

      wrapper.appendChild(row);
    }

    this.contentEl.appendChild(wrapper);
  }

  private renderGameModesTab(): void {
    let html = '';
    for (const [mode, config] of Object.entries(GAME_MODES)) {
      const detail = MODE_DETAILS[mode] || config.description;
      const tags: string[] = [];
      if (config.hasZone) tags.push('Shrinking Zone');
      if (config.hasRespawn) tags.push('Respawn');
      if (config.hasHill) tags.push('Zone Control');
      if (config.teamsCount) tags.push(`${config.teamsCount} Teams`);

      html += `
        <div class="help-mode-card">
          <div class="help-mode-header">
            <span class="help-mode-name">${config.name}</span>
            <span class="help-mode-players">${config.minPlayers}–${config.maxPlayers} players</span>
          </div>
          ${tags.length ? `<div class="help-mode-tags">${tags.map((t) => `<span class="help-mode-tag">${t}</span>`).join('')}</div>` : ''}
          <div class="help-mode-desc">${detail}</div>
        </div>
      `;
    }
    this.contentEl!.innerHTML = html;
  }

  private renderMapFeaturesTab(): void {
    this.contentEl!.innerHTML = `
      <div class="help-section">
        <div class="help-heading">Reinforced Walls</div>
        <div class="help-tip">Optional — toggled when creating a room.</div>
        <div class="help-row">Breakable walls take <b>2 hits</b> to destroy. The first explosion cracks them (visually damaged), and the second destroys them completely. Plan your bomb placement accordingly.</div>
      </div>

      <div class="help-section">
        <div class="help-heading">Dynamic Map Events</div>
        <div class="help-tip">Optional — toggled when creating a room. Adds random chaos to keep matches exciting.</div>
        <div class="help-row help-row-spaced">
          <b class="text-danger">Meteor Strikes</b> — Random tiles are targeted every 30–45 seconds. A warning reticle appears on the ground for 2 seconds before impact. Meteors destroy walls and kill players in the blast zone.
        </div>
        <div class="help-row">
          <b class="text-success">Power-Up Rain</b> — Every 60 seconds, power-ups drop across random open tiles on the map. A great way to gear up mid-game.
        </div>
      </div>

      <div class="help-section">
        <div class="help-heading">Hazard Tiles</div>
        <div class="help-tip">Optional — toggled when creating a room. Placed in fixed positions on the map.</div>
        <div class="help-row help-row-spaced">
          <span class="help-tile help-tile-teleporter-a"></span>
          <span class="help-tile help-tile-teleporter-b"></span>
          <b>Teleporters</b> — Glowing pads in blue/orange pairs. Step on one to instantly warp to the other. Use them for surprise attacks or quick escapes.
        </div>
        <div class="help-row">
          <span class="help-tile help-tile-conveyor">▸▸▸</span>
          <b>Conveyor Belts</b> — Dark tiles with directional arrows. Automatically push you in the arrow direction when you step on them. Can be used strategically or can trap you in danger.
        </div>
      </div>
    `;
  }

  private async renderGuidesTab(): Promise<void> {
    if (!this.contentEl) return;

    this.contentEl.innerHTML = GUIDE_DOCS.map(
      (doc) => `
      <details class="help-guide-section" data-doc="${doc.filename}">
        <summary>${doc.title}</summary>
        <div class="help-markdown"><div class="help-status">Loading...</div></div>
      </details>
    `,
    ).join('');

    // Load docs in parallel
    const sections = this.contentEl.querySelectorAll<HTMLElement>('.help-guide-section');
    const promises = GUIDE_DOCS.map(async (doc, i) => {
      try {
        const html = await this.fetchAndParseDoc(`/api/docs/${doc.filename}`);
        const content = sections[i]?.querySelector('.help-markdown');
        if (content) content.innerHTML = html;
      } catch {
        const content = sections[i]?.querySelector('.help-markdown');
        if (content) {
          content.innerHTML = `<div class="help-status-error">Failed to load ${doc.title}. <button class="btn btn-ghost" data-retry="${i}">Retry</button></div>`;
          content.querySelector(`[data-retry="${i}"]`)?.addEventListener('click', async () => {
            content.innerHTML = '<div class="help-status">Loading...</div>';
            try {
              const html = await this.fetchAndParseDoc(`/api/docs/${doc.filename}`, true);
              content.innerHTML = html;
            } catch {
              content.innerHTML = '<div class="help-status-error">Failed to load.</div>';
            }
          });
        }
      }
    });

    await Promise.all(promises);
  }

  private async renderLevelEditorTab(): Promise<void> {
    if (!this.contentEl) return;

    this.contentEl.innerHTML = '<div class="help-status">Loading...</div>';

    try {
      const html = await this.fetchAndParseDoc('/api/docs/campaign.md');
      this.contentEl.innerHTML = `<div class="help-markdown">${html}</div>`;
    } catch {
      this.contentEl.innerHTML =
        '<div class="help-status-error">Failed to load Level Editor documentation.</div>';
    }
  }

  private async renderAdminDocsTab(): Promise<void> {
    if (!this.contentEl) return;

    this.contentEl.innerHTML = STAFF_DOCS.map(
      (doc) => `
      <details class="help-guide-section" data-doc="${doc.filename}">
        <summary>${doc.title}</summary>
        <div class="help-markdown"><div class="help-status">Loading...</div></div>
      </details>
    `,
    ).join('');

    const sections = this.contentEl.querySelectorAll<HTMLElement>('.help-guide-section');
    const promises = STAFF_DOCS.map(async (doc, i) => {
      try {
        const isYaml = doc.filename.endsWith('.yaml');
        const content = await this.fetchRawDoc(`/api/docs/admin/${doc.filename}`);
        const el = sections[i]?.querySelector('.help-markdown');
        if (el) {
          if (isYaml) {
            el.innerHTML = `<pre><code>${this.escapeForPre(content)}</code></pre>`;
          } else {
            el.innerHTML = await marked.parse(content);
          }
        }
      } catch {
        const el = sections[i]?.querySelector('.help-markdown');
        if (el) {
          el.innerHTML = `<div class="help-status-error">Failed to load ${doc.title}.</div>`;
        }
      }
    });

    await Promise.all(promises);
  }

  private async fetchAndParseDoc(url: string, skipCache = false): Promise<string> {
    if (!skipCache && this.markdownCache.has(url)) {
      return this.markdownCache.get(url)!;
    }
    const raw = await this.fetchRawDoc(url);
    const html = await marked.parse(raw);
    this.markdownCache.set(url, html);
    return html;
  }

  private async fetchRawDoc(url: string): Promise<string> {
    const token = this.authManager.getAccessToken();
    const headers: Record<string, string> = { Accept: 'text/plain' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.text();
  }

  private escapeForPre(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async renderEmbedded(container: HTMLElement): Promise<void> {
    this.container = container;
    await this.loadFooterSettings();

    const rightLinks: string[] = [];
    if (this.displayGithub) {
      rightLinks.push(
        '<a class="admin-tab help-external-link" href="https://github.com/phoen-ix/blastarena/" target="_blank" rel="noopener">GitHub</a>',
      );
    }
    if (this.displayImprint) {
      rightLinks.push(
        '<button class="admin-tab help-external-link" data-tab="imprint">Imprint</button>',
      );
    }

    this.container.innerHTML = `
      <div class="view-content">
        <div class="admin-tabs" id="help-tab-bar">
          ${this.tabs
            .map(
              (t) =>
                `<button class="admin-tab ${t.id === this.activeTabId ? 'active' : ''}" data-tab="${t.id}">${t.label}</button>`,
            )
            .join('')}
          ${rightLinks.length > 0 ? `<span class="help-tab-spacer"></span>${rightLinks.join('')}` : ''}
        </div>
        <div class="admin-tab-content" id="help-tab-content"></div>
      </div>
    `;

    this.container.querySelector('#help-tab-bar')!.addEventListener('click', (e: Event) => {
      const target = e.target as HTMLElement;
      const tabId = target.getAttribute('data-tab');
      if (tabId === 'imprint') {
        this.showImprintTab();
        return;
      }
      if (tabId && tabId !== this.activeTabId) {
        this.switchTab(tabId);
      }
    });

    this.contentEl = this.container.querySelector('#help-tab-content');
    await this.renderActiveTab();
    this.pushGamepadContext();
  }

  private async loadFooterSettings(): Promise<void> {
    try {
      const [imprintResp, githubResp] = await Promise.all([
        ApiClient.get<{ enabled: boolean }>('/admin/settings/imprint'),
        ApiClient.get<{ enabled: boolean }>('/admin/settings/display_github'),
      ]);
      this.displayImprint = imprintResp.enabled;
      this.displayGithub = githubResp.enabled;
    } catch {
      // defaults
    }
  }

  private async showImprintTab(): Promise<void> {
    if (!this.contentEl) return;
    // Deactivate all tabs, activate imprint
    this.container.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
    this.container.querySelector('[data-tab="imprint"]')?.classList.add('active');
    this.activeTabId = '';

    this.contentEl.innerHTML = '<div class="help-section"><p>Loading imprint...</p></div>';
    try {
      const resp = await ApiClient.get<{ enabled: boolean; text: string }>(
        '/admin/settings/imprint',
      );
      const text = resp.text || 'No imprint information available.';
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      this.contentEl.innerHTML = `<div class="help-section" style="white-space:pre-wrap;line-height:1.6;">${escaped}</div>`;
    } catch {
      this.contentEl.innerHTML =
        '<div class="help-section"><p class="text-danger">Failed to load imprint.</p></div>';
    }
  }

  destroy(): void {
    UIGamepadNavigator.getInstance().popContext('help-ui');
  }

  private pushGamepadContext(): void {
    UIGamepadNavigator.getInstance().popContext('help-ui');
    UIGamepadNavigator.getInstance().pushContext({
      id: 'help-ui',
      elements: () => [
        this.container.querySelector<HTMLElement>('#help-ui-close')!,
        ...this.container.querySelectorAll<HTMLElement>('.admin-tab'),
        ...this.container.querySelectorAll<HTMLElement>(
          '.help-guide-section summary, .help-markdown a, .btn',
        ),
      ],
      onBack: () => {
        this.hide();
        this.onClose();
      },
    });
  }
}
