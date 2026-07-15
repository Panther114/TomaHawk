// Mod registry glue. Converts between the friendly editor-JSON unit shape
// (nautical miles, flat fields) and the internal sim spec (meters, full field
// set), and registers/unregisters units into the live MISSILES / SHIP_CLASSES
// catalogues. Pure (no DOM / IndexedDB), so it is unit-tested in Node.

import {
  NM,
  MISSILES,
  SHIP_CLASSES,
  defaultLoadout,
  defaultRcsM2,
  registerMissile,
  unregisterMissile,
  isBuiltinMissile,
  registerShipClass,
  unregisterShipClass,
  isBuiltinShipClass,
  missileAllowedForDomain,
  missileLaunchers,
  missileTargets
} from "../sim.js";

/** Registry key for a unit: ammo keys on its name/id, ships on their hull id. */
export function unitId(unit) {
  return unit.kind === "ammo" ? String(unit.name) : String(unit.id);
}

// Maps an editor-JSON unit kind to the missile-platform domain it corresponds
// to ("sea" for naval, "ground" for ground, "air" for aircraft) -- the same
// domain vocabulary a ship's own `domain` field uses. Used both by the
// Workshop's loadout picker and by validateUnit's cross-check (see
// missileAllowedForDomain) so a unit can only be given ammo built for it.
export const UNIT_KIND_DOMAIN = { naval: "sea", ground: "ground", aircraft: "air" };

const BUILTIN_PREFIX_ZH = {
  DDG: "驱逐舰", CCG: "巡洋舰", BBG: "战列舰", FFG: "护卫舰",
  SAM: "防空", CDB: "岸舰", DEB: "鹰击", EWR: "预警",
  F22: "F-22", F35A: "F-35A", F35C: "F-35C",
  F15E: "F-15E", F15N: "F-15N", F15C: "F-15C",
  F15EX: "F-15EX", F16V: "F-16V",
  AWAC: "预警机", AFB: "机场", CVN: "航母"
};
// prefixZh is display-only; unit-tag `prefix` itself stays alphanumeric (no "-").

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

const normalizeLaunchers = (u) => {
  const values = Array.isArray(u.launchers) ? u.launchers
    : Array.isArray(u.platforms) ? u.platforms
      : [
        u.platformSea ? "sea" : null,
        u.platformGround ? "ground" : null,
        u.platformAir ? "air" : null
      ];
  return [...new Set(values.filter((v) => ["sea", "ground", "air"].includes(v)))];
};

const normalizeTargets = (u) => {
  if (Array.isArray(u.targets) && u.targets.length) {
    return [...new Set(u.targets.filter((v) => ["air", "missile", "sea", "ground"].includes(v)))];
  }
  if (u.target === "missile") return ["missile"];
  if (u.target === "air") return ["air"];
  if (u.target === "dual") return ["missile", "air", "sea", "ground"];
  if (u.target === "ship" || u.category === "anti_ship") return ["sea", "ground"];
  return [];
};

const legacyCategory = (targets) => {
  const t = new Set(targets);
  const airDefense = t.has("missile") || t.has("air");
  const surface = t.has("sea") || t.has("ground");
  if (airDefense && surface) return "dual_role";
  if (airDefense) return t.has("air") && !t.has("missile") ? "air_to_air" : "ship_sam";
  return "anti_ship";
};

const legacyTarget = (targets) => {
  const t = new Set(targets);
  const airDefense = t.has("missile") || t.has("air");
  const surface = t.has("sea") || t.has("ground");
  if (airDefense && surface) return "dual";
  if (t.has("missile")) return "missile";
  if (t.has("air")) return "air";
  return "ship";
};

// --- editor JSON -> internal spec -----------------------------------------

function toMissileSpec(u) {
  const launchers = normalizeLaunchers(u);
  const targets = normalizeTargets(u);
  const cruiseAltitudeM = Number(u.cruiseAltitudeM);
  const terminalAltitudeM = Number(u.terminalAltitudeM);
  const terminalProfile = u.terminalProfile === "hypersonic_glide" ? "hypersonic_glide" : undefined;
  const rangeM = Number(u.rangeNm) * NM;
  // Explicit checkbox wins; otherwise hypersonic profile or very long reach
  // implies strategic (matches combat.js isStrategicSurfaceWeapon fallback).
  let strategic;
  if (u.strategic === true) strategic = true;
  else if (u.strategic === false) strategic = false;
  else if (terminalProfile === "hypersonic_glide" || rangeM >= 800 * NM) strategic = true;
  const spec = {
    name: u.name,
    // The ammo editor only exposes the ID, so a custom weapon labels itself with
    // its ID everywhere (map ring, inventory, loadout picker). We force shortLabel
    // to the name rather than honoring a stale value carried over from a clone —
    // otherwise e.g. an SM-7X cloned from MaritimeStrike would display as "MSTK".
    displayName: u.displayName || u.name,
    shortLabel: u.name,
    role: u.role || "custom",
    category: u.category || legacyCategory(targets),
    rcsM2: Number(u.rcsM2),
    platforms: launchers,
    launchers,
    targets,
    symbol: u.symbol,
    rangeM,
    speedMps: Number(u.speedMps),
    cellCost: Number(u.cellCost),
    pk: Number(u.pk),
    salvo: Math.round(Number(u.salvo)),
    target: u.target || legacyTarget(targets),
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
  if (terminalProfile) {
    spec.terminalProfile = terminalProfile;
    // High terminal profile defaults when the modder left altitudes at 0.
    if (Number.isFinite(cruiseAltitudeM) && cruiseAltitudeM > 0) spec.cruiseAltitudeM = cruiseAltitudeM;
    else spec.cruiseAltitudeM = 30000;
    if (Number.isFinite(terminalAltitudeM) && terminalAltitudeM > 0) spec.terminalAltitudeM = terminalAltitudeM;
    else spec.terminalAltitudeM = 5000;
    spec.terminalSeaSkimming = false;
  } else {
    if (Number.isFinite(cruiseAltitudeM) && cruiseAltitudeM > 0) spec.cruiseAltitudeM = cruiseAltitudeM;
    if (Number.isFinite(terminalAltitudeM) && terminalAltitudeM > 0) spec.terminalAltitudeM = terminalAltitudeM;
  }
  if (strategic === true) spec.strategic = true;
  if (strategic === false) spec.strategic = false;
  return spec;
}

// Checkbox in the Workshop only *opts in*. Unchecked means "use domain
// heuristic" (air + fixed ground with dedicated surface munitions), not an
// explicit opt-out — otherwise cloning an F-35 and re-saving would strip its
// specialist pass. Naval hulls still need the box checked (arsenal-ship case).
function strikeSpecialistFlag(u) {
  return u.strikeSpecialist === true ? true : undefined;
}

function toNavalClass(u) {
  // Hull dimensions are not exposed in the editor (draft/displacement are pure
  // flavor; length/beam only scale the map icon). Default them so custom ships
  // still render at a sensible size and hand-edited imports never break.
  const strikeSpecialist = strikeSpecialistFlag(u);
  const isAirfield = !!u.isAirfield;
  const maxParked = Number.isFinite(Number(u.maxParkedSquadrons))
    ? Math.max(0, Math.round(Number(u.maxParkedSquadrons)))
    : (isAirfield ? 6 : 0);
  return {
    hull: u.id, className: u.name, prefix: u.prefix, prefixZh: String(u.prefixZh || "").trim(), domain: "sea", isFixed: false,
    isAirfield,
    isCarrier: isAirfield,
    maxParkedSquadrons: maxParked,
    glyph: isAirfield ? (u.glyph || "carrier") : (u.glyph || null),
    lengthM: Number(u.lengthM) || 150, beamM: Number(u.beamM) || 20,
    draftM: Number(u.draftM) || 9, displacementT: Number(u.displacementT) || 9000,
    rcsM2: Number(u.rcsM2),
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
    defenseChannels: {
      sam: Math.round(Number(u.defenseSam ?? ((u.defenseArea ?? 0) + (u.defensePoint ?? 0)))),
      ciws: Math.round(Number(u.defenseCiws))
    },
    damageResist: Number(u.damageResist), damageDegrade: Number(u.damageDegrade),
    ...(strikeSpecialist === undefined ? {} : { strikeSpecialist }),
    baseLoadout: numClean(u.baseLoadout)
  };
}

function toGroundClass(u) {
  const isAirfield = !!u.isAirfield;
  const strikeSpecialist = strikeSpecialistFlag(u);
  return {
    // An airfield is a ground unit that may be placed anywhere and rearms
    // friendly squadrons; it carries the runway glyph by default.
    hull: u.id, className: u.name, prefix: u.prefix, prefixZh: String(u.prefixZh || "").trim(), domain: "ground", isFixed: true,
    isAirfield, glyph: u.glyph ?? (isAirfield ? "airfield" : "bunker"),
    lengthM: Number(u.lengthM), beamM: Number(u.beamM), draftM: 10, displacementT: 4000,
    rcsM2: Number(u.rcsM2),
    cruiseSpeedKt: 0, maxSpeedKt: 0, accelMps2: 0, decelMps2: 0, turnRateDps: 0, turnRateFlankDps: 0,
    radarRangeNm: Number(u.radarRangeNm), radarIntervalS: Number(u.radarIntervalS),
    vlsCells: Math.round(Number(u.vlsCells)),
    ciwsCount: 0, ciwsAmmo: 0, ciwsBurstRounds: 0, ciwsBurstS: 0, ciwsCycleS: 5,
    defenseChannels: { sam: Math.round(Number(u.defenseSam ?? ((u.defenseArea ?? 0) + (u.defensePoint ?? 0)))), ciws: 0 },
    damageResist: Number(u.damageResist), damageDegrade: Number(u.damageDegrade),
    maxParkedSquadrons: Number.isFinite(Number(u.maxParkedSquadrons))
      ? Math.max(0, Math.round(Number(u.maxParkedSquadrons)))
      : (isAirfield ? 12 : 0),
    ...(strikeSpecialist === undefined ? {} : { strikeSpecialist }),
    baseLoadout: numClean(u.baseLoadout)
  };
}

function toAircraftClass(u) {
  // A squadron's hit-point pool equals its aircraft count, so damageResist is
  // the flight size. Hull dimensions are nominal (icon only). enduranceS /
  // rearmTimeS feed the (temporary) RTB/rearm model.
  const size = Math.max(1, Math.round(Number(u.squadronSize) || 4));
  const strikeSpecialist = strikeSpecialistFlag(u);
  return {
    hull: u.id, className: u.name, prefix: u.prefix, prefixZh: String(u.prefixZh || "").trim(), domain: "air", isFixed: false, glyph: "aircraft",
    lengthM: Number(u.lengthM) || 20, beamM: Number(u.beamM) || 14, draftM: 5, displacementT: 30,
    rcsM2: Number(u.rcsM2),
    cruiseSpeedKt: Number(u.cruiseSpeedKt), maxSpeedKt: Number(u.maxSpeedKt),
    accelMps2: Number(u.accelMps2), decelMps2: Number(u.decelMps2),
    turnRateDps: Number(u.turnRateDps), turnRateFlankDps: Number(u.turnRateFlankDps),
    radarRangeNm: Number(u.radarRangeNm), radarIntervalS: Number(u.radarIntervalS),
    vlsCells: Math.round(Number(u.vlsCells)),
    ciwsCount: 0, ciwsAmmo: 0, ciwsBurstRounds: 0, ciwsBurstS: 0, ciwsCycleS: 5,
    defenseChannels: { sam: 0, ciws: 0 },
    damageResist: size, damageDegrade: Number(u.damageDegrade),
    enduranceS: Number(u.enduranceS) || 1800, rearmTimeS: Number(u.rearmTimeS) || 90,
    flares: Number.isFinite(Number(u.flares)) ? Math.round(Number(u.flares)) : 60,
    commandHub: !!u.commandHub,
    lowObservable: !!u.lowObservable,
    carrierCapable: !!u.carrierCapable,
    ...(strikeSpecialist === undefined ? {} : { strikeSpecialist }),
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
  const launchers = missileLaunchers(s);
  const targets = missileTargets(s);
  const strategic = s.strategic === true
    || (s.strategic !== false && (s.terminalProfile === "hypersonic_glide" || (s.rangeM ?? 0) >= 800 * NM));
  return {
    kind: "ammo", id, name: id, displayName: s.displayName, shortLabel: s.shortLabel, role: s.role,
    category: s.category, symbol: s.symbol, target: s.target,
    launchers,
    targets,
    // A legacy custom weapon saved before this field existed has no rcsM2 at
    // all; fall back to a plausible mid-size-munition default rather than
    // showing an empty/zero field.
    rcsM2: Number.isFinite(s.rcsM2) ? s.rcsM2 : 0.3,
    // A spec with no `platforms` predates this field and is unrestricted (see
    // missileAllowedForDomain), so it round-trips into the editor as "every
    // platform enabled" rather than silently losing all of them.
    platformSea: launchers.includes("sea"),
    platformGround: launchers.includes("ground"),
    platformAir: launchers.includes("air"),
    rangeNm: s.rangeM / NM, preferredMinRangeNm: s.preferredMinRangeM / NM, preferredMaxRangeNm: s.preferredMaxRangeM / NM,
    seekerRangeNm: s.seekerRangeM / NM, speedMps: s.speedMps, maxTurnRateDps: s.maxTurnRateDps,
    cellCost: s.cellCost, pk: s.pk, salvo: s.salvo, interceptorsPerThreat: s.interceptorsPerThreat,
    nezFraction: s.nezFraction ?? 0.5,
    magazineReserveRatio: s.magazineReserveRatio, launchIntervalS: s.launchIntervalS, salvoSpacingS: s.salvoSpacingS,
    ringStyle: s.ringStyle, guidance: s.guidance,
    terminalProfile: s.terminalProfile === "hypersonic_glide" ? "hypersonic_glide" : "",
    cruiseAltitudeM: Number.isFinite(s.cruiseAltitudeM) ? s.cruiseAltitudeM : 0,
    terminalAltitudeM: Number.isFinite(s.terminalAltitudeM) ? s.terminalAltitudeM : 0,
    strategic: !!strategic,
    retargetable: !!s.retargetable, selfDestructOnLoss: !!s.selfDestructOnLoss
  };
}

function fromShipClass(hull, c) {
  const base = {
    id: hull, name: c.className, prefix: c.prefix, prefixZh: c.prefixZh ?? BUILTIN_PREFIX_ZH[hull] ?? "",
    lengthM: c.lengthM, beamM: c.beamM,
    radarRangeNm: c.radarRangeNm, radarIntervalS: c.radarIntervalS,
    // A hull that predates this field (or was never given an explicit
    // rcsM2) round-trips using the exact same domain/displacement-based
    // default the sim itself falls back to (see defaultRcsM2 in ships.js),
    // so the editor never shows a value the sim wouldn't actually use.
    rcsM2: defaultRcsM2(c),
    vlsCells: c.vlsCells, damageResist: c.damageResist, damageDegrade: c.damageDegrade,
    defenseSam: c.defenseChannels?.sam ?? ((c.defenseChannels?.area ?? 0) + (c.defenseChannels?.point ?? 0)),
    strikeSpecialist: c.strikeSpecialist === true,
    baseLoadout: { ...(c.baseLoadout ?? defaultLoadout(hull)) }
  };
  if (c.domain === "air") {
    return {
      kind: "aircraft", id: hull, name: c.className, prefix: c.prefix, prefixZh: c.prefixZh ?? BUILTIN_PREFIX_ZH[hull] ?? "",
      squadronSize: Math.max(1, Math.round(c.damageResist ?? 4)),
      commandHub: c.commandHub === true,
      lowObservable: c.lowObservable === true,
      carrierCapable: c.carrierCapable === true,
      strikeSpecialist: c.strikeSpecialist === true,
      rcsM2: defaultRcsM2(c),
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
    return {
      kind: "ground", glyph: c.glyph ?? "bunker", isAirfield: c.isAirfield ?? false,
      maxParkedSquadrons: c.maxParkedSquadrons ?? 0,
      ...base
    };
  }
  return {
    kind: "naval", ...base,
    isAirfield: c.isAirfield === true,
    maxParkedSquadrons: c.maxParkedSquadrons ?? 0,
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

/** Available ammo ids (for loadout pickers): all registered missiles, or --
 *  when `domain` ("sea"/"ground"/"air") is given -- only those a unit of
 *  that platform type may actually carry (see missileAllowedForDomain). */
export function availableAmmoIds(domain) {
  const ids = Object.keys(MISSILES);
  if (!domain) return ids;
  return ids.filter((id) => missileAllowedForDomain(id, domain));
}
