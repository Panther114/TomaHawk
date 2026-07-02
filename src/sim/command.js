// Force-level command: the fused Cooperative Engagement (CEC) picture, the
// scoring helpers that estimate own/enemy strength from observation only, and
// the per-side command posture (OTC/AAWC roles, AAW sectors, aggressiveness,
// strike mode, target breadth, raid depth).

import { SIDE, FLEET_ROLE, NM } from "./constants.js";
import { clamp, wrapAngle } from "./math.js";
import { defaultLoadout, vlsCapacity, offensiveMissileCount } from "./ships.js";
import { currentTrack } from "./sensors.js";

const offensivePriorCache = new Map();

// Threat weight of an observed enemy aircraft squadron in the force estimate.
// Smaller than a destroyer's strike prior (a flight throws a modest salvo) but
// non-trivial. Provisional — tune alongside the air-unit model.
const AIR_OFFENSE_PRIOR = 12;

// ---------------------------------------------------------------------------
// Cooperative Engagement Capability (CEC) — composite fire-control tracks.
//
// Every alive ship on a side contributes its perceived track files to a single
// fused force picture. Reports of the same contact are combined into one
// composite track: position is a quality-weighted average of all reporting
// sensors, the velocity estimate comes from the firmest report, and the fused
// quality is boosted above any single sensor (sensor-netting / track-quality
// build-up). This is what lets one ship launch on another ship's track
// (engage-on-remote) and what feeds missile mid-course datalink updates.
// ---------------------------------------------------------------------------
function mergeTrack(fused, track) {
  const existing = fused.get(track.id);
  if (!existing) {
    fused.set(track.id, {
      id: track.id,
      side: track.side,
      domain: track.domain ?? "sea",
      classification: track.classification,
      x: track.x,
      y: track.y,
      vx: track.vx ?? 0,
      vy: track.vy ?? 0,
      quality: track.quality,
      uncertainty: track.uncertainty,
      weight: Math.max(0.05, track.quality),
      contributors: 1,
      bestQuality: track.quality
    });
    return;
  }
  const w = Math.max(0.05, track.quality);
  const totalW = existing.weight + w;
  existing.x = (existing.x * existing.weight + track.x * w) / totalW;
  existing.y = (existing.y * existing.weight + track.y * w) / totalW;
  existing.weight = totalW;
  existing.contributors += 1;
  existing.uncertainty = Math.min(existing.uncertainty, track.uncertainty);
  if (track.quality > existing.bestQuality) {
    existing.bestQuality = track.quality;
    existing.vx = track.vx ?? 0;
    existing.vy = track.vy ?? 0;
    existing.classification = track.classification;
  }
}

function finalizeFusedTrack(track) {
  const netGain = 1 + Math.min(0.25, (track.contributors - 1) * 0.12);
  track.quality = clamp(track.bestQuality * netGain, 0, 0.99);
}

export function buildForcePicture(sim, { dirtyOnly = false } = {}) {
  const dirtyIds = sim._dirtyTrackIds;
  const picture = dirtyOnly && sim.forcePicture && dirtyIds?.size
    ? sim.forcePicture
    : new Map([[SIDE.BLUE, new Map()], [SIDE.RED, new Map()]]);
  if (picture.size === 0) {
    picture.set(SIDE.BLUE, new Map());
    picture.set(SIDE.RED, new Map());
  }
  if (dirtyOnly && dirtyIds?.size) {
    for (const fused of picture.values()) {
      for (const id of dirtyIds) fused.delete(id);
    }
  }
  if (dirtyOnly && dirtyIds?.size && sim._trackHolders) {
    for (const id of dirtyIds) {
      for (const ship of sim._trackHolders.get(id) ?? []) {
        if (!ship.alive) continue;
        const rawTrack = ship.tracks.get(id);
        if (!rawTrack) continue;
        const track = currentTrack(rawTrack, sim.time);
        if (track.side === ship.side) continue;
        mergeTrack(picture.get(ship.side), track);
      }
    }
  } else {
    for (const ship of sim.ships) {
      if (!ship.alive) continue;
      const fused = picture.get(ship.side);
      if (!fused) continue;
      for (const rawTrack of ship.tracks.values()) {
        const track = currentTrack(rawTrack, sim.time);
        if (track.side === ship.side) continue;
        mergeTrack(fused, track);
      }
    }
  }
  // Composite quality: a contact held by multiple sensors yields a firmer,
  // fire-control-grade track than any single radar.
  for (const fused of picture.values()) {
    if (dirtyOnly && dirtyIds?.size) {
      for (const id of dirtyIds) {
        const track = fused.get(id);
        if (track) finalizeFusedTrack(track);
      }
    } else {
      for (const track of fused.values()) finalizeFusedTrack(track);
    }
  }
  sim.forcePicture = picture;
  dirtyIds?.clear();
  return picture;
}

export function forceTrack(sim, side, targetId) {
  return sim.forcePicture?.get(side)?.get(targetId) ?? null;
}

// ---------------------------------------------------------------------------
// Fleet command hierarchy, AAW sector responsibility, and formation stations.
//
// Each side designates the most capable surviving unit as Officer in Tactical
// Command (OTC) and air-defence guide. Remaining units take screen stations
// around the guide. The threat axis (mean bearing to known hostiles, or toward
// the enemy fleet if no contacts) anchors a set of AAW sectors that are split
// among the units so each owns a slice of sky, with the OTC covering the
// threat axis itself.
// ---------------------------------------------------------------------------
function fleetCapability(ship) {
  const sm2 = ship.loadout["SM-2MR"] ?? 0;
  const essm = ship.loadout.ESSM ?? 0;
  // Class-based multiplier: cruisers are prime AAW, BBG has massive channels
  const classMult = ship.hull === "CCG" ? 1.3 : ship.hull === "BBG" ? 1.5 : ship.hull === "FFG" ? 0.7 : 1.0;
  return (sm2 * 1 + essm * 0.3) * classMult - ship.damage * 8;
}

function offensivePriorForHull(hull) {
  if (offensivePriorCache.has(hull)) return offensivePriorCache.get(hull);
  const loadout = defaultLoadout(hull);
  const prior = (loadout.MaritimeStrike ?? 0) + (loadout.TomahawkBlockV ?? 0) + (loadout["SM-6"] ?? 0) * 0.35;
  offensivePriorCache.set(hull, prior);
  return prior;
}

function trackHullEstimate(track) {
  const text = String(track?.classification ?? "").toLowerCase();
  // Ground emplacements first — their class strings contain words ("battery",
  // "coastal") that would otherwise mis-match naval patterns.
  if (/\bsam\b|coastal sam/.test(text)) return "SAM";
  if (/early.?warn|\bewr\b|radar/.test(text)) return "EWR";
  if (/coastal defense|coastal defence|defense battery|defence battery|\bcdb\b/.test(text)) return "CDB";
  if (/battleship|trump|bbg/.test(text)) return "BBG";
  if (/cruiser|ticonderoga|ccg|cg/.test(text)) return "CCG";
  if (/frigate|constellation|ffg/.test(text)) return "FFG";
  if (/destroyer|burke|ddg/.test(text)) return "DDG";
  if (/surface combatant/.test(text)) return "DDG";
  return null;
}

function estimatedVlsCapacity(track) {
  const hull = trackHullEstimate(track) || "DDG";
  const quality = clamp(track?.quality ?? 0.35, 0.05, 0.99);
  return offensivePriorForHull(hull) * (0.7 + quality * 0.45);
}

export function offensiveTargetValue(track) {
  // Air platforms (squadrons) are priority air-defence targets: killing the
  // shooter is worth more than chasing its missiles. Valued on track firmness.
  if (track?.domain === "air") {
    const quality = clamp(track?.quality ?? 0.35, 0.05, 0.99);
    const uncertaintyPenalty = Math.min(18, (track?.uncertainty ?? 0) / NM * 0.75);
    return 78 + quality * 34 - uncertaintyPenalty;
  }
  const hull = trackHullEstimate(track);
  // Ground emplacements are high-priority strike targets: killing the radar
  // blinds the coast, killing the SAM opens the strike lane, the battery is a
  // direct anti-ship threat.
  const hullBase = hull === "BBG" ? 110 : hull === "CCG" ? 82 : hull === "DDG" ? 52 : hull === "FFG" ? 34
    : hull === "EWR" ? 95 : hull === "SAM" ? 88 : hull === "CDB" ? 70 : 44;
  const offense = offensivePriorForHull(hull || "DDG");
  const quality = clamp(track?.quality ?? 0.35, 0.05, 0.99);
  const certainty = quality * 30;
  const uncertaintyPenalty = Math.min(18, (track?.uncertainty ?? 0) / NM * 0.75);
  return hullBase + offense * 0.95 + certainty - uncertaintyPenalty;
}

export function offensiveCommitWindowS(posture, shooterAggression) {
  const aggression = clamp(0.55 * (posture?.aggression ?? 0.5) + 0.45 * shooterAggression, 0.15, 0.98);
  const modeBias = posture?.mode === "saturate" ? -0.55 : posture?.mode === "pressure" ? -0.2 : posture?.mode === "survive" ? 0.35 : 0;
  return clamp(4.1 - aggression * 3.1 + modeBias, 0.65, 4.2);
}

export function offensiveAllocationsPerCycle(posture, shooterAggression) {
  const aggression = clamp(0.55 * (posture?.aggression ?? 0.5) + 0.45 * shooterAggression, 0.15, 0.98);
  const advantage = posture?.advantage ?? 0;
  if (posture?.mode === "saturate") return aggression > 0.84 ? 4 : 3;
  if (posture?.mode === "pressure") return aggression > 0.7 || advantage > 0.12 ? 2 : 1;
  if (aggression > 0.86 || (aggression > 0.78 && advantage > 0.22)) return 3;
  if (aggression > 0.66 || advantage > 0.12) return 2;
  return 1;
}

export function coordinatedRaidDelayS(posture, trackCount, scoreShare) {
  const mode = posture?.mode ?? "focus";
  if (mode === "saturate") return clamp(0.55 + (trackCount - 1) * 0.18 - scoreShare * 0.25, 0.35, 1.2);
  if (mode === "pressure") return clamp(0.9 + (trackCount - 1) * 0.2 - scoreShare * 0.15, 0.65, 1.6);
  if (mode === "focus") return clamp(1.15 + (trackCount - 1) * 0.22 - scoreShare * 0.12, 0.85, 1.9);
  return clamp(1.45 + (trackCount - 1) * 0.22, 1.0, 2.2);
}

function observedForceMetrics(sim, side) {
  const fused = sim.forcePicture?.get(side);
  const metrics = { offense: 0, vls: 0, missilePressure: 0, targets: 0 };
  if (!fused) return metrics;
  for (const track of fused.values()) {
    if (track.side === side) continue;
    if (String(track.id).startsWith("M-")) {
      metrics.missilePressure += 1;
      continue;
    }
    const quality = clamp(track.quality ?? 0.35, 0.05, 0.99);
    if (track.domain === "air") {
      // Enemy aircraft carry strike weapons (a real offensive threat) but no VLS
      // magazine — counting them as a destroyer would over-state enemy strength.
      metrics.offense += AIR_OFFENSE_PRIOR * (0.55 + 0.45 * quality);
      metrics.targets += 1;
      continue;
    }
    const hull = trackHullEstimate(track) || "DDG";
    metrics.offense += offensivePriorForHull(hull) * (0.55 + 0.45 * quality);
    metrics.vls += estimatedVlsCapacity(track);
    metrics.targets += 1;
  }
  return metrics;
}

function selectCommandMode(prevMode, aggression, advantage, ownOffense, enemyEstimate, missilePressure, observedTargets) {
  const pressurePerTrack = missilePressure / Math.max(1, observedTargets || 1);
  if (prevMode === "saturate") {
    if (aggression > 0.56 && advantage > 0.02 && ownOffense > Math.max(8, enemyEstimate * 0.55)) return "saturate";
  }
  if (prevMode === "pressure") {
    if (aggression > 0.44 && advantage > -0.04 && ownOffense > Math.max(4, enemyEstimate * 0.4)) return "pressure";
  }
  if (aggression > 0.74 && advantage > 0.16 && ownOffense > Math.max(8, enemyEstimate * 0.85) && pressurePerTrack < 2.8) {
    return "saturate";
  }
  if (aggression > 0.52 && advantage > 0.02 && ownOffense > Math.max(4, enemyEstimate * 0.55)) {
    return "pressure";
  }
  if (aggression < 0.24 || (advantage < -0.22 && pressurePerTrack > 1.2)) return "survive";
  return "focus";
}

export function computeFleetCommand(sim) {
  const bySide = new Map();
  const commandState = new Map();
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (!bySide.has(ship.side)) bySide.set(ship.side, []);
    bySide.get(ship.side).push(ship);
    ship.isOTC = false;
    ship.fleetRole = FLEET_ROLE.UNIT;
  }
  const command = new Map();
  for (const [side, ships] of bySide) {
    // Deterministic OTC selection: most air-defence capability, ties by id.
    // The guide must be mobile (it anchors the moving formation), so fixed
    // ground emplacements are never chosen as OTC/AAWC unless no sea unit
    // survives on the side.
    const ordered = [...ships].sort((a, b) => fleetCapability(b) - fleetCapability(a) || a.id.localeCompare(b.id));
    // The guide anchors the surface formation, so it must be a mobile surface
    // combatant — never a fixed emplacement and never an air squadron.
    const mobileOrdered = ordered.filter((ship) => !ship.isFixed && ship.domain !== "air");
    const otc = mobileOrdered[0] ?? ordered[0];
    otc.isOTC = true;
    otc.fleetRole = FLEET_ROLE.OTC;
    // Second most capable mobile unit acts as dedicated AAW commander.
    const aawc = mobileOrdered.find((ship) => ship !== otc) ?? ordered.find((ship) => ship !== otc) ?? null;
    if (aawc) aawc.fleetRole = FLEET_ROLE.AAWC;

    // Threat axis: mean bearing from the formation guide to fused hostiles.
    const fused = sim.forcePicture?.get(side);
    let axis = side === SIDE.BLUE ? 0 : Math.PI;
    if (fused && fused.size) {
      let sx = 0;
      let sy = 0;
      for (const track of fused.values()) {
        const ang = Math.atan2(track.y - otc.y, track.x - otc.x);
        sx += Math.cos(ang);
        sy += Math.sin(ang);
      }
      if (sx !== 0 || sy !== 0) axis = Math.atan2(sy, sx);
    }

    // Split AAW sectors around the threat axis among the air-defence units.
    // Aircraft are mobile strikers, not sectorised air-defence pickets, so they
    // are excluded from the sector division and own no sector (a full-circle
    // half-width disables the sector overlay for them) and no formation station.
    // Derive from `ordered` (capability-sorted) so the non-air ordering — and
    // thus every sector assignment — is byte-identical to the pre-air behaviour
    // when no aircraft are present.
    const sectorShips = ordered.filter((ship) => ship.domain !== "air");
    for (const ship of ships) {
      if (ship.domain === "air") {
        ship.sectorCenter = side === SIDE.BLUE ? 0 : Math.PI;
        ship.sectorHalfWidth = Math.PI;
        ship.station = null;
      }
    }
    const n = sectorShips.length;
    const sectorWidth = (2 * Math.PI) / Math.max(1, n);
    const stationRing = 6 * NM; // screen radius around the guide
    const sectorOrder = [otc, ...sectorShips.filter((ship) => ship !== otc)];
    sectorOrder.forEach((ship, idx) => {
      if (ship.domain === "air") return;
      // idx 0 (OTC) -> centred on axis; others fan out alternately.
      const slot = idx === 0 ? 0 : (idx % 2 === 1 ? Math.ceil(idx / 2) : -Math.ceil(idx / 2));
      ship.sectorCenter = wrapAngle(axis + slot * sectorWidth);
      ship.sectorHalfWidth = sectorWidth / 2 + 0.12;
      // Formation station: ring around the guide on the threat side. Fixed
      // emplacements still own an AAW sector but are never given a station to
      // steam to (they cannot move).
      if (ship === otc || ship.isFixed) {
        ship.station = null;
      } else {
        const stationAng = wrapAngle(axis + slot * sectorWidth);
        ship.station = {
          x: otc.x + Math.cos(stationAng) * stationRing,
          y: otc.y + Math.sin(stationAng) * stationRing
        };
      }
    });
    const ownOffense = ships.reduce((sum, ship) => sum + offensiveMissileCount(ship, true), 0);
    const ownVls = ships.reduce((sum, ship) => sum + vlsCapacity(ship), 0);
    const observed = observedForceMetrics(sim, side);
    const enemyOffenseEstimate = observed.offense;
    const enemyVlsEstimate = observed.vls;
    const missilePressure = observed.missilePressure;
    const observedTargets = observed.targets;
    const ownPower = ownOffense + ownVls * 0.14;
    const enemyPower = enemyOffenseEstimate + enemyVlsEstimate * 0.14;
    const advantage = clamp(
      (ownPower - enemyPower) / Math.max(1, ownPower + enemyPower),
      -1,
      1
    );
    const rawAggression = clamp(
      0.28 + advantage * 0.74 - (missilePressure / Math.max(1, ships.length)) * 0.1,
      0.08,
      0.98
    );
    const prevState = sim.commandState?.get(side) ?? null;
    const prevAggression = prevState?.aggression ?? rawAggression;
    const aggression = clamp(
      prevAggression + clamp(rawAggression - prevAggression, -0.05, 0.09),
      0.08,
      0.98
    );
    const mode = selectCommandMode(prevState?.mode ?? "focus", aggression, advantage, ownOffense, enemyOffenseEstimate, missilePressure, observedTargets);
    const targetBreadth = mode === "saturate"
      ? Math.max(1, Math.min(3, observedTargets >= 4 ? 3 : observedTargets >= 2 ? 2 : 1))
      : mode === "pressure"
        ? Math.max(1, Math.min(2, observedTargets >= 3 ? 2 : 1))
        : 1;
    const raidDepth = mode === "saturate"
      ? Math.max(6, Math.min(12, Math.round(4 + ships.length * 1.5)))
      : mode === "pressure"
        ? Math.max(4, Math.min(9, Math.round(3 + ships.length)))
        : mode === "focus"
          ? Math.max(3, Math.min(7, Math.round(2 + ships.length * 0.8)))
          : Math.max(1, Math.min(4, Math.round(1 + ships.length * 0.5)));
    commandState.set(side, {
      aggression,
      rawAggression,
      advantage,
      ownOffense,
      ownVls,
      ownPower,
      enemyOffenseEstimate,
      enemyVlsEstimate,
      enemyPower,
      missilePressure,
      observedTargets,
      mode,
      targetBreadth,
      raidDepth
    });
    for (const ship of ships) {
      ship.commandAggression = aggression;
      ship.commandMode = mode;
      ship.commandTargetBreadth = targetBreadth;
      ship.commandRaidDepth = raidDepth;
      ship.commandOwnOffense = ownOffense;
      ship.commandOwnVls = ownVls;
      ship.commandOwnPower = ownPower;
      ship.commandEnemyOffenseEstimate = enemyOffenseEstimate;
      ship.commandEnemyVlsEstimate = enemyVlsEstimate;
      ship.commandEnemyPower = enemyPower;
    }
    command.set(side, { otc, aawc: aawc || null, axis, ships });
  }
  sim.fleetCommand = command;
  sim.commandState = commandState;
  return command;
}

// Does a contact's bearing from the ship fall inside the ship's AAW sector?
export function inSector(ship, point) {
  const bearing = Math.atan2(point.y - ship.y, point.x - ship.x);
  return Math.abs(wrapAngle(bearing - ship.sectorCenter)) <= ship.sectorHalfWidth;
}
