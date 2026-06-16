// Force-level command: the fused Cooperative Engagement (CEC) picture, the
// scoring helpers that estimate own/enemy strength from observation only, and
// the per-side command posture (OTC/AAWC roles, AAW sectors, aggressiveness,
// strike mode, target breadth, raid depth).

import { SIDE, FLEET_ROLE, NM } from "./constants.js";
import { clamp, wrapAngle } from "./math.js";
import { defaultLoadout, vlsCapacity, offensiveMissileCount } from "./ships.js";

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
export function buildForcePicture(sim) {
  const picture = new Map();
  for (const side of [SIDE.BLUE, SIDE.RED]) picture.set(side, new Map());
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    const fused = picture.get(ship.side);
    if (!fused) continue;
    for (const track of ship.tracks.values()) {
      if (track.side === ship.side) continue;
      const existing = fused.get(track.id);
      if (!existing) {
        fused.set(track.id, {
          id: track.id,
          side: track.side,
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
        continue;
      }
      // Quality-weighted position fusion.
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
  }
  // Composite quality: a contact held by multiple sensors yields a firmer,
  // fire-control-grade track than any single radar.
  for (const fused of picture.values()) {
    for (const track of fused.values()) {
      const netGain = 1 + Math.min(0.25, (track.contributors - 1) * 0.12);
      track.quality = clamp(track.bestQuality * netGain, 0, 0.99);
    }
  }
  sim.forcePicture = picture;
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
  const loadout = defaultLoadout(hull);
  return (loadout.MaritimeStrike ?? 0) + (loadout.TomahawkBlockV ?? 0) + (loadout["SM-6"] ?? 0) * 0.35;
}

function trackHullEstimate(track) {
  const text = String(track?.classification ?? "").toLowerCase();
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

function observedOffensiveCapacity(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (String(track.id).startsWith("M-")) continue;
    const hull = trackHullEstimate(track);
    const prior = offensivePriorForHull(hull || "DDG");
    const quality = clamp(track.quality ?? 0.35, 0.05, 0.99);
    total += prior * (0.55 + 0.45 * quality);
  }
  return total;
}

function observedVlsCapacity(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (String(track.id).startsWith("M-")) continue;
    total += estimatedVlsCapacity(track);
  }
  return total;
}

function observedMissilePressure(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (!String(track.id).startsWith("M-")) continue;
    if (track.side === side) continue;
    total += 1;
  }
  return total;
}

export function offensiveTargetValue(track) {
  const hull = trackHullEstimate(track);
  const hullBase = hull === "BBG" ? 110 : hull === "CCG" ? 82 : hull === "DDG" ? 52 : hull === "FFG" ? 34 : 44;
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

function observedHostileUnitCount(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (track.side === side || String(track.id).startsWith("M-")) continue;
    total += 1;
  }
  return total;
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
    const ordered = [...ships].sort((a, b) => fleetCapability(b) - fleetCapability(a) || a.id.localeCompare(b.id));
    const otc = ordered[0];
    otc.isOTC = true;
    otc.fleetRole = FLEET_ROLE.OTC;
    // Second most capable acts as dedicated AAW commander when available.
    if (ordered[1]) ordered[1].fleetRole = FLEET_ROLE.AAWC;

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

    // Split AAW sectors around the threat axis among the units; the OTC owns
    // the central sector straddling the axis.
    const n = ships.length;
    const sectorWidth = (2 * Math.PI) / Math.max(1, n);
    const stationRing = 6 * NM; // screen radius around the guide
    const sectorOrder = [otc, ...ordered.slice(1)];
    sectorOrder.forEach((ship, idx) => {
      // idx 0 (OTC) -> centred on axis; others fan out alternately.
      const slot = idx === 0 ? 0 : (idx % 2 === 1 ? Math.ceil(idx / 2) : -Math.ceil(idx / 2));
      ship.sectorCenter = wrapAngle(axis + slot * sectorWidth);
      ship.sectorHalfWidth = sectorWidth / 2 + 0.12;
      // Formation station: ring around the guide on the threat side.
      if (ship === otc) {
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
    const enemyOffenseEstimate = observedOffensiveCapacity(sim, side);
    const enemyVlsEstimate = observedVlsCapacity(sim, side);
    const missilePressure = observedMissilePressure(sim, side);
    const observedTargets = observedHostileUnitCount(sim, side);
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
    command.set(side, { otc, aawc: ordered[1] || null, axis, ships });
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
