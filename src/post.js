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
  uniform sampler2D tRaw;
  uniform float rawMode;
  uniform vec3 skyTopLin;
  uniform vec3 skyBottomLin;
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

  vec3 oklabToLinear(vec3 lab) {
    vec3 lms = vec3(
      lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z,
      lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z,
      lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z);
    lms = lms * lms * lms;
    return vec3(
      4.0767416621 * lms.x - 3.3077115913 * lms.y + 0.2309699292 * lms.z,
      -1.2684380046 * lms.x + 2.6097574011 * lms.y - 0.3413193965 * lms.z,
      -0.0041960863 * lms.x - 0.7034186147 * lms.y + 1.7076147010 * lms.z);
  }

  vec3 linearToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  // Gentle shoulder so bright highlights keep their hue instead of clipping to white.
  vec3 shoulder(vec3 c) {
    return c / (1.0 + 0.12 * max(max(c.r, c.g), c.b)) * 1.12;
  }

  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  // Orthographic depth is linear in [0,1].
  float viewDepth(vec2 uv) {
    return cameraNear + texture2D(tDepth, uv).r * (cameraFar - cameraNear);
  }

  void main() {
    if (rawMode > 0.5) {
      // Raw 3D: full-resolution MSAA render, unquantised. The target is cleared to transparent black,
      // so alpha is coverage and the sky composites under anti-aliased edges.
      vec4 s = texture2D(tRaw, vUv);
      vec3 c = shoulder(max(s.rgb * exposure, vec3(0.0)));
      vec3 lab = linearToOklab(c);
      lab.yz *= intensity;
      c = max(oklabToLinear(lab), vec3(0.0));
      c += mix(skyBottomLin, skyTopLin, smoothstep(0.05, 0.95, vUv.y)) * (1.0 - s.a);
      gl_FragColor = vec4(linearToSrgb(clamp(c, 0.0, 1.0)), 1.0);
      return;
    }

    float raw = texture2D(tDepth, vUv).r;
    vec3 lab;
    if (raw >= 0.999999) {
      lab = mix(skyBottom, skyTop, smoothstep(0.05, 0.95, vUv.y));
    } else {
      vec3 c = texture2D(tColor, vUv).rgb * exposure;
      lab = linearToOklab(shoulder(c));
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
    const [skyTopLin, skyBottomLin] = [0x79c2e7, 0xcceffb].map((h) => {
      const c = new THREE.Color().setHex(h);
      return new THREE.Vector3(c.r, c.g, c.b);
    });
    this.raw = false;
    this.rawTarget = null;
    this.uniforms = {
      tColor: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      tRaw: { value: null },
      rawMode: { value: 0 },
      skyTopLin: { value: skyTopLin },
      skyBottomLin: { value: skyBottomLin },
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

  /** Pixel mode renders at (width, height); raw mode renders the same size at full device resolution. */
  setSize(width, height) {
    this.width = width;
    this.height = height;
    if (this.raw) {
      if (!this.rawTarget) {
        this.rawTarget = new THREE.WebGLRenderTarget(width, height, {
          type: THREE.HalfFloatType,
          samples: 4,
          generateMipmaps: false,
          depthBuffer: true,
        });
        this.uniforms.tRaw.value = this.rawTarget.texture;
      }
      this.rawTarget.setSize(width, height);
    } else {
      this.target.setSize(width, height);
      this.uniforms.texel.value.set(1 / width, 1 / height);
    }
  }

  setRaw(raw) {
    this.raw = raw;
    this.uniforms.rawMode.value = raw ? 1 : 0;
  }

  render(scene, camera, pixelWorld) {
    const r = this.renderer;
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
    // Planar surfaces change depth by at most ~1.5 px-widths per pixel in true isometric view.
    this.uniforms.outlineThreshold.value = Math.max(0.08, pixelWorld * 2.6);
    r.setRenderTarget(this.raw ? this.rawTarget : this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }
}
