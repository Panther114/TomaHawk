// The deterministic top-level tick. Orchestrates ageing, movement, sensing,
// force-picture fusion, decisions, fire planning, launches, missile flight,
// and point defense, then resolves win/loss state.

import { SCENARIO_MODE, SIDE } from "./constants.js";
import { addEvent } from "./events.js";
import { canRunScenario } from "./scenario.js";
import { ageTracks, scanSensors, shareTracks, pruneDeadTracks, markContactDead } from "./sensors.js";
import { buildForcePicture, computeFleetCommand } from "./command.js";
import { moveShips, decideShip } from "./movement.js";
import { canRecoverAtBase, decideAircraft, updateAircraft } from "./aircraft.js";
import { scanSonar } from "./sonar.js";
import { decideSubmarine, updateSubmarineDepth } from "./submarines.js";
import { updateElectronicWarfareState } from "./ew.js";
import { planEngagements, processLaunchQueues, updateMissiles, pointDefense } from "./combat.js";
import { missileHasSurfaceTarget, missileCanTarget, MISSILES } from "./missiles.js";

const FORCE_PICTURE_INTERVAL_S = 0.5;
// Mutual magazine exhaustion: both sides spent dedicated strike + air-surface
// stores and no ASCMs remain in flight. Without this, long peer fights idle for
// thousands of sim-seconds with WINCHESTER hulls circling (verified in
// scripts/verify-battles.mjs small-naval / large-peer runs).
// Pure air-to-air fights are NOT a stalemate — AAM magazines still count.
const STALEMATE_HOLD_S = 90;

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

export function stepSim(sim, dt = 0.25, { allowPaused = false } = {}) {
  if (sim.mode === SCENARIO_MODE.SETUP) return sim;
  if (sim.mode === SCENARIO_MODE.ENDED) return sim;
  if (sim.paused && !allowPaused) return sim;
  if (sim.time === 0 && !canRunScenario(sim)) {
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
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    updateSubmarineDepth(ship, dt);
    updateElectronicWarfareState(sim, ship);
  }
  const radarChanged = scanSensors(sim, dt);
  const sonarChanged = scanSonar(sim, dt);
  const sensorChanged = radarChanged || sonarChanged;
  const shareDue = Math.floor((sim.time - dt) / 5) !== Math.floor(sim.time / 5);
  const sharedChanged = shareDue ? shareTracks(sim) : false;
  const pictureDue = !sim.forcePicture || sim.time + 1e-9 >= (sim.nextForcePictureAt ?? 0);
  if (sensorChanged || sharedChanged || pictureDue) {
    buildForcePicture(sim, { dirtyOnly: !pictureDue && (sensorChanged || sharedChanged) });
    sim.nextForcePictureAt = sim.time + FORCE_PICTURE_INTERVAL_S;
  }
  // Fleet command BEFORE movement decisions so navigation/CAP uses a fresh
  // axis instead of a 1-tick-stale one. planEngagements reuses it same-tick.
  // Gated to fire-plan cadence so RNG draws and cost match the old schedule —
  // just earlier in the tick, not more often.
  if (sim._fleetCommandAt == null || sim.time >= (sim.nextFirePlanAt ?? 0)) {
    computeFleetCommand(sim);
    sim._fleetCommandAt = sim.time;
  }
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (ship.domain === "air") decideAircraft(sim, ship);
    else if (ship.domain === "subsurface") decideSubmarine(sim, ship);
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
  if (aliveSideCount === 0 && !sim.ended) {
    sim.ended = "draw";
    sim.paused = true;
    sim.mode = SCENARIO_MODE.ENDED;
    addEvent(sim, "Mutual annihilation — neither side retains living ships. Draw.");
    return sim;
  }
  if (aliveSideCount === 1 && !sim.ended) {
    const pendingAttack = (sim._aliveMissiles ?? sim.missiles).some(missile =>
      missile.alive && missile.side !== soleSide && !String(missile.targetId).startsWith("M-")
      && (sim._shipById?.get(missile.targetId)?.alive ?? false));
    if (pendingAttack) return sim;
    sim.ended = soleSide;
    sim.paused = true;
    sim.mode = SCENARIO_MODE.ENDED;
    addEvent(sim, `${sim.ended} side controls the battlespace. Simulation ended.`);
    return sim;
  }
  // Stalemate / mutual exhaustion (draw): neither side retains an *offensive*
  // prosecution path. Ship SAMs alone (self-defence) do not keep a fight open —
  // long peer logs left two WINCHESTER DDGs circling for 6000s. Aircraft with
  // any remaining AAM/ASUW and live strike/AAM weapons still count.
  if (!sim.ended && aliveSideCount === 2) {
    // Throttle the O(ships×loadout) scan to 1s cadence; the 90s hold makes
    // 1s quantization lossless. Cache per side.
    if (sim._stalemateCacheAt == null || sim.time - sim._stalemateCacheAt >= 1) {
      sim._stalemateCacheAt = sim.time;
      sim._stalemateCache = {
        [SIDE.BLUE]: stillDangerous(SIDE.BLUE),
        [SIDE.RED]: stillDangerous(SIDE.RED),
      };
    }
    function stillDangerous(side) {
      const friendlies = sim._shipsBySide?.get(side) ?? [];
      const enemy = side === SIDE.BLUE ? SIDE.RED : SIDE.BLUE;
      const hostileDomains = new Set((sim._shipsBySide?.get(enemy) ?? [])
        .filter(unit => unit.alive).map(unit => unit.domain));
      const bases = friendlies.filter(unit => unit.alive && unit.isAirfield);
      const canAttack = (ship, loadout) => Object.entries(loadout ?? {}).some(([id, count]) => {
        const weapon = MISSILES[id];
        if (!(count > 0) || !weapon) return false;
        if (hostileDomains.has("air") && missileCanTarget(weapon, "air")) return true;
        if (hostileDomains.has("subsurface") && missileCanTarget(weapon, "subsurface")) return true;
        return (ship.domain === "air" || missileHasSurfaceTarget(weapon))
          && ((hostileDomains.has("sea") && missileCanTarget(weapon, "sea"))
            || (hostileDomains.has("ground") && missileCanTarget(weapon, "ground")));
      });
      for (const ship of friendlies) {
        if (!ship.alive) continue;
        if (ship.airState !== "rearming" && canAttack(ship, ship.loadout)) return true;
        if (ship.domain !== "air") continue;
        const compatible = bases.filter(base => canRecoverAtBase(ship, base));
        const serviceable = compatible.some(base => (base.sortiesRemaining ?? 0) > 0
          && (ship.airState !== "rearming" || ship.homeBaseId === base.id));
        if (serviceable && (canAttack(ship, ship.baseLoadoutSnapshot)
          || ship.airState !== "mission" || ship.fuelS <= ship.enduranceS * 0.2)) return true;
        // Let airborne flights finish recovery or run out of fuel.
        if (!compatible.length || ship.airState === "rtb") return true;
      }
      for (const m of sim._aliveMissiles || sim.missiles) {
        if (!m.alive || m.side !== side) continue;
        // In-flight strike weapons, or AAMs engaging a unit (not SAM-vs-missile).
        if (m.launchRole === "anti_ship") return true;
        if (m.launchRole === "anti_air" && !String(m.targetId || "").startsWith("M-")) return true;
      }
      return false;
    }
    const blueDangerous = sim._stalemateCache[SIDE.BLUE];
    const redDangerous = sim._stalemateCache[SIDE.RED];
    if (!blueDangerous && !redDangerous) {
      sim._stalemateSince = sim._stalemateSince ?? sim.time;
      if (sim.time - sim._stalemateSince >= STALEMATE_HOLD_S) {
        sim.ended = "draw";
        sim.paused = true;
        sim.mode = SCENARIO_MODE.ENDED;
        addEvent(sim, "Mutual exhaustion — neither side retains offensive munitions. Draw.");
      }
    } else {
      sim._stalemateSince = null;
    }
  }
  return sim;
}
