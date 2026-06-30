// Missile catalogue and missile-level display helpers. Depends only on unit
// constants.

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
    category: "anti_air",
    symbol: "triangle",
    rangeM: 90 * NM,
    speedMps: 1050,
    cellCost: 1,
    pk: 0.45,
    salvo: 2,
    target: "missile",
    defenseLayer: "area",
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
    category: "anti_air",
    symbol: "triangle",
    rangeM: 28 * NM,
    speedMps: 980,
    cellCost: 0.25,
    pk: 0.35,
    salvo: 2,
    target: "missile",
    defenseLayer: "point",
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
    symbol: "square",
    rangeM: 120 * NM,
    speedMps: 270,
    cellCost: 1,
    pk: 0.42,
    salvo: 4,
    target: "ship",
    defenseLayer: "strike",
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
    symbol: "square",
    rangeM: 650 * NM,
    speedMps: 245,
    cellCost: 1,
    pk: 0.34,
    salvo: 4,
    target: "ship",
    defenseLayer: "strike",
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
  "AIM-120": {
    name: "AIM-120",
    displayName: "AIM-120 AMRAAM",
    shortLabel: "120",
    role: "BVR active-radar air-to-air",
    category: "anti_air",
    symbol: "triangle",
    rangeM: 55 * NM,
    speedMps: 1200,
    cellCost: 1,
    pk: 0.50,
    salvo: 2,
    target: "air",
    defenseLayer: "area",
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
    nezFraction: 0.5,
    retargetable: false,
    selfDestructOnLoss: true
  },
  "AIM-9X": {
    name: "AIM-9X",
    displayName: "AIM-9X Sidewinder",
    shortLabel: "AIM9",
    role: "WVR infrared air-to-air",
    category: "anti_air",
    symbol: "triangle",
    rangeM: 18 * NM,
    speedMps: 900,
    cellCost: 1,
    pk: 0.72,
    salvo: 1,
    target: "air",
    defenseLayer: "point",
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
    symbol: "square",
    rangeM: 67 * NM,
    speedMps: 240,
    cellCost: 1,
    pk: 0.45,
    salvo: 2,
    target: "ship",
    defenseLayer: "strike",
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
  "SM-6": {
    name: "SM-6",
    displayName: "Standard Missile 6 ERAM",
    shortLabel: "SM6",
    role: "dual-role: fleet air defense / anti-surface",
    category: "dual_role",
    symbol: "diamond",
    rangeM: 200 * NM,
    speedMps: 1190,
    cellCost: 1,
    pk: 0.55,
    salvo: 2,
    target: "dual",
    defenseLayer: "area",
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

export function missileDisplayRole(missile) {
  if (!missile?.alive) return null;
  const spec = MISSILES[missile.missileId];
  if (!spec) return null;
  if (spec.category === "anti_air") return "anti_air";
  if (spec.category === "anti_ship") return "anti_ship";
  if (missile.launchRole === "anti_air" || missile.launchRole === "anti_ship") return missile.launchRole;
  // Legacy saves did not persist the role; their non-retargetable target is the launch intent.
  const targetId = String(missile.targetId ?? "");
  return targetId.startsWith("M-") ? "anti_air" : "anti_ship";
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
