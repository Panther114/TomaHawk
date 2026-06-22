// Pure presentation helpers for the tactical UI.
//
// Everything here is free of canvas/DOM access and global state: coordinate
// transforms take an explicit camera + viewport, and the panel builders return
// HTML strings. This keeps the view logic unit-testable (see tests/ui.test.mjs)
// and is the first step of separating rendering from `src/app.js`.

import { SIDE, NM, defaultLoadout, usedCells, vlsCapacity, battleSummaryCounts } from "../sim.js";
import { t, hullLabel } from "./lang.js";

// A ground emplacement is a fixed, land-based unit; it gets its own inventory
// sub-table (different columns) and glyph rather than the naval ship layout.
export function isGroundUnit(unit) {
  return unit?.domain === "ground" || unit?.isFixed === true;
}

const baselineLoadoutCache = new Map();

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

export function inventoryMissileColor(ship, missileId) {
  const hull = ship?.hull ?? "DDG";
  let baselineLoadout = baselineLoadoutCache.get(hull);
  if (!baselineLoadout) {
    baselineLoadout = defaultLoadout(hull);
    baselineLoadoutCache.set(hull, baselineLoadout);
  }
  const baseline = Math.max(0, Math.round(baselineLoadout[missileId] ?? 0));
  const count = displayCount(ship, missileId);
  if (count <= 0) return "#4e6972";
  if (baseline <= 0) return "#ffffff";
  return count > baseline / 3 ? "#ffffff" : "#f7b955";
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
export function inventoryHeadHtml(domain = "sea") {
  if (domain === "ground") {
    return `<div class="inventory-head ground">`
      + `<span data-i18n="inv.unit">UNIT</span>`
      + `<span data-i18n="inv.hp">HP</span>`
      + `<span data-i18n="inv.rdr">RDR</span>`
      + `<span data-i18n="inv.aaw">AAW</span>`
      + `<span data-i18n="inv.asuw">ASUW</span>`
      + `</div>`;
  }
  return `<div class="inventory-head">`
    + `<span data-i18n="inv.ship">SHIP</span><span data-i18n="inv.hp">HP</span><span data-i18n="inv.vls">VLS</span>`
    + `<span data-i18n="inv.sm2">SM2</span><span data-i18n="inv.sm6">SM6</span><span data-i18n="inv.essm">ESSM</span>`
    + `<span data-i18n="inv.mstk">MSTK</span><span data-i18n="inv.tlam">TLAM</span>`
    + `</div>`;
}

export function inventoryDividerHtml() {
  return `<div class="inventory-divider" aria-hidden="true"></div>`;
}

export function shipDisplayName(ship, separator = "-") {
  const hull = hullLabel(ship?.hull);
  const rawId = String(ship?.id ?? "");
  const suffix = rawId.includes("-")
    ? rawId.slice(rawId.indexOf("-") + 1)
    : rawId.replace(/^[A-Z]+/, "");
  return suffix ? `${hull}${separator}${suffix}` : hull;
}

export function inventoryRowHtml(ship, selected = false) {
  const hp = shipHpState(ship);
  return `
      <button class="inventory-row ${ship.side.toLowerCase()} ${ship.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${ship.id}">
        <span>${shipDisplayName(ship, "-")}</span>
        <b style="color:${inventoryHpColor(ship)}">${hp.currentHp}/${hp.maxHp}</b>
        <b style="color:${inventoryVlsColor(ship)}">${Math.round(usedCells(ship.loadout))}/${ship.vlsCells ?? 96}</b>
        <b style="color:${inventoryMissileColor(ship, "SM-2MR")}">${displayCount(ship, "SM-2MR")}</b>
        <b style="color:${inventoryMissileColor(ship, "SM-6")}">${displayCount(ship, "SM-6")}</b>
        <b style="color:${inventoryMissileColor(ship, "ESSM")}">${displayCount(ship, "ESSM")}</b>
        <b style="color:${inventoryMissileColor(ship, "MaritimeStrike")}">${displayCount(ship, "MaritimeStrike")}</b>
        <b style="color:${inventoryMissileColor(ship, "TomahawkBlockV")}">${displayCount(ship, "TomahawkBlockV")}</b>
      </button>
    `;
}

// Inventory row for a ground emplacement: tag, HP, radar reach (nm), and the
// counts of air-defence (AAW) and anti-surface (ASUW) effectors it carries. A
// radar site shows no weapons; a SAM site shows AAW; a battery shows ASUW.
export function groundRowHtml(unit, selected = false) {
  const hp = shipHpState(unit);
  const aaw = displayCount(unit, "SM-2MR") + displayCount(unit, "SM-6") + displayCount(unit, "ESSM");
  const asuw = displayCount(unit, "MaritimeStrike") + displayCount(unit, "TomahawkBlockV");
  const rdr = Math.round((unit.radarRangeM ?? 0) / NM);
  const cell = (value, color) => `<b style="color:${value > 0 ? color : "#4e6972"}">${value > 0 ? value : "·"}</b>`;
  return `
      <button class="inventory-row ground ${unit.side.toLowerCase()} ${unit.alive ? "" : "sunk"} ${selected ? "selected" : ""}" data-select-ship="${unit.id}">
        <span>${shipDisplayName(unit, "-")}</span>
        <b style="color:${inventoryHpColor(unit)}">${hp.currentHp}/${hp.maxHp}</b>
        <b>${rdr}</b>
        ${cell(aaw, "#5fd58c")}
        ${cell(asuw, "#f7e7a1")}
      </button>
    `;
}

// Build the full force inventory markup. Units are grouped by faction (BLUE
// then RED), and within each faction split into a naval sub-table and a ground
// sub-table — each with its own column header — so sea and ground assets read
// as distinct rosters. A divider separates the two factions.
export function inventoryHtml(orderedShips, isSelected = () => false) {
  const out = [];
  let factionEmitted = false;
  for (const side of [SIDE.BLUE, SIDE.RED]) {
    const sideUnits = orderedShips.filter((unit) => unit.side === side);
    if (!sideUnits.length) continue;
    if (factionEmitted) out.push(inventoryDividerHtml());
    factionEmitted = true;
    const sea = sideUnits.filter((unit) => !isGroundUnit(unit));
    const ground = sideUnits.filter((unit) => isGroundUnit(unit));
    if (sea.length) {
      out.push(inventoryHeadHtml("sea"));
      for (const unit of sea) out.push(inventoryRowHtml(unit, isSelected(unit.id)));
    }
    if (ground.length) {
      out.push(inventoryHeadHtml("ground"));
      for (const unit of ground) out.push(groundRowHtml(unit, isSelected(unit.id)));
    }
  }
  return out.join("");
}
