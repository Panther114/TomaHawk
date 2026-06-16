// Per-unit motion: kinematic integration (turn/accel limits, station-keeping,
// retreat) and the per-ship movement decision derived from tracks and threats.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE, SCENARIO_MODE } from "./constants.js";
import { clamp, distance, angleTo, wrapAngle } from "./math.js";
import { offensiveMissileCount } from "./ships.js";

export function moveShips(sim, dt) {
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (ship.waypoint) {
      const d = distance(ship, ship.waypoint);
      if (d < 0.4 * NM) {
        ship.waypoint = null;
        ship.desiredSpeed = 10 * KNOT * SHIP_SPEED_MULTIPLIER;
      } else {
        const desiredHeading = angleTo(ship, ship.waypoint);
        // Use turnRateFlank at high speed (> 75% flank), cruise turnRate otherwise
        const speedFrac = ship.maxSpeed > 0 ? ship.speed / ship.maxSpeed : 0;
        const effectiveTurn = speedFrac > 0.75 && ship.turnRateFlank
          ? ship.turnRateFlank
          : ship.turnRate;
        const delta = clamp(wrapAngle(desiredHeading - ship.heading), -effectiveTurn * dt, effectiveTurn * dt);
        ship.heading = wrapAngle(ship.heading + delta);
      }
    }
    const accelLimit = (ship.desiredSpeed >= ship.speed ? ship.accel : (ship.decel ?? ship.accel)) * dt;
    const speedDelta = clamp(ship.desiredSpeed - ship.speed, -accelLimit, accelLimit);
    const degrade = ship.damageDegrade ?? 0.22;
    const propHealth = ship.subsystems?.propulsion ?? 1.0;
    ship.speed = clamp(ship.speed + speedDelta, 0, ship.maxSpeed * Math.max(0.10, propHealth - ship.damage * degrade));
    ship.x += Math.cos(ship.heading) * ship.speed * dt;
    ship.y += Math.sin(ship.heading) * ship.speed * dt;
    ship.x = clamp(ship.x, -sim.widthM / 2, sim.widthM / 2);
    ship.y = clamp(ship.y, -sim.heightM / 2, sim.heightM / 2);
    ship.ciwsCooldown = Math.max(0, ship.ciwsCooldown - dt);
  }
}

export function decideShip(sim, ship) {
  if (!ship.alive || sim.time < ship.nextDecision) return;
  ship.nextDecision = sim.time + 1;
  if (sim.mode !== SCENARIO_MODE.RUNNING) return;
  const enemyTracks = [...ship.tracks.values()].filter((t) => t.side !== ship.side && t.quality > 0.18);
  enemyTracks.sort((a, b) => distance(ship, a) - distance(ship, b));
  const incoming = sim.missiles
    .filter((m) => m.alive && m.side !== ship.side && m.targetId === ship.id)
    .sort((a, b) => (a.timeToImpactEstimate ?? Infinity) - (b.timeToImpactEstimate ?? Infinity));
  if (incoming.length) {
    ship.desiredSpeed = ship.maxSpeed;
    const threat = incoming[0];
    ship.waypoint = {
      x: ship.x + Math.cos(angleTo(threat, ship) + Math.PI / 2) * 8 * NM,
      y: ship.y + Math.sin(angleTo(threat, ship) + Math.PI / 2) * 8 * NM
    };
    return;
  }
  if (offensiveMissileCount(ship, false) <= 0) {
    const nearestEnemy = enemyTracks[0];
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
    if (!enemyTracks.length) return;
  } else if (!enemyTracks.length) {
    ship.desiredSpeed = ship.cruiseSpeed ?? 16 * KNOT * SHIP_SPEED_MULTIPLIER;
    if (!ship.waypoint) {
      const patrol = ship.side === SIDE.BLUE ? 1 : -1;
      ship.waypoint = { x: ship.x + patrol * 9 * NM, y: ship.y + sim.rng.range(-6, 6) * NM };
    }
    return;
  }
  const target = enemyTracks[0];
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
