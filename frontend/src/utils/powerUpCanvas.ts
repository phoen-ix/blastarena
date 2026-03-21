export const POWERUP_EMOJI_MAP: Record<string, string> = {
  bomb_up: '\u{1F4A3}',
  fire_up: '\u{1F525}',
  speed_up: '\u26A1',
  shield: '\u{1F6E1}\uFE0F',
  kick: '\u{1F462}',
  pierce_bomb: '\u{1F4A5}',
  remote_bomb: '\u{1F4E1}',
  line_bomb: '\u{1F9E8}',
};

function canvasRoundRect(
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

export function renderPowerUpCanvas(color: string, emoji: string, size = 48): HTMLCanvasElement {
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
  canvasRoundRect(ctx, 4 * scale, 4 * scale, 40 * scale, 40 * scale, 8 * scale);
  ctx.fill();

  // Border
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * scale;
  canvasRoundRect(ctx, 4 * scale, 4 * scale, 40 * scale, 40 * scale, 8 * scale);
  ctx.stroke();

  // Emoji icon
  ctx.globalAlpha = 1;
  ctx.font = `${Math.round(22 * scale)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, center, center + 1 * scale);

  return canvas;
}
