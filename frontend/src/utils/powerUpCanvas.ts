import { quadRoundRect } from './canvasShapes';
import { POWERUP_ICON_DRAWERS } from './powerUpIcons';

export function renderPowerUpCanvas(color: string, type: string, size = 48): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const center = size / 2;
  const scale = size / 48;

  // Glow behind
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(center, center, 22 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Background rounded rect
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = color;
  quadRoundRect(ctx, 4 * scale, 4 * scale, 40 * scale, 40 * scale, 8 * scale);
  ctx.fill();

  // Border
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * scale;
  quadRoundRect(ctx, 4 * scale, 4 * scale, 40 * scale, 40 * scale, 8 * scale);
  ctx.stroke();

  // Procedural icon
  ctx.globalAlpha = 1;
  const drawIcon = POWERUP_ICON_DRAWERS[type];
  if (drawIcon) {
    drawIcon(ctx, center, center, scale);
  }

  return canvas;
}
