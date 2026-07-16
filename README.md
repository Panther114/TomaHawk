<div align="center">

# TomaHawk / 战斧

**Deterministic 2D modern battle sim — browser only, zero dependencies**

[![CI](https://github.com/Panther114/TomaHawk/actions/workflows/ci.yml/badge.svg)](https://github.com/Panther114/TomaHawk/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.3.0-orange)](CHANGELOG.md)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![Tests](https://img.shields.io/badge/tests-245%20passing-brightgreen)](tests)
[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)
[![Lang](https://img.shields.io/badge/lang-EN%20%7C%20%E4%B8%AD%E6%96%87-informational)](#how-to-play--玩法)

Place Blue/Red fleets — ships, coastal batteries, carriers, fighters — press play.
Both sides run the same autonomous AI: radar tracks (not perfect truth), CEC, layered
SAM/CIWS, air strikes, and dogfights. Same seed → same battle, every time.

部署蓝/红双方（舰艇、岸基、航母、战机），按播放。双方同一套自主 AI：雷达航迹（非全知）、
协同交战、分层防空、空中打击与格斗。相同种子 → 完全相同的一局。

[**Deploy**](https://railway.app/new/template?templateUrl=https://github.com/Panther114/TomaHawk) ·
[Quick start](#quick-start--快速开始) ·
[Play](#how-to-play--玩法) ·
[Docs](#docs--文档)

<img src="docs/screenshots/battle-overview.png" alt="Naval and air engagement" width="820">

</div>

---

## What it is / 这是什么

| | English | 中文 |
| --- | --- | --- |
| AI | Both sides fully autonomous | 双方完全自主 |
| Sensors | Tracks with quality/age; RCS + radar horizon | 带质量/时效的航迹；RCS + 雷达地平线 |
| CEC | Shared force picture; engage-on-remote | 共享态势；可接战队友航迹 |
| Defense | SAM channels + terminal CIWS; saturation leaks | 防空通道 + 末端近防；饱和可漏防 |
| Air | Strike profile, A2A, RTB/rearm at AFB or **CVN** | 突防剖面、空战、返场/再装挂（机场或**航母**） |
| BMD | **THAAD** — hypersonic/BM intercept only | **萨德** — 仅拦高超/弹道类 |
| Mods | Unit Workshop (JSON, browser storage) | 单位工坊（JSON，本地存储） |
| Stack | Node ≥20, no `npm install`, no bundler | 零依赖，无需安装包 |

---

## Quick start / 快速开始

```bash
npm start    # http://127.0.0.1:4172
npm test     # 245 deterministic tests
```

Windows: double-click `quickrun.bat` (frees port 4172, opens browser).  
Windows：双击 `quickrun.bat`。

Empty East China Sea setup loads first. Place ≥1 Blue **and** ≥1 Red unit, then `Space` / `▶`.  
先打开空东海想定；双方各放至少一个单位，再按 `Space` / `▶`。

**Railway:** one-click button above. Hosted SAVE downloads a file; LOAD imports it.  
**Railway：** 上方一键部署。托管端 SAVE 下载文件，LOAD 导入。

---

## How to play / 玩法

### Modes / 状态

| Mode | English | 中文 |
| --- | --- | --- |
| **setup** | Place / drag / delete; pick map | 部署、拖动、删除；选地图 |
| **running** | AI fights; pause / speed only | AI 交战；只能暂停/调速 |
| **ended** | One side wiped **or** mutual exhaustion draw | 一方全灭 **或** 双方弹尽和局 |

Win: last side with living units (in-flight missiles don't count).  
胜：还有存活单位的一方（飞行中的导弹不算单位）。

### Setup / 部署

1. **BLUE** / **RED** → class dropdown → left-click map.  
2. **Naval** on water; **ground** on land; **AFB** land or water; **CVN** water only.  
3. Left-drag move · right-click select · box-select on empty water · `Del` delete.  
4. Map: **East China Sea** (coastline) or **Open Sea**. Setup only.  
5. **Unit Workshop** (folder icon): custom units/weapons as JSON.

中文要点：蓝/红 → 选类型 → 左键放置；舰在水、陆基在陆、机场水陆皆可、航母仅水；工坊做自定义单位。

### Controls / 操作

| Key | Action |
| --- | --- |
| `Space` | Play / pause (starts from setup) |
| `Esc` | Cancel tool / clear selection |
| `R` | Ruler (again = clear) |
| `Tab` | Next unit |
| `` ` `` | Toggle event feed |
| `Del` | Delete selection (setup) |
| Mid-mouse / `Alt`+drag | Pan · wheel zoom |
| Speed slider | 1×–60× |
| `SAVE` / `LOAD` / `AAR` | Scenario JSON / after-action |
| 中/EN | Language |

Map toggles (`GRID` `TRACKS` `RADAR` `WEZ` `WEAPONS`) are display-only.  
地图开关只影响显示。

---

## Order of battle / 兵力表

### Naval / 海上

| ID | Class (approx.) | VLS | kt | Notes |
| --- | --- | ---: | ---: | --- |
| `DDG` | Arleigh Burke IIA | 96 | 31 | general purpose |
| `CCG` | Ticonderoga | 122 | 32.5 | AAW heavy |
| `BBG` | Arsenal concept | 288 | 24 | huge magazine |
| `FFG` | Constellation | 32 | 26 | light |
| `CVN` | Nimitz/Ford | 24 | 30 | **carrier** — moving airfield for carrier-capable air |

### Ground / 陆基

| ID | Role | Radar | Weapons |
| --- | --- | ---: | --- |
| `SAM` | coastal AA | 160 nm | SM-2 / SM-6 / ESSM |
| `THAAD` | **hypersonic/BM only** | 500 nm | THAAD×48 (never vs cruise/aircraft) |
| `CDB` | coastal strike | 250 nm | MSTK / TLAM |
| `DEB` | Dark Eagle | 500 nm | LRHW×8 |
| `EWR` | early warning | 400 nm | — |
| `AFB` | airfield (land/water) | 180 nm | rearm/refuel node |

### Air / 空中

One entity = a flight (HP = planes left). Loadouts are rigid by role.

| ID | Role | Radar | Loadout | Carrier |
| --- | --- | ---: | --- | --- |
| `F22` | 5th A2A (Raptor) | 130 | 120D + 9X | no |
| `F35A` | 5th ground strike | 120 | 120D + 9X + JSOW | no |
| `F35C` | 5th anti-ship | 120 | 120D + 9X + Harpoon | **yes** |
| `F15C` | 4th A2A | 100 | 120C + 9X | no |
| `F15E` | 4th ground strike | 95 | 120C + 9X + JSOW | no |
| `F15N` | 4th anti-ship (fictional) | 95 | 120C + 9X + Harpoon | **yes** |
| `F15EX` | multirole | 115 | 120D + 9X + JSOW + Harpoon | no |
| `F16V` | light multirole | 85 | 120C + 9X + JSOW | no |
| `AWAC` | AEW&C / command hub | 350 | unarmed | **yes** |

5th-gen = low RCS. `AWAC` orbits rear and speeds up CEC while airborne.  
Carrier-capable air recover on **CVN**; all air can use **AFB**.  
5 代低可探测；舰载机型可上航母，所有机队可用机场。

### Weapons / 武器

| ID | Label | Role | Range |
| --- | --- | --- | ---: |
| `SM-2MR` | SM2 | fleet SAM | 167 km |
| `ESSM` | ESSM | short SAM (quad) | 52 km |
| `SM-6` | SM6 | dual-role AA / ASuW | 370 km |
| `THAAD` | THAAD | high-alt BMD vs hypersonic only | 204 km |
| `MaritimeStrike` | MSTK | ASCM | 222 km |
| `TomahawkBlockV` | TLAM | long strike | 1,204 km |
| `DarkEagle` | LRHW | ground hypersonic | 2,778 km |
| `AIM-120C` / `D` | 120C / 120D | BVR AAM | 102 / 152 km |
| `AIM-9X` | AIM9 | WVR IR (flare-decoyable) | 33 km |
| `AGM-84` | HPN | air anti-ship | 124 km |
| `AGM-154` | JSOW | air anti-ground | 130 km |

Values are open-source simulation envelopes, not classified data.  
数据为开源近似包线，非涉密数据。

---

## How the AI fights / AI 如何作战

Short version — details: [`docs/SIMULATION_ASSUMPTIONS.md`](docs/SIMULATION_ASSUMPTIONS.md).

1. **Tracks, not truth** — quality / uncertainty / age; RCS + horizon scale detection.  
2. **CEC** — side fuses sensors; engage-on-remote with short network delay.  
3. **Command** — OTC / AAWC auto-picked; AAW sectors; screen stations.  
4. **Posture** — `survive` → `focus` → `pressure` → `saturate` from observed advantage.  
5. **Layered AAW** — shared SAM channels + CIWS; massed salvos leak.  
6. **THAAD** — only high-energy threats (e.g. Dark Eagle); SM-6 is the naval fallback.  
7. **Air** — stand-off strike, LO ingress when applicable, A2A, flares, RTB when winchester/bingo/unemployable.  
8. **ROE** — free / tight / hold; self-defense always on.  
9. **Damage** — ship hits degrade random subsystems; air hits remove one plane.  
10. **End** — wipe **or** mutual offensive exhaustion (draw).

中文：航迹非真值；CEC 共享；OTC/扇区；姿态四档；分层防空；萨德只拦高超；飞机防区外打击/返场；交战规则；子系统损伤；全灭或弹尽和局。

**Tips:** concentrate ships (CEC + channels) · protect EWR/AFB/CVN · don’t burn SM-6 for strike · coastlines block ships · same seed = same battle.

建议：编队集中 · 护雷达/机场/航母 · 勿滥用 SM-6 进攻 · 注意陆地 · 同种子同结果。

---

## Modding / 模组

Folder icon → **Unit Workshop**: create/edit naval, ground, aircraft, ammo as JSON
(IndexedDB; export to share). Built-ins are locked — clone to edit.

左上角文件夹 → **单位工坊**。内置只读，克隆后可改。详见 [`docs/MODDING.md`](docs/MODDING.md)。

---

## Development / 开发

| Command | Purpose |
| --- | --- |
| `npm start` | Serve app |
| `npm test` | Full suite (245) |
| `npm run bench` | Determinism + complexity score (must stay ~linear) |
| `npm run debug:sim` | Headless battle logs → `debug/` |
| `node scripts/verify-battles.mjs` | Multi-scenario long runs |

Sim core (`src/sim/`) is deterministic: one seeded PRNG, no `Math.random`/`Date.now` on the hot path. After sim changes, run `npm test` and check the bench complexity score.

仿真核心确定性：单一种子 PRNG。改 `src/sim/` 后务必跑测试与 bench。

Start coding: [`src/README.md`](src/README.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · agents: [`AGENTS.md`](AGENTS.md).

---

## Docs / 文档

| File | Content |
| --- | --- |
| [`docs/REFERENCE.md`](docs/REFERENCE.md) | Full bilingual manual |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Module split |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Fields / shapes |
| [`docs/SIMULATION_ASSUMPTIONS.md`](docs/SIMULATION_ASSUMPTIONS.md) | Doctrine / physics model |
| [`docs/MODDING.md`](docs/MODDING.md) | Workshop fields |
| [`docs/MAP_DATA.md`](docs/MAP_DATA.md) | Coastline data |
| [`docs/SOURCES.md`](docs/SOURCES.md) | Public sources |
| [`CHANGELOG.md`](CHANGELOG.md) | Releases |

```text
src/sim/     simulation core (barrel: sim.js)
src/app.js   canvas UI / controls
src/ui/      i18n, view helpers
src/mods/    Unit Workshop
src/world/   terrain / maps
tests/       node --test
```

---

## License / 许可

**PolyForm Noncommercial 1.0.0** — see [`LICENSE`](LICENSE).  
Free for noncommercial use; **no commercial use**. Source-available, not OSI “open source.”

非商业自由使用；**禁止商业用途**。
