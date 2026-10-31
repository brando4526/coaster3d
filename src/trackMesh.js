import * as THREE from 'three';
import { PAL } from './palette.js';
import { makeFrame, SPINE_OFFSET } from './track.js';

const SEG = 0.5;
const UP = new THREE.Vector3(0, 1, 0);

export function buildTrackGeometry(track, boxes) {
  const fr = makeFrame();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const ra = new THREE.Vector3();
  const rb = new THREE.Vector3();
  const n = Math.round(track.length / SEG);
  const spineCol = PAL.teal[3];
  const railCol = PAL.grey[4];
  const tieCol = PAL.teal[1];
  const fa = makeFrame();
  const fb = makeFrame();
  for (let k = 0; k < n; k++) {
    const s0 = k * SEG;
    const s1 = s0 + SEG;
    track.frame(s0, fa);
    track.frame(s1, fb);
    track.frame(s0 + SEG / 2, fr);
    a.copy(fa.p).addScaledVector(fa.u, SPINE_OFFSET);
    b.copy(fb.p).addScaledVector(fb.u, SPINE_OFFSET);
    boxes.segment(a, b, 0.46, 0.46, fr.u, spineCol, 0.06);
    for (const side of [-1, 1]) {
      ra.copy(fa.p).addScaledVector(fa.u, SPINE_OFFSET - 0.28).addScaledVector(fa.r, side * 0.6);
      rb.copy(fb.p).addScaledVector(fb.u, SPINE_OFFSET - 0.28).addScaledVector(fb.r, side * 0.6);
      boxes.segment(ra, rb, 0.18, 0.18, fr.u, railCol, 0.05);
    }
    if (k % 2 === 0) {
      const c = a.copy(fr.p).addScaledVector(fr.u, SPINE_OFFSET - 0.24);
      boxes.basis(c.x, c.y, c.z, fr.f, fr.u, fr.r, 0.16, 0.2, 1.36, tieCol);
    }
  }
}

/**
 * Places steel supports. Riders hang below the spine, so supports attach to the spine's top (+u side)
 * and are rejected if any part comes near the riders' sweep envelope or another track section.
 */
export function buildSupports(track, boxes, { blocked, skip }) {
  const fr = makeFrame();
  const hearts = [];
  const spines = [];
  for (let s = 0; s < track.length; s += 0.5) {
    track.frame(s, fr);
    hearts.push({ s, p: fr.p.clone() });
    spines.push({ s, p: fr.p.clone().addScaledVector(fr.u, SPINE_OFFSET) });
  }
  const sDist = (x, y) => {
    const d = Math.abs(x - y) % track.length;
    return Math.min(d, track.length - d);
  };

  const q = new THREE.Vector3();
  function segmentClear(p0, p1, sHere, attach) {
    const len = p0.distanceTo(p1);
    const steps = Math.max(1, Math.ceil(len / 0.35));
    for (let i = 0; i <= steps; i++) {
      q.lerpVectors(p0, p1, i / steps);
      const nearAttach = q.distanceTo(attach) < 1.3;
      for (const h of hearts) {
        if (nearAttach && sDist(h.s, sHere) < 2.5) continue;
        if (h.p.distanceToSquared(q) < 2.35 * 2.35) return false;
      }
      for (const sp of spines) {
        if (sDist(sp.s, sHere) < 3) continue;
        if (sp.p.distanceToSquared(q) < 1.0) return false;
      }
    }
    return true;
  }

  const placed = [];
  const colCol = PAL.orange[1];
  const footCol = PAL.grey[2];
  const rh = new THREE.Vector3();
  const uh = new THREE.Vector3();

  for (let s = 2; s < track.length; s += 6.5) {
    if (skip(s)) continue;
    track.frame(s, fr);
    const spine = fr.p.clone().addScaledVector(fr.u, SPINE_OFFSET);
    const A = spine.clone().addScaledVector(fr.u, 0.23);
    rh.set(fr.r.x, 0, fr.r.z);
    if (rh.lengthSq() < 1e-4) rh.set(fr.f.z, 0, -fr.f.x);
    rh.normalize();
    uh.set(fr.u.x, 0, fr.u.z);

    const options = [];
    if (fr.u.y > 0.45) {
      const T = A.clone().addScaledVector(UP, 0.95);
      const lean = Math.sign(uh.dot(rh)) || -1;
      for (const side of [lean, -lean]) {
        for (const reach of [2.5, 3.2]) {
          const C = T.clone().addScaledVector(rh, side * reach);
          options.push({ parts: [[A, T], [T, C]], col: C });
        }
      }
    } else if (fr.u.y < -0.45) {
      options.push({ parts: [], col: A.clone() });
      for (const side of [-1, 1]) {
        const C = A.clone().addScaledVector(rh, side * 2.6);
        options.push({ parts: [[A, C]], col: C });
      }
    } else if (uh.lengthSq() > 0.1) {
      uh.normalize();
      for (const reach of [1.8, 2.6]) {
        const C = A.clone().addScaledVector(uh, reach);
        options.push({ parts: [[A, C]], col: C });
      }
    }

    for (const opt of options) {
      const C = opt.col;
      if (C.y < 1.2 || blocked(C.x, C.z)) continue;
      if (placed.some((p) => Math.hypot(p.x - C.x, p.z - C.z) < 1.6)) continue;
      const G = new THREE.Vector3(C.x, 0, C.z);
      let ok = segmentClear(C, G, s, A);
      for (const [p0, p1] of opt.parts) ok = ok && segmentClear(p0, p1, s, A);
      if (!ok) continue;
      for (const [p0, p1] of opt.parts) boxes.segment(p0, p1, 0.34, 0.34, fr.f, colCol, 0.34);
      boxes.minMax(C.x - 0.22, 0, C.z - 0.22, C.x + 0.22, C.y + 0.17, C.z + 0.22, colCol);
      boxes.minMax(C.x - 0.5, -0.05, C.z - 0.5, C.x + 0.5, 0.35, C.z + 0.5, footCol);
      placed.push(C);
      break;
    }
  }
  return placed;
}
