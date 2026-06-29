// Unit Workshop popup controller. Renders the unit list + a dense, schema-driven
// parameter form, and wires save / clone / export / delete / drag-in import.
// Edits live only in a working copy: closing the popup or switching units
// discards unsaved changes; Save is the only commit path. Built-in units are
// read-only (Clone to customize) and can never be deleted.

import { getLang } from "../ui/lang.js";
import { SCHEMAS, DEFAULTS, DEPLOYABLE_TYPES, validateUnit } from "./schema.js";
import { loadMods, saveMod, deleteMod, recordKey } from "./store.js";
import { unitId, isBuiltinUnit, makeUniqueShipId, availableAmmoIds } from "./registry.js";
import { MISSILES, usedCells } from "../sim.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));
const L = (label) => label?.[getLang()] ?? label?.en ?? "";

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

  const findUnit = (key) => units.find((u) => recordKey(u) === key);
  const labelOf = (u) => (u.kind === "ammo" ? unitId(u) : `${u.prefix} · ${u.name}`);
  // Host callback must never break the editor's own flow (e.g. a render fault).
  const safeNotify = () => { try { onChange?.(); } catch (e) { console.warn("[mods] onChange failed", e); } };

  // --- list ----------------------------------------------------------------
  function renderList() {
    const groups = { ammo: [], naval: [], ground: [], aircraft: [] };
    for (const u of units) (groups[u.kind] || groups.naval).push(u);
    const lang = getLang();
    const section = (kind) => {
      const items = groups[kind].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
      const rows = items.map((u) => {
        const key = recordKey(u);
        const lock = isBuiltinUnit(u) ? `<span class="mods-lock" title="Built-in">●</span>` : "";
        const sel = key === selectedKey ? " selected" : "";
        return `<button class="mods-item${sel}" data-key="${esc(key)}">${lock}<span>${esc(labelOf(u))}</span></button>`;
      }).join("");
      return `<div class="mods-group"><div class="mods-group-h">${esc(KIND_LABEL[kind][lang] ?? KIND_LABEL[kind].en)}</div>${rows || `<div class="mods-empty">—</div>`}</div>`;
    };
    listEl.innerHTML = `
      <div class="mods-newbar">
        <button class="mods-new" data-new="naval">+ ${esc(L(KIND_LABEL.naval))}</button>
        <button class="mods-new" data-new="ground">+ ${esc(L(KIND_LABEL.ground))}</button>
        <button class="mods-new" data-new="aircraft">+ ${esc(L(KIND_LABEL.aircraft))}</button>
        <button class="mods-new" data-new="ammo">+ ${esc(L(KIND_LABEL.ammo))}</button>
      </div>
      ${section("naval")}${section("ground")}${section("aircraft")}${section("ammo")}`;
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
    } else if (f.type === "checkbox") {
      input = `<input type="checkbox" data-field="${f.key}"${v ? " checked" : ""}${dis} />`;
    } else {
      input = `<input type="text" data-field="${f.key}" value="${esc(v)}"${f.maxlength ? ` maxlength="${f.maxlength}"` : ""}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ""}${dis} />`;
    }
    const hint = f.unit ? ` <span class="mods-uhint">${esc(f.unit)}</span>` : "";
    return `<label class="mods-field"><span class="mods-flabel">${esc(L(f.label))}${hint}</span>${input}</label>`;
  }

  function loadoutHtml(locked) {
    const lo = form.baseLoadout || {};
    const rows = Object.entries(lo).map(([id, count]) => {
      const label = MISSILES[id]?.shortLabel ?? id;
      const rm = locked ? "" : `<button class="mods-lo-rm" data-loadout-remove="${esc(id)}" title="Remove">×</button>`;
      return `<div class="mods-lo-row"><span class="mods-lo-name" title="${esc(id)}">${esc(label)}</span>
        <input type="number" min="0" step="1" data-loadout-id="${esc(id)}" value="${esc(count)}"${locked ? " disabled" : ""} />${rm}</div>`;
    }).join("");
    const avail = availableAmmoIds().filter((id) => !(id in lo));
    const addSel = locked
      ? `<div class="mods-lo-hint">${esc(getLang() === "zh" ? "内置单位：点击「克隆」后即可添加/编辑载弹" : "Built-in — click Clone to add or edit weapons")}</div>`
      : `<div class="mods-lo-add"><select data-loadout-add>
        <option value="">+ ${esc(getLang() === "zh" ? "添加弹药" : "add ammo")}</option>
        ${avail.map((id) => `<option value="${esc(id)}">${esc(MISSILES[id]?.shortLabel ?? id)}</option>`).join("")}
      </select></div>`;
    const title = getLang() === "zh" ? "载弹" : "Loadout";
    // Live cell-budget readout (counts per-missile cell cost, not just counts).
    const used = +usedCells(lo).toFixed(2);
    const cap = Number(form.vlsCells) || 0;
    const over = used > cap;
    const cellTag = `<span class="mods-lo-cells${over ? " over" : ""}">${used} / ${cap} ${getLang() === "zh" ? "单元" : "cells"}</span>`;
    return `<fieldset class="mods-section mods-loadout"><legend>${esc(title)} ${cellTag}</legend>${rows || `<div class="mods-empty">—</div>`}${addSel}</fieldset>`;
  }

  // Role-dependent fields on ammo: salvo (volley size) is an offensive concept,
  // shown for anti-ship / dual; interceptors-per-threat is a defensive concept,
  // shown for anti-air / dual. Everything else is always visible.
  function fieldVisible(f) {
    if (form.kind !== "ammo") return true;
    const cat = form.category;
    if (f.key === "salvo") return cat === "anti_ship" || cat === "dual_role";
    if (f.key === "interceptorsPerThreat") return cat === "anti_air" || cat === "dual_role";
    return true;
  }

  function renderDetail() {
    if (!form) {
      detailEl.innerHTML = `<div class="mods-placeholder">${esc(getLang() === "zh" ? "从左侧选择一个单位，或新建一个。" : "Select a unit on the left, or create a new one.")}</div>`;
      return;
    }
    const schema = SCHEMAS[form.kind];
    const locked = !isNew && isBuiltinUnit(form);
    const lang = getLang();

    const typeField = isNew
      ? `<label class="mods-field"><span class="mods-flabel">${lang === "zh" ? "类型" : "Type"}</span>
          <select data-type-select>${DEPLOYABLE_TYPES.concat("ammo").map((k) => `<option value="${k}"${k === form.kind ? " selected" : ""}>${esc(L(KIND_LABEL[k]))}</option>`).join("")}</select></label>`
      : `<div class="mods-field mods-typeshow"><span class="mods-flabel">${lang === "zh" ? "类型" : "Type"}</span><span class="mods-typeval">${esc(L(KIND_LABEL[form.kind]))}${locked ? ` · ${lang === "zh" ? "内置（克隆后可编辑）" : "built-in (Clone to edit)"}` : ""}</span></div>`;

    const sections = schema.sections.map((sec) =>
      `<fieldset class="mods-section"><legend>${esc(L(sec.title))}</legend>
        <div class="mods-grid">${sec.fields.filter(fieldVisible).map((f) => fieldHtml(f, locked)).join("")}</div></fieldset>`
    ).join("");

    const loadout = schema.loadout ? loadoutHtml(locked) : "";

    const dirtyTag = dirty ? `<span class="mods-dirty">${lang === "zh" ? "未保存" : "Unsaved"}</span>` : "";
    const footer = `<div class="mods-actions">
      ${locked ? "" : `<button class="mods-btn primary" data-action="save">${lang === "zh" ? "保存" : "Save"}</button>`}
      <button class="mods-btn" data-action="clone">${lang === "zh" ? "克隆" : "Clone"}</button>
      <button class="mods-btn" data-action="export">${lang === "zh" ? "导出" : "Export"}</button>
      ${locked || isNew ? "" : `<button class="mods-btn danger" data-action="delete">${lang === "zh" ? "删除" : "Delete"}</button>`}
      ${dirtyTag}<span class="mods-errs" data-errs></span></div>`;

    detailEl.innerHTML = `<div class="mods-form">
      <div class="mods-toprow">${typeField}</div>${sections}${loadout}${footer}</div>`;
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${unitId(form)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function doDelete() {
    if (!form || isBuiltinUnit(form)) return;
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
  }

  async function importJson(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { return alert(getLang() === "zh" ? "无效的 JSON 文件" : "Invalid JSON file"); }
    if (!parsed || !SCHEMAS[parsed.kind]) return alert(getLang() === "zh" ? "无法识别的单位文件" : "Unrecognized unit file");
    delete parsed.builtin; delete parsed.locked; delete parsed._key;
    ensureUniqueIdentity(parsed);
    const result = validateUnit(parsed);
    if (!result.ok) return alert((getLang() === "zh" ? "校验失败: " : "Validation failed: ") + result.errors.map((e) => `${e.field} ${e.msg}`).join(", "));
    const record = await saveMod(parsed);
    units.push(record);
    selectKey(recordKey(record));
    safeNotify();
  }

  // --- events --------------------------------------------------------------
  listEl.addEventListener("click", (e) => {
    const newBtn = e.target.closest("[data-new]");
    if (newBtn) return startNew(newBtn.dataset.new);
    const item = e.target.closest("[data-key]");
    if (item) return selectKey(item.dataset.key);
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
    } else if (form.kind === "ammo" && t.matches('[data-field="category"]')) {
      // Category drives which role-specific fields show (salvo vs interceptors);
      // re-render so they appear/disappear immediately.
      form.category = t.value;
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
    el.textContent = `${used} / ${cap} ${getLang() === "zh" ? "单元" : "cells"}`;
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
    if (tag && !tag.querySelector(".mods-dirty")) {
      const span = document.createElement("span");
      span.className = "mods-dirty";
      span.textContent = getLang() === "zh" ? "未保存" : "Unsaved";
      tag.insertBefore(span, tag.querySelector("[data-errs]"));
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
    if (file) file.text().then(importJson);
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
    // Re-render the dynamically-built list/form in the current language. Called
    // by the host when the UI language toggles while the popup is open.
    refreshLang() { if (open) { renderList(); renderDetail(); } },
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
