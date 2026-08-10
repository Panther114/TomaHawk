import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

import { SHIP_CLASSES } from "../src/sim.js";
import { UNIT_CATEGORIES, unitCatalog, unitPresentation } from "../src/ui/catalog.js";
import { GUIDE_LESSONS, TUTORIAL_STEPS } from "../src/ui/tutorial.js";
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

test("interactive guide lessons project onto the stable sandbox spotlight data", () => {
  assert.equal(GUIDE_LESSONS.length, TUTORIAL_STEPS.length);
  for (const [index, lesson] of GUIDE_LESSONS.entries()) {
    assert.deepEqual(
      TUTORIAL_STEPS[index],
      {
        id: lesson.id,
        target: lesson.target,
        title: lesson.title,
        body: lesson.body,
        placement: lesson.placement
      }
    );
    assert.deepEqual(
      Object.keys(lesson.guide).sort(),
      ["action", "error", "focus", "label", "result"]
    );
  }
});

test("guide is a fullscreen immersive manual: live sandbox fills the screen", () => {
  const html = read("../guide.html");
  const script = read("../src/guide.js");
  const css = read("../src/guide.css");
  for (const id of ["quick-start", "guide-ui", "sandbox-frame", "spotlight", "scrim", "cursor-hint", "coach", "completion", "reference"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /src="src\/guide\.js"/);
  assert.match(html, /src="\/sandbox"/);
  assert.doesNotMatch(html, /assets\/guide\//);

  const stepIds = ["deploy-open", "library-pick", "place-unit", "deploy-red", "layers", "playback", "speed", "overview", "select-unit", "save", "workshop"];
  for (const id of stepIds) assert.match(script, new RegExp(`id: "${id}"`));
  assert.match(script, /contentDocument/);
  assert.match(script, /querySelector\("#app"\)/);
  assert.match(script, /setInterval/);
  assert.match(script, /AUTO_ADVANCE_MS/);
  assert.match(script, /function lockSandbox/);
  assert.match(script, /function prepareStage/);
  assert.match(script, /allowed: \[/);
  assert.match(script, /phases: \[/);
  assert.match(script, /readOnly: true/);
  assert.match(script, /blockUnlessAllowed/);
  assert.doesNotMatch(script, /localStorage/);
  assert.doesNotMatch(script, /guideProgress/);

  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /@media \(max-width:\s*900px\)/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
  assert.doesNotMatch(`${html}\n${script}`, /Dawnfall|dawnfall|onerror\s*=/i);
  assert.doesNotMatch(html, /<h[1-3][^>]*>[^<]*[:：]/);
  assert.doesNotMatch(html, /lesson-tabs|demo-coach|task-strip|operation-rules|workshop-flow/);
  assert.equal(existsSync(new URL("../src/assets/guide", import.meta.url)), false);
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

test("Tomahawk debugging keys use the v1 namespace and first-run prompts are removed", () => {
  const source = read("../src/app.js");
  const html = read("../sandbox.html");
  assert.doesNotMatch(source, /initiative\.tutorialDismissed/);
  assert.doesNotMatch(html, /id="empty-state"|id="tutorial-prompt"/);
  assert.match(source, /tomahawk\.debug/);
  assert.match(source, /window\.tomahawkMods/);
  assert.doesNotMatch(source, /window\.initiativeMods|localStorage\.getItem\("initiative\.debug"/);
});

test("mod persistence defines verified legacy migration into Tomahawk storage", () => {
  const source = read("../src/mods/store.js");
  assert.match(source, /const DB_NAME = "tomahawk-mods"/);
  assert.match(source, /const LEGACY_DB_NAME = "initiative-mods"/);
  assert.match(source, /for \(const record of records\) await dbPut\(targetDb, record\)/);
  assert.ok(source.indexOf("dbPut(targetDb, record)") < source.indexOf("deleteNamedDb(LEGACY_DB_NAME)"));
});

test("server exposes the three public pages with pretty routes", () => {
  const source = read("../server.mjs");
  assert.match(source, /"\/": "index\.html"/);
  assert.match(source, /"\/sandbox": "sandbox\.html"/);
  assert.match(source, /"\/guide": "guide\.html"/);
});

test("landing shell is a centered game menu with three cinematic depth layers", () => {
  const html = read("../index.html");
  const css = read("../src/landing.css");
  const script = read("../src/landing.js");

  assert.equal(html.match(/href="\/sandbox"/g)?.length, 1);
  assert.match(html, /href="\/guide"/);
  assert.match(html, /github\.com\/Panther114\/TomaHawk/);
  for (const asset of [
    "tomahawk-storm-sunset.webp",
    "tomahawk-carrier-v2.webp",
    "tomahawk-hornet-v2.webp",
  ]) {
    assert.match(html, new RegExp(asset.replace(".", "\\.")));
    const file = new URL(`../src/assets/landing/${asset}`, import.meta.url);
    assert.equal(existsSync(file), true);
    assert.ok(statSync(file).size > 100_000);
  }
  assert.equal(existsSync(new URL("../src/assets/hero/carrier-group.webp", import.meta.url)), false);
  assert.match(html, /src="src\/landing\.js"/);
  assert.match(html, /data-parallax-x="6"[\s\S]*data-parallax-y="4"/);
  assert.match(html, /data-parallax-x="22"[\s\S]*data-parallax-y="14"/);
  assert.match(html, /data-parallax-x="67"[\s\S]*data-parallax-y="43"/);
  assert.match(script, /querySelectorAll\("\[data-parallax-x\]\[data-parallax-y\]"\)/);
  assert.match(script, /x \* depthX/);
  assert.match(script, /y \* depthY/);
  assert.match(script, /event\.pointerType === "touch"/);
  assert.match(script, /pointerout/);
  assert.match(script, /event\.screenX/);
  assert.doesNotMatch(script, /landing\.addEventListener\("pointerleave"/);
  assert.match(script, /if \(reducedMotion\.matches\) \{[\s\S]*applyDepth\(currentX, currentY\)/);
  assert.doesNotMatch(css, /@media \(pointer: coarse\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(
    css.match(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/)?.[0] || "",
    /\.scene-(?:background|carrier|aircraft)[\s\S]*transform:\s*none/
  );
  assert.doesNotMatch(html, /hero-specs|hero-fallback|carrier-group\.webp|landing-foot/);
  assert.doesNotMatch(css, /transition:\s*all\b/);
});

test("public shells share the Tomahawk logo and CJK-only display font", () => {
  const fonts = read("../src/fonts.css");
  for (const page of ["../index.html", "../sandbox.html", "../guide.html"]) {
    const html = read(page);
    assert.match(html, /href="src\/fonts\.css"/);
    assert.match(html, /src\/assets\/icon\.png/);
    assert.doesNotMatch(html, /initiative-mark\.svg/);
    assert.doesNotMatch(html, /dawnfall-mark\.svg/);
  }
  assert.equal(existsSync(new URL("../src/assets/dawnfall-mark.svg", import.meta.url)), false);
  assert.match(fonts, /font-family:\s*"Tomahawk Han"/);
  assert.match(fonts, /src:\s*url\("fonts\/chi_font\.ttf"\)/);
  assert.match(fonts, /unicode-range:[\s\S]*U\+4E00-9FFF/);
  assert.doesNotMatch(
    fonts.match(/@font-face\s*\{[\s\S]*?font-family:\s*"Tomahawk Han"[\s\S]*?\}/)?.[0] || "",
    /U\+0000-00FF/
  );
});

test("AAR preserves source events and adds Chinese display text under a Tomahawk filename", () => {
  const source = read("../src/app.js");
  assert.match(source, /aar\.events = aar\.events\.map/);
  assert.match(source, /displayTextZh/);
  assert.match(source, /tomahawk-aar-/);
});
