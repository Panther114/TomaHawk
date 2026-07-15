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

There are three types. The second field in the form (**Type**) selects which, and
changing it re-renders the lower fields.

| Type | Deployable? | Registers into | Notes |
| --- | --- | --- | --- |
| `naval` | Yes (placement dropdown) | `SHIP_CLASSES` (`domain:"sea"`) | a moving warship |
| `ground` | Yes (placement dropdown) | `SHIP_CLASSES` (`domain:"ground"`, `isFixed:true`) | a fixed land emplacement, placed on land |
| `ammo` | **No** | `MISSILES` | a weapon; appears only in the loadout pickers of naval/ground units |

Custom units flow through the same sensor / CEC / engagement / win pipeline as
vanilla units — naval units can target ground units and vice-versa, and the win
condition is unchanged.

## Curated parameters

The editor exposes the meaningful gameplay parameters; advanced internals (doctrine
objects, draft for ground, etc.) are filled from sensible defaults. Ranges shown in
the form are in **nautical miles (NM)** and stored internally in metres.

### Naval
Identity (`name`, English unit tag `prefix`, optional Chinese unit tag `prefixZh`);
Mobility (`cruise`, `max`, `accel`, `decel`,
`turn`, `flank turn`); Sensors (`radar range`, `radar interval`); Magazine
(`VLS cells`, `loadout`); Survivability (`hit points`, `degrade`);
Defense channels (`SAM`, `ciws`); Doctrine (**strike specialist**).

- **Mobility auto-derivation:** editing **cruise speed** recomputes max speed,
  acceleration, deceleration, and turn rates (higher cruise ⇒ faster and more
  agile). You can still override any of those afterward.
- **Hull dimensions** are not editable — they only scale the map icon and are
  defaulted internally.
- **CIWS hardware** is not editable — a single default mount is used. The
  **CIWS** field under *Defense channels* controls how many incoming missiles
  the close-in layer can engage at once.
- **Strike specialist.** Check this for arsenal ships / dedicated long-range
  strikers so force fire planning allocates them in the specialist first pass
  (same priority as coastal batteries and strike aircraft). Ordinary multi-role
  destroyers leave it unchecked.

### Ground
Identity (`name`, English unit tag `prefix`, optional Chinese unit tag `prefixZh`,
**map glyph** = `sam`/`radar`/`bunker`/`airfield`, optional **airfield** and
**strike specialist** checkboxes);
Footprint (`length`, `width`); Sensors (`radar range`, `radar interval`); Magazine
(`cells`, `loadout` — leave empty for a pure radar site); Survivability (`hit points`,
`degrade`); Defense channel (`SAM`). Speed and CIWS are forced to zero.
For an anti-ship coastal battery, set the radar range above the weapon's range so it
can engage over the horizon. Tick **Strike specialist** for purpose-built strike
sites (like the vanilla CDB/DEB) so they receive a first-pass offensive allocation
and are not starved by nearby destroyers; fixed ground units with dedicated
surface munitions also get that pass by default even if the box is left unchecked.

### Aircraft
Identity (`name`, English unit tag `prefix`, optional Chinese unit tag `prefixZh`,
**command hub** and **strike specialist** checkboxes); Squadron
(`aircraft in flight` — the hit-point pool: each hit downs one plane);
Mobility (`cruise`, `max`, `accel`, `decel`, `turn`, `flank turn`); Sensors
(`radar range`, `radar interval`); Hardpoints (`hardpoints` — sized like naval
VLS cells, to fit the `loadout`); Endurance (`endurance`, `rearm time`);
Survivability (`speed loss per plane lost`, `flares`).
Squadrons carrying dedicated surface munitions (Harpoon/JSOW-class) already act as
strike specialists by default; the checkbox forces the same priority for unusual
loadouts if needed.

- **Unarmed = never fights.** Leave the `loadout` empty and the squadron
  automatically falls through every combat branch (no strike weapon, no
  air-to-air missile) to the non-combat fallback: it orbits behind the
  formation guide instead of screening ahead of it, exactly like the built-in
  `AWAC`. No other field needs to change to get this behaviour.
- **Command hub.** Check this box (or leave it unchecked — it defaults off) to
  make the squadron tighten its whole side's CEC track-sharing latency while
  it's alive and airborne (not down for fuel). Any aircraft can carry it, not
  just an AEW&C-styled one — it stacks with, and is independent of, a strike
  or air-superiority loadout.
- **`maxGLoad`** (the airframe's combat turn-rate ceiling) is not yet exposed
  in the editor; custom aircraft inherit a default. It only affects an
  evasive break or an air-to-air merge — routine navigation always flies a
  gentle standard-rate turn regardless of hull.

### Ammo
Identity (`ID` only — the loadout key; it also serves as the weapon's map/inventory
label); Classification (`launchers`, `targets`, `symbol`, `rcs`); Ranges (`max range`, `pref. min`, `pref. max`, `seeker`);
Kinematics (`speed`, `max turn`); Effect (`cell cost`, `pk`, `salvo`,
`per threat`, `reserve`); Timing (`launch interval`, `salvo spacing`); Behavior
(`ring style`, `guidance`, **flight profile**, **cruise / terminal altitude**,
**strategic / deep-strike**, `retargetable`, `self-destruct on loss`).

`launchers` may include naval, ground, and air. `targets` may include missiles,
aircraft, ships, and ground units. `pk` is the base per-shot success chance
before track quality, geometry, speed, saturation, and countermeasure modifiers.

- **Strategic / deep-strike.** When checked, the weapon may use the reserved
  strategic raid quota after general ASCMs have filled a target's normal
  allocation — so a custom LRHW is not starved by nearby destroyers dumping
  shorter-range munitions. Also auto-inferred when flight profile is
  *Hypersonic glide* or max range is ≥ 800 NM (vanilla Dark Eagle).
- **Flight profile → Hypersonic glide** sets a high cruise/terminal altitude
  (defaults 30 km / 5 km if you leave altitudes at 0) and a non-sea-skim
  terminal dive, matching the Dark Eagle abstraction.

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
