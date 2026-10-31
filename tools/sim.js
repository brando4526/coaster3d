// Dev helper: simulates one launch -> lap -> stop headlessly and prints the speed profile. Run: node tools/sim.js
import { buildTrack } from '../src/layout.js';
import { Train } from '../src/train.js';

const track = buildTrack();
const batch = { n: 0, alloc() { return this.n++; }, basis() {} };
const train = new Train(track, batch);
train.launch();

const tagAt = (s) => track.tags.find((z) => s >= z.s0 && s <= z.s1)?.tag ?? '-';
let time = 0;
let minV = Infinity;
let lastTag = '';
while (train.state !== 'stopped' || time < 1) {
  train.update(1 / 60);
  time += 1 / 60;
  const tag = tagAt(train.s);
  if (tag !== lastTag) {
    const y = track.P[Math.floor(train.s / 0.1) * 3 + 1];
    console.log(`${time.toFixed(1).padStart(5)}s  ${tag.padEnd(8)} v=${train.v.toFixed(1).padStart(4)}  heart y=${y.toFixed(1)}`);
    lastTag = tag;
  }
  if (train.state === 'running') minV = Math.min(minV, train.v);
  if (time > 200) throw new Error(`Train did not return (state ${train.state}, s ${train.s.toFixed(1)})`);
}
console.log(`ride ${time.toFixed(1)}s, top speed ${train.maxSpeed.toFixed(1)}, min running speed ${minV.toFixed(1)}, stopped at s=${train.s.toFixed(2)}`);
