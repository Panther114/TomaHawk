// Per-unit motion: kinematic integration (turn/accel limits, station-keeping,
// retreat) and the per-ship movement decision derived from tracks and threats.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE, SCENARIO_MODE } from "./constants.js";
import { clamp, distance, angleTo, wrapAngle } from "./math.js";
import { offensiveMissileCount } from "./ships.js";
import { firstLandCollisionFraction, isWaterPoint, segmentCrossesLand, terrainCollision } from "../world/terrain.js";
import { shipWaterClearanceM } from "./scenario.js";
import { iterateTracksForShip } from "./sensors.js";
import { AIRCRAFT_TEMP_CONFIG } from "./aircraft.js";

// Shared empty list: when the per-tick missile-by-target index exists but holds
// no bucket for a ship, that ship has nothing inbound — iterate nothing rather
// than falling back to a full O(missiles) scan (the pre-index fallback only).
const NO_INCOMING = [];
const CLEAR_ROUTE_CACHE_S = 10;
const BLOCKED_DETOUR_CACHE_S = 10;
const WAYPOINT_DEADBAND_M = 0.1 * NM;
function incomingMissilesFor(sim, shipId) {
  if (sim._missilesByTarget) return sim._missilesByTarget.get(shipId) ?? NO_INCOMING;
  return sim.missiles;
}

function steeringTurnRate(ship) {
  const speedFrac = ship.maxSpeed > 0 ? ship.speed / ship.maxSpeed : 0;
  return speedFrac > 0.75 && ship.turnRateFlank ? ship.turnRateFlank : ship.turnRate;
}

// --- aircraft turn-rate/speed model -----------------------------------------
// A fixed-wing aircraft's turn rate is not a flat per-class number: for a given
// load factor (G) it falls off with airspeed (omega = g*sqrt(n^2-1)/v — the
// standard coordinated-turn formula), so the SAME airframe turns tighter at low
// speed and wider at high speed. Reusing the ship-style flat turnRateDps/
// turnRateFlankDps switch for aircraft made every course correction turn at
// near-max-performance rate regardless of context, which reads as unrealistic
// snap-turns. Two G tiers stand in for pilot intent: a gentle standard-rate
// bank for routine navigation (ingress run, CAP vectoring, RTB, on-station
// repositioning) and the airframe's real combat G-limit only for genuinely
// aggressive moments (evasive break, a merge/intercept). `aggressive` is
// derived from state the AI layer already tracks (ship.evading / ship._phase),
// so no extra bookkeeping is needed here.
const G_MPS2 = 9.80665;
const DEG2RAD = Math.PI / 180;
const AIR_TRANSIT_G = 2.2;
const AIR_MIN_TURN_SPEED_MPS = 60; // floor so omega doesn't blow up near zero airspeed
const AIR_MIN_TURN_RATE = 1.0 * DEG2RAD;
const AIR_MAX_TURN_RATE = 25 * DEG2RAD;
// Bounded vertical rate (m/s) — a fighter-class climb/descent rate (~19,700
// ft/min), fast enough that a strike's cruise-to-ingress descent (9000m ->
// 150m) takes roughly a minute and a half rather than one decision tick.
const AIR_VERTICAL_RATE_MPS = 100;

function isAggressiveAirManeuver(ship) {
  return ship.evading === true || ship._phase === "a2a-defensive" || ship._phase === "a2a-sweep";
}

function aircraftTurnRateRadPerS(ship, aggressive) {
  const g = aggressive ? (ship.maxGLoad ?? 7) : AIR_TRANSIT_G;
  const v = Math.max(ship.speed, AIR_MIN_TURN_SPEED_MPS);
  const omega = (G_MPS2 * Math.sqrt(Math.max(0, g * g - 1))) / v;
  return clamp(omega, AIR_MIN_TURN_RATE, AIR_MAX_TURN_RATE);
}

function strategicTarget(ship) {
  return ship.navigationWaypoint ?? ship.waypoint ?? null;
}

function waypointReached(ship, waypoint, thresholdM) {
  return waypoint && distance(ship, waypoint) < thresholdM;
}

function setShipWaypoint(ship, waypoint, deadbandM = WAYPOINT_DEADBAND_M) {
  if (ship.waypoint && distance(ship.waypoint, waypoint) <= deadbandM) return;
  ship.waypoint = waypoint;
}

function detourCandidate(base, bearing, side, forwardM, lateralM) {
  return {
    x: base.x + Math.cos(bearing) * forwardM + Math.cos(bearing + side * Math.PI / 2) * lateralM,
    y: base.y + Math.sin(bearing) * forwardM + Math.sin(bearing + side * Math.PI / 2) * lateralM
  };
}

function chooseWaterDetour(sim, ship, target) {
  const clearanceM = shipWaterClearanceM(ship);
  const blockedT = firstLandCollisionFraction(ship, target, sim.mapId, clearanceM);
  if (blockedT == null) return null;
  const collisionPoint = {
    x: ship.x + (target.x - ship.x) * blockedT,
    y: ship.y + (target.y - ship.y) * blockedT
  };
  const bearing = angleTo(ship, target);
  const forwardFactors = [2, 4, 7, 10];
  const lateralFactors = [2, 4, 7];
  let best = null;
  for (const side of [-1, 1]) {
    for (const forwardFactor of forwardFactors) {
      for (const lateralFactor of lateralFactors) {
        const candidate = detourCandidate(
          collisionPoint,
          bearing,
          side,
          forwardFactor * clearanceM,
          lateralFactor * clearanceM
        );
        const withinBounds = {
          x: clamp(candidate.x, -sim.widthM / 2, sim.widthM / 2),
          y: clamp(candidate.y, -sim.heightM / 2, sim.heightM / 2)
        };
        if (!isWaterPoint(withinBounds, sim.mapId, clearanceM)) continue;
        if (segmentCrossesLand(ship, withinBounds, sim.mapId, clearanceM)) continue;
        const score = distance(withinBounds, target) + lateralFactor * 40 + forwardFactor * 15;
        if (!best || score < best.score) {
          best = { point: withinBounds, score };
        }
      }
    }
  }
  return best?.point ?? null;
}

function resolveNavigationTarget(sim, ship) {
  const target = ship.waypoint;
  if (!target) {
    ship.navigationWaypoint = null;
    ship.navPlan = null;
    return null;
  }
  const clearanceM = shipWaterClearanceM(ship);
  const sameGoal = ship.navPlan
    && ship.navPlan.goalX === target.x
    && ship.navPlan.goalY === target.y;
  const cacheWindowS = ship.navPlan?.blocked ? BLOCKED_DETOUR_CACHE_S : CLEAR_ROUTE_CACHE_S;
  const cacheValid = sameGoal && sim.time - ship.navPlan.plannedAt < cacheWindowS;
  if (ship.navigationWaypoint && waypointReached(ship, ship.navigationWaypoint, 0.35 * NM)) {
    ship.navigationWaypoint = null;
  }
  if (cacheValid && !ship.navPlan.blocked && !ship.navigationWaypoint) {
    return target;
  }
  if (cacheValid && ship.navPlan.blocked && ship.navigationWaypoint) {
    return ship.navigationWaypoint;
  }
  if (sameGoal && ship.navPlan.blocked && ship.navigationWaypoint) {
    const detourStillUsable = isWaterPoint(ship.navigationWaypoint, sim.mapId, clearanceM)
      && !segmentCrossesLand(ship, ship.navigationWaypoint, sim.mapId, clearanceM);
    if (detourStillUsable) {
      ship.navPlan.plannedAt = sim.time;
      return ship.navigationWaypoint;
    }
    ship.navigationWaypoint = null;
  }
  if (!segmentCrossesLand(ship, target, sim.mapId, clearanceM)) {
    ship.navigationWaypoint = null;
    ship.navPlan = { goalX: target.x, goalY: target.y, plannedAt: sim.time, blocked: false };
    return target;
  }
  if (sameGoal && ship.navigationWaypoint) {
    const detourStillUsable = isWaterPoint(ship.navigationWaypoint, sim.mapId, clearanceM)
      && !segmentCrossesLand(ship, ship.navigationWaypoint, sim.mapId, clearanceM);
    if (detourStillUsable) {
      ship.navPlan.plannedAt = sim.time;
      return ship.navigationWaypoint;
    }
  }
  ship.navigationWaypoint = chooseWaterDetour(sim, ship, target);
  ship.navPlan = { goalX: target.x, goalY: target.y, plannedAt: sim.time, blocked: true };
  return strategicTarget(ship);
}

function applyWaterCollisionGuard(sim, ship, nextPosition) {
  if (nextPosition.x === ship.x && nextPosition.y === ship.y) return nextPosition;
  const clearanceM = shipWaterClearanceM(ship);
  if (distance(ship, nextPosition) <= 0.02 * NM) return nextPosition;
  const collision = terrainCollision(ship, nextPosition, sim.mapId, clearanceM);
  if (!collision) return nextPosition;
  const blockedT = collision.fraction;
  const safeT = Math.max(0, blockedT - 0.02);
  ship.navigationWaypoint = null;
  ship.speed = 0;
  ship.desiredSpeed = Math.min(ship.desiredSpeed, ship.cruiseSpeed ?? ship.desiredSpeed);
  return {
    x: ship.x + (nextPosition.x - ship.x) * safeT,
    y: ship.y + (nextPosition.y - ship.y) * safeT
  };
}

// Kinematic integration for an air unit: turn toward the waypoint within the
// airframe turn limit, accelerate/decelerate toward desiredSpeed, advance, and
// clamp to the map. No terrain interaction (overflies everything). Speed is
// degraded by attrition (lost aircraft) just like a damaged ship's propulsion.
function moveAirUnit(sim, ship, dt) {
  // Full signed heading error (unclamped) — used both to limit this tick's
  // turn and, below, to bleed a little commanded speed proportional to how
  // hard the turn is (induced drag rises with bank angle; a real jet can't
  // hold max speed through a hard break). 0 when flying straight/no waypoint.
  let headingErrorRad = 0;
  if (ship.waypoint) {
    const d = distance(ship, ship.waypoint);
    if (d < 0.4 * NM) {
      ship.waypoint = null;
    } else {
      const aggressive = isAggressiveAirManeuver(ship);
      const desiredHeading = angleTo(ship, ship.waypoint);
      headingErrorRad = wrapAngle(desiredHeading - ship.heading);
      const effectiveTurn = aircraftTurnRateRadPerS(ship, aggressive);
      const delta = clamp(headingErrorRad, -effectiveTurn * dt, effectiveTurn * dt);
      ship.heading = wrapAngle(ship.heading + delta);
    }
  }
  // Altitude is a commanded TARGET (targetAltitudeM, set by the AI layer in
  // aircraft.js), climbed/descended toward at a bounded vertical rate rather
  // than snapped — a strike descending from cruise to ingress altitude
  // (9000m -> 150m) previously teleported there in one decision tick. Computed
  // here (before the speed integration below) so the same tick's climb/dive
  // can feed the gravity energy-exchange term.
  let altDelta = 0;
  if (Number.isFinite(ship.targetAltitudeM)) {
    altDelta = clamp(ship.targetAltitudeM - ship.altitudeM, -AIR_VERTICAL_RATE_MPS * dt, AIR_VERTICAL_RATE_MPS * dt);
  }
  const errFrac = Math.abs(headingErrorRad) / Math.PI; // 0 = on-heading, 1 = reversing course
  const bleed = 1 - (isAggressiveAirManeuver(ship) ? 0.30 : 0.10) * errFrac;
  // Afterburner: reheat unlocks meaningfully more top speed and much stronger
  // acceleration than MIL power (see AIRCRAFT_TEMP_CONFIG.afterburner* and the
  // decideAircraft branches that engage it) — modeled as a ceiling/rate
  // multiplier rather than a separate speed field so every airframe benefits
  // uniformly without new per-hull data.
  const abActive = ship.afterburner === true;
  const speedMult = abActive ? AIRCRAFT_TEMP_CONFIG.afterburnerSpeedMult : 1;
  const accelMult = abActive ? AIRCRAFT_TEMP_CONFIG.afterburnerAccelMult : 1;
  const effMaxSpeed = ship.maxSpeed * speedMult;
  const targetSpeed = Math.min(ship.desiredSpeed * speedMult, effMaxSpeed) * bleed;
  const accelLimit = (targetSpeed >= ship.speed ? ship.accel * accelMult : (ship.decel ?? ship.accel)) * dt;
  // GPE <-> KE energy exchange: a real jet gains genuine airspeed diving and
  // loses it climbing (specific energy trades between altitude and speed, not
  // just the induced-drag bleed from turning above) — previously altitude and
  // speed were two fully independent integrators with no physical coupling at
  // all. Small-angle approximation (sin(gamma) =~ verticalRate/speed) is exact
  // enough here since the vertical rate is already capped well below cruise
  // speed. See docs/SIMULATION_ASSUMPTIONS.md.
  const verticalRateMps = dt > 0 ? altDelta / dt : 0;
  const gravityAccel = ship.speed > 1 ? -G_MPS2 * clamp(verticalRateMps / ship.speed, -1, 1) : 0;
  const speedDelta = clamp(targetSpeed - ship.speed, -accelLimit, accelLimit) + gravityAccel * dt;
  const degrade = ship.damageDegrade ?? 0.1;
  ship.speed = clamp(ship.speed + speedDelta, 0, effMaxSpeed * Math.max(0.25, 1 - ship.damage * degrade));
  ship.altitudeM = Math.max(0, ship.altitudeM + altDelta);
  ship.x = clamp(ship.x + Math.cos(ship.heading) * ship.speed * dt, -sim.widthM / 2, sim.widthM / 2);
  ship.y = clamp(ship.y + Math.sin(ship.heading) * ship.speed * dt, -sim.heightM / 2, sim.heightM / 2);
}

export function moveShips(sim, dt) {
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    // Fixed ground emplacements never move; only keep their CIWS cycle ticking.
    if (ship.isFixed) {
      ship.speed = 0;
      ship.ciwsCooldown = Math.max(0, ship.ciwsCooldown - dt);
      continue;
    }
    // Air units fly directly to their waypoint: they overfly land and water, so
    // they skip the coastal-detour planner and the water-collision guard that
    // constrain surface ships. Altitude is not modelled.
    if (ship.domain === "air") {
      moveAirUnit(sim, ship, dt);
      continue;
    }
    const steeringTarget = resolveNavigationTarget(sim, ship);
    if (ship.waypoint) {
      const d = distance(ship, ship.waypoint);
      if (d < 0.4 * NM) {
        ship.waypoint = null;
        ship.navigationWaypoint = null;
        ship.desiredSpeed = 10 * KNOT * SHIP_SPEED_MULTIPLIER;
      } else if (steeringTarget) {
        const desiredHeading = angleTo(ship, steeringTarget);
        const effectiveTurn = steeringTurnRate(ship);
        const delta = clamp(wrapAngle(desiredHeading - ship.heading), -effectiveTurn * dt, effectiveTurn * dt);
        ship.heading = wrapAngle(ship.heading + delta);
        if (ship.navigationWaypoint) {
          ship.desiredSpeed = Math.min(ship.desiredSpeed, ship.cruiseSpeed ?? ship.desiredSpeed);
        }
      }
    }
    const accelLimit = (ship.desiredSpeed >= ship.speed ? ship.accel : (ship.decel ?? ship.accel)) * dt;
    const speedDelta = clamp(ship.desiredSpeed - ship.speed, -accelLimit, accelLimit);
    const degrade = ship.damageDegrade ?? 0.22;
    const propHealth = ship.subsystems?.propulsion ?? 1.0;
    ship.speed = clamp(ship.speed + speedDelta, 0, ship.maxSpeed * Math.max(0.10, propHealth - ship.damage * degrade));
    const nextPosition = {
      x: clamp(ship.x + Math.cos(ship.heading) * ship.speed * dt, -sim.widthM / 2, sim.widthM / 2),
      y: clamp(ship.y + Math.sin(ship.heading) * ship.speed * dt, -sim.heightM / 2, sim.heightM / 2)
    };
    const resolvedPosition = applyWaterCollisionGuard(sim, ship, nextPosition);
    ship.x = resolvedPosition.x;
    ship.y = resolvedPosition.y;
    ship.ciwsCooldown = Math.max(0, ship.ciwsCooldown - dt);
  }
}

export function decideShip(sim, ship) {
  if (!ship.alive || sim.time < ship.nextDecision) return;
  ship.nextDecision = sim.time + 1;
  if (sim.mode !== SCENARIO_MODE.RUNNING) return;
  // Fixed emplacements have no movement decision (no retreat, station, patrol).
  // They still sense and fire through the shared planning pipeline.
  if (ship.isFixed) return;
  // Air units run their own decision/state machine (mission/RTB/rearm) — see
  // updateAircraft in step.js. They do not use the surface-ship movement logic.
  if (ship.domain === "air") return;
  let nearestEnemy = null;
  let nearestEnemyRange = Infinity;
  for (const track of iterateTracksForShip(sim, ship)) {
    if (track.side === ship.side || track.quality <= 0.18) continue;
    const range = distance(ship, track);
    if (range < nearestEnemyRange) {
      nearestEnemy = track;
      nearestEnemyRange = range;
    }
  }
  let incoming = null;
  for (const missile of incomingMissilesFor(sim, ship.id)) {
    if (!missile.alive || missile.side === ship.side || missile.targetId !== ship.id) continue;
    if (!incoming || (missile.timeToImpactEstimate ?? Infinity) < (incoming.timeToImpactEstimate ?? Infinity)) {
      incoming = missile;
    }
  }
  if (incoming) {
    ship.desiredSpeed = ship.maxSpeed;
    const threat = incoming;
    setShipWaypoint(ship, {
      x: ship.x + Math.cos(angleTo(threat, ship) + Math.PI / 2) * 8 * NM,
      y: ship.y + Math.sin(angleTo(threat, ship) + Math.PI / 2) * 8 * NM
    });
    return;
  }
  if (offensiveMissileCount(ship, false) <= 0) {
    const fallback = ship.side === SIDE.BLUE ? Math.PI : 0;
    const retreatBearing = nearestEnemy ? angleTo(nearestEnemy, ship) : fallback;
    setShipWaypoint(ship, {
      x: ship.x + Math.cos(retreatBearing) * 45 * NM,
      y: ship.y + Math.sin(retreatBearing) * 18 * NM
    });
    ship.desiredSpeed = Math.max(ship.cruiseSpeed ?? 0, ship.maxSpeed * 0.86);
    return;
  }
  // Non-guide units hold formation station on the OTC when not prosecuting a
  // close contact; the guide (and single-ship sides) patrol/advance normally.
  if (ship.station && !ship.isOTC) {
    const d = distance(ship, ship.station);
    setShipWaypoint(ship, { x: ship.station.x, y: ship.station.y });
    // Close the station briskly when out of position, ease off once on station.
    ship.desiredSpeed = d > 1.5 * NM
      ? clamp(16 * KNOT * SHIP_SPEED_MULTIPLIER + d / 60, 16 * KNOT, ship.maxSpeed)
      : ship.cruiseSpeed ?? 16 * KNOT * SHIP_SPEED_MULTIPLIER;
    if (!nearestEnemy) return;
  } else if (!nearestEnemy) {
    ship.desiredSpeed = ship.cruiseSpeed ?? 16 * KNOT * SHIP_SPEED_MULTIPLIER;
    if (!ship.waypoint) {
      // Patrol toward the fleet's rough strategic bearing estimate (see
      // strategicBearingEstimate in command.js) instead of a random heading —
      // a picket with no contact still has a general sense of where the
      // enemy operates, the same real battlespace awareness an aircraft's CAP
      // fallback already uses. Previously this was pure sim.rng jitter with no
      // relationship whatsoever to the enemy's actual position, so a ship
      // patrolling with zero contacts wandered aimlessly rather than
      // searching in roughly the right direction.
      const axis = sim.fleetCommand?.get(ship.side)?.axis;
      const bearing = Number.isFinite(axis) ? axis : (ship.side === SIDE.BLUE ? 0 : Math.PI);
      setShipWaypoint(ship, { x: ship.x + Math.cos(bearing) * 9 * NM, y: ship.y + Math.sin(bearing) * 9 * NM });
    }
    return;
  }
  const target = nearestEnemy;
  const rangeM = distance(ship, target);
  const standoffM = ship.doctrine.standoffNm * NM;
  if (rangeM < standoffM * 0.72) {
    const away = angleTo(target, ship);
    setShipWaypoint(ship, { x: ship.x + Math.cos(away) * 12 * NM, y: ship.y + Math.sin(away) * 12 * NM });
    ship.desiredSpeed = 25 * KNOT * SHIP_SPEED_MULTIPLIER;
  } else if (rangeM > standoffM * 1.25) {
    setShipWaypoint(ship, { x: target.x, y: target.y });
    ship.desiredSpeed = 24 * KNOT * SHIP_SPEED_MULTIPLIER;
  } else {
    ship.desiredSpeed = 18 * KNOT * SHIP_SPEED_MULTIPLIER;
  }
}
