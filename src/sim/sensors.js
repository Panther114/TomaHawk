// Perception layer: radar detection of ships and missiles, track-file
// creation, ageing, pruning, and cooperative (CEC) track sharing within a side.

import { NM } from "./constants.js";
import { clamp, distance } from "./math.js";
import { MISSILES } from "./missiles.js";

const radarHeightCache = new WeakMap();
const TRACK_MAX_AGE_S = 160;
const TRACK_QUALITY_DECAY_PER_S = 0.006;
const TRACK_UNCERTAINTY_GROWTH_MPS = 90;
const SENSOR_GRID_CELL_M = 50 * NM;

// Radar horizon: 4/3 Earth radius model. Returns max line-of-sight range in meters.
function radarHorizonM(hRadarM, hTargetM) {
  const k = 4.0 / 3.0;
  const re = 6371000;
  return Math.sqrt(2 * k * re * hRadarM) + Math.sqrt(2 * k * re * hTargetM);
}

function radarHeightM(ship) {
  let height = radarHeightCache.get(ship);
  if (height === undefined) {
    height = Math.max(8, 15 + (ship.draftM || 9) * 0.6);
    radarHeightCache.set(ship, height);
  }
  return height;
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

function sensorGrid(entities, usefulRangeM) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    if (!entity.alive) continue;
    minX = Math.min(minX, entity.x);
    maxX = Math.max(maxX, entity.x);
    minY = Math.min(minY, entity.y);
    maxY = Math.max(maxY, entity.y);
  }
  if (maxX - minX <= usefulRangeM * 2 && maxY - minY <= usefulRangeM * 2) return { entities, cells: null };
  const cells = new Map();
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index];
    if (!entity.alive) continue;
    const x = Math.floor(entity.x / SENSOR_GRID_CELL_M);
    const y = Math.floor(entity.y / SENSOR_GRID_CELL_M);
    const key = `${x},${y}`;
    const bucket = cells.get(key) ?? [];
    bucket.push(index);
    cells.set(key, bucket);
  }
  return { entities, cells };
}

function sensorCandidates(grid, observer, rangeM) {
  if (!grid.cells) return grid.entities;
  const minX = Math.floor((observer.x - rangeM) / SENSOR_GRID_CELL_M);
  const maxX = Math.floor((observer.x + rangeM) / SENSOR_GRID_CELL_M);
  const minY = Math.floor((observer.y - rangeM) / SENSOR_GRID_CELL_M);
  const maxY = Math.floor((observer.y + rangeM) / SENSOR_GRID_CELL_M);
  const indexes = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (const index of grid.cells.get(`${x},${y}`) ?? []) indexes.push(index);
    }
  }
  if (indexes.length >= grid.entities.length * 0.7) return grid.entities;
  indexes.sort((a, b) => a - b);
  return indexes.map((index) => grid.entities[index]);
}

function sharedTrackMap(sim, side) {
  sim.sharedTracksBySide ||= new Map();
  let tracks = sim.sharedTracksBySide.get(side);
  if (!tracks) {
    tracks = new Map();
    sim.sharedTracksBySide.set(side, tracks);
  }
  return tracks;
}

function normalizeTrackTiming(track, time) {
  if (!Number.isFinite(track._stateTime)) {
    const age = Number.isFinite(track.age) ? track.age : 0;
    track._stateTime = Number.isFinite(track.lastSeen) ? track.lastSeen + age : time;
  }
  return track;
}

export function currentTrack(track, time) {
  if (!track) return null;
  normalizeTrackTiming(track, time);
  const elapsed = Math.max(0, time - track._stateTime);
  if (elapsed <= 0) return track;
  track.x += (track.vx ?? 0) * elapsed;
  track.y += (track.vy ?? 0) * elapsed;
  track.age = (track.age ?? 0) + elapsed;
  track.uncertainty = (track.uncertainty ?? 0) + elapsed * TRACK_UNCERTAINTY_GROWTH_MPS;
  track.quality = clamp((track.quality ?? 0) - elapsed * TRACK_QUALITY_DECAY_PER_S, 0, 1);
  track._stateTime = time;
  return track;
}

function trackExpiresAt(track, time) {
  normalizeTrackTiming(track, time);
  const ageRemaining = Math.max(0, TRACK_MAX_AGE_S - (track.age ?? 0));
  const qualityRemaining = Math.max(0, ((track.quality ?? 0) - 0.03) / TRACK_QUALITY_DECAY_PER_S);
  return track._stateTime + Math.min(ageRemaining, qualityRemaining);
}

function heapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].expiresAt <= item.expiresAt) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = item;
}

function heapPop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child = right < heap.length && heap[right].expiresAt < heap[left].expiresAt ? right : left;
      if (heap[child].expiresAt >= last.expiresAt) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
  }
  return first;
}

function indexTrack(sim, map, id, track, ship = null) {
  normalizeTrackTiming(track, sim.time);
  sim._trackExpiryHeap ||= [];
  heapPush(sim._trackExpiryHeap, { expiresAt: trackExpiresAt(track, sim.time), map, id, track, ship });
  if (ship) {
    sim._trackHolders ||= new Map();
    const holders = sim._trackHolders.get(id) ?? new Set();
    holders.add(ship);
    sim._trackHolders.set(id, holders);
  }
}

function setLocalTrack(sim, ship, id, track) {
  const isNew = !ship.tracks.has(id);
  ship.tracks.set(id, track);
  indexTrack(sim, ship.tracks, id, track, ship);
  if (isNew) sim._indexedLocalTrackCount = (sim._indexedLocalTrackCount ?? 0) + 1;
  sim._dirtyTrackIds ||= new Set();
  sim._dirtyTrackIds.add(id);
}

export function ensureTrackIndexes(sim) {
  const localCount = sim.ships.reduce((count, ship) => count + ship.tracks.size, 0);
  if (sim._trackIndexReady && localCount === sim._indexedLocalTrackCount) return;
  sim._trackHolders = new Map();
  sim._trackExpiryHeap = [];
  sim._indexedLocalTrackCount = localCount;
  for (const ship of sim.ships) {
    for (const [id, track] of ship.tracks) indexTrack(sim, ship.tracks, id, track, ship);
  }
  for (const tracks of sim.sharedTracksBySide?.values?.() ?? []) {
    for (const [id, track] of tracks) indexTrack(sim, tracks, id, track);
  }
  sim._trackIndexReady = true;
}

export function trackForShip(sim, ship, id) {
  const local = currentTrack(ship.tracks.get(id), sim.time);
  const shared = currentTrack(sim.sharedTracksBySide?.get(ship.side)?.get(id), sim.time);
  if (!local) return shared;
  if (!shared) return local;
  return shared.quality > local.quality ? shared : local;
}

export function* iterateTracksForShip(sim, ship) {
  for (const [id, local] of ship.tracks) {
    const best = trackForShip(sim, ship, id);
    if (best) yield best;
  }
  for (const [id, shared] of sim.sharedTracksBySide?.get(ship.side) ?? []) {
    if (ship.tracks.has(id)) continue;
    yield currentTrack(shared, sim.time);
  }
}

export function tracksForShip(sim, ship) {
  return [...iterateTracksForShip(sim, ship)];
}

export function markContactDead(sim, id) {
  sim._deadTrackIds ||= new Set();
  sim._deadTrackIds.add(id);
  sim._tracksNeedPrune = true;
  sim._dirtyTrackIds ||= new Set();
  sim._dirtyTrackIds.add(id);
}

export function scanSensors(sim, dt) {
  let changed = false;
  const observers = [];
  for (const observer of sim.ships) {
    if (!observer.alive || !observer.radarActive) continue;
    observer.radarCooldown -= dt;
    if (observer.radarCooldown > 0) continue;
    observer.radarCooldown = observer.radarInterval;
    observers.push(observer);
  }
  if (!observers.length) return false;
  const maxRadarRangeM = observers.reduce((range, observer) => Math.max(range, observer.radarRangeM), 0);
  const ships = sensorGrid(sim.ships, maxRadarRangeM);
  const missiles = sensorGrid(sim._aliveMissiles ?? sim.missiles, maxRadarRangeM);
  for (const observer of observers) {
    for (const target of sensorCandidates(ships, observer, observer.radarRangeM)) {
      if (target.id === observer.id || target.side === observer.side || !target.alive) continue;
      const dx = observer.x - target.x;
      const dy = observer.y - target.y;
      if (dx * dx + dy * dy > observer.radarRangeM * observer.radarRangeM) continue;
      const rangeM = distance(observer, target);
      // Radar horizon: reduce detection probability beyond geometric horizon
      const horizon = radarHorizonM(radarHeightM(observer), radarHeightM(target));
      const horizonFactor = rangeM > horizon ? clamp(1.0 - (rangeM - horizon) / (120 * NM), 0.20, 1.0) : 1.0;
      const chance = radarDetectionChance(rangeM, observer.radarRangeM, target) * horizonFactor;
      if (sim.rng.next() <= chance) {
        const radarHealth = observer.subsystems?.radar ?? 1.0;
        const quality = clamp((1 - rangeM / observer.radarRangeM + sim.rng.range(-0.08, 0.08)) * radarHealth, 0.05, 0.98);
        const uncertainty = (1 - quality) * 5 * NM + sim.rng.range(0, 0.5 * NM);
        setLocalTrack(sim, observer, target.id, {
          id: target.id,
          side: target.side,
          domain: target.domain ?? "sea",
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
        changed = true;
      }
    }
    for (const missile of sensorCandidates(missiles, observer, observer.radarRangeM)) {
      if (missile.side === observer.side) continue;
      const profile = missileDetectionEnvelope(observer, missile);
      const detectRangeM = profile.detectRangeM;
      const dx = observer.x - missile.x;
      const dy = observer.y - missile.y;
      if (dx * dx + dy * dy > detectRangeM * detectRangeM) continue;
      const rangeM = distance(observer, missile);
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
        setLocalTrack(sim, observer, missile.id, {
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
        changed = true;
      }
    }
  }
  return changed;
}

function liveContactForTrack(sim, trackId) {
  const id = String(trackId);
  if (id.startsWith("M-")) {
    const missile = sim._missileById?.get(id);
    if (missile) return missile.alive;
    return sim.missiles.some((candidate) => candidate.id === id && candidate.alive);
  }
  const ship = sim._shipById?.get(id) ?? sim.ships.find((candidate) => candidate.id === id);
  return !!ship && ship.alive;
}

export function pruneDeadTracks(sim) {
  ensureTrackIndexes(sim);
  const deadIds = sim._deadTrackIds;
  if (deadIds?.size) {
    for (const id of deadIds) {
      for (const ship of sim._trackHolders.get(id) ?? []) {
        if (ship.tracks.delete(id)) sim._indexedLocalTrackCount--;
      }
      sim._trackHolders.delete(id);
      for (const tracks of sim.sharedTracksBySide?.values?.() ?? []) tracks.delete(id);
    }
    deadIds.clear();
    return;
  }
  // Direct callers may not have marked the entity death through the combat
  // path, so retain a complete correctness fallback outside the hot tick path.
  for (const [id, holders] of sim._trackHolders) {
    if (liveContactForTrack(sim, id)) continue;
    for (const ship of holders) {
      if (ship.tracks.delete(id)) sim._indexedLocalTrackCount--;
    }
    sim._trackHolders.delete(id);
    for (const tracks of sim.sharedTracksBySide?.values?.() ?? []) tracks.delete(id);
  }
}

export function ageTracks(sim, dt) {
  ensureTrackIndexes(sim);
  let heap = sim._trackExpiryHeap;
  let sharedCount = 0;
  for (const tracks of sim.sharedTracksBySide?.values?.() ?? []) sharedCount += tracks.size;
  const activeTrackCount = (sim._indexedLocalTrackCount ?? 0) + sharedCount;
  if (heap.length > activeTrackCount * 4 + 256) {
    sim._trackExpiryHeap = [];
    for (const ship of sim.ships) {
      for (const [id, track] of ship.tracks) indexTrack(sim, ship.tracks, id, track, ship);
    }
    for (const tracks of sim.sharedTracksBySide?.values?.() ?? []) {
      for (const [id, track] of tracks) indexTrack(sim, tracks, id, track);
    }
    heap = sim._trackExpiryHeap;
  }
  while (heap.length && heap[0].expiresAt <= sim.time) {
    const item = heapPop(heap);
    if (item.map.get(item.id) !== item.track) continue;
    currentTrack(item.track, sim.time);
    if (item.track.age <= TRACK_MAX_AGE_S && item.track.quality >= 0.03) {
      heapPush(heap, { ...item, expiresAt: sim.time + 1e-9 });
      continue;
    }
    item.map.delete(item.id);
    if (item.ship) {
      sim._indexedLocalTrackCount--;
      const holders = sim._trackHolders.get(item.id);
      holders?.delete(item.ship);
      if (!holders?.size) sim._trackHolders.delete(item.id);
    }
    sim._dirtyTrackIds ||= new Set();
    sim._dirtyTrackIds.add(item.id);
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
  let changed = false;
  for (const [side, ships] of bySide) {
    const candidates = new Map();
    for (const source of ships) {
      for (const [id, rawTrack] of source.tracks) {
        const track = currentTrack(rawTrack, sim.time);
        if (track.side === source.side) continue;
        const trackAge = sim.time - (track.lastSeen || 0);
        if (trackAge < cecLatencyS) continue;
        const candidate = { source, id, track, quality: track.quality * 0.85 };
        const ranked = candidates.get(id) ?? [];
        if (!ranked.length || candidate.quality > ranked[0].quality) ranked.unshift(candidate);
        else if (ranked.length < 2 || candidate.quality > ranked[1].quality) ranked.splice(1, 0, candidate);
        if (ranked.length > 2) ranked.length = 2;
        candidates.set(id, ranked);
      }
    }
    const shared = sharedTrackMap(sim, side);
    for (const [id, ranked] of candidates) {
      const winner = ranked[0];
      if (!winner) continue;
      const current = currentTrack(shared.get(id), sim.time);
      if (!current || winner.quality > current.quality) {
        const networkTrack = {
          ...winner.track,
          quality: winner.quality,
          uncertainty: winner.track.uncertainty + 1500,
          source: `${winner.source.id} datalink`,
          _stateTime: sim.time
        };
        shared.set(id, networkTrack);
        indexTrack(sim, shared, id, networkTrack);
        sim._dirtyTrackIds ||= new Set();
        sim._dirtyTrackIds.add(id);
        changed = true;
      }
    }
  }
  return changed;
}
