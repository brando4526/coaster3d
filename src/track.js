import * as THREE from 'three';

const DEG = Math.PI / 180;
export const DS = 0.1; // resampled spacing along the heartline
export const SPINE_OFFSET = 1.75; // heartline -> spine centre, along track "up"

const smooth = (t) => t * t * (3 - 2 * t);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const PROFILES = {
  linear: () => 1,
  smooth: (t) => Math.sin(Math.PI * t) ** 2,
  in: (t) => Math.sin((Math.PI * t) / 2) ** 2,
  out: (t) => Math.cos((Math.PI * t) / 2) ** 2,
  // Flatter curvature for compact 180° turns (smaller bulge than `smooth`).
  turn: (t) => 0.45 + Math.sin(Math.PI * t) ** 2,
  // Clothoid-like loop: gentle entry/exit curvature, tight at the top (teardrop shape).
  loop: (t) => 0.22 + Math.sin(Math.PI * t) ** 2,
};

function eulerForward(th, ps, out) {
  return out.set(Math.cos(th) * Math.cos(ps), Math.sin(th), Math.cos(th) * Math.sin(ps));
}
function eulerUp(th, ps, out) {
  return out.set(-Math.sin(th) * Math.cos(ps), Math.cos(th), -Math.sin(th) * Math.sin(ps));
}

/**
 * Elements: { len, pitch, yaw, bank (absolute deg at end), roll (extra deg), offset (lateral), profile, tag }
 * The integrated path is the riders' heartline; the spine sits SPINE_OFFSET above it along the rolled up-vector.
 */
export class Track {
  constructor(start, elements) {
    const raw = [];
    const tagsRaw = [];
    const p = start.pos.clone();
    let th = 0;
    let ps = start.yaw;
    let bank = 0;
    const tmp = new THREE.Vector3();
    const pushRaw = (pos, t, y, b) => raw.push({ p: pos.clone(), up: eulerUp(t, y, new THREE.Vector3()), bank: b });
    pushRaw(p, th, ps, bank);

    for (const el of elements) {
      const n = Math.max(2, Math.ceil(el.len / 0.04));
      const ds = el.len / n;
      const w = PROFILES[el.profile || 'smooth'];
      let wsum = 0;
      for (let i = 0; i < n; i++) wsum += w((i + 0.5) / n);
      const dTh = (el.pitch || 0) * DEG;
      const dPs = (el.yaw || 0) * DEG;
      const bank0 = bank;
      const bank1 = (el.bank !== undefined ? el.bank * DEG : bank0) + (el.roll || 0) * DEG;
      const off = el.offset || 0;
      const right = new THREE.Vector3(-Math.sin(ps), 0, Math.cos(ps));
      const startIdx = raw.length - 1;
      for (let i = 0; i < n; i++) {
        const wm = w((i + 0.5) / n) / wsum;
        const th0 = th;
        const ps0 = ps;
        th += dTh * wm;
        ps += dPs * wm;
        eulerForward((th0 + th) / 2, (ps0 + ps) / 2, tmp);
        p.addScaledVector(tmp, ds);
        const t = (i + 1) / n;
        const pos = p.clone().addScaledVector(right, off * smooth(t));
        raw.push({ p: pos, up: eulerUp(th, ps, new THREE.Vector3()), bank: bank0 + (bank1 - bank0) * smooth(t) });
      }
      if (off) p.addScaledVector(right, off);
      bank = wrapPi(bank1);
      if (el.tag) tagsRaw.push({ tag: el.tag, a: startIdx, b: raw.length - 1 });
    }

    // Close the circuit with a Hermite curve back into the start pose.
    const endP = p.clone();
    const endF = eulerForward(th, ps, new THREE.Vector3());
    const startF = eulerForward(0, start.yaw, new THREE.Vector3());
    const gap = endP.distanceTo(start.pos);
    this.closingGap = gap;
    const k = gap * 1.15;
    const nClose = Math.max(4, Math.ceil(gap / 0.04));
    const closeStart = raw.length - 1;
    const h = new THREE.Vector3();
    const dh = new THREE.Vector3();
    for (let i = 1; i < nClose; i++) {
      const t = i / nClose;
      const t2 = t * t;
      const t3 = t2 * t;
      h.set(0, 0, 0)
        .addScaledVector(endP, 2 * t3 - 3 * t2 + 1)
        .addScaledVector(endF, (t3 - 2 * t2 + t) * k)
        .addScaledVector(start.pos, -2 * t3 + 3 * t2)
        .addScaledVector(startF, (t3 - t2) * k);
      dh.set(0, 0, 0)
        .addScaledVector(endP, 6 * t2 - 6 * t)
        .addScaledVector(endF, (3 * t2 - 4 * t + 1) * k)
        .addScaledVector(start.pos, -6 * t2 + 6 * t)
        .addScaledVector(startF, (3 * t2 - 2 * t) * k)
        .normalize();
      const up = new THREE.Vector3(0, 1, 0).addScaledVector(dh, -dh.y).normalize();
      raw.push({ p: h.clone(), up, bank: bank * (1 - smooth(t)) });
    }
    tagsRaw.push({ tag: 'closing', a: closeStart, b: raw.length - 1 });
    raw.push({ p: start.pos.clone(), up: new THREE.Vector3(0, 1, 0), bank: 0 });

    // Arc-length parametrisation of the raw samples.
    const cum = new Float64Array(raw.length);
    for (let i = 1; i < raw.length; i++) cum[i] = cum[i - 1] + raw[i].p.distanceTo(raw[i - 1].p);
    const total = cum[raw.length - 1];
    const N = Math.round(total / DS);
    this.length = N * DS;
    this.N = N;
    const scale = total / this.length;

    const P = new Float32Array(N * 3);
    const U = new Float32Array(N * 3);
    const F = new Float32Array(N * 3);
    const R = new Float32Array(N * 3);
    const bankArr = new Float32Array(N);
    const refUp = [];
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * DS * scale;
      while (j < raw.length - 2 && cum[j + 1] < s) j++;
      const seg = cum[j + 1] - cum[j];
      const t = seg > 0 ? (s - cum[j]) / seg : 0;
      const a = raw[j];
      const b = raw[j + 1];
      P[i * 3] = a.p.x + (b.p.x - a.p.x) * t;
      P[i * 3 + 1] = a.p.y + (b.p.y - a.p.y) * t;
      P[i * 3 + 2] = a.p.z + (b.p.z - a.p.z) * t;
      refUp.push(new THREE.Vector3().lerpVectors(a.up, b.up, t));
      bankArr[i] = a.bank + wrapPi(b.bank - a.bank) * t;
    }

    const f = new THREE.Vector3();
    const u = new THREE.Vector3();
    const r = new THREE.Vector3();
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const ia = (i - 1 + N) % N;
      const ib = (i + 1) % N;
      pa.fromArray(P, ia * 3);
      pb.fromArray(P, ib * 3);
      f.subVectors(pb, pa).normalize();
      u.copy(refUp[i]).addScaledVector(f, -refUp[i].dot(f)).normalize();
      r.crossVectors(f, u);
      const c = Math.cos(bankArr[i]);
      const sn = Math.sin(bankArr[i]);
      const ux = u.x * c + r.x * sn;
      const uy = u.y * c + r.y * sn;
      const uz = u.z * c + r.z * sn;
      u.set(ux, uy, uz);
      r.crossVectors(f, u);
      f.toArray(F, i * 3);
      u.toArray(U, i * 3);
      r.toArray(R, i * 3);
    }
    this.P = P;
    this.F = F;
    this.U = U;
    this.R = R;

    this.tags = tagsRaw.map(({ tag, a, b }) => ({ tag, s0: cum[a] / scale, s1: cum[b] / scale }));
  }

  zone(tag) {
    return this.tags.find((t) => t.tag === tag);
  }

  wrap(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Interpolated frame at arc length s. out = { p, f, u, r } of Vector3. */
  frame(s, out) {
    s = this.wrap(s);
    const x = s / DS;
    const i = Math.floor(x) % this.N;
    const k = (i + 1) % this.N;
    const t = x - Math.floor(x);
    lerpInto(out.p, this.P, i, k, t);
    lerpInto(out.f, this.F, i, k, t).normalize();
    lerpInto(out.u, this.U, i, k, t);
    out.u.addScaledVector(out.f, -out.u.dot(out.f)).normalize();
    out.r.crossVectors(out.f, out.u);
    return out;
  }

  spine(s, out, frame = makeFrame()) {
    this.frame(s, frame);
    return out.copy(frame.p).addScaledVector(frame.u, SPINE_OFFSET);
  }
}

function lerpInto(v, A, i, k, t) {
  const a = i * 3;
  const b = k * 3;
  return v.set(A[a] + (A[b] - A[a]) * t, A[a + 1] + (A[b + 1] - A[a + 1]) * t, A[a + 2] + (A[b + 2] - A[a + 2]) * t);
}

export function makeFrame() {
  return { p: new THREE.Vector3(), f: new THREE.Vector3(), u: new THREE.Vector3(), r: new THREE.Vector3() };
}
