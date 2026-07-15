import test from "node:test";
import assert from "node:assert/strict";

import {
  NM, SIDE, SCENARIO_MODE, SHIP_CLASSES, MISSILES,
  createScenario, clearSide, placeShip, stepSim, makeShip,
  isAirfield, isCarrier, isAircraft, canRecoverAtBase,
  serializeScenario, restoreScenario, usedCells
} from "../src/sim.js";

function running(seed = 21) {
  const sim = createScenario(seed, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  // Both sides required for stepSim to leave SETUP/pause gate.
  placeShip(sim, SIDE.RED, 90 * NM, 0, "EWR");
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

test("CVN exists as a sea-domain moving airfield with self-defence magazine", () => {
  const cls = SHIP_CLASSES.CVN;
  assert.ok(cls, "CVN class registered");
  assert.equal(cls.domain, "sea");
  assert.equal(cls.isFixed, false);
  assert.equal(cls.isAirfield, true);
  assert.equal(cls.isCarrier, true);
  assert.ok(cls.maxSpeedKt >= 28, "carrier can steam at ~30 kt class");
  assert.ok(cls.maxParkedSquadrons > 0, "finite deck slots");
  const cells = usedCells(cls.baseLoadout);
  assert.ok(cells <= cls.vlsCells + 1e-9, `loadout fits VLS (${cells}/${cls.vlsCells})`);
  const ship = makeShip(SIDE.BLUE, 0, 0, "CVN");
  assert.equal(isAirfield(ship), true);
  assert.equal(isCarrier(ship), true);
  assert.equal(ship.domain, "sea");
});

test("only carrierCapable airframes may recover on a CVN; AFB accepts all", () => {
  const cvn = makeShip(SIDE.BLUE, 0, 0, "CVN");
  const afb = makeShip(SIDE.BLUE, 10 * NM, 0, "AFB");
  const f35c = makeShip(SIDE.BLUE, 0, 5 * NM, "F35C");
  const f22 = makeShip(SIDE.BLUE, 0, -5 * NM, "F22");
  const f15n = makeShip(SIDE.BLUE, 5 * NM, 0, "F15N");
  assert.equal(f35c.carrierCapable, true);
  assert.equal(f15n.carrierCapable, true);
  assert.equal(f22.carrierCapable, false);
  assert.equal(canRecoverAtBase(f35c, cvn), true);
  assert.equal(canRecoverAtBase(f15n, cvn), true);
  assert.equal(canRecoverAtBase(f22, cvn), false);
  assert.equal(canRecoverAtBase(f22, afb), true);
  assert.equal(canRecoverAtBase(f35c, afb), true);
});

test("carrier is placed on water only (not land-anywhere like AFB)", () => {
  const sim = createScenario(7, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const cvn = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "CVN");
  assert.ok(cvn, "CVN places on open-sea water");
  assert.equal(cvn.isAirfield, true);
});

test("F-35C RTBs to a moving CVN, rides the deck while rearming, then relaunches", () => {
  const sim = running(31);
  const cvn = placeShip(sim, SIDE.BLUE, -40 * NM, 0, "CVN");
  // Steady easterly steam so deck motion is unambiguous.
  cvn.heading = 0;
  cvn.speed = cvn.cruiseSpeed;
  cvn.desiredSpeed = cvn.cruiseSpeed;
  cvn.waypoint = { x: 80 * NM, y: 0 };

  // Start close enough that a max-speed recovery beats fuel burn; winchester
  // (empty magazine) forces RTB even with full tanks.
  const f35c = placeShip(sim, SIDE.BLUE, -35 * NM, 2 * NM, "F35C");
  f35c.fuelS = f35c.enduranceS;
  f35c.loadout = { "AIM-120D": 0, "AIM-9X": 0, "AGM-84": 0 }; // winchester
  f35c.baseLoadoutSnapshot = { "AIM-120D": 2, "AIM-9X": 2, "AGM-84": 4 };

  let rearmed = false;
  let rodeDeck = false;
  let maxDeckErrorM = 0;
  for (let i = 0; i < 4000 && !rearmed; i++) {
    // Keep carrier steaming (AI may rewrite waypoint; re-assert motion lightly).
    if (cvn.alive && cvn.desiredSpeed < cvn.cruiseSpeed * 0.5) {
      cvn.desiredSpeed = cvn.cruiseSpeed;
      cvn.waypoint = { x: cvn.x + 40 * NM, y: cvn.y };
    }
    stepSim(sim, 0.25);
    if (f35c.airState === "rearming" && f35c.alive) {
      const err = Math.hypot(f35c.x - cvn.x, f35c.y - cvn.y);
      maxDeckErrorM = Math.max(maxDeckErrorM, err);
      if (err < 50) rodeDeck = true;
    }
    if (f35c.airState === "mission" && (f35c.loadout["AGM-84"] ?? 0) > 0 && f35c.fuelS > 1000) {
      rearmed = true;
    }
  }
  assert.ok(rodeDeck, "parked flight stayed on the moving deck");
  assert.ok(maxDeckErrorM < 200, `deck stick error ${maxDeckErrorM.toFixed(1)} m should stay tight`);
  assert.ok(rearmed, "squadron rearmed and relaunched from the carrier");
  assert.equal(f35c.homeBaseId, cvn.id);
});

test("land-based F-22 will not recover on CVN-only basing (splashes or seeks friendly edge)", () => {
  const sim = running(41);
  placeShip(sim, SIDE.BLUE, -40 * NM, 0, "CVN");
  // No AFB — only a carrier.
  const f22 = placeShip(sim, SIDE.BLUE, -5 * NM, 0, "F22");
  f22.fuelS = 40;
  f22.loadout = { "AIM-120D": 0, "AIM-9X": 0 };
  f22.baseLoadoutSnapshot = { "AIM-120D": 6, "AIM-9X": 2 };

  let recoveredOnCvn = false;
  for (let i = 0; i < 2500; i++) {
    stepSim(sim, 0.25);
    if (f22.airState === "rearming" && String(f22.homeBaseId || "").startsWith("CVN")) {
      recoveredOnCvn = true;
      break;
    }
    if (!f22.alive) break;
  }
  assert.equal(recoveredOnCvn, false, "F-22 must not park on a CVN deck");
});

test("full deck forces a holding pattern until a slot frees", () => {
  const sim = running(51);
  const cvn = placeShip(sim, SIDE.BLUE, 0, 0, "CVN");
  cvn.maxParkedSquadrons = 1;
  cvn.speed = 0;
  cvn.desiredSpeed = 0;

  const a = placeShip(sim, SIDE.BLUE, 0.5 * NM, 0, "F35C");
  const b = placeShip(sim, SIDE.BLUE, 0.5 * NM, 1 * NM, "F35C");
  for (const s of [a, b]) {
    s.fuelS = 50;
    s.loadout = { "AIM-120D": 0, "AIM-9X": 0, "AGM-84": 0 };
    s.baseLoadoutSnapshot = { "AIM-120D": 2, "AIM-9X": 2, "AGM-84": 4 };
  }

  let sawWait = false;
  let sawTwoRearming = false;
  for (let i = 0; i < 3000; i++) {
    stepSim(sim, 0.25);
    const rearming = [a, b].filter((s) => s.alive && s.airState === "rearming");
    if (rearming.length >= 2) sawTwoRearming = true;
    if ((a._phase === "deck-wait" || b._phase === "deck-wait") && rearming.length === 1) {
      sawWait = true;
    }
    if (sawWait && !sawTwoRearming && i > 800) break;
  }
  assert.ok(sawWait, "overflow flight held a deck-wait pattern");
  assert.equal(sawTwoRearming, false, "capacity 1 must not park two squadrons at once");
});

test("carrier serialize/restore keeps isAirfield and deck capacity", () => {
  const sim = running(61);
  const cvn = placeShip(sim, SIDE.BLUE, -15 * NM, 0, "CVN");
  const snap = serializeScenario(sim);
  const restored = restoreScenario(snap);
  const r = restored.ships.find((s) => s.hull === "CVN");
  assert.ok(r);
  assert.equal(r.isAirfield, true);
  assert.equal(isCarrier(r), true);
  assert.equal(r.maxParkedSquadrons, cvn.maxParkedSquadrons);
});

test("vanilla F35C/AWAC/F15N are carrier capable; F22/F35A/F15C are not", () => {
  for (const hull of ["F35C", "AWAC", "F15N"]) {
    assert.equal(SHIP_CLASSES[hull].carrierCapable, true, hull);
  }
  for (const hull of ["F22", "F35A", "F15C", "F15E", "F15EX", "F16V"]) {
    assert.equal(!!SHIP_CLASSES[hull].carrierCapable, false, hull);
  }
});
