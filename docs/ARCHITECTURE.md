# 架构说明

## 总览

破晓前夜采用原生 HTML、CSS、JavaScript 与 Canvas，没有打包器和前端框架。浏览器负责界面与绘制；模拟核心保持无 DOM、可在 Node.js 中直接测试。

```text
页面与交互（index / sandbox / guide）
        ↓
UI 适配层（src/app.js、src/ui/*）
        ↓
稳定公开入口（src/sim.js）
        ↓
确定性模拟核心（src/sim/*）
```

## 页面层

- `index.html`：产品落地页，只负责品牌与导航。
- `sandbox.html`：沙盘 DOM 外壳；`src/app.js` 连接 Canvas、控件、存档与工坊。
- `guide.html`：响应式中文教程。
- `server.mjs`：解析 `/`、`/sandbox`、`/guide`，流式发送静态文件；想定存取与调试日志端点仅在本地启用。

## UI 层

- `src/ui/lang.js`：单一简体中文消息目录与事件格式化。
- `src/ui/catalog.js`：22 个内置装备及自定义单位的展示目录；只引用模拟类数据，不向核心添加展示字段。
- `src/ui/symbols.js`：标准风格受控子集战术符号，使用缓存 `Path2D`。
- `src/ui/tutorial.js`：教程页与沙盘引导共享的步骤数据。
- `src/ui/view.js`：无 DOM 的 HTML 片段和投影辅助函数。

## 模拟核心

`src/sim.js` 仅为稳定导出入口。逻辑按职责拆分在：

- `scenario.js`：想定创建、部署、序列化、恢复与 AAR。
- `step.js`：固定顺序的时钟调度。
- `sensors.js`、`command.js`：探测、航迹与融合态势。
- `movement.js`、`aircraft.js`：舰艇与航空兵生命周期。
- `combat.js`、`missiles.js`：火力规划、飞行与防御。
- `ships.js`：内置与自定义单位注册表。

UI 不得绕过公开入口修改核心规则。v1 的页面、符号和教程改造不改变保存格式或模拟 API。

## 性能策略

Canvas 每帧绘制，DOM 面板约 20 Hz 更新。地图对象先做视口裁剪；标签使用 LOD 与聚类；战术符号的几何路径预构建后复用。模拟性能由 `scripts/perf-harness.mjs` 的机器无关复杂度分数约束。

## 数据与持久化

- 想定：兼容原有 JSON 结构。
- 单位工坊：IndexedDB `dawnfall-mods`；首次启动复制并验证旧数据库后删除旧库。
- 教程状态：`localStorage["dawnfall.tutorialDismissed"]`。
- 调试开关：`localStorage["dawnfall.debug"]` 或 `?debug=1`。

## 托管边界

Railway 运行 `npm start`，服务监听平台注入的 `0.0.0.0:$PORT`，并通过 `/health` 接受部署健康检查。Node 堆限制为 64 MiB；静态资源按流发送，不建立服务端资源缓存。

检测到 `RAILWAY_ENVIRONMENT` 后，`/scenario/*` 与 `/debug/save` 会保持关闭。浏览器承担模拟时钟、AI、绘制、单位工坊、教程状态、想定导入导出和战报生成，因此生产服务不保存用户状态，也不会随想定规模增加内存占用。
