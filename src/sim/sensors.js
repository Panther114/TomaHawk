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

// RCS-based detection. A radar's range against a target scales with the fourth
// root of the target's radar cross-section (the classic radar-range equation),
// referenced to a typical destroyer so ship-vs-ship play is near-unchanged while
// small targets (a fighter flight) are only seen much closer and large or low-
// observable hulls scale accordingly. Cheap: one pow() per detection candidate.
//
// Floor was 0.12 and silently collapsed every low-observable fighter onto the
// same detection range. Floor 0.05 restores LO differentiation (F-22 vs F-35).
//
// Air targets get a modest domain lift: absolute fighter RCS (0.25–25 m²) is
// three orders below a destroyer, so the destroyer-referenced fourth root
// alone paints even a non-stealth F-15 only at ~38 NM on a 190 NM radar — far
// inside real SPY-class search envelopes against high-altitude fighters — and
// track quality at that knife-edge never cleared the 0.32 ID gate. The lift
// keeps LO flights well inside non-stealth ones without letting any airframe
// match a surface combatant's detectability (hard cap 0.72 of nominal range).
const REF_RCS_M2 = 12000;
const RCS_RANGE_FLOOR = 0.05;
const AIR_RCS_RANGE_LIFT = 2.4;
const AIR_RCS_RANGE_CAP = 0.72;
function rcsRangeFactor(rcsM2, domain = "sea") {
  let factor = clamp(Math.pow((rcsM2 ?? REF_RCS_M2) / REF_RCS_M2, 0.25), RCS_RANGE_FLOOR, 1.0);
  if (domain === "air") {
    factor = clamp(factor * AIR_RCS_RANGE_LIFT, RCS_RANGE_FLOOR, AIR_RCS_RANGE_CAP);
  }
  return factor;
}

// Domain-aware unclassified label. Previously every low-quality track was
// labelled "surface combatant", so an air contact was estimated as a DDG for
// force posture and shown as a ship in the UI until firm classification.
function unclassifiedContactLabel(domain) {
  if (domain === "air") return "air contact";
  if (domain === "ground") return "ground contact";
  return "surface combatant";
}

// Same radar-range equation as rcsRangeFactor above, but referenced to the
// largest vanilla munition (TomahawkBlockV, ~0.5 m²) instead of a destroyer:
// every missile is 3-4 orders of magnitude smaller than even a stealth
// fighter, so reusing the platform reference point would clamp every weapon
// to the same floor and erase any distinction between, say, a tiny AIM-9X and
// a much larger cruise missile. Also capped at 1.0 for the same reason as the
// platform version (RCS only shortens detection, it never extends a radar
// beyond its rated reach).
const MISSILE_REF_RCS_M2 = 0.6;
function missileRcsRangeFactor(rcsM2) {
  return clamp(Math.pow((rcsM2 ?? MISSILE_REF_RCS_M2) / MISSILE_REF_RCS_M2, 0.25), 0.35, 1.0);
}

// Radar-reflective height for the geometric horizon: a flying entity uses its
// altitude (so a high-flying aircraft looks — and is seen — much farther than
// the horizon would suggest at sea level, and a sea-skimmer is masked beyond
// it — the "radar shadow"), surface/ground use their structural mast height.
// Used for BOTH sides of a radar-horizon pair: an aircraft's own lookdown
// range benefits from its altitude exactly the same way a target's does — a
// 9,000m-cruising fighter's radar horizon is enormous, not the ~18m a naval
// mast-height formula would give it (that bug — the observer side calling
// the ship-only radarHeightM directly — silently blinded every aircraft's
// look-down/look-out range to near sea-level, capping air-to-air detection
// far short of the intended RCS-scaled range and making mid-air merges look
// like ambushes; see the git history for the debug-log evidence).
function scatterHeightM(entity) {
  const alt = entity.altitudeM ?? 0;
  return alt > 30 ? alt : radarHeightM(entity);
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
  // Altitude/profile and detection-confidence still vary by weapon (a
  // sea-skimmer flies low and is masked by the horizon; a lofted
  // air-defence round flies high and is seen far outside it) — that is a
  // genuinely different physical axis from radar cross-section (how big the
  // return is once in view) and stays a per-weapon lookup here. RCS itself
  // used to be folded into this same table as a hand-tuned "visibilityFactor"
  // magic number with no relationship to any actual per-weapon RCS value;
  // it is now derived from spec.rcsM2 via missileRcsRangeFactor below, the
  // same physical concept already used for ship/aircraft detection.
  let targetHeightM = missile.terminal
    ? (spec.terminalAltitudeM ?? 15)
    : (spec.cruiseAltitudeM ?? 15);
  let baseChance = spec.cruiseAltitudeM ? 0.90 : 0.80;
  switch (missile.missileId) {
    case "TomahawkBlockV":
      targetHeightM = missile.terminal ? 12 : 30;
      baseChance = 0.72;
      break;
    case "MaritimeStrike":
      targetHeightM = missile.terminal ? 8 : 20;
      baseChance = 0.74;
      break;
    case "SM-6":
      targetHeightM = missile.terminal ? 1400 : 7000;
      baseChance = 0.92;
      break;
    case "SM-2MR":
      targetHeightM = missile.terminal ? 900 : 5000;
      baseChance = 0.88;
      break;
    case "ESSM":
      targetHeightM = missile.terminal ? 250 : 900;
      baseChance = 0.84;
      break;
    case "AGM-84": // air-launched sea-skimming anti-ship
      targetHeightM = missile.terminal ? 8 : 18;
      baseChance = 0.74;
      break;
    case "AGM-154": // air-launched stand-off glide weapon (anti-ground), not sea-skimming
      targetHeightM = missile.terminal ? 10 : 40;
      baseChance = 0.74;
      break;
    case "AIM-120C": // BVR air-to-air, fast high-flyer
    case "AIM-120D":
      targetHeightM = missile.terminal ? 3000 : 8000;
      baseChance = 0.8;
      break;
    case "AIM-9X": // WVR IR, small and lower
      targetHeightM = missile.terminal ? 400 : 1500;
      baseChance = 0.7;
      break;
    default:
      if (!spec.cruiseAltitudeM && !spec.terminalAltitudeM) {
        targetHeightM = missile.terminal ? 20 : 60;
        baseChance = 0.78;
      }
      break;
  }
  const visibilityFactor = missileRcsRangeFactor(spec.rcsM2);
  const horizonM = radarHorizonM(scatterHeightM(observer), targetHeightM);
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

// Always bucket entities into a uniform grid. Earlier code skipped the grid
// when the force fit inside 2× radar range — the common head-on / coastal case —
// which forced every observer into an O(entities) scan with full range/horizon
// math. The grid is pure broad-phase; detection outcomes are unchanged because
// every candidate still passes the same RCS/horizon/chance tests. Candidate
// order stays deterministic via a stable index sort.
function sensorGrid(entities, _usefulRangeM) {
  let aliveCount = 0;
  for (const entity of entities) if (entity.alive) aliveCount++;
  if (aliveCount === 0) return { entities, cells: null, aliveCount: 0 };
  // Tiny force: grid overhead exceeds the linear scan.
  if (aliveCount <= 8) return { entities, cells: null, aliveCount };
  const cells = new Map();
  for (let index = 0; index < entities.length; index++) {
    const entity = entities[index];
    if (!entity.alive) continue;
    const x = Math.floor(entity.x / SENSOR_GRID_CELL_M);
    const y = Math.floor(entity.y / SENSOR_GRID_CELL_M);
    const key = `${x},${y}`;
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(index);
  }
  return { entities, cells, aliveCount };
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
      const bucket = grid.cells.get(`${x},${y}`);
      if (!bucket) continue;
      for (const index of bucket) indexes.push(index);
    }
  }
  const aliveCount = grid.aliveCount ?? grid.entities.length;
  // Neighbourhood already covers most of the force — skip the sort/map and
  // walk the full list (alive entities are still filtered by the caller).
  if (indexes.length >= aliveCount * 0.7) return grid.entities;
  indexes.sort((a, b) => a - b);
  const out = new Array(indexes.length);
  for (let i = 0; i < indexes.length; i++) out[i] = grid.entities[indexes[i]];
  return out;
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
      // RCS-limited detection range (replaces the rigid radar range): a small or
      // low-observable target is only seen well inside the radar's nominal reach.
      const targetDomain = target.domain ?? "sea";
      const effectiveRangeM = observer.radarRangeM * rcsRangeFactor(target.rcsM2, targetDomain);
      const dx = observer.x - target.x;
      const dy = observer.y - target.y;
      if (dx * dx + dy * dy > effectiveRangeM * effectiveRangeM) continue;
      const rangeM = distance(observer, target);
      // Radar horizon: a high-altitude target is visible far; a low one (ship,
      // sea-skimmer) is masked beyond the geometric horizon (the radar shadow).
      const horizon = radarHorizonM(scatterHeightM(observer), scatterHeightM(target));
      const horizonFactor = rangeM > horizon ? clamp(1.0 - (rangeM - horizon) / (120 * NM), 0.20, 1.0) : 1.0;
      const chance = radarDetectionChance(rangeM, effectiveRangeM, target) * horizonFactor;
      if (sim.rng.next() <= chance) {
        const radarHealth = observer.subsystems?.radar ?? 1.0;
        const quality = clamp((1 - rangeM / effectiveRangeM + sim.rng.range(-0.08, 0.08)) * radarHealth, 0.05, 0.98);
        const uncertainty = (1 - quality) * 5 * NM + sim.rng.range(0, 0.5 * NM);
        setLocalTrack(sim, observer, target.id, {
          id: target.id,
          side: target.side,
          domain: targetDomain,
          classification: quality > 0.7 ? target.className : unclassifiedContactLabel(targetDomain),
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

// A live, on-mission "command hub" unit (see the commandHub ship flag —
// any hull can opt in, e.g. the AWAC AEW&C squadron) tightens this side's CEC
// track-sharing latency, representing a centralized, high-bandwidth relay/
// correlation node instead of every pair of ships propagating and merging
// tracks independently. Checked against the literal "mission" state (not the
// AIR_STATE.MISSION export) to avoid a circular import — aircraft.js already
// imports from sensors.js, so sensors.js cannot import back from it.
function hasActiveCommandHub(ships) {
  return ships.some((ship) => ship.commandHub && (ship.domain !== "air" || ship.airState === "mission"));
}

export function shareTracks(sim) {
  const bySide = new Map();
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (!bySide.has(ship.side)) bySide.set(ship.side, []);
    bySide.get(ship.side).push(ship);
  }
  const CEC_LATENCY_S = 1.8; // baseline CEC network propagation + processing latency
  const CEC_LATENCY_HUB_S = 0.6; // with an active command-hub relay
  let changed = false;
  for (const [side, ships] of bySide) {
    const cecLatencyS = hasActiveCommandHub(ships) ? CEC_LATENCY_HUB_S : CEC_LATENCY_S;
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
