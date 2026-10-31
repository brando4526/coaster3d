import * as THREE from 'three';

// Blocky, Minecraft-like proportions (world units; a person is ~2 units tall).
export const DIM = {
  thigh: 0.43,
  shin: 0.43,
  ankle: 0.12,
  hipW: 0.13,
  pelvisH: 0.95,
  torsoH: 0.62,
  torsoW: 0.5,
  torsoD: 0.28,
  shoulderW: 0.34,
  shoulderDrop: 0.07,
  upper: 0.31,
  fore: 0.31,
  head: 0.44,
  limb: 0.19,
};

const _d = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Analytic two-bone IK (law of cosines). Writes the middle joint (knee/elbow) and the reachable end.
 * `hint` is the direction the joint should bend towards.
 */
export function solveTwoBone(root, target, l1, l2, hint, outMid, outEnd) {
  _d.subVectors(target, root);
  let dist = _d.length();
  if (dist < 1e-6) {
    _d.set(0, -1, 0);
    dist = 1e-6;
  } else {
    _d.multiplyScalar(1 / dist);
  }
  const reach = THREE.MathUtils.clamp(dist, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-4);
  outEnd.copy(root).addScaledVector(_d, reach);
  const cosA = THREE.MathUtils.clamp((l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _b.copy(hint).addScaledVector(_d, -hint.dot(_d));
  if (_b.lengthSq() < 1e-8) _b.set(_d.y, -_d.x, 0);
  _b.normalize();
  outMid.copy(root).addScaledVector(_d, l1 * cosA).addScaledVector(_b, l1 * sinA);
}

const UP = new THREE.Vector3(0, 1, 0);

/** A box-rig: 16 instanced boxes driven by pelvis/torso orientation + IK targets for hands and feet. */
export class Rig {
  constructor(batch, look) {
    this.batch = batch;
    this.look = look;
    const sleeve = look.longSleeves ? look.shirt : look.skin;
    const shin = look.shorts ? look.skin : look.pants;
    this.id = {
      torso: batch.alloc(look.shirt),
      head: batch.alloc(look.skin),
      hairTop: batch.alloc(look.hat ?? look.hair),
      hairBack: batch.alloc(look.hat ?? look.hair),
      upper: [batch.alloc(look.shirt), batch.alloc(look.shirt)],
      fore: [batch.alloc(sleeve), batch.alloc(sleeve)],
      hand: [batch.alloc(look.skin), batch.alloc(look.skin)],
      thigh: [batch.alloc(look.pants), batch.alloc(look.pants)],
      shin: [batch.alloc(shin), batch.alloc(shin)],
      foot: [batch.alloc(look.shoes), batch.alloc(look.shoes)],
    };

    // Pose inputs (world space).
    this.pelvis = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.headYaw = 0;
    this.headPitch = 0;
    this.foot = [new THREE.Vector3(), new THREE.Vector3()];
    this.footDir = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)];
    this.footUp = [UP.clone(), UP.clone()];
    this.hand = [new THREE.Vector3(), new THREE.Vector3()];
    this.kneeHint = new THREE.Vector3(0, 0, 1);
    this.elbowHint = new THREE.Vector3(0, 0, -1);
    this.visible = true;

    // Derived (readable after update()).
    this.F = new THREE.Vector3();
    this.S = new THREE.Vector3();
    this.U = new THREE.Vector3();
    this.shoulder = [new THREE.Vector3(), new THREE.Vector3()];
    this.hip = [new THREE.Vector3(), new THREE.Vector3()];
    this._mid = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._hint = new THREE.Vector3();
    this._hF = new THREE.Vector3();
    this._hU = new THREE.Vector3();
    this._hS = new THREE.Vector3();
    this._c = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  /** Side sign: 0 = left (+S), 1 = right (-S). */
  static side(i) {
    return i === 0 ? 1 : -1;
  }

  /** Fills shoulder/hip joint positions from pelvis + orientation (call before choosing targets). */
  computeJoints() {
    const { F, S, U } = this;
    U.copy(this.up).normalize();
    F.copy(this.fwd).addScaledVector(U, -this.fwd.dot(U)).normalize();
    S.crossVectors(U, F);
    for (let i = 0; i < 2; i++) {
      const sd = Rig.side(i);
      this.hip[i].copy(this.pelvis).addScaledVector(S, sd * DIM.hipW);
      this.shoulder[i]
        .copy(this.pelvis)
        .addScaledVector(U, DIM.torsoH - DIM.shoulderDrop)
        .addScaledVector(S, sd * DIM.shoulderW);
    }
  }

  update() {
    const b = this.batch;
    const id = this.id;
    if (!this.visible) {
      for (const v of Object.values(id)) for (const k of [].concat(v)) b.hide(k);
      return;
    }
    this.computeJoints();
    const { F, S, U } = this;
    const c = this._c;

    c.copy(this.pelvis).addScaledVector(U, DIM.torsoH / 2 - 0.02);
    b.basis(id.torso, c.x, c.y, c.z, S, U, F, DIM.torsoW, DIM.torsoH + 0.04, DIM.torsoD);

    // Head: yaw about the torso up axis, then pitch about the head's side axis.
    const hF = this._hF;
    const hU = this._hU;
    const hS = this._hS;
    this._q.setFromAxisAngle(U, this.headYaw);
    hF.copy(F).applyQuaternion(this._q);
    hS.crossVectors(U, hF);
    this._q.setFromAxisAngle(hS, this.headPitch);
    hF.applyQuaternion(this._q);
    hU.copy(U).applyQuaternion(this._q);
    const H = DIM.head;
    c.copy(this.pelvis).addScaledVector(U, DIM.torsoH + 0.03).addScaledVector(hU, H / 2);
    b.basis(id.head, c.x, c.y, c.z, hS, hU, hF, H, H, H);
    if (this.look.hat) {
      const t = this._mid.copy(c).addScaledVector(hU, H / 2 + 0.04).addScaledVector(hF, 0.04);
      b.basis(id.hairTop, t.x, t.y, t.z, hS, hU, hF, H + 0.06, 0.12, H + 0.1);
      const br = this._mid.copy(c).addScaledVector(hU, H / 2 - 0.01).addScaledVector(hF, H / 2 + 0.12);
      b.basis(id.hairBack, br.x, br.y, br.z, hS, hU, hF, H * 0.9, 0.05, 0.26);
    } else {
      const t = this._mid.copy(c).addScaledVector(hU, H / 2 + 0.03);
      b.basis(id.hairTop, t.x, t.y, t.z, hS, hU, hF, H + 0.05, 0.1, H + 0.05);
      const bk = this._mid.copy(c).addScaledVector(hU, 0.06).addScaledVector(hF, -H / 2 - 0.03);
      b.basis(id.hairBack, bk.x, bk.y, bk.z, hS, hU, hF, H + 0.05, H * 0.75, 0.08);
    }

    const mid = this._mid;
    const end = this._end;
    const hint = this._hint;
    for (let i = 0; i < 2; i++) {
      const sd = Rig.side(i);
      // Legs: knees bend forward (and slightly outward).
      hint.copy(this.kneeHint).addScaledVector(S, sd * 0.15);
      solveTwoBone(this.hip[i], this.foot[i], DIM.thigh, DIM.shin, hint, mid, end);
      b.segment(id.thigh[i], this.hip[i], mid, DIM.limb + 0.01, DIM.limb + 0.01, F, 0.04);
      b.segment(id.shin[i], mid, end, DIM.limb, DIM.limb, F, 0.02);
      const fu = this.footUp[i];
      const fd = this._hF.copy(this.footDir[i]).addScaledVector(fu, -this.footDir[i].dot(fu)).normalize();
      const fs = hint.crossVectors(fu, fd).normalize();
      c.copy(end).addScaledVector(fd, 0.07).addScaledVector(fu, -DIM.ankle / 2);
      b.basis(id.foot[i], c.x, c.y, c.z, fs, fu, fd, 0.2, DIM.ankle, 0.32);

      // Arms: elbows bend backward and slightly outward.
      hint.copy(this.elbowHint).addScaledVector(S, sd * 0.35);
      solveTwoBone(this.shoulder[i], this.hand[i], DIM.upper, DIM.fore, hint, mid, end);
      b.segment(id.upper[i], this.shoulder[i], mid, DIM.limb - 0.01, DIM.limb - 0.01, F, 0.06);
      b.segment(id.fore[i], mid, end, DIM.limb - 0.02, DIM.limb - 0.02, F, 0.02);
      c.subVectors(end, mid).normalize();
      const hc = mid.copy(end).addScaledVector(c, 0.06);
      b.segment(id.hand[i], end, hc.addScaledVector(c, 0.06), 0.15, 0.15, F, 0.06);
    }
  }
}

const SHIRTS = ['red2', 'red3', 'orange1', 'yellow1', 'teal2', 'teal3', 'blue2', 'blue3', 'purple2', 'pink0', 'pink1', 'lime0', 'grass4', 'cream0', 'grey4'];
const PANTS = ['blue1', 'blue0', 'brown1', 'grey1', 'ink1', 'teal0', 'sand0', 'purple0'];
const HAIR = ['brown0', 'brown1', 'brown3', 'ink0', 'ink1', 'orange0', 'yellow0', 'red0', 'grey3'];
const SHOES = ['ink0', 'ink1', 'grey0', 'cream0', 'red1', 'brown0'];
const HATS = ['red2', 'blue2', 'yellow1', 'teal2', 'cream0', 'orange0'];

export function randomLook(PAL, rnd) {
  const pick = (arr) => {
    const key = arr[Math.floor(rnd() * arr.length)];
    const m = key.match(/^([a-z]+)(\d)$/);
    return PAL[m[1]][Number(m[2])];
  };
  return {
    shirt: pick(SHIRTS),
    pants: pick(PANTS),
    skin: PAL.skin[Math.floor(rnd() * PAL.skin.length)],
    hair: pick(HAIR),
    shoes: pick(SHOES),
    hat: rnd() < 0.28 ? pick(HATS) : null,
    longSleeves: rnd() < 0.3,
    shorts: rnd() < 0.3,
  };
}
