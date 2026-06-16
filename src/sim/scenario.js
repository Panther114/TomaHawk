// Scenario lifecycle: creation, JSON serialization/restore, after-action
// export, setup-mode editing (place/duplicate/delete/clear), and the run/setup
// gating predicates.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE, SCENARIO_MODE, FLEET_ROLE } from "./constants.js";
import { Rng } from "./math.js";
import {
  SHIP_CLASSES,
  makeShip,
  makeBurke,
  normalizeLoadout,
  defaultLoadout,
  defaultRoe,
  resetShipIds
} from "./ships.js";
import { addEvent } from "./events.js";

export function createScenario(seed = 7) {
  resetShipIds(1);
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
  resetShipIds(Math.max(1, ...data.ships.map((s) => {
    const num = Number(String(s.id).replace(/^[A-Z]+-/, "")) || 0;
    return num;
  })) + 1);
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

export function canAddAssets(sim) {
  return sim?.mode === SCENARIO_MODE.SETUP;
}
