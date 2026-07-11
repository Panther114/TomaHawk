# TomaHawk product trailer — design

## Goal

Produce one self-contained MP4 product trailer for TomaHawk. It should make the
simulator feel like a serious modern-battle command product: cinematic and
futuristic, but grounded entirely in its actual simulation model and interface.

## Deliverable and scope

- A 42-second, 1920×1080, 30 fps H.264 MP4 rendered from a standalone
  `demo_video/` Remotion project.
- `demo_video/` and its rendered output stay local and are ignored by Git.
- The trailer uses recorded live simulation footage as its central product-evidence
  layer, enhanced by product-derived vector/HTML/SVG motion graphics and an
  original synthesized sound bed. It deliberately does not use stock footage,
  third-party music, logos, or unverified military imagery.
- No simulator source, behavior, data model, or runtime UI is changed.

## Audience and message

The audience is someone evaluating a tactical simulator. The film must explain
that TomaHawk models what a force detects and shares before it acts; it does not
give either force omniscience.

The core line is: **SEE THE BATTLE. NOT THE OMNISCIENCE.**

The narrative follows the product's actual loop: deploy → detect → fuse → plan
fires → resolve damage. It will visually call out force composition, imperfect
tracks, CEC fusion, command posture, coordinated missile raids, layered SAM /
CIWS defence, and the sea/ground/air operating picture.

## Art direction

The physical scene is a briefing film projected in a dark aerospace-control
environment: deep blue-black space, near-white instrument geometry, restrained
blue and red force markers, and amber for command-state emphasis. The tone is
precision engineering, not cyberpunk.

- Use the app's existing tactical vocabulary: equirectangular coastline contour,
  kilometer grid, thin WEZ/radar circles, compact ship/missile marks, operational
  labels, and dense but readable status fragments.
- Use single, solid text colors; avoid gradient text, scanline backgrounds,
  neon-magenta cyberpunk, glass-card decoration, and dashboard-card grids.
- Keep primary text inside the 160 px horizontal and 120 px vertical safe area.
  Main messages use a minimum 104 px display size, support copy 44–54 px, and
  technical labels are decorative unless briefly isolated.
- Use one high-attention animated focal system per scene. Transitions and camera
  motion use an exponential Bézier ease (`0.16, 1, 0.3, 1`), with no bounce or
  elastic motion.

## Timeline

| Time | Chapter | Picture and copy |
| --- | --- | --- |
| 0:00–0:05 | Signal | Black void; a narrow coordinate field and coastline resolve. `TOMAHAWK` then `MODERN BATTLE SIMULATOR`. |
| 0:05–0:10 | Deploy | Top-down camera descends onto the tactical grid as Blue and Red force packages materialize. `DEPLOY THE FORCE.` |
| 0:10–0:16 | Detect | Radar sweeps and uncertain contact ellipses resolve only where sensor coverage exists. `DETECT WHAT EXISTS.` |
| 0:16–0:22 | Fuse | Multiple local tracks converge into a delayed shared-force picture. `FUSE THE PICTURE.` |
| 0:22–0:29 | Decide | Aggression/posture, range rings, sector assignment, and engagement arcs form around observed targets. `PLAN THE FIGHT.` |
| 0:29–0:36 | Resolve | A synchronized anti-ship raid is met by area defence, ESSM, and terminal CIWS. `LAYERED DEFENCE. REAL CONSEQUENCES.` |
| 0:36–0:42 | Close | Camera pulls out to a polished product-map frame and end card: `SEE THE BATTLE. NOT THE OMNISCIENCE.` |

## Architecture

`demo_video/` is isolated from the app and exposes one registered composition:
`TomaHawkTrailer`. A small scene component owns each chapter, while a shared
visual layer owns camera interpolation, vector terrain/grid, particles, force
symbols, tactical rings, and typography. The composition embeds a recorded MP4
of a live, high-density simulator battle for the track, command, missile, and
defence sections. Product-native overlays frame and annotate that evidence;
they never substitute it. The capture is made from a fresh local app run and
does not mutate the simulator source or behavior.

Motion will be derived from `useCurrentFrame()`, `interpolate()`, and static
SVG/CSS primitives supported by Remotion. No CSS animation or runtime transition
is used. Every supplied asset lives under `demo_video/public/` and is referenced
with `staticFile()`.

The synthesized audio score is generated locally from non-copyrighted oscillator,
noise, and impact components, exported into `public/`, and mixed in Remotion.
It contains a low propulsion bed, sparse data pings, launches, and a muted end
hit—no spoken voiceover.

## Error handling and verification

- Rendering is performed after a Remotion Studio pass on port 3333.
- The capture is inspected to confirm it visibly contains ships, force inventory,
  tactical tracks, launched weapons, and live event-log activity before it is
  embedded in the trailer.
- Representative motion checkpoints are inspected through the studio rather than
  only using stills: title, force deployment, track fusion, strike peak, and end
  card.
- The final render is checked with `ffprobe` for a single video stream, one audio
  stream, 1920×1080 dimensions, 30 fps, and approximately 42 seconds duration.
- The project is rendered twice only if a render failure or visual defect is
  observed. The output file remains untracked.
- Existing user changes are out of scope and will not be staged, modified, or
  incorporated into this trailer work.

## Decisions and exclusions

This is a product trailer rather than a gameplay recording. It is therefore
allowed to use a curated, high-density tactical scenario and cinematic camera
movement that the interactive app does not offer; all visual claims remain tied
to implemented simulation behavior. The film omits external footage because it
would dilute product evidence and create asset-rights uncertainty.
