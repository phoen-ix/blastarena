import { EMOTES, EmoteId } from '@blast-arena/shared';
import { setHtml } from '../utils/html';

const WHEEL_RADIUS = 100;
const STICK_DEADZONE = 0.5;

export class EmoteWheel {
  private overlay: HTMLElement | null = null;
  private onSelect: ((emoteId: EmoteId) => void) | null = null;
  private visible = false;
  private highlightedIndex = -1;
  private gamepadRAF: number | null = null;

  show(onSelect: (emoteId: EmoteId) => void): void {
    if (this.visible) return;
    this.visible = true;
    this.onSelect = onSelect;
    this.highlightedIndex = -1;

    this.overlay = document.createElement('div');
    this.overlay.className = 'emote-wheel-overlay';
    setHtml(this.overlay, this.buildHTML());
    document.body.appendChild(this.overlay);

    // Bind click handlers via delegation
    this.overlay.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.emote-wheel-item') as HTMLElement;
      if (btn && btn.dataset.id !== undefined) {
        const id = parseInt(btn.dataset.id) as EmoteId;
        this.select(id);
      }
    });

    this.startGamepadPolling();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.stopGamepadPolling();
    this.overlay?.remove();
    this.overlay = null;
    this.onSelect = null;
    this.highlightedIndex = -1;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private select(emoteId: EmoteId): void {
    if (this.onSelect) this.onSelect(emoteId);
    this.hide();
  }

  /** Poll gamepad right stick for radial selection, A to confirm, B to cancel */
  private startGamepadPolling(): void {
    const poll = () => {
      this.gamepadRAF = requestAnimationFrame(poll);
      if (!this.overlay) return;

      const pad = this.getPad();
      if (!pad) return;

      // Right stick for directional selection
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.abs(rx) > STICK_DEADZONE || Math.abs(ry) > STICK_DEADZONE) {
        // Convert stick angle to emote index
        const angle = Math.atan2(ry, rx);
        // Offset by -PI/2 to match wheel layout (first emote at top)
        const normalized = ((angle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
        const index = Math.round(normalized * EMOTES.length) % EMOTES.length;
        this.setHighlight(index);
      }

      // D-pad as fallback for radial navigation
      const dpadUp = pad.buttons[12]?.pressed ?? false;
      const dpadDown = pad.buttons[13]?.pressed ?? false;
      const dpadLeft = pad.buttons[14]?.pressed ?? false;
      const dpadRight = pad.buttons[15]?.pressed ?? false;
      if (dpadUp || dpadDown || dpadLeft || dpadRight) {
        const dx = (dpadRight ? 1 : 0) - (dpadLeft ? 1 : 0);
        const dy = (dpadDown ? 1 : 0) - (dpadUp ? 1 : 0);
        if (dx !== 0 || dy !== 0) {
          const angle = Math.atan2(dy, dx);
          const normalized = ((angle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
          const index = Math.round(normalized * EMOTES.length) % EMOTES.length;
          this.setHighlight(index);
        }
      }

      // A button confirms highlighted emote
      const aDown = pad.buttons[0]?.pressed ?? false;
      if (aDown && this.highlightedIndex >= 0) {
        this.select(EMOTES[this.highlightedIndex].id as EmoteId);
        return;
      }

      // B button cancels
      const bDown = pad.buttons[1]?.pressed ?? false;
      if (bDown) {
        this.hide();
      }
    };

    this.gamepadRAF = requestAnimationFrame(poll);
  }

  private stopGamepadPolling(): void {
    if (this.gamepadRAF !== null) {
      cancelAnimationFrame(this.gamepadRAF);
      this.gamepadRAF = null;
    }
  }

  private setHighlight(index: number): void {
    if (index === this.highlightedIndex || !this.overlay) return;
    // Remove previous highlight
    this.overlay.querySelector('.emote-wheel-item.gp-focus')?.classList.remove('gp-focus');
    // Apply new highlight
    const items = this.overlay.querySelectorAll('.emote-wheel-item');
    if (items[index]) {
      items[index].classList.add('gp-focus');
    }
    this.highlightedIndex = index;
  }

  private getPad(): Gamepad | null {
    const gamepads = navigator.getGamepads();
    for (const pad of gamepads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  private buildHTML(): string {
    const items = EMOTES.map((emote, i) => {
      const angle = (i / EMOTES.length) * 2 * Math.PI - Math.PI / 2;
      const x = Math.cos(angle) * WHEEL_RADIUS;
      const y = Math.sin(angle) * WHEEL_RADIUS;
      return `<button class="emote-wheel-item" data-id="${emote.id}"
        style="transform:translate(${x}px, ${y}px);">${emote.label}</button>`;
    }).join('');

    return `<div class="emote-wheel-ring">${items}</div>`;
  }
}
