# AGENTS.md

## Purpose

Use this file to route yourself to the smallest relevant part of the repository first. Do **not** read the whole repo by default.

## Fast repo map

- `src/sim.js` — **barrel only**: re-exports `src/sim/*`. Never put logic here; it is the stable public import surface for `src/app.js` and tests.
- `src/sim/` — the simulation core, split into focused modules (see below). `src/README.md` is the authoritative map.
- `src/app.js` — canvas rendering, UI state, map interaction, controls, panels, save/load wiring.
- `src/styles.css` — layout and visual styling for the tactical UI.
- `index.html` — static UI shell and DOM ids used by `src/app.js`.
- `tests/sim.test.mjs` — behavior/regression tests; often the fastest way to learn intended rules.
- `server.mjs` — tiny static file server for local runs.
- `README.md` — concise product overview; `docs/REFERENCE.md` holds the full bilingual manual.
- `docs/ARCHITECTURE.md` — module boundaries and rendering/sim split.
- `docs/DATA_MODEL.md` — object shapes and field meanings.
- `docs/SIMULATION_ASSUMPTIONS.md` — modeling assumptions and doctrine rules.
- `docs/ROADMAP.md` — future ideas; not always current behavior.

### `src/sim/` modules (route to the smallest one)

- `constants.js` — units, side/role/mode enums, `VISUAL_CONFIG`.
- `math.js` — geometry, kinematics, `interceptPoint`, `Rng`.
- `events.js` — event-log append/severity, `formatTime`/`formatLogLines`.
- `missiles.js` — `MISSILES` catalogue, `missileSymbol`/`missileDisplayRole`, `battleSummaryCounts`.
- `ships.js` — `SHIP_CLASSES`, ship factory, loadout/ROE helpers, hull-id counter.
- `sensors.js` — radar detection, `missileDetectionEnvelope`, track ageing/pruning/sharing.
- `command.js` — fused force picture (`buildForcePicture`/`forceTrack`) + fleet command posture.
- `movement.js` — `moveShips`, `decideShip`.
- `combat.js` — launch queues, `planEngagements`, `chooseDefensiveWeapon`, `updateMissiles`, `pointDefense`.
- `scenario.js` — `createScenario`, serialize/restore, export, place/duplicate/delete/clear.
- `step.js` — `stepSim` (the deterministic tick orchestrator).

## Start here by task

### 1. Combat, sensors, tracks, doctrine, missile behavior
Open the specific `src/sim/` module, plus:
- `tests/sim.test.mjs`
- `docs/DATA_MODEL.md`
- `docs/SIMULATION_ASSUMPTIONS.md`

Module by concern:
- scenario lifecycle / setup editing: `src/sim/scenario.js` (`createScenario`, `placeShip`, `duplicateShip`, `deleteShip`, `clearSide`, `canRunScenario`, serialize/restore/export)
- the tick order: `src/sim/step.js` (`stepSim`)
- loadouts: `src/sim/ships.js` (`defaultLoadout`, `validateLoadout`, `setLoadout`, `usedCells`, `vlsCapacity`)
- sensors/tracks: `src/sim/sensors.js` (`missileDetectionEnvelope`, scan/age/prune/share)
- force picture / CEC + command posture: `src/sim/command.js`
- defense/offense fire planning + missile flight: `src/sim/combat.js` (`chooseDefensiveWeapon`, `planEngagements`, `updateMissiles`, `pointDefense`)
- missile/ship catalogues: `src/sim/missiles.js`, `src/sim/ships.js`

### 2. Rendering, map interaction, selection, panels, controls
Go to:
- `src/app.js`
- `index.html`
- `src/styles.css`

Use `src/app.js` section jumps instead of reading top-to-bottom:
- drawing: `drawGrid`, `drawRadarRings`, `drawWeaponRangeRings`, `drawTracks`, `drawMissiles`, `render`
- overlays/panels: `renderFocusStrip`, `renderShipDetails`, `renderPanels`
- interaction: `pickShip`, pointer handlers, keyboard handlers
- sim control: `startScenario`, play/step/save/load/AAR handlers

### 3. CSS/layout or UI shell issues
Go to:
- `src/styles.css` for spacing, panel layout, typography, colors
- `index.html` for panel structure and element ids
- `src/app.js` only if the issue involves dynamically generated markup or DOM state

### 4. Save/load, exports, logs
Go to:
- `src/sim/scenario.js` for serialization/export helpers; `src/sim/events.js` for log formatting
- `src/app.js` for button wiring and file/clipboard behavior
- `tests/sim.test.mjs` for persistence regressions

### 5. Local server or startup behavior
Go to:
- `package.json`
- `server.mjs`
- `index.html`

### 6. Understanding intended behavior quickly
Start with:
- the matching test in `tests/sim.test.mjs`
- then the smallest relevant `src/sim/*` module (or `src/app.js`)

The simulation core is split into small `src/sim/*` modules behind the `src/sim.js` barrel; the UI is one large file (`src/app.js`). Tests are usually the quickest path to the rule being enforced.

## What not to read first

- Do **not** read `src/sim.js` for logic — it is just a re-export barrel. Open the relevant `src/sim/*` module instead.
- Do **not** start with full-file reads of `src/app.js` or `tests/sim.test.mjs` unless the task truly spans the whole subsystem.
- Do **not** start with `docs/ROADMAP.md` for current behavior; it includes future work.
- Do **not** read all docs for a small bug. Only open the doc that matches the question:
  - architecture/module split → `docs/ARCHITECTURE.md`
  - object fields/data shape → `docs/DATA_MODEL.md`
  - doctrine/model assumptions → `docs/SIMULATION_ASSUMPTIONS.md`

## Efficient working style for this repo

- Prefer `rg` on exact symbols or gameplay terms before opening large files.
- Treat the `src/sim/*` modules as the source of truth for gameplay rules (`src/sim.js` only re-exports them).
- Treat `src/app.js` as the source of truth for what is rendered and how the user interacts.
- Use `tests/sim.test.mjs` to confirm whether behavior is intentional, especially for determinism, defense logic, loadouts, serialization, and UI defaults.
- Keep changes deterministic; this is a core repository expectation.
- If you change behavior in a `src/sim/*` module, check whether a nearby test already exists before adding anything new.
- For UI edits, keep English and Chinese text in sync, and verify the result in both Edge and Chrome at 100% browser scale before wrapping up.

## Runtime and validation

- Start locally: `npm start`
- Run automated checks: `npm test`

There is no frontend build pipeline and no separate lint script in the current repo.

## Performance verification (required after backend-sim changes)

After **any** change that touches the simulation core (`src/sim/*`, the tick path,
sensors, combat, command, movement, or entity counts/structures), you **must**
verify and report the performance impact before wrapping up. Do not assume a
change is free.

- **Measure:** run `npm test` (the `tests/performance-regressions.test.mjs`
  "tick cost scales near-linearly with force size" case prints and asserts a
  **complexity score**), or `npm run bench` for the full human-readable report
  (throughput, determinism, and the same score).
- **What the score means:** it is a machine-independent ratio of per-tick cost at
  two force sizes (`scripts/perf-harness.mjs`). **1.0 = linear**, **5.0 = quadratic**;
  the test fails above **2.5**. A jump toward the quadratic value means an O(n)
  loop over ships/missiles became O(n²) — find and fix it before continuing.
- **Report:** in your final summary, explicitly state the complexity score (and,
  for larger changes, the before/after) and confirm determinism still holds
  (`npm run bench` prints `determinism … OK`). State the number even when it is
  unchanged — "no perf regression" must be backed by the measured score, not an
  assumption.
- If a regression is intended/unavoidable, say so explicitly and justify it
  rather than silently letting the score rise.

## High-signal file routing by problem type

| Problem | Read first | Then read if needed |
| --- | --- | --- |
| Ship placement/setup mode | `src/sim/scenario.js`, `src/app.js` | `tests/sim.test.mjs` |
| Missile launch/flight/intercept | `src/sim/combat.js`, `src/sim/math.js` (`interceptPoint`) | `tests/sim.test.mjs`, `docs/SIMULATION_ASSUMPTIONS.md` |
| Radar/tracks/CEC | `src/sim/sensors.js`, `src/sim/command.js` | `docs/DATA_MODEL.md`, tests |
| Command posture / AI aggression | `src/sim/command.js` | `tests/sim.test.mjs`, `docs/SIMULATION_ASSUMPTIONS.md` |
| Missile or ship catalogue/stats | `src/sim/missiles.js`, `src/sim/ships.js` | `docs/DATA_MODEL.md` |
| Save/load/AAR/log export | `src/sim/scenario.js`, `src/sim/events.js` | `src/app.js`, tests |
| The tick order of operations | `src/sim/step.js` | the called modules |
| Tactical map drawing | `src/app.js` draw functions | `src/styles.css`, `index.html` |
| Panel layout or visual polish | `src/styles.css` | `index.html`, `src/app.js` |
| Keyboard/mouse controls | `src/app.js` event listeners | `index.html` |
| Test failures about rules | matching case in `tests/sim.test.mjs` | relevant `src/sim/*` module |
| Startup/server issue | `package.json`, `server.mjs` | `index.html` |

