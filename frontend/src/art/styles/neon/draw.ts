import { rgba } from '../../paint';

/** Rounded rectangle from corner coordinates with a radius per corner (0 = square). */
export function rrc(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tl: number,
  tr: number,
  br: number,
  bl: number,
): void {
  g.beginPath();
  g.moveTo(x0 + tl, y0);
  g.lineTo(x1 - tr, y0);
  if (tr) g.arcTo(x1, y0, x1, y0 + tr, tr);
  else g.lineTo(x1, y0);
  g.lineTo(x1, y1 - br);
  if (br) g.arcTo(x1, y1, x1 - br, y1, br);
  else g.lineTo(x1, y1);
  g.lineTo(x0 + bl, y1);
  if (bl) g.arcTo(x0, y1, x0, y1 - bl, bl);
  else g.lineTo(x0, y1);
  g.lineTo(x0, y0 + tl);
  if (tl) g.arcTo(x0, y0, x0 + tl, y0, tl);
  else g.lineTo(x0, y0);
  g.closePath();
}

/** Open polyline path from a flat x,y list. */
export function polyline(g: CanvasRenderingContext2D, pts: number[]): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
}

/** Glowing stroke of the current path: a wide faint underlay and a crisp core. */
export function neonStroke(g: CanvasRenderingContext2D, color: string, w: number, a = 1): void {
  g.strokeStyle = rgba(color, 0.22 * a);
  g.lineWidth = w * 3.2;
  g.stroke();
  g.strokeStyle = rgba(color, a);
  g.lineWidth = w;
  g.stroke();
}

/** Fill the current path with a colour at an alpha. */
export function fillA(g: CanvasRenderingContext2D, color: string, a: number): void {
  g.fillStyle = rgba(color, a);
  g.fill();
}

/** Run `fn` with additive compositing, restoring the previous state afterwards. */
export function additive(g: CanvasRenderingContext2D, fn: () => void): void {
  g.save();
  g.globalCompositeOperation = 'lighter';
  fn();
  g.restore();
}

/** Clip to a tile at the origin. */
export function clipTile(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.rect(0, 0, 48, 48);
  g.clip();
}
