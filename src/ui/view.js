// Pure presentation helpers for the tactical UI.
//
// Everything here is free of canvas/DOM access and global state: coordinate
// transforms take an explicit camera + viewport, and the panel builders return
// HTML strings. This keeps the view logic unit-testable (see tests/ui.test.mjs)
// and is the first step of separating rendering from `src/app.js`.

import {
  SIDE, NM, MISSILES, SHIP_CLASSES, usedCells, vlsCapacity, battleSummaryCounts,
  aliveAircraftCount, squadronSize, missileHasSurfaceTarget
} from "../sim.js";
import { t, getLang } from "./lang.js";

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

// Canonical naval weapon columns, kept in this order when in use. Custom
// (modded) missiles are appended after these so a new weapon adds a column.
const VANILLA_COLUMNS = ["SM-2MR", "SM-6", "ESSM", "MaritimeStrike", "TomahawkBlockV"];

// The weapon columns to show: every missile actually carried (count > 0) by the
// given naval units — vanilla first (canonical order), then custom (sorted). So
// a column appears automatically when a weapon is deployed, vanilla or modded.
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

// Fixed-width naval grid: ship/HP/VLS keep their size and the weapon columns
// share the remainder, compressing as more are added (minmax floor of 0).
function navalGridStyle(weaponCount) {
  const weapons = weaponCount > 0 ? ` repeat(${weaponCount}, minmax(0, 0.66fr))` : "";
  return `grid-template-columns: minmax(42px,1.25fr) minmax(25px,0.72fr) minmax(45px,1fr)${weapons}`;
}

// --- colors ----------------------------------------------------------------

export function sideColor(side) {
  return side === SIDE.BLUE ? "#65a7ff" : "#ff6b63";
}

export function sideSoftColor(side) {
  return side === SIDE.BLUE ? "rgba(101,167,255,.18)" : "rgba(255,107,99,.16)";
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

export function clusterProximityLabels(items, thresholdPx) {
  if (items.length < 2) return items.map((item) => ({ items: [item], x: item.cx, y: item.cy }));
  const parent = items.map((_, index) => index);
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
  const cells = new Map();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const cellX = Math.floor(item.x / thresholdPx);
    const cellY = Math.floor(item.y / thresholdPx);
    for (let x = cellX - 1; x <= cellX + 1; x++) {
      for (let y = cellY - 1; y <= cellY + 1; y++) {
        for (const otherIndex of cells.get(`${x},${y}`) ?? []) {
          const other = items[otherIndex];
          if (Math.abs(item.y - other.y) <= thresholdPx && Math.abs(item.x - other.x) <= thresholdPx) unite(index, otherIndex);
        }
      }
    }
    const key = `${cellX},${cellY}`;
    const bucket = cells.get(key) ?? [];
    bucket.push(index);
    cells.set(key, bucket);
  }
  const grouped = new Map();
  for (let index = 0; index < items.length; index++) {
    const root = find(index);
    const group = grouped.get(root) ?? [];
    group.push(items[index]);
    grouped.set(root, group);
  }
  return [...grouped.values()].map((clusterItems) => {
    let x = 0;
    let y = 0;
    for (const item of clusterItems) {
      x += item.cx;
      y += item.cy;
    }
    return { items: clusterItems, x: x / clusterItems.length, y: y / clusterItems.length };
  });
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
  if (hp.currentHp <= 0) return "#4e6972";
  if (hp.currentHp >= hp.maxHp) return "#5fd58c";
  return "#f7b955";
}

export function inventoryVlsColor(ship) {
  const vls = vlsLoadState(ship);
  if (vls.used <= 0) return "#4e6972";
  if (vls.fill > 2 / 3) return "#5fd58c";
  if (vls.fill > 1 / 3) return "#f7b955";
  return "#f28d4e";
}

// Universal remaining-stock color rule for any INDIVIDUAL munition count shown
// anywhere in the UI (a single weapon type's rounds left, or a same-category
// aggregate like a ground/air unit's AAW or ASUW total) — deliberately the
// *opposite* scale from inventoryVlsColor (total-load "fuller is greener"):
// here full/plentiful is neutral white and the color only appears as a
// warning while stock runs low, ending at "empty" grey. Applies uniformly by
// construction (a percentage of `baseline`), so it needs no per-hull or
// per-unit-type special-casing — any custom weapon or modded unit gets
// correct coloring automatically.
//   > 67% of baseline -> white     (plenty left)
//   33-67% of baseline -> yellow  (getting low; inclusive of both edges)
//   < 33% of baseline -> red      (critical)
//   0                  -> grey    (empty)
// Literal 67/33 percentages (not the mathematical thirds 2/3 / 1/3, which
// round to 66.67/33.33 and would misclassify an exact 67 or 33 reading).
const STOCK_HIGH_FRAC = 0.67;
const STOCK_LOW_FRAC = 0.33;
export function remainingStockColor(count, baseline) {
  const c = Math.max(0, count);
  if (c <= 0) return "#4e6972";
  const b = Math.max(0, baseline);
  if (b <= 0) return "#ffffff";
  const frac = c / b;
  if (frac > STOCK_HIGH_FRAC) return "#ffffff";
  if (frac >= STOCK_LOW_FRAC) return "#f7b955";
  return "#ff6b63";
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
  return `
    <span class="${side === SIDE.BLUE ? "blue" : "red"} posture-chip">
      ${label} AGG
      <span class="agg-meter ${side === SIDE.BLUE ? "blue" : "red"}"><i style="width:${pct}%"></i></span>
      <b>${pct}%</b>
    </span>
  `;
}

export function renderBattleStatus(sim, counts = null) {
  const c = counts ?? battleSummaryCounts(sim);
  const bluePosture = commandPosture(sim, SIDE.BLUE);
  const redPosture = commandPosture(sim, SIDE.RED);
  return `
    <span class="red">R ${c.redShips}</span>
    <span class="blue">B ${c.blueShips}</span>
    <span class="red">R HP ${c.redHp}/${c.redHpMax}</span>
    <span class="blue">B HP ${c.blueHp}/${c.blueHpMax}</span>
    <span class="red">R AS ${c.redAntiShip}</span>
    <span class="red">R AA ${c.redAntiAir}</span>
    <span class="blue">B AS ${c.blueAntiShip}</span>
    <span class="blue">B AA ${c.blueAntiAir}</span>
    ${postureBar(SIDE.RED, redPosture)}
    ${postureBar(SIDE.BLUE, bluePosture)}
  `;
}

// Column header for an inventory sub-table. Naval ("sea") and ground tables
// expose different fields. Each column carries a data-i18n key so the generic
// localization pass translates every head in the panel.
export function inventoryHeadHtml(domain = "sea", columns = VANILLA_COLUMNS) {
  if (domain === "ground") {
    return `<div class="inventory-head ground">`
      + `<span data-i18n="inv.unit">UNIT</span>`
      + `<span data-i18n="inv.hp">HP</span>`
      + `<span data-i18n="inv.rdr">RDR</span>`
      + `<span data-i18n="inv.aaw">AAW</span>`
      + `<span data-i18n="inv.asuw">ASUW</span>`
      + `</div>`;
  }
  if (domain === "air") {
    // Reuses the 5-column ground grid; columns: unit, flight strength, state,
    // air-to-air count, air-to-surface count.
    return `<div class="inventory-head ground air">`
      + `<span data-i18n="inv.unit">UNIT</span>`
      + `<span data-i18n="inv.ac">A/C</span>`
      + `<span data-i18n="inv.state">STATE</span>`
      + `<span data-i18n="inv.aaw">AAW</span>`
      + `<span data-i18n="inv.asuw">ASUW</span>`
      + `</div>`;
  }
  // Weapon headers use the missile short label directly (military nomenclature,
  // not translated); the full id is on the title for hover/identification.
  const weaponHeads = columns
    .map((id) => `<span class="inv-wpn" title="${escapeHtml(id)}">${escapeHtml(MISSILES[id]?.shortLabel ?? id)}</span>`)
    .join("");
  return `<div class="inventory-head" style="${navalGridStyle(columns.length)}">`
    + `<span data-i18n="inv.ship">SHIP</span><span data-i18n="inv.hp">HP</span><span data-i18n="inv.vls">VLS</span>`
    + weaponHeads
    + `</div>`;
}

export function inventoryDividerHtml() {
  return `<div class="inventory-divider" aria-hidden="true"></div>`;
}

export function shipDisplayName(ship, separator = "-") {
  const rawId = String(ship?.id ?? "");
  const dash = rawId.indexOf("-");
  const suffix = dash >= 0 ? rawId.slice(dash + 1) : rawId.replace(/^[A-Z]+/, "");
  // Vanilla hulls have a localized label (e.g. DDG -> 驱逐舰). Custom (modded)
  // hulls have no translation, so `hullLabel` returns the raw i18n key; fall back
  // to the user-chosen unit tag, which is the prefix already embedded in the id.
  const cls = SHIP_CLASSES[ship?.hull];
  const key = `ship.${(ship?.hull || "DDG").toLowerCase()}`;
  const localized = t(key);
  const label = localized === key
    ? (getLang() === "zh" && cls?.prefixZh ? cls.prefixZh : (dash >= 0 ? rawId.slice(0, dash) : rawId.replace(/[-0-9].*$/, "")))
    : localized;
  return suffix ? `${label}${separator}${suffix}` : label;
}

export function inventoryRowHtml(ship, selected = false, columns = VANILLA_COLUMNS) {
  const hp = shipHpState(ship);
  const weaponCells = columns
    .map((id) => `<b style="color:${inventoryMissileColor(ship, id)}">${displayCount(ship, id)}</b>`)
    .join("");
  return `
      <button class="inventory-row ${ship.side === SIDE.BLUE ? "blue" : "red"} ${ship.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${escapeHtml(ship.id)}" style="${navalGridStyle(columns.length)}">
        <span>${escapeHtml(shipDisplayName(ship, "-"))}</span>
        <b style="color:${inventoryHpColor(ship)}">${hp.currentHp}/${hp.maxHp}</b>
        <b style="color:${inventoryVlsColor(ship)}">${Math.round(usedCells(ship.loadout))}/${ship.vlsCells ?? 96}</b>
        ${weaponCells}
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
    if (missileHasSurfaceTarget(spec)) { asuw += count; asuwBase += base; }
    else { aaw += count; aawBase += base; }
  }
  return { aaw, aawBase, asuw, asuwBase };
}

// Inventory row for a ground emplacement: tag, HP, radar reach (nm), and the
// counts of air-defence (AAW) and anti-surface (ASUW) effectors it carries. A
// radar site shows no weapons; a SAM site shows AAW; a battery shows ASUW.
export function groundRowHtml(unit, selected = false) {
  const hp = shipHpState(unit);
  const { aaw, aawBase, asuw, asuwBase } = aawAsuwAggregate(unit);
  const rdr = Math.round((unit.radarRangeM ?? 0) / NM);
  const cell = (value, base) => `<b style="color:${remainingStockColor(value, base)}">${value > 0 ? value : "·"}</b>`;
  return `
      <button class="inventory-row ground ${unit.side === SIDE.BLUE ? "blue" : "red"} ${unit.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${escapeHtml(unit.id)}">
        <span>${escapeHtml(shipDisplayName(unit, "-"))}</span>
        <b style="color:${inventoryHpColor(unit)}">${hp.currentHp}/${hp.maxHp}</b>
        <b>${rdr}</b>
        ${cell(aaw, aawBase)}
        ${cell(asuw, asuwBase)}
      </button>
    `;
}

// Inventory row for an aircraft squadron: tag, flight strength (alive/size),
// lifecycle state, and air-to-air / air-to-surface effector counts. HP state
// doubles as flight strength (the squadron's hit-point pool is its plane count).
const AIR_STATE_ABBR = { mission: "MSN", rtb: "RTB", rearming: "RRM" };
export function airRowHtml(unit, selected = false) {
  const hp = shipHpState(unit);
  const { aaw, aawBase, asuw, asuwBase } = aawAsuwAggregate(unit);
  const state = AIR_STATE_ABBR[unit.airState] ?? "MSN";
  const cell = (value, base) => `<b style="color:${remainingStockColor(value, base)}">${value > 0 ? value : "·"}</b>`;
  return `
      <button class="inventory-row ground air ${unit.side === SIDE.BLUE ? "blue" : "red"} ${unit.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${escapeHtml(unit.id)}">
        <span>${escapeHtml(shipDisplayName(unit, "-"))}</span>
        <b style="color:${inventoryHpColor(unit)}">${hp.currentHp}/${hp.maxHp}</b>
        <b>${state}</b>
        ${cell(aaw, aawBase)}
        ${cell(asuw, asuwBase)}
      </button>
    `;
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
    if (sea.length) {
      out.push(inventoryHeadHtml("sea", columns));
      for (const unit of sea) out.push(inventoryRowHtml(unit, isSelected(unit.id), columns));
    }
    if (ground.length) {
      out.push(inventoryHeadHtml("ground"));
      for (const unit of ground) out.push(groundRowHtml(unit, isSelected(unit.id)));
    }
    if (air.length) {
      out.push(inventoryHeadHtml("air"));
      for (const unit of air) out.push(airRowHtml(unit, isSelected(unit.id)));
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
// A percentage bar's color is independent of remainingStockColor's four-tier
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
    </div>
  </div>`;
}

// Dispatch by unit TYPE (domain / isFixed), never by hull name.
export function shipDetailCardHtml(s, cardWidth = 120) {
  if (s.domain === "air") return aircraftDetailCardHtml(s, cardWidth);
  if (s.isFixed) return groundDetailCardHtml(s, cardWidth);
  return navalDetailCardHtml(s, cardWidth);
}
