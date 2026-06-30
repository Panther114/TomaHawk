import test from "node:test";
import assert from "node:assert/strict";

import {
  NM, MISSILES, SHIP_CLASSES, makeShip, createScenario, clearSide, placeShip, duplicateShip, stepSim,
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
  // Park the squadron inside the ship's (RCS-limited) detection range and freeze
  // its autonomous routing (nextDecision = Infinity) so this isolates the SAM-
  // vs-aircraft attrition mechanic, not the stand-off strike AI (which would
  // correctly egress out of the SAM envelope — covered by its own tests).
  const vfa = placeShip(sim, SIDE.RED, 28 * NM, 0, "VFA");
  vfa.desiredSpeed = 0; vfa.fuelS = 1e9; vfa.nextDecision = Infinity;
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
    fired = sim.missiles.some((m) => m.side === SIDE.BLUE && m.missileId === "AGM-84");
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

test("aircraft weapons exist with correct categories (AMRAAM/Sidewinder/Harpoon)", () => {
  assert.equal(MISSILES["AIM-120"].category, "anti_air");
  assert.equal(MISSILES["AIM-9X"].category, "anti_air");
  assert.equal(MISSILES["AIM-9X"].guidance, "infrared", "Sidewinder is IR (flare-decoyable)");
  assert.equal(MISSILES["AGM-84"].category, "anti_ship");
  for (const id of ["AIM-120", "AIM-9X", "AGM-84"]) assert.ok(MISSILES[id].shortLabel.length >= 3, id);
});

test("the F/A-18 squadron carries more than 4 AAW and more than 6 ASUW", () => {
  const vfa = makeShip(SIDE.BLUE, 0, 0, "VFA");
  let aaw = 0;
  let asuw = 0;
  for (const [id, n] of Object.entries(vfa.loadout)) {
    if (MISSILES[id].category === "anti_ship") asuw += n; else aaw += n;
  }
  assert.ok(aaw > 4, `AAW ${aaw} > 4`);
  assert.ok(asuw > 6, `ASUW ${asuw} > 6`);
});

test("two squadrons fight air-to-air with AAMs and attrit each other", () => {
  const sim = running(7);
  const b = placeShip(sim, SIDE.BLUE, -25 * NM, 0, "VFA"); b.fuelS = 1e9;
  const r = placeShip(sim, SIDE.RED, 25 * NM, 0, "VFA"); r.fuelS = 1e9;
  let firedAAM = false;
  for (let i = 0; i < 1800; i++) {
    stepSim(sim, 0.25);
    if (sim.missiles.some((mm) => mm.missileId === "AIM-120" || mm.missileId === "AIM-9X")) firedAAM = true;
  }
  assert.ok(firedAAM, "air-to-air missiles were launched");
  assert.ok(aliveAircraftCount(b) < 4 || aliveAircraftCount(r) < 4, "at least one flight took losses");
});

test("a squadron breaks evasively when a missile closes in", () => {
  const sim = running(7);
  placeShip(sim, SIDE.BLUE, -10 * NM, 0, "CCG");
  // Hold the flight inside the cruiser's detection range and freeze its routing
  // so the test exercises the evasive-break reaction, not the stand-off AI.
  const r = placeShip(sim, SIDE.RED, 28 * NM, 0, "VFA");
  r.fuelS = 1e9; r.desiredSpeed = 0; r.nextDecision = Infinity;
  let broke = false;
  for (let i = 0; i < 1600 && !broke; i++) {
    stepSim(sim, 0.25);
    broke = r.evading === true || sim.events.some((e) => /breaks hard/.test(e.text));
  }
  assert.ok(broke, "the flight performed an evasive break");
});

test("flares are expended defending against infrared missiles", () => {
  const sim = running(7);
  // Start inside WVR range so the infrared (Sidewinder) phase actually occurs —
  // at long range it is a radar BVR (AMRAAM) fight where flares do not apply.
  const b = placeShip(sim, SIDE.BLUE, -4 * NM, 0, "VFA"); b.fuelS = 1e9;
  const r = placeShip(sim, SIDE.RED, 4 * NM, 0, "VFA"); r.fuelS = 1e9;
  for (let i = 0; i < 1800; i++) stepSim(sim, 0.25);
  // Sidewinders (IR) reaching a breaking flight consume flares from its pool.
  assert.ok((b.flares < b.flaresMax) || (r.flares < r.flaresMax), "a flight popped flares");
});

test("aircraft are hard targets: downing a flight costs many SAM shots", () => {
  const sim = running(7);
  placeShip(sim, SIDE.BLUE, -10 * NM, 0, "CCG");
  const r = placeShip(sim, SIDE.RED, 35 * NM, 0, "VFA"); r.fuelS = 1e9; r.desiredSpeed = 0;
  for (let i = 0; i < 2600; i++) stepSim(sim, 0.25);
  const sams = sim.events.filter((e) => /launched SM/.test(e.text)).length;
  const lost = 4 - aliveAircraftCount(r);
  // Evasion + small/fast target means well under one kill per interceptor.
  assert.ok(lost === 0 || sams > lost, `SAMs ${sams} should exceed kills ${lost} (low single-shot Pk)`);
});

test("a striker returns to base once its anti-ship load is spent", () => {
  const sim = running();
  placeShip(sim, SIDE.BLUE, -40 * NM, 0, "AFB");
  const v = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "VFA");
  placeShip(sim, SIDE.RED, 80 * NM, 0, "EWR");
  v.loadout = { "AIM-120": 4 }; // air-to-air left, strike (AGM-84) depleted
  let rtb = false;
  for (let i = 0; i < 200 && !rtb; i++) { stepSim(sim, 0.25); rtb = v.airState === "rtb" || v.airState === "rearming"; }
  assert.ok(rtb, "striker headed home with strike ammo spent");
});

test("a CAP fighter hard-kills an inbound ASCM but keeps an air-to-air reserve", () => {
  const sim = running(7);
  placeShip(sim, SIDE.BLUE, -10 * NM, 0, "DDG");
  const cap = placeShip(sim, SIDE.BLUE, 5 * NM, 0, "VFA"); cap.fuelS = 1e9;
  placeShip(sim, SIDE.RED, 30 * NM, 0, "CDB"); // fires anti-ship missiles
  let firedAtMissile = false;
  for (let i = 0; i < 2000 && !firedAtMissile; i++) {
    stepSim(sim, 0.25);
    firedAtMissile = sim.missiles.some((mm) => mm.side === SIDE.BLUE && mm.launcherId === cap.id && String(mm.targetId).startsWith("M-"));
  }
  assert.ok(firedAtMissile, "the fighter engaged an inbound anti-ship missile with an AAM");
  // It must not have stripped its air-to-air load: a heavy reserve of the radar
  // AAM remains (started at 8; conservative defence keeps most of it).
  assert.ok((cap.loadout["AIM-120"] ?? 0) >= 5, `kept an AAM reserve (${cap.loadout["AIM-120"]} of 8)`);
});

test("a full flight relaunches faster than a lone survivor (rate scales with aircraft)", () => {
  const launchTimes = (planes) => {
    const sim = running(7);
    const v = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "VFA"); v.fuelS = 1e9; v.desiredSpeed = 0;
    v.damage = 4 - planes;
    placeShip(sim, SIDE.RED, 20 * NM, 0, "BBG");
    placeShip(sim, SIDE.RED, 22 * NM, 4 * NM, "BBG");
    const times = [];
    for (let i = 0; i < 400; i++) {
      const before = sim.missiles.length;
      stepSim(sim, 0.25);
      for (let k = before; k < sim.missiles.length; k++) if (sim.missiles[k].launcherId === v.id) times.push(sim.time);
    }
    let minGap = Infinity;
    for (let i = 1; i < times.length; i++) { const g = times[i] - times[i - 1]; if (g > 0.01) minGap = Math.min(minGap, g); }
    return minGap;
  };
  const four = launchTimes(4);
  const one = launchTimes(1);
  assert.ok(four < one, `4-plane min gap ${four}s < 1-plane min gap ${one}s`);
});

test("air-to-air missiles carry a customizable no-escape-zone fraction", () => {
  for (const id of ["AIM-120", "AIM-9X"]) {
    const nez = MISSILES[id].nezFraction;
    assert.ok(Number.isFinite(nez) && nez > 0 && nez <= 1, `${id} nezFraction in (0,1]`);
  }
});

test("low-RCS aircraft are detected far closer than ships (RCS-based radar)", () => {
  const detects = (targetHull, rangeNm) => {
    const sim = running(7);
    const obs = placeShip(sim, SIDE.BLUE, 0, 0, "DDG"); obs.desiredSpeed = 0;
    const tgt = placeShip(sim, SIDE.RED, rangeNm * NM, 0, targetHull);
    if (tgt.fuelS !== undefined) { tgt.fuelS = 1e9; tgt.desiredSpeed = 0; }
    for (let i = 0; i < 160; i++) { stepSim(sim, 0.25); if (obs.tracks.has(tgt.id)) return true; }
    return false;
  };
  assert.ok(detects("DDG", 120), "a ship is detected at long range");
  assert.ok(!detects("VFA", 120), "an aircraft flight is NOT seen at that range (small RCS)");
  assert.ok(detects("VFA", 25), "the aircraft flight is detected once it closes in");
});

test("aircraft fly high and have a small RCS; ships sit at sea level with a large RCS", () => {
  const ddg = makeShip(SIDE.BLUE, 0, 0, "DDG");
  const vfa = makeShip(SIDE.BLUE, 0, 0, "VFA");
  assert.equal(ddg.altitudeM, 0);
  assert.ok(vfa.altitudeM > 1000, "aircraft cruise high");
  assert.ok(vfa.rcsM2 < ddg.rcsM2 / 100, "aircraft RCS far smaller than a ship");
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
