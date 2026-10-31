import * as THREE from 'three';

export const BASE = { x0: -44, x1: 27, z0: -22, z1: 30 };
export const PLATFORM_Y = 1.6;
export const PLATFORM = { x0: -21, x1: -5, z0: 9.2, z1: 19.5 };
export const RAMP_FRONT = { x0: -5, x1: 3, z0: 17.4, z1: 19.4 };
export const RAMP_BACK = { x0: -5, x1: 3, z0: 9.3, z1: 11.3 };
export const POND = { x: 12.5, z: -1.5, rx: 4.6, rz: 5.2 };

export const CAR_GAP = 2.5;
export const TRAIN_STOP_S = 14; // arc length of the front car when parked
export const SEAT_Z = [-1.2, -0.4, 0.4, 1.2];

const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function groundHeight(x, z) {
  if (inRect(PLATFORM, x, z)) return PLATFORM_Y;
  if (inRect(RAMP_FRONT, x, z) || inRect(RAMP_BACK, x, z)) {
    return PLATFORM_Y * THREE.MathUtils.clamp((RAMP_FRONT.x1 - x) / (RAMP_FRONT.x1 - RAMP_FRONT.x0), 0, 1);
  }
  return 0;
}

export function inPond(x, z, pad = 0) {
  const dx = (x - POND.x) / (POND.rx + pad);
  const dz = (z - POND.z) / (POND.rz + pad);
  const wobble = 0.12 * Math.sin(Math.atan2(dz, dx) * 3 + 1.3);
  return dx * dx + dz * dz < (1 + wobble) * (1 + wobble);
}

/** Polyline route with arc-length lookup (closed routes wrap). */
export class Route {
  constructor(points, closed = false) {
    this.pts = points.map(([x, z]) => new THREE.Vector3(x, 0, z));
    if (closed) this.pts.push(this.pts[0].clone());
    this.closed = closed;
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distanceTo(this.pts[i - 1]));
    this.length = this.cum[this.cum.length - 1];
  }

  at(d, outPos, outDir) {
    if (this.closed) d = ((d % this.length) + this.length) % this.length;
    else d = THREE.MathUtils.clamp(d, 0, this.length);
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < d) i++;
    const a = this.pts[i];
    const b = this.pts[i + 1];
    const seg = this.cum[i + 1] - this.cum[i];
    const t = seg > 0 ? (d - this.cum[i]) / seg : 0;
    outPos.lerpVectors(a, b, t);
    outPos.y = groundHeight(outPos.x, outPos.z);
    if (outDir) outDir.subVectors(b, a).setY(0).normalize();
    return outPos;
  }

  /** Arc length of the closest point on the route to (x, z). */
  project(x, z) {
    let best = Infinity;
    let bestD = 0;
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i];
      const b = this.pts[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / len2, 0, 1) : 0;
      const px = a.x + abx * t - x;
      const pz = a.z + abz * t - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) {
        best = d2;
        bestD = this.cum[i] + Math.sqrt(len2) * t;
      }
    }
    return bestD;
  }
}

// Walkways (x, z). Ground height is applied automatically.
export const PARK_LOOP = new Route(
  [
    [-39, 27.5], [8, 27.5], [22, 27.5], [24.5, 25], [24.5, 12], [24, -16], [21, -19.2],
    [-10, -19.2], [-38, -19.2], [-41.2, -16], [-41.2, 24], [-39, 27.5],
  ],
  true,
);
export const QUEUE_JOIN = [8, 27.5];
export const QUEUE_ROUTE = new Route([
  QUEUE_JOIN, [8, 25], [12.6, 25], [12.6, 23], [4.2, 23], [4.2, 20.9], [12.6, 20.9], [12.6, 18.4],
  [3, 18.4], [-5, 18.4], [-6.2, 18.4],
]);
export const GATE = new THREE.Vector3(-6.2, PLATFORM_Y, 18.4);
export const EXIT_JOIN = [24.5, 10.3];
export const EXIT_ROUTE_TAIL = new Route([[-5, 10.3], [3, 10.3], [9, 10.3], [20, 10.3], EXIT_JOIN]);
export const OPERATOR_SPOT = new THREE.Vector3(-18.4, PLATFORM_Y, 17.2);

// Decorative path stubs (not walked) that make the park read as connected.
export const PATH_POLYLINES = [
  PARK_LOOP.pts.map((p) => [p.x, p.z]),
  QUEUE_ROUTE.pts.slice(0, 8).map((p) => [p.x, p.z]),
  [[3, 10.3], [9, 10.3], [20, 10.3], EXIT_JOIN],
  [[-41.2, 18], [-33, 22.5], [-22, 22.5]],
];
export const PATH_HALF_WIDTH = 1.25;
