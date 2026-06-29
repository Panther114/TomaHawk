import test from "node:test";
import assert from "node:assert/strict";

import {
  NM, SHIP_CLASSES, makeShip, createScenario, clearSide, placeShip, duplicateShip, stepSim,
  SIDE, SCENARIO_MODE, aliveAircraftCount, squadronSize, isAircraft, isAirfield,
  serializeScenario, restoreScenario
} from "../src/sim.js";
import { DEFAULTS } from "../src/mods/schema.js";
import { registerUnit, unregisterUnit, makeUniqueShipId, vanillaUnits, unitId } from "../src/mods/registry.js";
import { airRowHtml, isAirUnit, isGroundUnit } from "../src/ui/view.js";

function running(seed = 7) {
  const sim = createScenario(seed);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

test("built-in air squadron (VFA) and airfield (AFB) exist with the right shape", () => {
  assert.equal(SHIP_CLASSES.VFA.domain, "air");
  assert.equal(SHIP_CLASSES.VFA.isFixed, false);
  assert.equal(SHIP_CLASSES.AFB.isAirfield, true);
  assert.equal(SHIP_CLASSES.AFB.domain, "ground");
});

test("a squadron seeds flight state: HP pool == plane count, fuel, mission, snapshot", () => {
  const vfa = makeShip(SIDE.BLUE, 0, 0, "VFA");
  assert.equal(isAircraft(vfa), true);
  assert.equal(squadronSize(vfa), 4);
  assert.equal(aliveAircraftCount(vfa), 4);
  assert.equal(vfa.airState, "mission");
  assert.ok(vfa.fuelS > 0);
  assert.deepEqual(vfa.baseLoadoutSnapshot, vfa.loadout);
});

test("each hit downs exactly one aircraft (attrition)", () => {
  const vfa = makeShip(SIDE.RED, 0, 0, "VFA");
  vfa.damage = 1;
  assert.equal(aliveAircraftCount(vfa), 3);
  vfa.damage = 4;
  assert.equal(aliveAircraftCount(vfa), 0);
});

test("air units and airfields can be placed anywhere; air is not seated to water", () => {
  const sim = running();
  const vfa = placeShip(sim, SIDE.BLUE, -7 * NM, 3 * NM, "VFA");
  const afb = placeShip(sim, SIDE.RED, 9 * NM, 0, "AFB");
  assert.ok(vfa && afb);
  assert.equal(isAircraft(vfa), true);
  assert.equal(isAirfield(afb), true);
  // Placement coordinates are preserved (no water reseat) for the air unit.
  assert.equal(Math.round(vfa.x / NM), -7);
  assert.equal(Math.round(vfa.y / NM), 3);
});

test("a ship shoots down an enemy aircraft (SAM vs platform, attrition)", () => {
  const sim = running(11);
  const ddg = placeShip(sim, SIDE.BLUE, -10 * NM, 0, "DDG");
  const vfa = placeShip(sim, SIDE.RED, 40 * NM, 0, "VFA");
  vfa.desiredSpeed = 0; vfa.fuelS = 1e9; // hold station, no fuel splash
  let downed = false;
  for (let i = 0; i < 2000 && !downed; i++) {
    stepSim(sim, 0.25);
    downed = aliveAircraftCount(vfa) < 4 || !vfa.alive;
  }
  assert.ok(downed, "the SAM ship attrited the enemy squadron");
});

test("an aircraft squadron strikes an enemy ship with anti-ship missiles", () => {
  const sim = running(13);
  const vfa = placeShip(sim, SIDE.BLUE, -40 * NM, 0, "VFA");
  vfa.desiredSpeed = 0; vfa.fuelS = 1e9;
  placeShip(sim, SIDE.RED, 30 * NM, 0, "DDG");
  let fired = false;
  for (let i = 0; i < 1600 && !fired; i++) {
    stepSim(sim, 0.25);
    fired = sim.missiles.some((m) => m.side === SIDE.BLUE && m.missileId === "MaritimeStrike");
  }
  assert.ok(fired, "the squadron launched an anti-ship missile at the ship");
});

test("RTB → rearm → relaunch refills the magazine and refuels", () => {
  const sim = running();
  placeShip(sim, SIDE.BLUE, -30 * NM, 0, "AFB");
  const vfa = placeShip(sim, SIDE.BLUE, -12 * NM, 0, "VFA");
  // A weaponless RED radar site keeps the scenario runnable without attacking
  // the squadron while it is parked rearming (which would make the test flaky).
  placeShip(sim, SIDE.RED, 80 * NM, 0, "EWR");
  vfa.loadout = {}; vfa.fuelS = 200; // winchester + low fuel -> RTB now
  const states = new Set();
  let relaunched = false;
  for (let i = 0; i < 5000 && !relaunched; i++) {
    stepSim(sim, 0.25);
    if (!vfa.alive) break;
    states.add(vfa.airState);
    relaunched = vfa.airState === "mission" && Object.keys(vfa.loadout).length > 0 && i > 40;
  }
  assert.ok(states.has("rtb"), "entered RTB");
  assert.ok(states.has("rearming"), "parked to rearm");
  assert.ok(relaunched, "relaunched with a refilled magazine");
  assert.ok(vfa.fuelS > 1000, "refuelled on rearm");
});

test("a squadron will not rearm on a destroyed airfield (diverts instead)", () => {
  const sim = running();
  const afb = placeShip(sim, SIDE.BLUE, -30 * NM, 0, "AFB");
  const vfa = placeShip(sim, SIDE.BLUE, -28 * NM, 0, "VFA"); // already within base reach
  placeShip(sim, SIDE.RED, 80 * NM, 0, "EWR");
  vfa.loadout = {}; vfa.fuelS = 300;
  // Run until it parks to rearm, then destroy the airfield mid-rearm.
  let parked = false;
  for (let i = 0; i < 200 && !parked; i++) { stepSim(sim, 0.25); parked = vfa.airState === "rearming"; }
  assert.ok(parked, "squadron parked to rearm");
  afb.alive = false; // airfield destroyed while the flight is on the ramp
  // It must NOT complete the rearm; with no other base it diverts and splashes.
  let resolved = false;
  for (let i = 0; i < 2000 && !resolved; i++) {
    stepSim(sim, 0.25);
    resolved = !vfa.alive || (vfa.airState === "mission" && Object.keys(vfa.loadout).length > 0);
  }
  assert.ok(!vfa.alive, "did not magically rearm on the crater — diverted and splashed");
  assert.equal(Object.keys(vfa.loadout).length, 0, "magazine was never refilled");
});

test("a duplicated airfield stays a valid airfield at its offset", () => {
  const sim = running();
  const afb = placeShip(sim, SIDE.BLUE, 0, 0, "AFB");
  const dup = duplicateShip(sim, afb.id);
  assert.ok(dup, "duplicate produced");
  assert.equal(isAirfield(dup), true);
  assert.notEqual(dup.id, afb.id);
});

test("a winchester squadron with no airfield splashes when fuel runs out", () => {
  const sim = running();
  const vfa = placeShip(sim, SIDE.BLUE, 0, 0, "VFA");
  placeShip(sim, SIDE.RED, 80 * NM, 0, "DDG");
  vfa.loadout = {}; vfa.fuelS = 40;
  let splashed = false;
  for (let i = 0; i < 1000 && !splashed; i++) {
    stepSim(sim, 0.25);
    splashed = !vfa.alive;
  }
  assert.ok(splashed, "ran out of fuel and was removed");
  assert.ok(sim.events.some((e) => /splashed/.test(e.text)), "logged a splash event");
});

test("a custom aircraft squadron registers, spawns, and unregisters", () => {
  const unit = { ...DEFAULTS.aircraft(), name: "Test Wing", prefix: "TWG", squadronSize: 6 };
  unit.id = makeUniqueShipId(unit.prefix);
  registerUnit(unit);
  assert.ok(SHIP_CLASSES[unit.id], "registered into SHIP_CLASSES");
  const ship = makeShip(SIDE.BLUE, 0, 0, unit.id);
  assert.equal(ship.domain, "air");
  assert.equal(squadronSize(ship), 6, "squadron size maps to HP pool");
  assert.equal(unregisterUnit(unit), true);
});

test("a custom airfield (ground + isAirfield) can be placed on water", () => {
  const unit = { ...DEFAULTS.ground(), name: "Sea Base", prefix: "SEB", isAirfield: true, glyph: "airfield" };
  unit.id = makeUniqueShipId(unit.prefix);
  registerUnit(unit);
  const sim = running();
  // openSea map: every point is water; an airfield must still place there.
  const base = placeShip(sim, SIDE.BLUE, 0, 0, unit.id);
  assert.ok(base, "airfield placed on water");
  assert.equal(isAirfield(base), true);
  unregisterUnit(unit);
});

test("vanillaUnits includes the built-in air squadron and airfield", () => {
  const v = vanillaUnits();
  assert.ok(v.some((u) => u.kind === "aircraft" && unitId(u) === "VFA"));
  assert.ok(v.some((u) => u.kind === "ground" && unitId(u) === "AFB" && u.isAirfield === true));
});

test("air inventory row reports flight strength, state and effector counts", () => {
  const vfa = makeShip(SIDE.BLUE, 0, 0, "VFA");
  assert.equal(isAirUnit(vfa), true);
  assert.equal(isGroundUnit(vfa), false);
  const row = airRowHtml(vfa, false);
  assert.match(row, /4\/4/, "shows 4/4 aircraft");
  assert.match(row, /MSN/, "shows mission state");
});

test("a scenario with air units is deterministic for the same seed", () => {
  const build = (seed) => {
    const sim = createScenario(seed);
    clearSide(sim, SIDE.BLUE); clearSide(sim, SIDE.RED);
    placeShip(sim, SIDE.BLUE, -40 * NM, 0, "VFA");
    placeShip(sim, SIDE.BLUE, -30 * NM, 5 * NM, "DDG");
    placeShip(sim, SIDE.RED, 35 * NM, 0, "VFA");
    placeShip(sim, SIDE.RED, 30 * NM, -5 * NM, "DDG");
    sim.mode = SCENARIO_MODE.RUNNING; sim.paused = false;
    return sim;
  };
  const digest = (s) => s.events.map((e) => `${e.t.toFixed(2)}|${e.side}|${e.text}`).join("\n");
  const a = build(5);
  const b = build(5);
  for (let i = 0; i < 1500; i++) { stepSim(a, 0.25); stepSim(b, 0.25); }
  assert.equal(digest(a), digest(b));
});
