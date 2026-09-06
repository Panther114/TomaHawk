// Unit Workshop popup controller. Renders the unit list + a dense, schema-driven
// parameter form, and wires save / clone / export / delete / drag-in import.
// Edits live only in a working copy: closing the popup or switching units
// discards unsaved changes; Save is the only commit path. Built-in units are
// read-only (Clone to customize) and can never be deleted.

import { SCHEMAS, DEFAULTS, DEPLOYABLE_TYPES, validateUnit } from "./schema.js";
import { loadMods, saveMod, deleteMod, recordKey } from "./store.js";
import { unitId, isBuiltinUnit, makeUniqueShipId, availableAmmoIds, UNIT_KIND_DOMAIN } from "./registry.js";
import { MISSILES, usedCells } from "../sim.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const L = (label) => label?.zh ?? label?.en ?? "";

const KIND_LABEL = {
  ammo: { en: "Ammo", zh: "弹药" },
  naval: { en: "Naval", zh: "海上" },
  ground: { en: "Ground", zh: "陆基" },
  aircraft: { en: "Air", zh: "空中" }
};

export function createModEditor({ overlay, onChange, onOpenChange } = {}) {
  const listEl = overlay.querySelector("#mods-list");
  const detailEl = overlay.querySelector("#mods-detail");

  let units = [];
  let loaded = false;
  let selectedKey = null;
  let form = null;        // working copy of the selected/edited unit
  let isNew = false;      // form is an unsaved new unit
  let dirty = false;
  let open = false;
  let query = "";
  let kindFilter = "all";

  const findUnit = (key) => units.find((u) => recordKey(u) === key);
  const unitTag = (u) => u.prefixZh || u.prefix;
  const labelOf = (u) => (u.kind === "ammo" ? unitId(u) : `${unitTag(u)} · ${u.name}`);
  // Host callback must never break the editor's own flow (e.g. a render fault).
  const safeNotify = () => { try { onChange?.(); } catch (e) { console.warn("[mods] onChange failed", e); } };

  // --- list ----------------------------------------------------------------
  function matchesQuery(u) {
    if (kindFilter !== "all" && u.kind !== kindFilter) return false;
    if (kindFilter === "custom" && isBuiltinUnit(u)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return labelOf(u).toLowerCase().includes(q) || String(unitId(u)).toLowerCase().includes(q);
  }
  function renderList() {
    const groups = { ammo: [], naval: [], ground: [], aircraft: [] };
    for (const u of units) {
      if (!matchesQuery(u)) continue;
      (groups[u.kind] || groups.naval).push(u);
    }
    const customCount = units.filter((u) => !isBuiltinUnit(u)).length;
    const countChip = (kind, label) => {
      const n = kind === "all" ? units.length : kind === "custom" ? customCount : units.filter((u) => u.kind === kind).length;
      const active = kindFilter === kind ? " active" : "";
      return `<button class="mods-chip${active}" data-filter="${kind}">${esc(label)} ${n}</button>`;
    };
    const section = (kind) => {
      const items = groups[kind].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
      if (!items.length) return "";
      const rows = items.map((u) => {
        const key = recordKey(u);
        const builtin = isBuiltinUnit(u);
        const lock = builtin ? `<span class="mods-lock" title="内置">锁</span>` : `<span class="mods-custom" title="自创">改</span>`;
        const sel = key === selectedKey ? " selected" : "";
        const sub = u.kind === "ammo" ? esc((u.targets || []).join("/")) : esc(u.prefixZh || u.prefix || "");
        return `<button class="mods-item${sel}" data-key="${esc(key)}" title="${esc(labelOf(u))}">${lock}<span class="mods-item-main"><span class="mods-item-name">${esc(labelOf(u))}</span><span class="mods-item-sub">${sub}</span></span></button>`;
      }).join("");
      return `<div class="mods-group"><div class="mods-group-h">${esc(KIND_LABEL[kind].zh)} · ${items.length}</div>${rows}</div>`;
    };
    const total = groups.naval.length + groups.ground.length + groups.aircraft.length + groups.ammo.length;
    listEl.innerHTML = `
      <div class="mods-searchbar"><input type="search" data-search placeholder="搜索名称 / 代号" value="${esc(query)}" aria-label="搜索单位" /></div>
      <div class="mods-chips">${countChip("all", "全部")}${countChip("naval", "海上")}${countChip("ground", "陆基")}${countChip("aircraft", "空中")}${countChip("ammo", "弹药")}${countChip("custom", "自创")}</div>
      <div class="mods-newbar">
        <button class="mods-new" data-new="naval">+ ${esc(L(KIND_LABEL.naval))}</button>
        <button class="mods-new" data-new="ground">+ ${esc(L(KIND_LABEL.ground))}</button>
        <button class="mods-new" data-new="aircraft">+ ${esc(L(KIND_LABEL.aircraft))}</button>
        <button class="mods-new" data-new="ammo">+ ${esc(L(KIND_LABEL.ammo))}</button>
      </div>
      ${section("naval")}${section("ground")}${section("aircraft")}${section("ammo")}
      ${total === 0 ? `<div class="mods-empty">无匹配 — 清空搜索或新建单位。</div>` : ""}`;
    const searchInput = listEl.querySelector("[data-search]");
    if (searchInput && document.activeElement?.dataset?.search !== undefined) {
      searchInput.focus();
      const len = searchInput.value.length;
      try { searchInput.setSelectionRange(len, len); } catch {}
    }
  }

  // --- detail form ---------------------------------------------------------
  function fieldHtml(f, locked) {
    const v = form[f.key];
    const dis = locked ? " disabled" : "";
    let input;
    if (f.type === "number") {
      const attrs = `${f.step != null ? ` step="${f.step}"` : ""}${f.min != null ? ` min="${f.min}"` : ""}${f.max != null ? ` max="${f.max}"` : ""}`;
      input = `<input type="number" data-field="${f.key}" value="${esc(v)}"${attrs}${dis} />`;
    } else if (f.type === "select") {
      const opts = f.options.map((o) => `<option value="${esc(o.value)}"${o.value === v ? " selected" : ""}>${esc(L(o.label))}</option>`).join("");
      input = `<select data-field="${f.key}"${dis}>${opts}</select>`;
    } else if (f.type === "multicheck") {
      const values = new Set(Array.isArray(v) ? v : []);
      input = `<div class="mods-checkgrid">${f.options.map((o) =>
        `<label class="mods-check"><input type="checkbox" data-multi-field="${esc(f.key)}" value="${esc(o.value)}"${values.has(o.value) ? " checked" : ""}${dis} /><span class="mods-check-ui" aria-hidden="true"></span><span class="mods-check-text">${esc(L(o.label))}</span></label>`
      ).join("")}</div>`;
    } else if (f.type === "checkbox") {
      return `<label class="mods-field mods-field-check"><span class="mods-check"><input type="checkbox" data-field="${f.key}"${v ? " checked" : ""}${dis} /><span class="mods-check-ui" aria-hidden="true"></span><span class="mods-check-text">${esc(L(f.label))}${f.unit ? ` <span class="mods-uhint">${esc(f.unit)}</span>` : ""}</span></span>${f.help ? `<span class="mods-help">${esc(L(f.help))}</span>` : ""}</label>`;
    } else {
      input = `<input type="text" data-field="${f.key}" value="${esc(v)}"${f.maxlength ? ` maxlength="${f.maxlength}"` : ""}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${dis} />`;
    }
    const hint = f.unit ? ` <span class="mods-uhint">${esc(f.unit)}</span>` : "";
    const help = f.help ? `<span class="mods-help">${esc(L(f.help))}</span>` : "";
    return `<label class="mods-field"><span class="mods-flabel">${esc(L(f.label))}${hint}</span>${input}${help}</label>`;
  }

  function loadoutHtml(locked) {
    const lo = form.baseLoadout || {};
    const rows = Object.entries(lo).map(([id, count]) => {
      const label = MISSILES[id]?.shortLabel ?? id;
      const rm = locked ? "" : `<button class="mods-lo-rm" data-loadout-remove="${esc(id)}" title="移除" aria-label="移除${esc(id)}">×</button>`;
      return `<div class="mods-lo-row"><span class="mods-lo-name" title="${esc(id)}">${esc(label)}</span>
        <input type="number" min="0" step="1" data-loadout-id="${esc(id)}" value="${esc(count)}" aria-label="${esc(id)}数量"${locked ? " disabled" : ""} />${rm}</div>`;
    }).join("");
    // Only offer ammo this unit's platform type can actually carry (see
    // missileAllowedForDomain) -- this is the fix for a naval/ground/aircraft
    // unit being able to pick up any registered weapon regardless of whether
    // it makes any sense for that platform (e.g. an aircraft equipping ESSM).
    const avail = availableAmmoIds(UNIT_KIND_DOMAIN[form.kind]).filter((id) => !(id in lo));
    const addSel = locked
      ? `<div class="mods-lo-hint">内置单位：点击「复制」后即可添加/编辑载弹。</div>`
      : `<div class="mods-lo-add"><select data-loadout-add aria-label="添加弹药">
        <option value="">+ 添加弹药（${avail.length}种可选）</option>
        ${avail.map((id) => `<option value="${esc(id)}">${esc(MISSILES[id]?.shortLabel ?? id)} · ${esc(id)}</option>`).join("")}
      </select></div>`;
    // Live cell-budget readout (counts per-missile cell cost, not just counts).
    const used = +usedCells(lo).toFixed(2);
    const cap = Number(form.vlsCells) || 0;
    const over = used > cap;
    const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    const budget = `<div class="mods-budget" role="status" aria-label="弹库占用"><div class="mods-budget-bar"><i style="width:${pct}%" class="${over ? "over" : ""}"></i></div><span class="mods-lo-cells${over ? " over" : ""}">${used} / ${cap} 单元${over ? " · 超载" : ""}</span></div>`;
    return `<details class="mods-section mods-loadout" open><summary>载弹 ${budget}</summary><div class="mods-lo-body">${rows || `<div class="mods-empty">暂无载弹 — 从下方添加。</div>`}${addSel}</div></details>`;
  }

  // Role-dependent fields on ammo: salvo is for surface-strike weapons;
  // interceptors/NEZ are for missile or aircraft targets.
  function fieldVisible(f) {
    if (form.kind !== "ammo") return true;
    const targets = new Set(form.targets || []);
    if (f.key === "salvo") return targets.has("sea") || targets.has("ground");
    if (f.key === "interceptorsPerThreat") return targets.has("missile") || targets.has("air");
    if (f.key === "nezFraction") return targets.has("missile") || targets.has("air");
    return true;
  }

  function renderDetail() {
    if (!form) {
      detailEl.innerHTML = `<div class="mods-placeholder"><b>从左侧选择一个单位，或新建一个。</b><span>内置单位只读 — 「复制」后即可自定义。支持搜索过滤，载弹超载会实时标红。</span></div>`;
      return;
    }
    const schema = SCHEMAS[form.kind];
    const locked = !isNew && isBuiltinUnit(form);
    const typeField = isNew
      ? `<label class="mods-field"><span class="mods-flabel">类型</span>
          <select data-type-select>${DEPLOYABLE_TYPES.concat("ammo").map((k) => `<option value="${k}"${k === form.kind ? " selected" : ""}>${esc(L(KIND_LABEL[k]))}</option>`).join("")}</select></label>`
      : "";
    const chips = [];
    if (form.vlsCells != null) chips.push(`<span class="mods-stat">${esc(String(form.vlsCells))} 单元</span>`);
    if (form.radarRangeNm != null) chips.push(`<span class="mods-stat">雷达 ${esc(String(form.radarRangeNm))}NM</span>`);
    if (form.cruiseSpeedKt != null && form.kind !== "ground") chips.push(`<span class="mods-stat">${esc(String(form.cruiseSpeedKt))}kt</span>`);
    if (form.damageResist != null || form.squadronSize != null) chips.push(`<span class="mods-stat">耐久 ${esc(String(form.squadronSize ?? form.damageResist))}</span>`);
    if (locked) chips.push(`<span class="mods-stat lock">内置只读</span>`);
    if (isNew) chips.push(`<span class="mods-stat new">新建未保存</span>`);

    const sections = schema.sections.map((sec, idx) =>
      `<details class="mods-section"${idx === 0 ? " open" : ""}><summary>${esc(L(sec.title))}</summary>
        <div class="mods-grid">${sec.fields.filter(fieldVisible).map((f) => fieldHtml(f, locked)).join("")}</div></details>`
    ).join("");

    const loadout = schema.loadout ? loadoutHtml(locked) : "";

    const dirtyTag = dirty ? `<span class="mods-dirty">未保存</span>` : `<span class="mods-clean">已保存</span>`;
    const toolbar = `<div class="mods-actions mods-actions-top">
      ${locked ? `<button type="button" class="mods-btn primary" data-action="clone">复制并自定义</button>` : ""}
      ${locked ? "" : `<button type="button" class="mods-btn primary" data-action="save">保存</button>`}
      ${locked ? "" : `<button type="button" class="mods-btn" data-action="clone">复制</button>`}
      <button type="button" class="mods-btn" data-action="export">${locked ? "导出 JSON" : "导出文件"}</button>
      ${locked || isNew ? "" : `<button type="button" class="mods-btn danger" data-action="delete">删除</button>`}
      ${dirtyTag}<span class="mods-errs" data-errs></span></div>`;

    detailEl.innerHTML = `<div class="mods-form">
      <div class="mods-summary"><div class="mods-summary-main"><span class="mods-kind">${esc(L(KIND_LABEL[form.kind]))}</span><b class="mods-name">${esc(form.kind === "ammo" ? unitId(form) : (form.name || "未命名"))}</b><span class="mods-id">${esc(form.kind === "ammo" ? "" : (form.id || form.prefix || ""))}</span></div><div class="mods-stats">${chips.join("")}</div></div>
      ${toolbar}
      <div class="mods-toprow">${typeField}</div>${sections}${loadout}</div>`;
    detailEl.scrollTop = 0;
  }

  function showErrors(errs) {
    const slot = detailEl.querySelector("[data-errs]");
    if (slot) slot.textContent = errs.map((e) => `${e.field}: ${e.msg}`).join("  ·  ");
  }

  // --- selection / lifecycle ----------------------------------------------
  function selectKey(key) {
    const u = findUnit(key);
    if (!u) return;
    selectedKey = key;
    form = JSON.parse(JSON.stringify(u));
    isNew = false;
    dirty = false;
    renderList();
    renderDetail();
  }

  function startNew(kind) {
    form = DEFAULTS[kind]();
    if (kind !== "ammo") form.id = makeUniqueShipId(form.prefix);
    selectedKey = null;
    isNew = true;
    dirty = true;
    renderList();
    renderDetail();
  }

  function ensureUniqueIdentity(u) {
    if (u.kind === "ammo") {
      let name = String(u.name || "MSL");
      const taken = new Set(units.filter((x) => x.kind === "ammo").map((x) => unitId(x)));
      if (taken.has(name)) { let n = 1; while (taken.has(`${name}-${n}`)) n++; name = `${name}-${n}`; }
      u.name = name;
    } else {
      if (!u.id || units.some((x) => x.kind !== "ammo" && x.id === u.id)) u.id = makeUniqueShipId(u.prefix);
    }
    return u;
  }

  async function doSave() {
    const result = validateUnit(form);
    if (!result.ok) { showErrors(result.errors); return; }
    if (isNew) ensureUniqueIdentity(form);
    try {
      const record = await saveMod(form);
      const key = recordKey(record);
      const idx = units.findIndex((u) => recordKey(u) === key);
      if (idx >= 0) units[idx] = record; else units.push(record);
      selectedKey = key;
      isNew = false;
      dirty = false;
      renderList();
      renderDetail();
      safeNotify();
    } catch (e) {
      console.warn("[mods] save failed", e);
      alert("保存失败，请重试。");
    }
  }

  function doClone() {
    const copy = JSON.parse(JSON.stringify(form));
    delete copy.builtin; delete copy.locked; delete copy._key;
    copy.name = `${copy.name || unitId(copy)} Copy`;
    if (copy.kind === "ammo") {
      copy.name = `${unitId(form)}-copy`;
      // Drop the source's identity fields so the clone labels itself by its new
      // ID instead of inheriting e.g. MaritimeStrike's "MSTK"/id.
      delete copy.id; delete copy.shortLabel; delete copy.displayName;
    } else { copy.id = makeUniqueShipId(copy.prefix); }
    form = copy;
    selectedKey = null;
    isNew = true;
    dirty = true;
    renderList();
    renderDetail();
  }

  function doExport() {
    const clean = JSON.parse(JSON.stringify(form));
    delete clean._key; delete clean.builtin; delete clean.locked;
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${unitId(form)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function doDelete() {
    if (!form || isBuiltinUnit(form)) return;
    try {
      const ok = await deleteMod(form);
      if (!ok) return;
      units = units.filter((u) => recordKey(u) !== recordKey(form));
      selectedKey = null;
      form = null;
      isNew = false;
      dirty = false;
      renderList();
      renderDetail();
      safeNotify();
    } catch (e) {
      console.warn("[mods] delete failed", e);
      alert("删除失败，请重试。");
    }
  }

  async function importJson(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return alert("无效的 JSON 文件"); }
    if (!parsed || !SCHEMAS[parsed.kind]) return alert("无法识别的单位文件");
    delete parsed.builtin; delete parsed.locked; delete parsed._key;
    ensureUniqueIdentity(parsed);
    const result = validateUnit(parsed);
    if (!result.ok) return alert("校验失败：" + result.errors.map((e) => `${e.field} ${e.msg}`).join("，"));
    try {
      const record = await saveMod(parsed);
      units.push(record);
      selectKey(recordKey(record));
      safeNotify();
    } catch (e) {
      console.warn("[mods] import save failed", e);
      alert("导入失败，请重试。");
    }
  }

  // --- events --------------------------------------------------------------
  listEl.addEventListener("click", (e) => {
    const filter = e.target.closest("[data-filter]");
    if (filter) {
      kindFilter = filter.dataset.filter;
      renderList();
      return;
    }
    const newBtn = e.target.closest("[data-new]");
    if (newBtn) return startNew(newBtn.dataset.new);
    const item = e.target.closest("[data-key]");
    if (item) return selectKey(item.dataset.key);
  });

  listEl.addEventListener("input", (e) => {
    if (e.target.matches("[data-search]")) {
      query = e.target.value;
      const pos = e.target.selectionStart;
      renderList();
      const input = listEl.querySelector("[data-search]");
      if (input) {
        input.focus();
        try { input.setSelectionRange(pos, pos); } catch {}
      }
    }
  });

  detailEl.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.field) {
      const f = currentField(t.dataset.field);
      if (f?.type === "number") form[t.dataset.field] = t.value === "" ? "" : Number(t.value);
      else if (f?.type === "checkbox") form[t.dataset.field] = t.checked;
      else form[t.dataset.field] = t.value;
      // Editing a naval unit's cruise speed auto-derives the rest of the mobility
      // block (higher cruise = faster + more agile). The user can still override
      // any derived field afterward; only editing cruise re-runs this.
      if (t.dataset.field === "cruiseSpeedKt" && form.kind === "naval") deriveMobilityFromCruise();
      // Editing VLS capacity changes the cell-budget readout.
      if (t.dataset.field === "vlsCells") updateLoadoutCells();
      markDirty();
    } else if (t.dataset.multiField) {
      const key = t.dataset.multiField;
      const values = new Set(Array.isArray(form[key]) ? form[key] : []);
      if (t.checked) values.add(t.value); else values.delete(t.value);
      form[key] = [...values];
      markDirty();
      if (key === "targets") renderDetail();
    } else if (t.dataset.loadoutId) {
      form.baseLoadout ||= {};
      form.baseLoadout[t.dataset.loadoutId] = Math.max(0, Math.round(Number(t.value) || 0));
      updateLoadoutCells();
      markDirty();
    }
  });

  detailEl.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-type-select]")) {
      const keepName = form.name;
      form = DEFAULTS[t.value]();
      if (t.value !== "ammo") form.id = makeUniqueShipId(form.prefix);
      else form.name = keepName || form.name;
      dirty = true;
      renderDetail();
    } else if (t.matches("[data-loadout-add]") && t.value) {
      form.baseLoadout ||= {};
      form.baseLoadout[t.value] = form.baseLoadout[t.value] || 1;
      markDirty();
      renderDetail();
    }
  });

  detailEl.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-loadout-remove]");
    if (rm) { delete form.baseLoadout[rm.dataset.loadoutRemove]; markDirty(); renderDetail(); return; }
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "save") doSave();
    else if (action === "clone") doClone();
    else if (action === "export") doExport();
    else if (action === "delete") doDelete();
  });

  // Live-update the loadout cell-budget readout in place (no full re-render, so
  // the edited input keeps focus). Mirrors the tag built in loadoutHtml.
  function updateLoadoutCells() {
    const el = detailEl.querySelector(".mods-lo-cells");
    if (!el) return;
    const used = +usedCells(form.baseLoadout || {}).toFixed(2);
    const cap = Number(form.vlsCells) || 0;
    el.textContent = `${used} / ${cap} 单元`;
    el.classList.toggle("over", used > cap);
  }

  // Derive max speed / accel / decel / turn / flank-turn from cruise speed and
  // push the results into both form state and the live inputs (focus on the
  // cruise field is preserved because we don't re-render the form).
  function deriveMobilityFromCruise() {
    const c = Number(form.cruiseSpeedKt) || 0;
    const round = (n, p) => Math.round(n * 10 ** p) / 10 ** p;
    const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
    const derived = {
      maxSpeedKt: clamp(round(c * 1.8, 1), 0, 70),
      accelMps2: clamp(round(c * 0.0075, 3), 0, 5),
      decelMps2: clamp(round(c * 0.0075 * 1.85, 3), 0, 5),
      turnRateDps: clamp(round(c * 0.16, 2), 0, 30),
      turnRateFlankDps: clamp(round(c * 0.16 * 0.7, 2), 0, 30)
    };
    Object.assign(form, derived);
    for (const [k, v] of Object.entries(derived)) {
      const el = detailEl.querySelector(`[data-field="${k}"]`);
      if (el && document.activeElement !== el) el.value = v;
    }
  }

  function currentField(key) {
    for (const sec of SCHEMAS[form.kind].sections) {
      const f = sec.fields.find((x) => x.key === key);
      if (f) return f;
    }
    return null;
  }

  function markDirty() {
    if (dirty) return;
    dirty = true;
    const tag = detailEl.querySelector(".mods-actions");
    if (tag) {
      const clean = tag.querySelector(".mods-clean");
      if (clean) {
        clean.className = "mods-dirty";
        clean.textContent = "未保存";
      } else if (!tag.querySelector(".mods-dirty")) {
        const span = document.createElement("span");
        span.className = "mods-dirty";
        span.textContent = "未保存";
        tag.insertBefore(span, tag.querySelector("[data-errs]"));
      }
    }
    const summary = detailEl.querySelector(".mods-stats .mods-stat.new");
    if (!summary) {
      const stats = detailEl.querySelector(".mods-stats");
      if (stats && isNew) {
        const s = document.createElement("span");
        s.className = "mods-stat new";
        s.textContent = "新建未保存";
        stats.appendChild(s);
      }
    }
  }

  // drag-and-drop JSON import onto the popup
  overlay.addEventListener("dragover", (e) => { if (open) { e.preventDefault(); overlay.classList.add("drop"); } });
  overlay.addEventListener("dragleave", (e) => { if (e.target === overlay) overlay.classList.remove("drop"); });
  overlay.addEventListener("drop", (e) => {
    if (!open) return;
    e.preventDefault();
    overlay.classList.remove("drop");
    const file = e.dataTransfer?.files?.[0];
    if (file) file.text().then(importJson).catch((e) => console.warn("[mods] drop read failed", e));
  });

  async function openEditor() {
    if (!loaded) { units = await loadMods(); loaded = true; safeNotify(); }
    open = true;
    overlay.hidden = false;
    selectedKey = null; form = null; isNew = false; dirty = false;
    renderList();
    renderDetail();
    onOpenChange?.(true);
  }

  function closeEditor() {
    open = false;
    overlay.hidden = true;
    form = null; dirty = false;
    onOpenChange?.(false);
  }

  return {
    open: openEditor,
    close: closeEditor,
    isOpen: () => open,
    // expose a one-shot loader so the app can register stored units at boot
    // without opening the popup
    async preload() { if (!loaded) { units = await loadMods(); loaded = true; safeNotify(); } },
    // Debug accessor (also wired to window.tomahawkMods): inspect or extract a
    // stored unit's JSON from the browser, and check whether it is registered.
    async dump(name) {
      if (!loaded) { units = await loadMods(); loaded = true; }
      const all = JSON.parse(JSON.stringify(units));
      if (!name) return all;
      const hit = all.find((u) => unitId(u) === name || u.name === name);
      return { record: hit ?? null, registeredAsMissile: !!MISSILES[name], registeredAmmoIds: availableAmmoIds() };
    }
  };
}
