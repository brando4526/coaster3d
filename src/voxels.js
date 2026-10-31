import * as THREE from 'three';

const colorCache = new Map();
function linearColor(hex) {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color().setHex(hex);
    colorCache.set(hex, c);
  }
  return c;
}

const sharedBox = new THREE.BoxGeometry(1, 1, 1);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

function writeBasis(arr, o, cx, cy, cz, X, Y, Z, sx, sy, sz) {
  arr[o] = X.x * sx; arr[o + 1] = X.y * sx; arr[o + 2] = X.z * sx; arr[o + 3] = 0;
  arr[o + 4] = Y.x * sy; arr[o + 5] = Y.y * sy; arr[o + 6] = Y.z * sy; arr[o + 7] = 0;
  arr[o + 8] = Z.x * sz; arr[o + 9] = Z.y * sz; arr[o + 10] = Z.z * sz; arr[o + 11] = 0;
  arr[o + 12] = cx; arr[o + 13] = cy; arr[o + 14] = cz; arr[o + 15] = 1;
}

// Builds a right-handed basis where Y follows (b - a) and Z leans towards `front`.
export function segmentBasis(a, b, front, X, Y, Z) {
  Y.subVectors(b, a);
  const len = Y.length();
  if (len < 1e-6) Y.set(0, 1, 0);
  else Y.multiplyScalar(1 / len);
  Z.copy(front).addScaledVector(Y, -front.dot(Y));
  if (Z.lengthSq() < 1e-8) {
    Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
    if (Z.lengthSq() < 1e-8) Z.set(1, 0, 0).addScaledVector(Y, -Y.x);
  }
  Z.normalize();
  X.crossVectors(Y, Z);
  return len;
}

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

/** Collects static boxes and bakes them into a single InstancedMesh (one draw call). */
export class StaticBoxes {
  constructor() {
    this.m = [];
    this.c = [];
  }

  get count() {
    return this.c.length;
  }

  basis(cx, cy, cz, X, Y, Z, sx, sy, sz, hex) {
    const o = this.m.length;
    this.m.length += 16;
    writeBasis(this.m, o, cx, cy, cz, X, Y, Z, sx, sy, sz);
    this.c.push(hex);
  }

  box(cx, cy, cz, sx, sy, sz, hex) {
    this.basis(cx, cy, cz, AX, AY, AZ, sx, sy, sz, hex);
  }

  minMax(x0, y0, z0, x1, y1, z1, hex) {
    this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), hex);
  }

  /** Box rotated about the vertical axis by `yaw` radians. */
  yawBox(cx, cy, cz, sx, sy, sz, yaw, hex) {
    _x.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _z.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.basis(cx, cy, cz, _x, AY, _z, sx, sy, sz, hex);
  }

  /** Box stretched from a to b with cross-section w x d; `front` orients the d axis. */
  segment(a, b, w, d, front, hex, extend = 0) {
    const len = segmentBasis(a, b, front, _x, _y, _z);
    this.basis((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, _x, _y, _z, w, len + extend, d, hex);
  }

  build({ castShadow = true, receiveShadow = true } = {}) {
    const n = this.c.length;
    const mesh = new THREE.InstancedMesh(sharedBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    mesh.instanceMatrix.array.set(this.m);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const col = linearColor(this.c[i]);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    return mesh;
  }
}

/** Fixed-capacity instanced boxes rewritten every frame (people, train, sign bulbs). */
export class DynamicBoxes {
  constructor(capacity, { castShadow = true, receiveShadow = true } = {}) {
    this.capacity = capacity;
    this.used = 0;
    this.mesh = new THREE.InstancedMesh(sharedBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.arr = this.mesh.instanceMatrix.array;
    this.colorsDirty = false;
  }

  alloc(hex) {
    if (this.used >= this.capacity) throw new Error('DynamicBoxes capacity exceeded');
    const i = this.used++;
    this.setColor(i, hex);
    this.hide(i);
    this.mesh.count = this.used;
    return i;
  }

  setColor(i, hex) {
    const col = linearColor(hex);
    const a = this.mesh.instanceColor.array;
    a[i * 3] = col.r;
    a[i * 3 + 1] = col.g;
    a[i * 3 + 2] = col.b;
    this.colorsDirty = true;
  }

  hide(i) {
    writeBasis(this.arr, i * 16, 0, -500, 0, AX, AY, AZ, 0, 0, 0);
  }

  basis(i, cx, cy, cz, X, Y, Z, sx, sy, sz) {
    writeBasis(this.arr, i * 16, cx, cy, cz, X, Y, Z, sx, sy, sz);
  }

  segment(i, a, b, w, d, front, extend = 0) {
    const len = segmentBasis(a, b, front, _x, _y, _z);
    writeBasis(this.arr, i * 16, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, _x, _y, _z, w, len + extend, d);
  }

  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorsDirty) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorsDirty = false;
    }
  }
}
