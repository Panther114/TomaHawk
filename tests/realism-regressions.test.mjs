import test from "node:test";
import assert from "node:assert/strict";

import {
  MISSILES,
  NM,
  SCENARIO_MODE,
  SIDE,
  ciwsEffectiveness,
  clearSide,
  commandDelayScale,
  createScenario,
  effectiveDefenseChannelCapacity,
  missileDetectionEnvelope,
  missileManeuverAuthority,
  missileRcsRangeFactor,
  placeShip,
  updateMissiles,
  vlsCadenceScale
} from "../src/sim.js";

test("all recorded subsystem health values have bounded gameplay effects", () => {
  const sim = createScenario(801);
  const ship = sim.ships.find((unit) => unit.side === SIDE.BLUE);
  ship.subsystems.vls = 0.25;
  ship.subsystems.fireControl = 0.4;
  ship.subsystems.ciws = 0.3;
  ship.subsystems.cic = 0.2;

  assert.equal(vlsCadenceScale(ship), 4);
  assert.equal(effectiveDefenseChannelCapacity(ship, 4), 2);
  assert.equal(ciwsEffectiveness(ship), 0.3);
  assert.equal(commandDelayScale(ship), 2.2);

  ship.subsystems.vls = 0;
  ship.subsystems.ciws = 0;
  assert.equal(vlsCadenceScale(ship), 5, "emergency launch cadence stays finite");
  assert.equal(ciwsEffectiveness(ship), 0.15, "damaged mount retains a bounded residual chance");
});

test("extremely small missile signatures use the tighter radar visibility floor", () => {
  const sim = createScenario(802);
  const observer = sim.ships.find((unit) => unit.side === SIDE.BLUE);
  const aim9 = missileDetectionEnvelope(observer, {
    missileId: "AIM-9X",
    terminal: false
  });

  assert.ok(aim9.visibilityFactor > 0.35, "catalogue AIM-9X follows the fourth-root equation, not the floor");
  assert.equal(missileRcsRangeFactor(1e-8), 0.18);
});

test("live missile detection uses physical altitude during terminal descent", () => {
  const sim = createScenario(803);
  const observer = sim.ships.find((unit) => unit.side === SIDE.BLUE);
  const high = missileDetectionEnvelope(observer, {
    missileId: "TomahawkBlockV",
    terminal: true,
    altitudeM: 1200
  });
  const low = missileDetectionEnvelope(observer, {
    missileId: "TomahawkBlockV",
    terminal: true,
    altitudeM: 12
  });

  assert.equal(high.targetHeightM, 1200);
  assert.equal(low.targetHeightM, 12);
  assert.ok(high.horizonM > low.horizonM);
});

test("anti-ship missiles descend across the terminal run instead of teleporting", () => {
  const sim = createScenario(804);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const launcher = placeShip(sim, SIDE.BLUE, -60 * NM, 0, "DDG");
  const target = placeShip(sim, SIDE.RED, 0, 0, "DDG");
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  const spec = MISSILES.TomahawkBlockV;
  const missile = {
    id: "M-gradual-terminal-descent",
    side: SIDE.BLUE,
    launcherId: launcher.id,
    targetId: target.id,
    missileId: "TomahawkBlockV",
    launchRole: "anti_ship",
    x: target.x - spec.seekerRangeM + 100,
    y: target.y,
    heading: 0,
    speed: spec.speedMps,
    launchSpeedMps: spec.speedMps,
    maxRangeM: spec.rangeM,
    flownM: spec.rangeM * 0.5,
    altitudeM: 1200,
    targetX: target.x,
    targetY: target.y,
    controllerSide: SIDE.BLUE,
    terminal: false,
    alive: true
  };
  sim.missiles.push(missile);

  updateMissiles(sim, 0.25);
  assert.equal(missile.terminal, true);
  assert.ok(missile.altitudeM > 1100, "terminal entry preserves current physical altitude");
  updateMissiles(sim, 0.25);
  assert.ok(missile.altitudeM < 1200, "subsequent flight descends toward the terminal profile");
  assert.ok(missile.altitudeM > 12, "descent remains continuous, not an instant snap");
});

test("post-burnout missiles lose turn authority near maximum range", () => {
  const fresh = missileManeuverAuthority({ flownM: 0.2, maxRangeM: 1 });
  const late = missileManeuverAuthority({ flownM: 0.95, maxRangeM: 1 });

  assert.equal(fresh, 1);
  assert.ok(late < 0.65 && late >= 0.55, `late authority ${late}`);
});
