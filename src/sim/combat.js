// Weapons and combat resolution: launch queueing/pacing, force-level defensive
// and offensive fire planning, missile flight and guidance, hit/intercept
// resolution, subsystem damage, and the terminal CIWS layer.

import { NM, SIDE, FLEET_ROLE, WEAPON_STATE } from "./constants.js";
import { clamp, distance, angleTo, wrapAngle, interceptPoint, entityVelocity } from "./math.js";
import { MISSILES, missileDisplayRole, missileCanTarget, missileHasSurfaceTarget, missileHasAirDefenseTarget } from "./missiles.js";
import { availableCount, setAvailableCount, defaultLoadout, defaultRoe } from "./ships.js";
import { addEvent } from "./events.js";
import { currentTrack, markContactDead } from "./sensors.js";
import { AIRCRAFT_TEMP_CONFIG, aliveAircraftCount } from "./aircraft.js";
import {
  forceTrack,
  inSector,
  computeFleetCommand,
  offensiveTargetValue,
  offensiveCommitWindowS,
  offensiveAllocationsPerCycle,
  coordinatedRaidDelayS
} from "./command.js";

// --- entity lookup helpers --------------------------------------------------
// Use the per-tick id indexes built in stepSim when present, falling back to a
// linear scan so functions called directly from tests (without a full tick)
// still behave. All return the same result as the original `.find`/`.filter`.

// When the per-tick missile-by-target index exists, an absent bucket means the
// ship has nothing inbound — iterate an empty list instead of falling back to a
// full O(missiles) scan. The scan fallback is only for callers without an index
// (e.g. direct unit tests). Shared frozen empty array avoids per-call allocation.
const NO_INCOMING = [];
function incomingMissilesFor(sim, shipId) {
  if (sim._missilesByTarget) return sim._missilesByTarget.get(shipId) ?? NO_INCOMING;
  return sim.missiles;
}

// --- missile spatial grid (saturation density) ------------------------------
// A pooled per-tick uniform grid bucketing live missiles by position. It lets
// the saturation models ask "how crowded is the airspace around this point" as a
// true LOCAL density (missiles from any raid), which is both more realistic than
// the old same-target-bucket proxy and bounded to a handful of nearby cells
// instead of a naive O(missiles) scan per query. Buckets are reused across ticks
// (only the previously-filled ones are cleared) to keep allocation — and GC
// pressure on low-RAM machines — low. Cell size ≈ the largest saturation radius.
const SAT_CELL_M = 8 * NM;
function buildMissileGrid(sim, missiles) {
  let grid = sim._missileGrid;
  if (!grid) grid = sim._missileGrid = { cells: new Map(), used: [] };
  for (const bucket of grid.used) bucket.length = 0;
  grid.used.length = 0;
  for (const m of missiles) {
    if (!m.alive) continue;
    const key = `${Math.floor(m.x / SAT_CELL_M)},${Math.floor(m.y / SAT_CELL_M)}`;
    let bucket = grid.cells.get(key);
    if (!bucket) { bucket = []; grid.cells.set(key, bucket); }
    if (bucket.length === 0) grid.used.push(bucket);
    bucket.push(m);
  }
  return grid;
}
// Count live missiles within `radiusM` of (x,y) that satisfy `match`. Scans only
// the cells overlapping the radius; the count is order-independent (deterministic).
function countNearbyMissiles(grid, x, y, radiusM, match) {
  if (!grid) return 0;
  const span = Math.ceil(radiusM / SAT_CELL_M);
  const cx = Math.floor(x / SAT_CELL_M);
  const cy = Math.floor(y / SAT_CELL_M);
  const r2 = radiusM * radiusM;
  let n = 0;
  for (let ix = cx - span; ix <= cx + span; ix++) {
    for (let iy = cy - span; iy <= cy + span; iy++) {
      const bucket = grid.cells.get(`${ix},${iy}`);
      if (!bucket) continue;
      for (const m of bucket) {
        const dx = m.x - x;
        const dy = m.y - y;
        if (dx * dx + dy * dy <= r2 && match(m)) n++;
      }
    }
  }
  return n;
}

// Effective relaunch interval for a launcher+weapon. A squadron has one shooter
// per surviving aircraft, so its volley cadence scales with the flight: a 4-ship
// flight relaunches a type ~4x faster than a lone survivor. Ships are unchanged
// (returns the raw spec interval), so the surface launch path is byte-identical.
function effectiveLaunchIntervalS(launcher, spec) {
  if (launcher.domain !== "air") return spec.launchIntervalS;
  return spec.launchIntervalS / Math.max(1, aliveAircraftCount(launcher));
}

// Sea-level sound speed used only for Mach-number kinematics (O(1), no tables).
const SOUND_MPS = 340;

function threatMissileSpec(threat) {
  return threat?.missileId ? MISSILES[threat.missileId] : null;
}

// High-energy / hypersonic threat: Mach 5+ or an explicit strategic / boost-glide
// profile (vanilla Dark Eagle and Unit Workshop LRHW-class ammo).
export function isHighEnergyThreat(threat) {
  if (!threat) return false;
  if ((threat.speed || 0) >= 5 * SOUND_MPS) return true;
  const spec = threatMissileSpec(threat);
  return !!(spec && (spec.terminalProfile === "hypersonic_glide" || spec.strategic === true));
}

/**
 * O(1) intercept difficulty of `threat` for a given interceptor (or CIWS).
 * Models the real drivers of hypersonic hardness without per-tick cost:
 *  - closing-speed engagement window (continuous Mach penalty)
 *  - boost-glide / strategic profile + altitude (high-energy trajectory)
 *  - layer suitability (point-defence ESSM/CIWS vs long-range high-energy SAMs)
 * Returns additive PK penalties and a tight floor/ceiling for high-energy shots.
 */
export function interceptDifficultyVsThreat(threat, interceptorSpec, { ciws = false } = {}) {
  const speed = Math.max(0, threat?.speed || 0);
  const mach = speed / SOUND_MPS;
  const tSpec = threatMissileSpec(threat);
  const hypoProfile = !!(tSpec && (tSpec.terminalProfile === "hypersonic_glide" || tSpec.strategic === true));
  const highEnergy = hypoProfile || mach >= 5;

  // Continuous kinematic penalty: window shrinks with Mach.
  // Balanced so SM-6 vs ~Mach 5 lands ~mid-20s–low-30s %, not coin-flip or coin-starve.
  // ~Mach 2 → 0.07, Mach 3 → 0.13, Mach 5 → ~0.24
  let speedPenalty = 0;
  if (mach > 1) {
    const over = mach - 1;
    const superOver = Math.max(0, mach - 2.5);
    speedPenalty = clamp(0.05 * over + 0.012 * superOver ** 1.4, 0, 0.42);
  }

  // Boost-glide / strategic profile: energy + manoeuvre abstraction; high
  // altitude mid-course further degrades medium-range terminal SAMs.
  let profilePenalty = 0;
  if (hypoProfile) {
    profilePenalty = 0.10;
    const alt = threat.altitudeM ?? tSpec.cruiseAltitudeM ?? 0;
    if (alt >= 12000) profilePenalty += 0.04;
    if (alt >= 22000) profilePenalty += 0.05;
  }

  // Layer match: short-range / gun systems lack the kinematics against high-energy
  // threats; long-reach high-speed interceptors (SM-6 class) are the least-bad option.
  // THAAD-class (hypersonicOnly / high_energy_only) is purpose-built for BM/LRHW.
  const thaadClass = !!(interceptorSpec
    && (interceptorSpec.hypersonicOnly === true || interceptorSpec.engageProfile === "high_energy_only"));
  let layerPenalty = 0;
  if (ciws) {
    if (highEnergy || mach >= 3.5) layerPenalty = 0.22;
    else if (mach >= 2) layerPenalty = 0.10;
  } else if (interceptorSpec && (highEnergy || mach >= 3.5)) {
    const iSpeed = interceptorSpec.speedMps || 0;
    const iRange = interceptorSpec.rangeM || 0;
    const speedRatio = iSpeed / Math.max(speed, 1);
    if (speedRatio < 0.65) layerPenalty += 0.10;
    else if (speedRatio < 0.85) layerPenalty += 0.05;
    else if (speedRatio < 1.05) layerPenalty += 0.02;
    if (iRange < 40 * NM) layerPenalty += 0.10;
    else if (iRange < 100 * NM) layerPenalty += 0.03;
    // High-end extended-range interceptor credit (SM-6-class).
    if (iRange >= 150 * NM && iSpeed >= 1100) layerPenalty = Math.max(0, layerPenalty - 0.10);
    // THAAD: hit-to-kill designed for high-altitude high-energy intercepts —
    // better kinematics than a dual-role fleet SAM against LRHW profiles.
    if (thaadClass) {
      // Wipe residual layer mismatch; BMD interceptors are the right layer.
      layerPenalty = 0;
      // Reduce profile/speed drag slightly (high-altitude geometry is their job).
      profilePenalty = Math.max(0, profilePenalty - 0.08);
      speedPenalty = Math.max(0, speedPenalty - 0.06);
    }
  }

  const total = speedPenalty + profilePenalty + layerPenalty;
  // Cap band: SM-6 vs LRHW ~25–38%; THAAD class higher (~40–58%) as a dedicated
  // high-altitude BMD layer. ESSM/CIWS stay clearly worse without being decorative.
  let pkFloor = 0.10;
  let pkCeil = 0.90;
  if (highEnergy || mach >= 5) {
    pkFloor = ciws ? 0.03 : (thaadClass ? 0.22 : 0.10);
    pkCeil = ciws ? 0.14
      : thaadClass ? 0.58
        : (interceptorSpec && interceptorSpec.rangeM >= 150 * NM && interceptorSpec.speedMps >= 1100)
          ? 0.38
          : 0.28;
  } else if (mach >= 3) {
    pkFloor = ciws ? 0.05 : 0.08;
    pkCeil = ciws ? 0.28 : 0.58;
  }

  return { speedPenalty, profilePenalty, layerPenalty, total, pkFloor, pkCeil, highEnergy };
}

/** Pure hit-chance for a SAM intercepting an in-flight threat. Hot path is O(1). */
export function missileInterceptHitChance(interceptorSpec, threat, {
  terminal = false,
  trackQuality = 0.75,
  trackAgeS = 0,
  concurrentThreats = 0
} = {}) {
  const diff = interceptDifficultyVsThreat(threat, interceptorSpec, { ciws: false });
  const seaSkimPenalty = threat?.seaSkimming ? 0.14 : 0;
  const saturationPenalty = Math.max(0, (concurrentThreats - 2) * 0.04);
  const trackPenalty = Math.max(0, 1 - trackQuality) * 0.18
    + Math.min(0.14, Math.max(0, trackAgeS - 2) * 0.02);
  return clamp(
    (interceptorSpec?.pk ?? 0.5) + (terminal ? 0.06 : 0)
      - diff.total - seaSkimPenalty - saturationPenalty - trackPenalty,
    diff.pkFloor,
    diff.pkCeil
  );
}

function aliveShipById(sim, id) {
  const s = sim._shipById ? sim._shipById.get(id) : sim.ships.find((x) => x.id === id);
  return s && s.alive ? s : undefined;
}

function shipById(sim, id) {
  return sim._shipById ? sim._shipById.get(id) : sim.ships.find((x) => x.id === id);
}

function aliveMissileById(sim, id) {
  const m = sim._missileById ? sim._missileById.get(id) : sim.missiles.find((x) => x.id === id);
  return m && m.alive ? m : undefined;
}

// Alive missiles whose target is `targetId`. The bucket already holds only
// alive missiles; valid during the fire-planning phase (no launches/kills occur
// between index build and planning).
function missilesTargeting(sim, targetId) {
  return sim._missilesByTarget?.get(targetId) ?? sim.missiles.filter((m) => m.alive && m.targetId === targetId);
}

function aliveShipsForSide(sim, side) {
  return sim._shipsBySide?.get(side) ?? sim.ships.filter((ship) => ship.alive && ship.side === side);
}

function canActAsShooter(ship) {
  if (ship.domain !== "ground") return true;
  return Object.entries(ship.loadout || {}).some(([id, count]) => count > 0 && MISSILES[id]);
}

function removeFromArray(list, item) {
  if (!list) return;
  const i = list.indexOf(item);
  if (i < 0) return;
  list[i] = list[list.length - 1];
  list.pop();
}

// Incremental index maintenance on death/launch. Avoids marking the whole
// entity-index set dirty (which forces a full Map rebuild next tick) for the
// common case of many missile kills in a saturated raid. Falls back to dirty
// when structures are missing (direct unit-test callers without a full tick).
function deactivateMissile(sim, missile) {
  if (!missile.alive) return;
  missile.alive = false;
  markContactDead(sim, missile.id);
  if (sim._aliveMissiles && sim._missilesByTarget) {
    removeFromArray(sim._aliveMissiles, missile);
    const bucket = sim._missilesByTarget.get(missile.targetId);
    if (bucket) {
      removeFromArray(bucket, missile);
      if (!bucket.length) sim._missilesByTarget.delete(missile.targetId);
    }
    // Leave dead entries in _missileById until compact so same-tick id lookups
    // still resolve; aliveMissileById already checks .alive.
  } else {
    sim._entityIndexesDirty = true;
  }
}

function deactivateShip(sim, ship) {
  if (!ship || !ship.alive) {
    if (ship) ship.alive = false;
    return;
  }
  ship.alive = false;
  markContactDead(sim, ship.id);
  if (sim._aliveShips && sim._shipsBySide) {
    removeFromArray(sim._aliveShips, ship);
    const bucket = sim._shipsBySide.get(ship.side);
    if (bucket) {
      removeFromArray(bucket, ship);
      if (!bucket.length) sim._shipsBySide.delete(ship.side);
    }
    if (sim._aliveSideCount && (ship.side === SIDE.BLUE || ship.side === SIDE.RED)) {
      sim._aliveSideCount[ship.side] = Math.max(0, (sim._aliveSideCount[ship.side] || 0) - 1);
    }
  } else {
    sim._entityIndexesDirty = true;
  }
}

function makeLaunchOrder(sim, launcher, track, missileId, sequence = 0) {
  const spec = MISSILES[missileId];
  if (!spec || availableCount(launcher, missileId) <= 0) return false;
  const rangeM = distance(launcher, track);
  if (rangeM > spec.rangeM) return false;
  const defensive = track.id?.startsWith?.("M-") && missileCanTarget(spec, "missile");
  const readyAt = track._readyAtOverride ?? (sim.time + sequence * spec.salvoSpacingS);
  const priority = track._priorityOverride ?? (defensive ? 0 : 50);
  launcher.launchQueue.push({
    missileId,
    targetId: track.id,
    targetSide: track.side,
    targetDomain: track.domain ?? "sea",
    targetClassification: track.classification,
    targetX: track.x,
    targetY: track.y,
    targetVx: track.vx ?? 0,
    targetVy: track.vy ?? 0,
    targetTrackQuality: track.quality ?? null,
    targetTrackAgeS: Math.max(
      track.age ?? 0,
      Number.isFinite(track.lastSeen) ? Math.max(0, sim.time - track.lastSeen) : 0
    ),
    requestedAt: sim.time,
    readyAt,
    launchSequence: sequence,
    defensive,
    priority
  });
  return true;
}

function defensiveChannelForWeapon(missileId) {
  const spec = MISSILES[missileId];
  return spec && missileCanTarget(spec, "missile") ? "sam" : null;
}

function usesDefensiveChannel(item) {
  if (!item) return false;
  if (item.defensive) return true;
  return String(item.targetId).startsWith("M-") && defensiveChannelForWeapon(item.missileId);
}

function channelCapacity(ship, channel) {
  if (channel === "sam" && !Number.isFinite(ship.defenseChannels?.sam)) {
    const area = ship.defenseChannels?.area ?? 0;
    const point = ship.defenseChannels?.point ?? 0;
    if (Number.isFinite(area) || Number.isFinite(point)) return (Number(area) || 0) + (Number(point) || 0);
  }
  const cap = ship.defenseChannels?.[channel];
  return Number.isFinite(cap) ? cap : Infinity;
}

function defensiveChannelUse(sim, ship, channel) {
  if (sim._engagementIndex) return sim._engagementIndex.channelUseByLauncher.get(ship.id)?.[channel] ?? 0;
  let used = 0;
  for (const missile of sim.missiles) {
    if (!missile.alive || missile.launcherId !== ship.id) continue;
    if (usesDefensiveChannel(missile) && defensiveChannelForWeapon(missile.missileId) === channel) used++;
  }
  for (const order of ship.launchQueue || []) {
    if (usesDefensiveChannel(order) && defensiveChannelForWeapon(order.missileId) === channel) used++;
  }
  return used;
}

function blockedDefensiveChannels(sim, ship) {
  const blocked = new Set();
  for (const channel of ["sam"]) {
    if (defensiveChannelUse(sim, ship, channel) >= channelCapacity(ship, channel)) blocked.add(channel);
  }
  return blocked;
}

function hasDefensiveChannel(sim, ship, missileId) {
  const channel = defensiveChannelForWeapon(missileId);
  return !channel || defensiveChannelUse(sim, ship, channel) < channelCapacity(ship, channel);
}

function queueSalvo(sim, launcher, track, missileId, count, options = {}) {
  launcher.launchQueue ||= [];
  let queued = 0;
  for (let i = 0; i < count; i++) {
    if (availableCount(launcher, missileId) - queued <= 0) break;
    if (makeLaunchOrder(sim, launcher, {
      ...track,
      _readyAtOverride: options.readyAtOverride,
      _priorityOverride: options.priorityOverride
    }, missileId, i)) {
      queued++;
      const order = launcher.launchQueue[launcher.launchQueue.length - 1];
      sim._engagementIndex?.recordQueued(launcher, order);
    }
  }
  if (queued > 0) addEvent(sim, `${launcher.name} queued ${queued}x ${MISSILES[missileId].shortLabel} salvo at ${track.classification}.`, launcher.side);
  return queued;
}

// An air-to-air shot needs the launching AIRCRAFT to be facing roughly toward
// the target (see the a2aLaunchConeDeg config comment in aircraft.js); ship
// and ground VLS launches fire in any direction, so this is a no-op for them.
function withinAirLaunchCone(launcher, targetX, targetY) {
  if (launcher.domain !== "air") return true;
  const coneRad = (AIRCRAFT_TEMP_CONFIG.a2aLaunchConeDeg * Math.PI) / 180;
  const bearing = angleTo(launcher, { x: targetX, y: targetY });
  return Math.abs(wrapAngle(bearing - launcher.heading)) <= coneRad;
}

function launchMissile(sim, launcher, order) {
  const spec = MISSILES[order.missileId];
  launcher.lastLaunchAtByMissile ||= {};
  if (!spec || availableCount(launcher, order.missileId) <= 0) return false;
  if (
    missileHasAirDefenseTarget(spec)
    && !withinAirLaunchCone(launcher, order.targetX, order.targetY)
  ) return false;
  const queueReadyAt = order.defensive ? (launcher.nextDefensiveLaunchAt || 0) : (launcher.nextLaunchAt || 0);
  if (sim.time < Math.max(order.readyAt, queueReadyAt)) return false;
  const lastTypeLaunch = launcher.lastLaunchAtByMissile[order.missileId] ?? -Infinity;
  if (sim.time - lastTypeLaunch < effectiveLaunchIntervalS(launcher, spec)) return false;
  setAvailableCount(launcher, order.missileId, availableCount(launcher, order.missileId) - 1);
  const lane = ((order.launchSequence ?? 0) % 5) - 2;
  const laneOffset = lane * 38;
  // Aim the launch on a collision/lead course using the commanded target
  // velocity rather than just its current position.
  const launchPos = {
    x: launcher.x + Math.cos(angleTo(launcher, { x: order.targetX, y: order.targetY }) + Math.PI / 2) * laneOffset,
    y: launcher.y + Math.sin(angleTo(launcher, { x: order.targetX, y: order.targetY }) + Math.PI / 2) * laneOffset
  };
  const lead = interceptPoint(
    launchPos.x, launchPos.y, spec.speedMps,
    order.targetX, order.targetY, order.targetVx ?? 0, order.targetVy ?? 0
  );
  const heading = Math.atan2(lead.y - launchPos.y, lead.x - launchPos.x);
  // Cruise altitude (m): anti-ship weapons sea-skim, air-defence/strike rounds
  // loft. AGM-154 (JSOW) is an air-to-GROUND glide weapon that reuses the
  // anti_ship pipeline for targeting only — mid-altitude glide, not sea-skim.
  const defaultCruiseAltM = order.missileId === "AGM-154"
    ? 4500
    : missileHasSurfaceTarget(spec) ? 30 : 7000;
  const cruiseAltitudeM = Number.isFinite(spec.cruiseAltitudeM) ? spec.cruiseAltitudeM : defaultCruiseAltM;
  // Air launches previously teleported to the cruise altitude on the launch
  // tick (Harpoon from 9 km → 30 m sea-skim instantly). Real weapons start at
  // the launch aircraft's altitude and descend toward their profile; ship/ground
  // VLS still loft to the weapon's cruise altitude as before.
  const isAirLaunch = launcher.domain === "air";
  const launchAltitudeM = isAirLaunch
    ? Math.max(0, launcher.altitudeM ?? cruiseAltitudeM)
    : cruiseAltitudeM;
  const missile = {
    id: `M-${sim.missiles.length + 1}-${Math.floor(sim.time * 10)}`,
    side: launcher.side,
    launcherId: launcher.id,
    targetId: order.targetId,
    missileId: order.missileId,
    launchRole: (String(order.targetId).startsWith("M-") || order.targetDomain === "air") ? "anti_air" : "anti_ship",
    x: launchPos.x,
    y: launchPos.y,
    heading: wrapAngle(heading + lane * 0.006),
    speed: spec.speedMps,
    maxRangeM: spec.rangeM,
    flownM: 0,
    targetX: order.targetX,
    targetY: order.targetY,
    aimX: lead.x,
    aimY: lead.y,
    phase: missileHasSurfaceTarget(spec) && order.targetDomain !== "air" && !String(order.targetId).startsWith("M-") ? "cruise" : "boost",
    altitudeM: launchAltitudeM,
    launchAltitudeM,
    cruiseAltitudeM,
    launchSpeedMps: spec.speedMps,
    terminalReason: null,
    seaSkimming: false,
    maneuvering: missileHasSurfaceTarget(spec),
    detectedBy: [],
    timeToImpactEstimate: null,
    terminal: false,
    alive: true,
    // Cooperative-guidance / command state.
    controllerSide: launcher.side,
    guidance: spec.guidance ?? "inertial_active",
    retargetable: spec.retargetable ?? false,
    targetLost: false,
    losRate: 0,
    losAngle: heading,
    defenseAttempts: {},
    trackQualityAtLaunch: order.targetTrackQuality,
    trackAgeAtLaunchS: order.targetTrackAgeS,
    launchSequence: order.launchSequence ?? 0,
    laneOffset
  };
  Object.defineProperty(missile, "_spec", { value: spec, writable: true, configurable: true });
  sim.missiles.push(missile);
  sim._missileById?.set(missile.id, missile);
  // Keep a separate alive list when present (must not alias sim.missiles while
  // updateMissiles may still be iterating that array).
  if (sim._aliveMissiles && sim._aliveMissiles !== sim.missiles) {
    sim._aliveMissiles.push(missile);
  } else if (!sim._aliveMissiles) {
    sim._entityIndexesDirty = true;
  }
  if (sim._missilesByTarget) {
    let bucket = sim._missilesByTarget.get(missile.targetId);
    if (!bucket) {
      bucket = [];
      sim._missilesByTarget.set(missile.targetId, bucket);
    }
    bucket.push(missile);
  }
  launcher.lastLaunchAtByMissile[order.missileId] = sim.time;
  if (order.defensive) {
    // Defensive VLS doctrine gets priority over strike salvo pacing. The
    // missile-specific interval above still prevents same-round overlap.
    launcher.nextDefensiveLaunchAt = sim.time + 0.45;
  } else {
    launcher.nextLaunchAt = sim.time + effectiveLaunchIntervalS(launcher, spec);
  }
  addEvent(sim, `${launcher.name} launched ${spec.shortLabel} at ${order.targetClassification}.`, launcher.side);
  return true;
}

export function processLaunchQueues(sim) {
  for (const ship of sim.ships) {
    if (!ship.alive || !ship.launchQueue?.length) continue;
    let selectedIndex = -1;
    for (let index = 0; index < ship.launchQueue.length; index++) {
      const order = ship.launchQueue[index];
      const spec = MISSILES[order.missileId];
      if (!spec || availableCount(ship, order.missileId) <= 0) continue;
      const queueReadyAt = order.defensive ? (ship.nextDefensiveLaunchAt || 0) : (ship.nextLaunchAt || 0);
      const lastTypeLaunch = ship.lastLaunchAtByMissile?.[order.missileId] ?? -Infinity;
      if (sim.time < Math.max(order.readyAt, queueReadyAt) || sim.time - lastTypeLaunch < effectiveLaunchIntervalS(ship, spec)) continue;
      if (selectedIndex < 0) {
        selectedIndex = index;
        continue;
      }
      const selected = ship.launchQueue[selectedIndex];
      const earlier = (order.priority ?? 50) - (selected.priority ?? 50)
        || order.readyAt - selected.readyAt
        || index - selectedIndex;
      if (earlier < 0) selectedIndex = index;
    }
    if (selectedIndex >= 0 && launchMissile(sim, ship, ship.launchQueue[selectedIndex])) {
      ship.launchQueue.splice(selectedIndex, 1);
    }
  }
}

function timeToImpact(missile, target) {
  if (!target || missile.speed <= 0) return Infinity;
  return distance(missile, target) / missile.speed;
}

function hasPendingOrActiveEngagement(sim, ship, targetId) {
  if (sim._engagementIndex) {
    return sim._engagementIndex.activeTargetsBySide.get(ship.side)?.has(targetId)
      || sim._engagementIndex.queuedTargetsByLauncher.get(ship.id)?.has(targetId);
  }
  return missilesTargeting(sim, targetId).some((m) => m.side === ship.side)
    || (ship.launchQueue || []).some((order) => order.targetId === targetId);
}

function shipThreatEngagementCount(sim, ship, targetId) {
  if (sim._engagementIndex) {
    return sim._engagementIndex.defensiveCountsByLauncher.get(ship.id)?.get(targetId) ?? 0;
  }
  const active = missilesTargeting(sim, targetId).filter((m) => (
    m.side === ship.side
    && m.launcherId === ship.id
    && usesDefensiveChannel(m)
  )).length;
  const queued = (ship.launchQueue || []).filter((order) => (
    order.targetId === targetId
    && usesDefensiveChannel(order)
  )).length;
  return active + queued;
}

function buildEngagementIndex(sim) {
  // Pool the top-level index structures across fire-planning cycles and clear
  // them in place rather than reallocating seven Maps every second. Each is
  // refilled in the same deterministic order, so a cleared+refilled Map iterates
  // identically to a fresh one — no behavioural change, just less GC churn. (The
  // small dynamic nested structures are still made fresh; pooling those is not
  // worth the bookkeeping risk.) The index is transient (nulled at the end of
  // planEngagements) so no stale data survives between cycles.
  const pool = sim._engPool ?? (sim._engPool = {
    countsBySide: new Map(),
    queuedByTarget: new Map(),
    activeTargetsBySide: new Map(),
    queuedTargetsByLauncher: new Map(),
    defensiveCountsByLauncher: new Map(),
    channelUseByLauncher: new Map(),
    solutionsByTarget: new Map(),
    bestLocalMissileTracks: new Map([[SIDE.BLUE, new Map()], [SIDE.RED, new Map()]])
  });
  const {
    countsBySide, queuedByTarget, activeTargetsBySide, queuedTargetsByLauncher,
    defensiveCountsByLauncher, channelUseByLauncher, solutionsByTarget, bestLocalMissileTracks
  } = pool;
  countsBySide.clear();
  queuedByTarget.clear();
  activeTargetsBySide.clear();
  queuedTargetsByLauncher.clear();
  defensiveCountsByLauncher.clear();
  channelUseByLauncher.clear();
  solutionsByTarget.clear();
  bestLocalMissileTracks.get(SIDE.BLUE).clear();
  bestLocalMissileTracks.get(SIDE.RED).clear();
  const increment = (side, targetId, missileId) => {
    let byTarget = countsBySide.get(side);
    if (!byTarget) {
      byTarget = new Map();
      countsBySide.set(side, byTarget);
    }
    let count = byTarget.get(targetId);
    if (!count) {
      count = { total: 0, byMissile: new Map() };
      byTarget.set(targetId, count);
    }
    count.total += 1;
    count.byMissile.set(missileId, (count.byMissile.get(missileId) ?? 0) + 1);
  };
  const incrementDefensiveLauncher = (launcherId, targetId) => {
    let counts = defensiveCountsByLauncher.get(launcherId);
    if (!counts) {
      counts = new Map();
      defensiveCountsByLauncher.set(launcherId, counts);
    }
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  };
  const incrementChannelUse = (launcherId, missileId) => {
    const channel = defensiveChannelForWeapon(missileId);
    if (!channel) return;
    let use = channelUseByLauncher.get(launcherId);
    if (!use) {
      use = { sam: 0 };
      channelUseByLauncher.set(launcherId, use);
    }
    use[channel] += 1;
  };
  const addSolution = (targetId, solution) => {
    const solutions = solutionsByTarget.get(targetId) ?? [];
    solutions.push(solution);
    solutionsByTarget.set(targetId, solutions);
  };
  for (const missile of sim._aliveMissiles ?? sim.missiles) {
    if (!missile.alive) continue;
    increment(missile.side, missile.targetId, missile.missileId);
    let activeTargets = activeTargetsBySide.get(missile.side);
    if (!activeTargets) {
      activeTargets = new Set();
      activeTargetsBySide.set(missile.side, activeTargets);
    }
    activeTargets.add(missile.targetId);
    if (usesDefensiveChannel(missile)) {
      incrementDefensiveLauncher(missile.launcherId, missile.targetId);
      incrementChannelUse(missile.launcherId, missile.missileId);
      const threat = aliveMissileById(sim, missile.targetId);
      if (threat) addSolution(missile.targetId, {
        side: missile.side,
        launcherId: missile.launcherId,
        weaponId: missile.missileId,
        etaS: timeToImpact(missile, threat),
        active: true
      });
    }
  }
  const recordQueued = (ship, order) => {
    increment(ship.side, order.targetId, order.missileId);
    let targets = queuedTargetsByLauncher.get(ship.id);
    if (!targets) {
      targets = new Set();
      queuedTargetsByLauncher.set(ship.id, targets);
    }
    targets.add(order.targetId);
    const spec = MISSILES[order.missileId];
    if (usesDefensiveChannel(order)) {
      incrementDefensiveLauncher(ship.id, order.targetId);
      incrementChannelUse(ship.id, order.missileId);
    }
    const queued = queuedByTarget.get(order.targetId) ?? [];
    queued.push({ ship, order });
    queuedByTarget.set(order.targetId, queued);
    const threat = aliveMissileById(sim, order.targetId);
    if (threat && spec && missileCanTarget(spec, "missile")) {
      const queueGate = Math.max(
        order.readyAt ?? sim.time,
        ship.nextDefensiveLaunchAt || 0,
        (ship.lastLaunchAtByMissile?.[order.missileId] ?? -Infinity) + spec.launchIntervalS
      );
      addSolution(order.targetId, {
        side: ship.side,
        launcherId: ship.id,
        weaponId: order.missileId,
        etaS: Math.max(0, queueGate - sim.time) + estimateInterceptTimeS(ship, threat, order.missileId),
        active: false
      });
    }
  };
  // Best local missile tracks: probe only live hostile missiles rather than
  // scanning every track on every ship (O(ships × tracks) → O(ships × live
  // missiles held). Same winner: highest quality, then freshest lastSeen.
  const liveMissiles = sim._aliveMissiles ?? sim.missiles;
  const sideShips = sim._shipsBySide;
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const ships = sideShips?.get(side) ?? sim.ships.filter((s) => s.alive && s.side === side);
    const byId = bestLocalMissileTracks.get(side);
    for (const missile of liveMissiles) {
      if (!missile.alive || missile.side === side) continue;
      let best = null;
      for (const ship of ships) {
        const raw = ship.tracks.get(missile.id);
        if (!raw) continue;
        const track = currentTrack(raw, sim.time);
        if (!best || track.quality > best.quality || track.lastSeen > best.lastSeen) best = track;
      }
      if (best) byId.set(missile.id, best);
    }
  }
  for (const ship of sim._aliveShips ?? sim.ships) {
    if (!ship.alive) continue;
    for (const order of ship.launchQueue || []) recordQueued(ship, order);
  }
  return {
    countsBySide,
    queuedByTarget,
    activeTargetsBySide,
    queuedTargetsByLauncher,
    defensiveCountsByLauncher,
    channelUseByLauncher,
    solutionsByTarget,
    bestLocalMissileTracks,
    recordQueued,
    increment
  };
}

function countSideWeaponsOnTarget(sim, side, targetId, missileId = null) {
  if (sim._engagementIndex) {
    const count = sim._engagementIndex.countsBySide.get(side)?.get(targetId);
    return missileId ? (count?.byMissile.get(missileId) ?? 0) : (count?.total ?? 0);
  }
  const active = missilesTargeting(sim, targetId).filter((m) => (
    m.side === side
    && (!missileId || m.missileId === missileId)
  )).length;
  const queued = sim.ships
    .filter((ship) => ship.alive && ship.side === side)
    .flatMap((ship) => ship.launchQueue || [])
    .filter((order) => order.targetId === targetId && (!missileId || order.missileId === missileId))
    .length;
  return active + queued;
}

function threatTimeToImpact(missile, target) {
  return target ? distance(missile, target) / Math.max(1, missile.speed) : Infinity;
}

function inboundRaidCount(sim, ship) {
  // The inbound raid on a ship is constant for the whole fire-planning cycle
  // (missiles in flight don't change while planning), yet it is queried once per
  // threat — so memoize it per cycle to avoid re-counting the same bucket O(raid)
  // times (the dominant quadratic cost in a saturated defence). Deterministic:
  // the cached value equals a fresh count.
  const cache = sim._raidCountCache;
  if (cache) {
    const cached = cache.get(ship.id);
    if (cached !== undefined) return cached;
  }
  let count = 0;
  const inbound = sim._missilesByTarget?.get(ship.id)
    ?? sim.missiles.filter((missile) => missile.targetId === ship.id);
  for (const missile of inbound) {
    if (missile.alive && missile.side !== ship.side) count++;
  }
  cache?.set(ship.id, count);
  return count;
}

function assignedInterceptorsForThreat(sim, side, missileId) {
  return countSideWeaponsOnTarget(sim, side, missileId, "SM-2MR")
    + countSideWeaponsOnTarget(sim, side, missileId, "SM-6")
    + countSideWeaponsOnTarget(sim, side, missileId, "ESSM");
}

function estimateInterceptTimeS(origin, threat, weaponId) {
  const spec = MISSILES[weaponId];
  if (!spec || spec.speedMps <= 0) return Infinity;
  const threatVelocity = entityVelocity(threat);
  const lead = interceptPoint(
    origin.x,
    origin.y,
    spec.speedMps,
    threat.x,
    threat.y,
    threatVelocity.vx,
    threatVelocity.vy
  );
  const solveTime = Number.isFinite(lead.t) && lead.t > 0 ? lead.t : distance(origin, threat) / spec.speedMps;
  return Math.max(0, solveTime);
}

function plannedInterceptorSolutions(sim, side, missile) {
  if (sim._engagementIndex) {
    return (sim._engagementIndex.solutionsByTarget.get(missile.id) ?? []).filter((solution) => solution.side === side);
  }
  const solutions = [];
  for (const interceptor of missilesTargeting(sim, missile.id)) {
    if (interceptor.side !== side) continue;
    const spec = MISSILES[interceptor.missileId];
    if (!spec || !missileCanTarget(spec, "missile")) continue;
    solutions.push({
      launcherId: interceptor.launcherId,
      weaponId: interceptor.missileId,
      etaS: timeToImpact(interceptor, missile),
      active: true
    });
  }
  const queuedOrders = sim._engagementIndex?.queuedByTarget.get(missile.id)
    ?? sim.ships.flatMap((ship) => (ship.launchQueue || []).map((order) => ({ ship, order })));
  for (const { ship, order } of queuedOrders) {
      if (!ship.alive || ship.side !== side || order.targetId !== missile.id) continue;
      const spec = MISSILES[order.missileId];
      if (!spec || !missileCanTarget(spec, "missile")) continue;
      const queueGate = Math.max(
        order.readyAt ?? sim.time,
        ship.nextDefensiveLaunchAt || 0,
        (ship.lastLaunchAtByMissile?.[order.missileId] ?? -Infinity) + spec.launchIntervalS
      );
      const releaseDelay = Math.max(0, queueGate - sim.time);
      solutions.push({
        launcherId: ship.id,
        weaponId: order.missileId,
        etaS: releaseDelay + estimateInterceptTimeS(ship, missile, order.missileId),
        active: false
      });
  }
  return solutions;
}

function threatRemainingHits(target) {
  if (!target) return 1;
  return Math.max(0, Math.ceil(target.damageResist ?? 1) - Math.round(target.damage ?? 0));
}

function defensiveNeedProfile(sim, side, missile, track, target) {
  const tti = threatTimeToImpact(missile, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  const lethalMargin = threatRemainingHits(target) <= 1;
  const solutions = plannedInterceptorSolutions(sim, side, missile);
  const viableSolutions = solutions.filter((solution) => solution.etaS <= tti - 1.5);
  let earliestEta = Infinity;
  for (const solution of viableSolutions) earliestEta = Math.min(earliestEta, solution.etaS);
  const firstSolutionLate = solutions.length > 0 && earliestEta >= tti - 1.5;
  const late = tti < 35;
  const veryLate = tti < 22;
  let desired = 1;
  const highEnergy = isHighEnergyThreat(missile);
  if (missile.terminal || track.quality < 0.42 || lethalMargin || firstSolutionLate || raidCount >= 2) desired = 2;
  if (viableSolutions.length < 1 && late) desired = Math.max(desired, 2);
  if (viableSolutions.length < 2 && (missile.terminal || lethalMargin || late || raidCount >= 2)) desired = Math.max(desired, 2);
  if ((missile.terminal || tti < 28) && (raidCount >= 3 || (lethalMargin && tti < 24))) desired = Math.max(desired, 3);
  // Hypersonic / strategic threats need multi-shot doctrine: single-shot PK is
  // low, so the planner must commit depth early rather than hoping one ESSM works.
  if (highEnergy) desired = Math.max(desired, 3);
  return {
    tti,
    raidCount,
    lethalMargin,
    solutions,
    viableSolutions,
    earliestEta,
    desired,
    needPromptShot: firstSolutionLate || highEnergy,
    needShootShoot: viableSolutions.length < 2 && (missile.terminal || lethalMargin || tti < 35 || raidCount >= 2 || highEnergy),
    // Never prefer ESSM as the "cheap" layer against high-energy threats.
    preferCheapLayer: range => !highEnergy
      && range <= MISSILES.ESSM.rangeM
      && (missile.terminal || tti < 40 || lethalMargin || raidCount >= 2)
  };
}

function chooseAntiShipWeapon(ship, track, allowReserve = false, aggression = 0.5) {
  const rangeM = distance(ship, track);
  const hull = ship.hull || "DDG";
  const baseLoad = defaultLoadout(hull);
  // Candidates are every anti-ship-capable weapon actually in the magazine
  // (vanilla or modded) — a fixed name list would ignore custom missiles. For a
  // vanilla hull this yields the same [SM-6, MaritimeStrike, TomahawkBlockV] set
  // in the same order, so existing behaviour and determinism are unchanged.
  const candidates = Object.keys(ship.loadout).filter((id) => {
    const spec = MISSILES[id];
    if (!spec) return false;
    const antiShipCapable = missileCanTarget(spec, track.domain ?? "sea");
    if (!antiShipCapable) return false;
    const dualRole = missileCanTarget(spec, "missile") && missileHasSurfaceTarget(spec);
    const reserve = allowReserve ? 0 : dualRole ? Math.ceil((baseLoad[id] ?? ship.loadout[id]) * (spec.magazineReserveRatio || 0)) : 0;
    if (!ship.loadout[id] || ship.loadout[id] <= reserve) return false;
    if (rangeM > spec.rangeM) return false;
    // Dual-role (e.g. SM-6): conserve for area air defence unless plentiful.
    if (dualRole && !allowReserve && ship.loadout[id] < (aggression > 0.72 ? 6 : 10)) return false;
    return true;
  });
  if (!candidates.length) return null;
  // Prefer a DEDICATED anti-ship weapon over a dual-role round so the fleet's
  // SM-6 (its precious area air-defence missile) is conserved for the air battle
  // instead of being burned as the primary strike weapon — then by range fit,
  // then by reach. (For a vanilla hull whose only in-range anti-ship option is a
  // dedicated weapon this is unchanged; it only changes the SM-6-vs-strike tie.)
  const dual = (id) => (missileCanTarget(MISSILES[id], "missile") && missileHasSurfaceTarget(MISSILES[id]) ? 1 : 0);
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateRangeFit = rangeM <= MISSILES[candidate].preferredMaxRangeM ? 0 : 1;
    const bestRangeFit = rangeM <= MISSILES[best].preferredMaxRangeM ? 0 : 1;
    const comparison = dual(candidate) - dual(best)
      || candidateRangeFit - bestRangeFit
      || MISSILES[candidate].rangeM - MISSILES[best].rangeM;
    if (comparison < 0) best = candidate;
  }
  return best;
}

// Pick a weapon to engage an enemy aircraft *platform* (not an in-flight
// missile). Candidates are anti-air-capable rounds actually in the magazine
// (ship_sam, air_to_air, or dual_role), keeping a defensive reserve unless
// authorised to commit it. Mirrors chooseAntiShipWeapon's longest-reach-fit
// selection. Serves both ships and aircraft shooters; which of these
// category weapons a given launcher can actually carry is enforced upstream
// by the Unit Workshop's platform gate (see missileAllowedForDomain), not here.
function chooseAntiAirWeapon(ship, track, allowReserve = false, aggression = 0.5) {
  const rangeM = distance(ship, track);
  const hull = ship.hull || "DDG";
  const baseLoad = defaultLoadout(hull);
  const candidates = Object.keys(ship.loadout).filter((id) => {
    const spec = MISSILES[id];
    if (!spec) return false;
    const antiAirCapable = missileCanTarget(spec, "air");
    if (!antiAirCapable) return false;
    if (rangeM > spec.rangeM) return false;
    const reserve = allowReserve ? 0 : Math.ceil((baseLoad[id] ?? ship.loadout[id]) * (spec.magazineReserveRatio || 0));
    if (!ship.loadout[id] || ship.loadout[id] <= reserve) return false;
    return true;
  });
  if (!candidates.length) return null;
  // Prefer a high-percentage no-escape-zone shot (target inside this weapon's NEZ)
  // — e.g. close in for a Sidewinder kill rather than lob a max-range AMRAAM —
  // then by preferred-range fit, then by reach.
  const inNez = (id) => (rangeM <= MISSILES[id].rangeM * (MISSILES[id].nezFraction ?? 0.5) ? 0 : 1);
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateFit = rangeM <= MISSILES[candidate].preferredMaxRangeM ? 0 : 1;
    const bestFit = rangeM <= MISSILES[best].preferredMaxRangeM ? 0 : 1;
    const comparison = inNez(candidate) - inNez(best)
      || candidateFit - bestFit
      || MISSILES[candidate].rangeM - MISSILES[best].rangeM;
    if (comparison < 0) best = candidate;
  }
  return best;
}

// Aircraft hard-kill of an inbound anti-ship missile (outer air battle). Kept
// deliberately conservative so a flight does not strip its air-to-air load to
// chase cruise missiles: only the long-range RADAR AAM is used (IR seekers do
// poorly against a cold sea-skimmer), only against ASCMs, and only while a heavy
// reserve of that round remains for the dogfight. Returns null otherwise.
function chooseAirInterceptWeapon(ship, threat) {
  if (!missileHasSurfaceTarget(MISSILES[threat.missileId])) return null;
  // Do not waste AAMs on hypersonic / strategic boost-glide threats (Dark Eagle
  // class). Real fighters do not employ AMRAAMs against LRHW profiles; ship
  // SAMs (SM-6) own that problem. Verified in long battle logs: F-22s emptied
  // magazines at DarkEagle tracks with zero realistic PK.
  if (isHighEnergyThreat(threat)) return null;
  const rangeM = distance(ship, threat);
  const baseLoad = defaultLoadout(ship.hull || "F15C");
  let best = null;
  for (const id in ship.loadout) {
    const spec = MISSILES[id];
    if (!spec) continue;
    if (!missileHasAirDefenseTarget(spec)) continue;
    if (spec.guidance === "infrared") continue; // WVR IR poor vs sea-skimmer; save for A2A
    if (rangeM > spec.rangeM) continue;
    const reserve = Math.ceil((baseLoad[id] ?? ship.loadout[id]) * 0.7); // keep 70% for air-to-air
    if (ship.loadout[id] <= reserve) continue;
    if (!best || spec.rangeM > MISSILES[best].rangeM) best = id;
  }
  return best;
}

/** True for THAAD-class interceptors: only high-energy / hypersonic threats. */
export function isHypersonicOnlyInterceptor(spec) {
  return !!(spec && (spec.hypersonicOnly === true || spec.engageProfile === "high_energy_only"));
}

// Best specialized BMD interceptor (THAAD etc.) still aboard and in range.
// Returns null for cruise/aircraft threats so THAAD magazines are never wasted.
function chooseHypersonicOnlyWeapon(ship, threat, rangeM, samOpen) {
  if (!samOpen || !isHighEnergyThreat(threat)) return null;
  const hull = ship.hull || "DDG";
  const baseLoad = defaultLoadout(hull);
  let best = null;
  const lo = ship.loadout;
  if (!lo) return null;
  for (const id of Object.keys(lo)) {
    const n = lo[id];
    if (!(n > 0)) continue;
    const spec = MISSILES[id];
    if (!spec || !isHypersonicOnlyInterceptor(spec)) continue;
    if (!missileCanTarget(spec, "missile")) continue;
    if (rangeM > spec.rangeM) continue;
    // Hypersonic raids always release from reserve — survival layer (do not
    // apply magazineReserveRatio for dedicated BMD interceptors).
    if (!best || spec.rangeM > MISSILES[best].rangeM || spec.speedMps > (MISSILES[best].speedMps || 0)) {
      best = id;
    }
  }
  return best;
}

export function chooseDefensiveWeapon(sim, ship, threat, options = {}) {
  const target = aliveShipById(sim, threat.targetId);
  const rangeM = distance(ship, threat);
  const tti = threatTimeToImpact(threat, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  const sm2 = MISSILES["SM-2MR"];
  const sm6 = MISSILES["SM-6"];
  const essm = MISSILES.ESSM;
  const hull = ship.hull || "DDG";
  const baseLoad = defaultLoadout(hull);
  const sm2Reserve = Math.ceil((baseLoad["SM-2MR"] ?? 0) * (sm2?.magazineReserveRatio || 0));
  const sm6Reserve = Math.ceil((baseLoad["SM-6"] ?? 0) * (sm6?.magazineReserveRatio || 0));
  const essmReserve = Math.ceil((baseLoad.ESSM ?? 0) * (essm?.magazineReserveRatio || 0));
  const sm2Count = availableCount(ship, "SM-2MR");
  const sm6Count = availableCount(ship, "SM-6");
  const essmCount = availableCount(ship, "ESSM");
  const blockedChannels = options.blockedChannels ?? new Set();
  const samOpen = !blockedChannels.has("sam");
  const highEnergy = isHighEnergyThreat(threat);
  // THAAD / BMD layer first for hypersonic threats (better PK, purpose-built).
  const specialized = chooseHypersonicOnlyWeapon(ship, threat, rangeM, samOpen);
  if (specialized) return specialized;
  // Batteries that only carry hypersonic-only interceptors never engage cruise
  // missiles or aircraft (realistic THAAD employment).
  const hasOnlyHypersonicSams = (() => {
    const lo = ship.loadout;
    if (!lo) return false;
    let anySam = false;
    for (const id of Object.keys(lo)) {
      if (!(lo[id] > 0)) continue;
      const spec = MISSILES[id];
      if (!spec || !missileCanTarget(spec, "missile")) continue;
      anySam = true;
      if (!isHypersonicOnlyInterceptor(spec)) return false;
    }
    return anySam;
  })();
  if (hasOnlyHypersonicSams && !highEnergy) return null;

  const survivalRisk = threat.terminal || tti < 35 || raidCount >= ship.defenseDoctrine.saturationThreshold || highEnergy;
  const sm2Available = samOpen && sm2 && (survivalRisk ? sm2Count > 0 : sm2Count > sm2Reserve) && rangeM <= sm2.rangeM;
  const sm6Available = samOpen && sm6 && (survivalRisk ? sm6Count > 0 : sm6Count > sm6Reserve) && rangeM <= sm6.rangeM;
  const essmAvailable = samOpen && essm && (survivalRisk ? essmCount > 0 : essmCount > essmReserve) && rangeM <= essm.rangeM;
  const cheapFollowupPreferred = options.preferCheapFollowup === true && !highEnergy;
  const urgent = options.urgent === true;
  // High-energy / hypersonic: commit the longest-reach high-energy interceptor
  // first (SM-6 class). ESSM is a last resort, not a preferred cheap layer.
  if (highEnergy) {
    if (sm6Available) return "SM-6";
    if (sm2Available) return "SM-2MR";
    if (essmAvailable) return "ESSM";
    if (samOpen && sm6Count > 0 && sm6 && rangeM <= sm6.rangeM) return "SM-6";
    if (samOpen && sm2Count > 0 && sm2 && rangeM <= sm2.rangeM) return "SM-2MR";
    if (samOpen && essmCount > 0 && essm && rangeM <= essm.rangeM) return "ESSM";
    return null;
  }
  if (cheapFollowupPreferred && essmAvailable) return "ESSM";
  if (urgent && essmAvailable && rangeM <= essm.rangeM) return "ESSM";
  if (sm6Available && rangeM > sm2.rangeM * 0.96) return "SM-6";
  if (essmAvailable && rangeM <= essm.preferredMaxRangeM * 0.95 && (tti < 55 || raidCount >= ship.defenseDoctrine.saturationThreshold)) return "ESSM";
  if (sm2Available && (rangeM > essm.preferredMaxRangeM * 0.85 || (tti > ship.defenseDoctrine.sm2EarlyTtiS && rangeM > 18 * NM) || raidCount >= 3)) return "SM-2MR";
  if (sm6Available && survivalRisk && (!sm2Available || raidCount >= ship.defenseDoctrine.saturationThreshold + 2)) return "SM-6";
  if (essmAvailable && rangeM <= essm.rangeM && (!survivalRisk || essmCount > 4)) return "ESSM";
  if (sm2Available) return "SM-2MR";
  if (sm6Available) return "SM-6";
  if (essmAvailable) return "ESSM";
  if (samOpen && essmCount > 0 && essm && rangeM <= essm.rangeM) return "ESSM";
  if (samOpen && sm2Count > 0 && sm2 && rangeM <= sm2.rangeM) return "SM-2MR";
  if (samOpen && sm6Count > 0 && sm6 && rangeM <= sm6.rangeM) return "SM-6";
  return null;
}

function missileThreatScore(sim, missile) {
  const target = aliveShipById(sim, missile.targetId);
  const tti = threatTimeToImpact(missile, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  // Hypersonic / strategic threats outrank routine ASCMs so the AAW plan
  // commits SM-6 depth early (single-shot PK is low; shoot-shoot-look matters).
  const highEnergyBonus = isHighEnergyThreat(missile) ? 55 : 0;
  return (missile.terminal ? 80 : 0) + clamp(90 - tti, 0, 90) + raidCount * 14
    + (target?.damage || 0) * 12 + highEnergyBonus;
}

function bestMissileTrackForSide(sim, side, missileId) {
  let best = forceTrack(sim, side, missileId) ?? null;
  const indexed = sim._engagementIndex?.bestLocalMissileTracks.get(side)?.get(missileId);
  if (indexed && (!best || indexed.quality > best.quality || indexed.lastSeen > (best.lastSeen ?? 0))) return indexed;
  if (sim._engagementIndex) return best;
  for (const ship of sim.ships) {
    if (!ship.alive || ship.side !== side) continue;
    const local = ship.tracks.get(missileId);
    if (!local) continue;
    if (!best || (local.quality ?? 0) > (best.quality ?? 0) || (local.lastSeen ?? 0) > (best.lastSeen ?? 0)) {
      best = local;
    }
  }
  return best;
}

// Same ranking as the historical [...shooters].sort(...): sector ownership and
// being the threatened ship pull a unit forward, then nearest wins.
function defenderPriorityKey(defender, track, targetId) {
  const sector = inSector(defender, track) ? -40 * NM : 0;
  const targetBonus = defender.id === targetId ? -8 * NM : 0;
  return distance(defender, track) + sector + targetBonus;
}

// Cap how many defenders are walked after ranking. Nearer/sector ships fill
// desired shots first; far-edge hulls almost never get an assignment once the
// local group is saturated. Small sides (≤ cap) keep full historical coverage.
const DEFENDER_WALK_CAP = 12;

function orderedDefendersForThreat(defensiveShooters, track, target, scratch) {
  const targetId = target?.id;
  const n = defensiveShooters.length;
  const keys = scratch.keys;
  const order = scratch.orderIdx;
  keys.length = n;
  order.length = n;
  for (let i = 0; i < n; i++) {
    keys[i] = defenderPriorityKey(defensiveShooters[i], track, targetId);
    order[i] = i;
  }
  order.sort((ia, ib) => keys[ia] - keys[ib] || ia - ib);
  const out = scratch.ordered;
  out.length = 0;
  const limit = Math.min(n, DEFENDER_WALK_CAP);
  for (let i = 0; i < limit; i++) out.push(defensiveShooters[order[i]]);
  return out;
}

function planDefensiveFires(sim) {
  const scratch = sim._defPlanScratch ?? (sim._defPlanScratch = {
    keys: [],
    orderIdx: [],
    rest: [],
    ordered: [],
    threats: []
  });
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const sideShips = aliveShipsForSide(sim, side);
    // Build shooter list without intermediate filter allocation when possible.
    const defensiveShooters = [];
    let formationMax = 1;
    for (const ship of sideShips) {
      if (!canActAsShooter(ship)) continue;
      defensiveShooters.push(ship);
      const cap = ship.defenseDoctrine?.maxAssignedInterceptors ?? 2;
      if (cap > formationMax) formationMax = cap;
    }
    if (!defensiveShooters.length) continue;

    const threats = scratch.threats;
    threats.length = 0;
    const liveMissiles = sim._aliveMissiles || sim.missiles;
    for (const missile of liveMissiles) {
      if (!missile.alive || missile.side === side) continue;
      const target = aliveShipById(sim, missile.targetId);
      if (!target || target.side !== side) continue;
      const track = bestMissileTrackForSide(sim, side, missile.id);
      if (!track) continue;
      threats.push({
        missile,
        track,
        target,
        score: missileThreatScore(sim, missile)
      });
    }
    threats.sort((a, b) => b.score - a.score);

    for (let ti = 0; ti < threats.length; ti++) {
      const { missile, track, target, score } = threats[ti];
      const need = defensiveNeedProfile(sim, side, missile, track, target);
      const desired = Math.max(1, Math.min(formationMax + 1, Math.max(
        need.desired,
        (score > 105 && need.tti < 35) || missile.terminal || track.quality < 0.42 ? 2 : 1
      )));
      let assigned = assignedInterceptorsForThreat(sim, side, missile.id);
      if (assigned >= desired) continue;
      // Defender priority: same sector/target/nearest ranking as before, walked
      // in that order until the desired interceptor count is filled.
      const defenders = orderedDefendersForThreat(defensiveShooters, track, target, scratch);
      const threatVel = entityVelocity(missile);
      for (const defender of defenders) {
        if (assigned >= desired) break;
        if (sim.time < (defender.defenseReactionAvailableAt || 0)) continue;
        const defenderAssigned = shipThreatEngagementCount(sim, defender, missile.id);
        const defenderShotCap = need.needShootShoot ? 2 : 1;
        if (defenderAssigned >= defenderShotCap) continue;
        if (!need.needShootShoot && !need.needPromptShot && hasPendingOrActiveEngagement(sim, defender, missile.id)) continue;
        // Aircraft defend the fleet with AAMs (conservatively); ships use their
        // layered SAM doctrine. Branching keeps the surface path byte-identical.
        const weapon = defender.domain === "air"
          ? chooseAirInterceptWeapon(defender, missile)
          : chooseDefensiveWeapon(sim, defender, missile, {
              urgent: need.needPromptShot,
              preferCheapFollowup: defenderAssigned > 0 && need.preferCheapLayer(distance(defender, missile)),
              blockedChannels: blockedDefensiveChannels(sim, defender)
            });
        if (!weapon) continue;
        if (!hasDefensiveChannel(sim, defender, weapon)) continue;
        const threatTrack = {
          id: missile.id,
          side: missile.side,
          classification: missile.missileId,
          x: track.x,
          y: track.y,
          vx: track.vx ?? threatVel.vx,
          vy: track.vy ?? threatVel.vy,
          quality: track.quality ?? (missile.terminal ? 0.9 : 0.7),
          age: track.age,
          lastSeen: track.lastSeen
        };
        const queued = queueSalvo(sim, defender, threatTrack, weapon, 1);
        if (queued) {
          missile.assignedDefenders ||= [];
          missile.assignedDefenders.push(defender.id);
          missile.threatScore = score;
          assigned += queued;
        }
      }
    }
  }
}

// Firing track for a shooter against a target. Prefers the unit's own sensor
// track, but falls back to the cooperative force (CEC) track so a ship can
// engage on a picture built by another unit's radar (engage-on-remote).
function bestTrackForShip(sim, ship, target) {
  const roe = ship.roe ?? defaultRoe();
  if (roe.weaponState === WEAPON_STATE.HOLD) return null;
  const idThreshold = Math.max(ship.offenseDoctrine.minimumTrackQuality, roe.identifyThreshold ?? 0);
  const own = currentTrack(ship.tracks.get(target.id), sim.time);
  const remote = forceTrack(sim, ship.side, target.id);
  let track = null;
  if (own && own.side !== ship.side && own.quality >= idThreshold) track = own;
  if (remote && (!track || remote.quality > track.quality)) track = remote;
  if (!track) return null;
  // TIGHT weapon-control posture demands a firmer ID and a closer commit range.
  if (roe.weaponState === WEAPON_STATE.TIGHT) {
    if (track.quality < (roe.tightMinQuality ?? 0.6)) return null;
    if (distance(ship, track) > (roe.tightCommitRangeNm ?? 90) * NM) return null;
  }
  return track;
}

function unresolvedOffensiveWaveCount(sim, side, targetId) {
  let count = 0;
  for (const missile of missilesTargeting(sim, targetId)) {
    if (!missile.alive || missile.side !== side || missile.terminal) continue;
    if (missileHasSurfaceTarget(MISSILES[missile.missileId]) || missile.launchRole === "anti_ship") count++;
  }
  return count;
}

function offensiveWaveHold(sim, side, targetId, desired) {
  const pending = unresolvedOffensiveWaveCount(sim, side, targetId);
  return pending >= Math.max(1, Math.min(4, Math.ceil(desired * 0.33)));
}

// LO stand-in release: any low-observable airframe (class flag) that still holds
// a surface munition uses a low-altitude stand-in profile rather than lofted
// max-range release. Previously hard-coded to hull === "F35C" + AGM-84 only.
function airStrikeReleaseBlocked(shooter, target, weapon, track) {
  if (shooter.domain !== "air" || !shooter.lowObservable) return false;
  if (!missileHasSurfaceTarget(MISSILES[weapon])) return false;
  const targetDomain = target.domain ?? track?.domain ?? "sea";
  if (targetDomain !== "sea" && targetDomain !== "ground") return false;
  if (shooter.altitudeM > AIRCRAFT_TEMP_CONFIG.lowObservableReleaseAltitudeM) return true;
  return distance(shooter, track) > MISSILES[weapon].rangeM * AIRCRAFT_TEMP_CONFIG.lowObservableStandInFrac;
}

// Long-range / hypersonic surface strike — may consume a reserved strategic
// quota after the general raid cap is full, so short-range ASCMs from the
// nearest DDG cannot permanently starve a Dark Eagle battery.
// Unit Workshop ammo can set `strategic: true|false` explicitly; otherwise we
// fall back to hypersonic profile or very long reach (≥ 800 NM).
function isStrategicSurfaceWeapon(missileId) {
  const spec = MISSILES[missileId];
  if (!spec || !missileHasSurfaceTarget(spec)) return false;
  if (spec.strategic === true) return true;
  if (spec.strategic === false) return false;
  return spec.terminalProfile === "hypersonic_glide" || spec.rangeM >= 800 * NM;
}

function shooterHasSurfaceWeaponForDomain(ship, domain) {
  const lo = ship.loadout;
  if (!lo) return false;
  for (const id of Object.keys(lo)) {
    if (!(lo[id] > 0)) continue;
    const spec = MISSILES[id];
    if (spec && missileCanTarget(spec, domain)) return true;
  }
  return false;
}

// Dedicated anti-surface munitions only — dual-role SAMs (SM-6) must not make a
// coastal SAM battery look like a strike specialist and steal first-pass slots.
function hasDedicatedSurfaceStrike(ship) {
  const lo = ship.loadout;
  if (!lo) return false;
  for (const id of Object.keys(lo)) {
    if (!(lo[id] > 0)) continue;
    const spec = MISSILES[id];
    if (!spec || !missileHasSurfaceTarget(spec)) continue;
    if (missileCanTarget(spec, "missile")) continue;
    return true;
  }
  return false;
}

// Strike specialists get the first offensive allocation pass so purpose-built
// magazines (DEB, CDB, air-to-ground/ship, or any Unit Workshop hull with
// `strikeSpecialist: true`) are not starved by the nearest generalist DDG.
// Requires live dedicated surface ammo; the class flag only overrides the
// domain heuristic when ammo is present.
function isStrikeSpecialist(ship) {
  if (!hasDedicatedSurfaceStrike(ship)) return false;
  if (ship.strikeSpecialist === false) return false;
  if (ship.strikeSpecialist === true) return true;
  return ship.domain === "air" || (ship.domain === "ground" && ship.isFixed);
}

function bestSurfaceReachM(ship, domain) {
  let best = 0;
  const lo = ship.loadout;
  if (!lo) return 0;
  for (const id of Object.keys(lo)) {
    if (!(lo[id] > 0)) continue;
    const spec = MISSILES[id];
    if (!spec || !missileCanTarget(spec, domain)) continue;
    if (spec.rangeM > best) best = spec.rangeM;
  }
  return best;
}

function ensureDomainTargetSlot(selectedTargets, observedTargets, domain, predicate) {
  if (selectedTargets.some((it) => (it.track.domain ?? "sea") === domain)) return;
  const match = observedTargets.find((it) => (it.track.domain ?? "sea") === domain && (!predicate || predicate(it)));
  if (match) selectedTargets.push(match);
}

function planOffensiveFires(sim) {
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const ships = aliveShipsForSide(sim, side);
    const posture = sim.commandState?.get(side) ?? {
      aggression: 0.5,
      advantage: 0,
      ownOffense: 0,
      mode: "focus",
      enemyOffenseEstimate: 0,
      targetBreadth: 1,
      raidDepth: 2
    };
    const observedTargets = [...(sim.forcePicture?.get(side)?.values() ?? [])]
      .filter((track) => track.side !== side && !String(track.id).startsWith("M-"))
      .map((track) => ({ track, score: offensiveTargetValue(track) }))
      .filter((item) => item.score >= 35)
      .sort((a, b) => b.score - a.score);
    if (!observedTargets.length) continue;
    const targetLimit = Math.max(1, Math.min(observedTargets.length, posture.targetBreadth ?? 1));
    const targetPlan = new Map();
    const selectedTargets = observedTargets.slice(0, targetLimit);
    // A high-value enemy flight can outrank every ship and, with a narrow target
    // breadth, monopolise the side's whole salvo — leaving the strikers' anti-
    // ship rounds unused. Guarantee the top surface/ground target a slot so the
    // fleet keeps prosecuting ships even while fighters are up. (When every
    // observed target is already surface this is a no-op, so pure-surface play is
    // unchanged.)
    if (selectedTargets.length && selectedTargets.every((it) => (it.track.domain ?? "sea") === "air")) {
      const topSurface = observedTargets.find((it) => (it.track.domain ?? "sea") !== "air");
      if (topSurface) selectedTargets.push(topSurface);
    }
    // Domain-specialist guarantees: if anyone on this side carries ground-only
    // or sea-only munitions (JSOW vs Harpoon, DEB, CDB), ensure a matching
    // domain target is on the plan so those magazines can actually be used.
    const sideHasGroundStrike = ships.some((s) => shooterHasSurfaceWeaponForDomain(s, "ground")
      && !shooterHasSurfaceWeaponForDomain(s, "sea"));
    const sideHasSeaOnlyStrike = ships.some((s) => shooterHasSurfaceWeaponForDomain(s, "sea")
      && !shooterHasSurfaceWeaponForDomain(s, "ground"));
    if (sideHasGroundStrike) ensureDomainTargetSlot(selectedTargets, observedTargets, "ground");
    if (sideHasSeaOnlyStrike) ensureDomainTargetSlot(selectedTargets, observedTargets, "sea");
    // Also keep a general surface (sea or ground) slot if the list is pure air.
    if (selectedTargets.every((it) => (it.track.domain ?? "sea") === "air")) {
      ensureDomainTargetSlot(selectedTargets, observedTargets, "sea");
      ensureDomainTargetSlot(selectedTargets, observedTargets, "ground");
    }

    const scoreTotal = selectedTargets.reduce((sum, item) => sum + item.score, 0) || 1;
    const aggression = posture.aggression ?? 0.5;
    for (const item of selectedTargets) {
      const scoreShare = item.score / scoreTotal;
      const desiredBase = posture.mode === "saturate"
        ? (posture.raidDepth ?? 6) * (1.15 + scoreShare * 1.55)
        : posture.mode === "pressure"
          ? (posture.raidDepth ?? 4) * (0.9 + scoreShare * 1.15)
          : posture.mode === "focus"
            ? (posture.raidDepth ?? 3) * (1.05 + scoreShare * 1.35)
            : (posture.raidDepth ?? 2) * (0.65 + scoreShare);
      let desired = Math.max(
        posture.mode === "saturate" ? 3 : 1,
        Math.min(
          posture.mode === "saturate" ? 16 : 12,
          Math.round(desiredBase)
        )
      );
      // Cap the raid by the target's toughness so the fleet does not dump a
      // 16-deep saturation salvo on a 1-HP frigate. Size it to score the
      // remaining hits through expected defensive leakage plus a few leakers —
      // enough to kill, not the whole magazine. (Posture still governs how the
      // shots are paced and split.)
      // A deliberate saturation doctrine is *meant* to overwhelm, so the cap
      // only reins in the default/measured postures (the casual overcommit) —
      // the SM-6→dedicated-weapon preference already curbs magazine waste in
      // every mode.
      const tgt = posture.mode === "saturate" ? null : aliveShipById(sim, item.track.id);
      if (tgt) {
        const remainingHits = Math.max(1, Math.ceil(tgt.damageResist ?? 1) - Math.round(tgt.damage ?? 0));
        const desiredLeakers = ships[0]?.offenseDoctrine?.desiredLeakers ?? 2;
        // Against a layered SAM defence only a fraction of a strike salvo leaks
        // through and hits, so size the raid to score the remaining hits at that
        // leakage plus a few extra leakers — generous enough to kill a defended
        // ship, but not the whole magazine on a lone frigate (a 2-HP hull caps at
        // ~8 instead of the 16-deep saturation salvo).
        const expectedLeakFrac = 0.35;
        const hpCap = Math.ceil(remainingHits / expectedLeakFrac) + desiredLeakers;
        desired = Math.min(desired, hpCap);
      }
      // Strategic overflow: a few reserved slots only long-range / hypersonic
      // weapons may fill after the general raid is full — layered deep strike
      // rather than either/or with the nearest destroyer's ASCMs.
      const strategicQuota = posture.mode === "survive"
        ? 0
        : Math.min(2, Math.max(0, Math.round(aggression * 2.2)));
      targetPlan.set(item.track.id, {
        track: item.track,
        score: item.score,
        desired,
        assigned: countSideWeaponsOnTarget(sim, side, item.track.id),
        strategicQuota,
        strategicAssigned: 0,
        coordinatedReadyAt: sim.time + coordinatedRaidDelayS(posture, selectedTargets.length, scoreShare)
      });
    }
    const enemyEstimate = posture.enemyOffenseEstimate ?? 0;
    const allowReserve = posture.mode === "saturate" || enemyEstimate <= 0 || posture.advantage > 0.18 || posture.aggression > 0.74;
    const primaryTrack = selectedTargets[0].track;
    const primaryDomain = primaryTrack.domain ?? "sea";
    const shooters = ships
      .filter((ship) => sim.time >= ship.reactionAvailableAt)
      .filter(canActAsShooter)
      .sort((a, b) => {
        // Prefer units that can actually prosecute the primary target domain,
        // then strike specialists (DEB / air-to-ground / CDB) so their magazines
        // are not starved by pure proximity of a DDG, then command role, then
        // range (with a small bonus for long-reach fit).
        const aCan = primaryDomain === "air"
          ? (a.loadout && Object.keys(a.loadout).some((id) => a.loadout[id] > 0 && missileCanTarget(MISSILES[id], "air")) ? 0 : 1)
          : (bestSurfaceReachM(a, primaryDomain) > 0 ? 0 : 1);
        const bCan = primaryDomain === "air"
          ? (b.loadout && Object.keys(b.loadout).some((id) => b.loadout[id] > 0 && missileCanTarget(MISSILES[id], "air")) ? 0 : 1)
          : (bestSurfaceReachM(b, primaryDomain) > 0 ? 0 : 1);
        if (aCan !== bCan) return aCan - bCan;
        const aSpec = isStrikeSpecialist(a) ? 0 : 1;
        const bSpec = isStrikeSpecialist(b) ? 0 : 1;
        if (aSpec !== bSpec) return aSpec - bSpec;
        const aRole = a.fleetRole === FLEET_ROLE.OTC ? -2 : a.fleetRole === FLEET_ROLE.AAWC ? -1 : 0;
        const bRole = b.fleetRole === FLEET_ROLE.OTC ? -2 : b.fleetRole === FLEET_ROLE.AAWC ? -1 : 0;
        if (aRole !== bRole) return aRole - bRole;
        const aDist = distance(a, primaryTrack);
        const bDist = distance(b, primaryTrack);
        // Prefer in-range shooters; among those, slightly prefer longer-reach
        // specialists when the target is far (DEB at 100+ NM beats a short
        // ASCM that cannot actually reach).
        const aReach = primaryDomain === "air" ? 0 : bestSurfaceReachM(a, primaryDomain);
        const bReach = primaryDomain === "air" ? 0 : bestSurfaceReachM(b, primaryDomain);
        const aInRange = aReach >= aDist ? 0 : 1;
        const bInRange = bReach >= bDist ? 0 : 1;
        if (aInRange !== bInRange) return aInRange - bInRange;
        return aDist - bDist || a.id.localeCompare(b.id);
      });

    // Two-pass allocation: specialists first (1 commit each) so DEB/air/CDB
    // get a shot before general naval ASCMs fill every raid slot; then the
    // normal multi-commit fleet pass.
    const allocateFrom = (shooterList, maxCommitsFor) => {
      for (const shooter of shooterList) {
        if (sim.time < shooter.reactionAvailableAt) continue;
        const shooterAggression = clamp(
          0.25 * (shooter.doctrine?.aggression ?? 0.65) + 0.75 * posture.aggression,
          0.15,
          0.95
        );
        let launches = 0;
        const commitLimit = maxCommitsFor(shooter, shooterAggression);
        while (launches < commitLimit) {
          let launchedThisPass = false;
          for (const item of selectedTargets) {
            const state = targetPlan.get(item.track.id);
            if (!state) continue;
            const targetShip = aliveShipById(sim, item.track.id);
            if (!targetShip) continue;
            const track = bestTrackForShip(sim, shooter, targetShip);
            if (!track) continue;
            const targetScore = state.score;
            const targetAllowReserve = allowReserve || shooterAggression > 0.72 || targetScore > 120;
            const targetIsAir = targetShip.domain === "air";
            const weapon = targetIsAir
              ? chooseAntiAirWeapon(shooter, track, targetAllowReserve, shooterAggression)
              : chooseAntiShipWeapon(shooter, track, targetAllowReserve, shooterAggression);
            if (!weapon) continue;
            if (airStrikeReleaseBlocked(shooter, targetShip, weapon, track)) continue;
            const strategic = !targetIsAir && isStrategicSurfaceWeapon(weapon);
            const generalFull = state.assigned >= state.desired;
            if (generalFull) {
              // Only strategic weapons may use the overflow quota.
              if (!strategic || state.strategicAssigned >= state.strategicQuota) continue;
            }
            if (offensiveWaveHold(sim, side, item.track.id, state.desired + state.strategicQuota)) continue;
            const alreadyAssigned = countSideWeaponsOnTarget(sim, side, item.track.id);
            const hardCap = state.desired + state.strategicQuota;
            if (alreadyAssigned >= hardCap) continue;
            const pendingMatches = (id) => targetIsAir ? missileCanTarget(MISSILES[id], "air") : missileHasSurfaceTarget(MISSILES[id]);
            const ownPending = (shooter.launchQueue || []).some((order) => order.targetId === item.track.id && pendingMatches(order.missileId))
              || missilesTargeting(sim, item.track.id).some((m) => m.launcherId === shooter.id && pendingMatches(m.missileId));
            const saturationHold = posture.mode === "saturate" ? 0.92 : shooterAggression > 0.74 ? 0.75 : 0.5;
            if (ownPending && alreadyAssigned >= Math.ceil(state.desired * saturationHold) && !strategic) continue;
            const salvoBonus = posture.mode === "saturate" && shooterAggression > 0.82 ? 1 : 0;
            const flightCap = shooter.domain === "air" ? Math.max(1, aliveAircraftCount(shooter)) : Infinity;
            const room = generalFull
              ? state.strategicQuota - state.strategicAssigned
              : hardCap - alreadyAssigned;
            const count = Math.min(
              MISSILES[weapon].salvo + salvoBonus,
              room,
              availableCount(shooter, weapon),
              flightCap
            );
            if (count > 0 && queueSalvo(sim, shooter, track, weapon, count, {
              readyAtOverride: state.coordinatedReadyAt,
              priorityOverride: posture.mode === "saturate" ? 40 : strategic ? 45 : 50
            })) {
              launches += 1;
              const baseWindow = offensiveCommitWindowS(posture, shooterAggression);
              // Specialists (especially slow-reloading hypersonics) get a slightly
              // longer cadence so they don't dump the whole DEB magazine in one
              // planning burst, but they do get *a* shot.
              const cadenceScale = strategic ? 1.15 : isStrikeSpecialist(shooter) ? 1.05 : 1;
              shooter.reactionAvailableAt = sim.time + (baseWindow + sim.rng.range(0, baseWindow * 0.45)) * cadenceScale;
              state.assigned += count;
              if (strategic && generalFull) state.strategicAssigned += count;
              launchedThisPass = true;
              break;
            }
          }
          if (!launchedThisPass) break;
        }
      }
    };

    const specialists = shooters.filter(isStrikeSpecialist);
    const general = shooters.filter((s) => !isStrikeSpecialist(s));
    // Pass 1: each specialist may take one allocation (unlock DEB / air strike).
    allocateFrom(specialists, () => 1);
    // Pass 2: fleet commit limits for remaining capacity (specialists may still
    // participate if reaction window allows and room remains).
    allocateFrom(general, (shooter, shooterAggression) => offensiveAllocationsPerCycle(posture, shooterAggression));
    allocateFrom(specialists, (shooter, shooterAggression) => Math.max(0, offensiveAllocationsPerCycle(posture, shooterAggression) - 1));
  }
}

export function planEngagements(sim) {
  if (sim.time < (sim.nextFirePlanAt ?? 0)) return;
  sim.nextFirePlanAt = sim.time + 1;
  // Per-cycle inbound-raid memo: the missile set is stable through planning.
  sim._raidCountCache = new Map();
  sim._engagementIndex = buildEngagementIndex(sim);
  computeFleetCommand(sim);
  planDefensiveFires(sim);
  planOffensiveFires(sim);
  for (const ship of sim.ships) {
    if (ship.alive) ship.lastFirePlanAt = sim.time;
  }
  sim._engagementIndex = null;
  sim._raidCountCache = null;
}

// Subsystem damage model: each hit degrades random subsystems, affecting combat capability.
function applySubsystemDamage(sim, ship) {
  const subs = ship.subsystems;
  if (!subs) return;
  // Each hit damages 2-3 subsystems (random selection weighted by vulnerability)
  const count = 2 + Math.floor(sim.rng.next() * 2); // 2 or 3
  const candidates = ["radar", "vls", "propulsion", "fireControl", "ciws", "cic"];
  // Shuffle and pick first `count`
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(sim.rng.next() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const messages = [];
  for (let i = 0; i < count; i++) {
    const key = candidates[i];
    const degradation = 0.15 + sim.rng.next() * 0.30; // 15-45% damage per subsystem hit
    subs[key] = Math.max(0, subs[key] - degradation);
    if (subs[key] <= 0.05) {
      messages.push(`${key} destroyed`);
    } else if (subs[key] < 0.5) {
      messages.push(`${key} heavily damaged`);
    }
  }
  if (messages.length) {
    addEvent(sim, `${ship.name} subsystem damage: ${messages.join(", ")}.`, ship.side);
  }
}

// Target destroyed in flight: no re-vectoring is allowed.
function handleTargetLoss(sim, missile, spec) {
  missile.targetLost = true;
  const controller = shipById(sim, missile.launcherId);
  const roe = controller?.roe ?? defaultRoe();
  deactivateMissile(sim, missile);
  if (roe.selfDestructOnTargetLoss) {
    addEvent(sim, `${missile.missileId} received a midcourse abort and self-destructed after its target was destroyed.`, missile.side);
  } else {
    addEvent(sim, `${missile.missileId} lost its target and fell into the sea.`, missile.side);
  }
  return false;
}

// Terminal survivability roll for a missile reaching an aircraft squadron. The
// flight is a small, fast, hard target (large inherent evasion), harder still
// while breaking, and infrared seekers can be spoofed outright by flares.
// May consume one flare and one RNG draw (flare roll); the caller draws the
// hit roll only when not decoyed, so the RNG order stays deterministic.
// Closing speed of a missile on its target along the line of sight (m/s).
// Positive = closing (hot/head-on), negative = opening (tail-chase / out-run).
function closureRate(missile, target) {
  const dx = target.x - missile.x;
  const dy = target.y - missile.y;
  const d = Math.hypot(dx, dy) || 1;
  const lx = dx / d;
  const ly = dy / d;
  const mvx = Math.cos(missile.heading) * missile.speed;
  const mvy = Math.sin(missile.heading) * missile.speed;
  const tv = entityVelocity(target);
  return (mvx - tv.vx) * lx + (mvy - tv.vy) * ly;
}

function airDefenseHitChance(sim, missile, spec, target) {
  const cfg = AIRCRAFT_TEMP_CONFIG;
  if (spec.guidance === "infrared" && (target.flares ?? 0) > 0 && (target.evading || missile.terminal)) {
    target.flares -= 1;
    if (sim.rng.next() < cfg.flareDecoyChance) {
      addEvent(sim, `${target.name} decoyed ${missile.missileId} with flares.`, target.side);
      return { decoyed: true, pk: 0 };
    }
  }
  let pk = spec.pk - cfg.evasionBase - (target.airEvasionBonus ?? 0);
  if (target.evading) pk -= cfg.evasionManeuver;
  pk += missile.terminal ? 0.10 : 0;
  // Air-to-air geometry. No-escape-zone: a shot taken within `nezFraction` of the
  // weapon's reach keeps its energy and is hard to defeat; a max-range shot is
  // energy-depleted and far easier to out-run. Aspect: a tail-chase (the target
  // opening from the missile) loses closure energy. Both are per-missile tunable.
  const rangeFrac = clamp((missile.flownM ?? 0) / Math.max(1, missile.maxRangeM), 0, 1);
  const nez = spec.nezFraction ?? 0.5;
  pk += rangeFrac <= nez ? 0.10 : -0.22 * ((rangeFrac - nez) / Math.max(0.05, 1 - nez));
  if (closureRate(missile, target) < 0) pk -= 0.12;
  return { decoyed: false, pk: clamp(pk, 0.03, 0.78) };
}

// Bounded energy-bleed (drag) model. A missile is fastest at launch and slows
// toward the end of its reach; denser air at low altitude bleeds energy faster,
// so a sea-skimmer arrives slower than a high-altitude round. Clamped so a weapon
// never stalls and engagement balance stays close to the tuned envelopes. Cheap:
// a handful of arithmetic ops per missile per tick.
function dragSpeedFactor(missile) {
  const flownFrac = clamp((missile.flownM ?? 0) / Math.max(1, missile.maxRangeM), 0, 1);
  const alt = missile.altitudeM ?? 1000;
  const densityFactor = alt < 100 ? 1.15 : (alt > 4000 ? 0.65 : 0.9);
  return clamp(1 - 0.32 * flownFrac * densityFactor, 0.62, 1);
}

// Maneuver-induced energy bleed: a missile forced to pull a hard turn to keep
// tracking a maneuvering/notching target bleeds real speed doing it — induced
// drag rises sharply with load factor, the same real effect that costs an
// aircraft airspeed through a hard break (see the turn-error `bleed` term in
// movement.js's moveAirUnit). This was previously entirely absent: the drag
// model above only depends on flownFrac/altitude, so a missile chasing a
// hard-breaking target lost no more speed than one running down a
// straight-line contact. That gap matters because the induced drag of a
// forced hard turn late in flight (when the missile has the least energy
// margin left) is the actual physical mechanism behind why the notch/beam+dive
// defense works — not just the aspect/NEZ PK penalty already modeled in
// airDefenseHitChance, which captures the same effect at the hit-probability
// level but never touched the missile's own kinematics until now. Missiles in
// this sim (unlike aircraft) have a flat turn-rate ceiling with no separate
// airspeed-dependent formula, so the load proxy here is the fraction of that
// design ceiling actually being pulled this tick, not a full lift/speed
// derivation — proportionate to how coarse the rest of the missile model is.
const MISSILE_TURN_DRAG_K = 0.5;
// Terminal-dive GPE->KE conversion factor and cap (see the terminal-phase
// transition below): fraction of speed gained per 1000m of altitude dropped.
const TERMINAL_DIVE_BOOST_K = 0.008;
const TERMINAL_DIVE_BOOST_CAP = 0.05;
function missileManeuverDragFactor(headingDeltaRad, dt, baseTurnRadPerS) {
  if (baseTurnRadPerS <= 0) return 1;
  const turnRateRadPerS = Math.abs(headingDeltaRad) / Math.max(dt, 1e-3);
  const turnFrac = clamp(turnRateRadPerS / baseTurnRadPerS, 0, 1.5);
  return clamp(1 - MISSILE_TURN_DRAG_K * turnFrac * turnFrac, 0.55, 1);
}

export function updateMissiles(sim, dt) {
  // Rebuild the missile saturation grid once per tick (reused by the interceptor
  // and CIWS saturation models below, and by point defense this same tick).
  const satGrid = buildMissileGrid(sim, sim._aliveMissiles ?? sim.missiles);
  for (const missile of sim.missiles) {
    if (!missile.alive) continue;
    const spec = missile._spec ?? MISSILES[missile.missileId];
    if (!missile._spec) Object.defineProperty(missile, "_spec", { value: spec, writable: true, configurable: true });
    const launchRole = missileDisplayRole(missile);
    // Resolve the target by id namespace, not by weapon role: in-flight missiles
    // have "M-…" ids, every platform (ship/ground/air) has a hull id. This lets a
    // SAM (anti_air) engage either an incoming missile OR an enemy aircraft.
    const targetIsInFlightMissile = String(missile.targetId).startsWith("M-");
    let target = targetIsInFlightMissile
      ? aliveMissileById(sim, missile.targetId)
      : aliveShipById(sim, missile.targetId);

    // Target killed in flight (sunk, or threat intercepted by someone else):
    // abort or self-destruct — never coast on a dead datum.
    if (!target) {
      if (!handleTargetLoss(sim, missile, spec)) continue;
      target = targetIsInFlightMissile
        ? sim.missiles.find((m) => m.id === missile.targetId && m.alive)
        : sim.ships.find((s) => s.id === missile.targetId && s.alive);
      if (!target) { deactivateMissile(sim, missile); continue; }
    }

    const distToTarget = distance(missile, target);
    missile.timeToImpactEstimate = timeToImpact(missile, target);
    // Anti-surface strike vs a platform; otherwise (intercepting a missile, or a
    // SAM running down an aircraft) it is an air-intercept engagement.
    const isAntiShipTarget = !targetIsInFlightMissile && launchRole === "anti_ship";
    if (targetIsInFlightMissile && distToTarget < 4 * NM) {
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "intercept endgame";
    } else if (isAntiShipTarget && distToTarget < spec.seekerRangeM) {
      const enteringTerminal = !missile.terminal;
      const priorAltitudeM = missile.altitudeM;
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "terminal attack phase";
      if (Number.isFinite(spec.terminalAltitudeM)) {
        missile.seaSkimming = spec.terminalSeaSkimming ?? false;
        missile.altitudeM = spec.terminalAltitudeM;
      } else if (missile.missileId === "AGM-154") {
        missile.altitudeM = 300; // JSOW: terminal dive on its glide profile, not a sea-skim
      } else {
        missile.seaSkimming = true;
        missile.altitudeM = 12; // drop to sea-skim for the terminal run-in
      }
      // GPE -> KE, once, at the moment of the dive: a controlled guided
      // descent converts only a small, heavily-damped fraction of the
      // altitude drop into forward speed (a real free-fall energy-conversion
      // formula would be wildly excessive here -- a guided glide/cruise
      // weapon bleeds most of that potential energy as drag maintaining
      // stable flight, not literal free-fall) but it is a genuine, physically-
      // motivated effect rather than the dive being energy-free. Folded into
      // launchSpeedMps (the reference dragSpeedFactor scales from) so it
      // persists through every later tick's recompute instead of being
      // overwritten immediately.
      if (enteringTerminal) {
        const droppedM = Math.max(0, priorAltitudeM - missile.altitudeM);
        const diveBoost = clamp(TERMINAL_DIVE_BOOST_K * (droppedM / 1000), 0, TERMINAL_DIVE_BOOST_CAP);
        missile.launchSpeedMps = (missile.launchSpeedMps ?? spec.speedMps) * (1 + diveBoost);
      }
    } else if (!targetIsInFlightMissile && !isAntiShipTarget && distToTarget < spec.seekerRangeM) {
      // SAM/AAM closing on an aircraft squadron.
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "intercept endgame";
    } else if (missile.flownM > 2 * NM) {
      missile.phase = "midcourse";
    }

    // Air-launched weapons: blend from launch altitude toward cruise profile
    // over the first ~8 NM (O(1) per missile). Stops the previous teleport to
    // sea-skim / glide altitude on the launch tick while still settling onto
    // the weapon's design profile before terminal.
    if (!missile.terminal
      && Number.isFinite(missile.launchAltitudeM)
      && Number.isFinite(missile.cruiseAltitudeM)
      && missile.launchAltitudeM !== missile.cruiseAltitudeM) {
      const blend = clamp(missile.flownM / (8 * NM), 0, 1);
      missile.altitudeM = missile.launchAltitudeM
        + (missile.cruiseAltitudeM - missile.launchAltitudeM) * blend;
    }

    // Select the aimpoint. Course is always computed on a velocity-lead
    // (collision) solution, never on the bare target position.
    let aimX = target.x;
    let aimY = target.y;
    let aimVx;
    let aimVy;
    // Mid-course: use CEC datalink for surface targets (ship or dual vs ship)
    const aimIsShip = isAntiShipTarget;
    if (aimIsShip && !missile.terminal) {
      const fused = forceTrack(sim, missile.controllerSide ?? missile.side, missile.targetId);
      if (fused) {
        aimX = fused.x;
        aimY = fused.y;
        aimVx = fused.vx;
        aimVy = fused.vy;
      } else {
        const tv = entityVelocity(target);
        aimVx = tv.vx;
        aimVy = tv.vy;
      }
    } else {
      // Terminal seeker lock (or interceptor under fire-control radar): lead
      // the true target motion.
      const tv = entityVelocity(target);
      aimVx = tv.vx;
      aimVy = tv.vy;
    }
    const lead = interceptPoint(missile.x, missile.y, missile.speed, aimX, aimY, aimVx, aimVy);
    missile.aimX = lead.x;
    missile.aimY = lead.y;
    missile.targetX = lead.x;
    missile.targetY = lead.y;

    // Rate-limited steering toward the lead point (proportional-navigation
    // style: track the rotating line of sight within the airframe's turn
    // limit, sharper in the terminal phase).
    const losAngle = Math.atan2(lead.y - missile.y, lead.x - missile.x);
    missile.losRate = wrapAngle(losAngle - (missile.losAngle ?? losAngle)) / Math.max(dt, 1e-3);
    missile.losAngle = losAngle;
    const baseTurn = (spec.maxTurnRateDps ?? 12) * Math.PI / 180;
    const maxTurn = baseTurn * (missile.terminal ? 1.5 : 1) * dt;
    const headingDeltaRad = clamp(wrapAngle(losAngle - missile.heading), -maxTurn, maxTurn);
    missile.heading = wrapAngle(missile.heading + headingDeltaRad);
    // Energy bleed: recompute speed from the launch value and the drag model so
    // long-range / low-altitude shots arrive slower (deterministic; no RNG),
    // then apply the additional maneuver-induced bleed from how hard this tick's
    // turn actually was (see missileManeuverDragFactor above).
    missile.speed = (missile.launchSpeedMps ?? spec.speedMps)
      * dragSpeedFactor(missile)
      * missileManeuverDragFactor(headingDeltaRad, dt, baseTurn * (missile.terminal ? 1.5 : 1));
    const travel = missile.speed * dt;
    missile.x += Math.cos(missile.heading) * travel;
    missile.y += Math.sin(missile.heading) * travel;
    missile.flownM += travel;
    if (target && targetIsInFlightMissile && distance(missile, target) < 850) {
      // Interceptor PK: base PK minus O(1) kinematic / profile / layer difficulty
      // (hypersonic boost-glide is far harder than a subsonic ASCM), sea-skim,
      // local saturation, and track cue quality. See missileInterceptHitChance.
      const interceptorSide = missile.side;
      const concurrentThreats = countNearbyMissiles(satGrid, missile.x, missile.y, 8 * NM,
        (m) => m.alive && m.side !== interceptorSide);
      const interceptChance = missileInterceptHitChance(spec, target, {
        terminal: missile.terminal,
        trackQuality: missile.trackQualityAtLaunch ?? 0.75,
        trackAgeS: missile.trackAgeAtLaunchS ?? 0,
        concurrentThreats
      });
      if (sim.rng.next() < interceptChance) {
        deactivateMissile(sim, target);
        addEvent(sim, `${missile.missileId} intercepted incoming ${target.missileId}.`, missile.side);
      } else {
        addEvent(sim, `${missile.missileId} failed to intercept ${target.missileId}.`, missile.side);
      }
      deactivateMissile(sim, missile);
    } else if (target && !targetIsInFlightMissile && distance(missile, target) < 420) {
      const isAir = target.domain === "air";
      let hitChance;
      let decoyed = false;
      if (isAir) {
        // Aircraft survivability: small, fast, hard-maneuvering target with IR
        // countermeasures — a far cry from a ship's near-certain terminal hit.
        const air = airDefenseHitChance(sim, missile, spec, target);
        hitChance = air.pk;
        decoyed = air.decoyed;
      } else {
        // Hit chance: base PK modified by terminal phase, sea state, target damage
        // Large ships (BBG) are easier to hit, fast/maneuvering ships harder
        const maneuverPenalty = target.speed > 12 ? 0.06 : 0;
        const sizeBonus = Math.min(0.08, (target.displacementT || 9200) / 200000);
        hitChance = clamp(
          spec.pk + (missile.terminal ? 0.18 : 0) - target.damage * 0.03 + sizeBonus - maneuverPenalty,
          0.10, 0.88
        );
      }
      // No hit roll is drawn when a flare already spoofed the seeker.
      const hit = !decoyed && sim.rng.next() < hitChance;
      if (hit) {
        target.damage += 1;
        // Subsystem damage applies to ships/emplacements, not aircraft flights
        // (a squadron has no radar/VLS/CIWS subsystems — a hit just downs a plane).
        if (!isAir) applySubsystemDamage(sim, target);
        const damageShown = Math.max(0, Math.round(target.damage));
        const resistShown = Math.max(1, Math.ceil(target.damageResist ?? 3.0));
        if (isAir) {
          const remaining = Math.max(0, resistShown - damageShown);
          addEvent(sim, `${target.name} lost an aircraft to ${missile.missileId} (${remaining} of ${resistShown} remaining).`, missile.side);
        } else {
          addEvent(sim, `${target.name} hit by ${missile.missileId}. Damage: ${damageShown}/${resistShown}.`, missile.side);
        }
        // Mission kill (or last aircraft downed) at the damageResist threshold.
        if (target.damage >= (target.damageResist ?? 3.0)) {
          target.speed = 0;
          deactivateShip(sim, target);
          const killMsg = isAir
            ? `${target.name} squadron destroyed — all ${resistShown} aircraft downed.`
            : `${target.name} mission-killed — ${damageShown} hits sustained (class limit ${resistShown}).`;
          addEvent(sim, killMsg, missile.side);
        }
      } else if (!decoyed) {
        addEvent(sim, `${missile.missileId} missed ${target.name}.`, missile.side);
      }
      deactivateMissile(sim, missile);
    }
    if (missile.flownM > missile.maxRangeM) {
      deactivateMissile(sim, missile);
      addEvent(sim, `${missile.missileId} exhausted fuel and fell into the sea.`, missile.side);
    }
  }
  let writeIndex = 0;
  for (const missile of sim.missiles) {
    if (missile.alive) sim.missiles[writeIndex++] = missile;
  }
  sim.missiles.length = writeIndex;
  // Keep alive/id indexes in lock-step with the compacted array without a full
  // entity-index rebuild (target buckets were already updated on deactivate).
  // Use a separate array so next tick's deactivate/launch never mutates the
  // list mid-iteration of updateMissiles.
  if (!sim._entityIndexesDirty) {
    if (sim._aliveMissiles) {
      sim._aliveMissiles.length = 0;
      for (const m of sim.missiles) sim._aliveMissiles.push(m);
    } else {
      sim._aliveMissiles = sim.missiles.slice();
    }
    if (sim._missileById) {
      sim._missileById.clear();
      for (const m of sim.missiles) sim._missileById.set(m.id, m);
    }
  }
}

export function pointDefense(sim) {
  for (const ship of sim.ships) {
    if (!ship.alive || ship.ciwsCooldown > 0 || ship.ciwsAmmo <= 0 || sim.time < ship.nextCiwsAt) continue;
    if (!(ship.roe?.ciwsRelease ?? true)) continue;
    const ciwsRange = 1.6 * NM;
    let inbound = null;
    for (const missile of incomingMissilesFor(sim, ship.id)) {
      if (!missile.alive || missile.side === ship.side || missile.targetId !== ship.id || !missile.terminal) continue;
      if (distance(ship, missile) >= ciwsRange) continue;
      if (!inbound || (missile.timeToImpactEstimate ?? Infinity) < (inbound.timeToImpactEstimate ?? Infinity)) {
        inbound = missile;
      }
    }
    if (!inbound) continue;
    // Per-class CIWS parameters
    const burstRounds = ship.ciwsBurstRounds ?? 180;
    const burstS = ship.ciwsBurstS ?? 1.4;
    const cycleS = ship.ciwsCycleS ?? 5.5;
    ship.ciwsAmmo = Math.max(0, ship.ciwsAmmo - burstRounds);
    ship.ciwsBurstUntil = sim.time + burstS;
    ship.nextCiwsAt = sim.time + cycleS;
    ship.ciwsCooldown = cycleS;
    // CIWS PK model: base PK per mount, each mount can engage one threat
    const ciwsCount = ship.ciwsCount ?? 1;
    const basePk = 0.45;  // Phalanx 1B baseline single-shot Pk against subsonic ASCM
    // Saturation: the CIWS is overwhelmed by the local density of terminal
    // leakers in its point-defence bubble (any nearby terminal threat, not only
    // those assigned to this ship), via the shared missile grid.
    const terminalCount = countNearbyMissiles(sim._missileGrid, ship.x, ship.y, 3 * NM,
      (m) => m.alive && m.side !== ship.side && m.terminal);
    const saturationRatio = Math.min(1, ciwsCount / Math.max(1, terminalCount));
    const seaSkimPenalty = inbound.seaSkimming ? 0.18 : 0;
    const damagePenalty = ship.damage * 0.06;
    // CIWS against hypersonic / high-energy threats: almost no kinematic window.
    const diff = interceptDifficultyVsThreat(inbound, null, { ciws: true });
    const pKill = clamp(
      basePk * saturationRatio - seaSkimPenalty - damagePenalty - diff.total,
      diff.pkFloor,
      Math.min(0.72, diff.pkCeil)
    );
    if (sim.rng.next() < pKill) {
      deactivateMissile(sim, inbound);
      addEvent(sim, `${ship.name} CIWS destroyed incoming ${inbound.missileId}.`, ship.side);
    } else {
      addEvent(sim, `${ship.name} CIWS failed against ${inbound.missileId}.`, ship.side);
    }
  }
}
