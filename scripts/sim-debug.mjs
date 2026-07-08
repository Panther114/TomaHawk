// Headless aircraft-scenario debug run.
//
//   node scripts/sim-debug.mjs            # default seed/scenario
//   node --expose-gc scripts/sim-debug.mjs
//
// Builds a deterministic air/surface battle (squadrons + ships + airfields on
// both sides), runs it to a conclusion, and writes two logs to debug/ that are
// OVERWRITTEN every run:
//
//   debug/perf-debug.log  — device/workload performance trace (PerfRecorder)
//   debug/sim-debug.log   — tactical narrative you can read to "watch" the fight
//
// The point is to be able to inspect AI behaviour and device cost without a
// browser. Determinism is unaffected (the collectors are read-only).

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createScenario, clearSide, placeShip, stepSim, SIDE, SCENARIO_MODE, NM
} from "../src/sim.js";
import { PerfRecorder, BattleLogger } from "../src/sim/debug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = resolve(__dirname, "..", "debug");

const SEED = Number(process.env.SEED ?? 7);
const MAX_TICKS = Number(process.env.TICKS ?? 20000);
const DT = 0.25;
const FRAME_S = Number(process.env.FRAME_S ?? 8);

// A LARGE, ASYMMETRIC, mixed-domain fight exercising every current unit type on
// both sides at once — air (all six fixed-identity squadrons plus the AWAC
// command-hub asset), naval, and fixed ground (SAM/CDB/DEB/EWR/airfield) — so the
// debug log can be read as a systematic trace of every kind of unit
// interaction: air-vs-air, air-vs-ship, air-vs-ground, ship-vs-ship,
// ground-vs-ship, and layered SAM defence against a strike.
//
// BLUE is an air-heavy expeditionary force (six strike/fighter squadrons plus
// an AWAC, backed by a thin two-ship surface escort and a rear airfield). RED
// is a defended coastal group (heavy naval + fixed ground defence, one
// contesting air-superiority squadron) — asymmetric in *kind*, not just size,
// so the battle is decided by how well air, naval, and ground doctrine
// interact rather than by a simple numbers mismatch.
function buildLargeAsymmetricBattle(seed) {
  const sim = createScenario(seed);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);

  // BLUE (west): rear airfield, a two-ship surface escort, one squadron of
  // each of the six fixed-identity airframes — every generation/role pairing
  // flying in the same battle — plus an AWAC orbiting behind the formation
  // as a command hub.
  placeShip(sim, SIDE.BLUE, -100 * NM, -20 * NM, "AFB");
  placeShip(sim, SIDE.BLUE, -70 * NM, -10 * NM, "DDG");
  placeShip(sim, SIDE.BLUE, -72 * NM, 10 * NM, "FFG");
  placeShip(sim, SIDE.BLUE, -55 * NM, 0 * NM, "F22");    // 5-gen air-superiority
  placeShip(sim, SIDE.BLUE, -58 * NM, 20 * NM, "F35A");  // 5-gen anti-ground
  placeShip(sim, SIDE.BLUE, -58 * NM, -25 * NM, "F35C"); // 5-gen anti-ship
  placeShip(sim, SIDE.BLUE, -50 * NM, -10 * NM, "F15C"); // 4.5-gen air-superiority
  placeShip(sim, SIDE.BLUE, -52 * NM, 30 * NM, "F15E");  // 4.5-gen anti-ground
  placeShip(sim, SIDE.BLUE, -52 * NM, -35 * NM, "F15N"); // 4.5-gen anti-ship
  placeShip(sim, SIDE.BLUE, -90 * NM, -10 * NM, "AWAC"); // command hub / moving radar

  // RED (east): a defended coastal group — cruiser + two frigates, a coastal SAM
  // battery, a coastal anti-ship battery, an early-warning radar, an airfield,
  // and one air-superiority squadron to contest BLUE's strikers.
  placeShip(sim, SIDE.RED, 68 * NM, -20 * NM, "CCG");
  placeShip(sim, SIDE.RED, 72 * NM, 20 * NM, "FFG");
  placeShip(sim, SIDE.RED, 78 * NM, -30 * NM, "FFG");
  placeShip(sim, SIDE.RED, 65 * NM, 0 * NM, "SAM");
  placeShip(sim, SIDE.RED, 60 * NM, 15 * NM, "CDB");
  placeShip(sim, SIDE.RED, 75 * NM, -5 * NM, "EWR");
  placeShip(sim, SIDE.RED, 95 * NM, 15 * NM, "AFB");
  placeShip(sim, SIDE.RED, 55 * NM, 5 * NM, "F15C");     // contesting air-superiority

  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  sim.debugPhaseLog = true;
  return sim;
}

function run() {
  const label = `large-asymmetric seed=${SEED}`;
  const sim = buildLargeAsymmetricBattle(SEED);
  const perf = new PerfRecorder({ label });
  const logger = new BattleLogger({ intervalS: FRAME_S, label });

  let tick = 0;
  for (; tick < MAX_TICKS; tick++) {
    const start = process.hrtime.bigint();
    stepSim(sim, DT);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    perf.record(sim, ms);
    logger.sample(sim);
    if (sim.mode === SCENARIO_MODE.ENDED) break;
  }
  logger.sample(sim, { force: true }); // final frame

  mkdirSync(DEBUG_DIR, { recursive: true });
  writeFileSync(resolve(DEBUG_DIR, "perf-debug.log"), perf.format(), "utf8");
  writeFileSync(resolve(DEBUG_DIR, "sim-debug.log"), logger.format(), "utf8");

  const aliveBlue = sim.ships.filter((s) => s.alive && s.side === SIDE.BLUE).length;
  const aliveRed = sim.ships.filter((s) => s.alive && s.side === SIDE.RED).length;
  const s = perf.summary();
  console.log(`run complete: ${tick + 1} ticks, sim ${sim.time.toFixed(1)}s, outcome=${sim.ended ?? "draw/ongoing"}`);
  console.log(`survivors: BLUE ${aliveBlue}, RED ${aliveRed}`);
  console.log(`perf: avg ${s.avgMs.toFixed(3)}ms/tick, p95 ${s.p95Ms.toFixed(3)}, max ${s.maxMs.toFixed(3)}, peak entities ${s.peakEntities} (missiles ${s.peakMissiles})`);
  console.log(`wrote debug/perf-debug.log and debug/sim-debug.log`);
}

run();
