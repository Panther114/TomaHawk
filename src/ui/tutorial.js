export const TUTORIAL_STEPS = [
  { id: "side", target: "#deploy-open", title: "先确定部署阵营", body: "进入装备库后先选择蓝方或红方。当前阵营会决定预览符号和新单位的颜色。", placement: "right" },
  { id: "library", target: "#deploy-open", title: "从装备库选择单位", body: "按海上、水下、陆基和空中筛选，也可以直接搜索型号或用途。", placement: "right" },
  { id: "placement", target: "#placement-chip", title: "在地图上连续部署", body: "光标预览会提示当前位置是否合法。单击放置，Esc 或右键结束部署。", placement: "bottom" },
  { id: "layers", target: "#layers-toggle", title: "按任务打开图层", body: "网格、航迹、雷达和武器射程都在这里。默认只保留最常用的战术信息。", placement: "top" },
  { id: "playback", target: "#bottom-bar", title: "控制推演时间", body: "播放、暂停、单步推进，并用速度滑杆在 1× 到 60× 之间调整。", placement: "top" },
  { id: "summary", target: "#battle-overview", title: "读取双方战况", body: "对照双方存活单位、总耐久、反舰与防空库存，以及指挥 AI 的攻势水平。", placement: "bottom" },
  { id: "context", target: "#right-panel", title: "查看单位与兵力", body: "选择地图单位会自动打开详情；“兵力列表”用于快速定位任何编队。", placement: "left" },
  { id: "tools", target: "#tools-toggle", title: "保存、载入与单位工坊", body: "低频操作统一放在工具抽屉，避免长期占用地图。", placement: "left" }
];

