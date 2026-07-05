import { EAST_CHINA_SEA_DATA } from "../ui/data/east-china-sea-data.js";
import {
  CORE_MAP_HEIGHT_M,
  CORE_MAP_WIDTH_M,
  EAST_CHINA_SEA_CENTER,
  geographicExtentForProjectedBounds,
  MAP_HALF_HEIGHT_M,
  MAP_HALF_WIDTH_M,
  MAP_HEIGHT_M,
  MAP_WIDTH_M,
  projectLonLat
} from "./map-spec.js";
const landCache = new WeakMap();
const TERRAIN_GRID_CELL_M = 24 * 1852;
const WATER_MASK_CELL_M = 0.5 * 1852;
const WATER_SAMPLE_ANGLES = Object.freeze([
  0,
  Math.PI / 4,
  Math.PI / 2,
  (3 * Math.PI) / 4,
  Math.PI,
  (-3 * Math.PI) / 4,
  -Math.PI / 2,
  -Math.PI / 4
]);

const emptyData = Object.freeze({ landRings: [], coastlines: [] });

export {
  CORE_MAP_HEIGHT_M,
  CORE_MAP_WIDTH_M,
  EAST_CHINA_SEA_CENTER,
  MAP_HALF_HEIGHT_M,
  MAP_HALF_WIDTH_M,
  MAP_HEIGHT_M,
  MAP_WIDTH_M,
  projectLonLat
};

export const TACTICAL_MAPS = {
  openSea: {
    id: "openSea",
    projection: null,
    geographicExtent: null,
    ...emptyData
  },
  eastChinaSea: {
    id: "eastChinaSea",
    projection: {
      type: "azimuthal-equidistant",
      center: EAST_CHINA_SEA_CENTER,
      sourceCrs: "EPSG:4326"
    },
    geographicExtent: geographicExtentForProjectedBounds(MAP_WIDTH_M, MAP_HEIGHT_M),
    landRings: EAST_CHINA_SEA_DATA.landRings,
    coastlines: EAST_CHINA_SEA_DATA.coastlines
  }
};

export function tacticalMap(id) {
  return TACTICAL_MAPS[id] ?? TACTICAL_MAPS.openSea;
}

export function normalizeMapId(id) {
  return tacticalMap(id).id;
}

export function isLandPoint(point, map = TACTICAL_MAPS.openSea) {
  const index = terrainIndex(map);
  return entriesAtPoint(index, point).some((entry) => pointInRing(point, entry));
}

export function isWaterPoint(point, mapOrId = TACTICAL_MAPS.openSea, clearanceM = 0) {
  const map = typeof mapOrId === "string" ? tacticalMap(mapOrId) : (mapOrId ?? TACTICAL_MAPS.openSea);
  const index = terrainIndex(map);
  if (!index.ringEntries.length) return true;
  if (waterMaskCellIsClear(index, point, clearanceM)) return true;
  if (isLandPoint(point, map)) return false;
  if (!(clearanceM > 0)) return true;
  for (const angle of WATER_SAMPLE_ANGLES) {
    const sample = {
      x: point.x + Math.cos(angle) * clearanceM,
      y: point.y + Math.sin(angle) * clearanceM
    };
    if (isLandPoint(sample, map)) return false;
  }
  return true;
}

export function segmentCrossesLand(start, end, mapOrId = TACTICAL_MAPS.openSea, clearanceM = 0) {
  return terrainCollision(start, end, mapOrId, clearanceM) !== null;
}

export function firstLandCollisionFraction(start, end, mapOrId = TACTICAL_MAPS.openSea, clearanceM = 0) {
  return terrainCollision(start, end, mapOrId, clearanceM)?.fraction ?? null;
}

export function terrainCollision(start, end, mapOrId = TACTICAL_MAPS.openSea, clearanceM = 0) {
  const map = typeof mapOrId === "string" ? tacticalMap(mapOrId) : (mapOrId ?? TACTICAL_MAPS.openSea);
  const index = terrainIndex(map);
  if (!index.ringEntries.length) return null;
  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
  if (segmentLength <= WATER_MASK_CELL_M) {
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    if (
      waterMaskCellIsClear(index, start, clearanceM)
      && waterMaskCellIsClear(index, mid, clearanceM)
      && waterMaskCellIsClear(index, end, clearanceM)
    ) {
      return null;
    }
  }
  const bounds = {
    minX: Math.min(start.x, end.x) - clearanceM,
    maxX: Math.max(start.x, end.x) + clearanceM,
    minY: Math.min(start.y, end.y) - clearanceM,
    maxY: Math.max(start.y, end.y) + clearanceM
  };
  const candidates = entriesInBounds(index, bounds);
  if (!candidates.length) return null;
  const edgeCandidates = indexedEntriesInBounds(index, index.edgeEntries, index.edgeCells, index.edgeQueryMarks, bounds);
  const offsets = clearanceM > 0
    ? [{ x: 0, y: 0 }, ...WATER_SAMPLE_ANGLES.map((angle) => ({
        x: Math.cos(angle) * clearanceM,
        y: Math.sin(angle) * clearanceM
      }))]
    : [{ x: 0, y: 0 }];
  let first = Infinity;
  for (const offset of offsets) {
    const shiftedStart = { x: start.x + offset.x, y: start.y + offset.y };
    const shiftedEnd = { x: end.x + offset.x, y: end.y + offset.y };
    if (!waterMaskCellIsClear(index, shiftedStart, 0)) {
      for (const entry of candidates) {
        if (pointInRing(shiftedStart, entry)) return { fraction: 0, ring: entry.polygon };
      }
    }
    for (const edge of edgeCandidates) {
      const fraction = segmentIntersectionFraction(shiftedStart, shiftedEnd, edge.start, edge.end);
      if (fraction < first) first = fraction;
    }
  }
  return Number.isFinite(first) ? { fraction: first } : null;
}

function terrainIndex(map) {
  const normalized = map ?? TACTICAL_MAPS.openSea;
  let cached = landCache.get(normalized);
  if (!cached) {
    const ringEntries = (normalized.landRings ?? []).map((polygon) => ({ polygon, bbox: ringBounds(polygon) }));
    const edgeEntries = buildEdgeEntries(ringEntries);
    cached = {
      ringEntries,
      cells: buildSpatialCells(ringEntries),
      edgeEntries,
      edgeCells: buildSpatialCells(edgeEntries),
      ringQueryMarks: new Uint32Array(ringEntries.length),
      edgeQueryMarks: new Uint32Array(edgeEntries.length),
      queryStamp: 0,
      safeWaterMask: new Map()
    };
    landCache.set(normalized, cached);
  }
  return cached;
}

function ringBounds(polygon) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function gridCoordinate(value) {
  return Math.floor(value / TERRAIN_GRID_CELL_M);
}

function gridKey(x, y) {
  return `${x},${y}`;
}

function buildSpatialCells(entries) {
  const cells = new Map();
  entries.forEach((entry, entryIndex) => {
    for (let x = gridCoordinate(entry.bbox.minX); x <= gridCoordinate(entry.bbox.maxX); x++) {
      for (let y = gridCoordinate(entry.bbox.minY); y <= gridCoordinate(entry.bbox.maxY); y++) {
        const key = gridKey(x, y);
        const bucket = cells.get(key);
        if (bucket) bucket.push(entryIndex);
        else cells.set(key, [entryIndex]);
      }
    }
  });
  return cells;
}

function boundsOverlap(a, b) {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

function entriesAtPoint(index, point) {
  const ids = index.cells.get(gridKey(gridCoordinate(point.x), gridCoordinate(point.y))) ?? [];
  return ids.map((id) => index.ringEntries[id]);
}

function entriesInBounds(index, bounds) {
  return indexedEntriesInBounds(index, index.ringEntries, index.cells, index.ringQueryMarks, bounds);
}

function indexedEntriesInBounds(index, entriesSource, cells, marks, bounds) {
  index.queryStamp = (index.queryStamp + 1) >>> 0;
  if (index.queryStamp === 0) {
    index.ringQueryMarks.fill(0);
    index.edgeQueryMarks.fill(0);
    index.queryStamp = 1;
  }
  const stamp = index.queryStamp;
  const ids = [];
  for (let x = gridCoordinate(bounds.minX); x <= gridCoordinate(bounds.maxX); x++) {
    for (let y = gridCoordinate(bounds.minY); y <= gridCoordinate(bounds.maxY); y++) {
      for (const id of cells.get(gridKey(x, y)) ?? []) {
        if (marks[id] === stamp) continue;
        marks[id] = stamp;
        ids.push(id);
      }
    }
  }
  const entries = [];
  for (const id of ids) {
    const entry = entriesSource[id];
    if (boundsOverlap(entry.bbox, bounds)) entries.push(entry);
  }
  return entries;
}

function buildEdgeEntries(ringEntries) {
  const edges = [];
  for (const { polygon } of ringEntries) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const start = { x: polygon[j][0], y: polygon[j][1] };
      const end = { x: polygon[i][0], y: polygon[i][1] };
      edges.push({
        start,
        end,
        bbox: {
          minX: Math.min(start.x, end.x),
          maxX: Math.max(start.x, end.x),
          minY: Math.min(start.y, end.y),
          maxY: Math.max(start.y, end.y)
        }
      });
    }
  }
  return edges;
}

function waterMaskCellIsClear(index, point, clearanceM) {
  const cellX = Math.floor(point.x / WATER_MASK_CELL_M);
  const cellY = Math.floor(point.y / WATER_MASK_CELL_M);
  const clearanceKey = Math.ceil(Math.max(0, clearanceM));
  const key = `${cellX},${cellY},${clearanceKey}`;
  if (index.safeWaterMask.has(key)) return index.safeWaterMask.get(key);
  const bounds = {
    minX: cellX * WATER_MASK_CELL_M - clearanceKey,
    maxX: (cellX + 1) * WATER_MASK_CELL_M + clearanceKey,
    minY: cellY * WATER_MASK_CELL_M - clearanceKey,
    maxY: (cellY + 1) * WATER_MASK_CELL_M + clearanceKey
  };
  const clear = entriesInBounds(index, bounds).length === 0;
  index.safeWaterMask.set(key, clear);
  return clear;
}

function pointInRing(point, entry) {
  const { bbox, polygon } = entry;
  if (point.x < bbox.minX || point.x > bbox.maxX || point.y < bbox.minY || point.y > bbox.maxY) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i];
    const [bx, by] = polygon[j];
    const crosses = (ay > point.y) !== (by > point.y)
      && point.x < ((bx - ax) * (point.y - ay)) / (by - ay) + ax;
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentIntersectionFraction(start, end, edgeStart, edgeEnd) {
  const rx = end.x - start.x;
  const ry = end.y - start.y;
  const sx = edgeEnd.x - edgeStart.x;
  const sy = edgeEnd.y - edgeStart.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return Infinity;
  const qpx = edgeStart.x - start.x;
  const qpy = edgeStart.y - start.y;
  const t = (qpx * sy - qpy * sx) / denominator;
  const u = (qpx * ry - qpy * rx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : Infinity;
}
