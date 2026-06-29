// Ship class catalogue, the ship factory, magazine/loadout accounting, and
// rules-of-engagement defaults. Also owns the monotonic hull-id counter shared
// with scenario setup/restore.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE, WEAPON_STATE, FLEET_ROLE } from "./constants.js";
import { MISSILES } from "./missiles.js";
import { clamp } from "./math.js";
import { initialAircraftState } from "./aircraft.js";

// Monotonic hull id counter. Shared with scenario.js so createScenario can
// reset it and restoreScenario can fast-forward it past loaded hull ids.
let nextId = 1;
export function resetShipIds(value = 1) {
  nextId = value;
}

export function defaultLoadout(hull = "DDG") {
  const cls = SHIP_CLASSES[hull] || SHIP_CLASSES.DDG;
  // Fixed ground emplacements carry an explicit, type-specific magazine rather
  // than the VLS-scaled naval loadout (a radar site has no weapons at all).
  if (cls.baseLoadout) return { ...cls.baseLoadout };
  const scale = cls.vlsCells / 96;
  const loadout = {
    "SM-2MR": Math.floor(36 * scale),
    "SM-6": Math.floor(16 * scale),
    ESSM: Math.floor(32 * scale),
    MaritimeStrike: Math.floor(16 * scale),
    TomahawkBlockV: Math.floor(12 * scale)
  };
  // Fill remaining capacity with SM-2MR. Floor it so quarter-cell ESSM costs
  // can't leave a fractional missile count (e.g. FFG would otherwise show 15.5).
  const remaining = Math.max(0, Math.floor(cls.vlsCells - usedCells(loadout)));
  loadout["SM-2MR"] += remaining;
  return loadout;
}

export function normalizeLoadout(loadout) {
  const normalized = {};
  for (const [id, count] of Object.entries(loadout || {})) {
    if (!MISSILES[id]) continue;
    const numeric = Number.isFinite(count) ? count : 0;
    const rounded = Math.round(numeric);
    normalized[id] = Math.max(0, rounded);
  }
  return normalized;
}

export function availableCount(ship, missileId) {
  const count = ship?.loadout?.[missileId];
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.round(count));
}

export function setAvailableCount(ship, missileId, count) {
  ship.loadout ||= {};
  ship.loadout[missileId] = Math.max(0, Math.round(Number.isFinite(count) ? count : 0));
  return ship.loadout[missileId];
}

export function defaultRoe() {
  return {
    // Weapon-control state governs offensive release. Defensive (self-defence)
    // fires are always authorised regardless of state, matching real ROE where
    // a unit may always defend itself.
    weaponState: WEAPON_STATE.FREE,
    // Minimum perceived track quality required to declare a contact hostile and
    // commit offensive weapons to it (positive identification gate).
    identifyThreshold: 0.32,
    // Under a TIGHT posture, offensive release additionally requires a firm
    // track and a closer commit range; HOLD forbids offensive release entirely.
    tightMinQuality: 0.6,
    tightCommitRangeNm: 90,
    // Target-loss policy for the current simulation. Retargeting is disabled;
    // weapons always self-destruct when their assigned target is destroyed.
    retargetAllowed: false,
    selfDestructOnTargetLoss: true,
    // Authorise the terminal CIWS layer.
    ciwsRelease: true
  };
}

export function usedCells(loadout) {
  return Object.entries(loadout).reduce((sum, [id, count]) => sum + (MISSILES[id]?.cellCost ?? 0) * count, 0);
}

export function vlsCapacity(ship) {
  return ship?.vlsCells ?? 96;
}

export function weaponRangeEntries(ship) {
  return Object.entries(ship.loadout)
    .filter(([id, count]) => count > 0 && MISSILES[id])
    .map(([id, count]) => ({
      id,
      count,
      shortLabel: MISSILES[id].shortLabel,
      category: MISSILES[id].category,
      rangeM: MISSILES[id].rangeM,
      ringStyle: MISSILES[id].ringStyle
    }))
    .sort((a, b) => b.rangeM - a.rangeM);
}

export function validateLoadout(loadout, ship = null) {
  const cells = usedCells(loadout);
  const maxCells = vlsCapacity(ship);
  const errors = [];
  if (cells > maxCells) errors.push(`VLS capacity exceeded: ${cells.toFixed(1)} / ${maxCells} cells`);
  for (const [id, count] of Object.entries(loadout)) {
    if (!MISSILES[id]) errors.push(`Unknown missile: ${id}`);
    if (!Number.isInteger(count) || count < 0) errors.push(`${id} count must be a non-negative integer`);
  }
  return { ok: errors.length === 0, cells, errors };
}

export function setLoadout(ship, missileId, count) {
  const maxCells = vlsCapacity(ship);
  const next = normalizeLoadout({ ...ship.loadout, [missileId]: clamp(Math.round(count), 0, maxCells) });
  const result = validateLoadout(next, ship);
  if (result.ok) ship.loadout = next;
  return result;
}

// Ship class catalogue. A live registry (not frozen): the modding system
// registers custom naval/ground unit types into it at runtime via
// registerShipClass. Consumers access it as SHIP_CLASSES[hull], so registered
// entries are visible everywhere with no further wiring. Built-in ids are
// captured below and can never be removed.
const SHIP_CLASSES = {
  DDG: { hull:"DDG",className:"Arleigh Burke Flight IIA approx.",prefix:"DDG",lengthM:155,beamM:20,draftM:9.3,displacementT:9200,cruiseSpeedKt:16,maxSpeedKt:31,accelMps2:0.12,decelMps2:0.22,turnRateDps:2.6,turnRateFlankDps:1.8,radarRangeNm:190,radarIntervalS:4,vlsCells:96,ciwsCount:1,ciwsAmmo:1550,ciwsBurstRounds:180,ciwsBurstS:1.4,ciwsCycleS:5.5,defenseChannels:{area:2,point:2,ciws:1},damageResist:2,damageDegrade:0.30 },
  CCG: { hull:"CCG",className:"Ticonderoga-class Cruiser approx.",prefix:"CG",lengthM:173,beamM:16.8,draftM:10.2,displacementT:9600,cruiseSpeedKt:18,maxSpeedKt:32.5,accelMps2:0.11,decelMps2:0.20,turnRateDps:2.2,turnRateFlankDps:1.5,radarRangeNm:210,radarIntervalS:3.5,vlsCells:122,ciwsCount:2,ciwsAmmo:3100,ciwsBurstRounds:200,ciwsBurstS:1.6,ciwsCycleS:4.8,defenseChannels:{area:4,point:3,ciws:2},damageResist:3,damageDegrade:0.24 },
  BBG: { hull:"BBG",className:"Trump-class Arsenal Battleship approx.",prefix:"BBG",lengthM:262,beamM:32,draftM:12.5,displacementT:28000,cruiseSpeedKt:16,maxSpeedKt:24,accelMps2:0.06,decelMps2:0.12,turnRateDps:1.2,turnRateFlankDps:0.7,radarRangeNm:250,radarIntervalS:3.0,vlsCells:288,ciwsCount:5,ciwsAmmo:6200,ciwsBurstRounds:300,ciwsBurstS:1.8,ciwsCycleS:3.5,defenseChannels:{area:6,point:4,ciws:4},damageResist:5,damageDegrade:0.14 },
  FFG: { hull:"FFG",className:"Constellation-class Frigate approx.",prefix:"FFG",lengthM:151,beamM:19.7,draftM:7.9,displacementT:7300,cruiseSpeedKt:16,maxSpeedKt:26,accelMps2:0.14,decelMps2:0.25,turnRateDps:3.2,turnRateFlankDps:2.4,radarRangeNm:150,radarIntervalS:5,vlsCells:32,ciwsCount:1,ciwsAmmo:800,ciwsBurstRounds:150,ciwsBurstS:1.2,ciwsCycleS:6.0,defenseChannels:{area:1,point:1,ciws:1},damageResist:1,damageDegrade:0.45 },

  // --- Fixed ground emplacements (domain:"ground", speed 0) ----------------
  // Modeled as stationary ship-entities so they flow through the existing
  // sensor/CEC/engagement pipeline unchanged. They are placed on land, never
  // re-seated to water, and never maneuver. Each is a distinct unit type.
  SAM: { hull:"SAM",className:"Coastal SAM Battery approx.",prefix:"SAM",domain:"ground",isFixed:true,glyph:"sam",lengthM:55,beamM:55,draftM:12,displacementT:6000,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:160,radarIntervalS:3.5,vlsCells:64,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{area:4,point:3,ciws:0},damageResist:2,damageDegrade:0.30,baseLoadout:{ "SM-2MR":32,"SM-6":8,ESSM:16 } },
  // Coastal battery carries an over-the-horizon targeting radar so its long
  // anti-ship missiles are usable at range rather than blind beyond a short
  // radar (its own radar must out-reach its primary MaritimeStrike envelope).
  CDB: { hull:"CDB",className:"Coastal Defense Battery approx.",prefix:"CDB",domain:"ground",isFixed:true,glyph:"bunker",lengthM:50,beamM:50,draftM:10,displacementT:5000,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:250,radarIntervalS:4,vlsCells:48,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{area:0,point:0,ciws:0},damageResist:2,damageDegrade:0.34,baseLoadout:{ MaritimeStrike:32,TomahawkBlockV:8 } },
  EWR: { hull:"EWR",className:"Early-Warning Radar approx.",prefix:"EWR",domain:"ground",isFixed:true,glyph:"radar",lengthM:40,beamM:40,draftM:14,displacementT:2500,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:400,radarIntervalS:5,vlsCells:0,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{area:0,point:0,ciws:0},damageResist:1,damageDegrade:0.5,baseLoadout:{} },

  // --- Air units (domain:"air") --------------------------------------------
  // A squadron is one fast-moving entity standing in for a flight of aircraft.
  // damageResist == plane count, so each hit downs one aircraft (attrition). It
  // joins the sensor/CEC net automatically via its radar + track-file. Carrier
  // basing is out of scope; squadrons are spawned directly and rearm at an
  // airfield. enduranceS / rearmTimeS are TEMP tunables (see aircraft.js).
  // F/A-18E/F Super Hornet squadron (4 aircraft). Mixed strike load: AMRAAM +
  // Sidewinder for air-to-air, Harpoon for anti-surface. Hardpoints (vlsCells)
  // hold the flight's aggregate stores; flares are the IR countermeasure pool.
  VFA: { hull:"VFA",className:"Strike Fighter Squadron approx.",prefix:"VFA",domain:"air",isFixed:false,glyph:"aircraft",lengthM:20,beamM:14,draftM:5,displacementT:30,cruiseSpeedKt:420,maxSpeedKt:540,accelMps2:3.0,decelMps2:3.0,turnRateDps:8,turnRateFlankDps:6,radarRangeNm:90,radarIntervalS:3,vlsCells:20,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{area:0,point:0,ciws:0},damageResist:4,damageDegrade:0.10,enduranceS:1800,rearmTimeS:90,flares:60,baseLoadout:{ "AIM-120":8,"AIM-9X":4,"AGM-84":8 } },

  // --- Airfield (domain:"ground", placeable anywhere) ----------------------
  // Behaves like a fixed ground unit but may be placed on land OR water. Serves
  // as a rearm/refuel node for friendly squadrons. isAirfield gates placement
  // and the RTB logic (see aircraft.js / scenario.js).
  AFB: { hull:"AFB",className:"Airfield approx.",prefix:"AFB",domain:"ground",isFixed:true,isAirfield:true,glyph:"airfield",lengthM:80,beamM:80,draftM:10,displacementT:8000,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:180,radarIntervalS:4,vlsCells:0,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{area:0,point:0,ciws:0},damageResist:3,damageDegrade:0.30,baseLoadout:{} }
};

// Built-in hull ids captured at module load. Protected from deletion and
// re-seeded to canonical values on every boot.
const BUILTIN_SHIP_IDS = new Set(Object.keys(SHIP_CLASSES));

/** True when `hull` is a vanilla (non-removable) ship/ground class. */
export function isBuiltinShipClass(hull) {
  return BUILTIN_SHIP_IDS.has(hull);
}

/** Register (or replace) a ship/ground class under its `hull` key. */
export function registerShipClass(cls) {
  if (!cls || typeof cls.hull !== "string" || !cls.hull) {
    throw new Error("registerShipClass: cls.hull is required");
  }
  SHIP_CLASSES[cls.hull] = cls;
  return cls.hull;
}

/** Remove a custom ship/ground class. Built-in classes are never removed. */
export function unregisterShipClass(hull) {
  if (BUILTIN_SHIP_IDS.has(hull)) return false;
  if (!(hull in SHIP_CLASSES)) return false;
  delete SHIP_CLASSES[hull];
  return true;
}

export { SHIP_CLASSES };

// Default radar cross-section (m²) when a class omits `rcsM2`. Surface ships
// scale with displacement; ground structures are large; an aircraft flight is a
// small, hard-to-detect target. A class may override (e.g. a future stealth hull
// with a deliberately low value). Used by the RCS-based detection model.
export function defaultRcsM2(cls) {
  if (Number.isFinite(cls.rcsM2)) return cls.rcsM2;
  const domain = cls.domain ?? "sea";
  if (domain === "air") return 25;
  if (domain === "ground") return 9000;
  return clamp((cls.displacementT ?? 9000) * 1.3, 3000, 50000);
}

// Default cruise altitude (m). Only aircraft fly; surface/ground sit at sea
// level (their radar-reflective height is the structural mast, handled by the
// sensor model). A class may override via `cruiseAltitudeM`.
export function defaultAltitudeM(cls) {
  if (Number.isFinite(cls.cruiseAltitudeM)) return cls.cruiseAltitudeM;
  return (cls.domain ?? "sea") === "air" ? 9000 : 0;
}

export function makeShip(side, x, y, hull = "DDG") {
  const cls = SHIP_CLASSES[hull] || SHIP_CLASSES.DDG;
  const seq = nextId++;
  const id = `${cls.prefix}-${seq}`;
  const cruise = cls.cruiseSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER;
  const loadout = normalizeLoadout(defaultLoadout(hull));
  const isAir = (cls.domain ?? "sea") === "air";
  return {
    id, name: `${side} ${cls.prefix} ${seq}`, side, hull, className: cls.className, x, y,
    domain: cls.domain ?? "sea", isFixed: cls.isFixed ?? false, glyph: cls.glyph ?? null,
    isAirfield: cls.isAirfield ?? false,
    // Air-unit state (squadron lifecycle/fuel/rearm). Empty object for non-air
    // so consumers can read uniformly; populated only for domain "air".
    ...(isAir ? initialAircraftState(cls) : {}),
    // Snapshot the spawned magazine so an airfield can refill it on rearm.
    baseLoadoutSnapshot: { ...loadout },
    heading: side === SIDE.BLUE ? Math.PI : 0, speed: 0,
    cruiseSpeed: cruise, desiredSpeed: cruise,
    maxSpeed: cls.maxSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER,
    accel: cls.accelMps2 * SHIP_SPEED_MULTIPLIER, decel: cls.decelMps2 * SHIP_SPEED_MULTIPLIER,
    turnRate: cls.turnRateDps * Math.PI / 180, turnRateFlank: cls.turnRateFlankDps * Math.PI / 180,
    lengthM: cls.lengthM, beamM: cls.beamM, draftM: cls.draftM, displacementT: cls.displacementT,
    // Signature + altitude drive RCS/horizon-based detection (see sensors.js).
    rcsM2: defaultRcsM2(cls), altitudeM: defaultAltitudeM(cls),
    radarRangeM: cls.radarRangeNm * NM, radarInterval: cls.radarIntervalS, radarCooldown: 0, radarActive: true,
    editable: true, alive: true,
    damage: 0, damageResist: cls.damageResist, damageDegrade: cls.damageDegrade,
    subsystems: { radar: 1.0, vls: 1.0, propulsion: 1.0, fireControl: 1.0, ciws: 1.0, cic: 1.0 },
    waypoint: null,
    navigationWaypoint: null,
    loadout,
    vlsCells: cls.vlsCells,
    tracks: new Map(),
    doctrine: { aggression: 0.65, standoffNm: 70, defensiveRangeNm: 22, conserveWeapons: 0.25 },
    defenseDoctrine: { sm2EarlyTtiS: 38, essmPreferredMaxNm: 24, saturationThreshold: 3, maxAssignedInterceptors: 2 },
    offenseDoctrine: { minimumTrackQuality: 0.32, desiredLeakers: 2, raidSaturation: 6, reserveTomahawk: 0.35 },
    roe: defaultRoe(),
    fleetRole: FLEET_ROLE.UNIT, isOTC: false,
    sectorCenter: side === SIDE.BLUE ? 0 : Math.PI, sectorHalfWidth: Math.PI, station: null,
    nextDecision: 0, reactionAvailableAt: 0, defenseReactionAvailableAt: 0, ciwsCooldown: 0,
    ciwsCount: cls.ciwsCount, ciwsAmmo: cls.ciwsAmmo,
    ciwsBurstRounds: cls.ciwsBurstRounds, ciwsBurstS: cls.ciwsBurstS, ciwsCycleS: cls.ciwsCycleS,
    ciwsBurstUntil: 0, nextCiwsAt: 0,
    defenseChannels: { ...cls.defenseChannels },
    engagementAssignments: {}, lastFirePlanAt: -Infinity,
    launchQueue: [], nextLaunchAt: 0, nextDefensiveLaunchAt: 0, lastLaunchAtByMissile: {}
  };
}

export function makeBurke(side, x, y) {
  return makeShip(side, x, y, "DDG");
}

export function offensiveMissileCount(ship, includeDualRole = true) {
  const strike = (ship.loadout.MaritimeStrike ?? 0) + (ship.loadout.TomahawkBlockV ?? 0);
  return strike + (includeDualRole ? (ship.loadout["SM-6"] ?? 0) : 0);
}

export function sideOffensiveMissileCount(sim, side, includeDualRole = true) {
  return sim.ships
    .filter((ship) => ship.alive && ship.side === side)
    .reduce((sum, ship) => sum + offensiveMissileCount(ship, includeDualRole), 0);
}
