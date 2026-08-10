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
- `guide.html` — the immersive Simplified Chinese player manual: a welcome overlay, a full-screen tutorial stage, and a shortcut/FAQ modal.
- `src/guide.js` — tutorial engine: embeds the real sandbox page in a full-screen same-origin iframe, walks the reader through deploy/run/judge/save steps by observing the sandbox DOM, locks the map camera and destructive keys while teaching, and persists versioned progress.
- `src/guide.css` — the full-screen teaching chrome: spotlight ring, dim scrim with a target cut-out, animated cursor hint, adaptive coach card, and modal overlays.
- `server.mjs` — routes `/`, `/sandbox`, and `/guide`, streams static files; scenario I/O and debug log endpoints are enabled only locally.

## UI layer

- `src/ui/lang.js` — single Simplified Chinese message catalogue and event formatting.
- `src/ui/catalog.js` — display catalogue for 22 built-in platforms plus custom units; reads sim class data only and does not push presentation fields into the core.
- `src/ui/symbols.js` — controlled tactical-symbol subset in a standard-inspired style, using cached `Path2D`.
- `src/ui/tutorial.js` — shared guide lesson data. `TUTORIAL_STEPS` is a stable five-field projection used by the existing in-sandbox spotlight tour.
- `src/ui/view.js` — DOM-free HTML fragments and projection helpers.

The manual embeds the real sandbox page (`/sandbox`) in a same-origin iframe that fills the viewport, so every control the reader touches is the actual product UI at its native size — no screenshots and no recreated widgets. `src/guide.js` drives the flow by observing the sandbox's own DOM (equipment overlay state, placement chip, battle-status counts, play icon, speed readout, layer toggles, save/workshop overlays); step targets are highlighted with a spotlight ring, a dimming scrim cut-out, and an animated cursor hint. While a step is active the guide locks map wheel-zoom, middle-drag pan, and destructive keys (Delete/Backspace/R, Space before the sim starts) via capture-phase listeners inside the iframe, and each step's activation prepares the sandbox to the state its instructions assume. Each step (or phase) allows clicks on its own targets only; the manual never persists progress and always opens at step 1.

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
- Interactive manual: always starts at step 1; no progress is persisted.
- Debug switch: `localStorage["tomahawk.debug"]` or `?debug=1`.

## Hosting boundary

Railway runs `npm start`. The service listens on the platform-injected `0.0.0.0:$PORT` and accepts deploy health checks on `/health`. The Node heap is limited to 64 MiB; static assets are streamed with no server-side asset cache.

When `RAILWAY_ENVIRONMENT` is set, `/scenario/*` and `/debug/save` stay closed. The browser owns the sim clock, AI, drawing, Unit Workshop, tutorial state, scenario import/export, and AAR generation, so production does not store user state and memory does not grow with scenario size on the server.
