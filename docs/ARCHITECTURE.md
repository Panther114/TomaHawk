# TomaHawk Architecture

TomaHawk is a local 2D modern battle simulator inspired by the tactical density of the DCS World F10/map view, not the 3D cockpit or external camera view. The current implementation is a dependency-light browser app served locally with Node so the project is playable immediately in this environment.

The implemented stack uses static HTML, CSS, and JavaScript with a deterministic simulation core. This keeps the project local, fast to run, and easy to inspect.

## Runtime Shape

- The simulation core owns deterministic state, doctrine, movement, sensors, tracks, missile flight, defenses, damage, and terrain-aware ship navigation. It is split into focused modules under `src/sim/` (constants, math, events, missiles, ships, sensors, command, movement, combat, aircraft, scenario, step) behind the `src/sim.js` re-export barrel. See `src/README.md` for the module map. `src/sim/aircraft.js` owns the air-domain squadron model: attrition (HP = plane count), the mission/RTB/rearm/fuel state machine, evasive maneuvers, flares, and the (intentionally provisional) `AIRCRAFT_TEMP_CONFIG` tunables.
- `src/app.js` owns canvas rendering, map interactions, UI panels, loadout editing, and sim controls.
- `src/world/terrain.js` is the shared low-level terrain module. It owns the tactical-map geometry, projection, and binary water/land queries that both the UI and the simulation consume.
- Scenario setup, save/load, copyable logs, and after-action export are handled through helpers in `src/sim/scenario.js` and `src/sim/events.js`.
- `server.mjs` serves only `index.html` and `src/` assets, exposes `/health`, and binds to Railway's injected host/port in deployment. Local runs retain the on-disk scenario/debug convenience endpoints; hosted Railway runs intentionally disable them, using browser-file save/import instead.
- `tests/` verifies deterministic and rules-level behavior with Node's built-in test runner — `sim.test.mjs` (core rules), `ui.test.mjs` (presentation helpers), `ground-units.test.mjs` (land emplacements), `performance-regressions.test.mjs` (complexity guard), plus map/font/i18n cases.
- `docs/DATA_MODEL.md` records the current object shapes and unit conventions.

## Core Boundaries

The simulation is intentionally separated into truth, perception, decision, and presentation concerns.

- Truth: actual ship and missile positions, health, impact resolution. Fixed land emplacements (`domain: "ground"`, `isFixed: true` — the SAM, CDB, and EWR types) are modeled as stationary ship-entities, so they sense, share, fire, take damage, and are targeted through this same pipeline without a parallel code path; they simply never move and must be placed on land.
- Perception: radar scans create hostile track files with quality, age, and uncertainty. Friendly and self state is known directly and is not duplicated into radar/CEC track maps.
- Decision: ship movement is per-unit (with formation station-keeping for non-guide units and retreat behavior for strike-empty units), while air defence is run as a force — a dynamically designated command hierarchy (OTC / AAWC), AAW sector responsibility, and a force-level fire planner allocate interceptors and salvos using a fused Cooperative Engagement (CEC) track picture, inbound threats, active and queued missiles, magazine state, and rules of engagement. Defensive orders are prioritized in the launch scheduler and use their own reaction/cadence gates so strike salvos cannot block urgent self-defence. Inbound defense uses the freshest local or shared missile track available to the force rather than waiting on a slower composite refresh.
- Presentation: the UI displays selected-unit tracks and uncertainty instead of giving every unit omniscient targeting data.

Scenarios move through three modes:

- `setup`: units can be added, dragged, selected by right-click or box select, and deleted with keyboard commands. Placement is domain-aware (sea units on water, ground emplacements on land), dragging holds the last valid position for the unit's domain, and map changes are only allowed here.
- `running`: the deterministic simulation advances.
- `ended`: one side has no surviving unit and the battle is frozen.

## Visual Layers

The canvas renderer draws the tactical map in this order:

- full-viewport 20 km ocean grid,
- selected presentation terrain (Open Sea or projected Natural Earth 1:50m global coastlines),
- all-ship weapon engagement-zone rings from actual nonzero loadout,
- radar rings when enabled,
- selected-unit perceived tracks and uncertainty,
- world-scaled ship symbols,
- missile symbols, labels, and engagement lines,
- setup selection box and DOM panels.

Ships and missiles use tactical scaling: their symbols shrink and grow with zoom, with a very small minimum size so they remain visible without dominating the map. Hit testing is intentionally larger than the rendered symbol so wide-zoom selection remains practical. Labels stay screen-sized, reduced, and fade at wide zoom unless they are critical.

The WEZ layer defaults to all-unit rings and can be changed to selected-only or disabled. Rings are super thin but kept visible for every ship regardless of side color. Overlapping rings of the **same weapon type and faction** are merged into a single union outline (each ring is stroked clipped to the region outside its same-type neighbours, so the internal crossing arcs disappear); rings of a different weapon or faction never merge, and style/colour/dash are unchanged. Large TLAM/MSTK rings are still rendered from world scale; selected labels are clamped to the viewport edge so they remain inspectable when the actual ring edge falls outside the screen.

The lower-left footer shows a one-line side summary for ship counts, hitpoints, and in-air missile roles. Ship addition is a setup-only action; the BLUE/RED placement controls are disabled once the scenario is running.

### UI hierarchy and typography

- The UI uses the system Segoe UI stack for operational text and the bundled Rationale face for the compact TomaHawk wordmark. It has no runtime web-font dependency.
- The interface deliberately retains small, dense type. Hierarchy comes from surface contrast, weight, grouping, dividers, and selective amber/side-color emphasis rather than globally increasing font sizes.
- The top command deck separates brand, scenario tools, map layers, and inventory. The bottom deck separates simulation transport, tactical readout, and save/export actions.
- The tactical feed is a distinct lower-left console with its copy action and retract toggle attached to the feed header.

Shared map dimensions live in `src/world/map-spec.js`; terrain definitions and binary water/land queries live in `src/world/terrain.js`; generated global coastline geometry lives in `src/ui/data/`, and `src/ui/maps.js` re-exports the presentation-facing map helpers. WGS84 Natural Earth land and coastline data is projected with a global equirectangular projection and rendered across the viewport without stretching or an artificial outer border. `docs/MAP_DATA.md` records provenance and regeneration. The simulation consumes the same binary water/land queries for setup validation, map resets, path checks, coastal detours, and final swept-segment collision guards. Terrain queries use a conservative 0.5 NM water mask plus ring/edge spatial grids as broad phases, then authoritative polygon and continuous segment intersection checks near land; rendering culls land/coast paths to the current viewport before drawing.

## DCS Map Reference

The UI follows the DCS map-view idea at a pragmatic level:

- Full-screen tactical map first.
- Dense grid and coordinate readout.
- Side-colored symbols instead of decorative ship art.
- Category-coded missile symbols: squares for anti-ship, triangles for anti-air.
- Thin low-alpha weapon range rings for every visible ship by default.
- Compact fleet inventory and bottom control strip.
- Dense event log for tactical interpretation.
- Copyable event log for after-action review outside the UI.
- Pan/zoom canvas map with minimal chrome.

This is not a clone of DCS UI assets or icons.

---

## Current Architecture Notes

### Key functions (and their home module)
- `SHIP_CLASSES` / `makeShip(side, x, y, hull)` (`src/sim/ships.js`) — per-class parameter catalogue and the generic hull-parameterised ship factory
- `usedCells()` / `vlsCapacity()` (`src/sim/ships.js`) — per-class VLS cell accounting
- `scanSensors(sim, dt)` (`src/sim/sensors.js`) — radar detection with per-missile-profile detection envelopes so high-altitude air-defense missiles and low-altitude cruise missiles are not equally visible; also holds the 4/3 Earth-radius `radarHorizonM()`/`radarHeightM()` horizon model
- `buildForcePicture(sim)` (`src/sim/command.js`) — fuses each side's tracks into one CEC composite picture
- `computeFleetCommand(sim)` (`src/sim/command.js`) — side-wide command posture from the force picture; derives smoothed aggressiveness, persistent strike mode, target breadth, and raid depth from own surface-magazine depth (all strike munitions) versus observed enemy strength. Threat axis uses unit tracks only (missiles excluded). Peer fights open near half-aggression; empty/thin pictures are pulled toward neutral advantage rather than panic survive
- `planOffensiveFires(sim)` (`src/sim/combat.js`) — force-level anti-surface planning that concentrates on the most valuable observed targets first, then allocates in two passes (strike specialists such as DEB/CDB/air, then general naval shooters). Strategic/hypersonic weapons may use a small overflow quota after the general raid cap. Domain-specialist target slots keep ground-only and sea-only magazines usable. Prefers dedicated anti-ship rounds over dual-role SM-6, caps raid size by target toughness outside `saturate` (anti-overcommit), and guarantees surface targets when air contacts would otherwise monopolise the plan
- `decideAircraft(sim, ship)` (`src/sim/aircraft.js`) — per-squadron geometry state machine: vectors on the fused CEC picture with **weapon-domain-filtered** surface locks (JSOW→ground, Harpoon→sea), runs a low-altitude stand-off strike (ingress → nose-on release hold → optional beam weave → egress), breaks to air-to-air only inside self-defence range, sweeps when it has no strike to fly, and falls back to fleet-screening CAP with waypoint deadband. Altitude (`altitudeM`) toggles high-cruise vs low-ingress to drive radar-horizon masking only
- `applySubsystemDamage(sim, ship)` (`src/sim/combat.js`) — random subsystem degradation on hit
- `PerfRecorder` / `BattleLogger` (`src/sim/debug.js`) — read-only per-run collectors (performance trace + tactical narrative) written by `scripts/sim-debug.mjs` / `scripts/validate-ai-fixes.mjs` (headless) and optionally by the browser app (`POST /debug/save` when `?debug=1` or `localStorage tomahawk.debug=1`); they draw no RNG and mutate no sim state, so determinism is unaffected

### Performance
- The browser animation loop budgets sim catch-up work per frame (~12 ms) and carries leftover sim time as debt, so a heavy raid cannot force many full ticks into one frame and hitch the UI. Simulation determinism is unchanged; only wall-clock pacing is affected.
- `stepSim` retains `_missileById`, `_shipById`, `_missilesByTarget`, `_shipsBySide`, `_aliveShips`, and `_aliveMissiles` across ticks. Launches and deaths update those structures **incrementally** when possible; a dirty flag still forces a full rebuild as a safety net. Side-alive counts support an O(1) win check.
- Fire planning builds one-cycle nested-map engagement/queue indexes and precomputes interceptor solutions and best missile tracks (probed from live hostile missiles, not a full track-map scan). Defensive planning ranks shooters with the same sector/target/nearest key as before, walks at most a short local list, and rejects missiles that are not aimed at a living friendly ship.
- Ship track maps contain local sensor reports only. CEC stores one delayed, degraded shared report per side/contact in `sharedTracksBySide`; consumers compose local and shared views without copying the same report into every receiver.
- Track position, quality, and uncertainty are projected lazily by `currentTrack()`. An expiry heap and reverse contact-holder index replace full-map ageing and death-pruning scans.
- The force picture refreshes fully every 0.5 seconds and incrementally updates dirty contacts directly through the reverse contact-holder index after sensor/CEC changes. Sensor scans **always** use a spatial broad-phase grid once the contact count exceeds a small threshold (detection math is unchanged; only candidate enumeration is pruned).
- The renderer caches stable panel/detail markup and weapon-range metadata, uses indexed missile-target lookup, spatial label clustering, and viewport culling. The canvas battlefield redraws every animation frame, but the **DOM side-panels refresh at ~20 Hz**. Dense-raid canvas savings: drop per-missile glow above ~50 live missiles, suppress most guide-lines unless zoomed/selected/low count, thin non-terminal icons above ~120 missiles, draw strategic-zoom missiles as dots, cull off-screen weapon rings, and gate WEZ rings to selected units when many hulls are present. These do not change simulation tick order. The `PerfRecorder` render-vs-sim split (`debug/perf-debug.log`) is how their effect is measured.
- `npm run bench` measures simulation throughput; `npm run bench:frontend` measures the isolated high-density rendering helpers.
- A machine-independent **complexity score** (`scripts/perf-harness.mjs`) measures the ratio of per-tick cost at two force sizes (~1.0 linear, ~5.0 quadratic). `tests/performance-regressions.test.mjs` asserts it under a ceiling so an accidental O(n²) hot loop fails CI; `npm run bench` prints the same score.

### UI: Ship Detail Overlay
- `shipDetailOverlay` — dynamically created fixed-position DOM element
- `renderShipDetails()` — renders compact subsystem cards for ships in `selectedIds`
- Right-click+drag on ship adds to `selectedIds` (additive selection)
- Right-click blank clears `selectedIds`
- The ship detail overlay is pinned to the right edge with a small inset and clamped to the viewport so it does not drift into the map. It renders compact cards at reduced scale and wraps into additional leftward columns based on the available vertical space.
- Inventory shows whole-number HP, hull type, and VLS occupancy; only sunk ships gray their names
- The top-right fleet inventory is intentionally tightened with smaller type and narrower columns to keep the panel compact while preserving the same information density.
- VLS occupancy bars are color-coded by fill ratio in the detail overlay: green at 80%+, yellow at 40-80%, red below 40%
- Alive ships show a subtle white center cross; sunk ships do not show waypoint/movement markers

### Ship Subsystem State
- `subsystems: { radar, vls, propulsion, fireControl, ciws, cic }` — each 1.0 nominal
- Degraded by `applySubsystemDamage()` on hit; affects combat functions
