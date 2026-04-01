import { EMOTES, EmoteId } from '@blast-arena/shared';

const WHEEL_RADIUS = 100;

export class EmoteWheel {
  private overlay: HTMLElement | null = null;
  private onSelect: ((emoteId: EmoteId) => void) | null = null;
  private visible = false;

  show(onSelect: (emoteId: EmoteId) => void): void {
    if (this.visible) return;
    this.visible = true;
    this.onSelect = onSelect;

    this.overlay = document.createElement('div');
    this.overlay.className = 'emote-wheel-overlay';
    this.overlay.innerHTML = this.buildHTML();
    document.body.appendChild(this.overlay);

    // Bind click handlers via delegation
    this.overlay.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.emote-wheel-item') as HTMLElement;
      if (btn && btn.dataset.id !== undefined) {
        const id = parseInt(btn.dataset.id) as EmoteId;
        this.select(id);
      }
    });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay?.remove();
    this.overlay = null;
    this.onSelect = null;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private select(emoteId: EmoteId): void {
    if (this.onSelect) this.onSelect(emoteId);
    this.hide();
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
