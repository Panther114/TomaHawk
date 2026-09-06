import { NM } from "./constants.js";
import { addEvent } from "./events.js";
import { clamp, distance } from "./math.js";

export function initialElectronicWarfareState(cls) {
  const domain = cls.domain ?? "sea";
  const defaultChaff = domain === "air" ? 12 : domain === "sea" ? 8 : 0;
  const radarDecoys = Math.max(0, Math.round(cls.radarDecoys ?? defaultChaff));
  return {
    esmRangeM: Math.max(0, cls.esmRangeNm ?? 0) * NM,
    jammerRangeM: Math.max(0, cls.jammerRangeNm ?? 0) * NM,
    jammerStrength: clamp(cls.jammerStrength ?? 0, 0, 1),
    jammerActive: cls.jammerDefaultOn === true,
    jammerNormallyActive: cls.jammerDefaultOn === true,
    radarDecoys,
    radarDecoysMax: radarDecoys,
    nextRadarDecoyAt: 0
  };
}

export function updateElectronicWarfareState(sim, unit) {
  if (!unit.alive || !(unit.emconUntil > 0) || sim.time < unit.emconUntil) return;
  unit.emconUntil = 0;
  unit.radarActive = unit.radarNormallyActive !== false;
  unit.jammerActive = unit.jammerNormallyActive === true;
  addEvent(sim, `${unit.name} ended anti-radiation EMCON and restored emitters.`, unit.side);
}

export function reactToAntiRadiationThreat(sim, missile, spec, target) {
  if (!spec?.requiresEmitter || missile.emconReactionResolved || !isElectromagneticEmitter(target)) return false;
  // Passive warning gives the emitter a short reaction margin before the HARM
  // reaches its nominal seeker envelope; waiting until the final 18 NM made a
  // capable escort's first interceptor routinely destroy the weapon before
  // EMCON could take effect.
  if (!(target.esmRangeM > 0) || distance(missile, target) > 24 * NM) return false;
  missile.emconReactionResolved = true;
  target.radarActive = false;
  target.jammerActive = false;
  // At 18 NM a HARM-class weapon still needs roughly a minute to arrive. Keep
  // the emitter down beyond that window; a shorter fixed pause unrealistically
  // restored the radar before impact.
  target.emconUntil = Math.max(target.emconUntil ?? 0, sim.time + 90);
  addEvent(sim, `${target.name} entered EMCON against ${missile.missileId}.`, target.side);
  return true;
}

// Electronic attack is evaluated once per radar observer. Signal strength falls
// with jammer distance; target-specific burn-through is applied separately.
export function electronicAttackPressure(observer, hostileUnits) {
  let pressure = 0;
  const ox = observer.x ?? 0;
  const oy = observer.y ?? 0;
  for (const jammer of hostileUnits) {
    if (!jammer.alive || jammer.side === observer.side || !jammer.jammerActive || !(jammer.jammerStrength > 0)) continue;
    const reachM = jammer.jammerRangeM ?? 0;
    if (!(reachM > 0)) continue;
    const dx = ox - (jammer.x ?? 0);
    const dy = oy - (jammer.y ?? 0);
    if (dx * dx + dy * dy > reachM * reachM) continue;
    const rangeM = Math.sqrt(dx * dx + dy * dy);
    const health = clamp(jammer.subsystems?.electronicWarfare ?? 1, 0.12, 1);
    const received = jammer.jammerStrength * health * (1 - 0.55 * rangeM / reachM);
    if (received > pressure) pressure = received;
  }
  return clamp(pressure, 0, 0.82);
}

// Radar echo falls with the fourth power of target range while a jammer arrives
// by a one-way path. Close targets therefore burn through even strong stand-off
// jamming; distant targets lose detection probability and track precision.
export function radarJammingPenalty(pressure, targetRangeM, radarRangeM) {
  if (!(pressure > 0) || !(radarRangeM > 0)) return 0;
  const rangeFraction = clamp(targetRangeM / radarRangeM, 0, 1);
  return clamp(pressure * (0.12 + 0.88 * rangeFraction * rangeFraction), 0, 0.78);
}

export function isElectromagneticEmitter(unit) {
  return !!(unit?.alive && (unit.radarActive || unit.jammerActive));
}

export function electronicSupportObservation(observer, emitter, rng) {
  const health = clamp(observer.subsystems?.electronicWarfare ?? 1, 0.12, 1);
  const esmRangeM = (observer.esmRangeM ?? 0) * health;
  if (!(esmRangeM > 0) || !isElectromagneticEmitter(emitter)) return null;
  const rangeM = distance(observer, emitter);
  if (rangeM > esmRangeM) return null;
  const emitterPower = emitter.jammerActive ? 1 : 0.72;
  const rangeFraction = rangeM / esmRangeM;
  const chance = clamp(0.94 * emitterPower - 0.48 * rangeFraction, 0.18, 0.94);
  if (rng.next() > chance) return null;
  const quality = clamp(0.22 + (1 - rangeFraction) * 0.46 + (emitter.jammerActive ? 0.12 : 0), 0.18, 0.82);
  const uncertainty = (1 - quality) * 14 * NM + 1.5 * NM;
  return {
    quality,
    uncertainty,
    classification: quality > 0.68 ? emitter.className : "electromagnetic emitter"
  };
}

function radarGuided(spec) {
  const guidance = String(spec?.guidance ?? "");
  return guidance.includes("active") || guidance.includes("radar");
}

export function tryRadarSoftKill(sim, missile, spec, target) {
  if (!radarGuided(spec) || !(target.radarDecoys > 0)) return false;
  if (sim.time < (target.nextRadarDecoyAt ?? 0)) return false;
  target.radarDecoys -= 1;
  target.nextRadarDecoyAt = sim.time + 3.5;
  const suite = clamp((target.jammerStrength ?? 0) * 0.35 + (target.esmRangeM > 0 ? 0.12 : 0), 0, 0.4);
  const homeOnJamPenalty = spec.homeOnJam ? 0.24 : 0;
  const chance = clamp(0.28 + suite + (target.jammerActive ? 0.08 : 0) - homeOnJamPenalty, 0.08, 0.62);
  if (sim.rng.next() >= chance) {
    addEvent(sim, `${target.name} deployed an RF decoy; ${missile.missileId} maintained lock.`, target.side);
    return false;
  }
  addEvent(sim, `${target.name} seduced ${missile.missileId} with an RF decoy.`, target.side);
  return true;
}
