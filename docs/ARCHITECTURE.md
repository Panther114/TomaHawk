# TomaHawk Architecture

TomaHawk is a local 2D modern naval sandbox inspired by the tactical density of the DCS World F10/map view, not the 3D cockpit or external camera view. The current implementation is a dependency-light browser app served locally with Node so the project is playable immediately in this environment.

The implemented stack uses static HTML, CSS, and JavaScript with a deterministic simulation core. This keeps the project local, fast to run, and easy to inspect.

## Runtime Shape

- `src/sim.js` owns deterministic simulation state, doctrine, movement, sensors, tracks, missile flight, defenses, and damage.
- `src/app.js` owns canvas rendering, map interactions, UI panels, loadout editing, and sim controls.
- Scenario setup, save/load, copyable logs, and after-action export are handled through helpers in `src/sim.js`.
- `server.mjs` serves the app at `http://127.0.0.1:4173`.
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

- ocean grid and scenario bounds,
- all-ship weapon engagement-zone rings from actual nonzero loadout,
- radar rings when enabled,
- selected-unit perceived tracks and uncertainty,
- world-scaled ship symbols,
- missile symbols, labels, and engagement lines,
- setup selection box and DOM panels.

Ships and missiles use tactical scaling: their symbols shrink and grow with zoom, with a very small minimum size so they remain visible without dominating the map. Hit testing is intentionally larger than the rendered symbol so wide-zoom selection remains practical. Labels stay screen-sized, reduced, and fade at wide zoom unless they are critical.

The WEZ layer defaults to all-unit rings and can be changed to selected-only or disabled. Rings are super thin but kept visible for every ship regardless of side color. Large TLAM/MSTK rings are still rendered from world scale; selected labels are clamped to the viewport edge so they remain inspectable when the actual ring edge falls outside the screen.

The lower-left footer shows a one-line side summary for ship counts, hitpoints, and in-air missile roles. Ship addition is a setup-only action; the BLUE/RED placement controls are disabled once the scenario is running.

## DCS Map Reference

The UI follows the DCS map-view idea at a pragmatic level:

- Full-screen tactical map first.
- Dense grid and coordinate readout.
- Side-colored symbols instead of decorative ship art.
- Category-coded missile symbols: squares for anti-ship, triangles for anti-air.
- Thin low-alpha weapon range rings for every visible ship by default.
- Combat focus strip for active missiles, selected-unit threat count, terminal missiles, and amber color meaning.
- Compact fleet inventory and bottom control strip.
- Dense event log for tactical interpretation.
- Copyable event log for after-action review outside the UI.
- Pan/zoom canvas map with minimal chrome.

This is not a clone of DCS UI assets or icons.

---

## Current Architecture Notes

### New Modules
- `SHIP_CLASSES` — exported catalogue of per-class parameters (kinematics, sensors, magazine, CIWS, damage resilience)
- `makeShip(side, x, y, hull)` — generic ship factory parameterised by hull type
- `scanSensors(sim, dt)` — ship radar detection, including per-missile-profile detection envelopes so high-altitude air-defense missiles and low-altitude cruise missiles are not treated as equally visible
- `applySubsystemDamage(sim, ship)` — random subsystem degradation on hit
- `radarHorizonM()` / `radarHeightM()` — 4/3 Earth-radius horizon model
- `usedCells()` / `vlsCapacity()` — per-class VLS cell accounting
- `computeFleetCommand(sim)` — side-wide command posture from the force picture; derives smoothed aggressiveness, persistent strike mode, target breadth, and raid depth from observed enemy strength and missile pressure
- `planOffensiveFires(sim)` — force-level anti-ship planning that concentrates on the most valuable observed targets first, then saturates them according to posture, offensive commit windows, strike mode, per-cycle strike allocation limits, and coordinated release windows across multiple shooters

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
