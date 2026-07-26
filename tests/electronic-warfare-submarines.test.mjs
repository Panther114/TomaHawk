import test from "node:test";
import assert from "node:assert/strict";

import {
  KNOT,
  MISSILES,
  NM,
  SCENARIO_MODE,
  SHIP_CLASSES,
  SIDE,
  acousticSignature,
  clearSide,
  createScenario,
  electronicAttackPressure,
  passiveSonarDetectionRange,
  placeShip,
  radarJammingPenalty,
  scanSensors,
  scanSonar,
  stepSim,
  tryRadarSoftKill
} from "../src/sim.js";

function emptyScenario(seed = 1) {
  const sim = createScenario(seed, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  return sim;
}

function start(sim) {
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

test("Virginia Block V is the single submarine type and carries the public 40-Tomahawk configuration", () => {
  const submarineClasses = Object.values(SHIP_CLASSES).filter((unit) => unit.domain === "subsurface");
  assert.equal(submarineClasses.length, 1);
  const ssn = submarineClasses[0];
  assert.equal(ssn.hull, "SSN");
  assert.match(ssn.className, /Virginia-class Block V/);
  assert.equal(ssn.lengthM, 140.5);
  assert.ok(ssn.maxSpeedKt >= 25, "public fact sheet says 25+ knots");
  assert.equal(ssn.baseLoadout.TomahawkBlockV, 40);
  assert.equal(ssn.baseLoadout.Mk48, 26);
  assert.equal(ssn.radarDefaultOn, false);
  assert.equal(MISSILES.Mk48.damage, 2, "heavyweight torpedo has greater effect than a routine missile hit");
});

test("radar cannot see a submerged SSN, while active sonar can build a contact", () => {
  const sim = emptyScenario(1101);
  const ddg = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  const ssn = placeShip(sim, SIDE.RED, 10 * NM, 0, "SSN");
  ddg.sonarActive = false;
  for (let i = 0; i < 20; i++) {
    ddg.radarCooldown = 0;
    scanSensors(sim, 5);
    sim.time += 5;
  }
  assert.equal(ddg.tracks.has(ssn.id), false);

  ddg.sonarActive = true;
  for (let i = 0; i < 20 && !ddg.tracks.has(ssn.id); i++) {
    ddg.sonarCooldown = 0;
    scanSonar(sim, 5);
    sim.time += 5;
  }
  assert.ok(ddg.tracks.has(ssn.id));
  assert.match(ddg.tracks.get(ssn.id).source, /sonar/);
});

test("quiet-speed submarines are materially harder to hear than flank-speed submarines", () => {
  const sim = emptyScenario(1102);
  const listener = placeShip(sim, SIDE.BLUE, 0, 0, "FFG");
  const ssn = placeShip(sim, SIDE.RED, 12 * NM, 0, "SSN");
  ssn.speed = 8 * KNOT;
  const quietSignature = acousticSignature(ssn);
  const quietRange = passiveSonarDetectionRange(listener, ssn);
  ssn.speed = 27 * KNOT;
  const flankSignature = acousticSignature(ssn);
  const flankRange = passiveSonarDetectionRange(listener, ssn);
  assert.ok(flankSignature > quietSignature * 4);
  assert.ok(flankRange > quietRange * 2);

  ssn.speed = 8 * KNOT;
  ssn.sonarActive = true;
  assert.ok(passiveSonarDetectionRange(listener, ssn) > quietRange * 1.6, "active sonar reveals the transmitting submarine");
});

test("sonar and EW subsystem damage reduce their actual sensor and jammer output", () => {
  const sim = emptyScenario(1103);
  const listener = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  const ssn = placeShip(sim, SIDE.RED, 10 * NM, 0, "SSN");
  const healthySonarRange = passiveSonarDetectionRange(listener, ssn);
  listener.subsystems.sonar = 0.25;
  assert.ok(passiveSonarDetectionRange(listener, ssn) < healthySonarRange * 0.35);

  const growler = placeShip(sim, SIDE.RED, 25 * NM, 0, "EA18G");
  const healthyPressure = electronicAttackPressure(listener, sim.ships);
  growler.subsystems.electronicWarfare = 0.25;
  const damagedPressure = electronicAttackPressure(listener, sim.ships);
  assert.ok(damagedPressure < healthyPressure * 0.35);
});

test("jamming degrades long-range radar acquisition but close targets burn through", () => {
  const pressure = 0.8;
  const closePenalty = radarJammingPenalty(pressure, 8 * NM, 190 * NM);
  const distantPenalty = radarJammingPenalty(pressure, 150 * NM, 190 * NM);
  assert.ok(closePenalty < 0.12);
  assert.ok(distantPenalty > closePenalty * 4);

  const detections = (jammed) => {
    const sim = emptyScenario(1200);
    const observer = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
    observer.jammerActive = false;
    const target = placeShip(sim, SIDE.RED, 50 * NM, 0, "F15C");
    target.radarActive = false;
    target.jammerActive = false;
    if (jammed) {
      const growler = placeShip(sim, SIDE.RED, 15 * NM, 15 * NM, "EA18G");
      growler.radarActive = false;
    }
    let hits = 0;
    let quality = 0;
    // Repeated independent scan opportunities from one deterministic PRNG
    // stream avoid bias from comparing the correlated first draw of adjacent
    // seeds.
    for (let sample = 0; sample < 200; sample++) {
      observer.tracks.delete(target.id);
      observer.radarCooldown = 0;
      observer.ewCooldown = 999;
      scanSensors(sim, 5);
      const track = observer.tracks.get(target.id);
      if (track) {
        hits++;
        quality += track.quality;
      }
      sim.time += 5;
    }
    return { hits, quality: quality / Math.max(1, hits) };
  };
  const clear = detections(false);
  const jammed = detections(true);
  assert.ok(clear.hits > 135);
  assert.ok(jammed.hits < clear.hits - 12, `clear ${clear.hits}, jammed ${jammed.hits}`);
  assert.ok(jammed.quality < clear.quality);
});

test("passive ESM detects an emitter without turning on the observer radar", () => {
  const sim = emptyScenario(1104);
  const observer = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  observer.radarActive = false;
  const emitter = placeShip(sim, SIDE.RED, 45 * NM, 0, "DDG");
  for (let i = 0; i < 30 && !observer.tracks.has(emitter.id); i++) {
    observer.ewCooldown = 0;
    scanSensors(sim, 4);
    sim.time += 4;
  }
  const track = observer.tracks.get(emitter.id);
  assert.ok(track);
  assert.match(track.source, /ESM/);
  assert.equal(track.emitterActive, true);

  observer.tracks.clear();
  emitter.radarActive = false;
  emitter.jammerActive = false;
  for (let i = 0; i < 20; i++) {
    observer.ewCooldown = 0;
    scanSensors(sim, 4);
    sim.time += 4;
  }
  assert.equal(observer.tracks.has(emitter.id), false);
});

test("RF decoys work against radar seekers and home-on-jam reduces their effectiveness", () => {
  const spoofRate = (missileId) => {
    const sim = emptyScenario(1300);
    const target = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
    target.jammerActive = true;
    target.radarDecoys = 1000;
    let spoofed = 0;
    for (let sample = 0; sample < 200; sample++) {
      sim.time += 4;
      target.nextRadarDecoyAt = 0;
      const missile = { missileId, side: SIDE.RED };
      if (tryRadarSoftKill(sim, missile, MISSILES[missileId], target)) spoofed++;
    }
    return spoofed;
  };
  const cruiseSpoofs = spoofRate("MaritimeStrike");
  const harmSpoofs = spoofRate("AGM-88");
  assert.ok(cruiseSpoofs > 110);
  assert.ok(harmSpoofs < cruiseSpoofs - 25);
});

test("anti-radiation attack suppresses a capable emitter through the weapon-arrival window", () => {
  const sim = start(emptyScenario(1105));
  const growler = placeShip(sim, SIDE.BLUE, -40 * NM, 0, "EA18G");
  growler.fuelS = 1e9;
  growler.loadout = { "AIM-120C": 0, "AGM-88": 1 };
  const target = placeShip(sim, SIDE.RED, 20 * NM, 0, "DDG");
  target.loadout = {};
  target.ciwsAmmo = 0;
  target.radarDecoys = 0;

  for (let i = 0; i < 1400 && !(target.emconUntil > sim.time); i++) stepSim(sim, 0.25);
  assert.ok(target.emconUntil > sim.time, "ESM-equipped target should react before impact");
  assert.equal(target.radarActive, false);
  assert.equal(target.jammerActive, false);
  assert.ok(target.emconUntil - sim.time >= 89, "EMCON covers the remaining HARM flight");
});

test("surface ASW and submarine torpedoes interact without impossible SAM-vs-torpedo shots", () => {
  const sim = start(emptyScenario(1106));
  const ddg = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  const ssn = placeShip(sim, SIDE.RED, 8 * NM, 0, "SSN");
  ddg.sonarActive = true;
  let asrocSplashed = false;
  for (let i = 0; i < 1200 && !sim.ended; i++) {
    stepSim(sim, 0.25);
    asrocSplashed ||= sim.missiles.some((missile) => missile.missileId === "VL-ASROC" && missile.medium === "underwater");
  }
  const eventText = sim.events.map((event) => event.text);
  assert.ok(eventText.some((text) => text.includes("launched ASROC")));
  assert.ok(eventText.some((text) => text.includes("launched MK48")));
  assert.ok(asrocSplashed, "VL-ASROC changes from rocket flight to an underwater homing phase");
  assert.equal(eventText.some((text) => /launched (SM2|ESSM) at Mk48/.test(text)), false);
  assert.ok(26 - ssn.loadout.Mk48 <= 4, "one surface target should not trigger a magazine dump");
});

test("submarine-launched Tomahawk exits the water before airborne cruise", () => {
  const sim = start(emptyScenario(1107));
  const ssn = placeShip(sim, SIDE.BLUE, 0, 0, "SSN");
  ssn.loadout = { Mk48: 0, TomahawkBlockV: 1 };
  placeShip(sim, SIDE.RED, 40 * NM, 0, "DDG");
  let weapon = null;
  for (let i = 0; i < 240 && !weapon; i++) {
    stepSim(sim, 0.25);
    weapon = sim.missiles.find((missile) => missile.missileId === "TomahawkBlockV");
  }
  assert.ok(weapon);
  assert.equal(weapon.medium, "underwater_to_air");
  assert.equal(weapon.altitudeM, 0);
  assert.equal(weapon.phase, "submerged launch");

  for (let i = 0; i < 80 && weapon.medium !== "air"; i++) stepSim(sim, 0.25);
  assert.equal(weapon.medium, "air");
  assert.ok(weapon.altitudeM > 0);
});

function runCrossDomain(seed) {
  const sim = start(emptyScenario(seed));
  const blueDdg = placeShip(sim, SIDE.BLUE, -4 * NM, 0, "DDG");
  blueDdg.loadout = { "SM-2MR": 8, ESSM: 16, "VL-ASROC": 4 };
  blueDdg.sonarActive = true;
  const blueSsn = placeShip(sim, SIDE.BLUE, -4 * NM, 6 * NM, "SSN");
  blueSsn.loadout = { Mk48: 4, TomahawkBlockV: 0 };
  const growler = placeShip(sim, SIDE.BLUE, -30 * NM, 20 * NM, "EA18G");
  growler.fuelS = 1e9;
  placeShip(sim, SIDE.BLUE, -20 * NM, -10 * NM, "EWR");

  const redDdg = placeShip(sim, SIDE.RED, 4 * NM, 6 * NM, "DDG");
  redDdg.loadout = { "SM-2MR": 8, ESSM: 16, "VL-ASROC": 4 };
  redDdg.sonarActive = true;
  const redSsn = placeShip(sim, SIDE.RED, 4 * NM, 0, "SSN");
  redSsn.loadout = { Mk48: 4, TomahawkBlockV: 0 };
  const fighter = placeShip(sim, SIDE.RED, 20 * NM, -10 * NM, "F15EX");
  fighter.fuelS = 1e9;
  placeShip(sim, SIDE.RED, 30 * NM, 20 * NM, "SAM");

  let asrocSplashed = false;
  for (let i = 0; i < 2400 && !sim.ended; i++) {
    stepSim(sim, 0.25);
    asrocSplashed ||= sim.missiles.some((missile) => missile.missileId === "VL-ASROC" && missile.medium === "underwater");
  }
  const text = sim.events.map((event) => event.text);
  const count = (pattern) => text.filter((line) => pattern.test(line)).length;
  return {
    time: sim.time,
    ended: sim.ended ?? null,
    alive: sim.ships.filter((unit) => unit.alive).map((unit) => unit.hull),
    mk48: count(/launched MK48/),
    asroc: count(/launched ASROC/),
    harm: count(/launched HARM/),
    jsow: count(/launched JSOW/),
    emcon: count(/entered EMCON/),
    impossibleSamShot: count(/launched (SM2|ESSM) at Mk48/),
    asrocSplashed
  };
}

test("mixed surface, ground, air, EW, and submarine battle is deterministic and exercises every new path", () => {
  const first = runCrossDomain(970);
  const second = runCrossDomain(970);
  assert.deepEqual(second, first);
  assert.ok(first.mk48 > 0);
  assert.ok(first.asroc > 0);
  assert.ok(first.harm > 0, "Growler performs SEAD against emitting surface/ground units");
  assert.ok(first.jsow > 0, "conventional air-to-ground strike remains active alongside EW");
  assert.ok(first.emcon > 0);
  assert.ok(first.asrocSplashed);
  assert.equal(first.impossibleSamShot, 0);
});
