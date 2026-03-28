import { SocketClient } from '../../network/SocketClient';
import { NotificationUI } from '../NotificationUI';
import {
  PowerUpType,
  POWERUP_DEFINITIONS,
  Room,
  GameDefaults,
  BotAIEntry,
  CustomMapSummary,
} from '@blast-arena/shared';
import { UIGamepadNavigator } from '../../game/UIGamepadNavigator';
import { renderMapPreview } from '../../utils/mapPreview';
import { getCustomMapTiles } from '../../utils/mapPreviewCache';
import { t } from '../../i18n';

export interface CreateRoomModalDeps {
  socketClient: SocketClient;
  notifications: NotificationUI;
  onRoomCreated: (room: Room) => void;
  generateRoomName: () => string;
  recordingsEnabled?: boolean;
  gameDefaults?: GameDefaults;
  activeAIs?: BotAIEntry[];
  customMaps?: CustomMapSummary[];
}

export function showCreateRoomModal(deps: CreateRoomModalDeps): void {
  const { socketClient, notifications, onRoomCreated, generateRoomName } = deps;
  const allPowerUps = Object.values(POWERUP_DEFINITIONS);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', t('ui:createRoom.title'));
  modal.innerHTML = `
    <div class="modal" style="width:760px;max-width:95vw;">
      <h2>${t('ui:createRoom.title')}</h2>

      <div class="form-grid">
        <div class="form-group">
          <label for="room-name">${t('ui:createRoom.roomName')}</label>
          <input type="text" id="room-name" placeholder="${t('ui:createRoom.roomNamePlaceholder')}" maxlength="30">
        </div>
        <div class="form-group">
          <label for="room-mode">${t('ui:createRoom.gameMode')}</label>
          <select id="room-mode">
            <option value="ffa">${t('game:modes.ffa.name')}</option>
            <option value="teams">${t('game:modes.teams.name')}</option>
            <option value="battle_royale">${t('game:modes.battle_royale.name')}</option>
            <option value="sudden_death">${t('game:modes.sudden_death.name')}</option>
            <option value="deathmatch">${t('game:modes.deathmatch.name')}</option>
            <option value="king_of_the_hill">${t('game:modes.king_of_the_hill.name')}</option>
          </select>
        </div>
        <div class="form-group">
          <label for="room-max-players">${t('ui:createRoom.maxPlayers')}</label>
          <select id="room-max-players">
            <option value="2">2</option>
            <option value="4" selected>4</option>
            <option value="6">6</option>
            <option value="8">8</option>
          </select>
        </div>
        <div class="form-group">
          <label for="room-round-time">${t('ui:createRoom.matchTime')}</label>
          <select id="room-round-time">
            <option value="60">${t('ui:createRoom.matchTimes.60')}</option>
            <option value="120">${t('ui:createRoom.matchTimes.120')}</option>
            <option value="180" selected>${t('ui:createRoom.matchTimes.180')}</option>
            <option value="300">${t('ui:createRoom.matchTimes.300')}</option>
            <option value="600">${t('ui:createRoom.matchTimes.600')}</option>
          </select>
        </div>
        ${
          deps.customMaps && deps.customMaps.length > 0
            ? `
        <div class="form-group">
          <label for="room-custom-map">${t('ui:createRoom.map')}</label>
          <select id="room-custom-map">
            <option value="">${t('ui:createRoom.randomGenerated')}</option>
            ${deps.customMaps.map((m) => `<option value="${m.id}">${t('ui:createRoom.mapOptionLabel', { name: m.name, width: m.mapWidth, height: m.mapHeight, spawns: m.spawnCount })}</option>`).join('')}
          </select>
          <div id="room-map-preview" style="margin-top:6px;display:none;"></div>
        </div>`
            : ''
        }
        <div class="form-group">
          <label for="room-map-size">${t('ui:createRoom.mapSize')}</label>
          <select id="room-map-size">
            <option value="21">${t('ui:createRoom.mapSizes.21')}</option>
            <option value="31" selected>${t('ui:createRoom.mapSizes.31')}</option>
            <option value="39">${t('ui:createRoom.mapSizes.39')}</option>
            <option value="51">${t('ui:createRoom.mapSizes.51')}</option>
            <option value="61">${t('ui:createRoom.mapSizes.61')}</option>
          </select>
        </div>
        <div class="form-group">
          <label for="room-wall-density">${t('ui:createRoom.wallDensity')}</label>
          <select id="room-wall-density">
            <option value="0.3">${t('ui:createRoom.wallDensities.low30')}</option>
            <option value="0.5">${t('ui:createRoom.wallDensities.med50')}</option>
            <option value="0.65" selected>${t('ui:createRoom.wallDensities.high65')}</option>
            <option value="0.8">${t('ui:createRoom.wallDensities.vhigh80')}</option>
          </select>
        </div>
        <div class="form-group">
          <label for="room-powerup-rate">${t('ui:createRoom.powerUpRate')}</label>
          <select id="room-powerup-rate">
            <option value="0">${t('ui:createRoom.puRates.none0')}</option>
            <option value="0.15">${t('ui:createRoom.puRates.low15')}</option>
            <option value="0.3" selected>${t('ui:createRoom.puRates.normal30')}</option>
            <option value="0.5">${t('ui:createRoom.puRates.high50')}</option>
            <option value="0.8">${t('ui:createRoom.puRates.vhigh80')}</option>
          </select>
        </div>
        <div class="form-group">
          <label for="room-bots">${t('ui:createRoom.bots')}</label>
          <select id="room-bots">
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
        <div class="form-group" id="bot-difficulty-row">
          <label for="room-bot-difficulty">${t('ui:createRoom.botDifficulty')}</label>
          <select id="room-bot-difficulty" disabled>
            <option value="easy">${t('ui:createRoom.difficulty.easy')}</option>
            <option value="normal" selected>${t('ui:createRoom.difficulty.normal')}</option>
            <option value="hard">${t('ui:createRoom.difficulty.hard')}</option>
          </select>
        </div>
        ${
          deps.activeAIs && deps.activeAIs.length > 1
            ? `
        <div class="form-group" id="bot-ai-row">
          <label for="room-bot-ai">${t('ui:createRoom.botAI')}</label>
          <select id="room-bot-ai" disabled>
            ${deps.activeAIs.map((ai) => `<option value="${ai.id}"${ai.isBuiltin ? ' selected' : ''}>${ai.name}</option>`).join('')}
          </select>
        </div>
        `
            : ''
        }
      </div>

      <div class="option-chips" style="margin-top:var(--sp-3);">
        <span class="settings-title" style="margin-bottom:0;margin-right:var(--sp-1);">${t('ui:createRoom.options')}</span>
        <label class="option-chip">
          <input type="checkbox" id="room-reinforced-walls" style="accent-color:var(--warning);">
          <span style="color:var(--warning);">${t('ui:createRoom.reinforcedWalls')}</span>
        </label>
        <label class="option-chip">
          <input type="checkbox" id="room-map-events" style="accent-color:var(--warning);">
          <span style="color:var(--warning);">${t('ui:createRoom.mapEvents')}</span>
        </label>
        <label class="option-chip">
          <input type="checkbox" id="room-hazard-tiles" style="accent-color:var(--info);">
          <span style="color:var(--info);">${t('ui:createRoom.hazardTiles')}</span>
        </label>
      </div>
      <div id="room-event-types" class="option-chips" style="display:none; margin-top:0.25rem; margin-left:1rem; padding-left:0.5rem; border-left:2px solid var(--warning);">
        ${['meteor', 'powerup_rain', 'wall_collapse', 'freeze_wave', 'bomb_surge', 'ufo_abduction']
          .map(
            (evt) => `
        <label class="option-chip">
          <input type="checkbox" class="room-event-type" value="${evt}" checked style="accent-color:var(--warning);">
          <span style="color:var(--warning);">${t(`ui:createRoom.eventTypes.${evt}`)}</span>
        </label>`,
          )
          .join('')}
      </div>
      <div id="room-hazard-types" class="option-chips" style="display:none; margin-top:0.25rem; margin-left:1rem; padding-left:0.5rem; border-left:2px solid var(--info);">
        ${['vine', 'quicksand', 'ice', 'lava', 'mud', 'spikes', 'dark_rift']
          .map(
            (hz) => `
        <label class="option-chip">
          <input type="checkbox" class="room-hazard-type" value="${hz}" checked style="accent-color:var(--info);">
          <span style="color:var(--info);">${t(`ui:createRoom.hazardTypes.${hz}`)}</span>
        </label>`,
          )
          .join('')}
      </div>
      <div class="option-chips" style="margin-top:0;">
        ${
          deps.recordingsEnabled
            ? `<label class="option-chip">
          <input type="checkbox" id="room-record-game" checked style="accent-color:var(--accent);">
          <span style="color:var(--accent);">${t('ui:createRoom.recordGame')}</span>
        </label>`
            : ''
        }
        <span id="friendly-fire-row" style="display:none;">
          <label class="option-chip">
            <input type="checkbox" id="room-friendly-fire" checked style="accent-color:var(--danger);">
            <span style="color:var(--danger);">${t('ui:createRoom.friendlyFire')}</span>
          </label>
        </span>
      </div>

      <div style="margin-top:var(--sp-3);">
        <div class="settings-title">${t('ui:createRoom.powerUps')}</div>
        <div class="option-chips">
          ${allPowerUps
            .map(
              (pu) => `
            <label class="option-chip">
              <input type="checkbox" class="powerup-check" value="${pu.type}" checked
                style="accent-color:${pu.color};">
              <span style="color:${pu.color};">${t(`game:powerups.${pu.type}.name`)}</span>
            </label>
          `,
            )
            .join('')}
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel">${t('ui:createRoom.cancel')}</button>
        <button class="btn btn-primary" id="modal-create">${t('ui:createRoom.create')}</button>
      </div>
    </div>
  `;

  // Apply admin-configured defaults
  if (deps.gameDefaults) {
    applyGameDefaults(modal, deps.gameDefaults);
  }

  // Show friendly fire option only for teams mode
  const modeSelect = modal.querySelector('#room-mode') as HTMLSelectElement;
  const ffRow = modal.querySelector('#friendly-fire-row') as HTMLElement;
  const updateFFVisibility = () => {
    ffRow.style.display = modeSelect.value === 'teams' ? 'inline' : 'none';
  };
  modeSelect.addEventListener('change', updateFFVisibility);
  updateFFVisibility();

  // Map events / hazard tiles sub-panel toggles
  const mapEventsCheck = modal.querySelector('#room-map-events') as HTMLInputElement;
  const eventTypesPanel = modal.querySelector('#room-event-types') as HTMLElement;
  const hazardCheck = modal.querySelector('#room-hazard-tiles') as HTMLInputElement;
  const hazardTypesPanel = modal.querySelector('#room-hazard-types') as HTMLElement;

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

  // Enable bot difficulty only when bots > 0
  const botsSelect = modal.querySelector('#room-bots') as HTMLSelectElement;
  const botDiffSelect = modal.querySelector('#room-bot-difficulty') as HTMLSelectElement;
  const botAiSelect = modal.querySelector('#room-bot-ai') as HTMLSelectElement | null;
  const maxPlayersSelect = modal.querySelector('#room-max-players') as HTMLSelectElement;
  const updateBotDiffEnabled = () => {
    const bots = parseInt(botsSelect.value);
    const hasBots = bots > 0;
    botDiffSelect.disabled = !hasBots;
    botDiffSelect.style.opacity = hasBots ? '1' : '0.4';
    if (botAiSelect) {
      botAiSelect.disabled = !hasBots;
      botAiSelect.style.opacity = hasBots ? '1' : '0.4';
    }
    // Auto-raise max players so bots + 1 host fit
    const needed = bots + 1;
    const currentMax = parseInt(maxPlayersSelect.value);
    if (needed > currentMax) {
      // Find the smallest option >= needed
      const options = Array.from(maxPlayersSelect.options).map((o) => parseInt(o.value));
      const fit = options.find((v) => v >= needed);
      if (fit) {
        maxPlayersSelect.value = String(fit);
      }
    }
  };
  botsSelect.addEventListener('change', updateBotDiffEnabled);
  updateBotDiffEnabled();

  // Custom map selection
  const customMapSelect = modal.querySelector('#room-custom-map') as HTMLSelectElement | null;
  const mapSizeSelect = modal.querySelector('#room-map-size') as HTMLSelectElement;
  const wallDensitySelectEl = modal.querySelector('#room-wall-density') as HTMLSelectElement;
  if (customMapSelect) {
    customMapSelect.addEventListener('change', () => {
      const isCustom = customMapSelect.value !== '';
      mapSizeSelect.disabled = isCustom;
      mapSizeSelect.style.opacity = isCustom ? '0.4' : '1';
      wallDensitySelectEl.disabled = isCustom;
      wallDensitySelectEl.style.opacity = isCustom ? '0.4' : '1';

      const previewEl = modal.querySelector('#room-map-preview') as HTMLElement | null;
      if (previewEl) {
        if (isCustom) {
          previewEl.style.display = 'block';
          previewEl.innerHTML = `<span style="font-size:11px;color:var(--text-muted);">${t('ui:createRoom.loadingPreview')}</span>`;
          const selectedVal = customMapSelect.value;
          getCustomMapTiles(parseInt(selectedVal))
            .then((data) => {
              if (customMapSelect.value !== selectedVal) return;
              const canvas = renderMapPreview(data.tiles, { maxCanvasSize: 180 });
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
    });
  }

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeModal();
  };
  const closeModal = () => {
    document.removeEventListener('keydown', escHandler);
    UIGamepadNavigator.getInstance().popContext('create-room-modal');
    modal.remove();
  };

  modal.querySelector('#modal-cancel')!.addEventListener('click', closeModal);
  modal.querySelector('#modal-create')!.addEventListener('click', () => {
    const name = (modal.querySelector('#room-name') as HTMLInputElement).value.trim();
    const gameMode = (modal.querySelector('#room-mode') as HTMLSelectElement).value as any;
    const maxPlayers = parseInt(maxPlayersSelect.value);
    const roundTime = parseInt(
      (modal.querySelector('#room-round-time') as HTMLSelectElement).value,
    );
    const wallDensity = parseFloat(
      (modal.querySelector('#room-wall-density') as HTMLSelectElement).value,
    );
    const powerUpDropRate = parseFloat(
      (modal.querySelector('#room-powerup-rate') as HTMLSelectElement).value,
    );
    const botCount = parseInt((modal.querySelector('#room-bots') as HTMLSelectElement).value);
    const botDifficulty = (modal.querySelector('#room-bot-difficulty') as HTMLSelectElement)
      .value as 'easy' | 'normal' | 'hard';

    const enabledPowerUps: PowerUpType[] = [];
    modal.querySelectorAll('.powerup-check:checked').forEach((cb: any) => {
      enabledPowerUps.push(cb.value as PowerUpType);
    });

    const roomName = name || generateRoomName();

    // Cap bots so total (1 host + bots) doesn't exceed maxPlayers
    const effectiveBots = Math.min(botCount, maxPlayers - 1);
    if (effectiveBots < botCount) {
      notifications.info(t('ui:createRoom.botsCapped', { count: effectiveBots, max: maxPlayers }));
    }

    const mapSize = parseInt((modal.querySelector('#room-map-size') as HTMLSelectElement).value);
    const customMapVal = (modal.querySelector('#room-custom-map') as HTMLSelectElement | null)
      ?.value;
    const customMapId = customMapVal ? parseInt(customMapVal, 10) : undefined;
    const friendlyFire =
      gameMode === 'teams'
        ? (modal.querySelector('#room-friendly-fire') as HTMLInputElement).checked
        : true;
    const reinforcedWalls = (modal.querySelector('#room-reinforced-walls') as HTMLInputElement)
      .checked;
    const enableMapEvents = (modal.querySelector('#room-map-events') as HTMLInputElement).checked;
    const selectedMapEvents = enableMapEvents
      ? Array.from(modal.querySelectorAll('.room-event-type:checked')).map(
          (cb) => (cb as HTMLInputElement).value,
        )
      : undefined;
    const hazardTiles = (modal.querySelector('#room-hazard-tiles') as HTMLInputElement).checked;
    const selectedHazardTiles = hazardTiles
      ? Array.from(modal.querySelectorAll('.room-hazard-type:checked')).map(
          (cb) => (cb as HTMLInputElement).value,
        )
      : undefined;
    const recordGame = deps.recordingsEnabled
      ? ((modal.querySelector('#room-record-game') as HTMLInputElement)?.checked ?? true)
      : false;

    socketClient.emit(
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
          closeModal();
          notifications.success(t('ui:createRoom.roomCreated'));
          onRoomCreated(response.room);
        } else {
          notifications.error(response.error || t('ui:createRoom.createFailed'));
        }
      },
    );
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', escHandler);
  document.getElementById('ui-overlay')!.appendChild(modal);

  UIGamepadNavigator.getInstance().pushContext({
    id: 'create-room-modal',
    elements: () => [
      ...modal.querySelectorAll<HTMLElement>(
        '.form-group input[type="text"], .form-group select:not([disabled])',
      ),
      ...modal.querySelectorAll<HTMLElement>('label:has(input[type="checkbox"])'),
      ...modal.querySelectorAll<HTMLElement>('#modal-cancel, #modal-create'),
    ],
    onBack: closeModal,
  });
}

function applyGameDefaults(modal: HTMLElement, defaults: GameDefaults): void {
  const setSelect = (id: string, value: string | number | undefined) => {
    if (value === undefined) return;
    const el = modal.querySelector(id) as HTMLSelectElement | null;
    if (el) el.value = String(value);
  };
  const setCheckbox = (id: string, value: boolean | undefined) => {
    if (value === undefined) return;
    const el = modal.querySelector(id) as HTMLInputElement | null;
    if (el) el.checked = value;
  };

  setSelect('#room-mode', defaults.gameMode);
  setSelect('#room-max-players', defaults.maxPlayers);
  setSelect('#room-round-time', defaults.roundTime);
  setSelect('#room-map-size', defaults.mapWidth);
  setSelect('#room-wall-density', defaults.wallDensity);
  setSelect('#room-powerup-rate', defaults.powerUpDropRate);
  setSelect('#room-bots', defaults.botCount);
  setSelect('#room-bot-difficulty', defaults.botDifficulty);
  setCheckbox('#room-reinforced-walls', defaults.reinforcedWalls);
  setCheckbox('#room-map-events', defaults.enableMapEvents);
  setCheckbox('#room-hazard-tiles', defaults.hazardTiles);
  setCheckbox('#room-friendly-fire', defaults.friendlyFire);
  setSelect('#room-bot-ai', defaults.botAiId);

  if (defaults.enabledPowerUps) {
    const enabled = new Set(defaults.enabledPowerUps);
    modal.querySelectorAll('.powerup-check').forEach((cb) => {
      const input = cb as HTMLInputElement;
      input.checked = enabled.has(input.value as PowerUpType);
    });
  }
}
