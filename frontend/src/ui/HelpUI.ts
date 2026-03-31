import { AuthManager } from '../network/AuthManager';
import { ApiClient } from '../network/ApiClient';
import { NotificationUI } from './NotificationUI';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import {
  POWERUP_DEFINITIONS,
  GAME_MODES,
  UserRole,
  CAMPAIGN_THEME_PALETTES,
  CAMPAIGN_THEME_NAMES,
} from '@blast-arena/shared';
import type { CampaignWorldTheme } from '@blast-arena/shared';
import { renderPowerUpCanvas } from '../utils/powerUpCanvas';
import { renderTileCanvas } from '../utils/tileCanvas';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { t } from '../i18n';

interface HelpTab {
  id: string;
  label: string;
  staffOnly: boolean;
}

function getAllTabs(): HelpTab[] {
  return [
    { id: 'getting-started', label: t('help:tabs.gettingStarted'), staffOnly: false },
    { id: 'power-ups', label: t('help:tabs.powerUps'), staffOnly: false },
    { id: 'game-modes', label: t('help:tabs.gameModes'), staffOnly: false },
    { id: 'map-features', label: t('help:tabs.mapFeatures'), staffOnly: false },
    { id: 'guides', label: t('help:tabs.guides'), staffOnly: false },
    { id: 'level-editor', label: t('help:tabs.levelEditor'), staffOnly: true },
    { id: 'admin-docs', label: t('help:tabs.adminDocs'), staffOnly: true },
  ];
}

function getPowerUpDetails(): Record<string, string> {
  return {
    bomb_up: t('help:powerUpDetails.bomb_up'),
    fire_up: t('help:powerUpDetails.fire_up'),
    speed_up: t('help:powerUpDetails.speed_up'),
    shield: t('help:powerUpDetails.shield'),
    kick: t('help:powerUpDetails.kick'),
    pierce_bomb: t('help:powerUpDetails.pierce_bomb'),
    remote_bomb: t('help:powerUpDetails.remote_bomb'),
    line_bomb: t('help:powerUpDetails.line_bomb'),
    bomb_throw: t('help:powerUpDetails.bomb_throw'),
  };
}

function getModeDetails(): Record<string, string> {
  return {
    ffa: t('help:modeDetails.ffa'),
    teams: t('help:modeDetails.teams'),
    battle_royale: t('help:modeDetails.battle_royale'),
    sudden_death: t('help:modeDetails.sudden_death'),
    deathmatch: t('help:modeDetails.deathmatch'),
    king_of_the_hill: t('help:modeDetails.king_of_the_hill'),
  };
}

function getGuideDocs() {
  return [
    { filename: 'campaign.md', title: t('help:guides.campaign') },
    { filename: 'replay-system.md', title: t('help:guides.replaySystem') },
    { filename: 'bot-ai-guide.md', title: t('help:guides.botAi') },
    { filename: 'enemy-ai-guide.md', title: t('help:guides.enemyAi') },
  ];
}

function getStaffDocs() {
  return [
    { filename: 'admin-and-systems.md', title: t('help:staffDocs.adminSystems') },
    { filename: 'infrastructure.md', title: t('help:staffDocs.infrastructure') },
    { filename: 'testing.md', title: t('help:staffDocs.testing') },
    { filename: 'performance-and-internals.md', title: t('help:staffDocs.performance') },
    { filename: 'bot-ai-internals.md', title: t('help:staffDocs.botAiInternals') },
    { filename: 'openapi.yaml', title: t('help:staffDocs.apiReference') },
  ];
}

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
  private onLanguageChanged = () => this.render();

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
    const allTabs = getAllTabs();
    this.tabs = isStaff ? [...allTabs] : allTabs.filter((tab) => !tab.staffOnly);
    this.activeTabId =
      initialTab && this.tabs.some((tab) => tab.id === initialTab) ? initialTab : 'getting-started';
  }

  async show(): Promise<void> {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    window.addEventListener('language-changed', this.onLanguageChanged);
    await this.render();
    this.pushGamepadContext();
  }

  hide(): void {
    window.removeEventListener('language-changed', this.onLanguageChanged);
    UIGamepadNavigator.getInstance().popContext('help-ui');
    this.container.remove();
  }

  private async render(): Promise<void> {
    // Refresh tab labels for current language
    const freshTabs = getAllTabs();
    for (const tab of this.tabs) {
      const fresh = freshTabs.find((ft) => ft.id === tab.id);
      if (fresh) tab.label = fresh.label;
    }

    await this.loadFooterSettings();

    const rightLinks: string[] = [];
    if (this.displayGithub) {
      rightLinks.push(
        `<a class="admin-tab help-external-link" href="https://github.com/phoen-ix/blastarena/" target="_blank" rel="noopener">${t('help:github')}</a>`,
      );
    }
    if (this.displayImprint) {
      rightLinks.push(
        `<button class="admin-tab help-external-link" data-tab="imprint">${t('help:imprint.tab')}</button>`,
      );
    }

    this.container.innerHTML = `
      <div class="admin-header">
        <h1>${t('help:title')}</h1>
        <button class="btn btn-secondary" id="help-ui-close">${t('help:backToLobby')}</button>
      </div>
      <div class="admin-tabs" id="help-tab-bar">
        ${this.tabs
          .map(
            (tab) =>
              `<button class="admin-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>`,
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
        <div class="help-heading">${t('help:keyboard.heading')}</div>
        <div class="help-row"><span class="help-key">WASD</span> / <span class="help-key">${t('help:keyboard.arrowKeys')}</span> ${t('help:keyboard.move')}</div>
        <div class="help-row"><span class="help-key">${t('help:keyboard.space')}</span> ${t('help:keyboard.placeBomb')}</div>
        <div class="help-row"><span class="help-key">E</span> ${t('help:keyboard.detonateRemote')}</div>
        <div class="help-row"><span class="help-key">Q</span> ${t('help:keyboard.throwBomb')}</div>
        <div class="help-row"><span class="help-key">1</span>–<span class="help-key">6</span> ${t('help:keyboard.sendEmote')}</div>
        <div class="help-row"><span class="help-key">1</span>–<span class="help-key">9</span> ${t('help:keyboard.spectateNth')}</div>
      </div>

      <div class="help-section">
        <div class="help-heading">${t('help:gamepad.heading')}</div>
        <div class="help-tip">${t('help:gamepad.tip')}</div>
        <div class="help-row"><span class="help-key">${t('help:gamepad.dpad')}</span> / <span class="help-key">${t('help:gamepad.leftStick')}</span> ${t('help:keyboard.move')}</div>
        <div class="help-row"><span class="help-key">A</span> ${t('help:gamepad.placeBomb')}</div>
        <div class="help-row"><span class="help-key">B</span> ${t('help:gamepad.detonateRemote')}</div>
        <div class="help-row"><span class="help-key">Y</span> ${t('help:gamepad.throwBomb')}</div>
        <div class="help-row"><span class="help-key">LB</span> / <span class="help-key">RB</span> ${t('help:gamepad.cycleSpectate')}</div>
        <div class="help-heading help-heading-spaced">${t('help:gamepad.menuNavHeading')}</div>
        <div class="help-row"><span class="help-key">${t('help:gamepad.dpad')}</span> / <span class="help-key">${t('help:gamepad.leftStick')}</span> ${t('help:gamepad.navigateMenus')}</div>
        <div class="help-row"><span class="help-key">A</span> ${t('help:gamepad.confirm')}</div>
        <div class="help-row"><span class="help-key">B</span> ${t('help:gamepad.back')}</div>
      </div>

      <div class="help-section">
        <div class="help-heading">${t('help:mechanics.heading')}</div>
        <div class="help-row"><b>${t('help:mechanics.bombs')}</b> ${t('help:mechanics.bombsDesc')}</div>
        <div class="help-row"><b>${t('help:mechanics.chainReactions')}</b> — ${t('help:mechanics.chainReactionsDesc')}</div>
        <div class="help-row"><b>${t('help:mechanics.kickedBombs')}</b> ${t('help:mechanics.kickedBombsDesc')}</div>
        <div class="help-row"><b>${t('help:mechanics.shieldBreak')}</b> — ${t('help:mechanics.shieldBreakDesc')}</div>
        <div class="help-row"><b>${t('help:mechanics.spawnInvuln')}</b> — ${t('help:mechanics.spawnInvulnDesc')}</div>
        <div class="help-row"><b>${t('help:mechanics.selfKills')}</b> ${t('help:mechanics.selfKillsDesc')}</div>
        <div class="help-row"><b>${t('help:mechanics.gracePeriod')}</b> — ${t('help:mechanics.gracePeriodDesc')}</div>
      </div>

      <div class="help-section">
        <div class="help-heading">${t('help:spectator.heading')}</div>
        <div class="help-tip">${t('help:spectator.tip')}</div>
        <div class="help-row"><span class="help-key">WASD</span> / <span class="help-key">${t('help:spectator.arrows')}</span> / <span class="help-key">${t('help:spectator.mouseDrag')}</span> ${t('help:spectator.freeCam')}</div>
        <div class="help-row"><span class="help-key">${t('help:spectator.click')}</span> ${t('help:spectator.followPlayer')}</div>
        <div class="help-row"><span class="help-key">1</span>–<span class="help-key">9</span> ${t('help:spectator.jumpToNth')}</div>
        <div class="help-row">${t('help:spectator.breakFollow')}</div>
      </div>
    `;
  }

  private renderPowerUpsTab(): void {
    if (!this.contentEl) return;

    const wrapper = document.createElement('div');
    const powerUpDetails = getPowerUpDetails();

    const tip = document.createElement('div');
    tip.className = 'help-tip';
    tip.textContent = t('help:powerUps.tip');
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
        <div class="help-powerup-name" style="color:${def.color}">${t(`game:powerups.${type}.name`)}</div>
        <div class="help-powerup-desc">${powerUpDetails[type] || t(`game:powerups.${type}.description`)}</div>
      `;
      row.appendChild(info);

      wrapper.appendChild(row);
    }

    this.contentEl.appendChild(wrapper);
  }

  private renderGameModesTab(): void {
    const modeDetails = getModeDetails();
    let html = '';
    for (const [mode, config] of Object.entries(GAME_MODES)) {
      const detail = modeDetails[mode] || config.description;
      const tags: string[] = [];
      if (config.hasZone) tags.push(t('help:modeTags.shrinkingZone'));
      if (config.hasRespawn) tags.push(t('help:modeTags.respawn'));
      if (config.hasHill) tags.push(t('help:modeTags.zoneControl'));
      if (config.teamsCount) tags.push(t('help:modeTags.teams', { count: config.teamsCount }));

      html += `
        <div class="help-mode-card">
          <div class="help-mode-header">
            <span class="help-mode-name">${t(`game:modes.${mode}.name`)}</span>
            <span class="help-mode-players">${t('help:gameModes.playerRange', { min: config.minPlayers, max: config.maxPlayers })}</span>
          </div>
          ${tags.length ? `<div class="help-mode-tags">${tags.map((tag) => `<span class="help-mode-tag">${tag}</span>`).join('')}</div>` : ''}
          <div class="help-mode-desc">${detail}</div>
        </div>
      `;
    }
    this.contentEl!.innerHTML = html;
  }

  private renderMapFeaturesTab(): void {
    if (!this.contentEl) return;

    const wrapper = document.createElement('div');

    // Reinforced Walls section — with tile previews
    const wallSection = document.createElement('div');
    wallSection.className = 'help-section';
    wallSection.innerHTML = `
      <div class="help-heading">${t('help:mapFeatures.reinforcedWalls.heading')}</div>
      <div class="help-tip">${t('help:mapFeatures.reinforcedWalls.tip')}</div>
      <div class="help-row" id="help-reinforced-row"></div>
    `;
    wrapper.appendChild(wallSection);

    const reinforcedRow = wallSection.querySelector('#help-reinforced-row')!;
    const wallCanvas = renderTileCanvas('wall', 22);
    wallCanvas.className = 'help-tile';
    reinforcedRow.appendChild(wallCanvas);
    const destCanvas = renderTileCanvas('destructible', 22);
    destCanvas.className = 'help-tile';
    reinforcedRow.appendChild(destCanvas);
    const crackedCanvas = renderTileCanvas('destructible_cracked', 22);
    crackedCanvas.className = 'help-tile';
    reinforcedRow.appendChild(crackedCanvas);
    reinforcedRow.insertAdjacentHTML('beforeend', ` ${t('help:mapFeatures.reinforcedWalls.desc')}`);

    // Dynamic Events section
    const eventsSection = document.createElement('div');
    eventsSection.className = 'help-section';
    eventsSection.innerHTML = `
      <div class="help-heading">${t('help:mapFeatures.dynamicEvents.heading')}</div>
      <div class="help-tip">${t('help:mapFeatures.dynamicEvents.tip')}</div>
      <div class="help-row help-row-spaced">
        <b class="text-danger">${t('help:mapFeatures.dynamicEvents.meteorStrikes')}</b> — ${t('help:mapFeatures.dynamicEvents.meteorStrikesDesc')}
      </div>
      <div class="help-row help-row-spaced">
        <b class="text-success">${t('help:mapFeatures.dynamicEvents.powerUpRain')}</b> — ${t('help:mapFeatures.dynamicEvents.powerUpRainDesc')}
      </div>
      <div class="help-row help-row-spaced">
        <b class="text-warning">${t('help:mapFeatures.dynamicEvents.wallCollapse')}</b> — ${t('help:mapFeatures.dynamicEvents.wallCollapseDesc')}
      </div>
      <div class="help-row help-row-spaced">
        <b style="color:var(--info)">${t('help:mapFeatures.dynamicEvents.freezeWave')}</b> — ${t('help:mapFeatures.dynamicEvents.freezeWaveDesc')}
      </div>
      <div class="help-row">
        <b class="text-danger">${t('help:mapFeatures.dynamicEvents.bombSurge')}</b> — ${t('help:mapFeatures.dynamicEvents.bombSurgeDesc')}
      </div>
    `;
    wrapper.appendChild(eventsSection);

    // Hazard Tiles section — with canvas tile previews
    const hazardSection = document.createElement('div');
    hazardSection.className = 'help-section';
    hazardSection.innerHTML = `
      <div class="help-heading">${t('help:mapFeatures.hazardTiles.heading')}</div>
      <div class="help-tip">${t('help:mapFeatures.hazardTiles.tip')}</div>
      <div class="help-row help-row-spaced" id="help-teleporter-row"></div>
      <div class="help-row" id="help-conveyor-row"></div>
    `;
    wrapper.appendChild(hazardSection);

    const teleRow = hazardSection.querySelector('#help-teleporter-row')!;
    const teleA = renderTileCanvas('teleporter_a', 22);
    teleA.className = 'help-tile';
    teleRow.appendChild(teleA);
    const teleB = renderTileCanvas('teleporter_b', 22);
    teleB.className = 'help-tile';
    teleRow.appendChild(teleB);
    teleRow.insertAdjacentHTML(
      'beforeend',
      ` <b>${t('help:mapFeatures.hazardTiles.teleporters')}</b> — ${t('help:mapFeatures.hazardTiles.teleportersDesc')}`,
    );

    const convRow = hazardSection.querySelector('#help-conveyor-row')!;
    const convCanvas = renderTileCanvas('conveyor_right', 22);
    convCanvas.className = 'help-tile';
    convRow.appendChild(convCanvas);
    convRow.insertAdjacentHTML(
      'beforeend',
      ` <b>${t('help:mapFeatures.hazardTiles.conveyorBelts')}</b> — ${t('help:mapFeatures.hazardTiles.conveyorBeltsDesc')}`,
    );

    // Theme Variants section — showcase wall/destructible across all themes
    const themeSection = document.createElement('div');
    themeSection.className = 'help-section';
    themeSection.innerHTML = `
      <div class="help-heading">${t('help:mapFeatures.themeVariants.heading')}</div>
      <div class="help-tip">${t('help:mapFeatures.themeVariants.tip')}</div>
    `;
    const themeGrid = document.createElement('div');
    themeGrid.className = 'help-theme-grid';
    const themes: CampaignWorldTheme[] = [
      'classic',
      'forest',
      'desert',
      'ice',
      'volcano',
      'void',
      'castle',
      'swamp',
      'sky',
    ];
    for (const theme of themes) {
      const palette = CAMPAIGN_THEME_PALETTES[theme];
      const cell = document.createElement('div');
      cell.className = 'help-theme-cell';
      const wallC = renderTileCanvas('wall', 28, palette);
      const destC = renderTileCanvas('destructible', 28, palette);
      cell.appendChild(wallC);
      cell.appendChild(destC);
      cell.insertAdjacentHTML(
        'beforeend',
        `<div class="help-theme-label">${CAMPAIGN_THEME_NAMES[theme]}</div>`,
      );
      themeGrid.appendChild(cell);
    }
    themeSection.appendChild(themeGrid);
    wrapper.appendChild(themeSection);

    this.contentEl.appendChild(wrapper);
  }

  private async renderGuidesTab(): Promise<void> {
    if (!this.contentEl) return;

    const guideDocs = getGuideDocs();
    this.contentEl.innerHTML = guideDocs
      .map(
        (doc) => `
      <details class="help-guide-section" data-doc="${doc.filename}">
        <summary>${doc.title}</summary>
        <div class="help-markdown"><div class="help-status">${t('help:loading')}</div></div>
      </details>
    `,
      )
      .join('');

    // Load docs in parallel
    const sections = this.contentEl.querySelectorAll<HTMLElement>('.help-guide-section');
    const promises = guideDocs.map(async (doc, i) => {
      try {
        const html = await this.fetchAndParseDoc(`/api/docs/${doc.filename}`);
        const content = sections[i]?.querySelector('.help-markdown');
        if (content) content.innerHTML = html;
      } catch {
        const content = sections[i]?.querySelector('.help-markdown');
        if (content) {
          content.innerHTML = `<div class="help-status-error">${t('help:failedToLoadDoc', { title: doc.title })} <button class="btn btn-ghost" data-retry="${i}">${t('help:retry')}</button></div>`;
          content.querySelector(`[data-retry="${i}"]`)?.addEventListener('click', async () => {
            content.innerHTML = `<div class="help-status">${t('help:loading')}</div>`;
            try {
              const html = await this.fetchAndParseDoc(`/api/docs/${doc.filename}`, true);
              content.innerHTML = html;
            } catch {
              content.innerHTML = `<div class="help-status-error">${t('help:failedToLoad')}</div>`;
            }
          });
        }
      }
    });

    await Promise.all(promises);
  }

  private async renderLevelEditorTab(): Promise<void> {
    if (!this.contentEl) return;

    const wrapper = document.createElement('div');

    // Tile Reference section
    const refSection = document.createElement('div');
    refSection.className = 'help-section';
    refSection.innerHTML = `
      <div class="help-heading">${t('help:levelEditor.tileReference')}</div>
      <div class="help-tip">${t('help:levelEditor.tileRefTip')}</div>
    `;
    wrapper.appendChild(refSection);

    // Helper to create a tile row with canvas + description
    const tileRow = (
      tiles: Parameters<typeof renderTileCanvas>[0][],
      text: string,
      spaced = true,
    ): HTMLDivElement => {
      const row = document.createElement('div');
      row.className = spaced ? 'help-row help-row-spaced' : 'help-row';
      for (const tile of tiles) {
        const c = renderTileCanvas(tile, 22);
        c.className = 'help-tile';
        row.appendChild(c);
      }
      row.insertAdjacentHTML('beforeend', ` ${text}`);
      return row;
    };

    // Basic Tiles
    const basicHeading = document.createElement('div');
    basicHeading.className = 'help-subheading';
    basicHeading.textContent = t('help:levelEditor.basicTiles');
    refSection.appendChild(basicHeading);
    refSection.appendChild(tileRow(['wall'], t('help:levelEditor.wall')));
    refSection.appendChild(tileRow(['destructible'], t('help:levelEditor.destructible')));
    refSection.appendChild(
      tileRow(['destructible_cracked'], t('help:levelEditor.destructibleCracked')),
    );

    // Mechanics
    const mechHeading = document.createElement('div');
    mechHeading.className = 'help-subheading';
    mechHeading.textContent = t('help:levelEditor.mechanics');
    refSection.appendChild(mechHeading);
    refSection.appendChild(
      tileRow(['teleporter_a', 'teleporter_b'], t('help:levelEditor.teleporter')),
    );
    refSection.appendChild(
      tileRow(
        ['conveyor_right', 'conveyor_up', 'conveyor_down', 'conveyor_left'],
        t('help:levelEditor.conveyor'),
      ),
    );

    // Campaign-Only Tiles
    const campHeading = document.createElement('div');
    campHeading.className = 'help-subheading';
    campHeading.textContent = t('help:levelEditor.campaignTiles');
    refSection.appendChild(campHeading);
    refSection.appendChild(tileRow(['exit'], t('help:levelEditor.exit')));
    refSection.appendChild(tileRow(['goal'], t('help:levelEditor.goal')));

    // Puzzle Tiles
    const puzzleHeading = document.createElement('div');
    puzzleHeading.className = 'help-subheading';
    puzzleHeading.textContent = t('help:levelEditor.puzzleTiles');
    refSection.appendChild(puzzleHeading);
    refSection.appendChild(
      tileRow(
        ['switch_red', 'switch_blue', 'switch_green', 'switch_yellow'],
        t('help:levelEditor.switch'),
      ),
    );
    refSection.appendChild(
      tileRow(['gate_red', 'gate_blue', 'gate_green', 'gate_yellow'], t('help:levelEditor.gate')),
    );
    refSection.appendChild(tileRow(['crumbling'], t('help:levelEditor.crumbling')));

    // Hazard Tiles
    const hazHeading = document.createElement('div');
    hazHeading.className = 'help-subheading';
    hazHeading.textContent = t('help:levelEditor.hazardTiles');
    refSection.appendChild(hazHeading);
    refSection.appendChild(tileRow(['vine'], t('help:levelEditor.vine')));
    refSection.appendChild(tileRow(['quicksand'], t('help:levelEditor.quicksand')));
    refSection.appendChild(tileRow(['ice'], t('help:levelEditor.ice')));
    refSection.appendChild(tileRow(['lava'], t('help:levelEditor.lava')));
    refSection.appendChild(tileRow(['mud'], t('help:levelEditor.mud')));
    refSection.appendChild(tileRow(['spikes'], t('help:levelEditor.spikes')));
    refSection.appendChild(tileRow(['dark_rift'], t('help:levelEditor.darkRift'), false));

    // Full docs section (loaded async)
    const docsSection = document.createElement('div');
    docsSection.className = 'help-section';
    docsSection.innerHTML = `
      <div class="help-heading">${t('help:levelEditor.fullDocs')}</div>
      <div class="help-tip">${t('help:levelEditor.fullDocsDesc')}</div>
      <div class="help-markdown"><div class="help-status">${t('help:loading')}</div></div>
    `;
    wrapper.appendChild(docsSection);

    this.contentEl.appendChild(wrapper);

    // Load markdown docs
    const markdownEl = docsSection.querySelector('.help-markdown')!;
    try {
      const html = await this.fetchAndParseDoc('/api/docs/campaign.md');
      markdownEl.innerHTML = html;
    } catch {
      markdownEl.innerHTML = `<div class="help-status-error">${t('help:failedToLoadLevelEditor')}</div>`;
    }
  }

  private async renderAdminDocsTab(): Promise<void> {
    if (!this.contentEl) return;

    const staffDocs = getStaffDocs();
    this.contentEl.innerHTML = staffDocs
      .map(
        (doc) => `
      <details class="help-guide-section" data-doc="${doc.filename}">
        <summary>${doc.title}</summary>
        <div class="help-markdown"><div class="help-status">${t('help:loading')}</div></div>
      </details>
    `,
      )
      .join('');

    const sections = this.contentEl.querySelectorAll<HTMLElement>('.help-guide-section');
    const promises = staffDocs.map(async (doc, i) => {
      try {
        const isYaml = doc.filename.endsWith('.yaml');
        const content = await this.fetchRawDoc(`/api/docs/admin/${doc.filename}`);
        const el = sections[i]?.querySelector('.help-markdown');
        if (el) {
          if (isYaml) {
            el.innerHTML = `<pre><code>${this.escapeForPre(content)}</code></pre>`;
          } else {
            el.innerHTML = DOMPurify.sanitize(await marked.parse(content));
          }
        }
      } catch {
        const el = sections[i]?.querySelector('.help-markdown');
        if (el) {
          el.innerHTML = `<div class="help-status-error">${t('help:failedToLoadDoc', { title: doc.title })}</div>`;
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
    const html = DOMPurify.sanitize(await marked.parse(raw));
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
        `<a class="admin-tab help-external-link" href="https://github.com/phoen-ix/blastarena/" target="_blank" rel="noopener">${t('help:github')}</a>`,
      );
    }
    if (this.displayImprint) {
      rightLinks.push(
        `<button class="admin-tab help-external-link" data-tab="imprint">${t('help:imprint.tab')}</button>`,
      );
    }

    this.container.innerHTML = `
      <div class="view-content">
        <div class="admin-tabs" id="help-tab-bar">
          ${this.tabs
            .map(
              (tab) =>
                `<button class="admin-tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>`,
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
      const resp = await ApiClient.get<{
        imprint: boolean;
        displayGithub: boolean;
      }>('/admin/settings/public');
      this.displayImprint = resp.imprint;
      this.displayGithub = resp.displayGithub;
    } catch {
      // defaults
    }
  }

  private async showImprintTab(): Promise<void> {
    if (!this.contentEl) return;
    // Deactivate all tabs, activate imprint
    this.container.querySelectorAll('.admin-tab').forEach((el) => el.classList.remove('active'));
    this.container.querySelector('[data-tab="imprint"]')?.classList.add('active');
    this.activeTabId = '';

    this.contentEl.innerHTML = `<div class="help-section"><p>${t('help:imprint.loading')}</p></div>`;
    try {
      const resp = await ApiClient.get<{ enabled: boolean; text: string }>(
        '/admin/settings/imprint',
      );
      const text = resp.text || t('help:imprint.noInfo');
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      this.contentEl.innerHTML = `<div class="help-section" style="white-space:pre-wrap;line-height:1.6;">${escaped}</div>`;
    } catch {
      this.contentEl.innerHTML = `<div class="help-section"><p class="text-danger">${t('help:imprint.failedToLoad')}</p></div>`;
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
