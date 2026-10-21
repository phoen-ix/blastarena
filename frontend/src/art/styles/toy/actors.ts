import type { Direction, EnemySpriteConfig } from '@blast-arena/shared';
import { circle, marker as markerPath, poly, rgba, rr, shade, star } from '../../paint';
import type { EnemyOpts, EyeStyle, GhostOpts, MarkerShape, PlayerOpts } from '../../painters/types';
import { CREAM, INK, ell, fl, seg, st } from './common';
import type { G } from './common';

const EYE_INK = '#1d1626';
const FOOT = '#3b2d45';
/** Bombers are drawn a little larger than their tile, scaled about the feet. */
const SCALE = 1.1;
const FEET_Y = 19;

/* ================================================================== bomber */

function drawEyes(
  g: G,
  eyes: EyeStyle,
  cx: number,
  cy: number,
  closed: boolean,
  side: boolean,
): void {
  const xs = eyes === 'cyclops' || side ? [cx] : [cx - 4.2, cx + 4.2];
  if (closed) {
    for (const ex of xs) {
      g.beginPath();
      g.arc(ex, cy - 0.5, eyes === 'cyclops' ? 3.2 : 2.4, 0.15 * Math.PI, 0.85 * Math.PI);
      st(g, EYE_INK, 1.5);
    }
    return;
  }
  for (const ex of xs) {
    if (eyes === 'dot') {
      g.fillStyle = EYE_INK;
      circle(g, ex, cy + 0.5, 1.8);
      g.fill();
      continue;
    }
    const big = eyes === 'cyclops';
    const rx = big ? 3.3 : 2.15;
    const ry = big ? 4.3 : eyes === 'angry' ? 2.8 : 3.4;
    g.fillStyle = EYE_INK;
    ell(g, ex, cy + (eyes === 'angry' ? 0.6 : 0), rx, ry);
    g.fill();
    g.fillStyle = '#ffffff';
    circle(g, ex - rx * 0.32, cy - ry * 0.38, big ? 1.3 : 0.95);
    g.fill();
  }
  if (eyes === 'angry') {
    if (side) seg(g, [cx - 2.5, cy - 5.6, cx + 3, cy - 3.6], EYE_INK, 1.7);
    else {
      seg(g, [cx - 7.2, cy - 5.4, cx - 1.8, cy - 3.4], EYE_INK, 1.7);
      seg(g, [cx + 7.2, cy - 5.4, cx + 1.8, cy - 3.4], EYE_INK, 1.7);
    }
  }
}

/**
 * The bomber at origin = tile centre. `frame` -1 = standing, 0..7 = the walk cycle the prototype
 * used (two steps per cycle).
 */
function drawBomber(
  g: G,
  color: string,
  dir: Direction,
  eyes: EyeStyle,
  frame: number,
  closed: boolean,
): void {
  const side = dir === 'left' || dir === 'right';
  if (dir === 'left') g.scale(-1, 1);
  const ph = frame < 0 ? 0 : (frame / 8) * Math.PI * 2;
  const s = frame < 0 ? 0 : Math.sin(ph);
  const c = frame < 0 ? 1 : Math.cos(ph);
  const bob = Math.abs(s) * 1.6;
  const tilt = side ? 0.06 + s * 0.025 : s * 0.06;
  const dark = shade(color, -0.3);
  const mid = shade(color, -0.14);
  const light = shade(color, 0.42);
  // feet
  if (side) {
    const walking = frame < 0 ? 0 : 1;
    const fA = { x: 1 + s * 5, lift: Math.max(0, c) * 3 * walking };
    const fB = { x: 1 - s * 5, lift: Math.max(0, -c) * 3 * walking };
    for (const f of [fB, fA]) {
      ell(g, f.x + 1, 15.6 - f.lift, 6, 3.6);
      fl(g, FOOT);
      st(g, INK, 1.2);
    }
  } else {
    const lL = Math.max(0, s) * 3.2;
    const lR = Math.max(0, -s) * 3.2;
    for (const [fx, lift] of [
      [-6.5, lL],
      [6.5, lR],
    ]) {
      ell(g, fx, 15.6 - lift, 5.6, 3.7);
      fl(g, FOOT);
      st(g, INK, 1.2);
    }
  }
  g.save();
  g.translate(0, -bob);
  g.translate(0, 14);
  g.rotate(tilt);
  g.translate(0, -14);
  // body
  ell(g, 0, 6.6, 10.4, 8.2);
  fl(g, mid);
  g.save();
  ell(g, 0, 6.6, 10.4, 8.2);
  g.clip();
  ell(g, 2.5, 10.5, 10, 6);
  fl(g, dark);
  g.restore();
  ell(g, 0, 6.6, 10.4, 8.2);
  st(g);
  // belt
  g.save();
  ell(g, 0, 6.6, 10.4, 8.2);
  g.clip();
  g.fillStyle = rgba(INK, 0.55);
  g.fillRect(-11, 8.4, 22, 2.2);
  g.restore();
  // hands
  if (side) {
    circle(g, 2 + s * 3, 6 - Math.abs(s) * 0.8, 3.6);
    fl(g, CREAM);
    st(g, INK, 1.2);
  } else {
    const hs = s * 1.6;
    for (const [hx, hy] of [
      [-11.4, 5.6 + hs],
      [11.4, 5.6 - hs],
    ]) {
      circle(g, hx, hy, 3.6);
      fl(g, CREAM);
      st(g, INK, 1.2);
    }
  }
  // antenna knob
  const kx = side ? -2.5 : 0;
  seg(g, [0, -21, kx, -26], INK, 1.7);
  circle(g, kx, -27.6, 3.3);
  fl(g, light);
  st(g, INK, 1.3);
  // head
  circle(g, 0, -8.6, 14.2);
  fl(g, dark);
  g.save();
  circle(g, 0, -8.6, 14.2);
  g.clip();
  circle(g, -1.6, -10.4, 13.2);
  fl(g, color);
  ell(g, -5.5, -15.6, 5.2, 3.4, -0.5);
  fl(g, rgba('#ffffff', 0.42));
  g.restore();
  circle(g, 0, -8.6, 14.2);
  st(g);
  if (dir === 'up') {
    // back of the helmet: a vent stripe and a lighter cap
    g.save();
    circle(g, 0, -8.6, 14.2);
    g.clip();
    rr(g, -6, -4, 12, 3.4, 1.7);
    fl(g, rgba(INK, 0.45));
    rr(g, -4, 0.5, 8, 2.6, 1.3);
    fl(g, rgba(INK, 0.3));
    g.restore();
  } else {
    const vx = side ? 5.2 : 0;
    const rx = side ? 7.4 : 10;
    ell(g, vx, -6.4, rx, 7.6);
    fl(g, CREAM);
    st(g, INK, 1.3);
    drawEyes(g, eyes, side ? vx + 2 : 0, -6.6, closed, side);
    if (!side && eyes !== 'cyclops') {
      g.fillStyle = 'rgba(255,120,120,0.35)';
      ell(g, -7, -2.4, 1.8, 1.1);
      g.fill();
      ell(g, 7, -2.4, 1.8, 1.1);
      g.fill();
    }
  }
  g.restore();
}

/** Walk steps map onto the prototype's 8-frame cycle: contact, passing, contact, passing. */
const STEP_FRAME = [0, 2, 4, 6];

export function player(g: G, o: PlayerOpts): void {
  const frame = o.pose.kind === 'walk' ? STEP_FRAME[o.pose.step] : -1;
  const closed = o.pose.kind === 'idle' && o.pose.blink;
  g.save();
  g.translate(0, FEET_Y);
  g.scale(SCALE, SCALE);
  g.translate(0, -FEET_Y);
  drawBomber(g, o.color, o.dir, o.eyes, frame, closed);
  g.restore();
}

/** The knockout ghost with its halo, centred a little above the origin. */
export function ghost(g: G, o: GhostOpts): void {
  const body = shade('#f8f4ff', 0);
  const tint = rgba(o.color, 0.16);
  g.save();
  g.translate(0, -6);
  g.scale(1.2, 1.2);
  ell(g, 0, -15, 7, 2.4);
  st(g, '#ffd65a', 2.2);
  const path = (): void => {
    g.beginPath();
    g.moveTo(-10, 8);
    g.lineTo(-10, -4);
    g.arc(0, -4, 10, Math.PI, 0);
    g.lineTo(10, 8);
    for (let i = 0; i < 4; i++) {
      const x0 = 10 - i * 5;
      g.quadraticCurveTo(x0 - 2.5, 8 + (i % 2 ? -3 : 3), x0 - 5, 8);
    }
    g.closePath();
  };
  path();
  fl(g, rgba(body, 0.94));
  path();
  fl(g, tint);
  path();
  st(g, rgba(INK, 0.6), 1.3);
  g.fillStyle = EYE_INK;
  ell(g, -3.4, -4, 1.5, 2.2);
  g.fill();
  ell(g, 3.4, -4, 1.5, 2.2);
  g.fill();
  ell(g, 0, 1.5, 1.6, 1.2);
  g.fill();
  g.restore();
}

/** Soap-bubble shield around a bomber; frames 0..3 breathe and walk a glint around. */
export function shield(g: G, o: { frame: number }): void {
  const a = (o.frame / 4) * Math.PI * 2;
  const r = 25 + Math.sin(a) * 1;
  const cy = -6;
  circle(g, 0, cy, r);
  fl(g, 'rgba(140,255,200,0.16)');
  st(g, 'rgba(200,255,230,0.85)', 1.8);
  g.beginPath();
  g.arc(0, cy, r - 4, Math.PI * 1.1, Math.PI * 1.45);
  st(g, 'rgba(255,255,255,0.85)', 2.4);
  const ga = -Math.PI / 4 + a;
  circle(g, Math.cos(ga) * (r - 2), cy + Math.sin(ga) * (r - 2), 1.8);
  fl(g, 'rgba(255,255,255,0.9)');
  circle(g, Math.cos(ga + Math.PI) * (r - 2), cy + Math.sin(ga + Math.PI) * (r - 2), 1.2);
  fl(g, 'rgba(255,255,255,0.6)');
}

/** Chest badge for the colour-blind shape markers. */
export function marker(g: G, o: { shape: MarkerShape; color: string }): void {
  const y = 6.5;
  circle(g, 0, y, 5);
  fl(g, CREAM);
  st(g, INK, 1.1);
  markerPath(g, o.shape, 0, y, 3);
  fl(g, shade(o.color, -0.35));
}

/* ================================================================== enemies */

interface EnemyLook {
  primary: string;
  secondary: string;
  dark: string;
  light: string;
}

function lookOf(sprite: EnemySpriteConfig): EnemyLook {
  const primary = sprite.primaryColor || '#44cc44';
  const secondary = sprite.secondaryColor || shade(primary, -0.45);
  return { primary, secondary, dark: shade(primary, -0.32), light: shade(primary, 0.4) };
}

/** Where the face sits (head centre) for each body, in canonical (facing down) coordinates. */
const FACE_Y: Record<string, number> = {
  blob: -2,
  spiky: -1,
  ghost: -6,
  robot: -6,
  bug: -4,
  skull: -6,
};

/** Top of the head, for horns, crowns and bandanas. */
const HEAD_TOP: Record<string, number> = {
  blob: -16,
  spiky: -19,
  ghost: -22,
  robot: -20,
  bug: -17,
  skull: -22,
};

function bodyPath(g: G, shape: string, sq: number): void {
  switch (shape) {
    case 'spiky':
      circle(g, 0, 0, 15.5);
      return;
    case 'ghost': {
      g.beginPath();
      g.moveTo(-15, 10);
      g.lineTo(-15, -6);
      g.arc(0, -6, 15, Math.PI, 0);
      g.lineTo(15, 10);
      for (let i = 0; i < 4; i++) {
        const x0 = 15 - i * 7.5;
        g.quadraticCurveTo(x0 - 3.75, 10 + (i % 2 ? -4 : 4) * (1 + sq * 2), x0 - 7.5, 10);
      }
      g.closePath();
      return;
    }
    case 'robot':
      rr(g, -15, -20, 30, 34, 6);
      return;
    case 'bug':
      ell(g, 0, 0, 15, 17);
      return;
    case 'skull':
      g.beginPath();
      g.arc(0, -6, 16, Math.PI * 0.8, Math.PI * 0.2);
      g.lineTo(9, 13);
      g.quadraticCurveTo(0, 17, -9, 13);
      g.closePath();
      return;
    default:
      // blob: a squishy dome, flat at the bottom
      g.beginPath();
      g.moveTo(-17, 12);
      g.bezierCurveTo(-19, -4, -12, -17, 0, -17);
      g.bezierCurveTo(12, -17, 19, -4, 17, 12);
      g.quadraticCurveTo(0, 16, -17, 12);
      g.closePath();
  }
}

function enemyEyes(
  g: G,
  style: string,
  cx: number,
  cy: number,
  side: boolean,
  skullSockets: boolean,
  look: EnemyLook,
): void {
  const xs = side ? [cx + 4] : [cx - 6, cx + 6];
  if (skullSockets) {
    // dark sockets with a glowing pupil
    for (const ex of xs) {
      ell(g, ex, cy, 4.6, 5);
      fl(g, shade(look.secondary, -0.5));
      circle(g, ex + (side ? 1 : 0), cy + 0.5, 1.6);
      fl(g, style === 'angry' ? '#ff5a4a' : style === 'crazy' ? '#ffe14a' : '#bff0ff');
    }
    return;
  }
  xs.forEach((ex, i) => {
    let r = 4.4;
    let sclera = '#ffffff';
    if (style === 'angry') sclera = '#ffd2c8';
    if (style === 'crazy') {
      sclera = '#fff36a';
      r = i === 0 ? 5.4 : 3.6;
    }
    circle(g, ex, cy, r);
    fl(g, sclera);
    st(g, INK, 1.2);
    const pr = style === 'crazy' ? (i === 0 ? 2.6 : 1.4) : 2;
    const px = side ? ex + 1.5 : ex + (style === 'crazy' && i === 1 ? -0.8 : 0);
    circle(g, px, cy + (style === 'sleepy' ? 1.4 : 0.6), pr);
    fl(g, EYE_INK);
    circle(g, px - pr * 0.4, cy - 0.4, pr * 0.35);
    fl(g, '#ffffff');
    if (style === 'sleepy') {
      // heavy lids
      g.save();
      circle(g, ex, cy, r);
      g.clip();
      g.fillStyle = look.dark;
      g.fillRect(ex - r, cy - r, r * 2, r * 0.95);
      g.restore();
      seg(g, [ex - r, cy - 0.2, ex + r, cy - 0.2], INK, 1.2);
    }
  });
  if (style === 'angry') {
    if (side) seg(g, [cx + 0.5, cy - 7, cx + 8, cy - 4.5], INK, 2);
    else {
      seg(g, [cx - 10.5, cy - 7.5, cx - 3, cy - 4.5], INK, 2);
      seg(g, [cx + 10.5, cy - 7.5, cx + 3, cy - 4.5], INK, 2);
    }
  }
}

function drawEnemyBody(
  g: G,
  sprite: EnemySpriteConfig,
  look: EnemyLook,
  dir: Direction,
  sq: number,
): void {
  const shape = sprite.bodyShape;
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';
  // body-specific underlay (legs, treads, spikes)
  if (shape === 'bug') {
    for (const ly of [-7, 1, 9]) {
      for (const sx of [-1, 1]) {
        seg(g, [sx * 12, ly, sx * 19, ly + 3 + sq * 2, sx * 20, ly + 7], INK, 2.8);
        seg(g, [sx * 12, ly, sx * 19, ly + 3 + sq * 2, sx * 20, ly + 7], look.secondary, 1.4);
      }
    }
  }
  if (shape === 'spiky') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2 + Math.PI / 8;
      const bx = Math.cos(a);
      const by = Math.sin(a);
      poly(g, [
        bx * 13 - by * 4.5,
        by * 13 + bx * 4.5,
        bx * (23 + sq * 2),
        by * (23 + sq * 2),
        bx * 13 + by * 4.5,
        by * 13 - bx * 4.5,
      ]);
      fl(g, look.secondary);
      st(g, INK, 1.2);
    }
  }
  if (shape === 'robot') {
    for (const tx of [-9, 9]) {
      rr(g, tx - 5, 11 - sq, 10, 6, 2.5);
      fl(g, '#4a4552');
      st(g, INK, 1.1);
    }
  }
  // body
  bodyPath(g, shape, sq);
  fl(g, look.primary);
  g.save();
  bodyPath(g, shape, sq);
  g.clip();
  ell(g, 6, 12, 18, 12);
  fl(g, look.dark);
  ell(g, -6, -10, 7, 4.5, -0.5);
  fl(g, rgba('#ffffff', 0.35));
  if (shape === 'bug') {
    // shell segments
    seg(g, [-15, -4, 15, -4], rgba(INK, 0.45), 1.4);
    seg(g, [-15, 5, 15, 5], rgba(INK, 0.45), 1.4);
    if (back) seg(g, [0, -17, 0, 17], rgba(INK, 0.55), 1.6);
  }
  g.restore();
  bodyPath(g, shape, sq);
  st(g, INK, 1.6);
  if (shape === 'robot') {
    // antenna and chest plate
    seg(g, [0, -20, 0, -26], INK, 1.8);
    circle(g, 0, -27.5, 3);
    fl(g, look.secondary);
    st(g, INK, 1.2);
    if (!back) {
      rr(g, -8, 2, 16, 8, 2);
      fl(g, rgba(look.secondary, 0.85));
      st(g, INK, 1.1);
      g.fillStyle = '#ffe66a';
      circle(g, -3, 6, 1.4);
      g.fill();
      circle(g, 3, 6, 1.4);
      g.fill();
    }
  }
  if (shape === 'skull' && !back) {
    // jaw line and nose
    seg(g, [-8, 8, 8, 8], rgba(INK, 0.5), 1.2);
    for (const tx of [-4, 0, 4]) seg(g, [tx, 8, tx, 12.5], rgba(INK, 0.45), 1);
    if (!side) {
      poly(g, [0, 0, -2.4, 4, 2.4, 4]);
      fl(g, shade(look.secondary, -0.4));
    }
  }
  if (shape === 'bug' && !back) {
    for (const sx of side ? [1] : [-1, 1]) {
      seg(g, [sx * 5, -15, sx * 10, -23], INK, 1.4);
      circle(g, sx * 10.5, -24, 2);
      fl(g, look.secondary);
    }
  }
  if (sprite.hasScar ?? false) {
    seg(g, [4, -10, -4, 2], shade(look.primary, -0.5), 2);
    seg(g, [-2, -6, 2, -2], shade(look.primary, -0.5), 1.4);
    seg(g, [2, -8, -2, -4], shade(look.primary, -0.5), 1.4);
  }
  if (back) return;
  const faceX = side ? 4 : 0;
  enemyEyes(g, sprite.eyeStyle, faceX, FACE_Y[shape] ?? -2, side, shape === 'skull', look);
  if (sprite.hasTeeth) {
    const my = (FACE_Y[shape] ?? -2) + 9;
    const xs = side ? [4, 8] : [-6, -2, 2, 6];
    g.beginPath();
    for (const tx of xs) {
      g.moveTo(tx - 2, my);
      g.lineTo(tx + 2, my);
      g.lineTo(tx, my + 4);
      g.closePath();
    }
    fl(g, '#ffffff');
    st(g, INK, 1);
  }
}

function drawEnemyExtras(
  g: G,
  sprite: EnemySpriteConfig,
  look: EnemyLook,
  dir: Direction,
  front: boolean,
): void {
  const shape = sprite.bodyShape;
  const side = dir === 'left' || dir === 'right';
  const back = dir === 'up';
  const top = HEAD_TOP[shape] ?? -17;
  if (!front) {
    // things behind the body
    if (sprite.hasWings ?? false) {
      for (const sx of side ? [-1] : [-1, 1]) {
        g.beginPath();
        g.moveTo(sx * 12, -4);
        g.quadraticCurveTo(sx * 26, -18, sx * 28, -6);
        g.quadraticCurveTo(sx * 22, -6, sx * 24, 2);
        g.quadraticCurveTo(sx * 18, 0, sx * 12, 6);
        g.closePath();
        fl(g, rgba(look.secondary, 0.92));
        st(g, INK, 1.2);
      }
    }
    if (sprite.hasTail ?? false) {
      const tx = side ? -15 : back ? 0 : 13;
      const ty = side ? 6 : back ? 14 : 10;
      seg(g, [tx * 0.6, ty, tx, ty + 2, tx + (side ? -5 : 4), ty - 4], INK, 4.6);
      seg(g, [tx * 0.6, ty, tx, ty + 2, tx + (side ? -5 : 4), ty - 4], look.secondary, 2.8);
      poly(g, [
        tx + (side ? -5 : 4) - 3,
        ty - 4,
        tx + (side ? -5 : 4),
        ty - 10,
        tx + (side ? -5 : 4) + 3,
        ty - 4,
      ]);
      fl(g, look.secondary);
      st(g, INK, 1);
    }
    return;
  }
  if (sprite.hasHorns) {
    for (const sx of side ? [1] : [-1, 1]) {
      const hx = side ? 2 : sx * 8;
      poly(g, [hx - 3.5, top + 4, hx + sx * 3 + (side ? 1 : 0), top - 7, hx + 3.5, top + 4]);
      fl(g, '#f2e6cf');
      st(g, INK, 1.2);
    }
  } else if (sprite.hasCrown ?? false) {
    const cy = top + 2;
    poly(g, [-8, cy, -9, cy - 8, -4, cy - 4, 0, cy - 10, 4, cy - 4, 9, cy - 8, 8, cy]);
    fl(g, '#ffd23f');
    st(g, INK, 1.3);
    g.fillStyle = '#e2493c';
    circle(g, 0, cy - 3, 1.5);
    g.fill();
  }
  const acc = sprite.accessory ?? 'none';
  if (acc === 'bandana') {
    const by = top + 6;
    g.save();
    bodyPath(g, shape, 0);
    g.clip();
    g.fillStyle = look.secondary;
    g.fillRect(-20, by, 40, 5);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (const dx of [-10, -2, 6, 14]) {
      circle(g, dx, by + 2.5, 0.9);
      g.fill();
    }
    g.restore();
    seg(g, [-18, by, 18, by], INK, 1);
    seg(g, [-18, by + 5, 18, by + 5], INK, 1);
    poly(g, [14, by + 1, 21, by - 4, 20, by + 4, 22, by + 8, 14, by + 5]);
    fl(g, look.secondary);
    st(g, INK, 1);
  } else if (acc === 'bow_tie' && !back) {
    const by = (FACE_Y[shape] ?? -2) + 15;
    const bx = side ? 4 : 0;
    poly(g, [bx, by, bx - 6, by - 4, bx - 6, by + 4]);
    fl(g, look.secondary);
    st(g, INK, 1.1);
    poly(g, [bx, by, bx + 6, by - 4, bx + 6, by + 4]);
    fl(g, look.secondary);
    st(g, INK, 1.1);
    circle(g, bx, by, 1.8);
    fl(g, shade(look.secondary, 0.3));
    st(g, INK, 1);
  } else if (acc === 'monocle' && !back) {
    const ex = side ? 8 : 6;
    const ey = FACE_Y[shape] ?? -2;
    circle(g, ex, ey, 6.2);
    st(g, '#d9b44a', 1.6);
    seg(g, [ex + 4, ey + 4.5, ex + 7, ey + 13], '#d9b44a', 1);
  }
}

export function enemy(g: G, o: EnemyOpts): void {
  const look = lookOf(o.sprite);
  const sq = o.frame === 1 ? 1 : 0;
  const ghostly = o.sprite.bodyShape === 'ghost';
  g.save();
  if (o.sprite.hasAura ?? false) {
    const gr = g.createRadialGradient(0, -2, 6, 0, -2, 28);
    gr.addColorStop(0, rgba(look.secondary, 0.4));
    gr.addColorStop(1, rgba(look.secondary, 0));
    g.fillStyle = gr;
    circle(g, 0, -2, 28);
    g.fill();
  }
  if (o.dir === 'left') g.scale(-1, 1);
  // a small squash on frame 1, about the feet; ghosts bob instead
  if (ghostly) g.translate(0, -2 - sq * 2);
  else {
    g.translate(0, 16);
    g.scale(1 + 0.05 * sq, 1 - 0.06 * sq);
    g.translate(0, -16);
  }
  drawEnemyExtras(g, o.sprite, look, o.dir, false);
  if (ghostly) g.globalAlpha = 0.9;
  drawEnemyBody(g, o.sprite, look, o.dir, sq);
  g.globalAlpha = 1;
  drawEnemyExtras(g, o.sprite, look, o.dir, true);
  g.restore();
}

/** A five-pointed sparkle, used by power-ups and fx. */
export function sparkle(g: G, x: number, y: number, r: number, color = '#ffffff'): void {
  g.fillStyle = color;
  star(g, x, y, 4, r, r * 0.26);
  g.fill();
}
