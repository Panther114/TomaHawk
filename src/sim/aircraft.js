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
import { MISSILES, missileCanTarget, missileHasSurfaceTarget } from "./missiles.js";
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
  lowObservableReleaseAltitudeM: 500,
  lowObservableStandInFrac: 0.65,
  // Ingress/on-station/egress sub-phase boundaries, given as HYSTERESIS PAIRS
  // (enter/exit) rather than a single line. A single threshold flip-flops: the
  // 5NM on-station weave plus normal target drift walks the range back and
  // forth across one boundary every few seconds, so the flight visibly jinks
  // (nose toward the target, then beam-on, then toward it again) instead of
  // flying a clean run. Each pair opens a dead zone the range must cross
  // fully before the sub-phase changes again — see the sub-phase state
  // machine in decideAircraft.
  //   ingressEnterFrac: from on-station, turn back inbound once this far out.
  //   ingressExitFrac:  once ingressing, keep closing until this far in
  //                     (< ingressEnterFrac) before leveling out on-station.
  ingressEnterFrac: 1.06,
  ingressExitFrac: 0.98,
  //   egressEnterFrac: from on-station, turn cold once this close in.
  //   egressExitFrac:  once egressing, keep opening range until this far out
  //                    (> egressEnterFrac) before resuming the on-station orbit.
  egressEnterFrac: 0.72,
  egressExitFrac: 0.80,
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
  // Once a striker has broken for a close threat, don't release it back to the
  // strike run until the range has opened out past this multiple of
  // a2aSelfDefenseRangeM — hysteresis so a fighter loitering near the merge
  // line doesn't flip the striker between "break" and "resume run" every tick.
  a2aSelfDefenseExitFrac: 1.3,
  // An air-to-air missile needs its own radar/IR seeker (or the launching
  // aircraft's radar for mid-course guidance) looking roughly at the target
  // to get a valid shot — unlike a ship's vertical-launch SAM, which fires in
  // any direction and turns onto the intercept course after launch, a fighter
  // cannot employ a forward-firing weapon at something well behind its own
  // nose. Permissive on purpose (this allows a beam or even a high-aspect
  // shot, reflecting real off-boresight seeker/HMD capability) — it only
  // blocks the clearly-unrealistic rear-hemisphere case. Enforced in
  // combat.js (launchMissile) and applies to aircraft launchers only; ship
  // and ground VLS launches are unaffected. See docs/SIMULATION_ASSUMPTIONS.md.
  a2aLaunchConeDeg: 100,
  // Minimum fused-track quality a squadron will vector a strike/intercept on
  // when picking a FRESH target. Once locked, a flight keeps the SAME target
  // as long as it appears anywhere in the fused picture at all (see
  // resolveLockedTrack) — it does not re-apply this floor to a target it is
  // already committed to.
  acquireTrackQuality: 0.14,
  // How long (s) to keep steering at a locked target's last known position
  // after it drops out of the fused picture entirely, before conceding the
  // lock and picking a fresh target. At long range a single radar sweep can
  // legitimately miss a contact for a cycle or two even though nothing about
  // the target changed; without a coast window that momentary gap reads as
  // "target lost" and the flight instantly retargets onto whatever else is
  // nearest — repeatedly, every time the original contact blips back out —
  // producing a visibly wobbling, indecisive flight path (confirmed in the
  // debug log: "CAP screen (no track held)" wedged between ingress legs
  // toward three different contacts within seconds, well before any of them
  // was actually destroyed). A real fire-control system coasts a track
  // through exactly this kind of brief dropout instead of dropping it.
  trackCoastS: 8,
  // With no contact to engage, an armed flight screens this far AHEAD of the
  // formation guide (OTC) on the threat axis (a combat air patrol).
  capStationM: 40 * NM,
  // ...while an UNARMED flight (no weapons at all — a support/sensor asset
  // like the AWAC AEW&C squadron) instead orbits this far BEHIND the guide,
  // on the side away from the threat: it has no business up front and
  // survives by standing off, not by fighting.
  supportOrbitM: 30 * NM,
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
  evasionBase: 0.16,
  // Additional hit-probability shaved while actively breaking (notching).
  evasionManeuver: 0.18,
  // Real BVR/WVR missile-defense doctrine (RWR spike / visual launch cue) is a
  // COMBINATION maneuver, not just a lateral break: beam/notch perpendicular
  // to the threat's line of sight to null the Doppler closure rate a
  // semi-active/active seeker keys on (the lateral turn already modeled), PLUS
  // a hard descent — "go low" — which trades altitude for the airspeed/energy
  // needed to keep out-turning a missile that has the least energy margin
  // late in its flight, denies a look-down seeker a clean picture, and (via
  // the denser low-altitude air) costs the missile more to keep following.
  // This was previously entirely missing: the evasion branch changed heading
  // but never touched targetAltitudeM, so a "defensive break" never actually
  // dived. See docs/SIMULATION_ASSUMPTIONS.md.
  evadeDiveAltitudeM: 250,
  // --- afterburner (all generations carry reheat) -------------------------
  // A real fighter's MIL-power top speed (maxSpeedKt) is not its absolute
  // ceiling — pushing into afterburner unlocks meaningfully more speed and
  // much stronger acceleration at a steep fuel-flow cost, which is why it is
  // reserved for genuinely demanding moments (a defensive break, closing an
  // intercept) rather than run continuously. Applies uniformly to every
  // airframe in the roster, 5th- or 4.5-gen alike — reheat is a property of
  // the engine, not the airframe generation.
  afterburnerSpeedMult: 1.18,
  afterburnerAccelMult: 1.7,
  afterburnerFuelBurnMult: 4.0
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

/** True for a sea-domain moving airfield (carrier). Fixed ground AFBs are false. */
export function isCarrier(ship) {
  if (!ship) return false;
  if (ship.isCarrier === true) return true;
  return ship.isAirfield === true && (ship.domain ?? "sea") === "sea" && ship.isFixed !== true;
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
    evadeUntil: 0,
    // Reheat state, decided fresh each decision tick in decideAircraft and
    // consumed by moveAirUnit (speed/accel boost) and updateAircraft (fuel
    // burn multiplier). See AIRCRAFT_TEMP_CONFIG's afterburner* constants.
    afterburner: false
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
// Carrier basing is implemented as a *moving airfield*: any unit with
// isAirfield:true is a rearm node. Land AFBs accept every squadron; sea
// carriers only recover carrierCapable airframes. Parked flights stick to the
// deck each movement tick. Keep decisions deterministic (no RNG).
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

/** Land AFB accepts all; sea carriers only accept carrierCapable airframes. */
export function canRecoverAtBase(aircraft, base) {
  if (!aircraft || !base?.alive || !isAirfield(base)) return false;
  if (base.side !== aircraft.side) return false;
  if (isCarrier(base) || ((base.domain ?? "sea") === "sea" && !base.isFixed)) {
    return aircraft.carrierCapable === true;
  }
  return true;
}

function airfieldsForSide(sim, side) {
  let cache = sim._airfieldsBySide;
  if (!cache) {
    cache = new Map();
    sim._airfieldsBySide = cache;
    for (const other of sim._aliveShips || sim.ships) {
      if (!other.alive || !isAirfield(other)) continue;
      let list = cache.get(other.side);
      if (!list) { list = []; cache.set(other.side, list); }
      list.push(other);
    }
  }
  return cache.get(side) || [];
}

/** Per-tick count of squadrons already rearming on each base (O(air) once). */
function parkedCountAt(sim, baseId) {
  let map = sim._parkedByBase;
  if (!map) {
    map = new Map();
    sim._parkedByBase = map;
    for (const s of sim._aliveShips || sim.ships) {
      if (!s.alive || s.domain !== "air") continue;
      if (s.airState !== AIR_STATE.REARMING || !s.homeBaseId) continue;
      map.set(s.homeBaseId, (map.get(s.homeBaseId) || 0) + 1);
    }
  }
  return map.get(baseId) || 0;
}

function baseHasDeckSlot(sim, aircraft, base) {
  const cap = base.maxParkedSquadrons;
  if (!(cap > 0)) return true; // 0 / unset = unlimited
  const parked = parkedCountAt(sim, base.id);
  // Already assigned to this deck (re-check during rearming) always fits.
  if (aircraft.homeBaseId === base.id && aircraft.airState === AIR_STATE.REARMING) return true;
  return parked < cap;
}

/**
 * Nearest friendly base this squadron may recover on. Carriers are skipped for
 * land-only airframes; full decks are still eligible as approach targets so
 * flights hold nearby until a slot frees (see RTB branch).
 */
function nearestFriendlyAirfield(sim, ship, { requireSlot = false } = {}) {
  let best = null;
  let bestD = Infinity;
  let bestCarrier = null;
  let bestCarrierD = Infinity;
  for (const other of airfieldsForSide(sim, ship.side)) {
    if (!other.alive || !canRecoverAtBase(ship, other)) continue;
    if (requireSlot && !baseHasDeckSlot(sim, ship, other)) continue;
    const d = distance(ship, other);
    if (d < bestD) { bestD = d; best = other; }
    // Carrier-capable airframes prefer their natural deck when it is not far
    // worse than the nearest land field (long battle logs: F-35C RTB'd to a
    // distant AFB while a healthy CVN was in the same task group).
    if (ship.carrierCapable && isCarrier(other) && d < bestCarrierD) {
      bestCarrierD = d;
      bestCarrier = other;
    }
  }
  if (bestCarrier && best) {
    if (bestCarrier.id === best.id) return bestCarrier;
    if (bestCarrierD <= bestD * 1.45) return bestCarrier;
  }
  return bestCarrier && !best ? bestCarrier : best;
}

/** True if the fused picture holds any non-missile track this loadout can arm. */
function hasEmployableSurfaceTrack(sim, ship) {
  const picture = sim.forcePicture?.get(ship.side);
  const tracks = picture ? picture.values() : iterateTracksForShip(sim, ship);
  for (const track of tracks) {
    if (!track || track.side === ship.side) continue;
    if (String(track.id).startsWith("M-")) continue;
    if ((track.domain ?? "sea") === "air") continue;
    if ((track.quality ?? 0) <= AIRCRAFT_TEMP_CONFIG.acquireTrackQuality) continue;
    if (loadoutCanEngageDomain(ship, track.domain ?? "sea")) return true;
  }
  return false;
}

/** Lead intercept point for a moving deck; fixed AFBs return current position. */
function approachPointForBase(ship, base) {
  if (!base) return null;
  if (base.isFixed || (base.speed || 0) < 0.5) return { x: base.x, y: base.y };
  const approachSpeed = Math.max(ship.maxSpeed || AIR_MAX_MPS, 1);
  const eta = distance(ship, base) / approachSpeed;
  return {
    x: base.x + Math.cos(base.heading || 0) * (base.speed || 0) * eta,
    y: base.y + Math.sin(base.heading || 0) * (base.speed || 0) * eta
  };
}

/** Pin a rearming squadron to its base deck (O(1)). Returns false if base lost. */
export function stickToBaseDeck(sim, ship) {
  if (!ship?.homeBaseId) return false;
  const base = sim._shipById?.get(ship.homeBaseId)
    ?? sim.ships.find((s) => s.id === ship.homeBaseId);
  if (!base?.alive || !isAirfield(base) || !canRecoverAtBase(ship, base)) return false;
  ship.x = base.x;
  ship.y = base.y;
  ship.heading = base.heading ?? ship.heading;
  ship.speed = base.speed || 0;
  ship.desiredSpeed = 0;
  ship.waypoint = null;
  ship.altitudeM = 0;
  ship.targetAltitudeM = 0;
  ship.afterburner = false;
  ship.evading = false;
  return true;
}

function holdingPatternPoint(base, ship) {
  // Orbit ~4 NM abeam the base (starboard relative to base heading) so full-deck
  // traffic does not stack on the recovery point itself.
  const h = base.heading || 0;
  const abeam = h + Math.PI / 2;
  const r = 4 * NM;
  return {
    x: base.x + Math.cos(abeam) * r,
    y: base.y + Math.sin(abeam) * r
  };
}

// True when the squadron currently carries at least one round that can engage
// the given domain (sea / ground / air). Used so anti-ground flights do not
// lock a destroyer they can never shoot, and anti-ship flights do not lock a
// SAM battery with Harpoons only.
function loadoutCanEngageDomain(ship, domain) {
  const lo = ship.loadout;
  if (!lo) return false;
  for (const id of Object.keys(lo)) {
    if (!(lo[id] > 0)) continue;
    if (missileCanTarget(MISSILES[id], domain)) return true;
  }
  return false;
}

// Acquire the nearest enemy surface and air contacts a squadron can be vectored
// onto. A flight is networked into the fleet's Cooperative Engagement (CEC)
// picture — the same fused force picture the ships fire on — so it can prosecute
// targets held by the fleet's long-range radars, not just the handful its own
// short-range set can see. Falls back to the unit's own/shared tracks when no
// force picture has been built yet (e.g. a direct unit-test call).
// Target-lock hysteresis + coast: once a flight commits to a surface or air
// target it keeps vectoring on that SAME track — appearing anywhere at all in
// the fused picture, not re-applying the acquisition quality floor — instead
// of re-sorting to "nearest track" every decision tick (1s). Without this,
// two similarly-ranged contacts (e.g. a SAM battery and a coastal battery
// 15NM apart) cause the flight to ping-pong its heading between them.
// If the locked track disappears from the picture ENTIRELY for a tick (a
// single missed radar sweep at long range, not a real loss), the flight
// coasts on the last known position for up to `trackCoastS` before conceding
// the lock — see the config comment. Only once neither a live update nor the
// coast window is available does it fall through to a fresh "nearest" pick,
// which is the "target genuinely lost" case a mission should retask on.
// Surface locks are further filtered by weapon domain: a JSOW-only flight will
// not commit geometry to a ship it cannot arm against.
function resolveLockedTrack(sim, ship, all, wantAir, keyPrefix) {
  const cfg = AIRCRAFT_TEMP_CONFIG;
  const idKey = `_${keyPrefix}TargetId`;
  const seenKey = `_${keyPrefix}LastSeenAt`;
  const xKey = `_${keyPrefix}AimX`;
  const yKey = `_${keyPrefix}AimY`;
  const currentId = ship[idKey];
  if (currentId) {
    const current = all.find((t) => t && t.id === currentId);
    if (current) {
      // Drop a held surface lock if the magazine can no longer engage that domain
      // (e.g. spent last JSOW while still holding AAMs — retask rather than orbit).
      if (!wantAir && !loadoutCanEngageDomain(ship, current.domain ?? "sea")) {
        ship[idKey] = null;
      } else {
        ship[seenKey] = sim.time;
        return current;
      }
    } else if (Number.isFinite(ship[seenKey]) && Number.isFinite(ship[xKey]) && sim.time - ship[seenKey] < cfg.trackCoastS) {
      return { id: currentId, x: ship[xKey], y: ship[yKey], domain: ship[`_${keyPrefix}AimDomain`] };
    }
  }
  let best = null; let bestD = Infinity;
  for (const track of all) {
    if (!track || track.side === ship.side) continue;
    if (String(track.id).startsWith("M-")) continue;
    if ((track.quality ?? 0) <= cfg.acquireTrackQuality) continue;
    if (((track.domain ?? "sea") === "air") !== wantAir) continue;
    if (!wantAir && !loadoutCanEngageDomain(ship, track.domain ?? "sea")) continue;
    const d = distance(ship, track);
    if (d < bestD) { bestD = d; best = track; }
  }
  ship[idKey] = best?.id ?? null;
  if (best) {
    ship[seenKey] = sim.time;
    ship[`_${keyPrefix}AimDomain`] = best.domain ?? "sea";
  }
  return best;
}

// Fire-control filtered aim point: a raw radar track's reported position
// carries per-detection noise (scanSensors in sensors.js scatters it by up to
// several NM depending on track quality) that can differ meaningfully sample
// to sample even for a target that hasn't materially moved. Steering straight
// at that raw sample every decision tick (1s) makes a flight visibly "chase
// the noise" — a wobbling, indecisive-looking flight path even while it is
// steadily pursuing one locked, unchanging target (confirmed in the debug
// log: heading swinging 20-40 degrees tick to tick during a plain straight-
// line ingress, with no phase change and no retarget in between). A real
// fire-control/nav solution filters successive returns instead of reacting to
// each one; this is a simple exponential filter on the track's reported x/y,
// keyed to the locked target id so retargeting snaps cleanly to the new
// contact instead of blending two different targets' positions together.
const AIM_SMOOTHING_ALPHA = 0.25;
function smoothedAimPoint(ship, keyPrefix, track) {
  if (!track) return null;
  const idKey = `_${keyPrefix}AimId`;
  const xKey = `_${keyPrefix}AimX`;
  const yKey = `_${keyPrefix}AimY`;
  if (ship[idKey] !== track.id) {
    ship[idKey] = track.id;
    ship[xKey] = track.x;
    ship[yKey] = track.y;
  } else {
    ship[xKey] += (track.x - ship[xKey]) * AIM_SMOOTHING_ALPHA;
    ship[yKey] += (track.y - ship[yKey]) * AIM_SMOOTHING_ALPHA;
  }
  // Keep every other field (id, quality, domain, classification, ...) from
  // the live track; only the steering-relevant x/y is filtered.
  return { ...track, x: ship[xKey], y: ship[yKey] };
}

function acquireAirTargets(sim, ship) {
  const picture = sim.forcePicture?.get(ship.side);
  const all = picture ? [...picture.values()] : [...iterateTracksForShip(sim, ship)];
  const surfTrack = resolveLockedTrack(sim, ship, all, false, "surf");
  const airTrack = resolveLockedTrack(sim, ship, all, true, "air");
  const surf = smoothedAimPoint(ship, "surf", surfTrack);
  const air = smoothedAimPoint(ship, "air", airTrack);
  return {
    surf,
    surfRangeM: surf ? distance(ship, surf) : Infinity,
    air,
    airRangeM: air ? distance(ship, air) : Infinity
  };
}

// Longest reach (m) among surface weapons currently aboard. When `domain` is
// set (sea/ground), only munitions that can engage that domain count — so a
// JSOW flight sizes its stand-off ring for ground sites, not for a Harpoon it
// does not carry. 0 when nothing fireable remains.
function bestStrikeRangeM(ship, domain = null) {
  let max = 0;
  const lo = ship.loadout;
  if (lo) for (const id in lo) {
    if (!(lo[id] > 0)) continue;
    const spec = MISSILES[id];
    if (!spec || !missileHasSurfaceTarget(spec)) continue;
    if (domain && !missileCanTarget(spec, domain)) continue;
    max = Math.max(max, spec.rangeM);
  }
  return max;
}

function hasAirToAir(ship) {
  const lo = ship.loadout;
  if (lo) for (const id in lo) {
    if (lo[id] > 0 && missileCanTarget(MISSILES[id], "air")) return true;
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
  if (lo) for (const id in lo) { const c = lo[id]; if (c > 0 && missileHasSurfaceTarget(MISSILES[id])) n += c; }
  return n;
}
function carriedStrike(ship) {
  const snap = ship.baseLoadoutSnapshot;
  if (snap) for (const id in snap) { if (snap[id] > 0 && missileHasSurfaceTarget(MISSILES[id])) return true; }
  return false;
}

// Low-observable stand-in strike profile: any LO airframe still holding a
// fireable surface munition for the locked domain. Replaces the old
// hull==="F35C" + AGM-84 hardcode so F-35A (JSOW) and Workshop LO clones share
// the same doctrine path.
function lowObservableAntiShipProfile(ship, surf) {
  if (!ship.lowObservable || !surf) return false;
  const domain = surf.domain ?? "sea";
  return loadoutCanEngageDomain(ship, domain);
}

// Whether this squadron's design carries any weapon at all (any hardpoint in
// its base loadout, not just anti-ship strike). Distinguishes "built unarmed
// on purpose" (a sensor/command asset like the AWAC — should loiter forever
// on its station, only ever coming home for fuel) from "built armed, magazine
// now empty" (should come home to rearm). Without this, an intentionally
// unarmed squadron reads as permanently "winchester" and RTBs on its very
// first decision tick, parks at the field, refuels/rearms into the same empty
// loadout, and immediately RTBs again next tick — a park-forever loop that
// never lets it fly its actual mission.
function everCarriesWeapons(ship) {
  const snap = ship.baseLoadoutSnapshot;
  if (snap) for (const id in snap) { if (snap[id] > 0) return true; }
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

// Bingo fuel: the fuel level (s) at which a flight must turn for home RIGHT
// NOW to have any chance of making it. A flat fraction of total endurance
// (the old rtbFuelThresholdFrac alone) is blind to how far the flight
// actually is from its base — a CAP screen or a strike that ranged out 70+NM
// can trigger RTB with a fixed-percentage fuel margin that is nowhere near
// enough to physically cover the return distance, guaranteeing a splash en
// route (confirmed in the debug log: an F22 triggered RTB with 340s of fuel
// while 72.4NM/450s-at-max-speed from its field — a 110s shortfall before it
// even turned around). Bingo is instead computed from the CURRENT distance to
// the nearest friendly field (time to fly it at max speed — the same speed
// RTB actually flies — plus a reserve) so the margin scales with reality, not
// a fixed percentage. The reserve absorbs what the straight-line max-speed
// estimate doesn't capture — accelerating up from cruise takes real time and
// distance (not instantaneous), and the transit-turn speed bleed briefly
// costs a little more (see movement.js) — plus ordinary decision latency;
// tuned against the debug log to a comfortable margin. Falls back to the flat
// fraction only when no friendly field exists to compute a distance to (the
// flight then limps toward friendly territory anyway; there is nothing to
// reach in time regardless of the threshold).
const AIR_FUEL_RESERVE_FRAC = 0.18;
function bingoFuelS(sim, ship) {
  const base = nearestFriendlyAirfield(sim, ship);
  const reserve = ship.enduranceS * AIR_FUEL_RESERVE_FRAC;
  if (!base) return ship.enduranceS * AIRCRAFT_TEMP_CONFIG.rtbFuelThresholdFrac;
  const timeToBaseS = distance(ship, base) / (ship.maxSpeed || AIR_MAX_MPS);
  return Math.max(ship.enduranceS * AIRCRAFT_TEMP_CONFIG.rtbFuelThresholdFrac, timeToBaseS + reserve);
}

// Debug-only: log a one-line event whenever a flight's behavioural phase
// changes (e.g. ingress -> on-station -> egress, or strike -> defensive A2A).
// This is the cheapest way to see the AI's actual decision history in the
// battle log without a line per tick; it draws no RNG and only fires on a
// state change, so it is deterministic and near-zero-cost when nothing
// changes. `extra` is a short free-form context string (range/altitude).
function setPhase(sim, ship, phase, extra) {
  if (ship._phase === phase) return;
  ship._phase = phase;
  if (sim.debugPhaseLog) addEvent(sim, `${ship.name} phase -> ${phase}${extra ? ` (${extra})` : ""}.`, ship.side);
}

// Per-decision-tick state machine for one squadron. Sets waypoint/desiredSpeed.
export function decideAircraft(sim, ship) {
  if (!ship.alive || sim.time < (ship.nextDecision ?? 0)) return;
  ship.nextDecision = sim.time + 1;
  if (sim.mode !== SCENARIO_MODE.RUNNING) return;

  // Parked + rearming: ride the deck (including a moving carrier) until the
  // rearm timer elapses, then relaunch. If the base is destroyed or the
  // squadron is no longer allowed to recover there, divert (RTB / splash).
  if (ship.airState === AIR_STATE.REARMING) {
    if (stickToBaseDeck(sim, ship)) {
      setPhase(sim, ship, "rearming", ship.homeBaseId);
      if (sim.time >= (ship.rearmUntil ?? 0)) {
        refillFromBase(ship);
        // Climb out after relaunch so the next mission tick is not stuck at deck
        // altitude (LO stand-in / CAP both assume a cruising height).
        const climbTo = 9000;
        ship.targetAltitudeM = climbTo;
        ship.altitudeM = Math.min((ship.altitudeM || 0) + 80, climbTo);
      }
      return;
    }
    ship.airState = AIR_STATE.RTB;
  }

  // While actively breaking to defeat a missile, hold the evasion course set by
  // updateAircraft — do not override it with mission/RTB navigation.
  if (ship.evading && sim.time < (ship.evadeUntil ?? 0)) {
    setPhase(sim, ship, "evading");
    return;
  }

  const lowFuel = ship.fuelS <= bingoFuelS(sim, ship);
  const winchester = everCarriesWeapons(ship) && totalWeapons(ship) <= 0;
  // A striker returns once its stand-off (anti-ship) load is spent, even if it
  // still has air-to-air missiles for self-escort.
  const strikeDepleted = carriedStrike(ship) && strikeAmmo(ship) <= 0;
  // Harpoon-only (or similar) after every ship is gone: still "armed" but no
  // fireable track — CAP forever with unusable munitions. Seen in long CVN
  // fights where F-35Cs kept ASUW=4 while only SAMs remained. RTB instead.
  const unemployableStrike = everCarriesWeapons(ship)
    && !hasAirToAir(ship)
    && strikeAmmo(ship) > 0
    && !hasEmployableSurfaceTrack(sim, ship);
  if ((lowFuel || winchester || strikeDepleted || unemployableStrike) && ship.airState !== AIR_STATE.RTB) {
    ship.airState = AIR_STATE.RTB;
  }

  if (ship.airState === AIR_STATE.RTB) {
    ship.afterburner = false; // conserve fuel getting home, not sprinting there
    // Prefer a base with an open deck slot; if every compatible deck is full,
    // still approach the nearest so we can hold a pattern until a slot frees.
    const base = nearestFriendlyAirfield(sim, ship, { requireSlot: true })
      || nearestFriendlyAirfield(sim, ship, { requireSlot: false });
    if (base) {
      ship.homeBaseId = base.id;
      const onFinal = distance(ship, base) <= AIRCRAFT_TEMP_CONFIG.baseReachM;
      if (onFinal && baseHasDeckSlot(sim, ship, base)) {
        ship.airState = AIR_STATE.REARMING;
        ship.rearmUntil = sim.time + (ship.rearmTimeS ?? AIRCRAFT_TEMP_CONFIG.rearmTimeS);
        // Occupy a deck slot immediately so concurrent RTBs see the capacity.
        if (sim._parkedByBase) {
          sim._parkedByBase.set(base.id, (sim._parkedByBase.get(base.id) || 0) + 1);
        }
        stickToBaseDeck(sim, ship);
        setPhase(sim, ship, "rearming", base.id);
        return;
      }
      if (onFinal && !baseHasDeckSlot(sim, ship, base)) {
        // Deck full: hold pattern abeam until a squadron relaunches.
        setPhase(sim, ship, "deck-wait", base.id);
        ship.waypoint = holdingPatternPoint(base, ship);
        ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
        ship.targetAltitudeM = Math.min(ship.altitudeM || 1500, 1500);
        return;
      }
      const reason = lowFuel ? "fuel" : winchester ? "winchester" : "strike-spent";
      const kind = isCarrier(base) ? "CVN" : "AFB";
      setPhase(sim, ship, "rtb", `${reason} -> ${kind} ${base.id}`);
      // Lead the moving deck so recovery does not chase the carrier's wake.
      ship.waypoint = approachPointForBase(ship, base);
      ship.desiredSpeed = ship.maxSpeed;
      ship.targetAltitudeM = Math.min(ship.altitudeM || 3000, 3000);
      return;
    }
    // No compatible base (e.g. land-only fighter with only a CVN present): limp
    // toward friendly territory; fuel exhaustion → splash.
    setPhase(sim, ship, "rtb-no-base");
    ship.homeBaseId = null;
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
  const surfDomain = surf?.domain ?? "sea";
  // Size the stand-off ring from weapons that can actually engage this lock.
  const strikeRangeM = bestStrikeRangeM(ship, surf ? surfDomain : null);
  const lowObservableStrike = lowObservableAntiShipProfile(ship, surf);
  const strikeReleaseFrac = lowObservableStrike ? cfg.lowObservableStandInFrac : cfg.standoffFrac;
  ship._standoffNm = strikeRangeM > 0 ? (strikeRangeM * strikeReleaseFrac) / NM : null;

  const canStrike = surf && strikeRangeM > 0;
  // Reheat is reserved for genuinely demanding moments (closing an intercept,
  // a defensive break) — reset to off each decision tick and only the a2a
  // branches below re-engage it, so cruise/ingress/patrol/RTB legs fly MIL
  // power and conserve fuel.
  ship.afterburner = false;

  // 1) Defensive air-to-air. Break for an enemy flight only when it closes inside
  //    self-defence/merge range (or this flight has no strike to fly). A striker
  //    ignores fighters farther out so it presses its run instead of collapsing
  //    into a furball. Stay high for energy and close to a no-escape-zone shot;
  //    the planner releases the missile.
  //
  //    The self-defence range check is hysteresis-gated (enter at
  //    a2aSelfDefenseRangeM, only release once the range has opened back out
  //    past a2aSelfDefenseExitFrac): a fighter loitering right around the
  //    merge line would otherwise make the striker flip-flop every decision
  //    tick between "break for the fighter" and "resume the strike run" —
  //    visibly indecisive flying. `!canStrike` (a pure air-superiority load)
  //    is a stable, non-range condition and needs no hysteresis.
  if (!air || !aam) ship._a2aBreak = false;
  if (air && aam && airRangeM <= cfg.a2aEngageRangeM) {
    const closeRange = ship._a2aBreak
      ? airRangeM <= cfg.a2aSelfDefenseRangeM * cfg.a2aSelfDefenseExitFrac
      : airRangeM <= cfg.a2aSelfDefenseRangeM;
    ship._a2aBreak = closeRange;
    if (closeRange || !canStrike) {
      setPhase(sim, ship, "a2a-defensive", `${air.id} @ ${(airRangeM / NM).toFixed(0)}NM`);
      ship.targetAltitudeM = cfg.cruiseAltitudeM;
      ship.waypoint = { x: air.x, y: air.y };
      ship.desiredSpeed = ship.maxSpeed;
      ship.afterburner = true; // closing an intercept: reheat for max closure rate/energy
      return;
    }
  }

  // 2) Stand-off strike. Vector onto the surface target, descend for a low-level
  //    ingress (radar-horizon masking), and hold at the stand-off ring — fire
  //    from just inside weapon reach, never inside the ship's air-defence
  //    envelope. Too close → turn cold and re-open range (egress).
  if (surf && strikeRangeM > 0) {
    const standoffM = strikeRangeM * strikeReleaseFrac;
    const r = surfRangeM;
    ship.targetAltitudeM = r <= standoffM * cfg.ingressStartFrac ? cfg.ingressAltitudeM : cfg.cruiseAltitudeM;
    // Sub-phase hysteresis: which boundary applies depends on which sub-phase
    // the flight is ALREADY in, opening a dead zone the range must fully cross
    // before it flips again (see the config comment on the *Enter/*Exit pairs).
    // Retargeting onto a different track resets it — the new run starts fresh.
    if (ship._strikeSubTargetId !== surf.id) {
      ship._strikeSubPhase = null;
      ship._strikeSubTargetId = surf.id;
      ship._noseOnUntil = null;
    }
    let sub = ship._strikeSubPhase;
    if (sub === "ingress") {
      sub = r > standoffM * cfg.ingressExitFrac ? "ingress" : "onstation";
    } else if (sub === "egress") {
      sub = r < standoffM * cfg.egressExitFrac ? "egress" : "onstation";
    } else if (r > standoffM * cfg.ingressEnterFrac) {
      sub = "ingress";
    } else if (r < standoffM * cfg.egressEnterFrac) {
      sub = "egress";
    } else {
      sub = "onstation";
    }
    ship._strikeSubPhase = sub;
    if (sub === "ingress") {
      setPhase(sim, ship, "strike-ingress", `${surf.id} @ ${(r / NM).toFixed(0)}NM alt ${Math.round(ship.altitudeM)}m`);
      ship.waypoint = { x: surf.x, y: surf.y };           // ingress
      ship.desiredSpeed = ship.maxSpeed;
    } else if (sub === "egress") {
      setPhase(sim, ship, "strike-egress", `${surf.id} @ ${(r / NM).toFixed(0)}NM`);
      const away = angleTo(surf, ship);                    // egress: open the range
      ship.waypoint = { x: ship.x + Math.cos(away) * 12 * NM, y: ship.y + Math.sin(away) * 12 * NM };
      ship.desiredSpeed = ship.maxSpeed;
    } else {
      // On station at stand-off: hold a nose-on release geometry first (real
      // air-launched weapons need the target roughly ahead of the jet), then
      // fall back to a beam racetrack weave so the flight does not slide off
      // the ring while waiting for the force planner to queue the shot.
      setPhase(sim, ship, "strike-onstation", `${surf.id} @ ${(r / NM).toFixed(0)}NM`);
      const stillArmed = loadoutCanEngageDomain(ship, surfDomain);
      if (stillArmed && (ship._noseOnUntil == null || sim.time < ship._noseOnUntil)) {
        if (ship._noseOnUntil == null) ship._noseOnUntil = sim.time + 12;
        // Short lead toward the target — aspect for release without re-entering
        // a deep ingress (egress hysteresis still protects the envelope).
        const bearing = angleTo(ship, surf);
        ship.waypoint = {
          x: ship.x + Math.cos(bearing) * 2.5 * NM,
          y: ship.y + Math.sin(bearing) * 2.5 * NM
        };
        ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
      } else {
        ship._noseOnUntil = null;
        if (sim.time >= (ship._weaveFlipAt ?? 0)) {
          ship._weaveSign = ship._weaveSign === 1 ? -1 : 1;
          ship._weaveFlipAt = sim.time + cfg.stationWeaveS;
        }
        const beam = angleTo(ship, surf) + (ship._weaveSign ?? 1) * Math.PI / 2;
        ship.waypoint = { x: ship.x + Math.cos(beam) * 5 * NM, y: ship.y + Math.sin(beam) * 5 * NM };
        ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
      }
    }
    return;
  }

  // 3) Air-to-air against a distant flight when that is all we can do (pure
  //    air-superiority load, or strike spent but AAMs remain): run it down.
  if (air && aam) {
    setPhase(sim, ship, "a2a-sweep", `${air.id} @ ${(airRangeM / NM).toFixed(0)}NM`);
    ship.targetAltitudeM = cfg.cruiseAltitudeM;
    ship.waypoint = { x: air.x, y: air.y };
    ship.desiredSpeed = ship.maxSpeed;
    ship.afterburner = true; // running down a bandit: reheat for the intercept
    return;
  }

  // 4) No engageable contact. An armed flight (or one that has no strike load
  //    but still carries AAMs — this branch is only reached with aam === true
  //    when hasAirToAir already found no live air contact to chase) flies a
  //    combat air patrol screening the fleet — a station AHEAD of the
  //    formation guide (OTC) along the threat axis. An UNARMED flight (a
  //    support/sensor asset like the AWAC AEW&C squadron, or any custom
  //    aircraft with no weapons at all) has no business up front: it orbits
  //    BEHIND the guide, on the far side away from the threat, at a
  //    deliberately generous stand-off — a moving radar survives by staying
  //    clear, not by fighting. Both read the shared command picture, so
  //    either station re-centers automatically as the OTC/threat axis shifts.
  setPhase(sim, ship, aam ? "cap" : "orbit");
  ship.targetAltitudeM = cfg.cruiseAltitudeM;
  ship.desiredSpeed = ship.cruiseSpeed ?? AIR_CRUISE_MPS;
  // CAP / support stations re-anchor only when the computed station has moved
  // materially — micro-updates every decision tick from a wandering OTC or a
  // noisy axis read as continuous heading wobble even on a quiet patrol.
  const CAP_STATION_DEADBAND_M = 2.5 * NM;
  const setStationIfMoved = (next) => {
    if (!ship.waypoint || distance(ship.waypoint, next) > CAP_STATION_DEADBAND_M) {
      ship.waypoint = next;
    }
  };
  const cmd = sim.fleetCommand?.get(ship.side);
  if (cmd?.otc?.alive && cmd.otc.domain !== "air" && Number.isFinite(cmd.axis)) {
    const standM = aam ? cfg.capStationM : cfg.supportOrbitM;
    const bearing = aam ? cmd.axis : cmd.axis + Math.PI; // support orbit: opposite the threat axis
    setStationIfMoved({
      x: cmd.otc.x + Math.cos(bearing) * standM,
      y: cmd.otc.y + Math.sin(bearing) * standM
    });
  } else if (Number.isFinite(cmd?.axis)) {
    // No surface OTC to anchor a station on (a pure-air fleet, or the last
    // surface unit just died) — fly the SAME real threat axis fleet command
    // already computed (bearing toward the enemy's actual force, not a
    // fixed compass heading; see enemyFleetCentroid in command.js), just
    // anchored on the aircraft itself instead of a formation guide.
    const bearing = aam ? cmd.axis : cmd.axis + Math.PI;
    // Self-relative stations always advance with the jet; only re-pick when
    // the axis itself has shifted enough that the old waypoint is off-axis.
    const axisKey = Math.round(cmd.axis * 20); // ~3 deg buckets
    if (ship._capAxisKey !== axisKey || !ship.waypoint) {
      ship._capAxisKey = axisKey;
      ship.waypoint = {
        x: ship.x + Math.cos(bearing) * 30 * NM,
        y: ship.y + Math.sin(bearing) * 30 * NM
      };
    } else if (distance(ship, ship.waypoint) < 4 * NM) {
      // Reached the leg end — extend along the same axis.
      ship.waypoint = {
        x: ship.x + Math.cos(bearing) * 30 * NM,
        y: ship.y + Math.sin(bearing) * 30 * NM
      };
    }
  } else if (!ship.waypoint) {
    // Absolute fallback for the one tick before fleet command has ever run
    // (computeFleetCommand hasn't executed yet this game). Self-corrects to
    // the branch above on the very next decision tick.
    const towardEnemy = ship.side === SIDE.BLUE ? 1 : -1;
    const dir = aam ? towardEnemy : -towardEnemy;
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
    if (ship.airState === AIR_STATE.REARMING) {
      // Deck stay is applied in moveAirUnit every tick; here only clear evade
      // and skip fuel burn while parked (rearm/refuel covers fuel).
      ship.evading = false;
      ship.afterburner = false;
      continue;
    }

    // Evasive break: when a missile is closing inside the reaction envelope (or
    // already terminal) the flight flies a COMBINATION defensive maneuver, not
    // just a lateral turn — real BVR/WVR doctrine pairs the beam/notch (steering
    // perpendicular to the threat's line of sight, nulling the closure rate a
    // semi-active/active seeker keys on) with a hard dive and afterburner: the
    // descent trades altitude for the airspeed/energy needed to keep out-turning
    // a missile that has little energy margin left late in flight, and denies a
    // look-down seeker a clean picture, while reheat maximizes the aircraft's
    // own turn/speed capability through the break. Previously this only turned
    // the flight sideways and never touched altitude at all. Both feed the
    // survivability model (a breaking target is far harder to hit).
    const threat = nearestIncomingMissile(sim, ship);
    if (threat && (threat.terminal || distance(ship, threat) <= AIRCRAFT_TEMP_CONFIG.evadeRangeM)) {
      if (!ship.evading) addEvent(sim, `${ship.name} breaks hard against an inbound missile, diving and going to afterburner.`, ship.side);
      ship.evading = true;
      ship.evadeUntil = sim.time + AIRCRAFT_TEMP_CONFIG.evadeDurationS;
      ship.afterburner = true;
      const beam = angleTo(threat, ship) + Math.PI / 2;
      ship.waypoint = { x: ship.x + Math.cos(beam) * 15 * NM, y: ship.y + Math.sin(beam) * 15 * NM };
      ship.desiredSpeed = ship.maxSpeed;
      ship.targetAltitudeM = Math.min(ship.altitudeM, AIRCRAFT_TEMP_CONFIG.evadeDiveAltitudeM);
    } else if (ship.evading && sim.time >= (ship.evadeUntil ?? 0)) {
      ship.evading = false;
      ship.afterburner = false;
    }

    // Afterburner burns fuel at several times the MIL-power rate — this is why
    // it is only engaged for genuinely demanding moments (see decideAircraft's
    // afterburner assignments) rather than run continuously.
    const fuelBurnMult = ship.afterburner ? AIRCRAFT_TEMP_CONFIG.afterburnerFuelBurnMult : 1;
    ship.fuelS = (ship.fuelS ?? 0) - dt * fuelBurnMult;
    if (ship.fuelS <= 0) {
      ship.fuelS = 0;
      ship.speed = 0;
      if (ship.alive) {
        ship.alive = false;
        markContactDead(sim, ship.id);
        // Incremental side/alive indexes (same pattern as combat.deactivateShip).
        if (sim._aliveShips && sim._shipsBySide) {
          const alive = sim._aliveShips;
          const ai = alive.indexOf(ship);
          if (ai >= 0) { alive[ai] = alive[alive.length - 1]; alive.pop(); }
          const bucket = sim._shipsBySide.get(ship.side);
          if (bucket) {
            const bi = bucket.indexOf(ship);
            if (bi >= 0) { bucket[bi] = bucket[bucket.length - 1]; bucket.pop(); }
            if (!bucket.length) sim._shipsBySide.delete(ship.side);
          }
          if (sim._aliveSideCount && (ship.side === SIDE.BLUE || ship.side === SIDE.RED)) {
            sim._aliveSideCount[ship.side] = Math.max(0, (sim._aliveSideCount[ship.side] || 0) - 1);
          }
        } else {
          sim._entityIndexesDirty = true;
        }
      }
      addEvent(sim, `${ship.name} ran out of fuel and splashed.`, ship.side);
    }
  }
}
