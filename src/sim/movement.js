// Per-unit motion: kinematic integration (turn/accel limits, station-keeping,
// retreat) and the per-ship movement decision derived from tracks and threats.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE, SCENARIO_MODE } from "./constants.js";
import { clamp, distance, angleTo, wrapAngle } from "./math.js";
import { offensiveMissileCount } from "./ships.js";
import { firstLandCollisionFraction, isWaterPoint, segmentCrossesLand, terrainCollision } from "../world/terrain.js";
import { shipWaterClearanceM } from "./scenario.js";
import { iterateTracksForShip } from "./sensors.js";

function steeringTurnRate(ship) {
  const speedFrac = ship.maxSpeed > 0 ? ship.speed / ship.maxSpeed : 0;
  return speedFrac > 0.75 && ship.turnRateFlank ? ship.turnRateFlank : ship.turnRate;
}

function strategicTarget(ship) {
  return ship.navigationWaypoint ?? ship.waypoint ?? null;
}

function waypointReached(ship, waypoint, thresholdM) {
  return waypoint && distance(ship, waypoint) < thresholdM;
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
  const cacheValid = ship.navPlan
    && ship.navPlan.goalX === target.x
    && ship.navPlan.goalY === target.y
    && sim.time - ship.navPlan.plannedAt < 2;
  if (ship.navigationWaypoint && waypointReached(ship, ship.navigationWaypoint, 0.35 * NM)) {
    ship.navigationWaypoint = null;
  }
  if (cacheValid && !ship.navPlan.blocked && !ship.navigationWaypoint) {
    return target;
  }
  if (cacheValid && ship.navPlan.blocked && ship.navigationWaypoint) {
    return ship.navigationWaypoint;
  }
  if (!segmentCrossesLand(ship, target, sim.mapId, clearanceM)) {
    ship.navigationWaypoint = null;
    ship.navPlan = { goalX: target.x, goalY: target.y, plannedAt: sim.time, blocked: false };
    return target;
  }
  if (ship.navigationWaypoint) {
    const detourStillUsable = isWaterPoint(ship.navigationWaypoint, sim.mapId, clearanceM)
      && !segmentCrossesLand(ship, ship.navigationWaypoint, sim.mapId, clearanceM);
    if (detourStillUsable) return ship.navigationWaypoint;
  }
  ship.navigationWaypoint = chooseWaterDetour(sim, ship, target);
  ship.navPlan = { goalX: target.x, goalY: target.y, plannedAt: sim.time, blocked: true };
  return strategicTarget(ship);
}

function applyWaterCollisionGuard(sim, ship, nextPosition) {
  const clearanceM = shipWaterClearanceM(ship);
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

export function moveShips(sim, dt) {
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    // Fixed ground emplacements never move; only keep their CIWS cycle ticking.
    if (ship.isFixed) {
      ship.speed = 0;
      ship.ciwsCooldown = Math.max(0, ship.ciwsCooldown - dt);
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
  for (const missile of sim._missilesByTarget?.get(ship.id) ?? sim.missiles) {
    if (!missile.alive || missile.side === ship.side || missile.targetId !== ship.id) continue;
    if (!incoming || (missile.timeToImpactEstimate ?? Infinity) < (incoming.timeToImpactEstimate ?? Infinity)) {
      incoming = missile;
    }
  }
  if (incoming) {
    ship.desiredSpeed = ship.maxSpeed;
    const threat = incoming;
    ship.waypoint = {
      x: ship.x + Math.cos(angleTo(threat, ship) + Math.PI / 2) * 8 * NM,
      y: ship.y + Math.sin(angleTo(threat, ship) + Math.PI / 2) * 8 * NM
    };
    return;
  }
  if (offensiveMissileCount(ship, false) <= 0) {
    const fallback = ship.side === SIDE.BLUE ? Math.PI : 0;
    const retreatBearing = nearestEnemy ? angleTo(nearestEnemy, ship) : fallback;
    ship.waypoint = {
      x: ship.x + Math.cos(retreatBearing) * 45 * NM,
      y: ship.y + Math.sin(retreatBearing) * 18 * NM
    };
    ship.desiredSpeed = Math.max(ship.cruiseSpeed ?? 0, ship.maxSpeed * 0.86);
    return;
  }
  // Non-guide units hold formation station on the OTC when not prosecuting a
  // close contact; the guide (and single-ship sides) patrol/advance normally.
  if (ship.station && !ship.isOTC) {
    const d = distance(ship, ship.station);
    ship.waypoint = { x: ship.station.x, y: ship.station.y };
    // Close the station briskly when out of position, ease off once on station.
    ship.desiredSpeed = d > 1.5 * NM
      ? clamp(16 * KNOT * SHIP_SPEED_MULTIPLIER + d / 60, 16 * KNOT, ship.maxSpeed)
      : ship.cruiseSpeed ?? 16 * KNOT * SHIP_SPEED_MULTIPLIER;
    if (!nearestEnemy) return;
  } else if (!nearestEnemy) {
    ship.desiredSpeed = ship.cruiseSpeed ?? 16 * KNOT * SHIP_SPEED_MULTIPLIER;
    if (!ship.waypoint) {
      const patrol = ship.side === SIDE.BLUE ? 1 : -1;
      ship.waypoint = { x: ship.x + patrol * 9 * NM, y: ship.y + sim.rng.range(-6, 6) * NM };
    }
    return;
  }
  const target = nearestEnemy;
  const rangeM = distance(ship, target);
  const standoffM = ship.doctrine.standoffNm * NM;
  if (rangeM < standoffM * 0.72) {
    const away = angleTo(target, ship);
    ship.waypoint = { x: ship.x + Math.cos(away) * 12 * NM, y: ship.y + Math.sin(away) * 12 * NM };
    ship.desiredSpeed = 25 * KNOT * SHIP_SPEED_MULTIPLIER;
  } else if (rangeM > standoffM * 1.25) {
    ship.waypoint = { x: target.x, y: target.y };
    ship.desiredSpeed = 24 * KNOT * SHIP_SPEED_MULTIPLIER;
  } else {
    ship.desiredSpeed = 18 * KNOT * SHIP_SPEED_MULTIPLIER;
  }
}
