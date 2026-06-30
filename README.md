# TomaHawk / 战斧 Naval Sandbox

**Current release:** `v0.3` (`package.json` version `0.3.0`)

TomaHawk (in-app name **战斧**) is a deterministic 2D browser simulation of modern
surface warfare: task-group missile combat, imperfect radar tracks, coordinated
force-level decision-making, and a compact tactical-map UI inspired by DCS-style
map views. It ships as a dependency-light JavaScript app — a tiny Node static
server hosts it locally, and the simulation core runs as plain ES modules
validated with Node's built-in test runner. **No build step.**

TomaHawk 是一个本地优先、二维、确定性的现代海战战术沙盘（应用内名称 **战斧**）：编队导弹
攻防、带不确定性的雷达航迹、力量级别的协同决策，以及紧凑的战术地图界面。项目零打包步骤，
使用原生 ES 模块，由极小的 Node 静态服务在本地托管。

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?templateUrl=https://github.com/Panther114/TomaHawk)

---

## Quick start / 快速开始

Requirements: a modern Node.js (ES module support) and a desktop browser. There
are **no package dependencies**, so no install step is required. The optional
refresh command regenerates the bundled Natural Earth coastline asset before
starting the server.
要求：支持 ES 模块的现代 Node.js 与桌面浏览器；无软件包依赖，无需安装步骤。可选刷新命令会在
启动服务前重新生成内置的 Natural Earth 海岸线数据。

```bash
npm start      # serve at http://127.0.0.1:4172
npm run refresh:start  # refresh Natural Earth data, then serve
npm test       # run the deterministic test suite (node --test)
```

The tactical world is nine times the original East China Sea view in width and
9.6 times in height. Its rigid camera boundary, simulation bounds, and
generated Natural Earth crop are all derived from the shared map dimensions.
/ 战术世界的宽度为原东海视图的九倍、高度为 9.6 倍；相机硬边界、模拟边界与生成的
Natural Earth 裁剪范围都由共享地图尺寸自动派生。

On Windows you can also double-click `quickrun.bat`: it frees port `4172`, starts
a fresh server, and opens the browser automatically.
Windows 用户也可双击 `quickrun.bat`：释放 `4172` 端口、启动服务并自动打开浏览器。

## Railway deployment / Railway 部署

TomaHawk is now ready for one-click Railway deployment via the button above. The
repository includes a root `railway.json`, starts with the existing `npm start`
script, binds to Railway's injected `PORT`, and exposes a `/health` endpoint for
platform health checks. Local development stays unchanged: `npm start` still
serves the app directly with no build step.

TomaHawk 现已支持通过上方按钮一键部署到 Railway。仓库根目录包含 `railway.json`，沿用现有
`npm start` 启动脚本，兼容 Railway 注入的 `PORT`，并提供 `/health` 健康检查端点；本地开发流程
保持不变，仍然是零构建步骤直接 `npm start`。

## Repository layout / 仓库结构

```text
./
├── README.md            # this concise overview / 本概览
├── CHANGELOG.md         # release history / 版本记录
├── LICENSE              # PolyForm Noncommercial 1.0.0
├── package.json
├── server.mjs           # local + Railway static server / 本地与 Railway 静态服务
├── railway.json         # Railway one-click deploy config
├── index.html           # UI shell + DOM ids
├── quickrun.bat         # Windows one-click launcher
├── src/
│   ├── README.md        # module map for src/ — read this first
│   ├── app.js           # rendering, input, panels, sim controls
│   ├── styles.css
│   ├── sim.js           # barrel: re-exports the simulation core
│   └── sim/             # the deterministic simulation core (11 modules)
│       ├── constants.js  math.js      events.js
│       ├── missiles.js   ships.js     sensors.js
│       ├── command.js    movement.js  combat.js
│       └── scenario.js   step.js
├── scripts/                  # bench.mjs, bench-frontend.mjs, perf-harness.mjs, map:data
├── tests/                    # node --test suite (sim, ui, ground-units, perf, maps, …)
└── docs/
    ├── REFERENCE.md            # full bilingual manual / 完整中英手册
    ├── ARCHITECTURE.md         # module boundaries, rendering/sim split
    ├── DATA_MODEL.md           # object shapes and field meanings
    ├── SIMULATION_ASSUMPTIONS.md
    ├── MAP_DATA.md             # Natural Earth provenance + regeneration
    ├── SOURCES.md              # public-source references and data policy
    ├── ROADMAP.md              # current status / future ideas
    └── NOTES.md                # historical dev notes
```

## What it does (at a glance) / 能力概览

- Deterministic seeded `setup` → `running` → `ended` scenarios, real-scale ship motion.
- A selectable geographic **East China Sea** coastline layer (Natural Earth 1:10m)
  alongside the border-less **Open Sea**, with kilometre coordinates and scale bar.
- Binary water-vs-land terrain handling: sea units must be placed on water, ground
  units on land, map changes are setup-only, and ships re-route along the coast or
  stop rather than crossing land.
- Imperfect radar tracks fused into a cooperative (CEC-style) force picture.
- Force-level command posture, offensive raid planning, and layered defensive
  fire allocation (area / point / CIWS), with `free` / `tight` / `hold` ROE.
- Four naval hulls (`DDG`, `CCG`, `BBG`, `FFG`) plus three fixed land emplacements
  (`SAM`, `CDB`, `EWR`), and five missiles
  (`SM-2MR`, `ESSM`, `MaritimeStrike`, `TomahawkBlockV`, `SM-6`).
- Overlapping same-type, same-faction weapon-range rings merge into a single
  coverage outline; full English/中文 UI with a one-click language toggle.
- Save/load, after-action export, and copyable tactical logs.

For the full capability list, data-model tables, simulation concepts, and the
complete operator/controls guide (English + 中文), see
**[`docs/REFERENCE.md`](docs/REFERENCE.md)**.
完整能力、数据模型、仿真概念与操作手册（中英双语）见 **[`docs/REFERENCE.md`](docs/REFERENCE.md)**。

## Documentation index / 文档索引

- [`src/README.md`](src/README.md) — source layout and module map (start here to navigate the code).
- [`docs/REFERENCE.md`](docs/REFERENCE.md) — full bilingual product manual.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — runtime structure, module boundaries, rendering layers.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — object shapes, unit conventions, ship/missile fields.
- [`docs/SIMULATION_ASSUMPTIONS.md`](docs/SIMULATION_ASSUMPTIONS.md) — modeling assumptions and abstraction policy.
- [`docs/MAP_DATA.md`](docs/MAP_DATA.md) — Natural Earth provenance, projection, and regeneration.
- [`docs/SOURCES.md`](docs/SOURCES.md) — public-source references and data policy.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — current capability status and forward-looking ideas.
- [`CHANGELOG.md`](CHANGELOG.md) — release history (`v0.1` → `v0.3`).
- [`AGENTS.md`](AGENTS.md) — navigation guide for AI coding agents.

## License / 许可

Licensed under the **PolyForm Noncommercial License 1.0.0** — see
[`LICENSE`](LICENSE).

You may freely use, copy, modify, and redistribute this software for any
**noncommercial** purpose (personal, hobby, research, education, and other
noncommercial organizations). **Commercial use — including selling the software
or any derivative — is not permitted.** Note that this is a *source-available*
noncommercial license, not an OSI-approved "open source" license (OSI licenses
must permit commercial use).

本项目采用 **PolyForm Noncommercial License 1.0.0**（见 [`LICENSE`](LICENSE)）。允许出于任何
**非商业**目的自由使用、复制、修改与再分发（个人、爱好、研究、教育及其他非营利组织）；**不允许
任何商业用途，包括出售本软件或其衍生作品。** 请注意：这是一份*源代码可见*的非商业许可证，并非
OSI 认证的“开源”许可证（OSI 许可证必须允许商业使用）。
