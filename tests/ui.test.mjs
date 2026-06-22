import test from "node:test";
import assert from "node:assert/strict";
import { createScenario, SIDE } from "../src/sim.js";
import {
  worldToScreen,
  screenToWorld,
  sideColor,
  sideSoftColor,
  shipHpState,
  vlsLoadState,
  displayCount,
  inventoryHpColor,
  inventoryVlsColor,
  inventoryMissileColor,
  commandPosture,
  postureBar,
  renderBattleStatus,
  inventoryHeadHtml,
  inventoryRowHtml,
  inventoryHtml,
  groundRowHtml,
  isGroundUnit,
  clusterProximityLabels
} from "../src/ui/view.js";
import { placeShip, clearSide, NM } from "../src/sim.js";
import { setLang, t } from "../src/ui/lang.js";

const camera = { x: 1000, y: -500, scale: 0.0022 };
const viewW = 1280;
const viewH = 720;

test("spatial missile-label clustering preserves connected proximity groups", () => {
  const items = Array.from({ length: 300 }, (_, index) => ({
    id: index,
    x: (index * 73) % 640,
    y: (index * 131) % 360,
    cx: (index * 73) % 640 + 4,
    cy: (index * 131) % 360 - 3
  }));
  const threshold = 18;
  const expected = [];
  const visited = new Set();
  for (let i = 0; i < items.length; i++) {
    if (visited.has(i)) continue;
    const stack = [i];
    const group = [];
    visited.add(i);
    while (stack.length) {
      const index = stack.pop();
      group.push(items[index].id);
      for (let j = 0; j < items.length; j++) {
        if (visited.has(j)) continue;
        if (Math.abs(items[index].x - items[j].x) <= threshold && Math.abs(items[index].y - items[j].y) <= threshold) {
          visited.add(j);
          stack.push(j);
        }
      }
    }
    expected.push(group.sort((a, b) => a - b));
  }
  const actual = clusterProximityLabels(items, threshold)
    .map((cluster) => cluster.items.map((item) => item.id).sort((a, b) => a - b));
  assert.deepEqual(actual, expected);
});

test("worldToScreen and screenToWorld are exact inverses", () => {
  const p = { x: 42345, y: -98765 };
  const screen = worldToScreen(p, camera, viewW, viewH);
  const back = screenToWorld(screen.x, screen.y, camera, viewW, viewH);
  assert.ok(Math.abs(back.x - p.x) < 1e-6);
  assert.ok(Math.abs(back.y - p.y) < 1e-6);
});

test("worldToScreen places the camera focus at viewport center", () => {
  const screen = worldToScreen({ x: camera.x, y: camera.y }, camera, viewW, viewH);
  assert.equal(screen.x, viewW / 2);
  assert.equal(screen.y, viewH / 2);
});

test("side colors are distinct for blue and red", () => {
  assert.notEqual(sideColor(SIDE.BLUE), sideColor(SIDE.RED));
  assert.notEqual(sideSoftColor(SIDE.BLUE), sideSoftColor(SIDE.RED));
});

test("shipHpState derives current HP from damage and resist", () => {
  assert.deepEqual(shipHpState({ damageResist: 3, damage: 1 }), { currentHp: 2, maxHp: 3, damage: 1 });
  // HP never goes negative, max is at least 1
  assert.deepEqual(shipHpState({ damageResist: 1, damage: 5 }), { currentHp: 0, maxHp: 1, damage: 5 });
});

test("vlsLoadState reports a full default destroyer magazine", () => {
  const ship = createScenario(1).ships[0];
  const vls = vlsLoadState(ship);
  assert.equal(vls.cap, 96);
  assert.ok(vls.used <= vls.cap);
  assert.ok(vls.fill > 0 && vls.fill <= 1);
});

test("inventory color helpers map hp, vls, and missile states to the requested thresholds", () => {
  const ship = createScenario(1).ships[0];
  assert.equal(inventoryHpColor({ damageResist: 2, damage: 0 }), "#5fd58c");
  assert.equal(inventoryHpColor({ damageResist: 2, damage: 2 }), "#4e6972");
  assert.equal(inventoryHpColor({ damageResist: 2, damage: 1 }), "#f7b955");
  assert.equal(inventoryVlsColor({ loadout: {} , vlsCells: 96 }), "#4e6972");
  assert.equal(inventoryVlsColor({ loadout: { MaritimeStrike: 80 }, vlsCells: 96 }), "#5fd58c");
  assert.equal(inventoryVlsColor({ loadout: { MaritimeStrike: 20 }, vlsCells: 96 }), "#f28d4e");
  assert.equal(inventoryMissileColor(ship, "ESSM"), "#ffffff");
  assert.equal(inventoryMissileColor({ hull: ship.hull, loadout: { ESSM: 1 } }, "ESSM"), "#f7b955");
  assert.equal(inventoryMissileColor({ hull: ship.hull, loadout: { ESSM: 0 } }, "ESSM"), "#4e6972");
});

test("displayCount returns non-negative integers and tolerates junk", () => {
  assert.equal(displayCount({ loadout: { ESSM: 7.6 } }, "ESSM"), 8);
  assert.equal(displayCount({ loadout: {} }, "ESSM"), 0);
  assert.equal(displayCount({ loadout: { ESSM: -3 } }, "ESSM"), 0);
  assert.equal(displayCount(null, "ESSM"), 0);
});

test("commandPosture falls back to a neutral posture when none is computed", () => {
  const sim = createScenario(1);
  const posture = commandPosture(sim, SIDE.BLUE);
  assert.equal(posture.aggression, 0.5);
});

test("postureBar renders the aggression percentage and side class", () => {
  const html = postureBar(SIDE.RED, { aggression: 0.42 });
  assert.match(html, /42%/);
  assert.match(html, /posture-chip/);
  assert.match(html, /\bred\b/);
});

test("renderBattleStatus emits ship counts and both posture bars", () => {
  const sim = createScenario(3);
  const html = renderBattleStatus(sim);
  assert.match(html, /R HP/);
  assert.match(html, /B HP/);
  assert.match(html, /B AGG/);
  assert.match(html, /R AGG/);
});

test("inventory header exposes all eight tracked columns", () => {
  const head = inventoryHeadHtml();
  for (const col of ["SHIP", "HP", "VLS", "SM2", "SM6", "ESSM", "MSTK", "TLAM"]) {
    assert.match(head, new RegExp(`>${col}<`));
  }
});

test("inventory row is a selectable button carrying the ship id and HP/VLS cells", () => {
  const ship = createScenario(7).ships[0];
  const row = inventoryRowHtml(ship, true);
  assert.match(row, new RegExp(`data-select-ship="${ship.id}"`));
  assert.match(row, /class="inventory-row blue[^"]*selected"/);
  assert.match(row, /\/96</); // VLS capacity cell
});

test("inventory row localizes the ship name in Chinese", () => {
  setLang("zh");
  const ship = { ...createScenario(7).ships[1], id: "CG-2", hull: "CCG" };
  const row = inventoryRowHtml(ship, false);
  assert.match(row, /巡洋舰-2/);
  setLang("en");
});

test("inventoryHtml inserts a divider between sides and a row per ship", () => {
  const sim = createScenario(5);
  const ordered = [...sim.ships].sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
  const html = inventoryHtml(ordered, () => false);
  const rows = (html.match(/inventory-row/g) || []).length;
  assert.equal(rows, sim.ships.length);
  assert.match(html, /inventory-divider/);
});

test("ground inventory header exposes the ground-specific columns", () => {
  const head = inventoryHeadHtml("ground");
  for (const col of ["UNIT", "HP", "RDR", "AAW", "ASUW"]) {
    assert.match(head, new RegExp(`>${col}<`));
  }
  assert.match(head, /inventory-head ground/);
});

test("isGroundUnit recognizes domain and isFixed", () => {
  assert.equal(isGroundUnit({ domain: "ground" }), true);
  assert.equal(isGroundUnit({ isFixed: true }), true);
  assert.equal(isGroundUnit({ domain: "sea" }), false);
  assert.equal(isGroundUnit({}), false);
});

test("groundRowHtml is a selectable row with the unit tag, radar reach, and effector counts", () => {
  const sim = createScenario(7, "openSea");
  clearSide(sim, SIDE.BLUE);
  const sam = placeShip(sim, SIDE.BLUE, -10 * NM, 0, "SAM");
  const row = groundRowHtml(sam, true);
  assert.match(row, new RegExp(`data-select-ship="${sam.id}"`));
  assert.match(row, /class="inventory-row ground blue[^"]*selected"/);
  assert.match(row, /SAM-/); // unit tag
  assert.match(row, /160</); // radar reach in nm
});

test("inventoryHtml renders a per-faction naval table then a ground table", () => {
  const sim = createScenario(13, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  placeShip(sim, SIDE.BLUE, -20 * NM, 0, "DDG");
  const sam = placeShip(sim, SIDE.BLUE, -18 * NM, 4 * NM, "SAM");
  placeShip(sim, SIDE.RED, 20 * NM, 0, "DDG");
  const ordered = [...sim.ships].sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
  const html = inventoryHtml(ordered, () => false);
  assert.match(html, /inventory-head ground/); // ground sub-table header present
  assert.match(html, new RegExp(`inventory-row ground[^"]*"[^>]*data-select-ship="${sam.id}"`));
  assert.match(html, /inventory-divider/); // divider between the two factions
  // The naval (sea) header precedes the ground header within the blue section.
  assert.ok(html.indexOf('class="inventory-head"') < html.indexOf("inventory-head ground"));
});

test("tracks toggle uses 锁定 in Chinese", () => {
  setLang("zh");
  assert.equal(t("opt.tracks"), "锁定");
  setLang("en");
});
