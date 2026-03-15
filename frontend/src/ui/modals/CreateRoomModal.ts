import { SocketClient } from '../../network/SocketClient';
import { NotificationUI } from '../NotificationUI';
import { PowerUpType, POWERUP_DEFINITIONS, Room } from '@blast-arena/shared';

export interface CreateRoomModalDeps {
  socketClient: SocketClient;
  notifications: NotificationUI;
  onRoomCreated: (room: Room) => void;
  generateRoomName: () => string;
}

export function showCreateRoomModal(deps: CreateRoomModalDeps): void {
  const { socketClient, notifications, onRoomCreated, generateRoomName } = deps;
  const allPowerUps = Object.values(POWERUP_DEFINITIONS);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:760px;max-width:95vw;padding:24px 28px;">
      <h2>Create Room</h2>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        <div class="form-group" style="margin-bottom:0;">
          <label>Room Name</label>
          <input type="text" id="room-name" placeholder="My Arena" maxlength="30">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Game Mode</label>
          <select id="room-mode">
            <option value="ffa">Free for All</option>
            <option value="teams">Teams</option>
            <option value="battle_royale">Battle Royale</option>
            <option value="sudden_death">Sudden Death</option>
            <option value="deathmatch">Deathmatch</option>
            <option value="king_of_the_hill">King of the Hill</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Max Players</label>
          <select id="room-max-players">
            <option value="2">2</option>
            <option value="4" selected>4</option>
            <option value="6">6</option>
            <option value="8">8</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Match Time</label>
          <select id="room-round-time">
            <option value="60">1 min</option>
            <option value="120">2 min</option>
            <option value="180" selected>3 min</option>
            <option value="300">5 min</option>
            <option value="600">10 min</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Map Size</label>
          <select id="room-map-size">
            <option value="11">11x11 (Small)</option>
            <option value="15" selected>15x15 (Normal)</option>
            <option value="19">19x19 (Large)</option>
            <option value="25">25x25 (Huge)</option>
            <option value="31">31x31 (Massive)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Wall Density</label>
          <select id="room-wall-density">
            <option value="0.3">Low (30%)</option>
            <option value="0.5">Medium (50%)</option>
            <option value="0.65" selected>High (65%)</option>
            <option value="0.8">Very High (80%)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Power-Up Rate</label>
          <select id="room-powerup-rate">
            <option value="0">None (0%)</option>
            <option value="0.15">Low (15%)</option>
            <option value="0.3" selected>Normal (30%)</option>
            <option value="0.5">High (50%)</option>
            <option value="0.8">Very High (80%)</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Bots</label>
          <select id="room-bots">
            <option value="0" selected>None</option>
            <option value="1">1 Bot</option>
            <option value="2">2 Bots</option>
            <option value="3">3 Bots</option>
            <option value="4">4 Bots</option>
            <option value="5">5 Bots</option>
            <option value="6">6 Bots</option>
            <option value="7">7 Bots</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0;" id="bot-difficulty-row">
          <label>Bot Difficulty</label>
          <select id="room-bot-difficulty" disabled>
            <option value="easy">Easy</option>
            <option value="normal" selected>Normal</option>
            <option value="hard">Hard</option>
          </select>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center;">
        <span style="color:var(--text-dim);font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin-right:4px;">Options</span>
        <label style="display:flex;align-items:center;gap:5px;padding:5px 10px;
          background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;">
          <input type="checkbox" id="room-reinforced-walls" style="accent-color:#886633;">
          <span style="color:#b8884d;font-weight:600;">Reinforced Walls</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;padding:5px 10px;
          background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;">
          <input type="checkbox" id="room-map-events" style="accent-color:var(--warning);">
          <span style="color:var(--warning);font-weight:600;">Map Events</span>
        </label>
        <label style="display:flex;align-items:center;gap:5px;padding:5px 10px;
          background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;">
          <input type="checkbox" id="room-hazard-tiles" style="accent-color:var(--info);">
          <span style="color:var(--info);font-weight:600;">Hazard Tiles</span>
        </label>
        <span id="friendly-fire-row" style="display:none;">
          <label style="display:flex;align-items:center;gap:5px;padding:5px 10px;
            background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;">
            <input type="checkbox" id="room-friendly-fire" checked style="accent-color:var(--danger);">
            <span style="color:var(--danger);font-weight:600;">Friendly Fire</span>
          </label>
        </span>
      </div>

      <div style="margin-top:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="color:var(--text-dim);font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Power-Ups</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${allPowerUps
            .map(
              (pu) => `
            <label style="display:flex;align-items:center;gap:5px;padding:4px 9px;
              background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:12px;">
              <input type="checkbox" class="powerup-check" value="${pu.type}" checked
                style="accent-color:${pu.color};">
              <span style="color:${pu.color};font-weight:600;">${pu.name}</span>
            </label>
          `,
            )
            .join('')}
        </div>
      </div>

      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-create">Create</button>
      </div>
    </div>
  `;

  // Show friendly fire option only for teams mode
  const modeSelect = modal.querySelector('#room-mode') as HTMLSelectElement;
  const ffRow = modal.querySelector('#friendly-fire-row') as HTMLElement;
  const updateFFVisibility = () => {
    ffRow.style.display = modeSelect.value === 'teams' ? 'inline' : 'none';
  };
  modeSelect.addEventListener('change', updateFFVisibility);
  updateFFVisibility();

  // Enable bot difficulty only when bots > 0
  const botsSelect = modal.querySelector('#room-bots') as HTMLSelectElement;
  const botDiffSelect = modal.querySelector('#room-bot-difficulty') as HTMLSelectElement;
  const updateBotDiffEnabled = () => {
    const hasBots = parseInt(botsSelect.value) > 0;
    botDiffSelect.disabled = !hasBots;
    botDiffSelect.style.opacity = hasBots ? '1' : '0.4';
  };
  botsSelect.addEventListener('change', updateBotDiffEnabled);
  updateBotDiffEnabled();

  modal.querySelector('#modal-cancel')!.addEventListener('click', () => modal.remove());
  modal.querySelector('#modal-create')!.addEventListener('click', () => {
    const name = (modal.querySelector('#room-name') as HTMLInputElement).value.trim();
    const gameMode = (modal.querySelector('#room-mode') as HTMLSelectElement).value as any;
    const maxPlayers = parseInt(
      (modal.querySelector('#room-max-players') as HTMLSelectElement).value,
    );
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
      notifications.info(`Bot count capped to ${effectiveBots} (max ${maxPlayers} players)`);
    }

    const mapSize = parseInt((modal.querySelector('#room-map-size') as HTMLSelectElement).value);
    const friendlyFire =
      gameMode === 'teams'
        ? (modal.querySelector('#room-friendly-fire') as HTMLInputElement).checked
        : true;
    const reinforcedWalls = (modal.querySelector('#room-reinforced-walls') as HTMLInputElement)
      .checked;
    const enableMapEvents = (modal.querySelector('#room-map-events') as HTMLInputElement).checked;
    const hazardTiles = (modal.querySelector('#room-hazard-tiles') as HTMLInputElement).checked;

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
          hazardTiles,
        },
      },
      (response: any) => {
        if (response.success && response.room) {
          modal.remove();
          notifications.success('Room created!');
          onRoomCreated(response.room);
        } else {
          notifications.error(response.error || 'Failed to create room');
        }
      },
    );
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  document.getElementById('ui-overlay')!.appendChild(modal);
}
