import type { TileType } from '@blast-arena/shared';
import type { SpecialOpts } from '../../painters/types';
import { circle, glow, poly, rgba, rng, rr, shade, star } from './shim';
import { additive, clipTile, neonStroke, polyline } from './draw';
import { pal, TAU } from './palette';

const PUZZLE: Record<string, string> = {
  red: '#ff4a5a',
  blue: '#4a8bff',
  green: '#3ee07a',
  yellow: '#ffd23a',
};

const ROT: Record<string, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

/** Frames baked per special tile; static tiles use one. */
export function specialFrames(tile: TileType): number {
  switch (tile) {
    case 'teleporter_a':
    case 'teleporter_b':
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
    case 'lava':
    case 'quicksand':
    case 'ice':
    case 'mud':
    case 'dark_rift':
      return 8;
    case 'exit':
    case 'goal':
    case 'vine':
      return 6;
    case 'gate_red':
    case 'gate_blue':
    case 'gate_green':
    case 'gate_yellow':
      return 4;
    default:
      return 1;
  }
}

/** Seconds per loop of an animated special tile. */
export function specialLoopSeconds(tile: TileType): number {
  switch (tile) {
    case 'teleporter_a':
    case 'teleporter_b':
      return 1.2;
    case 'conveyor_up':
    case 'conveyor_down':
    case 'conveyor_left':
    case 'conveyor_right':
      return 0.53;
    case 'lava':
      return 4;
    case 'quicksand':
      return 3;
    case 'ice':
      return 2.4;
    case 'mud':
      return 1.6;
    case 'dark_rift':
      return 1.4;
    case 'exit':
      return 1.2;
    case 'goal':
      return 1.5;
    case 'vine':
      return 2.4;
    default:
      return 0.8;
  }
}

export function special(g: CanvasRenderingContext2D, o: SpecialOpts): void {
  const t = o.tile as string;
  const ph = ((o.phase % 1) + 1) % 1;
  g.save();
  if (t === 'teleporter_a' || t === 'teleporter_b') teleporter(g, t === 'teleporter_b', ph);
  else if (t.startsWith('conveyor_')) conveyor(g, t.slice(9), ph, pal(o.world).edge);
  else if (t === 'exit') exitTile(g, ph);
  else if (t === 'goal') goalTile(g, ph);
  else if (t.startsWith('switch_')) {
    const active = t.endsWith('_active');
    const color = PUZZLE[t.slice(7).replace('_active', '')] ?? PUZZLE.red;
    switchTile(g, color, active);
  } else if (t.startsWith('gate_')) {
    const open = t.endsWith('_open');
    const color = PUZZLE[t.slice(5).replace('_open', '')] ?? PUZZLE.red;
    if (open) gateOpen(g, color);
    else gateClosed(g, color, ph);
  } else if (t === 'crumbling') crumbling(g, pal(o.world).seamGlow);
  else if (t === 'pit') pit(g, pal(o.world).seam);
  else if (t === 'vine') vine(g, ph);
  else if (t === 'quicksand') quicksand(g, ph);
  else if (t === 'ice') ice(g, ph);
  else if (t === 'lava') lava(g, ph);
  else if (t === 'mud') mud(g, ph);
  else if (t === 'spikes') spikes(g, false);
  else if (t === 'spikes_active') spikes(g, true);
  else if (t === 'dark_rift') rift(g, ph);
  g.restore();
}

function teleporter(g: CanvasRenderingContext2D, b: boolean, ph: number): void {
  const c = b ? '#ff9a3c' : '#3fd2ff';
  circle(g, 24, 24, 19.5);
  g.fillStyle = 'rgba(5,7,14,0.92)';
  g.fill();
  g.strokeStyle = rgba(c, 0.4);
  g.lineWidth = 2;
  g.stroke();
  const gr = g.createRadialGradient(24, 24, 0, 24, 24, 16);
  gr.addColorStop(0, rgba(c, 0.32));
  gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr;
  circle(g, 24, 24, 16);
  g.fill();
  g.save();
  clipTile(g);
  g.translate(24, 24);
  additive(g, () => {
    g.setLineDash([5, 4]);
    g.lineDashOffset = -ph * 36;
    g.strokeStyle = rgba(c, 0.85);
    g.lineWidth = 1.8;
    circle(g, 0, 0, 15.5);
    g.stroke();
    g.setLineDash([]);
    g.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const a = -ph * TAU + i * Math.PI;
      g.beginPath();
      g.arc(0, 0, 10, a, a + 1.6);
      g.strokeStyle = rgba(c, 0.75);
      g.lineWidth = 1.6;
      g.stroke();
    }
    glow(g, 0, 0, 12, c, 0.45 + 0.2 * Math.sin(ph * TAU * 2));
    for (let i = 0; i < 3; i++) {
      const f = (ph * 2 + i / 3) % 1;
      g.fillStyle = rgba(c, 1 - f);
      circle(g, Math.sin(i * 2.1) * 7, 6 - f * 26, 1.1);
      g.fill();
    }
  });
  g.restore();
}

function conveyor(g: CanvasRenderingContext2D, dir: string, ph: number, edge: string): void {
  g.save();
  clipTile(g);
  g.translate(24, 24);
  g.rotate(ROT[dir] ?? 0);
  g.fillStyle = '#0b0f1d';
  g.fillRect(-24, -24, 48, 48);
  g.fillStyle = '#1b2340';
  g.fillRect(-24, -22, 48, 4);
  g.fillRect(-24, 18, 48, 4);
  g.fillStyle = rgba(edge, 0.4);
  g.fillRect(-24, -18.5, 48, 0.9);
  g.fillRect(-24, 17.6, 48, 0.9);
  additive(g, () => {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const off = ph * 16;
    for (let i = -2; i < 3; i++) {
      const px = off + i * 16;
      polyline(g, [px - 4, -8, px + 3, 0, px - 4, 8]);
      neonStroke(g, edge, 2.2, 0.85);
    }
  });
  g.restore();
}

function exitTile(g: CanvasRenderingContext2D, ph: number): void {
  const c = '#3dff9a';
  g.fillStyle = 'rgba(4,10,8,0.9)';
  rr(g, 6, 6, 36, 36, 5);
  g.fill();
  g.fillStyle = '#0d1a15';
  rr(g, 9, 9, 30, 30, 4);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.6)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(24, 9);
  g.lineTo(24, 39);
  g.stroke();
  rr(g, 6.5, 6.5, 35, 35, 5);
  neonStroke(g, c, 1.2, 0.85);
  additive(g, () => {
    for (let i = 0; i < 2; i++) {
      const f = (ph + i * 0.5) % 1;
      const y = 15 + f * 14;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      polyline(g, [17, y, 24, y + 6, 31, y]);
      neonStroke(g, c, 1.8, Math.sin(f * Math.PI));
    }
  });
}

function goalTile(g: CanvasRenderingContext2D, ph: number): void {
  const c = '#ffd23a';
  g.save();
  g.translate(24, 24);
  additive(g, () => {
    glow(g, 0, 0, 20, c, 0.32 + 0.12 * Math.sin(ph * TAU));
    g.rotate((ph * TAU) / 8);
    g.strokeStyle = rgba(c, 0.35);
    g.lineWidth = 1.2;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.moveTo(Math.cos(a) * 13, Math.sin(a) * 13);
      g.lineTo(Math.cos(a) * 20, Math.sin(a) * 20);
    }
    g.stroke();
  });
  g.restore();
  star(g, 24, 24, 5, 11, 4.6);
  g.fillStyle = 'rgba(30,20,4,0.9)';
  g.fill();
  g.lineJoin = 'round';
  neonStroke(g, c, 1.5, 0.95);
  g.fillStyle = '#fff6c8';
  circle(g, 24, 24, 1.6);
  g.fill();
}

function switchTile(g: CanvasRenderingContext2D, c: string, active: boolean): void {
  circle(g, 24, 24, 16);
  g.fillStyle = active ? shade(c, -0.7) : 'rgba(8,10,18,0.92)';
  g.fill();
  if (active) additive(g, () => glow(g, 24, 24, 21, c, 0.4));
  circle(g, 24, 24, 15);
  neonStroke(g, c, active ? 1.8 : 1.2, active ? 1 : 0.55);
  circle(g, 24, 24, 9.5);
  g.strokeStyle = rgba(c, active ? 0.6 : 0.25);
  g.lineWidth = 1;
  g.stroke();
  circle(g, 24, active ? 24.6 : 24, active ? 5.5 : 4.2);
  g.fillStyle = active ? shade(c, 0.45) : rgba(c, 0.45);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  circle(g, 22.6, active ? 23 : 22.4, active ? 1.6 : 1.1);
  g.fill();
}

function gateEmitters(g: CanvasRenderingContext2D, c: string, lit: number): void {
  for (const y of [0, 42]) {
    g.fillStyle = '#151a2a';
    rr(g, 1.5, y + 0.5, 45, 5.5, 2);
    g.fill();
    g.strokeStyle = '#2b3350';
    g.lineWidth = 1;
    g.stroke();
    for (let i = 0; i < 5; i++) {
      g.fillStyle = rgba(c, lit);
      circle(g, 6 + i * 9, y + 3.2, 1.2);
      g.fill();
    }
  }
}

function gateClosed(g: CanvasRenderingContext2D, c: string, ph: number): void {
  g.fillStyle = 'rgba(6,8,16,0.85)';
  g.fillRect(1, 1, 46, 46);
  additive(g, () => {
    for (let i = 0; i < 5; i++) {
      const x = 6 + i * 9;
      const a = 0.65 + 0.35 * Math.sin(ph * TAU + i * 1.3);
      g.fillStyle = rgba(c, 0.18 * a);
      g.fillRect(x - 3.5, 5, 7, 38);
      g.fillStyle = rgba(c, 0.85 * a);
      g.fillRect(x - 1, 5, 2, 38);
      g.fillStyle = rgba('#ffffff', 0.5 * a);
      g.fillRect(x - 0.4, 5, 0.8, 38);
    }
  });
  gateEmitters(g, c, 1);
  rr(g, 1, 1, 46, 46, 4);
  g.strokeStyle = rgba(c, 0.35);
  g.lineWidth = 1;
  g.stroke();
}

function gateOpen(g: CanvasRenderingContext2D, c: string): void {
  g.save();
  g.globalAlpha = 0.8;
  gateEmitters(g, c, 0.35);
  g.restore();
  g.strokeStyle = rgba(c, 0.18);
  g.setLineDash([3, 4]);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(3, 24);
  g.lineTo(45, 24);
  g.stroke();
  g.setLineDash([]);
}

function crumbling(g: CanvasRenderingContext2D, glowC: string): void {
  g.fillStyle = 'rgba(0,0,0,0.38)';
  rr(g, 5, 5, 38, 38, 4);
  g.fill();
  const cracks = [
    [8, 6, 18, 20, 14, 34, 22, 44],
    [32, 4, 38, 16, 34, 28],
    [18, 20, 30, 22, 36, 34, 42, 40],
  ];
  for (const c of cracks) {
    polyline(g, c);
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 2.6;
    g.stroke();
    polyline(g, c);
    g.strokeStyle = rgba(glowC, 0.35);
    g.lineWidth = 0.8;
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.6)';
  for (const [x, y, s] of [
    [16, 22, 2],
    [33, 27, 1.6],
    [13, 37, 1.4],
  ]) {
    poly(g, [x - s, y, x, y - s, x + s, y, x, y + s]);
    g.fill();
  }
}

function pit(g: CanvasRenderingContext2D, seam: string): void {
  g.fillStyle = '#020205';
  g.fillRect(0, 0, 48, 48);
  const gr = g.createRadialGradient(24, 24, 4, 24, 24, 30);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(1, rgba(seam, 0.55));
  g.fillStyle = gr;
  rr(g, 2, 2, 44, 44, 5);
  g.fill();
  g.strokeStyle = rgba(seam, 0.9);
  g.lineWidth = 1.4;
  rr(g, 2.5, 2.5, 43, 43, 5);
  g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(3, 3, 42, 6);
}

function vine(g: CanvasRenderingContext2D, ph: number): void {
  const draw = (glowLayer: boolean) => {
    if (!glowLayer) {
      g.fillStyle = '#08160c';
      g.fillRect(0, 0, 48, 48);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      circle(g, 34, 14, 10);
      g.fill();
    }
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(2, 26);
    g.bezierCurveTo(12, 6, 24, 30, 46, 10);
    g.moveTo(6, 44);
    g.bezierCurveTo(18, 30, 30, 46, 44, 34);
    g.strokeStyle = glowLayer ? '#7dffb0' : '#1e6b34';
    g.lineWidth = glowLayer ? 1 : 3.2;
    g.stroke();
    for (const [lx, ly, a] of [
      [14, 15, -0.6],
      [30, 21, 0.5],
      [22, 37, -0.4],
      [38, 36, 0.7],
    ]) {
      g.save();
      g.translate(lx, ly);
      g.rotate(a);
      g.beginPath();
      g.ellipse(0, 0, 4.2, 2, 0, 0, TAU);
      g.fillStyle = glowLayer ? 'rgba(125,255,176,0.6)' : '#2a8a45';
      g.fill();
      g.restore();
    }
  };
  draw(false);
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.25 + 0.25 * Math.sin(ph * TAU);
  draw(true);
  g.restore();
}

function quicksand(g: CanvasRenderingContext2D, ph: number): void {
  const gr = g.createRadialGradient(24, 24, 2, 24, 24, 30);
  gr.addColorStop(0, '#6b5330');
  gr.addColorStop(1, '#30240f');
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  const r = rng(9);
  g.fillStyle = 'rgba(240,200,130,0.25)';
  for (let i = 0; i < 14; i++) g.fillRect(r() * 46, r() * 46, 1.2, 1.2);
  g.save();
  clipTile(g);
  g.translate(24, 24);
  g.strokeStyle = 'rgba(232,192,122,0.38)';
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  const speeds = [2, 1, 1];
  [6, 11, 16].forEach((rad, i) => {
    const a = ph * TAU * speeds[i] + i;
    g.beginPath();
    g.arc(0, 0, rad, a, a + 2.2);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, rad, a + Math.PI, a + Math.PI + 1.4);
    g.stroke();
  });
  g.fillStyle = '#1e160b';
  circle(g, 0, 0, 3.5);
  g.fill();
  g.restore();
}

function ice(g: CanvasRenderingContext2D, ph: number): void {
  const gr = g.createLinearGradient(0, 0, 48, 48);
  gr.addColorStop(0, '#3f8fb6');
  gr.addColorStop(1, '#17486b');
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  poly(g, [0, 0, 30, 0, 0, 22]);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  poly(g, [48, 48, 20, 48, 48, 22]);
  g.fill();
  g.strokeStyle = 'rgba(230,250,255,0.5)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(8, 18);
  g.lineTo(22, 24);
  g.lineTo(38, 16);
  g.moveTo(22, 24);
  g.lineTo(18, 40);
  g.stroke();
  g.strokeStyle = 'rgba(160,240,255,0.5)';
  g.lineWidth = 1;
  g.strokeRect(1, 1, 46, 46);
  g.save();
  clipTile(g);
  additive(g, () => {
    const xx = -20 + ph * 88;
    g.fillStyle = `rgba(255,255,255,${(0.32 * Math.sin(ph * Math.PI)).toFixed(3)})`;
    poly(g, [xx, 0, xx + 8, 0, xx - 16, 48, xx - 24, 48]);
    g.fill();
  });
  g.restore();
}

function lava(g: CanvasRenderingContext2D, ph: number): void {
  const gr = g.createLinearGradient(0, 0, 48, 48);
  gr.addColorStop(0, '#ff8a2a');
  gr.addColorStop(1, '#c21e08');
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  g.save();
  clipTile(g);
  additive(g, () => {
    for (let i = 0; i < 2; i++) {
      const px = ((ph * 74 + i * 37) % 74) - 13;
      const py = 14 + i * 18 + Math.sin(ph * TAU + i) * 4;
      glow(g, px, py, 17, '#ffd27a', 0.5);
      glow(g, px + 74, py, 17, '#ffd27a', 0.5);
    }
  });
  g.restore();
  const r = rng(36);
  for (let i = 0; i < 4; i++) {
    const pcx = 8 + (i % 2) * 24 + r() * 10;
    const pcy = 8 + Math.floor(i / 2) * 24 + r() * 10;
    const pts: number[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + r() * 0.4;
      const rad = 5 + r() * 5;
      pts.push(pcx + Math.cos(a) * rad, pcy + Math.sin(a) * rad);
    }
    poly(g, pts);
    g.fillStyle = '#2a0f0a';
    g.fill();
    g.strokeStyle = 'rgba(255,120,40,0.4)';
    g.lineWidth = 3;
    g.stroke();
    g.strokeStyle = 'rgba(255,190,90,0.75)';
    g.lineWidth = 0.9;
    g.stroke();
  }
}

function mud(g: CanvasRenderingContext2D, ph: number): void {
  g.fillStyle = '#2b2118';
  g.fillRect(0, 0, 48, 48);
  g.fillStyle = '#211910';
  circle(g, 14, 14, 9);
  g.fill();
  circle(g, 34, 32, 11);
  g.fill();
  g.fillStyle = 'rgba(120,150,70,0.12)';
  circle(g, 26, 22, 14);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.beginPath();
  g.ellipse(16, 30, 7, 2, -0.3, 0, TAU);
  g.fill();
  for (let i = 0; i < 2; i++) {
    const p = (ph + i * 0.5) % 1;
    const bx = 16 + i * 18;
    const by = 18 + i * 12;
    if (p < 0.8) {
      const rad = 1 + p * 4;
      g.fillStyle = 'rgba(70,55,35,0.9)';
      circle(g, bx, by, rad);
      g.fill();
      g.strokeStyle = 'rgba(150,125,90,0.7)';
      g.lineWidth = 0.8;
      g.stroke();
    } else {
      const q = (p - 0.8) / 0.2;
      g.strokeStyle = `rgba(150,125,90,${(0.5 * (1 - q)).toFixed(3)})`;
      g.lineWidth = 0.8;
      circle(g, bx, by, 5 + q * 6);
      g.stroke();
    }
  }
}

function spikes(g: CanvasRenderingContext2D, active: boolean): void {
  g.fillStyle = '#121520';
  g.fillRect(0, 0, 48, 48);
  g.fillStyle = '#1b1f2e';
  rr(g, 2.5, 2.5, 43, 43, 4);
  g.fill();
  g.strokeStyle = '#2c3248';
  g.lineWidth = 1;
  g.stroke();
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 3; k++) {
      const cx = 12 + k * 12;
      const cy = 12 + row * 12;
      g.fillStyle = '#06070c';
      circle(g, cx, cy, 3.3);
      g.fill();
      if (active) {
        poly(g, [cx, cy - 7, cx - 4, cy + 3.5, cx + 4, cy + 3.5]);
        const gr = g.createLinearGradient(cx - 4, 0, cx + 4, 0);
        gr.addColorStop(0, '#d7dcec');
        gr.addColorStop(0.5, '#9aa1ba');
        gr.addColorStop(1, '#575d76');
        g.fillStyle = gr;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.6)';
        g.lineWidth = 0.6;
        g.stroke();
      } else {
        g.fillStyle = 'rgba(160,170,200,0.35)';
        poly(g, [cx, cy - 1.6, cx - 1.3, cy + 1, cx + 1.3, cy + 1]);
        g.fill();
      }
    }
  }
  if (active) {
    rr(g, 1.5, 1.5, 45, 45, 4);
    neonStroke(g, '#ff3355', 1.4, 0.85);
  } else {
    for (const [cx, cy] of [
      [5, 5],
      [43, 5],
      [5, 43],
      [43, 43],
    ]) {
      g.fillStyle = 'rgba(255,51,85,0.45)';
      circle(g, cx, cy, 1.2);
      g.fill();
    }
  }
}

function rift(g: CanvasRenderingContext2D, ph: number): void {
  g.fillStyle = '#06030d';
  g.fillRect(0, 0, 48, 48);
  const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
  gr.addColorStop(0, '#2c1554');
  gr.addColorStop(0.6, '#130a26');
  gr.addColorStop(1, '#06030d');
  g.fillStyle = gr;
  g.fillRect(0, 0, 48, 48);
  g.save();
  clipTile(g);
  g.translate(24, 24);
  additive(g, () => {
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = (-ph * TAU) / 3 + (i * TAU) / 3;
      g.beginPath();
      for (let k = 0; k <= 10; k++) {
        const rad = 4 + k * 1.6;
        const ang = a + k * 0.3;
        if (k === 0) g.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        else g.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
      g.strokeStyle = 'rgba(138,92,255,0.6)';
      g.lineWidth = 2.2;
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const a = ph * TAU + i * 1.57;
      const rad = 14 + Math.sin(ph * TAU * 2 + i) * 3;
      g.fillStyle = '#cbb6ff';
      circle(g, Math.cos(a) * rad, Math.sin(a) * rad, 1);
      g.fill();
    }
  });
  g.fillStyle = '#000';
  circle(g, 0, 0, 5.5);
  g.fill();
  g.strokeStyle = 'rgba(190,160,255,0.85)';
  g.lineWidth = 1.2;
  g.stroke();
  g.restore();
}
