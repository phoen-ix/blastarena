import Phaser from 'phaser';
import { getSettings } from './Settings';
import { audioManager } from './AudioManager';
import { t } from '../i18n';

const STEP_MS = 600;
const SVG_NS = 'http://www.w3.org/2000/svg';
const RING_R = 52;
const RING_LENGTH = 2 * Math.PI * RING_R;

/**
 * The 3-2-1-GO before a match: a DOM overlay over the game (so camera zoom and bloom leave it
 * alone) with a ring that runs down each second. Timed with the scene clock.
 */
export class CountdownOverlay {
  private scene: Phaser.Scene;
  private active: boolean = false;
  private root: HTMLElement | null = null;
  private timers: Phaser.Time.TimerEvent[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** Call when game status transitions to 'playing' */
  show(): void {
    if (this.active) return;
    this.active = true;

    const animate = getSettings().animations;
    const root = document.createElement('div');
    root.className = 'countdown-overlay';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'countdown-ring');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(SVG_NS, 'circle');
    const fill = document.createElementNS(SVG_NS, 'circle');
    for (const c of [track, fill]) {
      c.setAttribute('cx', '60');
      c.setAttribute('cy', '60');
      c.setAttribute('r', String(RING_R));
    }
    track.setAttribute('class', 'countdown-ring-track');
    fill.setAttribute('class', 'countdown-ring-fill');
    fill.setAttribute('stroke-dasharray', String(RING_LENGTH));
    svg.append(track, fill);

    const num = document.createElement('span');
    num.className = 'countdown-num';
    root.append(svg, num);
    document.getElementById('ui-overlay')?.appendChild(root);
    this.root = root;

    const items = ['3', '2', '1', t('ui:hud.countdownGo')];
    items.forEach((label, i) => {
      const step = () => {
        const go = i === items.length - 1;
        if (go) audioManager.countdownGo();
        else audioManager.countdownBeep();
        num.textContent = label;
        root.classList.toggle('countdown-go', go);
        if (animate && typeof num.animate === 'function') {
          for (const el of [num, fill]) for (const a of el.getAnimations?.() ?? []) a.cancel();
          // Pop in with a slight overshoot, hold, then fade just before the next number.
          num.animate(
            [
              { transform: 'scale(1.9)', opacity: 0, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
              { transform: 'scale(1)', opacity: 1, offset: 0.4 },
              { transform: 'scale(1)', opacity: 1, offset: 0.82, easing: 'ease-in' },
              { transform: 'scale(0.88)', opacity: 0 },
            ],
            { duration: STEP_MS, fill: 'both' },
          );
          fill.animate(
            go
              ? [
                  { strokeDashoffset: '0', transform: 'scale(1)', opacity: 1 },
                  { strokeDashoffset: '0', transform: 'scale(1.6)', opacity: 0 },
                ]
              : [{ strokeDashoffset: '0' }, { strokeDashoffset: String(-RING_LENGTH) }],
            { duration: STEP_MS, easing: go ? 'ease-out' : 'linear', fill: 'both' },
          );
        }
      };
      const done = () => {
        if (i === items.length - 1) this.finish();
      };
      if (i === 0) step();
      else this.timers.push(this.scene.time.delayedCall(i * STEP_MS, step));
      if (i === items.length - 1) {
        this.timers.push(this.scene.time.delayedCall((i + 1) * STEP_MS, done));
      }
    });
  }

  private finish(): void {
    this.root?.remove();
    this.root = null;
    this.active = false;
  }

  destroy(): void {
    for (const timer of this.timers) timer?.remove?.();
    this.timers = [];
    this.finish();
  }
}
