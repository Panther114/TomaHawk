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

import { NM, KNOT, SHIP_SPEED_MULTIPLIER } from "./constants.js";

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
  maxSpeedKt: 540
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
  return {
    airState: AIR_STATE.MISSION,
    enduranceS,
    fuelS: enduranceS,
    rearmTimeS: Number.isFinite(cls.rearmTimeS) ? cls.rearmTimeS : AIRCRAFT_TEMP_CONFIG.rearmTimeS,
    rearmUntil: 0,
    homeBaseId: null
  };
}

export const AIR_CRUISE_MPS = AIRCRAFT_TEMP_CONFIG.cruiseSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER;
export const AIR_MAX_MPS = AIRCRAFT_TEMP_CONFIG.maxSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER;
