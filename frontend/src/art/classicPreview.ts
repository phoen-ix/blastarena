import { renderTileCanvas } from '../utils/tileCanvas';
import { drawBombSprite, drawPlayerSprite } from '../utils/playerCanvas';

/**
 * The settings-card preview for Classic: the same little scene as the drawn styles' preview,
 * painted with the Canvas2D copies of BootScene's textures that the Help and Settings pages use.
 */
export function drawClassicPreview(canvas: HTMLCanvasElement): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const cols = 5;
  const rows = 3;
  const tile = Math.floor(Math.min(canvas.width / cols, canvas.height / rows));
  const ox = Math.floor((canvas.width - cols * tile) / 2);
  const oy = Math.floor((canvas.height - rows * tile) / 2);
  const s = tile / 48;

  g.save();
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#1a1a2e';
  g.fillRect(0, 0, canvas.width, canvas.height);

  const wall = renderTileCanvas('wall', tile);
  const crate = renderTileCanvas('destructible', tile);
  const blocks: Record<string, HTMLCanvasElement> = {
    '0,0': wall,
    '4,0': wall,
    '2,1': wall,
    '0,2': wall,
    '4,2': wall,
    '3,0': crate,
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = ox + x * tile;
      const py = oy + y * tile;
      // BootScene's floor: a slightly varied base with a faint grid line.
      const v = (x * 3 + y) % 4;
      g.fillStyle = `rgb(${0x2a + v},${0x2a + v},${0x3e + v * 2})`;
      g.fillRect(px, py, tile, tile);
      g.strokeStyle = 'rgba(51,51,72,0.2)';
      g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, tile - 1, tile - 1);
      const block = blocks[`${x},${y}`];
      if (block) g.drawImage(block, px, py);
    }
  }

  drawPlayerSprite(g, ox + tile, oy + tile, tile, '#e94560');
  drawBombSprite(g, ox + 3 * tile, oy + tile, tile);

  // BootScene's explosion: four concentric circles, one per flame cell.
  for (let x = 1; x <= 3; x++) {
    const cx = ox + x * tile + 24 * s;
    const cy = oy + 2 * tile + 24 * s;
    for (const [r, color] of [
      [22, 'rgba(255,34,0,0.6)'],
      [16, 'rgba(255,102,0,0.7)'],
      [10, 'rgba(255,170,0,0.8)'],
      [5, 'rgba(255,255,68,0.9)'],
    ] as const) {
      g.fillStyle = color;
      g.beginPath();
      g.arc(cx, cy, r * s, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}
