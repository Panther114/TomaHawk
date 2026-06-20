# TomaHawk / 战斧 — Full Reference / 完整参考手册

Detailed bilingual manual for the `v0.1` release. The top-level `README.md` is a
concise overview; this file holds the full capability, architecture, data-model,
and operator detail. 顶层 `README.md` 为简明概览，本文件提供完整的能力、架构、数据模型与操作细节。

---

## English

### 1. Project overview

TomaHawk models a compact but technically structured naval engagement sandbox:

- deterministic seeded simulation,
- force-on-force Blue/Red surface combat,
- ship placement and scenario editing in setup mode,
- imperfect radar-derived tracks instead of omniscient targeting,
- offensive and defensive missile planning at force level,
- cooperative engagement and shared track abstraction,
- save/load plus after-action export,
- tactical-map UI with dense overlays, logs, and fleet inventory panels.

The project is intentionally local and dependency-light so it remains easy to
inspect, extend, and eventually replace with a lower-level simulation core if
desired.

### 2. Core capabilities in `v0.1`

#### Simulation and doctrine
- Deterministic simulation loop with seeded RNG.
- Scenario modes: `setup`, `running`, `ended`.
- Real-scale ship motion (`SHIP_SPEED_MULTIPLIER = 1`) with acceleration, deceleration, and turn-rate limits.
- Autonomous doctrine for both sides.
- Force-level command posture, offensive fire planning, and defensive fire allocation.
- Rules of engagement (`free`, `tight`, `hold`) with self-defense always permitted.

#### Sensors and information quality
- Radar-generated tracks with quality, uncertainty, age, and source metadata.
- Shared cooperative force picture rather than direct truth access.
- Missile detection envelopes that vary by flight profile.
- Dead-track pruning and age-based track degradation.

#### Weapons and combat resolution
- Surface-strike weapons: `MaritimeStrike`, `TomahawkBlockV`.
- Air/missile defense weapons: `SM-2MR`, `ESSM`.
- Dual-role weapon: `SM-6`.
- Paced launch queues, salvo spacing, launch cooldowns, and defensive-priority scheduling.
- Velocity-lead guidance, terminal seeker behavior, and self-destruct on target loss.
- Layered defense including area defense, point defense, and CIWS.
- Mission-kill style ship damage with subsystem degradation.

#### User interface and workflow
- Full-screen tactical map canvas.
- Grid, tracks, radar, WEZ, and missile visibility filters.
- Ship-class placement controls.
- Fleet inventory panel and compact event log.
- Save, load, AAR export, and tactical-feed copy actions.
- Right-click selection and multi-ship detail overlays.
- Ship detail rows show a localized subsystem name, a centered status bar, and a percentage only.
- Tactical-feed and ship-detail headings and rows render at an effective 10px in Chrome and Edge; other DOM labels use a 14px source minimum so Chrome matches Edge profiles configured with a 14px minimum font size.
- Tactical-feed display and clipboard exports use the active language, avoid duplicate side labels, and describe approximate opposing destroyers as `enemy DDG` / `敌方 DDG`.
- The ruler supports multiple measurements; clicking `RULER` again clears all measurements and exits ruler mode.
- The inventory uses the same effective 10px system UI typography as ship detail cards, with a narrower and shorter panel footprint.
- The left setup controls are grouped under `SHIP SPAWNING`; map selection currently offers Open Sea and an East China Sea coastline layer.
- Moving ships use short dashed heading arrows instead of waypoint lines and destination squares.
- The East China Sea layer uses locally bundled Natural Earth 1:10m land/coastline data in an azimuthal-equidistant projection and fills the viewport without stretching or an artificial outer border.
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
| `SM-6` | `SM6` | dual-role anti-air / anti-surface | 370 km |

Weapons encode range, speed, Pk, salvo size, launch interval, spacing, seeker
transition, guidance style, and reserve behavior.

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
- Left-click with `BLUE` or `RED` tool selected to place ships.
- Select hull type with the ship-class dropdown (`DDG`, `CCG`, `BBG`, `FFG`).
- Left-drag ships to reposition them during setup.
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
- Terrain is geographically sourced and projected but remains a UI framework: a reusable land query exists, while simulation movement does not yet enforce land collision or avoidance.
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

TomaHawk 是仓库名，应用内部与运行时名称为 **战斧**。它是一个本地优先、二维、确定性海战战术沙盘，核心关注点包括：现代水面舰艇对抗、导弹攻防、带不确定性的雷达航迹、协同交战、以及高信息密度的战术地图界面。

项目刻意保持轻量：

- 不依赖前端打包工具；
- 主要使用原生 JavaScript ES 模块；
- 使用极小的 Node HTTP 服务进行本地托管；
- 使用 Node 内置测试框架验证规则与回归行为。

### 2. `v0.1` 当前能力

#### 仿真与决策
- 基于种子的确定性仿真循环。
- `setup`、`running`、`ended` 三种场景状态。
- 按真实比例建模的舰艇运动、加减速和转向限制。
- 蓝红双方均由自主 doctrine 驱动。
- 力量级别的进攻规划、空防规划与指挥姿态评估。
- 支持 `free`、`tight`、`hold` 三级交战规则，且始终允许自卫。

#### 传感器与信息质量
- 雷达生成的航迹包含质量、误差、不确定性、时效与来源信息。
- 目标决策依赖感知图景，而不是直接读取“真值”。
- 导弹探测距离依据飞行剖面而变化。
- 已失效目标会被清理，旧航迹会随时间退化。

#### 武器与战斗结算
- 对海武器：`MaritimeStrike`、`TomahawkBlockV`。
- 防空/反导武器：`SM-2MR`、`ESSM`。
- 双用途武器：`SM-6`。
- 支持发射队列、齐射间隔、发射冷却、以及“防御优先”的调度逻辑。
- 使用速度前置截获引导、末段 seeker 转换、目标丢失自毁。
- 分层防御包括区域防空、点防御和 CIWS。
- 舰艇采用任务杀伤/子系统退化式损伤模型。

#### 界面与操作流
- 全屏战术地图画布。
- 网格、航迹、雷达、武器射程圈、导弹图层过滤。
- 支持按舰型投放单位。
- 编队库存面板与事件日志面板。
- 场景保存、读取、AAR 导出、战术日志复制。
- 右键选中与多舰详情卡片。

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
| `SM-6` | `SM6` | 防空/对海双用途 | 370 公里 |

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
- 选中 `BLUE` 或 `RED` 后左键点击地图放置舰艇。
- 通过舰型下拉框选择 `DDG`、`CCG`、`BBG`、`FFG`。
- 在 `setup` 模式下可左键拖动舰艇调整初始位置。
- 右键舰艇进行选择。
- 右键拖动/右键选择可叠加详情卡选择。
- 在空白区域右键拖动可框选。
- 舰艇详情行仅显示本地化子系统名称、居中状态条和百分比。
- 战术动态与舰艇详情的标题和行文字在 Chrome 与 Edge 中均以等效 10px 显示；其他 DOM 标签使用 14px 源字号下限，使 Chrome 与最小字号设为 14px 的 Edge 配置一致。
- 战术动态显示与剪贴板导出均使用当前语言，避免重复阵营名称，并将近似敌方驱逐舰简写为 `enemy DDG` / `敌方 DDG`。
- 标尺支持保留多条测量线；再次点击 `标尺` 会清除全部测量线并退出标尺模式。
- 编队库存与舰艇详情卡使用相同的系统 UI 字体和等效 10px 字号，并缩窄、压低了面板尺寸。
- 左侧五项准备控件统一归入 `船只生成` 分组；地图可在开放海域与东海海岸线图层之间选择。
- 舰艇运动指示改为短虚线航向箭头，不再绘制通往目标点的虚线和目标方框。
- 东海图层使用本地打包的 Natural Earth 1:10m 陆地与海岸线数据，并采用等距方位投影；地图铺满视口，不拉伸，也不显示人为外框。
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
- 地形已采用真实地理数据和投影，但仍属于 UI 基础框架：已提供可复用的陆地点查询，仿真机动尚未执行陆地碰撞或避障。
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
