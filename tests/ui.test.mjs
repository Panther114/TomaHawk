import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  remainingStockColor,
  commandPosture,
  postureBar,
  battleStatusState,
  renderBattleStatus,
  inventoryHeadHtml,
  inventoryRowHtml,
  inventoryRowState,
  inventoryHtml,
  unitInfoPopoverHtml,
  groundRowHtml,
  isGroundUnit,
  shipDetailCardHtml,
  clusterProximityLabels
} from "../src/ui/view.js";
import { placeShip, clearSide, NM } from "../src/sim.js";
import { t } from "../src/ui/lang.js";

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

test("inventory color helpers use the shared percentage thresholds", () => {
  const ship = createScenario(1).ships[0];
  assert.equal(inventoryHpColor({ damageResist: 2, damage: 0 }), "#f2f4f5");
  assert.equal(inventoryHpColor({ damageResist: 2, damage: 2 }), "#5c6369");
  assert.equal(inventoryHpColor({ damageResist: 4, damage: 1 }), "#64b982");
  assert.equal(inventoryHpColor({ damageResist: 4, damage: 2 }), "#64b982");
  assert.equal(inventoryHpColor({ damageResist: 4, damage: 3 }), "#d6ad45");
  assert.equal(inventoryVlsColor({ loadout: {} , vlsCells: 96 }), "#5c6369");
  assert.equal(inventoryVlsColor({ loadout: { MaritimeStrike: 80 }, vlsCells: 96 }), "#64b982");
  assert.equal(inventoryVlsColor({ loadout: { MaritimeStrike: 20 }, vlsCells: 96 }), "#c95757");
  assert.equal(inventoryMissileColor(ship, "ESSM"), "#f2f4f5");
  const withBaseline = (essm) => ({ loadout: { ESSM: essm }, baseLoadoutSnapshot: { ESSM: 30 } });
  assert.equal(inventoryMissileColor(withBaseline(0), "ESSM"), "#5c6369");
  assert.equal(inventoryMissileColor(withBaseline(30), "ESSM"), "#f2f4f5");
  assert.equal(inventoryMissileColor(withBaseline(21), "ESSM"), "#64b982");
  assert.equal(inventoryMissileColor(withBaseline(10), "ESSM"), "#d6ad45");
  assert.equal(inventoryMissileColor(withBaseline(6), "ESSM"), "#c95757");
});

test("dense missile rendering preserves every full tactical symbol and guide", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  // Batches may be fresh Maps or module-level pooled Maps; every weapon still
  // gets a full Path2D symbol + guide stroke (no visual LOD/culling caps).
  assert.match(source, /symbolBatches/);
  assert.match(source, /appendMissileSymbol\(/);
  assert.match(source, /ctx\.fill\(symbols\.path\)/);
  assert.match(source, /ctx\.stroke\(guide\.path\)/);
  assert.doesNotMatch(
    source,
    /lodDots|compactIcons|MISSILE_ICON_THIN_CAP|MISSILE_GUIDE_LINE_CAP|MISSILE_GLOW_CAP|stableMissileHash|Density sampling/
  );
});

test("inventoryRowState derives all live values used by in-place panel updates", () => {
  const ship = createScenario(1).ships[0];
  const initial = inventoryRowState(ship);
  assert.equal(initial.hp, ship.damageResist);
  assert.equal(initial.hpMax, ship.damageResist);
  assert.equal(initial.hpPct, 100);
  assert.equal(initial.hpColor, "#f2f4f5");
  assert.equal(initial.vlsCap, 96);

  ship.damage = 1;
  ship.loadout.ESSM = 0;
  const depleted = inventoryRowState(ship);
  assert.equal(depleted.hp, ship.damageResist - 1);
  assert.equal(depleted.aawColor, "#64b982");
  assert.equal(depleted.airState, "MSN");
});

test("battleStatusState exposes stable value and meter fields for DOM patching", () => {
  const sim = createScenario(1);
  const state = battleStatusState(sim);
  assert.match(state.blue.hp.value, /^\d+\/\d+$/);
  assert.equal(typeof state.blue.hp.pct, "number");
  assert.match(state.red.intercept.value, /^\d+%$/);
  assert.equal(typeof state.red.offense.pct, "number");
});

test("interception ledger counts same-tick events and stays bounded after compaction", () => {
  const sim = createScenario(2);
  sim.events = [
    { id: 1, t: 0, side: SIDE.RED, text: "Red DDG launched MSTK at target" },
    { id: 2, t: 0, side: SIDE.RED, text: "Red DDG launched MSTK at target" }
  ];
  battleStatusState(sim);
  assert.equal(sim._uiInterceptionStats.sides[SIDE.RED].launched, 2);

  sim.events = Array.from({ length: 500 }, (_, index) => ({
    id: index + 100,
    t: index,
    side: SIDE.RED,
    text: "Red DDG launched MSTK at target"
  }));
  battleStatusState(sim);
  assert.equal(sim._uiInterceptionStats.seen.size, 500);
});

test("unit icons and IDs use continuous zoom scaling with explicit larger bounds", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /const UNIT_ICON_MIN_SCALE = 0\.56/);
  assert.match(source, /const UNIT_ICON_MAX_SCALE = 1\.55/);
  assert.match(source, /function unitZoomProgress\(\)/);
  assert.match(source, /const iconScale = unitIconScale\(selected\)/);
  assert.match(source, /ctx\.font = canvasFont\(unitLabelPx\(\)\)/);
});

test("force roster typography is enlarged and HP denominators stay white until death", async () => {
  const css = await readFile(new URL("../src/tomahawk.css", import.meta.url), "utf8");
  assert.match(css, /\.inventory-head[\s\S]*?font-size: 12\.1px !important/);
  assert.match(css, /\.inventory-row[\s\S]*?font-size: 13\.2px !important/);
  assert.match(css, /\.inventory-unit strong[\s\S]*?font-size: 14\.3px/);
  assert.match(css, /\.inventory-cell b \{ font: 650 19\.8px\/18px/);
  assert.match(css, /\.inventory-denominator \{ color: var\(--text\); \}/);
  assert.match(css, /\.inventory-row\.sunk \.inventory-hp-denominator \{ color: #5c6369; \}/);
});

test("remainingStockColor applies the universal 100/50/25/0 thresholds", () => {
  assert.equal(remainingStockColor(0, 100), "#5c6369");
  assert.equal(remainingStockColor(100, 100), "#f2f4f5");
  assert.equal(remainingStockColor(99, 100), "#64b982");
  assert.equal(remainingStockColor(50, 100), "#64b982");
  assert.equal(remainingStockColor(49, 100), "#d6ad45");
  assert.equal(remainingStockColor(25, 100), "#d6ad45");
  assert.equal(remainingStockColor(24, 100), "#c95757");
  assert.equal(remainingStockColor(1, 100), "#c95757");
  // A count with no known baseline (e.g. a fake fixture) reads as "full" white
  // rather than false-alarming red/grey.
  assert.equal(remainingStockColor(5, 0), "#f2f4f5");
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

test("renderBattleStatus emits mirrored Chinese force summaries", () => {
  const sim = createScenario(3);
  const html = renderBattleStatus(sim);
  assert.match(html, /force-summary blue/);
  assert.match(html, /force-summary red/);
  assert.match(html, /总生命/);
  assert.match(html, /在空反舰/);
  assert.match(html, /在空防空/);
  assert.match(html, /存活目标/);
  assert.match(html, /攻势/);
});

test("inventory header exposes the naval roster columns", () => {
  const head = inventoryHeadHtml();
  for (const col of ["单位", "生命", "垂发", "防空弹药", "打击弹药", "速度"]) {
    assert.match(head, new RegExp(col));
  }
  assert.match(head, /inventory-head naval/);
});

test("inventory row is a selectable button carrying the ship id and HP/VLS cells", () => {
  const ship = createScenario(7).ships[0];
  const row = inventoryRowHtml(ship, true);
  assert.match(row, new RegExp(`data-select-ship="${ship.id}"`));
  assert.match(row, /class="inventory-row naval blue[^"]*selected"/);
  assert.match(row, /inventory-denominator">\/96</); // white VLS denominator
  assert.match(row, /data-inventory-hp[^>]*>2<\/i><i data-inventory-hp-cap[^>]*>\/2<\/i>/);
  // Compact single-line localized name; no repeated hull code or English labels.
  assert.match(row, /驱逐舰·1/);
  assert.doesNotMatch(row, /DDG 驱逐舰/);
  assert.match(row, /data-info-ship/);
  assert.doesNotMatch(row, /<small>HP<\/small>/);
  assert.doesNotMatch(row, /<small>VLS<\/small>/);
});

test("inventory markup escapes scenario-provided unit identifiers", () => {
  const html = inventoryRowHtml({
    id: '\"><img src=x onerror=alert(1)>', side: SIDE.BLUE, alive: true,
    damage: 0, damageResist: 1, loadout: {}, vlsCells: 1
  }, false);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("inventory row localizes the ship name in Chinese", () => {
  const ship = { ...createScenario(7).ships[1], id: "CG-2", hull: "CCG" };
  const row = inventoryRowHtml(ship, false);
  assert.match(row, /巡洋舰·2/);
  assert.doesNotMatch(row, /CG 巡洋舰/);
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
  for (const col of ["单位", "生命", "雷达", "防空弹药", "打击弹药"]) {
    assert.match(head, new RegExp(col));
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
  assert.match(row, /防空营·3/); // compact localized name
  assert.match(row, />160</); // radar reach (nm, no English suffix)
});

test("unit info popover exposes quantitative details without map geometry", () => {
  const sim = createScenario(7, "openSea");
  const f15n = placeShip(sim, SIDE.BLUE, -10 * NM, 0, "F15N");
  const html = unitInfoPopoverHtml(f15n, sim);
  assert.match(html, /inventory-info-card/);
  assert.match(html, /燃料/);
  assert.match(html, /高度/);
  assert.match(html, /弹药/);
  assert.doesNotMatch(html, /坐标|航点/);
});

test("shipDetailCardHtml dispatches naval/ground/air layouts by unit TYPE, not hull name", () => {
  const sim = createScenario(7, "openSea");
  clearSide(sim, SIDE.BLUE);
  const ddg = placeShip(sim, SIDE.BLUE, -20 * NM, 0, "DDG");
  const sam = placeShip(sim, SIDE.BLUE, -18 * NM, 0, "SAM");   // armed ground
  const ewr = placeShip(sim, SIDE.BLUE, -16 * NM, 0, "EWR");   // unarmed ground
  const f22 = placeShip(sim, SIDE.BLUE, -14 * NM, 0, "F22");

  // Naval: full subsystem readout, including a propulsion bar (it moves).
  const navalHtml = shipDetailCardHtml(ddg, 120);
  assert.match(navalHtml, new RegExp(t("detail.prop")));
  assert.match(navalHtml, new RegExp(t("detail.vls")));

  // Armed ground (SAM): no propulsion (never moves), but fire control, a LOAD
  // bar (it carries weapons), and AAW/ASUW counts appear because SM-6 is now
  // explicit dual-role missile/air/surface capable ammo.
  const samHtml = shipDetailCardHtml(sam, 120);
  assert.doesNotMatch(samHtml, new RegExp(t("detail.prop")));
  assert.match(samHtml, new RegExp(t("detail.fcs")));
  assert.match(samHtml, new RegExp(t("detail.load")));
  assert.match(samHtml, new RegExp(t("detail.aaw")));
  assert.match(samHtml, new RegExp(t("detail.asuw")));

  // Unarmed ground (EWR): no propulsion, no fire control, no LOAD bar, no
  // AAW/ASUW rows -- just radar and CIC (it's a sensor node, nothing else).
  const ewrHtml = shipDetailCardHtml(ewr, 120);
  assert.doesNotMatch(ewrHtml, new RegExp(t("detail.prop")));
  assert.doesNotMatch(ewrHtml, new RegExp(t("detail.fcs")));
  assert.doesNotMatch(ewrHtml, new RegExp(t("detail.load")));
  assert.doesNotMatch(ewrHtml, new RegExp(t("detail.aaw")));
  assert.doesNotMatch(ewrHtml, new RegExp(t("detail.asuw")));
  assert.match(ewrHtml, new RegExp(t("detail.radar")));

  // Air (F22): no VLS label (it's relabeled LOAD for aircraft too), a fuel
  // bar, and an AAW count (it carries AIM-120C/D/AIM-9X) but no ASUW (it's a
  // pure air-superiority loadout, carries no anti-ship weapon).
  const airHtml = shipDetailCardHtml(f22, 120);
  assert.doesNotMatch(airHtml, new RegExp(t("detail.vls")));
  assert.match(airHtml, new RegExp(t("detail.load")));
  assert.match(airHtml, new RegExp(t("detail.fuel")));
  assert.match(airHtml, new RegExp(t("detail.aaw")));
  assert.doesNotMatch(airHtml, new RegExp(t("detail.asuw")));
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

test("tracks toggle uses a Chinese label", () => {
  assert.equal(t("opt.tracks"), "锁定");
});
