import {
  MISSILES,
  NM,
  SCENARIO_MODE,
  SIDE,
  SHIP_CLASSES,
  VISUAL_CONFIG,
  canRunScenario,
  canAddAssets,
  createScenario,
  deleteShip,
  distance,
  eventSeverity,
  exportAfterAction,
  formatTime,
  placeShip,
  restoreScenario,
  serializeScenario,
  setLoadout,
  stepSim,
  weaponRangeEntries
} from "./sim.js";
import {
  sideColor,
  sideSoftColor,
  shipHpState,
  vlsLoadState,
  renderBattleStatus,
  inventoryHtml,
  worldToScreen as projectWorldToScreen,
  screenToWorld as projectScreenToWorld
} from "./ui/view.js";
import { t, toggleLang, getLang, hullLabel, roleLabel, sideLabel, translateEventText, formatLocalizedEventLines } from "./ui/lang.js";

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

let sim = createScenario();
let tool = "select";
let camera = { x: 0, y: 0, scale: 0.0022 };
let drag = null;
let activeRuler = null;
let rulers = [];
let selectionBox = null;
let selectedIds = new Set([sim.selectedId]);
let last = performance.now();
let labelBoxes = [];
let feedCollapsed = false;
let aboutOpen = false;
const TACTICAL_SYMBOL_SCALE = 26;
const CANVAS_FONT_FAMILY = '"Lato", "Segoe UI", Arial, sans-serif';
const canvasFont = (px) => `${px}px ${CANVAS_FONT_FAMILY}`;
const RUN_STATUS = {
  get ready() { return t('status.ready'); },
  get invalid() { return t('status.invalid'); },
  get running() { return t('status.running'); },
  get paused() { return t('status.paused'); },
  get ended() { return t('status.ended'); }
};

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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

function worldSize(meters, minPx = 2, maxPx = 24, multiplier = TACTICAL_SYMBOL_SCALE) {
  return Math.max(minPx, Math.min(maxPx, meters * camera.scale * multiplier));
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
  ctx.fillStyle = "#07141b";
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!filters.grid.classList.contains("active")) return;
  const minor = 10 * NM;
  const major = 50 * NM;
  const leftTop = screenToWorld(0, 0);
  const rightBottom = screenToWorld(innerWidth, innerHeight);

  for (let x = Math.floor(leftTop.x / minor) * minor; x < rightBottom.x; x += minor) {
    const sx = worldToScreen({ x, y: 0 }).x;
    const isMajor = Math.abs(x % major) < 1;
    ctx.strokeStyle = isMajor ? "rgba(95,139,154,.36)" : "rgba(95,139,154,.14)";
    ctx.lineWidth = isMajor ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, innerHeight);
    ctx.stroke();
  }
  for (let y = Math.floor(leftTop.y / minor) * minor; y < rightBottom.y; y += minor) {
    const sy = worldToScreen({ x: 0, y }).y;
    const isMajor = Math.abs(y % major) < 1;
    ctx.strokeStyle = isMajor ? "rgba(95,139,154,.36)" : "rgba(95,139,154,.14)";
    ctx.lineWidth = isMajor ? 1.2 : 1;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(innerWidth, sy);
    ctx.stroke();
  }

  const bounds = [
    worldToScreen({ x: -sim.widthM / 2, y: -sim.heightM / 2 }),
    worldToScreen({ x: sim.widthM / 2, y: sim.heightM / 2 })
  ];
  ctx.strokeStyle = "rgba(172, 213, 225, .45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(bounds[0].x, bounds[0].y, bounds[1].x - bounds[0].x, bounds[1].y - bounds[0].y);
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

function drawWeaponRangeRings(ship) {
  if (!filters.ranges.classList.contains("active") || !ship.alive) return;
  if (filters.rangesMode.value === "off") return;
  const p = worldToScreen(ship);
  const selected = ship.id === sim.selectedId;
  if (filters.rangesMode.value === "selected" && !selected) return;
  const entries = weaponRangeEntries(ship);
  ctx.save();
  for (const entry of entries) {
    const radius = entry.rangeM * camera.scale;
    if (radius < 1.5) continue;
    ctx.setLineDash(ringDash(entry.ringStyle));
    const isAirDefense = entry.category !== "anti_ship";
    const alpha = selected ? 0.82 : 0.58;
    ctx.strokeStyle = entry.category === "anti_ship"
      ? `rgba(247, 231, 161, ${selected ? 0.34 : 0.24})`
      : `${sideColor(ship.side)}${Math.round((isAirDefense ? alpha * 1.12 : alpha) * 255).toString(16).padStart(2, "0")}`;
    ctx.lineWidth = selected ? 0.72 : 0.56;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    const showRingLabel = radius > 10 && (selected || entry.category === "anti_air");
    if (showRingLabel) {
      ctx.setLineDash([]);
      ctx.globalAlpha = selected ? labelAlpha(true) * 0.86 : 0.74;
      ctx.fillStyle = entry.category === "anti_ship" ? "#f7e7a1" : sideColor(ship.side);
      ctx.font = canvasFont(VISUAL_CONFIG.rangeLabelPx);
      const labelX = Math.max(54, Math.min(innerWidth - 48, p.x + radius + 3));
      const antiAirOffset = entry.id === "ESSM" ? 8 : entry.id === "SM-2MR" ? -2 : 0;
      const labelY = Math.max(78, Math.min(innerHeight - 48, p.y - 3 + antiAirOffset));
      ctx.fillText(entry.shortLabel, labelX, labelY);
      ctx.globalAlpha = 1;
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

function drawScaledShip(ship) {
  const p = worldToScreen(ship);
  const color = sideColor(ship.side);
  const selected = ship.id === sim.selectedId;
  const len = worldSize(ship.lengthM, 3.5, 25);
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

  const alpha = labelAlpha(selected);
  if (alpha > 0.05) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = canvasFont(VISUAL_CONFIG.shipLabelPx);
    const roleTag = ship.isOTC ? ` ◈${roleLabel('OTC')}` : ship.fleetRole === "AAWC" ? ` ·${roleLabel('AAWC')}` : "";
    const displayHull = hullLabel(ship.hull);
    const seqNum = ship.id.replace(ship.hull + '-', '');
    ctx.fillText(`${displayHull}-${seqNum}${roleTag}`, p.x + len * 0.48 + 3, p.y - 5);
    ctx.restore();
  }
  if (ship.alive && ship.waypoint) {
    const w = worldToScreen(ship.waypoint);
    ctx.strokeStyle = `${color}88`;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(w.x, w.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const mark = worldSize(90, 2, 5.5, 22);
    ctx.strokeRect(w.x - mark, w.y - mark, mark * 2, mark * 2);
  }
}

function drawSectorResponsibility(ship) {
  // Only meaningful once a fleet exists and a sub-sector has been carved out.
  if (!ship.alive || sim.mode !== SCENARIO_MODE.RUNNING) return;
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
    for (const track of ship.tracks.values()) {
      const p = worldToScreen(track);
      const r = Math.max(3, track.uncertainty * camera.scale);
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
      const alpha = labelAlpha(track.quality > 0.65);
      if (alpha > 0.05) {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = sideColor(track.side);
        const contact = sim.ships.find((s) => s.id === track.id);
        const label = contact?.hull ?? (track.classification?.includes("combatant") ? "SURF" : track.classification);
        const text = `${label} Q${Math.round(track.quality * 100)}`;
        const font = canvasFont(VISUAL_CONFIG.shipLabelPx);
        ctx.font = font;
        if (reserveLabel(text, p.x + mark + 4, p.y + 11, font, track.quality > 0.88)) {
          ctx.fillText(text, p.x + mark + 4, p.y + 11);
        }
        ctx.restore();
      }
    }
  }
}

function drawMissiles() {
  if (!filters.missiles.classList.contains("active")) return;
  for (const missile of sim.missiles) {
    const p = worldToScreen(missile);
    const spec = MISSILES[missile.missileId];
    const isAntiAir = spec?.category === "anti_air";
    const size = worldSize(
      isAntiAir ? 34 : 52,
      VISUAL_CONFIG.missileMinPx * (isAntiAir ? 0.7 : 0.9),
      VISUAL_CONFIG.missileMaxPx * (isAntiAir ? 0.7 : 0.9),
      19
    );
    const iconColor = missile.terminal ? "#f7b955" : sideColor(missile.side);
    const labelColor = sideColor(missile.side);
    const labelOffset = ((missile.launchSequence ?? 0) % 5) * 3.5;
    const target = spec?.target === "missile"
      ? sim.missiles.find((m) => m.id === missile.targetId)
      : sim.ships.find((s) => s.id === missile.targetId);
    if (target) {
      const t = worldToScreen(target);
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
    if (spec?.category === "anti_air") {
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.65, -size * 0.72);
      ctx.lineTo(-size * 0.65, size * 0.72);
      ctx.closePath();
    } else if (spec?.category === "dual_role") {
      // Diamond for dual-role (SM-6)
      ctx.moveTo(size * 0.65, 0);
      ctx.lineTo(0, -size * 0.65);
      ctx.lineTo(-size * 0.65, 0);
      ctx.lineTo(0, size * 0.65);
      ctx.closePath();
    } else {
      ctx.rect(-size * 0.58, -size * 0.58, size * 1.16, size * 1.16);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = labelAlpha(missile.terminal) * 0.95;
    if (ctx.globalAlpha > 0.04) {
      const text = spec?.shortLabel ?? missile.missileId;
      const font = canvasFont(VISUAL_CONFIG.missileLabelPx);
      const labelX = p.x + size + 2 + (((missile.launchSequence ?? 0) % 3) - 1) * 4;
      const labelY = p.y - 2 + labelOffset;
      if (!reserveLabel(text, labelX, labelY, font, missile.terminal)) {
        ctx.restore();
        continue;
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(5, 12, 16, .92)";
      ctx.font = font;
      ctx.strokeText(text, labelX, labelY);
      ctx.fillStyle = labelColor;
      ctx.fillText(text, labelX, labelY);
    }
    ctx.restore();
  }
}

function drawRuler() {
  for (const ruler of [...rulers, activeRuler].filter(Boolean)) {
    const a = worldToScreen(ruler.a);
    const b = worldToScreen(ruler.b);
    const dNm = distance(ruler.a, ruler.b) / NM;
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
    ctx.fillText(`${dNm.toFixed(1)} nm / ${bearing.toFixed(0)}°`, (a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 8);
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
  if (!detailShips.length) { shipDetailOverlay.innerHTML = ''; return; }
  const cardWidth = 120;
  const cardGap = 2;
  const rightInset = 6;
  const y = 8;
  const availableHeight = innerHeight - y - 16;
  shipDetailOverlay.style.cssText = `position:fixed;right:${rightInset}px;top:${y}px;z-index:100;width:${cardWidth}px;max-height:${availableHeight}px;display:flex;flex-direction:column;align-items:stretch;gap:${cardGap}px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;scrollbar-color: rgba(142,193,205,0.25) transparent;`;

  const cardHtml = (s) => {
    const rdr = s.subsystems?.radar ?? 1.0;
    const prop = s.subsystems?.propulsion ?? 1.0;
    const fc = s.subsystems?.fireControl ?? 1.0;
    const ciws = s.subsystems?.ciws ?? 1.0;
    const cic = s.subsystems?.cic ?? 1.0;
    const hp = shipHpState(s);
    const vls = vlsLoadState(s);
    const color = sideColor(s.side);
    const subBar = (val, mode = "health") => {
      const w = Math.round(val * 100);
      const c = mode === "load"
        ? (val >= 0.8 ? '#5a9' : val >= 0.4 ? '#f7b955' : '#f66')
        : (val > 0.6 ? '#5a9' : val > 0.3 ? '#f7b955' : '#f66');
      return `<span class="subsystem-meter"><i style="width:${w}%;background:${c}"></i></span>`;
    };
    const row = (label, val, mode = "health") => `
      <span>${label}</span>
      ${subBar(val, mode)}
      <b>${Math.round(val * 100)}%</b>
    `;
    return `<div class="ship-detail-card" style="--ship-accent:${color};--ship-card-width:${cardWidth}px">
      <div class="ship-detail-heading">
        <b>${hullLabel(s.hull)} ${s.id}</b>
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
  shipDetailOverlay.innerHTML = detailShips.map(s => cardHtml(s)).join('');
}


function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  const invHead = unitTab.querySelector('.inventory-head');
  if (invHead) {
    const spans = invHead.querySelectorAll('span');
    const keys = ['inv.ship','inv.hp','inv.vls','inv.sm2','inv.sm6','inv.essm','inv.mstk','inv.tlam'];
    spans.forEach((sp, i) => { if (keys[i]) sp.textContent = t(keys[i]); });
  }
}

function renderPanels() {
  clock.textContent = formatTime(sim.time);
  play.textContent = sim.mode === SCENARIO_MODE.SETUP || sim.paused ? "▶" : "Ⅱ";
  status.innerHTML = renderBattleStatus(sim);
  const orderedShips = [...sim.ships].sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
  unitTab.innerHTML = inventoryHtml(orderedShips, (id) => selectedIds.has(id));
  applyI18n();
  const placementEnabled = canAddAssets(sim);
  document.querySelectorAll('[data-tool="blue"], [data-tool="red"], #ship-class').forEach((el) => {
    el.disabled = !placementEnabled;
  });
  eventLog.innerHTML = sim.events.map((e) => {
    const sLabel = sideLabel(e.side);
    const sideClass = e.side === 'BLUE' ? 'blue' : e.side === 'RED' ? 'red' : '';
    const sideWidth = getLang() === 'zh' ? '14px' : '12px';
    return `<div class="${eventSeverity(e.text)}" style="grid-template-columns:34px ${sideWidth} minmax(0, 1fr)">
      <span class="event-time">${formatTime(e.t)}</span>
      <b class="event-side ${sideClass}">${sLabel}</b>
      <span class="event-text">${translateEventText(e.text)}</span>
    </div>`;
  }).join("");
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
  drawGrid();
  for (const ship of sim.ships) drawWeaponRangeRings(ship);
  drawRadarRings();
  const focus = sim.ships.find((candidate) => candidate.id === sim.selectedId && selectedIds.has(candidate.id));
  if (focus) drawSectorResponsibility(focus);
  if (filters.tracks.classList.contains("active")) drawTracks();
  for (const ship of sim.ships) drawScaledShip(ship);
  drawMissiles();
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
  camera.scale = Math.max(0.00055, Math.min(0.011, camera.scale));
  const after = screenToWorld(event.clientX, event.clientY);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
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
    placeShip(sim, tool === "blue" ? SIDE.BLUE : SIDE.RED, world.x, world.y, hull);
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
      drag = { type: "ship", shipId: ship.id, ox: ship.x - world.x, oy: ship.y - world.y };
    }
  }
});
canvas.addEventListener("pointermove", (event) => {
  const world = screenToWorld(event.clientX, event.clientY);
  cursor.textContent = `${(world.x / NM).toFixed(1)}, ${(world.y / NM).toFixed(1)} nm`;
  if (drag) {
    if (drag.type === "ruler" && activeRuler) {
      activeRuler.b = world;
    } else if (drag.type === "ship") {
      const ship = sim.ships.find((candidate) => candidate.id === drag.shipId);
      if (ship) {
        ship.x = world.x + drag.ox;
        ship.y = world.y + drag.oy;
        ship.waypoint = null;
        ship.tracks.clear();
      }
    } else if (drag.type === "pan") {
      camera.x = drag.cx - (event.clientX - drag.x) / camera.scale;
      camera.y = drag.cy - (event.clientY - drag.y) / camera.scale;
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
  sim = createScenario();
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

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
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
  if (e.target.closest("#lang-toggle")) return;
  toggleAbout();
});
if (aboutCloseBtn) aboutCloseBtn.addEventListener("click", toggleAbout);
aboutOverlay.addEventListener("click", (e) => { if (e.target === aboutOverlay) toggleAbout(); });

// --- language toggle -------------------------------------------------------
if (langToggle) {
  langToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLang();
    langToggle.textContent = t('lang.toggle');
    applyI18n();
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
