import { NM } from "../sim/constants.js";

export const CORE_MAP_WIDTH_M = 720 * NM;
export const CORE_MAP_HEIGHT_M = 360 * NM;
const EARTH_RADIUS_M = 6371008.8;
export const MAP_WIDTH_M = 2 * Math.PI * EARTH_RADIUS_M;
export const MAP_HEIGHT_M = Math.PI * EARTH_RADIUS_M;
export const MAP_HALF_WIDTH_M = MAP_WIDTH_M / 2;
export const MAP_HALF_HEIGHT_M = MAP_HEIGHT_M / 2;
export const EAST_CHINA_SEA_CENTER = Object.freeze({ lon: 0, lat: 0 });
export const EAST_CHINA_SEA_CROP_PADDING = 0.18;

export function projectLonLat(lon, lat, center = EAST_CHINA_SEA_CENTER) {
  const toRad = Math.PI / 180;
  return {
    x: EARTH_RADIUS_M * (lon - center.lon) * toRad,
    y: -EARTH_RADIUS_M * (lat - center.lat) * toRad
  };
}

export function inverseProjectLonLat(x, y, center = EAST_CHINA_SEA_CENTER) {
  const toRad = Math.PI / 180;
  return {
    lon: center.lon + (x / EARTH_RADIUS_M) / toRad,
    lat: center.lat - (y / EARTH_RADIUS_M) / toRad
  };
}

function projectedBoundsSamples(widthM, heightM, padding = EAST_CHINA_SEA_CROP_PADDING) {
  const halfW = (widthM / 2) * (1 + padding);
  const halfH = (heightM / 2) * (1 + padding);
  return [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
    [0, -halfH],
    [halfW, 0],
    [0, halfH],
    [-halfW, 0]
  ];
}

export function geographicExtentForProjectedBounds(widthM, heightM, center = EAST_CHINA_SEA_CENTER, padding = EAST_CHINA_SEA_CROP_PADDING) {
  if (widthM >= MAP_WIDTH_M && heightM >= MAP_HEIGHT_M) {
    return Object.freeze({ west: -180, east: 180, south: -90, north: 90 });
  }
  const samples = projectedBoundsSamples(widthM, heightM, padding).map(([x, y]) => inverseProjectLonLat(x, y, center));
  return Object.freeze({
    west: Math.min(...samples.map((p) => p.lon)),
    east: Math.max(...samples.map((p) => p.lon)),
    south: Math.min(...samples.map((p) => p.lat)),
    north: Math.max(...samples.map((p) => p.lat))
  });
}
