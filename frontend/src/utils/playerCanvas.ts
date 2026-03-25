import { PLAYER_COLORS } from '../scenes/BootScene';

/** Draw a player sprite icon using Canvas2D (matches BootScene's Phaser rendering) */
export function drawPlayerSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  hexColor: string,
  eyeStyle?: string,
): void {
  const r = size * 0.12;
  const pad = size * 0.04;

  // Body darker bottom
  const darkerColor = darkenHex(hexColor, 0.7);
  ctx.fillStyle = darkerColor;
  roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
  ctx.fill();

  // Body lighter top
  ctx.fillStyle = hexColor;
  roundRect(ctx, x + pad, y + pad, size - pad * 2, size * 0.75, r);
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, size * 0.04);
  roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
  ctx.stroke();

  // Highlight shine
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  roundRect(ctx, x + size * 0.12, y + size * 0.1, size * 0.22, size * 0.13, size * 0.06);
  ctx.fill();

  const cx = x + size / 2;
  const cy = y + size / 2;

  if (eyeStyle === 'cyclops') {
    // Single centered eye
    const eyeR = size * 0.12;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.04, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.08, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  } else if (eyeStyle === 'dot') {
    // Small dot eyes
    const dotR = size * 0.04;
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx - size * 0.15, cy + size * 0.04, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + size * 0.15, cy + size * 0.04, dotR, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Default or angry eyes — white sclera + pupils
    const eyeR = size * 0.1;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(cx - size * 0.15, cy + size * 0.04, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + size * 0.15, cy + size * 0.04, eyeR, 0, Math.PI * 2);
    ctx.fill();

    // Angry eyebrows
    if (eyeStyle === 'angry') {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx - size * 0.24, cy - size * 0.04);
      ctx.lineTo(cx - size * 0.08, cy + size * 0.0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.24, cy - size * 0.04);
      ctx.lineTo(cx + size * 0.08, cy + size * 0.0);
      ctx.stroke();
    }

    // Pupils
    ctx.fillStyle = '#111';
    const pupilR = size * 0.05;
    ctx.beginPath();
    ctx.arc(cx - size * 0.15, cy + size * 0.08, pupilR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + size * 0.15, cy + size * 0.08, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Convert a PLAYER_COLORS integer to hex string */
export function playerColorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Get hex color for a player by index (from PLAYER_COLORS array) */
export function getPlayerColorHex(index: number): string {
  return playerColorToHex(PLAYER_COLORS[index % PLAYER_COLORS.length]);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function darkenHex(hex: string, factor: number): string {
  const c = hex.replace('#', '');
  const r = Math.round(parseInt(c.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(c.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(c.substring(4, 6), 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
