export type PowerUpIconDrawFn = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
) => void;

/** Bomb Up: bomb silhouette with a "+" sign */
function drawBombUpIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // Bomb body
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx - 2 * s, cy + 2 * s, 10 * s, 0, Math.PI * 2);
  ctx.fill();

  // Highlight
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(cx - 5 * s, cy - 1 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();

  // Fuse
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(cx - 2 * s, cy - 8 * s);
  ctx.quadraticCurveTo(cx + 4 * s, cy - 12 * s, cx + 6 * s, cy - 10 * s);
  ctx.stroke();

  // Spark
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx + 6 * s, cy - 10 * s, 2.5 * s, 0, Math.PI * 2);
  ctx.fill();

  // Plus sign
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.moveTo(cx + 8 * s, cy + 2 * s);
  ctx.lineTo(cx + 16 * s, cy + 2 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 12 * s, cy - 2 * s);
  ctx.lineTo(cx + 12 * s, cy + 6 * s);
  ctx.stroke();

  ctx.globalAlpha = 1;
}

/** Fire Up: stylized flame */
function drawFireUpIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // Outer flame
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14 * s);
  ctx.quadraticCurveTo(cx + 12 * s, cy - 4 * s, cx + 8 * s, cy + 10 * s);
  ctx.quadraticCurveTo(cx + 4 * s, cy + 14 * s, cx, cy + 12 * s);
  ctx.quadraticCurveTo(cx - 4 * s, cy + 14 * s, cx - 8 * s, cy + 10 * s);
  ctx.quadraticCurveTo(cx - 12 * s, cy - 4 * s, cx, cy - 14 * s);
  ctx.fill();

  // Inner flame
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8 * s);
  ctx.quadraticCurveTo(cx + 7 * s, cy - 1 * s, cx + 4 * s, cy + 8 * s);
  ctx.quadraticCurveTo(cx + 2 * s, cy + 11 * s, cx, cy + 9 * s);
  ctx.quadraticCurveTo(cx - 2 * s, cy + 11 * s, cx - 4 * s, cy + 8 * s);
  ctx.quadraticCurveTo(cx - 7 * s, cy - 1 * s, cx, cy - 8 * s);
  ctx.fill();

  // Core
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 2 * s);
  ctx.quadraticCurveTo(cx + 3 * s, cy + 3 * s, cx + 2 * s, cy + 7 * s);
  ctx.quadraticCurveTo(cx, cy + 9 * s, cx - 2 * s, cy + 7 * s);
  ctx.quadraticCurveTo(cx - 3 * s, cy + 3 * s, cx, cy - 2 * s);
  ctx.fill();

  ctx.globalAlpha = 1;
}

/** Speed Up: lightning bolt */
function drawSpeedUpIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.moveTo(cx + 2 * s, cy - 14 * s);
  ctx.lineTo(cx - 4 * s, cy - 1 * s);
  ctx.lineTo(cx + 1 * s, cy - 1 * s);
  ctx.lineTo(cx - 3 * s, cy + 14 * s);
  ctx.lineTo(cx + 8 * s, cy - 1 * s);
  ctx.lineTo(cx + 3 * s, cy - 1 * s);
  ctx.lineTo(cx + 8 * s, cy - 14 * s);
  ctx.closePath();
  ctx.fill();

  // Outline for definition
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1 * s;
  ctx.stroke();

  ctx.globalAlpha = 1;
}

/** Shield: heraldic shield shape */
function drawShieldIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // Outer shield
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(cx - 10 * s, cy - 12 * s);
  ctx.lineTo(cx + 10 * s, cy - 12 * s);
  ctx.quadraticCurveTo(cx + 12 * s, cy - 12 * s, cx + 12 * s, cy - 8 * s);
  ctx.lineTo(cx + 12 * s, cy + 2 * s);
  ctx.quadraticCurveTo(cx + 10 * s, cy + 12 * s, cx, cy + 15 * s);
  ctx.quadraticCurveTo(cx - 10 * s, cy + 12 * s, cx - 12 * s, cy + 2 * s);
  ctx.lineTo(cx - 12 * s, cy - 8 * s);
  ctx.quadraticCurveTo(cx - 12 * s, cy - 12 * s, cx - 10 * s, cy - 12 * s);
  ctx.closePath();
  ctx.fill();

  // Inner bevel
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(cx - 7 * s, cy - 8 * s);
  ctx.lineTo(cx + 7 * s, cy - 8 * s);
  ctx.quadraticCurveTo(cx + 8 * s, cy - 8 * s, cx + 8 * s, cy - 5 * s);
  ctx.lineTo(cx + 8 * s, cy + 1 * s);
  ctx.quadraticCurveTo(cx + 7 * s, cy + 8 * s, cx, cy + 11 * s);
  ctx.quadraticCurveTo(cx - 7 * s, cy + 8 * s, cx - 8 * s, cy + 1 * s);
  ctx.lineTo(cx - 8 * s, cy - 5 * s);
  ctx.quadraticCurveTo(cx - 8 * s, cy - 8 * s, cx - 7 * s, cy - 8 * s);
  ctx.closePath();
  ctx.fill();

  // Center cross
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.95;
  ctx.fillRect(cx - 1.5 * s, cy - 6 * s, 3 * s, 14 * s);
  ctx.fillRect(cx - 6 * s, cy - 1.5 * s, 12 * s, 3 * s);

  ctx.globalAlpha = 1;
}

/** Kick: boot with motion lines */
function drawKickIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // Boot shape
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  // Shaft (top)
  ctx.moveTo(cx - 3 * s, cy - 14 * s);
  ctx.lineTo(cx + 5 * s, cy - 14 * s);
  ctx.lineTo(cx + 5 * s, cy + 2 * s);
  // Toe
  ctx.lineTo(cx + 14 * s, cy + 4 * s);
  ctx.lineTo(cx + 14 * s, cy + 8 * s);
  // Sole
  ctx.lineTo(cx + 14 * s, cy + 12 * s);
  ctx.lineTo(cx - 5 * s, cy + 12 * s);
  // Heel
  ctx.lineTo(cx - 5 * s, cy + 4 * s);
  ctx.lineTo(cx - 3 * s, cy + 2 * s);
  ctx.closePath();
  ctx.fill();

  // Sole detail
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - 5 * s, cy + 9 * s, 19 * s, 3 * s);

  // Motion lines
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5 * s;
  for (let i = 0; i < 3; i++) {
    const y = cy + (i * 4 - 2) * s;
    ctx.beginPath();
    ctx.moveTo(cx - 14 * s, y);
    ctx.lineTo(cx - 8 * s, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/** Pierce Bomb: starburst with arrow through it */
function drawPierceBombIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
): void {
  // Starburst
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  const points = 6;
  const outerR = 12 * s;
  const innerR = 5 * s;
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Arrow through it
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.moveTo(cx - 14 * s, cy);
  ctx.lineTo(cx + 14 * s, cy);
  ctx.stroke();

  // Arrowhead
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx + 14 * s, cy);
  ctx.lineTo(cx + 9 * s, cy - 4 * s);
  ctx.lineTo(cx + 9 * s, cy + 4 * s);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 1;
}

/** Remote Bomb: antenna with signal waves */
function drawRemoteBombIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
): void {
  // Antenna base
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy + 8 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();

  // Antenna stick
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5 * s;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 4 * s);
  ctx.lineTo(cx, cy - 4 * s);
  ctx.stroke();

  // Signal waves
  ctx.lineWidth = 2 * s;
  ctx.lineCap = 'round';
  const arcs = [
    { r: 6, alpha: 0.9 },
    { r: 10, alpha: 0.6 },
    { r: 14, alpha: 0.35 },
  ];
  for (const arc of arcs) {
    ctx.globalAlpha = arc.alpha;
    ctx.beginPath();
    ctx.arc(cx, cy - 4 * s, arc.r * s, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.stroke();
  }

  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
}

/** Line Bomb: three bombs in a row with directional chevron */
function drawLineBombIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // Three circles in a row
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.9;
  const positions = [-8, 0, 8];
  const sizes = [4, 3.5, 3];
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx + positions[i] * s, cy + 2 * s, sizes[i] * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Connecting line
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(cx - 8 * s, cy + 2 * s);
  ctx.lineTo(cx + 8 * s, cy + 2 * s);
  ctx.stroke();

  // Directional chevron (pointing right)
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(cx + 10 * s, cy - 3 * s);
  ctx.lineTo(cx + 15 * s, cy + 2 * s);
  ctx.lineTo(cx + 10 * s, cy + 7 * s);
  ctx.stroke();

  // Fuse sparks on first bomb
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - 8 * s, cy - 4 * s, 2 * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

export const POWERUP_ICON_DRAWERS: Record<string, PowerUpIconDrawFn> = {
  bomb_up: drawBombUpIcon,
  fire_up: drawFireUpIcon,
  speed_up: drawSpeedUpIcon,
  shield: drawShieldIcon,
  kick: drawKickIcon,
  pierce_bomb: drawPierceBombIcon,
  remote_bomb: drawRemoteBombIcon,
  line_bomb: drawLineBombIcon,
};
