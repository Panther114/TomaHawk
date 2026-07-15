// The deterministic top-level tick. Orchestrates ageing, movement, sensing,
// force-picture fusion, decisions, fire planning, launches, missile flight,
// and point defense, then resolves win/loss state.

import { SCENARIO_MODE, SIDE } from "./constants.js";
import { addEvent } from "./events.js";
import { canRunScenario } from "./scenario.js";
import { ageTracks, scanSensors, shareTracks, pruneDeadTracks, markContactDead } from "./sensors.js";
import { buildForcePicture } from "./command.js";
import { moveShips, decideShip } from "./movement.js";
import { decideAircraft, updateAircraft } from "./aircraft.js";
import { planEngagements, processLaunchQueues, updateMissiles, pointDefense } from "./combat.js";

const FORCE_PICTURE_INTERVAL_S = 0.5;

// Full rebuild of pure lookup structures. Never draws RNG — only the cost of
// resolving entities by id. Combat maintains these incrementally on launch/
// death so saturated ticks avoid reallocating every Map each step; dirty still
// forces a safe full rebuild.
export function rebuildEntityIndexes(sim) {
  for (const ship of sim.ships) if (!ship.alive) markContactDead(sim, ship.id);
  for (const missile of sim.missiles) if (!missile.alive) markContactDead(sim, missile.id);
  const aliveShips = [];
  const shipById = new Map();
  const shipsBySide = new Map();
  let blueAlive = 0;
  let redAlive = 0;
  for (const ship of sim.ships) {
    shipById.set(ship.id, ship);
    if (!ship.alive) continue;
    aliveShips.push(ship);
    let bucket = shipsBySide.get(ship.side);
    if (!bucket) {
      bucket = [];
      shipsBySide.set(ship.side, bucket);
    }
    bucket.push(ship);
    if (ship.side === SIDE.BLUE) blueAlive++;
    else if (ship.side === SIDE.RED) redAlive++;
  }
  const aliveMissiles = [];
  const missileById = new Map();
  const missilesByTarget = new Map();
  for (const missile of sim.missiles) {
    missileById.set(missile.id, missile);
    if (!missile.alive) continue;
    aliveMissiles.push(missile);
    let bucket = missilesByTarget.get(missile.targetId);
    if (!bucket) {
      bucket = [];
      missilesByTarget.set(missile.targetId, bucket);
    }
    bucket.push(missile);
  }
  sim._aliveShips = aliveShips;
  sim._aliveMissiles = aliveMissiles;
  sim._shipById = shipById;
  sim._missileById = missileById;
  sim._missilesByTarget = missilesByTarget;
  sim._shipsBySide = shipsBySide;
  sim._aliveSideCount = { [SIDE.BLUE]: blueAlive, [SIDE.RED]: redAlive };
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
  // Per-tick airfield / deck-parking caches for aircraft RTB (filled lazily).
  sim._airfieldsBySide = null;
  sim._parkedByBase = null;
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
    if (!ship.alive) continue;
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
  // Win check: prefer O(1) side counts maintained on death; fall back to scan.
  let aliveSideCount = 0;
  let soleSide = null;
  if (sim._aliveSideCount && !sim._entityIndexesDirty) {
    for (const side of [SIDE.BLUE, SIDE.RED]) {
      if ((sim._aliveSideCount[side] || 0) > 0) {
        aliveSideCount++;
        soleSide = side;
      }
    }
  } else {
    const seen = new Set();
    for (const ship of sim._aliveShips || sim.ships) {
      if (!ship.alive) continue;
      seen.add(ship.side);
    }
    aliveSideCount = seen.size;
    if (aliveSideCount === 1) soleSide = [...seen][0];
  }
  if (aliveSideCount === 1 && !sim.ended) {
    sim.ended = soleSide;
    sim.paused = true;
    sim.mode = SCENARIO_MODE.ENDED;
    addEvent(sim, `${sim.ended} side controls the battlespace. Simulation ended.`);
  }
  return sim;
}
