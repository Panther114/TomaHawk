export const NM = 1852;
export const KNOT = 0.514444;
// Ship movement now runs at true real-world speed (1x). Time compression for
// playability is handled by the sim-rate control in the UI, not by inflating
// the platform's physical speed. Kept exported so saved scenarios and external
// tooling that reference the constant continue to resolve.
export const SHIP_SPEED_MULTIPLIER = 1;
export const SIDE = Object.freeze({ BLUE: "Blue", RED: "Red" });

// Rules of engagement weapon-control states (AEGIS-style).
export const WEAPON_STATE = Object.freeze({ FREE: "free", TIGHT: "tight", HOLD: "hold" });
// Fleet command roles assigned dynamically each planning cycle.
export const FLEET_ROLE = Object.freeze({ OTC: "OTC", AAWC: "AAWC", UNIT: "UNIT" });
export const SCENARIO_MODE = Object.freeze({ SETUP: "setup", RUNNING: "running", ENDED: "ended" });
export const VISUAL_CONFIG = Object.freeze({
  missileMinPx: 1.5,
  missileMaxPx: 6.5,
  missileLabelPx: 6,
  shipLabelPx: 9,
  rangeLabelPx: 8,
  uiBasePx: 8,
  logPx: 7
});

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

export function defaultLoadout(hull = "DDG") {
  const cls = SHIP_CLASSES[hull] || SHIP_CLASSES.DDG;
  const scale = cls.vlsCells / 96;
  const loadout = {
    "SM-2MR": Math.floor(36 * scale),
    "SM-6": Math.floor(16 * scale),
    ESSM: Math.floor(32 * scale),
    MaritimeStrike: Math.floor(16 * scale),
    TomahawkBlockV: Math.min(Math.floor(12 * scale), cls.vlsStrikeCells || 12)
  };
  const remaining = Math.max(0, cls.vlsCells - usedCells(loadout));
  loadout["SM-2MR"] += remaining;
  return loadout;
}

function normalizeLoadout(loadout) {
  const normalized = {};
  for (const [id, count] of Object.entries(loadout || {})) {
    if (!MISSILES[id]) continue;
    const numeric = Number.isFinite(count) ? count : 0;
    const rounded = Math.round(numeric);
    normalized[id] = Math.max(0, rounded);
  }
  return normalized;
}

function availableCount(ship, missileId) {
  const count = ship?.loadout?.[missileId];
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.round(count));
}

function setAvailableCount(ship, missileId, count) {
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

export function missileSymbol(missileId) {
  return MISSILES[missileId]?.symbol ?? "unknown";
}

export function missileDisplayRole(missile) {
  if (!missile?.alive) return null;
  const spec = MISSILES[missile.missileId];
  if (!spec) return null;
  if (spec.category === "anti_air") return "anti_air";
  if (spec.category === "anti_ship") return "anti_ship";
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

export function canAddAssets(sim) {
  return sim?.mode === SCENARIO_MODE.SETUP;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angleTo(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function wrapAngle(rad) {
  while (rad > Math.PI) rad -= Math.PI * 2;
  while (rad < -Math.PI) rad += Math.PI * 2;
  return rad;
}

// Closed-form intercept (lead) point for a constant-speed pursuer against a
// constant-velocity target. Solves |P + V*t| = s*t for the smallest positive
// time-to-go, then returns the predicted intercept coordinate. Falls back to
// the target's current position when no real positive solution exists (e.g.
// the target outruns the weapon), so guidance always has a valid aimpoint.
export function interceptPoint(px, py, speed, tx, ty, tvx, tvy) {
  const rx = tx - px;
  const ry = ty - py;
  const a = tvx * tvx + tvy * tvy - speed * speed;
  const b = 2 * (rx * tvx + ry * tvy);
  const c = rx * rx + ry * ry;
  let t = -1;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b + sq) / (2 * a);
      const t2 = (-b - sq) / (2 * a);
      const positives = [t1, t2].filter((v) => v > 1e-6);
      if (positives.length) t = Math.min(...positives);
    }
  }
  if (!(t > 0) || !Number.isFinite(t)) return { x: tx, y: ty, t: 0 };
  return { x: tx + tvx * t, y: ty + tvy * t, t };
}

export class Rng {
  constructor(seed = 123456789) {
    this.seed = seed >>> 0;
  }
  next() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  range(min, max) {
    return min + (max - min) * this.next();
  }
}

let nextId = 1;

// Ship class catalogue
const SHIP_CLASSES = Object.freeze({
  DDG: { hull:"DDG",className:"Arleigh Burke Flight IIA approx.",prefix:"DDG",lengthM:155,beamM:20,draftM:9.3,displacementT:9200,cruiseSpeedKt:16,maxSpeedKt:31,accelMps2:0.12,decelMps2:0.22,turnRateDps:2.6,turnRateFlankDps:1.8,radarRangeNm:190,radarIntervalS:4,vlsCells:96,vlsStrikeCells:12,ciwsCount:1,ciwsAmmo:1550,ciwsBurstRounds:180,ciwsBurstS:1.4,ciwsCycleS:5.5,defenseChannels:{area:2,point:2,ciws:1},damageResist:2,damageDegrade:0.30 },
  CCG: { hull:"CCG",className:"Ticonderoga-class Cruiser approx.",prefix:"CG",lengthM:173,beamM:16.8,draftM:10.2,displacementT:9600,cruiseSpeedKt:18,maxSpeedKt:32.5,accelMps2:0.11,decelMps2:0.20,turnRateDps:2.2,turnRateFlankDps:1.5,radarRangeNm:210,radarIntervalS:3.5,vlsCells:122,vlsStrikeCells:18,ciwsCount:2,ciwsAmmo:3100,ciwsBurstRounds:200,ciwsBurstS:1.6,ciwsCycleS:4.8,defenseChannels:{area:4,point:3,ciws:2},damageResist:3,damageDegrade:0.24 },
  BBG: { hull:"BBG",className:"Trump-class Arsenal Battleship approx.",prefix:"BBG",lengthM:262,beamM:32,draftM:12.5,displacementT:28000,cruiseSpeedKt:16,maxSpeedKt:24,accelMps2:0.06,decelMps2:0.12,turnRateDps:1.2,turnRateFlankDps:0.7,radarRangeNm:250,radarIntervalS:3.0,vlsCells:288,vlsStrikeCells:96,ciwsCount:5,ciwsAmmo:6200,ciwsBurstRounds:300,ciwsBurstS:1.8,ciwsCycleS:3.5,defenseChannels:{area:6,point:4,ciws:4},damageResist:5,damageDegrade:0.14 },
  FFG: { hull:"FFG",className:"Constellation-class Frigate approx.",prefix:"FFG",lengthM:151,beamM:19.7,draftM:7.9,displacementT:7300,cruiseSpeedKt:16,maxSpeedKt:26,accelMps2:0.14,decelMps2:0.25,turnRateDps:3.2,turnRateFlankDps:2.4,radarRangeNm:150,radarIntervalS:5,vlsCells:32,vlsStrikeCells:8,ciwsCount:1,ciwsAmmo:800,ciwsBurstRounds:150,ciwsBurstS:1.2,ciwsCycleS:6.0,defenseChannels:{area:1,point:1,ciws:1},damageResist:1,damageDegrade:0.45 }
});

export { SHIP_CLASSES };

function makeShip(side, x, y, hull = "DDG") {
  const cls = SHIP_CLASSES[hull] || SHIP_CLASSES.DDG;
  const id = `${cls.prefix}-${nextId++}`;
  const cruise = cls.cruiseSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER;
  return {
    id, name: `${side} ${cls.prefix} ${nextId - 1}`, side, hull, className: cls.className, x, y,
    heading: side === SIDE.BLUE ? 0 : Math.PI, speed: 0,
    cruiseSpeed: cruise, desiredSpeed: cruise,
    maxSpeed: cls.maxSpeedKt * KNOT * SHIP_SPEED_MULTIPLIER,
    accel: cls.accelMps2 * SHIP_SPEED_MULTIPLIER, decel: cls.decelMps2 * SHIP_SPEED_MULTIPLIER,
    turnRate: cls.turnRateDps * Math.PI / 180, turnRateFlank: cls.turnRateFlankDps * Math.PI / 180,
    lengthM: cls.lengthM, beamM: cls.beamM, draftM: cls.draftM, displacementT: cls.displacementT,
    radarRangeM: cls.radarRangeNm * NM, radarInterval: cls.radarIntervalS, radarCooldown: 0, radarActive: true,
    editable: true, alive: true,
    damage: 0, damageResist: cls.damageResist, damageDegrade: cls.damageDegrade,
    subsystems: { radar: 1.0, vls: 1.0, propulsion: 1.0, fireControl: 1.0, ciws: 1.0, cic: 1.0 },
    waypoint: null,
    loadout: normalizeLoadout(defaultLoadout(hull)),
    vlsCells: cls.vlsCells, vlsStrikeCells: cls.vlsStrikeCells,
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

function makeBurke(side, x, y) {
  return makeShip(side, x, y, "DDG");
}

function addEvent(sim, text, side = "SYS") {
  sim.events.unshift({ t: sim.time, side, text, severity: eventSeverity(text) });
  sim.events = sim.events.slice(0, 500);
}

function eventSeverity(text) {
  if (/mission-killed|sinking|hit by/i.test(text)) return "kill";
  if (/intercepted|destroyed incoming/i.test(text)) return "intercept";
  if (/launched|queued/i.test(text)) return "launch";
  if (/missed|failed|exhausted|leaked/i.test(text)) return "miss";
  return "info";
}

export function createScenario(seed = 7) {
  nextId = 1;
  const sim = {
    time: 0,
    seed,
    rng: new Rng(seed),
    widthM: 720 * NM,
    heightM: 360 * NM,
    ships: [],
    missiles: [],
    events: [],
    selectedId: null,
    mode: SCENARIO_MODE.SETUP,
    paused: true,
    nextFirePlanAt: 0
  };
  sim.ships.push(makeBurke(SIDE.BLUE, -20 * NM, 0));
  sim.ships.push(makeBurke(SIDE.RED, 20 * NM, 0));
  sim.selectedId = sim.ships[0].id;
  return sim;
}

export function serializeScenario(sim) {
  return {
    version: 1,
    seed: sim.seed,
    time: sim.time,
    widthM: sim.widthM,
    heightM: sim.heightM,
    selectedId: sim.selectedId,
    mode: sim.mode,
    paused: sim.paused,
    ended: sim.ended || null,
    nextFirePlanAt: sim.nextFirePlanAt ?? 0,
    ships: sim.ships.map((ship) => ({
      ...ship,
      tracks: [...ship.tracks.values()]
    })),
    missiles: sim.missiles,
    events: sim.events
  };
}

export function restoreScenario(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.ships)) {
    throw new Error("Unsupported scenario file");
  }
  nextId = Math.max(1, ...data.ships.map((s) => {
    const num = Number(String(s.id).replace(/^[A-Z]+-/, "")) || 0;
    return num;
  })) + 1;
  return {
    time: Number(data.time) || 0,
    seed: Number(data.seed) || 7,
    rng: new Rng(Number(data.seed) || 7),
    widthM: Number(data.widthM) || 720 * NM,
    heightM: Number(data.heightM) || 360 * NM,
    ships: data.ships.map((ship) => {
      const hull = ship.hull || "DDG";
      const cls = SHIP_CLASSES[hull] || SHIP_CLASSES.DDG;
      return {
        ...ship,
        hull,
        className: ship.className || cls.className,
        tracks: new Map((ship.tracks || []).map((track) => [track.id, track])),
        loadout: normalizeLoadout({ ...defaultLoadout(hull), ...(ship.loadout || {}) }),
        editable: ship.editable ?? true,
        vlsCells: ship.vlsCells ?? cls.vlsCells,
        vlsStrikeCells: ship.vlsStrikeCells ?? cls.vlsStrikeCells,
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
        defenseChannels: {
          ...cls.defenseChannels,
          ...(ship.defenseChannels || {})
        },
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
        station: ship.station || null
      };
    }),
    missiles: Array.isArray(data.missiles) ? data.missiles : [],
    events: Array.isArray(data.events) ? data.events : [],
    selectedId: data.selectedId,
    mode: Object.values(SCENARIO_MODE).includes(data.mode) ? data.mode : SCENARIO_MODE.SETUP,
    paused: data.paused ?? true,
    ended: data.ended || null,
    nextFirePlanAt: Number(data.nextFirePlanAt) || 0
  };
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
  const ship = makeShip(side, x, y, hull);
  sim.ships.push(ship);
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
  sim.ships.push(copy);
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
  addEvent(sim, `${ship.id} removed from scenario.`, ship.side);
  return true;
}

export function clearSide(sim, side) {
  const removedIds = new Set(sim.ships.filter((ship) => ship.side === side).map((ship) => ship.id));
  if (!removedIds.size) return 0;
  sim.ships = sim.ships.filter((ship) => ship.side !== side);
  sim.missiles = sim.missiles.filter((missile) => !removedIds.has(missile.launcherId) && !removedIds.has(missile.targetId));
  sim.selectedId = sim.ships[0]?.id ?? null;
  addEvent(sim, `${side} side cleared from scenario.`, side);
  return removedIds.size;
}

export function canRunScenario(sim) {
  const aliveSides = new Set(sim.ships.filter((ship) => ship.alive).map((ship) => ship.side));
  return aliveSides.has(SIDE.BLUE) && aliveSides.has(SIDE.RED);
}

export function formatLogLines(events) {
  return events.map((event) => `${formatTime(event.t)} ${event.side} ${event.text}`).join("\n");
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

// Radar horizon: 4/3 Earth radius model. Returns max line-of-sight range in meters.
function radarHorizonM(hRadarM, hTargetM) {
  const k = 4.0 / 3.0;
  const re = 6371000;
  return Math.sqrt(2 * k * re * hRadarM) + Math.sqrt(2 * k * re * hTargetM);
}

function radarHeightM(ship) {
  return Math.max(8, 15 + (ship.draftM || 9) * 0.6);
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

function scanSensors(sim, dt) {
  for (const observer of sim.ships) {
    if (!observer.alive || !observer.radarActive) continue;
    observer.radarCooldown -= dt;
    if (observer.radarCooldown > 0) continue;
    observer.radarCooldown = observer.radarInterval;
    for (const target of sim.ships) {
      if (target.id === observer.id || !target.alive) continue;
      const rangeM = distance(observer, target);
      if (rangeM > observer.radarRangeM) continue;
      // Radar horizon: reduce detection probability beyond geometric horizon
      const horizon = radarHorizonM(radarHeightM(observer), radarHeightM(target));
      const horizonFactor = rangeM > horizon ? clamp(1.0 - (rangeM - horizon) / (120 * NM), 0.20, 1.0) : 1.0;
      const chance = radarDetectionChance(rangeM, observer.radarRangeM, target) * horizonFactor;
      if (sim.rng.next() <= chance) {
        const radarHealth = observer.subsystems?.radar ?? 1.0;
        const quality = clamp((1 - rangeM / observer.radarRangeM + sim.rng.range(-0.08, 0.08)) * radarHealth, 0.05, 0.98);
        const uncertainty = (1 - quality) * 5 * NM + sim.rng.range(0, 0.5 * NM);
        observer.tracks.set(target.id, {
          id: target.id,
          side: target.side,
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
      }
    }
    for (const missile of sim._aliveMissiles || sim.missiles.filter((m) => m.alive)) {
      if (missile.side === observer.side) continue;
      const rangeM = distance(observer, missile);
      const profile = missileDetectionEnvelope(observer, missile);
      const detectRangeM = profile.detectRangeM;
      if (rangeM > detectRangeM) continue;
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
        observer.tracks.set(missile.id, {
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
      }
    }
  }
}

function liveContactForTrack(sim, trackId) {
  const id = String(trackId);
  if (id.startsWith("M-")) {
    return (sim._aliveMissiles || sim.missiles.filter((m) => m.alive)).some((m) => m.id === id);
  }
  const ship = sim.ships.find((candidate) => candidate.id === id);
  return !!ship && ship.alive;
}

function pruneDeadTracks(sim) {
  for (const ship of sim.ships) {
    for (const [id, track] of ship.tracks) {
      if (!liveContactForTrack(sim, id)) {
        ship.tracks.delete(id);
        continue;
      }
      if (track.id && track.id !== id && !liveContactForTrack(sim, track.id)) {
        ship.tracks.delete(id);
      }
    }
  }
}

function ageTracks(sim, dt) {
  pruneDeadTracks(sim);
  for (const ship of sim.ships) {
    for (const [id, track] of ship.tracks) {
      track.age += dt;
      track.x += track.vx * dt;
      track.y += track.vy * dt;
      track.uncertainty += dt * 90;
      track.quality = clamp(track.quality - dt * 0.006, 0, 1);
      if (track.age > 160 || track.quality < 0.03) ship.tracks.delete(id);
    }
  }
}

function shareTracks(sim) {
  const bySide = new Map();
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (!bySide.has(ship.side)) bySide.set(ship.side, []);
    bySide.get(ship.side).push(ship);
  }
  const cecLatencyS = 1.8; // CEC network propagation + processing latency
  for (const ships of bySide.values()) {
    for (const source of ships) {
      for (const receiver of ships) {
        if (source.id === receiver.id) continue;
        for (const [id, track] of source.tracks) {
          // CEC latency: fresh tracks (< latency window) haven't propagated yet
          const trackAge = sim.time - (track.lastSeen || 0);
          if (trackAge < cecLatencyS) continue;
          const current = receiver.tracks.get(id);
          // Quality degrades through the network: CEC link loss, quantization
          const shared = { ...track, quality: track.quality * 0.85, uncertainty: track.uncertainty + 1500, source: `${source.id} datalink` };
          if (!current || shared.quality > current.quality) receiver.tracks.set(id, shared);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cooperative Engagement Capability (CEC) — composite fire-control tracks.
//
// Every alive ship on a side contributes its perceived track files to a single
// fused force picture. Reports of the same contact are combined into one
// composite track: position is a quality-weighted average of all reporting
// sensors, the velocity estimate comes from the firmest report, and the fused
// quality is boosted above any single sensor (sensor-netting / track-quality
// build-up). This is what lets one ship launch on another ship's track
// (engage-on-remote) and what feeds missile mid-course datalink updates.
// ---------------------------------------------------------------------------
function buildForcePicture(sim) {
  const picture = new Map();
  for (const side of [SIDE.BLUE, SIDE.RED]) picture.set(side, new Map());
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    const fused = picture.get(ship.side);
    if (!fused) continue;
    for (const track of ship.tracks.values()) {
      if (track.side === ship.side) continue;
      const existing = fused.get(track.id);
      if (!existing) {
        fused.set(track.id, {
          id: track.id,
          side: track.side,
          classification: track.classification,
          x: track.x,
          y: track.y,
          vx: track.vx ?? 0,
          vy: track.vy ?? 0,
          quality: track.quality,
          uncertainty: track.uncertainty,
          weight: Math.max(0.05, track.quality),
          contributors: 1,
          bestQuality: track.quality
        });
        continue;
      }
      // Quality-weighted position fusion.
      const w = Math.max(0.05, track.quality);
      const totalW = existing.weight + w;
      existing.x = (existing.x * existing.weight + track.x * w) / totalW;
      existing.y = (existing.y * existing.weight + track.y * w) / totalW;
      existing.weight = totalW;
      existing.contributors += 1;
      existing.uncertainty = Math.min(existing.uncertainty, track.uncertainty);
      if (track.quality > existing.bestQuality) {
        existing.bestQuality = track.quality;
        existing.vx = track.vx ?? 0;
        existing.vy = track.vy ?? 0;
        existing.classification = track.classification;
      }
    }
  }
  // Composite quality: a contact held by multiple sensors yields a firmer,
  // fire-control-grade track than any single radar.
  for (const fused of picture.values()) {
    for (const track of fused.values()) {
      const netGain = 1 + Math.min(0.25, (track.contributors - 1) * 0.12);
      track.quality = clamp(track.bestQuality * netGain, 0, 0.99);
    }
  }
  sim.forcePicture = picture;
  return picture;
}

function forceTrack(sim, side, targetId) {
  return sim.forcePicture?.get(side)?.get(targetId) ?? null;
}

// ---------------------------------------------------------------------------
// Fleet command hierarchy, AAW sector responsibility, and formation stations.
//
// Each side designates the most capable surviving unit as Officer in Tactical
// Command (OTC) and air-defence guide. Remaining units take screen stations
// around the guide. The threat axis (mean bearing to known hostiles, or toward
// the enemy fleet if no contacts) anchors a set of AAW sectors that are split
// among the units so each owns a slice of sky, with the OTC covering the
// threat axis itself.
// ---------------------------------------------------------------------------
function fleetCapability(ship) {
  const sm2 = ship.loadout["SM-2MR"] ?? 0;
  const essm = ship.loadout.ESSM ?? 0;
  // Class-based multiplier: cruisers are prime AAW, BBG has massive channels
  const classMult = ship.hull === "CCG" ? 1.3 : ship.hull === "BBG" ? 1.5 : ship.hull === "FFG" ? 0.7 : 1.0;
  return (sm2 * 1 + essm * 0.3) * classMult - ship.damage * 8;
}

function offensivePriorForHull(hull) {
  const loadout = defaultLoadout(hull);
  return (loadout.MaritimeStrike ?? 0) + (loadout.TomahawkBlockV ?? 0) + (loadout["SM-6"] ?? 0) * 0.35;
}

function trackHullEstimate(track) {
  const text = String(track?.classification ?? "").toLowerCase();
  if (/battleship|trump|bbg/.test(text)) return "BBG";
  if (/cruiser|ticonderoga|ccg|cg/.test(text)) return "CCG";
  if (/frigate|constellation|ffg/.test(text)) return "FFG";
  if (/destroyer|burke|ddg/.test(text)) return "DDG";
  if (/surface combatant/.test(text)) return "DDG";
  return null;
}

function estimatedVlsCapacity(track) {
  const hull = trackHullEstimate(track) || "DDG";
  const quality = clamp(track?.quality ?? 0.35, 0.05, 0.99);
  return offensivePriorForHull(hull) * (0.7 + quality * 0.45);
}

function observedOffensiveCapacity(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (String(track.id).startsWith("M-")) continue;
    const hull = trackHullEstimate(track);
    const prior = offensivePriorForHull(hull || "DDG");
    const quality = clamp(track.quality ?? 0.35, 0.05, 0.99);
    total += prior * (0.55 + 0.45 * quality);
  }
  return total;
}

function observedVlsCapacity(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (String(track.id).startsWith("M-")) continue;
    total += estimatedVlsCapacity(track);
  }
  return total;
}

function observedMissilePressure(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (!String(track.id).startsWith("M-")) continue;
    if (track.side === side) continue;
    total += 1;
  }
  return total;
}

function offensiveTargetValue(track) {
  const hull = trackHullEstimate(track);
  const hullBase = hull === "BBG" ? 110 : hull === "CCG" ? 82 : hull === "DDG" ? 52 : hull === "FFG" ? 34 : 44;
  const offense = offensivePriorForHull(hull || "DDG");
  const quality = clamp(track?.quality ?? 0.35, 0.05, 0.99);
  const certainty = quality * 30;
  const uncertaintyPenalty = Math.min(18, (track?.uncertainty ?? 0) / NM * 0.75);
  return hullBase + offense * 0.95 + certainty - uncertaintyPenalty;
}

function offensiveCommitWindowS(posture, shooterAggression) {
  const aggression = clamp(0.55 * (posture?.aggression ?? 0.5) + 0.45 * shooterAggression, 0.15, 0.98);
  const modeBias = posture?.mode === "saturate" ? -0.55 : posture?.mode === "pressure" ? -0.2 : posture?.mode === "survive" ? 0.35 : 0;
  return clamp(4.1 - aggression * 3.1 + modeBias, 0.65, 4.2);
}

function offensiveAllocationsPerCycle(posture, shooterAggression) {
  const aggression = clamp(0.55 * (posture?.aggression ?? 0.5) + 0.45 * shooterAggression, 0.15, 0.98);
  const advantage = posture?.advantage ?? 0;
  if (posture?.mode === "saturate") return aggression > 0.84 ? 4 : 3;
  if (posture?.mode === "pressure") return aggression > 0.7 || advantage > 0.12 ? 2 : 1;
  if (aggression > 0.86 || (aggression > 0.78 && advantage > 0.22)) return 3;
  if (aggression > 0.66 || advantage > 0.12) return 2;
  return 1;
}

function coordinatedRaidDelayS(posture, trackCount, scoreShare) {
  const mode = posture?.mode ?? "focus";
  if (mode === "saturate") return clamp(0.55 + (trackCount - 1) * 0.18 - scoreShare * 0.25, 0.35, 1.2);
  if (mode === "pressure") return clamp(0.9 + (trackCount - 1) * 0.2 - scoreShare * 0.15, 0.65, 1.6);
  if (mode === "focus") return clamp(1.15 + (trackCount - 1) * 0.22 - scoreShare * 0.12, 0.85, 1.9);
  return clamp(1.45 + (trackCount - 1) * 0.22, 1.0, 2.2);
}

function observedHostileUnitCount(sim, side) {
  const fused = sim.forcePicture?.get(side);
  if (!fused) return 0;
  let total = 0;
  for (const track of fused.values()) {
    if (track.side === side || String(track.id).startsWith("M-")) continue;
    total += 1;
  }
  return total;
}

function selectCommandMode(prevMode, aggression, advantage, ownOffense, enemyEstimate, missilePressure, observedTargets) {
  const pressurePerTrack = missilePressure / Math.max(1, observedTargets || 1);
  if (prevMode === "saturate") {
    if (aggression > 0.56 && advantage > 0.02 && ownOffense > Math.max(8, enemyEstimate * 0.55)) return "saturate";
  }
  if (prevMode === "pressure") {
    if (aggression > 0.44 && advantage > -0.04 && ownOffense > Math.max(4, enemyEstimate * 0.4)) return "pressure";
  }
  if (aggression > 0.74 && advantage > 0.16 && ownOffense > Math.max(8, enemyEstimate * 0.85) && pressurePerTrack < 2.8) {
    return "saturate";
  }
  if (aggression > 0.52 && advantage > 0.02 && ownOffense > Math.max(4, enemyEstimate * 0.55)) {
    return "pressure";
  }
  if (aggression < 0.24 || (advantage < -0.22 && pressurePerTrack > 1.2)) return "survive";
  return "focus";
}

function computeFleetCommand(sim) {
  const bySide = new Map();
  const commandState = new Map();
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (!bySide.has(ship.side)) bySide.set(ship.side, []);
    bySide.get(ship.side).push(ship);
    ship.isOTC = false;
    ship.fleetRole = FLEET_ROLE.UNIT;
  }
  const command = new Map();
  for (const [side, ships] of bySide) {
    // Deterministic OTC selection: most air-defence capability, ties by id.
    const ordered = [...ships].sort((a, b) => fleetCapability(b) - fleetCapability(a) || a.id.localeCompare(b.id));
    const otc = ordered[0];
    otc.isOTC = true;
    otc.fleetRole = FLEET_ROLE.OTC;
    // Second most capable acts as dedicated AAW commander when available.
    if (ordered[1]) ordered[1].fleetRole = FLEET_ROLE.AAWC;

    // Threat axis: mean bearing from the formation guide to fused hostiles.
    const fused = sim.forcePicture?.get(side);
    let axis = side === SIDE.BLUE ? 0 : Math.PI;
    if (fused && fused.size) {
      let sx = 0;
      let sy = 0;
      for (const track of fused.values()) {
        const ang = Math.atan2(track.y - otc.y, track.x - otc.x);
        sx += Math.cos(ang);
        sy += Math.sin(ang);
      }
      if (sx !== 0 || sy !== 0) axis = Math.atan2(sy, sx);
    }

    // Split AAW sectors around the threat axis among the units; the OTC owns
    // the central sector straddling the axis.
    const n = ships.length;
    const sectorWidth = (2 * Math.PI) / Math.max(1, n);
    const stationRing = 6 * NM; // screen radius around the guide
    const sectorOrder = [otc, ...ordered.slice(1)];
    sectorOrder.forEach((ship, idx) => {
      // idx 0 (OTC) -> centred on axis; others fan out alternately.
      const slot = idx === 0 ? 0 : (idx % 2 === 1 ? Math.ceil(idx / 2) : -Math.ceil(idx / 2));
      ship.sectorCenter = wrapAngle(axis + slot * sectorWidth);
      ship.sectorHalfWidth = sectorWidth / 2 + 0.12;
      // Formation station: ring around the guide on the threat side.
      if (ship === otc) {
        ship.station = null;
      } else {
        const stationAng = wrapAngle(axis + slot * sectorWidth);
        ship.station = {
          x: otc.x + Math.cos(stationAng) * stationRing,
          y: otc.y + Math.sin(stationAng) * stationRing
        };
      }
    });
    const ownOffense = ships.reduce((sum, ship) => sum + offensiveMissileCount(ship, true), 0);
    const ownVls = ships.reduce((sum, ship) => sum + vlsCapacity(ship), 0);
    const enemyOffenseEstimate = observedOffensiveCapacity(sim, side);
    const enemyVlsEstimate = observedVlsCapacity(sim, side);
    const missilePressure = observedMissilePressure(sim, side);
    const observedTargets = observedHostileUnitCount(sim, side);
    const ownPower = ownOffense + ownVls * 0.14;
    const enemyPower = enemyOffenseEstimate + enemyVlsEstimate * 0.14;
    const advantage = clamp(
      (ownPower - enemyPower) / Math.max(1, ownPower + enemyPower),
      -1,
      1
    );
    const rawAggression = clamp(
      0.28 + advantage * 0.74 - (missilePressure / Math.max(1, ships.length)) * 0.1,
      0.08,
      0.98
    );
    const prevState = sim.commandState?.get(side) ?? null;
    const prevAggression = prevState?.aggression ?? rawAggression;
    const aggression = clamp(
      prevAggression + clamp(rawAggression - prevAggression, -0.05, 0.09),
      0.08,
      0.98
    );
    const mode = selectCommandMode(prevState?.mode ?? "focus", aggression, advantage, ownOffense, enemyOffenseEstimate, missilePressure, observedTargets);
    const targetBreadth = mode === "saturate"
      ? Math.max(1, Math.min(3, observedTargets >= 4 ? 3 : observedTargets >= 2 ? 2 : 1))
      : mode === "pressure"
        ? Math.max(1, Math.min(2, observedTargets >= 3 ? 2 : 1))
        : 1;
    const raidDepth = mode === "saturate"
      ? Math.max(6, Math.min(12, Math.round(4 + ships.length * 1.5)))
      : mode === "pressure"
        ? Math.max(4, Math.min(9, Math.round(3 + ships.length)))
        : mode === "focus"
          ? Math.max(3, Math.min(7, Math.round(2 + ships.length * 0.8)))
          : Math.max(1, Math.min(4, Math.round(1 + ships.length * 0.5)));
    commandState.set(side, {
      aggression,
      rawAggression,
      advantage,
      ownOffense,
      ownVls,
      ownPower,
      enemyOffenseEstimate,
      enemyVlsEstimate,
      enemyPower,
      missilePressure,
      observedTargets,
      mode,
      targetBreadth,
      raidDepth
    });
    for (const ship of ships) {
      ship.commandAggression = aggression;
      ship.commandMode = mode;
      ship.commandTargetBreadth = targetBreadth;
      ship.commandRaidDepth = raidDepth;
      ship.commandOwnOffense = ownOffense;
      ship.commandOwnVls = ownVls;
      ship.commandOwnPower = ownPower;
      ship.commandEnemyOffenseEstimate = enemyOffenseEstimate;
      ship.commandEnemyVlsEstimate = enemyVlsEstimate;
      ship.commandEnemyPower = enemyPower;
    }
    command.set(side, { otc, aawc: ordered[1] || null, axis, ships });
  }
  sim.fleetCommand = command;
  sim.commandState = commandState;
  return command;
}

// Does a contact's bearing from the ship fall inside the ship's AAW sector?
function inSector(ship, point) {
  const bearing = Math.atan2(point.y - ship.y, point.x - ship.x);
  return Math.abs(wrapAngle(bearing - ship.sectorCenter)) <= ship.sectorHalfWidth;
}

function moveShips(sim, dt) {
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    if (ship.waypoint) {
      const d = distance(ship, ship.waypoint);
      if (d < 0.4 * NM) {
        ship.waypoint = null;
        ship.desiredSpeed = 10 * KNOT * SHIP_SPEED_MULTIPLIER;
      } else {
        const desiredHeading = angleTo(ship, ship.waypoint);
        // Use turnRateFlank at high speed (> 75% flank), cruise turnRate otherwise
        const speedFrac = ship.maxSpeed > 0 ? ship.speed / ship.maxSpeed : 0;
        const effectiveTurn = speedFrac > 0.75 && ship.turnRateFlank
          ? ship.turnRateFlank
          : ship.turnRate;
        const delta = clamp(wrapAngle(desiredHeading - ship.heading), -effectiveTurn * dt, effectiveTurn * dt);
        ship.heading = wrapAngle(ship.heading + delta);
      }
    }
    const accelLimit = (ship.desiredSpeed >= ship.speed ? ship.accel : (ship.decel ?? ship.accel)) * dt;
    const speedDelta = clamp(ship.desiredSpeed - ship.speed, -accelLimit, accelLimit);
    const degrade = ship.damageDegrade ?? 0.22;
    const propHealth = ship.subsystems?.propulsion ?? 1.0;
    ship.speed = clamp(ship.speed + speedDelta, 0, ship.maxSpeed * Math.max(0.10, propHealth - ship.damage * degrade));
    ship.x += Math.cos(ship.heading) * ship.speed * dt;
    ship.y += Math.sin(ship.heading) * ship.speed * dt;
    ship.x = clamp(ship.x, -sim.widthM / 2, sim.widthM / 2);
    ship.y = clamp(ship.y, -sim.heightM / 2, sim.heightM / 2);
    ship.ciwsCooldown = Math.max(0, ship.ciwsCooldown - dt);
  }
}

function makeLaunchOrder(sim, launcher, track, missileId, sequence = 0) {
  const spec = MISSILES[missileId];
  if (!spec || availableCount(launcher, missileId) <= 0) return false;
  const rangeM = distance(launcher, track);
  if (rangeM > spec.rangeM) return false;
  const defensive = spec.target === "missile" || (track.id?.startsWith?.("M-") && spec.category !== "anti_ship");
  const readyAt = track._readyAtOverride ?? (sim.time + sequence * spec.salvoSpacingS);
  const priority = track._priorityOverride ?? (defensive ? 0 : 50);
  launcher.launchQueue.push({
    missileId,
    targetId: track.id,
    targetSide: track.side,
    targetClassification: track.classification,
    targetX: track.x,
    targetY: track.y,
    targetVx: track.vx ?? 0,
    targetVy: track.vy ?? 0,
    requestedAt: sim.time,
    readyAt,
    launchSequence: sequence,
    defensive,
    priority
  });
  return true;
}

function queueSalvo(sim, launcher, track, missileId, count, options = {}) {
  launcher.launchQueue ||= [];
  let queued = 0;
  for (let i = 0; i < count; i++) {
    if (availableCount(launcher, missileId) - queued <= 0) break;
    if (makeLaunchOrder(sim, launcher, {
      ...track,
      _readyAtOverride: options.readyAtOverride,
      _priorityOverride: options.priorityOverride
    }, missileId, i)) queued++;
  }
  if (queued > 0) addEvent(sim, `${launcher.name} queued ${queued}x ${MISSILES[missileId].shortLabel} salvo at ${track.classification}.`, launcher.side);
  return queued;
}

function launchMissile(sim, launcher, order) {
  const spec = MISSILES[order.missileId];
  launcher.lastLaunchAtByMissile ||= {};
  if (!spec || availableCount(launcher, order.missileId) <= 0) return false;
  const queueReadyAt = order.defensive ? (launcher.nextDefensiveLaunchAt || 0) : (launcher.nextLaunchAt || 0);
  if (sim.time < Math.max(order.readyAt, queueReadyAt)) return false;
  const lastTypeLaunch = launcher.lastLaunchAtByMissile[order.missileId] ?? -Infinity;
  if (sim.time - lastTypeLaunch < spec.launchIntervalS) return false;
  setAvailableCount(launcher, order.missileId, availableCount(launcher, order.missileId) - 1);
  const lane = ((order.launchSequence ?? 0) % 5) - 2;
  const laneOffset = lane * 38;
  // Aim the launch on a collision/lead course using the commanded target
  // velocity rather than just its current position.
  const launchPos = {
    x: launcher.x + Math.cos(angleTo(launcher, { x: order.targetX, y: order.targetY }) + Math.PI / 2) * laneOffset,
    y: launcher.y + Math.sin(angleTo(launcher, { x: order.targetX, y: order.targetY }) + Math.PI / 2) * laneOffset
  };
  const lead = interceptPoint(
    launchPos.x, launchPos.y, spec.speedMps,
    order.targetX, order.targetY, order.targetVx ?? 0, order.targetVy ?? 0
  );
  const heading = Math.atan2(lead.y - launchPos.y, lead.x - launchPos.x);
  const missile = {
    id: `M-${sim.missiles.length + 1}-${Math.floor(sim.time * 10)}`,
    side: launcher.side,
    launcherId: launcher.id,
    targetId: order.targetId,
    missileId: order.missileId,
    x: launchPos.x,
    y: launchPos.y,
    heading: wrapAngle(heading + lane * 0.006),
    speed: spec.speedMps,
    maxRangeM: spec.rangeM,
    flownM: 0,
    targetX: order.targetX,
    targetY: order.targetY,
    aimX: lead.x,
    aimY: lead.y,
    phase: spec.category === "anti_ship" ? "cruise" : "boost",
    terminalReason: null,
    seaSkimming: false,
    maneuvering: spec.category === "anti_ship",
    detectedBy: [],
    timeToImpactEstimate: null,
    terminal: false,
    alive: true,
    // Cooperative-guidance / command state.
    controllerSide: launcher.side,
    guidance: spec.guidance ?? "inertial_active",
    retargetable: spec.retargetable ?? false,
    targetLost: false,
    losRate: 0,
    losAngle: heading,
    defenseAttempts: {},
    launchSequence: order.launchSequence ?? 0,
    laneOffset
  };
  sim.missiles.push(missile);
  launcher.lastLaunchAtByMissile[order.missileId] = sim.time;
  if (order.defensive) {
    // Defensive VLS doctrine gets priority over strike salvo pacing. The
    // missile-specific interval above still prevents same-round overlap.
    launcher.nextDefensiveLaunchAt = sim.time + 0.45;
  } else {
    launcher.nextLaunchAt = sim.time + spec.launchIntervalS;
  }
  addEvent(sim, `${launcher.name} launched ${spec.shortLabel} at ${order.targetClassification}.`, launcher.side);
  return true;
}

function processLaunchQueues(sim) {
  for (const ship of sim.ships) {
    if (!ship.alive || !ship.launchQueue?.length) continue;
    const ordered = ship.launchQueue
      .map((order, index) => ({ order, index }))
      .sort((a, b) => (a.order.priority ?? 50) - (b.order.priority ?? 50)
        || a.order.readyAt - b.order.readyAt
        || a.index - b.index);
    for (const { order, index } of ordered) {
      if (launchMissile(sim, ship, order)) {
        ship.launchQueue.splice(index, 1);
        break;
      }
    }
  }
}

function timeToImpact(missile, target) {
  if (!target || missile.speed <= 0) return Infinity;
  return distance(missile, target) / missile.speed;
}

function hasPendingOrActiveEngagement(sim, ship, targetId) {
  return sim.missiles.some((m) => m.alive && m.side === ship.side && m.targetId === targetId)
    || (ship.launchQueue || []).some((order) => order.targetId === targetId);
}

function shipThreatEngagementCount(sim, ship, targetId) {
  const active = sim.missiles.filter((m) => (
    m.alive
    && m.side === ship.side
    && m.launcherId === ship.id
    && m.targetId === targetId
    && MISSILES[m.missileId]?.target !== "ship"
  )).length;
  const queued = (ship.launchQueue || []).filter((order) => (
    order.targetId === targetId
    && MISSILES[order.missileId]?.target !== "ship"
  )).length;
  return active + queued;
}

function countSideWeaponsOnTarget(sim, side, targetId, missileId = null) {
  const active = sim.missiles.filter((m) => (
    m.alive
    && m.side === side
    && m.targetId === targetId
    && (!missileId || m.missileId === missileId)
  )).length;
  const queued = sim.ships
    .filter((ship) => ship.alive && ship.side === side)
    .flatMap((ship) => ship.launchQueue || [])
    .filter((order) => order.targetId === targetId && (!missileId || order.missileId === missileId))
    .length;
  return active + queued;
}

function threatTimeToImpact(missile, target) {
  return target ? distance(missile, target) / Math.max(1, missile.speed) : Infinity;
}

function inboundRaidCount(sim, ship) {
  return sim._missilesByTarget?.get(ship.id)?.filter((m) => m.side !== ship.side).length ?? 0;
}

function assignedInterceptorsForThreat(sim, side, missileId) {
  return countSideWeaponsOnTarget(sim, side, missileId, "SM-2MR")
    + countSideWeaponsOnTarget(sim, side, missileId, "SM-6")
    + countSideWeaponsOnTarget(sim, side, missileId, "ESSM");
}

function estimateInterceptTimeS(origin, threat, weaponId) {
  const spec = MISSILES[weaponId];
  if (!spec || spec.speedMps <= 0) return Infinity;
  const threatVelocity = entityVelocity(threat);
  const lead = interceptPoint(
    origin.x,
    origin.y,
    spec.speedMps,
    threat.x,
    threat.y,
    threatVelocity.vx,
    threatVelocity.vy
  );
  const solveTime = Number.isFinite(lead.t) && lead.t > 0 ? lead.t : distance(origin, threat) / spec.speedMps;
  return Math.max(0, solveTime);
}

function plannedInterceptorSolutions(sim, side, missile) {
  const solutions = [];
  for (const interceptor of sim.missiles) {
    if (!interceptor.alive || interceptor.side !== side || interceptor.targetId !== missile.id) continue;
    const spec = MISSILES[interceptor.missileId];
    if (!spec || (spec.target !== "missile" && spec.target !== "dual")) continue;
    solutions.push({
      launcherId: interceptor.launcherId,
      weaponId: interceptor.missileId,
      etaS: timeToImpact(interceptor, missile),
      active: true
    });
  }
  for (const ship of sim.ships) {
    if (!ship.alive || ship.side !== side) continue;
    for (const order of ship.launchQueue || []) {
      if (order.targetId !== missile.id) continue;
      const spec = MISSILES[order.missileId];
      if (!spec || (spec.target !== "missile" && spec.target !== "dual")) continue;
      const queueGate = Math.max(
        order.readyAt ?? sim.time,
        ship.nextDefensiveLaunchAt || 0,
        (ship.lastLaunchAtByMissile?.[order.missileId] ?? -Infinity) + spec.launchIntervalS
      );
      const releaseDelay = Math.max(0, queueGate - sim.time);
      solutions.push({
        launcherId: ship.id,
        weaponId: order.missileId,
        etaS: releaseDelay + estimateInterceptTimeS(ship, missile, order.missileId),
        active: false
      });
    }
  }
  solutions.sort((a, b) => a.etaS - b.etaS);
  return solutions;
}

function threatRemainingHits(target) {
  if (!target) return 1;
  return Math.max(0, Math.ceil(target.damageResist ?? 1) - Math.round(target.damage ?? 0));
}

function defensiveNeedProfile(sim, side, missile, track, target) {
  const tti = threatTimeToImpact(missile, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  const lethalMargin = threatRemainingHits(target) <= 1;
  const solutions = plannedInterceptorSolutions(sim, side, missile);
  const viableSolutions = solutions.filter((solution) => solution.etaS <= tti - 1.5);
  const earliestEta = viableSolutions[0]?.etaS ?? Infinity;
  let desired = 1;
  if (missile.terminal || track.quality < 0.42 || raidCount >= 2 || lethalMargin) desired = 2;
  if (earliestEta >= tti - 1.5) desired = Math.max(desired, 2);
  if (viableSolutions.length < 1 && tti < 35) desired = Math.max(desired, 2);
  if (viableSolutions.length < 2 && (missile.terminal || lethalMargin || tti < 22)) desired = Math.max(desired, 2);
  if (raidCount >= 4 || (missile.terminal && lethalMargin && tti < 18)) desired = Math.max(desired, 3);
  return {
    tti,
    raidCount,
    lethalMargin,
    solutions,
    viableSolutions,
    earliestEta,
    desired,
    needPromptShot: earliestEta >= tti - 1.5,
    needShootShoot: viableSolutions.length < 2 && (missile.terminal || lethalMargin || tti < 22),
    preferCheapLayer: range => range <= MISSILES.ESSM.rangeM && (missile.terminal || tti < 40 || lethalMargin || raidCount >= 2)
  };
}

function offensiveMissileCount(ship, includeDualRole = true) {
  const strike = (ship.loadout.MaritimeStrike ?? 0) + (ship.loadout.TomahawkBlockV ?? 0);
  return strike + (includeDualRole ? (ship.loadout["SM-6"] ?? 0) : 0);
}

function sideOffensiveMissileCount(sim, side, includeDualRole = true) {
  return sim.ships
    .filter((ship) => ship.alive && ship.side === side)
    .reduce((sum, ship) => sum + offensiveMissileCount(ship, includeDualRole), 0);
}

function chooseAntiShipWeapon(ship, track, allowReserve = false, aggression = 0.5) {
  const rangeM = distance(ship, track);
  const hull = ship.hull || "DDG";
  const candidates = ["SM-6", "MaritimeStrike", "TomahawkBlockV"].filter((id) => {
    const reserve = allowReserve ? 0 : id === "SM-6" ? Math.ceil(defaultLoadout(hull)[id] * (MISSILES[id].magazineReserveRatio || 0)) : 0;
    if (!ship.loadout[id] || ship.loadout[id] <= reserve) return false;
    if (rangeM > MISSILES[id].rangeM) return false;
    // SM-6 dual-role: prefer using as area defense unless magazine is plentiful
    if (id === "SM-6" && !allowReserve && ship.loadout[id] < (aggression > 0.72 ? 6 : 10)) return false;
    return true;
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const aRangeFit = rangeM <= MISSILES[a].preferredMaxRangeM ? 0 : 1;
    const bRangeFit = rangeM <= MISSILES[b].preferredMaxRangeM ? 0 : 1;
    return aRangeFit - bRangeFit || MISSILES[a].rangeM - MISSILES[b].rangeM;
  });
  return candidates[0];
}

export function chooseDefensiveWeapon(sim, ship, threat, options = {}) {
  const target = sim.ships.find((s) => s.id === threat.targetId && s.alive);
  const rangeM = distance(ship, threat);
  const tti = threatTimeToImpact(threat, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  const sm2 = MISSILES["SM-2MR"];
  const sm6 = MISSILES["SM-6"];
  const essm = MISSILES.ESSM;
  const hull = ship.hull || "DDG";
  const baseLoad = defaultLoadout(hull);
  const sm2Reserve = Math.ceil(baseLoad["SM-2MR"] * sm2.magazineReserveRatio);
  const sm6Reserve = Math.ceil(baseLoad["SM-6"] * sm6.magazineReserveRatio);
  const essmReserve = Math.ceil(baseLoad.ESSM * essm.magazineReserveRatio);
  const sm2Count = availableCount(ship, "SM-2MR");
  const sm6Count = availableCount(ship, "SM-6");
  const essmCount = availableCount(ship, "ESSM");
  const survivalRisk = threat.terminal || tti < 35 || raidCount >= ship.defenseDoctrine.saturationThreshold;
  const sm2Available = (survivalRisk ? sm2Count > 0 : sm2Count > sm2Reserve) && rangeM <= sm2.rangeM;
  const sm6Available = (survivalRisk ? sm6Count > 0 : sm6Count > sm6Reserve) && rangeM <= sm6.rangeM;
  const essmAvailable = (survivalRisk ? essmCount > 0 : essmCount > essmReserve) && rangeM <= essm.rangeM;
  const cheapFollowupPreferred = options.preferCheapFollowup === true;
  const urgent = options.urgent === true;
  if (cheapFollowupPreferred && essmAvailable) return "ESSM";
  if (urgent && essmAvailable && rangeM <= essm.rangeM) return "ESSM";
  if (sm6Available && rangeM > sm2.rangeM * 0.96) return "SM-6";
  if (essmAvailable && rangeM <= essm.preferredMaxRangeM * 0.95 && (tti < 55 || raidCount >= ship.defenseDoctrine.saturationThreshold)) return "ESSM";
  if (sm2Available && (rangeM > essm.preferredMaxRangeM * 0.85 || (tti > ship.defenseDoctrine.sm2EarlyTtiS && rangeM > 18 * NM) || raidCount >= 3)) return "SM-2MR";
  if (sm6Available && survivalRisk && (!sm2Available || raidCount >= ship.defenseDoctrine.saturationThreshold + 2)) return "SM-6";
  if (essmAvailable && rangeM <= essm.rangeM && (!survivalRisk || essmCount > 4)) return "ESSM";
  if (sm2Available) return "SM-2MR";
  if (sm6Available) return "SM-6";
  if (essmAvailable) return "ESSM";
  if (essmCount > 0 && rangeM <= essm.rangeM) return "ESSM";
  if (sm2Count > 0 && rangeM <= sm2.rangeM) return "SM-2MR";
  if (sm6Count > 0 && rangeM <= sm6.rangeM) return "SM-6";
  return null;
}

function missileThreatScore(sim, missile) {
  const target = sim.ships.find((s) => s.id === missile.targetId && s.alive);
  const tti = threatTimeToImpact(missile, target);
  const raidCount = target ? inboundRaidCount(sim, target) : 1;
  return (missile.terminal ? 80 : 0) + clamp(90 - tti, 0, 90) + raidCount * 14 + (target?.damage || 0) * 12;
}

function bestMissileTrackForSide(sim, side, missileId) {
  let best = forceTrack(sim, side, missileId) ?? null;
  for (const ship of sim.ships) {
    if (!ship.alive || ship.side !== side) continue;
    const local = ship.tracks.get(missileId);
    if (!local) continue;
    if (!best || (local.quality ?? 0) > (best.quality ?? 0) || (local.lastSeen ?? 0) > (best.lastSeen ?? 0)) {
      best = local;
    }
  }
  return best;
}

function planDefensiveFires(sim) {
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const observedThreats = (sim._aliveMissiles || sim.missiles.filter((m) => m.alive))
      .filter((missile) => missile.side !== side)
      .map((missile) => {
        const track = bestMissileTrackForSide(sim, side, missile.id);
        if (!track) return null;
        return { missile, track, score: missileThreatScore(sim, missile) };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    for (const { missile, track, score } of observedThreats) {
      const target = sim.ships.find((s) => s.id === missile.targetId && s.alive);
      if (!target || target.side !== side) continue;
      const need = defensiveNeedProfile(sim, side, missile, track, target);
      const formationMax = sim.ships
        .filter((ship) => ship.alive && ship.side === side)
        .reduce((max, ship) => Math.max(max, ship.defenseDoctrine?.maxAssignedInterceptors ?? 2), 1);
      const desired = Math.max(1, Math.min(formationMax + 1, Math.max(need.desired, score > 105 || missile.terminal || track.quality < 0.42 ? 2 : 1)));
      let assigned = assignedInterceptorsForThreat(sim, side, missile.id);
      if (assigned >= desired) continue;
      // Defender priority: the unit that owns the AAW sector the observed
      // threat is in engages first, then the ship under attack, then nearest.
      const defenders = sim.ships
        .filter((ship) => ship.alive && ship.side === side)
        .sort((a, b) => {
          const aSector = inSector(a, track) ? -40 * NM : 0;
          const bSector = inSector(b, track) ? -40 * NM : 0;
          const aTargetBonus = a.id === target.id ? -8 * NM : 0;
          const bTargetBonus = b.id === target.id ? -8 * NM : 0;
          return distance(a, track) + aSector + aTargetBonus - (distance(b, track) + bSector + bTargetBonus);
        });
      const threatVel = entityVelocity(missile);
      for (const defender of defenders) {
        if (assigned >= desired) break;
        if (sim.time < (defender.defenseReactionAvailableAt || 0)) continue;
        const defenderAssigned = shipThreatEngagementCount(sim, defender, missile.id);
        const defenderShotCap = need.needShootShoot ? 2 : 1;
        if (defenderAssigned >= defenderShotCap) continue;
        if (!need.needShootShoot && !need.needPromptShot && hasPendingOrActiveEngagement(sim, defender, missile.id)) continue;
        const weapon = chooseDefensiveWeapon(sim, defender, missile, {
          urgent: need.needPromptShot,
          preferCheapFollowup: defenderAssigned > 0 && need.preferCheapLayer(distance(defender, missile))
        });
        if (!weapon) continue;
        const threatTrack = {
          id: missile.id,
          side: missile.side,
          classification: missile.missileId,
          x: track.x,
          y: track.y,
          vx: track.vx ?? threatVel.vx,
          vy: track.vy ?? threatVel.vy,
          quality: track.quality ?? (missile.terminal ? 0.9 : 0.7)
        };
        const queued = queueSalvo(sim, defender, threatTrack, weapon, 1);
        if (queued) {
          missile.assignedDefenders ||= [];
          missile.assignedDefenders.push(defender.id);
          missile.threatScore = score;
          defender.defenseReactionAvailableAt = sim.time + (weapon === "ESSM" ? 0.7 : 0.9);
          assigned += queued;
        }
      }
    }
  }
}

// Firing track for a shooter against a target. Prefers the unit's own sensor
// track, but falls back to the cooperative force (CEC) track so a ship can
// engage on a picture built by another unit's radar (engage-on-remote).
function bestTrackForShip(sim, ship, target) {
  const roe = ship.roe ?? defaultRoe();
  if (roe.weaponState === WEAPON_STATE.HOLD) return null;
  const idThreshold = Math.max(ship.offenseDoctrine.minimumTrackQuality, roe.identifyThreshold ?? 0);
  const own = ship.tracks.get(target.id);
  const remote = forceTrack(sim, ship.side, target.id);
  let track = null;
  if (own && own.side !== ship.side && own.quality >= idThreshold) track = own;
  if (remote && (!track || remote.quality > track.quality)) track = remote;
  if (!track) return null;
  // TIGHT weapon-control posture demands a firmer ID and a closer commit range.
  if (roe.weaponState === WEAPON_STATE.TIGHT) {
    if (track.quality < (roe.tightMinQuality ?? 0.6)) return null;
    if (distance(ship, track) > (roe.tightCommitRangeNm ?? 90) * NM) return null;
  }
  return track;
}

function planOffensiveFires(sim) {
  const ships = sim.ships.filter((ship) => ship.alive);
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const posture = sim.commandState?.get(side) ?? {
      aggression: 0.5,
      advantage: 0,
      ownOffense: 0,
      mode: "focus",
      enemyOffenseEstimate: 0,
      targetBreadth: 1,
      raidDepth: 2
    };
    const observedTargets = [...(sim.forcePicture?.get(side)?.values() ?? [])]
      .filter((track) => track.side !== side && !String(track.id).startsWith("M-"))
      .map((track) => ({ track, score: offensiveTargetValue(track) }))
      .filter((item) => item.score >= 35)
      .sort((a, b) => b.score - a.score);
    if (!observedTargets.length) continue;
    const targetLimit = Math.max(1, Math.min(observedTargets.length, posture.targetBreadth ?? 1));
    const targetPlan = new Map();
    const selectedTargets = observedTargets.slice(0, targetLimit);
    const scoreTotal = selectedTargets.reduce((sum, item) => sum + item.score, 0) || 1;
    for (const item of selectedTargets) {
      const scoreShare = item.score / scoreTotal;
      const desiredBase = posture.mode === "saturate"
        ? (posture.raidDepth ?? 6) * (1.15 + scoreShare * 1.55)
        : posture.mode === "pressure"
          ? (posture.raidDepth ?? 4) * (0.9 + scoreShare * 1.15)
          : posture.mode === "focus"
            ? (posture.raidDepth ?? 3) * (1.05 + scoreShare * 1.35)
            : (posture.raidDepth ?? 2) * (0.65 + scoreShare);
      const desired = Math.max(
        posture.mode === "saturate" ? 3 : 1,
        Math.min(
          posture.mode === "saturate" ? 16 : 12,
          Math.round(desiredBase)
        )
      );
      targetPlan.set(item.track.id, {
        track: item.track,
        score: item.score,
        desired,
        assigned: countSideWeaponsOnTarget(sim, side, item.track.id),
        coordinatedReadyAt: sim.time + coordinatedRaidDelayS(posture, selectedTargets.length, scoreShare)
      });
    }
    const enemyEstimate = posture.enemyOffenseEstimate ?? 0;
    const allowReserve = posture.mode === "saturate" || enemyEstimate <= 0 || posture.advantage > 0.18 || posture.aggression > 0.74;
    const shooters = ships
      .filter((ship) => ship.side === side && sim.time >= ship.reactionAvailableAt)
      .sort((a, b) => {
        const aRole = a.fleetRole === FLEET_ROLE.OTC ? -2 : a.fleetRole === FLEET_ROLE.AAWC ? -1 : 0;
        const bRole = b.fleetRole === FLEET_ROLE.OTC ? -2 : b.fleetRole === FLEET_ROLE.AAWC ? -1 : 0;
        const aDist = distance(a, selectedTargets[0].track);
        const bDist = distance(b, selectedTargets[0].track);
        return aRole - bRole || aDist - bDist || a.id.localeCompare(b.id);
      });
    for (const shooter of shooters) {
      const shooterAggression = clamp(
        0.25 * (shooter.doctrine?.aggression ?? 0.65) + 0.75 * posture.aggression,
        0.15,
        0.95
      );
      let launches = 0;
      const commitLimit = offensiveAllocationsPerCycle(posture, shooterAggression);
      while (launches < commitLimit) {
        let launchedThisPass = false;
        for (const item of selectedTargets) {
          const state = targetPlan.get(item.track.id);
          if (!state || state.assigned >= state.desired) continue;
          const targetShip = sim.ships.find((target) => target.id === item.track.id && target.alive);
          if (!targetShip) continue;
          const track = bestTrackForShip(sim, shooter, targetShip);
          if (!track) continue;
          const targetScore = state.score;
          const targetAllowReserve = allowReserve || shooterAggression > 0.72 || targetScore > 120;
          const weapon = chooseAntiShipWeapon(shooter, track, targetAllowReserve, shooterAggression);
          if (!weapon) continue;
          const alreadyAssigned = countSideWeaponsOnTarget(sim, side, item.track.id);
          if (alreadyAssigned >= state.desired) continue;
          const ownPending = (shooter.launchQueue || []).some((order) => order.targetId === item.track.id && MISSILES[order.missileId]?.category === "anti_ship")
            || sim.missiles.some((m) => m.alive && m.launcherId === shooter.id && m.targetId === item.track.id && MISSILES[m.missileId]?.category === "anti_ship");
          const saturationHold = posture.mode === "saturate" ? 0.92 : shooterAggression > 0.74 ? 0.75 : 0.5;
          if (ownPending && alreadyAssigned >= Math.ceil(state.desired * saturationHold)) continue;
          const salvoBonus = posture.mode === "saturate" && shooterAggression > 0.82 ? 1 : 0;
          const count = Math.min(MISSILES[weapon].salvo + salvoBonus, state.desired - alreadyAssigned, availableCount(shooter, weapon));
          if (count > 0 && queueSalvo(sim, shooter, track, weapon, count, {
            readyAtOverride: state.coordinatedReadyAt,
            priorityOverride: posture.mode === "saturate" ? 40 : 50
          })) {
            launches += 1;
            const baseWindow = offensiveCommitWindowS(posture, shooterAggression);
            shooter.reactionAvailableAt = sim.time + baseWindow + sim.rng.range(0, baseWindow * 0.45);
            state.assigned += count;
            launchedThisPass = true;
            break;
          }
        }
        if (!launchedThisPass) break;
      }
    }
  }
}

function planEngagements(sim) {
  if (sim.time < (sim.nextFirePlanAt ?? 0)) return;
  sim.nextFirePlanAt = sim.time + 1;
  computeFleetCommand(sim);
  planDefensiveFires(sim);
  planOffensiveFires(sim);
  for (const ship of sim.ships) {
    if (ship.alive) ship.lastFirePlanAt = sim.time;
  }
}

function decideShip(sim, ship) {
  if (!ship.alive || sim.time < ship.nextDecision) return;
  ship.nextDecision = sim.time + 1;
  if (sim.mode !== SCENARIO_MODE.RUNNING) return;
  const enemyTracks = [...ship.tracks.values()].filter((t) => t.side !== ship.side && t.quality > 0.18);
  enemyTracks.sort((a, b) => distance(ship, a) - distance(ship, b));
  const incoming = sim.missiles
    .filter((m) => m.alive && m.side !== ship.side && m.targetId === ship.id)
    .sort((a, b) => (a.timeToImpactEstimate ?? Infinity) - (b.timeToImpactEstimate ?? Infinity));
  if (incoming.length) {
    ship.desiredSpeed = ship.maxSpeed;
    const threat = incoming[0];
    ship.waypoint = {
      x: ship.x + Math.cos(angleTo(threat, ship) + Math.PI / 2) * 8 * NM,
      y: ship.y + Math.sin(angleTo(threat, ship) + Math.PI / 2) * 8 * NM
    };
    return;
  }
  if (offensiveMissileCount(ship, false) <= 0) {
    const nearestEnemy = enemyTracks[0];
    const fallback = ship.side === SIDE.BLUE ? Math.PI : 0;
    const retreatBearing = nearestEnemy ? angleTo(nearestEnemy, ship) : fallback;
    ship.waypoint = {
      x: ship.x + Math.cos(retreatBearing) * 45 * NM,
      y: ship.y + Math.sin(retreatBearing) * 18 * NM
    };
    ship.desiredSpeed = Math.max(ship.cruiseSpeed ?? 0, ship.maxSpeed * 0.86);
    return;
  }
  // Non-guide units hold formation station on the OTC when not prosecuting a
  // close contact; the guide (and single-ship sides) patrol/advance normally.
  if (ship.station && !ship.isOTC) {
    const d = distance(ship, ship.station);
    ship.waypoint = { x: ship.station.x, y: ship.station.y };
    // Close the station briskly when out of position, ease off once on station.
    ship.desiredSpeed = d > 1.5 * NM
      ? clamp(16 * KNOT * SHIP_SPEED_MULTIPLIER + d / 60, 16 * KNOT, ship.maxSpeed)
      : ship.cruiseSpeed ?? 16 * KNOT * SHIP_SPEED_MULTIPLIER;
    if (!enemyTracks.length) return;
  } else if (!enemyTracks.length) {
    ship.desiredSpeed = ship.cruiseSpeed ?? 16 * KNOT * SHIP_SPEED_MULTIPLIER;
    if (!ship.waypoint) {
      const patrol = ship.side === SIDE.BLUE ? 1 : -1;
      ship.waypoint = { x: ship.x + patrol * 9 * NM, y: ship.y + sim.rng.range(-6, 6) * NM };
    }
    return;
  }
  const target = enemyTracks[0];
  const rangeM = distance(ship, target);
  const standoffM = ship.doctrine.standoffNm * NM;
  if (rangeM < standoffM * 0.72) {
    const away = angleTo(target, ship);
    ship.waypoint = { x: ship.x + Math.cos(away) * 12 * NM, y: ship.y + Math.sin(away) * 12 * NM };
    ship.desiredSpeed = 25 * KNOT * SHIP_SPEED_MULTIPLIER;
  } else if (rangeM > standoffM * 1.25) {
    ship.waypoint = { x: target.x, y: target.y };
    ship.desiredSpeed = 24 * KNOT * SHIP_SPEED_MULTIPLIER;
  } else {
    ship.desiredSpeed = 18 * KNOT * SHIP_SPEED_MULTIPLIER;
  }
}

function entityVelocity(entity) {
  if (!entity) return { vx: 0, vy: 0 };
  const speed = entity.speed ?? 0;
  return { vx: Math.cos(entity.heading) * speed, vy: Math.sin(entity.heading) * speed };
}

// Subsystem damage model: each hit degrades random subsystems, affecting combat capability.
function applySubsystemDamage(sim, ship) {
  const subs = ship.subsystems;
  if (!subs) return;
  // Each hit damages 2-3 subsystems (random selection weighted by vulnerability)
  const count = 2 + Math.floor(sim.rng.next() * 2); // 2 or 3
  const candidates = ["radar", "vls", "propulsion", "fireControl", "ciws", "cic"];
  // Shuffle and pick first `count`
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(sim.rng.next() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const messages = [];
  for (let i = 0; i < count; i++) {
    const key = candidates[i];
    const degradation = 0.15 + sim.rng.next() * 0.30; // 15-45% damage per subsystem hit
    subs[key] = Math.max(0, subs[key] - degradation);
    if (subs[key] <= 0.05) {
      messages.push(`${key} destroyed`);
    } else if (subs[key] < 0.5) {
      messages.push(`${key} heavily damaged`);
    }
  }
  if (messages.length) {
    addEvent(sim, `${ship.name} subsystem damage: ${messages.join(", ")}.`, ship.side);
  }
}

// Target destroyed in flight: no re-vectoring is allowed.
function handleTargetLoss(sim, missile, spec) {
  missile.targetLost = true;
  const controller = sim.ships.find((s) => s.id === missile.launcherId);
  const roe = controller?.roe ?? defaultRoe();
  missile.alive = false;
  if (roe.selfDestructOnTargetLoss) {
    addEvent(sim, `${missile.missileId} received a midcourse abort and self-destructed after its target was destroyed.`, missile.side);
  } else {
    addEvent(sim, `${missile.missileId} lost its target and fell into the sea.`, missile.side);
  }
  return false;
}

function updateMissiles(sim, dt) {
  for (const missile of sim.missiles) {
    if (!missile.alive) continue;
    const spec = MISSILES[missile.missileId];
    // Dual-role missiles (SM-6) can target either ships or missiles
    const isDual = spec.target === "dual";
    let target = spec.target === "missile"
      ? sim.missiles.find((m) => m.id === missile.targetId && m.alive)
      : isDual
        ? (sim.ships.find((s) => s.id === missile.targetId && s.alive) ||
           sim.missiles.find((m) => m.id === missile.targetId && m.alive))
        : sim.ships.find((s) => s.id === missile.targetId && s.alive);

    // Target killed in flight (sunk, or threat intercepted by someone else):
    // abort or self-destruct — never coast on a dead datum.
    if (!target) {
      if (!handleTargetLoss(sim, missile, spec)) continue;
      target = spec.target === "missile"
        ? sim.missiles.find((m) => m.id === missile.targetId && m.alive)
        : isDual
          ? (sim.ships.find((s) => s.id === missile.targetId && s.alive) ||
             sim.missiles.find((m) => m.id === missile.targetId && m.alive))
        : sim.ships.find((s) => s.id === missile.targetId && s.alive);
      if (!target) { missile.alive = false; continue; }
    }

    const distToTarget = distance(missile, target);
    missile.timeToImpactEstimate = timeToImpact(missile, target);
    // Terminal phase determination: dual-role uses target type to decide
    const isAntiShipTarget = spec.category === "anti_ship" || (isDual && target.speed !== undefined && target.id?.startsWith && !target.id.startsWith("M-"));
    const isInterceptorTarget = spec.target === "missile" || (isDual && target.speed !== undefined && target.id?.startsWith && target.id.startsWith("M-"));
    if (isAntiShipTarget && distToTarget < spec.seekerRangeM) {
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "terminal attack phase";
      missile.seaSkimming = true;
    } else if (isInterceptorTarget && distToTarget < 4 * NM) {
      missile.terminal = true;
      missile.phase = "terminal";
      missile.terminalReason = "intercept endgame";
    } else if (missile.flownM > 2 * NM) {
      missile.phase = "midcourse";
    }

    // Select the aimpoint. Course is always computed on a velocity-lead
    // (collision) solution, never on the bare target position.
    let aimX = target.x;
    let aimY = target.y;
    let aimVx;
    let aimVy;
    // Mid-course: use CEC datalink for surface targets (ship or dual vs ship)
    const aimIsShip = spec.target === "ship" || (isDual && isAntiShipTarget);
    if (aimIsShip && !missile.terminal) {
      const fused = forceTrack(sim, missile.controllerSide ?? missile.side, missile.targetId);
      if (fused) {
        aimX = fused.x;
        aimY = fused.y;
        aimVx = fused.vx;
        aimVy = fused.vy;
      } else {
        const tv = entityVelocity(target);
        aimVx = tv.vx;
        aimVy = tv.vy;
      }
    } else {
      // Terminal seeker lock (or interceptor under fire-control radar): lead
      // the true target motion.
      const tv = entityVelocity(target);
      aimVx = tv.vx;
      aimVy = tv.vy;
    }
    const lead = interceptPoint(missile.x, missile.y, missile.speed, aimX, aimY, aimVx, aimVy);
    missile.aimX = lead.x;
    missile.aimY = lead.y;
    missile.targetX = lead.x;
    missile.targetY = lead.y;

    // Rate-limited steering toward the lead point (proportional-navigation
    // style: track the rotating line of sight within the airframe's turn
    // limit, sharper in the terminal phase).
    const losAngle = Math.atan2(lead.y - missile.y, lead.x - missile.x);
    missile.losRate = wrapAngle(losAngle - (missile.losAngle ?? losAngle)) / Math.max(dt, 1e-3);
    missile.losAngle = losAngle;
    const baseTurn = (spec.maxTurnRateDps ?? 12) * Math.PI / 180;
    const maxTurn = baseTurn * (missile.terminal ? 1.5 : 1) * dt;
    missile.heading = wrapAngle(missile.heading + clamp(wrapAngle(losAngle - missile.heading), -maxTurn, maxTurn));
    const travel = missile.speed * dt;
    missile.x += Math.cos(missile.heading) * travel;
    missile.y += Math.sin(missile.heading) * travel;
    missile.flownM += travel;
    // Hit resolution: determine target type for dual-role missiles
    const targetIsMissile = spec.target === "missile" || (isDual && isInterceptorTarget);
    const targetIsShip = spec.target === "ship" || (isDual && isAntiShipTarget);
    if (target && targetIsMissile && distance(missile, target) < 850) {
      // Interceptor PK: base PK modified by target kinematics and defense saturation
      // Sea-skimming targets are harder to engage; supersonic targets reduce engagement window
      const targetSpeed = target.speed || 270;
      const supersonicPenalty = targetSpeed > 600 ? 0.15 : 0;
      const seaSkimPenalty = target.seaSkimming ? 0.14 : 0;
      // Defense saturation: when many threats arrive simultaneously, each interceptor is less effective
      const concurrentThreats = (sim._missilesByTarget?.get(missile.targetId) || [])
        .filter((m) => m.side !== missile.side && distance(m, missile) < 8 * NM).length;
      const saturationPenalty = Math.max(0, (concurrentThreats - 2) * 0.04);
      const interceptChance = clamp(
        spec.pk + (missile.terminal ? 0.06 : 0) - supersonicPenalty - seaSkimPenalty - saturationPenalty,
        0.10,
        0.65
      );
      if (sim.rng.next() < interceptChance) {
        target.alive = false;
        addEvent(sim, `${missile.missileId} intercepted incoming ${target.missileId}.`, missile.side);
      } else {
        addEvent(sim, `${missile.missileId} failed to intercept ${target.missileId}.`, missile.side);
      }
      missile.alive = false;
    } else if (target && targetIsShip && distance(missile, target) < 420) {
      // Hit chance: base PK modified by terminal phase, sea state, target damage
      // Large ships (BBG) are easier to hit, fast/maneuvering ships harder
      const maneuverPenalty = target.speed > 12 ? 0.06 : 0;
      const sizeBonus = Math.min(0.08, (target.displacementT || 9200) / 200000);
      const hitChance = clamp(
        spec.pk + (missile.terminal ? 0.18 : 0) - target.damage * 0.03 + sizeBonus - maneuverPenalty,
        0.10, 0.88
      );
      if (sim.rng.next() < hitChance) {
        target.damage += 1;
        // Subsystem damage: each hit degrades random subsystems
        applySubsystemDamage(sim, target);
        const damageShown = Math.max(0, Math.round(target.damage));
        const resistShown = Math.max(1, Math.ceil(target.damageResist ?? 3.0));
        addEvent(sim, `${target.name} hit by ${missile.missileId}. Damage: ${damageShown}/${resistShown}.`, missile.side);
        // Mission kill at per-class damageResist threshold
        if (target.damage >= (target.damageResist ?? 3.0)) {
          target.alive = false;
          target.speed = 0;
          addEvent(sim, `${target.name} mission-killed — ${damageShown} hits sustained (class limit ${resistShown}).`, missile.side);
        }
      } else {
        addEvent(sim, `${missile.missileId} missed ${target.name}.`, missile.side);
      }
      missile.alive = false;
    }
    if (missile.flownM > missile.maxRangeM) {
      missile.alive = false;
      addEvent(sim, `${missile.missileId} exhausted fuel and fell into the sea.`, missile.side);
    }
  }
  sim.missiles = sim.missiles.filter((m) => m.alive);
}

function pointDefense(sim) {
  for (const ship of sim.ships) {
    if (!ship.alive || ship.ciwsCooldown > 0 || ship.ciwsAmmo <= 0 || sim.time < ship.nextCiwsAt) continue;
    if (!(ship.roe?.ciwsRelease ?? true)) continue;
    const ciwsRange = 1.6 * NM;
    const inbound = sim.missiles
      .filter((m) => m.alive && m.side !== ship.side && m.targetId === ship.id && m.terminal && distance(ship, m) < ciwsRange)
      .sort((a, b) => (a.timeToImpactEstimate ?? Infinity) - (b.timeToImpactEstimate ?? Infinity))[0];
    if (!inbound) continue;
    // Per-class CIWS parameters
    const burstRounds = ship.ciwsBurstRounds ?? 180;
    const burstS = ship.ciwsBurstS ?? 1.4;
    const cycleS = ship.ciwsCycleS ?? 5.5;
    ship.ciwsAmmo = Math.max(0, ship.ciwsAmmo - burstRounds);
    ship.ciwsBurstUntil = sim.time + burstS;
    ship.nextCiwsAt = sim.time + cycleS;
    ship.ciwsCooldown = cycleS;
    // CIWS PK model: base PK per mount, each mount can engage one threat
    const ciwsCount = ship.ciwsCount ?? 1;
    const basePk = 0.45;  // Phalanx 1B baseline single-shot Pk against subsonic ASCM
    const terminalCount = (sim._missilesByTarget?.get(ship.id) || [])
      .filter((m) => m.side !== ship.side && m.terminal && distance(ship, m) < 3 * NM).length;
    // Saturation: multiple simultaneous leakers divide CIWS attention
    const saturationRatio = Math.min(1, ciwsCount / Math.max(1, terminalCount));
    const seaSkimPenalty = inbound.seaSkimming ? 0.18 : 0;
    const damagePenalty = ship.damage * 0.06;
    const speedPenalty = (inbound.speed > 680 ? 0.12 : 0); // supersonic penalty
    const pKill = clamp(basePk * saturationRatio - seaSkimPenalty - damagePenalty - speedPenalty, 0.06, 0.72);
    if (sim.rng.next() < pKill) {
      inbound.alive = false;
      addEvent(sim, `${ship.name} CIWS destroyed incoming ${inbound.missileId}.`, ship.side);
    } else {
      addEvent(sim, `${ship.name} CIWS failed against ${inbound.missileId}.`, ship.side);
    }
  }
}

export function stepSim(sim, dt = 0.25) {
  if (sim.mode === SCENARIO_MODE.SETUP) return sim;
  if (sim.mode === SCENARIO_MODE.ENDED) return sim;
  if (!canRunScenario(sim)) {
    sim.paused = true;
    sim.mode = SCENARIO_MODE.SETUP;
    addEvent(sim, "Cannot run: both Blue and Red require at least one alive ship.");
    return sim;
  }
  sim.time += dt;
  // Pre-compute indexes for performance (avoid repeated O(n) filters)
  sim._aliveShips = sim.ships.filter((s) => s.alive);
  sim._aliveMissiles = sim.missiles.filter((m) => m.alive);
  // Group missiles by target for fast lookup
  const mbt = new Map();
  for (const m of sim._aliveMissiles) {
    if (!mbt.has(m.targetId)) mbt.set(m.targetId, []);
    mbt.get(m.targetId).push(m);
  }
  sim._missilesByTarget = mbt;
  // Group ships by side
  const sbs = new Map();
  for (const s of sim._aliveShips) {
    if (!sbs.has(s.side)) sbs.set(s.side, []);
    sbs.get(s.side).push(s);
  }
  sim._shipsBySide = sbs;
  // Group missiles by side
  const mbs = new Map();
  for (const m of sim._aliveMissiles) {
    if (!mbs.has(m.side)) mbs.set(m.side, []);
    mbs.get(m.side).push(m);
  }
  sim._missilesBySide = mbs;

  ageTracks(sim, dt);
  moveShips(sim, dt);
  scanSensors(sim, dt);
  if (Math.floor((sim.time - dt) / 5) !== Math.floor(sim.time / 5)) shareTracks(sim);
  buildForcePicture(sim);
  for (const ship of sim.ships) decideShip(sim, ship);
  planEngagements(sim);
  processLaunchQueues(sim);
  updateMissiles(sim, dt);
  pointDefense(sim);
  pruneDeadTracks(sim);
  const aliveSides = new Set(sim.ships.filter((s) => s.alive).map((s) => s.side));
  if (aliveSides.size === 1 && !sim.ended) {
    sim.ended = [...aliveSides][0];
    sim.paused = true;
    sim.mode = SCENARIO_MODE.ENDED;
    addEvent(sim, `${sim.ended} side controls the battlespace. Simulation ended.`);
  }
  return sim;
}

export function formatTime(t) {
  const minutes = Math.floor(t / 60).toString().padStart(2, "0");
  const seconds = Math.floor(t % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
