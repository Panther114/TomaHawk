// Browser persistence for custom units, backed by IndexedDB. This is the
// "permanent directory": each unit is a self-contained JSON record. Vanilla
// units are seeded here as locked records on first run (and re-healed to
// canonical on every boot), so they appear in the list like any other unit but
// can never be deleted or corrupted. No filesystem, no Downloads/Desktop.

import { vanillaUnits, registerUnit, unregisterUnit, unitId, isBuiltinUnit } from "./registry.js";

const DB_NAME = "tomahawk-mods";
const DB_VERSION = 1;
const STORE = "units";

/** Composite primary key so an ammo "DDG" can't collide with a hull "DDG". */
export function recordKey(unit) {
  return `${unit.kind}:${unitId(unit)}`;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "_key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll(db) {
  return reqPromise(tx(db, "readonly").getAll());
}

async function dbPut(db, record) {
  return reqPromise(tx(db, "readwrite").put(record));
}

async function dbDelete(db, key) {
  return reqPromise(tx(db, "readwrite").delete(key));
}

let dbHandle = null;

/**
 * Boot the mod system: seed/heal vanilla locked records, load all stored units,
 * and register every custom unit into the live catalogues. Returns the full
 * unit list (vanilla + custom) for the editor. Vanilla types are already in the
 * sim catalogues at module load, so they are not re-registered here.
 */
export async function loadMods() {
  const vanilla = vanillaUnits();
  if (!hasIndexedDb()) {
    // No persistence available (e.g. Node/tests): vanilla only, nothing to register.
    return vanilla.map((u) => ({ ...u, _key: recordKey(u) }));
  }
  const db = (dbHandle ||= await openDb());

  // Re-seed/heal vanilla records to canonical on every boot.
  for (const u of vanilla) await dbPut(db, { ...u, _key: recordKey(u) });

  const records = await dbGetAll(db);
  const registered = [];
  const failed = [];
  for (let rec of records) {
    if (rec.builtin || isBuiltinUnit(rec)) continue;
    // Self-heal: a record whose `kind` was lost (older/partial write) would
    // mis-route to ship registration and be silently dropped. The record key is
    // `kind:id`, so recover the kind from it and persist the repair.
    const keyKind = String(rec._key || "").split(":")[0];
    if (!["naval", "ground", "ammo"].includes(rec.kind) && ["naval", "ground", "ammo"].includes(keyKind)) {
      rec = { ...rec, kind: keyKind };
      try { await dbPut(db, rec); } catch { /* registration below still matters */ }
    }
    try { registerUnit(rec); registered.push(rec._key); }
    catch (e) {
      failed.push(rec._key);
      console.warn("[mods] failed to register stored unit", rec?._key, rec, e);
    }
  }
  const customCount = records.filter((r) => !(r.builtin || isBuiltinUnit(r))).length;
  console.info(`[mods] loaded ${customCount} custom unit(s); registered ${registered.length}` +
    (failed.length ? `, FAILED ${failed.length}: ${failed.join(", ")}` : ""), { registered, failed });
  return records;
}

/** Persist a custom unit and register it live. Returns the stored record. */
export async function saveMod(unit) {
  const record = { ...unit, _key: recordKey(unit) };
  registerUnit(record);
  if (hasIndexedDb()) await dbPut((dbHandle ||= await openDb()), record);
  return record;
}

/** Delete a custom unit (refuses built-ins) and unregister it live. */
export async function deleteMod(unit) {
  if (isBuiltinUnit(unit)) return false;
  unregisterUnit(unit);
  if (hasIndexedDb()) await dbDelete((dbHandle ||= await openDb()), recordKey(unit));
  return true;
}
