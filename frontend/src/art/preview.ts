import { setPaintScale } from './paint';
import type { StylePainters } from './painters/types';

/**
 * A small scene for the settings picker, painted straight onto a canvas: floor, a wall, a crate,
 * a player, a bomb and a burst of flame. Sized to fill the canvas's own pixel size.
 */
export function drawStylePreview(P: StylePainters, canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const cols = 5;
  const rows = 3;
  const top = P.blockHeight + 4;
  const scale = Math.min(canvas.width / (cols * 48), canvas.height / (rows * 48 + top));
  g.save();
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = P.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.imageSmoothingEnabled = !P.pixel;
  g.translate(
    (canvas.width - cols * 48 * scale) / 2,
    (canvas.height - (rows * 48 + top) * scale) / 2,
  );
  g.scale(scale, scale);
  g.translate(0, top);
  setPaintScale(scale);

  const blocks = new Set(['0,0', '4,0', '2,1', '0,2', '4,2', '3,0']);
  const at = (x: number, y: number, fn: () => void, centre = false) => {
    g.save();
    g.translate(x * 48 + (centre ? 24 : 0), y * 48 + (centre ? 24 : 0));
    fn();
    g.restore();
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      at(x, y, () => {
        g.beginPath();
        g.rect(0, 0, 48, 48);
        g.clip();
        P.floor(g, { world: 'classic', variant: (x * 3 + y) % 8, parity: ((x + y) & 1) as 0 | 1 });
        for (const [dx, dy] of [
          [-1, 0],
          [0, -1],
          [-1, -1],
        ]) {
          if (!blocks.has(`${x + dx},${y + dy}`)) continue;
          g.save();
          g.translate(dx * 48, dy * 48);
          P.blockShadow(g, { world: 'classic' });
          g.restore();
        }
      });
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (blocks.has(`${x},${y}`)) {
        at(x, y, () =>
          x === 3
            ? P.crate(g, { world: 'classic', kind: 'crate', variant: 0 })
            : P.wall(g, { world: 'classic', mask: 0, border: false, variant: (x + y) % 4 }),
        );
      }
      if (x === 1 && y === 1) {
        at(
          x,
          y,
          () =>
            P.player(g, {
              color: '#e94560',
              eyes: 'default',
              dir: 'down',
              pose: { kind: 'idle', blink: false },
            }),
          true,
        );
      }
      if (x === 3 && y === 1) {
        at(x, y, () => P.bomb(g, { type: 'normal', fuse: 0.6, spark: 0, hot: false }), true);
      }
      if (y === 2 && x >= 1 && x <= 3) {
        const piece = x === 2 ? 'center' : 'end';
        const dir = x === 1 ? 'left' : x === 3 ? 'right' : 'down';
        at(
          x,
          y,
          () =>
            P.flame(g, {
              piece,
              dir,
              frame: Math.floor(P.flameFrames * 0.3),
              frames: P.flameFrames,
              pierce: false,
            }),
          true,
        );
      }
    }
  }
  g.restore();
  setPaintScale(1);
}
