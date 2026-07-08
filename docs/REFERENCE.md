# TomaHawk / 战斧 — Full Reference / 完整参考手册

Detailed bilingual manual for the `v0.3` release. The top-level `README.md` is a
concise overview; this file holds the full capability, architecture, data-model,
and operator detail. 顶层 `README.md` 为简明概览，本文件提供完整的能力、架构、数据模型与操作细节。

---

## English

### 1. Project overview

TomaHawk models a compact but technically structured modern battle simulator:

- deterministic seeded simulation,
- force-on-force Blue/Red combat across sea, ground, and air units,
- unit placement and scenario editing in setup mode,
- imperfect radar-derived tracks instead of omniscient targeting,
- offensive and defensive missile planning at force level,
- cooperative engagement and shared track abstraction,
- save/load plus after-action export,
- tactical-map UI with dense overlays, logs, and fleet inventory panels.

The project is intentionally local and dependency-light so it remains easy to
inspect, extend, and eventually replace with a lower-level simulation core if
desired.

### 2. Core capabilities in `v0.3`

#### Simulation and doctrine
- Deterministic simulation loop with seeded RNG.
- Scenario modes: `setup`, `running`, `ended`.
- Real-scale ship motion (`SHIP_SPEED_MULTIPLIER = 1`) with acceleration, deceleration, and turn-rate limits.
- Autonomous doctrine for both sides.
- Force-level command posture, offensive fire planning, and defensive fire allocation.
- Rules of engagement (`free`, `tight`, `hold`) with self-defense always permitted.

#### Terrain, maps, and ground forces
- Selectable tactical maps: a border-less **Open Sea** and a projected global coastline layer (Natural Earth 1:50m).
- Binary water/land terrain shared by the renderer and the simulation: coastal detour navigation, swept-segment land-collision guards, and placement validation.
- Four fixed land-based emplacement types — **SAM** (coastal air defence), **CDB** (coastal anti-ship battery with an over-the-horizon targeting radar), **DEB** (Dark Eagle hypersonic strike battery), and **EWR** (long-range early-warning radar) — that sense, share, fire, and are targeted through the same pipeline as ships, but never move.

#### Sensors and information quality
- Radar-generated tracks with quality, uncertainty, age, and source metadata.
- Shared cooperative force picture rather than direct truth access.
- Missile detection envelopes that vary by flight profile.
- Dead-track pruning and age-based track degradation.

#### Weapons and combat resolution
- Surface-strike weapons: `MaritimeStrike`, `TomahawkBlockV`, `DarkEagle`.
- Air/missile defense weapons: `SM-2MR`, `ESSM`.
- Dual-role weapon: `SM-6`.
- Paced launch queues, salvo spacing, launch cooldowns, and defensive-priority scheduling.
- Velocity-lead guidance, terminal seeker behavior, and self-destruct on target loss.
- Layered defense including area defense, point defense, and CIWS.
- Mission-kill style ship damage with subsystem degradation.

#### User interface and workflow
- Full-screen tactical map canvas.
- Grid, tracks, radar, WEZ, and missile visibility filters.
- Tactical-map unit symbols are icon-only; ship, track, and missile identifiers are kept out of the canvas layer.
- Ship names stay visible on the map and in the fleet inventory, using localized hull names plus the ship number.
- Weapon range labels show the weapon name only; numeric distance text is omitted.
- Ship-class placement controls.
- Fleet inventory panel and compact event log.
- Save, load, AAR export, and tactical-feed copy actions.
- Right-click selection and multi-ship detail overlays.
- Ship detail headings use a single localized hull prefix plus the ship number, and detail rows show a localized subsystem name, a centered status bar, and a percentage only.
- Tactical-feed and ship-detail headings and rows render at an effective 10px in Chrome and Edge; other DOM labels use a 14px source minimum so Chrome matches Edge profiles configured with a 14px minimum font size.
- Tactical-feed display and clipboard exports use the active language, avoid duplicate side labels, and describe approximate opposing destroyers as `enemy DDG` / `敌方 DDG`.
- The ruler supports multiple measurements; clicking `RULER` again clears all measurements and exits ruler mode.
- The inventory uses the same effective 10px system UI typography as ship detail cards, with a narrower and shorter panel footprint.
- Inventory and detail-panel DOM is retained between animation frames when its content has not changed, so controls remain clickable during continuous rendering.
- The left setup controls are grouped under `SHIP SPAWNING`; map selection currently offers Open Sea and a global coastline layer.
- Ship direction arrows stay hidden during setup and appear when the battle starts; initial blue headings face left and red headings face right.
- Moving ships use short dashed heading arrows instead of waypoint lines and destination squares.
- The coastline layer uses locally bundled Natural Earth 1:50m global land/coastline data in an equirectangular projection and fills the viewport without stretching. The tactical map and simulation bounds cover the full globe, and terrain drawing culls land/coast paths to the current viewport before rendering.
- Map coordinates, the 20 km grid, dynamic scale bar, rulers, and visible weapon ranges use kilometers. Internal simulation distances remain meters.
- Weapon and missile text is hidden at wide zoom while circles and symbols remain; ship names stay fully opaque.

### 3. Technical architecture

#### Runtime split
- **`src/sim/` (behind the `src/sim.js` barrel)**: simulation state, ship/missile definitions, sensor logic, force picture, fleet command, missile planning, movement, damage, serialization, export. See `src/README.md` for the per-module map.
- **`src/app.js`**: canvas rendering, input handling, selection model, camera logic, panel rendering, UI controls, save/load wiring, clipboard/export actions.
- **`server.mjs`**: tiny Node HTTP server for local static hosting.
- **`tests/sim.test.mjs`**: rules-level and regression-style coverage for deterministic behavior and UI/documented defaults.

#### Execution model
- No bundler.
- No framework dependency.
- Native ES modules in browser and Node.
- Static assets served directly from repository files.
- Testing uses `node --test`.

### 4. Data model and gameplay entities

#### Ship classes
Current hull catalog in `src/sim/ships.js`:

| Hull | Approximate class | VLS cells | Max speed | Role emphasis |
| --- | --- | ---: | ---: | --- |
| `DDG` | Arleigh Burke Flight IIA approx. | 96 | 31 kn | balanced destroyer baseline |
| `CCG` | Ticonderoga-class cruiser approx. | 122 | 32.5 kn | heavier area air defense |
| `BBG` | arsenal battleship concept approx. | 288 | 24 kn | extreme magazine depth |
| `FFG` | Constellation-class frigate approx. | 32 | 26 kn | lighter, agile escort |

Fixed ground emplacements (`domain: "ground"`, `isFixed: true`, speed 0):

| Unit | Role | Radar | Weapons |
| --- | --- | ---: | --- |
| `SAM` | coastal surface-to-air battery | 160 nm | `SM-2MR`, `SM-6`, `ESSM` |
| `CDB` | coastal anti-ship battery | 250 nm (OTH) | `MaritimeStrike`, `TomahawkBlockV` |
| `DEB` | Dark Eagle hypersonic strike battery | 500 nm | `DarkEagle` |
| `EWR` | early-warning radar (no weapons) | 400 nm | — |

Ground units must be placed on land, never move, never act as the formation
guide, and are never re-seated to water; they otherwise share the ship object
shape, the CEC picture, and the engagement pipeline.

Air units (`domain: "air"`):

| Unit | Role | Radar | Weapons |
| --- | --- | ---: | --- |
| `F22` | 5th-gen air-superiority-only squadron (F-22 approx.) | 120 nm | `AIM-120D`, `AIM-9X` |
| `F35A` | 5th-gen anti-ground strike squadron (F-35A approx.) | 110 nm | `AIM-120D`, `AIM-9X`, `AGM-154` |
| `F35C` | 5th-gen anti-ship strike squadron (F-35C approx.) | 110 nm | `AIM-120D`, `AIM-9X`, `AGM-84` |
| `F15E` | 4.5-gen anti-ground strike squadron (F-15E approx.) | 90 nm | `AIM-120C`, `AIM-9X`, `AGM-154` |
| `F15N` | 4.5-gen anti-ship strike squadron (fictional) | 90 nm | `AIM-120C`, `AIM-9X`, `AGM-84` |
| `F15C` | 4.5-gen air-superiority-only squadron (F-15C approx.) | 95 nm | `AIM-120C`, `AIM-9X` |
| `AFB` | airfield / rearm-refuel node (placeable on land **or** water) | 180 nm | — |

Each hull has a **rigid** default loadout that fixes its role: an
air-superiority hull carries no strike weapon at all, an anti-ground hull
carries `AGM-154` (JSOW) and no `AGM-84`, an anti-ship hull carries `AGM-84`
and no `AGM-154`. A squadron is **one** entity whose hit-point pool equals its plane count, so each
hit downs one aircraft and its combat power scales with the survivors. It flies a
low-altitude stand-off strike (ingress → masked descent → release at the
stand-off ring → egress), dogfights with radar BVR and infrared WVR missiles
(evasive breaks + flares), and returns to a friendly airfield to rearm/refuel and
relaunch. See `docs/SIMULATION_ASSUMPTIONS.md` for the full doctrine.
Fighter fuel is modeled as combat radius with return reserve: about 600 nm for
5th-gen fighters and 680 nm for 4.5-gen fighters.

Each ship instance includes:
- kinematics,
- radar state,
- missile loadout,
- doctrine and ROE,
- track map,
- launch queues and cooldowns,
- subsystem health,
- fleet role and sector responsibility.

#### Missile set
Defined in `src/sim/missiles.js`:

| Missile | Short label | Role | Range |
| --- | --- | --- | ---: |
| `SM-2MR` | `SM2` | area air defense | 167 km |
| `ESSM` | `ESSM` | point defense | 52 km |
| `MaritimeStrike` | `MSTK` | anti-surface cruise strike | 222 km |
| `TomahawkBlockV` | `TLAM` | long-range anti-surface strike | 1,204 km |
| `DarkEagle` | `LRHW` | ground-launched hypersonic surface strike | 2,778 km |
| `SM-6` | `SM6` | dual-role anti-air / anti-surface | 370 km |
| `AIM-120C` | `120C` | BVR active-radar air-to-air | 102 km |
| `AIM-120D` | `120D` | extended-envelope BVR active-radar air-to-air | 152 km |
| `AIM-9X` | `AIM9` | WVR infrared air-to-air (flare-decoyable) | 33 km |
| `AGM-84` | `HPN` | air-launched sea-skimming anti-ship | 124 km |
| `AGM-154` | `JSOW` | air-launched stand-off anti-ground strike | 130 km |

Weapons encode range, speed, Pk, salvo size, launch interval, spacing, seeker
transition, guidance style, reserve behavior, and (for air-to-air) the no-escape-zone fraction.

### 5. Simulation concepts worth knowing

- **Imperfect information:** ships fight from track files, not exact enemy truth.
- **CEC-style abstraction:** ship tracks are fused into a side-wide composite picture for engage-on-remote behavior.
- **Force command:** the simulation designates OTC/AAWC-style roles and assigns anti-air sectors. The Chinese label for AAWC is `防空指挥`.
- **Layered defense:** long-range intercept, point defense, then CIWS.
- **Coordinated raids:** offensive release windows can align multiple launchers into one tactical wave.
- **Determinism:** same seed, same inputs, same rules path.
- **Serialization:** scenarios can be saved/restored without discarding important sim state such as tracks, queues, and cooldowns.

### 6. UI controls and operator workflow

#### Setup mode
- Left-click with `BLUE` or `RED` tool selected to place units.
- Select the unit type from the class dropdown — **Naval** (`DDG`, `CCG`, `BBG`, `FFG`) or **Ground** (`SAM`, `CDB`, `DEB`, `EWR`). Sea units must be placed on water and ground units on land.
- Left-drag units to reposition them during setup (sea units stay on water, ground units stay on land).
- Right-click ship to select it.
- Right-drag/right-click selection supports additive detail-card selection.
- Right-drag on empty map creates a box selection.
- `Delete` / `Backspace` removes selected ships in setup mode.
- `REV` resets the scenario.

#### Navigation and time control
- Mouse wheel zooms the tactical map.
- Middle mouse or `Alt` + drag pans the camera.
- `▶` starts or pauses the simulation.
- `STEP` or keyboard `.` advances one simulation tick.
- `Space` toggles run/pause.
- Speed slider adjusts time compression up to `60x`.

#### Data operations
- `SAVE` exports scenario JSON.
- `LOAD` imports scenario JSON.
- `AAR` exports after-action JSON.
- `COPY FIRE LOG` copies formatted event output in the active language.

### 7. Limitations and modeling policy

- The simulation is an approximation, not an authoritative military model.
- Public-source estimates are preferred over exact or sensitive values.
- The current implementation is intentionally single-process and local.
- There is no backend persistence layer beyond exported JSON files.
- Terrain is geographically sourced and projected, and the simulation now enforces it: a shared binary water/land query drives setup placement, coastal detour navigation, and swept-segment land-collision guards. There is still no shallow/deep-water model — navigability is simply water vs. not-water.
- The docs describe the current implementation and release label only.

### 8. Contribution notes

When extending the project:
- preserve deterministic behavior where possible,
- document new assumptions in `docs/`,
- add or update tests in `tests/sim.test.mjs`,
- keep the local-first workflow simple,
- avoid introducing sensitive or non-public technical data.

---

## 中文

### 1. 项目概述

TomaHawk 是仓库名，应用内部与运行时名称为 **战斧**。它是一个本地优先、二维、确定性的现代战斗模拟器，核心关注点包括：海上、陆基与空中单位的对抗，导弹攻防，带不确定性的雷达航迹，协同交战，以及高信息密度的战术地图界面。

项目刻意保持轻量：

- 不依赖前端打包工具；
- 主要使用原生 JavaScript ES 模块；
- 使用极小的 Node HTTP 服务进行本地托管；
- 使用 Node 内置测试框架验证规则与回归行为。

### 2. `v0.3` 当前能力

#### 仿真与决策
- 基于种子的确定性仿真循环。
- `setup`、`running`、`ended` 三种场景状态。
- 按真实比例建模的舰艇运动、加减速和转向限制。
- 蓝红双方均由自主 doctrine 驱动。
- 力量级别的进攻规划、空防规划与指挥姿态评估。
- 支持 `free`、`tight`、`hold` 三级交战规则，且始终允许自卫。

#### 地形、地图与陆基力量
- 可选战术地图：无边界的**开放海域**，以及投影后的全球海岸线图层（Natural Earth 1:50m）。
- 渲染与仿真共享“水/陆”二元地形：沿岸绕行导航、连续扫掠的陆地碰撞防护，以及部署校验。
- 四种固定式陆基阵地——**SAM**（岸基防空）、**CDB**（带超视距目标雷达的岸基反舰）、**DEB**（“暗鹰”高超声速打击）、**EWR**（远程预警雷达）——与海上单位走同一套感知、共享、开火与被打击流程，但永不移动。

#### 传感器与信息质量
- 雷达生成的航迹包含质量、误差、不确定性、时效与来源信息。
- 目标决策依赖感知图景，而不是直接读取“真值”。
- 导弹探测距离依据飞行剖面而变化。
- 已失效目标会被清理，旧航迹会随时间退化。

#### 武器与战斗结算
- 对地/对海武器：`MaritimeStrike`、`TomahawkBlockV`、`DarkEagle`。
- 防空/反导武器：`SM-2MR`、`ESSM`。
- 双用途武器：`SM-6`。
- 支持发射队列、齐射间隔、发射冷却、以及“防御优先”的调度逻辑。
- 使用速度前置截获引导、末段 seeker 转换、目标丢失自毁。
- 分层防御包括区域防空、点防御和 CIWS。
- 舰艇采用任务杀伤/子系统退化式损伤模型。

#### 界面与操作流
- 全屏战术地图画布。
- 网格、航迹、雷达、武器射程圈、导弹图层过滤。
- 战术地图仅显示图标，不在画布层显示舰艇、航迹或导弹文字标识。
- 舰名仍显示在地图和编队库存中，格式为本地化舰级名称加舰号。
- 武器射程标签只显示武器名称，不再附带距离数值。
- 支持按海上、陆基、空中类别投放单位。
- 编队库存面板与事件日志面板。
- 场景保存、读取、AAR 导出、战术日志复制。
- 右键选中与多舰详情卡片。
- 舰艇详情标题只显示一次本地化舰级前缀加舰号，详情行显示本地化子系统名称、居中的状态条和百分比。

### 3. 技术架构

#### 运行时拆分
- **`src/sim/`（通过 `src/sim.js` 汇总导出）**：仿真状态、舰艇/导弹定义、传感器逻辑、融合态势图、指挥逻辑、武器规划、机动、伤害、序列化与导出。各模块职责见 `src/README.md`。
- **`src/app.js`**：画布渲染、输入处理、选择逻辑、相机控制、面板渲染、UI 控件、保存/读取、复制与导出动作。
- **`server.mjs`**：本地静态资源 HTTP 服务。
- **`tests/sim.test.mjs`**：确定性、规则约束、默认 UI 行为与若干边界情况测试。

#### 执行方式
- 无 bundler。
- 无前端框架依赖。
- 浏览器与 Node 统一使用原生 ES Modules。
- 资源直接从仓库文件提供。
- 自动化测试使用 `node --test`。

### 4. 数据模型与主要实体

#### 舰艇类别
当前 `src/sim/ships.js` 内置 4 类舰体：

| 舰体代号 | 近似原型 | VLS 单元 | 最高航速 | 主要定位 |
| --- | --- | ---: | ---: | --- |
| `DDG` | Arleigh Burke Flight IIA 近似型 | 96 | 31 节 | 平衡型驱逐舰 |
| `CCG` | Ticonderoga 巡洋舰近似型 | 122 | 32.5 节 | 更强区域防空 |
| `BBG` | Arsenal Battleship 概念近似型 | 288 | 24 节 | 超大弹药深度 |
| `FFG` | Constellation 护卫舰近似型 | 32 | 26 节 | 轻型灵活护航 |

固定式陆基阵地（`domain: "ground"`、`isFixed: true`、航速为 0）：

| 单位 | 定位 | 雷达 | 武器 |
| --- | --- | ---: | --- |
| `SAM` | 岸基防空阵地 | 160 海里 | `SM-2MR`、`SM-6`、`ESSM` |
| `CDB` | 岸基反舰阵地 | 250 海里（超视距） | `MaritimeStrike`、`TomahawkBlockV` |
| `DEB` | “暗鹰”高超声速打击阵地 | 500 海里 | `DarkEagle` |
| `EWR` | 预警雷达（无武器） | 400 海里 | — |

陆基单位必须部署在陆地，永不移动、不担任编队指挥、也不会被重置到水面；其余方面与
舰艇共享对象结构、CEC 态势图与交战流程。

空中单位（`domain: "air"`）：

| 单位 | 定位 | 雷达 | 武器 |
| --- | --- | ---: | --- |
| `F22` | 5 代纯空优中队（F-22 近似型） | 120 海里 | `AIM-120D`、`AIM-9X` |
| `F35A` | 5 代对地打击中队（F-35A 近似型） | 110 海里 | `AIM-120D`、`AIM-9X`、`AGM-154` |
| `F35C` | 5 代反舰打击中队（F-35C 近似型） | 110 海里 | `AIM-120D`、`AIM-9X`、`AGM-84` |
| `F15E` | 4.5 代对地打击中队（F-15E 近似型） | 90 海里 | `AIM-120C`、`AIM-9X`、`AGM-154` |
| `F15N` | 4.5 代反舰打击中队（虚构型号） | 90 海里 | `AIM-120C`、`AIM-9X`、`AGM-84` |
| `F15C` | 4.5 代纯空优中队（F-15C 近似型） | 95 海里 | `AIM-120C`、`AIM-9X` |
| `AFB` | 机场 / 再装挂-加油节点（可部署于陆地**或**水面） | 180 海里 | — |

每型飞机都有**固定**的默认装载，直接决定其定位：纯空优机型完全不携带对面武器，
对地机型携带 `AGM-154`（JSOW）且不携带 `AGM-84`，反舰机型携带 `AGM-84` 且不携带
`AGM-154`。一个中队是**单个**实体，其生命值池即为存活飞机数，每次命中击落一架，
战斗力随存活数量下降。它执行低空防区外打击（突防 → 下降规避 → 环绕发射 → 脱
离），使用雷达超视距与红外近距导弹格斗（机动规避 + 红外诱饵），并返回友方机场
再装挂、加油后重新出击。完整条令见 `docs/SIMULATION_ASSUMPTIONS.md`。
战斗机燃油按带返航余量的作战半径建模：5 代机约 600 海里，4.5 代机约 680 海里。

每个舰艇对象都包含：
- 机动参数；
- 雷达状态；
- 导弹装载；
- doctrine 与 ROE；
- 航迹表；
- 发射队列与冷却；
- 子系统健康；
- 编队角色与防空扇区。

#### 导弹集合
定义于 `src/sim/missiles.js`：

| 导弹 | 地图短标 | 角色 | 射程 |
| --- | --- | --- | ---: |
| `SM-2MR` | `SM2` | 区域防空 | 167 公里 |
| `ESSM` | `ESSM` | 点防御 | 52 公里 |
| `MaritimeStrike` | `MSTK` | 对海巡航打击 | 222 公里 |
| `TomahawkBlockV` | `TLAM` | 远程对海打击 | 1,204 公里 |
| `DarkEagle` | `LRHW` | 陆基高超声速对地/对海打击 | 2,778 公里 |
| `SM-6` | `SM6` | 防空/对海双用途 | 370 公里 |
| `AIM-120C` | `120C` | 超视距主动雷达空空导弹 | 102 公里 |
| `AIM-120D` | `120D` | 扩展包线超视距主动雷达空空导弹 | 152 公里 |
| `AIM-9X` | `AIM9` | 近距红外空空导弹（可被诱饵弹欺骗） | 33 公里 |
| `AGM-84` | `HPN` | 机载海面掠飞反舰导弹 | 124 公里 |
| `AGM-154` | `JSOW` | 机载防区外对地打击武器 | 130 公里 |

武器定义中包含射程、速度、Pk、齐射规模、发射间隔、末段 seeker 距离、制导方式与保留比例等参数。

### 5. 重要仿真概念

- **非完美信息：** 舰艇决策基于航迹，不基于敌方真实坐标。
- **CEC 式协同图景：** 同阵营单位可融合航迹并实现类似 engage-on-remote 的行为。
- **编队指挥：** 仿真会指定 OTC/AAWC 类角色并划分防空责任扇区。AAWC 的中文标签为 `防空指挥`。
- **分层防御：** 远程拦截、近程点防御、最后由 CIWS 兜底。
- **协同饱和打击：** 多个平台可以对齐释放窗口形成战术波次。
- **确定性：** 相同 seed 与输入将走同一规则路径。
- **可序列化：** 保存/恢复不会丢失关键状态，如航迹、发射队列和冷却时间。

### 6. UI 控制与操作方式

#### 场景准备阶段
- 选中 `BLUE` 或 `RED` 后左键点击地图放置单位。
- 通过类别下拉框选择**海上**（`DDG`、`CCG`、`BBG`、`FFG`）或**陆基**（`SAM`、`CDB`、`DEB`、`EWR`）单位；海上单位必须放在水面，陆基单位必须放在陆地。
- 在 `setup` 模式下可左键拖动单位调整初始位置（海上单位保持在水面，陆基单位保持在陆地）。
- 右键舰艇进行选择。
- 右键拖动/右键选择可叠加详情卡选择。
- 在空白区域右键拖动可框选。
- 舰艇详情行仅显示本地化子系统名称、居中状态条和百分比。
- 战术动态与舰艇详情的标题和行文字在 Chrome 与 Edge 中均以等效 10px 显示；其他 DOM 标签使用 14px 源字号下限，使 Chrome 与最小字号设为 14px 的 Edge 配置一致。
- 战术动态显示与剪贴板导出均使用当前语言，避免重复阵营名称，并将近似敌方驱逐舰简写为 `enemy DDG` / `敌方 DDG`。
- 标尺支持保留多条测量线；再次点击 `标尺` 会清除全部测量线并退出标尺模式。
- 编队库存与舰艇详情卡使用相同的系统 UI 字体和等效 10px 字号，并缩窄、压低了面板尺寸。
- 编队库存与详情面板内容未变化时会在动画帧之间保留 DOM，避免持续渲染期间控件点击失效。
- 左侧五项准备控件统一归入 `船只生成` 分组；地图可在开放海域与东海海岸线图层之间选择。
- 舰艇方向箭头在部署阶段隐藏，开战时才出现；蓝方初始朝左，红方初始朝右。
- 舰艇运动指示改为短虚线航向箭头，不再绘制通往目标点的虚线和目标方框。
- 海岸线图层使用本地打包的 Natural Earth 1:50m 全球陆地与海岸线数据，并采用等距圆柱投影；地图铺满视口，不拉伸。战术地图与仿真边界覆盖整个地球，渲染时只绘制当前视口内的陆地/海岸路径。
- 地图坐标、20 公里网格、动态比例尺、标尺和可见武器射程统一使用公里；仿真内部仍以米为单位。
- 广域缩放时隐藏武器与导弹文字但保留射程圈和符号；舰名始终保持完全不透明。
- `Delete` / `Backspace` 可删除 `setup` 模式下的选中单位。
- `REV` 重置场景。

#### 视图与时间控制
- 鼠标滚轮缩放地图。
- 鼠标中键或 `Alt + 拖动` 平移视角。
- `▶` 开始或暂停仿真。
- `STEP` 或键盘 `.` 单步推进。
- `Space` 在运行/暂停之间切换。
- 速度滑条最高支持 `60x` 时间压缩。

#### 数据操作
- `SAVE` 导出场景 JSON。
- `LOAD` 导入场景 JSON。
- `AAR` 导出战后 JSON。
- `COPY FIRE LOG` 会按当前语言复制格式化日志。

### 7. 限制与建模原则

- 本项目是公开信息驱动的近似仿真，不是权威军事模型。
- 参数应优先使用公开来源与明确的不确定性说明。
- 地形已采用真实地理数据和投影，且仿真已实际执行：共享的“水/陆”二元查询驱动部署校验、沿岸绕行导航与连续扫掠的陆地碰撞防护。仍无深浅水模型——可航性只是“水/非水”。
- 当前实现刻意保持单进程、本地运行。
- 除导出的 JSON 外，没有后端持久化层。
- 文档仅描述当前实现，不包含前瞻性设计记录。

### 8. 贡献建议

扩展项目时建议遵循：
- 尽量保持确定性；
- 将新的建模假设同步写入 `docs/`；
- 在 `tests/sim.test.mjs` 中补充或更新测试；
- 保持本地优先、低依赖的工作流；
- 避免引入敏感或非公开技术数据。
