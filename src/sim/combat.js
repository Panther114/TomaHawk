// Weapons and combat resolution: launch queueing/pacing, force-level defensive
// and offensive fire planning, missile flight and guidance, hit/intercept
// resolution, subsystem damage, and the terminal CIWS layer.

import { NM, SIDE, FLEET_ROLE, WEAPON_STATE } from "./constants.js";
import { clamp, distance, angleTo, wrapAngle, interceptPoint, entityVelocity } from "./math.js";
import { MISSILES } from "./missiles.js";
import { availableCount, setAvailableCount, defaultLoadout, defaultRoe } from "./ships.js";
import { addEvent } from "./events.js";
import {
  forceTrack,
  inSector,
  computeFleetCommand,
  offensiveTargetValue,
  offensiveCommitWindowS,
  offensiveAllocationsPerCycle,
  coordinatedRaidDelayS
} from "./command.js";

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
    }, missileId, i)) queued++;
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
  sim.missiles.push(missile);
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
    const ordered = ship.launchQueue
      .map((order, index) => ({ order, index }))
      .sort((a, b) => (a.order.priority ?? 50) - (b.order.priority ?? 50)
        || a.order.readyAt - b.order.readyAt
        || a.index - b.index);
    for (const { order, index } of ordered) {
      if (launchMissile(sim, ship, order)) {
        ship.launchQueue.splice(index, 1);
        break;
      }
    }
  }
}

function timeToImpact(missile, target) {
  if (!target || missile.speed <= 0) return Infinity;
  return distance(missile, target) / missile.speed;
}

function hasPendingOrActiveEngagement(sim, ship, targetId) {
  return sim.missiles.some((m) => m.alive && m.side === ship.side && m.targetId === targetId)
    || (ship.launchQueue || []).some((order) => order.targetId === targetId);
}

function shipThreatEngagementCount(sim, ship, targetId) {
  const active = sim.missiles.filter((m) => (
    m.alive
    && m.side === ship.side
    && m.launcherId === ship.id
    && m.targetId === targetId
    && MISSILES[m.missileId]?.target !== "ship"
  )).length;
  const queued = (ship.launchQueue || []).filter((order) => (
    order.targetId === targetId
    && MISSILES[order.missileId]?.target !== "ship"
  )).length;
  return active + queued;
}

function countSideWeaponsOnTarget(sim, side, targetId, missileId = null) {
  const active = sim.missiles.filter((m) => (
    m.alive
    && m.side === side
    && m.targetId === targetId
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
  return sim._missilesByTarget?.get(ship.id)?.filter((m) => m.side !== ship.side).length ?? 0;
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
  const solutions = [];
  for (const interceptor of sim.missiles) {
    if (!interceptor.alive || interceptor.side !== side || interceptor.targetId !== missile.id) continue;
    const spec = MISSILES[interceptor.missileId];
    if (!spec || (spec.target !== "missile" && spec.target !== "dual")) continue;
    solutions.push({
      launcherId: interceptor.launcherId,
      weaponId: interceptor.missileId,
      etaS: timeToImpact(interceptor, missile),
      active: true
    });
  }
  for (const ship of sim.ships) {
    if (!ship.alive || ship.side !== side) continue;
    for (const order of ship.launchQueue || []) {
      if (order.targetId !== missile.id) continue;
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
  }
  solutions.sort((a, b) => a.etaS - b.etaS);
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
  const earliestEta = viableSolutions[0]?.etaS ?? Infinity;
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
  const candidates = ["SM-6", "MaritimeStrike", "TomahawkBlockV"].filter((id) => {
    const reserve = allowReserve ? 0 : id === "SM-6" ? Math.ceil(defaultLoadout(hull)[id] * (MISSILES[id].magazineReserveRatio || 0)) : 0;
    if (!ship.loadout[id] || ship.loadout[id] <= reserve) return false;
    if (rangeM > MISSILES[id].rangeM) return false;
    // SM-6 dual-role: prefer using as area defense unless magazine is plentiful
    if (id === "SM-6" && !allowReserve && ship.loadout[id] < (aggression > 0.72 ? 6 : 10)) return false;
    return true;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const aRangeFit = rangeM <= MISSILES[a].preferredMaxRangeM ? 0 : 1;
    const bRangeFit = rangeM <= MISSILES[b].preferredMaxRangeM ? 0 : 1;
    return aRangeFit - bRangeFit || MISSILES[a].rangeM - MISSILES[b].rangeM;
  });
  return candidates[0];
}

export function chooseDefensiveWeapon(sim, ship, threat, options = {}) {
  const target = sim.ships.find((s) => s.id === threat.targetId && s.alive);
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
  const target = sim.ships.find((s) => s.id === missile.targetId && s.alive);
  const tti = threatTimeToImpact(missile, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  return (missile.terminal ? 80 : 0) + clamp(90 - tti, 0, 90) + raidCount * 14 + (target?.damage || 0) * 12;
}

function bestMissileTrackForSide(sim, side, missileId) {
  let best = forceTrack(sim, side, missileId) ?? null;
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
    const observedThreats = (sim._aliveMissiles || sim.missiles.filter((m) => m.alive))
      .filter((missile) => missile.side !== side)
      .map((missile) => {
        const track = bestMissileTrackForSide(sim, side, missile.id);
        if (!track) return null;
        return { missile, track, score: missileThreatScore(sim, missile) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    for (const { missile, track, score } of observedThreats) {
      const target = sim.ships.find((s) => s.id === missile.targetId && s.alive);
      if (!target || target.side !== side) continue;
      const need = defensiveNeedProfile(sim, side, missile, track, target);
      const formationMax = sim.ships
        .filter((ship) => ship.alive && ship.side === side)
        .reduce((max, ship) => Math.max(max, ship.defenseDoctrine?.maxAssignedInterceptors ?? 2), 1);
      const desired = Math.max(1, Math.min(formationMax + 1, Math.max(need.desired, score > 105 || missile.terminal || track.quality < 0.42 ? 2 : 1)));
      let assigned = assignedInterceptorsForThreat(sim, side, missile.id);
      if (assigned >= desired) continue;
      // Defender priority: the unit that owns the AAW sector the observed
      // threat is in engages first, then the ship under attack, then nearest.
      const defenders = sim.ships
        .filter((ship) => ship.alive && ship.side === side)
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
  const own = ship.tracks.get(target.id);
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
  const ships = sim.ships.filter((ship) => ship.alive);
  for (const side of [SIDE.BLUE, SIDE.RED]) {
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
      .filter((ship) => ship.side === side && sim.time >= ship.reactionAvailableAt)
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
          const targetShip = sim.ships.find((target) => target.id === item.track.id && target.alive);
          if (!targetShip) continue;
          const track = bestTrackForShip(sim, shooter, targetShip);
          if (!track) continue;
          const targetScore = state.score;
          const targetAllowReserve = allowReserve || shooterAggression > 0.72 || targetScore > 120;
          const weapon = chooseAntiShipWeapon(shooter, track, targetAllowReserve, shooterAggression);
          if (!weapon) continue;
          const alreadyAssigned = countSideWeaponsOnTarget(sim, side, item.track.id);
          if (alreadyAssigned >= state.desired) continue;
          const ownPending = (shooter.launchQueue || []).some((order) => order.targetId === item.track.id && MISSILES[order.missileId]?.category === "anti_ship")
            || sim.missiles.some((m) => m.alive && m.launcherId === shooter.id && m.targetId === item.track.id && MISSILES[m.missileId]?.category === "anti_ship");
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
  computeFleetCommand(sim);
  planDefensiveFires(sim);
  planOffensiveFires(sim);
  for (const ship of sim.ships) {
    if (ship.alive) ship.lastFirePlanAt = sim.time;
  }
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
  const controller = sim.ships.find((s) => s.id === missile.launcherId);
  const roe = controller?.roe ?? defaultRoe();
  missile.alive = false;
  if (roe.selfDestructOnTargetLoss) {
    addEvent(sim, `${missile.missileId} received a midcourse abort and self-destructed after its target was destroyed.`, missile.side);
  } else {
    addEvent(sim, `${missile.missileId} lost its target and fell into the sea.`, missile.side);
  }
  return false;
}

export function updateMissiles(sim, dt) {
  for (const missile of sim.missiles) {
    if (!missile.alive) continue;
    const spec = MISSILES[missile.missileId];
    // Dual-role missiles (SM-6) can target either ships or missiles
    const isDual = spec.target === "dual";
    let target = spec.target === "missile"
      ? sim.missiles.find((m) => m.id === missile.targetId && m.alive)
      : isDual
        ? (sim.ships.find((s) => s.id === missile.targetId && s.alive) ||
           sim.missiles.find((m) => m.id === missile.targetId && m.alive))
        : sim.ships.find((s) => s.id === missile.targetId && s.alive);

    // Target killed in flight (sunk, or threat intercepted by someone else):
    // abort or self-destruct — never coast on a dead datum.
    if (!target) {
      if (!handleTargetLoss(sim, missile, spec)) continue;
      target = spec.target === "missile"
        ? sim.missiles.find((m) => m.id === missile.targetId && m.alive)
        : isDual
          ? (sim.ships.find((s) => s.id === missile.targetId && s.alive) ||
             sim.missiles.find((m) => m.id === missile.targetId && m.alive))
        : sim.ships.find((s) => s.id === missile.targetId && s.alive);
      if (!target) { missile.alive = false; continue; }
    }

    const distToTarget = distance(missile, target);
    missile.timeToImpactEstimate = timeToImpact(missile, target);
    // Terminal phase determination: dual-role uses target type to decide
    const isAntiShipTarget = spec.category === "anti_ship" || (isDual && target.speed !== undefined && target.id?.startsWith && !target.id.startsWith("M-"));
    const isInterceptorTarget = spec.target === "missile" || (isDual && target.speed !== undefined && target.id?.startsWith && target.id.startsWith("M-"));
    if (isAntiShipTarget && distToTarget < spec.seekerRangeM) {
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "terminal attack phase";
      missile.seaSkimming = true;
    } else if (isInterceptorTarget && distToTarget < 4 * NM) {
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
    const aimIsShip = spec.target === "ship" || (isDual && isAntiShipTarget);
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
    // Hit resolution: determine target type for dual-role missiles
    const targetIsMissile = spec.target === "missile" || (isDual && isInterceptorTarget);
    const targetIsShip = spec.target === "ship" || (isDual && isAntiShipTarget);
    if (target && targetIsMissile && distance(missile, target) < 850) {
      // Interceptor PK: base PK modified by target kinematics and defense saturation
      // Sea-skimming targets are harder to engage; supersonic targets reduce engagement window
      const targetSpeed = target.speed || 270;
      const supersonicPenalty = targetSpeed > 600 ? 0.15 : 0;
      const seaSkimPenalty = target.seaSkimming ? 0.14 : 0;
      // Defense saturation: when many threats arrive simultaneously, each interceptor is less effective
      const concurrentThreats = (sim._missilesByTarget?.get(missile.targetId) || [])
        .filter((m) => m.side !== missile.side && distance(m, missile) < 8 * NM).length;
      const saturationPenalty = Math.max(0, (concurrentThreats - 2) * 0.04);
      const interceptChance = clamp(
        spec.pk + (missile.terminal ? 0.06 : 0) - supersonicPenalty - seaSkimPenalty - saturationPenalty,
        0.10,
        0.65
      );
      if (sim.rng.next() < interceptChance) {
        target.alive = false;
        addEvent(sim, `${missile.missileId} intercepted incoming ${target.missileId}.`, missile.side);
      } else {
        addEvent(sim, `${missile.missileId} failed to intercept ${target.missileId}.`, missile.side);
      }
      missile.alive = false;
    } else if (target && targetIsShip && distance(missile, target) < 420) {
      // Hit chance: base PK modified by terminal phase, sea state, target damage
      // Large ships (BBG) are easier to hit, fast/maneuvering ships harder
      const maneuverPenalty = target.speed > 12 ? 0.06 : 0;
      const sizeBonus = Math.min(0.08, (target.displacementT || 9200) / 200000);
      const hitChance = clamp(
        spec.pk + (missile.terminal ? 0.18 : 0) - target.damage * 0.03 + sizeBonus - maneuverPenalty,
        0.10, 0.88
      );
      if (sim.rng.next() < hitChance) {
        target.damage += 1;
        // Subsystem damage: each hit degrades random subsystems
        applySubsystemDamage(sim, target);
        const damageShown = Math.max(0, Math.round(target.damage));
        const resistShown = Math.max(1, Math.ceil(target.damageResist ?? 3.0));
        addEvent(sim, `${target.name} hit by ${missile.missileId}. Damage: ${damageShown}/${resistShown}.`, missile.side);
        // Mission kill at per-class damageResist threshold
        if (target.damage >= (target.damageResist ?? 3.0)) {
          target.alive = false;
          target.speed = 0;
          addEvent(sim, `${target.name} mission-killed — ${damageShown} hits sustained (class limit ${resistShown}).`, missile.side);
        }
      } else {
        addEvent(sim, `${missile.missileId} missed ${target.name}.`, missile.side);
      }
      missile.alive = false;
    }
    if (missile.flownM > missile.maxRangeM) {
      missile.alive = false;
      addEvent(sim, `${missile.missileId} exhausted fuel and fell into the sea.`, missile.side);
    }
  }
  sim.missiles = sim.missiles.filter((m) => m.alive);
}

export function pointDefense(sim) {
  for (const ship of sim.ships) {
    if (!ship.alive || ship.ciwsCooldown > 0 || ship.ciwsAmmo <= 0 || sim.time < ship.nextCiwsAt) continue;
    if (!(ship.roe?.ciwsRelease ?? true)) continue;
    const ciwsRange = 1.6 * NM;
    const inbound = sim.missiles
      .filter((m) => m.alive && m.side !== ship.side && m.targetId === ship.id && m.terminal && distance(ship, m) < ciwsRange)
      .sort((a, b) => (a.timeToImpactEstimate ?? Infinity) - (b.timeToImpactEstimate ?? Infinity))[0];
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
    const terminalCount = (sim._missilesByTarget?.get(ship.id) || [])
      .filter((m) => m.side !== ship.side && m.terminal && distance(ship, m) < 3 * NM).length;
    // Saturation: multiple simultaneous leakers divide CIWS attention
    const saturationRatio = Math.min(1, ciwsCount / Math.max(1, terminalCount));
    const seaSkimPenalty = inbound.seaSkimming ? 0.18 : 0;
    const damagePenalty = ship.damage * 0.06;
    const speedPenalty = (inbound.speed > 680 ? 0.12 : 0); // supersonic penalty
    const pKill = clamp(basePk * saturationRatio - seaSkimPenalty - damagePenalty - speedPenalty, 0.06, 0.72);
    if (sim.rng.next() < pKill) {
      inbound.alive = false;
      addEvent(sim, `${ship.name} CIWS destroyed incoming ${inbound.missileId}.`, ship.side);
    } else {
      addEvent(sim, `${ship.name} CIWS failed against ${inbound.missileId}.`, ship.side);
    }
  }
}
