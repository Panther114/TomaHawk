import test from "node:test";
import assert from "node:assert/strict";

import {
  NM,
  SIDE,
  SCENARIO_MODE,
  MISSILES,
  createScenario,
  clearSide,
  placeShip,
  stepSim,
  offensiveMissileCount,
  decideAircraft,
  buildForcePicture,
  computeFleetCommand,
  isHighEnergyThreat,
  missileInterceptHitChance,
  chooseDefensiveWeapon
} from "../src/sim.js";

function emptyRunning(seed) {
  const sim = createScenario(seed, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

function seedTrack(observer, target, quality = 0.9) {
  observer.tracks.set(target.id, {
    id: target.id,
    side: target.side,
    domain: target.domain ?? "sea",
    classification: target.className,
    x: target.x,
    y: target.y,
    vx: 0,
    vy: 0,
    quality,
    uncertainty: 200,
    source: observer.id,
    age: 0,
    lastSeen: 0
  });
}

test("offensiveMissileCount counts Dark Eagle and air surface munitions", () => {
  const sim = emptyRunning(901);
  const deb = placeShip(sim, SIDE.BLUE, -10 * NM, 0, "DEB");
  const f35a = placeShip(sim, SIDE.BLUE, -12 * NM, 5 * NM, "F35A");
  const f35c = placeShip(sim, SIDE.BLUE, -12 * NM, -5 * NM, "F35C");
  const ddg = placeShip(sim, SIDE.BLUE, -15 * NM, 0, "DDG");
  assert.equal(offensiveMissileCount(deb, true), 8);
  assert.equal(offensiveMissileCount(deb, false), 8);
  assert.equal(offensiveMissileCount(f35a, false), 4); // AGM-154
  assert.equal(offensiveMissileCount(f35c, false), 4); // AGM-84
  assert.ok(offensiveMissileCount(ddg, true) > offensiveMissileCount(ddg, false));
});

test("Dark Eagle battery fires alongside nearby destroyers in a multi-shooter fight", () => {
  const sim = emptyRunning(902);
  const deb = placeShip(sim, SIDE.BLUE, -40 * NM, 0, "DEB");
  const ddg = placeShip(sim, SIDE.BLUE, -35 * NM, 2 * NM, "DDG");
  const ewr = placeShip(sim, SIDE.BLUE, -30 * NM, 0, "EWR");
  const target = placeShip(sim, SIDE.RED, 40 * NM, 0, "DDG");
  target.loadout = { "SM-2MR": 0, "SM-6": 0, ESSM: 0, MaritimeStrike: 0, TomahawkBlockV: 0 };
  for (const s of [deb, ddg, ewr]) seedTrack(s, target, 0.92);
  let debFired = false;
  for (let i = 0; i < 400 && !debFired; i++) {
    stepSim(sim, 0.25);
    debFired = sim.missiles.some((m) => m.launcherId === deb.id && m.missileId === "DarkEagle")
      || (deb.launchQueue || []).some((o) => o.missileId === "DarkEagle");
  }
  assert.ok(debFired, "DEB should receive an allocation and fire LRHW, not be starved by the DDG");
  assert.ok(deb.loadout.DarkEagle < 8 || debFired);
});

test("anti-ground aircraft locks a ground site, not a nearer ship", () => {
  const sim = emptyRunning(903);
  const striker = placeShip(sim, SIDE.BLUE, 0, 0, "F35A"); // AGM-154 ground-only
  const ship = placeShip(sim, SIDE.RED, 20 * NM, 0, "DDG");
  const sam = placeShip(sim, SIDE.RED, 35 * NM, 0, "SAM");
  seedTrack(striker, ship, 0.9);
  seedTrack(striker, sam, 0.9);
  buildForcePicture(sim);
  computeFleetCommand(sim);
  decideAircraft(sim, striker);
  // Nearest surface is the ship, but JSOW cannot engage sea — lock must be the SAM.
  assert.equal(striker._surfTargetId, sam.id, "ground-only loadout must lock a ground target");
  assert.ok(striker._standoffNm > 0);
});

test("anti-ship aircraft does not lock a ground-only site", () => {
  const sim = emptyRunning(904);
  const striker = placeShip(sim, SIDE.BLUE, 0, 0, "F35C"); // AGM-84 sea-only
  const sam = placeShip(sim, SIDE.RED, 15 * NM, 0, "SAM");
  const ship = placeShip(sim, SIDE.RED, 40 * NM, 0, "DDG");
  seedTrack(striker, sam, 0.9);
  seedTrack(striker, ship, 0.9);
  buildForcePicture(sim);
  computeFleetCommand(sim);
  decideAircraft(sim, striker);
  assert.equal(striker._surfTargetId, ship.id, "sea-only loadout must skip nearer ground site");
});

test("near-equal peer fight opens with moderate aggression, not survive", () => {
  const sim = emptyRunning(905);
  const blue1 = placeShip(sim, SIDE.BLUE, -30 * NM, 0, "DDG");
  const blue2 = placeShip(sim, SIDE.BLUE, -32 * NM, 4 * NM, "DDG");
  const red1 = placeShip(sim, SIDE.RED, 30 * NM, 0, "DDG");
  const red2 = placeShip(sim, SIDE.RED, 32 * NM, -4 * NM, "DDG");
  seedTrack(blue1, red1, 0.85);
  seedTrack(blue2, red2, 0.85);
  seedTrack(red1, blue1, 0.85);
  seedTrack(red2, blue2, 0.85);
  for (let i = 0; i < 8; i++) stepSim(sim, 0.25);
  const blue = sim.commandState.get(SIDE.BLUE);
  const red = sim.commandState.get(SIDE.RED);
  assert.ok((blue?.aggression ?? 0) >= 0.35, `blue aggression too low: ${blue?.aggression}`);
  assert.ok((red?.aggression ?? 0) >= 0.35, `red aggression too low: ${red?.aggression}`);
  assert.notEqual(blue?.mode, "survive");
  assert.notEqual(red?.mode, "survive");
});

test("threat axis ignores missile tracks", () => {
  const sim = emptyRunning(906);
  const blue = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "DDG");
  const red = placeShip(sim, SIDE.RED, 40 * NM, 0, "DDG");
  seedTrack(blue, red, 0.9);
  buildForcePicture(sim);
  computeFleetCommand(sim);
  const axisBefore = sim.fleetCommand.get(SIDE.BLUE).axis;
  // Inject a fused missile track far off-axis that would dominate a naive mean.
  const fused = sim.forcePicture.get(SIDE.BLUE);
  fused.set("M-fake-1", {
    id: "M-fake-1",
    side: SIDE.RED,
    x: blue.x,
    y: blue.y + 80 * NM,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    classification: "MaritimeStrike"
  });
  computeFleetCommand(sim);
  const axisAfter = sim.fleetCommand.get(SIDE.BLUE).axis;
  const delta = Math.abs(Math.atan2(Math.sin(axisAfter - axisBefore), Math.cos(axisAfter - axisBefore)));
  assert.ok(delta < 0.05, `axis should ignore missiles (delta=${delta})`);
});

test("JSOW flight eventually queues against a ground emplacement", () => {
  const sim = emptyRunning(907);
  const striker = placeShip(sim, SIDE.BLUE, -10 * NM, 0, "F35A");
  placeShip(sim, SIDE.BLUE, -15 * NM, 0, "AFB");
  const sam = placeShip(sim, SIDE.RED, 40 * NM, 0, "SAM");
  sam.loadout = { "SM-2MR": 0, "SM-6": 0, ESSM: 0 };
  seedTrack(striker, sam, 0.92);
  // Place striker near release range so geometry is on-station quickly.
  striker.x = sam.x - 50 * NM;
  striker.y = sam.y;
  striker.altitudeM = 200;
  striker.targetAltitudeM = 200;
  let fired = false;
  for (let i = 0; i < 500 && !fired; i++) {
    stepSim(sim, 0.25);
    fired = sim.missiles.some((m) => m.launcherId === striker.id && m.missileId === "AGM-154")
      || (striker.launchQueue || []).some((o) => o.missileId === "AGM-154");
  }
  assert.ok(fired, "anti-ground flight should release JSOW at a ground site");
});

test("hypersonic intercept PK is low and layer-sensitive (SM-6 ≫ ESSM)", () => {
  const darkEagle = {
    missileId: "DarkEagle",
    speed: MISSILES.DarkEagle.speedMps,
    altitudeM: MISSILES.DarkEagle.cruiseAltitudeM,
    seaSkimming: false
  };
  const subsonic = {
    missileId: "MaritimeStrike",
    speed: MISSILES.MaritimeStrike.speedMps,
    altitudeM: 30,
    seaSkimming: true
  };
  assert.equal(isHighEnergyThreat(darkEagle), true);
  assert.equal(isHighEnergyThreat(subsonic), false);

  const sm6VsH = missileInterceptHitChance(MISSILES["SM-6"], darkEagle, {
    terminal: true, trackQuality: 0.9, trackAgeS: 0, concurrentThreats: 1
  });
  const sm2VsH = missileInterceptHitChance(MISSILES["SM-2MR"], darkEagle, {
    terminal: true, trackQuality: 0.9, trackAgeS: 0, concurrentThreats: 1
  });
  const essmVsH = missileInterceptHitChance(MISSILES.ESSM, darkEagle, {
    terminal: true, trackQuality: 0.9, trackAgeS: 0, concurrentThreats: 1
  });
  const sm6VsCruise = missileInterceptHitChance(MISSILES["SM-6"], subsonic, {
    terminal: true, trackQuality: 0.9, trackAgeS: 0, concurrentThreats: 1
  });

  // Balanced band: harder than cruise, but multi-shot AAW can still work.
  assert.ok(sm6VsH <= 0.40, `SM-6 vs Dark Eagle too high: ${sm6VsH}`);
  assert.ok(sm6VsH >= 0.20, `SM-6 vs Dark Eagle too low: ${sm6VsH}`);
  assert.ok(sm2VsH < sm6VsH, "SM-2 should be worse than SM-6 against hypersonic");
  assert.ok(essmVsH <= sm2VsH, "ESSM should be worst layer against hypersonic");
  assert.ok(essmVsH <= 0.24, `ESSM vs Dark Eagle too high: ${essmVsH}`);
  assert.ok(essmVsH >= 0.08, `ESSM vs Dark Eagle too low: ${essmVsH}`);
  // Cruise intercepts remain clearly easier so ordinary AAW is not nerfed.
  assert.ok(sm6VsCruise > sm6VsH + 0.12, "subsonic ASCM intercept should stay much easier");
});

test("defensive weapon choice prefers SM-6 against hypersonic threats", () => {
  const sim = emptyRunning(908);
  const ship = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  ship.loadout["SM-6"] = 8;
  ship.loadout["SM-2MR"] = 16;
  ship.loadout.ESSM = 32;
  const threat = {
    id: "M-hypo",
    missileId: "DarkEagle",
    side: SIDE.RED,
    targetId: ship.id,
    x: 40 * NM,
    y: 0,
    speed: MISSILES.DarkEagle.speedMps,
    altitudeM: 30000,
    terminal: false,
    heading: Math.PI
  };
  const weapon = chooseDefensiveWeapon(sim, ship, threat);
  assert.equal(weapon, "SM-6");
});
