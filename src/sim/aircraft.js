// Air units: squadron entities (domain "air") and airfields.
//
// A squadron is ONE simulation entity that represents several aircraft. It costs
// one ship's worth of latency (one radar, one track-file, one decision, one fire
// plan) but renders and attrits as a flight: its hit-point pool equals its plane
// count, so each hit downs exactly one aircraft and combat power scales with the
// survivors. This keeps the perf budget flat as aircraft (which vastly outnumber
// ships) are added.
//
// IMPORTANT — these constants and the RTB/rearm/fuel behaviour are intentionally
// TEMPORARY and centralised here so they can be retuned or replaced later
// (carrier basing, per-airframe fuel models, etc.) without touching the rest of
// the sim. Treat everything in AIRCRAFT_TEMP_CONFIG as a placeholder.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE, SCENARIO_MODE } from "./constants.js";
import { distance, angleTo } from "./math.js";
import { MISSILES } from "./missiles.js";
import { addEvent } from "./events.js";
import { markContactDead, iterateTracksForShip } from "./sensors.js";

// Squadron / endurance / rearm tunables. All provisional.
export const AIRCRAFT_TEMP_CONFIG = Object.freeze({
  // Default flight size when a class does not specify one.
  defaultSquadronSize: 4,
  // Endurance (sim-seconds of flight) before fuel is exhausted. A class may
  // override via `enduranceS`.
  enduranceS: 1800,
  // Return-to-base when remaining fuel drops below this fraction of endurance.
  rtbFuelThresholdFrac: 0.2,
  // Seconds parked at an airfield to rearm + refuel before relaunch.
  rearmTimeS: 90,
  // Distance at which a returning flight is considered "recovered" at its base.
  baseReachM: 2 * NM,
  // Squadron airframe defaults (used when a class omits them).
  cruiseSpeedKt: 420,
  maxSpeedKt: 540,
  // --- survivability / countermeasures (all provisional) ------------------
  // Default IR-countermeasure (flare) pool when a class omits `flares`.
  flares: 60,
  // A missile this close (m) or already terminal triggers a hard evasive break.
  evadeRangeM: 12 * NM,
  // How long (s) a break maneuver is held after the last triggering threat.
  evadeDurationS: 6,
  // Chance an IR-guided missile is decoyed when a flaring, evading flight pops
  // flares in its terminal phase (one flare consumed per attempt).
  flareDecoyChance: 0.6,
  // Hit-probability the airframe shaves off any missile by virtue of being a
  // small, fast, hard target (before maneuver/flares).
  evasionBase: 0.22,
  // Additional hit-probability shaved while actively breaking (notching).
  evasionManeuver: 0.18
});

// Air-unit lifecycle states. Squadrons fly their mission until Winchester (out
// of weapons) or low fuel, then RTB; if no airfield is reachable they press on
// until fuel is gone and splash.
export const AIR_STATE = Object.freeze({ MISSION: "mission", RTB: "rtb", REARMING: "rearming" });

export function isAircraft(ship) {
  return ship?.domain === "air";
}

export function isAirfield(ship) {
  return ship?.isAirfield === true;
}

export function squadronSize(ship) {
  // The HP pool IS the plane count: max planes = ceil(damageResist).
  return Math.max(1, Math.ceil(ship?.damageResist ?? AIRCRAFT_TEMP_CONFIG.defaultSquadronSize));
}

export function aliveAircraftCount(ship) {
  return Math.max(0, squadronSize(ship) - Math.round(ship?.damage ?? 0));
}

// Per-entity air state seeded by makeShip for air-domain units. Kept here so the
// (temporary) shape lives next to the behaviour that consumes it.
export function initialAircraftState(cls) {
  const enduranceS = Number.isFinite(cls.enduranceS) ? cls.enduranceS : AIRCRAFT_TEMP_CONFIG.enduranceS;
  const flares = Number.isFinite(cls.flares) ? cls.flares : AIRCRAFT_TEMP_CONFIG.flares;
  return {
    airState: AIR_STATE.MISSION,
    enduranceS,
    fuelS: enduranceS,
    rearmTimeS: Number.isFinite(cls.rearmTimeS) ? cls.rearmTimeS : AIRCRAFT_TEMP_CONFIG.rearmTimeS,
    rearmUntil: 0,
    homeBaseId: null,
    // Survivability state.
    flaresMax: flares,
    flares,
    evading: false,
    evadeUntil: 0
  };
}

export const AIR_CRUISE_MPS = AIRCRAFT_TEMP_CONFIG.cruiseSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER;
export const AIR_MAX_MPS = AIRCRAFT_TEMP_CONFIG.maxSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER;

// ---------------------------------------------------------------------------
// TEMPORARY mission/RTB/rearm behaviour.
//
// A squadron flies its mission (pursue + attack the nearest enemy) until it is
// Winchester (out of weapons) or low on fuel, then returns to the nearest
// friendly airfield to rearm/refuel and relaunch. If no airfield is reachable
// it presses toward friendly territory and splashes when fuel runs out.
//
// This whole block is provisional scaffolding — carrier basing, per-airframe
// fuel, CAP/strike tasking, etc. can replace it later. Keep the decisions here
// deterministic (no RNG) so the simulation stays reproducible.
// ---------------------------------------------------------------------------

function totalWeapons(ship) {
  let n = 0;
  const lo = ship.loadout;
  if (lo) for (const id in lo) { const c = lo[id]; if (c > 0) n += c; }
  return n;
}

function friendlyHomeAnchor(sim, ship) {
  // Fallback "go home" point when no airfield exists: deep on the friendly edge.
  const x = ship.side === SIDE.BLUE ? -sim.widthM / 2 + 4 * NM : sim.widthM / 2 - 4 * NM;
  return { x, y: ship.y };
}

function nearestFriendlyAirfield(sim, ship) {
  let best = null;
  let bestD = Infinity;
  for (const other of sim.ships) {
    if (!other.alive || other.side !== ship.side || !isAirfield(other)) continue;
    const d = distance(ship, other);
    if (d < bestD) { bestD = d; best = other; }
  }
  return best;
}

function nearestEnemyTrack(sim, ship) {
  let best = null;
  let bestD = Infinity;
  for (const track of iterateTracksForShip(sim, ship)) {
    if (track.side === ship.side || track.quality <= 0.18) continue;
    if (String(track.id).startsWith("M-")) continue; // ignore in-flight missiles for nav
    const d = distance(ship, track);
    if (d < bestD) { bestD = d; best = track; }
  }
  return best;
}

// Nearest live enemy missile actually homing on this flight (the evasion cue).
const NO_INCOMING = [];
function nearestIncomingMissile(sim, ship) {
  // Indexed: an absent bucket means nothing inbound (skip the full-scan fallback,
  // which exists only for index-less direct callers).
  const list = sim._missilesByTarget ? (sim._missilesByTarget.get(ship.id) ?? NO_INCOMING) : sim.missiles;
  let best = null;
  let bestD = Infinity;
  for (const m of list) {
    if (!m.alive || m.side === ship.side || m.targetId !== ship.id) continue;
    const d = distance(ship, m);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// Strike (anti-ship) rounds currently aboard, and whether the flight launched
// with any — used to send strikers home once their stand-off load is expended.
function strikeAmmo(ship) {
  let n = 0;
  const lo = ship.loadout;
  if (lo) for (const id in lo) { const c = lo[id]; if (c > 0 && MISSILES[id]?.category === "anti_ship") n += c; }
  return n;
}
function carriedStrike(ship) {
  const snap = ship.baseLoadoutSnapshot;
  if (snap) for (const id in snap) { if (snap[id] > 0 && MISSILES[id]?.category === "anti_ship") return true; }
  return false;
}

function refillFromBase(ship) {
  ship.loadout = { ...(ship.baseLoadoutSnapshot || {}) };
  ship.fuelS = ship.enduranceS;
  ship.flares = ship.flaresMax ?? ship.flares ?? 0;
  ship.airState = AIR_STATE.MISSION;
  ship.evading = false;
  ship.evadeUntil = 0;
  ship.lastLaunchAtByMissile = {};
}

// Per-decision-tick state machine for one squadron. Sets waypoint/desiredSpeed.
export function decideAircraft(sim, ship) {
  if (!ship.alive || sim.time < (ship.nextDecision ?? 0)) return;
  ship.nextDecision = sim.time + 1;
  if (sim.mode !== SCENARIO_MODE.RUNNING) return;

  // Parked + rearming: hold until the rearm timer elapses, then relaunch — but
  // only while the home airfield is still alive. If it is destroyed mid-rearm
  // the flight cannot rearm on a crater, so it diverts (RTB to seek another
  // field, or splash). Falls through to the RTB logic below.
  if (ship.airState === AIR_STATE.REARMING) {
    const base = sim.ships.find((s) => s.id === ship.homeBaseId && s.alive && isAirfield(s));
    if (base) {
      ship.desiredSpeed = 0;
      ship.waypoint = null;
      if (sim.time >= (ship.rearmUntil ?? 0)) refillFromBase(ship);
      return;
    }
    ship.airState = AIR_STATE.RTB;
  }

  // While actively breaking to defeat a missile, hold the evasion course set by
  // updateAircraft — do not override it with mission/RTB navigation.
  if (ship.evading && sim.time < (ship.evadeUntil ?? 0)) return;

  const lowFuel = ship.fuelS <= ship.enduranceS * AIRCRAFT_TEMP_CONFIG.rtbFuelThresholdFrac;
  const winchester = totalWeapons(ship) <= 0;
  // A striker returns once its stand-off (anti-ship) load is spent, even if it
  // still has air-to-air missiles for self-escort.
  const strikeDepleted = carriedStrike(ship) && strikeAmmo(ship) <= 0;
  if ((lowFuel || winchester || strikeDepleted) && ship.airState !== AIR_STATE.RTB) {
    ship.airState = AIR_STATE.RTB;
  }

  if (ship.airState === AIR_STATE.RTB) {
    const base = nearestFriendlyAirfield(sim, ship);
    if (base) {
      ship.homeBaseId = base.id;
      if (distance(ship, base) <= AIRCRAFT_TEMP_CONFIG.baseReachM) {
        ship.airState = AIR_STATE.REARMING;
        ship.rearmUntil = sim.time + (ship.rearmTimeS ?? AIRCRAFT_TEMP_CONFIG.rearmTimeS);
        ship.desiredSpeed = 0;
        ship.waypoint = null;
        return;
      }
      ship.waypoint = { x: base.x, y: base.y };
      ship.desiredSpeed = ship.maxSpeed;
      return;
    }
    // No airfield: limp toward friendly territory; fuel exhaustion → splash.
    ship.waypoint = friendlyHomeAnchor(sim, ship);
    ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
    return;
  }

  // Mission: run down the nearest enemy so fire planning can engage it. Firing
  // itself is handled by the shared offensive/defensive planners.
  const enemy = nearestEnemyTrack(sim, ship);
  if (enemy) {
    ship.waypoint = { x: enemy.x, y: enemy.y };
    ship.desiredSpeed = ship.maxSpeed;
    return;
  }
  // No contacts: advance toward the enemy side at cruise to find work.
  ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
  if (!ship.waypoint) {
    const dir = ship.side === SIDE.BLUE ? 1 : -1;
    ship.waypoint = { x: ship.x + dir * 30 * NM, y: ship.y };
  }
}

// Per-tick upkeep for all squadrons: evasive maneuvering against inbound
// missiles, fuel burn, and splashing any flight that runs dry. Deterministic
// (no RNG here — the flare/PK rolls happen in the missile hit resolution) and
// gated entirely on air units.
export function updateAircraft(sim, dt) {
  for (const ship of sim.ships) {
    if (!ship.alive || ship.domain !== "air") continue;
    if (ship.airState === AIR_STATE.REARMING) { ship.evading = false; continue; } // parked

    // Evasive break: when a missile is closing inside the reaction envelope (or
    // already terminal) the flight notches — steering perpendicular to the
    // threat line of sight at max speed. This both reads as a hard maneuver and
    // feeds the survivability model (a breaking target is far harder to hit).
    const threat = nearestIncomingMissile(sim, ship);
    if (threat && (threat.terminal || distance(ship, threat) <= AIRCRAFT_TEMP_CONFIG.evadeRangeM)) {
      if (!ship.evading) addEvent(sim, `${ship.name} breaks hard against an inbound missile.`, ship.side);
      ship.evading = true;
      ship.evadeUntil = sim.time + AIRCRAFT_TEMP_CONFIG.evadeDurationS;
      const beam = angleTo(threat, ship) + Math.PI / 2;
      ship.waypoint = { x: ship.x + Math.cos(beam) * 15 * NM, y: ship.y + Math.sin(beam) * 15 * NM };
      ship.desiredSpeed = ship.maxSpeed;
    } else if (ship.evading && sim.time >= (ship.evadeUntil ?? 0)) {
      ship.evading = false;
    }

    ship.fuelS = (ship.fuelS ?? 0) - dt;
    if (ship.fuelS <= 0) {
      ship.fuelS = 0;
      ship.alive = false;
      ship.speed = 0;
      markContactDead(sim, ship.id);
      sim._entityIndexesDirty = true;
      addEvent(sim, `${ship.name} ran out of fuel and splashed.`, ship.side);
    }
  }
}
