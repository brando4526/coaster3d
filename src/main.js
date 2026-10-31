import * as THREE from 'three';
import { PALETTE, PAL, hexToCss } from './palette.js';
import { PixelPipeline } from './post.js';
import { StaticBoxes, DynamicBoxes } from './voxels.js';
import { buildTrack } from './layout.js';
import { makeFrame } from './track.js';
import { buildTrackGeometry, buildSupports } from './trackMesh.js';
import { buildScenery, isBlocked } from './scenery.js';
import { Train } from './train.js';
import { People } from './people.js';
import { IsoCamera } from './camera.js';
import { BASE } from './world.js';

// Deterministic RNG so the park layout is identical on every load.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const $ = (id) => document.getElementById(id);
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const viewport = $('viewport');
const canvas = $('scene');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const pipeline = new PixelPipeline(renderer);

// ---- Lighting: bright daylight sun + soft sky/ground ambient ----
const hemi = new THREE.HemisphereLight(0xd8f0ff, 0xb8d890, 1.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff4e0, 2.45);
const sunDir = new THREE.Vector3(0.36, 1, 0.62).normalize();
const baseCenter = new THREE.Vector3((BASE.x0 + BASE.x1) / 2, 0, (BASE.z0 + BASE.z1) / 2);
sun.position.copy(baseCenter).addScaledVector(sunDir, 90);
sun.target.position.copy(baseCenter);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -58;
sc.right = 58;
sc.top = 58;
sc.bottom = -58;
sc.near = 10;
sc.far = 190;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ---- World ----
const rnd = mulberry32(20261030);
const track = buildTrack();
const staticBoxes = new StaticBoxes();
buildTrackGeometry(track, staticBoxes);

const station = track.zone('station');
const closing = track.zone('closing');
const supports = buildSupports(track, staticBoxes, {
  blocked: (x, z) => isBlocked(x, z, 0.7),
  skip: (s) => (s >= station.s0 - 1 && s <= station.s1 + 0.5) || s >= closing.s0 + 1,
});

const hearts = [];
const fr = makeFrame();
for (let s = 0; s < track.length; s += 0.6) hearts.push(track.frame(s, fr).p.clone());
const scenery = buildScenery({ boxes: staticBoxes, hearts, supports, rnd });
const staticMesh = staticBoxes.build();
scene.add(staticMesh);

const dynamic = new DynamicBoxes(1200);
scene.add(dynamic.mesh);
// Train parts don't cast shadows so riders under the car beam stay lit and readable.
const trainBatch = new DynamicBoxes(220, { castShadow: false });
scene.add(trainBatch.mesh);
const train = new Train(track, trainBatch);
const people = new People(dynamic, train, rnd);

const fx = new DynamicBoxes(400, { castShadow: false });
scene.add(fx.mesh);
const bulbIds = [];
for (const p of scenery.bulbSpots) {
  for (const side of [-1, 1]) {
    const id = fx.alloc(PAL.yellow[2]);
    fx.basis(id, p.x, p.y, p.z + side * 0.22, X, Y, Z, 0.17, 0.17, 0.08);
    bulbIds.push(id);
  }
}
const cloudBatch = new DynamicBoxes(64, { castShadow: false, receiveShadow: false });
scene.add(cloudBatch.mesh);
for (const cloud of scenery.clouds) for (const part of cloud.parts) part.id = cloudBatch.alloc(part.c);

console.info(`[hammerhead] ${staticBoxes.count} static voxels, ${supports.length} supports, track ${track.length.toFixed(0)} units, palette ${PALETTE.length} colours`);

// ---- Camera ----
const iso = new IsoCamera(viewport, { target: new THREE.Vector3(-8, 4, 4), viewHeight: 58 });
const dioramaBox = new THREE.Box3(new THREE.Vector3(BASE.x0, -3.9, BASE.z0), new THREE.Vector3(BASE.x1, 15, BASE.z1));

// ---- State & UI ----
const state = {
  playing: true,
  time: 0,
  pixelSize: 3,
  autoLaunch: false,
  autoTimer: 0,
  lowW: 1,
  lowH: 1,
};

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  const px = Math.max(1, Math.round(state.pixelSize * dpr));
  state.lowW = Math.max(16, Math.ceil((w * dpr) / px));
  state.lowH = Math.max(16, Math.ceil((h * dpr) / px));
  renderer.setSize(state.lowW, state.lowH, false);
  canvas.style.width = `${(state.lowW * px) / dpr}px`;
  canvas.style.height = `${(state.lowH * px) / dpr}px`;
  pipeline.setSize(state.lowW, state.lowH);
  iso.setViewport(state.lowW, state.lowH);
  iso.fitBox(dioramaBox);
  readBuf = new Uint8Array(state.lowW * state.lowH * 4);
}
let readBuf = new Uint8Array(4);
new ResizeObserver(resize).observe(viewport);
window.addEventListener('resize', resize);

const ui = {
  launch: $('btn-launch'),
  play: $('btn-play'),
  auto: $('chk-auto'),
  zoom: $('rng-zoom'),
  zoomOut: $('out-zoom'),
  outline: $('chk-outline'),
  dither: $('chk-dither'),
  bright: $('rng-bright'),
  brightOut: $('out-bright'),
  intensity: $('rng-intensity'),
  intensityOut: $('out-intensity'),
  pixel: $('rng-pixel'),
  pixelOut: $('out-pixel'),
  statusText: $('status-text'),
  statusDot: $('status-dot'),
  speed: $('stat-speed'),
  riders: $('stat-riders'),
  queue: $('stat-queue'),
  laps: $('stat-laps'),
  colours: $('screen-colours'),
};

$('palette-count').textContent = String(PALETTE.length);
const swatches = $('swatches');
for (const p of PALETTE) {
  const s = document.createElement('span');
  s.style.background = hexToCss(p.hex);
  s.title = `${p.name} ${hexToCss(p.hex)}`;
  swatches.appendChild(s);
}

function launch() {
  if (people.dispatch()) state.autoTimer = 0;
}
function togglePlay() {
  state.playing = !state.playing;
  ui.play.textContent = state.playing ? 'Pause' : 'Play';
  ui.play.setAttribute('aria-pressed', String(state.playing));
}
function syncZoomUi() {
  ui.zoom.value = String(iso.zoomTarget);
  ui.zoomOut.textContent = `${iso.zoomTarget.toFixed(1)}×`;
}
iso.onChange = syncZoomUi;

ui.launch.addEventListener('click', launch);
ui.play.addEventListener('click', togglePlay);
ui.auto.addEventListener('change', () => (state.autoLaunch = ui.auto.checked));
ui.zoom.addEventListener('input', () => iso.setZoom(Number(ui.zoom.value)));
$('btn-rot-left').addEventListener('click', () => iso.rotate(-1));
$('btn-rot-right').addEventListener('click', () => iso.rotate(1));
$('btn-reset').addEventListener('click', () => iso.reset());
ui.outline.addEventListener('change', () => (pipeline.uniforms.outlineOn.value = ui.outline.checked ? 1 : 0));
ui.dither.addEventListener('change', () => (pipeline.uniforms.dither.value = ui.dither.checked ? 0.035 : 0));
ui.bright.addEventListener('input', () => {
  pipeline.uniforms.exposure.value = Number(ui.bright.value);
  ui.brightOut.textContent = Number(ui.bright.value).toFixed(2);
});
ui.intensity.addEventListener('input', () => {
  pipeline.uniforms.intensity.value = Number(ui.intensity.value);
  ui.intensityOut.textContent = Number(ui.intensity.value).toFixed(2);
});
ui.pixel.addEventListener('input', () => {
  state.pixelSize = Number(ui.pixel.value);
  ui.pixelOut.textContent = `${state.pixelSize} px`;
  resize();
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'range') return;
  const k = e.key.toLowerCase();
  if (k === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (k === 'l') launch();
  else if (k === 'q') iso.rotate(-1);
  else if (k === 'e') iso.rotate(1);
  else if (k === 'r') iso.reset();
  else if (k === 'o') {
    ui.outline.checked = !ui.outline.checked;
    ui.outline.dispatchEvent(new Event('change'));
  } else if (k === '+' || k === '=') iso.setZoom(iso.zoomTarget * 1.15);
  else if (k === '-') iso.setZoom(iso.zoomTarget / 1.15);
});

// ---- Animation helpers ----
let bulbStep = -1;
function updateBulbs(t) {
  const step = Math.floor(t * 5);
  if (step === bulbStep) return;
  bulbStep = step;
  bulbIds.forEach((id, i) => fx.setColor(id, (Math.floor(i / 2) + step) % 3 === 0 ? PAL.cream[0] : PAL.orange[1]));
}
function updateClouds(t) {
  const hx = (BASE.x1 - BASE.x0) / 2;
  const hz = (BASE.z1 - BASE.z0) / 2;
  const camX = Math.sin(iso.azimuth);
  const camZ = Math.cos(iso.azimuth);
  for (const cloud of scenery.clouds) {
    const a = cloud.angle + t * 0.006;
    const ox = Math.cos(a) * hx * cloud.radius;
    const oz = Math.sin(a) * hz * cloud.radius;
    // Only draw clouds behind the diorama so they never block the view.
    const behind = (ox * camX + oz * camZ) / Math.hypot(ox, oz) < -0.15;
    for (const p of cloud.parts) {
      if (!behind) cloudBatch.hide(p.id);
      else cloudBatch.basis(p.id, baseCenter.x + ox + p.dx, cloud.y + p.dy, baseCenter.z + oz + p.dz, X, Y, Z, p.w, p.h, p.d);
    }
  }
  cloudBatch.commit();
}

function updateUi() {
  const busy = people.ops !== 'ready';
  ui.statusText.textContent = people.statusText;
  ui.statusDot.className = `dot ${people.ops === 'running' ? 'running' : busy ? 'busy' : ''}`;
  ui.launch.disabled = !people.canLaunch;
  ui.launch.textContent = people.canLaunch ? 'Launch train' : people.ops === 'running' ? 'Train running…' : 'Loading…';
  ui.speed.textContent = `${Math.round(train.v * 3.6)} km/h`;
  ui.riders.textContent = `${people.riderCount} / 12`;
  ui.queue.textContent = String(people.queue.length);
  ui.laps.textContent = String(train.laps);
}

function countScreenColours() {
  const gl = renderer.getContext();
  gl.readPixels(0, 0, state.lowW, state.lowH, gl.RGBA, gl.UNSIGNED_BYTE, readBuf);
  const seen = new Set();
  for (let i = 0; i < readBuf.length; i += 4) seen.add((readBuf[i] << 16) | (readBuf[i + 1] << 8) | readBuf[i + 2]);
  return seen;
}

// ---- Main loop ----
resize();
let lastNow = performance.now();
let uiTimer = 0;
let colourTimer = 0.5;
function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 1 / 20);
  lastNow = now;
  if (state.playing) {
    state.time += dt;
    train.update(dt);
    people.update(dt, state.time);
    updateBulbs(state.time);
    if (state.autoLaunch && people.canLaunch) {
      state.autoTimer += dt;
      if (state.autoTimer > 2.5) launch();
    } else state.autoTimer = 0;
  }
  train.write();
  trainBatch.commit();
  dynamic.commit();
  fx.commit();
  iso.update(dt);
  updateClouds(state.time);
  pipeline.render(scene, iso.camera, iso.pixelWorld);

  colourTimer -= dt;
  if (colourTimer <= 0) {
    colourTimer = 1;
    const seen = countScreenColours();
    ui.colours.textContent = `${seen.size} / ${PALETTE.length}`;
    window.__hammerhead.lastColours = seen;
  }
  uiTimer -= dt;
  if (uiTimer <= 0) {
    uiTimer = 0.1;
    updateUi();
  }
  requestAnimationFrame(frame);
}

// Debug/automation hooks.
window.__hammerhead = { train, people, iso, pipeline, track, launch, state, palette: PALETTE, lastColours: null };

$('loading').remove();
syncZoomUi();
requestAnimationFrame(frame);
