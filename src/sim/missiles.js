// Missile catalogue and missile-level display helpers. Depends only on unit
// constants.
//
// `rcsM2` is the same physical concept used for ships/aircraft (radar
// cross-section, m²) but on a munition scale — every missile here is 3-4
// orders of magnitude smaller than even a stealth fighter, let alone a
// destroyer, so it is scaled against its own reference point rather than the
// platform one (see MISSILE_REF_RCS_M2 / missileRcsRangeFactor in sensors.js).
// Values are open-source-approximate (small guided-weapon airframes broadly
// fall in the 0.01-0.5 m² range depending on size/shaping), not classified or
// authoritative, consistent with every other weapon value in this catalogue.

import { NM } from "./constants.js";

// The missile catalogue is a live registry, not a frozen object: the modding
// system registers custom "ammo" units into it at runtime via registerMissile.
// Every consumer accesses it as MISSILES[id], so newly registered entries are
// visible everywhere without any further wiring. Built-in ids are captured
// below and can never be removed.
export const MISSILES = {
  "SM-2MR": {
    name: "SM-2MR",
    displayName: "Standard Missile 2 MR",
    shortLabel: "SM2",
    role: "area air defense",
    category: "ship_sam",
    platforms: ["sea", "ground"],
    launchers: ["sea", "ground"],
    targets: ["missile", "air"],
    rcsM2: 0.1,
    symbol: "triangle",
    rangeM: 90 * NM,
    speedMps: 1050,
    cellCost: 1,
    pk: 0.64,
    salvo: 2,
    target: "missile",
    preferredMinRangeM: 8 * NM,
    preferredMaxRangeM: 90 * NM,
    interceptorsPerThreat: 1,
    magazineReserveRatio: 0.18,
    launchIntervalS: 2.2,
    salvoSpacingS: 2.8,
    ringStyle: "dotted",
    maxTurnRateDps: 30,
    seekerRangeM: 14 * NM,
    guidance: "command_inertial",
    retargetable: false,
    selfDestructOnLoss: true
  },
  "ESSM": {
    name: "ESSM",
    displayName: "Evolved Sea Sparrow Missile",
    shortLabel: "ESSM",
    role: "point defense",
    category: "ship_sam",
    platforms: ["sea", "ground"],
    launchers: ["sea", "ground"],
    targets: ["missile", "air"],
    rcsM2: 0.05,
    symbol: "triangle",
    rangeM: 28 * NM,
    speedMps: 980,
    cellCost: 0.25,
    pk: 0.60,
    salvo: 2,
    target: "missile",
    preferredMinRangeM: 0.8 * NM,
    preferredMaxRangeM: 28 * NM,
    interceptorsPerThreat: 1,
    magazineReserveRatio: 0.12,
    launchIntervalS: 1.3,
    salvoSpacingS: 1.6,
    ringStyle: "dotted",
    maxTurnRateDps: 45,
    seekerRangeM: 9 * NM,
    guidance: "command_inertial",
    retargetable: false,
    selfDestructOnLoss: true
  },
  "MaritimeStrike": {
    name: "MaritimeStrike",
    displayName: "Maritime Strike Missile",
    shortLabel: "MSTK",
    role: "anti-surface cruise missile approx.",
    category: "anti_ship",
    platforms: ["sea", "ground"],
    launchers: ["sea", "ground"],
    targets: ["sea", "ground"],
    rcsM2: 0.3,
    symbol: "square",
    rangeM: 120 * NM,
    speedMps: 270,
    cellCost: 1,
    pk: 0.48,
    salvo: 4,
    target: "ship",
    preferredMinRangeM: 8 * NM,
    preferredMaxRangeM: 120 * NM,
    interceptorsPerThreat: 0,
    magazineReserveRatio: 0.2,
    launchIntervalS: 3.2,
    salvoSpacingS: 4.0,
    ringStyle: "long_dash",
    maxTurnRateDps: 9,
    seekerRangeM: 18 * NM,
    guidance: "inertial_active",
    retargetable: false,
    selfDestructOnLoss: true
  },
  "TomahawkBlockV": {
    name: "TomahawkBlockV",
    displayName: "Tomahawk Block V",
    shortLabel: "TLAM",
    role: "long-range surface strike approx.",
    category: "anti_ship",
    platforms: ["sea", "ground"],
    launchers: ["sea", "ground"],
    targets: ["sea", "ground"],
    rcsM2: 0.5,
    symbol: "square",
    rangeM: 650 * NM,
    speedMps: 245,
    cellCost: 1,
    pk: 0.40,
    salvo: 4,
    target: "ship",
    preferredMinRangeM: 80 * NM,
    preferredMaxRangeM: 650 * NM,
    interceptorsPerThreat: 0,
    magazineReserveRatio: 0.35,
    launchIntervalS: 4.0,
    salvoSpacingS: 5.0,
    ringStyle: "solid",
    maxTurnRateDps: 7,
    seekerRangeM: 14 * NM,
    guidance: "inertial_active",
    retargetable: false,
    selfDestructOnLoss: true
  },
  "DarkEagle": {
    name: "DarkEagle",
    displayName: "Dark Eagle LRHW",
    shortLabel: "LRHW",
    role: "ground-launched hypersonic surface strike approx.",
    category: "anti_ship",
    platforms: ["ground"],
    launchers: ["ground"],
    targets: ["sea", "ground"],
    rcsM2: 0.45,
    symbol: "diamond",
    rangeM: 1500 * NM,
    speedMps: 1700,
    cellCost: 1,
    pk: 0.58,
    salvo: 1,
    target: "ship",
    preferredMinRangeM: 80 * NM,
    preferredMaxRangeM: 1500 * NM,
    interceptorsPerThreat: 0,
    magazineReserveRatio: 0.1,
    launchIntervalS: 12,
    salvoSpacingS: 12,
    ringStyle: "solid",
    maxTurnRateDps: 11,
    seekerRangeM: 28 * NM,
    cruiseAltitudeM: 30000,
    terminalAltitudeM: 5000,
    terminalSeaSkimming: false,
    terminalProfile: "hypersonic_glide",
    // Explicit strategic flag so custom clones / Unit Workshop ammo can opt
    // into the reserved deep-strike raid quota without needing 800+ NM range.
    strategic: true,
    guidance: "inertial_active",
    retargetable: false,
    selfDestructOnLoss: true
  },
  // THAAD interceptor (public envelope): hit-to-kill, high-altitude ballistic /
  // hypersonic defense. ~200 km class reach, very high intercept speed. It is
  // NOT a cruise-missile or aircraft weapon — engageProfile high_energy_only
  // gates fire planning to isHighEnergyThreat only (see chooseDefensiveWeapon).
  "THAAD": {
    name: "THAAD",
    displayName: "THAAD Interceptor",
    shortLabel: "THAAD",
    role: "high-altitude hypersonic / ballistic missile defense approx.",
    category: "ship_sam",
    platforms: ["ground"],
    launchers: ["ground"],
    targets: ["missile"],
    rcsM2: 0.12,
    symbol: "triangle",
    // Public open-source envelope ~200 km (~108 NM); use 110 NM sim reach.
    rangeM: 110 * NM,
    // Interceptor ~Mach 8 class (~2.7 km/s) public-approx; model 2600 m/s.
    speedMps: 2600,
    cellCost: 1,
    // Base PK before track/saturation/high-energy terms; designed for BM/LRHW.
    pk: 0.72,
    salvo: 1,
    target: "missile",
    preferredMinRangeM: 15 * NM,
    preferredMaxRangeM: 110 * NM,
    interceptorsPerThreat: 1,
    magazineReserveRatio: 0.08,
    launchIntervalS: 3.5,
    salvoSpacingS: 4.0,
    ringStyle: "dotted",
    maxTurnRateDps: 28,
    seekerRangeM: 20 * NM,
    cruiseAltitudeM: 50000,
    terminalAltitudeM: 30000,
    terminalSeaSkimming: false,
    // Only fire at Mach-5+ / strategic / boost-glide threats.
    hypersonicOnly: true,
    engageProfile: "high_energy_only",
    guidance: "command_inertial_active",
    retargetable: false,
    selfDestructOnLoss: true
  },
  "AIM-120C": {
    name: "AIM-120C",
    displayName: "AIM-120C AMRAAM",
    shortLabel: "120C",
    role: "BVR active-radar air-to-air",
    category: "air_to_air",
    platforms: ["air"],
    launchers: ["air"],
    targets: ["air"],
    rcsM2: 0.03,
    symbol: "triangle",
    rangeM: 55 * NM,
    speedMps: 1200,
    cellCost: 1,
    pk: 0.72,
    salvo: 2,
    target: "air",
    preferredMinRangeM: 3 * NM,
    preferredMaxRangeM: 50 * NM,
    interceptorsPerThreat: 1,
    magazineReserveRatio: 0.1,
    launchIntervalS: 1.6,
    salvoSpacingS: 1.8,
    ringStyle: "dotted",
    maxTurnRateDps: 40,
    seekerRangeM: 16 * NM,
    guidance: "command_inertial_active",
    nezFraction: 0.55,
    legacyIds: ["AIM-120"],
    retargetable: false,
    selfDestructOnLoss: true
  },
  "AIM-120D": {
    name: "AIM-120D",
    displayName: "AIM-120D AMRAAM",
    shortLabel: "120D",
    role: "extended-envelope BVR active-radar air-to-air",
    category: "air_to_air",
    platforms: ["air"],
    launchers: ["air"],
    targets: ["air"],
    rcsM2: 0.03,
    symbol: "triangle",
    rangeM: 82 * NM,
    speedMps: 1220,
    cellCost: 1,
    pk: 0.76,
    salvo: 2,
    target: "air",
    preferredMinRangeM: 3 * NM,
    preferredMaxRangeM: 74 * NM,
    interceptorsPerThreat: 1,
    magazineReserveRatio: 0.1,
    launchIntervalS: 1.6,
    salvoSpacingS: 1.8,
    ringStyle: "dotted",
    maxTurnRateDps: 42,
    seekerRangeM: 18 * NM,
    guidance: "command_inertial_active",
    nezFraction: 0.62,
    retargetable: false,
    selfDestructOnLoss: true
  },
  "AIM-9X": {
    name: "AIM-9X",
    displayName: "AIM-9X Sidewinder",
    shortLabel: "AIM9",
    role: "WVR infrared air-to-air",
    category: "air_to_air",
    platforms: ["air"],
    launchers: ["air"],
    targets: ["air"],
    rcsM2: 0.02,
    symbol: "triangle",
    rangeM: 18 * NM,
    speedMps: 900,
    cellCost: 1,
    pk: 0.78,
    salvo: 1,
    target: "air",
    preferredMinRangeM: 0.5 * NM,
    preferredMaxRangeM: 16 * NM,
    interceptorsPerThreat: 1,
    magazineReserveRatio: 0.1,
    launchIntervalS: 1.0,
    salvoSpacingS: 1.2,
    ringStyle: "dotted",
    maxTurnRateDps: 60,
    seekerRangeM: 10 * NM,
    guidance: "infrared",
    nezFraction: 0.6,
    retargetable: false,
    selfDestructOnLoss: true
  },
  "AGM-84": {
    name: "AGM-84",
    displayName: "AGM-84 Harpoon",
    shortLabel: "HPN",
    role: "air-launched anti-ship",
    category: "anti_ship",
    platforms: ["air"],
    launchers: ["air"],
    targets: ["sea"],
    rcsM2: 0.25,
    symbol: "square",
    rangeM: 67 * NM,
    speedMps: 240,
    cellCost: 1,
    pk: 0.52,
    salvo: 2,
    target: "ship",
    preferredMinRangeM: 6 * NM,
    preferredMaxRangeM: 67 * NM,
    interceptorsPerThreat: 0,
    magazineReserveRatio: 0.15,
    launchIntervalS: 2.5,
    salvoSpacingS: 3.2,
    ringStyle: "long_dash",
    maxTurnRateDps: 8,
    seekerRangeM: 12 * NM,
    guidance: "inertial_active",
    retargetable: false,
    selfDestructOnLoss: true
  },
  "AGM-154": {
    name: "AGM-154",
    displayName: "AGM-154 JSOW",
    shortLabel: "JSOW",
    // Air-launched stand-off precision-guided glide weapon for prosecuting
    // defended fixed ground sites (SAM/CDB/DEB/EWR) from outside their own
    // engagement envelope rather than boring in on AGM-84's shorter reach.
    // Reuses the anti_ship pipeline: ground emplacements are already valid
    // "ship" targets for that category, so no new targeting path is needed.
    role: "air-launched stand-off anti-ground strike",
    category: "anti_ship",
    platforms: ["air"],
    launchers: ["air"],
    targets: ["ground"],
    rcsM2: 0.4,
    symbol: "square",
    rangeM: 70 * NM,
    speedMps: 220,
    cellCost: 1,
    pk: 0.58,
    salvo: 2,
    target: "ship",
    preferredMinRangeM: 10 * NM,
    preferredMaxRangeM: 70 * NM,
    interceptorsPerThreat: 0,
    magazineReserveRatio: 0.15,
    launchIntervalS: 2.5,
    salvoSpacingS: 3.2,
    ringStyle: "long_dash",
    maxTurnRateDps: 6,
    seekerRangeM: 10 * NM,
    guidance: "inertial_active",
    retargetable: false,
    selfDestructOnLoss: true
  },
  "SM-6": {
    name: "SM-6",
    displayName: "Standard Missile 6 ERAM",
    shortLabel: "SM6",
    role: "dual-role: fleet air defense / anti-surface",
    category: "dual_role",
    platforms: ["sea", "ground"],
    launchers: ["sea", "ground"],
    targets: ["missile", "air", "sea", "ground"],
    rcsM2: 0.15,
    symbol: "diamond",
    rangeM: 200 * NM,
    speedMps: 1190,
    cellCost: 1,
    pk: 0.74,
    salvo: 2,
    target: "dual",
    preferredMinRangeM: 10 * NM,
    preferredMaxRangeM: 200 * NM,
    interceptorsPerThreat: 1,
    magazineReserveRatio: 0.14,
    launchIntervalS: 2.4,
    salvoSpacingS: 3.0,
    ringStyle: "dotted",
    maxTurnRateDps: 35,
    seekerRangeM: 16 * NM,
    guidance: "command_inertial_active",
    retargetable: false,
    selfDestructOnLoss: true
  }
};

// Built-in ammo ids captured at module load. These are protected from deletion
// and are re-seeded to canonical values on every boot, so a corrupted custom
// record can never shadow a vanilla weapon.
const BUILTIN_MISSILE_IDS = new Set(Object.keys(MISSILES));

/** True when `id` is a vanilla (non-removable) missile/ammo type. */
export function isBuiltinMissile(id) {
  return BUILTIN_MISSILE_IDS.has(id);
}

/** Register (or replace) a missile/ammo spec under its `name` key. */
export function registerMissile(spec) {
  if (!spec || typeof spec.name !== "string" || !spec.name) {
    throw new Error("registerMissile: spec.name is required");
  }
  MISSILES[spec.name] = spec;
  return spec.name;
}

/** Remove a custom missile/ammo type. Built-in types are never removed. */
export function unregisterMissile(id) {
  if (BUILTIN_MISSILE_IDS.has(id)) return false;
  if (!(id in MISSILES)) return false;
  delete MISSILES[id];
  return true;
}

export function missileSymbol(missileId) {
  return MISSILES[missileId]?.symbol ?? "unknown";
}

// Legacy category helpers remain for rendering/tests and old custom ammo. The
// primary model is launchers[] + targets[] below.
export function isAntiAirCategory(category) {
  return category === "ship_sam" || category === "air_to_air";
}
// Broader "this round provides air-defense capability" check, additionally
// including dual-role weapons (e.g. SM-6, also usable offensively vs ships).
export function isAirDefenseCategory(category) {
  return isAntiAirCategory(category) || category === "dual_role";
}

export function missileLaunchers(spec) {
  if (!spec) return [];
  if (Array.isArray(spec.launchers) && spec.launchers.length) return spec.launchers;
  if (Array.isArray(spec.platforms) && spec.platforms.length) return spec.platforms;
  return ["sea", "ground", "air"];
}

export function missileTargets(spec) {
  if (!spec) return [];
  if (Array.isArray(spec.targets) && spec.targets.length) return spec.targets;
  if (spec.target === "missile") return ["missile"];
  if (spec.target === "air") return ["air"];
  if (spec.target === "dual") return ["missile", "air", "sea", "ground"];
  if (spec.target === "ship" || spec.category === "anti_ship") return ["sea", "ground"];
  return [];
}

export function missileCanTarget(spec, domain) {
  if (!spec) return false;
  const targetDomain = domain === "ship" ? "sea" : domain;
  return missileTargets(spec).includes(targetDomain);
}

export function missileHasSurfaceTarget(spec) {
  const targets = missileTargets(spec);
  return targets.includes("sea") || targets.includes("ground");
}

export function missileHasAirDefenseTarget(spec) {
  const targets = missileTargets(spec);
  return targets.includes("missile") || targets.includes("air");
}

// Which platform domains ("sea", "ground", "air") may carry a given missile.
// A spec with no `platforms` array is unrestricted -- legacy/custom ammo saved
// before this field existed keeps working everywhere, so existing mods are
// never silently broken by this gate.
export function missileAllowedForDomain(missileId, domain) {
  const spec = MISSILES[missileId];
  if (!spec) return false;
  return missileLaunchers(spec).includes(domain);
}

export function missileDisplayRole(missile) {
  if (!missile?.alive) return null;
  const spec = MISSILES[missile.missileId];
  if (!spec) return null;
  if (missile.launchRole === "anti_air" || missile.launchRole === "anti_ship") return missile.launchRole;
  const targetId = String(missile.targetId ?? "");
  if (targetId.startsWith("M-")) return "anti_air";
  if (targetId) return "anti_ship";
  if (missileCanTarget(spec, "missile") || missileCanTarget(spec, "air")) return "anti_air";
  return "anti_ship";
}

export function battleSummaryCounts(sim) {
  const ships = sim?.ships ?? [];
  const missiles = sim?.missiles ?? [];
  const shipTotals = {
    Blue: { ships: 0, hp: 0, maxHp: 0 },
    Red: { ships: 0, hp: 0, maxHp: 0 }
  };
  const missileTotals = {
    Blue: { anti_ship: 0, anti_air: 0 },
    Red: { anti_ship: 0, anti_air: 0 }
  };
  for (const ship of ships) {
    if (!ship) continue;
    const bucket = shipTotals[ship.side];
    if (!bucket) continue;
    const maxHp = Math.max(1, Math.ceil(ship.damageResist ?? 3));
    const hp = Math.max(0, maxHp - Math.round(ship.damage ?? 0));
    bucket.ships += ship.alive ? 1 : 0;
    bucket.hp += hp;
    bucket.maxHp += maxHp;
  }
  for (const missile of missiles) {
    if (!missile?.alive) continue;
    const bucket = missileTotals[missile.side];
    if (!bucket) continue;
    const role = missileDisplayRole(missile);
    if (role) bucket[role] += 1;
  }
  return {
    redShips: shipTotals.Red.ships,
    blueShips: shipTotals.Blue.ships,
    redHp: shipTotals.Red.hp,
    redHpMax: shipTotals.Red.maxHp,
    blueHp: shipTotals.Blue.hp,
    blueHpMax: shipTotals.Blue.maxHp,
    redAntiShip: missileTotals.Red.anti_ship,
    redAntiAir: missileTotals.Red.anti_air,
    blueAntiShip: missileTotals.Blue.anti_ship,
    blueAntiAir: missileTotals.Blue.anti_air
  };
}
