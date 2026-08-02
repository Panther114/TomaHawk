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
  isAntiAirCategory,
  isShipPositionOnWater,
  isShipPositionOnLand,
  missileDisplayRole,
  placeShip,
  restoreScenario,
  serializeScenario,
  stepSim,
  tracksForShip,
  weaponRangeEntries
} from "./sim.js";
import { PerfRecorder, BattleLogger } from "./sim/debug.js";
import {
  sideColor,
  sideSoftColor,
  shipDisplayName,
  battleStatusState,
  renderBattleStatus,
  inventoryHtml,
  inventoryRowState,
  unitInfoPopoverHtml,
  clusterProximityLabels,
  escapeHtml,
  worldToScreen as projectWorldToScreen,
  screenToWorld as projectScreenToWorld
} from "./ui/view.js";
import { t, translateEventText } from "./ui/lang.js";
import { UNIT_CATEGORIES, unitCatalog, unitPresentation } from "./ui/catalog.js";
import { drawTacticalSymbol } from "./ui/symbols.js";
import { TUTORIAL_STEPS } from "./ui/tutorial.js";
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
const speed = document.querySelector("#speed");
const shipClassSelect = document.querySelector("#ship-class");
const clock = document.querySelector("#clock");
const cursor = document.querySelector("#cursor");
const status = document.querySelector("#status");
const unitTab = document.querySelector("#unit-tab");
const unitInfoPopover = document.createElement("div");
unitInfoPopover.className = "inventory-info-popover";
unitInfoPopover.hidden = true;
document.body.appendChild(unitInfoPopover);
const scaleDistance = document.querySelector("#scale-distance");
const scaleGrid = document.querySelector("#scale-grid");
const scaleRule = document.querySelector(".scale-rule");
const filters = {
  grid: document.querySelector("#filter-grid"),
  tracks: document.querySelector("#filter-tracks"),
  radar: document.querySelector("#filter-radar"),
  ranges: document.querySelector("#filter-ranges"),
  missiles: document.querySelector("#filter-missiles")
};

let sim = createDefaultScenario();
let tool = "select";
// Camera coordinates are metres; the tactical readout presents kilometres.
let camera = { x: 13_900 * KM, y: -3_600 * KM, scale: 0.00125 };
let drag = null;
let activeRuler = null;
let rulers = [];
let selectionBox = null;
let selectedIds = new Set([sim.selectedId]);
let deploySide = SIDE.BLUE;
let deployHull = null;
let placementPreview = null;
let last = performance.now();

// The DOM side-panels are text and don't need 60 fps; rebuilding and diffing
// their markup every frame is wasted reflow. They refresh at ~20 Hz while the
// canvas battlefield keeps rendering every frame (so animation stays smooth).
let lastPanelRenderAt = 0;
const PANEL_RENDER_INTERVAL_MS = 50;
// Dirty flag: when the sim is paused and no user interaction has happened,
// skip the expensive canvas redraw entirely. Set true on any state change
// (sim step, camera pan/zoom, selection, placement, filter toggle, resize).
let canvasDirty = true;
// When many hulls and ranges are on, only selected ships draw WEZ rings.
const WEAPON_RING_SELECT_SHIP_CAP = 18;
// Reused label buckets to avoid per-frame Map/array churn in drawMissiles.
const _missileLabelBuckets = new Map();
const _missileLabelWidths = new Map();
const _missileLabelPool = [];
// Stable Path2D batches for missile guides/symbols (few style keys, recreated
// in place each frame instead of allocating fresh Maps/objects).
const _missileGuideBatches = new Map();
const _missileSymbolBatches = new Map();

// --- per-run debug capture --------------------------------------------------
// Two read-only collectors observe each running simulation and are persisted to
// debug/ (perf-debug.log + sim-debug.log) via the server, OVERWRITTEN every run,
// so the AI behaviour and device cost of the last run can be inspected offline.
// Opt-in only: enable with ?debug=1 in the URL or localStorage tomahawk.debug=1
// so normal play does not pay logging / network cost on every fight.
// A "run" is one SETUP→RUNNING→ENDED lifecycle; the collectors reset when a new
// run starts and the logs are saved when it ends (and periodically while live).
let perfRec = null;
let battleLog = null;
let debugRunActive = false;
let lastDebugSaveAt = 0;
// Wall-clock sim work left over when a frame hits its budget (seconds of sim).
let simTimeDebt = 0;

function debugCaptureEnabled() {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("tomahawk.debug") === "1") return true;
  } catch { /* private mode */ }
  try {
    return typeof location !== "undefined" && /(?:\?|&)debug=1(?:&|$)/.test(location.search || "");
  } catch {
    return false;
  }
}

function beginDebugRun() {
  if (!debugCaptureEnabled()) return;
  perfRec = new PerfRecorder({ label: `app run ${new Date().toISOString()}` });
  battleLog = new BattleLogger({ intervalS: 15, label: `app run ${new Date().toISOString()}` });
  debugRunActive = true;
  lastDebugSaveAt = performance.now();
  // Emit AI phase-transition events into the log while a debug capture is
  // live (see setPhase in aircraft.js) — off by default so normal play's
  // event feed isn't spammed with every squadron's internal state changes.
  sim.debugPhaseLog = true;
}

function saveDebugLogs() {
  if (!perfRec || !battleLog) return;
  try {
    fetch("/debug/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ perf: perfRec.format(), sim: battleLog.format() }),
      keepalive: true
    }).catch(() => {});
  } catch { /* best-effort; never disrupt the sim */ }
}
const MAX_CAMERA_SCALE = 0.011;

function minimumCameraScale() {
  return Math.max(innerWidth / MAP_WIDTH_M, innerHeight / MAP_HEIGHT_M);
}
const TACTICAL_SYMBOL_SCALE = 26;
const UNIT_ICON_MIN_SCALE = 0.56;
const UNIT_ICON_MAX_SCALE = 1.55;
const UNIT_ICON_MIN_CAMERA_SCALE = 0.00025;
const UNIT_ICON_MAX_CAMERA_SCALE = 0.004;
const UNIT_LABEL_MIN_PX = 8.5;
const UNIT_LABEL_MAX_PX = 13;
const CANVAS_FONT_FAMILY = '"Segoe UI", Arial, sans-serif';
const canvasFont = (px) => `${px}px ${CANVAS_FONT_FAMILY}`;
const terrainPathCache = new WeakMap();
let gridPathCache = { key: "", major: null, minor: null };
const TERRAIN_BUCKET_M = 4_000_000;
const weaponRangeCache = new WeakMap();
const terrainLayer = document.createElement("canvas");
const terrainLayerCtx = terrainLayer.getContext("2d");
let terrainLayerKey = "";
const panelRenderCache = {
  status: "",
  inventory: "",
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

let statusDomCache = null;
let inventoryDomRows = new Map();
const inventoryValueKeys = new Map();

function cacheStatusDom() {
  const cache = {};
  for (const side of ["blue", "red"]) {
    const force = status.querySelector(`.force-summary.${side}`);
    if (!force) return null;
    cache[side] = {};
    for (const field of ["units", "hp", "asuw", "aaw", "intercept", "offense"]) {
      const stat = force.querySelector(`.summary-stat.${field}`);
      cache[side][field] = {
        value: stat?.querySelector("b") ?? null,
        meter: stat?.querySelector(".mini-meter i") ?? null
      };
    }
  }
  return cache;
}

function patchBattleStatus(state) {
  if (!statusDomCache) statusDomCache = cacheStatusDom();
  if (!statusDomCache) return;
  for (const side of ["blue", "red"]) {
    for (const field of ["units", "hp", "asuw", "aaw", "intercept", "offense"]) {
      const next = state[side][field];
      const refs = statusDomCache[side][field];
      if (refs.value && refs.value.textContent !== next.value) refs.value.textContent = next.value;
      if (refs.meter && next.pct != null) {
        const width = `${next.pct}%`;
        if (refs.meter.style.width !== width) refs.meter.style.width = width;
      }
    }
  }
}

function cacheInventoryDomRows() {
  inventoryDomRows = new Map();
  for (const row of unitTab.querySelectorAll("[data-select-ship]")) {
    inventoryDomRows.set(row.dataset.selectShip, {
      root: row,
      hp: row.querySelector("[data-inventory-hp]"),
      hpCap: row.querySelector("[data-inventory-hp-cap]"),
      vls: row.querySelector("[data-inventory-vls]"),
      vlsCap: row.querySelector("[data-inventory-vls-cap]"),
      aaw: row.querySelector("[data-inventory-aaw]"),
      asuw: row.querySelector("[data-inventory-asuw]"),
      speed: row.querySelector("[data-inventory-speed]"),
      altitude: row.querySelector("[data-inventory-altitude]"),
      fuel: row.querySelector("[data-inventory-fuel]")
    });
  }
}

function setText(element, value) {
  if (element && element.textContent !== String(value)) element.textContent = String(value);
}

function setColor(element, color) {
  if (element && element.style.color !== color) element.style.color = color;
}

function patchInventoryRow(ship, refs) {
  const state = inventoryRowState(ship);
  refs.root.classList.toggle("selected", selectedIds.has(ship.id));
  refs.root.classList.toggle("sunk", !ship.alive);
  setText(refs.hp, state.hp);
  setColor(refs.hp, state.hpColor);
  setText(refs.hpCap, `/${state.hpMax}`);
  setText(refs.vls, state.vls);
  setColor(refs.vls, state.vlsColor);
  setText(refs.vlsCap, `/${state.vlsCap}`);
  setText(refs.aaw, state.aaw);
  setColor(refs.aaw, state.aawColor);
  setText(refs.asuw, state.asuw);
  setColor(refs.asuw, state.asuwColor);
  setText(refs.speed, `${state.speedKts} kt`);
  setText(refs.altitude, `${state.altitudeKm.toFixed(1)} km`);
  setText(refs.fuel, `${state.fuelPct}%`);
}

function filterEnabled(filter) {
  return filter?.type === "checkbox" ? filter.checked : filter?.classList.contains("active");
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

function setPrimarySelection(ship) {
  if (!ship) return;
  sim.selectedId = ship.id;
  selectedIds = new Set([ship.id]);
  const panel = document.querySelector("#right-panel");
  panel?.classList.remove("retracted");
  panel?.querySelector(".rp-collapse")?.setAttribute("aria-expanded", "true");
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
  return screenCoordinatesVisible(point.x, point.y, margin);
}

function screenCoordinatesVisible(x, y, margin = 32) {
  return x >= -margin && x <= innerWidth + margin
    && y >= -margin && y <= innerHeight + margin;
}

function segmentCoordinatesIntersectViewport(ax, ay, bx, by, margin = 0) {
  const minX = -margin;
  const maxX = innerWidth + margin;
  const minY = -margin;
  const maxY = innerHeight + margin;
  if (screenCoordinatesVisible(ax, ay, margin) || screenCoordinatesVisible(bx, by, margin)) return true;
  const dx = bx - ax;
  const dy = by - ay;
  let low = 0;
  let high = 1;
  let p = -dx;
  let q = ax - minX;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  p = dx;
  q = maxX - ax;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  p = -dy;
  q = ay - minY;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  p = dy;
  q = maxY - ay;
  if (p === 0) {
    return q >= 0;
  } else {
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    return low <= high;
  }
}

function segmentIntersectsViewport(a, b, margin = 0) {
  return segmentCoordinatesIntersectViewport(a.x, a.y, b.x, b.y, margin);
}

function drawSceneBase() {
  // Light sea theater (monochrome CIC): cool mist gray, not pure white.
  ctx.fillStyle = "#cfd6db";
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
  if (scaleMeters <= 40 * KM) return { scale: 1, alpha: 1 };
  if (scaleMeters <= 100 * KM) {
    const t = (scaleMeters - 40 * KM) / (60 * KM);
    return { scale: 1 - t * 0.16, alpha: 1 };
  }
  if (scaleMeters <= 200 * KM) {
    const t = (scaleMeters - 100 * KM) / (100 * KM);
    return { scale: 0.84 - t * 0.34, alpha: 1 - t * 0.18 };
  }
  if (scaleMeters <= 400 * KM) {
    const t = (scaleMeters - 200 * KM) / (200 * KM);
    return { scale: 0.5 - t * 0.5, alpha: 0.82 - t * 0.82 };
  }
  return { scale: 0, alpha: 0 };
}

function unitZoomProgress() {
  const cameraLog = Math.log(Math.max(camera.scale, UNIT_ICON_MIN_CAMERA_SCALE));
  const minLog = Math.log(UNIT_ICON_MIN_CAMERA_SCALE);
  const maxLog = Math.log(UNIT_ICON_MAX_CAMERA_SCALE);
  return Math.max(0, Math.min(1, (cameraLog - minLog) / (maxLog - minLog)));
}

function unitIconScale(selected = false) {
  const progress = unitZoomProgress();
  const scale = UNIT_ICON_MIN_SCALE + (UNIT_ICON_MAX_SCALE - UNIT_ICON_MIN_SCALE) * progress;
  return Math.min(UNIT_ICON_MAX_SCALE, scale * (selected ? 1.1 : 1));
}

function unitLabelPx() {
  return UNIT_LABEL_MIN_PX + (UNIT_LABEL_MAX_PX - UNIT_LABEL_MIN_PX) * unitZoomProgress();
}

function clusterSameTypeMissileLabels(items, thresholdPx) {
  return clusterProximityLabels(items, thresholdPx);
}

function labelAlpha(force = false) {
  if (force) return 1;
  return Math.max(0, Math.min(1, (camera.scale - 0.0007) / 0.0016));
}

function gridStepForScale() {
  // Keep ~30–70 lines per axis at any zoom so full-earth zoom-out stays cheap.
  const targetPx = 48;
  const metersPerLine = targetPx / Math.max(1e-9, camera.scale);
  const candidates = [
    GRID_MINOR_M,
    GRID_MAJOR_M,
    5 * GRID_MAJOR_M,
    20 * GRID_MAJOR_M,
    50 * GRID_MAJOR_M,
    100 * GRID_MAJOR_M,
    250 * GRID_MAJOR_M,
    500 * GRID_MAJOR_M
  ];
  for (const step of candidates) {
    if (step >= metersPerLine * 0.55) return step;
  }
  return candidates[candidates.length - 1];
}

function drawGrid() {
  if (!filterEnabled(filters.grid)) return;
  const step = gridStepForScale();
  const key = `${innerWidth}|${innerHeight}|${camera.x}|${camera.y}|${camera.scale}|${step}`;
  if (gridPathCache.key !== key) {
    const leftTop = screenToWorld(0, 0);
    const rightBottom = screenToWorld(innerWidth, innerHeight);
    const majorEvery = step >= GRID_MAJOR_M
      ? Math.max(1, Math.round(step / GRID_MAJOR_M))
      : 5;
    const major = new Path2D();
    const minor = new Path2D();
    for (let x = Math.floor(leftTop.x / step) * step; x < rightBottom.x; x += step) {
      const sx = worldToScreen({ x, y: 0 }).x;
      const isMajor = Math.abs(Math.round(x / step) % majorEvery) < 1e-9;
      const path = isMajor ? major : minor;
      path.moveTo(sx, 0);
      path.lineTo(sx, innerHeight);
    }
    for (let y = Math.floor(leftTop.y / step) * step; y < rightBottom.y; y += step) {
      const sy = worldToScreen({ x: 0, y }).y;
      const isMajor = Math.abs(Math.round(y / step) % majorEvery) < 1e-9;
      const path = isMajor ? major : minor;
      path.moveTo(0, sy);
      path.lineTo(innerWidth, sy);
    }
    gridPathCache = { key, major, minor };
  }
  ctx.strokeStyle = "rgba(20,24,28,.07)";
  ctx.lineWidth = 1;
  ctx.stroke(gridPathCache.minor);
  ctx.strokeStyle = "rgba(20,24,28,.16)";
  ctx.lineWidth = 1.15;
  ctx.stroke(gridPathCache.major);
}

function drawRadarRings() {
  if (!filterEnabled(filters.radar)) return;
  // Strategic zoom: radar arcs become noise and cost full circles for every pick.
  if (camera.scale < 0.00035) return;
  for (const ship of sim.ships) {
    if (!ship.alive || !ship.radarActive) continue;
    if (!selectedIds.has(ship.id)) continue;
    const p = worldToScreen(ship);
    ctx.strokeStyle = `${sideColor(ship.side)}40`;
    ctx.lineWidth = 0.9;
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
// space. The top-bar WEZ toggle controls the whole layer. With many hulls,
// only selected units draw rings (full detail returns when the force is small
// or the user selects the units they care about).
function collectWeaponRangeRings() {
  const rings = [];
  if (!filterEnabled(filters.ranges)) return rings;
  // Full-earth zoom-out: rings fill the screen and dominate frame cost.
  if (camera.scale < 0.00028 && selectedIds.size === 0) return rings;
  const aliveCount = sim._aliveShips?.length ?? sim.ships.length;
  // Dense zoom-in also thrashes on ring clip/union — only selected when busy.
  const selectOnly = aliveCount > WEAPON_RING_SELECT_SHIP_CAP
    || camera.scale < 0.00045
    || (camera.scale > 0.002 && aliveCount > 10);
  for (const ship of sim.ships) {
    if (!ship.alive) continue;
    const selected = selectedIds.has(ship.id) || ship.id === sim.selectedId;
    if (selectOnly && !selected) continue;
    const p = worldToScreen(ship);
    // Nearest distance from the viewport rectangle to this ship (ring centre).
    const nx = Math.max(0, Math.min(p.x, innerWidth));
    const ny = Math.max(0, Math.min(p.y, innerHeight));
    const minDistToView = Math.hypot(p.x - nx, p.y - ny);
    for (const entry of cachedWeaponRangeEntries(ship)) {
      const radius = entry.rangeM * camera.scale;
      if (radius < 1.5) continue;
      // The whole ring is off-screen (too small to reach the viewport): it draws
      // nothing and clips nothing visible, so skip it entirely. (Rings that
      // encompass the view are kept — they still bound the union of inner rings.)
      if (radius < minDistToView - 2) continue;
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
  // A merged cluster of overlapping same-type/same-faction rings should show
  // exactly one label, not one per ring. Union-find the group by the same
  // overlap test used for clipping. Cache each ring's neighbours during that
  // single pairwise pass so drawing does not repeat the O(n²) geometry work.
  // Keep one label owner per connected cluster (preferring a selected ring).
  const labelOwners = new Set();
  const overlapMap = new Map(rings.map((ring) => [ring, []]));
  for (const group of groups.values()) {
    if (group.length === 1) {
      labelOwners.add(group[0]);
      continue;
    }
    const parent = group.map((_, index) => index);
    const find = (index) => {
      while (parent[index] !== index) {
        parent[index] = parent[parent[index]];
        index = parent[index];
      }
      return index;
    };
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const reach = a.radius + b.radius;
        if (dx * dx + dy * dy < reach * reach) {
          overlapMap.get(a).push(b);
          overlapMap.get(b).push(a);
          const rootA = find(i);
          const rootB = find(j);
          if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
        }
      }
    }
    const ownerByRoot = new Map();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      const current = ownerByRoot.get(root);
      if (!current || (group[i].selected && !current.selected)) ownerByRoot.set(root, group[i]);
    }
    for (const owner of ownerByRoot.values()) labelOwners.add(owner);
  }
  ctx.save();
  for (const ring of rings) {
    const overlappers = overlapMap.get(ring);
    ctx.setLineDash(ringDash(ring.ringStyle));
    const isAirDefense = ring.category !== "anti_ship";
    const alpha = ring.selected ? 0.92 : 0.72;
    // Light-sea theater: ink-dark anti-ship rings, deeper force color for AAW.
    ctx.strokeStyle = ring.category === "anti_ship"
      ? `rgba(26, 30, 35, ${ring.selected ? 0.42 : 0.28})`
      : `${sideColor(ring.side)}${Math.round((isAirDefense ? alpha * 1.05 : alpha) * 255).toString(16).padStart(2, "0")}`;
    ctx.lineWidth = ring.selected ? 1.05 : 0.82;
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
      && (ring.selected || isAntiAirCategory(ring.category))
      && labelOwners.has(ring);
    if (showRingLabel) {
      ctx.setLineDash([]);
      // 30% more transparent and 30% smaller than the ring stroke's own label
      // used to be, so a merged cluster's single label reads as a light,
      // secondary annotation rather than competing with the ring itself.
      ctx.globalAlpha = (ring.selected ? labelAlpha(true) * 0.86 : 0.74) * 0.7;
      ctx.fillStyle = ring.category === "anti_ship" ? "#1a1e23" : sideColor(ring.side);
      ctx.font = canvasFont(VISUAL_CONFIG.rangeLabelPx * 0.7);
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
  ctx.fillStyle = selected ? sideSoftColor(ship.side) : "rgba(248, 250, 251, .94)";
  ctx.lineWidth = selected ? 1.35 : 1;
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
  ctx.globalAlpha = ship.alive ? 0.85 : 0.4;
  ctx.strokeStyle = "rgba(14,16,18,.45)";
  ctx.lineWidth = 0.55;
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
    ctx.font = canvasFont(Math.max(8, VISUAL_CONFIG.shipLabelPx * label.scale));
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
    ctx.fillStyle = selected ? sideSoftColor(ship.side) : "rgba(248, 250, 251, .94)";
    ctx.lineWidth = selected ? 1.25 : 0.9;
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

function drawSubmarine(ship, label) {
  const p = worldToScreen(ship);
  if (!screenPointVisible(p, 48)) return;
  const color = sideColor(ship.side);
  const selected = ship.id === sim.selectedId;
  const len = worldSize(ship.lengthM, 5, 18);
  const beam = Math.max(2.5, len * 0.22);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(ship.heading);
  ctx.globalAlpha = ship.alive ? 0.9 : 0.3;
  ctx.strokeStyle = color;
  ctx.fillStyle = selected ? sideSoftColor(ship.side) : "rgba(248, 250, 251, .94)";
  ctx.lineWidth = selected ? 1.3 : 0.95;
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  ctx.ellipse(0, 0, len * 0.5, beam, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-len * 0.12, 0);
  ctx.lineTo(len * 0.12, 0);
  ctx.moveTo(0, -beam);
  ctx.lineTo(0, -beam * 1.8);
  ctx.stroke();
  ctx.restore();
  if (label.alpha > 0.04) {
    ctx.save();
    ctx.globalAlpha = label.alpha;
    ctx.fillStyle = color;
    ctx.font = canvasFont(Math.max(7, VISUAL_CONFIG.shipLabelPx * label.scale));
    ctx.fillText(`${shipDisplayName(ship, "-")} ${Math.round(ship.depthM ?? 0)}m`, p.x + len * 0.5 + 3, p.y - 5);
    ctx.restore();
  }
}

// Frame-local density snapshot for ship/missile draw LOD (reset each render).
let _frameAliveShipCount = 0;
let _frameDenseDraw = false;

function drawShipLabel(ship, label) {
  const p = worldToScreen(ship);
  if (!screenPointVisible(p, 72)) return;
  const color = sideColor(ship.side);
  const selected = selectedIds.has(ship.id) || ship.id === sim.selectedId;
  const domain = ship.domain === "surface" ? "sea" : (ship.domain || "sea");
  const farOut = label.scale < 0.45 || label.alpha < 0.35;
  const dense = _frameDenseDraw && !selected;
  const showLabel = selected
    || (!farOut && !dense && label.alpha > 0.12 && _frameAliveShipCount <= 28)
    || (!farOut && label.alpha > 0.2 && _frameAliveShipCount <= 14);
  if (!showLabel) return;

  ctx.save();
  ctx.globalAlpha = (ship.alive ? 0.96 : 0.34) * Math.max(label.alpha, selected ? 1 : 0.5);
  ctx.fillStyle = color;
  const iconScale = unitIconScale(selected);
  ctx.font = canvasFont(unitLabelPx());
  const modifier = [ship.isOTC && "OTC", ship.isAAWC && "AAWC"].filter(Boolean).join(" · ");
  const airCount = domain === "air" ? ` ×${aliveAircraftCount(ship)}/${squadronSize(ship)}` : "";
  const depth = domain === "subsurface" ? ` ${Math.round(ship.depthM ?? 0)}m` : "";
  ctx.fillText(
    `${shipDisplayName(ship, "-")}${airCount}${depth}${modifier ? `  ${modifier}` : ""}`,
    p.x + 14 * iconScale,
    p.y - 7 * iconScale
  );
  ctx.restore();
}

function drawScaledShip(ship, label, drawLabel = true) {
  const p = worldToScreen(ship);
  if (!screenPointVisible(p, 36)) return;
  const color = sideColor(ship.side);
  const selected = selectedIds.has(ship.id) || ship.id === sim.selectedId;
  const presentation = unitPresentation(ship.hull, SHIP_CLASSES[ship.hull] || ship);
  // Follow every zoom-wheel movement continuously, then clamp to explicit
  // readable bounds at strategic and close tactical zoom.
  const farOut = label.scale < 0.45 || label.alpha < 0.35;
  // Dense zoom-in: many hulls on screen — labels/arrows still use LOD, while
  // every unit keeps its identifying internal texture.
  const dense = _frameDenseDraw && !selected;
  const iconScale = unitIconScale(selected);
  const domain = ship.domain === "surface" ? "sea" : (ship.domain || "sea");
  if (domain === "air") {
    // A squadron is a four-aircraft element. Keep the silhouettes small and
    // spread them into a compact echelon so the formation reads as a flight,
    // while the label remains the source of truth for attrition/custom sizes.
    const aircraftCount = Math.max(1, aliveAircraftCount(ship));
    const heading = Number.isFinite(ship.heading) ? ship.heading : 0;
    const aircraftScale = iconScale * 0.52;
    const formation = [
      [5, 0],
      [-3, -5],
      [-3, 5],
      [-10, 0]
    ];
    for (let i = 0; i < aircraftCount; i++) {
      const [along, across] = formation[i] || [-(i + 1) * 6, (i % 2 ? -1 : 1) * 5];
      const x = p.x + Math.cos(heading) * along - Math.sin(heading) * across;
      const y = p.y + Math.sin(heading) * along + Math.cos(heading) * across;
      drawTacticalSymbol(ctx, {
        x,
        y,
        side: ship.side,
        domain,
        symbolId: presentation.symbolId,
        selected,
        alive: ship.alive,
        heading,
        color,
        scale: aircraftScale,
        simple: false
      });
    }
  } else {
    drawTacticalSymbol(ctx, {
      x: p.x,
      y: p.y,
      side: ship.side,
      domain,
      symbolId: presentation.symbolId,
      selected,
      alive: ship.alive,
      heading: ship.heading,
      color,
      scale: iconScale,
      simple: false
    });
  }

  if (drawLabel) drawShipLabel(ship, label);

  // Velocity arrows only for selected (or sparse force) — big cost when many move.
  if (!farOut && (selected || !_frameDenseDraw) && sim.mode !== SCENARIO_MODE.SETUP
    && ship.alive && (ship.speed > 0.1 || ship.desiredSpeed > 0.1)) {
    const hasVelocity = Math.hypot(ship.vx ?? 0, ship.vy ?? 0) > 0.1;
    const direction = hasVelocity ? Math.atan2(ship.vy, ship.vx) : (Number.isFinite(ship.heading) ? ship.heading : 0);
    const arrowLength = 28;
    const tipX = p.x + Math.cos(direction) * arrowLength;
    const tipY = p.y + Math.sin(direction) * arrowLength;
    const wing = 5;
    ctx.strokeStyle = `${color}88`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(direction) * 14, p.y + Math.sin(direction) * 14);
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
  if (camera.scale < 0.0004) return;
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
    if (!selectedIds.has(ship.id)) continue;
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

function appendMissileSymbol(path, x, y, cos, sin, size, isAntiAir) {
  if (isAntiAir) {
    path.moveTo(x + size * cos, y + size * sin);
    let localX = -size * 0.65;
    let localY = -size * 0.72;
    path.lineTo(x + localX * cos - localY * sin, y + localX * sin + localY * cos);
    localY = size * 0.72;
    path.lineTo(x + localX * cos - localY * sin, y + localX * sin + localY * cos);
    path.closePath();
    return;
  }
  const half = size * 0.58;
  path.moveTo(
    x + (-half) * cos - (-half) * sin,
    y + (-half) * sin + (-half) * cos
  );
  path.lineTo(
    x + half * cos - (-half) * sin,
    y + half * sin + (-half) * cos
  );
  path.lineTo(
    x + half * cos - half * sin,
    y + half * sin + half * cos
  );
  path.lineTo(
    x + (-half) * cos - half * sin,
    y + (-half) * sin + half * cos
  );
  path.closePath();
}

function drawMissiles(label) {
  if (!filterEnabled(filters.missiles)) return;
  const labelFontPx = Math.max(7, VISUAL_CONFIG.shipLabelPx * 0.4 * label.scale);
  // Reuse label buckets (clear in place) to cut per-frame Map churn.
  for (const bucket of _missileLabelBuckets.values()) bucket.length = 0;
  const missileLabelsByType = _missileLabelBuckets;
  const labelWidths = _missileLabelWidths;
  const wantLabels = label.scale > 0 && label.alpha > 0;
  // Geometry is accumulated into a handful of paths and painted once per
  // visual style. Every weapon keeps its full triangle/square symbol and every
  // target guide remains present, but hundreds of save/rotate/fill/stroke calls
  // collapse into a small, stable number of canvas operations.
  const guideBatches = _missileGuideBatches;
  const symbolBatches = _missileSymbolBatches;
  for (const item of guideBatches.values()) {
    item.path = new Path2D();
    item.used = false;
  }
  for (const item of symbolBatches.values()) {
    item.path = new Path2D();
    item.used = false;
  }
  const batch = (map, key, style) => {
    let item = map.get(key);
    if (!item) {
      item = { path: new Path2D(), used: false, ...style };
      map.set(key, item);
    } else {
      item.stroke = style.stroke;
      item.fill = style.fill;
      item.width = style.width;
      item.dash = style.dash;
      item.glow = style.glow;
    }
    item.used = true;
    return item;
  };
  let labelPoolIndex = 0;
  const viewCenterX = innerWidth / 2;
  const viewCenterY = innerHeight / 2;
  const cameraScale = camera.scale;
  ctx.font = canvasFont(labelFontPx);
  const missiles = sim._aliveMissiles ?? sim.missiles;
  for (const missile of missiles) {
    if (!missile.alive) continue;
    const px = viewCenterX + (missile.x - camera.x) * cameraScale;
    const py = viewCenterY + (missile.y - camera.y) * cameraScale;
    const isAntiAir = missileDisplayRole(missile) === "anti_air";
    const targetCandidate = isAntiAir
      ? (sim._missileById?.get(missile.targetId) ?? null)
      : (sim._shipById?.get(missile.targetId) ?? null);
    const target = targetCandidate?.alive ? targetCandidate : null;
    const tx = target ? viewCenterX + (target.x - camera.x) * cameraScale : 0;
    const ty = target ? viewCenterY + (target.y - camera.y) * cameraScale : 0;
    const iconVisible = screenCoordinatesVisible(px, py, 24);
    if (!iconVisible) {
      if (!target || !segmentCoordinatesIntersectViewport(px, py, tx, ty, 4)) continue;
    }

    const iconColor = missile.terminal ? "#1a1e23" : sideColor(missile.side);
    if (target && segmentCoordinatesIntersectViewport(px, py, tx, ty, 4)) {
      const guide = batch(guideBatches, `${missile.side}|${missile.terminal ? "terminal" : "flight"}`, {
        stroke: `${sideColor(missile.side)}24`,
        width: missile.terminal ? 0.62 : 0.42,
        dash: missile.terminal ? [2, 3] : [7, 6]
      });
      guide.path.moveTo(px, py);
      guide.path.lineTo(tx, ty);
    }
    if (!iconVisible) continue;

    const size = worldSize(
      isAntiAir ? 34 : 52,
      Math.max(2.2, VISUAL_CONFIG.missileMinPx * (isAntiAir ? 0.85 : 1)),
      VISUAL_CONFIG.missileMaxPx * (isAntiAir ? 0.7 : 0.9),
      19
    );
    const symbols = batch(symbolBatches, `${isAntiAir ? "aaw" : "strike"}|${missile.terminal ? "terminal" : missile.side}`, {
      stroke: iconColor,
      fill: missile.terminal ? "rgba(26,30,35,.18)" : "rgba(248, 250, 251, .92)",
      width: isAntiAir ? 1.05 : 0.65,
      glow: isAntiAir
    });
    const heading = Number.isFinite(missile.heading) ? missile.heading : 0;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    appendMissileSymbol(symbols.path, px, py, cos, sin, size, isAntiAir);

    if (wantLabels) {
      const spec = MISSILES[missile.missileId];
      const text = spec?.shortLabel ?? spec?.name ?? "";
      const anchorX = px + size * 0.5 + 2;
      const anchorY = py - 4;
      const widthKey = `${labelFontPx}|${text}`;
      let width = labelWidths.get(widthKey);
      if (width === undefined) {
        width = ctx.measureText(text).width;
        labelWidths.set(widthKey, width);
      }
      const height = Math.max(7, labelFontPx + 2);
      const groupKey = `${missile.side}:${missile.missileId}`;
      let bucket = missileLabelsByType.get(groupKey);
      if (!bucket) {
        bucket = [];
        missileLabelsByType.set(groupKey, bucket);
      }
      const item = _missileLabelPool[labelPoolIndex++] ?? {};
      if (labelPoolIndex > _missileLabelPool.length) _missileLabelPool.push(item);
      item.x = anchorX;
      item.y = anchorY;
      item.cx = anchorX + width / 2;
      item.cy = anchorY - height / 2;
      item.width = width;
      item.height = height;
      item.text = text;
      item.color = iconColor;
      item.alpha = 0.96;
      bucket.push(item);
    }
  }

  ctx.save();
  for (const guide of guideBatches.values()) {
    if (!guide.used) continue;
    ctx.strokeStyle = guide.stroke;
    ctx.lineWidth = guide.width;
    ctx.setLineDash(guide.dash);
    ctx.stroke(guide.path);
  }
  ctx.restore();

  for (const symbols of symbolBatches.values()) {
    if (!symbols.used) continue;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = symbols.stroke;
    ctx.fillStyle = symbols.fill;
    ctx.lineWidth = symbols.width;
    if (symbols.glow) {
      ctx.shadowColor = symbols.stroke;
      ctx.shadowBlur = 3;
    }
    ctx.fill(symbols.path);
    ctx.stroke(symbols.path);
    ctx.restore();
  }

  if (wantLabels) {
    for (const items of missileLabelsByType.values()) {
      if (!items.length) continue;
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
    ctx.strokeStyle = "#1a1e23";
    ctx.fillStyle = "#1a1e23";
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
  ctx.strokeStyle = "rgba(14,16,18,.55)";
  ctx.fillStyle = "rgba(14,16,18,.06)";
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function placementValidity(world, hull = deployHull) {
  const cls = SHIP_CLASSES[hull];
  if (!cls) return { valid: false, reason: "装备数据不可用" };
  if (!canAddAssets(sim)) return { valid: false, reason: "当前推演状态不能部署" };
  const candidate = { ...cls, x: world.x, y: world.y, hull };
  const anywhere = cls.domain === "air" || (cls.isAirfield && (cls.domain === "ground" || cls.isFixed));
  if (anywhere) return { valid: true, reason: "可部署" };
  if (cls.isFixed || cls.domain === "ground") {
    return isShipPositionOnLand(sim, candidate)
      ? { valid: true, reason: "可部署" }
      : { valid: false, reason: "该地面装备必须部署在陆地上" };
  }
  return isShipPositionOnWater(sim, candidate)
    ? { valid: true, reason: "可部署" }
    : { valid: false, reason: "舰艇和潜艇必须部署在开放水域" };
}

function drawPlacementPreview() {
  if (!placementPreview || !deployHull || (tool !== "blue" && tool !== "red")) return;
  const item = unitPresentation(deployHull, SHIP_CLASSES[deployHull]);
  const p = worldToScreen(placementPreview);
  drawTacticalSymbol(ctx, {
    x: p.x,
    y: p.y,
    side: deploySide,
    domain: item.category === "sea" ? "sea" : item.category,
    symbolId: item.symbolId,
    selected: true,
    heading: deploySide === SIDE.BLUE ? Math.PI : 0,
    color: sideColor(deploySide),
    scale: 1.18,
    preview: true,
    valid: placementPreview.valid
  });
}


function applyI18n() {
  document.documentElement.lang = 'zh-CN';
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
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
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
  if (localized !== key) return localized;
  return cls.prefixZh || cls.prefix || hull;
}
function populateSpawnDropdown() {
  if (!shipClassSelect) return;
  const prev = shipClassSelect.value;
  const naval = [];
  const ground = [];
  const air = [];
  const subsurface = [];
  for (const [hull, cls] of Object.entries(SHIP_CLASSES)) {
    const bucket = cls.domain === "ground" ? ground
      : cls.domain === "air" ? air
        : cls.domain === "subsurface" ? subsurface
          : naval;
    bucket.push([hull, cls]);
  }
  const escAttr = escapeHtml;
  const optHtml = (arr) => arr
    .map(([hull, cls]) => `<option value="${escAttr(hull)}">${escAttr(spawnOptionLabel(hull, cls))}</option>`)
    .join("");
  const group = (label, arr) => arr.length ? `<optgroup label="${escAttr(label)}">${optHtml(arr)}</optgroup>` : "";
  shipClassSelect.innerHTML =
    group(t("naval.group"), naval) +
    group(t("subsurface.group"), subsurface) +
    group(t("ground.group"), ground) +
    group(t("air.group"), air);
  if ([...shipClassSelect.options].some((o) => o.value === prev)) shipClassSelect.value = prev;
}

function pointsBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function boundsOverlap(a, b) {
  return a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
}

function addTerrainBucket(buckets, item) {
  const minX = Math.floor(item.bbox.minX / TERRAIN_BUCKET_M);
  const maxX = Math.floor(item.bbox.maxX / TERRAIN_BUCKET_M);
  const minY = Math.floor(item.bbox.minY / TERRAIN_BUCKET_M);
  const maxY = Math.floor(item.bbox.maxY / TERRAIN_BUCKET_M);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = `${x},${y}`;
      const bucket = buckets.get(key) ?? [];
      if (!bucket.length) buckets.set(key, bucket);
      bucket.push(item);
    }
  }
}

function terrainItemsInView(buckets, viewBounds) {
  const items = [];
  const seen = new Set();
  const minX = Math.floor(viewBounds.minX / TERRAIN_BUCKET_M);
  const maxX = Math.floor(viewBounds.maxX / TERRAIN_BUCKET_M);
  const minY = Math.floor(viewBounds.minY / TERRAIN_BUCKET_M);
  const maxY = Math.floor(viewBounds.maxY / TERRAIN_BUCKET_M);
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (const item of buckets.get(`${x},${y}`) ?? []) {
        if (seen.has(item)) continue;
        seen.add(item);
        if (boundsOverlap(item.bbox, viewBounds)) items.push(item);
      }
    }
  }
  return items;
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
    const landBuckets = new Map();
    const waterBuckets = new Map();
    const coastBuckets = new Map();
    const borderBuckets = new Map();
    paths = {
      land: map.landRings.map((ring) => {
        const path = new Path2D();
        ring.forEach(([x, y], index) => index === 0 ? path.moveTo(x, y) : path.lineTo(x, y));
        path.closePath();
        return { path, bbox: pointsBounds(ring) };
      }),
      water: (map.waterRings ?? []).map((ring) => {
        const path = new Path2D();
        ring.forEach(([x, y], index) => index === 0 ? path.moveTo(x, y) : path.lineTo(x, y));
        path.closePath();
        return { path, bbox: pointsBounds(ring) };
      }),
      coast: map.coastlines.map((coastline) => {
        const path = new Path2D();
        coastline.forEach(([x, y], index) => index === 0 ? path.moveTo(x, y) : path.lineTo(x, y));
        return { path, bbox: pointsBounds(coastline) };
      }),
      // Retain the generated field for backwards-compatible map data loads,
      // but do not draw the fragmented political overlay. The prior clean
      // coastline layer is the visible map reference again.
      borders: (map.nationalBorders ?? []).map((border) => {
        const path = new Path2D();
        border.forEach(([x, y], index) => index === 0 ? path.moveTo(x, y) : path.lineTo(x, y));
        return { path, bbox: pointsBounds(border) };
      }),
      landBuckets,
      waterBuckets,
      coastBuckets,
      borderBuckets
    };
    for (const item of paths.land) addTerrainBucket(landBuckets, item);
    for (const item of paths.water) addTerrainBucket(waterBuckets, item);
    for (const item of paths.coast) addTerrainBucket(coastBuckets, item);
    for (const item of paths.borders) addTerrainBucket(borderBuckets, item);
    terrainPathCache.set(map, paths);
  }
  if (terrainLayerKey !== key) {
    terrainLayerKey = key;
    terrainLayerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    terrainLayerCtx.clearRect(0, 0, innerWidth, innerHeight);
    terrainLayerCtx.save();
    terrainLayerCtx.translate(innerWidth / 2 - camera.x * camera.scale, innerHeight / 2 - camera.y * camera.scale);
    terrainLayerCtx.scale(camera.scale, camera.scale);
    const viewBounds = {
      minX: camera.x - innerWidth / (2 * camera.scale),
      maxX: camera.x + innerWidth / (2 * camera.scale),
      minY: camera.y - innerHeight / (2 * camera.scale),
      maxY: camera.y + innerHeight / (2 * camera.scale)
    };
    terrainLayerCtx.fillStyle = "#626a73";
    terrainLayerCtx.setLineDash([]);
    for (const landPath of terrainItemsInView(paths.landBuckets, viewBounds)) terrainLayerCtx.fill(landPath.path);
    terrainLayerCtx.fillStyle = "#cfd6db";
    for (const waterPath of terrainItemsInView(paths.waterBuckets, viewBounds)) terrainLayerCtx.fill(waterPath.path);
    terrainLayerCtx.strokeStyle = "#000000";
    // Keep the coastline at a readable absolute screen width while drawing
    // inside the world-space camera transform.
    terrainLayerCtx.lineCap = "round";
    terrainLayerCtx.lineJoin = "round";
    terrainLayerCtx.lineWidth = 2.4 / Math.max(camera.scale, 0.0001);
    for (const coastPath of terrainItemsInView(paths.coastBuckets, viewBounds)) terrainLayerCtx.stroke(coastPath.path);
    const legacyBorderLayerEnabled = false;
    if (legacyBorderLayerEnabled) {
      for (const borderPath of terrainItemsInView(paths.borderBuckets, viewBounds)) terrainLayerCtx.stroke(borderPath.path);
    }
    terrainLayerCtx.strokeStyle = "rgba(14,16,18,.55)";
    terrainLayerCtx.lineWidth = 1.4;
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
  clock.textContent = formatTime(sim.time);
  play.textContent = sim.mode === SCENARIO_MODE.SETUP || sim.paused ? "▶" : "Ⅱ";
  document.querySelector("#speed-value").textContent = `${Number(speed.value)}×`;
  const counts = battleSummaryCounts(sim);
  const postureKey = [SIDE.BLUE, SIDE.RED].map((side) => {
    const posture = sim.commandState?.get(side);
    return `${posture?.aggression ?? 0.5}:${posture?.advantage ?? 0}`;
  }).join("|");
  // A compact mode label (SETUP READY / RUNNING / PAUSED / ENDED) leads the
  // status bar so the player always sees the current battle state at a glance.
  const modeLabel = sim.mode === SCENARIO_MODE.ENDED ? RUN_STATUS.ended
    : sim.mode === SCENARIO_MODE.RUNNING ? (sim.paused ? RUN_STATUS.paused : RUN_STATUS.running)
    : RUN_STATUS.ready;
  const statusKey = `${modeLabel}|${Object.values(counts).join(":")}|${postureKey}|${sim.events?.[0]?.t ?? 0}|${sim.events?.[0]?.text ?? ""}`;
  if (panelRenderCache.status !== statusKey) {
    panelRenderCache.status = statusKey;
    status.dataset.mode = modeLabel;
    status.setAttribute("aria-label", `${modeLabel}，双方战况`);
    if (!statusDomCache) {
      replaceHtmlIfChanged(status, renderBattleStatus(sim, counts));
      statusDomCache = cacheStatusDom();
    }
    patchBattleStatus(battleStatusState(sim, counts));
  }
  const inventoryStructureKey = `${sim.ships.map((ship) => [
    ship.id,
    ship.side,
    ship.hull,
    ship.domain,
    ship.isFixed
  ].join(":")).join("|")}`;
  if (panelRenderCache.inventory !== inventoryStructureKey) {
    panelRenderCache.inventory = inventoryStructureKey;
    const orderedShips = [...sim.ships].sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
    replaceHtmlIfChanged(unitTab, inventoryHtml(orderedShips, (id) => selectedIds.has(id)));
    applyI18n();
    cacheInventoryDomRows();
    inventoryValueKeys.clear();
  }
  for (const ship of sim.ships) {
    const valueKey = [
      ship.alive,
      ship.damage,
      ship.airState,
      Math.round(ship.speed ?? 0),
      Math.round(ship.altitudeM ?? 0),
      Math.round(ship.fuelS ?? 0),
      Math.round(ship.rearmUntil ?? 0),
      ship.homeBaseId,
      selectedIds.has(ship.id),
      ...Object.entries(ship.loadout || {}).flat()
    ].join(":");
    if (inventoryValueKeys.get(ship.id) === valueKey) continue;
    inventoryValueKeys.set(ship.id, valueKey);
    const refs = inventoryDomRows.get(ship.id);
    if (refs) patchInventoryRow(ship, refs);
  }
  const scaleKey = camera.scale.toFixed(8);
  if (panelRenderCache.scale !== scaleKey) {
    panelRenderCache.scale = scaleKey;
    renderScaleBar();
  }
  const placementEnabled = canAddAssets(sim);
  const placementKey = `${placementEnabled}`;
  if (panelRenderCache.placement !== placementKey) {
    panelRenderCache.placement = placementKey;
    document.querySelectorAll('[data-tool="blue"], [data-tool="red"], #ship-class').forEach((el) => {
      el.disabled = !placementEnabled;
    });
    const deployButton = document.querySelector("#deploy-open");
    deployButton.disabled = !placementEnabled;
    deployButton.title = placementEnabled ? "打开装备库" : "当前推演状态不能部署兵力";
    if (!placementEnabled && deployHull) endPlacement();
  }
}

function render() {
  // When paused and nothing changed, skip the expensive canvas redraw to keep
  // CPU/RAM idle. The dirty flag is set by any state change (sim step, camera,
  // selection, placement, filter toggle, resize, pointer move during placement).
  if (!canvasDirty && sim.paused) {
    // Still refresh DOM panels occasionally (cheap text diff), but skip canvas.
    const nowMs = performance.now();
    if (nowMs - lastPanelRenderAt >= PANEL_RENDER_INTERVAL_MS) {
      lastPanelRenderAt = nowMs;
      renderPanels();
    }
    return;
  }
  canvasDirty = false;
  clampCamera();
  _frameAliveShipCount = sim._aliveShips?.length ?? sim.ships.filter((s) => s.alive).length;
  // Dense when many hulls, especially zoomed in (detail + labels + arrows thrash).
  _frameDenseDraw = _frameAliveShipCount >= 16
    || (_frameAliveShipCount >= 10 && camera.scale > 0.0015);
  drawSceneBase();
  drawGrid();
  drawTerrain();
  drawWeaponRangeRings();
  drawRadarRings();
  if (!_frameDenseDraw || selectedIds.size > 0) {
    for (const ship of sim.ships) {
      if (selectedIds.has(ship.id)) drawSectorResponsibility(ship);
    }
  }
  if (filterEnabled(filters.tracks)) drawTracks();
  const label = shipLabelScale();
  // Paint unit geometry first, then labels in a dedicated pass so later units
  // or missile graphics cannot overpaint text belonging to an earlier unit.
  for (const ship of sim.ships) drawScaledShip(ship, label, false);
  drawMissiles(label);
  for (const ship of sim.ships) drawShipLabel(ship, label);
  drawPlacementPreview();
  if (tool === "ruler") drawRuler();
  drawSelectionBox();
  // Throttle the DOM side-panels to ~20 Hz (the canvas above still draws every
  // frame). Numbers/events updating 50 ms later is imperceptible, but it avoids
  // rebuilding the inventory/event-log markup and reflowing on every frame.
  const nowMs = performance.now();
  if (nowMs - lastPanelRenderAt >= PANEL_RENDER_INTERVAL_MS) {
    lastPanelRenderAt = nowMs;
    renderPanels();
  }
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

// Cap sim catch-up work per animation frame so a heavy raid (100+ missiles)
// cannot force 4×32ms ticks into one frame and hitch the UI. Leftover sim time
// carries as debt into the next frame (rate is wall-clock only).
const FRAME_SIM_BUDGET_MS = 12;

function tick(now) {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Returning to SETUP (a fresh scenario / reset) ends the current capture so
  // the next run starts clean rather than appending to the previous one.
  if (sim.mode === SCENARIO_MODE.SETUP) {
    debugRunActive = false;
    simTimeDebt = 0;
  }
  if (!sim.paused) {
    if (!debugRunActive && sim.mode === SCENARIO_MODE.RUNNING) beginDebugRun();
    const rate = Number(speed.value);
    let remaining = elapsed * rate + simTimeDebt;
    simTimeDebt = 0;
    const budgetStart = performance.now();
    let steppedThisFrame = false;
    while (remaining > 0) {
      // Always allow the first tick of the frame so a slow device still advances;
      // subsequent ticks respect the budget and carry leftover sim time as debt.
      if (steppedThisFrame && performance.now() - budgetStart > FRAME_SIM_BUDGET_MS) {
        simTimeDebt = remaining;
        break;
      }
      const t0 = performance.now();
      stepSim(sim, Math.min(0.25, remaining));
      steppedThisFrame = true;
      canvasDirty = true;
      if (debugRunActive) {
        perfRec.record(sim, performance.now() - t0);
        battleLog.sample(sim);
      }
      remaining -= 0.25;
    }
    // Persist while live (throttled) and once more the instant the run ends, so
    // the logs always reflect the latest run even if the tab is closed.
    if (debugRunActive) {
      if (sim.mode === SCENARIO_MODE.ENDED) { saveDebugLogs(); debugRunActive = false; }
      else if (now - lastDebugSaveAt > 5000) { saveDebugLogs(); lastDebugSaveAt = now; }
    }
  }
  const renderStart = performance.now();
  render();
  if (debugRunActive) perfRec.recordRender(performance.now() - renderStart);
  requestAnimationFrame(tick);
}

window.addEventListener("resize", () => { resize(); positionPlacementHud(); canvasDirty = true; });
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
  canvasDirty = true;
});
canvas.addEventListener("pointerdown", (event) => {
  const world = screenToWorld(event.clientX, event.clientY);
  if (event.button === 2) {
    if (tool === "blue" || tool === "red") {
      endPlacement();
      canvasDirty = true;
      return;
    }
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
    canvasDirty = true;
    return;
  }
  if (event.button === 1 || event.altKey) {
    drag = { type: "pan", x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
    return;
  }
  if (tool === "blue" || tool === "red") {
    if (!canAddAssets(sim)) return;
    const hull = deployHull || shipClassSelect?.value || "DDG";
    const validity = placementValidity(world, hull);
    setPlacementMessage(validity.reason, validity.valid);
    if (!validity.valid) return;
    const placed = placeShip(sim, tool === "blue" ? SIDE.BLUE : SIDE.RED, world.x, world.y, hull);
    if (!placed) return;
    setPrimarySelection(placed);
    document.querySelector("#empty-state")?.setAttribute("hidden", "");
    canvasDirty = true;
    return;
  }
  if (tool === "ruler") {
    activeRuler = { a: world, b: world };
    drag = { type: "ruler" };
    canvasDirty = true;
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
    canvasDirty = true;
  }
});
canvas.addEventListener("pointermove", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  const world = screenToWorld(event.clientX, event.clientY);
  cursor.textContent = `${(world.x / KM).toFixed(1)}, ${(world.y / KM).toFixed(1)} km`;
  if ((tool === "blue" || tool === "red") && deployHull) {
    positionPlacementHud(event.clientX, event.clientY);
    const validity = placementValidity(world);
    placementPreview = { ...world, ...validity };
    setPlacementMessage(validity.reason, validity.valid);
    canvasDirty = true;
  }
  if (drag) {
    if (drag.type === "ruler" && activeRuler) {
      activeRuler.b = world;
      canvasDirty = true;
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
        canvasDirty = true;
      }
    } else if (drag.type === "pan") {
      camera.x = drag.cx - (event.clientX - drag.x) / camera.scale;
      camera.y = drag.cy - (event.clientY - drag.y) / camera.scale;
      clampCamera();
      canvasDirty = true;
    } else if (drag.type === "box-select" && selectionBox) {
      selectionBox.x1 = event.clientX;
      selectionBox.y1 = event.clientY;
      canvasDirty = true;
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
  canvasDirty = true;
});

function setMapTool(nextTool) {
  tool = nextTool === "ruler" ? "ruler" : "select";
  if (tool !== "ruler") {
    // Leaving 测距 clears all ruler graphics — nothing should linger in 选择.
    activeRuler = null;
    rulers = [];
    drag = drag?.type === "ruler" ? null : drag;
  }
  document.querySelectorAll('[data-tool="select"], [data-tool="ruler"]').forEach((button) => {
    const on = button.dataset.tool === tool;
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const mapToolToggle = document.querySelector("#map-tool-toggle");
  if (mapToolToggle) {
    mapToolToggle.dataset.toolToggle = tool;
    mapToolToggle.setAttribute("aria-pressed", tool === "ruler" ? "true" : "false");
    mapToolToggle.querySelectorAll(".map-tool-option").forEach((option, index) => {
      option.classList.toggle("active", index === (tool === "ruler" ? 1 : 0));
    });
  }
  canvas.style.cursor = tool === "ruler" ? "crosshair" : "";
  canvasDirty = true;
}

document.querySelectorAll('[data-tool="select"], [data-tool="ruler"]').forEach((button) => {
  button.addEventListener("click", () => {
    // Exclusive toggle: 选择 ↔ 测距. Clicking the active tool does nothing.
    const next = button.dataset.tool;
    if (next === tool) return;
    setMapTool(next);
  });
});

// --- equipment library and continuous placement ---------------------------
const equipmentOverlay = document.querySelector("#equipment-overlay");
const equipmentGrid = document.querySelector("#equipment-grid");
const equipmentSearch = document.querySelector("#equipment-search");
const equipmentCategories = document.querySelector("#equipment-categories");
const equipmentCount = document.querySelector("#equipment-count");
const placementChip = document.querySelector("#placement-chip");
const placementName = document.querySelector("#placement-name");
const placementMessage = document.querySelector("#placement-message");
let equipmentCategory = "all";
let lastPointer = { x: innerWidth / 2, y: innerHeight / 2 };

function positionPlacementHud(clientX = lastPointer.x, clientY = lastPointer.y) {
  if (!placementChip || placementChip.hidden) return;
  const chipWidth = placementChip.offsetWidth || 190;
  const chipHeight = placementChip.offsetHeight || 40;
  const messageHeight = placementMessage?.offsetHeight || 22;
  const left = Math.max(8, Math.min(clientX + 16, innerWidth - chipWidth - 8));
  const top = Math.max(8, Math.min(clientY + 16, innerHeight - chipHeight - messageHeight - 16));
  placementChip.style.left = `${left}px`;
  placementChip.style.top = `${top}px`;
  if (placementMessage) {
    placementMessage.style.left = `${left}px`;
    placementMessage.style.top = `${top + chipHeight + 6}px`;
    placementMessage.style.width = `${chipWidth}px`;
  }
}

function markEmptyStateSeen() {}

function setPlacementMessage(message = "", valid = false) {
  placementMessage.textContent = message;
  placementMessage.classList.toggle("valid", Boolean(message && valid));
}

function endPlacement() {
  deployHull = null;
  placementPreview = null;
  placementChip.hidden = true;
  setPlacementMessage();
  setMapTool("select");
}

function renderEquipmentLibrary() {
  const query = equipmentSearch.value.trim().toLocaleLowerCase("zh-CN");
  const items = unitCatalog().filter((item) => {
    const categoryMatch = equipmentCategory === "all" || item.category === equipmentCategory;
    const searchMatch = !query || item.searchTerms.toLocaleLowerCase("zh-CN").includes(query);
    return categoryMatch && searchMatch;
  });
  equipmentCategories.innerHTML = UNIT_CATEGORIES.map((category) =>
    `<button type="button" data-category="${category.id}" class="${category.id === equipmentCategory ? "active" : ""}">${category.label}</button>`
  ).join("");
  equipmentGrid.innerHTML = items.map((item) => `
    <button class="equipment-card" type="button" data-equipment="${escapeHtml(item.id)}">
      <span class="equipment-stats">${item.statSummary.map((stat) => `<i>${escapeHtml(stat)}</i>`).join("")}</span>
      <span class="equipment-name"><strong>${escapeHtml(item.zhName)}</strong><b>${escapeHtml(item.designation)}</b></span>
      <span class="equipment-role">${escapeHtml(item.role)}${item.custom ? " · 自定义" : ""}</span>
      <span class="equipment-art" aria-hidden="true">
        ${item.artwork
          ? `<img src="${escapeHtml(item.artwork)}" alt="" loading="lazy" decoding="async" />`
          : `<i class="art-fallback ${escapeHtml(item.category)}"></i>`}
      </span>
      <span class="equipment-hover-name" aria-hidden="true"><strong>${escapeHtml(item.zhName)}</strong><small>${escapeHtml(item.designation)}</small></span>
      <span class="equipment-side-hit equipment-side-blue" data-deploy-side="blue" role="button" tabindex="0" aria-label="蓝方部署"></span>
      <span class="equipment-side-hit equipment-side-red" data-deploy-side="red" role="button" tabindex="0" aria-label="红方部署"></span>
    </button>`).join("");
  equipmentGrid.querySelectorAll(".equipment-art img").forEach((image) => {
    image.addEventListener("error", () => {
      const art = image.closest(".equipment-art");
      const card = image.closest("[data-equipment]");
      const category = unitPresentation(card?.dataset.equipment || "")?.category || "sea";
      image.remove();
      if (art && !art.querySelector(".art-fallback")) {
        const fallback = document.createElement("i");
        fallback.className = `art-fallback ${category}`;
        art.appendChild(fallback);
      }
    }, { once: true });
  });
  equipmentCount.textContent = query || equipmentCategory !== "all"
    ? `显示 ${items.length} 种装备`
    : `共 ${items.length} 种装备`;
}

function openEquipmentLibrary() {
  if (!canAddAssets(sim)) {
    setPlacementMessage("当前推演状态不能部署兵力。");
    return;
  }
  markEmptyStateSeen();
  sim.paused = true;
  equipmentOverlay.hidden = false;
  renderEquipmentLibrary();
  equipmentSearch.focus();
}

function closeEquipmentLibrary() {
  equipmentOverlay.hidden = true;
  canvas.focus();
}

function beginPlacement(hull) {
  deployHull = hull;
  shipClassSelect.value = hull;
  tool = deploySide === SIDE.BLUE ? "blue" : "red";
  const item = unitPresentation(hull, SHIP_CLASSES[hull]);
  placementName.textContent = `${deploySide === SIDE.BLUE ? "蓝方" : "红方"} · ${item.zhName} ${item.designation}`;
  placementChip.hidden = false;
  placementChip.classList.toggle("red", deploySide === SIDE.RED);
  positionPlacementHud();
  canvas.style.cursor = "crosshair";
  closeEquipmentLibrary();
  setPlacementMessage("移动光标选择部署位置");
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.remove("active"));
}

document.querySelector("#deploy-open")?.addEventListener("click", openEquipmentLibrary);
document.querySelector("#empty-deploy")?.addEventListener("click", openEquipmentLibrary);
document.querySelector("#equipment-close")?.addEventListener("click", closeEquipmentLibrary);
equipmentOverlay?.addEventListener("click", (event) => {
  if (event.target === equipmentOverlay) closeEquipmentLibrary();
  const side = event.target.closest("[data-deploy-side]")?.dataset.deploySide;
  if (side) {
    deploySide = side === "red" ? SIDE.RED : SIDE.BLUE;
    const hull = event.target.closest("[data-equipment]")?.dataset.equipment;
    if (hull) beginPlacement(hull);
    return;
  }
  const hull = event.target.closest("[data-equipment]")?.dataset.equipment;
  if (hull) beginPlacement(hull);
  const category = event.target.closest("[data-category]")?.dataset.category;
  if (category) {
    equipmentCategory = category;
    renderEquipmentLibrary();
  }
});
equipmentSearch?.addEventListener("input", renderEquipmentLibrary);
placementChip?.addEventListener("click", openEquipmentLibrary);

function startScenario() {
  if (!canRunScenario(sim)) {
    showNoticeDialog(RUN_STATUS.invalid);
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
  canvasDirty = true;
});
speed.addEventListener("input", () => {
  document.querySelector("#speed-value").textContent = `${Number(speed.value)}×`;
});
async function resetSandbox() {
  if (!(await confirmDialog("重置会清除当前推演和未保存的进度。确定继续吗？"))) return;
  sim = createDefaultScenario(undefined, sim.mapId);
  selectedIds = new Set([sim.selectedId].filter(Boolean));
  activeRuler = null;
  rulers = [];
  endPlacement();
}
document.querySelectorAll("[data-reset]").forEach((button) => button.addEventListener("click", resetSandbox));

function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// Custom-location save: File System Access API where available (a real "Save
// As" dialog, any folder), Blob-download fallback everywhere else. Either way
// this never touches saves/scenarios/, so it never shows up in the Load popup.
// Returns false if the user cancelled the OS file picker (so the caller can
// keep the Save form open); true once the file is written or downloaded.
async function saveJsonToCustomLocation(name, data) {
  const text = JSON.stringify(data, null, 2);
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      // Fall through to Blob download on any other failure (e.g. unsupported in this context).
    }
  }
  downloadJson(name, data);
  return true;
}

document.querySelector("#aar").addEventListener("click", () => {
  const aar = exportAfterAction(sim);
  aar.events = aar.events.map((event) => ({
    ...event,
    displayTextZh: translateEventText(event.text)
  }));
  downloadJson(`tomahawk-aar-${Math.floor(sim.time)}.json`, aar);
});

// Lightweight non-blocking replacement for window.confirm(): a real confirm()
// call freezes the whole tab's JS thread, including the rAF sim loop, until
// dismissed — unacceptable in a real-time simulator.
function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay";
    const card = document.createElement("div");
    card.className = "about-card save-card";
    const p = document.createElement("p");
    p.textContent = message;
    const actions = document.createElement("div");
    actions.className = "save-actions";
    const no = document.createElement("button");
    no.className = "about-close";
    no.textContent = t("save.cancel");
    const yes = document.createElement("button");
    yes.className = "about-close";
    yes.textContent = t("confirm.yes");
    actions.append(no, yes);
    card.append(p, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const finish = (result) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    // Trap keyboard while the modal is open: Escape = cancel, Enter = confirm.
    // Capture phase + stopPropagation stops the global keydown handler from
    // toggling the sim or cycling ships behind the dialog.
    const onKey = (event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); finish(false); }
      else if (event.key === "Enter") { event.preventDefault(); finish(true); }
    };
    document.addEventListener("keydown", onKey, true);
    no.addEventListener("click", () => finish(false));
    yes.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(false); });
    no.focus();
  });
}

function showNoticeDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "about-overlay notice-overlay";
    const card = document.createElement("div");
    card.className = "about-card notice-card";
    const p = document.createElement("p");
    p.textContent = message;
    const hint = document.createElement("small");
    hint.textContent = "点击任意位置关闭";
    const ok = document.createElement("button");
    ok.className = "about-close primary";
    ok.textContent = "确定";
    card.append(p, hint, ok);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const finish = () => { overlay.remove(); resolve(); };
    ok.addEventListener("click", finish);
    overlay.addEventListener("click", finish);
    ok.focus();
  });
}

// --- save scenario popup ----------------------------------------------------
const saveOverlay = document.querySelector("#save-overlay");
const saveNameInput = document.querySelector("#save-name");
let savePrevPaused = false;

function openSavePopup() {
  savePrevPaused = sim.paused;
  sim.paused = true;
  saveNameInput.value = "";
  document.querySelector('input[name="save-location"][value="default"]').checked = true;
  saveOverlay.hidden = false;
  saveNameInput.focus();
}

function closeSavePopup() {
  saveOverlay.hidden = true;
  sim.paused = savePrevPaused;
}

async function submitSave(name, force) {
  const location = document.querySelector('input[name="save-location"]:checked')?.value;
  const data = serializeScenario(sim);
  if (location === "custom") {
    try {
      // If the user dismissed the OS file picker, keep the Save form open so
      // they can retry instead of losing their typed scenario name.
      const saved = await saveJsonToCustomLocation(`${name || "Untitled"}.json`, data);
      if (saved === false) return;
      status.textContent = t("save.done");
      closeSavePopup();
    } catch {
      status.textContent = t("save.failed");
    }
    return;
  }
  try {
    const res = await fetch("/scenario/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, data, force })
    });
    if (!res.ok) {
      await saveJsonToCustomLocation(`${name || "Untitled"}.json`, data);
      status.textContent = t("save.done");
      closeSavePopup();
      return;
    }
    const result = await res.json();
    if (!result.ok && result.reason === "exists") {
      if (await confirmDialog(t("save.overwrite").replace("{n}", result.name))) {
        await submitSave(name, true);
      }
      return;
    }
    status.textContent = t("save.done");
    closeSavePopup();
  } catch {
    status.textContent = t("save.failed");
  }
}

document.querySelector("#save").addEventListener("click", openSavePopup);
document.querySelector("#save-cancel").addEventListener("click", closeSavePopup);
document.querySelector("#save-confirm").addEventListener("click", () => submitSave(saveNameInput.value.trim(), false));
saveOverlay.addEventListener("click", (e) => { if (e.target === saveOverlay) closeSavePopup(); });
document.querySelector("#load-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error("Scenario file exceeds the 5 MB import limit.");
    sim = restoreScenario(JSON.parse(await file.text()));
    selectedIds = new Set([sim.selectedId].filter(Boolean));
    closeLoadPopup();
  } catch (error) {
    alert(error.message);
  } finally {
    event.target.value = "";
  }
});

// --- load scenario popup -----------------------------------------------------
const loadOverlay = document.querySelector("#load-overlay");
const loadList = document.querySelector("#load-list");
let loadPrevPaused = false;

function formatSavedAt(ms) {
  const d = new Date(ms);
  return d.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}

async function refreshLoadList() {
  loadList.textContent = "";
  let entries = [];
  try {
    const response = await fetch("/scenario/list");
    if (response.ok) entries = await response.json();
  } catch {
    loadList.innerHTML = `<div class="load-empty">${t("load.failed")}</div>`;
    return;
  }
  if (!entries.length) {
    loadList.innerHTML = `<div class="load-empty">${t("load.empty")}</div>`;
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "load-row";
    const name = document.createElement("span");
    name.className = "load-name";
    name.textContent = entry.name;
    const date = document.createElement("span");
    date.className = "load-date";
    date.textContent = formatSavedAt(entry.savedAt);
    const del = document.createElement("button");
    del.className = "load-delete";
    del.type = "button";
    del.textContent = t("load.delete");
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog(t("load.deleteConfirm").replace("{n}", entry.name)))) return;
      await fetch(`/scenario/delete?name=${encodeURIComponent(entry.name)}`, { method: "DELETE" });
      refreshLoadList();
    });
    row.append(name, date, del);
    row.addEventListener("click", async () => {
      try {
        const data = await (await fetch(`/scenario/load?name=${encodeURIComponent(entry.name)}`)).json();
        sim = restoreScenario(data);
        selectedIds = new Set([sim.selectedId].filter(Boolean));
        closeLoadPopup();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    loadList.appendChild(row);
  }
}

function openLoadPopup() {
  loadPrevPaused = sim.paused;
  sim.paused = true;
  loadOverlay.hidden = false;
  refreshLoadList();
}

function closeLoadPopup() {
  loadOverlay.hidden = true;
  sim.paused = loadPrevPaused;
}

document.querySelector("#load").addEventListener("click", openLoadPopup);
document.querySelector("#load-cancel").addEventListener("click", closeLoadPopup);
document.querySelector("#load-import").addEventListener("click", () => document.querySelector("#load-file").click());
loadOverlay.addEventListener("click", (e) => { if (e.target === loadOverlay) closeLoadPopup(); });


window.addEventListener("keydown", (event) => {
  const target = event.target;
  // Never hijack keys while the user is typing in a field, dropdown, or any
  // editable control — Space/Tab/Delete there must serve the control itself.
  if (target instanceof HTMLInputElement
      || target instanceof HTMLSelectElement
      || target instanceof HTMLTextAreaElement
      || target.isContentEditable) return;
  if (modEditor.isOpen()) {
    if (event.key === "Escape") { event.preventDefault(); modEditor.close(); }
    return;
  }
  if (!equipmentOverlay.hidden && event.key === "Escape") {
    event.preventDefault();
    closeEquipmentLibrary();
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (sim.mode === SCENARIO_MODE.SETUP) startScenario();
    else if (sim.mode !== SCENARIO_MODE.ENDED) sim.paused = !sim.paused;
    canvasDirty = true;
  }
  if (event.key === ".") {
    if (sim.mode === SCENARIO_MODE.SETUP && !startScenario()) return;
    sim.paused = true;
    stepSim(sim, 0.25, { allowPaused: true });
    canvasDirty = true;
  }
  if (event.key === "Escape") {
    endPlacement();
    activeRuler = null;
    rulers = [];
    setMapTool("select");
  }
  if (event.key === "r" || event.key === "R") {
    if (tool === "ruler") {
      rulers = [];
      setMapTool("select");
    } else {
      setMapTool("ruler");
    }
  }
  if (event.key === "Tab") {
    // Tab cycles units only when no control is focused (focus rests on the
    // body/canvas). When a button or field is focused, let Tab move focus
    // normally so keyboard navigation between controls stays usable.
    if (target === document.body || target === document.documentElement || target === canvas) {
      event.preventDefault();
      cycleShip();
    }
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

function positionUnitInfo(event, anchor = event?.target) {
  if (unitInfoPopover.hidden) return;
  const rect = unitInfoPopover.getBoundingClientRect();
  const anchorRect = anchor?.getBoundingClientRect?.();
  const x = Number.isFinite(event?.clientX) ? event.clientX + 14 : (anchorRect?.right ?? 0) + 10;
  const y = Number.isFinite(event?.clientY) ? event.clientY + 14 : (anchorRect?.bottom ?? 0) + 8;
  const left = Math.max(8, Math.min(x, innerWidth - rect.width - 8));
  const top = Math.max(8, Math.min(y, innerHeight - rect.height - 8));
  unitInfoPopover.style.left = `${left}px`;
  unitInfoPopover.style.top = `${top}px`;
}

Object.values(filters).forEach((filter) => filter?.addEventListener("change", () => { canvasDirty = true; }));

function showUnitInfo(icon, event) {
  const ship = sim.ships.find((candidate) => candidate.id === icon?.dataset.infoShip);
  if (!ship) return;
  unitInfoPopover.innerHTML = unitInfoPopoverHtml(ship, sim);
  unitInfoPopover.hidden = false;
  positionUnitInfo(event, icon);
}

function hideUnitInfo() {
  unitInfoPopover.hidden = true;
}

unitTab?.addEventListener("pointerover", (event) => {
  const icon = event.target.closest?.("[data-info-ship]");
  if (!icon || (event.relatedTarget && icon.contains(event.relatedTarget))) return;
  showUnitInfo(icon, event);
});
unitTab?.addEventListener("pointermove", (event) => {
  const icon = event.target.closest?.("[data-info-ship]");
  if (icon) positionUnitInfo(event, icon);
});
unitTab?.addEventListener("pointerout", (event) => {
  const icon = event.target.closest?.("[data-info-ship]");
  if (icon && (!event.relatedTarget || !icon.contains(event.relatedTarget))) hideUnitInfo();
});
unitTab?.addEventListener("focusin", (event) => {
  const icon = event.target.closest?.("[data-info-ship]");
  if (icon) showUnitInfo(icon, null);
});
unitTab?.addEventListener("focusout", (event) => {
  const icon = event.target.closest?.("[data-info-ship]");
  if (icon && (!event.relatedTarget || !icon.contains(event.relatedTarget))) hideUnitInfo();
});
unitTab?.addEventListener("click", (event) => {
  if (event.target.closest?.("[data-info-ship]")) {
    event.preventDefault();
    event.stopPropagation();
  }
});
window.addEventListener("resize", hideUnitInfo);

resize();

// --- right panel collapse toggle -------------------------------------------
const rpCollapseBtn = document.querySelector(".rp-collapse");
if (rpCollapseBtn) {
  rpCollapseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.querySelector("#right-panel");
    const collapsed = panel.classList.toggle("retracted");
    rpCollapseBtn.setAttribute("aria-expanded", String(!collapsed));
  });
}

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
// Preload mod records from IndexedDB. A failure (e.g. a blocked/private storage
// context) must not crash the app or leave an unhandled rejection — the
// Workshop simply opens empty and vanilla play is unaffected.
modEditor.preload().catch((err) => console.warn("Unit Workshop preload failed:", err));
  // Console diagnostics: window.tomahawkMods.dump("SM-7X") returns the stored
// record plus whether it is registered as a usable missile.
window.tomahawkMods = modEditor;
if (modsToggle) modsToggle.addEventListener("click", (e) => { e.stopPropagation(); modEditor.open(); });
if (modsCloseBtn) modsCloseBtn.addEventListener("click", () => modEditor.close());
modsOverlay.addEventListener("click", (e) => { if (e.target === modsOverlay) modEditor.close(); });

// --- drawers, tabs and first-run guidance ---------------------------------
function wirePopover(toggleId, panelId) {
  const toggle = document.querySelector(toggleId);
  const panel = document.querySelector(panelId);
  toggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = panel.hidden;
    document.querySelectorAll(".hud-popover:not(#tools-menu)").forEach((item) => { item.hidden = true; });
    document.querySelectorAll("[aria-controls]").forEach((item) => {
      if (item !== toggle) item.setAttribute("aria-expanded", "false");
    });
    panel.hidden = !opening;
    toggle.setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && event.target !== toggle) {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}
wirePopover("#layers-toggle", "#map-options");

document.querySelector("#summary-collapse")?.addEventListener("click", (event) => {
  const overview = document.querySelector("#battle-overview");
  const collapsed = overview.classList.toggle("collapsed");
  event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
  event.currentTarget.setAttribute("aria-label", collapsed ? "展开战况总览" : "收起战况总览");
});
document.querySelector("#empty-close")?.addEventListener("click", () => {
  markEmptyStateSeen();
  canvas.focus();
});

document.querySelector("#map-tool-toggle")?.addEventListener("click", () => {
  setMapTool(tool === "select" ? "ruler" : "select");
});
document.querySelector("#context-close")?.addEventListener("click", () => {
  document.querySelector("#right-panel").classList.add("retracted");
  rpCollapseBtn?.setAttribute("aria-expanded", "false");
});

const tourOverlay = document.querySelector("#tour-overlay");
let tourIndex = 0;
function closeTour() {
  tourOverlay.hidden = true;
}
function showTourStep(index) {
  tourIndex = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, index));
  const step = TUTORIAL_STEPS[tourIndex];
  let target = document.querySelector(step.target);
  if (!target || target.hidden || !target.getClientRects().length) target = document.querySelector("#deploy-open");
  const rect = target.getBoundingClientRect();
  const spotlight = document.querySelector("#tour-spotlight");
  spotlight.style.cssText = `left:${rect.left - 6}px;top:${rect.top - 6}px;width:${rect.width + 12}px;height:${rect.height + 12}px`;
  const card = document.querySelector("#tour-card");
  const left = rect.right + 18 + 280 < innerWidth ? rect.right + 18 : Math.max(18, rect.left - 278);
  const top = Math.min(innerHeight - 210, Math.max(18, rect.top));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  document.querySelector("#tour-progress").textContent = `${tourIndex + 1} / ${TUTORIAL_STEPS.length}`;
  document.querySelector("#tour-title").textContent = step.title;
  document.querySelector("#tour-body").textContent = step.body;
  document.querySelector("#tour-next").textContent = tourIndex === TUTORIAL_STEPS.length - 1 ? "完成" : "下一步";
}
function startTour() {
  tourOverlay.hidden = false;
  showTourStep(0);
}
document.querySelector("#tutorial-start")?.addEventListener("click", startTour);
document.querySelector("#tour-exit")?.addEventListener("click", closeTour);
document.querySelector("#tour-next")?.addEventListener("click", () => {
  if (tourIndex >= TUTORIAL_STEPS.length - 1) closeTour();
  else showTourStep(tourIndex + 1);
});
// --- ship cycling via Tab --------------------------------------------------
function cycleShip() {
  const alive = sim.ships.filter((s) => s.alive);
  if (!alive.length) return;
  const idx = alive.findIndex((s) => s.id === sim.selectedId);
  const next = alive[(idx + 1) % alive.length];
  setPrimarySelection(next);
}

requestAnimationFrame(tick);
