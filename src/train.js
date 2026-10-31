import * as THREE from 'three';
import { PAL } from './palette.js';
import { makeFrame } from './track.js';
import { CAR_GAP, SEAT_Z, TRAIN_STOP_S } from './world.js';

const G = 9.81;
export const CAR_COUNT = 3;

// Car-local parts: p = [forward, up (towards track), right], s = size along the same axes.
function carParts(index) {
  const body = PAL.red[2];
  const seat = PAL.ink[2];
  const otsr = PAL.yellow[1];
  const parts = [
    { p: [0, 1.28, 0], s: [1.3, 0.34, 1.25], c: PAL.grey[0] },
    { p: [0.45, 1.28, 0.66], s: [0.34, 0.34, 0.1], c: PAL.ink[1] },
    { p: [-0.45, 1.28, 0.66], s: [0.34, 0.34, 0.1], c: PAL.ink[1] },
    { p: [0.45, 1.28, -0.66], s: [0.34, 0.34, 0.1], c: PAL.ink[1] },
    { p: [-0.45, 1.28, -0.66], s: [0.34, 0.34, 0.1], c: PAL.ink[1] },
    { p: [0, 0.98, 0], s: [0.36, 0.34, 0.36], c: PAL.grey[1] },
    { p: [0, 0.8, 0], s: [0.62, 0.22, 3.5], c: body },
    { p: [0, 0.72, 1.82], s: [0.85, 0.42, 0.18], c: body },
    { p: [0, 0.72, -1.82], s: [0.85, 0.42, 0.18], c: body },
    { p: [0.12, 0.92, 0], s: [0.3, 0.08, 3.2], c: PAL.cream[0] },
  ];
  for (const z of SEAT_Z) {
    parts.push(
      { p: [-0.27, -0.08, z], s: [0.13, 0.86, 0.6], c: seat },
      { p: [-0.29, 0.5, z], s: [0.08, 0.4, 0.12], c: PAL.grey[1] },
      { p: [-0.07, -0.56, z], s: [0.5, 0.1, 0.56], c: seat },
      { p: [-0.03, 0.22, z + 0.2], s: [0.4, 0.1, 0.13], c: otsr },
      { p: [-0.03, 0.22, z - 0.2], s: [0.4, 0.1, 0.13], c: otsr },
      { p: [0.17, 0.1, z + 0.17], s: [0.08, 0.28, 0.08], c: otsr },
      { p: [0.17, 0.1, z - 0.17], s: [0.08, 0.28, 0.08], c: otsr },
    );
  }
  if (index === 0) {
    // Hammerhead shark nose.
    parts.push(
      { p: [0.72, 0.98, 0], s: [0.9, 0.3, 0.55], c: PAL.grey[1] },
      { p: [1.28, 1.0, 0], s: [0.56, 0.32, 2.7], c: PAL.grey[1] },
      { p: [1.28, 0.82, 0], s: [0.5, 0.06, 2.5], c: PAL.cream[0] },
      { p: [1.4, 1.04, 1.36], s: [0.22, 0.2, 0.12], c: PAL.ink[0] },
      { p: [1.4, 1.04, -1.36], s: [0.22, 0.2, 0.12], c: PAL.ink[0] },
      { p: [1.58, 0.92, 0], s: [0.06, 0.06, 0.9], c: PAL.ink[0] },
    );
  }
  if (index === CAR_COUNT - 1) {
    // Tail fin.
    parts.push(
      { p: [-0.62, 0.95, 0], s: [0.5, 0.2, 0.12], c: PAL.grey[1] },
      { p: [-0.92, 1.18, 0], s: [0.26, 0.5, 0.12], c: PAL.grey[1] },
      { p: [-0.9, 0.72, 0], s: [0.22, 0.3, 0.12], c: PAL.grey[1] },
    );
  }
  return parts;
}

const _c = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _gf = new THREE.Vector3();

export class Train {
  constructor(track, batch) {
    this.track = track;
    this.batch = batch;
    this.L = track.length;
    const station = track.zone('station');
    this.sStop = station.s0 + TRAIN_STOP_S;
    this.launchEnd = track.zone('launch').s1;
    this.trimStart = track.zone('turn4').s0;
    this.brakeStart = track.zone('brakes').s0;
    this.s = this.sStop;
    this.v = 0;
    this.state = 'stopped';
    this.laps = 0;
    this.maxSpeed = 0;

    // Required speed so the train always clears what lies ahead (tire boosters top up on flat track).
    const n = track.N;
    this.vReq = new Float32Array(n);
    const look = Math.round(46 / 0.1);
    for (let i = 0; i < n; i++) {
      const y = track.P[i * 3 + 1];
      let hmax = y;
      for (let k = 1; k < look; k++) hmax = Math.max(hmax, track.P[((i + k) % n) * 3 + 1]);
      this.vReq[i] = Math.sqrt(Math.max(0, 2 * G * (hmax - y)) + 30);
    }

    this.cars = [];
    for (let i = 0; i < CAR_COUNT; i++) {
      const parts = carParts(i).map((p) => ({ ...p, id: batch.alloc(p.c) }));
      this.cars.push({
        index: i,
        parts,
        frame: makeFrame(),
        prevVel: new THREE.Vector3(),
        accel: new THREE.Vector3(),
        legDir: new THREE.Vector3(0.15, -1, 0).normalize(), // car-local (forward, up, right)
        inverted: 0,
      });
    }
    this.updateFrames(0);
  }

  get running() {
    return this.state !== 'stopped';
  }

  launch() {
    if (this.state !== 'stopped') return false;
    this.state = 'launching';
    return true;
  }

  distAhead(from, to) {
    return this.track.wrap(to - from);
  }

  inZone(s, a, b) {
    return this.track.wrap(s - a) <= this.track.wrap(b - a);
  }

  update(dt) {
    if (this.state !== 'stopped') {
      const sub = 4;
      const h = dt / sub;
      for (let k = 0; k < sub; k++) this.step(h);
    }
    this.updateFrames(dt);
  }

  step(dt) {
    if (this.state === 'stopped') return;
    const tr = this.track;
    let slope = 0;
    for (let i = 0; i < CAR_COUNT; i++) {
      const sc = tr.wrap(this.s - i * CAR_GAP);
      const idx = Math.floor(sc / 0.1) % tr.N;
      slope += tr.F[idx * 3 + 1];
    }
    slope /= CAR_COUNT;
    let a = -G * slope - 0.03 - 0.0012 * this.v * this.v;
    const s = tr.wrap(this.s);
    const idx = Math.floor(s / 0.1) % tr.N;

    if (this.state === 'launching') {
      if (this.v < 17.5) a = 10;
      if (this.distAhead(this.sStop, s) > this.distAhead(this.sStop, this.launchEnd)) this.state = 'running';
    } else if (this.state === 'running') {
      const flat = Math.abs(tr.F[idx * 3 + 1]) < 0.12;
      if (flat && this.v < this.vReq[idx]) a = Math.max(a, 6);
      if (this.inZone(s, this.trimStart, this.sStop)) this.state = 'braking';
    }
    if (this.state === 'braking') {
      const toStop = this.distAhead(s, this.sStop);
      const inFinal = this.inZone(s, this.brakeStart, this.sStop);
      let vT = inFinal ? Math.min(4.5, Math.sqrt(2 * 1.4 * toStop) + 0.15) : 8;
      if (!inFinal && this.v < vT) vT = this.v;
      a = THREE.MathUtils.clamp((vT - this.v) * 2.2, -9, 3);
      if (inFinal && toStop < 0.05) {
        this.s = this.sStop;
        this.v = 0;
        this.state = 'stopped';
        this.laps++;
        return;
      }
    }
    this.v = Math.max(this.state === 'braking' ? 0.3 : 1.2, this.v + a * dt);
    this.maxSpeed = Math.max(this.maxSpeed, this.v);
    this.s = tr.wrap(this.s + this.v * dt);
  }

  updateFrames(dt) {
    for (const car of this.cars) {
      const fr = car.frame;
      this.track.frame(this.s - car.index * CAR_GAP, fr);
      _vel.copy(fr.f).multiplyScalar(this.v);
      if (dt > 0) {
        _acc.subVectors(_vel, car.prevVel).multiplyScalar(1 / dt);
        car.accel.lerp(_acc, Math.min(1, dt * 6));
      }
      car.prevVel.copy(_vel);
      // Legs hang along (gravity - acceleration), expressed in the car frame.
      _gf.set(0, -G, 0).sub(car.accel);
      let lf = _gf.dot(fr.f);
      let lu = _gf.dot(fr.u);
      const lr = _gf.dot(fr.r);
      const len = Math.hypot(lf, lu, lr) || 1;
      lf /= len;
      lu /= len;
      const target = _c.set(THREE.MathUtils.clamp(lf, -0.55, 0.75) + 0.12, Math.min(lu, -0.45), THREE.MathUtils.clamp(lr / len, -0.5, 0.5)).normalize();
      car.legDir.lerp(target, dt > 0 ? Math.min(1, dt * 5) : 1).normalize();
      car.inverted = -fr.u.y;
    }
  }

  write() {
    const b = this.batch;
    for (const car of this.cars) {
      const { p, f, u, r } = car.frame;
      for (const part of car.parts) {
        _c.copy(p).addScaledVector(f, part.p[0]).addScaledVector(u, part.p[1]).addScaledVector(r, part.p[2]);
        b.basis(part.id, _c.x, _c.y, _c.z, f, u, r, part.s[0], part.s[1], part.s[2]);
      }
    }
  }

  /** World-space seat anchor (rider pelvis) for car c, seat k. */
  seatPelvis(c, k, out) {
    const { p, f, u, r } = this.cars[c].frame;
    return out.copy(p).addScaledVector(f, -0.04).addScaledVector(u, -0.43).addScaledVector(r, SEAT_Z[k]);
  }

  /** World-space restraint grip for car c, seat k, hand side sd (+1 = rider's left). */
  grip(c, k, sd, out) {
    const { p, f, u, r } = this.cars[c].frame;
    // Rider's left is -r when facing along f with up u.
    return out.copy(p).addScaledVector(f, 0.24).addScaledVector(u, -0.02).addScaledVector(r, SEAT_Z[k] - sd * 0.17);
  }
}
