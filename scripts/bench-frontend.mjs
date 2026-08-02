import { performance } from "node:perf_hooks";

import { createScenario, clearSide, placeShip, SIDE, NM } from "../src/sim.js";
import { clusterProximityLabels, inventoryHtml, inventoryRowState } from "../src/ui/view.js";

function measure(fn, iterations) {
  let sink = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) sink += fn(i) ?? 0;
  return { ms: performance.now() - start, sink };
}

function improvement(before, after) {
  return ((before - after) / before) * 100;
}

function naiveClusters(items, thresholdPx) {
  const clusters = [];
  const visited = new Set();
  for (let i = 0; i < items.length; i++) {
    if (visited.has(i)) continue;
    const stack = [i];
    const cluster = [];
    visited.add(i);
    while (stack.length) {
      const index = stack.pop();
      const item = items[index];
      cluster.push(item);
      for (let j = 0; j < items.length; j++) {
        if (visited.has(j)) continue;
        if (Math.abs(item.x - items[j].x) <= thresholdPx && Math.abs(item.y - items[j].y) <= thresholdPx) {
          visited.add(j);
          stack.push(j);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

const sim = createScenario(301);
clearSide(sim, SIDE.BLUE);
clearSide(sim, SIDE.RED);
for (let i = 0; i < 20; i++) {
  const y = (i - 9.5) * 3 * NM;
  placeShip(sim, SIDE.BLUE, -42 * NM, y, ["DDG", "CCG", "FFG", "BBG"][i % 4]);
  placeShip(sim, SIDE.RED, 42 * NM, -y, ["CCG", "FFG", "BBG", "DDG"][i % 4]);
}
for (let i = 0; i < 400; i++) {
  sim.missiles.push({
    id: `M-BENCH-${i}`,
    targetId: i % 2 ? sim.ships[i % sim.ships.length].id : `M-BENCH-${Math.max(0, i - 1)}`,
    alive: true
  });
}
const shipById = new Map(sim.ships.map((ship) => [ship.id, ship]));
const missileById = new Map(sim.missiles.map((missile) => [missile.id, missile]));

const linearLookup = measure(() => {
  let found = 0;
  for (const missile of sim.missiles) {
    const target = String(missile.targetId).startsWith("M-")
      ? sim.missiles.find((candidate) => candidate.id === missile.targetId)
      : sim.ships.find((candidate) => candidate.id === missile.targetId);
    if (target) found++;
  }
  return found;
}, 300);
const indexedLookup = measure(() => {
  let found = 0;
  for (const missile of sim.missiles) {
    const target = String(missile.targetId).startsWith("M-")
      ? missileById.get(missile.targetId)
      : shipById.get(missile.targetId);
    if (target) found++;
  }
  return found;
}, 300);

const labels = Array.from({ length: 400 }, (_, index) => ({
  id: index,
  x: (index * 73) % 1280,
  y: (index * 131) % 720,
  cx: (index * 73) % 1280 + 4,
  cy: (index * 131) % 720 - 3
}));
const naiveLabelTime = measure(() => naiveClusters(labels, 18).length, 100);
const spatialLabelTime = measure(() => clusterProximityLabels(labels, 18).length, 100);

const orderedShips = [...sim.ships].sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
const uncachedPanels = measure(() => inventoryHtml(orderedShips).length, 600);
let inventoryKey = "";
let inventory = "";
const cachedPanels = measure(() => {
  const nextKey = sim.ships.map((ship) => [ship.id, ship.alive, ship.damage, ...Object.values(ship.loadout)].join(":" )).join("|");
  if (nextKey !== inventoryKey) {
    inventoryKey = nextKey;
    inventory = inventoryHtml(orderedShips);
  }
  return inventory.length;
}, 600);

const changingShip = orderedShips[0];
const changingWeapon = Object.keys(changingShip.loadout)[0];
const changingStart = changingShip.loadout[changingWeapon];
const rebuiltChangingPanels = measure((iteration) => {
  changingShip.loadout[changingWeapon] = Math.max(0, changingStart - (iteration % 2));
  return inventoryHtml(orderedShips).length;
}, 600);
const patchedChangingRows = measure((iteration) => {
  changingShip.loadout[changingWeapon] = Math.max(0, changingStart - (iteration % 2));
  const state = inventoryRowState(changingShip);
  return state.vls + state.aaw + state.asuw;
}, 600);
changingShip.loadout[changingWeapon] = changingStart;

console.log("frontend hot-path microbenchmark (40 ships / 400 missiles):");
console.log(`  target lookup: ${linearLookup.ms.toFixed(1)} -> ${indexedLookup.ms.toFixed(1)} ms (${improvement(linearLookup.ms, indexedLookup.ms).toFixed(1)}% faster)`);
console.log(`  label clustering: ${naiveLabelTime.ms.toFixed(1)} -> ${spatialLabelTime.ms.toFixed(1)} ms (${improvement(naiveLabelTime.ms, spatialLabelTime.ms).toFixed(1)}% faster)`);
console.log(`  stable inventory frames: ${uncachedPanels.ms.toFixed(1)} -> ${cachedPanels.ms.toFixed(1)} ms (${improvement(uncachedPanels.ms, cachedPanels.ms).toFixed(1)}% faster)`);
console.log(`  changing-ammo panel work: ${rebuiltChangingPanels.ms.toFixed(1)} -> ${patchedChangingRows.ms.toFixed(1)} ms (${improvement(rebuiltChangingPanels.ms, patchedChangingRows.ms).toFixed(1)}% faster)`);
