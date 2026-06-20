import { NM } from "../sim.js";
import { EAST_CHINA_SEA_DATA } from "./data/east-china-sea-data.js";

export const KM = 1000;
export const GRID_MINOR_M = 20 * KM;
export const GRID_MAJOR_M = 100 * KM;
export const WEAPON_LABEL_MIN_SCALE = 0.0012;
export const MAP_WIDTH_M = 720 * NM;
export const MAP_HEIGHT_M = 360 * NM;
export const EAST_CHINA_SEA_CENTER = Object.freeze({ lon: 125, lat: 28.2 });
const EARTH_RADIUS_M = 6371008.8;

export function projectLonLat(lon, lat, center = EAST_CHINA_SEA_CENTER) {
  const toRad = Math.PI / 180;
  const lambda = lon * toRad;
  const phi = lat * toRad;
  const lambda0 = center.lon * toRad;
  const phi0 = center.lat * toRad;
  const delta = lambda - lambda0;
  const cosC = Math.max(-1, Math.min(1,
    Math.sin(phi0) * Math.sin(phi) + Math.cos(phi0) * Math.cos(phi) * Math.cos(delta)
  ));
  const c = Math.acos(cosC);
  const k = c < 1e-12 ? 1 : c / Math.sin(c);
  const x = EARTH_RADIUS_M * k * Math.cos(phi) * Math.sin(delta);
  const north = EARTH_RADIUS_M * k * (
    Math.cos(phi0) * Math.sin(phi) - Math.sin(phi0) * Math.cos(phi) * Math.cos(delta)
  );
  return { x, y: -north };
}

export function formatDistanceKm(meters) {
  const km = Math.max(0, meters) / KM;
  return `${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

export function niceScaleDistanceM(scale, targetPx = 100) {
  const rawMeters = targetPx / Math.max(scale, Number.EPSILON);
  const magnitude = 10 ** Math.floor(Math.log10(rawMeters));
  const candidates = [1, 2, 5, 10].map((factor) => factor * magnitude);
  const meters = candidates.reduce((best, candidate) => (
    Math.abs(candidate * scale - targetPx) < Math.abs(best * scale - targetPx) ? candidate : best
  ));
  return { meters, pixels: meters * scale };
}

export function shouldShowWeaponLabels(scale) {
  return scale >= WEAPON_LABEL_MIN_SCALE;
}

const emptyData = Object.freeze({ landRings: [], coastlines: [] });

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
    geographicExtent: { west: 118.2, east: 131.8, south: 25.2, north: 31.2 },
    landRings: EAST_CHINA_SEA_DATA.landRings,
    coastlines: EAST_CHINA_SEA_DATA.coastlines
  }
};

export function tacticalMap(id) {
  return TACTICAL_MAPS[id] ?? TACTICAL_MAPS.openSea;
}

export function isLandPoint(point, map = TACTICAL_MAPS.openSea) {
  return map.landRings.some((polygon) => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, ay] = polygon[i];
      const [bx, by] = polygon[j];
      const crosses = (ay > point.y) !== (by > point.y)
        && point.x < ((bx - ax) * (point.y - ay)) / (by - ay) + ax;
      if (crosses) inside = !inside;
    }
    return inside;
  });
}
