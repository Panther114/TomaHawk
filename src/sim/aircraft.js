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
  // --- altitude / strike geometry (all provisional) -----------------------
  // Altitude is NOT a third movement axis; it is a per-flight attribute that
  // drives the radar-horizon masking in the sensor model. A flight cruises high
  // (better lookout, energy for air-to-air) and descends for a low-level strike
  // ingress so hostile radars only see it much closer (the "go low" the user
  // expects on a strike run).
  cruiseAltitudeM: 9000,
  ingressAltitudeM: 150,
  // Fire the stand-off anti-ship load from just inside its max reach, then hold —
  // never bore into the ship's air-defence envelope. Fractions of the best
  // carried anti-ship weapon's range.
  standoffFrac: 0.9,
  // Closer than this fraction of the stand-off ring → turn cold and re-open
  // range (the egress the user asked for: "move away after they are done").
  egressFrac: 0.72,
  // Begin the low-level descent once within this multiple of the stand-off ring.
  ingressStartFrac: 1.7,
  // On-station weave period (s): how long the flight holds one beam leg before
  // reversing. Alternating the leg keeps it on the stand-off ring (a racetrack)
  // instead of sliding off the threat axis.
  stationWeaveS: 16,
  // Pursue an enemy flight for air-to-air out to this range (m) when the flight
  // has no strike mission to fly (a dedicated sweep / spent striker).
  a2aEngageRangeM: 60 * NM,
  // A striker only breaks off its run for a hostile flight that closes inside
  // this (self-defence / merge range); a fighter farther out is ignored so the
  // strike is prosecuted rather than every flight collapsing into a furball.
  a2aSelfDefenseRangeM: 22 * NM,
  // Minimum fused-track quality a squadron will vector a strike/intercept on.
  acquireTrackQuality: 0.14,
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
    // Intrinsic hit-probability reduction a generation buys beyond the common
    // airframe evasion (e.g. a low-observable 5-gen flight is harder to engage).
    airEvasionBonus: Number.isFinite(cls.airEvasionBonus) ? cls.airEvasionBonus : 0,
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

// Acquire the nearest enemy surface and air contacts a squadron can be vectored
// onto. A flight is networked into the fleet's Cooperative Engagement (CEC)
// picture — the same fused force picture the ships fire on — so it can prosecute
// targets held by the fleet's long-range radars, not just the handful its own
// short-range set can see. Falls back to the unit's own/shared tracks when no
// force picture has been built yet (e.g. a direct unit-test call).
function acquireAirTargets(sim, ship) {
  const q = AIRCRAFT_TEMP_CONFIG.acquireTrackQuality;
  let surf = null; let surfD = Infinity;
  let air = null; let airD = Infinity;
  const consider = (track) => {
    if (!track || track.side === ship.side) return;
    if (String(track.id).startsWith("M-")) return;
    if ((track.quality ?? 0) <= q) return;
    const d = distance(ship, track);
    if ((track.domain ?? "sea") === "air") {
      if (d < airD) { airD = d; air = track; }
    } else if (d < surfD) { surfD = d; surf = track; }
  };
  const picture = sim.forcePicture?.get(ship.side);
  if (picture) {
    for (const track of picture.values()) consider(track);
  } else {
    for (const track of iterateTracksForShip(sim, ship)) consider(track);
  }
  return { surf, surfRangeM: surfD, air, airRangeM: airD };
}

// Longest reach (m) among the anti-ship weapons currently aboard — the basis for
// the stand-off ring. 0 when the flight carries no strike rounds.
function bestStrikeRangeM(ship) {
  let max = 0;
  const lo = ship.loadout;
  if (lo) for (const id in lo) {
    if (lo[id] > 0 && MISSILES[id]?.category === "anti_ship") max = Math.max(max, MISSILES[id].rangeM);
  }
  return max;
}

function hasAirToAir(ship) {
  const lo = ship.loadout;
  if (lo) for (const id in lo) {
    const cat = MISSILES[id]?.category;
    if (lo[id] > 0 && (cat === "anti_air" || cat === "dual_role")) return true;
  }
  return false;
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

  // Mission: prosecute the fused fleet picture. Firing itself is handled by the
  // shared offensive/defensive planners; this only sets the flight's geometry —
  // where to fly, how fast, and at what altitude.
  const cfg = AIRCRAFT_TEMP_CONFIG;
  const { surf, surfRangeM, air, airRangeM } = acquireAirTargets(sim, ship);
  const aam = hasAirToAir(ship);
  const strikeRangeM = bestStrikeRangeM(ship);
  ship._standoffNm = strikeRangeM > 0 ? (strikeRangeM * cfg.standoffFrac) / NM : null;

  const canStrike = surf && strikeRangeM > 0;

  // 1) Defensive air-to-air. Break for an enemy flight only when it closes inside
  //    self-defence/merge range (or this flight has no strike to fly). A striker
  //    ignores fighters farther out so it presses its run instead of collapsing
  //    into a furball. Stay high for energy and close to a no-escape-zone shot;
  //    the planner releases the missile.
  if (air && aam && (airRangeM <= cfg.a2aSelfDefenseRangeM || !canStrike) && airRangeM <= cfg.a2aEngageRangeM) {
    ship.altitudeM = cfg.cruiseAltitudeM;
    ship.waypoint = { x: air.x, y: air.y };
    ship.desiredSpeed = ship.maxSpeed;
    return;
  }

  // 2) Stand-off strike. Vector onto the surface target, descend for a low-level
  //    ingress (radar-horizon masking), and hold at the stand-off ring — fire
  //    from just inside weapon reach, never inside the ship's air-defence
  //    envelope. Too close → turn cold and re-open range (egress).
  if (surf && strikeRangeM > 0) {
    const standoffM = strikeRangeM * cfg.standoffFrac;
    const r = surfRangeM;
    ship.altitudeM = r <= standoffM * cfg.ingressStartFrac ? cfg.ingressAltitudeM : cfg.cruiseAltitudeM;
    if (r > standoffM * 1.06) {
      ship.waypoint = { x: surf.x, y: surf.y };           // ingress
      ship.desiredSpeed = ship.maxSpeed;
    } else if (r < standoffM * cfg.egressFrac) {
      const away = angleTo(surf, ship);                    // egress: open the range
      ship.waypoint = { x: ship.x + Math.cos(away) * 12 * NM, y: ship.y + Math.sin(away) * 12 * NM };
      ship.desiredSpeed = ship.maxSpeed;
    } else {
      // On station at stand-off: weave a racetrack across the threat bearing to
      // hold range while the strike is released, rather than boring straight in.
      // The beam leg reverses every `stationWeaveS` so the net drift cancels and
      // the flight stays on the stand-off ring instead of sliding off the axis.
      if (sim.time >= (ship._weaveFlipAt ?? 0)) {
        ship._weaveSign = ship._weaveSign === 1 ? -1 : 1;
        ship._weaveFlipAt = sim.time + cfg.stationWeaveS;
      }
      const beam = angleTo(ship, surf) + (ship._weaveSign ?? 1) * Math.PI / 2;
      ship.waypoint = { x: ship.x + Math.cos(beam) * 5 * NM, y: ship.y + Math.sin(beam) * 5 * NM };
      ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
    }
    return;
  }

  // 3) Air-to-air against a distant flight when that is all we can do (pure
  //    air-superiority load, or strike spent but AAMs remain): run it down.
  if (air && aam) {
    ship.altitudeM = cfg.cruiseAltitudeM;
    ship.waypoint = { x: air.x, y: air.y };
    ship.desiredSpeed = ship.maxSpeed;
    return;
  }

  // 4) No engageable contact: fly a combat air patrol that screens the fleet — a
  //    station ahead of the formation guide (OTC) along the force's threat axis,
  //    taken from the shared command picture. Cruise high for lookout.
  ship.altitudeM = cfg.cruiseAltitudeM;
  ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
  const cmd = sim.fleetCommand?.get(ship.side);
  if (cmd?.otc?.alive && cmd.otc.domain !== "air" && Number.isFinite(cmd.axis)) {
    const capM = 40 * NM; // screen this far ahead of the guide toward the threat
    ship.waypoint = { x: cmd.otc.x + Math.cos(cmd.axis) * capM, y: cmd.otc.y + Math.sin(cmd.axis) * capM };
  } else if (!ship.waypoint) {
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
