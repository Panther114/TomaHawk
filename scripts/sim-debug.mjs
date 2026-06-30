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
  createScenario, clearSide, placeShip, stepSim, SIDE, SCENARIO_MODE, NM, SHIP_CLASSES
} from "../src/sim.js";
import { PerfRecorder, BattleLogger } from "../src/sim/debug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = resolve(__dirname, "..", "debug");

const SEED = Number(process.env.SEED ?? 7);
const MAX_TICKS = Number(process.env.TICKS ?? 8000);
const DT = 0.25;
const FRAME_S = Number(process.env.FRAME_S ?? 15);

// A 5th-gen squadron type exists only after task #18 lands; fall back to the
// 4.5-gen VFA so the runner works before/after that change.
const GEN5 = SHIP_CLASSES.VFS ? "VFS" : "VFA";

// A HIGHLY ASYMMETRIC fight: an air-power task force (BLUE) raiding a surface
// fleet with no air arm (RED). The two sides differ in composition, geometry,
// and doctrine — it is meant to *resolve* (one side is destroyed), unlike the
// mirrored stalemate, and to exercise the full strike → RTB → rearm cycle as the
// dispersed BLUE squadrons shuttle to their airfield.
function buildAirBattle(seed) {
  const sim = createScenario(seed);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);

  // BLUE (west): an air armada — four squadrons (two stealth 5-gen + two 4.5-gen)
  // dispersed across the threat axis, a lone DDG picket, and an airfield to the
  // rear as the rearm/refuel node. Almost no surface combat power; it lives or
  // dies by the strike.
  placeShip(sim, SIDE.BLUE, -98 * NM, -34 * NM, "AFB");   // rear rearm node
  placeShip(sim, SIDE.BLUE, -78 * NM, -26 * NM, "DDG");   // single escort/picket
  placeShip(sim, SIDE.BLUE, -55 * NM, -6 * NM, GEN5);     // 5-gen stealth
  placeShip(sim, SIDE.BLUE, -58 * NM, -30 * NM, GEN5);    // 5-gen stealth
  placeShip(sim, SIDE.BLUE, -52 * NM, 16 * NM, "VFA");    // 4.5-gen
  placeShip(sim, SIDE.BLUE, -61 * NM, -46 * NM, "VFA");   // 4.5-gen

  // RED (east): a surface group strong in anti-ship punch but THIN on air defence
  // and with NO aircraft — a coastal defence battery (heavy anti-ship, no SAMs),
  // two frigates (shallow magazines), and an early-warning radar. Asymmetry of
  // *kind*: RED out-ranges BLUE's surface picket with land-based anti-ship fires,
  // but cannot weather a sustained air raid, so the battle resolves: BLUE's
  // persistent stand-off strike cracks RED while RED hammers the BLUE picket.
  placeShip(sim, SIDE.RED, 60 * NM, 6 * NM, "CDB");       // coastal anti-ship battery
  placeShip(sim, SIDE.RED, 55 * NM, 18 * NM, "FFG");
  placeShip(sim, SIDE.RED, 63 * NM, -6 * NM, "FFG");
  placeShip(sim, SIDE.RED, 70 * NM, 8 * NM, "EWR");       // early-warning radar

  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return sim;
}

function run() {
  const label = `air-battle seed=${SEED} gen5=${GEN5}`;
  const sim = buildAirBattle(SEED);
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
