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

export function normalizeLoadout(loadout, legacyAim120Id = "AIM-120C") {
  const normalized = {};
  for (const [id, count] of Object.entries(loadout || {})) {
    const missileId = id === "AIM-120" ? legacyAim120Id : id;
    if (!MISSILES[missileId]) continue;
    const numeric = Number.isFinite(count) ? count : 0;
    const rounded = Math.round(numeric);
    normalized[missileId] = Math.max(0, rounded);
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
  DDG: { hull:"DDG",className:"Arleigh Burke Flight IIA approx.",prefix:"DDG",lengthM:155,beamM:20,draftM:9.3,displacementT:9200,cruiseSpeedKt:16,maxSpeedKt:31,accelMps2:0.12,decelMps2:0.22,turnRateDps:2.6,turnRateFlankDps:1.8,radarRangeNm:190,radarIntervalS:4,vlsCells:96,ciwsCount:1,ciwsAmmo:1550,ciwsBurstRounds:180,ciwsBurstS:1.4,ciwsCycleS:5.5,defenseChannels:{sam:4,ciws:1},damageResist:2,damageDegrade:0.30 },
  CCG: { hull:"CCG",className:"Ticonderoga-class Cruiser approx.",prefix:"CG",lengthM:173,beamM:16.8,draftM:10.2,displacementT:9600,cruiseSpeedKt:18,maxSpeedKt:32.5,accelMps2:0.11,decelMps2:0.20,turnRateDps:2.2,turnRateFlankDps:1.5,radarRangeNm:210,radarIntervalS:3.5,vlsCells:122,ciwsCount:2,ciwsAmmo:3100,ciwsBurstRounds:200,ciwsBurstS:1.6,ciwsCycleS:4.8,defenseChannels:{sam:7,ciws:2},damageResist:3,damageDegrade:0.24 },
  BBG: { hull:"BBG",className:"Trump-class Arsenal Battleship approx.",prefix:"BBG",lengthM:262,beamM:32,draftM:12.5,displacementT:28000,cruiseSpeedKt:16,maxSpeedKt:24,accelMps2:0.06,decelMps2:0.12,turnRateDps:1.2,turnRateFlankDps:0.7,radarRangeNm:250,radarIntervalS:3.0,vlsCells:288,ciwsCount:5,ciwsAmmo:6200,ciwsBurstRounds:300,ciwsBurstS:1.8,ciwsCycleS:3.5,defenseChannels:{sam:10,ciws:4},damageResist:5,damageDegrade:0.14 },
  FFG: { hull:"FFG",className:"Constellation-class Frigate approx.",prefix:"FFG",lengthM:151,beamM:19.7,draftM:7.9,displacementT:7300,cruiseSpeedKt:16,maxSpeedKt:26,accelMps2:0.14,decelMps2:0.25,turnRateDps:3.2,turnRateFlankDps:2.4,radarRangeNm:150,radarIntervalS:5,vlsCells:32,ciwsCount:1,ciwsAmmo:800,ciwsBurstRounds:150,ciwsBurstS:1.2,ciwsCycleS:6.0,defenseChannels:{sam:2,ciws:1},damageResist:1,damageDegrade:0.45 },

  // --- Fixed ground emplacements (domain:"ground", speed 0) ----------------
  // Modeled as stationary ship-entities so they flow through the existing
  // sensor/CEC/engagement pipeline unchanged. They are placed on land, never
  // re-seated to water, and never maneuver. Each is a distinct unit type.
  SAM: { hull:"SAM",className:"Coastal SAM Battery approx.",prefix:"SAM",domain:"ground",isFixed:true,glyph:"sam",lengthM:55,beamM:55,draftM:12,displacementT:6000,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:160,radarIntervalS:3.5,vlsCells:64,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:7,ciws:0},damageResist:2,damageDegrade:0.30,baseLoadout:{ "SM-2MR":32,"SM-6":8,ESSM:16 } },
  // Coastal battery carries an over-the-horizon targeting radar so its long
  // anti-ship missiles are usable at range rather than blind beyond a short
  // radar (its own radar must out-reach its primary MaritimeStrike envelope).
  CDB: { hull:"CDB",className:"Coastal Strike Battery approx.",prefix:"Coast Strike",domain:"ground",isFixed:true,glyph:"bunker",lengthM:50,beamM:50,draftM:10,displacementT:5000,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:250,radarIntervalS:4,vlsCells:48,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},damageResist:2,damageDegrade:0.34,baseLoadout:{ MaritimeStrike:32,TomahawkBlockV:8 } },
  DEB: { hull:"DEB",className:"Dark Eagle Battery approx.",prefix:"Dark Eagle",domain:"ground",isFixed:true,glyph:"bunker",lengthM:70,beamM:55,draftM:10,displacementT:6500,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:500,radarIntervalS:4.5,vlsCells:8,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},damageResist:2,damageDegrade:0.34,baseLoadout:{ DarkEagle:8 } },
  EWR: { hull:"EWR",className:"Early-Warning Radar approx.",prefix:"EW Radar",domain:"ground",isFixed:true,glyph:"radar",lengthM:40,beamM:40,draftM:14,displacementT:2500,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:400,radarIntervalS:5,vlsCells:0,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},damageResist:1,damageDegrade:0.5,baseLoadout:{} },

  // --- Air units (domain:"air") --------------------------------------------
  // A squadron is one fast-moving entity standing in for a flight of aircraft.
  // damageResist == plane count, so each hit downs one aircraft (attrition). It
  // joins the sensor/CEC net automatically via its radar + track-file. Carrier
  // basing is out of scope; squadrons are spawned directly and rearm at an
  // airfield. enduranceS / rearmTimeS are TEMP tunables (see aircraft.js).
  // maxGLoad is the airframe's combat turn-rate ceiling (structural G limit),
  // used only for aggressive maneuvers (evasion, a merge/intercept) — routine
  // navigation flies a much gentler standard-rate turn regardless of hull; see
  // aircraftTurnRateRadPerS in movement.js. turnRateDps/turnRateFlankDps are
  // legacy/display-only for aircraft (kept for schema compatibility) and no
  // longer drive their steering.
  //
  // Six fixed-identity airframes, each with a RIGID default loadout that
  // defines its role — vlsCells is sized to exactly fit that loadout, so a
  // squadron spawns as (and stays) purpose-built rather than a generic
  // "multirole" hardpoint budget. Two generations (5th-gen low-observable,
  // 4.5-gen non-stealth) cross three roles (air-to-air only, anti-ground
  // strike, anti-ship strike): AGM-154 JSOW is the dedicated stand-off
  // anti-ground weapon, AGM-84 Harpoon the dedicated anti-ship weapon — a
  // strike airframe never carries both, and an air-superiority airframe
  // carries neither.
  //
  // Unit tags follow a GxRR scheme (Generation x Role): AA = air-superiority
  // (air-to-air only), AG = anti-ground strike (matches this project's own
  // AGM-84/AGM-154 naming), AS = anti-ship strike. Class names are kept short
  // ("5th Gen X" / "4th Gen X") rather than a real-airframe name + parenthetical
  // — the tag + name pair is what actually renders in the unit list/inventory.
  // All 5th-gen hulls share the same hardpoint count (8) and all 4.5-gen hulls
  // share theirs (14) so the roster reads as two clean weight classes rather
  // than six ad hoc numbers; loadouts are rebalanced to fill each exactly.
  //
  // 5th-GEN air-superiority — 4-aircraft squadron. No strike weapons at all:
  // the lowest radar cross-section and the highest agility of the six, built
  // to win the air-to-air fight before anyone else can shoot.
  F22: { hull:"F22",className:"5th Gen Air Supremacy",prefix:"G5 Air Sup",domain:"air",isFixed:false,glyph:"aircraft",lengthM:19,beamM:13.5,draftM:5,displacementT:28,cruiseSpeedKt:460,maxSpeedKt:580,accelMps2:3.4,decelMps2:3.2,turnRateDps:10,turnRateFlankDps:8,maxGLoad:9.0,radarRangeNm:120,radarIntervalS:2.5,vlsCells:8,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},rcsM2:1.5,damageResist:4,damageDegrade:0.09,enduranceS:11454,rearmTimeS:85,flares:60,airEvasionBonus:0.12,baseLoadout:{ "AIM-120D":6,"AIM-9X":2 } },
  // 5th-GEN anti-ground — 4-aircraft squadron. Self-defence AAMs plus a JSOW
  // stand-off strike load; carries no anti-ship weapon.
  F35A: { hull:"F35A",className:"5th Gen Strike",prefix:"G5 Strike",domain:"air",isFixed:false,glyph:"aircraft",lengthM:15.7,beamM:10.7,draftM:4.4,displacementT:29,cruiseSpeedKt:420,maxSpeedKt:540,accelMps2:3.0,decelMps2:3.0,turnRateDps:7,turnRateFlankDps:5,maxGLoad:7.0,radarRangeNm:110,radarIntervalS:2.5,vlsCells:8,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},rcsM2:2.3,damageResist:4,damageDegrade:0.10,enduranceS:12544,rearmTimeS:95,flares:56,airEvasionBonus:0.06,baseLoadout:{ "AIM-120D":2,"AIM-9X":2,"AGM-154":4 } },
  // 5th-GEN anti-ship — 4-aircraft squadron, the carrier variant. Same stealth
  // family as the anti-ground hull but loaded with AGM-84 instead of JSOW;
  // bigger wing and fuel fraction mean it needs more endurance seconds to cover
  // the same 5th-gen combat radius at its lower cruise speed.
  F35C: { hull:"F35C",className:"5th Gen Sea Strike",prefix:"G5 Sea Strike",domain:"air",isFixed:false,glyph:"aircraft",lengthM:15.7,beamM:13.1,draftM:4.4,displacementT:32,cruiseSpeedKt:400,maxSpeedKt:520,accelMps2:2.8,decelMps2:2.8,turnRateDps:6.5,turnRateFlankDps:5,maxGLoad:6.5,radarRangeNm:110,radarIntervalS:2.5,vlsCells:8,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},rcsM2:2.3,damageResist:4,damageDegrade:0.10,enduranceS:13171,rearmTimeS:100,flares:56,airEvasionBonus:0.06,baseLoadout:{ "AIM-120D":2,"AIM-9X":2,"AGM-84":4 } },
  // 4.5-GEN anti-ground — 4-aircraft squadron. Non-stealth (large radar
  // cross-section, no evasion bonus) but the biggest bomb truck of the six: a
  // heavier JSOW load than the 5th-gen anti-ground hull and the toughest airframe.
  F15E: { hull:"F15E",className:"4th Gen Strike",prefix:"G4 Strike",domain:"air",isFixed:false,glyph:"aircraft",lengthM:19.4,beamM:13,draftM:5.6,displacementT:36,cruiseSpeedKt:430,maxSpeedKt:560,accelMps2:3.0,decelMps2:3.0,turnRateDps:7,turnRateFlankDps:5.5,maxGLoad:7.5,radarRangeNm:90,radarIntervalS:3,vlsCells:14,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},rcsM2:22,damageResist:4,damageDegrade:0.10,enduranceS:13885,rearmTimeS:95,flares:60,airEvasionBonus:0,baseLoadout:{ "AIM-120C":4,"AIM-9X":2,"AGM-154":8 } },
  // 4.5-GEN anti-ship — 4-aircraft squadron. Not a real airframe: a fictional
  // naval-strike sibling of the anti-ground hull carrying AGM-84 instead of
  // JSOW, same non-stealth chassis and toughness.
  F15N: { hull:"F15N",className:"4th Gen Sea Strike",prefix:"G4 Sea Strike",domain:"air",isFixed:false,glyph:"aircraft",lengthM:19.4,beamM:13,draftM:5.6,displacementT:36,cruiseSpeedKt:430,maxSpeedKt:560,accelMps2:3.0,decelMps2:3.0,turnRateDps:7,turnRateFlankDps:5.5,maxGLoad:7.5,radarRangeNm:90,radarIntervalS:3,vlsCells:14,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},rcsM2:22,damageResist:4,damageDegrade:0.10,enduranceS:13885,rearmTimeS:95,flares:60,airEvasionBonus:0,baseLoadout:{ "AIM-120C":4,"AIM-9X":2,"AGM-84":8 } },
  // 4.5-GEN air-superiority — 4-aircraft squadron. No strike weapons at all,
  // like the 5th-gen air-superiority hull, but non-stealth: a bigger radar
  // signature traded for the biggest internal AAM load of the roster.
  F15C: { hull:"F15C",className:"4th Gen Air Supremacy",prefix:"G4 Air Sup",domain:"air",isFixed:false,glyph:"aircraft",lengthM:19.4,beamM:13,draftM:5.6,displacementT:31,cruiseSpeedKt:440,maxSpeedKt:580,accelMps2:3.2,decelMps2:3.0,turnRateDps:8,turnRateFlankDps:6,maxGLoad:8.5,radarRangeNm:95,radarIntervalS:3,vlsCells:14,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},rcsM2:20,damageResist:4,damageDegrade:0.10,enduranceS:13570,rearmTimeS:90,flares:60,airEvasionBonus:0.02,baseLoadout:{ "AIM-120C":10,"AIM-9X":4 } },
  // AEW&C — E-2D Hawkeye squadron approx. (1 aircraft: unlike the fighter
  // roster this models a single high-value, unescorted-feeling sensor
  // platform, not a 4-ship flight — damageResist:1 makes any hit a mission
  // kill, same as the real thing). Unarmed (baseLoadout:{}) and slow — it is
  // a moving radar, not a combatant, and its own AI never chases a fight (see
  // decideAircraft's unarmed-orbit branch in aircraft.js). Its radar is the
  // longest of any mobile platform (only a fixed EWR out-ranges it) and its
  // rcsM2 is large and non-stealthy (a big, un-hidden rotodome) — it survives
  // by standing off behind the formation, not by being hard to see.
  // commandHub:true is the "acts as a command hub when present" behaviour: it
  // tightens fleet-wide CEC track-sharing latency while alive and on mission
  // (see shareTracks in sensors.js) — any custom aircraft can opt into the
  // same behaviour from the Unit Workshop.
  AWAC: { hull:"AWAC",className:"E-2D Hawkeye Squadron (AEW&C) approx.",prefix:"AWAC",domain:"air",isFixed:false,glyph:"aircraft",lengthM:17.6,beamM:24.6,draftM:5.6,displacementT:24,cruiseSpeedKt:300,maxSpeedKt:330,accelMps2:1.6,decelMps2:1.6,turnRateDps:5,turnRateFlankDps:4,maxGLoad:3.0,commandHub:true,radarRangeNm:350,radarIntervalS:2,vlsCells:0,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},rcsM2:35,damageResist:1,damageDegrade:0.10,enduranceS:7200,rearmTimeS:60,flares:30,airEvasionBonus:0,baseLoadout:{} },

  // --- Airfield (domain:"ground", placeable anywhere) ----------------------
  // Behaves like a fixed ground unit but may be placed on land OR water. Serves
  // as a rearm/refuel node for friendly squadrons. isAirfield gates placement
  // and the RTB logic (see aircraft.js / scenario.js).
  AFB: { hull:"AFB",className:"Airfield approx.",prefix:"Airfield",domain:"ground",isFixed:true,isAirfield:true,glyph:"airfield",lengthM:80,beamM:80,draftM:10,displacementT:8000,cruiseSpeedKt:0,maxSpeedKt:0,accelMps2:0,decelMps2:0,turnRateDps:0,turnRateFlankDps:0,radarRangeNm:180,radarIntervalS:4,vlsCells:0,ciwsCount:0,ciwsAmmo:0,ciwsBurstRounds:0,ciwsBurstS:0,ciwsCycleS:5,defenseChannels:{sam:0,ciws:0},damageResist:3,damageDegrade:0.30,baseLoadout:{} }
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
    // Combat turn-rate ceiling for aircraft (structural G limit); see the
    // class-block comment above and aircraftTurnRateRadPerS in movement.js.
    // Harmless/unused for non-air hulls.
    maxGLoad: cls.maxGLoad ?? 7,
    // "Acts as a command hub when present" — see shareTracks in sensors.js.
    // Any hull (vanilla or custom) can opt in via this flag; not aircraft-
    // specific in the schema, though only a mobile, sensor-heavy platform
    // like an AWACS makes realistic sense as one.
    commandHub: cls.commandHub === true,
    lengthM: cls.lengthM, beamM: cls.beamM, draftM: cls.draftM, displacementT: cls.displacementT,
    // Signature + altitude drive RCS/horizon-based detection (see sensors.js).
    rcsM2: defaultRcsM2(cls),
    // altitudeM is the PHYSICAL altitude, climbed/descended toward
    // targetAltitudeM at a bounded rate (see moveAirUnit in movement.js) —
    // the AI layer commands a target, it does not teleport the aircraft
    // there. Irrelevant for surface/ground hulls (both stay at 0).
    altitudeM: defaultAltitudeM(cls), targetAltitudeM: defaultAltitudeM(cls),
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
    defenseChannels: {
      sam: cls.defenseChannels?.sam ?? ((cls.defenseChannels?.area ?? 0) + (cls.defenseChannels?.point ?? 0)),
      ciws: cls.defenseChannels?.ciws ?? 0
    },
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
