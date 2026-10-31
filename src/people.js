import * as THREE from 'three';
import { PAL } from './palette.js';
import { Rig, DIM, randomLook } from './rig.js';
import {
  Route, groundHeight, PARK_LOOP, QUEUE_ROUTE, QUEUE_JOIN, EXIT_ROUTE_TAIL, EXIT_JOIN, SEAT_Z, PLATFORM_Y,
  OPERATOR_SPOT,
} from './world.js';
import { CAR_COUNT } from './train.js';

const QUEUE_SPACING = 1.15;
const MAX_QUEUE = 16;
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (t) => t * t * (3 - 2 * t);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;

const tmp = Array.from({ length: 12 }, () => new THREE.Vector3());

class Guest {
  constructor(people, look, rnd) {
    this.people = people;
    this.rnd = rnd;
    this.rig = new Rig(people.batch, look);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.yawTarget = 0;
    this.vel = new THREE.Vector3();
    this.walkSpeed = 1.2 + rnd() * 0.45;
    this.feet = [0, 1].map(() => ({ plant: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, swinging: false, dur: 0.3 }));
    this.lastStep = 0;
    this.task = 'idle';
    this.route = null;
    this.d = 0;
    this.targetD = 0;
    this.dir = 1;
    this.phase = rnd() * 100;
    this.swayFreq = 0.16 + rnd() * 0.12;
    this.armPose = 'hang';
    this.armTimer = 2 + rnd() * 8;
    this.head = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, timer: rnd() * 3 };
    this.stanceYaw = 0;
    this.fidgetTimer = 5 + rnd() * 10;
    this.pauseTimer = 0;
    this.wantsRideIn = 5 + rnd() * 40;
    this.seat = null; // { car, seat }
    this.sit = 0; // 0 standing -> 1 seated
    this.armStyle = rnd() < 0.35 ? 'hold' : rnd() < 0.6 ? 'brave' : 'wild';
    this.raise = 0;
    this.waveTimer = 0;
    this.after = null;
    this.backwards = false;
    this.cheerTimer = 0;
    this.trainFan = rnd() < 0.65;
  }

  placeAt(x, z, yaw) {
    this.pos.set(x, groundHeight(x, z), z);
    this.yaw = this.yawTarget = yaw;
    this.plantFeet();
  }

  plantFeet() {
    const S = tmp[0].set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.feet.forEach((f, i) => {
      f.plant.copy(this.pos).addScaledVector(S, Rig.side(i) * 0.14);
      f.plant.y = groundHeight(f.plant.x, f.plant.z);
      f.swinging = false;
      f.t = 1;
    });
  }

  setRoute(route, d, targetD) {
    this.route = route;
    this.d = d;
    this.targetD = targetD;
  }

  // ---- locomotion ----
  followRoute(dt) {
    const prev = tmp[1].copy(this.pos);
    let moving = false;
    if (this.route) {
      const delta = this.targetD - this.d;
      if (Math.abs(delta) > 0.01) {
        const step = Math.sign(delta) * Math.min(Math.abs(delta), this.walkSpeed * dt);
        this.d += step;
        moving = true;
      }
      const dir = tmp[2];
      this.route.at(this.d, this.pos, dir);
      if (moving) this.yawTarget = Math.atan2(dir.x, dir.z) + ((this.targetD < this.d) !== this.backwards ? Math.PI : 0);
    }
    this.vel.subVectors(this.pos, prev).setY(0).multiplyScalar(dt > 0 ? 1 / dt : 0);
    return moving;
  }

  updateGait(dt) {
    const sp = this.vel.length();
    const yaw = this.yaw + this.stanceYaw;
    const S = tmp[3].set(Math.cos(yaw), 0, -Math.sin(yaw));
    const walking = sp > 0.25;
    const homes = [tmp[4], tmp[5]];
    for (let i = 0; i < 2; i++) {
      homes[i].copy(this.pos).addScaledVector(S, Rig.side(i) * 0.14).addScaledVector(this.vel, 0.2);
    }
    for (const f of this.feet) {
      if (!f.swinging) continue;
      f.t += dt / f.dur;
      if (f.t >= 1) {
        f.t = 1;
        f.swinging = false;
        f.plant.copy(f.to);
        f.plant.y = groundHeight(f.plant.x, f.plant.z);
      }
    }
    if (!this.feet[0].swinging && !this.feet[1].swinging) {
      const err = this.feet.map((f, i) => Math.hypot(f.plant.x - homes[i].x, f.plant.z - homes[i].z));
      let i = err[0] > err[1] ? 0 : 1;
      const thr = walking ? 0.16 : 0.07;
      if (i === this.lastStep && err[1 - i] > thr * 0.6) i = 1 - i;
      if (err[i] > thr) {
        const f = this.feet[i];
        f.swinging = true;
        f.t = 0;
        f.from.copy(f.plant);
        f.to.copy(homes[i]).addScaledVector(this.vel, 0.12);
        f.dur = walking ? clamp(0.36 - sp * 0.05, 0.25, 0.34) : 0.26;
        f.lift = walking ? 0.13 : 0.07;
        this.lastStep = i;
      }
    }
  }

  footPos(i, out) {
    const f = this.feet[i];
    if (!f.swinging) return out.copy(f.plant);
    const e = smooth(f.t);
    out.lerpVectors(f.from, f.to, e);
    out.y = groundHeight(out.x, out.z) + Math.sin(Math.PI * f.t) * f.lift;
    return out;
  }

  updateHead(dt, time, opts = {}) {
    const h = this.head;
    h.timer -= dt;
    if (h.timer <= 0) {
      h.timer = 1.2 + this.rnd() * 3.2;
      const r = this.rnd();
      if (opts.walking) {
        h.tYaw = (this.rnd() - 0.5) * 0.8;
        h.tPitch = (this.rnd() - 0.5) * 0.2;
      } else if (r < 0.25) {
        h.tYaw = 0;
        h.tPitch = 0;
      } else {
        h.tYaw = (this.rnd() - 0.5) * 2.2;
        h.tPitch = -0.2 + this.rnd() * 0.5;
      }
    }
    let ty = h.tYaw;
    let tp = h.tPitch;
    const train = this.people.train;
    if (opts.watchTrain && train.running) {
      const car = train.cars[0].frame.p;
      const dx = car.x - this.pos.x;
      const dz = car.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 34) {
        ty = clamp(wrapAngle(Math.atan2(dx, dz) - this.yaw), -1.25, 1.25);
        tp = clamp(Math.atan2(car.y - this.pos.y - 1.8, dist), -0.4, 0.7);
      }
    }
    if (opts.lookDown) tp = -0.5;
    const k = 1 - Math.exp(-dt * 5);
    h.yaw += (ty - h.yaw) * k;
    h.pitch += (tp - h.pitch) * k;
    this.rig.headYaw = h.yaw;
    this.rig.headPitch = -h.pitch;
  }

  /** Standing / walking pose from root + feet (with idle weight shift and arm poses). */
  poseStanding(dt, time, opts = {}) {
    const rig = this.rig;
    const sp = this.vel.length();
    const walking = sp > 0.25;
    this.yaw += wrapAngle(this.yawTarget - this.yaw) * (1 - Math.exp(-dt * 7));
    const F = tmp[6].set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const S = tmp[7].set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const fp0 = this.footPos(0, rig.foot[0]);
    const fp1 = this.footPos(1, rig.foot[1]);
    const ground = this.pos.y;
    const w = walking ? 0 : Math.sin(time * Math.PI * 2 * this.swayFreq + this.phase);
    const pel = rig.pelvis.copy(this.pos);
    pel.y = ground + DIM.pelvisH - (walking ? 0.05 : 0.02 + 0.03 * Math.abs(w));
    pel.addScaledVector(S, w * 0.07);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (f.swinging) {
        pel.y += Math.sin(Math.PI * f.t) * 0.035;
        pel.addScaledVector(S, -Rig.side(i) * 0.035 * Math.sin(Math.PI * f.t));
      }
    }
    // Relaxed (unweighted) heel lifts slightly while idling.
    if (!walking) {
      const light = w > 0 ? 1 : 0;
      if (!this.feet[light].swinging) rig.foot[light].y += 0.03 * Math.abs(w);
    }
    for (let i = 0; i < 2; i++) rig.foot[i].y += DIM.ankle;
    // Keep feet reachable: lower the pelvis rather than over-stretching legs.
    for (let i = 0; i < 2; i++) {
      const hip = tmp[8].copy(pel).addScaledVector(S, Rig.side(i) * DIM.hipW);
      const hd = Math.hypot(hip.x - rig.foot[i].x, hip.z - rig.foot[i].z);
      const maxV = Math.sqrt(Math.max(0.01, (DIM.thigh + DIM.shin - 0.02) ** 2 - hd * hd));
      pel.y = Math.min(pel.y, rig.foot[i].y + maxV);
    }
    rig.fwd.copy(F);
    rig.up.copy(UP).addScaledVector(F, walking ? 0.06 : 0).addScaledVector(S, -w * 0.05).normalize();
    for (let i = 0; i < 2; i++) {
      rig.footDir[i].copy(F).addScaledVector(S, Rig.side(i) * 0.12).normalize();
      rig.footUp[i].copy(UP);
    }
    rig.kneeHint.copy(F);
    rig.elbowHint.copy(F).negate().addScaledVector(UP, -0.3);
    rig.computeJoints();

    // Arms.
    const pose = walking ? 'walk' : opts.arms || this.armPose;
    for (let i = 0; i < 2; i++) {
      const sd = Rig.side(i);
      const hand = rig.hand[i];
      const sh = rig.shoulder[i];
      if (pose === 'walk') {
        const footFwd = tmp[9].subVectors(rig.foot[i], this.pos).dot(F);
        const swing = clamp(-footFwd * 0.9, -0.3, 0.3);
        hand.copy(sh).addScaledVector(UP, -0.56).addScaledVector(F, swing + 0.04).addScaledVector(S, sd * 0.07);
      } else if (pose === 'pockets') {
        hand.copy(pel).addScaledVector(S, sd * 0.24).addScaledVector(F, 0.1).addScaledVector(UP, 0.02);
      } else if (pose === 'hips') {
        hand.copy(pel).addScaledVector(S, sd * 0.31).addScaledVector(UP, 0.16).addScaledVector(F, -0.02);
        rig.elbowHint.copy(S).multiplyScalar(sd).addScaledVector(F, -0.4);
      } else if (pose === 'phone') {
        hand.copy(pel).addScaledVector(UP, 0.42).addScaledVector(F, 0.32).addScaledVector(S, sd * 0.05);
        rig.elbowHint.copy(UP).multiplyScalar(-1).addScaledVector(F, -0.3);
      } else if (pose === 'crossed') {
        hand.copy(pel).addScaledVector(UP, 0.4 - i * 0.04).addScaledVector(F, 0.22).addScaledVector(S, -sd * 0.14);
        rig.elbowHint.copy(UP).multiplyScalar(-1).addScaledVector(S, sd);
      } else if (pose === 'wave' && i === 1) {
        hand.copy(sh).addScaledVector(UP, 0.55).addScaledVector(S, sd * (0.2 + 0.12 * Math.sin(time * 10))).addScaledVector(F, 0.08);
        rig.elbowHint.copy(S).multiplyScalar(sd).addScaledVector(UP, -0.5);
      } else if (pose === 'cheer') {
        hand.copy(sh).addScaledVector(UP, 0.56).addScaledVector(S, sd * (0.16 + 0.06 * Math.sin(time * 9 + i))).addScaledVector(F, 0.05);
        rig.elbowHint.copy(S).multiplyScalar(sd).addScaledVector(UP, -0.4);
      } else {
        const sway = Math.sin(time * 1.3 + this.phase + i) * 0.02;
        hand.copy(sh).addScaledVector(UP, -0.57).addScaledVector(F, 0.05 + sway).addScaledVector(S, sd * 0.06);
      }
    }
  }

  /** Seated pose driven by the train car frame (legs dangle with felt acceleration). */
  poseSeated(time, out) {
    const train = this.people.train;
    const car = train.cars[this.seat.car];
    const { f, u, r } = car.frame;
    train.seatPelvis(this.seat.car, this.seat.seat, out.pelvis);
    out.fwd.copy(f);
    out.up.copy(u);
    const S = tmp[10].crossVectors(u, f);
    const ld = car.legDir;
    for (let i = 0; i < 2; i++) {
      const sd = Rig.side(i);
      const kick = Math.sin(time * 2.4 + this.phase + i * Math.PI) * 0.05;
      out.feet[i]
        .copy(out.pelvis)
        .addScaledVector(S, sd * DIM.hipW)
        .addScaledVector(f, 0.43 + ld.x * 0.43 + kick)
        .addScaledVector(u, ld.y * 0.43)
        .addScaledVector(r, ld.z * 0.43);
      out.footDir[i].copy(f);
      out.footUp[i].copy(u);
    }
    const moving = train.running;
    const thrill = moving && (train.v > 11 || car.inverted > 0.2);
    const wantRaise = this.cheerTimer > 0 || (moving && (this.armStyle === 'wild' || (this.armStyle === 'brave' && thrill)));
    this.raise += ((wantRaise ? 1 : 0) - this.raise) * 0.08;
    for (let i = 0; i < 2; i++) {
      const sd = Rig.side(i);
      const grip = train.grip(this.seat.car, this.seat.seat, sd, tmp[11]);
      const shoulder = tmp[9].copy(out.pelvis).addScaledVector(u, DIM.torsoH - DIM.shoulderDrop).addScaledVector(S, sd * DIM.shoulderW);
      const up = tmp[8].copy(shoulder).addScaledVector(u, 0.3).addScaledVector(f, 0.48).addScaledVector(S, sd * (0.28 + 0.06 * Math.sin(time * 8 + this.phase)));
      out.hands[i].lerpVectors(grip, up, smooth(this.raise));
    }
    out.elbow.copy(f).multiplyScalar(-1).addScaledVector(u, -0.5);
  }

  update(dt, time) {
    const people = this.people;
    const rig = this.rig;
    switch (this.task) {
      case 'wander': {
        if (this.pauseTimer > 0) {
          this.pauseTimer -= dt;
          this.vel.set(0, 0, 0);
        } else {
          this.targetD = this.d + this.dir * 50;
          this.followRoute(dt);
          if (this.rnd() < dt * 0.02) this.pauseTimer = 2.5 + this.rnd() * 4;
        }
        this.wantsRideIn -= dt;
        const dj = Math.abs(wrapAngle(((this.d - people.joinD) / PARK_LOOP.length) * Math.PI * 2)) * (PARK_LOOP.length / (Math.PI * 2));
        if (this.wantsRideIn <= 0 && dj < 0.6 && people.queue.length < MAX_QUEUE) {
          people.joinQueue(this);
        }
        break;
      }
      case 'queue': {
        const idx = people.queue.indexOf(this);
        this.targetD = people.slotD(idx);
        const moving = this.followRoute(dt);
        if (!moving) {
          const dir = tmp[2];
          QUEUE_ROUTE.at(this.d, tmp[1], dir);
          this.yawTarget = Math.atan2(dir.x, dir.z);
        }
        break;
      }
      case 'walkTo': {
        const moving = this.followRoute(dt);
        if (!moving && this.after && this.route && this.d >= this.route.length - 0.02) {
          const next = this.after;
          this.after = null;
          next();
        }
        break;
      }
      case 'sitting':
      case 'standing':
      case 'seated': {
        this.vel.set(0, 0, 0);
        break;
      }
      default:
        this.vel.set(0, 0, 0);
    }

    this.cheerTimer = Math.max(0, this.cheerTimer - dt);

    if (this.task === 'seated' || this.task === 'sitting' || this.task === 'standing') {
      const seated = people.seatedPose;
      this.poseSeated(time, seated);
      if (this.task === 'sitting') this.sit = Math.min(1, this.sit + dt / 0.8);
      if (this.task === 'standing') this.sit = Math.max(0, this.sit - dt / 0.7);
      const e = smooth(this.sit);
      if (e < 1) {
        // Blend from the standing pose at the boarding spot.
        this.updateGait(0);
        this.poseStanding(dt, time, { arms: 'hang' });
      }
      rig.pelvis.lerp(seated.pelvis, e);
      rig.fwd.lerp(seated.fwd, e).normalize();
      rig.up.lerp(seated.up, e).normalize();
      for (let i = 0; i < 2; i++) {
        if (e < 1) {
          rig.foot[i].lerp(seated.feet[i], e);
          rig.hand[i].lerp(seated.hands[i], e);
          rig.footDir[i].lerp(seated.footDir[i], e).normalize();
          rig.footUp[i].lerp(seated.footUp[i], e).normalize();
        } else {
          rig.foot[i].copy(seated.feet[i]);
          rig.hand[i].copy(seated.hands[i]);
          rig.footDir[i].copy(seated.footDir[i]);
          rig.footUp[i].copy(seated.footUp[i]);
        }
      }
      rig.kneeHint.copy(seated.fwd).addScaledVector(seated.up, 0.6);
      if (e > 0.5) rig.elbowHint.copy(seated.elbow);
      this.updateHead(dt, time, { watchTrain: false });
      if (people.train.running) {
        this.head.yaw *= 0.9;
        this.head.pitch *= 0.9;
        rig.headYaw = this.head.yaw;
        rig.headPitch = -this.head.pitch;
      }
      if (this.task === 'sitting' && this.sit >= 1) this.task = 'seated';
      if (this.task === 'standing' && this.sit <= 0) {
        this.plantFeet();
        const next = this.after;
        this.after = null;
        if (next) next();
      }
      rig.update();
      return;
    }

    if (this.task === 'operator') this.vel.set(0, 0, 0);
    const walking = this.vel.lengthSq() > 0.06;
    if (!walking) {
      this.armTimer -= dt;
      if (this.armTimer <= 0) {
        const poses = ['hang', 'hang', 'pockets', 'hips', 'phone', 'crossed'];
        this.armPose = poses[Math.floor(this.rnd() * poses.length)];
        this.armTimer = 5 + this.rnd() * 10;
      }
      this.fidgetTimer -= dt;
      if (this.fidgetTimer <= 0) {
        this.stanceYaw = (this.rnd() - 0.5) * 0.7;
        this.fidgetTimer = 6 + this.rnd() * 12;
      }
    } else {
      this.stanceYaw *= 0.9;
    }
    this.updateGait(dt);
    let arms = this.task === 'operator' && this.waveTimer > 0 ? 'wave' : undefined;
    if (this.cheerTimer > 0) arms = 'cheer';
    this.poseStanding(dt, time, { arms });
    if (!walking && this.stanceYaw) rig.fwd.applyAxisAngle(UP, this.stanceYaw * 0.5);
    this.waveTimer = Math.max(0, this.waveTimer - dt);
    this.updateHead(dt, time, {
      walking,
      watchTrain: this.task === 'operator' || (!walking && this.trainFan),
      lookDown: !walking && this.armPose === 'phone' && this.task !== 'operator',
    });
    rig.update();
  }
}

export class People {
  constructor(batch, train, rnd) {
    this.batch = batch;
    this.train = train;
    this.rnd = rnd;
    this.guests = [];
    this.queue = [];
    this.seats = Array.from({ length: CAR_COUNT }, () => Array(SEAT_Z.length).fill(null));
    this.ops = 'ready';
    this.opsTimer = 0;
    this.queueOffset = 0;
    this.boarders = [];
    this.joinD = PARK_LOOP.project(...QUEUE_JOIN);
    this.exitD = PARK_LOOP.project(...EXIT_JOIN);
    this.seatedPose = {
      pelvis: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), elbow: new THREE.Vector3(),
      feet: [new THREE.Vector3(), new THREE.Vector3()], hands: [new THREE.Vector3(), new THREE.Vector3()],
      footDir: [new THREE.Vector3(), new THREE.Vector3()], footUp: [new THREE.Vector3(), new THREE.Vector3()],
    };

    const make = () => {
      const g = new Guest(this, randomLook(PAL, rnd), rnd);
      this.guests.push(g);
      return g;
    };

    // Riders already aboard.
    const seatList = [];
    for (let c = 0; c < CAR_COUNT; c++) for (let k = 0; k < SEAT_Z.length; k++) seatList.push([c, k]);
    shuffle(seatList, rnd);
    seatList.slice(0, 8).forEach(([c, k]) => {
      const g = make();
      this.seatGuest(g, c, k, true);
    });

    // Queue.
    for (let i = 0; i < 14; i++) {
      const g = make();
      this.queue.push(g);
      g.task = 'queue';
      const d = this.slotD(i);
      g.setRoute(QUEUE_ROUTE, d, d);
      const p = QUEUE_ROUTE.at(d, tmp[0], tmp[1]);
      g.placeAt(p.x, p.z, Math.atan2(tmp[1].x, tmp[1].z));
    }

    // Park visitors.
    for (let i = 0; i < 12; i++) {
      const g = make();
      g.task = 'wander';
      g.dir = rnd() < 0.5 ? 1 : -1;
      const d = rnd() * PARK_LOOP.length;
      g.setRoute(PARK_LOOP, d, d);
      const p = PARK_LOOP.at(d, tmp[0], tmp[1]);
      g.placeAt(p.x, p.z, Math.atan2(tmp[1].x, tmp[1].z) + (g.dir < 0 ? Math.PI : 0));
    }

    // Ride operator.
    this.operator = make();
    this.operator.task = 'operator';
    this.operator.armPose = 'hang';
    this.operator.placeAt(OPERATOR_SPOT.x, OPERATOR_SPOT.z, Math.PI);
  }

  slotD(i) {
    return QUEUE_ROUTE.length - 0.3 - (i + this.queueOffset) * QUEUE_SPACING;
  }

  seatGuest(g, c, k, instant) {
    this.seats[c][k] = g;
    g.seat = { car: c, seat: k };
    g.task = instant ? 'seated' : 'sitting';
    g.sit = instant ? 1 : 0;
    g.route = null;
  }

  joinQueue(g) {
    this.queue.push(g);
    g.task = 'queue';
    g.setRoute(QUEUE_ROUTE, 0, this.slotD(this.queue.length - 1));
    g.wantsRideIn = 40 + this.rnd() * 60;
  }

  get canLaunch() {
    return this.ops === 'ready' && !this.train.running;
  }

  dispatch() {
    if (!this.canLaunch) return false;
    this.train.launch();
    this.ops = 'running';
    this.operator.waveTimer = 2.5;
    return true;
  }

  stationCarX(c) {
    const fr = this.train.cars[c].frame;
    return fr.p.x;
  }

  startUnloading() {
    this.ops = 'unloading';
    this.opsTimer = 0;
    let k = 0;
    for (let c = 0; c < CAR_COUNT; c++) {
      for (let s = 0; s < SEAT_Z.length; s++) {
        const g = this.seats[c][s];
        if (!g) continue;
        g.cheerTimer = 1.4;
        const delay = 1.4 + k++ * 0.25;
        setTimeoutSim(this, delay, () => this.unloadGuest(g));
      }
    }
  }

  unloadGuest(g) {
    const { car, seat } = g.seat;
    this.seats[car][seat] = null;
    const x = this.stationCarX(car);
    const z = this.train.cars[car].frame.p.z + SEAT_Z[seat];
    g.task = 'standing';
    g.placeAt(x + 0.42, z, Math.PI / 2);
    g.after = () => {
      g.seat = null;
      const pts = [[x + 0.42, z], [x + 1.1, z], [x + 1.1, 10.3], ...EXIT_ROUTE_TAIL.pts.map((p) => [p.x, p.z])];
      const route = new Route(pts);
      g.task = 'walkTo';
      g.setRoute(route, 0, route.length);
      g.after = () => {
        // Many riders head straight back to the queue (by the shorter way round the park loop).
        const rideAgain = this.rnd() < 0.55;
        const L = PARK_LOOP.length;
        const ahead = (((this.joinD - this.exitD) % L) + L) % L;
        g.task = 'wander';
        g.dir = rideAgain ? (ahead < L / 2 ? 1 : -1) : this.rnd() < 0.5 ? 1 : -1;
        g.setRoute(PARK_LOOP, this.exitD, this.exitD);
        g.wantsRideIn = rideAgain ? 0 : 15 + this.rnd() * 35;
        g.walkSpeed = 1.2 + this.rnd() * 0.45;
      };
    };
  }

  startLoading() {
    this.ops = 'loading';
    const free = [];
    for (let c = 0; c < CAR_COUNT; c++) for (let s = 0; s < SEAT_Z.length; s++) if (!this.seats[c][s]) free.push([c, s]);
    shuffle(free, this.rnd);
    const want = Math.min(this.queue.length, 6 + Math.floor(this.rnd() * 5), free.length);
    this.boarders = [];
    // The line shuffles forward gradually behind the boarding guests.
    this.queueOffset += want;
    for (let i = 0; i < want; i++) {
      const g = this.queue.shift();
      const [c, s] = free[i];
      this.seats[c][s] = g;
      g.seat = { car: c, seat: s };
      this.boarders.push(g);
      const x = this.stationCarX(c);
      const z = this.train.cars[c].frame.p.z + SEAT_Z[s];
      const start = QUEUE_ROUTE.at(g.d, tmp[0]);
      const route = new Route([[start.x, start.z], [x + 1.1, 18.3], [x + 1.1, z]]);
      g.task = 'walkTo';
      g.walkSpeed = 1.5;
      g.backwards = false;
      g.setRoute(route, 0, 0);
      setTimeoutSim(this, i * 0.35, () => g.setRoute(route, 0, route.length));
      g.after = () => {
        // Back into the seat, then sit down.
        const backIn = new Route([[x + 1.1, z], [x + 0.42, z]]);
        g.backwards = true;
        g.walkSpeed = 0.8;
        g.setRoute(backIn, 0, backIn.length);
        g.after = () => {
          g.backwards = false;
          g.yawTarget = g.yaw = Math.PI / 2;
          this.seatGuest(g, c, s, false);
        };
      };
    }
  }

  update(dt, time) {
    // Simulated timers (respect pause).
    this.timers = (this.timers || []).filter((t) => {
      t.t -= dt;
      if (t.t <= 0) {
        t.fn();
        return false;
      }
      return true;
    });

    this.opsTimer += dt;
    this.queueOffset = Math.max(0, this.queueOffset - dt * 1.3);
    switch (this.ops) {
      case 'running':
        if (!this.train.running) this.startUnloading();
        break;
      case 'unloading': {
        const busy = this.seats.flat().some((g) => g && (g.task === 'seated' || g.task === 'standing'));
        if (!busy && this.opsTimer > 3.2 && (this.timers || []).length === 0) this.startLoading();
        break;
      }
      case 'loading': {
        const done = this.boarders.every((g) => g.task === 'seated');
        if (done) {
          this.ops = 'locking';
          this.opsTimer = 0;
        }
        break;
      }
      case 'locking':
        if (this.opsTimer > 1.0) {
          this.ops = 'ready';
          this.operator.waveTimer = 1.2;
        }
        break;
      default:
        break;
    }

    for (const g of this.guests) g.update(dt, time);
  }

  get statusText() {
    switch (this.ops) {
      case 'ready':
        return 'Ready to launch';
      case 'running':
        return 'Train on circuit';
      case 'unloading':
        return 'Unloading riders';
      case 'loading':
        return 'Boarding guests';
      case 'locking':
        return 'Checking restraints';
      default:
        return '';
    }
  }

  get riderCount() {
    return this.seats.flat().filter((g) => g && g.task === 'seated').length;
  }
}

function setTimeoutSim(people, delay, fn) {
  (people.timers ||= []).push({ t: delay, fn });
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

