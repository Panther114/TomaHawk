import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  GRID_MAJOR_M,
  GRID_MINOR_M,
  TACTICAL_MAPS,
  formatDistanceKm,
  isLandPoint,
  niceScaleDistanceM,
  projectLonLat,
  shouldShowWeaponLabels,
  tacticalMap
} from "../src/ui/maps.js";

test("coastline map uses global Natural Earth land and coastline data", () => {
  const map = TACTICAL_MAPS.eastChinaSea;
  assert.equal(map.projection.type, "equirectangular");
  assert.ok(map.geographicExtent.west <= -180);
  assert.ok(map.geographicExtent.east >= 180);
  assert.ok(map.geographicExtent.south <= -90);
  assert.ok(map.geographicExtent.north >= 90);
  assert.ok(map.landRings.length > 1000);
  assert.ok(map.coastlines.length > 300);
  assert.equal(TACTICAL_MAPS.openSea.landRings.length, 0);
  assert.equal(tacticalMap("unknown"), TACTICAL_MAPS.openSea);
});

test("global projection keeps longitude and latitude scale stable", () => {
  const center = projectLonLat(0, 0);
  const north = projectLonLat(0, 1);
  const east = projectLonLat(1, 0);
  assert.ok(Math.abs(center.x) < 1e-6 && Math.abs(center.y) < 1e-6);
  assert.ok(Math.abs(Math.abs(north.y) - 111195) < 300);
  assert.ok(Math.abs(Math.abs(east.x) - 111195) < 300);
});

test("terrain query recognizes mainland coast and open East China Sea", () => {
  const map = TACTICAL_MAPS.eastChinaSea;
  assert.equal(isLandPoint(projectLonLat(121.47, 31.23), map), true);
  assert.equal(isLandPoint(projectLonLat(125, 28.2), map), false);
});

test("kilometer grid, formatting, scale bar, and zoom label threshold are stable", () => {
  assert.equal(GRID_MINOR_M, 20000);
  assert.equal(GRID_MAJOR_M, 100000);
  assert.equal(formatDistanceKm(51900), "52 km");
  assert.equal(formatDistanceKm(9500), "9.5 km");
  assert.deepEqual(niceScaleDistanceM(0.002), { meters: 50000, pixels: 100 });
  assert.equal(shouldShowWeaponLabels(0.0012), true);
  assert.equal(shouldShowWeaponLabels(0.00119), false);
});

test("canvas map fills the viewport without an outer border and uses kilometers", () => {
  const app = fs.readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /clipMapScene\(\)/);
  assert.doesNotMatch(app, /drawMapBorder\(\)/);
  assert.match(app, /niceScaleDistanceM\(camera\.scale, 72\)/);
  assert.match(app, /ctx\.fillText\(ring\.shortLabel, labelX, labelY\)/);
  assert.doesNotMatch(app, /(?:entry|ring)\.shortLabel\}\s*\$\{formatDistanceKm/);
  assert.match(app, /dKm\.toFixed\(1\).*km/);
  assert.doesNotMatch(app, /dNm\.toFixed/);
});
