import * as THREE from 'three';

export const ISO_ELEVATION = Math.atan(1 / Math.SQRT2); // 35.264° -> axes project at 30° (true isometric)
const QUARTER = Math.PI / 2;
const BASE_AZ = Math.PI / 4;

export class IsoCamera {
  constructor(dom, { target, viewHeight }) {
    this.dom = dom;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 600);
    this.homeTarget = target.clone();
    this.homeViewHeight = viewHeight;
    this.target = target.clone();
    this.viewHeight = viewHeight;
    this.zoom = 1;
    this.zoomTarget = 1;
    this.azimuth = BASE_AZ;
    this.azTarget = BASE_AZ;
    this.distance = 220;
    this.lowH = 1;
    this.aspect = 1;
    this.onChange = null;
    this.dragging = null;
    this._bindEvents();
  }

  get pixelWorld() {
    return this.viewHeight / this.zoom / this.lowH;
  }

  rotate(steps) {
    this.azTarget = BASE_AZ + (Math.round((this.azTarget - BASE_AZ) / QUARTER) + steps) * QUARTER;
  }

  setZoom(z) {
    this.zoomTarget = THREE.MathUtils.clamp(z, 0.6, 6);
    this.onChange?.();
  }

  reset() {
    this.target.copy(this.homeTarget);
    this.zoomTarget = 1;
    const k = Math.round((this.azimuth - BASE_AZ) / (2 * Math.PI));
    this.azTarget = BASE_AZ + k * 2 * Math.PI;
    this.onChange?.();
  }

  setViewport(lowW, lowH) {
    this.lowH = lowH;
    this.aspect = lowW / lowH;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 9);
    if (!this.dragging || this.dragging.mode !== 'rotate') this.azimuth += (this.azTarget - this.azimuth) * k;
    this.zoom += (this.zoomTarget - this.zoom) * k;
    if (Math.abs(this.zoom - this.zoomTarget) < 1e-4) this.zoom = this.zoomTarget;
    if (Math.abs(this.azimuth - this.azTarget) < 1e-5) this.azimuth = this.azTarget;

    const cam = this.camera;
    const h = this.viewHeight / 2;
    cam.left = -h * this.aspect;
    cam.right = h * this.aspect;
    cam.top = h;
    cam.bottom = -h;
    cam.zoom = this.zoom;
    cam.updateProjectionMatrix();

    const ce = Math.cos(ISO_ELEVATION);
    const dir = new THREE.Vector3(ce * Math.sin(this.azimuth), Math.sin(ISO_ELEVATION), ce * Math.cos(this.azimuth));
    // Snap the target to the low-res pixel grid so static voxels never shimmer while idle.
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const pw = this.pixelWorld;
    const tx = Math.round(this.target.dot(right) / pw) * pw;
    const ty = Math.round(this.target.dot(up) / pw) * pw;
    const tz = this.target.dot(dir);
    const snapped = new THREE.Vector3().addScaledVector(right, tx).addScaledVector(up, ty).addScaledVector(dir, tz);
    cam.position.copy(snapped).addScaledVector(dir, this.distance);
    cam.up.set(0, 1, 0);
    cam.lookAt(snapped);
    cam.updateMatrixWorld();
  }

  _bindEvents() {
    const el = this.dom;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(this.zoomTarget * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    el.addEventListener('pointerdown', (e) => {
      const pan = e.button === 2 || e.button === 1 || e.shiftKey;
      this.dragging = { mode: pan ? 'pan' : 'rotate', x: e.clientX, y: e.clientY, moved: 0 };
      if (pan) this.onPanStart?.();
      el.setPointerCapture(e.pointerId);
      el.classList.add(pan ? 'panning' : 'rotating');
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.dragging;
      if (!d) return;
      if (e.buttons === 0) {
        end(e);
        return;
      }
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.mode === 'rotate') {
        this.azimuth -= dx * 0.008;
        this.azTarget = this.azimuth;
      } else {
        const scale = (this.viewHeight / this.zoom) / el.clientHeight;
        const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
        const fwd = new THREE.Vector3(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
        this.target.addScaledVector(right, -dx * scale).addScaledVector(fwd, (dy * scale) / Math.sin(ISO_ELEVATION));
        this.target.x = THREE.MathUtils.clamp(this.target.x, -50, 35);
        this.target.z = THREE.MathUtils.clamp(this.target.z, -30, 38);
      }
    });
    const end = (e) => {
      if (!this.dragging) return;
      if (this.dragging.mode === 'rotate') {
        // Release snaps back to the nearest true-isometric angle.
        this.azTarget = BASE_AZ + Math.round((this.azimuth - BASE_AZ) / QUARTER) * QUARTER;
      }
      this.dragging = null;
      el.classList.remove('panning', 'rotating');
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      this.onChange?.();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  /** Frames an axis-aligned box (true-iso, current aspect) and makes it the home view. */
  fitBox(box, margin = 1.04) {
    const ce = Math.cos(ISO_ELEVATION);
    const az = BASE_AZ;
    const dir = new THREE.Vector3(ce * Math.sin(az), Math.sin(ISO_ELEVATION), ce * Math.cos(az));
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    let minR = Infinity;
    let maxR = -Infinity;
    let minU = Infinity;
    let maxU = -Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      const r = p.dot(right);
      const u = p.dot(up);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
    }
    const w = maxR - minR;
    const h = maxU - minU;
    const center = box.getCenter(new THREE.Vector3());
    const cr = (minR + maxR) / 2 - center.dot(right);
    const cu = (minU + maxU) / 2 - center.dot(up);
    const fitted = center.addScaledVector(right, cr).addScaledVector(up, cu);
    const atHome = this.target.distanceTo(this.homeTarget) < 1e-3;
    this.homeTarget.copy(fitted);
    if (atHome) this.target.copy(fitted);
    this.viewHeight = Math.max(h, w / this.aspect) * margin;
  }
}
