# Unit Workshop

The Unit Workshop lets you create ships, ground emplacements, aircraft, and ammo without editing simulation source. Custom records reuse the same sim paths as built-ins; there is no separate “mod rules engine.”

## How to use

1. In the sandbox, open **工具** (Tools) → **单位工坊** (Unit Workshop) at the top right.
2. Select a built-in record and **克隆** (Clone), or create a new unit.
3. Adjust sensors, mobility, durability, capabilities, and loadout.
4. After save, the unit appears in the equipment library immediately.
5. Use **导出** (Export) to share JSON; drag JSON onto the workshop to import.

Built-in records stay read-only and are restored to canonical values on startup. Delete applies only to custom records.

## Four record kinds

- `naval` — surface or subsurface platforms.
- `ground` — fixed emplacements and airfields.
- `aircraft` — aircraft squadrons.
- `ammo` — missiles, torpedoes, or other munitions; not directly deployable.

Ammo fit is constrained by target domain, launch platform, flight profile, and category. The workshop filters obvious incompatibilities; import validation checks again.

## Persistence and compatibility

v1 uses IndexedDB database `tomahawk-mods`, object store `units`, primary key still `kind:id`. On first launch it reads the legacy database, copies all records, verifies the write, then deletes the old database. On migration failure, legacy data is left in place and retried next launch.

JSON shape stays compatible with v0.3. When a custom unit lacks new presentation fields, the equipment library and tactical symbols fall back deterministically from `domain`, `glyph`, and capabilities.

In the browser console, `window.tomahawkMods.dump()` lists loaded records for debugging only.
