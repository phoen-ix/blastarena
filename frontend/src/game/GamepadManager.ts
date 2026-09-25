import Phaser from 'phaser';

export interface GamepadInput {
  direction: 'up' | 'down' | 'left' | 'right' | null;
  action: 'bomb' | 'detonate' | 'throw' | null;
}

export interface GamepadMenuInput {
  pause: boolean;
  emoteWheel: boolean;
}

export interface SpectatorGamepadInput {
  panX: number;
  panY: number;
  nextPlayer: boolean;
  prevPlayer: boolean;
}

export class GamepadManager {
  private scene: Phaser.Scene;
  private readonly DEADZONE = 0.3;

  private prevBombButton = false;
  private prevDetonateButton = false;
  private prevThrowButton = false;
  private prevStartButton = false;
  private prevEmoteButton = false;
  private prevLB = false;
  private prevRB = false;

  // Indexed gamepad state for local co-op
  private prevIndexedBomb: Map<string, boolean> = new Map();
  private prevIndexedDetonate: Map<string, boolean> = new Map();
  private prevIndexedThrow: Map<string, boolean> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  private getPad(index?: number): Phaser.Input.Gamepad.Gamepad | null {
    if (!this.scene.input.gamepad) return null;
    const pads = this.scene.input.gamepad.gamepads;
    if (index !== undefined) {
      // Return specific gamepad by index
      const pad = pads[index];
      return pad && pad.connected ? pad : null;
    }
    for (const pad of pads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  /** Poll a specific gamepad by index (for local co-op P2) */
  pollIndexed(index: number): GamepadInput {
    const pad = this.getPad(index);
    if (!pad) return { direction: null, action: null };
    const direction = this.readDirection(pad);

    const bombDown = pad.buttons[0]?.pressed ?? false;
    const detonateDown = pad.buttons[1]?.pressed ?? false;
    const throwDown = pad.buttons[2]?.pressed ?? false;

    // Use separate just-pressed state keyed by index
    const key = `pad${index}`;
    const prevBomb = this.prevIndexedBomb.get(key) ?? false;
    const prevDet = this.prevIndexedDetonate.get(key) ?? false;
    const prevThrow = this.prevIndexedThrow.get(key) ?? false;

    let action: 'bomb' | 'detonate' | 'throw' | null = null;
    if (bombDown && !prevBomb) action = 'bomb';
    if (detonateDown && !prevDet) action = 'detonate';
    if (throwDown && !prevThrow) action = 'throw';

    this.prevIndexedBomb.set(key, bombDown);
    this.prevIndexedDetonate.set(key, detonateDown);
    this.prevIndexedThrow.set(key, throwDown);

    return { direction, action };
  }

  poll(): GamepadInput {
    const pad = this.getPad();
    if (!pad) {
      this.prevBombButton = false;
      this.prevDetonateButton = false;
      this.prevThrowButton = false;
      return { direction: null, action: null };
    }

    const direction = this.readDirection(pad);

    const bombDown = pad.buttons[0]?.pressed ?? false;
    const detonateDown = pad.buttons[1]?.pressed ?? false;
    const throwDown = pad.buttons[2]?.pressed ?? false;

    let action: 'bomb' | 'detonate' | 'throw' | null = null;
    if (bombDown && !this.prevBombButton) action = 'bomb';
    if (detonateDown && !this.prevDetonateButton) action = 'detonate';
    if (throwDown && !this.prevThrowButton) action = 'throw';

    this.prevBombButton = bombDown;
    this.prevDetonateButton = detonateDown;
    this.prevThrowButton = throwDown;

    return { direction, action };
  }

  pollSpectator(): SpectatorGamepadInput {
    const pad = this.getPad();
    if (!pad) {
      this.prevLB = false;
      this.prevRB = false;
      return { panX: 0, panY: 0, nextPlayer: false, prevPlayer: false };
    }

    const dir = this.readDirection(pad);
    const panX = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const panY = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;

    const lbDown = pad.buttons[4]?.pressed ?? false;
    const rbDown = pad.buttons[5]?.pressed ?? false;

    const nextPlayer = rbDown && !this.prevRB;
    const prevPlayer = lbDown && !this.prevLB;

    this.prevRB = rbDown;
    this.prevLB = lbDown;

    return { panX, panY, nextPlayer, prevPlayer };
  }

  /** Poll menu buttons (Start = pause, Y = emote wheel) — edge-detected */
  pollMenu(): GamepadMenuInput {
    const pad = this.getPad();
    if (!pad) {
      this.prevStartButton = false;
      this.prevEmoteButton = false;
      return { pause: false, emoteWheel: false };
    }

    const startDown = pad.buttons[9]?.pressed ?? false;
    const emoteDown = pad.buttons[3]?.pressed ?? false;

    const pause = startDown && !this.prevStartButton;
    const emoteWheel = emoteDown && !this.prevEmoteButton;

    this.prevStartButton = startDown;
    this.prevEmoteButton = emoteDown;

    return { pause, emoteWheel };
  }

  isConnected(): boolean {
    return this.getPad() !== null;
  }

  /**
   * Treat the action buttons as already held, so a press only counts after a release. Called while
   * the pause menu or emote wheel owns A/B: the button that confirms or closes them was still down
   * on the next gameplay poll and became a bomb or a detonation.
   */
  suppressHeldButtons(): void {
    this.prevBombButton = true;
    this.prevDetonateButton = true;
    this.prevThrowButton = true;
    for (let i = 0; i < 4; i++) {
      this.prevIndexedBomb.set(`pad${i}`, true);
      this.prevIndexedDetonate.set(`pad${i}`, true);
      this.prevIndexedThrow.set(`pad${i}`, true);
    }
  }

  private readDirection(
    pad: Phaser.Input.Gamepad.Gamepad,
  ): 'up' | 'down' | 'left' | 'right' | null {
    const dpadUp = pad.buttons[12]?.pressed ?? false;
    const dpadDown = pad.buttons[13]?.pressed ?? false;
    const dpadLeft = pad.buttons[14]?.pressed ?? false;
    const dpadRight = pad.buttons[15]?.pressed ?? false;

    if (dpadUp) return 'up';
    if (dpadDown) return 'down';
    if (dpadLeft) return 'left';
    if (dpadRight) return 'right';

    if (pad.leftStick) {
      const x = pad.leftStick.x;
      const y = pad.leftStick.y;
      const absX = Math.abs(x);
      const absY = Math.abs(y);

      if (absX > this.DEADZONE || absY > this.DEADZONE) {
        if (absX > absY) {
          return x > 0 ? 'right' : 'left';
        } else {
          return y > 0 ? 'down' : 'up';
        }
      }
    }

    return null;
  }

  reset(): void {
    this.prevBombButton = false;
    this.prevDetonateButton = false;
    this.prevThrowButton = false;
    this.prevStartButton = false;
    this.prevEmoteButton = false;
    this.prevLB = false;
    this.prevRB = false;
    this.prevIndexedBomb.clear();
    this.prevIndexedDetonate.clear();
    this.prevIndexedThrow.clear();
  }

  destroy(): void {
    this.reset();
  }
}
