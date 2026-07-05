import test from "node:test";
import assert from "node:assert/strict";

import {
  NM, MISSILES, SHIP_CLASSES, makeShip, createScenario, clearSide, placeShip, duplicateShip, stepSim,
  SIDE, SCENARIO_MODE, aliveAircraftCount, squadronSize, isAircraft, isAirfield,
  serializeScenario, restoreScenario, missileDetectionEnvelope, shareTracks
} from "../src/sim.js";
import { DEFAULTS } from "../src/mods/schema.js";
import { registerUnit, unregisterUnit, makeUniqueShipId, vanillaUnits, unitId } from "../src/mods/registry.js";
import { airRowHtml, isAirUnit, isGroundUnit } from "../src/ui/view.js";

// The six built-in squadron hulls, replacing the old generic VFA/VFS pair.
// Each has a RIGID default loadout that defines its role: an air-superiority
// airframe carries no strike weapon at all, an anti-ground airframe carries
// AGM-154 JSOW and no AGM-84, an anti-ship airframe carries AGM-84 and no
// JSOW. Two generations (5th-gen low-observable, 4.5-gen non-stealth) cross
// the three roles.
const AIR_SUPERIORITY_HULLS = ["F22", "F15C"];
const ANTI_GROUND_HULLS = ["F35A", "F15E"];
const ANTI_SHIP_HULLS = ["F35C", "F15N"];
const FIFTH_GEN_HULLS = ["F22", "F35A", "F35C"];
const FOURTH_HALF_GEN_HULLS = ["F15E", "F15N", "F15C"];
const ALL_AIRCRAFT_HULLS = [...AIR_SUPERIORITY_HULLS, ...ANTI_GROUND_HULLS, ...ANTI_SHIP_HULLS];

function running(seed = 7) {
  const sim = createScenario(seed);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

test("VFA and VFS no longer exist as ship classes", () => {
  assert.equal(SHIP_CLASSES.VFA, undefined);
  assert.equal(SHIP_CLASSES.VFS, undefined);
});

test("all six aircraft squadron hulls exist with the right shape and airfield (AFB) is unchanged", () => {
  for (const hull of ALL_AIRCRAFT_HULLS) {
    assert.equal(SHIP_CLASSES[hull].domain, "air", `${hull} domain`);
    assert.equal(SHIP_CLASSES[hull].isFixed, false, `${hull} isFixed`);
  }
  assert.equal(SHIP_CLASSES.AFB.isAirfield, true);
  assert.equal(SHIP_CLASSES.AFB.domain, "ground");
});

test("each aircraft hull's vlsCells exactly fits its own default loadout (a genuinely rigid magazine)", () => {
  for (const hull of ALL_AIRCRAFT_HULLS) {
    const cls = SHIP_CLASSES[hull];
    const cells = Object.entries(cls.baseLoadout).reduce(
      (sum, [id, count]) => sum + count * (MISSILES[id]?.cellCost ?? 1),
      0
    );
    assert.equal(cls.vlsCells, cells, `${hull} vlsCells should equal its fixed loadout's cell cost`);
  }
});

test("F-22 and F-15C squadrons are air-to-air only: zero strike weapons of any kind", () => {
  for (const hull of AIR_SUPERIORITY_HULLS) {
    const loadout = SHIP_CLASSES[hull].baseLoadout;
    assert.equal(loadout["AGM-84"] ?? 0, 0, `${hull} should carry no AGM-84`);
    assert.equal(loadout["AGM-154"] ?? 0, 0, `${hull} should carry no AGM-154`);
    assert.ok(((loadout["AIM-120C"] ?? 0) + (loadout["AIM-120D"] ?? 0)) > 0 && (loadout["AIM-9X"] ?? 0) > 0, `${hull} should carry both AAMs`);
  }
});

test("5th-gen aircraft carry AIM-120D while 4.5-gen aircraft carry AIM-120C", () => {
  for (const hull of FIFTH_GEN_HULLS) {
    assert.ok((SHIP_CLASSES[hull].baseLoadout["AIM-120D"] ?? 0) > 0, `${hull} should carry AIM-120D`);
    assert.equal(SHIP_CLASSES[hull].baseLoadout["AIM-120C"] ?? 0, 0, `${hull} should not carry AIM-120C`);
  }
  for (const hull of FOURTH_HALF_GEN_HULLS) {
    assert.ok((SHIP_CLASSES[hull].baseLoadout["AIM-120C"] ?? 0) > 0, `${hull} should carry AIM-120C`);
    assert.equal(SHIP_CLASSES[hull].baseLoadout["AIM-120D"] ?? 0, 0, `${hull} should not carry AIM-120D`);
  }
});

test("F-35A and F-15E squadrons carry the anti-ground JSOW and no anti-ship Harpoon", () => {
  for (const hull of ANTI_GROUND_HULLS) {
    const loadout = SHIP_CLASSES[hull].baseLoadout;
    assert.ok((loadout["AGM-154"] ?? 0) > 0, `${hull} should carry AGM-154`);
    assert.equal(loadout["AGM-84"] ?? 0, 0, `${hull} should carry no AGM-84`);
  }
});

test("F-35C and F-15N squadrons carry the anti-ship Harpoon and no anti-ground JSOW", () => {
  for (const hull of ANTI_SHIP_HULLS) {
    const loadout = SHIP_CLASSES[hull].baseLoadout;
    assert.ok((loadout["AGM-84"] ?? 0) > 0, `${hull} should carry AGM-84`);
    assert.equal(loadout["AGM-154"] ?? 0, 0, `${hull} should carry no AGM-154`);
  }
});

test("5th-gen airframes have a meaningfully smaller radar cross-section than 4.5-gen airframes", () => {
  const maxFifthGenRcs = Math.max(...FIFTH_GEN_HULLS.map((hull) => SHIP_CLASSES[hull].rcsM2));
  const minFourthHalfGenRcs = Math.min(...FOURTH_HALF_GEN_HULLS.map((hull) => SHIP_CLASSES[hull].rcsM2));
  assert.ok(maxFifthGenRcs < minFourthHalfGenRcs / 5, "5th-gen RCS should be far smaller than 4.5-gen RCS");
});

// Polish pass: unit tags follow a Generation x Role scheme (G5/G4 x
// AA/AG/AS), concise class names replace the old "F-22 Raptor Squadron
// (5th-gen air-superiority) approx." style, and every hull within a
// generation shares the same hardpoint count (5th-gen: 8, 4.5-gen: 14) so the
// roster reads as two clean weight classes instead of six ad hoc numbers.
test("aircraft tags/names follow the GxRR scheme and hardpoints are uniform per generation", () => {
  const expectedPrefix = {
    F22: "G5AA", F35A: "G5AG", F35C: "G5AS",
    F15C: "G4AA", F15E: "G4AG", F15N: "G4AS"
  };
  for (const [hull, prefix] of Object.entries(expectedPrefix)) {
    assert.equal(SHIP_CLASSES[hull].prefix, prefix, `${hull} unit tag`);
    assert.ok(!/approx\.$/.test(SHIP_CLASSES[hull].className), `${hull} className should be concise, not a real-airframe name`);
  }
  for (const hull of FIFTH_GEN_HULLS) assert.equal(SHIP_CLASSES[hull].vlsCells, 8, `${hull} 5th-gen hardpoints`);
  const fourthGenHardpoints = new Set(FOURTH_HALF_GEN_HULLS.map((hull) => SHIP_CLASSES[hull].vlsCells));
  assert.equal(fourthGenHardpoints.size, 1, "every 4.5-gen hull should share the same hardpoint count");
});

test("AGM-154 JSOW is a distinct anti-ground stand-off weapon with its own range/speed profile", () => {
  const jsow = MISSILES["AGM-154"];
  const harpoon = MISSILES["AGM-84"];
  assert.ok(jsow, "AGM-154 is registered");
  assert.equal(jsow.category, "anti_ship", "reuses the proven ship/ground engagement pipeline");
  assert.equal(jsow.target, "ship");
  assert.notEqual(jsow.rangeM, harpoon.rangeM, "JSOW should have a distinct range profile from Harpoon");
  assert.ok(jsow.rangeM > harpoon.rangeM, "JSOW's stand-off range should exceed AGM-84's");
});

test("AGM-154 has its own tuned radar detection envelope, distinct from AGM-84's", () => {
  const observer = makeShip(SIDE.BLUE, 0, 0, "DDG");
  const jsowEnvelope = missileDetectionEnvelope(observer, { missileId: "AGM-154", terminal: false });
  const harpoonEnvelope = missileDetectionEnvelope(observer, { missileId: "AGM-84", terminal: false });
  assert.notEqual(jsowEnvelope.targetHeightM, harpoonEnvelope.targetHeightM, "JSOW should not silently copy AGM-84's sea-skim profile");
});

// Regression: every missile now carries a real, distinct rcsM2 (previously
// detection range used a hand-tuned "visibilityFactor" magic number per
// weapon with no relationship to any actual RCS value at all). A tiny WVR
// dogfight missile must have a meaningfully smaller radar-derived visibility
// factor than a much larger long-range cruise missile.
test("every missile has an RCS, and a small AAM is far less radar-visible than a large cruise missile", () => {
  for (const id of Object.keys(MISSILES)) {
    assert.ok(Number.isFinite(MISSILES[id].rcsM2) && MISSILES[id].rcsM2 > 0, `${id} has a positive rcsM2`);
  }
  assert.ok(MISSILES["AIM-9X"].rcsM2 < MISSILES["TomahawkBlockV"].rcsM2 / 10, "AIM-9X RCS should be far smaller than Tomahawk's");
  const observer = makeShip(SIDE.BLUE, 0, 0, "DDG");
  const aim9xEnvelope = missileDetectionEnvelope(observer, { missileId: "AIM-9X", terminal: false });
  const tomahawkEnvelope = missileDetectionEnvelope(observer, { missileId: "TomahawkBlockV", terminal: false });
  assert.ok(aim9xEnvelope.visibilityFactor < tomahawkEnvelope.visibilityFactor, "the smaller munition should have a lower RCS-derived visibility factor");
});

test("a cruising aircraft's own altitude extends its radar horizon (observer side, not just target side)", () => {
  // Regression test: the observer side of the radar-horizon calculation used
  // to call the ship-only mast-height formula directly, ignoring altitude
  // entirely -- so a 9,000m-cruising fighter's look-down range against a
  // sea-skimming missile was capped as if it were sitting at sea level (~19NM)
  // instead of the 200+NM its altitude actually affords. A sea-level ship and
  // a high-flying aircraft should NOT get the same horizon against the same
  // low-flying missile.
  const ship = makeShip(SIDE.BLUE, 0, 0, "DDG");
  const aircraft = makeShip(SIDE.BLUE, 0, 0, "F15C");
  assert.ok(aircraft.altitudeM > 1000, "the aircraft fixture actually cruises high");
  const shipEnvelope = missileDetectionEnvelope(ship, { missileId: "AGM-84", terminal: false });
  const aircraftEnvelope = missileDetectionEnvelope(aircraft, { missileId: "AGM-84", terminal: false });
  assert.ok(
    aircraftEnvelope.horizonM > shipEnvelope.horizonM * 5,
    `a cruising aircraft's horizon (${(aircraftEnvelope.horizonM / NM).toFixed(0)}NM) should be far beyond a sea-level ship's (${(shipEnvelope.horizonM / NM).toFixed(0)}NM) against the same sea-skimming missile`
  );
});

test("a squadron seeds flight state: HP pool == plane count, fuel, mission, snapshot", () => {
  const f15n = makeShip(SIDE.BLUE, 0, 0, "F15N");
  assert.equal(isAircraft(f15n), true);
  assert.equal(squadronSize(f15n), 4);
  assert.equal(aliveAircraftCount(f15n), 4);
  assert.equal(f15n.airState, "mission");
  assert.ok(f15n.fuelS > 0);
  assert.deepEqual(f15n.baseLoadoutSnapshot, f15n.loadout);
});

test("each hit downs exactly one aircraft (attrition)", () => {
  const f15n = makeShip(SIDE.RED, 0, 0, "F15N");
  f15n.damage = 1;
  assert.equal(aliveAircraftCount(f15n), 3);
  f15n.damage = 4;
  assert.equal(aliveAircraftCount(f15n), 0);
});

test("air units and airfields can be placed anywhere; air is not seated to water", () => {
  const sim = running();
  const f15n = placeShip(sim, SIDE.BLUE, -7 * NM, 3 * NM, "F15N");
  const afb = placeShip(sim, SIDE.RED, 9 * NM, 0, "AFB");
  assert.ok(f15n && afb);
  assert.equal(isAircraft(f15n), true);
  assert.equal(isAirfield(afb), true);
  // Placement coordinates are preserved (no water reseat) for the air unit.
  assert.equal(Math.round(f15n.x / NM), -7);
  assert.equal(Math.round(f15n.y / NM), 3);
});

test("a ship shoots down an enemy aircraft (SAM vs platform, attrition)", () => {
  const sim = running(11);
  const ddg = placeShip(sim, SIDE.BLUE, -10 * NM, 0, "DDG");
  // Park the squadron inside the ship's (RCS-limited) detection range and freeze
  // its autonomous routing (nextDecision = Infinity) so this isolates the SAM-
  // vs-aircraft attrition mechanic, not the stand-off strike AI (which would
  // correctly egress out of the SAM envelope — covered by its own tests).
  const f15n = placeShip(sim, SIDE.RED, 28 * NM, 0, "F15N");
  f15n.desiredSpeed = 0; f15n.fuelS = 1e9; f15n.nextDecision = Infinity;
  let downed = false;
  for (let i = 0; i < 2000 && !downed; i++) {
    stepSim(sim, 0.25);
    downed = aliveAircraftCount(f15n) < 4 || !f15n.alive;
  }
  assert.ok(downed, "the SAM ship attrited the enemy squadron");
});

test("an anti-ship squadron strikes an enemy ship with its Harpoon (AGM-84)", () => {
  const sim = running(13);
  const f15n = placeShip(sim, SIDE.BLUE, -40 * NM, 0, "F15N");
  f15n.desiredSpeed = 0; f15n.fuelS = 1e9;
  placeShip(sim, SIDE.RED, 30 * NM, 0, "DDG");
  let fired = false;
  for (let i = 0; i < 1600 && !fired; i++) {
    stepSim(sim, 0.25);
    fired = sim.missiles.some((m) => m.side === SIDE.BLUE && m.missileId === "AGM-84");
  }
  assert.ok(fired, "the squadron launched an anti-ship missile at the ship");
});

test("an anti-ground squadron actually strikes an enemy ground site with its JSOW (AGM-154)", () => {
  const sim = running(13);
  const f35a = placeShip(sim, SIDE.BLUE, -40 * NM, 0, "F35A");
  f35a.desiredSpeed = 0; f35a.fuelS = 1e9;
  // An unarmed EWR isolates "can the squadron release its dedicated anti-ground
  // weapon against a ground-domain target" from "does it survive a SAM's own
  // return fire", which is a separate, already-covered attrition mechanic.
  placeShip(sim, SIDE.RED, 30 * NM, 0, "EWR");
  let fired = false;
  for (let i = 0; i < 1600 && !fired; i++) {
    stepSim(sim, 0.25);
    fired = sim.missiles.some((m) => m.side === SIDE.BLUE && m.missileId === "AGM-154");
  }
  assert.ok(fired, "the squadron launched its anti-ground missile at the ground site");
});

test("RTB → rearm → relaunch refills the magazine and refuels", () => {
  const sim = running();
  placeShip(sim, SIDE.BLUE, -30 * NM, 0, "AFB");
  const f15n = placeShip(sim, SIDE.BLUE, -12 * NM, 0, "F15N");
  // A weaponless RED radar site keeps the scenario runnable without attacking
  // the squadron while it is parked rearming (which would make the test flaky).
  placeShip(sim, SIDE.RED, 80 * NM, 0, "EWR");
  f15n.loadout = {}; f15n.fuelS = 200; // winchester + low fuel -> RTB now
  const states = new Set();
  let relaunched = false;
  for (let i = 0; i < 5000 && !relaunched; i++) {
    stepSim(sim, 0.25);
    if (!f15n.alive) break;
    states.add(f15n.airState);
    relaunched = f15n.airState === "mission" && Object.keys(f15n.loadout).length > 0 && i > 40;
  }
  assert.ok(states.has("rtb"), "entered RTB");
  assert.ok(states.has("rearming"), "parked to rearm");
  assert.ok(relaunched, "relaunched with a refilled magazine");
  assert.deepEqual(f15n.loadout, SHIP_CLASSES.F15N.baseLoadout, "rearmed to the exact built-in default loadout");
  assert.ok(f15n.fuelS > 1000, "refuelled on rearm");
});

test("a squadron will not rearm on a destroyed airfield (diverts instead)", () => {
  const sim = running();
  const afb = placeShip(sim, SIDE.BLUE, -30 * NM, 0, "AFB");
  const f15n = placeShip(sim, SIDE.BLUE, -28 * NM, 0, "F15N"); // already within base reach
  placeShip(sim, SIDE.RED, 80 * NM, 0, "EWR");
  f15n.loadout = {}; f15n.fuelS = 300;
  // Run until it parks to rearm, then destroy the airfield mid-rearm.
  let parked = false;
  for (let i = 0; i < 200 && !parked; i++) { stepSim(sim, 0.25); parked = f15n.airState === "rearming"; }
  assert.ok(parked, "squadron parked to rearm");
  afb.alive = false; // airfield destroyed while the flight is on the ramp
  // It must NOT complete the rearm; with no other base it diverts and splashes.
  let resolved = false;
  for (let i = 0; i < 2000 && !resolved; i++) {
    stepSim(sim, 0.25);
    resolved = !f15n.alive || (f15n.airState === "mission" && Object.keys(f15n.loadout).length > 0);
  }
  assert.ok(!f15n.alive, "did not magically rearm on the crater — diverted and splashed");
  assert.equal(Object.keys(f15n.loadout).length, 0, "magazine was never refilled");
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
  const f15n = placeShip(sim, SIDE.BLUE, 0, 0, "F15N");
  placeShip(sim, SIDE.RED, 80 * NM, 0, "DDG");
  f15n.loadout = {}; f15n.fuelS = 40;
  let splashed = false;
  for (let i = 0; i < 1000 && !splashed; i++) {
    stepSim(sim, 0.25);
    splashed = !f15n.alive;
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

test("vanillaUnits includes all six built-in air squadrons and the airfield", () => {
  const v = vanillaUnits();
  for (const hull of ALL_AIRCRAFT_HULLS) {
    assert.ok(v.some((u) => u.kind === "aircraft" && unitId(u) === hull), `${hull} listed as a vanilla aircraft unit`);
  }
  assert.ok(v.some((u) => u.kind === "ground" && unitId(u) === "AFB" && u.isAirfield === true));
});

test("air inventory row reports flight strength, state and effector counts", () => {
  const f15n = makeShip(SIDE.BLUE, 0, 0, "F15N");
  assert.equal(isAirUnit(f15n), true);
  assert.equal(isGroundUnit(f15n), false);
  const row = airRowHtml(f15n, false);
  assert.match(row, /4\/4/, "shows 4/4 aircraft");
  assert.match(row, /MSN/, "shows mission state");
});

test("aircraft weapons exist with correct categories (AMRAAM/Sidewinder/Harpoon/JSOW)", () => {
  assert.equal(MISSILES["AIM-120C"].category, "air_to_air");
  assert.equal(MISSILES["AIM-120D"].category, "air_to_air");
  assert.equal(MISSILES["AIM-9X"].category, "air_to_air");
  assert.equal(MISSILES["AIM-9X"].guidance, "infrared", "Sidewinder is IR (flare-decoyable)");
  assert.equal(MISSILES["AGM-84"].category, "anti_ship");
  assert.equal(MISSILES["AGM-154"].category, "anti_ship");
  for (const id of ["AIM-120C", "AIM-120D", "AIM-9X", "AGM-84", "AGM-154"]) assert.ok(MISSILES[id].shortLabel.length >= 3, id);
});

// Regression: "anti_air" used to be a single bucket shared by ship-launched
// SAMs (SM-2MR/ESSM) and aircraft-carried AAMs (AIM-120C/D/AIM-9X), so nothing
// stopped a squadron's loadout from containing a ship point-defense round as
// if it were a dogfight weapon. Every air-to-air missile must now declare
// "air" as an eligible launch platform, and no aircraft-only weapon may be
// carried by a ship/ground unit.
test("every air-to-air missile is air-launched only; ship SAMs are not air-launchable", () => {
  for (const id of ["AIM-120C", "AIM-120D", "AIM-9X"]) {
    assert.equal(MISSILES[id].category, "air_to_air");
    assert.deepEqual(MISSILES[id].platforms, ["air"]);
  }
  for (const id of ["SM-2MR", "ESSM"]) {
    assert.equal(MISSILES[id].category, "ship_sam");
    assert.ok(!MISSILES[id].platforms.includes("air"), `${id} must not be air-launchable`);
  }
});

test("the F-15N squadron carries more than 4 AAW and more than 6 ASUW", () => {
  const f15n = makeShip(SIDE.BLUE, 0, 0, "F15N");
  let aaw = 0;
  let asuw = 0;
  for (const [id, n] of Object.entries(f15n.loadout)) {
    if (MISSILES[id].category === "anti_ship") asuw += n; else aaw += n;
  }
  assert.ok(aaw > 4, `AAW ${aaw} > 4`);
  assert.ok(asuw > 6, `ASUW ${asuw} > 6`);
});

test("two squadrons fight air-to-air with AAMs and attrit each other", () => {
  const sim = running(7);
  const b = placeShip(sim, SIDE.BLUE, -25 * NM, 0, "F15C"); b.fuelS = 1e9;
  const r = placeShip(sim, SIDE.RED, 25 * NM, 0, "F15C"); r.fuelS = 1e9;
  let firedAAM = false;
  for (let i = 0; i < 1800; i++) {
    stepSim(sim, 0.25);
    if (sim.missiles.some((mm) => mm.missileId === "AIM-120C" || mm.missileId === "AIM-120D" || mm.missileId === "AIM-9X")) firedAAM = true;
  }
  assert.ok(firedAAM, "air-to-air missiles were launched");
  assert.ok(aliveAircraftCount(b) < 4 || aliveAircraftCount(r) < 4, "at least one flight took losses");
});

// Regression: the CAP/orbit fallback (and the fleet-command threat axis it
// reads) used to hardcode "BLUE's enemy is east, RED's enemy is west" — the
// canonical default-scenario layout, but not a real invariant. Any pair of
// squadrons placed the other way around (or any pure-air fight with no
// surface OTC at all) had both flights screen AWAY from each other forever:
// they never closed inside RCS-limited detection range, so radar never
// triggered and no shot was ever fired, no matter how close the user placed
// them. The fix reads each side's actual whole-fleet position to derive the
// default threat axis instead of a fixed compass heading.
test("two squadrons placed in the REVERSED (blue-east, red-west) layout still close and fight, not fly apart", () => {
  const sim = running(11);
  const b = placeShip(sim, SIDE.BLUE, 10 * NM, 0, "F15C"); b.fuelS = 1e9;
  const r = placeShip(sim, SIDE.RED, -10 * NM, 0, "F15C"); r.fuelS = 1e9;
  let firedAAM = false;
  let minSepM = Infinity;
  for (let i = 0; i < 1200; i++) {
    stepSim(sim, 0.25);
    if (sim.missiles.some((mm) => mm.missileId === "AIM-120C" || mm.missileId === "AIM-120D" || mm.missileId === "AIM-9X")) firedAAM = true;
    minSepM = Math.min(minSepM, Math.hypot(b.x - r.x, b.y - r.y));
    if (firedAAM) break;
  }
  assert.ok(firedAAM, "air-to-air missiles were launched despite the reversed layout");
  assert.ok(minSepM < 20 * NM, "the flights closed to within detection/engagement range instead of diverging");
});

test("a squadron breaks evasively when a missile closes in", () => {
  const sim = running(7);
  placeShip(sim, SIDE.BLUE, -10 * NM, 0, "CCG");
  // Hold the flight inside the cruiser's detection range and freeze its routing
  // so the test exercises the evasive-break reaction, not the stand-off AI. A
  // non-stealth (high-RCS) hull is deliberately used so detection at this
  // range is not itself the bottleneck being tested.
  const r = placeShip(sim, SIDE.RED, 28 * NM, 0, "F15E");
  r.fuelS = 1e9; r.desiredSpeed = 0; r.nextDecision = Infinity;
  let broke = false;
  for (let i = 0; i < 1600 && !broke; i++) {
    stepSim(sim, 0.25);
    broke = r.evading === true || sim.events.some((e) => /breaks hard/.test(e.text));
  }
  assert.ok(broke, "the flight performed an evasive break");
});

// Regression: the evasive break previously only turned the flight sideways —
// it never touched targetAltitudeM at all, so a "defensive break" never
// actually dived, contrary to real BVR/WVR doctrine which pairs the beam/notch
// with a hard descent and afterburner (see updateAircraft in aircraft.js).
test("an evasive break dives and goes to afterburner, not just a lateral turn", () => {
  const sim = running(7);
  placeShip(sim, SIDE.BLUE, -10 * NM, 0, "CCG");
  const r = placeShip(sim, SIDE.RED, 28 * NM, 0, "F15E");
  r.fuelS = 1e9; r.desiredSpeed = 0; r.nextDecision = Infinity;
  let minAltitudeWhileEvading = Infinity;
  let sawAfterburner = false;
  for (let i = 0; i < 1600; i++) {
    stepSim(sim, 0.25);
    if (r.evading) {
      minAltitudeWhileEvading = Math.min(minAltitudeWhileEvading, r.altitudeM);
      sawAfterburner = sawAfterburner || r.afterburner === true;
    }
  }
  assert.ok(minAltitudeWhileEvading < 9000, "the flight actually descended during the break, not just turned");
  assert.ok(sawAfterburner, "the flight engaged afterburner during the break");
});

test("flares are expended defending against infrared missiles", () => {
  const sim = running(7);
  // Start inside WVR range so the infrared (Sidewinder) phase actually occurs —
  // at long range it is a radar BVR (AMRAAM) fight where flares do not apply.
  const b = placeShip(sim, SIDE.BLUE, -4 * NM, 0, "F35A"); b.fuelS = 1e9;
  const r = placeShip(sim, SIDE.RED, 4 * NM, 0, "F35A"); r.fuelS = 1e9;
  for (let i = 0; i < 1800; i++) stepSim(sim, 0.25);
  // Sidewinders (IR) reaching a breaking flight consume flares from its pool.
  assert.ok((b.flares < b.flaresMax) || (r.flares < r.flaresMax), "a flight popped flares");
});

test("aircraft are hard targets: downing a flight costs many SAM shots", () => {
  const sim = running(7);
  placeShip(sim, SIDE.BLUE, -10 * NM, 0, "CCG");
  // Non-stealth hull deliberately: it must actually get detected and engaged
  // for "SAMs fired should exceed kills" to be a meaningful assertion rather
  // than a vacuous pass from never being detected in the first place.
  const r = placeShip(sim, SIDE.RED, 35 * NM, 0, "F15E"); r.fuelS = 1e9; r.desiredSpeed = 0;
  for (let i = 0; i < 2600; i++) stepSim(sim, 0.25);
  const sams = sim.events.filter((e) => /launched SM/.test(e.text)).length;
  const lost = 4 - aliveAircraftCount(r);
  // Evasion + small/fast target means well under one kill per interceptor.
  assert.ok(lost === 0 || sams > lost, `SAMs ${sams} should exceed kills ${lost} (low single-shot Pk)`);
});

test("a striker returns to base once its anti-ship load is spent", () => {
  const sim = running();
  placeShip(sim, SIDE.BLUE, -40 * NM, 0, "AFB");
  const v = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "F35C");
  placeShip(sim, SIDE.RED, 80 * NM, 0, "EWR");
  v.loadout = { "AIM-120D": 4 }; // air-to-air left, strike (AGM-84) depleted
  let rtb = false;
  for (let i = 0; i < 200 && !rtb; i++) { stepSim(sim, 0.25); rtb = v.airState === "rtb" || v.airState === "rearming"; }
  assert.ok(rtb, "striker headed home with strike ammo spent");
});

test("a CAP fighter hard-kills an inbound ASCM but keeps an air-to-air reserve", () => {
  const sim = running(7);
  placeShip(sim, SIDE.BLUE, -10 * NM, 0, "DDG");
  const cap = placeShip(sim, SIDE.BLUE, 5 * NM, 0, "F15C"); cap.fuelS = 1e9;
  placeShip(sim, SIDE.RED, 30 * NM, 0, "CDB"); // fires anti-ship missiles
  let firedAtMissile = false;
  for (let i = 0; i < 2000 && !firedAtMissile; i++) {
    stepSim(sim, 0.25);
    firedAtMissile = sim.missiles.some((mm) => mm.side === SIDE.BLUE && mm.launcherId === cap.id && String(mm.targetId).startsWith("M-"));
  }
  assert.ok(firedAtMissile, "the fighter engaged an inbound anti-ship missile with an AAM");
  // It must not have stripped its air-to-air load: a heavy reserve of the radar
  // AAM remains (started at 8; conservative defence keeps most of it).
  assert.ok((cap.loadout["AIM-120C"] ?? 0) >= 5, `kept an AAM reserve (${cap.loadout["AIM-120C"]} of 10)`);
});

test("a full flight relaunches faster than a lone survivor (rate scales with aircraft)", () => {
  const launchTimes = (planes) => {
    const sim = running(7);
    const v = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "F15N"); v.fuelS = 1e9; v.desiredSpeed = 0;
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
  for (const id of ["AIM-120C", "AIM-120D", "AIM-9X"]) {
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
  assert.ok(!detects("F15C", 120), "an aircraft flight is NOT seen at that range (small RCS)");
  assert.ok(detects("F15C", 25), "the aircraft flight is detected once it closes in");
});

test("aircraft fly high and have a small RCS; ships sit at sea level with a large RCS", () => {
  const ddg = makeShip(SIDE.BLUE, 0, 0, "DDG");
  const f15c = makeShip(SIDE.BLUE, 0, 0, "F15C");
  assert.equal(ddg.altitudeM, 0);
  assert.ok(f15c.altitudeM > 1000, "aircraft cruise high");
  assert.ok(f15c.rcsM2 < ddg.rcsM2 / 100, "aircraft RCS far smaller than a ship");
});

test("a scenario with air units is deterministic for the same seed", () => {
  const build = (seed) => {
    const sim = createScenario(seed);
    clearSide(sim, SIDE.BLUE); clearSide(sim, SIDE.RED);
    placeShip(sim, SIDE.BLUE, -40 * NM, 0, "F15N");
    placeShip(sim, SIDE.BLUE, -30 * NM, 5 * NM, "DDG");
    placeShip(sim, SIDE.RED, 35 * NM, 0, "F15N");
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

test("AWAC squadron exists as an unarmed, command-hub-capable, longest-ranged sensor asset", () => {
  const cls = SHIP_CLASSES.AWAC;
  assert.equal(cls.domain, "air");
  assert.equal(cls.isFixed, false);
  assert.equal(cls.commandHub, true);
  assert.deepEqual(cls.baseLoadout, {});
  assert.equal(cls.vlsCells, 0);
  for (const hull of ALL_AIRCRAFT_HULLS) {
    assert.ok(cls.radarRangeNm >= SHIP_CLASSES[hull].radarRangeNm, `AWAC radar should reach at least as far as ${hull}'s`);
  }
  const awac = makeShip(SIDE.BLUE, 0, 0, "AWAC");
  assert.equal(isAircraft(awac), true);
  assert.equal(awac.commandHub, true);
  assert.deepEqual(awac.loadout, {});
});

test("an unarmed AWAC never enters combat and orbits behind the formation guide, not ahead of it (regression: 'winchester' RTB loop)", () => {
  // A squadron with an empty base loadout used to read as permanently
  // "winchester" (zero weapons == magazine spent), so it RTB'd on its very
  // first decision tick, parked to rearm into the same empty magazine, and
  // immediately RTB'd again -- a park-forever loop that never let it fly its
  // actual station-keeping mission. See the `everCarriesWeapons` gate in
  // aircraft.js.
  const sim = running(3);
  placeShip(sim, SIDE.BLUE, -30 * NM, 0, "AFB");
  const otc = placeShip(sim, SIDE.BLUE, -15 * NM, 0, "DDG"); otc.desiredSpeed = 0;
  const awac = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "AWAC");
  // Weaponless RED radar site: gives the AWAC something to fuse into a threat
  // axis without ever threatening it, isolating the AI-geometry question from
  // survivability (already covered elsewhere).
  placeShip(sim, SIDE.RED, 40 * NM, 0, "EWR");
  const phases = new Set();
  const airStates = new Set();
  for (let i = 0; i < 400; i++) {
    stepSim(sim, 0.25);
    airStates.add(awac.airState);
    if (awac._phase) phases.add(awac._phase);
  }
  assert.ok(awac.alive, "the AWAC survived (nothing on the RED side can shoot at it)");
  assert.deepEqual([...airStates], ["mission"], "stayed on mission the whole run instead of looping through RTB");
  assert.deepEqual([...phases], ["orbit"], "held the unarmed support-orbit phase, never a combat or CAP phase");
  assert.equal(sim.missiles.some((m) => m.launcherId === awac.id), false, "never launched a weapon it doesn't carry");
  // The RED contact sits east of the BLUE OTC, so the threat axis points east;
  // an unarmed asset orbits on the opposite (west) side of the guide, unlike
  // an armed CAP fighter which would screen ahead toward the threat.
  assert.ok(awac.waypoint.x < otc.x, "orbits on the side of the formation guide away from the threat axis");
});

test("an AWAC still RTBs and refuels on low fuel, even though it never runs out of ammo", () => {
  const sim = running(3);
  placeShip(sim, SIDE.BLUE, -30 * NM, 0, "AFB");
  const awac = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "AWAC");
  placeShip(sim, SIDE.RED, 80 * NM, 0, "EWR");
  awac.fuelS = 200; // force a near-immediate bingo-fuel call
  const states = new Set();
  let refueled = false;
  for (let i = 0; i < 3000 && !refueled; i++) {
    stepSim(sim, 0.25);
    states.add(awac.airState);
    refueled = awac.airState === "mission" && awac.fuelS > 1000;
  }
  assert.ok(states.has("rtb"), "low fuel sent it home");
  assert.ok(states.has("rearming"), "it actually parked to refuel");
  assert.ok(refueled, "topped off and resumed its mission (not stuck parked forever)");
});

test("an alive, on-mission command-hub unit tightens its side's CEC track-sharing latency", () => {
  const buildFixture = (hubShip) => {
    const sim = { time: 10, ships: [] };
    const sourceTrack = { side: SIDE.BLUE, x: 0, y: 0, vx: 0, vy: 0, quality: 0.8, age: 0, uncertainty: 100, lastSeen: 9, _stateTime: 9 };
    const source = { alive: true, side: SIDE.RED, tracks: new Map([["B-1", sourceTrack]]) };
    const relay = { alive: true, side: SIDE.RED, tracks: new Map() };
    sim.ships.push(source, relay);
    if (hubShip) sim.ships.push(hubShip);
    return sim;
  };
  const sharedAfter = (sim) => {
    shareTracks(sim);
    return sim.sharedTracksBySide?.get(SIDE.RED)?.has("B-1") ?? false;
  };
  // Baseline latency (1.8s) is not yet satisfied by a 1.0s-old track.
  assert.equal(sharedAfter(buildFixture(null)), false, "no command hub: a 1.0s-old track hasn't cleared the 1.8s baseline latency yet");
  // An alive, on-mission command hub tightens latency to 0.6s, which a 1.0s-old track clears.
  const hub = { alive: true, side: SIDE.RED, domain: "air", airState: "mission", commandHub: true, tracks: new Map() };
  assert.equal(sharedAfter(buildFixture(hub)), true, "an active command hub shares the same-age track immediately");
  // A command-hub aircraft that is down for fuel/rearm does not count as active.
  const grounded = { alive: true, side: SIDE.RED, domain: "air", airState: "rearming", commandHub: true, tracks: new Map() };
  assert.equal(sharedAfter(buildFixture(grounded)), false, "a command hub parked to rearm does not tighten latency");
});
