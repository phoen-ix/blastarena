import { ApiClient } from '../network/ApiClient';
import { SocketClient } from '../network/SocketClient';
import { AuthManager } from '../network/AuthManager';
import { NotificationUI } from './NotificationUI';
import { UIGamepadNavigator } from '../game/UIGamepadNavigator';
import { PartyBar } from './PartyBar';
import { escapeHtml } from '../utils/html';
import { getErrorMessage } from '@blast-arena/shared';
import { showLocalCoopModal } from './modals/LocalCoopModal';
import { showBuddyModal, BuddyLaunchConfig } from './modals/BuddyModal';
import { LocalCoopP2Identity } from '../game/LocalCoopInput';
import game from '../main';

interface CampaignLevel {
  id: number;
  name: string;
  description: string;
  enemyCount: number;
  lives: number;
  timeLimit: number;
  completed: boolean;
  stars: number;
  bestTime: number | null;
  locked: boolean;
}

interface CampaignWorld {
  id: number;
  name: string;
  description: string;
  theme: string;
  levelCount?: number;
  completedCount?: number;
  levels: CampaignLevel[];
}

export class CampaignUI {
  private container: HTMLElement;
  private notifications: NotificationUI;
  private socketClient: SocketClient;
  private authManager: AuthManager;
  private onClose: () => void;
  private partyBar: PartyBar | null;
  private expandedWorldId: number | null = null;
  private selectedLevelId: number | null = null;
  private worlds: CampaignWorld[] = [];
  private embedded = false;

  constructor(
    socketClient: SocketClient,
    notifications: NotificationUI,
    onClose: () => void,
    partyBar?: PartyBar,
    authManager?: AuthManager,
  ) {
    this.socketClient = socketClient;
    this.notifications = notifications;
    this.onClose = onClose;
    this.partyBar = partyBar ?? null;
    this.authManager = authManager ?? ({} as AuthManager);
    this.container = document.createElement('div');
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: var(--bg-base);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  async show(): Promise<void> {
    const uiOverlay = document.getElementById('ui-overlay');
    if (uiOverlay && !uiOverlay.contains(this.container)) {
      uiOverlay.appendChild(this.container);
    }
    await this.loadCampaignData();
    this.render();
    this.pushGamepadContext();
  }

  hide(): void {
    UIGamepadNavigator.getInstance().popContext('campaign');
    this.container.remove();
  }

  async renderEmbedded(container: HTMLElement): Promise<void> {
    this.embedded = true;
    this.container = container;
    await this.loadCampaignData();
    this.renderContent();
    this.pushGamepadContext();
  }

  destroy(): void {
    UIGamepadNavigator.getInstance().popContext('campaign');
    this.container.innerHTML = '';
    this.embedded = false;
    this.worlds = [];
    this.expandedWorldId = null;
    this.selectedLevelId = null;
  }

  private async loadCampaignData(): Promise<void> {
    try {
      const data = await ApiClient.get<{ worlds: any[] }>('/campaign/worlds');
      // Map API response into local CampaignWorld shape
      this.worlds = data.worlds.map((w: any) => {
        const levels: CampaignLevel[] = (w.levels || []).map((l: any, i: number) => {
          const prevCompleted = i === 0 || (w.levels[i - 1]?.progress?.completed ?? false);
          return {
            id: l.id,
            name: l.name,
            description: l.description || '',
            enemyCount: l.enemyCount || 0,
            lives: l.lives || 3,
            timeLimit: l.timeLimit || 0,
            completed: !!l.progress?.completed,
            stars: l.progress?.stars || 0,
            bestTime: l.progress?.bestTimeSeconds ?? null,
            locked: !prevCompleted && !l.progress?.completed,
          };
        });
        return {
          id: w.id,
          name: w.name,
          description: w.description || '',
          theme: w.theme || 'classic',
          levelCount: w.levelCount,
          completedCount: w.completedCount,
          levels,
        };
      });
    } catch (err: unknown) {
      this.notifications.error('Failed to load campaign: ' + getErrorMessage(err));
      this.worlds = [];
    }
  }

  private render(): void {
    this.container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: var(--bg-surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    `;

    const title = document.createElement('h1');
    title.style.cssText = `
      color: var(--primary);
      font-size: 24px;
      font-family: var(--font-display);
      font-weight: 700;
      letter-spacing: 3px;
      margin: 0;
    `;
    title.innerHTML = '<span style="color:var(--text);">CAMP</span>AIGN';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.textContent = 'Back to Lobby';
    backBtn.addEventListener('click', () => {
      this.hide();
      this.onClose();
    });

    header.appendChild(title);
    header.appendChild(backBtn);
    this.container.appendChild(header);

    this.renderContent();
  }

  private renderContent(): void {
    // Remove any existing content area (preserve header if present)
    const existingContent = this.container.querySelector('[data-campaign-content]');
    if (existingContent) existingContent.remove();

    // Content area
    const content = document.createElement('div');
    content.setAttribute('data-campaign-content', 'true');
    content.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    `;

    if (this.worlds.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        color: var(--text-muted);
        text-align: center;
        padding: 80px 20px;
        font-size: 15px;
      `;
      empty.textContent = 'No campaign worlds available yet.';
      content.appendChild(empty);
    } else {
      const worldStack = document.createElement('div');
      worldStack.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 720px;
        margin: 0 auto;
      `;

      for (const world of this.worlds) {
        worldStack.appendChild(this.createWorldCard(world));
      }

      content.appendChild(worldStack);
    }

    this.container.appendChild(content);
  }

  private createWorldCard(world: CampaignWorld): HTMLElement {
    const completedCount = world.levels.filter((l) => l.completed).length;
    const totalCount = world.levels.length;
    const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    const isExpanded = this.expandedWorldId === world.id;

    const card = document.createElement('div');
    card.style.cssText = `
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      transition: border-color 0.2s;
    `;

    // World header (clickable to expand/collapse)
    const worldHeader = document.createElement('div');
    worldHeader.style.cssText = `
      padding: 20px 24px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    worldHeader.dataset.worldId = String(world.id);
    worldHeader.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--primary)';
    });
    worldHeader.addEventListener('mouseleave', () => {
      card.style.borderColor = 'var(--border)';
    });

    // Top row: name + theme badge + chevron
    const topRow = document.createElement('div');
    topRow.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;

    const nameArea = document.createElement('div');
    nameArea.style.cssText = 'display:flex;align-items:center;gap:12px;';

    const worldName = document.createElement('span');
    worldName.style.cssText = `
      font-family: var(--font-display);
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    `;
    worldName.textContent = escapeHtml(world.name);

    const themeBadge = document.createElement('span');
    themeBadge.style.cssText = `
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--accent);
      background: rgba(0,212,170,0.1);
      padding: 3px 8px;
      border-radius: 4px;
    `;
    themeBadge.textContent = escapeHtml(world.theme);

    nameArea.appendChild(worldName);
    nameArea.appendChild(themeBadge);

    const chevron = document.createElement('span');
    chevron.style.cssText = `
      font-size: 18px;
      color: var(--text-dim);
      transition: transform 0.2s;
      transform: rotate(${isExpanded ? '180deg' : '0deg'});
    `;
    chevron.textContent = '\u25BC';

    topRow.appendChild(nameArea);
    topRow.appendChild(chevron);

    // Description
    const desc = document.createElement('div');
    desc.style.cssText = `
      font-size: 13px;
      color: var(--text-dim);
      line-height: 1.4;
    `;
    desc.textContent = escapeHtml(world.description);

    // Progress bar row
    const progressRow = document.createElement('div');
    progressRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    const progressBar = document.createElement('div');
    progressBar.style.cssText = `
      flex: 1;
      height: 6px;
      background: var(--bg-elevated);
      border-radius: 3px;
      overflow: hidden;
    `;

    const progressFill = document.createElement('div');
    progressFill.style.cssText = `
      height: 100%;
      width: ${progressPct}%;
      background: ${completedCount === totalCount ? 'var(--success)' : 'var(--primary)'};
      border-radius: 3px;
      transition: width 0.3s;
    `;
    progressBar.appendChild(progressFill);

    const progressLabel = document.createElement('span');
    progressLabel.style.cssText = `
      font-size: 12px;
      color: var(--text-dim);
      white-space: nowrap;
      font-weight: 600;
    `;
    progressLabel.textContent = `${completedCount}/${totalCount}`;

    progressRow.appendChild(progressBar);
    progressRow.appendChild(progressLabel);

    worldHeader.appendChild(topRow);
    worldHeader.appendChild(desc);
    worldHeader.appendChild(progressRow);
    card.appendChild(worldHeader);

    // Level list (shown when expanded)
    const levelContainer = document.createElement('div');
    levelContainer.style.cssText = `
      display: ${isExpanded ? 'flex' : 'none'};
      flex-direction: column;
      gap: 0;
      border-top: 1px solid var(--border);
    `;

    for (const level of world.levels) {
      levelContainer.appendChild(this.createLevelCard(level));
    }

    card.appendChild(levelContainer);

    // Toggle expand on click
    worldHeader.addEventListener('click', () => {
      if (this.expandedWorldId === world.id) {
        this.expandedWorldId = null;
        levelContainer.style.display = 'none';
        chevron.style.transform = 'rotate(0deg)';
      } else {
        // Collapse previously expanded
        const prevExpanded = this.container.querySelector('[data-expanded="true"]');
        if (prevExpanded) {
          (prevExpanded as HTMLElement).style.display = 'none';
          prevExpanded.removeAttribute('data-expanded');
          const prevChevron = prevExpanded.parentElement?.querySelector(
            'span[style*="transform"]',
          ) as HTMLElement | null;
          if (prevChevron) prevChevron.style.transform = 'rotate(0deg)';
        }
        this.expandedWorldId = world.id;
        levelContainer.style.display = 'flex';
        levelContainer.setAttribute('data-expanded', 'true');
        chevron.style.transform = 'rotate(180deg)';
      }
      this.selectedLevelId = null;
    });

    return card;
  }

  private createLevelCard(level: CampaignLevel): HTMLElement {
    const isSelected = this.selectedLevelId === level.id;
    const isAvailable = !level.locked && !level.completed;

    const card = document.createElement('div');
    card.style.cssText = `
      padding: 14px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      cursor: ${level.locked ? 'default' : 'pointer'};
      opacity: ${level.locked ? '0.4' : '1'};
      background: ${isSelected ? 'var(--bg-elevated)' : 'transparent'};
      transition: background 0.15s;
    `;

    card.dataset.levelId = String(level.id);
    if (level.locked) card.dataset.locked = 'true';

    if (!level.locked) {
      card.addEventListener('mouseenter', () => {
        if (this.selectedLevelId !== level.id) {
          card.style.background = 'var(--bg-hover)';
        }
      });
      card.addEventListener('mouseleave', () => {
        card.style.background =
          this.selectedLevelId === level.id ? 'var(--bg-elevated)' : 'transparent';
      });
    }

    // Left side: level info
    const leftSide = document.createElement('div');
    leftSide.style.cssText = 'display:flex;flex-direction:column;gap:4px;flex:1;';

    const nameRow = document.createElement('div');
    nameRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const levelName = document.createElement('span');
    levelName.style.cssText = `
      font-family: var(--font-display);
      font-size: 15px;
      font-weight: 600;
      color: ${level.locked ? 'var(--text-muted)' : isAvailable ? 'var(--text)' : 'var(--text-dim)'};
    `;
    levelName.textContent = escapeHtml(level.name);

    nameRow.appendChild(levelName);

    if (level.locked) {
      const lockIcon = document.createElement('span');
      lockIcon.style.cssText = 'font-size:13px;color:var(--text-muted);';
      lockIcon.textContent = '\uD83D\uDD12';
      nameRow.appendChild(lockIcon);
    }

    if (level.completed) {
      const checkmark = document.createElement('span');
      checkmark.style.cssText = 'font-size:14px;color:var(--success);';
      checkmark.textContent = '\u2713';
      nameRow.appendChild(checkmark);

      if (level.stars > 0) {
        const starsEl = document.createElement('span');
        starsEl.style.cssText = 'font-size:13px;color:var(--warning);letter-spacing:1px;';
        starsEl.textContent = '\u2605'.repeat(level.stars) + '\u2606'.repeat(3 - level.stars);
        nameRow.appendChild(starsEl);
      }

      if (level.bestTime !== null) {
        const mins = Math.floor(level.bestTime / 60);
        const secs = level.bestTime % 60;
        const timeEl = document.createElement('span');
        timeEl.style.cssText = 'font-size:12px;color:var(--text-muted);';
        timeEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        nameRow.appendChild(timeEl);
      }
    }

    if (isAvailable) {
      const availDot = document.createElement('span');
      availDot.style.cssText = `
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--primary);
        display: inline-block;
        box-shadow: 0 0 6px var(--primary);
      `;
      nameRow.appendChild(availDot);
    }

    const levelDesc = document.createElement('div');
    levelDesc.style.cssText = `
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.3;
    `;
    levelDesc.textContent = escapeHtml(level.description);

    leftSide.appendChild(nameRow);
    leftSide.appendChild(levelDesc);

    // Right side: stats + start button
    const rightSide = document.createElement('div');
    rightSide.style.cssText = 'display:flex;align-items:center;gap:16px;flex-shrink:0;';

    // Stats badges
    const statsArea = document.createElement('div');
    statsArea.style.cssText = 'display:flex;gap:10px;align-items:center;';

    const enemyBadge = this.createStatBadge(`${level.enemyCount}`, 'enemies', 'var(--danger)');
    const livesBadge = this.createStatBadge(
      `${level.lives}`,
      level.lives === 1 ? 'life' : 'lives',
      'var(--success)',
    );

    const timerMins = Math.floor(level.timeLimit / 60);
    const timerSecs = level.timeLimit % 60;
    const timerStr =
      timerSecs > 0 ? `${timerMins}:${timerSecs.toString().padStart(2, '0')}` : `${timerMins}m`;
    const timerBadge = this.createStatBadge(timerStr, 'time', 'var(--warning)');

    statsArea.appendChild(enemyBadge);
    statsArea.appendChild(livesBadge);
    statsArea.appendChild(timerBadge);
    rightSide.appendChild(statsArea);

    // Start button area (shown when selected and not locked)
    if (isSelected && !level.locked) {
      const btnArea = document.createElement('div');
      btnArea.style.cssText = 'display: flex; gap: 8px; align-items: center;';

      const startBtn = document.createElement('button');
      startBtn.className = 'btn btn-primary';
      startBtn.style.cssText = `
        font-size: 14px;
        padding: 8px 20px;
        font-weight: 700;
        letter-spacing: 0.5px;
      `;
      startBtn.textContent = 'Start';
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startLevel(level.id);
      });
      btnArea.appendChild(startBtn);

      // Online co-op button: shown when in a 2-person party as the leader
      const party = this.partyBar?.getParty();
      if (party && party.members.length === 2) {
        const coopBtn = document.createElement('button');
        coopBtn.className = 'btn btn-secondary';
        coopBtn.style.cssText = `
          font-size: 14px;
          padding: 8px 16px;
          font-weight: 700;
          letter-spacing: 0.5px;
        `;
        coopBtn.textContent = 'Co-op';
        coopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.startLevel(level.id, true);
        });
        btnArea.appendChild(coopBtn);
      }

      // Local co-op button: always available
      const localCoopBtn = document.createElement('button');
      localCoopBtn.className = 'btn btn-ghost';
      localCoopBtn.style.cssText = `
        font-size: 13px;
        padding: 8px 12px;
        font-weight: 600;
      `;
      localCoopBtn.textContent = 'Local Co-op';
      localCoopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showLocalCoopSetup(level.id);
      });
      btnArea.appendChild(localCoopBtn);

      // Buddy mode button: always available
      const buddyBtn = document.createElement('button');
      buddyBtn.className = 'btn btn-ghost';
      buddyBtn.style.cssText = `
        font-size: 13px;
        padding: 8px 12px;
        font-weight: 600;
        color: var(--accent);
      `;
      buddyBtn.textContent = 'Buddy';
      buddyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showBuddySetup(level.id);
      });
      btnArea.appendChild(buddyBtn);

      rightSide.appendChild(btnArea);
    }

    card.appendChild(leftSide);
    card.appendChild(rightSide);

    // Click to select (if not locked)
    if (!level.locked) {
      card.addEventListener('click', () => {
        if (this.selectedLevelId === level.id) {
          this.selectedLevelId = null;
        } else {
          this.selectedLevelId = level.id;
        }
        if (this.embedded) {
          this.renderContent();
        } else {
          this.render();
        }
      });
    }

    return card;
  }

  private createStatBadge(value: string, label: string, color: string): HTMLElement {
    const badge = document.createElement('div');
    badge.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
    `;

    const valEl = document.createElement('span');
    valEl.style.cssText = `
      font-family: var(--font-display);
      font-size: 14px;
      font-weight: 700;
      color: ${color};
    `;
    valEl.textContent = value;

    const labelEl = document.createElement('span');
    labelEl.style.cssText = `
      font-size: 10px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    `;
    labelEl.textContent = label;

    badge.appendChild(valEl);
    badge.appendChild(labelEl);
    return badge;
  }

  private pushGamepadContext(): void {
    const gpNav = UIGamepadNavigator.getInstance();
    gpNav.popContext('campaign');
    gpNav.pushContext({
      id: 'campaign',
      elements: () => [
        ...this.container.querySelectorAll<HTMLElement>('.btn-secondary'),
        ...this.container.querySelectorAll<HTMLElement>('[data-world-id]'),
        ...this.container.querySelectorAll<HTMLElement>(
          '[data-level-id]:not([data-locked="true"])',
        ),
        ...this.container.querySelectorAll<HTMLElement>('.btn-primary'),
      ],
      onBack: () => {
        this.hide();
        this.onClose();
      },
    });
  }

  private showLocalCoopSetup(levelId: number): void {
    showLocalCoopModal(
      (config) => {
        game.registry.set('localCoopConfig', config);
        if (config.p2Identity) {
          game.registry.set('localCoopP2Identity', config.p2Identity);
        }
        this.startLevel(levelId, false, true);
      },
      () => {
        /* cancel — do nothing */
      },
      this.authManager,
    );
  }

  private showBuddySetup(levelId: number): void {
    showBuddyModal(
      (config: BuddyLaunchConfig) => {
        game.registry.set('localCoopConfig', config);
        game.registry.set('buddyMode', true);
        game.registry.set('buddyConfig', config.buddySettings);
        this.startLevel(levelId, false, true, true);
      },
      () => {
        /* cancel — do nothing */
      },
    );
  }

  private async startLevel(
    levelId: number,
    coopMode = false,
    localCoopMode = false,
    buddyMode = false,
  ): Promise<void> {
    try {
      this.notifications.info('Loading level...');

      // Fetch enemy types for texture generation
      const enemyTypesResp = await ApiClient.get<any>('/campaign/enemy-types');

      // Listen for the server's initial state before transitioning
      const gameStartHandler = (data: any) => {
        this.socketClient.off('campaign:gameStart' as any, gameStartHandler as any);

        // Clear all DOM overlays
        const uiOverlay = document.getElementById('ui-overlay');
        if (uiOverlay) {
          while (uiOverlay.firstChild) {
            uiOverlay.removeChild(uiOverlay.firstChild);
          }
        }

        // Set registry flags for GameScene
        const registry = game.registry;
        registry.set('campaignMode', true);
        registry.set('campaignCoopMode', coopMode || localCoopMode || buddyMode);
        registry.set('localCoopMode', localCoopMode || buddyMode);
        registry.set('initialGameState', data.state.gameState);
        registry.set('campaignEnemyTypes', enemyTypesResp.enemyTypes || []);

        // Transition to GameScene + HUDScene
        const activeScene = game.scene.getScene('LobbyScene') || game.scene.getScene('MenuScene');
        if (activeScene) {
          activeScene.scene.start('GameScene');
          activeScene.scene.launch('HUDScene');
        }
      };
      this.socketClient.on('campaign:gameStart' as any, gameStartHandler as any);

      // Build start data
      const startData: any = { levelId };
      if (buddyMode) {
        startData.buddyMode = true;
      } else if (coopMode) {
        startData.coopMode = true;
      } else if (localCoopMode) {
        startData.localCoopMode = true;
        const p2Id = game.registry.get('localCoopP2Identity') as LocalCoopP2Identity | undefined;
        if (p2Id?.mode === 'loggedIn' && p2Id.loggedInUserId) {
          startData.localP2 = { userId: p2Id.loggedInUserId, username: p2Id.loggedInUsername };
        } else {
          startData.localP2 = {
            username: p2Id?.guestName || 'Player 2',
            guestColor: p2Id?.guestColor,
          };
        }
      }

      // Emit campaign:start socket event
      this.socketClient.emit('campaign:start' as any, startData, (response: any) => {
        if (response && response.error) {
          this.socketClient.off('campaign:gameStart' as any, gameStartHandler as any);
          this.notifications.error(response.error);
        }
      });
    } catch (err: unknown) {
      this.notifications.error('Failed to start level: ' + getErrorMessage(err));
    }
  }
}
