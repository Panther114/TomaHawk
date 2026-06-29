// Weapons and combat resolution: launch queueing/pacing, force-level defensive
// and offensive fire planning, missile flight and guidance, hit/intercept
// resolution, subsystem damage, and the terminal CIWS layer.

import { NM, SIDE, FLEET_ROLE, WEAPON_STATE } from "./constants.js";
import { clamp, distance, angleTo, wrapAngle, interceptPoint, entityVelocity } from "./math.js";
import { MISSILES, missileDisplayRole } from "./missiles.js";
import { availableCount, setAvailableCount, defaultLoadout, defaultRoe } from "./ships.js";
import { addEvent } from "./events.js";
import { currentTrack, markContactDead } from "./sensors.js";
import { AIRCRAFT_TEMP_CONFIG } from "./aircraft.js";
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
  if (sim.time - lastTypeLaunch < spec.launchIntervalS) return false;
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
    launcher.nextLaunchAt = sim.time + spec.launchIntervalS;
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
      if (sim.time < Math.max(order.readyAt, queueReadyAt) || sim.time - lastTypeLaunch < spec.launchIntervalS) continue;
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
  const countsBySide = new Map();
  const queuedByTarget = new Map();
  const activeTargetsBySide = new Map();
  const queuedTargetsByLauncher = new Map();
  const defensiveCountsByLauncher = new Map();
  const solutionsByTarget = new Map();
  const bestLocalMissileTracks = new Map([[SIDE.BLUE, new Map()], [SIDE.RED, new Map()]]);
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
  let count = 0;
  for (const missile of sim._missilesByTarget?.get(ship.id) ?? []) {
    if (missile.alive && missile.side !== ship.side) count++;
  }
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
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateRangeFit = rangeM <= MISSILES[candidate].preferredMaxRangeM ? 0 : 1;
    const bestRangeFit = rangeM <= MISSILES[best].preferredMaxRangeM ? 0 : 1;
    const comparison = candidateRangeFit - bestRangeFit || MISSILES[candidate].rangeM - MISSILES[best].rangeM;
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
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateFit = rangeM <= MISSILES[candidate].preferredMaxRangeM ? 0 : 1;
    const bestFit = rangeM <= MISSILES[best].preferredMaxRangeM ? 0 : 1;
    const comparison = candidateFit - bestFit || MISSILES[candidate].rangeM - MISSILES[best].rangeM;
    if (comparison < 0) best = candidate;
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
        const weapon = chooseDefensiveWeapon(sim, defender, missile, {
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
      const desired = Math.max(
        posture.mode === "saturate" ? 3 : 1,
        Math.min(
          posture.mode === "saturate" ? 16 : 12,
          Math.round(desiredBase)
        )
      );
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
          const count = Math.min(MISSILES[weapon].salvo + salvoBonus, state.desired - alreadyAssigned, availableCount(shooter, weapon));
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
  sim._engagementIndex = buildEngagementIndex(sim);
  computeFleetCommand(sim);
  planDefensiveFires(sim);
  planOffensiveFires(sim);
  for (const ship of sim.ships) {
    if (ship.alive) ship.lastFirePlanAt = sim.time;
  }
  sim._engagementIndex = null;
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
function airDefenseHitChance(sim, missile, spec, target) {
  const cfg = AIRCRAFT_TEMP_CONFIG;
  if (spec.guidance === "infrared" && (target.flares ?? 0) > 0 && (target.evading || missile.terminal)) {
    target.flares -= 1;
    if (sim.rng.next() < cfg.flareDecoyChance) {
      addEvent(sim, `${target.name} decoyed ${missile.missileId} with flares.`, target.side);
      return { decoyed: true, pk: 0 };
    }
  }
  let pk = spec.pk - cfg.evasionBase;
  if (target.evading) pk -= cfg.evasionManeuver;
  pk += missile.terminal ? 0.10 : 0;
  return { decoyed: false, pk: clamp(pk, 0.03, 0.7) };
}

export function updateMissiles(sim, dt) {
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
      // Defense saturation: when many threats arrive simultaneously, each interceptor is less effective
      let concurrentThreats = 0;
      for (const candidate of sim._missilesByTarget?.get(missile.targetId) ?? []) {
        if (candidate.alive && candidate.side !== missile.side && distance(candidate, missile) < 8 * NM) concurrentThreats++;
      }
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
    let terminalCount = 0;
    for (const missile of sim._missilesByTarget?.get(ship.id) ?? []) {
      if (missile.alive && missile.side !== ship.side && missile.terminal && distance(ship, missile) < 3 * NM) terminalCount++;
    }
    // Saturation: multiple simultaneous leakers divide CIWS attention
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
