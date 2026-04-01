import { ILobbyView, ViewDeps } from './types';
import { ApiClient } from '../../network/ApiClient';
import {
  PowerUpType,
  POWERUP_DEFINITIONS,
  Room,
  GameDefaults,
  BotAIEntry,
  CustomMapSummary,
} from '@blast-arena/shared';
import game from '../../main';
import { renderMapPreview } from '../../utils/mapPreview';
import { getCustomMapTiles } from '../../utils/mapPreviewCache';
import { t } from '../../i18n';

export class CreateRoomView implements ILobbyView {
  readonly viewId = 'create-room';
  get title() {
    return t('ui:createRoom.title');
  }

  private deps: ViewDeps;
  private container: HTMLElement | null = null;
  private onRoomCreated: (room: Room) => void;
  private onCancel: () => void;
  private recordingsEnabled = false;
  private gameDefaults: GameDefaults = {};
  private activeAIs: BotAIEntry[] = [];
  private myMaps: CustomMapSummary[] = [];
  private publishedMaps: CustomMapSummary[] = [];

  constructor(deps: ViewDeps, onRoomCreated: (room: Room) => void, onCancel: () => void) {
    this.deps = deps;
    this.onRoomCreated = onRoomCreated;
    this.onCancel = onCancel;
  }

  async render(container: HTMLElement): Promise<void> {
    this.container = container;

    // Load settings in parallel
    try {
      const [recResp, defResp, aiResp, myMapsResp, pubMapsResp] = await Promise.all([
        ApiClient.get<{ enabled: boolean }>('/admin/settings/recordings_enabled'),
        ApiClient.get<{ defaults: GameDefaults }>('/admin/settings/game_defaults'),
        ApiClient.get<{ ais: BotAIEntry[] }>('/admin/ai/active'),
        ApiClient.get<{ maps: CustomMapSummary[] }>('/maps/mine').catch(() => ({ maps: [] })),
        ApiClient.get<{ maps: CustomMapSummary[] }>('/maps/published').catch(() => ({ maps: [] })),
      ]);
      this.recordingsEnabled = recResp.enabled;
      this.gameDefaults = defResp.defaults ?? {};
      this.activeAIs = aiResp.ais ?? [];
      this.myMaps = myMapsResp.maps ?? [];
      this.publishedMaps = pubMapsResp.maps ?? [];
    } catch {
      // defaults
    }

    this.renderForm();
  }

  destroy(): void {
    this.container = null;
  }

  private renderForm(): void {
    if (!this.container) return;

    const allPowerUps = Object.values(POWERUP_DEFINITIONS);
    const hasMultipleAIs = this.activeAIs.length > 1;

    this.container.innerHTML = `
      <div class="create-room-page">
        <div class="create-room-content">
          <div class="create-room-section">
            <h3 class="create-room-section-title">${t('ui:createRoom.general')}</h3>
            <div class="create-room-grid">
              <div class="form-group">
                <label>${t('ui:createRoom.roomName')}</label>
                <input type="text" class="input" id="cr-name" placeholder="${t('ui:createRoom.roomNamePlaceholder')}" maxlength="30">
              </div>
              <div class="form-group">
                <label>${t('ui:createRoom.gameMode')}</label>
                <select class="select" id="cr-mode">
                  <option value="ffa">${t('game:modes.ffa.name')}</option>
                  <option value="teams">${t('game:modes.teams.name')}</option>
                  <option value="battle_royale">${t('game:modes.battle_royale.name')}</option>
                  <option value="sudden_death">${t('game:modes.sudden_death.name')}</option>
                  <option value="deathmatch">${t('game:modes.deathmatch.name')}</option>
                  <option value="king_of_the_hill">${t('game:modes.king_of_the_hill.name')}</option>
                </select>
              </div>
              <div class="form-group">
                <label>${t('ui:createRoom.maxPlayers')}</label>
                <select class="select" id="cr-max-players">
                  <option value="2">2</option>
                  <option value="4" selected>4</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                </select>
              </div>
              <div class="form-group">
                <label>${t('ui:createRoom.matchTime')}</label>
                <select class="select" id="cr-round-time">
                  <option value="60">${t('ui:createRoom.matchTimes.60')}</option>
                  <option value="120">${t('ui:createRoom.matchTimes.120')}</option>
                  <option value="180" selected>${t('ui:createRoom.matchTimes.180')}</option>
                  <option value="300">${t('ui:createRoom.matchTimes.300')}</option>
                  <option value="600">${t('ui:createRoom.matchTimes.600')}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="create-room-section">
            <h3 class="create-room-section-title">${t('ui:createRoom.map')}</h3>
            <div class="create-room-grid">
              <div class="form-group" style="grid-column:1/-1;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <label style="flex:1;">${t('ui:createRoom.map')}</label>
                  <button class="btn btn-sm btn-ghost" id="cr-new-map" style="font-size:11px;padding:2px 8px;">${t('ui:createRoom.newMap')}</button>
                </div>
                <select class="select" id="cr-custom-map">
                  <option value="">${t('ui:createRoom.randomGenerated')}</option>
                  ${this.buildMapOptions()}
                </select>
                <div id="cr-map-hint" style="font-size:10px;color:var(--text-dim);margin-top:2px;display:none;"></div>
                <div id="cr-map-preview" style="margin-top:8px;display:none;"></div>
              </div>
              <div class="form-group">
                <label>${t('ui:createRoom.mapSize')}</label>
                <select class="select" id="cr-map-size">
                  <option value="21">${t('ui:createRoom.mapSizes.21')}</option>
                  <option value="31" selected>${t('ui:createRoom.mapSizes.31')}</option>
                  <option value="39">${t('ui:createRoom.mapSizes.39')}</option>
                  <option value="51">${t('ui:createRoom.mapSizes.51')}</option>
                  <option value="61">${t('ui:createRoom.mapSizes.61')}</option>
                </select>
              </div>
              <div class="form-group">
                <label>${t('ui:createRoom.wallDensity')}</label>
                <select class="select" id="cr-wall-density">
                  <option value="0.3">${t('ui:createRoom.wallDensities.low30')}</option>
                  <option value="0.5">${t('ui:createRoom.wallDensities.med50')}</option>
                  <option value="0.65" selected>${t('ui:createRoom.wallDensities.high65')}</option>
                  <option value="0.8">${t('ui:createRoom.wallDensities.vhigh80')}</option>
                </select>
              </div>
              <div class="form-group">
                <label>${t('ui:createRoom.powerUpRate')}</label>
                <select class="select" id="cr-powerup-rate">
                  <option value="0">${t('ui:createRoom.puRates.none0')}</option>
                  <option value="0.15">${t('ui:createRoom.puRates.low15')}</option>
                  <option value="0.3" selected>${t('ui:createRoom.puRates.normal30')}</option>
                  <option value="0.5">${t('ui:createRoom.puRates.high50')}</option>
                  <option value="0.8">${t('ui:createRoom.puRates.vhigh80')}</option>
                </select>
              </div>
            </div>
          </div>

          <div class="create-room-section">
            <h3 class="create-room-section-title">${t('ui:createRoom.bots')}</h3>
            <div class="create-room-grid">
              <div class="form-group">
                <label>${t('ui:createRoom.botCount')}</label>
                <select class="select" id="cr-bots">
                  <option value="0" selected>${t('ui:createRoom.none')}</option>
                  <option value="1">${t('ui:createRoom.nBots', { count: 1 })}</option>
                  <option value="2">${t('ui:createRoom.nBots', { count: 2 })}</option>
                  <option value="3">${t('ui:createRoom.nBots', { count: 3 })}</option>
                  <option value="4">${t('ui:createRoom.nBots', { count: 4 })}</option>
                  <option value="5">${t('ui:createRoom.nBots', { count: 5 })}</option>
                  <option value="6">${t('ui:createRoom.nBots', { count: 6 })}</option>
                  <option value="7">${t('ui:createRoom.nBots', { count: 7 })}</option>
                </select>
              </div>
              <div class="form-group">
                <label>${t('ui:createRoom.botDifficulty')}</label>
                <select class="select" id="cr-bot-difficulty" disabled>
                  <option value="easy">${t('ui:createRoom.difficulty.easy')}</option>
                  <option value="normal" selected>${t('ui:createRoom.difficulty.normal')}</option>
                  <option value="hard">${t('ui:createRoom.difficulty.hard')}</option>
                </select>
              </div>
              ${
                hasMultipleAIs
                  ? `
              <div class="form-group">
                <label>${t('ui:createRoom.botAI')}</label>
                <select class="select" id="cr-bot-ai" disabled>
                  ${this.activeAIs.map((ai) => `<option value="${ai.id}"${ai.isBuiltin ? ' selected' : ''}>${ai.name}</option>`).join('')}
                </select>
              </div>
              `
                  : ''
              }
            </div>
          </div>

          <div class="create-room-section">
            <h3 class="create-room-section-title">${t('ui:createRoom.options')}</h3>
            <div class="create-room-options">
              <label class="option-chip">
                <input type="checkbox" id="cr-reinforced-walls" style="accent-color:var(--warning);">
                <span style="color:var(--warning);">${t('ui:createRoom.reinforcedWalls')}</span>
              </label>
              <label class="option-chip">
                <input type="checkbox" id="cr-map-events" style="accent-color:var(--warning);">
                <span style="color:var(--warning);">${t('ui:createRoom.mapEvents')}</span>
              </label>
              <label class="option-chip">
                <input type="checkbox" id="cr-hazard-tiles" style="accent-color:var(--info);">
                <span style="color:var(--info);">${t('ui:createRoom.hazardTiles')}</span>
              </label>
            </div>
            <div id="cr-event-types" class="create-room-options" style="display:none; margin-left:1rem; margin-top:0.25rem; padding-left:0.5rem; border-left:2px solid var(--warning);">
              ${[
                'meteor',
                'powerup_rain',
                'wall_collapse',
                'freeze_wave',
                'bomb_surge',
                'ufo_abduction',
              ]
                .map(
                  (evt) => `
              <label class="option-chip">
                <input type="checkbox" class="cr-event-type" value="${evt}" checked style="accent-color:var(--warning);">
                <span style="color:var(--warning);">${t(`ui:createRoom.eventTypes.${evt}`)}</span>
              </label>`,
                )
                .join('')}
            </div>
            <div id="cr-hazard-types" class="create-room-options" style="display:none; margin-left:1rem; margin-top:0.25rem; padding-left:0.5rem; border-left:2px solid var(--info);">
              ${['vine', 'quicksand', 'ice', 'lava', 'mud', 'spikes', 'dark_rift']
                .map(
                  (hz) => `
              <label class="option-chip">
                <input type="checkbox" class="cr-hazard-type" value="${hz}" checked style="accent-color:var(--info);">
                <span style="color:var(--info);">${t(`ui:createRoom.hazardTypes.${hz}`)}</span>
              </label>`,
                )
                .join('')}
            </div>
            <div class="create-room-options" style="margin-top:0;">
              ${
                this.recordingsEnabled
                  ? `
              <label class="option-chip">
                <input type="checkbox" id="cr-record-game" checked style="accent-color:var(--accent);">
                <span style="color:var(--accent);">${t('ui:createRoom.recordGame')}</span>
              </label>`
                  : ''
              }
              <span id="cr-ff-row" style="display:none;">
                <label class="option-chip">
                  <input type="checkbox" id="cr-friendly-fire" checked style="accent-color:var(--danger);">
                  <span style="color:var(--danger);">${t('ui:createRoom.friendlyFire')}</span>
                </label>
              </span>
            </div>
          </div>

          <div class="create-room-section">
            <h3 class="create-room-section-title">${t('ui:createRoom.powerUps')}</h3>
            <div class="create-room-options">
              ${allPowerUps
                .map(
                  (pu) => `
                <label class="option-chip">
                  <input type="checkbox" class="powerup-check" value="${pu.type}" checked style="accent-color:${pu.color};">
                  <span style="color:${pu.color};">${t(`game:powerups.${pu.type}.name`)}</span>
                </label>
              `,
                )
                .join('')}
            </div>
          </div>

          <div class="create-room-actions">
            <button class="btn btn-ghost" id="cr-cancel">${t('ui:createRoom.cancel')}</button>
            <button class="btn btn-primary" id="cr-submit">${t('ui:createRoom.create')}</button>
          </div>
        </div>
      </div>
    `;

    this.applyDefaults();
    this.bindEvents();
  }

  private applyDefaults(): void {
    if (!this.container || !this.gameDefaults) return;
    const d = this.gameDefaults;

    const setSelect = (id: string, value: string | number | undefined) => {
      if (value === undefined) return;
      const el = this.container!.querySelector(id) as HTMLSelectElement | null;
      if (el) el.value = String(value);
    };
    const setCheckbox = (id: string, value: boolean | undefined) => {
      if (value === undefined) return;
      const el = this.container!.querySelector(id) as HTMLInputElement | null;
      if (el) el.checked = value;
    };

    setSelect('#cr-mode', d.gameMode);
    setSelect('#cr-max-players', d.maxPlayers);
    setSelect('#cr-round-time', d.roundTime);
    setSelect('#cr-map-size', d.mapWidth);
    setSelect('#cr-wall-density', d.wallDensity);
    setSelect('#cr-powerup-rate', d.powerUpDropRate);
    setSelect('#cr-bots', d.botCount);
    setSelect('#cr-bot-difficulty', d.botDifficulty);
    setCheckbox('#cr-reinforced-walls', d.reinforcedWalls);
    setCheckbox('#cr-map-events', d.enableMapEvents);
    setCheckbox('#cr-hazard-tiles', d.hazardTiles);
    setCheckbox('#cr-friendly-fire', d.friendlyFire);
    setSelect('#cr-bot-ai', d.botAiId);

    if (d.enabledPowerUps) {
      const enabled = new Set(d.enabledPowerUps);
      this.container.querySelectorAll('.powerup-check').forEach((cb) => {
        (cb as HTMLInputElement).checked = enabled.has(
          (cb as HTMLInputElement).value as PowerUpType,
        );
      });
    }
  }

  private bindEvents(): void {
    if (!this.container) return;

    // Friendly fire visibility
    const modeSelect = this.container.querySelector('#cr-mode') as HTMLSelectElement;
    const ffRow = this.container.querySelector('#cr-ff-row') as HTMLElement;
    const updateFF = () => {
      ffRow.style.display = modeSelect.value === 'teams' ? 'inline' : 'none';
    };
    modeSelect.addEventListener('change', updateFF);
    updateFF();

    // Map events / hazard tiles sub-panel toggles
    const mapEventsCheck = this.container.querySelector('#cr-map-events') as HTMLInputElement;
    const eventTypesPanel = this.container.querySelector('#cr-event-types') as HTMLElement;
    const hazardCheck = this.container.querySelector('#cr-hazard-tiles') as HTMLInputElement;
    const hazardTypesPanel = this.container.querySelector('#cr-hazard-types') as HTMLElement;

    const updateEventPanel = () => {
      eventTypesPanel.style.display = mapEventsCheck.checked ? 'flex' : 'none';
    };
    const updateHazardPanel = () => {
      hazardTypesPanel.style.display = hazardCheck.checked ? 'flex' : 'none';
    };
    mapEventsCheck.addEventListener('change', updateEventPanel);
    hazardCheck.addEventListener('change', updateHazardPanel);
    updateEventPanel();
    updateHazardPanel();

    // Bot difficulty/AI enable
    const botsSelect = this.container.querySelector('#cr-bots') as HTMLSelectElement;
    const botDiffSelect = this.container.querySelector('#cr-bot-difficulty') as HTMLSelectElement;
    const botAiSelect = this.container.querySelector('#cr-bot-ai') as HTMLSelectElement | null;
    const maxPlayersSelect = this.container.querySelector('#cr-max-players') as HTMLSelectElement;

    const updateBots = () => {
      const bots = parseInt(botsSelect.value);
      const hasBots = bots > 0;
      botDiffSelect.disabled = !hasBots;
      botDiffSelect.style.opacity = hasBots ? '1' : '0.4';
      if (botAiSelect) {
        botAiSelect.disabled = !hasBots;
        botAiSelect.style.opacity = hasBots ? '1' : '0.4';
      }
      const needed = bots + 1;
      const currentMax = parseInt(maxPlayersSelect.value);
      if (needed > currentMax) {
        const options = Array.from(maxPlayersSelect.options).map((o) => parseInt(o.value));
        const fit = options.find((v) => v >= needed);
        if (fit) maxPlayersSelect.value = String(fit);
      }
    };
    botsSelect.addEventListener('change', updateBots);
    updateBots();

    // Custom map selection
    const customMapSelect = this.container.querySelector('#cr-custom-map') as HTMLSelectElement;
    const mapSizeSelect = this.container.querySelector('#cr-map-size') as HTMLSelectElement;
    const wallDensitySelect = this.container.querySelector('#cr-wall-density') as HTMLSelectElement;
    const mapHint = this.container.querySelector('#cr-map-hint') as HTMLElement;
    const allMaps = [...this.myMaps, ...this.publishedMaps];
    const mapById = new Map(allMaps.map((m) => [String(m.id), m]));

    const updateMapSelection = () => {
      const val = customMapSelect.value;
      const isCustom = val !== '';
      mapSizeSelect.disabled = isCustom;
      mapSizeSelect.style.opacity = isCustom ? '0.4' : '1';
      wallDensitySelect.disabled = isCustom;
      wallDensitySelect.style.opacity = isCustom ? '0.4' : '1';

      if (isCustom) {
        const map = mapById.get(val);
        if (map) {
          const maxP = parseInt(maxPlayersSelect.value);
          if (map.spawnCount < maxP) {
            mapHint.textContent = t('ui:createRoom.mapSpawnHint', { count: map.spawnCount });
            mapHint.style.display = 'block';
            mapHint.style.color = 'var(--warning)';
          } else {
            mapHint.textContent = t('ui:createRoom.mapDimensions', {
              width: map.mapWidth,
              height: map.mapHeight,
            });
            mapHint.style.display = 'block';
            mapHint.style.color = 'var(--text-dim)';
          }
        }
      } else {
        mapHint.style.display = 'none';
      }

      // Map preview
      const previewEl = this.container?.querySelector('#cr-map-preview') as HTMLElement | null;
      if (previewEl) {
        if (isCustom) {
          previewEl.style.display = 'block';
          previewEl.innerHTML = `<span style="font-size:11px;color:var(--text-muted);">${t('ui:createRoom.loadingPreview')}</span>`;
          const selectedVal = val;
          getCustomMapTiles(parseInt(selectedVal))
            .then((data) => {
              if (customMapSelect.value !== selectedVal) return;
              const canvas = renderMapPreview(data.tiles, { maxCanvasSize: 200 });
              canvas.style.cssText = 'border:1px solid var(--border);border-radius:4px;';
              previewEl.innerHTML = '';
              previewEl.appendChild(canvas);
            })
            .catch(() => {
              if (customMapSelect.value !== selectedVal) return;
              previewEl.style.display = 'none';
            });
        } else {
          previewEl.style.display = 'none';
          previewEl.innerHTML = '';
        }
      }
    };
    customMapSelect.addEventListener('change', updateMapSelection);
    maxPlayersSelect.addEventListener('change', updateMapSelection);

    // New Map button
    this.container.querySelector('#cr-new-map')!.addEventListener('click', () => {
      game.registry.set('editorMode', 'custom_map');
      game.registry.set('customMapId', null);
      const lobbyScene = game.scene.getScene('LobbyScene');
      if (lobbyScene) lobbyScene.scene.start('LevelEditorScene');
    });

    // Cancel
    this.container.querySelector('#cr-cancel')!.addEventListener('click', () => {
      this.onCancel();
    });

    // Create
    this.container.querySelector('#cr-submit')!.addEventListener('click', () => {
      this.submitRoom();
    });
  }

  private submitRoom(): void {
    if (!this.container) return;

    const name = (this.container.querySelector('#cr-name') as HTMLInputElement).value.trim();
    const gameMode = (this.container.querySelector('#cr-mode') as HTMLSelectElement).value as any;
    const maxPlayers = parseInt(
      (this.container.querySelector('#cr-max-players') as HTMLSelectElement).value,
    );
    const roundTime = parseInt(
      (this.container.querySelector('#cr-round-time') as HTMLSelectElement).value,
    );
    const wallDensity = parseFloat(
      (this.container.querySelector('#cr-wall-density') as HTMLSelectElement).value,
    );
    const powerUpDropRate = parseFloat(
      (this.container.querySelector('#cr-powerup-rate') as HTMLSelectElement).value,
    );
    const botCount = parseInt(
      (this.container.querySelector('#cr-bots') as HTMLSelectElement).value,
    );
    const botDifficulty = (this.container.querySelector('#cr-bot-difficulty') as HTMLSelectElement)
      .value as 'easy' | 'normal' | 'hard';
    const botAiSelect = this.container.querySelector('#cr-bot-ai') as HTMLSelectElement | null;
    const mapSize = parseInt(
      (this.container.querySelector('#cr-map-size') as HTMLSelectElement).value,
    );
    const customMapValue = (this.container.querySelector('#cr-custom-map') as HTMLSelectElement)
      .value;
    const customMapId = customMapValue ? parseInt(customMapValue, 10) : undefined;

    const enabledPowerUps: PowerUpType[] = [];
    this.container.querySelectorAll('.powerup-check:checked').forEach((cb: any) => {
      enabledPowerUps.push(cb.value as PowerUpType);
    });

    const roomName = name || this.generateRoomName();
    const effectiveBots = Math.min(botCount, maxPlayers - 1);
    if (effectiveBots < botCount) {
      this.deps.notifications.info(
        t('ui:createRoom.botsCapped', { count: effectiveBots, max: maxPlayers }),
      );
    }

    const friendlyFire =
      gameMode === 'teams'
        ? (this.container.querySelector('#cr-friendly-fire') as HTMLInputElement).checked
        : true;
    const reinforcedWalls = (
      this.container.querySelector('#cr-reinforced-walls') as HTMLInputElement
    ).checked;
    const enableMapEvents = (this.container.querySelector('#cr-map-events') as HTMLInputElement)
      .checked;
    const selectedMapEvents = enableMapEvents
      ? Array.from(this.container.querySelectorAll('.cr-event-type:checked')).map(
          (cb) => (cb as HTMLInputElement).value,
        )
      : undefined;
    const hazardTiles = (this.container.querySelector('#cr-hazard-tiles') as HTMLInputElement)
      .checked;
    const selectedHazardTiles = hazardTiles
      ? Array.from(this.container.querySelectorAll('.cr-hazard-type:checked')).map(
          (cb) => (cb as HTMLInputElement).value,
        )
      : undefined;
    const recordGame = this.recordingsEnabled
      ? ((this.container.querySelector('#cr-record-game') as HTMLInputElement)?.checked ?? true)
      : false;

    this.deps.socketClient.emit(
      'room:create',
      {
        name: roomName,
        config: {
          gameMode,
          maxPlayers,
          mapWidth: mapSize,
          mapHeight: mapSize,
          roundTime,
          wallDensity,
          enabledPowerUps,
          powerUpDropRate,
          botCount: effectiveBots,
          botDifficulty: effectiveBots > 0 ? botDifficulty : undefined,
          friendlyFire,
          reinforcedWalls,
          enableMapEvents,
          selectedMapEvents,
          hazardTiles,
          selectedHazardTiles,
          recordGame,
          botAiId: effectiveBots > 0 && botAiSelect ? botAiSelect.value : undefined,
          customMapId,
        },
      },
      (response: any) => {
        if (response.success && response.room) {
          this.deps.notifications.success(t('ui:createRoom.roomCreated'));
          this.onRoomCreated(response.room);
        } else {
          this.deps.notifications.error(response.error || t('ui:createRoom.createFailed'));
        }
      },
    );
  }

  private buildMapOptions(): string {
    const myMapIds = new Set(this.myMaps.map((m) => m.id));
    // Community maps = published maps not created by this user
    const communityMaps = this.publishedMaps.filter((m) => !myMapIds.has(m.id));
    let html = '';
    if (this.myMaps.length > 0) {
      html += `<optgroup label="${t('ui:createRoom.myMaps')}">`;
      for (const m of this.myMaps) {
        html += `<option value="${m.id}">${m.name} (${m.mapWidth}x${m.mapHeight}, ${m.spawnCount} spawns)</option>`;
      }
      html += '</optgroup>';
    }
    if (communityMaps.length > 0) {
      html += `<optgroup label="${t('ui:createRoom.communityMaps')}">`;
      for (const m of communityMaps) {
        const by = m.creatorUsername ? ` by ${m.creatorUsername}` : '';
        const rating = m.avgRating
          ? ` ${'★'.repeat(Math.round(m.avgRating))}${'☆'.repeat(5 - Math.round(m.avgRating))}`
          : '';
        html += `<option value="${m.id}">${m.name}${by}${rating} (${m.mapWidth}x${m.mapHeight}, ${m.spawnCount} spawns)</option>`;
      }
      html += '</optgroup>';
    }
    return html;
  }

  private generateRoomName(): string {
    const adjectives = [
      'Explosive',
      'Chaotic',
      'Blazing',
      'Fiery',
      'Reckless',
      'Volatile',
      'Scorched',
      'Molten',
      'Infernal',
      'Savage',
    ];
    const nouns = [
      'Arena',
      'Warzone',
      'Blitz',
      'Showdown',
      'Brawl',
      'Mayhem',
      'Rumble',
      'Frenzy',
      'Clash',
      'Carnage',
    ];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
  }
}
