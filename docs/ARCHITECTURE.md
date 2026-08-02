# Architecture

## Overview

Tomahawk uses plain HTML, CSS, JavaScript, and Canvas — no bundler and no frontend framework. The browser owns UI and drawing; the simulation core stays DOM-free and is testable directly in Node.js.

```text
Pages and interaction (index / sandbox / guide)
        ↓
UI adapter layer (src/app.js, src/ui/*)
        ↓
Stable public entry (src/sim.js)
        ↓
Deterministic simulation core (src/sim/*)
```

## Page layer

- `index.html` — product landing page (brand and navigation only).
- `sandbox.html` — sandbox DOM shell; `src/app.js` wires Canvas, controls, saves, and the workshop.
- `guide.html` — semantic, no-script-readable shell for the responsive Simplified Chinese task manual.
- `src/guide.js` — optional interaction enhancement for the mini console, chapter state, screenshot annotations, and versioned progress.
- `src/guide.css` — the manual's large-type layout, responsive chapter navigation, demo console, and HTML annotation system.
- `server.mjs` — routes `/`, `/sandbox`, and `/guide`, streams static files; scenario I/O and debug log endpoints are enabled only locally.

## UI layer

- `src/ui/lang.js` — single Simplified Chinese message catalogue and event formatting.
- `src/ui/catalog.js` — display catalogue for 22 built-in platforms plus custom units; reads sim class data only and does not push presentation fields into the core.
- `src/ui/symbols.js` — controlled tactical-symbol subset in a standard-inspired style, using cached `Path2D`.
- `src/ui/tutorial.js` — shared guide lesson data. `TUTORIAL_STEPS` is a stable five-field projection used by the existing in-sandbox spotlight tour.
- `src/ui/view.js` — DOM-free HTML fragments and projection helpers.

The manual's mini console deliberately does not import or run the simulation core. It models only UI state so a reader can rehearse controls without modifying a scenario. Current-UI screenshot assets live in `src/assets/guide/`; `scripts/screenshot-guide.mjs` drives normal sandbox controls with Playwright and regenerates them at a fixed 1600×900, 1× device scale.

## Simulation core

`src/sim.js` is only a stable re-export barrel. Logic is split by responsibility:

- `scenario.js` — scenario create/place/serialize/restore and AAR.
- `step.js` — fixed-order tick scheduler.
- `sensors.js`, `command.js` — detection, tracks, and fused force picture.
- `movement.js`, `aircraft.js` — ship and aircraft lifecycle.
- `combat.js`, `missiles.js` — fire planning, flight, and defence.
- `ships.js` — built-in and custom unit registry.

UI must not bypass the public entry to change core rules. The v1 page, symbol, and tutorial work did not change save format or simulation API.

## Performance strategy

Canvas draws every frame; DOM panels refresh at about 20 Hz. Map objects are viewport-culled first; labels use LOD and clustering; tactical-symbol geometry is prebuilt and reused. Simulation performance is guarded by the machine-independent complexity score from `scripts/perf-harness.mjs`.

## Data and persistence

- Scenarios: compatible with the existing JSON shape.
- Unit Workshop: IndexedDB `tomahawk-mods`; on first launch, legacy DB records are copied and verified before the old DB is removed.
- Tutorial state: `localStorage["tomahawk.tutorialDismissed"]`.
- Interactive manual progress: `localStorage["tomahawk.guideProgress.v1"]`; unavailable storage falls back to in-memory state.
- Debug switch: `localStorage["tomahawk.debug"]` or `?debug=1`.

## Hosting boundary

Railway runs `npm start`. The service listens on the platform-injected `0.0.0.0:$PORT` and accepts deploy health checks on `/health`. The Node heap is limited to 64 MiB; static assets are streamed with no server-side asset cache.

When `RAILWAY_ENVIRONMENT` is set, `/scenario/*` and `/debug/save` stay closed. The browser owns the sim clock, AI, drawing, Unit Workshop, tutorial state, scenario import/export, and AAR generation, so production does not store user state and memory does not grow with scenario size on the server.
