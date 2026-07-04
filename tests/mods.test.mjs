import test from "node:test";
import assert from "node:assert/strict";

import {
  NM, MISSILES, SHIP_CLASSES, makeShip, createDefaultScenario, createScenario, clearSide,
  placeShip, stepSim, SIDE, SCENARIO_MODE
} from "../src/sim.js";
import { SCHEMAS, DEFAULTS, validateUnit, DEPLOYABLE_TYPES, UNIT_TYPES } from "../src/mods/schema.js";
import {
  toInternalSpec, vanillaUnits, registerUnit, unregisterUnit, isBuiltinUnit,
  makeUniqueShipId, unitId, availableAmmoIds
} from "../src/mods/registry.js";
import { loadMods, deleteMod, recordKey } from "../src/mods/store.js";
import { weaponColumns, groundRowHtml } from "../src/ui/view.js";

test("schema exposes four types; naval+ground+aircraft are deployable", () => {
  assert.deepEqual(UNIT_TYPES, ["naval", "ground", "aircraft", "ammo"]);
  assert.deepEqual(DEPLOYABLE_TYPES, ["naval", "ground", "aircraft"]);
  assert.ok(SCHEMAS.naval && SCHEMAS.ground && SCHEMAS.aircraft && SCHEMAS.ammo);
});

test("validateUnit accepts defaults and rejects bad fields", () => {
  for (const kind of UNIT_TYPES) assert.equal(validateUnit(DEFAULTS[kind]()).ok, true, kind);
  const badAmmo = { ...DEFAULTS.ammo(), name: "bad id!" };
  assert.equal(validateUnit(badAmmo).ok, false);
  const badNum = { ...DEFAULTS.naval(), radarRangeNm: -5 };
  assert.equal(validateUnit(badNum).ok, false);
  const badEnum = { ...DEFAULTS.ammo(), category: "nonsense" };
  assert.equal(validateUnit(badEnum).ok, false);
});

test("validateUnit rejects a loadout that exceeds VLS capacity, counting cell cost", () => {
  // 8 single-cell missiles into a 4-cell magazine -> over budget.
  const over = { ...DEFAULTS.naval(), vlsCells: 4, baseLoadout: { "SM-2MR": 8 } };
  const r = validateUnit(over);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /VLS cells/.test(e.msg)), "reports a VLS-cell error");
  // ESSM costs 0.25 cells each: 16 ESSM exactly fills 4 cells (ok); 20 overflows.
  assert.equal(validateUnit({ ...DEFAULTS.naval(), vlsCells: 4, baseLoadout: { ESSM: 16 } }).ok, true);
  assert.equal(validateUnit({ ...DEFAULTS.naval(), vlsCells: 4, baseLoadout: { ESSM: 20 } }).ok, false);
});

test("vanillaUnits cover every built-in catalogue entry and are locked", () => {
  const v = vanillaUnits();
  const ammo = v.filter((u) => u.kind === "ammo").map(unitId);
  const ships = v.filter((u) => u.kind !== "ammo").map(unitId);
  for (const id of Object.keys(MISSILES)) assert.ok(ammo.includes(id), `missing ammo ${id}`);
  for (const hull of Object.keys(SHIP_CLASSES)) assert.ok(ships.includes(hull), `missing hull ${hull}`);
  assert.ok(v.every((u) => u.locked && u.builtin));
});

test("ammo NM<->m conversion round-trips against the vanilla catalogue", () => {
  const sm2 = vanillaUnits().find((u) => u.kind === "ammo" && unitId(u) === "SM-2MR");
  assert.equal(sm2.rangeNm, MISSILES["SM-2MR"].rangeM / NM);
  const spec = toInternalSpec(sm2);
  assert.ok(Math.abs(spec.rangeM - MISSILES["SM-2MR"].rangeM) < 1e-6);
  assert.ok(Math.abs(spec.seekerRangeM - MISSILES["SM-2MR"].seekerRangeM) < 1e-6);
});

test("vanilla ship round-trip reproduces core internal fields", () => {
  const ddg = vanillaUnits().find((u) => u.kind === "naval" && unitId(u) === "DDG");
  const spec = toInternalSpec(ddg);
  assert.equal(spec.vlsCells, SHIP_CLASSES.DDG.vlsCells);
  assert.equal(spec.radarRangeNm, SHIP_CLASSES.DDG.radarRangeNm);
  assert.equal(spec.defenseChannels.area, SHIP_CLASSES.DDG.defenseChannels.area);
});

// Regression: RCS used to be invisible in the Unit Workshop entirely (no
// schema field, no registry round-trip) even though the sim core has used it
// for detection since much earlier. Every unit type -- naval, ground,
// aircraft, and ammo -- must expose and round-trip rcsM2.
test("RCS is exposed and round-trips for every unit kind, including built-ins without an explicit value", () => {
  for (const kind of UNIT_TYPES) {
    const schema = SCHEMAS[kind];
    const hasRcsField = schema.sections.some((s) => s.fields.some((f) => f.key === "rcsM2"));
    assert.ok(hasRcsField, `${kind} schema exposes an rcsM2 field`);
    assert.ok(Number.isFinite(DEFAULTS[kind]().rcsM2), `${kind} default has a finite rcsM2`);
  }
  // F-22 has an explicit low-observable rcsM2 in ships.js; the Workshop's
  // vanilla listing must reflect that exact value, not an auto-computed one.
  const f22 = vanillaUnits().find((u) => u.kind === "aircraft" && unitId(u) === "F22");
  assert.equal(f22.rcsM2, SHIP_CLASSES.F22.rcsM2);
  // DDG has no explicit rcsM2 in ships.js; the Workshop must show the same
  // domain/displacement-derived default the sim itself would actually use.
  const ddg = vanillaUnits().find((u) => u.kind === "naval" && unitId(u) === "DDG");
  assert.ok(Number.isFinite(ddg.rcsM2) && ddg.rcsM2 > 0);
  // A custom hull with an explicit rcsM2 must carry it through to the
  // internal spec unchanged.
  const custom = { ...DEFAULTS.naval(), name: "Ghost", prefix: "GHX", rcsM2: 42 };
  assert.equal(toInternalSpec(custom).rcsM2, 42);
});

test("built-in units cannot be unregistered", () => {
  const ddg = vanillaUnits().find((u) => unitId(u) === "DDG");
  assert.equal(isBuiltinUnit(ddg), true);
  assert.equal(unregisterUnit(ddg), false);
  assert.ok(SHIP_CLASSES.DDG, "DDG still present");
});

test("a custom naval unit registers, spawns, and unregisters cleanly", () => {
  const unit = { ...DEFAULTS.naval(), name: "Test Cruiser", prefix: "TCG" };
  unit.id = makeUniqueShipId(unit.prefix);
  registerUnit(unit);
  assert.ok(SHIP_CLASSES[unit.id], "registered into SHIP_CLASSES");
  const ship = makeShip(SIDE.BLUE, 0, 0, unit.id);
  assert.equal(ship.domain, "sea");
  assert.equal(ship.isFixed, false);
  assert.equal(ship.vlsCells, unit.vlsCells);
  assert.ok((ship.loadout["SM-2MR"] ?? 0) > 0, "custom baseLoadout applied");
  assert.equal(unregisterUnit(unit), true);
  assert.equal(SHIP_CLASSES[unit.id], undefined);
});

test("a custom ground unit is fixed, on-land, and carries its glyph", () => {
  const unit = { ...DEFAULTS.ground(), name: "Test Bastion", prefix: "TBN", glyph: "radar" };
  unit.id = makeUniqueShipId(unit.prefix);
  registerUnit(unit);
  const ship = makeShip(SIDE.RED, 10, 10, unit.id);
  assert.equal(ship.domain, "ground");
  assert.equal(ship.isFixed, true);
  assert.equal(ship.glyph, "radar");
  unregisterUnit(unit);
});

test("a registered custom ammo appears in the loadout picker list", () => {
  const unit = { ...DEFAULTS.ammo(), name: "PICKER-TEST" };
  registerUnit(unit);
  assert.ok(availableAmmoIds().includes("PICKER-TEST"), "custom ammo offered to naval/ground loadouts");
  unregisterUnit(unit);
  assert.ok(!availableAmmoIds().includes("PICKER-TEST"), "removed after unregister");
});

test("a custom ammo unit registers and is usable in a loadout", () => {
  const unit = { ...DEFAULTS.ammo(), name: "TEST-SAM", shortLabel: "TSAM" };
  registerUnit(unit);
  assert.ok(MISSILES["TEST-SAM"], "registered into MISSILES");
  const navy = { ...DEFAULTS.naval(), name: "Carrier", prefix: "CVX", baseLoadout: { "TEST-SAM": 8 } };
  navy.id = makeUniqueShipId(navy.prefix);
  registerUnit(navy);
  const ship = makeShip(SIDE.BLUE, 0, 0, navy.id);
  assert.equal(ship.loadout["TEST-SAM"], 8);
  unregisterUnit(navy);
  unregisterUnit(unit);
});

test("force inventory adds a column for a deployed custom missile (vanilla first, custom appended)", () => {
  const ammo = { ...DEFAULTS.ammo(), name: "SM-7X", category: "anti_ship" };
  registerUnit(ammo);
  const ship = { side: "BLUE", hull: "DDG", loadout: { "SM-2MR": 20, "SM-7X": 4 } };
  const cols = weaponColumns([ship]);
  assert.ok(cols.includes("SM-7X"), "custom missile gets a column");
  assert.ok(cols.indexOf("SM-2MR") < cols.indexOf("SM-7X"), "vanilla before custom");
  // a weapon carried by nobody is not given a column
  assert.ok(!cols.includes("TomahawkBlockV"));
  unregisterUnit(ammo);
});

test("ground inventory aggregates a custom anti-ship missile into ASUW by category", () => {
  const ammo = { ...DEFAULTS.ammo(), name: "CB-99", category: "anti_ship" };
  registerUnit(ammo);
  const ground = { side: "RED", hull: "CDB", domain: "ground", isFixed: true,
    loadout: { "CB-99": 6 }, radarRangeM: 100 * NM, damageResist: 2 };
  const row = groundRowHtml(ground, false);
  assert.match(row, />6</, "custom anti-ship counted in the ASUW cell");
  unregisterUnit(ammo);
});

test("a ship actually fires a custom anti-ship missile at the enemy", () => {
  const ammo = { ...DEFAULTS.ammo(), name: "HARPOON-X", category: "anti_ship",
    rangeNm: 140, preferredMinRangeNm: 5, preferredMaxRangeNm: 140 };
  registerUnit(ammo);
  const hull = { ...DEFAULTS.naval(), name: "Striker", prefix: "STK", baseLoadout: { "HARPOON-X": 16 } };
  hull.id = makeUniqueShipId(hull.prefix);
  registerUnit(hull);
  const sim = createScenario(7, "openSea");
  clearSide(sim, SIDE.BLUE);
  clearSide(sim, SIDE.RED);
  const blue = placeShip(sim, SIDE.BLUE, -15 * NM, 0, hull.id);
  placeShip(sim, SIDE.RED, 15 * NM, 0, "DDG");
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  let fired = false;
  for (let i = 0; i < 1200 && !fired; i++) {
    stepSim(sim, 0.25);
    fired = sim.missiles.some((m) => m.missileId === "HARPOON-X")
      || (blue.launchQueue || []).some((o) => o.missileId === "HARPOON-X");
  }
  assert.ok(fired, "the custom anti-ship missile was launched or queued");
  unregisterUnit(hull);
  unregisterUnit(ammo);
});

test("a custom unit survives a short deterministic battle without throwing", () => {
  const unit = { ...DEFAULTS.naval(), name: "Skirmisher", prefix: "SKG" };
  unit.id = makeUniqueShipId(unit.prefix);
  registerUnit(unit);
  const sim = createDefaultScenario(7);
  const placed = placeShip(sim, SIDE.BLUE, -20 * NM, 0, unit.id);
  assert.ok(placed, "custom hull placed");
  for (let i = 0; i < 200; i++) stepSim(sim, 0.25);
  assert.ok(sim.ships.some((s) => s.hull === unit.id), "custom ship present after stepping");
  unregisterUnit(unit);
});

test("loadMods returns the vanilla set in Node (no IndexedDB) and built-ins resist delete", async () => {
  const list = await loadMods();
  assert.equal(list.length, vanillaUnits().length);
  assert.ok(list.every((u) => u._key === recordKey(u)));
  const ddg = list.find((u) => unitId(u) === "DDG");
  assert.equal(await deleteMod(ddg), false);
});
