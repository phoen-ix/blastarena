import { SocketClient } from '../network/SocketClient';
import {
  SpectatorEnergyState,
  SPECTATOR_WALL_COST,
  SPECTATOR_METEOR_COST,
  SPECTATOR_POWERUP_COST,
  SPECTATOR_SPEED_ZONE_COST,
  SPECTATOR_MAX_ENERGY,
} from '@blast-arena/shared';
import { t } from '../i18n';
import { setHtml } from '../utils/html';

type ActionType = 'place_wall' | 'trigger_meteor' | 'drop_powerup' | 'speed_zone';

interface ActionDef {
  type: ActionType;
  cost: number;
  hotkey: string;
  icon: string;
}

const ACTIONS: ActionDef[] = [
  { type: 'place_wall', cost: SPECTATOR_WALL_COST, hotkey: 'Q', icon: '&#x25A3;' },
  { type: 'trigger_meteor', cost: SPECTATOR_METEOR_COST, hotkey: 'W', icon: '&#x2604;' },
  { type: 'drop_powerup', cost: SPECTATOR_POWERUP_COST, hotkey: 'E', icon: '&#x2605;' },
  { type: 'speed_zone', cost: SPECTATOR_SPEED_ZONE_COST, hotkey: 'R', icon: '&#x21C4;' },
];

export class SpectatorActionBar {
  private socketClient: SocketClient;
  private container: HTMLElement | null = null;
  private energyBar: HTMLElement | null = null;
  private energyText: HTMLElement | null = null;
  private buttons: Map<ActionType, HTMLElement> = new Map();
  private selectedAction: ActionType | null = null;
  private energy: number = 0;
  private cooldownRemaining: number = 0;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private onTargetSelect: ((type: ActionType) => void) | null = null;
  private onTargetCancel: (() => void) | null = null;

  constructor(socketClient: SocketClient) {
    this.socketClient = socketClient;
  }

  mount(parent: HTMLElement): void {
    this.container = document.createElement('div');
    this.container.id = 'spectator-action-bar';
    this.container.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(0,0,0,0.85);
      border: 1px solid var(--border);
      border-radius: 8px;
      z-index: 100;
      user-select: none;
    `;

    // Energy bar
    const energyWrap = document.createElement('div');
    energyWrap.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 80px;
      margin-right: 4px;
    `;
    this.energyText = document.createElement('div');
    this.energyText.style.cssText = 'font-size:11px; color:var(--text-muted); margin-bottom:2px;';
    this.energyText.textContent = '0 / ' + SPECTATOR_MAX_ENERGY;
    energyWrap.appendChild(this.energyText);

    const barOuter = document.createElement('div');
    barOuter.style.cssText = `
      width: 80px;
      height: 8px;
      background: var(--surface);
      border-radius: 4px;
      overflow: hidden;
    `;
    this.energyBar = document.createElement('div');
    this.energyBar.style.cssText = `
      height: 100%;
      width: 0%;
      background: var(--primary);
      border-radius: 4px;
      transition: width 0.15s;
    `;
    barOuter.appendChild(this.energyBar);
    energyWrap.appendChild(barOuter);
    this.container.appendChild(energyWrap);

    // Action buttons
    for (const action of ACTIONS) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.dataset.action = action.type;
      btn.title = `${t(`ui:spectator.${action.type}`)} (${action.hotkey}) - ${action.cost} energy`;
      btn.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 52px;
        padding: 4px 8px;
        font-size: 11px;
        position: relative;
        opacity: 0.5;
      `;
      setHtml(
        btn,
        `
        <span style="font-size:18px; line-height:1;">${action.icon}</span>
        <span style="font-size:9px; color:var(--text-muted);">${action.hotkey} · ${action.cost}</span>
      `,
      );
      btn.addEventListener('click', () => this.selectAction(action.type));
      this.buttons.set(action.type, btn);
      this.container.appendChild(btn);
    }

    // Targeting hint
    const hint = document.createElement('div');
    hint.id = 'spectator-target-hint';
    hint.style.cssText = `
      position: fixed;
      bottom: 130px;
      left: 50%;
      transform: translateX(-50%);
      display: none;
      padding: 4px 12px;
      background: rgba(0,0,0,0.8);
      border: 1px solid var(--primary);
      border-radius: 4px;
      color: var(--text);
      font-size: 12px;
      z-index: 100;
    `;
    parent.appendChild(hint);

    parent.appendChild(this.container);

    // Keyboard shortcuts
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toUpperCase();
      if (key === 'Q') this.selectAction('place_wall');
      else if (key === 'W') this.selectAction('trigger_meteor');
      else if (key === 'E') this.selectAction('drop_powerup');
      else if (key === 'R') this.selectAction('speed_zone');
      else if (key === 'ESCAPE') this.cancelSelection();
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  updateFromState(energyStates: SpectatorEnergyState[] | undefined, localPlayerId: number): void {
    if (!this.container || !energyStates) return;

    const myState = energyStates.find((s) => s.playerId === localPlayerId);
    if (!myState) return;

    this.energy = myState.energy;
    this.cooldownRemaining = myState.cooldownTicksRemaining;

    // Update energy bar
    const pct = Math.round((this.energy / SPECTATOR_MAX_ENERGY) * 100);
    if (this.energyBar) this.energyBar.style.width = pct + '%';
    if (this.energyText) this.energyText.textContent = `${this.energy} / ${SPECTATOR_MAX_ENERGY}`;

    // Update button states
    for (const action of ACTIONS) {
      const btn = this.buttons.get(action.type);
      if (!btn) continue;
      const canAfford = this.energy >= action.cost && this.cooldownRemaining <= 0;
      btn.style.opacity = canAfford ? '1' : '0.4';
      (btn as HTMLButtonElement).disabled = !canAfford;
      if (this.selectedAction === action.type) {
        btn.style.outline = '2px solid var(--primary)';
        btn.style.outlineOffset = '2px';
      } else {
        btn.style.outline = 'none';
      }
    }
  }

  private selectAction(type: ActionType): void {
    const action = ACTIONS.find((a) => a.type === type);
    if (!action) return;
    if (this.energy < action.cost || this.cooldownRemaining > 0) return;

    if (this.selectedAction === type) {
      this.cancelSelection();
      return;
    }

    this.selectedAction = type;
    // Show targeting hint
    const hint = document.getElementById('spectator-target-hint');
    if (hint) {
      hint.textContent = t('ui:spectator.clickToPlace');
      hint.style.display = 'block';
    }
    // Notify scene for cursor change
    this.onTargetSelect?.(type);
  }

  cancelSelection(): void {
    this.selectedAction = null;
    const hint = document.getElementById('spectator-target-hint');
    if (hint) hint.style.display = 'none';
    this.onTargetCancel?.();
  }

  getSelectedAction(): ActionType | null {
    return this.selectedAction;
  }

  /** Send the action to the server for the selected tile. */
  executeAction(x: number, y: number): void {
    if (!this.selectedAction) return;
    const type = this.selectedAction;
    this.cancelSelection();

    this.socketClient.emit(
      'spectator:action',
      { type, position: { x, y } },
      (response: { success: boolean; error?: string }) => {
        if (!response.success) {
          // Could show a brief notification, but for now just log
          console.warn('Spectator action failed:', response.error);
        }
      },
    );
  }

  setCallbacks(onSelect: (type: ActionType) => void, onCancel: () => void): void {
    this.onTargetSelect = onSelect;
    this.onTargetCancel = onCancel;
  }

  destroy(): void {
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.container?.remove();
    this.container = null;
    document.getElementById('spectator-target-hint')?.remove();
    this.selectedAction = null;
    this.buttons.clear();
  }
}
