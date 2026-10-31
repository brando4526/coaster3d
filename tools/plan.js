// Dev helper: prints an ASCII plan of the coaster layout. Run: node tools/plan.js
import { buildTrack } from '../src/layout.js';
import { makeFrame } from '../src/track.js';

const t = buildTrack();
const fr = makeFrame();
console.log('length', t.length.toFixed(1), 'closing gap', t.closingGap.toFixed(2));
for (const z of t.tags) {
  t.frame(z.s0, fr);
  const a = fr.p.clone();
  t.frame(z.s1, fr);
  console.log(z.tag.padEnd(8), z.s0.toFixed(1).padStart(6), z.s1.toFixed(1).padStart(6), ' start', a.toArray().map((v) => v.toFixed(1)).join(','), ' end', fr.p.toArray().map((v) => v.toFixed(1)).join(','));
}

let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = 0, minFeet = 1e9;
const W = 90, H = 64, X0 = -45, Z0 = -34;
const grid = Array.from({ length: H }, () => Array(W).fill(' '));
for (let s = 0; s < t.length; s += 0.5) {
  t.frame(s, fr);
  const { p, u } = fr;
  minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
  minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  maxY = Math.max(maxY, p.y);
  minFeet = Math.min(minFeet, p.y - u.y * 1.2);
  const gx = Math.round(p.x - X0), gz = Math.round(p.z - Z0);
  if (gx >= 0 && gx < W && gz >= 0 && gz < H) {
    grid[gz][gx] = p.y < 4 ? '.' : p.y < 8 ? 'o' : p.y < 12 ? 'O' : '#';
  }
}
console.log(`x ${minX.toFixed(1)}..${maxX.toFixed(1)} z ${minZ.toFixed(1)}..${maxZ.toFixed(1)} maxY ${maxY.toFixed(1)} minFeetY ${minFeet.toFixed(2)}`);
console.log(grid.map((r, i) => String(i + Z0).padStart(4) + ' ' + r.join('')).join('\n'));
