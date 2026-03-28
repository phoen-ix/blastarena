/**
 * Canvas2D tile preview renderer for DOM-based UI (Help panel, Level Editor docs, etc.).
 * Replicates the procedural Phaser tile textures from BootScene + campaignThemes.
 */

import type { CampaignThemePalette } from '@blast-arena/shared';

// Default classic palette (matches BootScene constants)
const CLASSIC: CampaignThemePalette = {
  wall: 0x333355,
  wallAccent: 0x444466,
  destructible: 0x886633,
  destructibleAccent: 0x997744,
  floor: 0x2a2a3e,
  floorAccent: 0x323248,
};

function hexToRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

function hexToRgb(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r},${g},${b})`;
}

function darken(color: number, factor: number): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (Math.min(255, r) << 16) | (Math.min(255, g) << 8) | Math.min(255, b);
}

function lighten(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, number] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = size / 48;
  return [canvas, ctx, s];
}

// --- Tile drawers ---

function drawWall(ctx: CanvasRenderingContext2D, s: number, p: CampaignThemePalette): void {
  ctx.fillStyle = hexToRgb(p.wall);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgb(lighten(p.wall, 1.3));
  ctx.fillRect(0, 0, 48 * s, 2 * s);
  ctx.fillRect(0, 0, 2 * s, 48 * s);
  ctx.fillStyle = hexToRgb(darken(p.wall, 0.7));
  ctx.fillRect(0, 46 * s, 48 * s, 2 * s);
  ctx.fillRect(46 * s, 0, 2 * s, 48 * s);
  ctx.fillStyle = hexToRgb(p.wallAccent);
  ctx.fillRect(4 * s, 4 * s, 18 * s, 18 * s);
  ctx.fillRect(26 * s, 26 * s, 18 * s, 18 * s);
  ctx.fillStyle = hexToRgba(lighten(p.wallAccent, 1.2), 0.3);
  ctx.fillRect(6 * s, 6 * s, 8 * s, 8 * s);
  ctx.fillRect(28 * s, 28 * s, 8 * s, 8 * s);
}

function drawDestructible(ctx: CanvasRenderingContext2D, s: number, p: CampaignThemePalette): void {
  ctx.fillStyle = hexToRgb(p.destructible);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgb(p.destructibleAccent);
  ctx.fillRect(0, 0, 48 * s, 2 * s);
  ctx.fillRect(0, 0, 2 * s, 48 * s);
  ctx.fillStyle = hexToRgb(darken(p.destructible, 0.7));
  ctx.fillRect(0, 46 * s, 48 * s, 2 * s);
  ctx.fillRect(46 * s, 0, 2 * s, 48 * s);
  ctx.strokeStyle = hexToRgba(darken(p.destructible, 0.6), 0.6);
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(0, 16 * s);
  ctx.lineTo(48 * s, 16 * s);
  ctx.moveTo(0, 32 * s);
  ctx.lineTo(48 * s, 32 * s);
  ctx.moveTo(24 * s, 0);
  ctx.lineTo(24 * s, 16 * s);
  ctx.moveTo(12 * s, 16 * s);
  ctx.lineTo(12 * s, 32 * s);
  ctx.moveTo(36 * s, 16 * s);
  ctx.lineTo(36 * s, 32 * s);
  ctx.moveTo(24 * s, 32 * s);
  ctx.lineTo(24 * s, 48 * s);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(darken(p.destructible, 0.5), 0.3);
  ctx.beginPath();
  ctx.moveTo(8 * s, 4 * s);
  ctx.lineTo(14 * s, 12 * s);
  ctx.moveTo(34 * s, 20 * s);
  ctx.lineTo(42 * s, 28 * s);
  ctx.stroke();
}

function drawDestructibleCracked(
  ctx: CanvasRenderingContext2D,
  s: number,
  p: CampaignThemePalette,
): void {
  ctx.fillStyle = hexToRgb(darken(p.destructible, 0.85));
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgb(p.destructible);
  ctx.fillRect(0, 0, 48 * s, 2 * s);
  ctx.fillRect(0, 0, 2 * s, 48 * s);
  ctx.fillStyle = hexToRgb(darken(p.destructible, 0.5));
  ctx.fillRect(0, 46 * s, 48 * s, 2 * s);
  ctx.fillRect(46 * s, 0, 2 * s, 48 * s);
  ctx.strokeStyle = hexToRgba(darken(p.destructible, 0.5), 0.6);
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(0, 16 * s);
  ctx.lineTo(48 * s, 16 * s);
  ctx.moveTo(0, 32 * s);
  ctx.lineTo(48 * s, 32 * s);
  ctx.moveTo(24 * s, 0);
  ctx.lineTo(24 * s, 16 * s);
  ctx.moveTo(12 * s, 16 * s);
  ctx.lineTo(12 * s, 32 * s);
  ctx.moveTo(36 * s, 16 * s);
  ctx.lineTo(36 * s, 32 * s);
  ctx.moveTo(24 * s, 32 * s);
  ctx.lineTo(24 * s, 48 * s);
  ctx.stroke();
  // Heavy cracks
  ctx.strokeStyle = hexToRgba(darken(p.destructible, 0.3), 0.7);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(6 * s, 2 * s);
  ctx.lineTo(20 * s, 14 * s);
  ctx.lineTo(18 * s, 28 * s);
  ctx.moveTo(30 * s, 18 * s);
  ctx.lineTo(44 * s, 34 * s);
  ctx.lineTo(38 * s, 46 * s);
  ctx.moveTo(10 * s, 34 * s);
  ctx.lineTo(24 * s, 44 * s);
  ctx.stroke();
}

function drawTeleporter(
  ctx: CanvasRenderingContext2D,
  s: number,
  variant: 'a' | 'b',
  floorColor: number,
): void {
  const c = 24 * s;
  const padColor = variant === 'a' ? 0x44aaff : 0xff8844;
  ctx.fillStyle = hexToRgb(floorColor);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgba(padColor, 0.15);
  ctx.beginPath();
  ctx.arc(c, c, 20 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(padColor, 0.3);
  ctx.beginPath();
  ctx.arc(c, c, 14 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(padColor, 0.5);
  ctx.beginPath();
  ctx.arc(c, c, 8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(padColor, 0.6);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(c, c, 18 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(padColor, 0.4);
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.arc(c, c, 10 * s, 0, Math.PI, true);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, 10 * s, Math.PI, Math.PI * 2, true);
  ctx.stroke();
}

function drawConveyor(
  ctx: CanvasRenderingContext2D,
  s: number,
  dir: string,
  floorColor: number,
  accentColor: number,
): void {
  const STRIPE_W = 8;
  const horizontal = dir === 'left' || dir === 'right';
  const chevronAngles: Record<string, number> = {
    up: -Math.PI / 2,
    down: Math.PI / 2,
    left: Math.PI,
    right: 0,
  };
  ctx.fillStyle = hexToRgb(floorColor);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgba(accentColor, 0.5);
  ctx.fillRect(2 * s, 2 * s, 44 * s, 44 * s);
  ctx.fillStyle = hexToRgba(0x88aacc, 0.35);
  const cycle = STRIPE_W * 2;
  if (horizontal) {
    for (let sx = 0; sx < 48; sx += cycle) ctx.fillRect(sx * s, 0, STRIPE_W * s, 48 * s);
  } else {
    for (let sy = 0; sy < 48; sy += cycle) ctx.fillRect(0, sy * s, 48 * s, STRIPE_W * s);
  }
  const angle = chevronAngles[dir];
  const c = 24 * s;
  const ax = Math.cos(angle) * 5 * s,
    ay = Math.sin(angle) * 5 * s;
  const px = Math.cos(angle + Math.PI / 2) * 4 * s,
    py = Math.sin(angle + Math.PI / 2) * 4 * s;
  ctx.strokeStyle = hexToRgba(0x88aacc, 0.5);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(c + ax, c + ay);
  ctx.lineTo(c - ax * 0.4 + px, c - ay * 0.4 + py);
  ctx.moveTo(c + ax, c + ay);
  ctx.lineTo(c - ax * 0.4 - px, c - ay * 0.4 - py);
  ctx.stroke();
}

function drawExit(ctx: CanvasRenderingContext2D, s: number, floorColor: number): void {
  ctx.fillStyle = hexToRgb(floorColor);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  // Trapdoor
  ctx.fillStyle = hexToRgb(0x4a3a2e);
  roundRect(ctx, 6 * s, 6 * s, 36 * s, 36 * s, 4 * s);
  ctx.fill();
  ctx.fillStyle = hexToRgb(0x3a2a1e);
  roundRect(ctx, 8 * s, 8 * s, 32 * s, 32 * s, 3 * s);
  ctx.fill();
  // Door handle
  ctx.fillStyle = hexToRgb(0xccaa44);
  ctx.beginPath();
  ctx.arc(30 * s, 24 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  // Arrow down
  ctx.fillStyle = hexToRgba(0x44ff44, 0.7);
  ctx.beginPath();
  ctx.moveTo(24 * s, 34 * s);
  ctx.lineTo(18 * s, 26 * s);
  ctx.lineTo(30 * s, 26 * s);
  ctx.closePath();
  ctx.fill();
}

function drawGoal(ctx: CanvasRenderingContext2D, s: number, floorColor: number): void {
  ctx.fillStyle = hexToRgb(floorColor);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  const c = 24 * s;
  ctx.fillStyle = hexToRgba(0xffcc00, 0.2);
  ctx.beginPath();
  ctx.arc(c, c, 18 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0xffcc00, 0.4);
  ctx.beginPath();
  ctx.arc(c, c, 12 * s, 0, Math.PI * 2);
  ctx.fill();
  // Star
  ctx.fillStyle = hexToRgba(0xffdd44, 0.9);
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    ctx.beginPath();
    ctx.moveTo(ax * s, ay * s);
    ctx.lineTo(bx * s, by * s);
    ctx.lineTo(cx * s, cy * s);
    ctx.closePath();
    ctx.fill();
  };
  tri(24, 12, 27, 20, 35, 20);
  tri(24, 12, 21, 20, 13, 20);
  tri(24, 36, 27, 28, 35, 28);
  tri(24, 36, 21, 28, 13, 28);
  tri(13, 20, 17, 24, 13, 28);
  tri(35, 20, 31, 24, 35, 28);
}

function drawSwitch(
  ctx: CanvasRenderingContext2D,
  s: number,
  color: number,
  floorColor: number,
): void {
  const c = 24 * s;
  ctx.fillStyle = hexToRgb(floorColor);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.strokeStyle = hexToRgba(0x333348, 0.2);
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0, 0, 48 * s, 48 * s);
  // Pressure plate
  ctx.fillStyle = hexToRgba(color, 0.5);
  ctx.beginPath();
  ctx.arc(c, c, 16 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(color, 0.6);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(c, c, 16 * s, 0, Math.PI * 2);
  ctx.stroke();
  // Center gem
  ctx.fillStyle = hexToRgba(lighten(color, 1.3), 0.8);
  ctx.beginPath();
  ctx.arc(c, c, 6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0xffffff, 0.2);
  ctx.beginPath();
  ctx.arc(22 * s, 22 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawGate(ctx: CanvasRenderingContext2D, s: number, color: number): void {
  ctx.fillStyle = hexToRgb(0x2a2a40);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  // Vertical bars
  ctx.strokeStyle = hexToRgba(color, 0.8);
  ctx.lineWidth = 4 * s;
  for (let i = 0; i < 5; i++) {
    const bx = (6 + i * 9) * s;
    ctx.beginPath();
    ctx.moveTo(bx, 2 * s);
    ctx.lineTo(bx, 46 * s);
    ctx.stroke();
  }
  // Horizontal crossbars
  ctx.strokeStyle = hexToRgba(darken(color, 0.8), 0.7);
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(2 * s, 16 * s);
  ctx.lineTo(46 * s, 16 * s);
  ctx.moveTo(2 * s, 32 * s);
  ctx.lineTo(46 * s, 32 * s);
  ctx.stroke();
  // Frame
  ctx.fillStyle = hexToRgba(darken(color, 0.8), 0.6);
  ctx.fillRect(0, 0, 48 * s, 3 * s);
  ctx.fillRect(0, 45 * s, 48 * s, 3 * s);
}

function drawCrumbling(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = hexToRgb(0x33302e);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.strokeStyle = hexToRgba(0x333348, 0.2);
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0, 0, 48 * s, 48 * s);
  // Crack lines
  ctx.strokeStyle = hexToRgba(0x1a1a28, 0.7);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(8 * s, 6 * s);
  ctx.lineTo(18 * s, 20 * s);
  ctx.lineTo(14 * s, 34 * s);
  ctx.lineTo(22 * s, 44 * s);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(0x1a1a28, 0.6);
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(32 * s, 4 * s);
  ctx.lineTo(38 * s, 16 * s);
  ctx.lineTo(34 * s, 28 * s);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(0x1a1a28, 0.5);
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(18 * s, 20 * s);
  ctx.lineTo(30 * s, 22 * s);
  ctx.moveTo(26 * s, 36 * s);
  ctx.lineTo(40 * s, 42 * s);
  ctx.stroke();
  // Debris dots
  ctx.fillStyle = hexToRgba(0x1a1a28, 0.4);
  for (const [cx, cy, r] of [
    [16, 22, 1.5],
    [20, 18, 1],
    [36, 14, 1],
    [32, 26, 1.5],
    [14, 38, 1],
    [28, 40, 1],
  ]) {
    ctx.beginPath();
    ctx.arc(cx * s, cy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Hazard tile drawers ---

function drawVine(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = hexToRgb(0x2a3a1e);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.strokeStyle = hexToRgba(0x3a7a22, 0.8);
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(4 * s, 24 * s);
  ctx.lineTo(20 * s, 8 * s);
  ctx.lineTo(28 * s, 20 * s);
  ctx.lineTo(44 * s, 10 * s);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(0x3a7a22, 0.7);
  ctx.beginPath();
  ctx.moveTo(8 * s, 40 * s);
  ctx.lineTo(24 * s, 30 * s);
  ctx.lineTo(40 * s, 42 * s);
  ctx.stroke();
  ctx.fillStyle = hexToRgba(0x4a9a2a, 0.7);
  ctx.beginPath();
  ctx.arc(20 * s, 8 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(28 * s, 20 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(24 * s, 30 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0x5aaa3a, 0.5);
  ctx.beginPath();
  ctx.arc(12 * s, 16 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(36 * s, 36 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawQuicksand(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = hexToRgb(0x8b7a4a);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  const c = 24 * s;
  ctx.strokeStyle = hexToRgba(0x9a8a5a, 0.5);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(c, c, 16 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(0xa09060, 0.4);
  ctx.beginPath();
  ctx.arc(c, c, 10 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(0x7a6a3a, 0.5);
  ctx.beginPath();
  ctx.arc(c, c, 6 * s, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = hexToRgba(0x5a4a2a, 0.6);
  ctx.beginPath();
  ctx.arc(c, c, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0xb09a6a, 0.3);
  for (const [x, y] of [
    [10, 10],
    [38, 14],
    [14, 38],
    [40, 38],
  ]) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, 1 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = hexToRgba(0x6a5a3a, 0.4);
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0, 0, 48 * s, 48 * s);
}

function drawIce(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = hexToRgb(0x8ac8e8);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgba(0xc0e8ff, 0.5);
  ctx.fillRect(4 * s, 4 * s, 16 * s, 8 * s);
  ctx.fillStyle = hexToRgba(0xd0f0ff, 0.3);
  ctx.fillRect(28 * s, 24 * s, 12 * s, 6 * s);
  ctx.strokeStyle = hexToRgba(0x6ab0d0, 0.4);
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(10 * s, 20 * s);
  ctx.lineTo(24 * s, 24 * s);
  ctx.lineTo(38 * s, 18 * s);
  ctx.moveTo(24 * s, 24 * s);
  ctx.lineTo(20 * s, 40 * s);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(0xa0d8f0, 0.3);
  ctx.strokeRect(0, 0, 48 * s, 48 * s);
}

function drawLava(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = hexToRgb(0xcc3300);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgba(0x991a00, 0.6);
  ctx.beginPath();
  ctx.arc(12 * s, 16 * s, 8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(36 * s, 32 * s, 10 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0xff6600, 0.7);
  ctx.beginPath();
  ctx.arc(20 * s, 12 * s, 5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(34 * s, 20 * s, 4 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(16 * s, 36 * s, 6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0xffaa00, 0.5);
  ctx.beginPath();
  ctx.arc(20 * s, 12 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(16 * s, 36 * s, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(0xff4400, 0.8);
  ctx.lineWidth = 2 * s;
  ctx.strokeRect(1 * s, 1 * s, 46 * s, 46 * s);
}

function drawMud(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = hexToRgb(0x4a4030);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgba(0x3a3020, 0.6);
  ctx.beginPath();
  ctx.arc(14 * s, 14 * s, 8 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(34 * s, 30 * s, 10 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0x3a4a20, 0.3);
  ctx.beginPath();
  ctx.arc(24 * s, 24 * s, 14 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0x2a2018, 0.5);
  for (const [x, y] of [
    [18, 20],
    [30, 14],
    [22, 36],
  ]) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = hexToRgba(0x3a3020, 0.4);
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0, 0, 48 * s, 48 * s);
}

function drawSpikes(ctx: CanvasRenderingContext2D, s: number): void {
  ctx.fillStyle = hexToRgb(0x3a3a40);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgba(0x4a4a52, 0.6);
  ctx.fillRect(4 * s, 4 * s, 40 * s, 40 * s);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = (12 + c * 12) * s,
        cy = (12 + r * 12) * s;
      ctx.fillStyle = hexToRgba(0x2a2a30, 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexToRgba(0x888890, 0.4);
      ctx.beginPath();
      ctx.arc(cx, cy, 1 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawDarkRift(ctx: CanvasRenderingContext2D, s: number): void {
  const c = 24 * s;
  ctx.fillStyle = hexToRgb(0x0a0812);
  ctx.fillRect(0, 0, 48 * s, 48 * s);
  ctx.fillStyle = hexToRgba(0x2a1a4a, 0.6);
  ctx.beginPath();
  ctx.arc(c, c, 18 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0x3a2266, 0.5);
  ctx.beginPath();
  ctx.arc(c, c, 12 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0x5533aa, 0.4);
  ctx.beginPath();
  ctx.arc(c, c, 7 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexToRgba(0x000000, 0.8);
  ctx.beginPath();
  ctx.arc(c, c, 3 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexToRgba(0x7744cc, 0.5);
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.arc(c, c, 14 * s, 0, Math.PI, true);
  ctx.stroke();
  ctx.strokeStyle = hexToRgba(0x6633bb, 0.4);
  ctx.beginPath();
  ctx.arc(c, c, 14 * s, Math.PI, Math.PI * 2, true);
  ctx.stroke();
  ctx.fillStyle = hexToRgba(0x9966ff, 0.5);
  for (const [x, y] of [
    [10, 10],
    [38, 16],
    [14, 38],
    [36, 36],
  ]) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, 1 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Helper ---

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

// --- Public API ---

export type TileType =
  | 'wall'
  | 'destructible'
  | 'destructible_cracked'
  | 'teleporter_a'
  | 'teleporter_b'
  | 'conveyor_up'
  | 'conveyor_down'
  | 'conveyor_left'
  | 'conveyor_right'
  | 'exit'
  | 'goal'
  | 'switch_red'
  | 'switch_blue'
  | 'switch_green'
  | 'switch_yellow'
  | 'gate_red'
  | 'gate_blue'
  | 'gate_green'
  | 'gate_yellow'
  | 'crumbling'
  | 'vine'
  | 'quicksand'
  | 'ice'
  | 'lava'
  | 'mud'
  | 'spikes'
  | 'dark_rift';

const PUZZLE_COLORS: Record<string, number> = {
  red: 0xff4444,
  blue: 0x4488ff,
  green: 0x44cc66,
  yellow: 0xffcc44,
};

export function renderTileCanvas(
  type: TileType,
  size = 32,
  palette?: CampaignThemePalette,
): HTMLCanvasElement {
  const [canvas, ctx, s] = makeCanvas(size);
  const p = palette ?? CLASSIC;

  switch (type) {
    case 'wall':
      drawWall(ctx, s, p);
      break;
    case 'destructible':
      drawDestructible(ctx, s, p);
      break;
    case 'destructible_cracked':
      drawDestructibleCracked(ctx, s, p);
      break;
    case 'teleporter_a':
      drawTeleporter(ctx, s, 'a', p.floor);
      break;
    case 'teleporter_b':
      drawTeleporter(ctx, s, 'b', p.floor);
      break;
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
      drawConveyor(ctx, s, type.replace('conveyor_', ''), p.floor, p.floorAccent);
      break;
    case 'exit':
      drawExit(ctx, s, p.floor);
      break;
    case 'goal':
      drawGoal(ctx, s, p.floor);
      break;
    case 'switch_red':
    case 'switch_blue':
    case 'switch_green':
    case 'switch_yellow': {
      const color = type.replace('switch_', '');
      drawSwitch(ctx, s, PUZZLE_COLORS[color], p.floor);
      break;
    }
    case 'gate_red':
    case 'gate_blue':
    case 'gate_green':
    case 'gate_yellow': {
      const color = type.replace('gate_', '');
      drawGate(ctx, s, PUZZLE_COLORS[color]);
      break;
    }
    case 'crumbling':
      drawCrumbling(ctx, s);
      break;
    case 'vine':
      drawVine(ctx, s);
      break;
    case 'quicksand':
      drawQuicksand(ctx, s);
      break;
    case 'ice':
      drawIce(ctx, s);
      break;
    case 'lava':
      drawLava(ctx, s);
      break;
    case 'mud':
      drawMud(ctx, s);
      break;
    case 'spikes':
      drawSpikes(ctx, s);
      break;
    case 'dark_rift':
      drawDarkRift(ctx, s);
      break;
  }

  return canvas;
}
