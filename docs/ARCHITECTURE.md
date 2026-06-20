# TomaHawk Architecture

TomaHawk is a local 2D modern naval sandbox inspired by the tactical density of the DCS World F10/map view, not the 3D cockpit or external camera view. The current implementation is a dependency-light browser app served locally with Node so the project is playable immediately in this environment.

The implemented stack uses static HTML, CSS, and JavaScript with a deterministic simulation core. This keeps the project local, fast to run, and easy to inspect.

## Runtime Shape

- The simulation core owns deterministic state, doctrine, movement, sensors, tracks, missile flight, defenses, and damage. It is split into focused modules under `src/sim/` (constants, math, events, missiles, ships, sensors, command, movement, combat, scenario, step) behind the `src/sim.js` re-export barrel. See `src/README.md` for the module map.
- `src/app.js` owns canvas rendering, map interactions, UI panels, loadout editing, and sim controls.
- Scenario setup, save/load, copyable logs, and after-action export are handled through helpers in `src/sim/scenario.js` and `src/sim/events.js`.
- `server.mjs` serves the app locally at `http://127.0.0.1:4173`, binds to Railway's injected host/port in deployment, and exposes `/health` for platform checks.
- `tests/sim.test.mjs` verifies deterministic and rules-level behavior with Node's built-in test runner.
- `docs/DATA_MODEL.md` records the current object shapes and unit conventions.

## Core Boundaries

The simulation is intentionally separated into truth, perception, decision, and presentation concerns.

- Truth: actual ship and missile positions, health, impact resolution.
- Perception: radar scans create track files with quality, age, and uncertainty.
- Decision: ship movement is per-unit (with formation station-keeping for non-guide units and retreat behavior for strike-empty units), while air defence is run as a force — a dynamically designated command hierarchy (OTC / AAWC), AAW sector responsibility, and a force-level fire planner allocate interceptors and salvos using a fused Cooperative Engagement (CEC) track picture, inbound threats, active and queued missiles, magazine state, and rules of engagement. Defensive orders are prioritized in the launch scheduler and use their own reaction/cadence gates so strike salvos cannot block urgent self-defence. Inbound defense uses the freshest local or shared missile track available to the force rather than waiting on a slower composite refresh.
- Presentation: the UI displays selected-unit tracks and uncertainty instead of giving every unit omniscient targeting data.

Scenarios move through three modes:

- `setup`: ships can be added, dragged, selected by right-click or box select, and deleted with keyboard commands.
- `running`: the deterministic simulation advances.
- `ended`: one side has no surviving ship and the battle is frozen.

## Visual Layers

The canvas renderer draws the tactical map in this order:

- full-viewport 20 km ocean grid,
- selected presentation terrain (Open Sea or projected Natural Earth 1:10m East China Sea coastlines),
- all-ship weapon engagement-zone rings from actual nonzero loadout,
- radar rings when enabled,
- selected-unit perceived tracks and uncertainty,
- world-scaled ship symbols,
- missile symbols, labels, and engagement lines,
- setup selection box and DOM panels.

Ships and missiles use tactical scaling: their symbols shrink and grow with zoom, with a very small minimum size so they remain visible without dominating the map. Hit testing is intentionally larger than the rendered symbol so wide-zoom selection remains practical. Labels stay screen-sized, reduced, and fade at wide zoom unless they are critical.

The WEZ layer defaults to all-unit rings and can be changed to selected-only or disabled. Rings are super thin but kept visible for every ship regardless of side color. Large TLAM/MSTK rings are still rendered from world scale; selected labels are clamped to the viewport edge so they remain inspectable when the actual ring edge falls outside the screen.

The lower-left footer shows a one-line side summary for ship counts, hitpoints, and in-air missile roles. Ship addition is a setup-only action; the BLUE/RED placement controls are disabled once the scenario is running.

### UI hierarchy and typography

- The UI uses the system Segoe UI stack for operational text and the bundled Rationale face for the compact TomaHawk wordmark. It has no runtime web-font dependency.
- The interface deliberately retains small, dense type. Hierarchy comes from surface contrast, weight, grouping, dividers, and selective amber/side-color emphasis rather than globally increasing font sizes.
- The top command deck separates brand, scenario tools, map layers, and inventory. The bottom deck separates simulation transport, tactical readout, and save/export actions.
- The tactical feed is a distinct lower-left console with its copy action and retract toggle attached to the feed header.

Terrain definitions live in `src/ui/maps.js`; generated East China Sea geometry lives in `src/ui/data/`. WGS84 Natural Earth land and coastline data is projected with a regional azimuthal-equidistant projection and rendered across the full viewport at meter-accurate scale without stretching or an artificial outer border. `docs/MAP_DATA.md` records provenance and regeneration. The module also exposes `isLandPoint()` as the future integration boundary for placement, path planning, and collision checks. The deterministic simulation movement code does not consume terrain yet, so land avoidance is deliberately not claimed as current behavior.

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
- `computeFleetCommand(sim)` (`src/sim/command.js`) — side-wide command posture from the force picture; derives smoothed aggressiveness, persistent strike mode, target breadth, and raid depth from observed enemy strength and missile pressure
- `planOffensiveFires(sim)` (`src/sim/combat.js`) — force-level anti-ship planning that concentrates on the most valuable observed targets first, then saturates them according to posture, offensive commit windows, strike mode, per-cycle strike allocation limits, and coordinated release windows across multiple shooters
- `applySubsystemDamage(sim, ship)` (`src/sim/combat.js`) — random subsystem degradation on hit

### Performance
- Pre-computed indexes in `stepSim`: `_missilesByTarget`, `_shipsBySide`, `_aliveShips`, `_aliveMissiles`, `_missilesBySide`
- Hot-path functions use cached lookups instead of repeated O(n) filters

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
