import type {
  BombOpts,
  BombType,
  ChunkOpts,
  FlameOpts,
  FxOpts,
  PowerUpOpts,
  ScorchOpts,
} from '../../painters/types';
import {
  circle,
  clamp,
  ease,
  glow,
  hexagon,
  icon,
  mix,
  poly,
  PU_COLORS_NEW,
  PU_SHAPE,
  rgba,
  rng,
  rr,
  shade,
  star,
} from './shim';
import { additive, neonStroke, polyline } from './draw';
import { pal, TAU } from './palette';

/* ---------------- bombs ---------------- */

const REMOTE_LED = '#7d9bff';

export function bomb(g: CanvasRenderingContext2D, o: BombOpts): void {
  g.save();
  if (o.type === 'pierce') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const pa = 0.3;
      poly(g, [
        ca * 20.5,
        2 + sa * 20.5,
        Math.cos(a - pa) * 12,
        2 + Math.sin(a - pa) * 12,
        Math.cos(a + pa) * 12,
        2 + Math.sin(a + pa) * 12,
      ]);
      g.fillStyle = sa < 0 ? '#a3a9c2' : '#646a84';
      g.fill();
      g.strokeStyle = '#151824';
      g.lineWidth = 0.8;
      g.stroke();
    }
  }
  const gr = g.createRadialGradient(-5, -4, 1, 0, 2, 15);
  gr.addColorStop(0, '#525a7c');
  gr.addColorStop(0.45, '#1b1f30');
  gr.addColorStop(1, '#06070e');
  g.fillStyle = gr;
  circle(g, 0, 2, 14);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 1.5;
  g.stroke();
  // cap
  g.fillStyle = '#2e3448';
  rr(g, -4.5, -14.5, 9, 4.5, 1.5);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(-3.5, -14, 7, 0.9);
  // specular
  g.fillStyle = 'rgba(255,255,255,0.42)';
  g.beginPath();
  g.ellipse(-5, -4, 4.6, 2.8, -0.6, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.8)';
  circle(g, -7.4, -5.8, 1);
  g.fill();
  if (o.type === 'pierce') {
    const rg = g.createRadialGradient(0, 2, 0, 0, 2, 9);
    rg.addColorStop(0, 'rgba(255,47,114,0.85)');
    rg.addColorStop(1, 'rgba(255,47,114,0)');
    g.fillStyle = rg;
    circle(g, 0, 2, 9);
    g.fill();
    g.fillStyle = '#ff2f72';
    circle(g, 0, 2, 3.6);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    circle(g, 0, 2, 1.5);
    g.fill();
  }
  if (o.hot) {
    additive(g, () => {
      glow(g, 0, 2, 15, o.spark ? '#ffffff' : '#ff3344', 0.65);
      glow(g, 0, 2, 7, '#ffd0d0', 0.5);
    });
  }
  if (o.type === 'remote') {
    g.strokeStyle = '#3a4058';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(2.5, -13);
    g.lineTo(7.5, -22.5);
    g.stroke();
    const on = o.spark === 1;
    g.fillStyle = on ? shade(REMOTE_LED, 0.5) : shade(REMOTE_LED, -0.5);
    circle(g, 7.5, -23.5, 2.4);
    g.fill();
    if (on) {
      additive(g, () => {
        glow(g, 7.5, -23.5, 8, REMOTE_LED, 0.8);
        g.strokeStyle = rgba(REMOTE_LED, 0.45);
        g.lineWidth = 1.2;
        for (const r of [5, 8.5]) {
          g.beginPath();
          g.arc(7.5, -23.5, r, -Math.PI * 0.85, -Math.PI * 0.15);
          g.stroke();
        }
      });
    }
  } else {
    // the fuse: a timer ring that runs down clockwise from the top
    const fuse = clamp(o.fuse);
    const a0 = -Math.PI / 2;
    const a1 = a0 + fuse * TAU;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.lineWidth = 2;
    circle(g, 0, 2, 19);
    g.stroke();
    const col = fuse > 0.4 ? '#ffb347' : mix('#ff3344', '#ffb347', fuse / 0.4);
    if (fuse > 0.001) {
      additive(g, () => {
        g.beginPath();
        g.arc(0, 2, 19, a0, a1);
        g.strokeStyle = rgba(col, 0.22);
        g.lineWidth = 4.5;
        g.stroke();
        g.beginPath();
        g.arc(0, 2, 19, a0, a1);
        g.strokeStyle = col;
        g.lineWidth = 1.7;
        g.stroke();
        const px = Math.cos(a1) * 19;
        const py = 2 + Math.sin(a1) * 19;
        glow(g, px, py, o.spark ? 8 : 6, '#fff1b0', o.spark ? 0.95 : 0.7);
        g.fillStyle = '#ffffff';
        circle(g, px, py, o.spark ? 1.7 : 1.3);
        g.fill();
      });
    }
  }
  g.restore();
}

/** The owner band: the bomb's equator ring and rim light, in white for tinting. */
export function bombBand(g: CanvasRenderingContext2D, o: { type: BombType }): void {
  g.save();
  g.lineCap = 'round';
  const ry = o.type === 'pierce' ? 4.2 : 4.6;
  g.beginPath();
  g.ellipse(0, 2, 13.6, ry, 0, 0.08, Math.PI - 0.08);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 5;
  g.stroke();
  g.beginPath();
  g.ellipse(0, 2, 13.6, ry, 0, 0.08, Math.PI - 0.08);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.2;
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 1.3;
  g.beginPath();
  g.arc(0, 2, 12.8, 0.25, 1.45);
  g.stroke();
  g.restore();
}

/* ---------------- flames ---------------- */

type Stops = [number, string][];
const STOPS: Record<'normal' | 'pierce', Stops> = {
  normal: [
    [0, 'rgba(255,40,110,0)'],
    [0.1, 'rgba(255,40,110,0.28)'],
    [0.21, 'rgba(255,84,40,0.8)'],
    [0.32, 'rgba(255,176,80,0.95)'],
    [0.41, 'rgba(255,250,226,1)'],
  ],
  pierce: [
    [0, 'rgba(40,120,255,0)'],
    [0.1, 'rgba(60,150,255,0.3)'],
    [0.21, 'rgba(90,205,255,0.82)'],
    [0.32, 'rgba(180,245,255,0.96)'],
    [0.41, 'rgba(255,255,255,1)'],
  ],
};

function linGrad(
  g: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  stops: Stops,
): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  for (let i = stops.length - 1; i >= 0; i--) gr.addColorStop(1 - stops[i][0], stops[i][1]);
  return gr;
}

function radGrad(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  stops: Stops,
): CanvasGradient {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  gr.addColorStop(0, stops[stops.length - 1][1]);
  for (let i = stops.length - 1; i >= 0; i--) gr.addColorStop(1 - 2 * stops[i][0], stops[i][1]);
  return gr;
}

const END_ROT: Record<string, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

export function flame(g: CanvasRenderingContext2D, o: FlameOpts): void {
  const n = Math.max(1, o.frames);
  const u = clamp((o.frame + 0.5) / n);
  const age = u * 0.5;
  const life = 1 - u;
  const e = ease.outCubic(clamp(age / 0.07));
  // every piece shares the same flicker so neighbouring arms always line up
  const fl = 1 + 0.07 * Math.sin(o.frame * 2.7 + 0.4) + 0.04 * Math.sin(o.frame * 5.3 + 1.1);
  const th = (0.3 + 0.7 * Math.sqrt(life)) * e * fl * 0.86;
  const stops = STOPS[o.pierce ? 'pierce' : 'normal'];
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = clamp(life * 5);
  if (o.piece === 'center') {
    const s = (0.55 + 0.45 * e) * (0.72 + 0.28 * Math.sqrt(life)) * fl;
    g.fillStyle = radGrad(g, 0, 0, 30 * s, stops);
    g.fillRect(-32, -32, 64, 64);
    g.rotate(age * 2 + 0.3);
    g.fillStyle = o.pierce ? 'rgba(235,250,255,0.9)' : 'rgba(255,252,240,0.9)';
    star(g, 0, 0, 4, 21 * s * (0.55 + 0.45 * life), 2.6 * s);
    g.fill();
  } else if (o.piece === 'arm') {
    if (o.dir === 'down' || o.dir === 'up') g.rotate(Math.PI / 2);
    g.scale(1, Math.max(0.01, th));
    g.fillStyle = linGrad(g, -24, 24, stops);
    g.fillRect(-24, -24, 48, 48);
  } else {
    g.rotate(END_ROT[o.dir] ?? 0);
    g.scale(1, Math.max(0.01, th));
    g.fillStyle = linGrad(g, -24, 24, stops);
    g.fillRect(-24, -24, 20, 48);
    g.fillStyle = radGrad(g, -4, 0, 24, stops);
    g.beginPath();
    g.moveTo(-4, -24);
    g.arc(-4, 0, 24, -Math.PI / 2, Math.PI / 2);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/* ---------------- power-ups ---------------- */

type Shape = (typeof PU_SHAPE)[keyof typeof PU_SHAPE];

function tokenPath(g: CanvasRenderingContext2D, shape: Shape): void {
  switch (shape) {
    case 'hex':
      hexagon(g, 0, 0, 15.5, Math.PI / 6);
      break;
    case 'diamond':
      poly(g, [0, -16.5, 15.5, 0, 0, 16.5, -15.5, 0]);
      break;
    case 'shield':
      g.beginPath();
      g.moveTo(-11.5, -13.5);
      g.lineTo(11.5, -13.5);
      g.quadraticCurveTo(14, -13.5, 14, -10.5);
      g.lineTo(14, -0.5);
      g.quadraticCurveTo(12, 11, 0, 16);
      g.quadraticCurveTo(-12, 11, -14, -0.5);
      g.lineTo(-14, -10.5);
      g.quadraticCurveTo(-14, -13.5, -11.5, -13.5);
      g.closePath();
      break;
    default:
      circle(g, 0, 0, 14);
  }
}

const LIFT = -7;

export function powerUp(g: CanvasRenderingContext2D, o: PowerUpOpts): void {
  const c = PU_COLORS_NEW[o.type];
  const shape = PU_SHAPE[o.type];
  g.save();
  // light pad
  g.beginPath();
  g.ellipse(0, 14, 15, 5.2, 0, 0, TAU);
  g.fillStyle = rgba(c, 0.18);
  g.fill();
  g.strokeStyle = rgba(c, 0.8);
  g.lineWidth = 1.3;
  g.stroke();
  g.beginPath();
  g.ellipse(0, 14, 9, 3, 0, 0, TAU);
  g.strokeStyle = rgba(c, 0.35);
  g.lineWidth = 1;
  g.stroke();
  additive(g, () => {
    glow(g, 0, 14, 16, c, 0.28);
    g.fillStyle = rgba(c, 0.08);
    poly(g, [-13, 14, 13, 14, 8, LIFT, -8, LIFT]);
    g.fill();
  });
  // token
  g.translate(0, LIFT);
  tokenPath(g, shape);
  g.strokeStyle = rgba(c, 0.25);
  g.lineWidth = 7;
  g.stroke();
  tokenPath(g, shape);
  g.fillStyle = 'rgba(9,11,22,0.9)';
  g.fill();
  const gr = g.createLinearGradient(0, -16, 0, 16);
  gr.addColorStop(0, rgba(c, 0.5));
  gr.addColorStop(1, rgba(c, 0.1));
  g.fillStyle = gr;
  g.fill();
  g.save();
  tokenPath(g, shape);
  g.clip();
  g.fillStyle = 'rgba(255,255,255,0.045)';
  for (let yy = -17; yy < 17; yy += 3) g.fillRect(-18, yy, 36, 1);
  g.restore();
  tokenPath(g, shape);
  g.strokeStyle = shade(c, 0.2);
  g.lineWidth = 2;
  g.stroke();
  g.save();
  g.scale(0.84, 0.84);
  tokenPath(g, shape);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 0.9;
  g.stroke();
  g.restore();
  icon(g, o.type, 0, 0.5, 0.56);
  // glint sweep across the first part of the loop, then a rest
  const n = Math.max(1, o.frames);
  const sweep = Math.max(2, n - 2);
  if (o.frame < sweep) {
    const k = (o.frame + 0.5) / sweep;
    g.save();
    tokenPath(g, shape);
    g.clip();
    additive(g, () => {
      const xx = -26 + k * 52;
      g.fillStyle = 'rgba(255,255,255,0.45)';
      poly(g, [xx - 4, -20, xx + 4, -20, xx - 6, 20, xx - 14, 20]);
      g.fill();
    });
    g.restore();
  }
  g.restore();
}

/* ---------------- effects ---------------- */

export function fx(g: CanvasRenderingContext2D, o: FxOpts): void {
  g.save();
  switch (o.kind) {
    case 'spark':
      additive(g, () => {
        glow(g, 0, 0, 7, '#ffb04a', 0.8);
        g.fillStyle = '#fff4c2';
        circle(g, 0, 0, 1.8);
        g.fill();
      });
      break;
    case 'smoke':
      glow(g, 0, 0, 16, '#5a5f78', 0.55);
      glow(g, -3, -2, 9, '#7a80a0', 0.25);
      break;
    case 'dust':
      glow(g, 0, 0, 10, '#7d8bbd', 0.6);
      break;
    case 'star':
      additive(g, () => {
        glow(g, 0, 0, 8, '#ffffff', 0.5);
        g.fillStyle = '#ffffff';
        star(g, 0, 0, 4, 7, 1.6);
        g.fill();
      });
      break;
    case 'ember':
      additive(g, () => {
        glow(g, 0, 0, 6, '#ff7a2a', 0.85);
        g.fillStyle = '#ffd27a';
        g.fillRect(-1, -1, 2, 2);
      });
      break;
    case 'snow':
      glow(g, 0, 0, 4, '#eaf6ff', 0.6);
      g.fillStyle = '#ffffff';
      circle(g, 0, 0, 1.5);
      g.fill();
      break;
    case 'firefly':
      additive(g, () => {
        glow(g, 0, 0, 9, '#c8ff5a', 0.7);
        g.fillStyle = '#f2ffb0';
        circle(g, 0, 0, 1.6);
        g.fill();
      });
      break;
    case 'mote':
      glow(g, 0, 0, 4, '#d8d4f0', 0.4);
      break;
    case 'glow':
      glow(g, 0, 0, 24, '#ffffff', 1);
      break;
    case 'ring':
      circle(g, 0, 0, 19);
      g.strokeStyle = 'rgba(255,255,255,0.25)';
      g.lineWidth = 6;
      g.stroke();
      circle(g, 0, 0, 19);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.stroke();
      break;
    case 'localRing':
      g.setLineDash([6, 4.5]);
      g.beginPath();
      g.ellipse(0, 0, 20, 7.5, 0, 0, TAU);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.8;
      g.stroke();
      g.setLineDash([]);
      break;
    case 'teamRing':
      g.beginPath();
      g.ellipse(0, 0, 15.5, 5.8, 0, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.2;
      g.stroke();
      break;
  }
  g.restore();
}

export function chunk(g: CanvasRenderingContext2D, o: ChunkOpts): void {
  const P = pal(o.world);
  const r = rng(o.variant * 97 + (o.kind === 'cracked' ? 13 : 0) + 3);
  const w = 9 + r() * 5;
  const h = 5 + r() * 3;
  g.save();
  g.rotate((r() - 0.5) * 1.2);
  const body = o.kind === 'cracked' ? shade(P.crate, -0.15) : shade(P.crate, 0.25);
  poly(g, [-w / 2, -h / 2, w / 2 - 1, -h / 2 - 1, w / 2, h / 2, -w / 2 + 1.5, h / 2 + 0.5]);
  g.fillStyle = body;
  g.fill();
  g.strokeStyle = shade(P.rim, 0.55);
  g.lineWidth = 1;
  g.stroke();
  if (o.variant === 2 || o.kind === 'cracked') {
    additive(g, () => {
      g.fillStyle = rgba(P.circuit, 0.9);
      g.fillRect(-w / 2 + 1, -0.6, w - 2, 1.2);
      glow(g, 0, 0, 6, P.circuit, 0.35);
    });
  } else {
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(-w / 2, -h / 2, w, 1);
  }
  g.restore();
}

export function scorch(g: CanvasRenderingContext2D, o: ScorchOpts): void {
  const r = rng(o.variant * 31 + 7);
  g.save();
  const gr = g.createRadialGradient(0, 0, 2, 0, 0, 22);
  gr.addColorStop(0, 'rgba(6,4,8,0.8)');
  gr.addColorStop(0.55, 'rgba(10,6,10,0.45)');
  gr.addColorStop(1, 'rgba(10,6,10,0)');
  g.fillStyle = gr;
  g.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const rad = 15 + r() * 7;
    if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 8; i++) {
    const a = r() * TAU;
    const d = 13 + r() * 8;
    circle(g, Math.cos(a) * d, Math.sin(a) * d, 0.7 + r() * 1.2);
    g.fill();
  }
  // a few cooling embers glow in the burn
  additive(g, () => {
    for (let i = 0; i < 3; i++) {
      const a = r() * TAU;
      const d = r() * 9;
      polyline(g, [
        Math.cos(a) * d,
        Math.sin(a) * d,
        Math.cos(a + 0.4) * (d + 5),
        Math.sin(a + 0.4) * (d + 5),
      ]);
      g.strokeStyle = 'rgba(255,110,50,0.35)';
      g.lineWidth = 0.9;
      g.stroke();
    }
  });
  g.restore();
}

export function meteor(g: CanvasRenderingContext2D): void {
  g.save();
  // fiery trail toward the upper right
  additive(g, () => {
    g.save();
    g.translate(8, -8);
    g.rotate(-Math.PI / 4);
    const gr = g.createLinearGradient(0, 0, 26, 0);
    gr.addColorStop(0, 'rgba(255,120,60,0.85)');
    gr.addColorStop(1, 'rgba(255,40,110,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, -9);
    g.quadraticCurveTo(14, -6, 26, 0);
    g.quadraticCurveTo(14, 6, 0, 9);
    g.closePath();
    g.fill();
    g.restore();
    glow(g, 0, 0, 22, '#ff6a2a', 0.5);
  });
  const gr = g.createRadialGradient(-4, -4, 1, 0, 0, 14);
  gr.addColorStop(0, '#5a3a2e');
  gr.addColorStop(0.6, '#2a1712');
  gr.addColorStop(1, '#120806');
  poly(g, [-12, -6, -6, -13, 5, -12, 13, -4, 12, 7, 3, 13, -8, 11, -13, 3]);
  g.fillStyle = gr;
  g.fill();
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.lineWidth = 1.2;
  g.stroke();
  for (const s of [
    [-8, -2, -2, 2, 4, -3, 9, 1],
    [-3, 8, 1, 3, 6, 7],
  ]) {
    polyline(g, s);
    neonStroke(g, '#ff8a3a', 1, 0.9);
  }
  g.restore();
}
