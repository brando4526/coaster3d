# Hammerhead — pixel-art voxel coaster diorama

A real-time Three.js (WebGL) diorama of **Hammerhead**, a modern steel flying coaster, rendered as crisp
pixel art through a low-resolution orthographic true-isometric camera, depth outlines and a strict
64-colour OKLab palette.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

Requires Node 18+ (Vite 5).

It also runs from any static web server (e.g. Apache/XAMPP): serve the project folder itself (an import map in
`index.html` loads `three` from `node_modules/`, so run `npm install` first), or serve the `dist/` build, which uses
relative paths and works from any subfolder.

## What's in the scene

- **Track** – 336-unit circuit built by a turtle integrator along the riders' heartline: LSM launch,
  twisted top hat, **exactly 3 vertical loops** (clothoid/teardrop profile with lateral offset),
  zero-g roll, inline twist, diving roll and four banked turns, closed with a Hermite brake run.
  Riders hang beneath the spine; the spine sits 1.75 units above the heartline along the rolled up-vector.
- **Supports** – placed automatically every ~6.5 units and attached to the spine's top side. Each
  candidate (overhead gantry, straight-down column for inverted sections, side arm) is rejected if it
  would enter the riders' sweep envelope or another part of the track.
- **Train** – **exactly 3 cars**, 4 seats each, hammerhead-shark nose and tail fin. Physics uses gravity
  along the averaged slope, drag, a launch, tire boosters on flat track (sized so it always clears the
  next hill), trim brakes and a station stop.
- **People** – Minecraft-proportioned box rigs with **analytic two-bone IK** for arms and legs:
  - queueing guests shift their weight (the relaxed knee bends, heel lifts), look around, fidget,
    use their phones and watch the train;
  - park visitors walk with a procedural foot-planting gait (arms swing against the legs);
  - riders sit with legs dangling along the felt acceleration (gravity − acceleration), and either hold the
    restraints or raise their arms;
  - a full station cycle: unload → exit ramp → wander → rejoin queue → board (walk in, back into seat, sit).
- **Terrain** – grass/path/pond tiles on a layered diorama slab, voxel trees, flowers, lamps, benches,
  queue switchbacks, open station with striped canopies and the double-sided **HAMMERHEAD** marquee sign
  (5-row pixel font, chasing bulbs) above the station entrance.

## Rendering pipeline

1. The scene renders into a low-resolution render target (`viewport / pixel size`) with a depth texture.
2. A full-screen pass:
   - converts each pixel to **OKLab**, applies brightness and palette-intensity (chroma) scaling and an
     optional 4×4 Bayer dither on lightness;
   - snaps it to the nearest of the **64 palette colours** in OKLab space;
   - draws dark **depth outlines** (one low-res pixel, i.e. pixel-size screen pixels thick) on the far side of
     every depth discontinuity, with a threshold scaled to the world size of a pixel so flat slopes don't outline.
3. The low-res canvas is upscaled with `image-rendering: pixelated` at an integer device-pixel scale.

**Raw 3D** mode replaces this pipeline: the scene renders at full device resolution into a 4× MSAA target and is
output with only brightness/intensity and sRGB encoding applied.

The palette is generated in `src/palette.js` from OKLCh ramps (hue-shifted shadows/highlights) and gamut-mapped
into sRGB; the module throws if it ever exceeds 64 entries.

## Controls

| Control | Action |
| --- | --- |
| **Launch train** / `L` | Dispatch the train (enabled once loading has finished) |
| **Pause / Play** / `Space` | Freeze or resume all animation |
| Auto-dispatch | Launch automatically whenever the train is ready |
| Zoom slider / mouse wheel / `+` `-` | Orthographic zoom (0.6×–6×) |
| ⟲ / ⟳ / `Q` `E` | Rotate 90°, always landing on a true-isometric angle |
| Follow coaster cars / `F` | Camera tracks the middle car (stays orthographic isometric; panning releases it) |
| Drag / right-drag (or shift-drag) | Orbit (snaps back to isometric on release) / pan |
| **Reset view** / `R` | Fit the whole diorama (also stops following) |
| Raw 3D / `V` | Bypass the pixel filter: full-resolution MSAA render with no palette, outlines or dither |
| Depth outlines / `O` | Toggle outlines |
| Ordered dithering | Toggle Bayer dithering |
| Brightness, Palette intensity | Pre-quantisation exposure and OKLab chroma scale (output stays within the palette) |
| Pixel size | 2–6 screen pixels per art pixel (default 2) |

## Project layout

```
index.html            UI shell + side panel
src/main.js           renderer, lights, world assembly, UI wiring, main loop
src/palette.js        OKLab maths and the 64-colour palette
src/post.js           low-res target, outlines, OKLab quantisation
src/voxels.js         static/dynamic instanced box batches (one draw call each)
src/track.js          heartline integrator, frames, arc-length lookup
src/layout.js         the Hammerhead element list
src/trackMesh.js      track voxels and collision-checked supports
src/world.js          base bounds, station, ramps, walk routes, ground height
src/scenery.js        terrain, station, sign, queue, props, trees, clouds
src/rig.js            box-rig character + two-bone IK
src/people.js         guest behaviours, gait, seating and station operations
src/train.js          cars and ride physics
src/camera.js         true-isometric orthographic camera controller
tools/plan.js         ASCII plan of the layout (node tools/plan.js)
tools/clearance.js    walkway vs. rider-envelope clearance check
tools/sim.js          headless one-lap physics run
```
