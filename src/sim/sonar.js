import { KNOT, NM } from "./constants.js";
import { addEvent } from "./events.js";
import { clamp, distance3d } from "./math.js";
import { MISSILES } from "./missiles.js";
import { setLocalTrack } from "./sensors.js";

export function initialSonarState(cls) {
  const acousticDecoys = Math.max(0, Math.round(cls.acousticDecoys ?? 0));
  return {
    passiveSonarRangeM: Math.max(0, cls.passiveSonarRangeNm ?? 0) * NM,
    activeSonarRangeM: Math.max(0, cls.activeSonarRangeNm ?? 0) * NM,
    sonarInterval: Math.max(1, cls.sonarIntervalS ?? 6),
    sonarCooldown: 0,
    sonarActive: cls.sonarDefaultOn === true,
    acousticQuieting: clamp(cls.acousticQuieting ?? 0, 0, 0.9),
    acousticDecoys,
    acousticDecoysMax: acousticDecoys,
    nextAcousticDecoyAt: 0
  };
}

export function acousticSignature(unit) {
  const domain = unit?.domain
    ?? ((unit?.medium?.startsWith("underwater") || MISSILES[unit?.missileId]?.medium === "underwater")
      ? "subsurface"
      : "sea");
  const speedKt = Math.max(0, (unit?.speed ?? 0) / KNOT);
  if (domain === "subsurface") {
    const quiet = 1 - clamp(unit.acousticQuieting ?? 0.65, 0, 0.9);
    const machinery = 0.08 + 0.018 * speedKt;
    const cavitation = speedKt > 18 ? Math.pow((speedKt - 18) / 10, 2) * 0.9 : 0;
    return clamp((machinery + cavitation) * quiet, 0.025, 1.4);
  }
  if (domain === "sea") {
    const displacement = clamp((unit?.displacementT ?? 9000) / 12000, 0.35, 3);
    return clamp((0.22 + speedKt * 0.035) * Math.sqrt(displacement), 0.18, 2.5);
  }
  return 0;
}

function isUnderwaterTarget(target) {
  return target?.domain === "subsurface"
    || target?.medium?.startsWith("underwater")
    || MISSILES[target?.missileId]?.medium === "underwater";
}

export function passiveSonarDetectionRange(observer, target) {
  const sonarHealth = clamp(observer?.subsystems?.sonar ?? 1, 0.12, 1);
  const base = (observer?.passiveSonarRangeM ?? 0) * sonarHealth;
  if (!(base > 0)) return 0;
  const signature = acousticSignature(target);
  const activeBonus = target?.sonarActive ? 1.75 : 1;
  const depthFactor = isUnderwaterTarget(target)
    ? clamp(1.05 - (target.depthM ?? 250) / 900, 0.55, 1.05)
    : 1;
  return base * clamp(Math.sqrt(signature) * activeBonus, 0.18, 1.65) * depthFactor;
}

function sonarClassification(target, quality) {
  if (quality > 0.72) return target.className ?? target.missileId;
  if (String(target.id).startsWith("M-")) return "underwater weapon";
  return target.domain === "subsurface" ? "subsurface contact" : "surface contact";
}

function sonarTrack(sim, observer, target, rangeM, detectRangeM, active) {
  const baseQuality = active ? 0.58 : 0.34;
  const quality = clamp(
    baseQuality + (1 - rangeM / Math.max(1, detectRangeM)) * (active ? 0.34 : 0.42)
      + sim.rng.range(-0.06, 0.06),
    0.12,
    active ? 0.96 : 0.84
  );
  const uncertainty = (1 - quality) * (active ? 3.5 : 9) * NM + (active ? 0.2 : 0.8) * NM;
  return setLocalTrack(sim, observer, target.id, {
    id: target.id,
    side: target.side,
    domain: String(target.id).startsWith("M-") ? "missile" : target.domain,
    classification: sonarClassification(target, quality),
    x: target.x + sim.rng.range(-uncertainty, uncertainty),
    y: target.y + sim.rng.range(-uncertainty, uncertainty),
    vx: Math.cos(target.heading ?? 0) * (target.speed ?? 0),
    vy: Math.sin(target.heading ?? 0) * (target.speed ?? 0),
    quality,
    uncertainty,
    source: `${observer.id} ${active ? "active" : "passive"} sonar`,
    sensorType: active ? "active-sonar" : "passive-sonar",
    depthM: Number.isFinite(target.depthM) ? target.depthM : undefined,
    age: 0,
    lastSeen: sim.time
  });
}

export function scanSonar(sim, dt) {
  let changed = false;
  const acousticTargets = sim._sonarAcousticTargets ??= [];
  acousticTargets.length = 0;
  for (const unit of sim.ships) {
    if (unit.alive && (unit.domain === "sea" || unit.domain === "subsurface")) acousticTargets.push(unit);
  }
  const underwaterWeapons = sim._sonarUnderwaterWeapons ??= [];
  underwaterWeapons.length = 0;
  for (const missile of sim._aliveMissiles ?? sim.missiles) {
    if (missile.alive && (missile.medium?.startsWith("underwater") || MISSILES[missile.missileId]?.medium === "underwater")) {
      underwaterWeapons.push(missile);
    }
  }
  const targets = sim._sonarTargets ??= [];
  targets.length = 0;
  for (const target of acousticTargets) targets.push(target);
  for (const target of underwaterWeapons) targets.push(target);
  for (const observer of sim.ships) {
    if (!observer.alive || !((observer.passiveSonarRangeM ?? 0) > 0 || (observer.activeSonarRangeM ?? 0) > 0)) continue;
    observer.sonarCooldown = (observer.sonarCooldown ?? 0) - dt;
    if (observer.sonarCooldown > 0) continue;
    observer.sonarCooldown = observer.sonarInterval ?? 6;
    for (const target of targets) {
      if (!target.alive || target.side === observer.side || target.id === observer.id) continue;
      const rangeM = distance3d(observer, target);
      const sonarHealth = clamp(observer.subsystems?.sonar ?? 1, 0.12, 1);
      const depthFactor = isUnderwaterTarget(target)
        ? clamp(1.05 - (target.depthM ?? 250) / 1600, 0.68, 1.05)
        : 1;
      const activeRangeM = observer.sonarActive
        ? (observer.activeSonarRangeM ?? 0) * sonarHealth * depthFactor
        : 0;
      const passiveRangeM = passiveSonarDetectionRange(observer, target);
      const active = activeRangeM > 0 && rangeM <= activeRangeM;
      const detectRangeM = active ? activeRangeM : passiveRangeM;
      if (!(detectRangeM > 0) || rangeM > detectRangeM) continue;
      const chance = active
        ? clamp(0.94 - 0.32 * rangeM / detectRangeM, 0.5, 0.94)
        : clamp(0.78 - 0.48 * rangeM / detectRangeM, 0.12, 0.78);
      if (sim.rng.next() > chance) continue;
      changed = sonarTrack(sim, observer, target, rangeM, detectRangeM, active) || changed;
    }
  }
  return changed;
}

export function tryAcousticSoftKill(sim, missile, target) {
  if (!(target.acousticDecoys > 0) || sim.time < (target.nextAcousticDecoyAt ?? 0)) return false;
  target.acousticDecoys -= 1;
  target.nextAcousticDecoyAt = sim.time + 8;
  const speedPenalty = clamp(((target.speed ?? 0) / KNOT - 12) / 18, 0, 0.18);
  const chance = clamp(0.42 - speedPenalty, 0.22, 0.48);
  if (sim.rng.next() >= chance) {
    addEvent(sim, `${target.name} deployed an acoustic countermeasure; ${missile.missileId} reacquired.`, target.side);
    return false;
  }
  addEvent(sim, `${target.name} decoyed ${missile.missileId} with an acoustic countermeasure.`, target.side);
  return true;
}
