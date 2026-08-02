export const GUIDE_LESSONS = [
  {
    id: "side",
    target: "#deploy-open",
    title: "先确定部署阵营",
    body: "打开装备库后先选择蓝方或红方。阵营会决定预览符号和新单位的颜色。",
    placement: "right",
    guide: {
      label: "部署与选择",
      focus: "#demo-deploy",
      action: "点“部署兵力”，选择阵营和单位，再在地图上单击。",
      result: "阵营色符号会出现在地图上；保持部署模式即可连续放置同型单位。",
      error: "红色轮廓表示地形不匹配。舰艇需要水域，地面阵地需要陆地。"
    }
  },
  {
    id: "library",
    target: "#deploy-open",
    title: "从装备库选择单位",
    body: "按水面、水下、地面和空中筛选，也可以搜索型号、名称或任务类型。",
    placement: "right",
    guide: {
      label: "装备库",
      focus: "#demo-deploy",
      action: "先选阵营，再用分类或搜索缩小范围，最后点击装备卡。",
      result: "装备库关闭，地图进入连续部署状态。",
      error: "推演开始后不能继续部署；需要先重置当前推演。"
    }
  },
  {
    id: "placement",
    target: "#placement-chip",
    title: "在地图上连续部署",
    body: "光标预览会提示当前位置是否合法。单击放置，Esc 或右键结束部署。",
    placement: "bottom",
    guide: {
      label: "地图部署",
      focus: "#demo-map",
      action: "移动到合适地形，确认轮廓不是红色后单击。按 Esc 结束。",
      result: "单位加入当前阵营，顶部战况同步更新。",
      error: "狭窄海湾可能无法容纳舰艇；向开放水域移动后再试。"
    }
  },
  {
    id: "layers",
    target: "#layers-toggle",
    title: "按任务打开图层",
    body: "网格、航迹、雷达和武器射程都在这里。默认只保留最常用的战术信息。",
    placement: "top",
    guide: {
      label: "图层与航迹",
      focus: "#demo-layers",
      action: "打开“图层”，按需要切换网格、航迹、雷达和武器射程。",
      result: "地图只显示当前判断所需的信息，避免多个范围环互相遮挡。",
      error: "航迹是本方掌握的目标估计，不一定等于目标真实位置。"
    }
  },
  {
    id: "playback",
    target: "#bottom-bar",
    title: "控制推演时间",
    body: "播放、暂停或单步推进，并用速度滑杆在 1× 到 60× 之间调整。",
    placement: "top",
    guide: {
      label: "时间控制",
      focus: "#demo-playback",
      action: "点播放开始，拖动速度滑杆；需要观察关键时刻时使用暂停或单步。",
      result: "单位、航迹、战况和弹药库存会随推演时间更新。",
      error: "若播放无反应，请确认蓝红双方至少各有一个存活单位。"
    }
  },
  {
    id: "summary",
    target: "#battle-overview",
    title: "读取双方战况",
    body: "对照双方存活目标、总生命、在空反舰与在空防空，以及指挥 AI 的攻势水平。",
    placement: "bottom",
    guide: {
      label: "战况总览",
      focus: "#demo-summary",
    action: "对照蓝红双方的存活目标、总生命、在空反舰、在空防空与攻势百分比。",
      result: "可以快速判断哪一方正在失去平台、拦截能力或进攻节奏。",
      error: "库存下降不一定代表命中；武器可能仍在飞行或已被拦截。"
    }
  },
  {
    id: "context",
    target: "#right-panel",
    title: "查看单位与兵力",
    body: "选择地图单位会展开详情；“兵力列表”用于快速定位任何编队。",
    placement: "left",
    guide: {
      label: "兵力详情",
      focus: "#demo-force",
      action: "点击地图单位或右侧“兵力”把手，查看耐久、任务和载弹。",
      result: "选中单位会高亮，右侧面板显示其当前状态与剩余武器。",
      error: "详情是当前单位状态；顶部战况是整个阵营的汇总。"
    }
  },
  {
    id: "tools",
    target: "#tools-toggle",
    title: "保存、载入与单位工坊",
    body: "低频操作统一放在系统工具菜单，避免长期占用战术地图。",
    placement: "left",
    guide: {
      label: "系统工具",
      focus: "#demo-tools",
      action: "打开右上角系统工具，选择保存、载入、AAR 或单位工坊。",
      result: "当前推演和自定义单位都保留在浏览器本地，也可导出为文件。",
      error: "清空并重置会丢弃未保存进度，执行前先保存重要推演。"
    }
  }
];

export const TUTORIAL_STEPS = GUIDE_LESSONS.map(
  ({ id, target, title, body, placement }) => ({ id, target, title, body, placement })
);
