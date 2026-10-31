import * as THREE from 'three';
import { PALETTE, INK, oklabOfHex } from './palette.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define PAL_SIZE ${PALETTE.length}

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 texel;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float outlineOn;
  uniform float outlineThreshold;
  uniform float exposure;
  uniform float intensity;
  uniform float dither;
  uniform vec3 skyTop;
  uniform vec3 skyBottom;
  uniform vec3 palLab[PAL_SIZE];
  uniform vec3 palRgb[PAL_SIZE];
  uniform vec3 inkRgb;
  varying vec2 vUv;

  vec3 linearToOklab(vec3 c) {
    vec3 lms = vec3(
      0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b,
      0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b,
      0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
    lms = pow(max(lms, vec3(0.0)), vec3(1.0 / 3.0));
    return vec3(
      0.2104542553 * lms.x + 0.7936177850 * lms.y - 0.0040720468 * lms.z,
      1.9779984951 * lms.x - 2.4285922050 * lms.y + 0.4505937099 * lms.z,
      0.0259040371 * lms.x + 0.7827717662 * lms.y - 0.8086757660 * lms.z);
  }

  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  // Orthographic depth is linear in [0,1].
  float viewDepth(vec2 uv) {
    return cameraNear + texture2D(tDepth, uv).r * (cameraFar - cameraNear);
  }

  void main() {
    float raw = texture2D(tDepth, vUv).r;
    vec3 lab;
    if (raw >= 0.999999) {
      lab = mix(skyBottom, skyTop, smoothstep(0.05, 0.95, vUv.y));
    } else {
      vec3 c = texture2D(tColor, vUv).rgb * exposure;
      // Gentle shoulder so bright highlights keep their hue instead of clipping to white.
      c = c / (1.0 + 0.12 * max(max(c.r, c.g), c.b));
      lab = linearToOklab(c * 1.12);
    }
    lab.yz *= intensity;
    lab.x += (bayer4(gl_FragCoord.xy) - 0.5) * dither;

    vec3 outRgb = palRgb[0];
    float best = 1e9;
    for (int i = 0; i < PAL_SIZE; i++) {
      vec3 d = lab - palLab[i];
      d.yz *= 1.35;
      float dist = dot(d, d);
      if (dist < best) { best = dist; outRgb = palRgb[i]; }
    }

    if (outlineOn > 0.5) {
      float z = cameraNear + raw * (cameraFar - cameraNear);
      float zl = viewDepth(vUv - vec2(texel.x, 0.0));
      float zr = viewDepth(vUv + vec2(texel.x, 0.0));
      float zd = viewDepth(vUv - vec2(0.0, texel.y));
      float zu = viewDepth(vUv + vec2(0.0, texel.y));
      float nearest = min(min(zl, zr), min(zd, zu));
      // Outline lands on the far side of every depth discontinuity -> crisp silhouette ring.
      if (z - nearest > outlineThreshold) outRgb = inkRgb;
    }

    gl_FragColor = vec4(outRgb, 1.0);
  }
`;

const toVec3Rgb = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

export class PixelPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 1;
    this.height = 1;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
    });
    this.target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);

    const [skyTop, skyBottom] = [0x79c2e7, 0xcceffb].map((h) => new THREE.Vector3(...oklabOfHex(h)));
    this.uniforms = {
      tColor: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      texel: { value: new THREE.Vector2(1, 1) },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 1000 },
      outlineOn: { value: 1 },
      outlineThreshold: { value: 0.4 },
      exposure: { value: 1 },
      intensity: { value: 1 },
      dither: { value: 0.035 },
      skyTop: { value: skyTop },
      skyBottom: { value: skyBottom },
      palLab: { value: PALETTE.map((p) => new THREE.Vector3(...p.lab)) },
      palRgb: { value: PALETTE.map((p) => toVec3Rgb(p.hex)) },
      inkRgb: { value: toVec3Rgb(INK) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.target.setSize(width, height);
    this.uniforms.texel.value.set(1 / width, 1 / height);
  }

  render(scene, camera, pixelWorld) {
    const r = this.renderer;
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
    // Planar surfaces change depth by at most ~1.5 px-widths per pixel in true isometric view.
    this.uniforms.outlineThreshold.value = Math.max(0.08, pixelWorld * 2.6);
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }
}
