# TomaHawk / 战斧 Naval Sandbox

**Current release:** `v0.1` (`package.json` version `0.1.0`)

TomaHawk is the repository name for a local-first naval combat sandbox whose in-app/runtime identity is **战斧**. The project is a deterministic 2D browser simulation of modern surface warfare, centered on task-group missile combat, imperfect radar tracks, coordinated force-level decision-making, and compact tactical-map presentation inspired by the practical density of DCS-style map views.

This repository currently ships as a lightweight JavaScript application with no frontend build pipeline. A small Node.js static server hosts the app locally, while the simulation core runs in plain ES modules and is validated with Node's built-in test runner.

---

## English

### 1. Release status

- **Release line:** `v0.1`
- **NPM/package metadata:** `0.1.0`
- **Execution model:** local browser app served by Node.js
- **Primary entry points:** `./index.html`, `./src/app.js`, `./src/sim.js`
- **Server address:** `http://127.0.0.1:4173`

### 2. Project overview

TomaHawk models a compact but technically structured naval engagement sandbox:

- deterministic seeded simulation,
- force-on-force Blue/Red surface combat,
- ship placement and scenario editing in setup mode,
- imperfect radar-derived tracks instead of omniscient targeting,
- offensive and defensive missile planning at force level,
- cooperative engagement and shared track abstraction,
- save/load plus after-action export,
- tactical-map UI with dense overlays, logs, and fleet inventory panels.

The project is intentionally local and dependency-light so it remains easy to inspect, extend, and eventually replace with a lower-level simulation core if desired.

### 3. Core capabilities in `v0.1`

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
- Save, load, AAR export, and copy-log actions.
- Right-click selection and multi-ship detail overlays.

### 4. Technical architecture

#### Runtime split
- **`src/sim.js`**: simulation state, ship/missile definitions, sensor logic, force picture, fleet command, missile planning, movement, damage, serialization, export.
- **`src/app.js`**: canvas rendering, input handling, selection model, camera logic, panel rendering, UI controls, save/load wiring, clipboard/export actions.
- **`server.mjs`**: tiny Node HTTP server for local static hosting.
- **`tests/sim.test.mjs`**: rules-level and regression-style coverage for deterministic behavior and UI/documented defaults.

#### Execution model
- No bundler.
- No framework dependency.
- Native ES modules in browser and Node.
- Static assets served directly from repository files.
- Testing uses `node --test`.

### 5. Repository layout

```text
./
├── README.md
├── CHANGELOG.md
├── package.json
├── server.mjs
├── index.html
├── src/
│   ├── app.js
│   ├── sim.js
│   └── styles.css
├── tests/
│   └── sim.test.mjs
└── docs/
    ├── ARCHITECTURE.md
    ├── DATA_MODEL.md
    ├── ROADMAP.md
    ├── SIMULATION_ASSUMPTIONS.md
    └── SOURCES.md
```

### 6. Data model and gameplay entities

#### Ship classes
Current hull catalog in `src/sim.js`:

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

| Missile | Short label | Role | Range |
| --- | --- | --- | ---: |
| `SM-2MR` | `SM2` | area air defense | 90 NM |
| `ESSM` | `ESSM` | point defense | 28 NM |
| `MaritimeStrike` | `MSTK` | anti-surface cruise strike | 120 NM |
| `TomahawkBlockV` | `TLAM` | long-range anti-surface strike | 650 NM |
| `SM-6` | `SM6` | dual-role anti-air / anti-surface | 200 NM |

Weapons encode range, speed, Pk, salvo size, launch interval, spacing, seeker transition, guidance style, and reserve behavior.

### 7. Simulation concepts worth knowing

- **Imperfect information:** ships fight from track files, not exact enemy truth.
- **CEC-style abstraction:** ship tracks are fused into a side-wide composite picture for engage-on-remote behavior.
- **Force command:** the simulation designates OTC/AAWC-style roles and assigns anti-air sectors.
- **Layered defense:** long-range intercept, point defense, then CIWS.
- **Coordinated raids:** offensive release windows can align multiple launchers into one tactical wave.
- **Determinism:** same seed, same inputs, same rules path.
- **Serialization:** scenarios can be saved/restored without discarding important sim state such as tracks, queues, and cooldowns.

### 8. Running the project

#### Requirements
- A modern Node.js runtime with ES module support.
- A desktop browser.

#### Install
This repository currently has no external runtime dependencies declared in `package.json`, so there is no required package-install step.

```bash
cd tomahawk
```

#### Start the local server
```bash
npm start
```

Then open:

```text
http://127.0.0.1:4173
```

### 9. Testing

Run the existing automated test suite:

```bash
cd tomahawk
npm test
```

The current test suite covers deterministic behavior, loadout validation, tracking, offensive planning, defensive reactions, serialization, UI defaults, compact rendering assumptions, and several missile-combat edge cases.

### 10. UI controls and operator workflow

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
- `COPY LOG` / `COPY FIRE LOG` copies formatted event output.

### 11. Documentation index

- `./docs/ARCHITECTURE.md` — runtime structure, module boundaries, rendering layers.
- `./docs/DATA_MODEL.md` — object shapes, unit conventions, missile and ship fields.
- `./docs/SIMULATION_ASSUMPTIONS.md` — modeling assumptions and abstraction policy.
- `./docs/SOURCES.md` — public-source references and data policy.
- `./docs/ROADMAP.md` — current capability summary and completed implementation notes.
- `./CHANGELOG.md` — formal release history beginning with `v0.1`.

### 12. Limitations and modeling policy

- The simulation is an approximation, not an authoritative military model.
- Public-source estimates are preferred over exact or sensitive values.
- The current implementation is intentionally single-process and local.
- There is no backend persistence layer beyond exported JSON files.
- The docs describe the current implementation and release label only.

### 13. Contribution notes

When extending the project:
- preserve deterministic behavior where possible,
- document new assumptions in `docs/`,
- add or update tests in `tests/sim.test.mjs`,
- keep the local-first workflow simple,
- avoid introducing sensitive or non-public technical data.

### 14. License status

No standalone license file is currently present in the repository root. Add one before redistributing the project under a formal open-source license.

---

## 中文

### 1. 版本状态

- **当前版本线：** `v0.1`
- **包版本：** `0.1.0`
- **运行方式：** 由 Node.js 提供本地静态服务的浏览器应用
- **主要入口：** `./index.html`、`./src/app.js`、`./src/sim.js`
- **默认地址：** `http://127.0.0.1:4173`

### 2. 项目概述

TomaHawk 是仓库名，应用内部与运行时名称为 **战斧**。它是一个本地优先、二维、确定性海战战术沙盘，核心关注点包括：现代水面舰艇对抗、导弹攻防、带不确定性的雷达航迹、协同交战、以及高信息密度的战术地图界面。

项目刻意保持轻量：

- 不依赖前端打包工具；
- 主要使用原生 JavaScript ES 模块；
- 使用极小的 Node HTTP 服务进行本地托管；
- 使用 Node 内置测试框架验证规则与回归行为。

### 3. `v0.1` 当前能力

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
- 场景保存、读取、AAR 导出、日志复制。
- 右键选中与多舰详情卡片。

### 4. 技术架构

#### 运行时拆分
- **`src/sim.js`**：仿真状态、舰艇/导弹定义、传感器逻辑、融合态势图、指挥逻辑、武器规划、机动、伤害、序列化与导出。
- **`src/app.js`**：画布渲染、输入处理、选择逻辑、相机控制、面板渲染、UI 控件、保存/读取、复制与导出动作。
- **`server.mjs`**：本地静态资源 HTTP 服务。
- **`tests/sim.test.mjs`**：确定性、规则约束、默认 UI 行为与若干边界情况测试。

#### 执行方式
- 无 bundler。
- 无前端框架依赖。
- 浏览器与 Node 统一使用原生 ES Modules。
- 资源直接从仓库文件提供。
- 自动化测试使用 `node --test`。

### 5. 仓库结构

```text
./
├── README.md
├── CHANGELOG.md
├── package.json
├── server.mjs
├── index.html
├── src/
│   ├── app.js
│   ├── sim.js
│   └── styles.css
├── tests/
│   └── sim.test.mjs
└── docs/
    ├── ARCHITECTURE.md
    ├── DATA_MODEL.md
    ├── ROADMAP.md
    ├── SIMULATION_ASSUMPTIONS.md
    └── SOURCES.md
```

### 6. 数据模型与主要实体

#### 舰艇类别
当前 `src/sim.js` 内置 4 类舰体：

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

| 导弹 | 地图短标 | 角色 | 射程 |
| --- | --- | --- | ---: |
| `SM-2MR` | `SM2` | 区域防空 | 90 海里 |
| `ESSM` | `ESSM` | 点防御 | 28 海里 |
| `MaritimeStrike` | `MSTK` | 对海巡航打击 | 120 海里 |
| `TomahawkBlockV` | `TLAM` | 远程对海打击 | 650 海里 |
| `SM-6` | `SM6` | 防空/对海双用途 | 200 海里 |

武器定义中包含射程、速度、Pk、齐射规模、发射间隔、末段 seeker 距离、制导方式与保留比例等参数。

### 7. 重要仿真概念

- **非完美信息：** 舰艇决策基于航迹，不基于敌方真实坐标。
- **CEC 式协同图景：** 同阵营单位可融合航迹并实现类似 engage-on-remote 的行为。
- **编队指挥：** 仿真会指定 OTC/AAWC 类角色并划分防空责任扇区。
- **分层防御：** 远程拦截、近程点防御、最后由 CIWS 兜底。
- **协同饱和打击：** 多个平台可以对齐释放窗口形成战术波次。
- **确定性：** 相同 seed 与输入将走同一规则路径。
- **可序列化：** 保存/恢复不会丢失关键状态，如航迹、发射队列和冷却时间。

### 8. 如何运行

#### 环境要求
- 支持 ES Modules 的现代 Node.js。
- 桌面浏览器。

#### 安装
当前 `package.json` 没有声明额外运行时依赖，因此通常不需要额外安装步骤：

```bash
cd tomahawk
```

#### 启动本地服务
```bash
npm start
```

然后打开：

```text
http://127.0.0.1:4173
```

### 9. 测试

运行现有自动化测试：

```bash
cd tomahawk
npm test
```

当前测试覆盖：确定性、装载校验、航迹生成、进攻/防御规划、序列化恢复、默认 UI 设定、紧凑渲染假设，以及多个导弹攻防边界场景。

### 10. UI 控制与操作方式

#### 场景准备阶段
- 选中 `BLUE` 或 `RED` 后左键点击地图放置舰艇。
- 通过舰型下拉框选择 `DDG`、`CCG`、`BBG`、`FFG`。
- 在 `setup` 模式下可左键拖动舰艇调整初始位置。
- 右键舰艇进行选择。
- 右键拖动/右键选择可叠加详情卡选择。
- 在空白区域右键拖动可框选。
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
- `COPY LOG` / `COPY FIRE LOG` 复制格式化日志。

### 11. 文档索引

- `./docs/ARCHITECTURE.md`：运行结构、模块边界、渲染层次。
- `./docs/DATA_MODEL.md`：对象结构、单位规范、舰艇与导弹字段。
- `./docs/SIMULATION_ASSUMPTIONS.md`：建模假设与抽象原则。
- `./docs/SOURCES.md`：公开来源与数据政策。
- `./docs/ROADMAP.md`：当前能力摘要与已完成实现说明。
- `./CHANGELOG.md`：从 `v0.1` 开始的正式版本记录。

### 12. 限制与建模原则

- 本项目是公开信息驱动的近似仿真，不是权威军事模型。
- 参数应优先使用公开来源与明确的不确定性说明。
- 当前实现刻意保持单进程、本地运行。
- 除导出的 JSON 外，没有后端持久化层。
- 文档仅描述当前实现，不包含前瞻性设计记录。

### 13. 贡献建议

扩展项目时建议遵循：
- 尽量保持确定性；
- 将新的建模假设同步写入 `docs/`；
- 在 `tests/sim.test.mjs` 中补充或更新测试；
- 保持本地优先、低依赖的工作流；
- 避免引入敏感或非公开技术数据。

### 14. 许可状态

仓库根目录目前没有独立的许可证文件；如果要以正式开源方式分发，请先补充 license 文件。
