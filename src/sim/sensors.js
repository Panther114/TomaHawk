// Perception layer: radar detection of ships and missiles, track-file
// creation, ageing, pruning, and cooperative (CEC) track sharing within a side.

import { NM } from "./constants.js";
import { clamp, distance } from "./math.js";
import { MISSILES } from "./missiles.js";

// Radar horizon: 4/3 Earth radius model. Returns max line-of-sight range in meters.
function radarHorizonM(hRadarM, hTargetM) {
  const k = 4.0 / 3.0;
  const re = 6371000;
  return Math.sqrt(2 * k * re * hRadarM) + Math.sqrt(2 * k * re * hTargetM);
}

function radarHeightM(ship) {
  return Math.max(8, 15 + (ship.draftM || 9) * 0.6);
}

function radarDetectionChance(rangeM, radarRangeM, target) {
  const ratio = clamp(rangeM / radarRangeM, 0, 1.4);
  const base = 0.96 - ratio * ratio * 0.74;
  const damagePenalty = target.damage * 0.08;
  return clamp(base - damagePenalty, 0.05, 0.96);
}

export function missileDetectionEnvelope(observer, missile) {
  const spec = MISSILES[missile?.missileId];
  if (!spec) return { detectRangeM: 0, horizonM: 0, targetHeightM: 8, visibilityFactor: 0.34, baseChance: 0.8 };
  let targetHeightM = 15;
  let visibilityFactor = 0.34;
  let baseChance = 0.80;
  switch (missile.missileId) {
    case "TomahawkBlockV":
      targetHeightM = missile.terminal ? 12 : 30;
      visibilityFactor = missile.terminal ? 0.18 : 0.16;
      baseChance = 0.72;
      break;
    case "MaritimeStrike":
      targetHeightM = missile.terminal ? 8 : 20;
      visibilityFactor = missile.terminal ? 0.22 : 0.19;
      baseChance = 0.74;
      break;
    case "SM-6":
      targetHeightM = missile.terminal ? 1400 : 7000;
      visibilityFactor = missile.terminal ? 0.82 : 0.72;
      baseChance = 0.92;
      break;
    case "SM-2MR":
      targetHeightM = missile.terminal ? 900 : 5000;
      visibilityFactor = missile.terminal ? 0.68 : 0.60;
      baseChance = 0.88;
      break;
    case "ESSM":
      targetHeightM = missile.terminal ? 250 : 900;
      visibilityFactor = missile.terminal ? 0.48 : 0.42;
      baseChance = 0.84;
      break;
    default:
      targetHeightM = missile.terminal ? 20 : 60;
      visibilityFactor = missile.terminal ? 0.28 : 0.24;
      baseChance = 0.78;
      break;
  }
  const horizonM = radarHorizonM(radarHeightM(observer), targetHeightM);
  const detectRangeM = Math.min(observer.radarRangeM * visibilityFactor, horizonM * 1.1);
  return { detectRangeM, horizonM, targetHeightM, visibilityFactor, baseChance };
}

function missileRadarDetectionChance(rangeM, detectRangeM, missile, profile) {
  const ratio = clamp(rangeM / detectRangeM, 0, 1.4);
  const base = (profile?.baseChance ?? 0.80) - ratio * ratio * 0.62;
  const terminalBonus = missile.terminal ? 0.16 : 0;
  const seaSkimPenalty = missile.seaSkimming ? 0.08 : 0;
  return clamp(base + terminalBonus - seaSkimPenalty, 0.04, 0.92);
}

export function scanSensors(sim, dt) {
  for (const observer of sim.ships) {
    if (!observer.alive || !observer.radarActive) continue;
    observer.radarCooldown -= dt;
    if (observer.radarCooldown > 0) continue;
    observer.radarCooldown = observer.radarInterval;
    for (const target of sim.ships) {
      if (target.id === observer.id || !target.alive) continue;
      const rangeM = distance(observer, target);
      if (rangeM > observer.radarRangeM) continue;
      // Radar horizon: reduce detection probability beyond geometric horizon
      const horizon = radarHorizonM(radarHeightM(observer), radarHeightM(target));
      const horizonFactor = rangeM > horizon ? clamp(1.0 - (rangeM - horizon) / (120 * NM), 0.20, 1.0) : 1.0;
      const chance = radarDetectionChance(rangeM, observer.radarRangeM, target) * horizonFactor;
      if (sim.rng.next() <= chance) {
        const radarHealth = observer.subsystems?.radar ?? 1.0;
        const quality = clamp((1 - rangeM / observer.radarRangeM + sim.rng.range(-0.08, 0.08)) * radarHealth, 0.05, 0.98);
        const uncertainty = (1 - quality) * 5 * NM + sim.rng.range(0, 0.5 * NM);
        observer.tracks.set(target.id, {
          id: target.id,
          side: target.side,
          classification: quality > 0.7 ? target.className : "surface combatant",
          x: target.x + sim.rng.range(-uncertainty, uncertainty),
          y: target.y + sim.rng.range(-uncertainty, uncertainty),
          vx: Math.cos(target.heading) * target.speed,
          vy: Math.sin(target.heading) * target.speed,
          quality,
          uncertainty,
          source: observer.id,
          age: 0,
          lastSeen: sim.time
        });
      }
    }
    for (const missile of sim._aliveMissiles || sim.missiles.filter((m) => m.alive)) {
      if (missile.side === observer.side) continue;
      const rangeM = distance(observer, missile);
      const profile = missileDetectionEnvelope(observer, missile);
      const detectRangeM = profile.detectRangeM;
      if (rangeM > detectRangeM) continue;
      const horizon = profile.horizonM;
      const horizonFactor = rangeM > horizon ? clamp(1.0 - (rangeM - horizon) / (70 * NM), 0.15, 1.0) : 1.0;
      const chance = missileRadarDetectionChance(rangeM, detectRangeM, missile, profile) * horizonFactor;
      if (sim.rng.next() <= chance) {
        const quality = clamp(
          0.16
          + (1 - rangeM / detectRangeM) * 0.48
          + (missile.terminal ? 0.20 : 0)
          + sim.rng.range(-0.05, 0.05),
          0.05,
          0.92
        );
        const uncertainty = (1 - quality) * 4.5 * NM + (missile.terminal ? 0.35 * NM : 0.9 * NM);
        observer.tracks.set(missile.id, {
          id: missile.id,
          side: missile.side,
          classification: missile.missileId,
          x: missile.x + sim.rng.range(-uncertainty, uncertainty),
          y: missile.y + sim.rng.range(-uncertainty, uncertainty),
          vx: Math.cos(missile.heading) * missile.speed,
          vy: Math.sin(missile.heading) * missile.speed,
          quality,
          uncertainty,
          source: observer.id,
          age: 0,
          lastSeen: sim.time
        });
      }
    }
  }
}

function liveContactForTrack(sim, trackId) {
  const id = String(trackId);
  if (id.startsWith("M-")) {
    return (sim._aliveMissiles || sim.missiles.filter((m) => m.alive)).some((m) => m.id === id);
  }
  const ship = sim.ships.find((candidate) => candidate.id === id);
  return !!ship && ship.alive;
}

export function pruneDeadTracks(sim) {
  for (const ship of sim.ships) {
    for (const [id, track] of ship.tracks) {
      if (!liveContactForTrack(sim, id)) {
        ship.tracks.delete(id);
        continue;
      }
      if (track.id && track.id !== id && !liveContactForTrack(sim, track.id)) {
        ship.tracks.delete(id);
      }
    }
  }
}

export function ageTracks(sim, dt) {
  pruneDeadTracks(sim);
  for (const ship of sim.ships) {
    for (const [id, track] of ship.tracks) {
      track.age += dt;
      track.x += track.vx * dt;
      track.y += track.vy * dt;
      track.uncertainty += dt * 90;
      track.quality = clamp(track.quality - dt * 0.006, 0, 1);
      if (track.age > 160 || track.quality < 0.03) ship.tracks.delete(id);
    }
  }
}

export function shareTracks(sim) {
  const bySide = new Map();
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (!bySide.has(ship.side)) bySide.set(ship.side, []);
    bySide.get(ship.side).push(ship);
  }
  const cecLatencyS = 1.8; // CEC network propagation + processing latency
  for (const ships of bySide.values()) {
    for (const source of ships) {
      for (const receiver of ships) {
        if (source.id === receiver.id) continue;
        for (const [id, track] of source.tracks) {
          // CEC latency: fresh tracks (< latency window) haven't propagated yet
          const trackAge = sim.time - (track.lastSeen || 0);
          if (trackAge < cecLatencyS) continue;
          const current = receiver.tracks.get(id);
          // Quality degrades through the network: CEC link loss, quantization
          const shared = { ...track, quality: track.quality * 0.85, uncertainty: track.uncertainty + 1500, source: `${source.id} datalink` };
          if (!current || shared.quality > current.quality) receiver.tracks.set(id, shared);
        }
      }
    }
  }
}
