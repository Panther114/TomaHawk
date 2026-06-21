// Missile catalogue and missile-level display helpers. Depends only on unit
// constants.

import { NM } from "./constants.js";

export const MISSILES = Object.freeze({
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
});

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
