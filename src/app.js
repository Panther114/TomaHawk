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
  setScenarioMap,
  setLoadout,
  stepSim,
  tracksForShip,
  weaponRangeEntries
} from "./sim.js";
import { PerfRecorder, BattleLogger } from "./sim/debug.js";
import {
  sideColor,
  sideSoftColor,
  shipDisplayName,
  shipDetailCardHtml,
  renderBattleStatus,
  inventoryHtml,
  clusterProximityLabels,
  escapeHtml,
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
  missiles: document.querySelector("#filter-missiles")
};

let sim = createDefaultScenario(undefined, mapSelect?.value);
let tool = "select";
// Camera coordinates are metres; the tactical readout presents kilometres.
let camera = { x: 13_900 * KM, y: -3_600 * KM, scale: 0.00125 };
let drag = null;
let activeRuler = null;
let rulers = [];
let selectionBox = null;
let selectedIds = new Set([sim.selectedId]);
let last = performance.now();

// The DOM side-panels are text and don't need 60 fps; rebuilding and diffing
// their markup every frame is wasted reflow. They refresh at ~20 Hz while the
// canvas battlefield keeps rendering every frame (so animation stays smooth).
let lastPanelRenderAt = 0;
const PANEL_RENDER_INTERVAL_MS = 50;
// Above this many live missiles, drop the per-missile glow (canvas shadowBlur is
// very expensive and indistinguishable in a crowded raid — exactly when frame
// budget is tight).
const MISSILE_GLOW_CAP = 50;
// Guide-lines (dashed missile→target strokes) are free at low density but
// dominate canvas cost in large raids. Only draw them when few missiles, or the
// related unit is selected, or the camera is zoomed in for tactical reading.
const MISSILE_GUIDE_LINE_CAP = 40;
// Above this count, thin non-terminal icons with a stable id hash (terminal and
// selection-related missiles always drawn). Purely visual; sim unchanged.
const MISSILE_ICON_THIN_CAP = 120;
// When many hulls and ranges are on, only selected ships draw WEZ rings.
const WEAPON_RING_SELECT_SHIP_CAP = 18;
// Reused label buckets to avoid per-frame Map/array churn in drawMissiles.
const _missileLabelBuckets = new Map();
const _missileLabelWidths = new Map();

function stableMissileHash(id) {
  // Deterministic visual thinning — not crypto; just spreads ids across buckets.
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

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
const TERRAIN_BUCKET_M = 4_000_000;
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

function drawGrid() {
  if (!filters.grid.classList.contains("active")) return;
  const leftTop = screenToWorld(0, 0);
  const rightBottom = screenToWorld(innerWidth, innerHeight);
  // Strategic zoom: only major lines (minor spacing becomes sub-pixel clutter
  // and wastes stroke calls across a huge map viewport).
  const minorStep = camera.scale < 0.0009 ? GRID_MAJOR_M : GRID_MINOR_M;

  for (let x = Math.floor(leftTop.x / minorStep) * minorStep; x < rightBottom.x; x += minorStep) {
    const sx = worldToScreen({ x, y: 0 }).x;
    const isMajor = Math.abs(x % GRID_MAJOR_M) < 1;
    if (minorStep === GRID_MAJOR_M && !isMajor) continue;
    ctx.strokeStyle = isMajor ? "rgba(95,139,154,.36)" : "rgba(95,139,154,.14)";
    ctx.lineWidth = isMajor ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, innerHeight);
    ctx.stroke();
  }
  for (let y = Math.floor(leftTop.y / minorStep) * minorStep; y < rightBottom.y; y += minorStep) {
    const sy = worldToScreen({ x: 0, y }).y;
    const isMajor = Math.abs(y % GRID_MAJOR_M) < 1;
    if (minorStep === GRID_MAJOR_M && !isMajor) continue;
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
// space. The top-bar WEZ toggle controls the whole layer. With many hulls,
// only selected units draw rings (full detail returns when the force is small
// or the user selects the units they care about).
function collectWeaponRangeRings() {
  const rings = [];
  if (!filters.ranges.classList.contains("active")) return rings;
  const aliveCount = sim._aliveShips?.length ?? sim.ships.length;
  const selectOnly = aliveCount > WEAPON_RING_SELECT_SHIP_CAP && selectedIds.size > 0;
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
  // overlap test used for clipping, then keep a single label owner per
  // connected cluster (preferring a selected ring so its label still wins).
  const labelOwners = new Set();
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
      && (ring.selected || isAntiAirCategory(ring.category))
      && labelOwners.has(ring);
    if (showRingLabel) {
      ctx.setLineDash([]);
      // 30% more transparent and 30% smaller than the ring stroke's own label
      // used to be, so a merged cluster's single label reads as a light,
      // secondary annotation rather than competing with the ring itself.
      ctx.globalAlpha = (ring.selected ? labelAlpha(true) * 0.86 : 0.74) * 0.7;
      ctx.fillStyle = ring.category === "anti_ship" ? "#f7e7a1" : sideColor(ring.side);
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
  // Carrier: dashed flight-deck centreline so a CVN reads as a moving airfield
  // at a glance without a separate draw path.
  if (ship.isAirfield || ship.isCarrier || ship.glyph === "carrier") {
    ctx.save();
    ctx.globalAlpha = ship.alive ? 0.85 : 0.4;
    ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.lineWidth = 0.7;
    ctx.setLineDash([Math.max(2, len * 0.08), Math.max(1.5, len * 0.05)]);
    ctx.beginPath();
    ctx.moveTo(-len * 0.35, 0);
    ctx.lineTo(len * 0.4, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
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

function drawMissiles(label) {
  if (!filters.missiles.classList.contains("active")) return;
  const labelFontPx = Math.max(7, VISUAL_CONFIG.shipLabelPx * 0.4 * label.scale);
  // Reuse label buckets (clear in place) to cut per-frame Map churn.
  for (const bucket of _missileLabelBuckets.values()) bucket.length = 0;
  const missileLabelsByType = _missileLabelBuckets;
  const labelWidths = _missileLabelWidths;
  const liveCount = sim._aliveMissiles?.length ?? sim.missiles.length;
  // Drop the per-missile glow in a crowded raid (shadowBlur is the most expensive
  // per-draw op and invisible at that density).
  const useGlow = liveCount <= MISSILE_GLOW_CAP;
  const zoomedIn = camera.scale >= 0.0012;
  const drawAllGuides = liveCount <= MISSILE_GUIDE_LINE_CAP || zoomedIn;
  const thinIcons = liveCount > MISSILE_ICON_THIN_CAP;
  // Strategic zoom: tiny points instead of rotated polygons (still read side/color).
  const lodDots = label.scale <= 0 || label.alpha < 0.15;
  const wantLabels = !lodDots && label.scale > 0 && label.alpha > 0;
  ctx.save();
  ctx.font = canvasFont(labelFontPx);
  const missiles = sim._aliveMissiles ?? sim.missiles;
  for (const missile of missiles) {
    if (!missile.alive) continue;
    const p = worldToScreen(missile);
    const iconVisible = screenPointVisible(p, 24);
    const relatedSelected = selectedIds.has(missile.launcherId) || selectedIds.has(missile.targetId);
    // Density sampling: always show terminal + selection-related; thin the rest.
    if (thinIcons && !missile.terminal && !relatedSelected && (stableMissileHash(missile.id) % 3) !== 0) {
      continue;
    }
    const drawGuide = drawAllGuides || relatedSelected || missile.terminal;
    if (!iconVisible && !drawGuide) continue;

    const isAntiAir = missileDisplayRole(missile) === "anti_air";
    const iconColor = missile.terminal ? "#f7b955" : sideColor(missile.side);

    if (drawGuide) {
      const targetCandidate = isAntiAir
        ? (sim._missileById?.get(missile.targetId) ?? null)
        : (sim._shipById?.get(missile.targetId) ?? null);
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
    }
    if (!iconVisible) continue;

    if (lodDots) {
      ctx.fillStyle = iconColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, missile.terminal ? 2.4 : 1.6, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    const size = worldSize(
      isAntiAir ? 34 : 52,
      Math.max(2.2, VISUAL_CONFIG.missileMinPx * (isAntiAir ? 0.85 : 1)),
      VISUAL_CONFIG.missileMaxPx * (isAntiAir ? 0.7 : 0.9),
      19
    );
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(missile.heading);
    ctx.strokeStyle = iconColor;
    ctx.fillStyle = missile.terminal ? "rgba(247,185,85,.22)" : "rgba(5, 12, 16, .82)";
    ctx.lineWidth = isAntiAir ? 1.05 : 0.65;
    if (isAntiAir && useGlow) {
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

    if (wantLabels) {
      const spec = MISSILES[missile.missileId];
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
      let bucket = missileLabelsByType.get(groupKey);
      if (!bucket) {
        bucket = [];
        missileLabelsByType.set(groupKey, bucket);
      }
      bucket.push({
        x: anchorX,
        y: anchorY,
        cx: anchorX + width / 2,
        cy: anchorY - height / 2,
        width,
        height,
        text,
        color: iconColor,
        alpha: 0.96
      });
    }
  }
  ctx.restore();

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

  // Card layout/coloring lives in ui/view.js (shipDetailCardHtml), dispatched
  // by unit TYPE (domain/isFixed) rather than hull name, and unit-tested
  // there — this is just wiring selection state to it.
  replaceHtmlIfChanged(shipDetailOverlay, detailShips.map((s) => shipDetailCardHtml(s, cardWidth)).join(''));
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
  return getLang() === "zh" && cls.prefixZh ? cls.prefixZh : (cls.prefix || hull);
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
  const escAttr = escapeHtml;
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
    const coastBuckets = new Map();
    paths = {
      land: map.landRings.map((ring) => {
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
      landBuckets,
      coastBuckets
    };
    for (const item of paths.land) addTerrainBucket(landBuckets, item);
    for (const item of paths.coast) addTerrainBucket(coastBuckets, item);
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
    terrainLayerCtx.fillStyle = "#111b1f";
    terrainLayerCtx.setLineDash([]);
    for (const landPath of terrainItemsInView(paths.landBuckets, viewBounds)) terrainLayerCtx.fill(landPath.path);
    terrainLayerCtx.strokeStyle = "#ffffff";
    terrainLayerCtx.lineWidth = 1.8 / camera.scale;
    for (const coastPath of terrainItemsInView(paths.coastBuckets, viewBounds)) terrainLayerCtx.stroke(coastPath.path);
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
      const sideClass = e.side === SIDE.BLUE ? 'blue' : e.side === SIDE.RED ? 'red' : '';
      const sideWidth = lang === 'zh' ? '14px' : '12px';
      return `<div class="${eventSeverity(e.text)}" style="grid-template-columns:34px ${sideWidth} minmax(0, 1fr)">
        <span class="event-time">${formatTime(e.t)}</span>
        <b class="event-side ${sideClass}">${sLabel}</b>
        <span class="event-text">${escapeHtml(translateEventText(e.text))}</span>
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
  // Throttle the DOM side-panels to ~20 Hz (the canvas above still draws every
  // frame). Numbers/events updating 50 ms later is imperceptible, but it avoids
  // rebuilding the inventory/event-log markup and reflowing on every frame.
  const nowMs = performance.now();
  if (nowMs - lastPanelRenderAt >= PANEL_RENDER_INTERVAL_MS) {
    lastPanelRenderAt = nowMs;
    renderPanels();
    renderShipDetails();
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

// Custom-location save: File System Access API where available (a real "Save
// As" dialog, any folder), Blob-download fallback everywhere else. Either way
// this never touches saves/scenarios/, so it never shows up in the Load popup.
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
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
      // Fall through to Blob download on any other failure (e.g. unsupported in this context).
    }
  }
  downloadJson(name, data);
}

document.querySelector("#aar").addEventListener("click", () => {
  downloadJson(`tomahawk-aar-${Math.floor(sim.time)}.json`, exportAfterAction(sim));
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
    const finish = (result) => { overlay.remove(); resolve(result); };
    no.addEventListener("click", () => finish(false));
    yes.addEventListener("click", () => finish(true));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(false); });
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
    await saveJsonToCustomLocation(`${name || "Untitled"}.json`, data);
    closeSavePopup();
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
  return d.toLocaleString(getLang() === "zh" ? "zh-CN" : "en-US", { dateStyle: "short", timeStyle: "short" });
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
