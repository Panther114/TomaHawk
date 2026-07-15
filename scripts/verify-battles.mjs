// Multi-scenario long-run verification harness.
//
//   node scripts/verify-battles.mjs
//   ONLY=1,3 TICKS=8000 node scripts/verify-battles.mjs
//
// Runs several deterministic battles (small, unequal, large/complex), writes
// per-scenario tactical + perf logs under debug/verify/, and a machine/human
// summary JSON+text report. Collectors draw no RNG.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  createScenario, clearSide, placeShip, stepSim, SIDE, SCENARIO_MODE, NM, MISSILES
} from "../src/sim.js";
import { PerfRecorder, BattleLogger } from "../src/sim/debug.js";
import { offensiveMissileCount } from "../src/sim/ships.js";
import { isAircraft, isAirfield, isCarrier, aliveAircraftCount } from "../src/sim/aircraft.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "debug", "verify");

const DT = 0.25;
const DEFAULT_TICKS = Number(process.env.TICKS ?? 24000); // 6000s sim @ 0.25
const FRAME_S = Number(process.env.FRAME_S ?? 30);
const ONLY = process.env.ONLY
  ? new Set(String(process.env.ONLY).split(",").map((s) => s.trim()))
  : null;

function empty(seed, mapId = "openSea") {
  const sim = createScenario(seed, mapId);
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  return sim;
}

function start(sim) {
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  sim.debugPhaseLog = true;
  return sim;
}

// --- scenario builders ------------------------------------------------------

/** 1. Small peer naval duel — pure ship fight, long-range TLAM/MSTK. */
function scenarioSmallNaval(seed) {
  const sim = empty(seed);
  placeShip(sim, SIDE.BLUE, -45 * NM, 0, "DDG");
  placeShip(sim, SIDE.BLUE, -48 * NM, 6 * NM, "FFG");
  placeShip(sim, SIDE.RED, 45 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 48 * NM, -6 * NM, "FFG");
  return start(sim);
}

/** 2. Small unequal — lone FFG + F15C vs heavy DDG/CCG/SAM screen. */
function scenarioSmallUnequal(seed) {
  const sim = empty(seed);
  placeShip(sim, SIDE.BLUE, -50 * NM, 0, "FFG");
  placeShip(sim, SIDE.BLUE, -40 * NM, 8 * NM, "F15C");
  placeShip(sim, SIDE.BLUE, -70 * NM, 0, "AFB");
  placeShip(sim, SIDE.RED, 40 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 45 * NM, 8 * NM, "CCG");
  placeShip(sim, SIDE.RED, 55 * NM, 0, "SAM");
  placeShip(sim, SIDE.RED, 50 * NM, -10 * NM, "EWR");
  return start(sim);
}

/** 3. Carrier strike group vs coastal battery (unequal, carrier basing). */
function scenarioCarrierCoastal(seed) {
  const sim = empty(seed);
  // BLUE CBG
  placeShip(sim, SIDE.BLUE, -70 * NM, 0, "CVN");
  placeShip(sim, SIDE.BLUE, -65 * NM, 8 * NM, "DDG");
  placeShip(sim, SIDE.BLUE, -65 * NM, -8 * NM, "DDG");
  placeShip(sim, SIDE.BLUE, -60 * NM, 0, "FFG");
  placeShip(sim, SIDE.BLUE, -55 * NM, 5 * NM, "F35C");
  placeShip(sim, SIDE.BLUE, -55 * NM, -5 * NM, "F35C");
  placeShip(sim, SIDE.BLUE, -58 * NM, 12 * NM, "F15N");
  placeShip(sim, SIDE.BLUE, -75 * NM, 4 * NM, "AWAC");
  // RED coastal
  placeShip(sim, SIDE.RED, 55 * NM, 0, "SAM");
  placeShip(sim, SIDE.RED, 58 * NM, 10 * NM, "SAM");
  placeShip(sim, SIDE.RED, 50 * NM, -8 * NM, "CDB");
  placeShip(sim, SIDE.RED, 60 * NM, 5 * NM, "DEB");
  placeShip(sim, SIDE.RED, 65 * NM, 0, "EWR");
  placeShip(sim, SIDE.RED, 48 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 70 * NM, 8 * NM, "AFB");
  placeShip(sim, SIDE.RED, 40 * NM, 6 * NM, "F22");
  return start(sim);
}

/** 4. Large complex peer — ships + ground + mixed air + carriers both sides. */
function scenarioLargePeer(seed) {
  const sim = empty(seed);
  // BLUE west
  placeShip(sim, SIDE.BLUE, -90 * NM, 0, "CVN");
  placeShip(sim, SIDE.BLUE, -80 * NM, 0, "DDG");
  placeShip(sim, SIDE.BLUE, -78 * NM, 10 * NM, "DDG");
  placeShip(sim, SIDE.BLUE, -78 * NM, -10 * NM, "CCG");
  placeShip(sim, SIDE.BLUE, -85 * NM, 15 * NM, "FFG");
  placeShip(sim, SIDE.BLUE, -95 * NM, 5 * NM, "SAM");
  placeShip(sim, SIDE.BLUE, -92 * NM, -12 * NM, "CDB");
  placeShip(sim, SIDE.BLUE, -100 * NM, 0, "AFB");
  placeShip(sim, SIDE.BLUE, -70 * NM, 0, "F22");
  placeShip(sim, SIDE.BLUE, -68 * NM, 12 * NM, "F35C");
  placeShip(sim, SIDE.BLUE, -68 * NM, -12 * NM, "F15N");
  placeShip(sim, SIDE.BLUE, -72 * NM, 8 * NM, "F15C");
  placeShip(sim, SIDE.BLUE, -88 * NM, 8 * NM, "AWAC");
  // RED east
  placeShip(sim, SIDE.RED, 90 * NM, 0, "CVN");
  placeShip(sim, SIDE.RED, 80 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 78 * NM, 10 * NM, "DDG");
  placeShip(sim, SIDE.RED, 78 * NM, -10 * NM, "CCG");
  placeShip(sim, SIDE.RED, 85 * NM, -15 * NM, "FFG");
  placeShip(sim, SIDE.RED, 95 * NM, -5 * NM, "SAM");
  placeShip(sim, SIDE.RED, 92 * NM, 12 * NM, "DEB");
  placeShip(sim, SIDE.RED, 100 * NM, 0, "AFB");
  placeShip(sim, SIDE.RED, 70 * NM, 0, "F22");
  placeShip(sim, SIDE.RED, 68 * NM, -12 * NM, "F35A");
  placeShip(sim, SIDE.RED, 68 * NM, 12 * NM, "F35C");
  placeShip(sim, SIDE.RED, 72 * NM, -8 * NM, "F15E");
  placeShip(sim, SIDE.RED, 88 * NM, -8 * NM, "AWAC");
  return start(sim);
}

/** 5. Air-heavy unequal raid — BLUE massed strike vs RED SAM umbrella. */
function scenarioAirRaid(seed) {
  const sim = empty(seed);
  placeShip(sim, SIDE.BLUE, -90 * NM, 0, "AFB");
  placeShip(sim, SIDE.BLUE, -40 * NM, 0, "F15E");
  placeShip(sim, SIDE.BLUE, -42 * NM, 10 * NM, "F15E");
  placeShip(sim, SIDE.BLUE, -42 * NM, -10 * NM, "F35A");
  placeShip(sim, SIDE.BLUE, -38 * NM, 5 * NM, "F15N");
  placeShip(sim, SIDE.BLUE, -45 * NM, 0, "F15C");
  placeShip(sim, SIDE.BLUE, -50 * NM, 8 * NM, "F22");
  placeShip(sim, SIDE.BLUE, -70 * NM, 0, "AWAC");
  placeShip(sim, SIDE.BLUE, -55 * NM, -5 * NM, "DDG");

  placeShip(sim, SIDE.RED, 40 * NM, 0, "SAM");
  placeShip(sim, SIDE.RED, 45 * NM, 8 * NM, "SAM");
  placeShip(sim, SIDE.RED, 45 * NM, -8 * NM, "SAM");
  placeShip(sim, SIDE.RED, 50 * NM, 0, "EWR");
  placeShip(sim, SIDE.RED, 55 * NM, 5 * NM, "DEB");
  placeShip(sim, SIDE.RED, 48 * NM, 12 * NM, "CDB");
  placeShip(sim, SIDE.RED, 35 * NM, 0, "DDG");
  placeShip(sim, SIDE.RED, 60 * NM, 0, "AFB");
  placeShip(sim, SIDE.RED, 30 * NM, 6 * NM, "F15C");
  return start(sim);
}

const SCENARIOS = [
  { id: "1", name: "small-naval-peer", build: scenarioSmallNaval, seed: 101, ticks: DEFAULT_TICKS },
  { id: "2", name: "small-unequal", build: scenarioSmallUnequal, seed: 202, ticks: DEFAULT_TICKS },
  { id: "3", name: "carrier-vs-coastal", build: scenarioCarrierCoastal, seed: 303, ticks: DEFAULT_TICKS },
  { id: "4", name: "large-peer-complex", build: scenarioLargePeer, seed: 404, ticks: DEFAULT_TICKS },
  { id: "5", name: "air-raid-unequal", build: scenarioAirRaid, seed: 505, ticks: DEFAULT_TICKS }
];

// --- analysis ---------------------------------------------------------------

function countEvents(sim, re) {
  let n = 0;
  for (const e of sim.events || []) {
    const text = e.text || e.message || "";
    if (re.test(text)) n++;
  }
  return n;
}

function launchCounts(sim) {
  const counts = Object.create(null);
  const bump = (id) => { counts[id] = (counts[id] || 0) + 1; };
  for (const m of sim.missiles) bump(m.missileId);
  // Also count still-queued (not yet left the rail) for end-state inventory of intent.
  for (const s of sim.ships) {
    for (const o of s.launchQueue || []) bump(o.missileId);
  }
  return counts;
}

function sideSnapshot(sim, side) {
  const units = sim.ships.filter((s) => s.side === side);
  const alive = units.filter((s) => s.alive);
  const ships = alive.filter((s) => (s.domain ?? "sea") === "sea" && !s.isAirfield);
  const ground = alive.filter((s) => s.domain === "ground" || (s.isFixed && !s.isAirfield));
  const air = alive.filter((s) => s.domain === "air");
  const carriers = alive.filter((s) => isCarrier(s) || (s.isAirfield && s.domain === "sea"));
  const fields = alive.filter((s) => isAirfield(s));
  const offense = alive.reduce((n, s) => n + offensiveMissileCount(s, true), 0);
  const planes = air.reduce((n, s) => n + aliveAircraftCount(s), 0);
  const rearming = air.filter((s) => s.airState === "rearming").map((s) => s.id);
  const rtb = air.filter((s) => s.airState === "rtb").map((s) => s.id);
  return {
    alive: alive.length,
    ships: ships.length,
    ground: ground.length,
    air: air.length,
    planes,
    carriers: carriers.length,
    airfields: fields.length,
    offense,
    rearming,
    rtb,
    hulls: alive.map((s) => s.hull)
  };
}

function analyze(sim, perf, wallMs, ticks) {
  const events = sim.events || [];
  const launches = launchCounts(sim);
  const flags = [];

  // Realism / health checks (soft warnings, not hard fails).
  const blue = sideSnapshot(sim, SIDE.BLUE);
  const red = sideSnapshot(sim, SIDE.RED);
  const intercepts = countEvents(sim, /intercepted/i);
  const misses = countEvents(sim, /failed to intercept/i);
  const decoys = countEvents(sim, /decoyed/i);
  const splashes = countEvents(sim, /splashed|ran out of fuel/i);
  const rearmPhases = countEvents(sim, /phase -> rearming/i);
  const deckWait = countEvents(sim, /phase -> deck-wait/i);
  const rtbPhases = countEvents(sim, /phase -> rtb/i);
  const darkEagle = launches.DarkEagle || 0;
  const jsow = launches["AGM-154"] || 0;
  const harpoon = launches["AGM-84"] || 0;
  const aam = (launches["AIM-120C"] || 0) + (launches["AIM-120D"] || 0) + (launches["AIM-9X"] || 0);

  if (ticks > 200 && Object.keys(launches).length === 0) {
    flags.push("NO_LAUNCHES: no missiles ever left a rail");
  }
  // Peer fights with DEBs present should eventually fire them.
  const debAliveStart = true; // approximate from final remaining not ideal
  if ((sim._scenarioName || "").includes("large") || (sim._scenarioName || "").includes("carrier")) {
    // soft: if neither side used surface air munitions in air-capable fights
  }
  // Fuel splash with nearby base of matching type is suspicious.
  if (splashes > 3 && rearmPhases === 0 && (blue.airfields + red.airfields) > 0) {
    flags.push(`FUEL_SPLASH_NO_REARM: ${splashes} fuel/splash events but zero rearming phases`);
  }
  // Parked on carrier should appear in carrier scenarios when capable air RTBs.
  const avgMs = wallMs / Math.max(1, ticks);
  const s = perf.summary();
  if (s.p95Ms > 8) flags.push(`PERF_P95_HIGH: p95 ${s.p95Ms.toFixed(2)} ms/tick`);
  if (s.maxMs > 40) flags.push(`PERF_SPIKE: max ${s.maxMs.toFixed(2)} ms/tick`);

  // Stuck rearming forever?
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const snap = side === SIDE.BLUE ? blue : red;
    for (const id of snap.rearming) {
      const u = sim.ships.find((x) => x.id === id);
      if (u && u.airState === "rearming" && sim.time > (u.rearmUntil || 0) + 5) {
        flags.push(`STUCK_REARM: ${id} still rearming past rearmUntil`);
      }
    }
  }

  // Carrier deck stick residual: rearming air far from home base.
  for (const unit of sim.ships) {
    if (!unit.alive || unit.domain !== "air" || unit.airState !== "rearming") continue;
    const base = sim.ships.find((b) => b.id === unit.homeBaseId);
    if (!base?.alive) {
      flags.push(`REARM_NO_BASE: ${unit.id} rearming without live homeBase`);
      continue;
    }
    const d = Math.hypot(unit.x - base.x, unit.y - base.y);
    if (d > 500) flags.push(`DECK_DESYNC: ${unit.id} ${d.toFixed(0)}m from base ${base.id}`);
  }

  return {
    ticks,
    simTimeS: +sim.time.toFixed(1),
    outcome: sim.ended ?? (sim.mode === SCENARIO_MODE.ENDED ? "ended" : "ongoing"),
    wallMs: +wallMs.toFixed(1),
    avgMsTick: +avgMs.toFixed(3),
    perf: {
      p50: +s.p50Ms.toFixed(3),
      p95: +s.p95Ms.toFixed(3),
      max: +s.maxMs.toFixed(3),
      peakEntities: s.peakEntities,
      peakMissiles: s.peakMissiles
    },
    blue,
    red,
    launches,
    counts: { intercepts, misses, decoys, splashes, rearmPhases, deckWait, rtbPhases, darkEagle, jsow, harpoon, aam },
    eventTotal: events.length,
    flags,
    lastEvents: events.slice(-12).map((e) => ({
      t: e.t ?? e.time,
      side: e.side,
      text: e.text || e.message
    }))
  };
}

function runOne(spec) {
  const label = `${spec.name} seed=${spec.seed}`;
  const sim = spec.build(spec.seed);
  sim._scenarioName = spec.name;
  const perf = new PerfRecorder({ label });
  const logger = new BattleLogger({ intervalS: FRAME_S, label });

  const t0 = performance.now();
  let tick = 0;
  const maxTicks = spec.ticks;
  for (; tick < maxTicks; tick++) {
    const start = process.hrtime.bigint();
    stepSim(sim, DT);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    perf.record(sim, ms);
    logger.sample(sim);
    if (sim.mode === SCENARIO_MODE.ENDED) break;
  }
  logger.sample(sim, { force: true });
  const wallMs = performance.now() - t0;

  const analysis = analyze(sim, perf, wallMs, tick + (sim.mode === SCENARIO_MODE.ENDED ? 1 : 0));
  analysis.name = spec.name;
  analysis.seed = spec.seed;
  analysis.id = spec.id;

  mkdirSync(OUT_DIR, { recursive: true });
  const base = `${spec.id}-${spec.name}`;
  writeFileSync(resolve(OUT_DIR, `${base}-sim.log`), logger.format(), "utf8");
  writeFileSync(resolve(OUT_DIR, `${base}-perf.log`), perf.format(), "utf8");
  writeFileSync(resolve(OUT_DIR, `${base}-summary.json`), JSON.stringify(analysis, null, 2), "utf8");

  return analysis;
}

function formatReport(results) {
  const lines = [];
  lines.push("TomaHawk multi-scenario battle verification");
  lines.push(`generated ${new Date().toISOString()}`);
  lines.push("");
  for (const r of results) {
    lines.push("=".repeat(72));
    lines.push(`#${r.id} ${r.name}  seed=${r.seed}`);
    lines.push(`  outcome=${r.outcome}  simTime=${r.simTimeS}s  ticks=${r.ticks}  wall=${(r.wallMs / 1000).toFixed(1)}s`);
    lines.push(`  perf avg=${r.avgMsTick}ms  p50=${r.perf.p50}  p95=${r.perf.p95}  max=${r.perf.max}  peakEnt=${r.perf.peakEntities} msl=${r.perf.peakMissiles}`);
    lines.push(`  BLUE alive=${r.blue.alive} ships=${r.blue.ships} ground=${r.blue.ground} air=${r.blue.air} planes=${r.blue.planes} offense=${r.blue.offense}`);
    lines.push(`       hulls=[${r.blue.hulls.join(",")}] rearming=${r.blue.rearming.length} rtb=${r.blue.rtb.length}`);
    lines.push(`  RED  alive=${r.red.alive} ships=${r.red.ships} ground=${r.red.ground} air=${r.red.air} planes=${r.red.planes} offense=${r.red.offense}`);
    lines.push(`       hulls=[${r.red.hulls.join(",")}] rearming=${r.red.rearming.length} rtb=${r.red.rtb.length}`);
    const topLaunch = Object.entries(r.launches).sort((a, b) => b[1] - a[1]).slice(0, 12)
      .map(([k, v]) => `${k}:${v}`).join(" ");
    lines.push(`  launches  ${topLaunch || "(none)"}`);
    lines.push(`  events    total=${r.eventTotal} intercepts=${r.counts.intercepts} miss=${r.counts.misses} decoy=${r.counts.decoys} splash=${r.counts.splashes}`);
    lines.push(`            rearmPhases=${r.counts.rearmPhases} deckWait=${r.counts.deckWait} rtbPhases=${r.counts.rtbPhases}`);
    lines.push(`            DEB=${r.counts.darkEagle} JSOW=${r.counts.jsow} HPN=${r.counts.harpoon} AAM=${r.counts.aam}`);
    if (r.flags.length) {
      lines.push(`  FLAGS:`);
      for (const f of r.flags) lines.push(`    - ${f}`);
    } else {
      lines.push(`  FLAGS: (none)`);
    }
    lines.push(`  last events:`);
    for (const e of r.lastEvents) {
      lines.push(`    t=${e.t} [${e.side}] ${e.text}`);
    }
    lines.push("");
  }
  lines.push("=".repeat(72));
  const allFlags = results.flatMap((r) => r.flags.map((f) => `${r.name}: ${f}`));
  lines.push(`TOTAL scenarios=${results.length}  flagged=${allFlags.length}`);
  if (allFlags.length) {
    for (const f of allFlags) lines.push(`  ! ${f}`);
  }
  const avgP95 = results.reduce((s, r) => s + r.perf.p95, 0) / results.length;
  lines.push(`mean p95 ms/tick across scenarios: ${avgP95.toFixed(3)}`);
  return lines.join("\n");
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const selected = SCENARIOS.filter((s) => !ONLY || ONLY.has(s.id));
  console.log(`Running ${selected.length} scenarios (max ${DEFAULT_TICKS} ticks / ${(DEFAULT_TICKS * DT).toFixed(0)}s sim each)...`);
  const results = [];
  for (const spec of selected) {
    process.stdout.write(`  #${spec.id} ${spec.name} ... `);
    const r = runOne(spec);
    results.push(r);
    console.log(`${r.outcome} @ ${r.simTimeS}s  p95=${r.perf.p95}ms  flags=${r.flags.length}`);
  }
  const report = formatReport(results);
  writeFileSync(resolve(OUT_DIR, "REPORT.txt"), report, "utf8");
  writeFileSync(resolve(OUT_DIR, "REPORT.json"), JSON.stringify(results, null, 2), "utf8");
  console.log("\n" + report);
  console.log(`\nWrote logs to ${OUT_DIR}`);
}

main();
