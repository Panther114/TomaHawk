# Changelog

All notable changes to this repository will be documented in this file.

## Unreleased

### Added
- **CI**: `.github/workflows/ci.yml` runs `npm test` on every push/PR across Node 20/22 on Linux + Windows. `package.json` now declares `engines.node >= 20`.
- `src/ui/view.js` — pure, DOM-free presentation helpers (coordinate transforms, panel HTML builders, per-ship derived state) extracted from `src/app.js`, with `tests/ui.test.mjs` covering them.
- `scripts/bench.mjs` (`npm run bench`) — reports simulation ticks/sec by battle size and re-verifies determinism.
- A wired-up **RULER** tool (button + `R` shortcut) for on-map range/bearing measurement.

### Changed
- Reworked the dense tactical UI again to remove the top metrics bar, switch the operational display font to Lato, tighten the top-left command corner, and make the tactical feed retractable without increasing the base type scale.
- Hot-path lookups in `src/sim/combat.js` now use per-tick id indexes (`_shipById`, `_missileById`, and the existing `_missilesByTarget`) instead of repeated linear `find`/`filter` scans. Pure lookup change — deterministic output is byte-identical (verified against the pre-change core across multiple seeds and 8-ship battles).
- `src/app.js` slimmed: presentation helpers moved to `src/ui/view.js`; the duplicated `eventSeverity` now comes from the `sim.js` barrel.

### Removed
- Dead `waypoint` tool branch in `src/app.js` (manual steering — out of scope for an observer-only simulation).

### Added (license & docs, earlier in this cycle)
- `LICENSE` — the project is now released under the **PolyForm Noncommercial License 1.0.0** (free for any noncommercial use; commercial use, including resale, is not permitted). `package.json` declares `LicenseRef-PolyForm-Noncommercial-1.0.0`.
- `.gitignore` for `node_modules`, runtime export files, and OS/editor cruft.
- `src/README.md` — source layout and `src/sim/` module map.
- `docs/REFERENCE.md` — the full bilingual product manual moved out of `README.md`.

### Changed
- **Modularized the simulation core.** `src/sim.js` is now a re-export barrel; the implementation lives in focused modules under `src/sim/` (`constants`, `math`, `events`, `missiles`, `ships`, `sensors`, `command`, `movement`, `combat`, `scenario`, `step`). No behavior change — the public API and all 55 tests are unchanged, and deterministic output is byte-identical.
- Slimmed `README.md` to a concise bilingual overview; detailed reference content lives in `docs/REFERENCE.md`. The Chinese section is preserved in full.
- Updated `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/DATA_MODEL.md` to route to the new `src/sim/` modules.
- Relocated the historical dev scratch notes from `progress.md` to `docs/NOTES.md`.

## v0.1

### Release summary
- Establishes the current public baseline for the TomaHawk / 战斧 local naval sandbox.
- Formalizes the repository's current release line as `v0.1`.
- Captures the lightweight Node.js + browser runtime and deterministic simulation core already present in the repository.

### Included in v0.1
- Local static server via `server.mjs` serving the application at `127.0.0.1:4173`.
- Browser-based tactical map UI implemented in `src/app.js` and `src/styles.css`.
- Deterministic naval combat simulation core implemented in `src/sim.js`.
- Seeded scenario creation, setup/running/ended modes, and JSON save/load/AAR export.
- Force-level doctrine, offensive raid planning, defensive missile allocation, and ROE-aware engagement logic.
- Imperfect radar tracks, cooperative force-picture abstraction, and profile-based missile detection behavior.
- Four ship hull categories: `DDG`, `CCG`, `BBG`, and `FFG`.
- Five modeled missile families: `SM-2MR`, `ESSM`, `MaritimeStrike`, `TomahawkBlockV`, and `SM-6`.
- Existing automated regression coverage through `npm test` (`node --test`).
- Expanded top-level documentation in `README.md` for both English and Chinese readers.

### Documentation set for v0.1
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/SIMULATION_ASSUMPTIONS.md`
- `docs/SOURCES.md`
- `docs/ROADMAP.md`

### Notes
- `docs/` contains some forward-looking `v0.2+` design notes; they remain planning/reference material and do not change the current release tag of `v0.1`.
