import { addEvent } from "./events.js";
import { clamp } from "./math.js";

const SUBSYSTEM_KEYS = ["radar", "vls", "propulsion", "fireControl", "ciws", "cic"];

export function subsystemHealth(ship, key) {
  return clamp(ship?.subsystems?.[key] ?? 1, 0, 1);
}

export function vlsCadenceScale(ship) {
  return 1 / Math.max(0.2, subsystemHealth(ship, "vls"));
}

export function effectiveDefenseChannelCapacity(ship, nominalCapacity) {
  if (!Number.isFinite(nominalCapacity)) return nominalCapacity;
  if (nominalCapacity <= 0) return 0;
  return Math.max(1, Math.ceil(nominalCapacity * subsystemHealth(ship, "fireControl")));
}

export function ciwsEffectiveness(ship) {
  return Math.max(0.15, subsystemHealth(ship, "ciws"));
}

export function commandDelayScale(ship) {
  return 1 + (1 - subsystemHealth(ship, "cic")) * 1.5;
}

export function applySubsystemDamage(sim, ship) {
  const subs = ship.subsystems;
  if (!subs) return;
  const count = 2 + Math.floor(sim.rng.next() * 2);
  const candidates = [...SUBSYSTEM_KEYS];
  if ((ship.passiveSonarRangeM ?? 0) > 0 || (ship.activeSonarRangeM ?? 0) > 0) candidates.push("sonar");
  if ((ship.esmRangeM ?? 0) > 0 || (ship.jammerStrength ?? 0) > 0) candidates.push("electronicWarfare");
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(sim.rng.next() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const messages = [];
  for (let i = 0; i < count; i++) {
    const key = candidates[i];
    const degradation = 0.15 + sim.rng.next() * 0.30;
    subs[key] = Math.max(0, subs[key] - degradation);
    if (subs[key] <= 0.05) {
      messages.push(`${key} critically damaged`);
    } else if (subs[key] < 0.5) {
      messages.push(`${key} heavily damaged`);
    }
  }
  if (messages.length) {
    addEvent(sim, `${ship.name} subsystem damage: ${messages.join(", ")}.`, ship.side);
  }
}
