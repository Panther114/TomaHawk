// Scenario lifecycle: creation, JSON serialization/restore, after-action
// export, setup-mode editing (place/duplicate/delete/clear), and the run/setup
// gating predicates.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE, SCENARIO_MODE, FLEET_ROLE } from "./constants.js";
import { clamp, Rng } from "./math.js";
import {
  SHIP_CLASSES,
  makeShip,
  makeBurke,
  normalizeLoadout,
  defaultLoadout,
  defaultRoe,
  resetShipIds,
  defaultRcsM2,
  defaultAltitudeM
} from "./ships.js";
import { initialAircraftState } from "./aircraft.js";
import { addEvent } from "./events.js";
import { MAP_HEIGHT_M, MAP_WIDTH_M } from "../world/terrain.js";
import { isLandPoint, isWaterPoint, normalizeMapId, tacticalMap } from "../world/terrain.js";
import { currentTrack } from "./sensors.js";
import DEFAULT_SCENARIO_TEMPLATE from "./default-scenario.json" with { type: "json" };

const DEFAULT_MAP_ID = "openSea";
const MAP_RESEAT_STEP_M = 2.5 * NM;
const MAP_RESEAT_MAX_RADIUS_M = 36 * NM;
const SIM_WIDTH_M = MAP_WIDTH_M;
const SIM_HEIGHT_M = MAP_HEIGHT_M;
const MAX_SCENARIO_SHIPS = 200;
const MAX_SCENARIO_MISSILES = 5_000;
const MAX_SCENARIO_EVENTS = 500;

function boundedScenarioArray(value, name, maximum, { required = false } = {}) {
  if (value == null && !required) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid scenario ${name}.`);
  if (value.length > maximum) throw new Error(`Invalid scenario: too many ${name}.`);
  return value;
}

function scenarioDimension(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function legacyAim120IdForHull(hull) {
  // Prefer the hull's actual default magazine so new 5th-gen / AIM-120D types
  // (F-15EX, Workshop LO clones) do not silently map to AIM-120C.
  const cls = SHIP_CLASSES[hull];
  if (cls?.baseLoadout && (cls.baseLoadout["AIM-120D"] ?? 0) > 0) return "AIM-120D";
  if (hull === "F22" || hull === "F35A" || hull === "F35C" || hull === "F15EX") return "AIM-120D";
  return "AIM-120C";
}

export function clampShipToBounds(sim, ship) {
  const x = Number(ship.x);
  const y = Number(ship.y);
  ship.x = clamp(Number.isFinite(x) ? x : 0, -sim.widthM / 2, sim.widthM / 2);
  ship.y = clamp(Number.isFinite(y) ? y : 0, -sim.heightM / 2, sim.heightM / 2);
  return ship;
}

export function shipWaterClearanceM(ship) {
  const length = Number(ship?.lengthM) || 0;
  const beam = Number(ship?.beamM) || 0;
  return Math.max(0.18 * NM, length * 0.2, beam * 0.75);
}

function waterAnchor(side) {
  return {
    x: side === SIDE.BLUE ? -20 * NM : 20 * NM,
    y: 0
  };
}

function formationOffset(index) {
  const row = Math.floor(index / 2);
  const side = index % 2 === 0 ? -1 : 1;
  return {
    x: row * 3.5 * NM,
    y: side * (1.75 + row * 0.3) * NM
  };
}

function canOccupyWater(sim, point, ship) {
  const bounded = clampShipToBounds(sim, { ...point });
  return isWaterPoint(bounded, sim.mapId, shipWaterClearanceM(ship));
}

export function isShipPositionOnWater(sim, ship) {
  return canOccupyWater(sim, ship, ship);
}

// Fixed ground emplacements must sit on land. Maps with no terrain (open sea)
// have no coastline to violate, so any point is acceptable there.
function canEmplaceOnLand(sim, point) {
  const map = tacticalMap(sim.mapId);
  if (!map.landRings?.length) return true;
  return isLandPoint(clampShipToBounds(sim, { ...point }), map);
}

export function isShipPositionOnLand(sim, ship) {
  return canEmplaceOnLand(sim, ship);
}

function findNearestOpenWater(sim, point, ship) {
  const bounded = clampShipToBounds(sim, { ...point });
  if (canOccupyWater(sim, bounded, ship)) return bounded;
  for (let radius = MAP_RESEAT_STEP_M; radius <= MAP_RESEAT_MAX_RADIUS_M; radius += MAP_RESEAT_STEP_M) {
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const candidate = clampShipToBounds(sim, {
        x: bounded.x + Math.cos(angle) * radius,
        y: bounded.y + Math.sin(angle) * radius
      });
      if (canOccupyWater(sim, candidate, ship)) return candidate;
    }
  }
  return null;
}

function assignFleetWaterPositions(sim, ships) {
  const occupied = [];
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const sideShips = ships
      // Only sea units are seated into open water. Fixed ground emplacements,
      // airfields, and air units keep their placed position.
      .filter((ship) => ship.side === side && (ship.domain ?? "sea") === "sea")
      .sort((a, b) => a.id.localeCompare(b.id));
    const anchor = waterAnchor(side);
    sideShips.forEach((ship, index) => {
      const offset = formationOffset(index);
      const preferred = {
        x: anchor.x + (side === SIDE.BLUE ? -offset.x : offset.x),
        y: anchor.y + offset.y
      };
      let position = findNearestOpenWater(sim, preferred, ship);
      if (!position) position = findNearestOpenWater(sim, anchor, ship);
      if (!position) {
        throw new Error(`Unable to find open-water start position for ${ship.id} on ${sim.mapId}.`);
      }
      let separationPass = 0;
      while (occupied.some((other) => Math.hypot(other.x - position.x, other.y - position.y) < Math.max(shipWaterClearanceM(ship), shipWaterClearanceM(other.ship)) * 2) && separationPass < 12) {
        const nudged = findNearestOpenWater(sim, {
          x: position.x + (side === SIDE.BLUE ? -1 : 1) * MAP_RESEAT_STEP_M,
          y: position.y + (separationPass % 2 === 0 ? 1 : -1) * MAP_RESEAT_STEP_M
        }, ship);
        if (!nudged) break;
        position = nudged;
        separationPass += 1;
      }
      ship.x = position.x;
      ship.y = position.y;
      ship.waypoint = null;
      ship.navigationWaypoint = null;
      ship.tracks?.clear?.();
      occupied.push({ x: position.x, y: position.y, ship });
    });
  }
  sim.sharedTracksBySide?.clear?.();
  sim._trackIndexReady = false;
}

export function ensureShipInOpenWater(sim, ship, { fallbackToFormation = false } = {}) {
  clampShipToBounds(sim, ship);
  // Fixed ground emplacements live on land, airfields and air units may sit
  // anywhere — never relocate any of them to water.
  if (ship.isFixed || ship.domain === "air") return ship;
  if (canOccupyWater(sim, ship, ship)) return ship;
  const recovered = findNearestOpenWater(sim, ship, ship);
  if (recovered) {
    ship.x = recovered.x;
    ship.y = recovered.y;
    ship.waypoint = null;
    ship.navigationWaypoint = null;
    return ship;
  }
  if (fallbackToFormation) {
    assignFleetWaterPositions(sim, [ship]);
    return ship;
  }
  return null;
}

export function createScenario(seed = 7, mapId = DEFAULT_MAP_ID) {
  resetShipIds(1);
  const sim = {
    time: 0,
    seed,
    rng: new Rng(seed),
    widthM: SIM_WIDTH_M,
    heightM: SIM_HEIGHT_M,
    mapId: normalizeMapId(mapId),
    ships: [],
    missiles: [],
    events: [],
    selectedId: null,
    mode: SCENARIO_MODE.SETUP,
    paused: true,
    nextFirePlanAt: 0,
    nextForcePictureAt: 0,
    sharedTracksBySide: new Map(),
    _entityIndexesDirty: true
  };
  sim.ships.push(makeBurke(SIDE.BLUE, waterAnchor(SIDE.BLUE).x, 0));
  sim.ships.push(makeBurke(SIDE.RED, waterAnchor(SIDE.RED).x, 0));
  assignFleetWaterPositions(sim, sim.ships);
  sim.selectedId = sim.ships[0].id;
  return sim;
}

export function createDefaultScenario(seed = 7, mapId = DEFAULT_SCENARIO_TEMPLATE.mapId ?? DEFAULT_MAP_ID) {
  const restored = restoreScenario(structuredClone(DEFAULT_SCENARIO_TEMPLATE));
  restored.seed = seed;
  restored.rng = new Rng(seed);
  restored.mapId = normalizeMapId(mapId);
  restored.selectedId = restored.ships[0]?.id ?? null;
  return restored;
}

export function serializeScenario(sim) {
  return {
    version: 2,
    seed: sim.seed,
    time: sim.time,
    widthM: sim.widthM,
    heightM: sim.heightM,
    mapId: normalizeMapId(sim.mapId),
    selectedId: sim.selectedId,
    mode: sim.mode,
    paused: sim.paused,
    ended: sim.ended || null,
    nextFirePlanAt: sim.nextFirePlanAt ?? 0,
    nextForcePictureAt: sim.nextForcePictureAt ?? 0,
    ships: sim.ships.map((ship) => ({
      ...ship,
      tracks: [...ship.tracks.values()].map((track) => ({ ...currentTrack(track, sim.time) }))
    })),
    sharedTracksBySide: [...(sim.sharedTracksBySide?.entries?.() ?? [])].map(([side, tracks]) => [
      side,
      [...tracks.values()].map((track) => ({ ...currentTrack(track, sim.time) }))
    ]),
    missiles: sim.missiles,
    events: sim.events
  };
}

export function restoreScenario(data) {
  if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.ships)) {
    throw new Error("Unsupported scenario file");
  }
  const ships = boundedScenarioArray(data.ships, "ships", MAX_SCENARIO_SHIPS, { required: true });
  const missiles = boundedScenarioArray(data.missiles, "missiles", MAX_SCENARIO_MISSILES);
  const events = boundedScenarioArray(data.events, "events", MAX_SCENARIO_EVENTS);
  const seed = Number.isFinite(Number(data.seed)) ? Number(data.seed) : 7;
  const widthM = scenarioDimension(data.widthM, SIM_WIDTH_M);
  const heightM = scenarioDimension(data.heightM, SIM_HEIGHT_M);
  const mapId = normalizeMapId(data.mapId ?? DEFAULT_MAP_ID);
  resetShipIds(Math.max(1, ...ships.map((s) => {
    const num = Number(String(s.id).replace(/^[A-Z]+-/, "")) || 0;
    return num;
  })) + 1);
  const restored = {
    time: Number(data.time) || 0,
    seed,
    rng: new Rng(seed),
    widthM,
    heightM,
    mapId,
    ships: ships.map((ship) => {
      const hull = ship.hull || "DDG";
      const cls = SHIP_CLASSES[hull] || SHIP_CLASSES.DDG;
      const domain = ship.domain ?? cls.domain ?? "sea";
      const legacyAim120Id = legacyAim120IdForHull(hull);
      const loadout = normalizeLoadout({ ...defaultLoadout(hull), ...(ship.loadout || {}) }, legacyAim120Id);
      // Air units carry lifecycle/fuel state; seed class defaults then keep any
      // serialized values so a saved mid-flight squadron restores faithfully.
      const airState = domain === "air"
        ? {
            ...initialAircraftState(cls),
            ...(ship.airState != null ? { airState: ship.airState } : {}),
            ...(Number.isFinite(ship.fuelS) ? { fuelS: ship.fuelS } : {}),
            ...(Number.isFinite(ship.rearmUntil) ? { rearmUntil: ship.rearmUntil } : {}),
            ...(ship.homeBaseId != null ? { homeBaseId: ship.homeBaseId } : {}),
            ...(Number.isFinite(ship.flares) ? { flares: ship.flares } : {}),
            ...(ship.evading != null ? { evading: ship.evading } : {}),
            ...(Number.isFinite(ship.evadeUntil) ? { evadeUntil: ship.evadeUntil } : {})
          }
        : {};
      return {
        ...ship,
        hull,
        domain,
        isFixed: ship.isFixed ?? cls.isFixed ?? false,
        isAirfield: ship.isAirfield ?? cls.isAirfield ?? false,
        isCarrier: ship.isCarrier === true || cls.isCarrier === true
          || ((ship.isAirfield ?? cls.isAirfield) && (domain === "sea") && !(ship.isFixed ?? cls.isFixed)),
        carrierCapable: ship.carrierCapable === true || cls.carrierCapable === true,
        maxParkedSquadrons: Number.isFinite(ship.maxParkedSquadrons)
          ? ship.maxParkedSquadrons
          : (Number.isFinite(cls.maxParkedSquadrons) ? cls.maxParkedSquadrons : 0),
        strikeSpecialist: ship.strikeSpecialist === true ? true
          : ship.strikeSpecialist === false ? false
            : cls.strikeSpecialist === true ? true
              : cls.strikeSpecialist === false ? false
                : undefined,
        className: ship.className || cls.className,
        tracks: new Map((ship.tracks || []).map((track) => [track.id, track])),
        loadout,
        baseLoadoutSnapshot: ship.baseLoadoutSnapshot ? normalizeLoadout(ship.baseLoadoutSnapshot, legacyAim120Id) : { ...loadout },
        ...airState,
        editable: ship.editable ?? true,
        vlsCells: ship.vlsCells ?? cls.vlsCells,
        lengthM: ship.lengthM ?? cls.lengthM,
        beamM: ship.beamM ?? cls.beamM,
        draftM: ship.draftM ?? cls.draftM,
        displacementT: ship.displacementT ?? cls.displacementT,
        cruiseSpeed: Number.isFinite(ship.cruiseSpeed) ? ship.cruiseSpeed : cls.cruiseSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER,
        maxSpeed: Number.isFinite(ship.maxSpeed) ? ship.maxSpeed : cls.maxSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER,
        accel: Number.isFinite(ship.accel) ? ship.accel : cls.accelMps2 * SHIP_SPEED_MULTIPLIER,
        decel: Number.isFinite(ship.decel) ? ship.decel : cls.decelMps2 * SHIP_SPEED_MULTIPLIER,
        turnRate: Number.isFinite(ship.turnRate) ? ship.turnRate : cls.turnRateDps * Math.PI / 180,
        turnRateFlank: Number.isFinite(ship.turnRateFlank) ? ship.turnRateFlank : cls.turnRateFlankDps * Math.PI / 180,
        rcsM2: Number.isFinite(ship.rcsM2) ? ship.rcsM2 : defaultRcsM2(cls),
        altitudeM: Number.isFinite(ship.altitudeM) ? ship.altitudeM : defaultAltitudeM(cls),
        targetAltitudeM: Number.isFinite(ship.targetAltitudeM)
          ? ship.targetAltitudeM
          : Number.isFinite(ship.altitudeM) ? ship.altitudeM : defaultAltitudeM(cls),
        radarRangeM: Number.isFinite(ship.radarRangeM) ? ship.radarRangeM : cls.radarRangeNm * NM,
        radarInterval: Number.isFinite(ship.radarInterval) ? ship.radarInterval : cls.radarIntervalS,
        ciwsCount: ship.ciwsCount ?? cls.ciwsCount,
        ciwsAmmo: Number.isFinite(ship.ciwsAmmo) ? ship.ciwsAmmo : cls.ciwsAmmo,
        ciwsBurstRounds: ship.ciwsBurstRounds ?? cls.ciwsBurstRounds,
        ciwsBurstS: ship.ciwsBurstS ?? cls.ciwsBurstS,
        ciwsCycleS: ship.ciwsCycleS ?? cls.ciwsCycleS,
        ciwsBurstUntil: Number(ship.ciwsBurstUntil) || 0,
        nextCiwsAt: Number(ship.nextCiwsAt) || 0,
        ciwsCooldown: Number(ship.ciwsCooldown) || 0,
        damageResist: ship.damageResist ?? cls.damageResist,
        damageDegrade: ship.damageDegrade ?? cls.damageDegrade,
        reactionAvailableAt: Number(ship.reactionAvailableAt) || 0,
        defenseReactionAvailableAt: Number(ship.defenseReactionAvailableAt) || 0,
        defenseChannels: (() => {
          const oldSam = (ship.defenseChannels?.area ?? 0) + (ship.defenseChannels?.point ?? 0);
          const clsOldSam = (cls.defenseChannels?.area ?? 0) + (cls.defenseChannels?.point ?? 0);
          return {
            sam: ship.defenseChannels?.sam ?? (oldSam > 0 ? oldSam : cls.defenseChannels?.sam ?? clsOldSam),
            ciws: ship.defenseChannels?.ciws ?? cls.defenseChannels?.ciws ?? 0
          };
        })(),
        engagementAssignments: ship.engagementAssignments || {},
        lastFirePlanAt: Number.isFinite(ship.lastFirePlanAt) ? ship.lastFirePlanAt : -Infinity,
        launchQueue: Array.isArray(ship.launchQueue) ? ship.launchQueue : [],
        nextLaunchAt: Number(ship.nextLaunchAt) || 0,
        nextDefensiveLaunchAt: Number(ship.nextDefensiveLaunchAt) || 0,
        lastLaunchAtByMissile: ship.lastLaunchAtByMissile || {},
        doctrine: {
          aggression: 0.65,
          standoffNm: 70,
          defensiveRangeNm: 22,
          conserveWeapons: 0.25,
          ...(ship.doctrine || {})
        },
        defenseDoctrine: {
          sm2EarlyTtiS: 38,
          essmPreferredMaxNm: 24,
          saturationThreshold: 3,
          maxAssignedInterceptors: 2,
          ...(ship.defenseDoctrine || {})
        },
        offenseDoctrine: {
          minimumTrackQuality: 0.32,
          desiredLeakers: 2,
          raidSaturation: 6,
          reserveTomahawk: 0.35,
          ...(ship.offenseDoctrine || {})
        },
        roe: { ...defaultRoe(), ...(ship.roe || {}) },
        fleetRole: ship.fleetRole || FLEET_ROLE.UNIT,
        isOTC: ship.isOTC ?? false,
        sectorCenter: Number.isFinite(ship.sectorCenter) ? ship.sectorCenter : (ship.side === SIDE.BLUE ? 0 : Math.PI),
        sectorHalfWidth: Number.isFinite(ship.sectorHalfWidth) ? ship.sectorHalfWidth : Math.PI,
        station: ship.station || null,
        navigationWaypoint: ship.navigationWaypoint || null
      };
    }),
    missiles,
    events,
    selectedId: data.selectedId,
    mode: Object.values(SCENARIO_MODE).includes(data.mode) ? data.mode : SCENARIO_MODE.SETUP,
    paused: data.paused ?? true,
    ended: data.ended || null,
    nextFirePlanAt: Number(data.nextFirePlanAt) || 0,
    nextForcePictureAt: Number(data.nextForcePictureAt) || 0,
    sharedTracksBySide: new Map((data.sharedTracksBySide || []).map(([side, tracks]) => [
      side,
      new Map((tracks || []).map((track) => [track.id, track]))
    ])),
    _entityIndexesDirty: true,
    _trackIndexReady: false
  };
  // Version-2 saves from before the centralized CEC store may contain one
  // datalink copy per receiver. Collapse those copies while restoring.
  for (const ship of restored.ships) {
    const shared = restored.sharedTracksBySide.get(ship.side) ?? new Map();
    restored.sharedTracksBySide.set(ship.side, shared);
    for (const [id, track] of ship.tracks) {
      if (!String(track.source ?? "").includes("datalink")) continue;
      const current = shared.get(id);
      if (!current || (track.quality ?? 0) > (current.quality ?? 0)) shared.set(id, track);
      ship.tracks.delete(id);
    }
  }
  for (const ship of restored.ships) {
    ensureShipInOpenWater(restored, ship, { fallbackToFormation: true });
  }
  return restored;
}

export function exportAfterAction(sim) {
  return {
    version: 1,
    seed: sim.seed,
    durationS: sim.time,
    winner: sim.ended || null,
    survivingShips: sim.ships.filter((s) => s.alive).map((s) => s.id),
    ships: sim.ships.map((s) => ({
      id: s.id,
      name: s.name,
      side: s.side,
      alive: s.alive,
      damage: s.damage,
      remainingLoadout: s.loadout
    })),
    events: [...sim.events].reverse()
  };
}

export function placeShip(sim, side, x, y, hull = "DDG") {
  const ship = clampShipToBounds(sim, makeShip(side, x, y, hull));
  // Placement rules by unit kind:
  //   air units may be placed anywhere (land or water);
  //   ground airfields (AFB) may be placed anywhere;
  //   other fixed ground emplacements require land;
  //   sea units — including carriers (moving airfields) — require open water.
  const placeAnywhere = ship.domain === "air"
    || (ship.isAirfield && (ship.domain === "ground" || ship.isFixed));
  if (!placeAnywhere) {
    if (ship.isFixed) {
      if (!canEmplaceOnLand(sim, ship)) return null;
    } else if (!canOccupyWater(sim, ship, ship)) {
      return null;
    }
  }
  sim.ships.push(ship);
  sim._entityIndexesDirty = true;
  sim.selectedId = ship.id;
  addEvent(sim, `${side} ${ship.hull} placed.`, side);
  return ship;
}

export function duplicateShip(sim, shipId) {
  const original = sim.ships.find((ship) => ship.id === shipId);
  if (!original) return null;
  const hull = original.hull || "DDG";
  const copy = makeShip(original.side, original.x + 2 * NM, original.y + 2 * NM, hull);
  copy.heading = original.heading;
  copy.desiredSpeed = original.desiredSpeed;
  copy.radarActive = original.radarActive;
  copy.loadout = normalizeLoadout({ ...original.loadout });
  copy.doctrine = { ...original.doctrine };
  copy.defenseDoctrine = { ...original.defenseDoctrine };
  copy.offenseDoctrine = { ...original.offenseDoctrine };
  if (copy.isFixed) {
    // A fixed emplacement's offset copy must stay on land; if the offset spills
    // into water, overlap the original (the user can drag it clear). Airfields
    // are exempt — they may sit on land or water, so the offset always stands.
    if (!copy.isAirfield && !canEmplaceOnLand(sim, copy)) {
      copy.x = original.x;
      copy.y = original.y;
    }
  } else if (!ensureShipInOpenWater(sim, copy)) {
    assignFleetWaterPositions(sim, [copy]);
  }
  sim.ships.push(copy);
  sim._entityIndexesDirty = true;
  sim.selectedId = copy.id;
  addEvent(sim, `${copy.side} ${copy.hull} duplicated from ${original.id}.`, copy.side);
  return copy;
}

export function deleteShip(sim, shipId) {
  const ship = sim.ships.find((candidate) => candidate.id === shipId);
  if (!ship) return false;
  sim.ships = sim.ships.filter((candidate) => candidate.id !== shipId);
  sim.missiles = sim.missiles.filter((missile) => missile.launcherId !== shipId && missile.targetId !== shipId);
  sim.selectedId = sim.ships[0]?.id ?? null;
  sim._entityIndexesDirty = true;
  sim._trackIndexReady = false;
  addEvent(sim, `${ship.id} removed from scenario.`, ship.side);
  return true;
}

export function clearSide(sim, side) {
  const removedIds = new Set(sim.ships.filter((ship) => ship.side === side).map((ship) => ship.id));
  if (!removedIds.size) return 0;
  sim.ships = sim.ships.filter((ship) => ship.side !== side);
  sim.missiles = sim.missiles.filter((missile) => !removedIds.has(missile.launcherId) && !removedIds.has(missile.targetId));
  sim.selectedId = sim.ships[0]?.id ?? null;
  sim._entityIndexesDirty = true;
  sim._trackIndexReady = false;
  addEvent(sim, `${side} side cleared from scenario.`, side);
  return removedIds.size;
}

export function canRunScenario(sim) {
  const aliveSides = new Set(sim.ships.filter((ship) => ship.alive).map((ship) => ship.side));
  return aliveSides.has(SIDE.BLUE) && aliveSides.has(SIDE.RED);
}

export function canAddAssets(sim) {
  return sim?.mode === SCENARIO_MODE.SETUP;
}

export function setScenarioMap(sim, mapId) {
  if (sim?.mode !== SCENARIO_MODE.SETUP) {
    return { ok: false, reason: "mode_locked", mapId: normalizeMapId(sim?.mapId) };
  }
  const nextMapId = normalizeMapId(mapId);
  if (nextMapId === sim.mapId) return { ok: true, changed: false, mapId: nextMapId };
  sim.mapId = nextMapId;
  assignFleetWaterPositions(sim, sim.ships);
  addEvent(sim, `Scenario map set to ${tacticalMap(nextMapId).id}; ship positions reset to open water.`);
  return { ok: true, changed: true, mapId: nextMapId };
}
