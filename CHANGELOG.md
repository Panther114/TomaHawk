# Changelog

All notable changes to this repository will be documented in this file.
本文件记录仓库的全部重要变更。

## Unreleased

### Added — Unit modding system / 单位自定义系统
- **Unit Workshop.** A new folder-icon button beside the language toggle opens a dense editor popup: a lockable unit list on the left, and a curated, schema-driven parameter form on the right (empty until a unit is selected). Edits live in a working copy — closing the popup or switching units discards unsaved changes; **Save** is the only commit path.
- **Three unit types.** `naval` and `ground` units are deployable from the placement dropdown; `ammo` units are not deployable and instead populate the loadout pickers of naval/ground units. Selecting a type re-renders the lower fields from that type's schema.
- **Self-contained JSON units, permanently stored in the browser.** Each unit is a self-contained JSON record kept in IndexedDB (no Downloads/Desktop, no server changes — works identically for local runs and the cloud build). Drag a unit `.json` onto the popup to import it; **Export** writes a unit back out as a file to share.
- **Vanilla units are locked, not deletable.** All built-in hulls, ground emplacements, and weapons are seeded into the store as read-only records and re-healed to canonical values on every boot. They render read-only with a **Clone** action; custom units add **Save**/**Delete**.
- **Live registries.** `MISSILES` and `SHIP_CLASSES` are now mutable registries (not frozen) with `registerMissile`/`registerShipClass` (+ `isBuiltin…`/`unregister…`). Custom units flow through the existing sensor/CEC/engagement/win pipeline with no parallel code path. Ground units carry an explicit `glyph` (`sam`/`radar`/`bunker`) so custom emplacements pick a map symbol.
- 单位工坊：语言切换按钮旁的文件夹图标打开一个紧凑编辑器；左侧为可锁定的单位列表，右侧为按类型生成的参数表单。未保存的修改在切换或关闭时丢弃，只有“保存”会提交。共三种类型：`naval`/`ground` 可部署，`ammo` 仅用于载弹配置。每个单位是存于浏览器 IndexedDB 的自包含 JSON，可拖入导入、导出分享；内置单位只读且不可删除。

### Changed
- `MISSILES` / `SHIP_CLASSES` changed from frozen objects to live registries; all built-in values are preserved exactly, so the deterministic regression suite and complexity score are unchanged (138 tests pass; complexity score ≈0.95).
- **Removed the strike-cell concept.** `vlsStrikeCells` is gone from the model, the editor, and saved scenarios: every missile now draws from one shared VLS pool by its `cellCost`. Vanilla default loadouts are byte-identical (the old cap never bound any built-in hull), so determinism is unaffected. / 移除“打击单元”概念：所有导弹共用同一垂发容量。

### Removed
- Naval editor: the **Hull** (length/beam/draft/displacement), **CIWS hardware**, and **Strike cells** fields — all defaulted internally to keep the form lean. Mobility fields now auto-derive from cruise speed. Ammo identity is reduced to **ID** (the weapon labels itself with its ID).

## v0.2

### Release summary
- Second public release of the TomaHawk / 战斧 local naval sandbox. It collects every change made since `v0.1`: a geographic terrain layer, terrain-aware navigation, fixed land-based unit types, a fully bilingual UI, Railway deployment, a modularized simulation core, and a machine-independent performance-regression guard.
- The simulation remains deterministic, dependency-light, and build-step-free; everything below was verified through `npm test` and the determinism check in `npm run bench`.

### Added — Terrain and maps
- **Tactical maps with a real coastline.** A selectable **East China Sea** layer renders locally bundled Natural Earth 1:10m land and coastline data in a regional azimuthal-equidistant projection, alongside the original border-less **Open Sea** layer. Map selection is a setup-only control.
- **Shared world geometry.** `src/world/map-spec.js` and `src/world/terrain.js` own the map dimensions, projection, and binary water/land queries consumed by both the renderer and the simulation. The tactical world was expanded to nine times the core map width and 9.6 times its height, and the camera now clamps to that rigid border instead of zooming past it.
- **Kilometre scale UI.** Map coordinates, a 20 km grid, a dynamic scale bar, rulers, and visible weapon ranges all read in kilometres; internal simulation distances stay in metres.
- `docs/MAP_DATA.md` records the Natural Earth provenance and the `npm run map:data` regeneration step.

### Added — Terrain-aware navigation
- Ship movement now treats terrain as a binary navigability problem (water vs. not-water). Ships plan deterministic coastal detours around land, fall back to stopping/replanning at the last safe water point rather than crossing a coastline, and reuse a blocked-route plan for its cache window.
- Setup placement enforces terrain: **sea units must be placed on water** and snap back to the last valid water position when dragged onto land.

### Added — Ground-based unit types
- **Three fixed, land-based emplacements** modeled as stationary ship-entities so they flow through the existing sensor / CEC / engagement / win pipeline:
  - **SAM** — coastal surface-to-air battery (area + point interceptors).
  - **CDB** — coastal anti-ship defence battery with an over-the-horizon targeting radar.
  - **EWR** — early-warning radar with a long search range and no weapons.
- Ground units **must be placed on land** (and on terrain maps are rejected on water); they never move, are never chosen as the formation guide, and are never re-seated to water on restore or map change.
- **Cross-domain cooperation works both ways:** a ground radar feeds the fleet's cooperative (CEC) picture and a ship can engage on a ground unit's remote track; naval anti-ship fire targets and destroys enemy ground units, and a coastal SAM defends nearby friendly ships.
- The Force Inventory now groups each faction into a **naval sub-table and a ground sub-table** with their own column headers and unique unit tags (`SAM-`, `CDB-`, `EWR-`), and ground units render as distinct map glyphs (SAM triangle, EWR diamond + sweep, battery bunker).

### Added — UI, i18n, and deployment
- **Full English/Chinese (中文) UI** with a one-click language toggle covering panels, controls, ship/role labels, and the tactical event log (including localized clipboard export).
- A wired-up **RULER** tool (button + `R`) that supports multiple simultaneous range/bearing measurements.
- **One-click Railway deployment**: a root `railway.json`, `PORT` binding, and a `/health` endpoint, with local `npm start` unchanged.
- Overlapping weapon-range rings of the **same weapon type and faction** now render as a single union outline (internal arcs removed) instead of a tangle of crossing circles. Style, colour, and dash are unchanged; rings of different types or factions are never merged.

### Added — Tooling, tests, and license
- **Modularized simulation core**: `src/sim.js` is a re-export barrel; the implementation lives in focused modules under `src/sim/` (`constants`, `math`, `events`, `missiles`, `ships`, `sensors`, `command`, `movement`, `combat`, `scenario`, `step`).
- `src/ui/view.js` — pure, DOM-free presentation helpers (coordinate transforms, panel HTML builders, per-ship derived state), unit-tested in `tests/ui.test.mjs`.
- **Benchmarks**: `npm run bench` reports ticks/sec by battle size plus a determinism check and a terrain-route case; `npm run bench:frontend` measures dense rendering helpers.
- **Machine-independent performance-regression guard**: `scripts/perf-harness.mjs` produces a *complexity score* (the ratio of per-tick cost at two force sizes; ~1.0 linear, ~5.0 quadratic), asserted under a ceiling by `tests/performance-regressions.test.mjs` so an accidental O(n²) hot loop fails CI.
- **CI**: `.github/workflows/ci.yml` runs `npm test` on every push/PR across Node 20/22 on Linux + Windows; `package.json` declares `engines.node >= 20`.
- **License**: released under the **PolyForm Noncommercial License 1.0.0** (free for any noncommercial use; commercial use is not permitted). `package.json` declares `LicenseRef-PolyForm-Noncommercial-1.0.0`.

### Changed
- **Real-scale ship motion** (`SHIP_SPEED_MULTIPLIER = 1`): tempo now comes from the UI sim-rate (time-compression) control rather than inflated platform speed.
- The coastal defence battery's targeting radar was widened to an over-the-horizon range so its long anti-ship missiles are usable at standoff instead of leaving the battery blind and passive beyond a short radar.
- Hot-path lookups use persistent per-tick id indexes; track ageing is lazy with an expiry heap; the cooperative force picture refreshes on a bounded cadence with incremental dirty updates. All verified deterministic (byte-identical event streams).
- Repeated UI passes tightened the dense tactical layout (retractable feed, compact inventory and detail cards, side-coloured emphasis) without raising the base type scale.
- `README.md` was slimmed to a concise bilingual overview; the full manual lives in `docs/REFERENCE.md`.

### Fixed
- Each launched missile now stores an immutable `launchRole`, so an SM-6 keeps the correct square/triangle icon and anti-ship/anti-air behaviour for its whole flight.
- Duplicating a ground emplacement keeps the copy on land instead of letting its offset spill into the sea.

### Documentation
- Reorganized and refreshed the documentation set for `v0.2`: `README.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SIMULATION_ASSUMPTIONS.md`, `docs/MAP_DATA.md`, `docs/ROADMAP.md`, `src/README.md`, and `AGENTS.md`.

---

### 中文摘要（v0.2）

- **第二个公开版本**，汇总自 `v0.1` 以来的全部改动：地理地形图层、地形感知导航、固定式陆基单位、完整中英双语界面、Railway 部署、模块化仿真核心，以及与机器无关的性能回归护栏。仿真保持确定性、低依赖、零构建步骤，以上改动均通过 `npm test` 与 `npm run bench` 的确定性校验。
- **地形与地图**：新增可选的**东海**图层，使用本地打包的 Natural Earth 1:10m 陆地/海岸线数据与等距方位投影，与原**开放海域**图层并存（仅在 `setup` 阶段切换）。共享世界几何位于 `src/world/`，世界范围扩展为核心地图的九倍宽、9.6 倍高，相机硬边界限制。坐标、20 公里网格、比例尺、标尺与可见射程统一以公里显示，内部仍以米计算。
- **地形感知导航**：舰艇将地形视为“水/非水”的二元可航问题，会绕行确定性的沿岸航线，必要时在最后安全水域停车重规划，而不会穿越陆地；海上单位只能部署在水面。
- **陆基单位**：新增三种固定式陆基阵地——**SAM**（岸基防空）、**CDB**（带超视距目标雷达的岸基反舰）、**EWR**（远程预警雷达，无武器）。它们必须部署在陆地、不移动、不担任编队指挥、不会被重置到水面；陆海双向协同：陆基雷达馈送 CEC 态势、舰艇可凭陆基远程航迹开火，舰载反舰火力可摧毁敌方陆基单位，岸基防空可保护友邻舰艇。编队列表按阵营拆分为**海上子表与陆基子表**（各自列头与唯一单位标签），陆基单位以独立图标渲染。
- **界面、双语与部署**：完整中英双语界面与一键切换（含本地化日志导出）；可保留多条测量线的 `标尺` 工具；Railway 一键部署（`railway.json`、`PORT` 绑定、`/health` 健康检查）；**同武器类型且同阵营**的重叠射程圈合并为单一外轮廓（去除内部弧线），不改变线型/颜色/虚线，跨类型或跨阵营不合并。
- **工具、测试与许可**：模块化仿真核心（`src/sim.js` 为汇总导出）；纯展示层 `src/ui/view.js`（`tests/ui.test.mjs` 覆盖）；基准测试 `npm run bench` 与 `npm run bench:frontend`；与机器无关的**复杂度评分**性能回归护栏（`scripts/perf-harness.mjs` + `tests/performance-regressions.test.mjs`，约 1.0 为线性、约 5.0 为二次，超阈值即 CI 失败）；CI 工作流；采用 **PolyForm 非商业许可证 1.0.0**。
- **变更与修复**：真实比例舰艇运动；CDB 目标雷达扩展为超视距，使其远程反舰武器在防区外可用；持续的界面紧凑化；每枚导弹固定记录 `launchRole`（修复 SM-6 图标/行为）；复制陆基阵地时副本保持在陆地。

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
