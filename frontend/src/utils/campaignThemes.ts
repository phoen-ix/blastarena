import Phaser from 'phaser';
import {
  CampaignWorldTheme,
  CampaignThemePalette,
  CAMPAIGN_THEME_PALETTES,
} from '@blast-arena/shared';

const S = 48; // tile size

function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function lighten(color: number, factor: number): number {
  const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.floor((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

function generateThemedWall(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(palette.wall, 1);
  g.fillRect(0, 0, S, S);
  g.fillStyle(lighten(palette.wall, 1.3), 1);
  g.fillRect(0, 0, S, 2);
  g.fillRect(0, 0, 2, S);
  g.fillStyle(darken(palette.wall, 0.7), 1);
  g.fillRect(0, S - 2, S, 2);
  g.fillRect(S - 2, 0, 2, S);
  g.fillStyle(palette.wallAccent, 1);
  g.fillRect(4, 4, 18, 18);
  g.fillRect(26, 26, 18, 18);
  g.fillStyle(lighten(palette.wallAccent, 1.2), 0.3);
  g.fillRect(6, 6, 8, 8);
  g.fillRect(28, 28, 8, 8);
  g.generateTexture('themed_wall', S, S);
  g.destroy();
}

function generateThemedDestructible(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(palette.destructible, 1);
  g.fillRect(0, 0, S, S);
  g.fillStyle(palette.destructibleAccent, 1);
  g.fillRect(0, 0, S, 2);
  g.fillRect(0, 0, 2, S);
  g.fillStyle(darken(palette.destructible, 0.7), 1);
  g.fillRect(0, S - 2, S, 2);
  g.fillRect(S - 2, 0, 2, S);
  g.lineStyle(1, darken(palette.destructible, 0.6), 0.6);
  g.lineBetween(0, 16, S, 16);
  g.lineBetween(0, 32, S, 32);
  g.lineBetween(24, 0, 24, 16);
  g.lineBetween(12, 16, 12, 32);
  g.lineBetween(36, 16, 36, 32);
  g.lineBetween(24, 32, 24, S);
  g.lineStyle(1, darken(palette.destructible, 0.5), 0.3);
  g.lineBetween(8, 4, 14, 12);
  g.lineBetween(34, 20, 42, 28);
  g.generateTexture('themed_destructible', S, S);
  g.destroy();

  // Cracked variant
  const c = scene.make.graphics({ x: 0, y: 0 });
  c.fillStyle(darken(palette.destructible, 0.85), 1);
  c.fillRect(0, 0, S, S);
  c.fillStyle(palette.destructible, 1);
  c.fillRect(0, 0, S, 2);
  c.fillRect(0, 0, 2, S);
  c.fillStyle(darken(palette.destructible, 0.5), 1);
  c.fillRect(0, S - 2, S, 2);
  c.fillRect(S - 2, 0, 2, S);
  c.lineStyle(1, darken(palette.destructible, 0.5), 0.6);
  c.lineBetween(0, 16, S, 16);
  c.lineBetween(0, 32, S, 32);
  c.lineBetween(24, 0, 24, 16);
  c.lineBetween(12, 16, 12, 32);
  c.lineBetween(36, 16, 36, 32);
  c.lineBetween(24, 32, 24, S);
  c.lineStyle(2, darken(palette.destructible, 0.3), 0.7);
  c.lineBetween(6, 2, 20, 14);
  c.lineBetween(20, 14, 18, 28);
  c.lineBetween(30, 18, 44, 34);
  c.lineBetween(44, 34, 38, 46);
  c.lineBetween(10, 34, 24, 44);
  c.generateTexture('themed_destructible_cracked', S, S);
  c.destroy();
}

function generateThemedFloors(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  for (let v = 0; v < 4; v++) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    const shade = palette.floor + v * 0x010101;
    g.fillStyle(shade, 1);
    g.fillRect(0, 0, S, S);
    g.lineStyle(1, palette.floorAccent, 0.2);
    g.strokeRect(0, 0, S, S);
    if (v === 1 || v === 3) {
      g.fillStyle(palette.floorAccent, 0.15);
      g.fillCircle(12, 12, 1);
      g.fillCircle(36, 36, 1);
    }
    if (v === 2 || v === 3) {
      g.fillStyle(palette.floorAccent, 0.1);
      g.fillCircle(36, 12, 1);
      g.fillCircle(12, 36, 1);
    }
    g.generateTexture(`themed_floor_${v}`, S, S);
    g.destroy();
  }
}

function generateThemedTeleporters(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  for (const suffix of ['a', 'b']) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    g.fillStyle(palette.floor, 1);
    g.fillRect(0, 0, S, S);
    const padColor = suffix === 'a' ? 0x44aaff : 0xff8844;
    g.fillStyle(padColor, 0.15);
    g.fillCircle(24, 24, 20);
    g.fillStyle(padColor, 0.3);
    g.fillCircle(24, 24, 14);
    g.fillStyle(padColor, 0.5);
    g.fillCircle(24, 24, 8);
    g.lineStyle(2, padColor, 0.6);
    g.strokeCircle(24, 24, 18);
    g.lineStyle(1, padColor, 0.4);
    g.beginPath();
    g.arc(24, 24, 10, 0, Math.PI, true);
    g.strokePath();
    g.beginPath();
    g.arc(24, 24, 10, Math.PI, Math.PI * 2, true);
    g.strokePath();
    g.generateTexture(`themed_teleporter_${suffix}`, S, S);
    g.destroy();
  }
}

function generateThemedConveyors(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  const CONVEYOR_FRAMES = 4;
  const CONVEYOR_FPS = 8;
  const STRIPE_W = 8;
  const stripeColor = lighten(palette.floorAccent, 1.5);
  const conveyorDirs: Record<string, { horizontal: boolean; positive: boolean }> = {
    up: { horizontal: false, positive: false },
    down: { horizontal: false, positive: true },
    left: { horizontal: true, positive: false },
    right: { horizontal: true, positive: true },
  };
  const chevronAngles: Record<string, number> = {
    up: -Math.PI / 2,
    down: Math.PI / 2,
    left: Math.PI,
    right: 0,
  };
  for (const [dir, { horizontal, positive }] of Object.entries(conveyorDirs)) {
    for (let f = 0; f < CONVEYOR_FRAMES; f++) {
      const g = scene.make.graphics({ x: 0, y: 0 });
      g.fillStyle(palette.floor, 1);
      g.fillRect(0, 0, S, S);
      g.fillStyle(palette.floorAccent, 0.5);
      g.fillRect(2, 2, 44, 44);
      const cycle = STRIPE_W * 2;
      const rawOffset = (f / CONVEYOR_FRAMES) * cycle;
      const offset = positive ? rawOffset : -rawOffset;
      g.fillStyle(stripeColor, 0.35);
      if (horizontal) {
        for (let sx = -cycle; sx < S + cycle; sx += cycle) {
          const x0 = sx + (((offset % cycle) + cycle) % cycle);
          g.fillRect(x0, 0, STRIPE_W, S);
        }
      } else {
        for (let sy = -cycle; sy < S + cycle; sy += cycle) {
          const y0 = sy + (((offset % cycle) + cycle) % cycle);
          g.fillRect(0, y0, S, STRIPE_W);
        }
      }
      const angle = chevronAngles[dir];
      const ax = Math.cos(angle) * 5;
      const ay = Math.sin(angle) * 5;
      const px = Math.cos(angle + Math.PI / 2);
      const py = Math.sin(angle + Math.PI / 2);
      g.lineStyle(2, stripeColor, 0.5);
      g.beginPath();
      g.moveTo(24 + ax, 24 + ay);
      g.lineTo(24 - ax * 0.4 + px * 4, 24 - ay * 0.4 + py * 4);
      g.moveTo(24 + ax, 24 + ay);
      g.lineTo(24 - ax * 0.4 - px * 4, 24 - ay * 0.4 - py * 4);
      g.strokePath();
      const key = f === 0 ? `themed_conveyor_${dir}` : `themed_conveyor_${dir}_${f}`;
      g.generateTexture(key, S, S);
      g.destroy();
    }
    scene.anims.create({
      key: `themed_conveyor_${dir}_anim`,
      frames: Array.from({ length: CONVEYOR_FRAMES }, (_, i) => ({
        key: i === 0 ? `themed_conveyor_${dir}` : `themed_conveyor_${dir}_${i}`,
      })),
      frameRate: CONVEYOR_FPS,
      repeat: -1,
    });
  }
}

function generateThemedSwitches(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  const puzzleColors: Record<string, number> = {
    red: 0xff4444,
    blue: 0x4488ff,
    green: 0x44cc66,
    yellow: 0xffcc44,
  };
  for (const [colorName, colorVal] of Object.entries(puzzleColors)) {
    const brighterColor = Phaser.Display.Color.IntegerToColor(colorVal).lighten(30).color;
    const darkerColor = Phaser.Display.Color.IntegerToColor(colorVal).darken(30).color;

    // Inactive switch
    const sw = scene.make.graphics({ x: 0, y: 0 });
    sw.fillStyle(palette.floor, 1);
    sw.fillRect(0, 0, S, S);
    sw.lineStyle(1, palette.floorAccent, 0.2);
    sw.strokeRect(0, 0, S, S);
    sw.fillStyle(colorVal, 0.5);
    sw.fillCircle(24, 24, 16);
    sw.lineStyle(2, colorVal, 0.6);
    sw.strokeCircle(24, 24, 16);
    sw.fillStyle(brighterColor, 0.8);
    sw.fillCircle(24, 24, 6);
    sw.fillStyle(0xffffff, 0.2);
    sw.fillCircle(22, 22, 3);
    sw.generateTexture(`themed_switch_${colorName}`, S, S);
    sw.destroy();

    // Active switch
    const swAct = scene.make.graphics({ x: 0, y: 0 });
    swAct.fillStyle(palette.floor, 1);
    swAct.fillRect(0, 0, S, S);
    swAct.lineStyle(1, palette.floorAccent, 0.2);
    swAct.strokeRect(0, 0, S, S);
    swAct.fillStyle(darkerColor, 0.5);
    swAct.fillCircle(24, 24, 16);
    swAct.fillStyle(colorVal, 0.2);
    swAct.fillCircle(24, 24, 20);
    swAct.lineStyle(2, colorVal, 0.8);
    swAct.strokeCircle(24, 24, 16);
    swAct.fillStyle(brighterColor, 1);
    swAct.fillCircle(24, 24, 8);
    swAct.fillStyle(0xffffff, 0.35);
    swAct.fillCircle(22, 21, 4);
    swAct.generateTexture(`themed_switch_${colorName}_active`, S, S);
    swAct.destroy();
  }
}

function generateThemedGates(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  const puzzleColors: Record<string, number> = {
    red: 0xff4444,
    blue: 0x4488ff,
    green: 0x44cc66,
    yellow: 0xffcc44,
  };
  for (const [colorName, colorVal] of Object.entries(puzzleColors)) {
    const darkerGateColor = Phaser.Display.Color.IntegerToColor(colorVal).darken(20).color;

    // Closed gate
    const g = scene.make.graphics({ x: 0, y: 0 });
    g.fillStyle(darken(palette.floor, 0.9), 1);
    g.fillRect(0, 0, S, S);
    g.lineStyle(4, colorVal, 0.8);
    for (let i = 0; i < 5; i++) {
      const bx = 6 + i * 9;
      g.lineBetween(bx, 2, bx, 46);
    }
    g.lineStyle(3, darkerGateColor, 0.7);
    g.lineBetween(2, 16, 46, 16);
    g.lineBetween(2, 32, 46, 32);
    g.fillStyle(darkerGateColor, 0.6);
    g.fillRect(0, 0, S, 3);
    g.fillRect(0, 45, S, 3);
    g.generateTexture(`themed_gate_${colorName}`, S, S);
    g.destroy();

    // Open gate
    const o = scene.make.graphics({ x: 0, y: 0 });
    o.fillStyle(palette.floor, 1);
    o.fillRect(0, 0, S, S);
    o.lineStyle(1, palette.floorAccent, 0.2);
    o.strokeRect(0, 0, S, S);
    o.lineStyle(3, colorVal, 0.35);
    for (let i = 0; i < 5; i++) {
      const bx = 6 + i * 9;
      o.lineBetween(bx, 0, bx, 6);
    }
    o.fillStyle(colorVal, 0.2);
    o.fillRect(0, 0, S, 2);
    o.generateTexture(`themed_gate_${colorName}_open`, S, S);
    o.destroy();
  }
}

function generateThemedCrumbling(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(darken(palette.floor, 0.9), 1);
  g.fillRect(0, 0, S, S);
  g.lineStyle(1, palette.floorAccent, 0.2);
  g.strokeRect(0, 0, S, S);
  // Crack lines
  g.lineStyle(1, darken(palette.floor, 0.6), 0.6);
  g.lineBetween(8, 8, 24, 20);
  g.lineBetween(24, 20, 40, 16);
  g.lineBetween(24, 20, 20, 38);
  g.lineBetween(20, 38, 36, 42);
  // Missing chunks
  g.fillStyle(darken(palette.floor, 0.5), 0.4);
  g.fillCircle(10, 36, 4);
  g.fillCircle(38, 10, 3);
  g.fillCircle(30, 30, 3);
  g.generateTexture('themed_crumbling', S, S);
  g.destroy();
}

function generateThemedExitGoal(scene: Phaser.Scene, palette: CampaignThemePalette): void {
  // Exit tile (trapdoor)
  const e = scene.make.graphics({ x: 0, y: 0 });
  e.fillStyle(palette.floor, 1);
  e.fillRect(0, 0, S, S);
  e.fillStyle(0x4a3a2e, 1);
  e.fillRoundedRect(6, 6, 36, 36, 4);
  e.fillStyle(0x3a2a1e, 1);
  e.fillRoundedRect(8, 8, 32, 32, 3);
  e.fillStyle(0xccaa44, 1);
  e.fillCircle(30, 24, 3);
  e.fillStyle(0x44ff44, 0.7);
  e.fillTriangle(24, 34, 18, 26, 30, 26);
  e.generateTexture('themed_exit', S, S);
  e.destroy();

  // Goal tile (star marker)
  const gl = scene.make.graphics({ x: 0, y: 0 });
  gl.fillStyle(palette.floor, 1);
  gl.fillRect(0, 0, S, S);
  gl.fillStyle(0xffcc00, 0.2);
  gl.fillCircle(24, 24, 18);
  gl.fillStyle(0xffcc00, 0.4);
  gl.fillCircle(24, 24, 12);
  gl.fillStyle(0xffdd44, 0.9);
  gl.fillTriangle(24, 12, 27, 20, 35, 20);
  gl.fillTriangle(24, 12, 21, 20, 13, 20);
  gl.fillTriangle(24, 36, 27, 28, 35, 28);
  gl.fillTriangle(24, 36, 21, 28, 13, 28);
  gl.fillTriangle(13, 20, 17, 24, 13, 28);
  gl.fillTriangle(35, 20, 31, 24, 35, 28);
  gl.generateTexture('themed_goal', S, S);
  gl.destroy();
}

export function generateThemedTileTextures(scene: Phaser.Scene, theme: CampaignWorldTheme): void {
  const palette = CAMPAIGN_THEME_PALETTES[theme];
  if (!palette) return;
  generateThemedWall(scene, palette);
  generateThemedDestructible(scene, palette);
  generateThemedFloors(scene, palette);
  generateThemedTeleporters(scene, palette);
  generateThemedConveyors(scene, palette);
  generateThemedSwitches(scene, palette);
  generateThemedGates(scene, palette);
  generateThemedCrumbling(scene, palette);
  generateThemedExitGoal(scene, palette);
}

export function generateHazardTileTextures(scene: Phaser.Scene): void {
  // Vine: green tendrils over earthy floor
  const vineGfx = scene.make.graphics({ x: 0, y: 0 });
  vineGfx.fillStyle(0x2a3a1e, 1);
  vineGfx.fillRect(0, 0, S, S);
  vineGfx.lineStyle(1, 0x2a3a1e, 0.3);
  vineGfx.strokeRect(0, 0, S, S);
  // Vine tendrils
  vineGfx.lineStyle(3, 0x3a7a22, 0.8);
  vineGfx.lineBetween(4, 24, 20, 8);
  vineGfx.lineBetween(20, 8, 28, 20);
  vineGfx.lineBetween(28, 20, 44, 10);
  vineGfx.lineStyle(3, 0x3a7a22, 0.7);
  vineGfx.lineBetween(8, 40, 24, 30);
  vineGfx.lineBetween(24, 30, 40, 42);
  // Leaves
  vineGfx.fillStyle(0x4a9a2a, 0.7);
  vineGfx.fillCircle(20, 8, 4);
  vineGfx.fillCircle(28, 20, 3);
  vineGfx.fillCircle(24, 30, 4);
  vineGfx.fillStyle(0x5aaa3a, 0.5);
  vineGfx.fillCircle(12, 16, 3);
  vineGfx.fillCircle(36, 36, 3);
  vineGfx.generateTexture('vine', S, S);
  vineGfx.destroy();

  // Quicksand: swirling sand pattern
  const qsGfx = scene.make.graphics({ x: 0, y: 0 });
  qsGfx.fillStyle(0x8b7a4a, 1);
  qsGfx.fillRect(0, 0, S, S);
  // Swirl rings
  qsGfx.lineStyle(2, 0x9a8a5a, 0.5);
  qsGfx.strokeCircle(24, 24, 16);
  qsGfx.lineStyle(2, 0xa09060, 0.4);
  qsGfx.strokeCircle(24, 24, 10);
  qsGfx.lineStyle(2, 0x7a6a3a, 0.5);
  qsGfx.strokeCircle(24, 24, 6);
  // Center dark spot
  qsGfx.fillStyle(0x5a4a2a, 0.6);
  qsGfx.fillCircle(24, 24, 4);
  // Sand grains
  qsGfx.fillStyle(0xb09a6a, 0.3);
  qsGfx.fillCircle(10, 10, 1);
  qsGfx.fillCircle(38, 14, 1);
  qsGfx.fillCircle(14, 38, 1);
  qsGfx.fillCircle(40, 38, 1);
  // Warning border
  qsGfx.lineStyle(1, 0x6a5a3a, 0.4);
  qsGfx.strokeRect(0, 0, S, S);
  qsGfx.generateTexture('quicksand', S, S);
  qsGfx.destroy();

  // Ice: blue-white translucent surface
  const iceGfx = scene.make.graphics({ x: 0, y: 0 });
  iceGfx.fillStyle(0x8ac8e8, 1);
  iceGfx.fillRect(0, 0, S, S);
  // Shine highlights
  iceGfx.fillStyle(0xc0e8ff, 0.5);
  iceGfx.fillRect(4, 4, 16, 8);
  iceGfx.fillStyle(0xd0f0ff, 0.3);
  iceGfx.fillRect(28, 24, 12, 6);
  // Crack lines
  iceGfx.lineStyle(1, 0x6ab0d0, 0.4);
  iceGfx.lineBetween(10, 20, 24, 24);
  iceGfx.lineBetween(24, 24, 38, 18);
  iceGfx.lineBetween(24, 24, 20, 40);
  // Border shimmer
  iceGfx.lineStyle(1, 0xa0d8f0, 0.3);
  iceGfx.strokeRect(0, 0, S, S);
  iceGfx.generateTexture('ice', S, S);
  iceGfx.destroy();

  // Lava: red-orange bubbling surface (impassable)
  const lavaGfx = scene.make.graphics({ x: 0, y: 0 });
  lavaGfx.fillStyle(0xcc3300, 1);
  lavaGfx.fillRect(0, 0, S, S);
  // Darker undercurrents
  lavaGfx.fillStyle(0x991a00, 0.6);
  lavaGfx.fillCircle(12, 16, 8);
  lavaGfx.fillCircle(36, 32, 10);
  // Bright bubbles
  lavaGfx.fillStyle(0xff6600, 0.7);
  lavaGfx.fillCircle(20, 12, 5);
  lavaGfx.fillCircle(34, 20, 4);
  lavaGfx.fillCircle(16, 36, 6);
  // Hot spots
  lavaGfx.fillStyle(0xffaa00, 0.5);
  lavaGfx.fillCircle(20, 12, 3);
  lavaGfx.fillCircle(16, 36, 3);
  // Glow rim
  lavaGfx.lineStyle(2, 0xff4400, 0.8);
  lavaGfx.strokeRect(1, 1, S - 2, S - 2);
  lavaGfx.generateTexture('lava', S, S);
  lavaGfx.destroy();

  // Mud: brown-green murky surface
  const mudGfx = scene.make.graphics({ x: 0, y: 0 });
  mudGfx.fillStyle(0x4a4030, 1);
  mudGfx.fillRect(0, 0, S, S);
  // Darker muddy patches
  mudGfx.fillStyle(0x3a3020, 0.6);
  mudGfx.fillCircle(14, 14, 8);
  mudGfx.fillCircle(34, 30, 10);
  // Murky green tint
  mudGfx.fillStyle(0x3a4a20, 0.3);
  mudGfx.fillCircle(24, 24, 14);
  // Bubble holes
  mudGfx.fillStyle(0x2a2018, 0.5);
  mudGfx.fillCircle(18, 20, 2);
  mudGfx.fillCircle(30, 14, 2);
  mudGfx.fillCircle(22, 36, 2);
  // Border
  mudGfx.lineStyle(1, 0x3a3020, 0.4);
  mudGfx.strokeRect(0, 0, S, S);
  mudGfx.generateTexture('mud', S, S);
  mudGfx.destroy();

  // Spikes: retracted/safe state (gray metallic)
  const spkGfx = scene.make.graphics({ x: 0, y: 0 });
  spkGfx.fillStyle(0x3a3a40, 1);
  spkGfx.fillRect(0, 0, S, S);
  // Metal plate base
  spkGfx.fillStyle(0x4a4a52, 0.6);
  spkGfx.fillRect(4, 4, 40, 40);
  // Spike holes (3x3 grid)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = 12 + c * 12;
      const cy = 12 + r * 12;
      spkGfx.fillStyle(0x2a2a30, 0.8);
      spkGfx.fillCircle(cx, cy, 3);
      // Small spike tip barely visible
      spkGfx.fillStyle(0x888890, 0.4);
      spkGfx.fillCircle(cx, cy, 1);
    }
  }
  spkGfx.generateTexture('spikes', S, S);
  spkGfx.destroy();

  // Spikes active: extended/lethal state (red metallic)
  const spkActGfx = scene.make.graphics({ x: 0, y: 0 });
  spkActGfx.fillStyle(0x3a2020, 1);
  spkActGfx.fillRect(0, 0, S, S);
  spkActGfx.fillStyle(0x4a2a2a, 0.6);
  spkActGfx.fillRect(4, 4, 40, 40);
  // Extended spike triangles (3x3 grid)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cx = 12 + c * 12;
      const cy = 12 + r * 12;
      // Spike triangle
      spkActGfx.fillStyle(0xaaaaaa, 1);
      spkActGfx.fillTriangle(cx, cy - 5, cx - 3, cy + 3, cx + 3, cy + 3);
      // Tip highlight
      spkActGfx.fillStyle(0xdddddd, 0.8);
      spkActGfx.fillTriangle(cx, cy - 5, cx - 1, cy, cx + 1, cy);
    }
  }
  // Danger border
  spkActGfx.lineStyle(2, 0xcc3333, 0.7);
  spkActGfx.strokeRect(1, 1, S - 2, S - 2);
  spkActGfx.generateTexture('spikes_active', S, S);
  spkActGfx.destroy();

  // Dark Rift: purple-black swirling void
  const riftGfx = scene.make.graphics({ x: 0, y: 0 });
  riftGfx.fillStyle(0x0a0812, 1);
  riftGfx.fillRect(0, 0, S, S);
  // Void swirl
  riftGfx.fillStyle(0x2a1a4a, 0.6);
  riftGfx.fillCircle(24, 24, 18);
  riftGfx.fillStyle(0x3a2266, 0.5);
  riftGfx.fillCircle(24, 24, 12);
  riftGfx.fillStyle(0x5533aa, 0.4);
  riftGfx.fillCircle(24, 24, 7);
  // Center void
  riftGfx.fillStyle(0x000000, 0.8);
  riftGfx.fillCircle(24, 24, 3);
  // Spiral lines
  riftGfx.lineStyle(1, 0x7744cc, 0.5);
  riftGfx.beginPath();
  riftGfx.arc(24, 24, 14, 0, Math.PI, true);
  riftGfx.strokePath();
  riftGfx.lineStyle(1, 0x6633bb, 0.4);
  riftGfx.beginPath();
  riftGfx.arc(24, 24, 14, Math.PI, Math.PI * 2, true);
  riftGfx.strokePath();
  // Particle sparkles
  riftGfx.fillStyle(0x9966ff, 0.5);
  riftGfx.fillCircle(10, 10, 1);
  riftGfx.fillCircle(38, 16, 1);
  riftGfx.fillCircle(14, 38, 1);
  riftGfx.fillCircle(36, 36, 1);
  riftGfx.generateTexture('dark_rift', S, S);
  riftGfx.destroy();
}
