import * as THREE from 'three';
import { PAL } from './palette.js';
import {
  BASE, PLATFORM, PLATFORM_Y, RAMP_FRONT, RAMP_BACK, PATH_POLYLINES, PATH_HALF_WIDTH, inPond, OPERATOR_SPOT,
} from './world.js';

const UP = new THREE.Vector3(0, 1, 0);

function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / l2)) : 0;
  return Math.hypot(ax + abx * t - px, az + abz * t - pz);
}

export function pathDistance(x, z) {
  let best = Infinity;
  for (const pl of PATH_POLYLINES) {
    for (let i = 0; i < pl.length - 1; i++) {
      best = Math.min(best, distToSegment(x, z, pl[i][0], pl[i][1], pl[i + 1][0], pl[i + 1][1]));
    }
  }
  return best;
}

const QUEUE_AREA = { x0: 2.6, x1: 14.2, z0: 16.9, z1: 26.6 };
const STATION_AREA = { x0: -22, x1: -4, z0: 8.4, z1: 20.4 };
const inRect = (r, x, z, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;

/** True where support footers / trees must not be placed. */
export function isBlocked(x, z, margin = 0.8) {
  if (x < BASE.x0 + 1.2 || x > BASE.x1 - 1.2 || z < BASE.z0 + 1.2 || z > BASE.z1 - 1.2) return true;
  if (inRect(STATION_AREA, x, z, margin) || inRect(QUEUE_AREA, x, z, margin)) return true;
  if (inRect(RAMP_FRONT, x, z, margin + 0.5) || inRect(RAMP_BACK, x, z, margin + 0.5)) return true;
  if (pathDistance(x, z) < PATH_HALF_WIDTH + margin) return true;
  if (inPond(x, z, 0.6)) return true;
  return false;
}

// 5-row pixel font (variable width) for the sign.
const FONT = {
  H: ['1001', '1001', '1111', '1001', '1001'],
  A: ['0110', '1001', '1111', '1001', '1001'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  E: ['111', '100', '110', '100', '111'],
  R: ['1110', '1001', '1110', '1010', '1001'],
  D: ['1110', '1001', '1001', '1001', '1110'],
};

function textColumns(text) {
  const cols = [];
  [...text].forEach((ch, i) => {
    const g = FONT[ch];
    if (i > 0) cols.push(null);
    for (let c = 0; c < g[0].length; c++) cols.push(g.map((row) => row[c] === '1'));
  });
  return cols;
}

function fence(boxes, x0, z0, x1, z1) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 1.4));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    boxes.box(x0 + (x1 - x0) * t, 0.45, z0 + (z1 - z0) * t, 0.14, 0.9, 0.14, PAL.grey[1]);
  }
  const a = new THREE.Vector3(x0, 0.86, z0);
  const b = new THREE.Vector3(x1, 0.86, z1);
  boxes.segment(a, b, 0.09, 0.09, UP, PAL.blue[1], 0.07);
  a.y = b.y = 0.46;
  boxes.segment(a, b, 0.07, 0.07, UP, PAL.blue[2], 0.07);
}

function tree(boxes, x, z, rnd) {
  const kind = rnd();
  if (kind < 0.55) {
    const h = 1.8 + rnd() * 0.8;
    boxes.minMax(x - 0.25, 0, z - 0.25, x + 0.25, h + 0.3, z + 0.25, PAL.brown[2]);
    const w = 2.2 + rnd() * 0.6;
    boxes.minMax(x - w / 2, h, z - w / 2, x + w / 2, h + 1.5, z + w / 2, PAL.grass[3]);
    boxes.minMax(x - w / 3, h + 1.5, z - w / 3, x + w / 3, h + 2.2, z + w / 3, PAL.grass[4]);
    for (let i = 0; i < 3; i++) {
      const ox = (rnd() - 0.5) * w;
      const oz = (rnd() - 0.5) * w;
      const sz = 0.7 + rnd() * 0.4;
      boxes.box(x + ox, h + 0.3 + rnd() * 1.0, z + oz, sz, sz, sz, i === 0 ? PAL.grass[2] : PAL.grass[4]);
    }
  } else if (kind < 0.85) {
    boxes.minMax(x - 0.2, 0, z - 0.2, x + 0.2, 1.1, z + 0.2, PAL.brown[1]);
    const layers = [[2.3, PAL.grass[1]], [1.75, PAL.grass[2]], [1.2, PAL.grass[2]], [0.6, PAL.grass[3]]];
    let y = 0.9;
    for (const [w, c] of layers) {
      boxes.minMax(x - w / 2, y, z - w / 2, x + w / 2, y + 0.85, z + w / 2, c);
      y += 0.85;
    }
  } else {
    const w = 1.0 + rnd() * 0.5;
    boxes.minMax(x - w / 2, 0, z - w / 2, x + w / 2, 0.8 + rnd() * 0.3, z + w / 2, PAL.grass[3]);
    boxes.box(x + 0.2, 0.9, z - 0.1, 0.18, 0.18, 0.18, rnd() < 0.5 ? PAL.pink[0] : PAL.red[3]);
  }
}

function lamp(boxes, x, z) {
  boxes.minMax(x - 0.3, 0, z - 0.3, x + 0.3, 0.2, z + 0.3, PAL.grey[1]);
  boxes.minMax(x - 0.08, 0, z - 0.08, x + 0.08, 2.8, z + 0.08, PAL.ink[2]);
  boxes.minMax(x - 0.22, 2.75, z - 0.22, x + 0.22, 3.15, z + 0.22, PAL.yellow[2]);
  boxes.minMax(x - 0.28, 3.15, z - 0.28, x + 0.28, 3.27, z + 0.28, PAL.ink[2]);
}

function bench(boxes, x, z, alongX) {
  const [sx, sz] = alongX ? [1.5, 0.5] : [0.5, 1.5];
  boxes.box(x, 0.45, z, sx, 0.12, sz, PAL.brown[3]);
  const [bx, bz] = alongX ? [0, 0.2] : [0.2, 0];
  boxes.box(x + bx, 0.8, z + bz, alongX ? 1.5 : 0.1, 0.45, alongX ? 0.1 : 1.5, PAL.brown[3]);
  for (const s of [-1, 1]) {
    const lx = alongX ? s * 0.6 : 0;
    const lz = alongX ? 0 : s * 0.6;
    boxes.box(x + lx, 0.2, z + lz, 0.12, 0.4, 0.12, PAL.ink[1]);
  }
}

export function buildScenery({ boxes, hearts, supports, rnd }) {
  const heartClear = (x, y, z, r) => !hearts.some((h) => h.distanceToSquared(new THREE.Vector3(x, y, z)) < r * r);

  // --- Diorama slab with strata ---
  const { x0, x1, z0, z1 } = BASE;
  boxes.minMax(x0, -1.9, z0, x1, -0.5, z1, PAL.brown[2]);
  boxes.minMax(x0 + 0.01, -3.1, z0 + 0.01, x1 - 0.01, -1.9, z1 - 0.01, PAL.brown[1]);
  boxes.minMax(x0 + 0.02, -3.9, z0 + 0.02, x1 - 0.02, -3.1, z1 - 0.02, PAL.grey[0]);
  for (let i = 0; i < 70; i++) {
    const onX = rnd() < 0.5;
    const t = rnd();
    const y = -0.8 - rnd() * 2.8;
    const col = y < -3.1 ? PAL.grey[1] : y < -1.9 ? PAL.brown[0] : PAL.brown[3];
    if (onX) boxes.box(x0 + 1 + t * (x1 - x0 - 2), y, z1 + 0.02, 0.6 + rnd(), 0.3 + rnd() * 0.3, 0.1, col);
    else boxes.box(x1 + 0.02, y, z0 + 1 + t * (z1 - z0 - 2), 0.1, 0.3 + rnd() * 0.3, 0.6 + rnd(), col);
  }

  // --- Ground tiles ---
  for (let x = x0; x < x1; x++) {
    for (let z = z0; z < z1; z++) {
      const cx = x + 0.5;
      const cz = z + 0.5;
      const h = hash(x, z);
      if (inPond(cx, cz)) {
        boxes.minMax(x, -0.5, z, x + 1, -0.32, z + 1, h < 0.12 ? PAL.blue[4] : PAL.blue[3]);
        continue;
      }
      if (inPond(cx, cz, 0.9)) {
        boxes.minMax(x, -0.5, z, x + 1, -0.04, z + 1, h < 0.5 ? PAL.sand[1] : PAL.sand[2]);
        continue;
      }
      const pd = pathDistance(cx, cz);
      if (pd < PATH_HALF_WIDTH) {
        const edge = pd > PATH_HALF_WIDTH - 0.6;
        boxes.minMax(x, -0.5, z, x + 1, -0.02, z + 1, edge ? PAL.sand[1] : h < 0.3 ? PAL.sand[3] : PAL.sand[2]);
        continue;
      }
      const col = h < 0.62 ? PAL.grass[4] : h < 0.86 ? PAL.grass[3] : h < 0.96 ? PAL.grass[5] : PAL.lime[0];
      boxes.minMax(x, -0.5, z, x + 1, 0, z + 1, col);
    }
  }

  // --- Station ---
  const P = PLATFORM;
  boxes.minMax(P.x0, 0, P.z0, P.x1, PLATFORM_Y - 0.06, P.z1, PAL.grey[1]);
  boxes.minMax(P.x0, PLATFORM_Y - 0.06, P.z0, P.x1, PLATFORM_Y, P.z1, PAL.grey[3]);
  boxes.minMax(P.x0 + 0.2, PLATFORM_Y - 0.06, 12.0, P.x1 - 0.2, PLATFORM_Y + 0.005, 16.0, PAL.grey[2]);
  for (const z of [12.0, 16.0]) boxes.minMax(P.x0 + 0.2, PLATFORM_Y - 0.06, z - 0.12, P.x1 - 0.2, PLATFORM_Y + 0.01, z + 0.12, PAL.yellow[1]);
  for (const ramp of [RAMP_FRONT, RAMP_BACK]) {
    const zc = (ramp.z0 + ramp.z1) / 2;
    const w = ramp.z1 - ramp.z0;
    const a = new THREE.Vector3(ramp.x1 + 0.1, -0.13, zc);
    const b = new THREE.Vector3(ramp.x0, PLATFORM_Y - 0.13, zc);
    boxes.segment(a, b, w, 0.26, UP, PAL.grey[3], 0);
    for (const side of [-1, 1]) {
      const zr = zc + side * (w / 2 + 0.05);
      const ra = new THREE.Vector3(ramp.x1, 0.9, zr);
      const rb = new THREE.Vector3(ramp.x0, PLATFORM_Y + 0.9, zr);
      boxes.segment(ra, rb, 0.09, 0.09, UP, PAL.teal[2], 0.05);
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const px = ramp.x1 + (ramp.x0 - ramp.x1) * t;
        const py = PLATFORM_Y * t;
        boxes.minMax(px - 0.06, py - 0.1, zr - 0.06, px + 0.06, py + 0.9, zr + 0.06, PAL.grey[1]);
      }
    }
    for (let i = 1; i < 4; i++) {
      const px = ramp.x1 + (ramp.x0 - ramp.x1) * (i / 4);
      boxes.minMax(px - 0.15, 0, zc - w / 2 + 0.2, px + 0.15, PLATFORM_Y * (i / 4) - 0.2, zc + w / 2 - 0.2, PAL.grey[1]);
    }
  }
  const pillarX = [-21, -17, -13, -9, -5];
  for (const x of pillarX) {
    boxes.minMax(x - 0.18, PLATFORM_Y, 9.35 - 0.18, x + 0.18, 5.9, 9.35 + 0.18, PAL.cream[0]);
    boxes.minMax(x - 0.15, PLATFORM_Y, 19.32 - 0.15, x + 0.15, 4.6, 19.32 + 0.15, PAL.cream[0]);
    boxes.minMax(x - 0.2, 5.85, 8.9, x + 0.2, 6.15, 15.2, PAL.cream[0]);
    boxes.minMax(x - 0.13, 4.95, 13.87, x + 0.13, 5.9, 14.13, PAL.grey[1]);
    boxes.minMax(x - 0.26, 4.9, 13.6, x + 0.26, 5.05, 14.4, PAL.grey[1]);
  }
  // Back canopy (carries the sign) + a low striped awning at the front. Both are placed so the
  // isometric sight-lines to the parked train and the boarding walkway stay clear.
  for (let x = -21.6, i = 0; x < -4.4; x += 1.72, i++) {
    const x1 = Math.min(x + 1.72, -4.4);
    const c = i % 2 ? PAL.cream[0] : PAL.red[2];
    boxes.minMax(x, 6.15, 8.6, x1, 6.45, 11.4, c);
    boxes.minMax(x, 4.6, 19.4, x1, 4.85, 20.3, c);
    boxes.minMax(x + 0.2, 4.4, 20.18, x1 - 0.2, 4.6, 20.3, c);
  }
  boxes.minMax(-21.2, 6.45, 9.1, -4.8, 6.75, 10.9, PAL.red[2]);
  boxes.minMax(-20.8, 6.75, 9.6, -5.2, 7.0, 10.4, PAL.cream[0]);
  boxes.minMax(-21.2, 5.85, 13.86, -4.8, 6.12, 14.14, PAL.grey[1]);

  // Operator console & booth.
  const O = OPERATOR_SPOT;
  boxes.minMax(O.x - 0.35, PLATFORM_Y, O.z - 0.82, O.x + 0.35, PLATFORM_Y + 0.95, O.z - 0.48, PAL.grey[0]);
  boxes.minMax(O.x - 0.38, PLATFORM_Y + 0.95, O.z - 0.86, O.x + 0.38, PLATFORM_Y + 1.02, O.z - 0.44, PAL.ink[1]);
  boxes.box(O.x - 0.18, PLATFORM_Y + 1.06, O.z - 0.65, 0.12, 0.08, 0.12, PAL.grass[4]);
  boxes.box(O.x + 0.15, PLATFORM_Y + 1.06, O.z - 0.65, 0.14, 0.08, 0.14, PAL.red[2]);
  boxes.minMax(-20.9, PLATFORM_Y, 17.7, -19.4, PLATFORM_Y + 2.3, 19.2, PAL.cream[0]);
  boxes.minMax(-21.0, PLATFORM_Y + 2.3, 17.6, -19.3, PLATFORM_Y + 2.5, 19.3, PAL.blue[2]);
  boxes.minMax(-20.6, PLATFORM_Y + 1.2, 17.66, -19.7, PLATFORM_Y + 1.9, 17.7, PAL.blue[4]);

  // Platform end railings.
  for (const x of [P.x0 + 0.1]) {
    const a = new THREE.Vector3(x, PLATFORM_Y + 0.9, P.z0 + 0.2);
    const b = new THREE.Vector3(x, PLATFORM_Y + 0.9, P.z1 - 0.2);
    boxes.segment(a, b, 0.09, 0.09, UP, PAL.teal[2], 0);
    for (let z = P.z0 + 0.2; z <= P.z1; z += 1.6) boxes.minMax(x - 0.06, PLATFORM_Y, z - 0.06, x + 0.06, PLATFORM_Y + 0.9, z + 0.06, PAL.grey[1]);
  }
  for (const z of [17.35, 19.45]) boxes.minMax(-5.4, PLATFORM_Y, z - 0.1, -5.15, PLATFORM_Y + 1.2, z + 0.1, PAL.yellow[1]);

  // --- HAMMERHEAD sign on the station's back canopy, facing the entrance plaza (double-sided) ---
  const px = 0.3;
  const cols = textColumns('HAMMERHEAD');
  const textW = cols.length * px;
  const signCx = -13;
  const signZ = 8.76;
  const boardW = textW + 1.3;
  const boardY0 = 6.55;
  const boardH = 5 * px + 1.1;
  boxes.minMax(signCx - boardW / 2, boardY0, signZ - 0.16, signCx + boardW / 2, boardY0 + boardH, signZ + 0.16, PAL.blue[0]);
  boxes.minMax(signCx - boardW / 2 - 0.22, boardY0 - 0.22, signZ - 0.2, signCx + boardW / 2 + 0.22, boardY0, signZ + 0.2, PAL.red[1]);
  boxes.minMax(signCx - boardW / 2 - 0.22, boardY0 + boardH, signZ - 0.2, signCx + boardW / 2 + 0.22, boardY0 + boardH + 0.22, signZ + 0.2, PAL.red[1]);
  for (const s of [-1, 1]) boxes.minMax(signCx + s * (boardW / 2 + 0.11) - 0.11, boardY0, signZ - 0.2, signCx + s * (boardW / 2 + 0.11) + 0.11, boardY0 + boardH, signZ + 0.2, PAL.red[1]);
  const textY0 = boardY0 + 0.55;
  cols.forEach((col, ci) => {
    if (!col) return;
    col.forEach((on, row) => {
      if (!on) return;
      const y = textY0 + (4 - row) * px + px / 2;
      const xf = signCx - textW / 2 + ci * px + px / 2;
      boxes.box(xf, y, signZ + 0.18, px, px, 0.06, PAL.yellow[1]);
      const xb = signCx + textW / 2 - ci * px - px / 2;
      boxes.box(xb, y, signZ - 0.18, px, px, 0.06, PAL.yellow[1]);
    });
  });
  // Shark fin on top of the sign.
  for (let i = 0; i < 4; i++) {
    const w = 1.6 - i * 0.38;
    boxes.minMax(signCx - 0.3 - w / 2 + i * 0.22, boardY0 + boardH + 0.22 + i * 0.32, signZ - 0.1, signCx - 0.3 + w / 2 + i * 0.22, boardY0 + boardH + 0.54 + i * 0.32, signZ + 0.1, PAL.grey[1]);
  }
  const bulbs = [];
  const step = 0.55;
  for (let x = signCx - boardW / 2 - 0.11; x <= signCx + boardW / 2 + 0.12; x += step) {
    bulbs.push([x, boardY0 - 0.11], [x, boardY0 + boardH + 0.11]);
  }
  for (let y = boardY0 + step / 2; y < boardY0 + boardH; y += step) {
    bulbs.push([signCx - boardW / 2 - 0.11, y], [signCx + boardW / 2 + 0.11, y]);
  }
  const bulbSpots = bulbs.map(([x, y]) => new THREE.Vector3(x, y, signZ));

  // --- Queue switchbacks ---
  fence(boxes, 3.2, 24, 11.6, 24);
  fence(boxes, 5.2, 21.95, 13.6, 21.95);
  fence(boxes, 3.2, 19.65, 11.6, 19.65);
  fence(boxes, 13.6, 17.3, 13.6, 26);
  fence(boxes, 3.2, 19.65, 3.2, 26);
  fence(boxes, 3.2, 26, 7, 26);
  fence(boxes, 9, 26, 13.6, 26);
  fence(boxes, 3, 17.3, 13.6, 17.3);
  // Entrance arch.
  for (const x of [6.7, 9.3]) boxes.minMax(x - 0.2, 0, 26.3, x + 0.2, 3.4, 26.7, PAL.teal[2]);
  boxes.minMax(6.3, 3.4, 26.25, 9.7, 3.85, 26.75, PAL.orange[1]);
  boxes.minMax(7.4, 3.85, 26.4, 8.6, 4.2, 26.6, PAL.grey[1]);
  boxes.minMax(7.8, 4.2, 26.4, 8.4, 4.6, 26.6, PAL.grey[1]);
  for (const [x, c] of [[6.5, PAL.red[2]], [9.5, PAL.yellow[1]]]) {
    boxes.minMax(x - 0.04, 3.85, 26.46, x + 0.04, 4.9, 26.54, PAL.ink[2]);
    boxes.minMax(x + 0.04, 4.45, 26.48, x + 0.6, 4.85, 26.52, c);
  }

  // --- Props: lamps, benches, bins, cart, picnic tables ---
  for (let x = -36; x <= 20; x += 8) lamp(boxes, x, 29.0);
  for (let z = -14; z <= 22; z += 9) {
    lamp(boxes, 26.0, z);
    lamp(boxes, -42.8, z);
  }
  for (let x = -34; x <= 18; x += 10) lamp(boxes, x, -20.8);
  [[-30, 29.0, true], [-6, 29.0, true], [16, 29.0, true], [26.0, 4, false], [-42.8, -6, false], [0, -20.8, true]].forEach(([x, z, ax]) => bench(boxes, x, z, ax));
  [[-26, 29.0], [0, 29.0], [26.0, 18], [-42.8, 12]].forEach(([x, z]) => {
    boxes.minMax(x - 0.22, 0, z - 0.22, x + 0.22, 0.7, z + 0.22, PAL.teal[1]);
    boxes.minMax(x - 0.25, 0.7, z - 0.25, x + 0.25, 0.78, z + 0.25, PAL.ink[2]);
  });
  // Ice-cream cart.
  boxes.minMax(-14.8, 0.25, 25.0, -13.2, 1.2, 25.9, PAL.pink[1]);
  boxes.minMax(-14.8, 1.2, 25.0, -13.2, 1.3, 25.9, PAL.cream[0]);
  for (const x of [-14.5, -13.5]) boxes.minMax(x - 0.2, 0, 24.95, x + 0.2, 0.4, 25.05, PAL.ink[1]);
  boxes.minMax(-14.05, 1.3, 25.4, -13.95, 2.6, 25.5, PAL.grey[2]);
  [[1.7, PAL.red[2]], [1.2, PAL.cream[0]], [0.6, PAL.red[2]]].forEach(([w, c], i) => boxes.minMax(-14 - w / 2, 2.6 + i * 0.18, 25.45 - w / 2, -14 + w / 2, 2.78 + i * 0.18, 25.45 + w / 2, c));
  // Picnic area at the end of the left stub path.
  for (const [x, z, c] of [[-26, 24.8, PAL.yellow[1]], [-21, 25.2, PAL.teal[3]]]) {
    boxes.minMax(x - 0.9, 0.7, z - 0.5, x + 0.9, 0.82, z + 0.5, PAL.brown[3]);
    for (const s of [-1, 1]) boxes.minMax(x - 0.9, 0.38, z + s * 0.85 - 0.18, x + 0.9, 0.48, z + s * 0.85 + 0.18, PAL.brown[2]);
    for (const s of [-1, 1]) boxes.minMax(x + s * 0.7 - 0.07, 0, z - 0.07, x + s * 0.7 + 0.07, 0.7, z + 0.07, PAL.brown[1]);
    boxes.minMax(x - 0.05, 0.82, z - 0.05, x + 0.05, 2.4, z + 0.05, PAL.grey[2]);
    boxes.minMax(x - 1.1, 2.4, z - 1.1, x + 1.1, 2.55, z + 1.1, c);
    boxes.minMax(x - 0.6, 2.55, z - 0.6, x + 0.6, 2.7, z + 0.6, PAL.cream[0]);
  }

  // --- Hedge border ---
  const hedge = (ax, az, bx, bz) => boxes.minMax(Math.min(ax, bx), 0, Math.min(az, bz), Math.max(ax, bx), 0.75, Math.max(az, bz), PAL.grass[2]);
  hedge(x0 + 0.1, z0 + 0.1, x1 - 0.1, z0 + 0.7);
  hedge(x0 + 0.1, z0 + 0.1, x0 + 0.7, z1 - 0.1);
  hedge(x1 - 0.7, z0 + 0.1, x1 - 0.1, z1 - 0.1);
  hedge(x0 + 0.1, z1 - 0.7, x1 - 0.1, z1 - 0.1);

  // --- Trees, bushes and flowers on free grass ---
  const trees = [];
  for (let tries = 0; tries < 900 && trees.length < 46; tries++) {
    const x = x0 + 2.5 + rnd() * (x1 - x0 - 5);
    const z = z0 + 2.5 + rnd() * (z1 - z0 - 5);
    if (isBlocked(x, z, 1.4)) continue;
    if (supports.some((s) => Math.hypot(s.x - x, s.z - z) < 2.2)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.8)) continue;
    if (!heartClear(x, 2.5, z, 4.2) || !heartClear(x, 4.5, z, 4.2) || !heartClear(x, 0.8, z, 3.0)) continue;
    trees.push({ x, z });
    tree(boxes, Math.round(x * 4) / 4, Math.round(z * 4) / 4, rnd);
  }
  const flowerCols = [PAL.pink[0], PAL.yellow[1], PAL.red[3], PAL.cream[0], PAL.purple[2], PAL.orange[1]];
  for (let i = 0, n = 0; i < 2000 && n < 220; i++) {
    const x = x0 + 1.5 + rnd() * (x1 - x0 - 3);
    const z = z0 + 1.5 + rnd() * (z1 - z0 - 3);
    if (isBlocked(x, z, 0.3) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.4)) continue;
    const c = flowerCols[Math.floor(rnd() * flowerCols.length)];
    boxes.box(x, 0.12, z, 0.2, 0.24, 0.2, c);
    n++;
  }

  // --- Clouds: a ring around the floating diorama (animated in main.js) ---
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const cloud = { angle: (i / 9) * Math.PI * 2 + rnd() * 0.4, radius: 1.18 + rnd() * 0.2, y: 3 + rnd() * 16, parts: [] };
    const parts = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < parts; k++) {
      cloud.parts.push({
        dx: (k - parts / 2) * 1.6, dy: (k % 2) * 0.6, dz: (rnd() - 0.5) * 1.6,
        w: 2 + rnd() * 2.4, h: 1 + rnd() * 0.7, d: 1.8 + rnd() * 2, c: k % 2 ? PAL.cream[0] : PAL.grey[5],
      });
    }
    clouds.push(cloud);
  }
  return { bulbSpots, trees, clouds };
}
