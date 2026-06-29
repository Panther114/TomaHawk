// Public entry point for the simulation core.
//
// The implementation lives in focused modules under `src/sim/`. This barrel
// re-exports their full surface so existing imports (`./sim.js`) keep working
// unchanged. Module map:
//
//   sim/constants.js  — units, side/role/mode enums, visual config
//   sim/math.js       — geometry, kinematics, intercept solver, RNG
//   sim/events.js     — event-log append/severity/formatting
//   sim/missiles.js   — missile catalogue + display helpers + battle summary
//   sim/ships.js      — ship classes, factory, loadout/ROE, hull-id counter
//   sim/sensors.js    — radar detection, track ageing/pruning, CEC sharing
//   sim/command.js    — fused force picture + fleet command posture
//   sim/movement.js   — ship motion integration and movement decisions
//   sim/combat.js     — launch queues, fire planning, missile flight, defenses
//   sim/scenario.js   — create/serialize/restore/export + setup editing
//   sim/step.js       — the deterministic top-level tick (stepSim)

export * from "./sim/constants.js";
export * from "./sim/math.js";
export * from "./sim/events.js";
export * from "./sim/missiles.js";
export * from "./sim/aircraft.js";
export * from "./sim/ships.js";
export * from "./sim/sensors.js";
export * from "./sim/command.js";
export * from "./sim/movement.js";
export * from "./sim/combat.js";
export * from "./sim/scenario.js";
export * from "./sim/step.js";
