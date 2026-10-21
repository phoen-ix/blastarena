const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where to draw a partner arrow: CSS pixels from the top-left of the game, and its heading. */
export interface ArrowPlacement {
  x: number;
  y: number;
  angle: number;
}

/**
 * The split-screen divider and the arrows pointing at an off-screen partner, as DOM over the
 * game. In the canvas they were drawn through each camera's zoom, which distorted them; here
 * they stay one size whatever the zoom or render ratio.
 */
export class SplitScreenOverlay {
  private root: HTMLElement;
  private divider: HTMLElement;
  private arrows: SVGSVGElement[] = [];

  constructor(mode: 'split-h' | 'split-v') {
    this.root = document.createElement('div');
    this.root.className = 'split-overlay';
    this.root.setAttribute('aria-hidden', 'true');
    this.divider = document.createElement('div');
    this.root.appendChild(this.divider);
    for (let i = 0; i < 2; i++) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'split-arrow');
      svg.setAttribute('viewBox', '-12 -12 24 24');
      const tri = document.createElementNS(SVG_NS, 'polygon');
      // Pointing right; rotated toward the partner.
      tri.setAttribute('points', '10,0 -7,7 -7,-7');
      svg.appendChild(tri);
      svg.style.display = 'none';
      this.root.appendChild(svg);
      this.arrows.push(svg);
    }
    this.setMode(mode);
    document.getElementById('ui-overlay')?.appendChild(this.root);
  }

  setMode(mode: 'split-h' | 'split-v'): void {
    this.divider.className = `split-divider split-divider-${mode === 'split-h' ? 'h' : 'v'}`;
  }

  /** Show arrow `i` (0 = player one's view, 1 = player two's) at `at`, or hide it. */
  setArrow(i: 0 | 1, at: ArrowPlacement | null): void {
    const svg = this.arrows[i];
    if (!svg) return;
    if (!at) {
      if (svg.style.display !== 'none') svg.style.display = 'none';
      return;
    }
    svg.style.display = '';
    svg.style.transform = `translate(${at.x}px, ${at.y}px) rotate(${at.angle}rad)`;
  }

  destroy(): void {
    this.root.remove();
  }
}
