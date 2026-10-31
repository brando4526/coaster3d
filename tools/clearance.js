// Dev helper: reports walkway points that intrude into the riders' sweep envelope. Run: node tools/clearance.js
import * as THREE from 'three';
import { buildTrack } from '../src/layout.js';
import { makeFrame } from '../src/track.js';
import { PARK_LOOP, QUEUE_ROUTE, EXIT_ROUTE_TAIL, PATH_POLYLINES, Route, groundHeight } from '../src/world.js';

const track = buildTrack();
const fr = makeFrame();
const hearts = [];
for (let s = 0; s < track.length; s += 0.4) {
  track.frame(s, fr);
  hearts.push({ s, p: fr.p.clone() });
}

function check(name, route) {
  const p = new THREE.Vector3();
  const issues = [];
  for (let d = 0; d <= route.length; d += 0.5) {
    route.at(d, p);
    const g = groundHeight(p.x, p.z);
    for (const h of [0.6, 1.4, 2.1]) {
      const q = new THREE.Vector3(p.x, g + h, p.z);
      for (const ht of hearts) {
        if (ht.p.distanceTo(q) < 2.5) {
          issues.push(`${name} d=${d.toFixed(1)} (${p.x.toFixed(1)},${p.z.toFixed(1)}) near track s=${ht.s.toFixed(1)} heartY=${ht.p.y.toFixed(1)}`);
          break;
        }
      }
    }
  }
  const uniq = [...new Set(issues)];
  console.log(name, uniq.length ? `${uniq.length} conflicts` : 'clear');
  uniq.slice(0, 12).forEach((s) => console.log('  ', s));
}

check('park', PARK_LOOP);
check('queue', QUEUE_ROUTE);
check('exit', EXIT_ROUTE_TAIL);
PATH_POLYLINES.forEach((pl, i) => check(`deco${i}`, new Route(pl)));
