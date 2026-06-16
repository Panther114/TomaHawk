# `src/` layout

Source for the TomaHawk / 战斧 sandbox. No build step — these files are served
as-is and run as native ES modules in the browser and in Node.

## Files

- `app.js` — browser entry: canvas rendering, input, panels, sim controls.
- `styles.css` — tactical UI layout and styling.
- `sim.js` — **barrel only**. Re-exports the simulation core from `sim/`.
  Consumers (`app.js`, tests) import from here; do not move logic back into it.

## `sim/` — the simulation core (dependency order, low → high)

| Module | Owns |
| --- | --- |
| `constants.js` | units (`NM`, `KNOT`), side/role/mode enums, `VISUAL_CONFIG` |
| `math.js` | geometry, kinematics, `interceptPoint`, `Rng` |
| `events.js` | event-log append, severity, time formatting |
| `missiles.js` | `MISSILES` catalogue, display helpers, `battleSummaryCounts` |
| `ships.js` | `SHIP_CLASSES`, ship factory, loadout/ROE, hull-id counter |
| `sensors.js` | radar detection, track ageing/pruning, CEC track sharing |
| `command.js` | fused force picture + fleet command posture (OTC/AAWC, modes) |
| `movement.js` | ship motion integration and per-unit movement decisions |
| `combat.js` | launch queues, fire planning, missile flight, damage, CIWS |
| `scenario.js` | create/serialize/restore/export + setup-mode editing |
| `step.js` | `stepSim` — the deterministic top-level tick |

## Conventions

- **Imports flow upward only.** A module imports from lower layers, never the
  reverse. Cross-references between functions in different modules are fine
  because they execute at runtime, after all modules load.
- **Add a new public symbol** → export it from its module, then add the module
  to the `export *` list in `sim.js` if it is a new file.
- **Where things go:** new missile → `missiles.js`; new hull → `ships.js`;
  new sensor/track rule → `sensors.js`; AI posture → `command.js`; weapon
  logic/guidance → `combat.js`; save-format field → `scenario.js`.
- **Keep it deterministic.** Same seed + inputs ⇒ same result. Route all
  randomness through `sim.rng` (the seeded `Rng`), never `Math.random()`.
- **Verify with `npm test`** after any change to `sim/`.
