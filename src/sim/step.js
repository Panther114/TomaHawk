// The deterministic top-level tick. Orchestrates ageing, movement, sensing,
// force-picture fusion, decisions, fire planning, launches, missile flight,
// and point defense, then resolves win/loss state.

import { SCENARIO_MODE } from "./constants.js";
import { addEvent } from "./events.js";
import { canRunScenario } from "./scenario.js";
import { ageTracks, scanSensors, shareTracks, pruneDeadTracks, markContactDead } from "./sensors.js";
import { buildForcePicture } from "./command.js";
import { moveShips, decideShip } from "./movement.js";
import { decideAircraft, updateAircraft } from "./aircraft.js";
import { planEngagements, processLaunchQueues, updateMissiles, pointDefense } from "./combat.js";

const FORCE_PICTURE_INTERVAL_S = 0.5;

function rebuildEntityIndexes(sim) {
  for (const ship of sim.ships) if (!ship.alive) markContactDead(sim, ship.id);
  for (const missile of sim.missiles) if (!missile.alive) markContactDead(sim, missile.id);
  sim._aliveShips = sim.ships.filter((ship) => ship.alive);
  sim._aliveMissiles = sim.missiles.filter((missile) => missile.alive);
  sim._shipById = new Map(sim.ships.map((ship) => [ship.id, ship]));
  sim._missileById = new Map(sim.missiles.map((missile) => [missile.id, missile]));
  sim._missilesByTarget = new Map();
  for (const missile of sim._aliveMissiles) {
    const bucket = sim._missilesByTarget.get(missile.targetId) ?? [];
    bucket.push(missile);
    sim._missilesByTarget.set(missile.targetId, bucket);
  }
  sim._shipsBySide = new Map();
  for (const ship of sim._aliveShips) {
    const bucket = sim._shipsBySide.get(ship.side) ?? [];
    bucket.push(ship);
    sim._shipsBySide.set(ship.side, bucket);
  }
  sim._entityIndexesDirty = false;
}

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
  // Pre-compute indexes for performance (avoid repeated O(n) filters/finds).
  // These are pure lookup structures — they never draw RNG — so they do not
  // affect deterministic output, only the cost of resolving entities by id.
  if (sim._entityIndexesDirty || !sim._aliveShips) rebuildEntityIndexes(sim);
  ageTracks(sim, dt);
  moveShips(sim, dt);
  updateAircraft(sim, dt);
  const sensorChanged = scanSensors(sim, dt);
  const shareDue = Math.floor((sim.time - dt) / 5) !== Math.floor(sim.time / 5);
  const sharedChanged = shareDue ? shareTracks(sim) : false;
  const pictureDue = !sim.forcePicture || sim.time + 1e-9 >= (sim.nextForcePictureAt ?? 0);
  if (sensorChanged || sharedChanged || pictureDue) {
    buildForcePicture(sim, { dirtyOnly: !pictureDue && (sensorChanged || sharedChanged) });
    sim.nextForcePictureAt = sim.time + FORCE_PICTURE_INTERVAL_S;
  }
  for (const ship of sim.ships) {
    if (ship.domain === "air") decideAircraft(sim, ship);
    else decideShip(sim, ship);
  }
  planEngagements(sim);
  processLaunchQueues(sim);
  updateMissiles(sim, dt);
  pointDefense(sim);
  if (sim._tracksNeedPrune) {
    pruneDeadTracks(sim);
    sim._tracksNeedPrune = false;
  }
  const aliveSides = new Set(sim._aliveShips.filter((ship) => ship.alive).map((ship) => ship.side));
  if (aliveSides.size === 1 && !sim.ended) {
    sim.ended = [...aliveSides][0];
    sim.paused = true;
    sim.mode = SCENARIO_MODE.ENDED;
    addEvent(sim, `${sim.ended} side controls the battlespace. Simulation ended.`);
  }
  return sim;
}
