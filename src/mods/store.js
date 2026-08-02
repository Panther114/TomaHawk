// Browser persistence for custom units, backed by IndexedDB. This is the
// "permanent directory": each unit is a self-contained JSON record. Vanilla
// units are seeded here as locked records on first run (and re-healed to
// canonical on every boot), so they appear in the list like any other unit but
// can never be deleted or corrupted. No filesystem, no Downloads/Desktop.

import { vanillaUnits, registerUnit, unregisterUnit, unitId, isBuiltinUnit } from "./registry.js";

const DB_NAME = "tomahawk-mods";
const LEGACY_DB_NAME = "initiative-mods";
const DB_VERSION = 1;
const STORE = "units";

/** Composite primary key so an ammo "DDG" can't collide with a hull "DDG". */
export function recordKey(unit) {
  return `${unit.kind}:${unitId(unit)}`;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openNamedDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "_key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteNamedDb(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`数据库 ${name} 仍被占用`));
  });
}

async function migrateLegacyDb(targetDb) {
  let legacy;
  try {
    if (typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === LEGACY_DB_NAME)) return;
    }
    legacy = await openNamedDb(LEGACY_DB_NAME);
    const records = await dbGetAll(legacy);
    for (const record of records) await dbPut(targetDb, record);
    legacy.close();
    await deleteNamedDb(LEGACY_DB_NAME);
  } catch (error) {
    legacy?.close();
    // Keep the old database intact when any copy/verification step fails.
    console.warn("[mods] 旧版单位数据库迁移未完成，将在下次启动时重试", error);
  }
}

async function openDb() {
  const db = await openNamedDb(DB_NAME);
  await migrateLegacyDb(db);
  return db;
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
  const vanillaRecords = vanilla.map((u) => ({ ...u, _key: recordKey(u) }));
  if (!hasIndexedDb()) {
    // No persistence available (e.g. Node/tests): vanilla only, nothing to register.
    return vanillaRecords;
  }
  let db;
  try {
    db = (dbHandle ||= await openDb());
  } catch (e) {
    // A blocked/private storage context must not break the editor or the sim.
    console.warn("[mods] IndexedDB unavailable, loading vanilla only", e);
    return vanillaRecords;
  }

  // Re-seed/heal vanilla records to canonical on every boot. A single failing
  // write must not abort the whole load (and block every custom unit below).
  for (const u of vanilla) {
    try { await dbPut(db, { ...u, _key: recordKey(u) }); }
    catch (e) { console.warn("[mods] failed to re-seed vanilla unit", u?._key, e); }
  }

  let records;
  try { records = await dbGetAll(db); }
  catch (e) {
    console.warn("[mods] failed to read stored units", e);
    return vanillaRecords;
  }
  const registered = [];
  const failed = [];
  for (let rec of records) {
    if (rec.builtin || isBuiltinUnit(rec)) continue;
    // Self-heal: a record whose `kind` was lost (older/partial write) would
    // mis-route to ship registration and be silently dropped. The record key is
    // `kind:id`, so recover the kind from it and persist the repair.
    const keyKind = String(rec._key || "").split(":")[0];
    if (!["naval", "ground", "aircraft", "ammo"].includes(rec.kind) && ["naval", "ground", "aircraft", "ammo"].includes(keyKind)) {
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

/** Persist a custom unit and register it live. Returns the stored record.
 *  Persists BEFORE registering so a failed write never leaves a phantom unit
 *  live in the sim catalogues but missing from storage. */
export async function saveMod(unit) {
  const record = { ...unit, _key: recordKey(unit) };
  if (hasIndexedDb()) await dbPut((dbHandle ||= await openDb()), record);
  registerUnit(record);
  return record;
}

/** Delete a custom unit (refuses built-ins) and unregister it live.
 *  Persists the deletion BEFORE unregistering so a failed write never leaves the
 *  unit gone from the live catalogues yet still resurrecting on next boot. */
export async function deleteMod(unit) {
  if (isBuiltinUnit(unit)) return false;
  if (hasIndexedDb()) await dbDelete((dbHandle ||= await openDb()), recordKey(unit));
  unregisterUnit(unit);
  return true;
}
