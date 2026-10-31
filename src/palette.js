// 64-colour palette authored in OKLCh and converted through OKLab -> sRGB.
// Every colour that reaches the screen is snapped to one of these entries.

export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function oklchToLinear(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  return oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// Gamut-map by reducing chroma at constant lightness/hue (keeps the OKLab perceptual intent).
function oklchToSrgb8(L, C, h) {
  let rgb = oklchToLinear(L, C, h);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear(L, lo, h);
  }
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.max(0, v)))) * 255));
}

// Ramps of [L, C, hue]. Shadows drift cool, highlights drift warm (pixel-art hue shifting).
const RAMPS = {
  ink: [[0.17, 0.04, 285], [0.27, 0.05, 285], [0.37, 0.05, 280]],
  grey: [[0.47, 0.025, 262], [0.58, 0.022, 258], [0.69, 0.02, 252], [0.8, 0.015, 248], [0.9, 0.01, 245], [0.97, 0.006, 240]],
  grass: [[0.34, 0.08, 160], [0.43, 0.11, 152], [0.52, 0.135, 145], [0.61, 0.15, 140], [0.7, 0.16, 135], [0.79, 0.15, 128], [0.87, 0.13, 120]],
  lime: [[0.8, 0.18, 118], [0.9, 0.15, 112]],
  blue: [[0.38, 0.1, 262], [0.48, 0.12, 255], [0.58, 0.12, 248], [0.68, 0.11, 240], [0.78, 0.09, 232], [0.86, 0.065, 225], [0.93, 0.04, 220]],
  teal: [[0.4, 0.07, 205], [0.5, 0.09, 200], [0.6, 0.11, 195], [0.7, 0.12, 190], [0.8, 0.12, 185], [0.89, 0.09, 180]],
  red: [[0.36, 0.11, 20], [0.46, 0.15, 25], [0.56, 0.18, 28], [0.66, 0.17, 33], [0.76, 0.13, 40]],
  orange: [[0.62, 0.16, 50], [0.72, 0.16, 60], [0.82, 0.13, 70]],
  yellow: [[0.78, 0.15, 88], [0.87, 0.16, 98], [0.94, 0.11, 102]],
  brown: [[0.3, 0.05, 40], [0.38, 0.06, 48], [0.46, 0.07, 55], [0.54, 0.075, 60], [0.62, 0.07, 65]],
  sand: [[0.7, 0.055, 75], [0.78, 0.05, 80], [0.86, 0.045, 85], [0.93, 0.03, 90]],
  skin: [[0.52, 0.07, 45], [0.64, 0.08, 55], [0.75, 0.075, 60], [0.84, 0.06, 65]],
  purple: [[0.38, 0.11, 300], [0.48, 0.14, 305], [0.6, 0.15, 310], [0.72, 0.12, 315]],
  pink: [[0.62, 0.15, 355], [0.74, 0.12, 358], [0.85, 0.07, 0]],
  moss: [[0.27, 0.05, 170]],
  cream: [[0.97, 0.02, 95]],
};

export const MAX_COLOURS = 64;
export const PAL = {};
export const PALETTE = [];

const seen = new Set();
for (const [name, ramp] of Object.entries(RAMPS)) {
  PAL[name] = ramp.map(([L, C, h], i) => {
    const [r, g, b] = oklchToSrgb8(L, C, h);
    const hex = (r << 16) | (g << 8) | b;
    if (!seen.has(hex)) {
      seen.add(hex);
      const lab = linearToOklab(srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255));
      PALETTE.push({ hex, rgb: [r, g, b], lab, name: ramp.length > 1 ? `${name} ${i}` : name });
    }
    return hex;
  });
}

if (PALETTE.length > MAX_COLOURS) {
  throw new Error(`Palette has ${PALETTE.length} colours; the limit is ${MAX_COLOURS}.`);
}

export const INK = PAL.ink[0];

export function hexToCss(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

export function oklabOfHex(hex) {
  return linearToOklab(
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  );
}
