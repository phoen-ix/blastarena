import { circle, ellipseFill, glow, hash2, mix, poly, rgba, rng, rr, shade, star } from './shim';
import type { BlockShadowOpts, CrateOpts, FloorOpts, WallOpts } from '../../painters/types';
import { MASK_E, MASK_N, MASK_S, MASK_W } from '../../painters/types';
import { additive, neonStroke, polyline, rrc } from './draw';
import { pal, TAU } from './palette';
import type { NeonWorld } from './palette';

/* ---------------- floor ---------------- */

export function floor(g: CanvasRenderingContext2D, o: FloorOpts): void {
  const P = pal(o.world);
  const v = o.variant & 7;
  const h = hash2(v, o.parity, 11);
  const r = rng(v * 7919 + o.parity * 104729 + 17);
  g.save();
  g.fillStyle = mix(P.floor, P.floor2, h * 0.9);
  g.fillRect(0, 0, 48, 48);
  if (o.parity === 0) {
    g.fillStyle = 'rgba(255,255,255,0.014)';
    g.fillRect(0, 0, 48, 48);
  }
  const sh = g.createLinearGradient(0, 0, 48, 48);
  sh.addColorStop(0, 'rgba(255,255,255,0.05)');
  sh.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, 48, 48);
  // inset panel line
  g.strokeStyle = rgba(P.seam, 0.6);
  g.lineWidth = 1;
  rr(g, 4.5, 4.5, 39, 39, 4);
  g.stroke();
  floorMotif(g, P, v, o.parity, r);
  // seams on the top/left edges, so each grid line is drawn once
  g.fillStyle = rgba(P.seamGlow, 0.06);
  g.fillRect(0, 0, 48, 2.5);
  g.fillRect(0, 0, 2.5, 48);
  g.fillStyle = P.seam;
  g.fillRect(0, 0, 48, 1);
  g.fillRect(0, 0, 1, 48);
  if (v === 1 || v === 4 || v === 6) {
    g.fillStyle = rgba(P.seamGlow, 0.45);
    g.fillRect(0, 0, 1.6, 1.6);
  }
  g.restore();
}

function floorMotif(
  g: CanvasRenderingContext2D,
  P: NeonWorld,
  v: number,
  parity: number,
  r: () => number,
): void {
  switch (P.motif) {
    case 'panel':
      if (v === 2) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (let i = 0; i < 3; i++) g.fillRect(17, 30 + i * 3.2, 14, 1.4);
      }
      if (v === 5) {
        g.fillStyle = rgba(P.seamGlow, 0.6);
        circle(g, 40, 8, 1.2);
        g.fill();
        glow(g, 40, 8, 4, P.seamGlow, 0.12);
      }
      break;
    case 'moss':
      for (let i = 0; i < 5; i++) {
        g.fillStyle = rgba(i % 2 ? P.seamGlow : '#2a6b3c', i % 2 ? 0.16 : 0.35);
        circle(g, 6 + r() * 36, 6 + r() * 36, 0.8 + r() * 1.6);
        g.fill();
      }
      if (v === 3 || v === 6) {
        const x = 12 + r() * 24;
        const y = 14 + r() * 20;
        g.fillStyle = rgba(P.edge2, 0.55);
        circle(g, x, y, 1.3);
        g.fill();
        glow(g, x, y, 4.5, P.edge2, 0.14);
      }
      break;
    case 'sand': {
      // sandstone slabs: one mortar line across, offset by parity
      g.strokeStyle = 'rgba(0,0,0,0.32)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(5, 24.5);
      g.lineTo(43, 24.5);
      const sx = parity ? 18.5 : 30.5;
      g.moveTo(sx, 5);
      g.lineTo(sx, 24.5);
      g.moveTo(parity ? 30.5 : 18.5, 24.5);
      g.lineTo(parity ? 30.5 : 18.5, 43);
      g.stroke();
      g.fillStyle = 'rgba(255,190,110,0.05)';
      g.fillRect(5, 5, 38, 19);
      if (v === 1 || v === 4) {
        g.strokeStyle = rgba(P.seamGlow, 0.14);
        g.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          g.beginPath();
          g.arc(24, 54 + i * 6, 26, Math.PI * 1.2, Math.PI * 1.8);
          g.stroke();
        }
      }
      if (v === 6) {
        g.strokeStyle = rgba(P.seamGlow, 0.35);
        g.lineWidth = 1;
        circle(g, 35, 13, 3.4);
        g.stroke();
        glow(g, 35, 13, 6, P.seamGlow, 0.1);
      }
      break;
    }
    case 'crystal':
      g.strokeStyle = 'rgba(200,240,255,0.05)';
      g.lineWidth = 1;
      polyline(g, [6 + r() * 8, 40, 26 + r() * 10, 8]);
      g.stroke();
      if (v === 1 || v === 5) {
        g.fillStyle = 'rgba(220,250,255,0.5)';
        star(g, 10 + r() * 28, 10 + r() * 28, 4, 2.6, 0.6);
        g.fill();
      }
      break;
    case 'magma':
      if (v === 2 || v === 6) {
        const px = 8 + r() * 20;
        const pts = [px, 6, px + 6, 18, px + 2, 28, px + 10, 42];
        polyline(g, pts);
        g.strokeStyle = 'rgba(255,90,31,0.18)';
        g.lineWidth = 3.4;
        g.stroke();
        polyline(g, pts);
        g.strokeStyle = 'rgba(255,150,70,0.4)';
        g.lineWidth = 0.9;
        g.stroke();
      }
      break;
    case 'void': {
      const n = 2 + (v % 3);
      for (let i = 0; i < n; i++) {
        const x = 6 + r() * 36;
        const y = 6 + r() * 36;
        g.fillStyle = i % 2 ? 'rgba(255,190,245,0.55)' : 'rgba(255,255,255,0.45)';
        circle(g, x, y, 0.5 + r() * 0.6);
        g.fill();
      }
      if (v === 4) glow(g, 30, 20, 14, P.seamGlow, 0.07);
      break;
    }
    case 'rune':
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      if (v % 2 === 0) {
        const yy = 22 + v;
        g.moveTo(4, yy);
        g.lineTo(44, yy);
        g.moveTo(16 + v * 2, 4);
        g.lineTo(16 + v * 2, yy);
      } else {
        g.moveTo(21 + v, 4);
        g.lineTo(21 + v, 44);
      }
      g.stroke();
      if (v === 7) {
        g.strokeStyle = rgba(P.edge2, 0.35);
        circle(g, 24, 24, 5);
        g.stroke();
      }
      break;
    case 'swamp':
      if (v === 1 || v === 3 || v === 6) {
        ellipseFill(g, 18 + r() * 12, 20 + r() * 10, 11, 6, 'rgba(0,0,0,0.28)');
        g.strokeStyle = rgba(P.seamGlow, 0.1);
        g.lineWidth = 0.8;
        g.stroke();
      }
      if (v === 2 || v === 5) {
        for (let i = 0; i < 3; i++) {
          const x = 10 + r() * 28;
          const y = 10 + r() * 28;
          g.strokeStyle = rgba(P.seamGlow, 0.3);
          g.lineWidth = 0.8;
          circle(g, x, y, 1 + r() * 1.5);
          g.stroke();
        }
      }
      break;
    case 'cloud':
      if (v === 0 || v === 4 || v === 7) {
        g.fillStyle = 'rgba(230,248,255,0.05)';
        const x = 8 + r() * 14;
        const y = 14 + r() * 20;
        for (const [dx, dy, rad] of [
          [0, 0, 7],
          [8, -2, 8],
          [16, 1, 6],
        ]) {
          circle(g, x + dx, y + dy, rad);
          g.fill();
        }
      }
      if (v === 2) {
        g.fillStyle = 'rgba(255,255,255,0.55)';
        star(g, 36, 12, 4, 2.6, 0.6);
        g.fill();
      }
      break;
  }
}

/* ---------------- block shadow ---------------- */

/** Soft drop shadow toward the bottom right plus a faint emissive spill from the block's edges. */
export function blockShadow(g: CanvasRenderingContext2D, o: BlockShadowOpts): void {
  const P = pal(o.world);
  g.save();
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(0,0,0,0.1)';
    rr(g, 8 - i * 1.4, 10 - i * 1.4, 42 + i * 2.8, 42 + i * 2.8, 8 + i * 2);
    g.fill();
  }
  additive(g, () => {
    g.fillStyle = rgba(P.edge, 0.045);
    rr(g, -5, -5, 58, 58, 14);
    g.fill();
    g.fillStyle = rgba(P.edge, 0.045);
    rr(g, -2, -2, 52, 52, 10);
    g.fill();
  });
  g.restore();
}

/* ---------------- walls ---------------- */

interface Sides {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

export function wall(g: CanvasRenderingContext2D, o: WallOpts): void {
  const P = pal(o.world);
  const sides: Sides = {
    n: (o.mask & MASK_N) !== 0,
    e: (o.mask & MASK_E) !== 0,
    s: (o.mask & MASK_S) !== 0,
    w: (o.mask & MASK_W) !== 0,
  };
  g.save();
  drawBlock(g, P, sides, o.border, o.variant % 3);
  g.restore();
}

function drawBlock(
  g: CanvasRenderingContext2D,
  P: NeonWorld,
  sides: Sides,
  border: boolean,
  v: number,
): void {
  const I = 2.5;
  const x0 = sides.w ? 0 : I;
  const y0 = sides.n ? 0 : I;
  const x1 = 48 - (sides.e ? 0 : I);
  const y1 = 48 - (sides.s ? 0 : I);
  const R = border ? 5 : 7;
  const tl = !sides.n && !sides.w ? R : 0;
  const tr = !sides.n && !sides.e ? R : 0;
  const br = !sides.s && !sides.e ? R : 0;
  const bl = !sides.s && !sides.w ? R : 0;
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, border ? shade(P.wallTop, 0.17) : P.wallTop);
  gr.addColorStop(1, border ? shade(P.wallBot, 0.2) : P.wallBot);
  g.fillStyle = gr;
  rrc(g, x0, y0, x1, y1, tl, tr, br, bl);
  g.fill();
  g.save();
  rrc(g, x0, y0, x1, y1, tl, tr, br, bl);
  g.clip();
  // glass sheen
  g.fillStyle = 'rgba(255,255,255,0.055)';
  poly(g, [-4, 18, 18, -4, 30, -4, -4, 30]);
  g.fill();
  const horiz = sides.e || sides.w;
  const vert = sides.n || sides.s;
  if (border) {
    // grooves across the run so the barrier reads as a solid rail
    g.fillStyle = 'rgba(0,0,0,0.38)';
    if (horiz && !vert) for (let k = 0; k < 3; k++) g.fillRect(8 + k * 16, 0, 1.6, 48);
    else if (vert && !horiz) for (let k = 0; k < 3; k++) g.fillRect(0, 8 + k * 16, 48, 1.6);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    if (horiz && !vert) for (let k = 0; k < 3; k++) g.fillRect(9.6 + k * 16, 0, 1, 48);
    else if (vert && !horiz) for (let k = 0; k < 3; k++) g.fillRect(0, 9.6 + k * 16, 48, 1);
  }
  wallMotif(g, P, border, v);
  if (!sides.n) {
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(x0, y0, x1 - x0, 1.4);
  }
  if (!sides.s) {
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(x0, y1 - 2.2, x1 - x0, 2.2);
  }
  g.restore();
  // emissive edges on the open sides
  g.lineCap = 'round';
  const e = 1.3;
  if (!sides.n && !sides.s && !sides.e && !sides.w) {
    rrc(g, x0 + e, y0 + e, x1 - e, y1 - e, R - 1, R - 1, R - 1, R - 1);
    neonStroke(g, P.edge, 1.3, 0.95);
    g.strokeStyle = rgba(P.edge, 0.16);
    g.lineWidth = 1;
    rr(g, x0 + 6, y0 + 6, x1 - x0 - 12, y1 - y0 - 12, 3);
    g.stroke();
    g.fillStyle = P.edge2;
    for (const [cx, cy] of [
      [x0 + 4.2, y0 + 4.2],
      [x1 - 4.2, y0 + 4.2],
      [x0 + 4.2, y1 - 4.2],
      [x1 - 4.2, y1 - 4.2],
    ]) {
      circle(g, cx, cy, 0.9);
      g.fill();
    }
  } else {
    g.beginPath();
    if (!sides.n) {
      g.moveTo(x0 + tl, y0 + e);
      g.lineTo(x1 - tr, y0 + e);
    }
    if (!sides.s) {
      g.moveTo(x0 + bl, y1 - e);
      g.lineTo(x1 - br, y1 - e);
    }
    if (!sides.w) {
      g.moveTo(x0 + e, y0 + tl);
      g.lineTo(x0 + e, y1 - bl);
    }
    if (!sides.e) {
      g.moveTo(x1 - e, y0 + tr);
      g.lineTo(x1 - e, y1 - br);
    }
    neonStroke(g, P.edge, 1.2, 0.85);
  }
}

function wallMotif(g: CanvasRenderingContext2D, P: NeonWorld, border: boolean, v: number): void {
  switch (P.motif) {
    case 'panel':
      if (!border) {
        g.strokeStyle = rgba(P.edge, 0.5);
        g.lineWidth = 1.1;
        poly(g, [24, 18.5, 29.5, 24, 24, 29.5, 18.5, 24]);
        g.stroke();
        g.fillStyle = rgba(P.edge2, 0.9);
        circle(g, 24, 24, 1.3);
        g.fill();
      } else if (v === 1) {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        for (let i = 0; i < 3; i++) g.fillRect(14, 18 + i * 4, 20, 1.5);
      }
      break;
    case 'moss': {
      g.fillStyle = 'rgba(30,110,60,0.55)';
      g.beginPath();
      g.moveTo(-2, 30);
      g.bezierCurveTo(6, 22 + v * 3, 10, 10, 26 - v * 3, 6);
      g.bezierCurveTo(30, 2, 34, -2, 40, -2);
      g.lineTo(-2, -2);
      g.closePath();
      g.fill();
      g.strokeStyle = rgba(P.edge, 0.3);
      g.lineWidth = 1;
      polyline(g, [8, 40, 14, 30, 22, 28, 28, 18]);
      g.stroke();
      g.fillStyle = rgba(P.edge2, 0.85);
      for (const [sx, sy] of [
        [10, 12],
        [18, 8],
        [6, 20],
        [30, 24 + v * 4],
      ]) {
        circle(g, sx, sy, 0.9);
        g.fill();
      }
      break;
    }
    case 'sand': {
      // sandstone courses with a carved, glowing chevron band
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 1;
      g.beginPath();
      for (const yy of [15.5, 32.5]) {
        g.moveTo(0, yy);
        g.lineTo(48, yy);
      }
      const off = v * 6;
      g.moveTo(14 + off, 0);
      g.lineTo(14 + off, 15.5);
      g.moveTo(30 - off / 2, 15.5);
      g.lineTo(30 - off / 2, 32.5);
      g.moveTo(10 + off, 32.5);
      g.lineTo(10 + off, 48);
      g.stroke();
      g.fillStyle = 'rgba(255,200,120,0.06)';
      g.fillRect(0, 0, 48, 15.5);
      if (!border || v === 1) {
        g.lineJoin = 'round';
        polyline(g, [9, 27, 16.5, 21, 24, 27, 31.5, 21, 39, 27]);
        neonStroke(g, P.edge, 1.1, 0.8);
      }
      break;
    }
    case 'crystal':
      g.fillStyle = 'rgba(220,245,255,0.09)';
      poly(g, [0, 0, 24, 21, 48, 0]);
      g.fill();
      g.fillStyle = 'rgba(220,245,255,0.04)';
      poly(g, [48, 0, 24, 21, 48, 48]);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.18)';
      poly(g, [0, 48, 24, 21, 48, 48]);
      g.fill();
      g.strokeStyle = 'rgba(200,245,255,0.18)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(24, 21);
      g.lineTo(48, 0);
      g.moveTo(24, 21);
      g.lineTo(24 + (v - 1) * 6, 48);
      g.stroke();
      g.fillStyle = '#ffffff';
      star(g, 14 + v * 8, 11, 4, 3.2, 0.7);
      g.fill();
      break;
    case 'magma': {
      const seams = [
        [6, 10, 16, 20, 13, 31, 22, 42],
        [30, 6, 35, 18, 28, 28, 38, 40],
        [10, 38, 20, 30, 32, 34, 42, 26],
      ];
      const list = border ? [seams[v % 3]] : [seams[0], seams[1]];
      for (const s of list) {
        polyline(g, s);
        g.strokeStyle = 'rgba(255,90,31,0.28)';
        g.lineWidth = 3.6;
        g.stroke();
        polyline(g, s);
        g.strokeStyle = '#ffb347';
        g.lineWidth = 1;
        g.stroke();
      }
      break;
    }
    case 'void': {
      const r = rng(31 + v * 13 + (border ? 7 : 0));
      for (let i = 0; i < 7; i++) {
        g.fillStyle = i % 3 === 0 ? 'rgba(255,200,245,0.8)' : 'rgba(255,255,255,0.55)';
        circle(g, 5 + r() * 38, 5 + r() * 38, 0.5 + r() * 0.7);
        g.fill();
      }
      if (!border || v === 2) {
        g.lineCap = 'round';
        polyline(g, [12, 38, 20, 26, 26, 28, 36, 12]);
        neonStroke(g, P.edge, 1, 0.75);
        g.fillStyle = '#ffffff';
        star(g, 20, 26, 4, 3, 0.6);
        g.fill();
      }
      break;
    }
    case 'rune':
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 16 + v * 4);
      g.lineTo(48, 16 + v * 4);
      g.moveTo(20 + v * 6, 0);
      g.lineTo(20 + v * 6, 16 + v * 4);
      g.stroke();
      if (!border || v === 2) {
        g.beginPath();
        g.arc(24, 27, 7.5, 0, TAU);
        g.moveTo(24, 22);
        g.lineTo(28.5, 27);
        g.lineTo(24, 32);
        g.lineTo(19.5, 27);
        g.closePath();
        g.lineJoin = 'round';
        neonStroke(g, P.edge2, 1.1, 0.8);
        g.fillStyle = rgba(P.edge2, 0.9);
        circle(g, 24, 27, 1.2);
        g.fill();
      }
      break;
    case 'swamp': {
      // algae dripping from the top, toxic bubbles caught in the glass
      g.fillStyle = 'rgba(70,110,30,0.5)';
      g.beginPath();
      g.moveTo(-2, -2);
      g.lineTo(50, -2);
      g.lineTo(50, 8);
      const drips = [44, 36 - v * 3, 28, 19 + v * 2, 10, 2];
      for (let i = 0; i < drips.length; i++) {
        const dx = drips[i];
        const len = 8 + ((i * 5 + v * 3) % 9);
        g.lineTo(dx + 3, 8);
        g.quadraticCurveTo(dx, 8 + len, dx - 3, 8);
      }
      g.lineTo(-2, 8);
      g.closePath();
      g.fill();
      for (const [bx, by, br] of [
        [14 + v * 4, 30, 2.4],
        [32, 36 - v * 2, 1.8],
        [24, 22, 1.2],
      ]) {
        g.strokeStyle = rgba(P.edge, 0.7);
        g.lineWidth = 0.9;
        circle(g, bx, by, br);
        g.stroke();
        glow(g, bx, by, br * 2.5, P.edge, 0.15);
      }
      break;
    }
    case 'cloud': {
      g.fillStyle = 'rgba(240,250,255,0.16)';
      const cx = 18 + v * 4;
      for (const [dx, dy, rad] of [
        [-8, 30, 8],
        [2, 26, 10],
        [12, 31, 7],
        [-2, 34, 7],
      ]) {
        circle(g, cx + dx, dy, rad);
        g.fill();
      }
      g.fillStyle = '#ffffff';
      star(g, 34 - v * 6, 12, 4, 3, 0.6);
      g.fill();
      break;
    }
  }
}

/* ---------------- crates ---------------- */

export function crate(g: CanvasRenderingContext2D, o: CrateOpts): void {
  const P = pal(o.world);
  const cracked = o.kind === 'cracked';
  g.save();
  const gr = g.createLinearGradient(0, 4, 0, 44);
  gr.addColorStop(0, cracked ? shade(P.crate, -0.2) : shade(P.crate, 0.12));
  gr.addColorStop(1, P.crate2);
  g.fillStyle = gr;
  rr(g, 4, 4, 40, 40, 5);
  g.fill();
  g.fillStyle = rgba(P.circuit, 0.06);
  rr(g, 8, 8, 32, 32, 3);
  g.fill();
  // frame
  g.strokeStyle = shade(P.rim, 0.25);
  g.lineWidth = 2.4;
  rr(g, 5.4, 5.4, 37.2, 37.2, 4.4);
  g.stroke();
  g.strokeStyle = rgba(P.circuit, 0.22);
  g.lineWidth = 1;
  rr(g, 4.2, 4.2, 39.6, 39.6, 5);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.fillRect(8, 4.4, 32, 1.2);
  // cargo crate: a quiet cross brace and one light strip
  const ta = cracked ? 0.4 : 0.8;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = shade(P.rim, 0.05);
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(10, 10);
  g.lineTo(38, 38);
  g.moveTo(38, 10);
  g.lineTo(10, 38);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(10, 9);
  g.lineTo(38, 37);
  g.moveTo(38, 9);
  g.lineTo(10, 37);
  g.stroke();
  crateWorldDetail(g, P, o.variant);
  // housing for the strip
  g.fillStyle = 'rgba(3,3,8,0.85)';
  rr(g, 11, 20, 26, 8, 4);
  g.fill();
  g.strokeStyle = shade(P.rim, 0.3);
  g.lineWidth = 1;
  rr(g, 11, 20, 26, 8, 4);
  g.stroke();
  // emissive strip
  g.fillStyle = rgba(P.circuit, ta * 0.35);
  rr(g, 12.5, 21.5, 23, 5, 2.5);
  g.fill();
  g.fillStyle = rgba(P.circuit, cracked ? 0.5 : 0.95);
  rr(g, 14, 22.8, cracked ? 9 : 20, 2.4, 1.2);
  g.fill();
  if (cracked) {
    rr(g, 26, 22.8, 8, 2.4, 1.2);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(16, 23.2, cracked ? 5 : 14, 0.9);
  g.fillStyle = rgba(P.circuit, ta * 0.6);
  for (const [cx, cy] of [
    [9.5, 9.5],
    [38.5, 9.5],
    [9.5, 38.5],
    [38.5, 38.5],
  ]) {
    circle(g, cx, cy, 1);
    g.fill();
  }
  if (o.variant === 1) {
    // stencil marks on the lower panel
    g.fillStyle = rgba(P.circuit, 0.3);
    g.fillRect(29, 33, 6, 1.2);
    g.fillRect(29, 35.4, 4, 1.2);
  }
  if (cracked) {
    g.fillStyle = 'rgba(5,6,13,0.85)';
    poly(g, [4, 4, 13, 4, 4, 12]);
    g.fill();
    poly(g, [44, 44, 34, 44, 44, 35]);
    g.fill();
    const fr = [
      [9, 6, 16, 15, 14, 22, 22, 26],
      [44, 18, 34, 22, 30, 31, 22, 26],
      [22, 26, 18, 34, 22, 42],
    ];
    for (const f of fr) {
      polyline(g, f);
      g.strokeStyle = rgba(P.circuit, 0.35);
      g.lineWidth = 3.6;
      g.stroke();
      polyline(g, f);
      g.strokeStyle = '#fff1d6';
      g.lineWidth = 1;
      g.stroke();
    }
  }
  // the strip's light on the crate face
  additive(g, () => glow(g, 24, 24, 15, P.circuit, cracked ? 0.2 : 0.1));
  g.restore();
}

function crateWorldDetail(g: CanvasRenderingContext2D, P: NeonWorld, variant: number): void {
  switch (P.motif) {
    case 'moss':
      g.fillStyle = 'rgba(40,120,60,0.55)';
      g.beginPath();
      g.moveTo(4, 30);
      g.quadraticCurveTo(9, 34, 6, 44);
      g.lineTo(4, 44);
      g.closePath();
      g.fill();
      circle(g, 40 - variant * 26, 8, 3);
      g.fill();
      break;
    case 'crystal':
      g.fillStyle = 'rgba(230,250,255,0.35)';
      for (let i = 0; i < 5; i++) {
        poly(g, [8 + i * 7, 5, 11 + i * 7, 5, 9.5 + i * 7, 8 + ((i + variant) % 3)]);
        g.fill();
      }
      break;
    case 'magma':
      polyline(g, [6, 40, 12, 33, 9, 27]);
      g.strokeStyle = 'rgba(255,120,40,0.5)';
      g.lineWidth = 1;
      g.stroke();
      break;
    case 'sand':
      g.fillStyle = 'rgba(255,200,120,0.12)';
      poly(g, [4, 44, 4, 36, 16, 44]);
      g.fill();
      break;
    case 'void':
      g.fillStyle = 'rgba(255,200,245,0.7)';
      circle(g, 34 - variant * 20, 34, 0.8);
      g.fill();
      break;
    case 'swamp':
      g.fillStyle = 'rgba(80,120,30,0.45)';
      g.fillRect(4, 38, 40, 6);
      break;
    case 'cloud':
      g.fillStyle = 'rgba(255,255,255,0.08)';
      circle(g, 14, 36, 6);
      g.fill();
      circle(g, 22, 38, 5);
      g.fill();
      break;
    default:
      break;
  }
}
