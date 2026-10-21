import type { Direction, EnemySpriteConfig } from '@blast-arena/shared';
import type { EnemyOpts, EyeStyle, GhostOpts, PlayerOpts } from '../../painters/types';
import { circle, glow, hexagon, mix, poly, rgba, rr, shade, star } from './shim';
import { additive, neonStroke, polyline } from './draw';
import { TAU } from './palette';

/* ---------------- player droid ---------------- */

function bodyPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(-15, 8);
  g.lineTo(-15, -6);
  g.arc(0, -6, 15, Math.PI, 0);
  g.lineTo(15, 8);
  g.quadraticCurveTo(15, 13, 10, 13);
  g.lineTo(-10, 13);
  g.quadraticCurveTo(-15, 13, -15, 8);
  g.closePath();
}

function eyeShape(
  g: CanvasRenderingContext2D,
  eyes: EyeStyle,
  ex: number,
  ey: number,
  left: boolean,
  closed: boolean,
  r: number,
): void {
  if (closed) {
    rr(g, ex - r, ey - 0.6, r * 2, 1.3, 0.6);
    g.fill();
    return;
  }
  if (eyes === 'angry') {
    const inner = left ? 1 : -1;
    poly(g, [
      ex - 3 * inner,
      ey - 2.2,
      ex + 3 * inner,
      ey - 0.2,
      ex + 3 * inner,
      ey + 1.9,
      ex - 3 * inner,
      ey + 0.7,
    ]);
    g.fill();
  } else if (eyes === 'dot') {
    circle(g, ex, ey, 1.35);
    g.fill();
  } else {
    circle(g, ex, ey, r);
    g.fill();
  }
}

/** The droid body in its colour, facing `dir`, with LED eyes (closed for a blink). */
function drawDroid(
  g: CanvasRenderingContext2D,
  color: string,
  dir: Direction,
  eyes: EyeStyle,
  closed: boolean,
): void {
  g.lineJoin = 'round';
  bodyPath(g);
  g.lineWidth = 3.4;
  g.strokeStyle = 'rgba(3,4,10,0.92)';
  g.stroke();
  const gr = g.createLinearGradient(-12, -21, 10, 13);
  gr.addColorStop(0, shade(color, 0.42));
  gr.addColorStop(0.45, color);
  gr.addColorStop(1, shade(color, -0.52));
  g.fillStyle = gr;
  bodyPath(g);
  g.fill();
  g.save();
  bodyPath(g);
  g.clip();
  g.fillStyle = 'rgba(5,6,13,0.5)';
  g.fillRect(-16, 4, 32, 5);
  g.fillStyle = rgba(shade(color, 0.7), 0.95);
  g.fillRect(-6, 5.8, 12, 1.4);
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  g.ellipse(-6.5, -15, 5.5, 3, -0.55, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(shade(color, 0.7), 0.6);
  g.lineWidth = 1.8;
  g.beginPath();
  g.arc(0, -6, 13.8, -0.25, 0.95);
  g.stroke();
  g.restore();
  g.strokeStyle = rgba(shade(color, 0.6), 0.75);
  g.lineWidth = 0.9;
  bodyPath(g);
  g.stroke();
  const led = eyes === 'angry' ? mix('#ff3355', '#ffffff', 0.35) : mix(color, '#ffffff', 0.72);
  if (dir === 'up') {
    g.fillStyle = 'rgba(5,6,13,0.55)';
    rr(g, -8, -15.5, 16, 11.5, 4);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      g.moveTo(-4.5, -12.5 + i * 3);
      g.lineTo(4.5, -12.5 + i * 3);
    }
    g.stroke();
    g.strokeStyle = '#191d2c';
    g.lineWidth = 1.7;
    g.beginPath();
    g.moveTo(0, -20.5);
    g.lineTo(0, -26.5);
    g.stroke();
    g.fillStyle = rgba(color, 0.45);
    circle(g, 0, -27, 4);
    g.fill();
    g.fillStyle = led;
    circle(g, 0, -27, 1.9);
    g.fill();
    return;
  }
  const side = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const vw = side ? 16 : 22;
  const vx = side === 0 ? -11 : side > 0 ? -3.5 : -12.5;
  const vg = g.createLinearGradient(0, -13, 0, 0);
  vg.addColorStop(0, '#141a2c');
  vg.addColorStop(1, '#04060c');
  g.fillStyle = vg;
  rr(g, vx, -13, vw, 12.5, 6);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.16)';
  rr(g, vx + 2.5, -11.8, vw * 0.45, 2.2, 1.1);
  g.fill();
  const ey = -6.6;
  const ex = side === 0 ? [-5, 5] : side > 0 ? [2, 8.2] : [-8.2, -2];
  if (eyes === 'cyclops') {
    const mx = (ex[0] + ex[1]) / 2;
    const rg = g.createRadialGradient(mx, ey, 0, mx, ey, 7);
    rg.addColorStop(0, rgba(color, 0.7));
    rg.addColorStop(1, rgba(color, 0));
    g.fillStyle = rg;
    g.fillRect(mx - 7, ey - 7, 14, 14);
    g.fillStyle = led;
    g.beginPath();
    g.ellipse(mx, ey, side ? 3.4 : 4.3, closed ? 0.7 : 2.8, 0, 0, TAU);
    g.fill();
  } else {
    for (let i = 0; i < 2; i++) {
      const rg = g.createRadialGradient(ex[i], ey, 0, ex[i], ey, 5.5);
      rg.addColorStop(0, rgba(eyes === 'angry' ? '#ff3355' : color, 0.75));
      rg.addColorStop(1, rgba(color, 0));
      g.fillStyle = rg;
      g.fillRect(ex[i] - 6, ey - 6, 12, 12);
      g.fillStyle = led;
      eyeShape(g, eyes, ex[i], ey, i === 0, closed, side ? 2.3 : 2.6);
    }
  }
  if (side) {
    const ax = side > 0 ? -11.5 : 11.5;
    g.fillStyle = shade(color, -0.45);
    circle(g, ax, -4, 3.4);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 0.8;
    g.stroke();
    g.fillStyle = led;
    circle(g, ax, -4, 1.1);
    g.fill();
  }
}

export function player(g: CanvasRenderingContext2D, o: PlayerOpts): void {
  const walking = o.pose.kind === 'walk';
  const step = o.pose.kind === 'walk' ? o.pose.step : 0;
  const closed = o.pose.kind === 'idle' && o.pose.blink;
  const ph = (step * Math.PI) / 2;
  const s1 = Math.sin(ph);
  const bob = walking ? -Math.abs(s1) * 2.2 : 0;
  let tilt = 0;
  if (walking && (o.dir === 'left' || o.dir === 'right')) {
    tilt = (o.dir === 'right' ? 1 : -1) * (0.07 + s1 * 0.03);
  }
  g.save();
  // under-glow on the floor
  additive(g, () => glow(g, 0, 15, 18, o.color, 0.3));
  // feet; the lifted foot fires its thruster
  const feet: [number, number][] = [
    [-8, walking ? -Math.max(0, s1) * 2.6 : 0],
    [8, walking ? -Math.max(0, -s1) * 2.6 : 0],
  ];
  for (const [fx, lift] of feet) {
    if (lift < 0) additive(g, () => glow(g, fx, 19, 6, o.color, 0.6));
    g.fillStyle = '#0b0d18';
    rr(g, fx - 4, 11.5 + lift, 8, 6, 2.6);
    g.fill();
    g.strokeStyle = rgba(o.color, 0.55);
    g.lineWidth = 0.8;
    g.stroke();
  }
  g.translate(0, bob);
  g.rotate(tilt);
  drawDroid(g, o.color, o.dir, o.eyes, closed);
  g.restore();
}

/** Hologram ghost: the droid as a translucent projection that dissolves toward the bottom. */
export function ghost(g: CanvasRenderingContext2D, o: GhostOpts): void {
  g.save();
  additive(g, () => glow(g, 0, -4, 24, o.color, 0.35));
  g.globalAlpha = 0.6;
  drawDroid(g, o.color, 'down', 'default', false);
  g.globalAlpha = 1;
  g.save();
  bodyPath(g);
  g.clip();
  additive(g, () => {
    g.fillStyle = rgba(o.color, 0.5);
    for (let yy = -21; yy < 14; yy += 3.5) g.fillRect(-16, yy, 32, 0.9);
  });
  g.restore();
  bodyPath(g);
  g.lineJoin = 'round';
  neonStroke(g, shade(o.color, 0.45), 1.1, 0.9);
  // dissolve toward the bottom
  const fade = g.createLinearGradient(0, -2, 0, 16);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = fade;
  g.fillRect(-32, -2, 64, 20);
  g.restore();
}

/* ---------------- shield ---------------- */

export function shield(g: CanvasRenderingContext2D, o: { frame: number }): void {
  const col = '#5dffb0';
  const f = ((o.frame % 4) + 4) % 4;
  g.save();
  g.translate(0, -2);
  g.globalAlpha = 0.82 + 0.18 * Math.sin((f / 4) * TAU);
  hexagon(g, 0, 0, 28, Math.PI / 6);
  g.fillStyle = rgba(col, 0.08);
  g.fill();
  g.save();
  hexagon(g, 0, 0, 28, Math.PI / 6);
  g.clip();
  g.strokeStyle = rgba(col, 0.16);
  g.lineWidth = 0.8;
  const dx = 5 * Math.sqrt(3);
  for (let row = -5; row <= 5; row++) {
    for (let k = -4; k <= 4; k++) {
      hexagon(g, k * dx + (row % 2 ? dx / 2 : 0), row * 7.5, 5, Math.PI / 6);
      g.stroke();
    }
  }
  g.restore();
  hexagon(g, 0, 0, 28, Math.PI / 6);
  neonStroke(g, '#7dffc4', 1.5, 0.85);
  g.globalAlpha = 1;
  additive(g, () => {
    const a = (f * Math.PI) / 4 - Math.PI / 4;
    glow(g, Math.cos(a) * 26, Math.sin(a) * 26, 9, '#bfffe4', 0.7);
    glow(g, Math.cos(a + Math.PI) * 26, Math.sin(a + Math.PI) * 26, 7, '#bfffe4', 0.4);
  });
  g.restore();
}

/* ---------------- enemies ---------------- */

interface Face {
  /** Eye centre line and half-spacing (down view). */
  ey: number;
  spread: number;
  /** Top of the head, for horns and crowns. */
  top: number;
  /** Half-width of the body, for wings. */
  half: number;
}

const ENEMY_LED: Record<string, string> = {
  angry: '#ff3355',
  crazy: '#ffe14a',
};

export function enemy(g: CanvasRenderingContext2D, o: EnemyOpts): void {
  const s = o.sprite;
  const prim = s.primaryColor || '#44cc44';
  const sec = s.secondaryColor || '#225522';
  const f = o.frame & 1;
  const dir = o.dir;
  g.save();
  if (s.hasAura) {
    additive(g, () => {
      glow(g, 0, 0, 30, sec, 0.45);
      circle(g, 0, 0, 25);
      g.strokeStyle = rgba(sec, 0.35);
      g.lineWidth = 1.2;
      g.setLineDash([3, 4]);
      g.stroke();
      g.setLineDash([]);
    });
  }
  // contact glow under the body
  additive(g, () => glow(g, 0, 18, 16, prim, 0.25));
  const face = faceFor(s.bodyShape);
  if (s.hasWings) wings(g, sec, dir, face, f);
  if (s.hasTail && dir !== 'down') tail(g, sec, dir);
  body(g, s.bodyShape, prim, sec, f, dir);
  if (s.hasTail && dir === 'down') tail(g, sec, dir);
  if (s.hasScar) {
    g.lineCap = 'round';
    polyline(g, [5, -9, -4, 3]);
    neonStroke(g, mix(prim, '#ffffff', 0.55), 1, 0.7);
    polyline(g, [-1, -5, 3, -1]);
    neonStroke(g, mix(prim, '#ffffff', 0.55), 0.8, 0.6);
  }
  eyesFor(g, s, face, dir, prim);
  if (s.hasTeeth && dir !== 'up') {
    g.fillStyle = '#f4f7ff';
    const tx = dir === 'right' ? 3 : dir === 'left' ? -3 : 0;
    for (let i = -2; i <= 2; i++) {
      poly(g, [
        tx + i * 4 - 1.8,
        face.ey + 9,
        tx + i * 4 + 1.8,
        face.ey + 9,
        tx + i * 4,
        face.ey + 12.5,
      ]);
      g.fill();
    }
    additive(g, () => glow(g, tx, face.ey + 10, 8, '#ffffff', 0.15));
  }
  if (s.hasHorns) {
    for (const sx of [-1, 1]) {
      poly(g, [sx * 9, face.top + 6, sx * 6, face.top - 4, sx * 2, face.top + 7]);
      g.fillStyle = shade(sec, 0.05);
      g.fill();
      g.lineJoin = 'round';
      neonStroke(g, shade(sec, 0.6), 1, 0.85);
    }
  } else if (s.hasCrown) {
    const by = face.top + 2;
    poly(g, [-7, by, -7.5, by - 7, -3.5, by - 3.5, 0, by - 9, 3.5, by - 3.5, 7.5, by - 7, 7, by]);
    g.fillStyle = 'rgba(60,40,0,0.85)';
    g.fill();
    g.lineJoin = 'round';
    neonStroke(g, '#ffd23a', 1.1, 0.95);
    g.fillStyle = '#fff2b0';
    circle(g, 0, by - 4, 1.1);
    g.fill();
  }
  accessory(g, s, face, dir);
  g.restore();
}

function faceFor(shape: EnemySpriteConfig['bodyShape']): Face {
  switch (shape) {
    case 'spiky':
      return { ey: -1, spread: 6.5, top: -18, half: 18 };
    case 'ghost':
      return { ey: -5, spread: 7, top: -20, half: 18 };
    case 'robot':
      return { ey: -7, spread: 6, top: -16, half: 16 };
    case 'bug':
      return { ey: -10, spread: 5.5, top: -18, half: 16 };
    case 'skull':
      return { ey: -5, spread: 7, top: -21, half: 18 };
    default:
      return { ey: -4, spread: 7, top: -20, half: 19 };
  }
}

function glassFill(
  g: CanvasRenderingContext2D,
  prim: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, shade(prim, 0.35));
  gr.addColorStop(0.5, shade(prim, -0.15));
  gr.addColorStop(1, shade(prim, -0.65));
  g.fillStyle = gr;
  g.fill();
}

function body(
  g: CanvasRenderingContext2D,
  shape: EnemySpriteConfig['bodyShape'],
  prim: string,
  sec: string,
  f: number,
  dir: Direction,
): void {
  g.lineJoin = 'round';
  switch (shape) {
    case 'spiky': {
      const len = f ? 26 : 24;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU - Math.PI / 2;
        const p = a + Math.PI / 2;
        const bx = Math.cos(a) * 15;
        const by = Math.sin(a) * 15;
        poly(g, [
          bx + Math.cos(p) * 4,
          by + Math.sin(p) * 4,
          bx - Math.cos(p) * 4,
          by - Math.sin(p) * 4,
          Math.cos(a) * len,
          Math.sin(a) * len,
        ]);
        g.fillStyle = shade(sec, -0.1);
        g.fill();
        neonStroke(g, shade(sec, 0.6), 1, 0.9);
      }
      const pts: number[] = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU - Math.PI / 2;
        pts.push(Math.cos(a) * 18, Math.sin(a) * 18);
      }
      poly(g, pts);
      glassFill(g, prim, -10, -18, 10, 16);
      neonStroke(g, shade(prim, 0.3), 1.2, 0.9);
      sheen(g, -6, -9);
      break;
    }
    case 'ghost': {
      const ghostPath = () => {
        g.beginPath();
        g.moveTo(-18, 12);
        g.lineTo(-18, -2);
        g.arc(0, -2, 18, Math.PI, 0);
        g.lineTo(18, 12);
        for (let i = 0; i < 4; i++) {
          const x0 = 18 - i * 9;
          const dip = (i + f) % 2 === 0 ? 19 : 15.5;
          g.quadraticCurveTo(x0 - 4.5, dip, x0 - 9, 12);
        }
        g.closePath();
      };
      ghostPath();
      g.save();
      g.globalAlpha = 0.8;
      glassFill(g, prim, 0, -20, 0, 18);
      g.restore();
      g.save();
      ghostPath();
      g.clip();
      additive(g, () => {
        g.fillStyle = rgba(prim, 0.3);
        for (let yy = -20; yy < 20; yy += 3.5) g.fillRect(-20, yy, 40, 0.9);
      });
      g.restore();
      ghostPath();
      neonStroke(g, shade(prim, 0.4), 1.2, 0.9);
      sheen(g, -6, -11);
      break;
    }
    case 'robot': {
      g.strokeStyle = shade(sec, 0.1);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(0, -15);
      g.lineTo(0, -22);
      g.stroke();
      g.fillStyle = f ? shade(sec, -0.3) : shade(sec, 0.5);
      circle(g, 0, -23, 2.8);
      g.fill();
      if (!f) additive(g, () => glow(g, 0, -23, 7, sec, 0.8));
      // legs
      g.fillStyle = '#0d1020';
      rr(g, -11, 13 + (f ? -1 : 0), 7, 6, 2);
      g.fill();
      rr(g, 4, 13 + (f ? 0 : -1), 7, 6, 2);
      g.fill();
      rr(g, -16, -15, 32, 30, 5);
      glassFill(g, prim, 0, -15, 0, 15);
      neonStroke(g, shade(prim, 0.35), 1.2, 0.9);
      // chest plate
      rr(g, -8, 2, 16, 8, 2);
      g.fillStyle = 'rgba(4,6,12,0.8)';
      g.fill();
      additive(g, () => {
        g.fillStyle = rgba(sec, 0.85);
        g.fillRect(-6, 5, 12, 2);
        glow(g, 0, 6, 9, sec, 0.3);
      });
      g.fillStyle = 'rgba(255,255,255,0.4)';
      for (const [bx, by] of [
        [-13, -12],
        [13, -12],
        [-13, 12],
        [13, 12],
      ]) {
        circle(g, bx, by, 0.9);
        g.fill();
      }
      sheen(g, -7, -10);
      break;
    }
    case 'bug': {
      g.strokeStyle = shade(sec, 0.3);
      g.lineWidth = 1.6;
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const y = -4 + i * 8;
        const swing = (i % 2 === f ? 1 : -1) * 3;
        g.beginPath();
        g.moveTo(-13, y);
        g.lineTo(-21, y + swing);
        g.moveTo(13, y);
        g.lineTo(21, y - swing);
        g.stroke();
      }
      // antennae
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.moveTo(sx * 5, -16);
        g.quadraticCurveTo(sx * 9, -24, sx * 13, -22);
        g.strokeStyle = shade(sec, 0.3);
        g.lineWidth = 1.2;
        g.stroke();
        additive(g, () => glow(g, sx * 13, -22, 4, sec, 0.9));
      }
      g.beginPath();
      g.ellipse(0, 0, 15, 18, 0, 0, TAU);
      glassFill(g, prim, -8, -18, 8, 18);
      neonStroke(g, shade(prim, 0.35), 1.2, 0.9);
      if (dir !== 'up') {
        g.beginPath();
        g.ellipse(0, -10, 9, 6.5, 0, 0, TAU);
        g.fillStyle = 'rgba(4,6,12,0.75)';
        g.fill();
      }
      g.strokeStyle = rgba(sec, 0.7);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, -4);
      g.lineTo(0, 17);
      g.moveTo(-12, 3);
      g.quadraticCurveTo(0, 6, 12, 3);
      g.moveTo(-10, 10);
      g.quadraticCurveTo(0, 13, 10, 10);
      g.stroke();
      sheen(g, -6, -5);
      break;
    }
    case 'skull': {
      const jaw = f ? 1.6 : 0;
      rr(g, -11, 7 + jaw, 22, 11, 4);
      glassFill(g, shade(prim, -0.1), 0, 7, 0, 18);
      neonStroke(g, shade(prim, 0.3), 1, 0.85);
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = -1; i <= 1; i++) {
        g.moveTo(i * 5, 9 + jaw);
        g.lineTo(i * 5, 16 + jaw);
      }
      g.stroke();
      circle(g, 0, -4, 18);
      glassFill(g, prim, -8, -22, 8, 14);
      neonStroke(g, shade(prim, 0.35), 1.2, 0.9);
      if (dir !== 'up') {
        const sx = dir === 'right' ? 3 : dir === 'left' ? -3 : 0;
        g.fillStyle = 'rgba(4,4,10,0.9)';
        circle(g, sx - 7, -5, 5.6);
        g.fill();
        circle(g, sx + 7, -5, 5.6);
        g.fill();
        poly(g, [sx, 2, sx - 2.6, 6.5, sx + 2.6, 6.5]);
        g.fill();
      }
      sheen(g, -7, -14);
      break;
    }
    default: {
      // blob: a glossy jelly droplet that squashes on its step frame
      const rx = f ? 20.5 : 19.5;
      const ry = f ? 17 : 18.5;
      const cy = f ? 1 : 0;
      g.beginPath();
      g.ellipse(0, cy, rx, ry, 0, 0, TAU);
      glassFill(g, prim, -10, -18, 10, 18);
      g.save();
      g.beginPath();
      g.ellipse(0, cy, rx, ry, 0, 0, TAU);
      g.clip();
      additive(g, () => glow(g, 0, cy + 8, 13, sec, 0.45));
      g.restore();
      g.beginPath();
      g.ellipse(0, cy, rx, ry, 0, 0, TAU);
      neonStroke(g, shade(prim, 0.35), 1.2, 0.9);
      sheen(g, -6, -9 + cy);
      break;
    }
  }
}

function sheen(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.beginPath();
  g.ellipse(x, y, 4.6, 2.6, -0.55, 0, TAU);
  g.fill();
}

function eyesFor(
  g: CanvasRenderingContext2D,
  s: EnemySpriteConfig,
  face: Face,
  dir: Direction,
  prim: string,
): void {
  if (dir === 'up') {
    // back view: a dim status strip instead of eyes
    additive(g, () => {
      g.fillStyle = rgba(prim, 0.5);
      rr(g, -5, face.ey - 1, 10, 2, 1);
      g.fill();
    });
    return;
  }
  const side = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  const ex = side === 0 ? [-face.spread, face.spread] : side > 0 ? [1, 7.5] : [-7.5, -1];
  const ey = face.ey;
  const base = ENEMY_LED[s.eyeStyle] ?? mix(prim, '#ffffff', 0.78);
  const ledCore = mix(base, '#ffffff', 0.35);
  for (let i = 0; i < 2; i++) {
    let r = side ? 2.3 : 2.7;
    if (s.eyeStyle === 'crazy') r = i === 0 ? 3.4 : 1.8;
    additive(g, () => glow(g, ex[i], ey, r * 2.4, base, 0.7));
    g.fillStyle = ledCore;
    if (s.eyeStyle === 'angry') {
      const inner = i === 0 ? 1 : -1;
      poly(g, [
        ex[i] - 3 * inner,
        ey - 2.2,
        ex[i] + 3 * inner,
        ey - 0.2,
        ex[i] + 3 * inner,
        ey + 1.9,
        ex[i] - 3 * inner,
        ey + 0.7,
      ]);
      g.fill();
      g.strokeStyle = 'rgba(4,4,10,0.9)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(ex[i] - 3.6 * inner, ey - 4.6);
      g.lineTo(ex[i] + 3.2 * inner, ey - 2.8);
      g.stroke();
    } else if (s.eyeStyle === 'sleepy') {
      rr(g, ex[i] - 3, ey - 0.4, 6, 2, 1);
      g.fill();
      g.strokeStyle = 'rgba(4,4,10,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ex[i] - 3.4, ey - 1.4);
      g.lineTo(ex[i] + 3.4, ey - 1.4);
      g.stroke();
    } else {
      circle(g, ex[i], ey, r);
      g.fill();
    }
  }
}

function wings(
  g: CanvasRenderingContext2D,
  sec: string,
  dir: Direction,
  face: Face,
  f: number,
): void {
  const front = dir === 'right' ? -1 : dir === 'left' ? 1 : 0;
  const wy = -6 + (f ? -2 : 0);
  for (const sx of [-1, 1]) {
    const k = front === sx ? 1 : front === -sx ? 0.7 : 1;
    const x0 = sx * (face.half - 2);
    poly(g, [
      x0,
      wy + 2,
      x0 + sx * 12 * k,
      wy - 10 * k,
      x0 + sx * 9 * k,
      wy + 4,
      x0 + sx * 2,
      wy + 8,
    ]);
    g.fillStyle = rgba(shade(sec, 0.2), 0.4);
    g.fill();
    g.lineJoin = 'round';
    neonStroke(g, shade(sec, 0.6), 1, 0.8);
  }
}

function tail(g: CanvasRenderingContext2D, sec: string, dir: Direction): void {
  const tip: Record<Direction, [number, number, number, number]> = {
    down: [14, 8, 22, 14],
    up: [0, 16, 0, 26],
    left: [16, 6, 26, 0],
    right: [-16, 6, -26, 0],
  };
  const [bx, by, tx, ty] = tip[dir];
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(bx, by);
  g.quadraticCurveTo((bx + tx) / 2 + 4, (by + ty) / 2 + 4, tx, ty);
  neonStroke(g, shade(sec, 0.3), 2, 0.9);
  star(g, tx, ty, 3, 3.4, 1.2);
  g.fillStyle = shade(sec, 0.5);
  g.fill();
}

function accessory(
  g: CanvasRenderingContext2D,
  s: EnemySpriteConfig,
  face: Face,
  dir: Direction,
): void {
  const acc = s.accessory ?? 'none';
  if (acc === 'none' || dir === 'up') return;
  const sec = s.secondaryColor || '#225522';
  const side = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
  if (acc === 'bow_tie') {
    const y = face.ey + 15;
    const x = side * 3;
    poly(g, [x, y, x - 6, y - 3.5, x - 6, y + 3.5]);
    g.fillStyle = shade(sec, 0.1);
    g.fill();
    neonStroke(g, shade(sec, 0.5), 0.8, 0.8);
    poly(g, [x, y, x + 6, y - 3.5, x + 6, y + 3.5]);
    g.fillStyle = shade(sec, 0.1);
    g.fill();
    neonStroke(g, shade(sec, 0.5), 0.8, 0.8);
    g.fillStyle = shade(sec, 0.6);
    circle(g, x, y, 1.5);
    g.fill();
  } else if (acc === 'monocle') {
    const ex = side === 0 ? face.spread : side > 0 ? 7.5 : -1;
    circle(g, ex, face.ey, 5.2);
    neonStroke(g, '#ffffff', 1, 0.75);
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(ex + 4.5, face.ey + 2.5);
    g.quadraticCurveTo(ex + 8, face.ey + 8, ex + 6, face.ey + 13);
    g.stroke();
  } else if (acc === 'bandana') {
    const y = face.ey - 6;
    rr(g, -15, y - 1.8, 30, 3.6, 1.6);
    g.fillStyle = shade(sec, 0.05);
    g.fill();
    neonStroke(g, shade(sec, 0.45), 0.8, 0.7);
    const kx = side < 0 ? -15 : 15;
    const kd = side < 0 ? -1 : 1;
    poly(g, [kx, y - 1, kx + kd * 5, y - 6, kx + kd * 4, y + 3]);
    g.fillStyle = shade(sec, 0.05);
    g.fill();
  }
}
