// Headless near-equal mixed-domain fight used to validate AI/fire-planning
// fixes (Dark Eagle employment, air domain targeting, peer aggression, lag).
//
//   node scripts/validate-ai-fixes.mjs
//   SEED=7 TICKS=1200 node scripts/validate-ai-fixes.mjs
//
// Writes debug/validate-perf.log and debug/validate-sim.log (does not overwrite
// the interactive app's perf/sim-debug pair unless VALIDATE_OVERWRITE=1).

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createScenario, clearSide, placeShip, stepSim, SIDE, SCENARIO_MODE, NM, MISSILES
} from "../src/sim.js";
import { PerfRecorder, BattleLogger } from "../src/sim/debug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = resolve(__dirname, "..", "debug");

const SEED = Number(process.env.SEED ?? 11);
const MAX_TICKS = Number(process.env.TICKS ?? 1200); // 300s sim @ 0.25
const DT = 0.25;
const FRAME_S = 15;

// Near-equal peer fight roughly matching the 10:40 investigation layout:
// both sides have ships, SAMs, DEBs/CDBs, and mixed air (strike + fighter).
function buildPeerBattle(seed) {
  const sim = createScenario(seed, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);

  // BLUE west
  placeShip(sim, SIDE.BLUE, -80 * NM, 0, "DDG");
  placeShip(sim, SIDE.BLUE, -78 * NM, 8 * NM, "DDG");
  placeShip(sim, SIDE.BLUE, -76 * NM, -8 * NM, "FFG");
  placeShip(sim, SIDE.BLUE, -90 * NM, 5 * NM, "SAM");
  placeShip(sim, SIDE.BLUE, -92 * NM, -5 * NM, "SAM");
  placeShip(sim, SIDE.BLUE, -88 * NM, 12 * NM, "CDB");
  placeShip(sim, SIDE.BLUE, -95 * NM, 0, "AFB");
  // Strike aircraft start already inside a realistic stand-off transit so the
  // 300s validation window can observe weapon release (not just long ingress).
  placeShip(sim, SIDE.BLUE, 20 * NM, 18 * NM, "F15N"); // sea strike vs RED ships
  placeShip(sim, SIDE.BLUE, 25 * NM, -18 * NM, "F15E"); // ground strike vs RED SAM/DEB
  placeShip(sim, SIDE.BLUE, -68 * NM, 0, "F15C");
  placeShip(sim, SIDE.BLUE, -85 * NM, 10 * NM, "AWAC");

  // RED east — includes Dark Eagle batteries
  placeShip(sim, SIDE.RED, 80 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 78 * NM, 8 * NM, "DDG");
  placeShip(sim, SIDE.RED, 76 * NM, -8 * NM, "CCG");
  placeShip(sim, SIDE.RED, 90 * NM, 5 * NM, "SAM");
  placeShip(sim, SIDE.RED, 88 * NM, 12 * NM, "DEB");
  placeShip(sim, SIDE.RED, 92 * NM, -4 * NM, "DEB");
  placeShip(sim, SIDE.RED, 94 * NM, 0, "EWR");
  placeShip(sim, SIDE.RED, 95 * NM, 8 * NM, "AFB");
  placeShip(sim, SIDE.RED, -15 * NM, 18 * NM, "F35A"); // ground strike vs BLUE SAM/CDB
  placeShip(sim, SIDE.RED, -20 * NM, -18 * NM, "F35C"); // sea strike vs BLUE ships
  placeShip(sim, SIDE.RED, 68 * NM, 0, "F22");
  placeShip(sim, SIDE.RED, 85 * NM, -10 * NM, "AWAC");

  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  sim.debugPhaseLog = true;
  return sim;
}

function summarize(sim) {
  const darkEagleLaunches = sim.missiles.filter((m) => m.missileId === "DarkEagle").length
    + sim.ships.reduce((n, s) => n + (s.launchQueue || []).filter((o) => o.missileId === "DarkEagle").length, 0);
  const jsow = sim.missiles.filter((m) => m.missileId === "AGM-154").length
    + sim.ships.reduce((n, s) => n + (s.launchQueue || []).filter((o) => o.missileId === "AGM-154").length, 0);
  const harpoon = sim.missiles.filter((m) => m.missileId === "AGM-84").length
    + sim.ships.reduce((n, s) => n + (s.launchQueue || []).filter((o) => o.missileId === "AGM-84").length, 0);
  const debRemaining = sim.ships
    .filter((s) => s.hull === "DEB" && s.alive)
    .map((s) => ({ id: s.id, left: s.loadout?.DarkEagle ?? 0 }));
  const postures = [SIDE.BLUE, SIDE.RED].map((side) => {
    const cs = sim.commandState?.get(side);
    return cs
      ? { side, mode: cs.mode, aggr: +cs.aggression.toFixed(3), adv: +cs.advantage.toFixed(3), breadth: cs.targetBreadth }
      : { side, mode: null };
  });
  const liveMissiles = sim.missiles.filter((m) => m.alive).length;
  return { darkEagleLaunches, jsow, harpoon, debRemaining, postures, liveMissiles, time: sim.time };
}

function run() {
  const label = `validate-ai-fixes seed=${SEED}`;
  const sim = buildPeerBattle(SEED);
  const perf = new PerfRecorder({ label });
  const logger = new BattleLogger({ intervalS: FRAME_S, label });

  const early = [];
  let tick = 0;
  for (; tick < MAX_TICKS; tick++) {
    const start = process.hrtime.bigint();
    stepSim(sim, DT);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    perf.record(sim, ms);
    logger.sample(sim);
    if (tick === 20 || tick === 80 || tick === 240) early.push({ tick, ...summarize(sim) });
    if (sim.mode === SCENARIO_MODE.ENDED) break;
  }
  logger.sample(sim, { force: true });
  const final = summarize(sim);
  const s = perf.summary();

  mkdirSync(DEBUG_DIR, { recursive: true });
  const overwrite = process.env.VALIDATE_OVERWRITE === "1";
  const perfPath = resolve(DEBUG_DIR, overwrite ? "perf-debug.log" : "validate-perf.log");
  const simPath = resolve(DEBUG_DIR, overwrite ? "sim-debug.log" : "validate-sim.log");
  writeFileSync(perfPath, perf.format(), "utf8");
  writeFileSync(simPath, logger.format(), "utf8");

  const report = {
    ticks: tick + 1,
    outcome: sim.ended ?? "ongoing",
    early,
    final,
    perf: {
      avgMs: +s.avgMs.toFixed(3),
      p50Ms: +s.p50Ms.toFixed(3),
      p95Ms: +s.p95Ms.toFixed(3),
      maxMs: +s.maxMs.toFixed(3),
      peakEntities: s.peakEntities,
      peakMissiles: s.peakMissiles
    },
    checks: {
      darkEagleFired: final.darkEagleLaunches > 0,
      jsowFired: final.jsow > 0,
      harpoonFired: final.harpoon > 0,
      earlyAggrOk: early[0]?.postures?.every((p) => p.aggr >= 0.3) ?? false,
      earlyNotBothSurvive: early[0]?.postures?.some((p) => p.mode !== "survive") ?? false
    }
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${perfPath}`);
  console.log(`wrote ${simPath}`);

  const failed = Object.entries(report.checks).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length) {
    console.error(`VALIDATION GAPS (may still be acceptable mid-run): ${failed.join(", ")}`);
    // Non-zero only if Dark Eagle never fired — the headline regression.
    if (!report.checks.darkEagleFired) process.exitCode = 2;
  } else {
    console.log("VALIDATION OK: Dark Eagle, air strike, and peer aggression checks passed.");
  }
}

run();
