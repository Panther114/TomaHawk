// Pure presentation helpers for the tactical UI.
//
// Everything here is free of canvas/DOM access and global state: coordinate
// transforms take an explicit camera + viewport, and the panel builders return
// HTML strings. This keeps the view logic unit-testable (see tests/ui.test.mjs)
// and is the first step of separating rendering from `src/app.js`.

import {
  SIDE, NM, KNOT, MISSILES, SHIP_CLASSES, usedCells, vlsCapacity, battleSummaryCounts,
  aliveAircraftCount, squadronSize, missileCanTarget, missileHasSurfaceTarget
} from "../sim.js";
import { t } from "./lang.js";

// A ground emplacement is a fixed, land-based unit; it gets its own inventory
// sub-table (different columns) and glyph rather than the naval ship layout.
export function isGroundUnit(unit) {
  return unit?.domain === "ground" || unit?.isFixed === true;
}

// An air unit (aircraft squadron) gets its own inventory sub-table: flight
// strength + lifecycle state instead of HP/VLS.
export function isAirUnit(unit) {
  return unit?.domain === "air";
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

// Canonical naval weapons, kept in this order for callers that need a stable
// catalogue view. Custom (modded) missiles are appended automatically.
const VANILLA_COLUMNS = ["SM-2MR", "SM-6", "ESSM", "MaritimeStrike", "TomahawkBlockV"];

// Every missile actually carried (count > 0) by the given naval units —
// vanilla first (canonical order), then custom (sorted).
export function weaponColumns(navalUnits) {
  const present = new Set();
  for (const unit of navalUnits) {
    for (const [id, count] of Object.entries(unit.loadout || {})) {
      if (count > 0 && MISSILES[id]) present.add(id);
    }
  }
  const vanilla = VANILLA_COLUMNS.filter((id) => present.has(id));
  const custom = [...present].filter((id) => !VANILLA_COLUMNS.includes(id)).sort();
  return [...vanilla, ...custom];
}

// --- colors ----------------------------------------------------------------

// Deep force colors for monochrome sandbox: saturated only for side identity.
export function sideColor(side) {
  return side === SIDE.BLUE ? "#2d579f" : "#9f3838";
}

export function sideSoftColor(side) {
  return side === SIDE.BLUE ? "rgba(45,87,159,.16)" : "rgba(159,56,56,.14)";
}

// --- camera / viewport transforms ------------------------------------------

export function worldToScreen(p, camera, viewW, viewH) {
  return {
    x: viewW / 2 + (p.x - camera.x) * camera.scale,
    y: viewH / 2 + (p.y - camera.y) * camera.scale
  };
}

export function screenToWorld(x, y, camera, viewW, viewH) {
  return {
    x: (x - viewW / 2) / camera.scale + camera.x,
    y: (y - viewH / 2) / camera.scale + camera.y
  };
}

// Reused union-find / grid scratch so dense missile-label clustering does not
// allocate parent arrays and string cell keys on every draw.
const _clusterParent = [];
const _clusterRows = new Map();
const _clusterUsed = [];
const _clusterGroups = new Map();

export function clusterProximityLabels(items, thresholdPx) {
  if (items.length < 2) {
    return items.map((item) => ({ items: [item], x: item.cx, y: item.cy }));
  }
  const parent = _clusterParent;
  parent.length = items.length;
  for (let index = 0; index < items.length; index++) parent[index] = index;
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const unite = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
  };
  for (const bucket of _clusterUsed) bucket.length = 0;
  _clusterUsed.length = 0;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const cellX = Math.floor(item.x / thresholdPx);
    const cellY = Math.floor(item.y / thresholdPx);
    for (let x = cellX - 1; x <= cellX + 1; x++) {
      const row = _clusterRows.get(x);
      if (!row) continue;
      for (let y = cellY - 1; y <= cellY + 1; y++) {
        const neighbors = row.get(y);
        if (!neighbors) continue;
        for (const otherIndex of neighbors) {
          const other = items[otherIndex];
          if (Math.abs(item.y - other.y) <= thresholdPx && Math.abs(item.x - other.x) <= thresholdPx) {
            unite(index, otherIndex);
          }
        }
      }
    }
    let row = _clusterRows.get(cellX);
    if (!row) {
      row = new Map();
      _clusterRows.set(cellX, row);
    }
    let bucket = row.get(cellY);
    if (!bucket) {
      bucket = [];
      row.set(cellY, bucket);
    }
    if (bucket.length === 0) _clusterUsed.push(bucket);
    bucket.push(index);
  }
  for (const group of _clusterGroups.values()) group.length = 0;
  _clusterGroups.clear();
  for (let index = 0; index < items.length; index++) {
    const root = find(index);
    let group = _clusterGroups.get(root);
    if (!group) {
      group = [];
      _clusterGroups.set(root, group);
    }
    group.push(items[index]);
  }
  const out = [];
  for (const clusterItems of _clusterGroups.values()) {
    if (!clusterItems.length) continue;
    let x = 0;
    let y = 0;
    for (const item of clusterItems) {
      x += item.cx;
      y += item.cy;
    }
    out.push({
      items: clusterItems.slice(),
      x: x / clusterItems.length,
      y: y / clusterItems.length
    });
  }
  return out;
}

// --- per-ship derived state ------------------------------------------------

export function shipHpState(ship) {
  const maxHp = Math.max(1, Math.ceil(ship.damageResist ?? 3));
  const damage = Math.max(0, Math.round(ship.damage ?? 0));
  const currentHp = Math.max(0, maxHp - damage);
  return { currentHp, maxHp, damage };
}

export function vlsLoadState(ship) {
  const used = Math.max(0, Math.round(usedCells(ship.loadout)));
  const cap = Math.max(1, Math.round(vlsCapacity(ship)));
  const fill = Math.max(0, Math.min(1, used / cap));
  return { used, cap, fill };
}

export function inventoryHpColor(ship) {
  const hp = shipHpState(ship);
  return remainingStockColor(hp.currentHp, hp.maxHp);
}

export function inventoryVlsColor(ship) {
  const vls = vlsLoadState(ship);
  return remainingStockColor(vls.used, vls.cap);
}

// One source of truth for every remaining-value readout in the force inventory
// and unit cards. Because the calculation only depends on current/baseline,
// custom units and future ammunition definitions inherit it automatically.
//   100%       -> white
//   50–<100%   -> green
//   25–<50%    -> yellow
//   >0–<25%    -> red
//   0          -> dark grey
export function remainingStockColor(count, baseline) {
  const c = Math.max(0, Number(count) || 0);
  if (c <= 0) return "#5c6369";
  const b = Math.max(0, Number(baseline) || 0);
  if (b <= 0) return "#f2f4f5";
  const frac = Math.min(1, c / b);
  if (frac >= 1) return "#f2f4f5";
  if (frac >= 0.5) return "#64b982";
  if (frac >= 0.25) return "#d6ad45";
  return "#c95757";
}

export function inventoryMissileColor(ship, missileId) {
  const baseline = Math.max(0, Math.round(ship?.baseLoadoutSnapshot?.[missileId] ?? 0));
  return remainingStockColor(displayCount(ship, missileId), baseline);
}

export function displayCount(ship, missileId) {
  const count = Number(ship?.loadout?.[missileId]);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.round(count));
}

export function commandPosture(sim, side) {
  return sim.commandState?.get(side) ?? {
    aggression: 0.5,
    advantage: 0,
    ownOffense: 0,
    ownVls: 0,
    ownPower: 0,
    enemyOffenseEstimate: 0,
    enemyVlsEstimate: 0,
    enemyPower: 0,
    targetBreadth: 1,
    raidDepth: 2
  };
}

// --- panel HTML builders ---------------------------------------------------

export function postureBar(side, posture) {
  const label = side === SIDE.BLUE ? "B" : "R";
  const pct = Math.round(posture.aggression * 100);
  const agg = t('status.agg');
  return `
    <span class="${side === SIDE.BLUE ? "blue" : "red"} posture-chip">
      ${label} ${agg}
      <span class="agg-meter ${side === SIDE.BLUE ? "blue" : "red"}"><i style="width:${pct}%"></i></span>
      <b>${pct}%</b>
    </span>
  `;
}

// Keep a UI-only ledger because the simulation compacts resolved missiles.
// Launches aimed at another missile are defensive and excluded from the
// offensive denominator; successful interceptor and CIWS events are hard kills.
function interceptionStats(sim) {
  const ledger = sim._uiInterceptionStats ||= {
    seen: new Set(),
    sides: {
      [SIDE.BLUE]: { launched: 0, intercepted: 0 },
      [SIDE.RED]: { launched: 0, intercepted: 0 }
    }
  };
  const events = Array.isArray(sim.events) ? sim.events : [];
  // The simulation keeps only the newest event records. Drop ledger keys for
  // compacted records as well, otherwise a long battle grows a second,
  // unbounded history even though sim.events itself is capped.
  const activeKeys = new Set(events.map((event) => (
    event && typeof event === "object" && event.id != null ? event.id : event
  )));
  for (const key of ledger.seen) {
    if (!activeKeys.has(key)) ledger.seen.delete(key);
  }
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const key = event.id != null ? event.id : event;
    if (ledger.seen.has(key)) continue;
    ledger.seen.add(key);
    const text = String(event.text || "");
    const side = event.side === SIDE.RED || event.side === SIDE.BLUE ? event.side : null;
    if (!side) continue;
    if (/ launched /.test(text) && !/ queued /.test(text)) {
      const target = text.split(" at ").pop().replace(/\.+$/, "");
      const isMissileTarget = Object.entries(MISSILES).some(([id, spec]) => (
        id === target || spec.shortLabel === target
      ));
      if (!isMissileTarget) ledger.sides[side].launched++;
    }
    if (/intercepted incoming|CIWS destroyed incoming/i.test(text)) {
      ledger.sides[side].intercepted++;
    }
  }
  return ledger.sides;
}

export function battleStatusState(sim, counts = null) {
  const c = counts ?? battleSummaryCounts(sim);
  const intercepts = interceptionStats(sim);
  const state = {};
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const prefix = side === SIDE.BLUE ? "blue" : "red";
    const posture = commandPosture(sim, side);
    const ships = c[`${prefix}Ships`];
    const hp = c[`${prefix}Hp`];
    const hpMax = c[`${prefix}HpMax`];
    const antiShip = c[`${prefix}AntiShip`];
    const antiAir = c[`${prefix}AntiAir`];
    // An empty force is not damaged: keep its overview meter visually full
    // until the first unit exists and supplies a real denominator.
    const hpPct = hpMax ? Math.round(hp / hpMax * 100) : 100;
    const offensePct = Math.round((posture.aggression ?? 0.5) * 100);
    const enemySide = side === SIDE.BLUE ? SIDE.RED : SIDE.BLUE;
    const enemyOffensive = intercepts[enemySide]?.launched ?? 0;
    const interceptionRate = enemyOffensive
      ? Math.round((intercepts[side]?.intercepted ?? 0) / enemyOffensive * 100)
      : 0;
    state[prefix] = {
      units: { value: String(ships), pct: null },
      hp: { value: `${hp}/${hpMax}`, pct: hpPct },
      asuw: { value: String(antiShip), pct: null },
      aaw: { value: String(antiAir), pct: null },
      intercept: { value: `${interceptionRate}%`, pct: interceptionRate },
      offense: { value: `${offensePct}%`, pct: offensePct }
    };
  }
  return state;
}

export function renderBattleStatus(sim, counts = null) {
  const state = battleStatusState(sim, counts);
  const force = (side, label) => {
    const prefix = side === SIDE.BLUE ? "blue" : "red";
    const values = state[prefix];
    const stat = (className, name, value, pct = null) => `<span class="summary-stat ${className}">
      <small>${Array.isArray(name) ? name.map((line) => `<span>${line}</span>`).join("") : name}</small><b>${value}</b>${pct == null ? "" : `<span class="mini-meter"><i style="width:${pct}%"></i></span>`}
    </span>`;
    return `<div class="force-summary ${prefix}">
      <span class="force-side" aria-label="${label}"><b aria-hidden="true"></b></span>
      ${stat("units", "存活目标", values.units.value)}
      ${stat("hp", "总生命", values.hp.value, values.hp.pct)}
      ${stat("asuw", "在空反舰", values.asuw.value)}
      ${stat("aaw", "在空防空", values.aaw.value)}
      ${stat("intercept", "拦截率", values.intercept.value, values.intercept.pct)}
      ${stat("offense", "攻势", values.offense.value, values.offense.pct)}
    </div>`;
  };
  return `${force(SIDE.BLUE, "蓝")}${force(SIDE.RED, "红")}`;
}

// Column header for an inventory sub-table. Naval ("sea") and ground tables
// expose different fields. Each column carries a data-i18n key so the generic
// localization pass translates every head in the panel.
export function inventoryHeadHtml(domain = "sea", columns = VANILLA_COLUMNS) {
  if (domain === "ground") {
    return `<div class="inventory-head ground">`
      + `<span>单位</span><span>生命</span><span>雷达</span><span>防空弹药</span><span>打击弹药</span><span>模式</span>`
      + `</div>`;
  }
  if (domain === "air") {
    return `<div class="inventory-head ground air">`
      + `<span>航空</span><span>编组</span><span>高度</span><span>燃料</span><span>防空弹药</span><span>打击弹药</span>`
      + `</div>`;
  }
  return `<div class="inventory-head naval">`
    + `<span>单位</span><span>生命</span><span>垂发</span><span>防空弹药</span><span>打击弹药</span><span>速度</span>`
    + `</div>`;
}

const INFO_ICON = `<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="8.5" fill="currentColor"/><path d="M10 9v5" fill="none" stroke="var(--panel-solid)" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.1" r="1" fill="var(--panel-solid)"/></svg>`;

export function inventoryDividerHtml() {
  return `<div class="inventory-divider" aria-hidden="true"></div>`;
}

export function shipDisplayName(ship, separator = "-") {
  const rawId = String(ship?.id ?? "");
  // Ids are `${prefix}-${seq}`. Prefer the class prefix (never contains "-") so
  // a mistaken hyphenated tag cannot corrupt the numeric suffix. Fall back to
  // the last "-" so custom tags like "G5-AA-12" still yield a useful label.
  const cls = SHIP_CLASSES[ship?.hull];
  const prefix = cls?.prefix ? String(cls.prefix) : null;
  let suffix;
  let idLabel;
  if (prefix && rawId.startsWith(`${prefix}-`)) {
    suffix = rawId.slice(prefix.length + 1);
    idLabel = prefix;
  } else {
    const dash = rawId.lastIndexOf("-");
    suffix = dash >= 0 ? rawId.slice(dash + 1) : rawId.replace(/^[A-Z]+/, "");
    idLabel = dash >= 0 ? rawId.slice(0, dash) : rawId.replace(/[-0-9].*$/, "");
  }
  // Vanilla hulls have a localized label (e.g. DDG -> 驱逐舰). Custom (modded)
  // hulls have no translation, so `t` returns the raw i18n key; fall back to
  // the user-chosen unit tag.
  const key = `ship.${(ship?.hull || "DDG").toLowerCase()}`;
  const localized = t(key);
  const label = localized === key
    ? (cls?.prefixZh || idLabel)
    : localized;
  return suffix ? `${label}${separator}${suffix}` : label;
}

// The roster already carries the class in the localized name. Repeating the
// hull code in front of it ("DDG 驱逐舰-2") wastes the narrow first column and
// makes aircraft names especially noisy, so list rows use one compact label.
export function unitListName(unit, displayNumber = null) {
  const name = shipDisplayName(unit, "·");
  if (displayNumber == null) return name;
  const separator = name.lastIndexOf("·");
  const base = separator >= 0 ? name.slice(0, separator) : name;
  return `${base}·${displayNumber}`;
}

export function inventoryRowHtml(ship, selected = false, columns = VANILLA_COLUMNS, displayNumber = null) {
  const state = inventoryRowState(ship);
  const name = unitListName(ship, displayNumber);
  return `
      <button class="inventory-row naval ${ship.side === SIDE.BLUE ? "blue" : "red"} ${ship.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${escapeHtml(ship.id)}">
        <span class="inventory-unit"><span class="inventory-info" data-info-ship="${escapeHtml(ship.id)}" role="button" tabindex="0" aria-label="查看单位详细信息">${INFO_ICON}</span><strong>${escapeHtml(name)}</strong></span>
        <span class="inventory-cell"><b><i data-inventory-hp style="color:${state.hpColor}">${state.hp}</i><i data-inventory-hp-cap class="inventory-denominator inventory-hp-denominator">/${state.hpMax}</i></b></span>
        <span class="inventory-cell"><b><i data-inventory-vls style="color:${state.vlsColor}">${state.vls}</i><i data-inventory-vls-cap class="inventory-denominator">/${state.vlsCap}</i></b></span>
        <span class="inventory-cell"><b data-inventory-aaw style="color:${state.aawColor}">${state.aaw}</b></span>
        <span class="inventory-cell"><b data-inventory-asuw style="color:${state.asuwColor}">${state.asuw}</b></span>
        <span class="inventory-cell"><b class="inventory-neutral" data-inventory-speed>${state.speedKts} kt</b></span>
      </button>
    `;
}

// Aggregate a unit's loadout into air-defence (AAW: anti_air + dual_role) and
// anti-surface (ASUW: anti_ship) totals, each paired with its baseline (from
// the unit's spawn-time loadout snapshot) so callers can color the aggregate
// by remaining-stock fraction exactly like an individual weapon column —
// custom (modded) weapons count via their `category`, not their id, so this
// needs no per-weapon or per-unit-type list to stay correct.
export function aawAsuwAggregate(unit) {
  let aaw = 0;
  let aawBase = 0;
  let asuw = 0;
  let asuwBase = 0;
  const snapshot = unit.baseLoadoutSnapshot || {};
  for (const id of Object.keys(unit.loadout || {})) {
    const spec = MISSILES[id];
    if (!spec) continue;
    const count = displayCount(unit, id);
    const base = Math.max(0, Math.round(snapshot[id] ?? 0));
    const supportsAirDefense = missileCanTarget(spec, "missile") || missileCanTarget(spec, "air");
    if (supportsAirDefense) { aaw += count; aawBase += base; }
    if (missileHasSurfaceTarget(spec) || missileCanTarget(spec, "subsurface")) {
      asuw += count;
      asuwBase += base;
    }
  }
  return { aaw, aawBase, asuw, asuwBase };
}

export function inventoryRowState(unit) {
  const hp = shipHpState(unit);
  const { aaw, aawBase, asuw, asuwBase } = aawAsuwAggregate(unit);
  const vls = vlsLoadState(unit);
  const speedKts = Math.max(0, Math.round((Number(unit.speed) || 0) / KNOT));
  const altitudeKm = Math.max(0, Math.round((Number(unit.altitudeM) || 0) / 100) / 10);
  const endurance = Math.max(0, Number(unit.enduranceS) || 0);
  const fuelS = Math.max(0, Number(unit.fuelS) || 0);
  const fuelPct = endurance > 0 ? Math.max(0, Math.min(100, Math.round((fuelS / endurance) * 100))) : 0;
  return {
    hp: hp.currentHp,
    hpMax: hp.maxHp,
    hpPct: hp.maxHp ? Math.round((hp.currentHp / hp.maxHp) * 100) : 0,
    hpColor: remainingStockColor(hp.currentHp, hp.maxHp),
    vls: vls.used,
    vlsCap: vls.cap,
    vlsColor: remainingStockColor(vls.used, vls.cap),
    aaw,
    aawColor: remainingStockColor(aaw, aawBase),
    asuw,
    asuwColor: remainingStockColor(asuw, asuwBase),
    airState: AIR_STATE_ABBR[unit.airState] ?? "MSN",
    speedKts,
    altitudeKm,
    fuelPct,
    fuelS
  };
}

// Inventory row for a ground emplacement: tag, HP, radar reach (nm), and the
// counts of air-defence (AAW) and anti-surface (ASUW) effectors it carries. A
// radar site shows no weapons; a SAM site shows AAW; a battery shows ASUW.
function groundRole(unit) {
  if (unit?.isAirfield || unit?.hull === "AFB") return "基地";
  if (unit?.hull === "EWR") return "预警";
  if (unit?.hull === "THAAD") return "反导";
  if (unit?.strikeSpecialist || unit?.hull === "CDB" || unit?.hull === "DEB") return "打击";
  if (unit?.hull === "SAM") return "防空";
  return "支援";
}

export function groundRowHtml(unit, selected = false, displayNumber = null) {
  const state = inventoryRowState(unit);
  const rdr = Math.round((unit.radarRangeM ?? 0) / NM);
  const name = unitListName(unit, displayNumber);
  return `
      <button class="inventory-row ground ${unit.side === SIDE.BLUE ? "blue" : "red"} ${unit.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${escapeHtml(unit.id)}">
        <span class="inventory-unit"><span class="inventory-info" data-info-ship="${escapeHtml(unit.id)}" role="button" tabindex="0" aria-label="查看单位详细信息">${INFO_ICON}</span><strong>${escapeHtml(name)}</strong></span>
        <span class="inventory-cell"><b><i data-inventory-hp style="color:${state.hpColor}">${state.hp}</i><i data-inventory-hp-cap class="inventory-denominator inventory-hp-denominator">/${state.hpMax}</i></b></span>
        <span class="inventory-cell"><b class="inventory-neutral">${rdr}</b></span>
        <span class="inventory-cell"><b data-inventory-aaw style="color:${state.aawColor}">${state.aaw}</b></span>
        <span class="inventory-cell"><b data-inventory-asuw style="color:${state.asuwColor}">${state.asuw}</b></span>
        <span class="inventory-cell"><b class="inventory-neutral">${groundRole(unit)}</b></span>
      </button>
    `;
}

// Inventory row for an aircraft squadron: tag, flight strength (alive/size),
// lifecycle state, and air-to-air / air-to-surface effector counts. HP state
// doubles as flight strength (the squadron's hit-point pool is its plane count).
const AIR_STATE_ABBR = { mission: "MSN", rtb: "RTB", rearming: "RRM" };
export function airRowHtml(unit, selected = false, displayNumber = null) {
  const state = inventoryRowState(unit);
  const name = unitListName(unit, displayNumber);
  return `
      <button class="inventory-row ground air ${unit.side === SIDE.BLUE ? "blue" : "red"} ${unit.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${escapeHtml(unit.id)}">
        <span class="inventory-unit"><span class="inventory-info" data-info-ship="${escapeHtml(unit.id)}" role="button" tabindex="0" aria-label="查看单位详细信息">${INFO_ICON}</span><strong>${escapeHtml(name)}</strong></span>
        <span class="inventory-cell"><b><i data-inventory-hp style="color:${state.hpColor}">${state.hp}</i><i data-inventory-hp-cap class="inventory-denominator inventory-hp-denominator">/${state.hpMax}</i></b></span>
        <span class="inventory-cell"><b class="inventory-neutral" data-inventory-altitude>${state.altitudeKm.toFixed(1)} km</b></span>
        <span class="inventory-cell"><b class="inventory-neutral" data-inventory-fuel>${state.fuelPct}%</b></span>
        <span class="inventory-cell"><b data-inventory-aaw style="color:${state.aawColor}">${state.aaw}</b></span>
        <span class="inventory-cell"><b data-inventory-asuw style="color:${state.asuwColor}">${state.asuw}</b></span>
      </button>
    `;
}

function infoMetric(label, value) {
  return `<span class="inventory-info-metric"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`;
}

function infoLoadout(unit) {
  const entries = Object.entries(unit?.loadout || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([id, count]) => `${MISSILES[id]?.shortLabel || id} ${Math.max(0, Math.round(Number(count)))}`);
  return entries.length ? entries.join(" · ") : "无";
}

function infoSubsystems(unit) {
  const labels = [
    ["radar", "雷达"], ["propulsion", "动力"], ["fireControl", "射控"],
    ["ciws", "近防"], ["cic", "战情"], ["sonar", "声呐"], ["electronicWarfare", "电侦"]
  ];
  return labels
    .filter(([key]) => Number.isFinite(unit?.subsystems?.[key]))
    .map(([key, label]) => `${label} ${Math.round(unit.subsystems[key] * 100)}%`)
    .join(" · ") || "无数据";
}

// Compact, quantitative hover card for the roster's info icon. It intentionally
// excludes coordinates, waypoints, and track geometry: those belong on the map
// and would make a hover card noisy rather than useful.
export function unitInfoPopoverHtml(unit, sim = null) {
  if (!unit) return "";
  const state = inventoryRowState(unit);
  const title = unitListName(unit);
  const rows = [infoMetric("生命", `${state.hp}/${state.hpMax}`)];
  if (unit.domain === "air") {
    const base = sim?.ships?.find((candidate) => candidate.id === unit.homeBaseId);
    rows.push(
      infoMetric("编组", `${state.hp}/${state.hpMax}`),
      infoMetric("高度", `${state.altitudeKm.toFixed(1)} km`),
      infoMetric("速度", `${state.speedKts} kt`),
      infoMetric("燃料", `${state.fuelPct}% (${Math.round(state.fuelS)} s)`),
      infoMetric("状态", AIR_STATE_ABBR[unit.airState] ?? "MSN"),
      infoMetric("基地", base ? unitListName(base) : "未指定"),
      infoMetric("诱饵", `${Math.max(0, Math.round(unit.flares ?? 0))}/${Math.max(0, Math.round(unit.flaresMax ?? 0))}`),
      infoMetric("弹药", infoLoadout(unit))
    );
  } else if (unit.domain === "subsurface") {
    rows.push(
      infoMetric("速度", `${state.speedKts} kt`),
      infoMetric("深度", `${Math.round(unit.depthM ?? 0)} m`),
      infoMetric("垂发", `${state.vls}/${state.vlsCap}`),
      infoMetric("弹药", infoLoadout(unit)),
      infoMetric("子系统", infoSubsystems(unit))
    );
  } else if (unit.isFixed || unit.domain === "ground") {
    rows.push(
      infoMetric("雷达", `${Math.round((unit.radarRangeM ?? 0) / NM)} nm`),
      infoMetric("防空弹药", `${state.aaw}`),
      infoMetric("打击弹药", `${state.asuw}`),
      infoMetric("弹药", infoLoadout(unit)),
      infoMetric("子系统", infoSubsystems(unit))
    );
  } else {
    rows.push(
      infoMetric("速度", `${state.speedKts} kt`),
      infoMetric("雷达", `${Math.round((unit.radarRangeM ?? 0) / NM)} nm`),
      infoMetric("垂发", `${state.vls}/${state.vlsCap}`),
      infoMetric("防空弹药", `${state.aaw}`),
      infoMetric("打击弹药", `${state.asuw}`),
      infoMetric("弹药", infoLoadout(unit)),
      infoMetric("子系统", infoSubsystems(unit))
    );
  }
  return `<div class="inventory-info-card" style="--unit-accent:${sideColor(unit.side)}">
    <div class="inventory-info-heading"><b>${escapeHtml(title)}</b><small>${unit.alive ? "在线" : "失效"}</small></div>
    <div class="inventory-info-grid">${rows.join("")}</div>
  </div>`;
}

// Build the full force inventory markup. Units are grouped by faction (BLUE
// then RED), and within each faction split into a naval sub-table and a ground
// sub-table — each with its own column header — so sea and ground assets read
// as distinct rosters. A divider separates the two factions.
export function inventoryHtml(orderedShips, isSelected = () => false) {
  const out = [];
  // Weapon columns are computed across all naval units (both sides) so the two
  // sub-tables stay aligned and a deployed custom weapon shows everywhere.
  const columns = weaponColumns(orderedShips.filter((unit) => !isGroundUnit(unit) && !isAirUnit(unit)));
  let factionEmitted = false;
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const sideUnits = orderedShips.filter((unit) => unit.side === side);
    if (!sideUnits.length) continue;
    if (factionEmitted) out.push(inventoryDividerHtml());
    factionEmitted = true;
    const sea = sideUnits.filter((unit) => !isGroundUnit(unit) && !isAirUnit(unit));
    const ground = sideUnits.filter((unit) => isGroundUnit(unit));
    const air = sideUnits.filter((unit) => isAirUnit(unit));
    const rosterNumbers = new Map();
    const categoryCounts = new Map();
    for (const unit of sideUnits) {
      const category = unit.hull || unit.domain || "unit";
      const next = (categoryCounts.get(category) || 0) + 1;
      categoryCounts.set(category, next);
      rosterNumbers.set(unit.id, next);
    }
    if (sea.length) {
      out.push(inventoryHeadHtml("sea", columns));
      for (const unit of sea) out.push(inventoryRowHtml(unit, isSelected(unit.id), columns, rosterNumbers.get(unit.id)));
    }
    if (ground.length) {
      out.push(inventoryHeadHtml("ground"));
      for (const unit of ground) out.push(groundRowHtml(unit, isSelected(unit.id), rosterNumbers.get(unit.id)));
    }
    if (air.length) {
      out.push(inventoryHeadHtml("air"));
      for (const unit of air) out.push(airRowHtml(unit, isSelected(unit.id), rosterNumbers.get(unit.id)));
    }
  }
  return out.join("");
}

// --- ship detail card (type-based, not per-unit) ----------------------------
// A selected unit's detail card is dispatched by TYPE (domain / isFixed), not
// hull name, so a custom Unit Workshop hull always gets the layout matching
// its declared capabilities without any editor-side configuration:
//   air     -> flight readouts (fuel, flares, LOAD, state, altitude)
//   ground  -> fixed-emplacement readouts (no propulsion; CIWS/FCS/LOAD only
//              if the unit actually has them)
//   (else)  -> full naval subsystem readout
// A percentage bar's color is independent of remainingStockColor's five-state
// rule (that rule is for a single munition COUNT, e.g. AAW/ASUW); a bar shows
// fractional health/load with its own simpler 2-threshold scheme.
function detailSubBar(val, mode = "health") {
  const w = Math.round(Math.max(0, Math.min(1, val)) * 100);
  const c = mode === "load"
    ? (val >= 0.8 ? "#5a9" : val >= 0.4 ? "#f7b955" : "#f66")
    : (val > 0.6 ? "#5a9" : val > 0.3 ? "#f7b955" : "#f66");
  return `<span class="subsystem-meter"><i style="width:${w}%;background:${c}"></i></span>`;
}
function detailRow(label, val, mode = "health") {
  return `<span>${label}</span>${detailSubBar(val, mode)}<b>${Math.round(Math.max(0, Math.min(1, val)) * 100)}%</b>`;
}
function detailTextRow(label, value) {
  return `<span>${label}</span><b style="grid-column:2/4;text-align:right">${value}</b>`;
}
// A single munition-category count, colored by the same universal
// remaining-stock rule as the Force Inventory panel so a card and the
// inventory row always agree.
function detailCountRow(label, value, base) {
  return `<span>${label}</span><b style="grid-column:2/4;text-align:right;color:${remainingStockColor(value, base)}">${value > 0 ? value : "·"}</b>`;
}

// Aircraft squadrons have no ship subsystems — show flight-relevant readouts
// (surviving aircraft, fuel, flares, lifecycle state, altitude) plus a LOAD
// bar standing in for VLS (total munitions vs. the squadron's rearmed
// baseline — vlsCells is sized to exactly fit that baseline, see ships.js)
// and the AAW/ASUW breakdown colored by remaining stock.
function aircraftDetailCardHtml(s, cardWidth) {
  const color = sideColor(s.side);
  const ac = aliveAircraftCount(s);
  const size = squadronSize(s);
  const fuelFrac = s.enduranceS ? (s.fuelS ?? 0) / s.enduranceS : 0;
  const flareFrac = s.flaresMax ? (s.flares ?? 0) / s.flaresMax : 0;
  const radarDecoyFrac = s.radarDecoysMax ? (s.radarDecoys ?? 0) / s.radarDecoysMax : 0;
  const vls = vlsLoadState(s);
  const { aaw, aawBase, asuw, asuwBase } = aawAsuwAggregate(s);
  const state = ({ mission: "MSN", rtb: "RTB", rearming: "RRM" })[s.airState] ?? "MSN";
  return `<div class="ship-detail-card" style="--ship-accent:${color};--ship-card-width:${cardWidth}px">
    <div class="ship-detail-heading">
      <b>${escapeHtml(shipDisplayName(s, ""))}</b>
      <span style="color:${ac < size ? "#f7b955" : ""}">${t("detail.ac")} ${ac}/${size}</span>
    </div>
    <div class="ship-detail-grid">
      ${detailRow(t("detail.fuel"), fuelFrac, "load")}
      ${detailRow(t("detail.flares"), flareFrac, "load")}
      ${s.radarDecoysMax ? detailRow(t("detail.decoy"), radarDecoyFrac, "load") : ""}
      ${s.jammerStrength > 0 ? detailTextRow(t("detail.jam"), s.jammerActive ? "ON" : "EMCON") : ""}
      ${detailRow(t("detail.load"), vls.fill, "load")}
      ${detailTextRow(t("detail.state"), state + (s.evading ? " !" : ""))}
      ${detailTextRow(t("detail.alt"), `${((s.altitudeM ?? 0) / 1000).toFixed(1)} km`)}
      ${aawBase > 0 ? detailCountRow(t("detail.aaw"), aaw, aawBase) : ""}
      ${asuwBase > 0 ? detailCountRow(t("detail.asuw"), asuw, asuwBase) : ""}
    </div>
  </div>`;
}

// Fixed ground emplacements: no propulsion (never move) and, currently, no
// CIWS on any vanilla site, so both are dropped rather than shown as an
// always-100%/always-N/A bar. FCS and the LOAD bar only appear for an armed
// site (EWR/AFB carry no weapons at all); AAW/ASUW rows only appear for the
// category the site actually carries — all driven by the unit's own declared
// capability (ciwsCount, loadout), never by hull name, so a custom ground
// unit gets the right layout automatically.
function groundDetailCardHtml(s, cardWidth) {
  const color = sideColor(s.side);
  const hp = shipHpState(s);
  const rdr = s.subsystems?.radar ?? 1.0;
  const cic = s.subsystems?.cic ?? 1.0;
  const fc = s.subsystems?.fireControl ?? 1.0;
  const ciws = s.subsystems?.ciws ?? 1.0;
  const vls = vlsLoadState(s);
  const armed = Object.keys(s.baseLoadoutSnapshot || {}).length > 0;
  const { aaw, aawBase, asuw, asuwBase } = aawAsuwAggregate(s);
  return `<div class="ship-detail-card" style="--ship-accent:${color};--ship-card-width:${cardWidth}px">
    <div class="ship-detail-heading">
      <b>${escapeHtml(shipDisplayName(s, ""))}</b>
      <span style="color:${hp.currentHp < hp.maxHp ? "#f7b955" : ""}">HP ${hp.currentHp}/${hp.maxHp}</span>
    </div>
    <div class="ship-detail-grid">
      ${detailRow(t("detail.radar"), rdr)}
      ${detailRow(t("detail.cic"), cic)}
      ${armed ? detailRow(t("detail.fcs"), fc) : ""}
      ${(s.ciwsCount ?? 0) > 0 ? detailRow(t("detail.ciws"), ciws) : ""}
      ${armed ? detailRow(t("detail.load"), vls.fill, "load") : ""}
      ${aawBase > 0 ? detailCountRow(t("detail.aaw"), aaw, aawBase) : ""}
      ${asuwBase > 0 ? detailCountRow(t("detail.asuw"), asuw, asuwBase) : ""}
    </div>
  </div>`;
}

// Naval hulls: full subsystem readout (radar, propulsion, VLS load, fire
// control, CIWS, CIC).
function navalDetailCardHtml(s, cardWidth) {
  const rdr = s.subsystems?.radar ?? 1.0;
  const prop = s.subsystems?.propulsion ?? 1.0;
  const fc = s.subsystems?.fireControl ?? 1.0;
  const ciws = s.subsystems?.ciws ?? 1.0;
  const cic = s.subsystems?.cic ?? 1.0;
  const hp = shipHpState(s);
  const vls = vlsLoadState(s);
  const ew = s.subsystems?.electronicWarfare ?? 1.0;
  const radarDecoyFrac = s.radarDecoysMax ? (s.radarDecoys ?? 0) / s.radarDecoysMax : 0;
  const color = sideColor(s.side);
  return `<div class="ship-detail-card" style="--ship-accent:${color};--ship-card-width:${cardWidth}px">
    <div class="ship-detail-heading">
      <b>${escapeHtml(shipDisplayName(s, ""))}</b>
      <span style="color:${hp.currentHp < hp.maxHp ? "#f7b955" : ""}">HP ${hp.currentHp}/${hp.maxHp}</span>
    </div>
    <div class="ship-detail-grid">
      ${detailRow(t("detail.radar"), rdr)}
      ${detailRow(t("detail.prop"), prop)}
      ${detailRow(t("detail.vls"), vls.fill, "load")}
      ${detailRow(t("detail.fcs"), fc)}
      ${detailRow(t("detail.ciws"), ciws)}
      ${detailRow(t("detail.cic"), cic)}
      ${(s.esmRangeM > 0 || s.jammerStrength > 0) ? detailRow(t("detail.esm"), ew) : ""}
      ${s.radarDecoysMax ? detailRow(t("detail.decoy"), radarDecoyFrac, "load") : ""}
    </div>
  </div>`;
}

function submarineDetailCardHtml(s, cardWidth) {
  const hp = shipHpState(s);
  const prop = s.subsystems?.propulsion ?? 1.0;
  const fc = s.subsystems?.fireControl ?? 1.0;
  const cic = s.subsystems?.cic ?? 1.0;
  const vls = vlsLoadState(s);
  const sonar = s.subsystems?.sonar ?? 1;
  const ew = s.subsystems?.electronicWarfare ?? 1;
  const decoyBase = s.acousticDecoysMax ?? s.acousticDecoys ?? 0;
  const decoys = decoyBase > 0 ? (s.acousticDecoys ?? 0) / decoyBase : 0;
  const color = sideColor(s.side);
  return `<div class="ship-detail-card" style="--ship-accent:${color};--ship-card-width:${cardWidth}px">
    <div class="ship-detail-heading">
      <b>${escapeHtml(shipDisplayName(s, ""))}</b>
      <span style="color:${hp.currentHp < hp.maxHp ? "#f7b955" : ""}">HP ${hp.currentHp}/${hp.maxHp}</span>
    </div>
    <div class="ship-detail-grid">
      ${detailTextRow(t("detail.depth"), `${Math.round(s.depthM ?? 0)} m`)}
      ${detailRow(t("detail.sonar"), sonar)}
      ${s.esmRangeM > 0 ? detailRow(t("detail.esm"), ew) : ""}
      ${detailRow(t("detail.prop"), prop)}
      ${detailRow(t("detail.vls"), vls.fill, "load")}
      ${detailRow(t("detail.fcs"), fc)}
      ${detailRow(t("detail.cic"), cic)}
      ${detailRow(t("detail.decoy"), decoys, "load")}
    </div>
  </div>`;
}

// Dispatch by unit TYPE (domain / isFixed), never by hull name.
export function shipDetailCardHtml(s, cardWidth = 120) {
  if (s.domain === "air") return aircraftDetailCardHtml(s, cardWidth);
  if (s.domain === "subsurface") return submarineDetailCardHtml(s, cardWidth);
  if (s.isFixed) return groundDetailCardHtml(s, cardWidth);
  return navalDetailCardHtml(s, cardWidth);
}
