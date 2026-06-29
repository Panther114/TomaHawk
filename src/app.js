import {
  MISSILES,
  NM,
  SCENARIO_MODE,
  SIDE,
  SHIP_CLASSES,
  VISUAL_CONFIG,
  aliveAircraftCount,
  squadronSize,
  battleSummaryCounts,
  canRunScenario,
  canAddAssets,
  clampShipToBounds,
  createDefaultScenario,
  deleteShip,
  distance,
  eventSeverity,
  exportAfterAction,
  formatTime,
  isShipPositionOnWater,
  isShipPositionOnLand,
  missileDisplayRole,
  placeShip,
  restoreScenario,
  serializeScenario,
  setScenarioMap,
  setLoadout,
  stepSim,
  tracksForShip,
  weaponRangeEntries
} from "./sim.js";
import {
  sideColor,
  sideSoftColor,
  shipHpState,
  shipDisplayName,
  vlsLoadState,
  renderBattleStatus,
  inventoryHtml,
  clusterProximityLabels,
  worldToScreen as projectWorldToScreen,
  screenToWorld as projectScreenToWorld
} from "./ui/view.js";
import { t, toggleLang, getLang, sideLabel, translateEventText, formatLocalizedEventLines } from "./ui/lang.js";
import { createModEditor } from "./mods/editor.js";
import {
  GRID_MAJOR_M,
  GRID_MINOR_M,
  KM,
  MAP_HALF_HEIGHT_M,
  MAP_HALF_WIDTH_M,
  MAP_HEIGHT_M,
  MAP_WIDTH_M,
  formatDistanceKm,
  niceScaleDistanceM,
  shouldShowWeaponLabels,
  tacticalMap
} from "./ui/maps.js";

const canvas = document.querySelector("#map");
const ctx = canvas.getContext("2d");
const play = document.querySelector("#play");
const step = document.querySelector("#step");
const speed = document.querySelector("#speed");
const shipClassSelect = document.querySelector("#ship-class");
const clock = document.querySelector("#clock");
const cursor = document.querySelector("#cursor");
const status = document.querySelector("#status");
const eventConsole = document.querySelector("#event-console");
const eventLog = document.querySelector("#event-log");
const toggleFeed = document.querySelector("#toggle-feed");
const copyFireLog = document.querySelector("#copy-fire-log");
const unitTab = document.querySelector("#unit-tab");
const langToggle = document.querySelector("#lang-toggle");
const mapSelect = document.querySelector("#map-select");
const scaleDistance = document.querySelector("#scale-distance");
const scaleGrid = document.querySelector("#scale-grid");
const scaleRule = document.querySelector(".scale-rule");
const shipDetailOverlay = document.createElement("div");
shipDetailOverlay.id = "ship-detail-overlay";
document.body.appendChild(shipDetailOverlay);
const filters = {
  grid: document.querySelector("#filter-grid"),
  tracks: document.querySelector("#filter-tracks"),
  radar: document.querySelector("#filter-radar"),
  ranges: document.querySelector("#filter-ranges"),
  rangesMode: document.querySelector("#ranges-mode"),
  missiles: document.querySelector("#filter-missiles")
};

let sim = createDefaultScenario(undefined, mapSelect?.value);
let tool = "select";
let camera = { x: 0, y: 0, scale: 0.00125 };
let drag = null;
let activeRuler = null;
let rulers = [];
let selectionBox = null;
let selectedIds = new Set([sim.selectedId]);
let last = performance.now();
let labelBoxes = [];
let feedCollapsed = false;
let aboutOpen = false;
const MAX_CAMERA_SCALE = 0.011;

function minimumCameraScale() {
  return Math.max(innerWidth / MAP_WIDTH_M, innerHeight / MAP_HEIGHT_M);
}
const TACTICAL_SYMBOL_SCALE = 26;
const CANVAS_FONT_FAMILY = '"Segoe UI", Arial, sans-serif';
const canvasFont = (px) => `${px}px ${CANVAS_FONT_FAMILY}`;
const terrainPathCache = new WeakMap();
const weaponRangeCache = new WeakMap();
const terrainLayer = document.createElement("canvas");
const terrainLayerCtx = terrainLayer.getContext("2d");
let terrainLayerKey = "";
const panelRenderCache = {
  lang: null,
  status: "",
  inventory: "",
  events: "",
  eventHead: null,
  details: "",
  placement: "",
  scale: ""
};
const RUN_STATUS = {
  get ready() { return t('status.ready'); },
  get invalid() { return t('status.invalid'); },
  get running() { return t('status.running'); },
  get paused() { return t('status.paused'); },
  get ended() { return t('status.ended'); }
};

function replaceHtmlIfChanged(element, html) {
  if (element.innerHTML !== html) element.innerHTML = html;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.floor(innerWidth * dpr);
  const h = Math.floor(innerHeight * dpr);
  canvas.width = w;
  canvas.height = h;
  // Size the element from the floored backing store divided by dpr so the
  // backing maps 1:1 onto physical pixels. Using innerWidth directly leaves a
  // sub-pixel mismatch at fractional dpr (e.g. 1.5 on Windows 150% scaling):
  // 625css * 1.5 = 937.5 device px vs a 937 backing → resampling blur.
  canvas.style.width = `${w / dpr}px`;
  canvas.style.height = `${h / dpr}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  terrainLayerKey = "";
  clampCamera();
}

function selectedShip() {
  return sim.ships.find((s) => s.id === sim.selectedId) ?? sim.ships[0];
}

function setPrimarySelection(ship) {
  if (!ship) return;
  sim.selectedId = ship.id;
  selectedIds = new Set([ship.id]);
}

// Thin wrappers binding the pure transforms in ui/view.js to this module's
// live camera + window viewport.
function worldToScreen(p) {
  return projectWorldToScreen(p, camera, innerWidth, innerHeight);
}

function screenToWorld(x, y) {
  return projectScreenToWorld(x, y, camera, innerWidth, innerHeight);
}

function screenPointVisible(point, margin = 32) {
  return point.x >= -margin && point.x <= innerWidth + margin
    && point.y >= -margin && point.y <= innerHeight + margin;
}

function segmentIntersectsViewport(a, b, margin = 0) {
  const minX = -margin;
  const maxX = innerWidth + margin;
  const minY = -margin;
  const maxY = innerHeight + margin;
  if (screenPointVisible(a, margin) || screenPointVisible(b, margin)) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let low = 0;
  let high = 1;
  for (const [p, q] of [[-dx, a.x - minX], [dx, maxX - a.x], [-dy, a.y - minY], [dy, maxY - a.y]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}

function drawSceneBase() {
  ctx.fillStyle = "#07141b";
  ctx.fillRect(0, 0, innerWidth, innerHeight);
}

function clampCamera() {
  const minScale = minimumCameraScale();
  camera.scale = Math.max(minScale, Math.min(MAX_CAMERA_SCALE, camera.scale));
  const halfViewW = innerWidth / (2 * camera.scale);
  const halfViewH = innerHeight / (2 * camera.scale);
  camera.x = Math.max(-MAP_HALF_WIDTH_M + halfViewW, Math.min(MAP_HALF_WIDTH_M - halfViewW, camera.x));
  camera.y = Math.max(-MAP_HALF_HEIGHT_M + halfViewH, Math.min(MAP_HALF_HEIGHT_M - halfViewH, camera.y));
}

function worldSize(meters, minPx = 2, maxPx = 24, multiplier = TACTICAL_SYMBOL_SCALE) {
  return Math.max(minPx, Math.min(maxPx, meters * camera.scale * multiplier));
}

function shipLabelScale() {
  const scaleMeters = niceScaleDistanceM(camera.scale, 72).meters;
  if (scaleMeters <= 20 * KM) return { scale: 1, alpha: 1 };
  if (scaleMeters <= 50 * KM) {
    const t = (scaleMeters - 20 * KM) / (30 * KM);
    return { scale: 1 - t * 0.16, alpha: 1 };
  }
  if (scaleMeters <= 100 * KM) {
    const t = (scaleMeters - 50 * KM) / (50 * KM);
    return { scale: 0.84 - t * 0.34, alpha: 1 - t * 0.18 };
  }
  if (scaleMeters <= 200 * KM) {
    const t = (scaleMeters - 100 * KM) / (100 * KM);
    return { scale: 0.5 - t * 0.5, alpha: 0.82 - t * 0.82 };
  }
  return { scale: 0, alpha: 0 };
}

function clusterSameTypeMissileLabels(items, thresholdPx) {
  return clusterProximityLabels(items, thresholdPx);
}

function labelAlpha(force = false) {
  if (force) return 1;
  return Math.max(0, Math.min(1, (camera.scale - 0.0007) / 0.0016));
}

function reserveLabel(text, x, y, font, critical = false) {
  ctx.save();
  ctx.font = font;
  const metrics = ctx.measureText(text);
  ctx.restore();
  const h = Math.max(7, Number(font.match(/([\d.]+)px/)?.[1] ?? 7) + 2);
  const box = {
    left: x - 2,
    right: x + metrics.width + 2,
    top: y - h + 2,
    bottom: y + 3
  };
  const collides = labelBoxes.some((b) => box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top);
  if (collides && !critical) return false;
  labelBoxes.push(box);
  return true;
}

function drawGrid() {
  if (!filters.grid.classList.contains("active")) return;
  const leftTop = screenToWorld(0, 0);
  const rightBottom = screenToWorld(innerWidth, innerHeight);

  for (let x = Math.floor(leftTop.x / GRID_MINOR_M) * GRID_MINOR_M; x < rightBottom.x; x += GRID_MINOR_M) {
    const sx = worldToScreen({ x, y: 0 }).x;
    const isMajor = Math.abs(x % GRID_MAJOR_M) < 1;
    ctx.strokeStyle = isMajor ? "rgba(95,139,154,.36)" : "rgba(95,139,154,.14)";
    ctx.lineWidth = isMajor ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, innerHeight);
    ctx.stroke();
  }
  for (let y = Math.floor(leftTop.y / GRID_MINOR_M) * GRID_MINOR_M; y < rightBottom.y; y += GRID_MINOR_M) {
    const sy = worldToScreen({ x: 0, y }).y;
    const isMajor = Math.abs(y % GRID_MAJOR_M) < 1;
    ctx.strokeStyle = isMajor ? "rgba(95,139,154,.36)" : "rgba(95,139,154,.14)";
    ctx.lineWidth = isMajor ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(innerWidth, sy);
    ctx.stroke();
  }

}

function drawRadarRings() {
  if (!filters.radar.classList.contains("active")) return;
  for (const ship of sim.ships) {
    if (!ship.alive || !ship.radarActive) continue;
    if (!selectedIds.has(ship.id)) continue;
    const p = worldToScreen(ship);
    ctx.strokeStyle = `${sideColor(ship.side)}26`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ship.radarRangeM * camera.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function ringDash(style) {
  if (style === "dotted") return [1, 5];
  if (style === "long_dash") return [10, 7];
  return [];
}

function cachedWeaponRangeEntries(ship) {
  const key = Object.entries(ship.loadout).map(([id, count]) => `${id}:${count}`).join("|");
  const cached = weaponRangeCache.get(ship);
  if (cached?.key === key) return cached.entries;
  const entries = weaponRangeEntries(ship);
  weaponRangeCache.set(ship, { key, entries });
  return entries;
}

// Collect every weapon range ring that should be drawn this frame, in screen
// space. Honors the range-ring filter/mode exactly as before.
function collectWeaponRangeRings() {
  const rings = [];
  if (!filters.ranges.classList.contains("active")) return rings;
  const mode = filters.rangesMode.value;
  if (mode === "off") return rings;
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    const selected = ship.id === sim.selectedId;
    if (mode === "selected" && !selected) continue;
    const p = worldToScreen(ship);
    for (const entry of cachedWeaponRangeEntries(ship)) {
      const radius = entry.rangeM * camera.scale;
      if (radius < 1.5) continue;
      rings.push({
        side: ship.side,
        id: entry.id,
        category: entry.category,
        ringStyle: entry.ringStyle,
        shortLabel: entry.shortLabel,
        x: p.x,
        y: p.y,
        radius,
        selected
      });
    }
  }
  return rings;
}

// Clip the canvas to the region OUTSIDE a circle, by filling a huge rectangle
// with the circle punched out (even-odd winding) and clipping to it. Applied
// once per overlapping neighbour, the successive (intersecting) clips leave
// only the part of a ring that lies outside every same-type neighbour.
function clipOutsideCircle(circle) {
  ctx.beginPath();
  ctx.rect(-1e7, -1e7, 2e7, 2e7);
  ctx.moveTo(circle.x + circle.radius, circle.y);
  ctx.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
  ctx.clip("evenodd");
}

function drawWeaponRangeRings() {
  const rings = collectWeaponRangeRings();
  if (!rings.length) return;
  // Group rings by faction + weapon type. Only members of the same group may
  // merge — different weapon (different radius/style) or different faction
  // (different colour) never do. Within a group, a ring is clipped against the
  // same-type neighbours it actually overlaps so the crossing internal arcs
  // disappear, leaving a single union outline; non-overlapping rings are left
  // whole and look exactly as before. Per-ring style/colour/dash/labels are
  // unchanged.
  const groups = new Map();
  for (const ring of rings) {
    const key = `${ring.side}|${ring.id}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(ring);
  }
  ctx.save();
  for (const ring of rings) {
    const group = groups.get(`${ring.side}|${ring.id}`);
    const overlappers = group.length > 1
      ? group.filter((other) => {
        if (other === ring) return false;
        const dx = ring.x - other.x;
        const dy = ring.y - other.y;
        const reach = ring.radius + other.radius;
        return dx * dx + dy * dy < reach * reach;
      })
      : [];
    ctx.setLineDash(ringDash(ring.ringStyle));
    const isAirDefense = ring.category !== "anti_ship";
    const alpha = ring.selected ? 0.82 : 0.58;
    ctx.strokeStyle = ring.category === "anti_ship"
      ? `rgba(247, 231, 161, ${ring.selected ? 0.34 : 0.24})`
      : `${sideColor(ring.side)}${Math.round((isAirDefense ? alpha * 1.12 : alpha) * 255).toString(16).padStart(2, "0")}`;
    ctx.lineWidth = ring.selected ? 0.72 : 0.56;
    if (overlappers.length) {
      ctx.save();
      for (const other of overlappers) clipOutsideCircle(other);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    const showRingLabel = shouldShowWeaponLabels(camera.scale)
      && ring.radius > 10
      && (ring.selected || ring.category === "anti_air");
    if (showRingLabel) {
      ctx.setLineDash([]);
      ctx.globalAlpha = ring.selected ? labelAlpha(true) * 0.86 : 0.74;
      ctx.fillStyle = ring.category === "anti_ship" ? "#f7e7a1" : sideColor(ring.side);
      ctx.font = canvasFont(VISUAL_CONFIG.rangeLabelPx);
      const labelX = Math.max(54, Math.min(innerWidth - 48, ring.x + ring.radius + 3));
      const antiAirOffset = ring.id === "ESSM" ? 8 : ring.id === "SM-2MR" ? -2 : 0;
      const labelY = Math.max(78, Math.min(innerHeight - 48, ring.y - 3 + antiAirOffset));
      ctx.fillText(ring.shortLabel, labelX, labelY);
      ctx.globalAlpha = 1;
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// Fixed ground emplacements render as static map symbols (no hull, heading,
// wake, or velocity arrow): SAM = up-triangle, EWR = diamond with a radar
// sweep, battery/other = square bunker.
function drawGroundUnit(ship, label) {
  const p = worldToScreen(ship);
  if (!screenPointVisible(p, 48)) return;
  const color = sideColor(ship.side);
  const selected = ship.id === sim.selectedId;
  const s = 6;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = ship.alive ? 1 : 0.35;
  ctx.strokeStyle = color;
  ctx.fillStyle = selected ? sideSoftColor(ship.side) : "rgba(5, 12, 16, .78)";
  ctx.lineWidth = selected ? 1.2 : 0.8;
  // Glyph drives the ground symbol so custom (modded) ground units can pick a
  // shape independent of their hull id: sam=triangle, radar=diamond, bunker=square.
  const glyph = ship.glyph || (ship.hull === "SAM" ? "sam" : ship.hull === "EWR" ? "radar" : "bunker");
  ctx.beginPath();
  if (glyph === "sam") {
    ctx.moveTo(0, -s); ctx.lineTo(s, s); ctx.lineTo(-s, s); ctx.closePath();
  } else if (glyph === "radar") {
    ctx.moveTo(0, -s); ctx.lineTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.closePath();
  } else if (glyph === "airfield") {
    // Rounded "stadium" footprint suggesting a runway/ramp.
    ctx.rect(-s * 1.15, -s * 0.7, 2.3 * s, 1.4 * s);
  } else {
    ctx.rect(-s, -s, 2 * s, 2 * s);
  }
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = ship.alive ? 0.8 : 0.4;
  ctx.strokeStyle = "rgba(255,255,255,.7)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  if (glyph === "radar") {
    ctx.arc(0, 0, s * 0.55, -Math.PI * 0.78, -Math.PI * 0.08);
  } else if (glyph === "airfield") {
    // Dashed centreline like a runway.
    ctx.moveTo(-s * 0.9, 0); ctx.lineTo(-s * 0.2, 0);
    ctx.moveTo(s * 0.2, 0); ctx.lineTo(s * 0.9, 0);
  } else {
    ctx.moveTo(-s * 0.4, 0); ctx.lineTo(s * 0.4, 0);
    ctx.moveTo(0, -s * 0.4); ctx.lineTo(0, s * 0.4);
  }
  ctx.stroke();
  ctx.restore();

  if (label.alpha > 0.04) {
    ctx.save();
    ctx.globalAlpha = (ship.alive ? 0.96 : 0.34) * label.alpha;
    ctx.fillStyle = color;
    ctx.font = canvasFont(Math.max(7, VISUAL_CONFIG.shipLabelPx * label.scale));
    ctx.fillText(shipDisplayName(ship, "-"), p.x + s + 4, p.y - 4);
    ctx.restore();
  }
}

// A squadron renders as a small formation of dart glyphs — one per surviving
// aircraft — so attrition is visible (a 4-ship that has lost a plane shows 3).
// It is one entity; the darts are pure presentation offsets around its centre.
function drawAircraft(ship, label) {
  const p = worldToScreen(ship);
  if (!screenPointVisible(p, 60)) return;
  const color = sideColor(ship.side);
  const selected = ship.id === sim.selectedId;
  const alive = Math.max(ship.alive ? 1 : 0, aliveAircraftCount(ship));
  const heading = Number.isFinite(ship.heading) ? ship.heading : 0;
  const dart = 5;
  // Wedge formation: lead aircraft ahead, wingmen stepped back on alternating
  // sides. Offsets are in screen pixels along/across the heading.
  const along = (i) => -Math.floor((i + 1) / 2) * 7;
  const across = (i) => (i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * 7);
  ctx.save();
  ctx.globalAlpha = ship.alive ? 1 : 0.3;
  for (let i = 0; i < Math.max(1, alive); i++) {
    const ax = Math.cos(heading) * along(i) - Math.sin(heading) * across(i);
    const ay = Math.sin(heading) * along(i) + Math.cos(heading) * across(i);
    ctx.save();
    ctx.translate(p.x + ax, p.y + ay);
    ctx.rotate(heading);
    ctx.strokeStyle = color;
    ctx.fillStyle = selected ? sideSoftColor(ship.side) : "rgba(5, 12, 16, .82)";
    ctx.lineWidth = selected ? 1.1 : 0.7;
    ctx.beginPath();
    // Forward-pointing dart (arrowhead) — reads as a fast jet.
    ctx.moveTo(dart, 0);
    ctx.lineTo(-dart * 0.7, dart * 0.7);
    ctx.lineTo(-dart * 0.3, 0);
    ctx.lineTo(-dart * 0.7, -dart * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // Skip label rendering entirely when zoomed far out (faded) — fillText is the
  // dominant per-entity cost in a large, zoomed-out battle. Render-only LOD.
  if (label.alpha > 0.04) {
    ctx.save();
    ctx.globalAlpha = (ship.alive ? 0.96 : 0.34) * label.alpha;
    ctx.fillStyle = color;
    ctx.font = canvasFont(Math.max(7, VISUAL_CONFIG.shipLabelPx * label.scale));
    const count = `${aliveAircraftCount(ship)}/${squadronSize(ship)}`;
    ctx.fillText(`${shipDisplayName(ship, "-")} ×${count}`, p.x + 10, p.y - 6);
    ctx.restore();
  }
}

function drawScaledShip(ship, label) {
  if (ship.domain === "air") return drawAircraft(ship, label);
  if (ship.isFixed || ship.domain === "ground") return drawGroundUnit(ship, label);
  const p = worldToScreen(ship);
  if (!screenPointVisible(p, 48)) return;
  const color = sideColor(ship.side);
  const selected = ship.id === sim.selectedId;
  const len = worldSize(ship.lengthM, 4, 25);
  const beam = Math.max(2.25, Math.min(8, len * 0.28));
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ship.heading);
  ctx.globalAlpha = ship.alive ? 1 : 0.35;
  ctx.strokeStyle = color;
  ctx.fillStyle = selected ? sideSoftColor(ship.side) : "rgba(5, 12, 16, .78)";
  ctx.lineWidth = selected ? 1.2 : 0.8;
  ctx.beginPath();
  ctx.moveTo(len * 0.5, 0);
  ctx.lineTo(len * 0.18, -beam * 0.5);
  ctx.lineTo(-len * 0.43, -beam * 0.5);
  ctx.lineTo(-len * 0.5, 0);
  ctx.lineTo(-len * 0.43, beam * 0.5);
  ctx.lineTo(len * 0.18, beam * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (len > 7) {
    ctx.beginPath();
    ctx.moveTo(-len * 0.12, 0);
    ctx.lineTo(len * 0.44, 0);
    ctx.stroke();
  }
  ctx.save();
  ctx.globalAlpha = ship.alive ? 0.76 : 0.42;
  ctx.strokeStyle = "rgba(255,255,255,.82)";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(-len * 0.11, 0);
  ctx.lineTo(len * 0.11, 0);
  ctx.moveTo(0, -len * 0.11);
  ctx.lineTo(0, len * 0.11);
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  if (label.alpha > 0.04) {
    ctx.save();
    ctx.globalAlpha = (ship.alive ? 0.96 : 0.34) * label.alpha;
    ctx.fillStyle = color;
    ctx.font = canvasFont(Math.max(7, VISUAL_CONFIG.shipLabelPx * label.scale));
    ctx.fillText(shipDisplayName(ship, "-"), p.x + len * 0.48 + 3, p.y - 5);
    ctx.restore();
  }

  if (sim.mode !== SCENARIO_MODE.SETUP && ship.alive && (ship.speed > 0.1 || ship.desiredSpeed > 0.1)) {
    const hasVelocity = Math.hypot(ship.vx ?? 0, ship.vy ?? 0) > 0.1;
    const direction = hasVelocity ? Math.atan2(ship.vy, ship.vx) : (Number.isFinite(ship.heading) ? ship.heading : 0);
    const arrowLength = Math.max(18, Math.min(34, len * 2.8));
    const tipX = p.x + Math.cos(direction) * arrowLength;
    const tipY = p.y + Math.sin(direction) * arrowLength;
    const wing = 5;
    ctx.strokeStyle = `${color}88`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(direction) * (len * 0.6), p.y + Math.sin(direction) * (len * 0.6));
    ctx.lineTo(tipX, tipY);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(direction - Math.PI / 4) * wing, tipY - Math.sin(direction - Math.PI / 4) * wing);
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - Math.cos(direction + Math.PI / 4) * wing, tipY - Math.sin(direction + Math.PI / 4) * wing);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawSectorResponsibility(ship) {
  // Only meaningful once a fleet exists and a sub-sector has been carved out.
  if (!ship.alive || sim.mode !== SCENARIO_MODE.RUNNING) return;
  // Aircraft are strikers, not sectorised air-defence pickets — no AAW sector.
  if (ship.domain === "air") return;
  if (!Number.isFinite(ship.sectorCenter) || !(ship.sectorHalfWidth < Math.PI - 0.05)) return;
  const p = worldToScreen(ship);
  const radius = Math.min(ship.radarRangeM * camera.scale * 0.5, Math.max(innerWidth, innerHeight));
  ctx.save();
  ctx.fillStyle = `${sideColor(ship.side)}10`;
  ctx.strokeStyle = `${sideColor(ship.side)}55`;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.arc(p.x, p.y, radius, ship.sectorCenter - ship.sectorHalfWidth, ship.sectorCenter + ship.sectorHalfWidth);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Formation station marker for non-guide units.
  if (ship.station && !ship.isOTC) {
    const s = worldToScreen(ship.station);
    ctx.save();
    ctx.strokeStyle = `${sideColor(ship.side)}77`;
    ctx.lineWidth = 0.6;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawTracks() {
  for (const ship of sim.ships) {
    if (ship.id !== sim.selectedId) continue;
    for (const track of tracksForShip(sim, ship)) {
      const p = worldToScreen(track);
      const r = Math.max(3, track.uncertainty * camera.scale);
      if (!screenPointVisible(p, r + 8)) continue;
      const mark = worldSize(120, 2, 6, 24);
      ctx.strokeStyle = `${sideColor(track.side)}88`;
      ctx.fillStyle = `${sideColor(track.side)}20`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - mark, p.y);
      ctx.lineTo(p.x + mark, p.y);
      ctx.moveTo(p.x, p.y - mark);
      ctx.lineTo(p.x, p.y + mark);
      ctx.stroke();
    }
  }
}

function drawMissiles(label) {
  if (!filters.missiles.classList.contains("active")) return;
  const labelFontPx = Math.max(7, VISUAL_CONFIG.shipLabelPx * 0.4 * label.scale);
  const missileLabelsByType = new Map();
  const labelWidths = new Map();
  ctx.save();
  ctx.font = canvasFont(labelFontPx);
  for (const missile of sim.missiles) {
    const p = worldToScreen(missile);
    const iconVisible = screenPointVisible(p, 24);
    const spec = MISSILES[missile.missileId];
    const isAntiAir = missileDisplayRole(missile) === "anti_air";
    const size = worldSize(
      isAntiAir ? 34 : 52,
      Math.max(2.2, VISUAL_CONFIG.missileMinPx * (isAntiAir ? 0.85 : 1)),
      VISUAL_CONFIG.missileMaxPx * (isAntiAir ? 0.7 : 0.9),
      19
    );
    const iconColor = missile.terminal ? "#f7b955" : sideColor(missile.side);
    const targetCandidate = isAntiAir
      ? (sim._missileById?.get(missile.targetId) ?? sim.missiles.find((m) => m.id === missile.targetId))
      : (sim._shipById?.get(missile.targetId) ?? sim.ships.find((s) => s.id === missile.targetId));
    const target = targetCandidate?.alive ? targetCandidate : null;
    if (target) {
      const t = worldToScreen(target);
      if (segmentIntersectsViewport(p, t, 4)) {
        ctx.save();
        ctx.strokeStyle = `${sideColor(missile.side)}24`;
        ctx.lineWidth = missile.terminal ? 0.62 : 0.42;
        ctx.setLineDash(missile.terminal ? [2, 3] : [7, 6]);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (!iconVisible) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(missile.heading);
    ctx.strokeStyle = iconColor;
    ctx.fillStyle = missile.terminal ? "rgba(247,185,85,.22)" : "rgba(5, 12, 16, .82)";
    ctx.lineWidth = isAntiAir ? 1.05 : 0.65;
    if (isAntiAir) {
      ctx.shadowColor = iconColor;
      ctx.shadowBlur = 3;
    }
    ctx.beginPath();
    if (isAntiAir) {
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.65, -size * 0.72);
      ctx.lineTo(-size * 0.65, size * 0.72);
      ctx.closePath();
    } else {
      ctx.rect(-size * 0.58, -size * 0.58, size * 1.16, size * 1.16);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (label.scale > 0 && label.alpha > 0) {
      const text = spec?.shortLabel ?? spec?.name ?? "";
      const anchorX = p.x + size * 0.5 + 2;
      const anchorY = p.y - 4;
      let width = labelWidths.get(text);
      if (width === undefined) {
        width = ctx.measureText(text).width;
        labelWidths.set(text, width);
      }
      const height = Math.max(7, labelFontPx + 2);
      const groupKey = `${missile.side}:${missile.missileId}`;
      if (!missileLabelsByType.has(groupKey)) missileLabelsByType.set(groupKey, []);
      missileLabelsByType.get(groupKey).push({
        x: anchorX,
        y: anchorY,
        cx: anchorX + width / 2,
        cy: anchorY - height / 2,
        width,
        height,
        text,
        color: iconColor,
        alpha: missile.alive ? 0.96 : 0.34
      });
    }
  }
  ctx.restore();

  if (label.scale > 0 && label.alpha > 0) {
    for (const items of missileLabelsByType.values()) {
      const clusters = clusterSameTypeMissileLabels(items, Math.max(18, labelFontPx * 1.8));
      for (const cluster of clusters) {
        const [first] = cluster.items;
        ctx.save();
        ctx.globalAlpha = first.alpha * label.alpha;
        ctx.fillStyle = first.color;
        ctx.font = canvasFont(labelFontPx);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(first.text, cluster.x, cluster.y);
        ctx.restore();
      }
    }
  }
}

function drawRuler() {
  for (const ruler of [...rulers, activeRuler].filter(Boolean)) {
    const a = worldToScreen(ruler.a);
    const b = worldToScreen(ruler.b);
    const dKm = distance(ruler.a, ruler.b) / KM;
    const bearing = (Math.atan2(ruler.b.x - ruler.a.x, ruler.a.y - ruler.b.y) * 180 / Math.PI + 360) % 360;
    ctx.strokeStyle = "#f7e7a1";
    ctx.fillStyle = "#f7e7a1";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = canvasFont(8);
    ctx.fillText(`${dKm.toFixed(1)} km / ${bearing.toFixed(0)}°`, (a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 8);
  }
}

function drawSelectionBox() {
  if (!selectionBox) return;
  const x = Math.min(selectionBox.x0, selectionBox.x1);
  const y = Math.min(selectionBox.y0, selectionBox.y1);
  const w = Math.abs(selectionBox.x1 - selectionBox.x0);
  const h = Math.abs(selectionBox.y1 - selectionBox.y0);
  ctx.save();
  ctx.strokeStyle = "rgba(216,237,242,.55)";
  ctx.fillStyle = "rgba(216,237,242,.05)";
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function renderShipDetails() {
  // Build compact detail cards for selected ships (right-click+drag selected)
  const detailShips = sim.ships.filter(s => s.alive && selectedIds.has(s.id));
  const detailKey = `${getLang()}|${innerHeight}|${detailShips.map((ship) => [
    ship.id,
    ship.damage,
    ship.alive,
    ship.subsystems?.radar,
    ship.subsystems?.propulsion,
    ship.subsystems?.fireControl,
    ship.subsystems?.ciws,
    ship.subsystems?.cic,
    // Air units show volatile flight readouts; key on coarse fuel + flares +
    // state so the card refreshes as they change (a few selected cards, cheap).
    ship.domain === "air"
      ? `${Math.round((ship.fuelS / (ship.enduranceS || 1)) * 20)}:${ship.flares}:${ship.airState}:${ship.evading ? 1 : 0}`
      : 0,
    ...Object.values(ship.loadout)
  ].join(":")).join("|")}`;
  if (panelRenderCache.details === detailKey) return;
  panelRenderCache.details = detailKey;
  if (!detailShips.length) { replaceHtmlIfChanged(shipDetailOverlay, ''); return; }
  const cardWidth = 120;
  const cardGap = 2;
  const rightInset = 6;
  const y = 8;
  const availableHeight = innerHeight - y - 16;
  shipDetailOverlay.style.cssText = `position:fixed;right:${rightInset}px;top:${y}px;z-index:100;width:${cardWidth}px;max-height:${availableHeight}px;display:flex;flex-direction:column;align-items:stretch;gap:${cardGap}px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color: rgba(142,193,205,0.25) transparent;`;

  const subBar = (val, mode = "health") => {
    const w = Math.round(Math.max(0, Math.min(1, val)) * 100);
    const c = mode === "load"
      ? (val >= 0.8 ? '#5a9' : val >= 0.4 ? '#f7b955' : '#f66')
      : (val > 0.6 ? '#5a9' : val > 0.3 ? '#f7b955' : '#f66');
    return `<span class="subsystem-meter"><i style="width:${w}%;background:${c}"></i></span>`;
  };

  // Aircraft squadrons have no ship subsystems — show flight-relevant readouts
  // (surviving aircraft, fuel, flares, lifecycle state, and effector counts).
  const aircraftCardHtml = (s) => {
    const color = sideColor(s.side);
    const ac = aliveAircraftCount(s);
    const size = squadronSize(s);
    const fuelFrac = s.enduranceS ? (s.fuelS ?? 0) / s.enduranceS : 0;
    const flareFrac = s.flaresMax ? (s.flares ?? 0) / s.flaresMax : 0;
    let aaw = 0, asuw = 0;
    for (const [id, n] of Object.entries(s.loadout || {})) {
      if (!MISSILES[id]) continue;
      if (MISSILES[id].category === 'anti_ship') asuw += n; else aaw += n;
    }
    const state = ({ mission: 'MSN', rtb: 'RTB', rearming: 'RRM' })[s.airState] ?? 'MSN';
    const row = (label, val, mode = "health") => `<span>${label}</span>${subBar(val, mode)}<b>${Math.round(Math.max(0, Math.min(1, val)) * 100)}%</b>`;
    const textRow = (label, value) => `<span>${label}</span><b style="grid-column:2/4;text-align:right">${value}</b>`;
    return `<div class="ship-detail-card" style="--ship-accent:${color};--ship-card-width:${cardWidth}px">
      <div class="ship-detail-heading">
        <b>${shipDisplayName(s, "")}</b>
        <span style="color:${ac < size ? '#f7b955' : ''}">${t('detail.ac')} ${ac}/${size}</span>
      </div>
      <div class="ship-detail-grid">
        ${row(t('detail.fuel'), fuelFrac, "load")}
        ${row(t('detail.flares'), flareFrac, "load")}
        ${textRow(t('detail.state'), state + (s.evading ? ' !' : ''))}
        ${textRow(t('detail.alt'), `${((s.altitudeM ?? 0) / 1000).toFixed(1)} km`)}
        ${textRow(t('detail.aaw'), aaw)}
        ${textRow(t('detail.asuw'), asuw)}
      </div>
    </div>`;
  };

  const cardHtml = (s) => {
    if (s.domain === "air") return aircraftCardHtml(s);
    const rdr = s.subsystems?.radar ?? 1.0;
    const prop = s.subsystems?.propulsion ?? 1.0;
    const fc = s.subsystems?.fireControl ?? 1.0;
    const ciws = s.subsystems?.ciws ?? 1.0;
    const cic = s.subsystems?.cic ?? 1.0;
    const hp = shipHpState(s);
    const vls = vlsLoadState(s);
    const color = sideColor(s.side);
    const row = (label, val, mode = "health") => `
      <span>${label}</span>
      ${subBar(val, mode)}
      <b>${Math.round(val * 100)}%</b>
    `;
    return `<div class="ship-detail-card" style="--ship-accent:${color};--ship-card-width:${cardWidth}px">
      <div class="ship-detail-heading">
        <b>${shipDisplayName(s, "")}</b>
        <span style="color:${hp.currentHp < hp.maxHp ? '#f7b955' : ''}">HP ${hp.currentHp}/${hp.maxHp}</span>
      </div>
      <div class="ship-detail-grid">
        ${row(t('detail.radar'), rdr)}
        ${row(t('detail.prop'), prop)}
        ${row(t('detail.vls'), vls.fill, "load")}
        ${row(t('detail.fcs'), fc)}
        ${row(t('detail.ciws'), ciws)}
        ${row(t('detail.cic'), cic)}
      </div>
    </div>`;
  };
  replaceHtmlIfChanged(shipDetailOverlay, detailShips.map(s => cardHtml(s)).join(''));
}


function applyI18n() {
  document.documentElement.lang = getLang() === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  document.querySelectorAll('[data-i18n-label]').forEach((el) => {
    el.setAttribute('label', t(el.getAttribute('data-i18n-label')));
  });
  // Inventory column headers carry their own data-i18n keys and are localized
  // by the generic [data-i18n] pass above, so no special-case is needed here.
}

// Rebuild the placement dropdown from the live SHIP_CLASSES registry so custom
// (modded) naval/ground units appear alongside vanilla hulls. Ammo is never
// listed here — it only populates loadout pickers in the Unit Workshop.
function spawnOptionLabel(hull, cls) {
  const key = `ship.${hull.toLowerCase()}`;
  const localized = t(key);
  return localized !== key ? localized : (cls.prefix || hull);
}
function populateSpawnDropdown() {
  if (!shipClassSelect) return;
  const prev = shipClassSelect.value;
  const naval = [];
  const ground = [];
  const air = [];
  for (const [hull, cls] of Object.entries(SHIP_CLASSES)) {
    const bucket = cls.domain === "ground" ? ground : cls.domain === "air" ? air : naval;
    bucket.push([hull, cls]);
  }
  const escAttr = (s) => String(s).replace(/"/g, "&quot;");
  const optHtml = (arr) => arr
    .map(([hull, cls]) => `<option value="${escAttr(hull)}">${escAttr(spawnOptionLabel(hull, cls))}</option>`)
    .join("");
  const group = (label, arr) => arr.length ? `<optgroup label="${escAttr(label)}">${optHtml(arr)}</optgroup>` : "";
  shipClassSelect.innerHTML =
    group(t("naval.group"), naval) +
    group(t("ground.group"), ground) +
    group(t("air.group"), air);
  if ([...shipClassSelect.options].some((o) => o.value === prev)) shipClassSelect.value = prev;
}

function drawTerrain() {
  const map = tacticalMap(sim.mapId);
  const dpr = window.devicePixelRatio || 1;
  const key = `${map.id}|${innerWidth}|${innerHeight}|${camera.x.toFixed(2)}|${camera.y.toFixed(2)}|${camera.scale.toFixed(6)}|${dpr.toFixed(2)}`;
  if (terrainLayer.width !== Math.floor(innerWidth * dpr)) {
    terrainLayer.width = Math.floor(innerWidth * dpr);
    terrainLayer.height = Math.floor(innerHeight * dpr);
    terrainLayerKey = "";
  }
  let paths = terrainPathCache.get(map);
  if (!paths) {
    paths = {
      land: map.landRings.map((ring) => {
        const path = new Path2D();
        ring.forEach(([x, y], index) => index === 0 ? path.moveTo(x, y) : path.lineTo(x, y));
        path.closePath();
        return path;
      }),
      coast: new Path2D()
    };
    for (const coastline of map.coastlines) {
      coastline.forEach(([x, y], index) => index === 0 ? paths.coast.moveTo(x, y) : paths.coast.lineTo(x, y));
    }
    terrainPathCache.set(map, paths);
  }
  if (terrainLayerKey !== key) {
    terrainLayerKey = key;
    terrainLayerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    terrainLayerCtx.clearRect(0, 0, innerWidth, innerHeight);
    terrainLayerCtx.save();
    terrainLayerCtx.translate(innerWidth / 2 - camera.x * camera.scale, innerHeight / 2 - camera.y * camera.scale);
    terrainLayerCtx.scale(camera.scale, camera.scale);
    terrainLayerCtx.fillStyle = "#111b1f";
    terrainLayerCtx.setLineDash([]);
    for (const landPath of paths.land) terrainLayerCtx.fill(landPath);
    terrainLayerCtx.strokeStyle = "#ffffff";
    terrainLayerCtx.lineWidth = 1.8 / camera.scale;
    terrainLayerCtx.stroke(paths.coast);
    terrainLayerCtx.strokeStyle = "rgba(255,255,255,.88)";
    terrainLayerCtx.lineWidth = 1.4 / camera.scale;
    terrainLayerCtx.strokeRect(-MAP_HALF_WIDTH_M, -MAP_HALF_HEIGHT_M, MAP_WIDTH_M, MAP_HEIGHT_M);
    terrainLayerCtx.restore();
  }
  // Blit the terrain layer 1:1 in device space. Drawing it at (innerWidth x
  // innerHeight) under the dpr transform would rescale its backing store
  // (e.g. 937 → 937.5 px at dpr 1.5) and soften the coastline; an identity
  // transform maps backing pixels straight onto the matching main-canvas pixels.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(terrainLayer, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.restore();
}

function renderScaleBar() {
  const scale = niceScaleDistanceM(camera.scale, 72);
  scaleDistance.textContent = formatDistanceKm(scale.meters);
  scaleRule.style.width = `${scale.pixels.toFixed(1)}px`;
  scaleGrid.textContent = t('scale.grid').replace('{n}', String(GRID_MINOR_M / KM));
}

function renderPanels() {
  const lang = getLang();
  clock.textContent = formatTime(sim.time);
  play.textContent = sim.mode === SCENARIO_MODE.SETUP || sim.paused ? "▶" : "Ⅱ";
  const counts = battleSummaryCounts(sim);
  const postureKey = [SIDE.BLUE, SIDE.RED].map((side) => {
    const posture = sim.commandState?.get(side);
    return `${posture?.aggression ?? 0.5}:${posture?.advantage ?? 0}`;
  }).join("|");
  const statusKey = `${lang}|${Object.values(counts).join(":")}|${postureKey}`;
  if (panelRenderCache.status !== statusKey) {
    panelRenderCache.status = statusKey;
    replaceHtmlIfChanged(status, renderBattleStatus(sim, counts));
  }
  const inventoryKey = `${lang}|${sim.ships.map((ship) => [
    ship.id,
    ship.side,
    ship.alive,
    ship.damage,
    selectedIds.has(ship.id),
    ...Object.values(ship.loadout)
  ].join(":")).join("|")}`;
  let inventoryChanged = false;
  if (panelRenderCache.inventory !== inventoryKey) {
    panelRenderCache.inventory = inventoryKey;
    const orderedShips = [...sim.ships].sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
    replaceHtmlIfChanged(unitTab, inventoryHtml(orderedShips, (id) => selectedIds.has(id)));
    inventoryChanged = true;
  }
  const langChanged = panelRenderCache.lang !== lang;
  if (langChanged || inventoryChanged) {
    panelRenderCache.lang = lang;
    applyI18n();
  }
  const scaleKey = `${lang}|${camera.scale.toFixed(8)}`;
  if (panelRenderCache.scale !== scaleKey) {
    panelRenderCache.scale = scaleKey;
    renderScaleBar();
  }
  const placementEnabled = canAddAssets(sim);
  const placementKey = `${placementEnabled}|${sim.mapId}`;
  if (panelRenderCache.placement !== placementKey) {
    panelRenderCache.placement = placementKey;
    document.querySelectorAll('[data-tool="blue"], [data-tool="red"], #ship-class').forEach((el) => {
      el.disabled = !placementEnabled;
    });
    if (mapSelect) {
      mapSelect.disabled = !placementEnabled;
      if (mapSelect.value !== sim.mapId) mapSelect.value = sim.mapId;
    }
  }
  const newestEvent = sim.events[0];
  const eventKey = `${lang}|${sim.events.length}|${newestEvent?.t ?? ""}|${newestEvent?.side ?? ""}|${newestEvent?.text ?? ""}`;
  if (panelRenderCache.events !== eventKey || panelRenderCache.eventHead !== newestEvent) {
    panelRenderCache.events = eventKey;
    panelRenderCache.eventHead = newestEvent;
    replaceHtmlIfChanged(eventLog, sim.events.map((e) => {
      const sLabel = sideLabel(e.side);
      const sideClass = e.side === 'BLUE' ? 'blue' : e.side === 'RED' ? 'red' : '';
      const sideWidth = lang === 'zh' ? '14px' : '12px';
      return `<div class="${eventSeverity(e.text)}" style="grid-template-columns:34px ${sideWidth} minmax(0, 1fr)">
        <span class="event-time">${formatTime(e.t)}</span>
        <b class="event-side ${sideClass}">${sLabel}</b>
        <span class="event-text">${translateEventText(e.text)}</span>
      </div>`;
    }).join(""));
  }
}

function setFeedCollapsed(nextCollapsed) {
  feedCollapsed = nextCollapsed;
  eventConsole.classList.toggle("collapsed", feedCollapsed);
  const svg = toggleFeed.querySelector("svg");
  if (svg) {
    svg.style.transform = feedCollapsed ? "rotate(-90deg)" : "rotate(0deg)";
    svg.style.transition = "transform 140ms ease-out";
  }
  toggleFeed.setAttribute("aria-expanded", String(!feedCollapsed));
}

function render() {
  labelBoxes = [];
  clampCamera();
  drawSceneBase();
  drawGrid();
  drawTerrain();
  drawWeaponRangeRings();
  drawRadarRings();
  for (const ship of sim.ships) {
    if (selectedIds.has(ship.id)) drawSectorResponsibility(ship);
  }
  if (filters.tracks.classList.contains("active")) drawTracks();
  const label = shipLabelScale();
  for (const ship of sim.ships) drawScaledShip(ship, label);
  drawMissiles(label);
  drawRuler();
  drawSelectionBox();
  renderPanels();
  renderShipDetails();
}

function pickShip(world) {
  let best = null;
  let bestD = 1.5 * NM;
  for (const ship of sim.ships) {
    const d = distance(ship, world);
    if (d < bestD) {
      best = ship;
      bestD = d;
    }
  }
  return best;
}

function tick(now) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!sim.paused) {
    const rate = Number(speed.value);
    let remaining = elapsed * rate;
    while (remaining > 0) {
      stepSim(sim, Math.min(0.25, remaining));
      remaining -= 0.25;
    }
  }
  render();
  requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const before = screenToWorld(event.clientX, event.clientY);
  camera.scale *= event.deltaY < 0 ? 1.12 : 0.89;
  camera.scale = Math.max(minimumCameraScale(), Math.min(MAX_CAMERA_SCALE, camera.scale));
  const after = screenToWorld(event.clientX, event.clientY);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  clampCamera();
});
canvas.addEventListener("pointerdown", (event) => {
  const world = screenToWorld(event.clientX, event.clientY);
  if (event.button === 2) {
    const ship = pickShip(world);
    if (ship) {
      sim.selectedId = ship.id;
      selectedIds.add(ship.id);
      drag = { type: "right-select", x: event.clientX, y: event.clientY };
    } else {
      selectedIds.clear();
      sim.selectedId = null;
      selectionBox = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY };
      drag = { type: "box-select" };
    }
    return;
  }
  if (event.button === 1 || event.altKey) {
    drag = { type: "pan", x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
    return;
  }
  if (tool === "blue" || tool === "red") {
    if (!canAddAssets(sim)) return;
    const hull = shipClassSelect?.value || "DDG";
    const placed = placeShip(sim, tool === "blue" ? SIDE.BLUE : SIDE.RED, world.x, world.y, hull);
    if (!placed) return;
    selectedIds = new Set([sim.selectedId]);
    document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    return;
  }
  if (tool === "ruler") {
    activeRuler = { a: world, b: world };
    drag = { type: "ruler" };
    return;
  }
  const ship = pickShip(world);
  if (ship) {
    setPrimarySelection(ship);
    if (sim.mode === SCENARIO_MODE.SETUP) {
      drag = {
        type: "ship",
        shipId: ship.id,
        ox: ship.x - world.x,
        oy: ship.y - world.y,
        lastValidX: ship.x,
        lastValidY: ship.y
      };
    }
  }
});
canvas.addEventListener("pointermove", (event) => {
  const world = screenToWorld(event.clientX, event.clientY);
  cursor.textContent = `${(world.x / KM).toFixed(1)}, ${(world.y / KM).toFixed(1)} km`;
  if (drag) {
    if (drag.type === "ruler" && activeRuler) {
      activeRuler.b = world;
    } else if (drag.type === "ship") {
      const ship = sim.ships.find((candidate) => candidate.id === drag.shipId);
      if (ship) {
        ship.x = world.x + drag.ox;
        ship.y = world.y + drag.oy;
        clampShipToBounds(sim, ship);
        // Sea units must stay on water; fixed ground emplacements must stay on
        // land.
        if (ship.isFixed ? isShipPositionOnLand(sim, ship) : isShipPositionOnWater(sim, ship)) {
          drag.lastValidX = ship.x;
          drag.lastValidY = ship.y;
          ship.waypoint = null;
          ship.navigationWaypoint = null;
          ship.tracks.clear();
        } else {
          ship.x = drag.lastValidX;
          ship.y = drag.lastValidY;
        }
      }
    } else if (drag.type === "pan") {
      camera.x = drag.cx - (event.clientX - drag.x) / camera.scale;
      camera.y = drag.cy - (event.clientY - drag.y) / camera.scale;
      clampCamera();
    } else if (drag.type === "box-select" && selectionBox) {
      selectionBox.x1 = event.clientX;
      selectionBox.y1 = event.clientY;
    }
  }
});
canvas.addEventListener("pointerup", (event) => {
  if (drag?.type === "ruler" && activeRuler) {
    rulers.push(activeRuler);
    activeRuler = null;
  }
  if (drag?.type === "box-select" && selectionBox) {
    const minX = Math.min(selectionBox.x0, selectionBox.x1);
    const maxX = Math.max(selectionBox.x0, selectionBox.x1);
    const minY = Math.min(selectionBox.y0, selectionBox.y1);
    const maxY = Math.max(selectionBox.y0, selectionBox.y1);
    const hits = sim.ships.filter((ship) => {
      const p = worldToScreen(ship);
      return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
    });
    if (hits.length) {
      selectedIds = new Set(hits.map((ship) => ship.id));
      sim.selectedId = hits[0].id;
    }
  }
  selectionBox = null;
  drag = null;
});

document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.tool === "ruler" && tool === "ruler") {
      tool = "select";
      activeRuler = null;
      rulers = [];
      document.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
      button.blur();
      return;
    }
    tool = button.dataset.tool;
    document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b === button));
  });
});

function startScenario() {
  if (!canRunScenario(sim)) {
    status.textContent = RUN_STATUS.invalid;
    return false;
  }
  if (sim.mode === SCENARIO_MODE.SETUP) sim.mode = SCENARIO_MODE.RUNNING;
  if (sim.mode !== SCENARIO_MODE.ENDED) sim.paused = false;
  return true;
}

play.addEventListener("click", () => {
  if (sim.mode === SCENARIO_MODE.SETUP) {
    startScenario();
  } else if (sim.mode !== SCENARIO_MODE.ENDED) {
    sim.paused = !sim.paused;
  }
});
step.addEventListener("click", () => {
  if (sim.mode === SCENARIO_MODE.SETUP && !startScenario()) return;
  sim.paused = true;
  stepSim(sim, 0.25);
});
document.querySelector("#reset").addEventListener("click", () => {
  sim = createDefaultScenario(undefined, sim.mapId);
  selectedIds = new Set([sim.selectedId]);
  activeRuler = null;
  rulers = [];
});

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

document.querySelector("#save").addEventListener("click", () => {
  downloadJson(`tomahawk-scenario-${Math.floor(sim.time)}.json`, serializeScenario(sim));
});
document.querySelector("#aar").addEventListener("click", () => {
  downloadJson(`tomahawk-aar-${Math.floor(sim.time)}.json`, exportAfterAction(sim));
});
copyFireLog.addEventListener("click", async () => {
  await copyLogToClipboard();
});
toggleFeed.addEventListener("click", () => {
  setFeedCollapsed(!feedCollapsed);
});


// Toggle button click handlers for map-options filters
document.querySelectorAll("#map-options .toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    btn.classList.toggle("active");
  });
});


async function copyLogToClipboard() {
  const text = formatLocalizedEventLines(sim.events, formatTime);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    status.textContent = t('status.logCopied').replace('{n}', sim.events.length);
  } catch {
    status.textContent = t('status.logFailed');
  }
}
document.querySelector("#load").addEventListener("click", () => document.querySelector("#load-file").click());
document.querySelector("#load-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    sim = restoreScenario(JSON.parse(await file.text()));
    selectedIds = new Set([sim.selectedId].filter(Boolean));
  } catch (error) {
    alert(error.message);
  } finally {
    event.target.value = "";
  }
});

if (mapSelect) {
  mapSelect.addEventListener("change", () => {
    const result = setScenarioMap(sim, mapSelect.value);
    if (!result.ok) mapSelect.value = sim.mapId;
    selectedIds = new Set([sim.selectedId].filter(Boolean));
  });
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (modEditor.isOpen()) {
    if (event.key === "Escape") { event.preventDefault(); modEditor.close(); }
    return;
  }
  if (aboutOpen) {
    if (event.key === "Escape" || event.code === "Space") {
      event.preventDefault();
      toggleAbout();
    }
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (sim.mode === SCENARIO_MODE.SETUP) startScenario();
    else if (sim.mode !== SCENARIO_MODE.ENDED) sim.paused = !sim.paused;
  }
  if (event.key === ".") {
    if (sim.mode === SCENARIO_MODE.SETUP && !startScenario()) return;
    sim.paused = true;
    stepSim(sim, 0.25);
  }
  if (event.key === "Escape") {
    tool = "select";
    activeRuler = null;
    rulers = [];
    document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  }
  if (event.key === "r" || event.key === "R") {
    if (tool === "ruler") {
      tool = "select";
      activeRuler = null;
      rulers = [];
    } else {
      tool = "ruler";
    }
    document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  }
  if (event.key === "Tab") {
    event.preventDefault();
    cycleShip();
  }
  if (event.key === "`" || event.key === "~") {
    event.preventDefault();
    setFeedCollapsed(!feedCollapsed);
  }
  if ((event.key === "Delete" || event.key === "Backspace") && sim.mode === SCENARIO_MODE.SETUP) {
    event.preventDefault();
    for (const id of [...selectedIds]) deleteShip(sim, id);
    selectedIds = new Set([sim.selectedId].filter(Boolean));
  }
});

document.body.addEventListener("click", (event) => {
  const id = event.target.closest("[data-select-ship]")?.dataset.selectShip;
  const ship = id ? sim.ships.find((candidate) => candidate.id === id) : null;
  if (ship) setPrimarySelection(ship);
});

document.body.addEventListener("change", (event) => {
  const ship = selectedShip();
  if (!ship) return;
  if (event.target.id === "radar-toggle") ship.radarActive = event.target.checked;
  if (event.target.dataset.missile) {
    const result = setLoadout(ship, event.target.dataset.missile, Number(event.target.value));
    if (!result.ok) event.target.value = ship.loadout[event.target.dataset.missile] ?? 0;
  }
  if (event.target.dataset.doc) ship.doctrine[event.target.dataset.doc] = Number(event.target.value);
});
document.body.addEventListener("input", (event) => {
  const ship = selectedShip();
  if (ship && event.target.dataset.doc) ship.doctrine[event.target.dataset.doc] = Number(event.target.value);
});

setFeedCollapsed(false);
resize();

// --- right panel collapse toggle -------------------------------------------
const rpCollapseBtn = document.querySelector(".rp-collapse");
if (rpCollapseBtn) {
  rpCollapseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelector("#right-panel").classList.toggle("retracted");
  });
}

// --- about overlay ---------------------------------------------------------
const aboutOverlay = document.querySelector("#about-overlay");
const aboutCloseBtn = document.querySelector("#about-close");
let prevPaused = false;

function toggleAbout() {
  aboutOpen = !aboutOpen;
  if (aboutOpen) {
    prevPaused = sim.paused;
    sim.paused = true;
    aboutOverlay.hidden = false;
  } else {
    aboutOverlay.hidden = true;
    sim.paused = prevPaused;
  }
}

document.querySelector("#brand-panel").addEventListener("click", (e) => {
  if (e.target.closest("#lang-toggle") || e.target.closest("#mods-toggle")) return;
  toggleAbout();
});
if (aboutCloseBtn) aboutCloseBtn.addEventListener("click", toggleAbout);
aboutOverlay.addEventListener("click", (e) => { if (e.target === aboutOverlay) toggleAbout(); });

// --- unit workshop (modding) ----------------------------------------------
const modsOverlay = document.querySelector("#mods-overlay");
const modsToggle = document.querySelector("#mods-toggle");
const modsCloseBtn = document.querySelector("#mods-close");
let modsPrevPaused = false;
const modEditor = createModEditor({
  overlay: modsOverlay,
  // Only the placement dropdown needs an explicit refresh; the rAF tick loop
  // redraws the map every frame, so no full render() call is needed here
  // (and calling it re-entrantly could fault mid-frame).
  onChange: () => { populateSpawnDropdown(); },
  onOpenChange: (isOpen) => {
    if (isOpen) { modsPrevPaused = sim.paused; sim.paused = true; }
    else { sim.paused = modsPrevPaused; }
    applyI18n();
  }
});
populateSpawnDropdown();
modEditor.preload();
// Console diagnostics: window.tomahawkMods.dump("SM-7X") returns the stored
// record plus whether it is registered as a usable missile.
window.tomahawkMods = modEditor;
if (modsToggle) modsToggle.addEventListener("click", (e) => { e.stopPropagation(); modEditor.open(); });
if (modsCloseBtn) modsCloseBtn.addEventListener("click", () => modEditor.close());
modsOverlay.addEventListener("click", (e) => { if (e.target === modsOverlay) modEditor.close(); });

// --- language toggle -------------------------------------------------------
if (langToggle) {
  langToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLang();
    langToggle.textContent = t('lang.toggle');
    applyI18n();
    populateSpawnDropdown();
    modEditor.refreshLang();
    render();
  });
}

// --- ship cycling via Tab --------------------------------------------------
function cycleShip() {
  const alive = sim.ships.filter((s) => s.alive);
  if (!alive.length) return;
  const idx = alive.findIndex((s) => s.id === sim.selectedId);
  const next = alive[(idx + 1) % alive.length];
  setPrimarySelection(next);
}

requestAnimationFrame(tick);
