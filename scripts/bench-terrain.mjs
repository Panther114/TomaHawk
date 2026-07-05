// Terrain-navigation micro-benchmark.
//
//   npm run bench:terrain
//   BASELINE_TERRAIN_MS=26.48 npm run bench:terrain
//
// Measures the East China Sea blocked-route path that dominates browser sim
// cost when a surface ship repeatedly replans around land. This is a comparison
// harness, not an absolute pass/fail gate.

import { createScenario, moveShips, NM } from "../src/sim.js";
import { isWaterPoint, projectLonLat } from "../src/world/terrain.js";

const DT = 0.25;
const SUSTAINED_TICKS = 80;
const BLOCKED_START = projectLonLat(122.3, 30.9);
const BLOCKED_GOAL = projectLonLat(121.47, 31.23);

function elapsedMs(fn) {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function buildBlockedCoastalScenario() {
  const sim = createScenario(17, "eastChinaSea");
  const ship = sim.ships[0];
  Object.assign(ship, BLOCKED_START);
  ship.waypoint = { ...BLOCKED_GOAL };
  return { sim, ship };
}

function buildOpenSeaControlScenario() {
  const sim = createScenario(17, "openSea");
  const ship = sim.ships[0];
  Object.assign(ship, { x: -40 * NM, y: 0 });
  ship.waypoint = { x: 40 * NM, y: 8 * NM };
  return { sim, ship };
}

function runSustained({ sim, ship }, ticks) {
  for (let i = 0; i < ticks; i++) {
    sim.time += DT;
    moveShips(sim, DT);
    if (ship.domain === "sea" && !isWaterPoint(ship, sim.mapId, 0)) {
      throw new Error(`ship left water at tick ${i}`);
    }
  }
}

const first = buildBlockedCoastalScenario();
const firstPlanMs = elapsedMs(() => moveShips(first.sim, DT));

const sustained = buildBlockedCoastalScenario();
moveShips(sustained.sim, DT);
const sustainedMsTotal = elapsedMs(() => runSustained(sustained, SUSTAINED_TICKS));
const sustainedMsPerTick = sustainedMsTotal / SUSTAINED_TICKS;

const openSea = buildOpenSeaControlScenario();
const openSeaMsTotal = elapsedMs(() => runSustained(openSea, SUSTAINED_TICKS));
const openSeaMsPerTick = openSeaMsTotal / SUSTAINED_TICKS;

const baseline = Number(process.env.BASELINE_TERRAIN_MS ?? 0);
const result = {
  firstPlanMs,
  sustainedTicks: SUSTAINED_TICKS,
  sustainedMsTotal,
  sustainedMsPerTick,
  openSeaMsPerTick,
  ...(baseline > 0 ? { speedupVsBaseline: baseline / sustainedMsPerTick } : {})
};

console.log(JSON.stringify(result));
console.log("\nterrain navigation benchmark:");
console.log(`  first blocked plan: ${firstPlanMs.toFixed(2)} ms`);
console.log(`  sustained blocked route: ${sustainedMsTotal.toFixed(2)} ms / ${SUSTAINED_TICKS} ticks (${sustainedMsPerTick.toFixed(3)} ms/tick)`);
console.log(`  open-sea control: ${openSeaMsPerTick.toFixed(3)} ms/tick`);
if (baseline > 0) console.log(`  speedup vs baseline ${baseline.toFixed(3)} ms/tick: ${(baseline / sustainedMsPerTick).toFixed(2)}x`);
