# `src/` layout

Source for the TomaHawk / 战斧 sandbox. No build step — these files are served
as-is and run as native ES modules in the browser and in Node.

## Files

- `app.js` — browser entry: canvas rendering, input, panels, sim controls.
- `world/map-spec.js` — shared map dimensions, projection center, and crop helpers used by terrain and data generation.
- `world/terrain.js` — shared tactical-map geometry and binary water/land
  queries, accelerated by conservative water-mask and ring/edge spatial grids.
- `ui/view.js` — **pure** presentation helpers (coordinate transforms, panel
  HTML builders, per-ship derived state). No DOM/canvas/global access, so it is
  unit-tested directly in `tests/ui.test.mjs`. `app.js` imports from here.
- `mods/` — the **Unit Workshop** modding system (browser): custom naval/ground/
  ammo unit types stored as self-contained JSON in IndexedDB and registered into
  the live `MISSILES`/`SHIP_CLASSES` catalogues at boot. See the table below.
- `styles.css` — tactical UI layout and styling.
- `sim.js` — **barrel only**. Re-exports the simulation core from `sim/`.
  Consumers (`app.js`, `ui/`, tests) import from here; do not move logic into it.

## `sim/` — the simulation core (dependency order, low → high)

| Module | Owns |
| --- | --- |
| `constants.js` | units (`NM`, `KNOT`), side/role/mode enums, `VISUAL_CONFIG` |
| `math.js` | geometry, kinematics, `interceptPoint`, `Rng` |
| `events.js` | event-log append, severity, time formatting |
| `missiles.js` | `MISSILES` catalogue, display helpers, `battleSummaryCounts` |
| `ships.js` | `SHIP_CLASSES` (four naval hulls + three fixed ground emplacements SAM/CDB/EWR via `domain`/`isFixed`), ship factory, loadout/ROE, hull-id counter |
| `sensors.js` | hostile radar detection, lazy track ageing/pruning, centralized CEC sharing, adaptive spatial scan index |
| `command.js` | fused force picture + fleet command posture (OTC/AAWC, modes) |
| `movement.js` | ship motion integration, terrain-aware detours, per-unit movement decisions |
| `combat.js` | launch queues, fire planning, missile flight, damage, CIWS |
| `scenario.js` | create/serialize/restore/export, map state, setup-mode editing |
| `step.js` | `stepSim` — the deterministic top-level tick |

## `mods/` — the Unit Workshop (browser only; never imported by `sim/`)

| Module | Owns |
| --- | --- |
| `schema.js` | curated per-type field definitions, defaults, and pure `validateUnit` (Node-tested) |
| `registry.js` | editor-JSON ↔ internal-spec conversion (both directions, incl. NM↔m) and register/unregister into the live catalogues (pure) |
| `store.js` | IndexedDB persistence; seeds/heals vanilla locked records, loads + registers custom units at boot |
| `editor.js` | the popup controller: list, schema-driven form, save/clone/export/delete, drag-in import, discard-on-switch |

`ships.js` and `missiles.js` expose `register*`/`unregister*`/`isBuiltin*` so the
registry can extend the catalogues without a parallel code path. Built-in ids are
captured at module load and can never be removed.

## Conventions

- **Imports flow upward only.** A module imports from lower layers, never the
  reverse. Cross-references between functions in different modules are fine
  because they execute at runtime, after all modules load.
- **Add a new public symbol** → export it from its module, then add the module
  to the `export *` list in `sim.js` if it is a new file.
- **Where things go:** new missile → `missiles.js`; new hull or ground
  emplacement → `ships.js`; new sensor/track rule → `sensors.js`; AI posture →
  `command.js`; weapon logic/guidance → `combat.js`; save-format field or
  placement/terrain rule → `scenario.js`; map geometry / water-land query →
  `world/terrain.js`; a moddable parameter, editor field, or import/storage rule
  → `mods/` (`schema.js` for fields, `registry.js` for conversion, `store.js` for
  persistence, `editor.js` for the UI).
- **Keep it deterministic.** Same seed + inputs ⇒ same result. Route all
  randomness through `sim.rng` (the seeded `Rng`), never `Math.random()`.
- **Verify with `npm test`** after any change to `sim/` or `ui/`.
- **`npm run bench`** reports ticks/sec by battle size, re-checks determinism,
  and prints the machine-independent complexity score (`scripts/perf-harness.mjs`);
  `tests/performance-regressions.test.mjs` asserts that score so an accidental
  O(n²) hot loop fails CI.
- **`npm run bench:frontend`** measures dense target lookup, label clustering,
  and stable inventory-frame work;
  CI (`.github/workflows/ci.yml`) runs `npm test` on every push/PR.
