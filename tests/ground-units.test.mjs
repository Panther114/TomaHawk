import test from "node:test";
import assert from "node:assert/strict";

import {
  NM,
  SIDE,
  SCENARIO_MODE,
  SHIP_CLASSES,
  defaultLoadout,
  createScenario,
  clearSide,
  placeShip,
  duplicateShip,
  stepSim,
  computeFleetCommand,
  serializeScenario,
  restoreScenario,
  forceTrack,
  FLEET_ROLE
} from "../src/sim.js";
import { isLandPoint, isWaterPoint, tacticalMap } from "../src/world/terrain.js";

// Scan a coarse grid of the active map for a clearly-land and clearly-water
// point so placement tests do not hard-code coastline coordinates.
function findTerrainPoints(sim) {
  const map = tacticalMap(sim.mapId);
  let land = null;
  let water = null;
  const halfW = sim.widthM / 2;
  const halfH = sim.heightM / 2;
  for (let gx = -20; gx <= 20 && (!land || !water); gx++) {
    for (let gy = -20; gy <= 20 && (!land || !water); gy++) {
      const p = { x: (gx / 20) * halfW * 0.95, y: (gy / 20) * halfH * 0.95 };
      if (!land && isLandPoint(p, map)) land = p;
      if (!water && isWaterPoint(p, sim.mapId, 0.5 * NM)) water = p;
    }
  }
  return { land, water };
}

function emptyRunningScenario(seed, map = "openSea") {
  const sim = createScenario(seed, map);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  return sim;
}

test("ground classes are fixed, land-based, and speed-locked", () => {
  for (const hull of ["SAM", "CDB", "EWR"]) {
    const cls = SHIP_CLASSES[hull];
    assert.equal(cls.domain, "ground", hull);
    assert.equal(cls.isFixed, true, hull);
    assert.equal(cls.maxSpeedKt, 0, hull);
  }
});

test("ground default loadouts are explicit type-specific magazines", () => {
  assert.deepEqual(defaultLoadout("SAM"), { "SM-2MR": 32, "SM-6": 8, ESSM: 16 });
  assert.deepEqual(defaultLoadout("CDB"), { MaritimeStrike: 32, TomahawkBlockV: 8 });
  assert.deepEqual(defaultLoadout("EWR"), {}); // radar carries no weapons
});

test("ground emplacements never move and never re-seat to water", () => {
  const sim = emptyRunningScenario(7);
  const sam = placeShip(sim, SIDE.BLUE, -10 * NM, 3 * NM, "SAM");
  const enemy = placeShip(sim, SIDE.RED, 20 * NM, 0, "DDG");
  assert.ok(sam && enemy);
  const start = { x: sam.x, y: sam.y };
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  for (let i = 0; i < 600 && !sim.ended; i++) stepSim(sim, 0.25);
  assert.equal(sam.x, start.x);
  assert.equal(sam.y, start.y);
  assert.equal(sam.speed, 0);
});

test("naval anti-ship fire engages and destroys a defenceless ground radar", () => {
  const sim = emptyRunningScenario(7);
  placeShip(sim, SIDE.BLUE, -12 * NM, 0, "DDG");
  const ewr = placeShip(sim, SIDE.RED, 12 * NM, 0, "EWR");
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  let sawStrikeAtEwr = false;
  for (let i = 0; i < 4000 && !sim.ended; i++) {
    stepSim(sim, 0.25);
    if (!sawStrikeAtEwr) sawStrikeAtEwr = sim.missiles.some((m) => m.targetId === ewr.id && m.side === SIDE.BLUE);
  }
  assert.ok(sawStrikeAtEwr, "blue should target the ground radar with anti-ship missiles");
  assert.equal(ewr.alive, false, "the radar should be destroyed");
  assert.equal(sim.ended, SIDE.BLUE);
});

test("ground radar shares its picture so a radar-off friendly ship can engage on remote", () => {
  const sim = emptyRunningScenario(11);
  const blind = placeShip(sim, SIDE.BLUE, -60 * NM, 0, "DDG");
  blind.radarActive = false; // cannot detect for itself
  placeShip(sim, SIDE.BLUE, 0, 0, "EWR"); // long-range search radar
  const red = placeShip(sim, SIDE.RED, 40 * NM, 0, "DDG");
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  for (let i = 0; i < 80; i++) stepSim(sim, 0.25);
  const fused = forceTrack(sim, SIDE.BLUE, red.id);
  assert.ok(fused, "the EWR's track must reach the fused force picture");
  assert.equal(blind.tracks.has(red.id), false, "the blind ship has no organic track");
});

test("a fixed emplacement is never the OTC while a mobile unit survives", () => {
  const sim = emptyRunningScenario(5);
  const ddg = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "DDG");
  const sam = placeShip(sim, SIDE.BLUE, -18 * NM, 4 * NM, "SAM");
  placeShip(sim, SIDE.RED, 20 * NM, 0, "DDG");
  computeFleetCommand(sim);
  assert.equal(ddg.fleetRole, FLEET_ROLE.OTC);
  assert.equal(sam.isOTC, false);
  assert.equal(sam.station, null, "a fixed unit is never assigned a station to steam to");
});

test("ground units survive a serialize/restore round-trip without relocating", () => {
  const sim = emptyRunningScenario(3);
  const cdb = placeShip(sim, SIDE.RED, 15 * NM, -7 * NM, "CDB");
  placeShip(sim, SIDE.BLUE, -15 * NM, 0, "DDG");
  const restored = restoreScenario(serializeScenario(sim));
  const restoredCdb = restored.ships.find((s) => s.id === cdb.id);
  assert.ok(restoredCdb);
  assert.equal(restoredCdb.domain, "ground");
  assert.equal(restoredCdb.isFixed, true);
  assert.equal(restoredCdb.x, cdb.x);
  assert.equal(restoredCdb.y, cdb.y);
});

test("ground emplacements may be placed on land but never on water (terrain map)", () => {
  const sim = createScenario(21, "eastChinaSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const { land, water } = findTerrainPoints(sim);
  assert.ok(land, "test map should expose a land point");
  assert.ok(water, "test map should expose a water point");
  // Ground unit: rejected on water, accepted on land.
  assert.equal(placeShip(sim, SIDE.BLUE, water.x, water.y, "SAM"), null);
  const onLand = placeShip(sim, SIDE.BLUE, land.x, land.y, "SAM");
  assert.ok(onLand, "a SAM should place on land");
  assert.equal(onLand.isFixed, true);
  // Sea unit: the inverse — accepted on water, rejected on land.
  assert.ok(placeShip(sim, SIDE.RED, water.x, water.y, "DDG"), "a DDG should place on water");
  assert.equal(placeShip(sim, SIDE.RED, land.x, land.y, "DDG"), null);
});

test("duplicating a ground emplacement keeps the copy on land", () => {
  const sim = createScenario(7, "eastChinaSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const { land } = findTerrainPoints(sim);
  const sam = placeShip(sim, SIDE.BLUE, land.x, land.y, "SAM");
  const copy = duplicateShip(sim, sam.id);
  assert.ok(copy);
  assert.equal(copy.isFixed, true);
  assert.equal(isLandPoint({ x: copy.x, y: copy.y }, tacticalMap(sim.mapId)), true);
});

test("coastal battery engages a ship beyond its anti-ship missile range using long-range fires", () => {
  // The target sits at 150 nm — beyond MaritimeStrike (120 nm) but within the
  // battery's targeting radar — so a passive battery would never fire. The fix
  // (radar out-reaching the primary weapon) lets it engage with TomahawkBlockV.
  const sim = createScenario(7, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const blue = placeShip(sim, SIDE.BLUE, -75 * NM, 0, "DDG");
  blue.loadout = { "SM-2MR": 40, "SM-6": 0, ESSM: 32, MaritimeStrike: 0, TomahawkBlockV: 0 };
  const cdb = placeShip(sim, SIDE.RED, 75 * NM, 0, "CDB");
  const startTlam = cdb.loadout.TomahawkBlockV;
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  let firedAtBlue = false;
  for (let i = 0; i < 2000 && !sim.ended; i++) {
    stepSim(sim, 0.25);
    if (!firedAtBlue) firedAtBlue = sim.missiles.some((m) => m.side === SIDE.RED && m.targetId === blue.id);
  }
  assert.ok(firedAtBlue, "the battery should launch at the ship 150 nm away");
  assert.ok(cdb.loadout.TomahawkBlockV < startTlam, "it should expend long-range missiles at that standoff");
});

test("win condition still resolves when a side holds only ground assets", () => {
  const sim = emptyRunningScenario(9);
  placeShip(sim, SIDE.BLUE, -12 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 12 * NM, 0, "EWR"); // red is ground-only and defenceless
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  for (let i = 0; i < 4000 && !sim.ended; i++) stepSim(sim, 0.25);
  assert.equal(sim.ended, SIDE.BLUE);
  assert.equal(sim.mode, SCENARIO_MODE.ENDED);
});
