# Unit Modding — the Unit Workshop / 单位自定义

TomaHawk's unit stats are no longer hard-coded. The **Unit Workshop** lets you
create, edit, import, and export custom units. Open it with the folder icon next
to the language toggle (top-left).

战斧的单位数值不再写死在代码里。点击左上角语言切换旁的文件夹图标，即可打开
**单位工坊**，用于新建、编辑、导入和导出自定义单位。

## How it works

- **Storage.** Each unit is a self-contained JSON record stored in the browser's
  IndexedDB — not in Downloads/Desktop, and with no server changes, so it behaves
  identically for local runs and the cloud build. The left-hand list is that
  store's contents.
- **Sharing.** Drag a unit `.json` file onto the popup to import it. Use **Export**
  to write a unit back out as a file; hand that file to another player and they
  drag it in to try your unit.
- **Editing model.** Click a unit to load it into the form. Edits live in a working
  copy: closing the popup or switching to another unit **discards** unsaved changes.
  **Save** is the only commit path.
- **Built-in units are locked.** The vanilla hulls, ground emplacements, and weapons
  are seeded as read-only records (re-healed to canonical on every boot). They can be
  **Cloned** to make an editable copy, but never edited in place or deleted. Custom
  units add **Save** and **Delete**.

## Unit types

There are four types. The second field in the form (**Type**) selects which, and
changing it re-renders the lower fields.

| Type | Deployable? | Registers into | Notes |
| --- | --- | --- | --- |
| `naval` | Yes (placement dropdown) | `SHIP_CLASSES` (`domain:"sea"`) | moving warship; optional **Carrier deck** (`isAirfield`) |
| `ground` | Yes (placement dropdown) | `SHIP_CLASSES` (`domain:"ground"`, `isFixed:true`) | fixed emplacement on land; optional **Airfield** (land or water) |
| `aircraft` | Yes (placement dropdown) | `SHIP_CLASSES` (`domain:"air"`) | squadron entity (HP = plane count); optional carrier-capable / LO / command hub |
| `ammo` | **No** | `MISSILES` | weapon; appears in loadout pickers for platforms whose `launchers` match |

Custom units flow through the same sensor / CEC / engagement / win pipeline as
vanilla units — cross-domain targeting works, and the win condition is unchanged.

## Curated parameters

The editor exposes the meaningful gameplay parameters; advanced internals (doctrine
objects, draft for ground, etc.) are filled from sensible defaults. Ranges shown in
the form are in **nautical miles (NM)** and stored internally in metres.

### Naval
Identity (`name`, English unit tag `prefix`, optional Chinese unit tag `prefixZh`,
optional **Carrier deck** checkbox); Mobility (`cruise`, `max`, `accel`, `decel`,
`turn`, `flank turn`); Sensors (`radar range`, `radar interval`, **RCS**);
Magazine (`VLS cells`, `loadout`); Survivability (`hit points`, `degrade`);
Defense channels (`SAM`, `ciws`); Doctrine (**strike specialist**). Optional
**max parked squadrons** when Carrier deck is enabled.

- **Mobility auto-derivation:** editing **cruise speed** recomputes max speed,
  acceleration, deceleration, and turn rates (higher cruise ⇒ faster and more
  agile). You can still override any of those afterward.
- **Hull dimensions** are not editable — they only scale the map icon and are
  defaulted internally.
- **CIWS hardware** is not editable — a single default mount is used. The
  **CIWS** field under *Defense channels* controls how many incoming missiles
  the close-in layer can engage at once.
- **Carrier deck.** Marks the hull as a moving airfield (`isAirfield`). Only
  airframes with **Carrier capable** may recover here (vanilla `CVN` behaviour).
- **Strike specialist.** Check for arsenal ships / dedicated long-range
  strikers so force fire planning allocates them in the specialist first pass
  (same priority as coastal batteries and strike aircraft). Ordinary multi-role
  destroyers leave it unchecked.

### Ground
Identity (`name`, English unit tag `prefix`, optional Chinese unit tag `prefixZh`,
**map glyph** = `sam`/`radar`/`bunker`/`airfield`, optional **airfield** and
**strike specialist** checkboxes);
Footprint (`length`, `width`); Sensors (`radar range`, `radar interval`, **RCS**);
Magazine (`cells`, `loadout` — leave empty for a pure radar site); Survivability
(`hit points`, `degrade`); Defense channel (`SAM`). Speed and CIWS are forced to zero.
For an anti-ship coastal battery, set the radar range above the weapon's range so it
can engage over the horizon. Tick **Strike specialist** for purpose-built strike
sites (like the vanilla CDB/DEB). Tick **Airfield** for a rearm node placeable on
land or water (vanilla `AFB`). A THAAD-style battery is a ground unit whose
loadout only contains a **hypersonic-only** ammo type (see Ammo).

### Aircraft
Identity (`name`, English unit tag `prefix`, optional Chinese unit tag `prefixZh`,
**command hub**, **strike specialist**, **low-observable**, and **carrier capable**
checkboxes); Squadron (`aircraft in flight` — HP pool: each hit downs one plane);
Mobility (`cruise`, `max`, `accel`, `decel`, `turn`, `flank turn`); Sensors
(`radar range`, `radar interval`, **RCS**); Hardpoints (`hardpoints` — sized like
naval VLS cells, to fit the `loadout`); Endurance (`endurance`, `rearm time`);
Survivability (`speed loss per plane lost`, `flares`).
Squadrons carrying dedicated surface munitions already act as strike specialists
by default; the checkbox forces the same priority for unusual loadouts.

- **Unarmed = never fights.** Empty `loadout` → CAP fallback behind the guide
  (vanilla `AWAC`), not a combat screen.
- **Command hub.** Tightens side CEC share latency while alive and airborne.
- **Low-observable.** Stand-in strike release profile (vanilla F-35 family).
- **Carrier capable.** May recover on a naval Carrier-deck unit (`CVN`).
- **`maxGLoad`** is not yet exposed; custom aircraft inherit a default. It only
  affects combat turns — routine navigation uses a standard-rate turn.

### Ammo
Identity (`ID` only — the loadout key; also the map/inventory label);
Classification (`launchers`, `targets`, `symbol`, `rcs`); Ranges (`max range`,
`pref. min`, `pref. max`, `seeker`); Kinematics (`speed`, `max turn`); Effect
(`cell cost`, `pk`, `salvo`, `per threat`, `reserve`); Timing (`launch interval`,
`salvo spacing`); Behavior (`ring style`, `guidance`, **flight profile**,
**cruise / terminal altitude**, **strategic / deep-strike**, **hypersonic-only
(BMD)**, `retargetable`, `self-destruct on loss`).

`launchers` may include naval, ground, and air. `targets` may include missiles,
aircraft, ships, and ground units. `pk` is the base per-shot success chance
before track quality, geometry, speed, saturation, and countermeasure modifiers.
Loadout pickers only offer ammo whose `launchers` match the platform domain.

- **Strategic / deep-strike.** Reserved raid quota after general ASCMs fill a
  target (also auto-inferred for hypersonic-glide profile or range ≥ 800 NM —
  vanilla Dark Eagle).
- **Flight profile → Hypersonic glide** sets high cruise/terminal altitudes
  (defaults 30 km / 5 km if left at 0) and a non-sea-skim dive.
- **Hypersonic-only (BMD).** Interceptor engages only high-energy /
  hypersonic-profile threats (vanilla `THAAD`). Leave unchecked for ordinary
  SAM/AAM behaviour.

## For developers

- `src/sim/missiles.js` and `src/sim/ships.js` expose the live catalogues plus
  `registerMissile`/`registerShipClass`, `unregisterMissile`/`unregisterShipClass`,
  and `isBuiltinMissile`/`isBuiltinShipClass`. Built-in ids are captured at module
  load and protected from deletion.
- `src/mods/schema.js` is the single source of truth for the editable fields,
  defaults, and validation. Add a parameter here and it appears in the form.
- `src/mods/registry.js` converts editor-JSON ↔ internal spec (both ways) and is
  pure/Node-testable. `src/mods/store.js` owns IndexedDB (with a vanilla-only
  fallback when IndexedDB is absent, e.g. in tests).
- Determinism is preserved: vanilla specs register identically every boot, so the
  known-seed regression suite and the complexity score are unaffected. Custom units
  only enter a battle when explicitly spawned.
- Tests: `tests/mods.test.mjs`.
