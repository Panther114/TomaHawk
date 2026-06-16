// The deterministic top-level tick. Orchestrates ageing, movement, sensing,
// force-picture fusion, decisions, fire planning, launches, missile flight,
// and point defense, then resolves win/loss state.

import { SCENARIO_MODE } from "./constants.js";
import { addEvent } from "./events.js";
import { canRunScenario } from "./scenario.js";
import { ageTracks, scanSensors, shareTracks, pruneDeadTracks } from "./sensors.js";
import { buildForcePicture } from "./command.js";
import { moveShips, decideShip } from "./movement.js";
import { planEngagements, processLaunchQueues, updateMissiles, pointDefense } from "./combat.js";

export function stepSim(sim, dt = 0.25) {
  if (sim.mode === SCENARIO_MODE.SETUP) return sim;
  if (sim.mode === SCENARIO_MODE.ENDED) return sim;
  if (!canRunScenario(sim)) {
    sim.paused = true;
    sim.mode = SCENARIO_MODE.SETUP;
    addEvent(sim, "Cannot run: both Blue and Red require at least one alive ship.");
    return sim;
  }
  sim.time += dt;
  // Pre-compute indexes for performance (avoid repeated O(n) filters)
  sim._aliveShips = sim.ships.filter((s) => s.alive);
  sim._aliveMissiles = sim.missiles.filter((m) => m.alive);
  // Group missiles by target for fast lookup
  const mbt = new Map();
  for (const m of sim._aliveMissiles) {
    if (!mbt.has(m.targetId)) mbt.set(m.targetId, []);
    mbt.get(m.targetId).push(m);
  }
  sim._missilesByTarget = mbt;
  // Group ships by side
  const sbs = new Map();
  for (const s of sim._aliveShips) {
    if (!sbs.has(s.side)) sbs.set(s.side, []);
    sbs.get(s.side).push(s);
  }
  sim._shipsBySide = sbs;
  // Group missiles by side
  const mbs = new Map();
  for (const m of sim._aliveMissiles) {
    if (!mbs.has(m.side)) mbs.set(m.side, []);
    mbs.get(m.side).push(m);
  }
  sim._missilesBySide = mbs;

  ageTracks(sim, dt);
  moveShips(sim, dt);
  scanSensors(sim, dt);
  if (Math.floor((sim.time - dt) / 5) !== Math.floor(sim.time / 5)) shareTracks(sim);
  buildForcePicture(sim);
  for (const ship of sim.ships) decideShip(sim, ship);
  planEngagements(sim);
  processLaunchQueues(sim);
  updateMissiles(sim, dt);
  pointDefense(sim);
  pruneDeadTracks(sim);
  const aliveSides = new Set(sim.ships.filter((s) => s.alive).map((s) => s.side));
  if (aliveSides.size === 1 && !sim.ended) {
    sim.ended = [...aliveSides][0];
    sim.paused = true;
    sim.mode = SCENARIO_MODE.ENDED;
    addEvent(sim, `${sim.ended} side controls the battlespace. Simulation ended.`);
  }
  return sim;
}
