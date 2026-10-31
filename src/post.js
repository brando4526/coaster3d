import * as THREE from 'three';
import { PALETTE, INK, oklabOfHex } from './palette.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Tilt-shift: a horizontal band around tiltFocus stays sharp and a Gaussian blur grows above and below it. The blur is
// separable: a pass over the scene target blurs horizontally into tTilt, and the final pass blurs that vertically.
// Colour is premultiplied (alpha = coverage), so blurred silhouettes fade into the sky instead of haloing.
const tiltGlsl = /* glsl */ `
  #define TILT_TAPS 16
  #define TILT_RAMP 0.35
  #define TILT_MIN_SIGMA 0.3
  uniform float tiltBlur;
  uniform float tiltFocus;
  uniform float tiltBand;

  // Blur sigma in render-target pixels at screen height y (0 = bottom, 1 = top).
  float tiltSigma(float y, float texelY) {
    float t = clamp((abs(y - tiltFocus) - tiltBand) / TILT_RAMP, 0.0, 1.0);
    return tiltBlur * (t * t * (3.0 - 2.0 * t)) / texelY;
  }

  // One axis of the Gaussian; px is the uv size of one pixel along that axis. Explicit-LOD fetches keep the
  // data-dependent loop legal on every GL backend.
  vec4 tiltGather(sampler2D tex, vec2 uv, vec2 px, float sigma) {
    vec4 sum = textureLod(tex, uv, 0.0);
    if (sigma < TILT_MIN_SIGMA) return sum;
    // Taps reach 3 sigma. Beyond a stride of one pixel each tap straddles two texels, so linear filtering folds them together.
    float stride = max(1.0, 3.0 * sigma / float(TILT_TAPS));
    float wsum = 1.0;
    for (int i = 1; i <= TILT_TAPS; i++) {
      float o = float(i) * stride - 0.5 * (stride - 1.0);
      if (o > 3.0 * sigma) break;
      float w = stride * exp(-0.5 * o * o / (sigma * sigma));
      sum += w * (textureLod(tex, uv + px * o, 0.0) + textureLod(tex, uv - px * o, 0.0));
      wsum += 2.0 * w;
    }
    return sum / wsum;
  }
`;

const tiltFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 texel;
  varying vec2 vUv;
  ${tiltGlsl}

  void main() {
    gl_FragColor = tiltGather(tSrc, vUv, vec2(texel.x, 0.0), tiltSigma(vUv.y, texel.y));
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  #define PAL_SIZE ${PALETTE.length}

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tRaw;
  uniform sampler2D tTilt;
  uniform float rawMode;
  uniform float tiltOn;
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
  ${tiltGlsl}

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
    // Blur radius for this row; zero when the lens is off or the row is inside the sharp band.
    float sigma = tiltOn > 0.5 ? tiltSigma(vUv.y, texel.y) : 0.0;
    bool blurred = sigma >= TILT_MIN_SIGMA;

    if (rawMode > 0.5) {
      // Raw 3D: full-resolution MSAA render, unquantised. The target is cleared to transparent black,
      // so alpha is coverage and the sky composites under anti-aliased edges.
      vec4 s;
      if (blurred) s = tiltGather(tTilt, vUv, vec2(0.0, texel.y), sigma);
      else s = texture2D(tRaw, vUv);
      vec3 c = shoulder(max(s.rgb * exposure, vec3(0.0)));
      vec3 lab = linearToOklab(c);
      lab.yz *= intensity;
      c = max(oklabToLinear(lab), vec3(0.0));
      c += mix(skyBottomLin, skyTopLin, smoothstep(0.05, 0.95, vUv.y)) * (1.0 - s.a);
      gl_FragColor = vec4(linearToSrgb(clamp(c, 0.0, 1.0)), 1.0);
      return;
    }

    float raw = texture2D(tDepth, vUv).r;
    vec3 skyLab = mix(skyBottom, skyTop, smoothstep(0.05, 0.95, vUv.y));
    vec3 lab = skyLab;
    if (raw < 0.999999) lab = linearToOklab(shoulder(texture2D(tColor, vUv).rgb * exposure));
    float smear = 0.0;
    if (blurred) {
      // Blurred rows come from the tilt target (premultiplied, alpha = coverage), so blend scene and sky by coverage.
      vec4 s = tiltGather(tTilt, vUv, vec2(0.0, texel.y), sigma);
      vec3 blurLab = mix(skyLab, linearToOklab(shoulder(s.rgb / max(s.a, 1e-4) * exposure)), s.a);
      smear = distance(blurLab, lab);
      lab = blurLab;
    }
    lab.yz *= intensity;
    // Where the blur changed a pixel, dither wider so the smoothed gradient steps through the palette instead of snapping to it.
    lab.x += (bayer4(gl_FragCoord.xy) - 0.5) * dither * (1.0 + 4.0 * smoothstep(0.03, 0.12, smear));

    vec3 outRgb = palRgb[0];
    float best = 1e9;
    for (int i = 0; i < PAL_SIZE; i++) {
      vec3 d = lab - palLab[i];
      d.yz *= 1.35;
      float dist = dot(d, d);
      if (dist < best) { best = dist; outRgb = palRgb[i]; }
    }

    // Defocused rows lose their outlines.
    if (outlineOn > 0.5 && sigma < 0.9) {
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
    this.tilt = false;
    this.tiltTarget = null;
    this.uniforms = {
      tColor: { value: this.target.texture },
      tDepth: { value: this.target.depthTexture },
      tRaw: { value: null },
      tTilt: { value: null },
      rawMode: { value: 0 },
      tiltOn: { value: 0 },
      // Defaults mirror the tilt-shift sliders in index.html (60% blur, 50% position, 30% width).
      tiltBlur: { value: 0.0084 }, // sigma at the far edge of the ramp, as a fraction of the render height
      tiltFocus: { value: 0.5 }, // height of the focus line: 0 = bottom, 1 = top
      tiltBand: { value: 0.15 }, // half the height of the fully sharp band
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

    // Horizontal tilt-shift pass; shares the lens uniforms with the final pass so one slider drives both.
    this.tiltMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        texel: this.uniforms.texel,
        tiltBlur: this.uniforms.tiltBlur,
        tiltFocus: this.uniforms.tiltFocus,
        tiltBand: this.uniforms.tiltBand,
      },
      vertexShader,
      fragmentShader: tiltFragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    const tiltQuad = new THREE.Mesh(this.quad.geometry, this.tiltMaterial);
    tiltQuad.frustumCulled = false;
    this.tiltScene = new THREE.Scene();
    this.tiltScene.add(tiltQuad);
  }

  /** Pixel mode renders at (width, height); raw mode renders the same size at full device resolution. */
  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.uniforms.texel.value.set(1 / width, 1 / height);
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
    }
    this.syncTiltTarget();
  }

  setRaw(raw) {
    this.raw = raw;
    this.uniforms.rawMode.value = raw ? 1 : 0;
  }

  /** Tilt-shift lens: blurs above and below a sharp focus band (tune via the tilt* uniforms). */
  setTilt(on) {
    this.tilt = on;
    this.uniforms.tiltOn.value = on ? 1 : 0;
    this.syncTiltTarget();
  }

  /** The horizontal-blur target only exists, at the current size, while the lens is on. */
  syncTiltTarget() {
    if (!this.tilt) {
      this.tiltTarget?.dispose();
      this.tiltTarget = null;
      this.uniforms.tTilt.value = null;
      return;
    }
    if (!this.tiltTarget) {
      this.tiltTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
        type: THREE.HalfFloatType,
        generateMipmaps: false,
        depthBuffer: false,
      });
      this.uniforms.tTilt.value = this.tiltTarget.texture;
    }
    this.tiltTarget.setSize(this.width, this.height);
  }

  render(scene, camera, pixelWorld) {
    const r = this.renderer;
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
    // Planar surfaces change depth by at most ~1.5 px-widths per pixel in true isometric view.
    this.uniforms.outlineThreshold.value = Math.max(0.08, pixelWorld * 2.6);
    const sceneTarget = this.raw ? this.rawTarget : this.target;
    r.setRenderTarget(sceneTarget);
    r.render(scene, camera);
    if (this.tilt) {
      this.tiltMaterial.uniforms.tSrc.value = sceneTarget.texture;
      r.setRenderTarget(this.tiltTarget);
      r.render(this.tiltScene, this.postCamera);
    }
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }
}
