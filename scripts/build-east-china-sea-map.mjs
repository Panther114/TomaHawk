import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  EAST_CHINA_SEA_CENTER,
  projectLonLat
} from "../src/world/map-spec.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "src", "ui", "data", "east-china-sea-data.js");
const NATURAL_EARTH_REVISION = "ca96624a56bd078437bca8184e78163e5039ad19";
const SOURCES = {
  land: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_REVISION}/geojson/ne_50m_land.geojson`,
  coast: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_REVISION}/geojson/ne_50m_coastline.geojson`,
  lakes: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_REVISION}/geojson/ne_50m_lakes.geojson`,
  // A separate line layer keeps political boundaries out of collision logic.
  // This is a generalized cartographic reference, not a legal boundary survey.
  borders: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_REVISION}/geojson/ne_50m_admin_0_boundary_lines_land.geojson`,
  // China-side boundary geometry from the versioned cnmaps-data release. Its
  // documentation identifies this geometry as the Chinese mapping-standard
  // side of disputed boundaries; it is rendered only as a visual reference.
  prcBoundary: "https://raw.githubusercontent.com/cnmetlab/cnmaps-data/1.1.2/cnmaps_data/data/datasets/administrative/amap/land/100000.geojson"
};
const CROP = {
  minLon: -180,
  maxLon: 180,
  minLat: -90,
  maxLat: 90
};

function project([lon, lat]) {
  const p = projectLonLat(lon, lat, EAST_CHINA_SEA_CENTER);
  return [Math.round(p.x), Math.round(p.y)];
}

function pointInPolygon(ring, px, py) {
  let inside = false;
  for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
    const [ax, ay] = ring[k], [bx, by] = ring[l];
    if ((ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function ringBbox(ring) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, maxX, minY, maxY };
}

function clipRing(ring) {
  const edges = [
    { inside: ([x]) => x >= CROP.minLon, cross: (a, b) => [CROP.minLon, a[1] + (b[1] - a[1]) * (CROP.minLon - a[0]) / (b[0] - a[0])] },
    { inside: ([x]) => x <= CROP.maxLon, cross: (a, b) => [CROP.maxLon, a[1] + (b[1] - a[1]) * (CROP.maxLon - a[0]) / (b[0] - a[0])] },
    { inside: (([, y]) => y >= CROP.minLat), cross: (a, b) => [a[0] + (b[0] - a[0]) * (CROP.minLat - a[1]) / (b[1] - a[1]), CROP.minLat] },
    { inside: (([, y]) => y <= CROP.maxLat), cross: (a, b) => [a[0] + (b[0] - a[0]) * (CROP.maxLat - a[1]) / (b[1] - a[1]), CROP.maxLat] }
  ];
  let output = ring;
  for (const edge of edges) {
    const input = output;
    output = [];
    if (!input.length) break;
    let previous = input[input.length - 1];
    for (const current of input) {
      if (edge.inside(current)) {
        if (!edge.inside(previous)) output.push(edge.cross(previous, current));
        output.push(current);
      } else if (edge.inside(previous)) {
        output.push(edge.cross(previous, current));
      }
      previous = current;
    }
  }
  return output.length >= 3 ? output : [];
}

function clipSegment(a, b) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - CROP.minLon], [dx, CROP.maxLon - a[0]], [-dy, a[1] - CROP.minLat], [dy, CROP.maxLat - a[1]]]) {
    if (p === 0 && q < 0) return null;
    if (p === 0) continue;
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

function clipLine(line) {
  const parts = [];
  let current = [];
  for (let i = 1; i < line.length; i += 1) {
    const segment = clipSegment(line[i - 1], line[i]);
    if (!segment) {
      if (current.length > 1) parts.push(current);
      current = [];
      continue;
    }
    if (!current.length || current.at(-1)[0] !== segment[0][0] || current.at(-1)[1] !== segment[0][1]) {
      if (current.length > 1) parts.push(current);
      current = [segment[0]];
    }
    current.push(segment[1]);
  }
  if (current.length > 1) parts.push(current);
  return parts;
}

function polygonRings(geometry, exteriorOnly = true) {
  if (geometry.type === "Polygon") return exteriorOnly ? [geometry.coordinates[0]] : geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((poly) => exteriorOnly ? poly[0] : poly).flat();
  return [];
}

function lineStrings(geometry) {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function segmentRectInterval(a, b, rect) {
  let enter = 0;
  let exit = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [start, delta, min, max] of [
    [a[0], dx, rect.minLon, rect.maxLon],
    [a[1], dy, rect.minLat, rect.maxLat]
  ]) {
    if (delta === 0) {
      if (start < min || start > max) return null;
      continue;
    }
    let low = (min - start) / delta;
    let high = (max - start) / delta;
    if (low > high) [low, high] = [high, low];
    enter = Math.max(enter, low);
    exit = Math.min(exit, high);
    if (enter > exit) return null;
  }
  return [Math.max(0, enter), Math.min(1, exit)];
}

function interpolate(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Natural Earth contains the international version of several China-adjacent
// lines. Remove only the portions in the China replacement window, preserving
// the rest of the global border layer, then add the PRC-side outline below.
function lineOutsideRect(line, rect) {
  const parts = [];
  let current = [];
  const flush = () => {
    if (current.length > 1) parts.push(current);
    current = [];
  };
  const append = (start, end) => {
    if (!current.length) current = [start, end];
    else {
      const last = current.at(-1);
      if (Math.abs(last[0] - start[0]) < 1e-9 && Math.abs(last[1] - start[1]) < 1e-9) current.push(end);
      else { flush(); current = [start, end]; }
    }
  };
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const interval = segmentRectInterval(a, b, rect);
    if (!interval) {
      append(a, b);
      continue;
    }
    const [enter, exit] = interval;
    if (enter > 1e-9) {
      append(a, interpolate(a, b, enter));
      flush();
    } else {
      flush();
    }
    if (exit < 1 - 1e-9) append(interpolate(a, b, exit), b);
  }
  flush();
  return parts;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

const [land, coast, lakes, borders, prcBoundary] = await Promise.all([
  fetchJson(SOURCES.land),
  fetchJson(SOURCES.coast),
  fetchJson(SOURCES.lakes),
  fetchJson(SOURCES.borders),
  fetchJson(SOURCES.prcBoundary)
]);
const landRings = land.features
  .flatMap((feature) => polygonRings(feature.geometry))
  .filter((ring) => ring.length >= 3 && Array.isArray(ring[0]))
  .map(clipRing)
  .filter((ring) => ring.length >= 3)
  .map((ring) => ring.map(project));
const waterRings = lakes.features
  .flatMap((feature) => polygonRings(feature.geometry))
  .filter((ring) => ring.length >= 3 && Array.isArray(ring[0]))
  .map(clipRing)
  .filter((ring) => ring.length >= 3)
  .map((ring) => ring.map(project));
// Also derive water rings from closed coastline loops that lie inside a land
// polygon (e.g. the Caspian Sea, which Natural Earth 1:50m land treats as part
// of the continental landmass).  The heuristic: a closed coastline loop whose
// bounding box is much smaller than its containing land ring's bbox is an
// inland water body (lake/sea), not an island (whose coastline ≈ land ring).
const coastlineRings = coast.features
  .flatMap((feature) => lineStrings(feature.geometry))
  .filter((line) => line.length >= 3)
  .map(clipLine)
  .flat()
  .filter((line) => line.length >= 3)
  .map((line) => line.map(project));
const closedCoastRings = coastlineRings.filter((line) => {
  const first = line[0], last = line[line.length - 1];
  return Math.hypot(last[0] - first[0], last[1] - first[1]) < 1000 && line.length >= 10;
});
for (const coastRing of closedCoastRings) {
  const cb = ringBbox(coastRing);
  const coastArea = (cb.maxX - cb.minX) * (cb.maxY - cb.minY);
  const cx = (cb.minX + cb.maxX) / 2, cy = (cb.minY + cb.maxY) / 2;
  // Is the centre inside an existing water ring (lake-data source)?  Skip — it is a lake island.
  const skip = waterRings.some((wr) => pointInPolygon(wr, cx, cy));
  if (skip) continue;
  // Is the centre inside a land ring?
  for (const lr of landRings) {
    if (pointInPolygon(lr, cx, cy)) {
      const lb = ringBbox(lr);
      const landArea = (lb.maxX - lb.minX) * (lb.maxY - lb.minY);
      // Inland sea: coastline bbox is < 10 % of the containing land bbox.
      if (landArea > 0 && coastArea / landArea < 0.1 && coastRing.length < lr.length) {
        waterRings.push(coastRing);
      }
      break;
    }
  }
}
const coastlines = coastlineRings;
const chinaReplacementWindow = { minLon: 70, maxLon: 140, minLat: 2, maxLat: 56 };
const naturalEarthBorders = borders.features
  .flatMap((feature) => lineStrings(feature.geometry))
  .flatMap((line) => lineOutsideRect(line, chinaReplacementWindow))
  .filter((line) => line.length >= 2)
  .map((line) => line.map(project));
const prcBoundaryRings = prcBoundary.type === "Polygon"
  ? [prcBoundary.coordinates[0]]
  : prcBoundary.type === "MultiPolygon"
    ? prcBoundary.coordinates.map((polygon) => polygon[0])
    : [];
const prcBorders = prcBoundaryRings
  .filter((ring) => ring.length >= 3 && Array.isArray(ring[0]))
  .map(clipRing)
  .filter((ring) => ring.length >= 3)
  .map((ring) => ring.map(project));
const nationalBorders = [...naturalEarthBorders, ...prcBorders];

const output = `// Generated by scripts/build-east-china-sea-map.mjs.\n`
  + `// Natural Earth vector revision: ${NATURAL_EARTH_REVISION}\n`
  + `// Global border reference: https://www.naturalearthdata.com/\n`
  + `// China-side outline: cnmaps-data 1.1.2 (amap/100000), MIT, https://github.com/cnmetlab/cnmaps-data\n`
  + `// The border toggle is a visual reference; public release in China still requires the applicable map review.\n`
  + `export const EAST_CHINA_SEA_DATA = ${JSON.stringify({ landRings, waterRings, coastlines, nationalBorders })};\n`;
await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, output);
console.log(`Wrote ${OUTPUT} (${landRings.length} land rings, ${waterRings.length} water rings, ${coastlines.length} coastline paths, ${nationalBorders.length} national-border paths)`);
