import test from "node:test";
import assert from "node:assert/strict";

import {
  NM,
  SIDE,
  createScenario,
  moveShips,
  scanSensors,
  shareTracks,
  stepSim,
  SCENARIO_MODE,
  trackForShip,
  ageTracks,
  currentTrack
} from "../src/sim.js";
import {
  firstLandCollisionFraction,
  isWaterPoint,
  projectLonLat
} from "../src/world/terrain.js";
import { complexityScore } from "../scripts/perf-harness.mjs";

test("radar track files contain hostile contacts, not friendly or self tracks", () => {
  const sim = createScenario(91);
  const blue = sim.ships[0];
  const red = sim.ships[1];
  const blueTwo = structuredClone({ ...blue, tracks: undefined });
  blueTwo.id = "DDG-BLUE-2";
  blueTwo.x = blue.x + NM;
  blueTwo.tracks = new Map();
  blueTwo.radarCooldown = 0;
  sim.ships.push(blueTwo);
  blue.radarCooldown = 0;
  red.radarCooldown = 0;

  scanSensors(sim, 0.25);

  assert.equal(blue.tracks.has(blueTwo.id), false);
  assert.equal(blueTwo.tracks.has(blue.id), false);
  assert.equal(blue.tracks.has(blue.id), false);
});

test("CEC sharing does not transitively relay a track during the same update", () => {
  const sim = createScenario(92);
  const blueOne = sim.ships[0];
  const red = sim.ships[1];
  const blueTwo = { ...blueOne, id: "BLUE-2", tracks: new Map() };
  const blueThree = { ...blueOne, id: "BLUE-3", tracks: new Map() };
  sim.ships.splice(1, 0, blueTwo, blueThree);
  sim.time = 10;
  blueOne.tracks.set(red.id, {
    id: red.id,
    side: red.side,
    classification: red.className,
    x: red.x,
    y: red.y,
    vx: 0,
    vy: 0,
    quality: 0.8,
    uncertainty: 500,
    source: blueOne.id,
    age: 3,
    lastSeen: 7
  });

  shareTracks(sim);

  assert.equal(trackForShip(sim, blueTwo, red.id)?.source, `${blueOne.id} datalink`);
  assert.equal(trackForShip(sim, blueThree, red.id)?.source, `${blueOne.id} datalink`);
  assert.equal(blueTwo.tracks.has(red.id), false, "shared reports are not copied into receiver-local maps");
});

test("blocked navigation plans reuse their detour during the cache window", () => {
  const sim = createScenario(93, "eastChinaSea");
  const ship = sim.ships[0];
  Object.assign(ship, projectLonLat(122.3, 30.9));
  ship.waypoint = projectLonLat(121.47, 31.23);

  moveShips(sim, 0.25);
  const plannedAt = ship.navPlan.plannedAt;
  const detour = ship.navigationWaypoint;
  sim.time += 0.25;
  moveShips(sim, 0.25);

  assert.equal(ship.navPlan.plannedAt, plannedAt);
  assert.deepEqual(ship.navigationWaypoint, detour);
});

test("blocked navigation keeps a valid detour after the short cache expires", () => {
  const sim = createScenario(930, "eastChinaSea");
  const ship = sim.ships[0];
  const goal = projectLonLat(121.47, 31.23);
  Object.assign(ship, projectLonLat(122.3, 30.9));
  ship.waypoint = goal;

  moveShips(sim, 0.25);
  const detour = { ...ship.navigationWaypoint };
  assert.ok(detour.x && detour.y, "blocked route should choose a detour");
  for (let i = 0; i < 12; i++) {
    sim.time += 0.25;
    moveShips(sim, 0.25);
    assert.equal(isWaterPoint(ship, sim.mapId, 0), true, `ship should remain on water at tick ${i}`);
  }

  assert.equal(ship.navPlan.goalX, goal.x);
  assert.equal(ship.navPlan.goalY, goal.y);
  assert.deepEqual(ship.navigationWaypoint, detour);
});

test("terrain collision fraction returns the first of multiple land crossings", () => {
  const square = (left, right) => [
    [left, -2],
    [right, -2],
    [right, 2],
    [left, 2],
    [left, -2]
  ];
  const map = { landRings: [square(-6, -4), square(4, 6)], coastlines: [] };
  const fraction = firstLandCollisionFraction({ x: -10, y: 0 }, { x: 10, y: 0 }, map, 0);

  assert.ok(fraction > 0.19 && fraction < 0.21, `expected first crossing near 0.2, got ${fraction}`);
});

test("force-picture extrapolation uses the conservative half-second cadence", () => {
  const sim = createScenario(94);
  for (const ship of sim.ships) ship.radarActive = false;
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;

  stepSim(sim, 0.25);
  const firstPicture = sim.forcePicture;
  stepSim(sim, 0.25);
  assert.equal(sim.forcePicture, firstPicture);
  stepSim(sim, 0.25);
  assert.notEqual(sim.forcePicture, firstPicture);
});

test("track aging is lazy and materializes the same linear state on access", () => {
  const sim = createScenario(95);
  const blue = sim.ships[0];
  const red = sim.ships[1];
  blue.tracks.set(red.id, {
    id: red.id,
    side: red.side,
    x: 100,
    y: 200,
    vx: 10,
    vy: -4,
    quality: 0.8,
    uncertainty: 500,
    age: 0,
    lastSeen: 0
  });
  sim.time = 2;
  ageTracks(sim, 2);
  const raw = blue.tracks.get(red.id);
  assert.equal(raw.x, 100);
  assert.equal(raw.quality, 0.8);
  const current = currentTrack(raw, sim.time);
  assert.equal(current.x, 120);
  assert.equal(current.y, 192);
  assert.ok(Math.abs(current.quality - 0.788) < 1e-9);
  assert.equal(current.uncertainty, 680);
});

// Time-complexity regression guard. Rather than asserting an absolute
// milliseconds-per-tick budget (which varies by machine and makes CI flaky),
// this measures how the per-tick cost *scales* with force size on the current
// machine. Healthy near-linear scaling sits around 1.0; a quadratic regression
// (an O(n) hot loop turned O(n^2)) pushes the score toward the 5x size ratio.
// The 2.5 ceiling tolerates measurement noise and log-factor growth while
// flagging any genuine super-linear blow-up. Lower the ceiling to tighten the
// guard; see scripts/perf-harness.mjs for the methodology.
test("simulation tick cost scales near-linearly with force size", () => {
  const { score, small, large, smallShips, largeShips, quadraticScore } = complexityScore();
  console.log(`    [perf] ${smallShips} ships: ${small.toFixed(4)} ms/tick`);
  console.log(`    [perf] ${largeShips} ships: ${large.toFixed(4)} ms/tick`);
  console.log(
    `    [perf] complexity score: ${score.toFixed(2)} ` +
    `(1.0 = linear, ${quadraticScore.toFixed(1)} = quadratic; ceiling 2.5)`
  );
  assert.ok(
    score < 2.5,
    `tick-cost scaling regressed: complexity score ${score.toFixed(2)} >= 2.5 ` +
    `(${smallShips} ships ${small.toFixed(4)} ms/tick -> ${largeShips} ships ${large.toFixed(4)} ms/tick). ` +
    `A score near ${quadraticScore.toFixed(1)} means tick cost grew with the square of the force size — ` +
    `look for an O(n^2) loop over ships or missiles introduced by the change.`
  );
});

test("entity indexes persist across ticks without membership changes", () => {
  const sim = createScenario(96);
  for (const ship of sim.ships) ship.radarActive = false;
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  stepSim(sim, 0.25);
  const shipIndex = sim._shipById;
  const targetIndex = sim._missilesByTarget;
  stepSim(sim, 0.25);
  assert.equal(sim._shipById, shipIndex);
  assert.equal(sim._missilesByTarget, targetIndex);
});
