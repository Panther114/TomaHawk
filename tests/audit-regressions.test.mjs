import assert from "node:assert/strict";
import test from "node:test";
import {
  addEvent, canReceiveTrack, chooseDefensiveWeapon, clearSide, createScenario,
  decideAircraft, decideSubmarine, duplicateShip, exportAfterAction, isShipPositionOnLand,
  NM, placeShip, pointDefense, restoreScenario, SCENARIO_MODE, serializeScenario,
  setLoadout, setScenarioMap, SIDE, stepSim, updateMissiles
} from "../src/sim.js";
import { battleStatusState } from "../src/ui/view.js";
import { translateEventText } from "../src/ui/lang.js";
import { geographicDistanceM, projectLonLat } from "../src/world/map-spec.js";

function battle(blue = "DDG", red = "DDG") {
  const sim = createScenario(7, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const b = placeShip(sim, SIDE.BLUE, -15 * NM, 0, blue);
  const r = placeShip(sim, SIDE.RED, 15 * NM, 0, red);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return { sim, b, r };
}

function fire(sim, target, overrides = {}) {
  const missile = {
    id: "M-" + (sim.missiles.length + 1), missileId: "AGM-84",
    side: target.side === SIDE.BLUE ? SIDE.RED : SIDE.BLUE, targetId: target.id,
    launchRole: target.domain === "air" ? "anti_air" : "anti_ship",
    x: target.x - 450, y: target.y, heading: 0, speed: 300, launchSpeedMps: 300,
    flownM: 0, maxRangeM: 200 * NM, altitudeM: 12, medium: "air",
    terminal: true, alive: true, ...overrides
  };
  sim.missiles.push(missile);
  return missile;
}

const checkpoint = sim => restoreScenario(JSON.parse(JSON.stringify(serializeScenario(sim))));
const ticks = (sim, count) => { for (let tick = 0; tick < count; tick++) stepSim(sim); };

test("JSON checkpoints continue with the same random state and event stream", () => {
  for (const tick of [4, 47, 164, 328, 477, 760, 1200]) {
    const { sim } = battle();
    ticks(sim, tick);
    const resumed = checkpoint(sim);
    ticks(sim, 700);
    ticks(resumed, 700);
    assert.equal(resumed.rng.seed, sim.rng.seed, "RNG at checkpoint tick " + tick);
    assert.deepEqual(resumed.events, sim.events);
  }
});

test("pending hostile ordnance can turn apparent victory into a draw", () => {
  const { sim, b, r } = battle();
  for (const unit of [b, r]) {
    unit.damage = unit.damageResist - 1;
    unit.loadout = {};
    unit.radarDecoys = 0;
    unit.ciwsAmmo = 0;
  }
  fire(sim, r);
  fire(sim, b, { x: b.x - 2200 });
  sim.rng.next = () => 0.2;
  stepSim(sim);
  assert.equal(r.alive, false);
  assert.equal(sim.mode, SCENARIO_MODE.RUNNING);
  ticks(sim, 40);
  assert.equal(sim.ended, "draw");
});

test("CIWS rejects submerged and vertically distant contacts", () => {
  const { sim, b } = battle();
  const before = b.ciwsAmmo;
  fire(sim, b, { missileId: "Mk48", medium: "underwater", depthM: 200 });
  fire(sim, b, { altitudeM: 50_000 });
  pointDefense(sim);
  assert.equal(b.ciwsAmmo, before);
  assert.equal(sim.missiles.length, 2);
});

test("an airborne intercept and a depleted strike cannot hit from outside their envelope", () => {
  const air = battle("DDG", "F22");
  air.r.altitudeM = 12_000;
  air.r.radarDecoys = 0;
  fire(air.sim, air.r, { missileId: "SM-2MR" });
  air.sim.rng.next = () => 0;
  updateMissiles(air.sim, 0.25);
  assert.equal(air.r.damage, 0);

  const surface = battle();
  surface.r.radarDecoys = 0;
  const missile = fire(surface.sim, surface.r, { flownM: 100, maxRangeM: 101 });
  surface.sim.rng.next = () => 0;
  updateMissiles(surface.sim, 0.25);
  assert.equal(missile.alive, false);
  assert.equal(missile.flownM, 101);
  assert.equal(surface.r.damage, 0);
});

test("guidance keeps its last datum and submarines require an incoming cue", () => {
  const { sim, r } = battle();
  const missile = fire(sim, r, {
    terminal: false, x: r.x - 70 * NM, targetX: r.x, targetY: 0
  });
  r.y += 17_000;
  updateMissiles(sim, 0.25);
  assert.equal(missile.aimY, 0);

  const sub = battle("SSN", "SSN");
  fire(sub.sim, sub.b, { missileId: "Mk48", medium: "underwater", x: sub.b.x - 22 * NM });
  decideSubmarine(sub.sim, sub.b);
  assert.equal(sub.b.targetDepthM, 250);
  assert.ok(sub.b.desiredSpeed < sub.b.maxSpeed);
});

test("no-attack scenarios draw at the same tick after a late checkpoint", () => {
  const { sim, b, r } = battle("AWAC", "AWAC");
  for (const unit of [b, r]) placeShip(sim, unit.side, unit.x, unit.y, "AFB");
  ticks(sim, 356);
  const resumed = checkpoint(sim);
  ticks(sim, 20);
  ticks(resumed, 20);
  assert.equal(sim.ended, "draw");
  assert.equal(resumed.ended, "draw");
  assert.equal(resumed.time, sim.time);
});

test("sortie stocks, launch spacing and aircraft losses limit rearm", () => {
  const { sim, b } = battle("F22", "EWR");
  const base = placeShip(sim, SIDE.BLUE, b.x, b.y, "AFB");
  base.sortiesRemaining = 1;
  b.damage = b.damageResist - 1;
  b.loadout = {};
  b.airState = "rearming";
  b.homeBaseId = base.id;
  b.rearmUntil = 0;
  decideAircraft(sim, b);
  assert.equal(b.airState, "mission");
  assert.equal(b.loadout["AIM-120D"], 1);
  assert.equal(base.sortiesRemaining, 0);
  assert.ok(base.nextSortieAt > sim.time);
  const other = placeShip(sim, SIDE.BLUE, base.x, base.y, "F22");
  Object.assign(other, { airState: "rearming", homeBaseId: base.id, rearmUntil: 0 });
  decideAircraft(sim, other);
  assert.equal(other.airState, "rearming");
});

test("ship IDs are per scenario and duplication retains ROE", () => {
  const { sim, b } = battle();
  createScenario(8);
  b.roe.ciwsRelease = false;
  const copy = duplicateShip(sim, b.id);
  assert.equal(copy.roe.ciwsRelease, false);
  assert.equal(new Set(sim.ships.map(ship => ship.id)).size, sim.ships.length);
  assert.equal(setLoadout(b, "AIM-120D", 1).ok, false);
  assert.equal(b.loadout["AIM-120D"], undefined);
});

test("geographic map changes preserve legal placements and geographic ruler distance", () => {
  const { sim } = battle();
  sim.mode = SCENARIO_MODE.SETUP;
  const ocean = projectLonLat(145, 25);
  const unit = placeShip(sim, SIDE.BLUE, ocean.x, ocean.y, "SAM");
  assert.equal(setScenarioMap(sim, "eastChinaSea").ok, true);
  assert.equal(isShipPositionOnLand(sim, unit), true);
  const km = geographicDistanceM(projectLonLat(0, 60), projectLonLat(1, 60)) / 1000;
  assert.ok(Math.abs(km - 55.597) < 0.01);
});

test("an unknown in-flight custom weapon is rejected before installation", () => {
  const { sim, r } = battle();
  fire(sim, r, { missileId: "ABSENT_CUSTOM_AMMO" });
  assert.throws(() => checkpoint(sim), /ABSENT_CUSTOM_AMMO/);
});

test("battle archive, interception percentages and translated outcomes survive checkpoint", () => {
  const { sim } = battle();
  for (let n = 0; n < 600; n++) {
    addEvent(sim, "launch", SIDE.RED, "attack");
    if (n % 4 === 0) addEvent(sim, "intercept", SIDE.BLUE, "intercept");
    battleStatusState(sim);
  }
  const resumed = checkpoint(sim);
  assert.equal(battleStatusState(resumed).blue.intercept.value, "25%");
  assert.equal(exportAfterAction(resumed).events.length, sim.events.length + sim.eventArchive.length);
  assert.equal(exportAfterAction(resumed).events[0].id, 1);
  assert.match(translateEventText("Mutual exhaustion — neither side retains offensive munitions. Draw."), /平局/);
  assert.match(translateEventText("Blue side controls the battlespace. Simulation ended."), /蓝方控制战场/);
});

test("long-distance datalinks and low-altitude THAAD shots are outside their envelopes", () => {
  assert.equal(canReceiveTrack({ x: 3_000_000, y: 0 }, { linkX: 0, linkY: 0 }), false);
  assert.equal(canReceiveTrack({ x: 60_000, y: 0 }, { linkX: 0, linkY: 0 }), true);
  const { sim, b } = battle("THAAD", "DEB");
  const threat = { id: "M-test", missileId: "DarkEagle", x: 0, y: 0, speed: 1700, altitudeM: 5000, targetId: b.id };
  assert.equal(chooseDefensiveWeapon(sim, b, threat), null);
  assert.equal(chooseDefensiveWeapon(sim, b, { ...threat, altitudeM: 30_000 }), "THAAD");
});
