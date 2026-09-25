import { GamepadManager, GamepadInput } from './GamepadManager';
import { t } from '../i18n';

export interface LocalPlayerInput {
  direction: 'up' | 'down' | 'left' | 'right' | null;
  action: 'bomb' | 'detonate' | 'throw' | null;
}

export type ControlPreset = 'wasd' | 'arrows' | 'numpad' | 'gamepad1' | 'gamepad2';
export type CameraMode = 'shared' | 'split-h' | 'split-v';

export interface LocalCoopP2Identity {
  mode: 'guest' | 'loggedIn';
  guestName: string;
  guestColor: number;
  loggedInUserId?: number;
  loggedInUsername?: string;
}

export interface LocalCoopConfig {
  p1Controls: ControlPreset;
  p2Controls: ControlPreset;
  cameraMode: CameraMode;
  p2Identity?: LocalCoopP2Identity;
}

// Functions, not constants: t() returns the bare key until i18n has initialised, and this module
// is imported at boot. (audit G12)
export function getControlPresetLabels(): Record<ControlPreset, string> {
  return {
    wasd: t('campaign:localCoopModal.controlPresets.wasd'),
    arrows: t('campaign:localCoopModal.controlPresets.arrows'),
    numpad: t('campaign:localCoopModal.controlPresets.numpad'),
    gamepad1: t('campaign:localCoopModal.controlPresets.gamepad1'),
    gamepad2: t('campaign:localCoopModal.controlPresets.gamepad2'),
  };
}

export function getCameraModeLabels(): Record<CameraMode, string> {
  return {
    shared: t('campaign:localCoopModal.cameraModes.shared'),
    'split-h': t('campaign:localCoopModal.cameraModes.splitH'),
    'split-v': t('campaign:localCoopModal.cameraModes.splitV'),
  };
}

export const DEFAULT_LOCAL_COOP_CONFIG: LocalCoopConfig = {
  p1Controls: 'wasd',
  p2Controls: 'numpad',
  cameraMode: 'shared',
};

export const DEFAULT_P2_GUEST_COLOR = 0x44aaff; // blue

const STORAGE_KEY = 'blast-arena-local-coop-controls';
const P2_IDENTITY_KEY = 'blast-arena-local-coop-p2';

export function loadP2Identity(): LocalCoopP2Identity {
  try {
    const raw = localStorage.getItem(P2_IDENTITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mode: 'guest',
        guestName: parsed.guestName || 'Player 2',
        guestColor:
          typeof parsed.guestColor === 'number' ? parsed.guestColor : DEFAULT_P2_GUEST_COLOR,
      };
    }
  } catch {
    /* ignore */
  }
  return { mode: 'guest', guestName: 'Player 2', guestColor: DEFAULT_P2_GUEST_COLOR };
}

export function saveP2Identity(identity: LocalCoopP2Identity): void {
  // Only persist guest name/color (not login credentials)
  localStorage.setItem(
    P2_IDENTITY_KEY,
    JSON.stringify({ guestName: identity.guestName, guestColor: identity.guestColor }),
  );
}

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

const WASD_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyE', 'KeyQ']);
const ARROW_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'ShiftLeft',
  'ShiftRight',
  'Slash',
]);
const NUMPAD_KEYS = new Set([
  'Numpad8',
  'Numpad4',
  'Numpad6',
  'Numpad2',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
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
  private p1PrevThrow = false;
  private p2PrevBomb = false;
  private p2PrevDetonate = false;
  private p2PrevThrow = false;

  private keyDownHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;
  private blurHandler: () => void;

  // `_scene` is unused: input is read from window key events and the GamepadManager, not the
  // scene. Kept in the signature for the GameScene call site. (audit G4)
  constructor(gamepadManager: GamepadManager, config: LocalCoopConfig) {
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
    // A key held while the window loses focus never gets its keyup, and the player kept walking
    // until it was pressed again.
    this.blurHandler = () => this.keysDown.clear();
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    window.addEventListener('blur', this.blurHandler);
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
    let throwDown = false;
    switch (preset) {
      case 'wasd':
        bombDown = this.keysDown.has('Space');
        detDown = this.keysDown.has('KeyE');
        throwDown = this.keysDown.has('KeyQ');
        break;
      case 'arrows':
        bombDown = this.keysDown.has('Enter');
        detDown = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight');
        throwDown = this.keysDown.has('Slash');
        break;
      case 'numpad':
        bombDown = this.keysDown.has('NumpadAdd');
        detDown = this.keysDown.has('NumpadSubtract');
        throwDown = this.keysDown.has('NumpadMultiply');
        break;
    }

    const prevBomb = player === 'p1' ? this.p1PrevBomb : this.p2PrevBomb;
    const prevDet = player === 'p1' ? this.p1PrevDetonate : this.p2PrevDetonate;
    const prevThrow = player === 'p1' ? this.p1PrevThrow : this.p2PrevThrow;

    if (bombDown && !prevBomb) action = 'bomb';
    if (detDown && !prevDet) action = 'detonate';
    if (throwDown && !prevThrow) action = 'throw';

    if (player === 'p1') {
      this.p1PrevBomb = bombDown;
      this.p1PrevDetonate = detDown;
      this.p1PrevThrow = throwDown;
    } else {
      this.p2PrevBomb = bombDown;
      this.p2PrevDetonate = detDown;
      this.p2PrevThrow = throwDown;
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
    window.removeEventListener('blur', this.blurHandler);
    this.keysDown.clear();
    this.p1PrevBomb = false;
    this.p1PrevDetonate = false;
    this.p1PrevThrow = false;
    this.p2PrevBomb = false;
    this.p2PrevDetonate = false;
    this.p2PrevThrow = false;
  }
}
