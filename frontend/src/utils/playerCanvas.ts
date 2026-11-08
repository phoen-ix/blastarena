import { quadRoundRect } from './canvasShapes';
import { playerColor } from '../game/playerPalette';

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
  quadRoundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
  ctx.fill();

  // Body lighter top
  ctx.fillStyle = hexColor;
  quadRoundRect(ctx, x + pad, y + pad, size - pad * 2, size * 0.75, r);
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, size * 0.04);
  quadRoundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, r);
  ctx.stroke();

  // Highlight shine
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  quadRoundRect(ctx, x + size * 0.12, y + size * 0.1, size * 0.22, size * 0.13, size * 0.06);
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

/** CSS colour of palette slot `index`, honouring the colour-blind setting (playerPalette). */
export function getPlayerColorHex(index: number): string {
  return playerColorToHex(playerColor(index));
}

/** Draw a bomb sprite icon using Canvas2D (matches BootScene's Phaser rendering) */
export function drawBombSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  baseColor?: string,
  fuseColor?: string,
): void {
  const s = size / 48;
  const isCustom = !!baseColor;

  // Body shadow (offset lower)
  const bodyDark = isCustom ? darkenHex(baseColor!, 0.75) : '#111111';
  ctx.fillStyle = bodyDark;
  ctx.beginPath();
  ctx.arc(x + 24 * s, y + 26 * s, 16 * s, 0, Math.PI * 2);
  ctx.fill();

  // Body main
  if (isCustom) {
    ctx.fillStyle = baseColor!;
    ctx.beginPath();
    ctx.arc(x + 24 * s, y + 24 * s, 16 * s, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#222222';
    ctx.beginPath();
    ctx.arc(x + 22 * s, y + 23 * s, 12 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Metallic highlight / shine
  ctx.fillStyle = isCustom ? 'rgba(255,255,255,0.3)' : 'rgba(68,68,68,0.6)';
  ctx.beginPath();
  ctx.arc(x + 18 * s, y + (isCustom ? 18 : 20) * s, (isCustom ? 5 : 4) * s, 0, Math.PI * 2);
  ctx.fill();

  // Fuse line
  const fc = fuseColor || '#886644';
  ctx.strokeStyle = fc;
  ctx.lineWidth = (isCustom ? 3 : 2) * s;
  ctx.beginPath();
  if (isCustom) {
    ctx.moveTo(x + 24 * s, y + 8 * s);
    ctx.lineTo(x + 28 * s, y + 4 * s);
    ctx.lineTo(x + 32 * s, y + 6 * s);
  } else {
    ctx.moveTo(x + 24 * s, y + 10 * s);
    ctx.lineTo(x + 28 * s, y + 6 * s);
    ctx.lineTo(x + 30 * s, y + 8 * s);
  }
  ctx.stroke();

  // Spark tip
  const sparkX = isCustom ? 32 : 30;
  const sparkY = isCustom ? 6 : 7;
  ctx.fillStyle = isCustom ? '#ffff00' : '#ff4400';
  ctx.beginPath();
  ctx.arc(x + sparkX * s, y + sparkY * s, (isCustom ? 3 : 4) * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = isCustom ? '#ffffff' : '#ffaa00';
  ctx.beginPath();
  ctx.arc(x + sparkX * s, y + sparkY * s, (isCustom ? 1.5 : 2) * s, 0, Math.PI * 2);
  ctx.fill();
}

function darkenHex(hex: string, factor: number): string {
  const c = hex.replace('#', '');
  const r = Math.round(parseInt(c.substring(0, 2), 16) * factor);
  const g = Math.round(parseInt(c.substring(2, 4), 16) * factor);
  const b = Math.round(parseInt(c.substring(4, 6), 16) * factor);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
