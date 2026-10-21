/** Paint helpers used across the neon painters, plus a couple of neon-local shortcuts. */
export {
  circle,
  clamp,
  ease,
  glow,
  hash2,
  hexagon,
  icon,
  lerp,
  mix,
  poly,
  PU_COLORS_NEW,
  PU_SHAPE,
  rgba,
  rng,
  rr,
  shade,
  star,
} from '../../paint';

/** Fill an ellipse (leaves the path set, so callers may stroke it too). */
export function ellipseFill(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  rot = 0,
): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
}
