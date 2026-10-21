import { describe, it, expect, beforeEach } from 'vitest';
import { SplitScreenOverlay } from '../../src/game/SplitScreenOverlay';

describe('SplitScreenOverlay', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const overlay = document.createElement('div');
    overlay.id = 'ui-overlay';
    document.body.appendChild(overlay);
  });

  it('draws the divider for the split and shows arrows only when placed', () => {
    const o = new SplitScreenOverlay('split-v');
    expect(document.querySelector('.split-divider-v')).not.toBeNull();
    const arrows = document.querySelectorAll<SVGSVGElement>('.split-arrow');
    expect(arrows).toHaveLength(2);
    expect(arrows[0].style.display).toBe('none');

    o.setArrow(0, { x: 120, y: 40, angle: Math.PI / 2 });
    expect(arrows[0].style.display).toBe('');
    expect(arrows[0].style.transform).toContain('translate(120px, 40px)');
    o.setArrow(0, null);
    expect(arrows[0].style.display).toBe('none');

    o.setMode('split-h');
    expect(document.querySelector('.split-divider-h')).not.toBeNull();
    o.destroy();
    expect(document.querySelector('.split-overlay')).toBeNull();
  });
});
