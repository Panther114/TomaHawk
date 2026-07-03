// Mod registry glue. Converts between the friendly editor-JSON unit shape
// (nautical miles, flat fields) and the internal sim spec (meters, full field
// set), and registers/unregisters units into the live MISSILES / SHIP_CLASSES
// catalogues. Pure (no DOM / IndexedDB), so it is unit-tested in Node.

import {
  NM,
  MISSILES,
  SHIP_CLASSES,
  defaultLoadout,
  registerMissile,
  unregisterMissile,
  isBuiltinMissile,
  registerShipClass,
  unregisterShipClass,
  isBuiltinShipClass
} from "../sim.js";

/** Registry key for a unit: ammo keys on its name/id, ships on their hull id. */
export function unitId(unit) {
  return unit.kind === "ammo" ? String(unit.name) : String(unit.id);
}

/** True when this editor-JSON unit corresponds to a built-in (locked) type. */
export function isBuiltinUnit(unit) {
  return unit.kind === "ammo" ? isBuiltinMissile(unitId(unit)) : isBuiltinShipClass(unitId(unit));
}

/** Generate a hull id not already present in SHIP_CLASSES, derived from a tag. */
export function makeUniqueShipId(prefix) {
  const base = String(prefix || "UNIT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "UNIT";
  let id = base;
  let n = 1;
  while (id in SHIP_CLASSES) id = `${base}${n++}`;
  return id;
}

const numClean = (loadout) => {
  const out = {};
  for (const [id, count] of Object.entries(loadout || {})) {
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (n > 0) out[id] = n;
  }
  return out;
};

// --- editor JSON -> internal spec -----------------------------------------

function toMissileSpec(u) {
  return {
    name: u.name,
    // The ammo editor only exposes the ID, so a custom weapon labels itself with
    // its ID everywhere (map ring, inventory, loadout picker). We force shortLabel
    // to the name rather than honoring a stale value carried over from a clone —
    // otherwise e.g. an SM-7X cloned from MaritimeStrike would display as "MSTK".
    displayName: u.displayName || u.name,
    shortLabel: u.name,
    role: u.role || "custom",
    category: u.category,
    symbol: u.symbol,
    rangeM: Number(u.rangeNm) * NM,
    speedMps: Number(u.speedMps),
    cellCost: Number(u.cellCost),
    pk: Number(u.pk),
    salvo: Math.round(Number(u.salvo)),
    target: u.target,
    defenseLayer: u.defenseLayer,
    preferredMinRangeM: Number(u.preferredMinRangeNm) * NM,
    preferredMaxRangeM: Number(u.preferredMaxRangeNm) * NM,
    interceptorsPerThreat: Math.round(Number(u.interceptorsPerThreat)),
    nezFraction: Number.isFinite(Number(u.nezFraction)) ? Number(u.nezFraction) : 0.5,
    magazineReserveRatio: Number(u.magazineReserveRatio),
    launchIntervalS: Number(u.launchIntervalS),
    salvoSpacingS: Number(u.salvoSpacingS),
    ringStyle: u.ringStyle,
    maxTurnRateDps: Number(u.maxTurnRateDps),
    seekerRangeM: Number(u.seekerRangeNm) * NM,
    guidance: u.guidance,
    retargetable: !!u.retargetable,
    selfDestructOnLoss: !!u.selfDestructOnLoss
  };
}

function toNavalClass(u) {
  // Hull dimensions are not exposed in the editor (draft/displacement are pure
  // flavor; length/beam only scale the map icon). Default them so custom ships
  // still render at a sensible size and hand-edited imports never break.
  return {
    hull: u.id, className: u.name, prefix: u.prefix, domain: "sea", isFixed: false,
    lengthM: Number(u.lengthM) || 150, beamM: Number(u.beamM) || 20,
    draftM: Number(u.draftM) || 9, displacementT: Number(u.displacementT) || 9000,
    cruiseSpeedKt: Number(u.cruiseSpeedKt), maxSpeedKt: Number(u.maxSpeedKt),
    accelMps2: Number(u.accelMps2), decelMps2: Number(u.decelMps2),
    turnRateDps: Number(u.turnRateDps), turnRateFlankDps: Number(u.turnRateFlankDps),
    radarRangeNm: Number(u.radarRangeNm), radarIntervalS: Number(u.radarIntervalS),
    vlsCells: Math.round(Number(u.vlsCells)),
    // CIWS hardware is no longer editable — a single default mount is used; the
    // editable "CIWS" defense-channel count below governs how many it can engage.
    ciwsCount: Number.isFinite(Number(u.ciwsCount)) ? Math.round(Number(u.ciwsCount)) : 1,
    ciwsAmmo: Number(u.ciwsAmmo) || 1550,
    ciwsBurstRounds: Number(u.ciwsBurstRounds) || 180, ciwsBurstS: Number(u.ciwsBurstS) || 1.4, ciwsCycleS: Number(u.ciwsCycleS) || 5.5,
    defenseChannels: { area: Math.round(Number(u.defenseArea)), point: Math.round(Number(u.defensePoint)), ciws: Math.round(Number(u.defenseCiws)) },
    damageResist: Number(u.damageResist), damageDegrade: Number(u.damageDegrade),
    baseLoadout: numClean(u.baseLoadout)
  };
}

function toGroundClass(u) {
  const isAirfield = !!u.isAirfield;
  return {
    // An airfield is a ground unit that may be placed anywhere and rearms
    // friendly squadrons; it carries the runway glyph by default.
    hull: u.id, className: u.name, prefix: u.prefix, domain: "ground", isFixed: true,
    isAirfield, glyph: u.glyph ?? (isAirfield ? "airfield" : "bunker"),
    lengthM: Number(u.lengthM), beamM: Number(u.beamM), draftM: 10, displacementT: 4000,
    cruiseSpeedKt: 0, maxSpeedKt: 0, accelMps2: 0, decelMps2: 0, turnRateDps: 0, turnRateFlankDps: 0,
    radarRangeNm: Number(u.radarRangeNm), radarIntervalS: Number(u.radarIntervalS),
    vlsCells: Math.round(Number(u.vlsCells)),
    ciwsCount: 0, ciwsAmmo: 0, ciwsBurstRounds: 0, ciwsBurstS: 0, ciwsCycleS: 5,
    defenseChannels: { area: Math.round(Number(u.defenseArea)), point: Math.round(Number(u.defensePoint)), ciws: 0 },
    damageResist: Number(u.damageResist), damageDegrade: Number(u.damageDegrade),
    baseLoadout: numClean(u.baseLoadout)
  };
}

function toAircraftClass(u) {
  // A squadron's hit-point pool equals its aircraft count, so damageResist is
  // the flight size. Hull dimensions are nominal (icon only). enduranceS /
  // rearmTimeS feed the (temporary) RTB/rearm model.
  const size = Math.max(1, Math.round(Number(u.squadronSize) || 4));
  return {
    hull: u.id, className: u.name, prefix: u.prefix, domain: "air", isFixed: false, glyph: "aircraft",
    lengthM: Number(u.lengthM) || 20, beamM: Number(u.beamM) || 14, draftM: 5, displacementT: 30,
    cruiseSpeedKt: Number(u.cruiseSpeedKt), maxSpeedKt: Number(u.maxSpeedKt),
    accelMps2: Number(u.accelMps2), decelMps2: Number(u.decelMps2),
    turnRateDps: Number(u.turnRateDps), turnRateFlankDps: Number(u.turnRateFlankDps),
    radarRangeNm: Number(u.radarRangeNm), radarIntervalS: Number(u.radarIntervalS),
    vlsCells: Math.round(Number(u.vlsCells)),
    ciwsCount: 0, ciwsAmmo: 0, ciwsBurstRounds: 0, ciwsBurstS: 0, ciwsCycleS: 5,
    defenseChannels: { area: 0, point: 0, ciws: 0 },
    damageResist: size, damageDegrade: Number(u.damageDegrade),
    enduranceS: Number(u.enduranceS) || 1800, rearmTimeS: Number(u.rearmTimeS) || 90,
    flares: Number.isFinite(Number(u.flares)) ? Math.round(Number(u.flares)) : 60,
    commandHub: !!u.commandHub,
    baseLoadout: numClean(u.baseLoadout)
  };
}

/** Build the internal sim spec for an editor-JSON unit (does not register it). */
export function toInternalSpec(unit) {
  if (unit.kind === "ammo") return toMissileSpec(unit);
  if (unit.kind === "ground") return toGroundClass(unit);
  if (unit.kind === "aircraft") return toAircraftClass(unit);
  return toNavalClass(unit);
}

// --- internal spec -> editor JSON (for seeding vanilla into the list) ------

function fromMissileSpec(id, s) {
  return {
    kind: "ammo", id, name: id, displayName: s.displayName, shortLabel: s.shortLabel, role: s.role,
    category: s.category, symbol: s.symbol, target: s.target, defenseLayer: s.defenseLayer,
    rangeNm: s.rangeM / NM, preferredMinRangeNm: s.preferredMinRangeM / NM, preferredMaxRangeNm: s.preferredMaxRangeM / NM,
    seekerRangeNm: s.seekerRangeM / NM, speedMps: s.speedMps, maxTurnRateDps: s.maxTurnRateDps,
    cellCost: s.cellCost, pk: s.pk, salvo: s.salvo, interceptorsPerThreat: s.interceptorsPerThreat,
    nezFraction: s.nezFraction ?? 0.5,
    magazineReserveRatio: s.magazineReserveRatio, launchIntervalS: s.launchIntervalS, salvoSpacingS: s.salvoSpacingS,
    ringStyle: s.ringStyle, guidance: s.guidance, retargetable: !!s.retargetable, selfDestructOnLoss: !!s.selfDestructOnLoss
  };
}

function fromShipClass(hull, c) {
  const base = {
    id: hull, name: c.className, prefix: c.prefix,
    lengthM: c.lengthM, beamM: c.beamM,
    radarRangeNm: c.radarRangeNm, radarIntervalS: c.radarIntervalS,
    vlsCells: c.vlsCells, damageResist: c.damageResist, damageDegrade: c.damageDegrade,
    defenseArea: c.defenseChannels?.area ?? 0, defensePoint: c.defenseChannels?.point ?? 0,
    baseLoadout: { ...(c.baseLoadout ?? defaultLoadout(hull)) }
  };
  if (c.domain === "air") {
    return {
      kind: "aircraft", id: hull, name: c.className, prefix: c.prefix,
      squadronSize: Math.max(1, Math.round(c.damageResist ?? 4)),
      commandHub: c.commandHub === true,
      cruiseSpeedKt: c.cruiseSpeedKt, maxSpeedKt: c.maxSpeedKt,
      accelMps2: c.accelMps2, decelMps2: c.decelMps2,
      turnRateDps: c.turnRateDps, turnRateFlankDps: c.turnRateFlankDps,
      radarRangeNm: c.radarRangeNm, radarIntervalS: c.radarIntervalS,
      vlsCells: c.vlsCells, enduranceS: c.enduranceS ?? 1800, rearmTimeS: c.rearmTimeS ?? 90,
      damageDegrade: c.damageDegrade, flares: c.flares ?? 60,
      baseLoadout: { ...(c.baseLoadout ?? {}) }
    };
  }
  if (c.domain === "ground") {
    return { kind: "ground", glyph: c.glyph ?? "bunker", isAirfield: c.isAirfield ?? false, ...base };
  }
  return {
    kind: "naval", ...base,
    draftM: c.draftM, displacementT: c.displacementT,
    cruiseSpeedKt: c.cruiseSpeedKt, maxSpeedKt: c.maxSpeedKt,
    accelMps2: c.accelMps2, decelMps2: c.decelMps2,
    turnRateDps: c.turnRateDps, turnRateFlankDps: c.turnRateFlankDps,
    ciwsCount: c.ciwsCount, ciwsAmmo: c.ciwsAmmo, ciwsBurstRounds: c.ciwsBurstRounds,
    ciwsBurstS: c.ciwsBurstS, ciwsCycleS: c.ciwsCycleS,
    defenseCiws: c.defenseChannels?.ciws ?? 0
  };
}

/** Return the built-in units as locked editor-JSON records for store seeding. */
export function vanillaUnits() {
  const out = [];
  for (const [id, spec] of Object.entries(MISSILES)) {
    if (isBuiltinMissile(id)) out.push({ ...fromMissileSpec(id, spec), builtin: true, locked: true });
  }
  for (const [hull, cls] of Object.entries(SHIP_CLASSES)) {
    if (isBuiltinShipClass(hull)) out.push({ ...fromShipClass(hull, cls), builtin: true, locked: true });
  }
  return out;
}

/** Register (or replace) an editor-JSON unit into the live catalogues. */
export function registerUnit(unit) {
  const spec = toInternalSpec(unit);
  if (unit.kind === "ammo") return registerMissile(spec);
  return registerShipClass(spec);
}

/** Remove a custom unit from the live catalogues. Built-ins are never removed. */
export function unregisterUnit(unit) {
  return unit.kind === "ammo" ? unregisterMissile(unitId(unit)) : unregisterShipClass(unitId(unit));
}

/** Available ammo ids (for loadout pickers): all registered missiles. */
export function availableAmmoIds() {
  return Object.keys(MISSILES);
}
