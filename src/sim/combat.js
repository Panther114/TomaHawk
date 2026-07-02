// Weapons and combat resolution: launch queueing/pacing, force-level defensive
// and offensive fire planning, missile flight and guidance, hit/intercept
// resolution, subsystem damage, and the terminal CIWS layer.

import { NM, SIDE, FLEET_ROLE, WEAPON_STATE } from "./constants.js";
import { clamp, distance, angleTo, wrapAngle, interceptPoint, entityVelocity } from "./math.js";
import { MISSILES, missileDisplayRole } from "./missiles.js";
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

function deactivateMissile(sim, missile) {
  if (!missile.alive) return;
  missile.alive = false;
  markContactDead(sim, missile.id);
  sim._entityIndexesDirty = true;
}

function makeLaunchOrder(sim, launcher, track, missileId, sequence = 0) {
  const spec = MISSILES[missileId];
  if (!spec || availableCount(launcher, missileId) <= 0) return false;
  const rangeM = distance(launcher, track);
  if (rangeM > spec.rangeM) return false;
  const defensive = spec.target === "missile" || (track.id?.startsWith?.("M-") && spec.category !== "anti_ship");
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
    requestedAt: sim.time,
    readyAt,
    launchSequence: sequence,
    defensive,
    priority
  });
  return true;
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

function launchMissile(sim, launcher, order) {
  const spec = MISSILES[order.missileId];
  launcher.lastLaunchAtByMissile ||= {};
  if (!spec || availableCount(launcher, order.missileId) <= 0) return false;
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
  const missile = {
    id: `M-${sim.missiles.length + 1}-${Math.floor(sim.time * 10)}`,
    side: launcher.side,
    launcherId: launcher.id,
    targetId: order.targetId,
    missileId: order.missileId,
    // Dual-role role is "anti_air" when engaging an in-flight missile OR an
    // aircraft platform, else "anti_ship". (Identical to the old defensive-based
    // rule for vanilla, where air targets never occur.)
    launchRole: spec.category === "dual_role"
      ? ((String(order.targetId).startsWith("M-") || order.targetDomain === "air") ? "anti_air" : "anti_ship")
      : spec.category,
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
    phase: spec.category === "anti_ship" ? "cruise" : "boost",
    // Cruise altitude (m): anti-ship weapons sea-skim, air-defence/strike rounds
    // loft. Drives the energy-bleed (drag) model and the detail display; the map
    // stays top-down (altitude is not a third movement axis).
    altitudeM: spec.category === "anti_ship" ? 30 : 7000,
    launchSpeedMps: spec.speedMps,
    terminalReason: null,
    seaSkimming: false,
    maneuvering: spec.category === "anti_ship",
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
    launchSequence: order.launchSequence ?? 0,
    laneOffset
  };
  Object.defineProperty(missile, "_spec", { value: spec, writable: true, configurable: true });
  sim.missiles.push(missile);
  sim._missileById?.set(missile.id, missile);
  sim._aliveMissiles?.push(missile);
  if (sim._missilesByTarget) {
    const bucket = sim._missilesByTarget.get(missile.targetId) ?? [];
    bucket.push(missile);
    sim._missilesByTarget.set(missile.targetId, bucket);
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
    && MISSILES[m.missileId]?.target !== "ship"
  )).length;
  const queued = (ship.launchQueue || []).filter((order) => (
    order.targetId === targetId
    && MISSILES[order.missileId]?.target !== "ship"
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
    solutionsByTarget: new Map(),
    bestLocalMissileTracks: new Map([[SIDE.BLUE, new Map()], [SIDE.RED, new Map()]])
  });
  const {
    countsBySide, queuedByTarget, activeTargetsBySide, queuedTargetsByLauncher,
    defensiveCountsByLauncher, solutionsByTarget, bestLocalMissileTracks
  } = pool;
  countsBySide.clear();
  queuedByTarget.clear();
  activeTargetsBySide.clear();
  queuedTargetsByLauncher.clear();
  defensiveCountsByLauncher.clear();
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
    const spec = missile._spec ?? MISSILES[missile.missileId];
    if (spec?.target !== "ship") {
      incrementDefensiveLauncher(missile.launcherId, missile.targetId);
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
    if (spec?.target !== "ship") incrementDefensiveLauncher(ship.id, order.targetId);
    const queued = queuedByTarget.get(order.targetId) ?? [];
    queued.push({ ship, order });
    queuedByTarget.set(order.targetId, queued);
    const threat = aliveMissileById(sim, order.targetId);
    if (threat && spec && (spec.target === "missile" || spec.target === "dual")) {
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
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    for (const [id, rawTrack] of ship.tracks) {
      if (!String(id).startsWith("M-")) continue;
      const track = currentTrack(rawTrack, sim.time);
      const byId = bestLocalMissileTracks.get(ship.side);
      const current = byId.get(id);
      if (!current || track.quality > current.quality || track.lastSeen > current.lastSeen) byId.set(id, track);
    }
    for (const order of ship.launchQueue || []) recordQueued(ship, order);
  }
  return {
    countsBySide,
    queuedByTarget,
    activeTargetsBySide,
    queuedTargetsByLauncher,
    defensiveCountsByLauncher,
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
  for (const missile of sim._missilesByTarget?.get(ship.id) ?? []) {
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
    if (!spec || (spec.target !== "missile" && spec.target !== "dual")) continue;
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
      if (!spec || (spec.target !== "missile" && spec.target !== "dual")) continue;
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
  let desired = 1;
  if (missile.terminal || track.quality < 0.42 || raidCount >= 2 || lethalMargin) desired = 2;
  if (earliestEta >= tti - 1.5) desired = Math.max(desired, 2);
  if (viableSolutions.length < 1 && tti < 35) desired = Math.max(desired, 2);
  if (viableSolutions.length < 2 && (missile.terminal || lethalMargin || tti < 22)) desired = Math.max(desired, 2);
  if (raidCount >= 4 || (missile.terminal && lethalMargin && tti < 18)) desired = Math.max(desired, 3);
  return {
    tti,
    raidCount,
    lethalMargin,
    solutions,
    viableSolutions,
    earliestEta,
    desired,
    needPromptShot: earliestEta >= tti - 1.5,
    needShootShoot: viableSolutions.length < 2 && (missile.terminal || lethalMargin || tti < 22),
    preferCheapLayer: range => range <= MISSILES.ESSM.rangeM && (missile.terminal || tti < 40 || lethalMargin || raidCount >= 2)
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
    const antiShipCapable = spec.category === "anti_ship" || spec.target === "ship" || spec.target === "dual";
    if (!antiShipCapable) return false;
    const dualRole = spec.category === "dual_role";
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
  const dual = (id) => (MISSILES[id].category === "dual_role" ? 1 : 0);
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
// (anti_air or dual_role), keeping a defensive reserve unless authorised to
// commit it. Mirrors chooseAntiShipWeapon's longest-reach-fit selection.
function chooseAntiAirWeapon(ship, track, allowReserve = false, aggression = 0.5) {
  const rangeM = distance(ship, track);
  const hull = ship.hull || "DDG";
  const baseLoad = defaultLoadout(hull);
  const candidates = Object.keys(ship.loadout).filter((id) => {
    const spec = MISSILES[id];
    if (!spec) return false;
    const antiAirCapable = spec.category === "anti_air" || spec.category === "dual_role"
      || spec.target === "missile" || spec.target === "dual";
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
  if (MISSILES[threat.missileId]?.category !== "anti_ship") return null;
  const rangeM = distance(ship, threat);
  const baseLoad = defaultLoadout(ship.hull || "F15C");
  let best = null;
  for (const id in ship.loadout) {
    const spec = MISSILES[id];
    if (!spec) continue;
    if (spec.category !== "anti_air" && spec.category !== "dual_role") continue;
    if (spec.guidance === "infrared") continue; // WVR IR poor vs sea-skimmer; save for A2A
    if (rangeM > spec.rangeM) continue;
    const reserve = Math.ceil((baseLoad[id] ?? ship.loadout[id]) * 0.7); // keep 70% for air-to-air
    if (ship.loadout[id] <= reserve) continue;
    if (!best || spec.rangeM > MISSILES[best].rangeM) best = id;
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
  const sm2Reserve = Math.ceil(baseLoad["SM-2MR"] * sm2.magazineReserveRatio);
  const sm6Reserve = Math.ceil(baseLoad["SM-6"] * sm6.magazineReserveRatio);
  const essmReserve = Math.ceil(baseLoad.ESSM * essm.magazineReserveRatio);
  const sm2Count = availableCount(ship, "SM-2MR");
  const sm6Count = availableCount(ship, "SM-6");
  const essmCount = availableCount(ship, "ESSM");
  const survivalRisk = threat.terminal || tti < 35 || raidCount >= ship.defenseDoctrine.saturationThreshold;
  const sm2Available = (survivalRisk ? sm2Count > 0 : sm2Count > sm2Reserve) && rangeM <= sm2.rangeM;
  const sm6Available = (survivalRisk ? sm6Count > 0 : sm6Count > sm6Reserve) && rangeM <= sm6.rangeM;
  const essmAvailable = (survivalRisk ? essmCount > 0 : essmCount > essmReserve) && rangeM <= essm.rangeM;
  const cheapFollowupPreferred = options.preferCheapFollowup === true;
  const urgent = options.urgent === true;
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
  if (essmCount > 0 && rangeM <= essm.rangeM) return "ESSM";
  if (sm2Count > 0 && rangeM <= sm2.rangeM) return "SM-2MR";
  if (sm6Count > 0 && rangeM <= sm6.rangeM) return "SM-6";
  return null;
}

function missileThreatScore(sim, missile) {
  const target = aliveShipById(sim, missile.targetId);
  const tti = threatTimeToImpact(missile, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  return (missile.terminal ? 80 : 0) + clamp(90 - tti, 0, 90) + raidCount * 14 + (target?.damage || 0) * 12;
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

function planDefensiveFires(sim) {
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const sideShips = aliveShipsForSide(sim, side);
    const formationMax = sideShips.reduce(
      (max, ship) => Math.max(max, ship.defenseDoctrine?.maxAssignedInterceptors ?? 2),
      1
    );
    const observedThreats = (sim._aliveMissiles || sim.missiles.filter((m) => m.alive))
      .filter((missile) => {
        if (missile.side === side) return false;
        const target = aliveShipById(sim, missile.targetId);
        return target?.side === side;
      })
      .map((missile) => {
        const track = bestMissileTrackForSide(sim, side, missile.id);
        if (!track) return null;
        return { missile, track, target: aliveShipById(sim, missile.targetId), score: missileThreatScore(sim, missile) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    for (const { missile, track, target, score } of observedThreats) {
      const need = defensiveNeedProfile(sim, side, missile, track, target);
      const desired = Math.max(1, Math.min(formationMax + 1, Math.max(need.desired, score > 105 || missile.terminal || track.quality < 0.42 ? 2 : 1)));
      let assigned = assignedInterceptorsForThreat(sim, side, missile.id);
      if (assigned >= desired) continue;
      // Defender priority: the unit that owns the AAW sector the observed
      // threat is in engages first, then the ship under attack, then nearest.
      const defenders = [...sideShips]
        .sort((a, b) => {
          const aSector = inSector(a, track) ? -40 * NM : 0;
          const bSector = inSector(b, track) ? -40 * NM : 0;
          const aTargetBonus = a.id === target.id ? -8 * NM : 0;
          const bTargetBonus = b.id === target.id ? -8 * NM : 0;
          return distance(a, track) + aSector + aTargetBonus - (distance(b, track) + bSector + bTargetBonus);
        });
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
              preferCheapFollowup: defenderAssigned > 0 && need.preferCheapLayer(distance(defender, missile))
            });
        if (!weapon) continue;
        const threatTrack = {
          id: missile.id,
          side: missile.side,
          classification: missile.missileId,
          x: track.x,
          y: track.y,
          vx: track.vx ?? threatVel.vx,
          vy: track.vy ?? threatVel.vy,
          quality: track.quality ?? (missile.terminal ? 0.9 : 0.7)
        };
        const queued = queueSalvo(sim, defender, threatTrack, weapon, 1);
        if (queued) {
          missile.assignedDefenders ||= [];
          missile.assignedDefenders.push(defender.id);
          missile.threatScore = score;
          defender.defenseReactionAvailableAt = sim.time + (weapon === "ESSM" ? 0.7 : 0.9);
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
    const scoreTotal = selectedTargets.reduce((sum, item) => sum + item.score, 0) || 1;
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
      targetPlan.set(item.track.id, {
        track: item.track,
        score: item.score,
        desired,
        assigned: countSideWeaponsOnTarget(sim, side, item.track.id),
        coordinatedReadyAt: sim.time + coordinatedRaidDelayS(posture, selectedTargets.length, scoreShare)
      });
    }
    const enemyEstimate = posture.enemyOffenseEstimate ?? 0;
    const allowReserve = posture.mode === "saturate" || enemyEstimate <= 0 || posture.advantage > 0.18 || posture.aggression > 0.74;
    const shooters = ships
      .filter((ship) => sim.time >= ship.reactionAvailableAt)
      .sort((a, b) => {
        const aRole = a.fleetRole === FLEET_ROLE.OTC ? -2 : a.fleetRole === FLEET_ROLE.AAWC ? -1 : 0;
        const bRole = b.fleetRole === FLEET_ROLE.OTC ? -2 : b.fleetRole === FLEET_ROLE.AAWC ? -1 : 0;
        const aDist = distance(a, selectedTargets[0].track);
        const bDist = distance(b, selectedTargets[0].track);
        return aRole - bRole || aDist - bDist || a.id.localeCompare(b.id);
      });
    for (const shooter of shooters) {
      const shooterAggression = clamp(
        0.25 * (shooter.doctrine?.aggression ?? 0.65) + 0.75 * posture.aggression,
        0.15,
        0.95
      );
      let launches = 0;
      const commitLimit = offensiveAllocationsPerCycle(posture, shooterAggression);
      while (launches < commitLimit) {
        let launchedThisPass = false;
        for (const item of selectedTargets) {
          const state = targetPlan.get(item.track.id);
          if (!state || state.assigned >= state.desired) continue;
          const targetShip = aliveShipById(sim, item.track.id);
          if (!targetShip) continue;
          const track = bestTrackForShip(sim, shooter, targetShip);
          if (!track) continue;
          const targetScore = state.score;
          const targetAllowReserve = allowReserve || shooterAggression > 0.72 || targetScore > 120;
          // Engaging an aircraft platform draws anti-air rounds; ships/ground
          // draw anti-ship rounds. Routing by target domain keeps the surface
          // path byte-identical when no air units are present.
          const targetIsAir = targetShip.domain === "air";
          const weapon = targetIsAir
            ? chooseAntiAirWeapon(shooter, track, targetAllowReserve, shooterAggression)
            : chooseAntiShipWeapon(shooter, track, targetAllowReserve, shooterAggression);
          if (!weapon) continue;
          const alreadyAssigned = countSideWeaponsOnTarget(sim, side, item.track.id);
          if (alreadyAssigned >= state.desired) continue;
          const offensiveCat = targetIsAir
            ? ((c) => c === "anti_air" || c === "dual_role")
            : ((c) => c === "anti_ship");
          const ownPending = (shooter.launchQueue || []).some((order) => order.targetId === item.track.id && offensiveCat(MISSILES[order.missileId]?.category))
            || missilesTargeting(sim, item.track.id).some((m) => m.launcherId === shooter.id && offensiveCat(MISSILES[m.missileId]?.category));
          const saturationHold = posture.mode === "saturate" ? 0.92 : shooterAggression > 0.74 ? 0.75 : 0.5;
          if (ownPending && alreadyAssigned >= Math.ceil(state.desired * saturationHold)) continue;
          const salvoBonus = posture.mode === "saturate" && shooterAggression > 0.82 ? 1 : 0;
          // A squadron's coordinated volley is capped by its surviving aircraft:
          // one shooter per plane, so an attrited flight throws fewer per cycle.
          // Infinity for ships keeps the surface path byte-identical.
          const flightCap = shooter.domain === "air" ? Math.max(1, aliveAircraftCount(shooter)) : Infinity;
          const count = Math.min(MISSILES[weapon].salvo + salvoBonus, state.desired - alreadyAssigned, availableCount(shooter, weapon), flightCap);
          if (count > 0 && queueSalvo(sim, shooter, track, weapon, count, {
            readyAtOverride: state.coordinatedReadyAt,
            priorityOverride: posture.mode === "saturate" ? 40 : 50
          })) {
            launches += 1;
            const baseWindow = offensiveCommitWindowS(posture, shooterAggression);
            shooter.reactionAvailableAt = sim.time + baseWindow + sim.rng.range(0, baseWindow * 0.45);
            state.assigned += count;
            launchedThisPass = true;
            break;
          }
        }
        if (!launchedThisPass) break;
      }
    }
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
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "terminal attack phase";
      missile.seaSkimming = true;
      missile.altitudeM = 12; // drop to sea-skim for the terminal run-in
    } else if (!targetIsInFlightMissile && !isAntiShipTarget && distToTarget < spec.seekerRangeM) {
      // SAM/AAM closing on an aircraft squadron.
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "intercept endgame";
    } else if (missile.flownM > 2 * NM) {
      missile.phase = "midcourse";
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
    missile.heading = wrapAngle(missile.heading + clamp(wrapAngle(losAngle - missile.heading), -maxTurn, maxTurn));
    // Energy bleed: recompute speed from the launch value and the drag model so
    // long-range / low-altitude shots arrive slower (deterministic; no RNG).
    missile.speed = (missile.launchSpeedMps ?? spec.speedMps) * dragSpeedFactor(missile);
    const travel = missile.speed * dt;
    missile.x += Math.cos(missile.heading) * travel;
    missile.y += Math.sin(missile.heading) * travel;
    missile.flownM += travel;
    if (target && targetIsInFlightMissile && distance(missile, target) < 850) {
      // Interceptor PK: base PK modified by target kinematics and defense saturation
      // Sea-skimming targets are harder to engage; supersonic targets reduce engagement window
      const targetSpeed = target.speed || 270;
      const supersonicPenalty = targetSpeed > 600 ? 0.15 : 0;
      const seaSkimPenalty = target.seaSkimming ? 0.14 : 0;
      // Defense saturation: an interceptor is less effective when the local
      // airspace is crowded with inbound threats (discrimination/guidance load).
      // True spatial density of nearby threat (opposite-side) missiles, via the
      // grid — replaces the old same-target-bucket proxy that counted ~nothing.
      const interceptorSide = missile.side;
      const concurrentThreats = countNearbyMissiles(satGrid, missile.x, missile.y, 8 * NM,
        (m) => m.alive && m.side !== interceptorSide);
      const saturationPenalty = Math.max(0, (concurrentThreats - 2) * 0.04);
      const interceptChance = clamp(
        spec.pk + (missile.terminal ? 0.06 : 0) - supersonicPenalty - seaSkimPenalty - saturationPenalty,
        0.10,
        0.65
      );
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
          target.alive = false;
          target.speed = 0;
          markContactDead(sim, target.id);
          sim._entityIndexesDirty = true;
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
    const speedPenalty = (inbound.speed > 680 ? 0.12 : 0); // supersonic penalty
    const pKill = clamp(basePk * saturationRatio - seaSkimPenalty - damagePenalty - speedPenalty, 0.06, 0.72);
    if (sim.rng.next() < pKill) {
      deactivateMissile(sim, inbound);
      addEvent(sim, `${ship.name} CIWS destroyed incoming ${inbound.missileId}.`, ship.side);
    } else {
      addEvent(sim, `${ship.name} CIWS failed against ${inbound.missileId}.`, ship.side);
    }
  }
}
