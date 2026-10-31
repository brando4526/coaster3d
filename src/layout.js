import * as THREE from 'three';
import { Track } from './track.js';

// Station runs along +x at the front of the diorama. All angles in degrees.
export const STATION = {
  heartY: 3.0,
  z: 14,
  x0: -22,
  length: 18,
};

export const LAYOUT = [
  { tag: 'station', len: STATION.length, profile: 'linear' },
  { tag: 'launch', len: 12, profile: 'linear' },
  // Top hat with a 90° twist at the crest.
  { tag: 'tophat', len: 8, pitch: 70 },
  { len: 2, profile: 'linear' },
  { len: 14, pitch: -140, yaw: -90 },
  { len: 2, profile: 'linear' },
  { len: 9, pitch: 70 },
  { len: 4, profile: 'linear' },
  // Back row (heading -x): banked turn, loop 1, zero-g roll.
  { tag: 'turn1', len: 15, yaw: -90, bank: -60 },
  { len: 3, bank: 0 },
  { tag: 'loop1', len: 34, pitch: 360, offset: 3.4, profile: 'loop' },
  { len: 3, profile: 'linear' },
  { len: 5, pitch: 22 },
  { tag: 'roll1', len: 16, roll: 360, pitch: -22 },
  { len: 2 },
  // Left-hand 180° banked turn into the middle row (heading +x).
  { tag: 'turn2', len: 22, yaw: -180, bank: -65, profile: 'turn' },
  { len: 3, bank: 0 },
  { tag: 'loop2', len: 34, pitch: 360, offset: -3.4, profile: 'loop' },
  { len: 3, profile: 'linear' },
  { len: 5, pitch: 14 },
  { tag: 'twist', len: 12, pitch: -14, roll: 360 },
  // Right-hand 180° banked turn into the near row (heading -x).
  { tag: 'turn3', len: 22, yaw: 180, bank: 62, profile: 'turn' },
  { len: 3, bank: 0 },
  { tag: 'loop3', len: 32, pitch: 360, offset: 3.4, profile: 'loop' },
  { len: 2, profile: 'linear' },
  // Diving roll sheds height before the final turn.
  { len: 3, pitch: -16 },
  { tag: 'roll2', len: 13, roll: -360, profile: 'linear' },
  { len: 3, pitch: 16 },
  // Final left U-turn onto the brake run.
  { tag: 'turn4', len: 25, yaw: -180, bank: -50, profile: 'turn' },
  { tag: 'brakes', len: 3, bank: 0 },
];

export function buildTrack() {
  return new Track({ pos: new THREE.Vector3(STATION.x0, STATION.heartY, STATION.z), yaw: 0 }, LAYOUT);
}
