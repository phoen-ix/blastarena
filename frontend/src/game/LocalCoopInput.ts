import { GamepadManager, GamepadInput } from './GamepadManager';

export interface LocalPlayerInput {
  direction: 'up' | 'down' | 'left' | 'right' | null;
  action: 'bomb' | 'detonate' | null;
}

export type ControlPreset = 'wasd' | 'arrows' | 'numpad' | 'gamepad1' | 'gamepad2';
export type CameraMode = 'shared' | 'split-h' | 'split-v';

export interface LocalCoopConfig {
  p1Controls: ControlPreset;
  p2Controls: ControlPreset;
  cameraMode: CameraMode;
}

export const CONTROL_PRESET_LABELS: Record<ControlPreset, string> = {
  wasd: 'WASD + Space/E',
  arrows: 'Arrows + Enter/Shift',
  numpad: 'Numpad 8462 + Plus/Minus',
  gamepad1: 'Gamepad 1',
  gamepad2: 'Gamepad 2',
};

export const CAMERA_MODE_LABELS: Record<CameraMode, string> = {
  shared: 'Shared (Auto-Zoom)',
  'split-h': 'Split Horizontal',
  'split-v': 'Split Vertical',
};

export const DEFAULT_LOCAL_COOP_CONFIG: LocalCoopConfig = {
  p1Controls: 'wasd',
  p2Controls: 'numpad',
  cameraMode: 'shared',
};

const STORAGE_KEY = 'blast-arena-local-coop-controls';

export function loadLocalCoopConfig(): LocalCoopConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.p1Controls && parsed.p2Controls) {
        return { ...DEFAULT_LOCAL_COOP_CONFIG, ...parsed };
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_LOCAL_COOP_CONFIG };
}

export function saveLocalCoopConfig(config: LocalCoopConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

const WASD_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE']);
const ARROW_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'ShiftLeft',
  'ShiftRight',
]);
const NUMPAD_KEYS = new Set([
  'Numpad8',
  'Numpad4',
  'Numpad6',
  'Numpad2',
  'NumpadAdd',
  'NumpadSubtract',
]);

function getPresetKeyCodes(preset: ControlPreset): Set<string> {
  switch (preset) {
    case 'wasd':
      return WASD_KEYS;
    case 'arrows':
      return ARROW_KEYS;
    case 'numpad':
      return NUMPAD_KEYS;
    default:
      return new Set();
  }
}

/**
 * Handles dual-player input for local co-op campaign with configurable control presets.
 *
 * 5 presets: WASD, Arrows, Numpad, Gamepad 1, Gamepad 2.
 * Each player is assigned one preset. Keyboard takes priority over gamepad fallback
 * only when using a keyboard preset.
 */
export class LocalCoopInput {
  private gamepadManager: GamepadManager;
  private config: LocalCoopConfig;

  private keysDown: Set<string> = new Set();
  private trackedKeyCodes: Set<string> = new Set();

  private p1PrevBomb = false;
  private p1PrevDetonate = false;
  private p2PrevBomb = false;
  private p2PrevDetonate = false;

  private keyDownHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene, gamepadManager: GamepadManager, config: LocalCoopConfig) {
    this.gamepadManager = gamepadManager;
    this.config = config;

    // Build tracked key set from both assigned keyboard presets
    for (const k of getPresetKeyCodes(config.p1Controls)) this.trackedKeyCodes.add(k);
    for (const k of getPresetKeyCodes(config.p2Controls)) this.trackedKeyCodes.add(k);

    this.keyDownHandler = (e: KeyboardEvent) => {
      if (this.trackedKeyCodes.has(e.code)) {
        this.keysDown.add(e.code);
      }
    };
    this.keyUpHandler = (e: KeyboardEvent) => {
      if (this.trackedKeyCodes.has(e.code)) {
        this.keysDown.delete(e.code);
      }
    };
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
  }

  pollP1(): LocalPlayerInput {
    return this.pollPreset(this.config.p1Controls, 'p1');
  }

  pollP2(): LocalPlayerInput {
    return this.pollPreset(this.config.p2Controls, 'p2');
  }

  private pollPreset(preset: ControlPreset, player: 'p1' | 'p2'): LocalPlayerInput {
    if (preset === 'gamepad1' || preset === 'gamepad2') {
      const gpIndex = preset === 'gamepad1' ? 0 : 1;
      return this.pollGamepad(gpIndex);
    }
    return this.pollKeyboard(preset, player);
  }

  private pollKeyboard(preset: ControlPreset, player: 'p1' | 'p2'): LocalPlayerInput {
    let direction: LocalPlayerInput['direction'] = null;
    let action: LocalPlayerInput['action'] = null;

    switch (preset) {
      case 'wasd':
        if (this.keysDown.has('KeyW')) direction = 'up';
        else if (this.keysDown.has('KeyS')) direction = 'down';
        else if (this.keysDown.has('KeyA')) direction = 'left';
        else if (this.keysDown.has('KeyD')) direction = 'right';
        break;
      case 'arrows':
        if (this.keysDown.has('ArrowUp')) direction = 'up';
        else if (this.keysDown.has('ArrowDown')) direction = 'down';
        else if (this.keysDown.has('ArrowLeft')) direction = 'left';
        else if (this.keysDown.has('ArrowRight')) direction = 'right';
        break;
      case 'numpad':
        if (this.keysDown.has('Numpad8')) direction = 'up';
        else if (this.keysDown.has('Numpad2')) direction = 'down';
        else if (this.keysDown.has('Numpad4')) direction = 'left';
        else if (this.keysDown.has('Numpad6')) direction = 'right';
        break;
    }

    let bombDown = false;
    let detDown = false;
    switch (preset) {
      case 'wasd':
        bombDown = this.keysDown.has('Space');
        detDown = this.keysDown.has('KeyE');
        break;
      case 'arrows':
        bombDown = this.keysDown.has('Enter');
        detDown = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
        break;
      case 'numpad':
        bombDown = this.keysDown.has('NumpadAdd');
        detDown = this.keysDown.has('NumpadSubtract');
        break;
    }

    const prevBomb = player === 'p1' ? this.p1PrevBomb : this.p2PrevBomb;
    const prevDet = player === 'p1' ? this.p1PrevDetonate : this.p2PrevDetonate;

    if (bombDown && !prevBomb) action = 'bomb';
    if (detDown && !prevDet) action = 'detonate';

    if (player === 'p1') {
      this.p1PrevBomb = bombDown;
      this.p1PrevDetonate = detDown;
    } else {
      this.p2PrevBomb = bombDown;
      this.p2PrevDetonate = detDown;
    }

    return { direction, action };
  }

  private pollGamepad(index: number): LocalPlayerInput {
    const gpInput: GamepadInput = this.gamepadManager.pollIndexed(index);
    return { direction: gpInput.direction, action: gpInput.action };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    this.keysDown.clear();
    this.p1PrevBomb = false;
    this.p1PrevDetonate = false;
    this.p2PrevBomb = false;
    this.p2PrevDetonate = false;
  }
}
