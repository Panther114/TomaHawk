import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScenario } from "../src/sim.js";
import {
  CORE_MAP_HEIGHT_M,
  CORE_MAP_WIDTH_M,
  MAP_HEIGHT_M,
  MAP_WIDTH_M,
  TACTICAL_MAPS
} from "../src/ui/maps.js";
import { geographicExtentForProjectedBounds } from "../src/world/map-spec.js";

test("coastline world and extent cover the full globe", () => {
  assert.ok(MAP_WIDTH_M > CORE_MAP_WIDTH_M * 25);
  assert.ok(MAP_HEIGHT_M > CORE_MAP_HEIGHT_M * 25);

  const extent = TACTICAL_MAPS.eastChinaSea.geographicExtent;
  const expected = geographicExtentForProjectedBounds(MAP_WIDTH_M, MAP_HEIGHT_M);
  assert.ok(Math.abs(extent.west - expected.west) < 1e-9);
  assert.ok(Math.abs(extent.east - expected.east) < 1e-9);
  assert.ok(Math.abs(extent.south - expected.south) < 1e-9);
  assert.ok(Math.abs(extent.north - expected.north) < 1e-9);

  const sim = createScenario(1);
  assert.equal(sim.widthM, MAP_WIDTH_M);
  assert.equal(sim.heightM, MAP_HEIGHT_M);
});

test("camera clamping uses the viewport-derived map scale", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /const minScale = minimumCameraScale\(\);/);
  assert.doesNotMatch(appSource, /\bMIN_CAMERA_SCALE\b/);
});

test("the initial tactical viewport focuses the requested East China Sea coordinate", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /let camera = \{ x: 13_900 \* KM, y: -3_600 \* KM, scale: 0\.00125 \};/);
});

test("frame rendering preserves interactive panel DOM when content is unchanged", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /replaceHtmlIfChanged\(unitTab,/);
  assert.doesNotMatch(appSource, /unitTab\.innerHTML\s*=/);
});

test("hosted save fallback preserves browser-file export when server storage is unavailable", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /if \(!res\.ok\) \{\s*await saveJsonToCustomLocation/s);
});

test("tactical feed escapes translated scenario event text before inserting markup", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /escapeHtml\(translateEventText\(e\.text\)\)/);
});

test("tactical-map renders ship and missile labels as fill text, not stroke labels", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /shipDisplayName\(ship, "-"\)/);
  assert.doesNotMatch(appSource, /strokeText\(text, labelX, labelY\)/);
});

test("ship labels shrink and fade out as the map scale bar advances", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /function shipLabelScale\(\)/);
  assert.match(appSource, /scaleMeters <= 20 \* KM/);
  assert.match(appSource, /scaleMeters <= 50 \* KM/);
  assert.match(appSource, /scaleMeters <= 100 \* KM/);
  assert.match(appSource, /scaleMeters <= 200 \* KM/);
});

test("launched missiles display zoom-fading text labels beside their icons", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /function clusterSameTypeMissileLabels\(items, thresholdPx\)/);
  assert.match(appSource, /ctx\.font = canvasFont\(labelFontPx\)/);
  assert.match(appSource, /const labelFontPx = Math\.max\(7, VISUAL_CONFIG\.shipLabelPx \* 0\.4 \* label\.scale\)/);
  assert.match(appSource, /const groupKey = `\$\{missile\.side\}:\$\{missile\.missileId\}`;/);
});

test("ship and missile icons keep a small minimum size instead of collapsing to dots", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /worldSize\(ship\.lengthM, 4, 25\)/);
  assert.match(appSource, /Math\.max\(2\.2, VISUAL_CONFIG\.missileMinPx \* \(isAntiAir \? 0\.85 : 1\)\)/);
});

test("terrain rendering reuses a cached offscreen layer when the camera is unchanged", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /const terrainLayer = document\.createElement\("canvas"\);/);
  assert.match(appSource, /if \(terrainLayerKey !== key\) \{/);
  assert.match(appSource, /const TERRAIN_BUCKET_M = 4_000_000;/);
  assert.match(appSource, /terrainItemsInView\(paths\.landBuckets, viewBounds\)/);
  assert.match(appSource, /terrainItemsInView\(paths\.coastBuckets, viewBounds\)/);
  // The cached layer is blitted 1:1 in device space (identity transform) so a
  // fractional devicePixelRatio does not resample/soften the coastline.
  assert.match(appSource, /ctx\.drawImage\(terrainLayer, 0, 0\);/);
});

test("setup mode suppresses ship direction arrows until battle starts", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /sim\.mode !== SCENARIO_MODE\.SETUP && ship\.alive && \(ship\.speed > 0\.1 \|\| ship\.desiredSpeed > 0\.1\)/);
});

test("multi-selection radar rendering iterates every selected ship", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.match(appSource, /for \(const ship of sim\.ships\) \{\s*if \(selectedIds\.has\(ship\.id\)\) drawSectorResponsibility\(ship\);\s*\}/s);
  assert.doesNotMatch(appSource, /drawSectorResponsibility\(focus\)/);
});

test("weapon range labels omit the numeric distance suffix", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /formatDistanceKm\((?:entry|ring)\.rangeM\)/);
  assert.match(appSource, /ctx\.fillText\(ring\.shortLabel, labelX, labelY\)/);
});

test("spawn section keeps only the tight button-group box", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(styles, /#left-rail \{[\s\S]*background: transparent;[\s\S]*border-color: transparent;[\s\S]*box-shadow: none;/);
  assert.match(styles, /\.spawn-tools \{[\s\S]*border: 1px solid rgba\(142, 193, 205, 0\.42\);/);
});
