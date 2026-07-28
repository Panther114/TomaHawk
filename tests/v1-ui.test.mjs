import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SHIP_CLASSES } from "../src/sim.js";
import { UNIT_CATEGORIES, unitCatalog, unitPresentation } from "../src/ui/catalog.js";
import { TUTORIAL_STEPS } from "../src/ui/tutorial.js";
import * as language from "../src/ui/lang.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("v1 unit catalogue covers every live class with the fixed presentation interface", () => {
  const entries = unitCatalog();
  assert.equal(entries.length, Object.keys(SHIP_CLASSES).length);
  for (const entry of entries) {
    assert.deepEqual(
      Object.keys(entry).filter((key) => key !== "custom").sort(),
      ["artwork", "category", "designation", "id", "role", "searchTerms", "statSummary", "symbolId", "zhName"].sort()
    );
  }
});

test("equipment search terms and category data cover all four operational domains", () => {
  assert.deepEqual(UNIT_CATEGORIES.map((entry) => entry.id), ["all", "sea", "subsurface", "ground", "air"]);
  const entries = unitCatalog();
  for (const category of ["sea", "subsurface", "ground", "air"]) {
    assert.ok(entries.some((entry) => entry.category === category), category);
  }
  assert.ok(entries.find((entry) => entry.id === "F22").searchTerms.includes("猛禽"));
});

test("custom unit presentation uses a deterministic safe fallback", () => {
  const cls = { domain: "ground", prefixZh: "试验雷达", glyph: "radar", radarRangeNm: 80 };
  assert.deepEqual(unitPresentation("CUSTOM-EWR", cls), unitPresentation("CUSTOM-EWR", cls));
  assert.equal(unitPresentation("CUSTOM-EWR", cls).custom, true);
  assert.match(unitPresentation("CUSTOM-EWR", cls).symbolId, /ground/);
});

test("Chinese message layer exposes no language state or toggle API", () => {
  assert.equal(typeof language.t, "function");
  assert.equal(typeof language.translateEventText, "function");
  assert.equal("getLang" in language, false);
  assert.equal("setLang" in language, false);
  assert.equal("toggleLang" in language, false);
});

test("tutorial steps share the required stable data shape", () => {
  assert.ok(TUTORIAL_STEPS.length >= 8);
  for (const step of TUTORIAL_STEPS) {
    assert.deepEqual(Object.keys(step).sort(), ["body", "id", "placement", "target", "title"]);
  }
});

test("sandbox shell has continuous deployment, drawer, layers and tutorial controls", () => {
  const html = read("../sandbox.html");
  for (const id of ["equipment-overlay", "placement-chip", "placement-message", "right-panel", "map-options", "bottom-bar", "tour-overlay"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /lang-toggle|event-console|id="about-overlay"/);
});

test("continuous placement uses existing public placement validation and reports reasons", () => {
  const source = read("../src/app.js");
  assert.match(source, /function placementValidity/);
  assert.match(source, /isShipPositionOnLand\(sim, candidate\)/);
  assert.match(source, /isShipPositionOnWater\(sim, candidate\)/);
  assert.match(source, /function endPlacement/);
  assert.match(source, /event\.button === 2[\s\S]*endPlacement\(\)/);
});

test("tutorial preference and Dawnfall debugging keys use the v1 namespace", () => {
  const source = read("../src/app.js");
  assert.match(source, /dawnfall\.tutorialDismissed/);
  assert.match(source, /dawnfall\.debug/);
  assert.match(source, /window\.dawnfallMods/);
  assert.doesNotMatch(source, /window\.tomahawkMods|localStorage\.getItem\("tomahawk\.debug"/);
});

test("mod persistence defines verified legacy migration into dawnfall-mods", () => {
  const source = read("../src/mods/store.js");
  assert.match(source, /const DB_NAME = "dawnfall-mods"/);
  assert.match(source, /const LEGACY_DB_NAME = "tomahawk-mods"/);
  assert.match(source, /for \(const record of records\) await dbPut\(targetDb, record\)/);
  assert.ok(source.indexOf("dbPut(targetDb, record)") < source.indexOf("deleteNamedDb(LEGACY_DB_NAME)"));
});

test("server exposes the three public pages with pretty routes", () => {
  const source = read("../server.mjs");
  assert.match(source, /"\/": "index\.html"/);
  assert.match(source, /"\/sandbox": "sandbox\.html"/);
  assert.match(source, /"\/guide": "guide\.html"/);
});

test("AAR preserves source events and adds Chinese display text under a Dawnfall filename", () => {
  const source = read("../src/app.js");
  assert.match(source, /aar\.events = aar\.events\.map/);
  assert.match(source, /displayTextZh/);
  assert.match(source, /dawnfall-aar-/);
});
