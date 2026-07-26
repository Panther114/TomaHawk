import { KNOT, NM, SCENARIO_MODE, SIDE } from "./constants.js";
import { angleTo, clamp, distance } from "./math.js";
import { iterateTracksForShip } from "./sensors.js";

export function isSubmarine(unit) {
  return unit?.domain === "subsurface";
}

export function updateSubmarineDepth(ship, dt) {
  if (!isSubmarine(ship)) return;
  const target = clamp(ship.targetDepthM ?? 250, 20, ship.maxDepthM ?? 450);
  const rate = Math.max(0.5, ship.depthRateMps ?? 2.5);
  ship.depthM = clamp(
    (ship.depthM ?? 250) + clamp(target - (ship.depthM ?? 250), -rate * dt, rate * dt),
    20,
    ship.maxDepthM ?? 450
  );
}

export function decideSubmarine(sim, ship) {
  if (!ship.alive || sim.mode !== SCENARIO_MODE.RUNNING || sim.time < ship.nextDecision) return;
  ship.nextDecision = sim.time + 1;
  let nearest = null;
  let nearestRange = Infinity;
  for (const track of iterateTracksForShip(sim, ship)) {
    if (track.side === ship.side || track.quality < 0.2 || String(track.id).startsWith("M-")) continue;
    const rangeM = distance(ship, track);
    if (rangeM < nearestRange) {
      nearest = track;
      nearestRange = rangeM;
    }
  }
  const incoming = (sim._missilesByTarget?.get(ship.id) ?? sim.missiles)
    .find((missile) => missile.alive && missile.side !== ship.side && missile.targetId === ship.id);
  if (incoming) {
    ship.targetDepthM = Math.min(ship.maxDepthM ?? 450, 400);
    ship.desiredSpeed = ship.maxSpeed;
    const evade = angleTo(incoming, ship) + Math.PI / 2;
    ship.waypoint = {
      x: ship.x + Math.cos(evade) * 10 * NM,
      y: ship.y + Math.sin(evade) * 10 * NM
    };
    return;
  }
  ship.targetDepthM = 250;
  if (!nearest) {
    ship.desiredSpeed = Math.min(ship.cruiseSpeed, 8 * KNOT);
    if (!ship.waypoint) {
      const bearing = sim.fleetCommand?.get(ship.side)?.axis
        ?? (ship.side === SIDE.BLUE ? 0 : Math.PI);
      ship.waypoint = {
        x: ship.x + Math.cos(bearing) * 12 * NM,
        y: ship.y + Math.sin(bearing) * 12 * NM
      };
    }
    return;
  }
  const torpedoRangeM = 27 * NM;
  if (nearestRange > torpedoRangeM * 0.8) {
    ship.waypoint = { x: nearest.x, y: nearest.y };
    ship.desiredSpeed = Math.min(ship.cruiseSpeed, 10 * KNOT);
  } else if (nearestRange < 9 * NM) {
    const away = angleTo(nearest, ship);
    ship.waypoint = {
      x: ship.x + Math.cos(away) * 10 * NM,
      y: ship.y + Math.sin(away) * 10 * NM
    };
    ship.desiredSpeed = Math.min(ship.maxSpeed, 16 * KNOT);
  } else {
    ship.desiredSpeed = Math.min(ship.cruiseSpeed, 8 * KNOT);
  }
}
