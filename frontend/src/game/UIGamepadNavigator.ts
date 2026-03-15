interface FocusContext {
  id: string;
  elements: () => HTMLElement[];
  focusIndex: number;
  onBack?: () => void;
}

type Direction = 'up' | 'down' | 'left' | 'right';

const DEADZONE = 0.3;
const INITIAL_DELAY = 400;
const REPEAT_RATE = 120;

export class UIGamepadNavigator {
  private static instance: UIGamepadNavigator | null = null;

  private contextStack: FocusContext[] = [];
  private pollRAF: number | null = null;
  private active = true;
  private prevButtons: boolean[] = [];
  private prevDirection: Direction | null = null;
  private dirHeldSince = 0;
  private lastRepeatFire = 0;
  private gamepadVisible = false;

  // Custom dropdown state
  private dropdownEl: HTMLElement | null = null;
  private dropdownSelect: HTMLSelectElement | null = null;
  private dropdownIndex = 0;

  private constructor() {
    this.startPolling();
    document.addEventListener('mousemove', this.onMouseMove, { passive: true });
  }

  static getInstance(): UIGamepadNavigator {
    if (!UIGamepadNavigator.instance) {
      UIGamepadNavigator.instance = new UIGamepadNavigator();
    }
    return UIGamepadNavigator.instance;
  }

  pushContext(ctx: Omit<FocusContext, 'focusIndex'> & { focusIndex?: number }): void {
    this.contextStack.push({ focusIndex: 0, ...ctx });
    this.applyFocus();
  }

  popContext(id?: string): void {
    if (id) {
      const idx = this.contextStack.findIndex((c) => c.id === id);
      if (idx >= 0) this.contextStack.splice(idx, 1);
    } else {
      this.contextStack.pop();
    }
    this.closeDropdown();
    this.clearAllFocusRings();
    if (this.contextStack.length > 0) {
      this.applyFocus();
    }
  }

  clearAll(): void {
    this.closeDropdown();
    this.contextStack = [];
    this.clearAllFocusRings();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.closeDropdown();
      this.clearAllFocusRings();
    }
  }

  private get currentContext(): FocusContext | null {
    return this.contextStack.length > 0 ? this.contextStack[this.contextStack.length - 1] : null;
  }

  private get isDropdownOpen(): boolean {
    return this.dropdownEl !== null;
  }

  // --- Polling loop ---

  private startPolling(): void {
    const poll = () => {
      this.pollRAF = requestAnimationFrame(poll);
      if (!this.active || !this.currentContext) return;

      const pad = this.getPad();
      if (!pad) {
        this.prevButtons = [];
        this.prevDirection = null;
        return;
      }

      const now = performance.now();

      // Direction with repeat-fire
      const dir = this.readDirection(pad);
      if (dir) {
        if (dir !== this.prevDirection) {
          this.dirHeldSince = now;
          this.lastRepeatFire = now;
          this.handleDirection(dir);
        } else {
          const elapsed = now - this.dirHeldSince;
          if (elapsed >= INITIAL_DELAY) {
            const sinceLast = now - this.lastRepeatFire;
            if (sinceLast >= REPEAT_RATE) {
              this.lastRepeatFire = now;
              this.handleDirection(dir);
            }
          }
        }
      } else {
        this.dirHeldSince = 0;
      }
      this.prevDirection = dir;

      // A button (confirm) — just-pressed
      const aDown = pad.buttons[0]?.pressed ?? false;
      const prevA = this.prevButtons[0] ?? false;
      if (aDown && !prevA) {
        if (this.isDropdownOpen) {
          this.confirmDropdownSelection();
        } else {
          this.confirmFocused();
        }
      }

      // B button (back) — just-pressed
      const bDown = pad.buttons[1]?.pressed ?? false;
      const prevB = this.prevButtons[1] ?? false;
      if (bDown && !prevB) {
        if (this.isDropdownOpen) {
          this.closeDropdown();
        } else {
          this.backAction();
        }
      }

      // Store button states
      this.prevButtons = pad.buttons.map((b) => b.pressed);
    };

    this.pollRAF = requestAnimationFrame(poll);
  }

  private getPad(): Gamepad | null {
    const gamepads = navigator.getGamepads();
    for (const pad of gamepads) {
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  private readDirection(pad: Gamepad): Direction | null {
    if (pad.buttons[12]?.pressed) return 'up';
    if (pad.buttons[13]?.pressed) return 'down';
    if (pad.buttons[14]?.pressed) return 'left';
    if (pad.buttons[15]?.pressed) return 'right';

    const x = pad.axes[0] ?? 0;
    const y = pad.axes[1] ?? 0;
    const absX = Math.abs(x);
    const absY = Math.abs(y);

    if (absX > DEADZONE || absY > DEADZONE) {
      if (absX > absY) {
        return x > 0 ? 'right' : 'left';
      } else {
        return y > 0 ? 'down' : 'up';
      }
    }

    return null;
  }

  // --- Focus management ---

  private handleDirection(dir: Direction): void {
    // If dropdown is open, navigate within it
    if (this.isDropdownOpen) {
      this.navigateDropdown(dir);
      return;
    }

    const ctx = this.currentContext;
    if (!ctx) return;

    const els = ctx.elements();
    if (els.length === 0) return;

    if (!this.gamepadVisible) {
      this.gamepadVisible = true;
    }

    // If only one focusable element and it's in a scrollable container, scroll instead
    if (els.length === 1 && (dir === 'up' || dir === 'down')) {
      const focused = els[ctx.focusIndex];
      const scrollParent = this.findScrollParent(focused);
      if (scrollParent) {
        scrollParent.scrollBy({ top: dir === 'down' ? 60 : -60, behavior: 'smooth' });
        return;
      }
    }

    const newIndex = this.findSpatialNeighbor(els, ctx.focusIndex, dir);
    if (newIndex !== null && newIndex !== ctx.focusIndex) {
      ctx.focusIndex = newIndex;
      this.applyFocus();
    }
  }

  /**
   * Find the nearest element in the given direction using screen positions.
   * Uses a permissive directional filter (just requires movement in the right
   * direction) combined with heavy cross-axis penalty so same-row/column
   * neighbors always beat diagonally-offset ones.
   */
  private findSpatialNeighbor(
    els: HTMLElement[],
    currentIndex: number,
    dir: Direction,
  ): number | null {
    const current = els[currentIndex];
    if (!current) return null;

    const curRect = current.getBoundingClientRect();
    const cx = curRect.left + curRect.width / 2;
    const cy = curRect.top + curRect.height / 2;

    const isVertical = dir === 'up' || dir === 'down';

    let bestIndex: number | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < els.length; i++) {
      if (i === currentIndex) continue;

      const rect = els[i].getBoundingClientRect();
      const ex = rect.left + rect.width / 2;
      const ey = rect.top + rect.height / 2;

      const dx = ex - cx;
      const dy = ey - cy;

      // Must be moving in the pressed direction (> 2px threshold)
      const primaryDelta = isVertical ? dy : dx;
      const isForward = dir === 'down' || dir === 'right' ? primaryDelta > 2 : primaryDelta < -2;
      if (!isForward) continue;

      const primaryDist = Math.abs(isVertical ? dy : dx);
      const crossDist = Math.abs(isVertical ? dx : dy);

      // Heavy cross-axis penalty: elements on the same row/column
      // (small cross offset) strongly preferred over diagonal ones.
      const score = primaryDist + crossDist * 5;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    // Fallback: wrap to next/prev element linearly so edges are never stuck
    if (bestIndex === null) {
      if (dir === 'down' || dir === 'right') {
        bestIndex = currentIndex + 1 < els.length ? currentIndex + 1 : 0;
      } else {
        bestIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : els.length - 1;
      }
    }

    return bestIndex;
  }

  private applyFocus(): void {
    const ctx = this.currentContext;
    if (!ctx) return;

    const els = ctx.elements();
    if (els.length === 0) return;

    ctx.focusIndex = Math.max(0, Math.min(els.length - 1, ctx.focusIndex));

    this.clearAllFocusRings();

    if (!this.gamepadVisible) return;

    const el = els[ctx.focusIndex];
    el.classList.add('gp-focus');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.focus();
    }
  }

  private confirmFocused(): void {
    const ctx = this.currentContext;
    if (!ctx) return;

    const els = ctx.elements();
    if (els.length === 0) return;

    ctx.focusIndex = Math.max(0, Math.min(els.length - 1, ctx.focusIndex));
    const el = els[ctx.focusIndex];

    if (!this.gamepadVisible) {
      this.gamepadVisible = true;
      this.applyFocus();
      return;
    }

    if (el instanceof HTMLSelectElement) {
      this.openDropdown(el);
    } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      el.checked = !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      el.select();
    } else {
      // Buttons, room cards, labels — dispatch click
      el.click();
    }
  }

  private backAction(): void {
    const ctx = this.currentContext;
    if (!ctx?.onBack) return;
    ctx.onBack();
  }

  // --- Custom dropdown overlay ---

  private openDropdown(select: HTMLSelectElement): void {
    this.closeDropdown();

    this.dropdownSelect = select;
    this.dropdownIndex = select.selectedIndex;

    const rect = select.getBoundingClientRect();

    const dropdown = document.createElement('div');
    dropdown.className = 'gp-dropdown';

    // Position near the select
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.width = `${Math.max(rect.width, 180)}px`;
    dropdown.style.zIndex = '9000';

    // Build option items
    const options = select.options;
    for (let i = 0; i < options.length; i++) {
      const item = document.createElement('div');
      item.className = 'gp-dropdown-item';
      if (i === this.dropdownIndex) item.classList.add('gp-dropdown-active');
      item.textContent = options[i].text;
      item.dataset.index = String(i);
      dropdown.appendChild(item);
    }

    document.body.appendChild(dropdown);

    // Position: prefer below, flip above if not enough space
    const dropdownHeight = dropdown.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;

    if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
      dropdown.style.top = `${rect.bottom + 4}px`;
    } else {
      dropdown.style.top = `${rect.top - dropdownHeight - 4}px`;
    }

    // Scroll active item into view
    const activeItem = dropdown.querySelector('.gp-dropdown-active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }

    this.dropdownEl = dropdown;
  }

  private navigateDropdown(dir: Direction): void {
    if (!this.dropdownEl || !this.dropdownSelect) return;

    const items = this.dropdownEl.querySelectorAll<HTMLElement>('.gp-dropdown-item');
    if (items.length === 0) return;

    let newIndex = this.dropdownIndex;
    if (dir === 'up') newIndex--;
    else if (dir === 'down') newIndex++;
    else return; // left/right ignored in dropdown

    // Clamp
    if (newIndex < 0) newIndex = items.length - 1;
    else if (newIndex >= items.length) newIndex = 0;

    if (newIndex !== this.dropdownIndex) {
      items[this.dropdownIndex]?.classList.remove('gp-dropdown-active');
      this.dropdownIndex = newIndex;
      items[this.dropdownIndex]?.classList.add('gp-dropdown-active');
      items[this.dropdownIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }

  private confirmDropdownSelection(): void {
    if (!this.dropdownSelect) return;

    const select = this.dropdownSelect;
    const newIndex = this.dropdownIndex;

    this.closeDropdown();

    if (select.selectedIndex !== newIndex) {
      select.selectedIndex = newIndex;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  private closeDropdown(): void {
    if (this.dropdownEl) {
      this.dropdownEl.remove();
      this.dropdownEl = null;
    }
    this.dropdownSelect = null;
    this.dropdownIndex = 0;
  }

  // --- Utilities ---

  private findScrollParent(el: HTMLElement): HTMLElement | null {
    let parent = el.parentElement;
    while (parent) {
      const overflow = getComputedStyle(parent).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        if (parent.scrollHeight > parent.clientHeight) return parent;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  private clearAllFocusRings(): void {
    document.querySelectorAll('.gp-focus').forEach((el) => el.classList.remove('gp-focus'));
  }

  private onMouseMove = (): void => {
    if (this.gamepadVisible) {
      this.gamepadVisible = false;
      this.closeDropdown();
      this.clearAllFocusRings();
    }
  };

  destroy(): void {
    if (this.pollRAF !== null) {
      cancelAnimationFrame(this.pollRAF);
      this.pollRAF = null;
    }
    document.removeEventListener('mousemove', this.onMouseMove);
    this.closeDropdown();
    this.clearAll();
    UIGamepadNavigator.instance = null;
  }
}
