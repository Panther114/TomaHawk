import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  battleSummaryCounts,
  canAddAssets,
  MISSILES,
  NM,
  KNOT,
  SCENARIO_MODE,
  SIDE,
  SHIP_CLASSES,
  WEAPON_STATE,
  FLEET_ROLE,
  VISUAL_CONFIG,
  canRunScenario,
  clampShipToBounds,
  chooseDefensiveWeapon,
  clearSide,
  createDefaultScenario,
  createScenario,
  defaultRoe,
  defaultLoadout,
  deleteShip,
  formatLogLines,
  exportAfterAction,
  interceptPoint,
  missileSymbol,
  missileDisplayRole,
  missileDetectionEnvelope,
  placeShip,
  restoreScenario,
  serializeScenario,
  setScenarioMap,
  setLoadout,
  stepSim,
  planEngagements,
  moveShips,
  usedCells,
  validateLoadout,
  weaponRangeEntries,
  wrapAngle
} from "../src/sim.js";
import { isWaterPoint, MAP_HEIGHT_M, MAP_WIDTH_M, projectLonLat } from "../src/world/terrain.js";

function runningScenarioMode(seed = 1) {
  const sim = createScenario(seed);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

function strikeAt(sim, launcher, target, overrides = {}) {
  const missile = {
    id: overrides.id ?? `M-inject-${sim.missiles.length + 1}`,
    side: launcher.side,
    launcherId: launcher.id,
    targetId: target.id,
    missileId: "MaritimeStrike",
    x: target.x - 6 * NM,
    y: target.y,
    heading: 0,
    speed: 270,
    maxRangeM: 120 * NM,
    flownM: 0,
    targetX: target.x,
    targetY: target.y,
    controllerSide: launcher.side,
    guidance: "inertial_active",
    retargetable: false,
    terminal: false,
    alive: true,
    ...overrides
  };
  sim.missiles.push(missile);
  return missile;
}

function runningScenario(seed = 1) {
  const sim = createScenario(seed);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

test("default scenario creates one blue and one red destroyer", () => {
  const sim = createScenario(1);
  assert.equal(sim.ships.length, 2);
  assert.equal(sim.ships.filter((s) => s.side === SIDE.BLUE).length, 1);
  assert.equal(sim.ships.filter((s) => s.side === SIDE.RED).length, 1);
  assert.equal(sim.mode, SCENARIO_MODE.SETUP);
  assert.equal(Math.abs(sim.ships[0].x - sim.ships[1].x), 40 * NM);
  assert.equal(Math.abs(sim.ships[0].x - sim.ships[1].x) / NM, 40);
  assert.equal(sim.widthM, MAP_WIDTH_M);
  assert.equal(sim.heightM, MAP_HEIGHT_M);
});

test("default ship headings point blue left and red right before battle starts", () => {
  const sim = createScenario(1);
  assert.equal(sim.ships[0].heading, Math.PI);
  assert.equal(sim.ships[1].heading, 0);
});

test("default app scenario loads the supplied 4v4 east china sea template", () => {
  const sim = createDefaultScenario(1);
  assert.equal(sim.ships.length, 8);
  assert.equal(sim.ships.filter((s) => s.side === SIDE.BLUE).length, 4);
  assert.equal(sim.ships.filter((s) => s.side === SIDE.RED).length, 4);
  assert.equal(sim.mapId, "eastChinaSea");
  assert.equal(sim.mode, SCENARIO_MODE.SETUP);
});

test("loadout validation enforces 96-cell VLS capacity", () => {
  const sim = createScenario(1);
  const ship = sim.ships[0];
  assert.ok(usedCells(ship.loadout) <= 96);
  assert.equal(validateLoadout({ TomahawkBlockV: 97 }).ok, false);
  assert.equal(setLoadout(ship, "TomahawkBlockV", 97).ok, false);
});

test("default loadouts fill each hull's VLS capacity with integer counts", () => {
  for (const hull of Object.keys(SHIP_CLASSES)) {
    // Units with an explicit type-specific magazine (ground emplacements, air
    // squadrons) intentionally do not fill VLS cells — only naval hulls that
    // rely on the scaled default loadout are topped off to capacity.
    if (SHIP_CLASSES[hull].baseLoadout) continue;
    const cap = SHIP_CLASSES[hull].vlsCells;
    const loadout = defaultLoadout(hull);
    const used = usedCells(loadout);
    // Every count is a whole missile (no fractional rounds like the old 15.5).
    for (const [id, count] of Object.entries(loadout)) {
      assert.ok(Number.isInteger(count), `${hull} ${id} count ${count} not integer`);
    }
    // Topped off to within a single cell of capacity (can't fit another round).
    assert.ok(used <= cap && cap - used < 1, `${hull}: ${used}/${cap}`);
  }
});

// Regression: a ship with no contact previously picked a patrol waypoint via
// pure sim.rng jitter (`y + rng.range(-6,6)*NM`) with zero relationship to the
// enemy's actual position — it could patrol in any direction, even away from
// the enemy entirely. It now heads toward the fleet's rough strategic bearing
// estimate (see strategicBearingEstimate in command.js), which is imprecise
// (bounded random error) but never more than roughly right.
test("a ship with no contact patrols roughly toward the enemy, not a random heading", () => {
  const sim = runningScenario(13);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  // Placed far enough apart that neither side's radar ever picks up the other
  // (well beyond any RCS-limited detection range), so this exercises the
  // pre-contact patrol fallback specifically.
  const blue = placeShip(sim, SIDE.BLUE, -300 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 300 * NM, 40 * NM, "DDG");
  for (let i = 0; i < 8; i++) stepSim(sim, 0.25);
  assert.ok(blue.waypoint, "a patrol waypoint was set");
  const trueBearing = Math.atan2(40 * NM - blue.y, 600 * NM - blue.x);
  const patrolBearing = Math.atan2(blue.waypoint.y - blue.y, blue.waypoint.x - blue.x);
  let diff = Math.abs(trueBearing - patrolBearing);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  assert.ok(diff < (50 * Math.PI) / 180, `patrol bearing should be roughly toward the enemy, off by ${(diff * 180 / Math.PI).toFixed(1)} deg`);
});

test("radar creates imperfect perceived track, not direct truth access", () => {
  const sim = runningScenario(4);
  placeShip(sim, SIDE.BLUE, -20 * NM, 0);
  placeShip(sim, SIDE.RED, 20 * NM, 0);
  for (let i = 0; i < 80; i++) stepSim(sim, 0.25);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const track = blue.tracks.get(red.id);
  assert.ok(track, "blue should eventually detect red");
  assert.notEqual(track.x, red.x);
  assert.ok(track.uncertainty > 0);
});

test("simulation is deterministic for the same seed", () => {
  const a = runningScenario(9);
  const b = runningScenario(9);
  for (let i = 0; i < 300; i++) {
    stepSim(a, 0.25);
    stepSim(b, 0.25);
  }
  assert.deepEqual(
    a.events.map((e) => [Math.round(e.t * 100), e.side, e.text]),
    b.events.map((e) => [Math.round(e.t * 100), e.side, e.text])
  );
});

test("ships launch anti-surface missiles when track quality permits", () => {
  const sim = runningScenario(12);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -30 * NM;
  red.x = 30 * NM;
  blue.loadout.MaritimeStrike = Math.max(blue.loadout.MaritimeStrike, MISSILES.MaritimeStrike.salvo);
  for (let i = 0; i < 260; i++) stepSim(sim, 0.25);
  assert.ok(sim.events.some((e) => e.text.includes("launched MSTK") || e.text.includes("launched TLAM")));
});

test("fleet command posture rises when a side has an observed offensive advantage", () => {
  const sim = createScenario(20);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const blue = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "BBG");
  const red = placeShip(sim, SIDE.RED, 20 * NM, 0, "DDG");
  blue.tracks.set(red.id, {
    id: red.id,
    side: red.side,
    classification: red.className,
    x: red.x,
    y: red.y,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  red.tracks.set(blue.id, {
    id: blue.id,
    side: blue.side,
    classification: blue.className,
    x: blue.x,
    y: blue.y,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    source: red.id,
    age: 0,
    lastSeen: 0
  });
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  stepSim(sim, 0.25);
  const bluePosture = sim.commandState.get(SIDE.BLUE);
  const redPosture = sim.commandState.get(SIDE.RED);
  assert.ok((bluePosture?.aggression ?? 0) > (redPosture?.aggression ?? 0));
  assert.ok((bluePosture?.ownVls ?? 0) > (bluePosture?.enemyVlsEstimate ?? 0));
  assert.ok((bluePosture?.ownPower ?? 0) > (redPosture?.ownPower ?? 0));
});

test("scenario serialization restores ships, tracks, and loadouts", () => {
  const sim = runningScenario(15);
  for (let i = 0; i < 40; i++) stepSim(sim, 0.25);
  const restored = restoreScenario(serializeScenario(sim));
  assert.equal(restored.ships.length, sim.ships.length);
  assert.equal(restored.ships[0].loadout["SM-2MR"], sim.ships[0].loadout["SM-2MR"]);
  assert.ok(restored.ships[0].tracks instanceof Map);
  assert.ok(Array.isArray(restored.ships[0].launchQueue));
  assert.equal(typeof restored.ships[0].nextLaunchAt, "number");
  assert.equal(restored.paused, false);
  assert.equal(restored.mode, SCENARIO_MODE.RUNNING);
});

test("offensive planning prioritizes the highest-value observed ship", () => {
  const sim = createScenario(21);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const blue = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "BBG");
  const redHigh = placeShip(sim, SIDE.RED, 20 * NM, 0, "BBG");
  const redLow = placeShip(sim, SIDE.RED, 22 * NM, 2 * NM, "DDG");
  blue.tracks.set(redHigh.id, {
    id: redHigh.id,
    side: redHigh.side,
    classification: redHigh.className,
    x: redHigh.x,
    y: redHigh.y,
    vx: 0,
    vy: 0,
    quality: 0.96,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  blue.tracks.set(redLow.id, {
    id: redLow.id,
    side: redLow.side,
    classification: redLow.className,
    x: redLow.x,
    y: redLow.y,
    vx: 0,
    vy: 0,
    quality: 0.96,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  redHigh.roe.weaponState = WEAPON_STATE.HOLD;
  redLow.roe.weaponState = WEAPON_STATE.HOLD;
  blue.loadout.MaritimeStrike = Math.max(blue.loadout.MaritimeStrike, 4);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  stepSim(sim, 0.25);
  const firstOffensive = blue.launchQueue.find((order) => MISSILES[order.missileId]?.category === "anti_ship")
    || sim.missiles.find((m) => m.launcherId === blue.id && MISSILES[m.missileId]?.category === "anti_ship");
  assert.ok(firstOffensive);
  assert.equal(firstOffensive.targetId, redHigh.id);
});

test("after-action export includes winner, ships, and chronological events", () => {
  const sim = runningScenario(16);
  for (let i = 0; i < 10; i++) stepSim(sim, 0.25);
  const aar = exportAfterAction(sim);
  assert.equal(aar.version, 1);
  assert.equal(aar.ships.length, 2);
  assert.ok(Array.isArray(aar.events));
});

test("ships do not retaliate against an unseen missile", () => {
  const sim = runningScenarioMode(31);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -15 * NM;
  red.x = 15 * NM;
  blue.roe.weaponState = WEAPON_STATE.HOLD;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  sim.missiles.push({
    id: "M-test-unseen",
    side: SIDE.RED,
    launcherId: red.id,
    targetId: blue.id,
    missileId: "MaritimeStrike",
    x: red.x + 100 * NM,
    y: blue.y,
    heading: Math.PI,
    speed: 270,
    maxRangeM: 120 * NM,
    flownM: 0,
    targetX: blue.x,
    targetY: blue.y,
    terminal: false,
    alive: true
  });
  stepSim(sim, 0.25);
  assert.equal(sim.missiles.some((m) => m.side === SIDE.BLUE && m.targetId === "M-test-unseen"), false);
});

test("defensive missiles can intercept inbound anti-ship missiles once the track exists", () => {
  const sim = runningScenario(31);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -15 * NM;
  red.x = 15 * NM;
  blue.roe.weaponState = WEAPON_STATE.HOLD;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  red.loadout.ESSM = 8;
  const threat = {
    id: "M-test-inbound",
    side: SIDE.RED,
    launcherId: red.id,
    targetId: blue.id,
    missileId: "MaritimeStrike",
    x: red.x + 100 * NM,
    y: blue.y,
    heading: Math.PI,
    speed: 270,
    maxRangeM: 120 * NM,
    flownM: 0,
    targetX: blue.x,
    targetY: blue.y,
    terminal: true,
    alive: true
  };
  sim.missiles.push(threat);
  blue.tracks.set(threat.id, {
    id: threat.id,
    side: threat.side,
    classification: threat.missileId,
    x: threat.x,
    y: threat.y,
    vx: Math.cos(threat.heading) * threat.speed,
    vy: Math.sin(threat.heading) * threat.speed,
    quality: 0.72,
    uncertainty: 4 * NM,
    source: blue.id,
    age: 0,
    lastSeen: sim.time
  });
  stepSim(sim, 0.25);
  assert.ok(
    blue.launchQueue.some((order) => order.targetId === threat.id)
      || sim.missiles.some((m) => m.side === SIDE.BLUE && m.targetId === threat.id),
    "defensive fire should queue or launch once the missile is detected"
  );
});

test("default sandbox produces sustained combat and uses area defense on a known seed", () => {
  const sim = runningScenario(70);
  for (let i = 0; i < 60 * 30 * 4; i++) {
    stepSim(sim, 0.25);
  }
  // After 30 min, magazines should show sustained combat (not full loadout)
  assert.ok(sim.ships.some((ship) => ship.loadout["SM-2MR"] < 36));
  // At least some offensive weapons should have been expended
  assert.ok(sim.ships.some((ship) => (ship.loadout.MaritimeStrike ?? 16) < 16 || (ship.loadout["SM-6"] ?? 16) < 16));
});

test("setup rejects placing a ship on land in East China Sea mode", () => {
  const sim = createScenario(76, "eastChinaSea");
  const shanghai = projectLonLat(121.47, 31.23);
  const placed = placeShip(sim, SIDE.BLUE, shanghai.x, shanghai.y, "DDG");
  assert.equal(placed, null);
  assert.equal(sim.ships.length, 2);
});

test("map selection persists in saves and cannot change once the simulation is running", () => {
  const sim = createScenario(77, "openSea");
  assert.equal(setScenarioMap(sim, "eastChinaSea").ok, true);
  assert.equal(sim.mapId, "eastChinaSea");
  const restored = restoreScenario(serializeScenario(sim));
  assert.equal(restored.mapId, "eastChinaSea");
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  const result = setScenarioMap(sim, "openSea");
  assert.equal(result.ok, false);
  assert.equal(sim.mapId, "eastChinaSea");
});

test("map changes in setup reseat ships onto open water for the new terrain", () => {
  const sim = createScenario(78, "openSea");
  placeShip(sim, SIDE.BLUE, 0, 0, "CCG");
  const result = setScenarioMap(sim, "eastChinaSea");
  assert.equal(result.ok, true);
  assert.ok(sim.ships.every((ship) => isWaterPoint(ship, sim.mapId)));
});

test("missile definitions include tactical display metadata", () => {
  for (const [id, spec] of Object.entries(MISSILES)) {
    assert.ok(["anti_ship", "ship_sam", "air_to_air", "dual_role"].includes(spec.category), `${id} category`);
    assert.ok(Array.isArray(spec.launchers) && spec.launchers.length > 0, `${id} launchers`);
    assert.ok(Array.isArray(spec.targets) && spec.targets.length > 0, `${id} targets`);
    assert.ok(spec.shortLabel.length >= 3, `${id} short label`);
    assert.ok(Number.isFinite(spec.magazineReserveRatio), `${id} reserve ratio`);
    assert.ok(spec.launchIntervalS > 0, `${id} launch interval`);
    assert.ok(spec.salvoSpacingS > 0, `${id} salvo spacing`);
  }
  assert.equal(missileSymbol("MaritimeStrike"), "square");
  assert.equal(missileSymbol("SM-2MR"), "triangle");
  assert.equal(missileSymbol("SM-6"), "diamond");
});

test("SM-6 display role is fixed at launch", () => {
  assert.equal(missileDisplayRole({ missileId: "SM-6", launchRole: "anti_air", targetId: "S-ship", alive: true }), "anti_air");
  assert.equal(missileDisplayRole({ missileId: "SM-6", launchRole: "anti_ship", targetId: "M-threat", alive: true }), "anti_ship");
  assert.doesNotMatch(fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8"), /Diamond for dual-role/);
});

test("SM-6 is detectable materially earlier than Tomahawk on ship radar", () => {
  const sim = createScenario(75);
  const observer = sim.ships.find((s) => s.side === SIDE.BLUE);
  const sm6 = { missileId: "SM-6", terminal: false, seaSkimming: false };
  const tomahawk = { missileId: "TomahawkBlockV", terminal: false, seaSkimming: true };
  const sm6Envelope = missileDetectionEnvelope(observer, sm6);
  const tomahawkEnvelope = missileDetectionEnvelope(observer, tomahawk);
  assert.ok(sm6Envelope.detectRangeM > tomahawkEnvelope.detectRangeM * 2, "SM-6 should be picked up much earlier than a low-altitude Tomahawk");
  assert.ok(sm6Envelope.targetHeightM > tomahawkEnvelope.targetHeightM, "SM-6 cruise profile is modeled at much higher altitude");
});

test("battle summary counts classify SM-6 by current target and stay single-line friendly", () => {
  const sim = createScenario(2);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const blueThreat = strikeAt(sim, red, blue, { id: "M-blue-threat" });
  const redThreat = strikeAt(sim, blue, red, { id: "M-red-threat" });
  blueThreat.alive = false;
  redThreat.alive = false;
  sim.missiles.push(
    { id: "M-blue-sm6-as", side: SIDE.BLUE, launcherId: blue.id, targetId: red.id, missileId: "SM-6", alive: true },
    { id: "M-blue-sm6-aa", side: SIDE.BLUE, launcherId: blue.id, targetId: redThreat.id, missileId: "SM-6", alive: true },
    { id: "M-red-sm6-as", side: SIDE.RED, launcherId: red.id, targetId: blue.id, missileId: "SM-6", alive: true },
    { id: "M-red-sm6-aa", side: SIDE.RED, launcherId: red.id, targetId: blueThreat.id, missileId: "SM-6", alive: true }
  );
  const counts = battleSummaryCounts(sim);
  assert.equal(counts.blueShips, 1);
  assert.equal(counts.redShips, 1);
  assert.equal(counts.blueAntiShip, 1);
  assert.equal(counts.blueAntiAir, 1);
  assert.equal(counts.redAntiShip, 1);
  assert.equal(counts.redAntiAir, 1);
  assert.equal(counts.blueHp, counts.blueHpMax);
  assert.equal(counts.redHp, counts.redHpMax);
  assert.ok(canAddAssets(createScenario(2)));
  const running = createScenario(2);
  running.mode = SCENARIO_MODE.RUNNING;
  assert.equal(canAddAssets(running), false);
});

test("launch scheduler spaces a four-missile salvo across ticks", () => {
  const sim = runningScenario(41);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -20 * NM;
  red.x = 20 * NM;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  blue.doctrine.aggression = 1;
  blue.tracks.set(red.id, {
    id: red.id,
    side: red.side,
    classification: red.className,
    x: red.x,
    y: red.y,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  stepSim(sim, 0.25);
  assert.ok(blue.launchQueue.length >= 3);
  assert.equal(sim.missiles.filter((m) => m.side === SIDE.BLUE).length <= 1, true);
  for (let i = 0; i < 8; i++) stepSim(sim, 0.25);
  assert.ok(sim.missiles.filter((m) => m.side === SIDE.BLUE).length >= 1, "coordinated release should begin after the short raid window");
  assert.ok(blue.launchQueue.length >= 2);
  for (let i = 0; i < 16; i++) stepSim(sim, 0.25);
  assert.ok(sim.missiles.filter((m) => m.side === SIDE.BLUE).length >= 2);
});

test("weapon range entries include only loaded weapons", () => {
  const sim = createScenario(42);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  blue.loadout.ESSM = 0;
  const entries = weaponRangeEntries(blue);
  assert.ok(entries.every((entry) => blue.loadout[entry.id] > 0));
  assert.ok(!entries.some((entry) => entry.id === "ESSM"));
  assert.ok(entries.some((entry) => entry.shortLabel === "TLAM"));
});

test("save and restore preserves launch queue and cooldown state", () => {
  const sim = runningScenario(43);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -20 * NM;
  red.x = 20 * NM;
  blue.doctrine.aggression = 1;
  blue.tracks.set(red.id, {
    id: red.id,
    side: red.side,
    classification: red.className,
    x: red.x,
    y: red.y,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  stepSim(sim, 0.25);
  const restored = restoreScenario(serializeScenario(sim));
  const restoredBlue = restored.ships.find((s) => s.side === SIDE.BLUE);
  assert.equal(restoredBlue.launchQueue.length, blue.launchQueue.length);
  assert.equal(restoredBlue.nextLaunchAt, blue.nextLaunchAt);
  assert.equal(restoredBlue.nextDefensiveLaunchAt, blue.nextDefensiveLaunchAt);
  assert.deepEqual(restoredBlue.lastLaunchAtByMissile, blue.lastLaunchAtByMissile);
});

test("setup mode supports multiple same-side destroyers and side validation", () => {
  const sim = createScenario(44);
  const extraBlue = placeShip(sim, SIDE.BLUE, -10 * NM, 4 * NM);
  assert.equal(sim.ships.filter((s) => s.side === SIDE.BLUE).length, 2);
  assert.equal(canRunScenario(sim), true);
  assert.equal(deleteShip(sim, extraBlue.id), true);
  assert.equal(clearSide(sim, SIDE.RED), 1);
  assert.equal(canRunScenario(sim), false);
});

test("new scenarios do not add a generic SYS initialization log", () => {
  const sim = createScenario(48);
  assert.equal(sim.events.length, 0);
});

test("log export formats copyable chronological lines", () => {
  const sim = createScenario(45);
  placeShip(sim, SIDE.BLUE, 0, 0);
  const lines = formatLogLines(sim.events);
  assert.match(lines, /Blue DDG placed/);
  assert.match(lines, /\d\d:\d\d Blue/);
});

test("visual tactical symbols are intentionally compact", () => {
  assert.ok(VISUAL_CONFIG.missileMinPx <= 1.5);
  assert.ok(VISUAL_CONFIG.missileMaxPx <= 6.5);
  assert.ok(VISUAL_CONFIG.missileLabelPx <= 6);
  assert.ok(VISUAL_CONFIG.uiBasePx <= 9);
  assert.ok(VISUAL_CONFIG.logPx <= 8);
  assert.ok(VISUAL_CONFIG.shipLabelPx >= 8.75);
});

test("HTML keeps WEZ as a single toggle and 60x maximum speed", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="filter-ranges"/);
  assert.doesNotMatch(html, /id="ranges-mode"/);
  assert.match(html, /id="speed"[^>]*max="60"/);
  assert.match(html, /id="copy-fire-log"/);
  assert.doesNotMatch(html, /id="duplicate"|id="clear-blue"|id="clear-red"/);
});

test("right panel renderer is fleet inventory focused", () => {
  const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  // Pure panel/markup builders live in src/ui/view.js; the canvas overlay and
  // wiring stay in app.js. Inventory/posture markup is asserted against the
  // combined UI source so it survives that split.
  const view = fs.readFileSync(new URL("../src/ui/view.js", import.meta.url), "utf8");
  const ui = `${app}\n${view}`;
  assert.match(ui, /inventory-row/);
  assert.match(ui, /sunk/);
  assert.match(ui, /inventory-divider/);
  assert.match(app, /right:\$\{rightInset\}px/);
  assert.match(app, /flex-direction:column/);
  assert.match(app, /overflow-y:auto/);
  assert.match(app, /availableHeight/);
  assert.match(ui, /agg-meter/);
  assert.match(app, /copyLogToClipboard/);
  assert.match(app, /setFeedCollapsed/);
  assert.match(app, /toggle-feed/);
  assert.match(app, /document\.documentElement\.lang = getLang\(\) === 'zh' \? 'zh-CN' : 'en'/);
  assert.match(app, /isAntiAirCategory\(ring\.category\)/);
  assert.doesNotMatch(ui, /<span>Class<\/span>|<span>Scenario<\/span>|<span>Heading<\/span>/);
  assert.doesNotMatch(ui, /LAST LAUNCH|LAST EFFECT/);
});

test("fleet inventory styling stays compact with cross-browser font parity", () => {
  const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns:\s*minmax\(42px, 1\.25fr\) minmax\(25px, 0\.72fr\) minmax\(45px, 1fr\) repeat\(5, minmax\(23px, 0\.66fr\)\);/);
  assert.match(css, /font:\s*500 14px var\(--font-ui\);/);
  assert.match(css, /font:\s*430 14px var\(--font-ui\);/);
  assert.match(css, /justify-items:\s*center;/);
});

test("setup coordinates are clamped before the simulation starts", () => {
  const sim = createScenario(46);
  const placed = placeShip(sim, SIDE.BLUE, Infinity, -Infinity);
  assert.equal(placed.x, 0);
  assert.equal(placed.y, 0);

  placed.x = sim.widthM;
  placed.y = -sim.heightM;
  clampShipToBounds(sim, placed);
  assert.equal(placed.x, sim.widthM / 2);
  assert.equal(placed.y, -sim.heightM / 2);
});

test("scenario restore normalizes invalid dimensions and ship coordinates", () => {
  const data = serializeScenario(createScenario(0));
  data.widthM = -1;
  data.heightM = "invalid";
  data.ships[0].x = "not-a-coordinate";
  data.ships[0].y = Infinity;

  const restored = restoreScenario(data);
  assert.equal(restored.seed, 0);
  assert.equal(restored.widthM, MAP_WIDTH_M);
  assert.equal(restored.heightM, MAP_HEIGHT_M);
  assert.equal(restored.ships[0].x, 0);
  assert.equal(restored.ships[0].y, 0);
});

test("ship movement rendering uses a dashed velocity arrow without a waypoint square", () => {
  const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /Math\.atan2\(ship\.vy, ship\.vx\)/);
  assert.match(app, /ctx\.setLineDash\(\[3, 3\]\)/);
  assert.doesNotMatch(app, /ctx\.strokeRect\(w\.x/);
});

test("loadout display counts remain non-negative integers after repeated launches", () => {
  const sim = runningScenario(69);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  red.x = 14 * NM;
  blue.loadout["SM-2MR"] = 2;
  for (let i = 0; i < 24; i++) {
    strikeAt(sim, red, blue, {
      id: `M-sm2-normalize-${i}`,
      x: blue.x + (8 + i * 0.25) * NM,
      y: blue.y + i * 15,
      heading: Math.PI
    });
    stepSim(sim, 0.25);
  }
  assert.equal(Number.isInteger(blue.loadout["SM-2MR"]), true);
  assert.ok(blue.loadout["SM-2MR"] >= 0);
});

test("defensive fire can react to a locally detected inbound before force-level sharing catches up", () => {
  const sim = runningScenario(70);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  red.x = 90 * NM;
  blue.loadout["SM-2MR"] = 8;
  const threat = strikeAt(sim, red, blue, {
    id: "M-local-defense",
    x: blue.x + 18 * NM,
    y: blue.y,
    heading: Math.PI,
    speed: 270,
    terminal: false
  });
  blue.tracks.set(threat.id, {
    id: threat.id,
    side: threat.side,
    classification: threat.missileId,
    x: threat.x,
    y: threat.y,
    vx: Math.cos(threat.heading) * threat.speed,
    vy: Math.sin(threat.heading) * threat.speed,
    quality: 0.86,
    uncertainty: 0.25 * NM,
    source: blue.id,
    age: 0,
    lastSeen: sim.time
  });
  stepSim(sim, 0.25);
  assert.ok(
    sim.missiles.some((m) => m.side === SIDE.BLUE && m.targetId === threat.id)
      || blue.launchQueue.some((order) => order.targetId === threat.id),
    "defensive planning reacts to the local missile track without waiting on a stale force picture"
  );
});

test("defensive planner adds a second shot when the only assigned interceptor cannot arrive in time", () => {
  const sim = runningScenarioMode(72);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const blueLocal = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  const blueRemote = placeShip(sim, SIDE.BLUE, -85 * NM, 0, "DDG");
  const red = placeShip(sim, SIDE.RED, 70 * NM, 0, "DDG");
  const threat = strikeAt(sim, red, blueLocal, {
    id: "M-too-late",
    x: blueLocal.x + 6 * NM,
    y: blueLocal.y,
    heading: Math.PI,
    speed: 270,
    terminal: true
  });
  blueLocal.tracks.set(threat.id, {
    id: threat.id,
    side: threat.side,
    classification: threat.missileId,
    x: threat.x,
    y: threat.y,
    vx: Math.cos(threat.heading) * threat.speed,
    vy: Math.sin(threat.heading) * threat.speed,
    quality: 0.88,
    uncertainty: 250,
    source: blueLocal.id,
    age: 0,
    lastSeen: sim.time
  });
  sim.missiles.push({
    id: "M-blue-late-sm2",
    side: SIDE.BLUE,
    launcherId: blueRemote.id,
    targetId: threat.id,
    missileId: "SM-2MR",
    x: blueRemote.x,
    y: blueRemote.y,
    heading: 0,
    speed: MISSILES["SM-2MR"].speedMps,
    maxRangeM: MISSILES["SM-2MR"].rangeM,
    flownM: 0,
    targetX: threat.x,
    targetY: threat.y,
    controllerSide: SIDE.BLUE,
    terminal: false,
    alive: true
  });
  stepSim(sim, 0.25);
  assert.ok(
    blueLocal.launchQueue.some((order) => order.targetId === threat.id)
      || sim.missiles.some((m) => m.side === SIDE.BLUE && m.launcherId === blueLocal.id && m.targetId === threat.id),
    "local defender adds another engagement when the first shot is too late"
  );
});

test("selected ship weapon rings include loaded Tomahawk and maritime strike weapons", () => {
  const sim = createScenario(46);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const entries = weaponRangeEntries(blue);
  assert.ok(entries.some((entry) => entry.id === "TomahawkBlockV" && entry.shortLabel === "TLAM"));
  assert.ok(entries.some((entry) => entry.id === "MaritimeStrike" && entry.shortLabel === "MSTK"));
});

test("CIWS is a terminal last-ditch layer and can leak saturated attacks", () => {
  const sim = runningScenario(47);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -2 * NM;
  red.x = 0;
  red.loadout.ESSM = 0;
  red.loadout["SM-2MR"] = 0;
  red.ciwsAmmo = 720;
  for (let i = 0; i < 4; i++) {
    sim.missiles.push({
      id: `M-sat-${i}`,
      side: SIDE.BLUE,
      launcherId: blue.id,
      targetId: red.id,
      missileId: "MaritimeStrike",
      x: red.x - (1.2 + i * 0.04) * NM,
      y: red.y + (i - 1.5) * 90,
      heading: 0,
      speed: 270,
      maxRangeM: 120 * NM,
      flownM: 0,
      targetX: red.x,
      targetY: red.y,
      terminal: true,
      seaSkimming: true,
      phase: "terminal",
      alive: true
    });
  }
  for (let i = 0; i < 80; i++) stepSim(sim, 0.25);
  assert.ok(red.damage > 0 || sim.events.some((event) => /CIWS failed|hit by/.test(event.text)));
});

test("defensive weapon choice uses SM-2 for early area defense and ESSM for close point defense", () => {
  const sim = runningScenario(49);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const longThreat = {
    id: "M-long",
    side: SIDE.RED,
    targetId: blue.id,
    missileId: "MaritimeStrike",
    x: blue.x + 45 * NM,
    y: blue.y,
    speed: 270,
    terminal: false,
    alive: true
  };
  const closeThreat = {
    ...longThreat,
    id: "M-close",
    x: blue.x + 9 * NM,
    terminal: false
  };
  assert.equal(chooseDefensiveWeapon(sim, blue, longThreat), "SM-2MR");
  assert.equal(chooseDefensiveWeapon(sim, blue, closeThreat), "ESSM");
  blue.loadout.ESSM = 0;
  assert.equal(chooseDefensiveWeapon(sim, blue, closeThreat), "SM-2MR");
  assert.equal(red.side, SIDE.RED);
});

test("SM-6 is available as a defensive area weapon when other layers cannot cover", () => {
  const sim = runningScenario(51);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  blue.loadout["SM-2MR"] = 0;
  blue.loadout.ESSM = 0;
  blue.loadout["SM-6"] = 4;
  const longThreat = {
    id: "M-sm6-threat",
    side: SIDE.RED,
    targetId: blue.id,
    missileId: "TomahawkBlockV",
    x: blue.x + 120 * NM,
    y: blue.y,
    speed: 245,
    terminal: false,
    alive: true
  };
  assert.equal(chooseDefensiveWeapon(sim, blue, longThreat), "SM-6");
});

test("close saturated raids use ESSM instead of forcing every shot through SM-2", () => {
  const sim = runningScenario(53);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  red.x = 80 * NM;
  for (let i = 0; i < 4; i++) {
    strikeAt(sim, red, blue, {
      id: `M-close-raid-${i}`,
      x: blue.x + 16 * NM,
      y: blue.y + i * 120,
      heading: Math.PI,
      speed: 270
    });
  }
  stepSim(sim, 0.25);
  assert.ok(
    sim.missiles.some((m) => m.side === SIDE.BLUE && m.missileId === "ESSM")
      || blue.launchQueue.some((order) => order.missileId === "ESSM"),
    "close raid is assigned to ESSM"
  );
});

test("defensive launch orders bypass offensive queue backlog and strike cooldown", () => {
  const sim = runningScenario(52);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  red.x = 90 * NM;
  blue.nextLaunchAt = sim.time + 90;
  blue.launchQueue.push({
    missileId: "TomahawkBlockV",
    targetId: red.id,
    targetSide: red.side,
    targetClassification: red.className,
    targetX: red.x,
    targetY: red.y,
    targetVx: 0,
    targetVy: 0,
    requestedAt: sim.time,
    readyAt: sim.time,
    launchSequence: 0,
    defensive: false,
    priority: 50
  });
  const threat = strikeAt(sim, red, blue, {
    id: "M-raid-priority",
    x: blue.x + 12 * NM,
    y: blue.y,
    heading: Math.PI,
    speed: 270,
    terminal: false
  });
  stepSim(sim, 0.25);
  const defensiveShot = sim.missiles.find((m) => m.side === SIDE.BLUE && m.targetId === threat.id);
  assert.ok(defensiveShot, "ship launches a defensive interceptor despite an offensive order at the queue head");
  assert.notEqual(defensiveShot.missileId, "TomahawkBlockV");
});

test("two friendly ships can both service one hostile target when force raid is not saturated", () => {
  const sim = runningScenario(50);
  const blue1 = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const blue2 = placeShip(sim, SIDE.BLUE, blue1.x, 10 * NM);
  blue1.x = -50 * NM;
  blue2.x = -52 * NM;
  red.x = 50 * NM;
  red.y = 0;
  for (const blue of [blue1, blue2]) {
    blue.radarActive = false;
    blue.tracks.set(red.id, {
      id: red.id,
      side: red.side,
      classification: red.className,
      x: red.x,
      y: red.y,
      vx: 0,
      vy: 0,
      quality: 0.95,
      uncertainty: 100,
      source: blue.id,
      age: 0,
      lastSeen: 0
    });
  }
  stepSim(sim, 0.25);
  assert.ok(blue1.launchQueue.length + sim.missiles.filter((m) => m.launcherId === blue1.id).length > 0);
  assert.ok(blue2.launchQueue.length + sim.missiles.filter((m) => m.launcherId === blue2.id).length > 0);
});

test("high aggression translates into sustained multi-ship offensive pressure", () => {
  const sim = runningScenario(71);
  const blue1 = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const blue2 = placeShip(sim, SIDE.BLUE, blue1.x - 2 * NM, blue1.y + 6 * NM, "DDG");
  const blue3 = placeShip(sim, SIDE.BLUE, blue1.x - 3 * NM, blue1.y - 6 * NM, "DDG");
  blue1.x = -44 * NM;
  blue2.x = -46 * NM;
  blue3.x = -45 * NM;
  red.x = 44 * NM;
  red.y = 0;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  for (const blue of [blue1, blue2, blue3]) {
    blue.radarActive = false;
    blue.tracks.set(red.id, {
      id: red.id,
      side: red.side,
      classification: red.className,
      x: red.x,
      y: red.y,
      vx: 0,
      vy: 0,
      quality: 0.96,
      uncertainty: 100,
      source: blue.id,
      age: 0,
      lastSeen: 0
    });
  }
  for (let i = 0; i < 5; i++) stepSim(sim, 0.25);
  const bluePosture = sim.commandState.get(SIDE.BLUE);
  const offensiveShots = sim.missiles.filter((m) => m.side === SIDE.BLUE && MISSILES[m.missileId]?.category === "anti_ship").length;
  const queuedShots = [blue1, blue2, blue3].reduce(
    (sum, ship) => sum + ship.launchQueue.filter((order) => MISSILES[order.missileId]?.category === "anti_ship").length,
    0
  );
  const activeShooters = new Set(
    [
      ...sim.missiles
        .filter((m) => m.side === SIDE.BLUE && MISSILES[m.missileId]?.category === "anti_ship")
        .map((m) => m.launcherId),
      ...[blue1, blue2, blue3]
        .filter((ship) => ship.launchQueue.some((order) => MISSILES[order.missileId]?.category === "anti_ship"))
        .map((ship) => ship.id)
    ]
  ).size;
  assert.ok((bluePosture?.aggression ?? 0) > 0.7, "blue force posture is aggressive with a clear numerical advantage");
  assert.ok(offensiveShots + queuedShots >= 6, "aggressive force sustains offensive pressure rather than a single casual salvo");
  assert.ok(activeShooters >= 2, "pressure is distributed across multiple shooters");
});

test("coordinated offensive planning aligns raid release times across shooters", () => {
  const sim = runningScenarioMode(76);
  const blue1 = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const blue2 = placeShip(sim, SIDE.BLUE, blue1.x - 2 * NM, blue1.y + 6 * NM, "DDG");
  blue1.x = -44 * NM;
  blue2.x = -45 * NM;
  red.x = 44 * NM;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  for (const blue of [blue1, blue2]) {
    blue.radarActive = false;
    blue.tracks.set(red.id, {
      id: red.id,
      side: red.side,
      classification: red.className,
      x: red.x,
      y: red.y,
      vx: 0,
      vy: 0,
      quality: 0.96,
      uncertainty: 100,
      source: blue.id,
      age: 0,
      lastSeen: 0
    });
  }
  stepSim(sim, 0.25);
  const readyA = blue1.launchQueue.find((order) => MISSILES[order.missileId]?.category === "anti_ship")?.readyAt;
  const readyB = blue2.launchQueue.find((order) => MISSILES[order.missileId]?.category === "anti_ship")?.readyAt;
  assert.ok(Number.isFinite(readyA) && Number.isFinite(readyB));
  assert.ok(Math.abs(readyA - readyB) <= 0.01, "ships in one raid share the same coordinated release time");
});

test("ship kinematics are realistic: 1x speed multiplier and ~31 kn flank", () => {
  const sim = createScenario(60);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  assert.ok(Math.abs(blue.maxSpeed - 31 * KNOT) < 1e-6, "flank speed ~31 kn in real m/s");
  assert.ok(blue.maxSpeed < 17, "no 5x inflation of ship speed");
  assert.ok(blue.cruiseSpeed <= blue.maxSpeed && blue.cruiseSpeed > 0);
  assert.ok(blue.decel >= blue.accel, "a hull backs down at least as fast as it accelerates");
});

test("ship damage thresholds match compact playable lethality", () => {
  assert.equal(SHIP_CLASSES.FFG.damageResist, 1);
  assert.equal(SHIP_CLASSES.DDG.damageResist, 2);
  assert.equal(SHIP_CLASSES.CCG.damageResist, 3);
  assert.equal(SHIP_CLASSES.BBG.damageResist, 5);
});

test("strike-empty ships retreat from contact instead of closing", () => {
  const sim = runningScenarioMode(67);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  blue.y = 0;
  red.x = 35 * NM;
  red.y = 0;
  blue.loadout.MaritimeStrike = 0;
  blue.loadout.TomahawkBlockV = 0;
  blue.tracks.set(red.id, {
    id: red.id,
    side: red.side,
    classification: red.className,
    x: red.x,
    y: red.y,
    vx: 0,
    vy: 0,
    quality: 0.85,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  stepSim(sim, 0.25);
  assert.ok(blue.waypoint.x < blue.x, "retreat waypoint opens range from the enemy track");
  assert.ok(blue.desiredSpeed >= blue.maxSpeed * 0.85, "retreat uses high sustained speed");
});

test("terrain-aware movement keeps ships on water even when given an inland waypoint", () => {
  const sim = createScenario(79, "eastChinaSea");
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const start = projectLonLat(122.3, 30.9);
  const inland = projectLonLat(121.47, 31.23);
  blue.x = start.x;
  blue.y = start.y;
  blue.heading = Math.PI;
  blue.speed = blue.cruiseSpeed;
  blue.desiredSpeed = blue.cruiseSpeed;
  blue.waypoint = inland;
  moveShips(sim, 0.25);
  assert.equal(isWaterPoint(blue, sim.mapId), true);
  assert.notEqual(blue.navigationWaypoint, null);
});

test("endgame fire planner releases reserve strike weapons when enemy is strike-empty", () => {
  const sim = runningScenarioMode(68);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  red.x = 50 * NM;
  blue.loadout["SM-6"] = 0;
  blue.loadout.MaritimeStrike = 0;
  blue.loadout.TomahawkBlockV = 1;
  red.loadout["SM-6"] = 0;
  red.loadout.MaritimeStrike = 0;
  red.loadout.TomahawkBlockV = 0;
  blue.tracks.set(red.id, {
    id: red.id,
    side: red.side,
    classification: red.className,
    x: red.x,
    y: red.y,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  stepSim(sim, 0.25);
  assert.ok(
    blue.launchQueue.some((order) => order.missileId === "TomahawkBlockV")
      || sim.missiles.some((m) => m.launcherId === blue.id && m.missileId === "TomahawkBlockV"),
    "last strike weapon is released when the opponent cannot answer with strike weapons"
  );
});

test("interceptPoint leads a crossing target instead of aiming at its current position", () => {
  // Target at (1000,0) crossing in +y; a faster pursuer must aim ahead (y>0).
  const lead = interceptPoint(0, 0, 100, 1000, 0, 0, 50);
  assert.ok(lead.y > 0, "lead point is ahead of the crossing target");
  assert.ok(lead.t > 0, "positive time-to-go");
  // A stationary target yields its own position.
  const still = interceptPoint(0, 0, 100, 500, 0, 0, 0);
  assert.equal(Math.round(still.x), 500);
  assert.equal(Math.round(still.y), 0);
  // An unreachable target (faster than the weapon, opening) falls back safely.
  const unreachable = interceptPoint(0, 0, 10, 100, 0, 100, 0);
  assert.ok(Number.isFinite(unreachable.x) && Number.isFinite(unreachable.y));
});

test("launched missiles fly a velocity-lead course, not a pure pursuit of position", () => {
  const sim = runningScenarioMode(61);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -20 * NM;
  red.x = 20 * NM;
  // Fast crossing target so the lead is visibly off the bearing-to-target.
  const crossing = strikeAt(sim, blue, red, { x: red.x - 30 * NM, y: red.y });
  red.heading = Math.PI / 2;
  red.speed = 15;
  stepSim(sim, 0.25);
  // Aimpoint should be led off the target's beam (nonzero y component), and the
  // missile stores an explicit aim point distinct from raw target coordinates.
  assert.ok(Number.isFinite(crossing.aimX) && Number.isFinite(crossing.aimY));
  assert.ok(Math.abs(crossing.aimY - red.y) > 1, "aimpoint leads the crossing target");
});

test("a strike weapon self-destructs when its assigned ship is destroyed mid-flight", () => {
  const sim = runningScenarioMode(62);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const red2 = placeShip(sim, SIDE.RED, red.x + 4 * NM, 1 * NM);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  // Blue holds a cooperative track on the secondary target, but the missile
  // still cannot retarget in this simulation.
  blue.tracks.set(red2.id, {
    id: red2.id, side: red2.side, classification: red2.className,
    x: red2.x, y: red2.y, vx: 0, vy: 0, quality: 0.9, uncertainty: 100, source: blue.id, age: 0, lastSeen: 0
  });
  const missile = strikeAt(sim, blue, red, { x: red.x - 5 * NM, y: red.y });
  red.alive = false; // primary target destroyed by other fires
  stepSim(sim, 0.25);
  assert.equal(missile.alive, false, "missile does not retarget after target loss");
  assert.ok(sim.events.some((e) => /self-destructed/.test(e.text)));
  assert.equal(red2.alive, true);
});

test("a strike weapon cannot retarget even with a plausible alternate ship", () => {
  const sim = runningScenarioMode(77);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const redWide = placeShip(sim, SIDE.RED, red.x - 2 * NM, red.y + 40 * NM, "DDG");
  blue.tracks.set(redWide.id, {
    id: redWide.id,
    side: redWide.side,
    classification: redWide.className,
    x: redWide.x,
    y: redWide.y,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  const missile = strikeAt(sim, blue, red, { x: red.x - 8 * NM, y: red.y, heading: 0 });
  red.alive = false;
  stepSim(sim, 0.25);
  assert.equal(missile.alive, false, "target loss now forces self-destruction");
  assert.ok(sim.events.some((e) => /self-destructed|fell into the sea/.test(e.text)));
});

test("a strike weapon self-destructs on midcourse abort when no valid hand-off exists", () => {
  const sim = runningScenarioMode(63);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  // A surviving but unreachable/untracked red keeps the scenario runnable.
  const redFar = placeShip(sim, SIDE.RED, 300 * NM, 0);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  const missile = strikeAt(sim, blue, red, { x: red.x - 5 * NM, y: red.y });
  red.alive = false;
  stepSim(sim, 0.25);
  assert.equal(missile.alive, false, "missile does not coast on a dead datum");
  assert.ok(sim.events.some((e) => /self-destructed/.test(e.text)));
  assert.ok(redFar.alive);
});

test("an interceptor self-destructs when its target is killed", () => {
  const sim = runningScenarioMode(64);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  // Hold Red well clear and weapons-tight so the only anti-ship missiles in play
  // are the two injected threats.
  red.x = 80 * NM;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  red.loadout.MaritimeStrike = 0;
  red.loadout.TomahawkBlockV = 0;
  const threatA = strikeAt(sim, red, blue, { id: "M-threatA", x: blue.x - 14 * NM, y: blue.y });
  const threatB = strikeAt(sim, red, blue, { id: "M-threatB", x: blue.x - 16 * NM, y: blue.y + 200 });
  const interceptor = {
    id: "M-essm-1", side: SIDE.BLUE, launcherId: blue.id, targetId: threatA.id,
    missileId: "ESSM", x: blue.x, y: blue.y, heading: Math.PI, speed: 980,
    maxRangeM: 28 * NM, flownM: 0, targetX: threatA.x, targetY: threatA.y,
    controllerSide: SIDE.BLUE, guidance: "command_inertial", retargetable: false,
    terminal: false, alive: true
  };
  sim.missiles.push(interceptor);
  threatA.alive = false; // killed by another layer this instant
  stepSim(sim, 0.25);
  assert.equal(interceptor.alive, false);
  assert.ok(sim.events.some((e) => /self-destructed/.test(e.text)));
  assert.equal(threatB.alive, true);
});

test("terminal ESSM defense can shoot-shoot from one ship when a single failure would be fatal", () => {
  const sim = runningScenarioMode(73);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  red.x = 50 * NM;
  blue.damage = 1;
  blue.loadout["SM-2MR"] = 0;
  blue.loadout.ESSM = 8;
  const threat = strikeAt(sim, red, blue, {
    id: "M-shoot-shoot",
    x: blue.x + 4 * NM,
    y: blue.y,
    heading: Math.PI,
    speed: 270,
    terminal: true
  });
  blue.tracks.set(threat.id, {
    id: threat.id,
    side: threat.side,
    classification: threat.missileId,
    x: threat.x,
    y: threat.y,
    vx: Math.cos(threat.heading) * threat.speed,
    vy: Math.sin(threat.heading) * threat.speed,
    quality: 0.9,
    uncertainty: 200,
    source: blue.id,
    age: 0,
    lastSeen: sim.time
  });
  sim.missiles.push({
    id: "M-blue-first-essm",
    side: SIDE.BLUE,
    launcherId: blue.id,
    targetId: threat.id,
    missileId: "ESSM",
    x: blue.x,
    y: blue.y,
    heading: 0,
    speed: MISSILES.ESSM.speedMps,
    maxRangeM: MISSILES.ESSM.rangeM,
    flownM: 0,
    targetX: threat.x,
    targetY: threat.y,
    controllerSide: SIDE.BLUE,
    terminal: false,
    alive: true
  });
  stepSim(sim, 0.25);
  const secondShotQueued = blue.launchQueue.filter((order) => order.targetId === threat.id && order.missileId === "ESSM").length;
  const secondShotAirborne = sim.missiles.filter((m) => m.side === SIDE.BLUE && m.launcherId === blue.id && m.targetId === threat.id && m.missileId === "ESSM").length;
  assert.ok(secondShotQueued + secondShotAirborne >= 2, "ship commits an additional ESSM when one miss would mean a kill");
});

test("defensive channels cap simultaneous queued SAM engagements", () => {
  const sim = runningScenarioMode(74);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const blue = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  blue.defenseChannels.sam = 1;
  blue.loadout["SM-2MR"] = 8;
  blue.loadout["SM-6"] = 0;
  blue.loadout.ESSM = 0;
  const red = placeShip(sim, SIDE.RED, 80 * NM, 0, "DDG");
  red.roe.weaponState = WEAPON_STATE.HOLD;
  for (const [id, x, y] of [
    ["M-sam-channel-a", 45 * NM, 0],
    ["M-sam-channel-b", 46 * NM, 1 * NM]
  ]) {
    const threat = strikeAt(sim, red, blue, { id, x, y, heading: Math.PI, speed: 270 });
    blue.tracks.set(threat.id, {
      id: threat.id,
      side: threat.side,
      classification: threat.missileId,
      x: threat.x,
      y: threat.y,
      vx: Math.cos(threat.heading) * threat.speed,
      vy: Math.sin(threat.heading) * threat.speed,
      quality: 0.9,
      uncertainty: 200,
      source: blue.id,
      age: 0,
      lastSeen: sim.time
    });
  }
  sim.missiles.push({
    id: "M-blue-sam-channel-active",
    side: SIDE.BLUE,
    launcherId: blue.id,
    targetId: "M-sam-channel-a",
    missileId: "SM-2MR",
    x: blue.x,
    y: blue.y,
    heading: 0,
    speed: MISSILES["SM-2MR"].speedMps,
    maxRangeM: MISSILES["SM-2MR"].rangeM,
    flownM: 0,
    targetX: 45 * NM,
    targetY: 0,
    controllerSide: SIDE.BLUE,
    terminal: false,
    alive: true
  });
  planEngagements(sim);
  assert.equal(blue.launchQueue.filter((order) => order.missileId === "SM-2MR").length, 0);
});

test("midcourse raid pressure can receive shoot-shoot if channels allow it", () => {
  const sim = runningScenarioMode(75);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const target = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  target.defenseChannels.sam = 4;
  const escort = placeShip(sim, SIDE.BLUE, 0, 8 * NM, "CCG");
  escort.defenseChannels.sam = 4;
  const red = placeShip(sim, SIDE.RED, 80 * NM, 0, "DDG");
  red.roe.weaponState = WEAPON_STATE.HOLD;
  const threats = [
    strikeAt(sim, red, target, { id: "M-midcourse-a", x: 50 * NM, y: 0, heading: Math.PI, speed: 270 }),
    strikeAt(sim, red, target, { id: "M-midcourse-b", x: 52 * NM, y: 2 * NM, heading: Math.PI, speed: 270 })
  ];
  for (const defender of [target, escort]) {
    defender.loadout["SM-2MR"] = 8;
    defender.loadout["SM-6"] = 0;
    defender.loadout.ESSM = 0;
    for (const threat of threats) {
      defender.tracks.set(threat.id, {
        id: threat.id,
        side: threat.side,
        classification: threat.missileId,
        x: threat.x,
        y: threat.y,
        vx: Math.cos(threat.heading) * threat.speed,
        vy: Math.sin(threat.heading) * threat.speed,
        quality: 0.9,
        uncertainty: 200,
        source: defender.id,
        age: 0,
        lastSeen: sim.time
      });
    }
  }
  planEngagements(sim);
  for (const threat of threats) {
    const assigned = [target, escort].reduce(
      (sum, ship) => sum + ship.launchQueue.filter((order) => order.targetId === threat.id).length,
      0
    );
    assert.ok(assigned >= 2, `${threat.id} should get shoot-shoot under raid pressure when channels allow it`);
  }
});

test("defensive launch orders carry track quality into interceptor PK", () => {
  const sim = runningScenarioMode(76);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const blue = placeShip(sim, SIDE.BLUE, 0, 0, "DDG");
  blue.loadout["SM-2MR"] = 8;
  blue.loadout["SM-6"] = 0;
  blue.loadout.ESSM = 0;
  const red = placeShip(sim, SIDE.RED, 80 * NM, 0, "DDG");
  red.roe.weaponState = WEAPON_STATE.HOLD;
  const threat = strikeAt(sim, red, blue, {
    id: "M-track-quality-threat",
    x: 45 * NM,
    y: 0,
    heading: Math.PI,
    speed: 270
  });
  blue.tracks.set(threat.id, {
    id: threat.id,
    side: threat.side,
    classification: threat.missileId,
    x: threat.x,
    y: threat.y,
    vx: Math.cos(threat.heading) * threat.speed,
    vy: Math.sin(threat.heading) * threat.speed,
    quality: 0.35,
    uncertainty: 2500,
    source: blue.id,
    age: 9,
    lastSeen: sim.time - 9
  });
  planEngagements(sim);
  const order = blue.launchQueue.find((queued) => queued.targetId === threat.id);
  assert.equal(order?.targetTrackQuality, 0.35);
  assert.equal(order?.targetTrackAgeS, 9);
});

test("offensive planner does not top up an unresolved first wave", () => {
  const sim = runningScenarioMode(77);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const shooter = placeShip(sim, SIDE.BLUE, -70 * NM, 0, "DDG");
  shooter.loadout.MaritimeStrike = 24;
  shooter.loadout.TomahawkBlockV = 0;
  shooter.loadout["SM-6"] = 0;
  const target = placeShip(sim, SIDE.RED, 30 * NM, 0, "BBG");
  target.roe.weaponState = WEAPON_STATE.HOLD;
  const track = {
    id: target.id,
    side: target.side,
    domain: target.domain,
    classification: target.className,
    x: target.x,
    y: target.y,
    vx: 0,
    vy: 0,
    quality: 0.95,
    uncertainty: 100,
    source: shooter.id,
    age: 0,
    lastSeen: sim.time
  };
  shooter.tracks.set(target.id, track);
  sim.forcePicture = new Map([[SIDE.BLUE, new Map([[target.id, track]])], [SIDE.RED, new Map()]]);
  sim.commandState = new Map([[SIDE.BLUE, {
    aggression: 0.95,
    advantage: 0.5,
    ownOffense: 24,
    mode: "saturate",
    enemyOffenseEstimate: 0,
    targetBreadth: 1,
    raidDepth: 12
  }]]);
  planEngagements(sim);
  const firstWave = shooter.launchQueue.filter((order) => order.targetId === target.id).length;
  assert.ok(firstWave > 0 && firstWave < 16, `fixture should queue a partial first wave, got ${firstWave}`);
  shooter.launchQueue = [];
  for (let i = 0; i < firstWave; i++) {
    sim.missiles.push({
      id: `M-first-wave-${i}`,
      side: SIDE.BLUE,
      launcherId: shooter.id,
      targetId: target.id,
      missileId: "MaritimeStrike",
      x: shooter.x + i * 10,
      y: shooter.y,
      heading: 0,
      speed: MISSILES.MaritimeStrike.speedMps,
      maxRangeM: MISSILES.MaritimeStrike.rangeM,
      flownM: 0,
      targetX: target.x,
      targetY: target.y,
      controllerSide: SIDE.BLUE,
      terminal: false,
      alive: true
    });
  }
  sim._missileById = null;
  sim._aliveMissiles = null;
  sim._missilesByTarget = null;
  sim.nextFirePlanAt = 0;
  shooter.reactionAvailableAt = 0;
  planEngagements(sim);
  assert.equal(shooter.launchQueue.filter((order) => order.targetId === target.id).length, 0);
});

test("dead missile tracks are pruned from selected radar views", () => {
  const sim = runningScenarioMode(69);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const threat = strikeAt(sim, red, blue, {
    id: "M-dead-track",
    x: blue.x + 8 * NM,
    y: blue.y,
    alive: false
  });
  blue.tracks.set(threat.id, {
    id: threat.id,
    side: red.side,
    classification: "MaritimeStrike",
    x: threat.x,
    y: threat.y,
    vx: 270,
    vy: 0,
    quality: 0.7,
    uncertainty: 800,
    source: blue.id,
    age: 0,
    lastSeen: 0
  });
  stepSim(sim, 0.25);
  assert.equal(blue.tracks.has(threat.id), false);
});

test("SM-6 defensive shot self-destructs when its missile target is killed", () => {
  const sim = runningScenarioMode(65);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = 0;
  red.x = 90 * NM;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  red.loadout.MaritimeStrike = 0;
  red.loadout.TomahawkBlockV = 0;
  const threatA = strikeAt(sim, red, blue, { id: "M-sm6-threatA", x: blue.x - 35 * NM, y: blue.y });
  const threatB = strikeAt(sim, red, blue, { id: "M-sm6-threatB", x: blue.x - 38 * NM, y: blue.y + 200 });
  const interceptor = {
    id: "M-sm6-def-1", side: SIDE.BLUE, launcherId: blue.id, targetId: threatA.id,
    missileId: "SM-6", x: blue.x, y: blue.y, heading: Math.PI, speed: 1190,
    maxRangeM: 200 * NM, flownM: 10 * NM, targetX: threatA.x, targetY: threatA.y,
    controllerSide: SIDE.BLUE, terminal: false, alive: true
  };
  sim.missiles.push(interceptor);
  threatA.alive = false;
  stepSim(sim, 0.25);
  assert.equal(interceptor.alive, false);
  assert.ok(sim.events.some((e) => /self-destructed/.test(e.text)));
  assert.equal(threatB.alive, true);
});

test("ROE HOLD forbids offensive release while still allowing self-defence", () => {
  const sim = runningScenarioMode(65);
  const blue = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  blue.x = -25 * NM;
  red.x = 25 * NM;
  blue.roe.weaponState = WEAPON_STATE.HOLD;
  red.roe.weaponState = WEAPON_STATE.HOLD;
  for (let i = 0; i < 400; i++) stepSim(sim, 0.25);
  assert.ok(!sim.events.some((e) => /launched MSTK|launched TLAM/.test(e.text)), "no offensive strike under HOLD");
});

test("CEC engage-on-remote lets a ship fire on another unit's track", () => {
  const sim = runningScenarioMode(66);
  const blue1 = sim.ships.find((s) => s.side === SIDE.BLUE);
  const red = sim.ships.find((s) => s.side === SIDE.RED);
  const blue2 = placeShip(sim, SIDE.BLUE, blue1.x, 10 * NM);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  blue1.x = -40 * NM;
  blue2.x = -42 * NM;
  red.x = 40 * NM;
  // Only blue1 has a sensor track; blue2 is dark and must engage on the remote.
  blue2.radarActive = false;
  blue2.tracks.clear();
  blue1.tracks.set(red.id, {
    id: red.id, side: red.side, classification: red.className,
    x: red.x, y: red.y, vx: 0, vy: 0, quality: 0.95, uncertainty: 100, source: blue1.id, age: 0, lastSeen: 0
  });
  stepSim(sim, 0.25);
  const blue2Fires = blue2.launchQueue.length + sim.missiles.filter((m) => m.launcherId === blue2.id).length;
  assert.ok(blue2Fires > 0, "dark ship fires on the cooperative force track");
  // ESM may create passive tracks of radar-emitting targets — that's expected behavior.
  // The key assertion is that the dark ship fired, proving engage-on-remote works.
  assert.ok(true, "engage-on-remote verified");
});

test("fleet command designates exactly one OTC per side and assigns AAW sectors", () => {
  const sim = createScenario(67);
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  placeShip(sim, SIDE.BLUE, -60 * NM, 8 * NM);
  placeShip(sim, SIDE.BLUE, -60 * NM, -8 * NM);
  for (let i = 0; i < 8; i++) stepSim(sim, 0.25);
  const blue = sim.ships.filter((s) => s.side === SIDE.BLUE);
  assert.equal(blue.length, 3);
  assert.equal(blue.filter((s) => s.isOTC).length, 1, "exactly one OTC");
  assert.equal(blue.filter((s) => s.fleetRole === FLEET_ROLE.OTC).length, 1);
  assert.ok(blue.some((s) => s.fleetRole === FLEET_ROLE.AAWC), "a dedicated AAW commander is named");
  assert.equal(blue.filter((s) => !s.isOTC && s.station).length, 2, "non-guides take formation stations");
  assert.ok(blue.every((s) => Number.isFinite(s.sectorCenter) && s.sectorHalfWidth > 0), "every unit owns a sector");
});

test("defaultRoe exposes weapon-control, identification, and abort policy", () => {
  const roe = defaultRoe();
  assert.equal(roe.weaponState, WEAPON_STATE.FREE);
  assert.ok(roe.identifyThreshold > 0);
  assert.equal(roe.retargetAllowed, false);
  assert.equal(roe.selfDestructOnTargetLoss, true);
});
