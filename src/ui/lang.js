// i18n helpers for the tactical UI.
// English is default; Chinese (Simplified) is the alternate.
// Missile IDs (SM-2MR, SM-6, ESSM, TLAM, TomahawkBlockV), hull designations
// (DDG, CCG, BBG, FFG), and data abbreviations (HP, VLS, AS, AA, %, kn, ch:)
// are never translated — they are military nomenclature.

let currentLang = "en";

const strings = {
  // Panel headings
  "panel.forceInventory": { en: "FORCE INVENTORY", zh: "态势列表" },
  "panel.liveOrder":      { en: "LIVE ORDER",      zh: "实时指令" },
  "panel.shipSpawning":   { en: "SHIP SPAWNING",   zh: "船只生成" },

  // Console
  "console.tacticalFeed": { en: "TACTICAL FEED",    zh: "战术日志" },
  "console.copyFeed":     { en: "COPY FEED",        zh: "复制日志" },
  "console.toggleFeed":   { en: "Toggle tactical feed", zh: "展开或收起战术动态" },

  // Left rail tools
  "tool.blue":   { en: "BLUE",   zh: "蓝方" },
  "tool.red":    { en: "RED",    zh: "红方" },
  "tool.ruler":  { en: "RULER",  zh: "标尺" },
  "tool.rev":    { en: "REV",    zh: "重置" },

  // Map option toggles
  "opt.grid":    { en: "GRID",    zh: "网格" },
  "opt.tracks":  { en: "TRACKS",  zh: "锁定" },
  "opt.radar":   { en: "RADAR",   zh: "雷达" },
  "opt.wez":     { en: "WEZ",     zh: "杀伤区" },
  "opt.weapons": { en: "WEAPONS", zh: "武器" },
  "map.select":       { en: "Tactical map", zh: "战术地图" },
  "map.coastline":    { en: "COASTLINE", zh: "沿岸" },
  "map.openSea":      { en: "OPEN SEA", zh: "开放海域" },
  "scale.aria":       { en: "Map scale", zh: "地图比例尺" },
  "scale.grid":       { en: "GRID {n} km", zh: "网格 {n} 公里" },

  // Bottom bar buttons
  "btn.save":    { en: "SAVE",    zh: "保存存档" },
  "btn.load":    { en: "LOAD",    zh: "加载存档" },
  "btn.aar":     { en: "AAR",     zh: "下载战报" },
  "btn.speed":   { en: "SPD",     zh: "速度" },
  "btn.playPause": { en: "Play or pause simulation", zh: "开始或暂停推演" },

  // Status messages
  "status.ready":    { en: "SETUP READY",           zh: "部署就绪" },
  "status.setup":    { en: "Default 4v4 scenario loaded; press play when ready.", zh: "默认 4v4 想定已载入，准备好后按空格开始。" },
  "status.paused":   { en: "PAUSED",               zh: "已暂停" },
  "status.ended":    { en: "ENDED",                zh: "已结束" },
  "status.running":  { en: "RUNNING",              zh: "运行中" },
  "status.invalid":  { en: "SETUP NEEDS BLUE+RED", zh: "需要蓝红双方" },
  "status.logCopied":{ en: "LOG COPIED · {n} lines", zh: "日志已复制 · {n} 行" },
  "status.logFailed":{ en: "LOG COPY FAILED",      zh: "复制失败" },

  // Ship detail card row labels
  "detail.radar": { en: "RADAR", zh: "雷达" },
  "detail.prop":  { en: "PROP",  zh: "动力" },
  "detail.vls":   { en: "VLS",   zh: "垂发" },
  "detail.fcs":   { en: "FCS",   zh: "射控" },
  "detail.ciws":  { en: "CIWS",  zh: "近防" },
  "detail.cic":   { en: "CIC",   zh: "战情" },
  "detail.ac":    { en: "A/C",   zh: "飞机" },
  "detail.fuel":  { en: "FUEL",  zh: "燃油" },
  "detail.flares":{ en: "FLARE", zh: "诱饵" },
  "detail.state": { en: "STATE", zh: "状态" },
  "detail.alt":   { en: "ALT",   zh: "高度" },
  "detail.aaw":   { en: "AAW",   zh: "防空" },
  "detail.asuw":  { en: "ASUW",  zh: "反舰" },
  "detail.load":  { en: "LOAD",  zh: "弹药" },
  "detail.rdr":   { en: "RDR",   zh: "雷达距" },

  // Ship class labels (for select and descriptions)
  "ship.ddg":  { en: "DDG", zh: "驱逐舰" },
  "ship.ccg":  { en: "CCG", zh: "巡洋舰" },
  "ship.bbg":  { en: "BBG", zh: "战列舰" },
  "ship.ffg":  { en: "FFG", zh: "护卫舰" },
  "ship.desc.ddg":  { en: "Guided-Missile Destroyer", zh: "导弹驱逐舰" },
  "ship.desc.ccg":  { en: "Guided-Missile Cruiser",   zh: "导弹巡洋舰" },
  "ship.desc.bbg":  { en: "Guided-Missile Battleship", zh: "导弹战列舰" },
  "ship.desc.ffg":  { en: "Frigate",                   zh: "护卫舰" },

  // Battle status bar
  "status.ships": { en: "Ships", zh: "舰艇" },
  "status.hp":    { en: "HP",    zh: "耐久" },
  "status.agg":   { en: "AGG",   zh: "攻势" },

  // Inventory header columns
  "inv.ship":  { en: "SHIP",  zh: "舰名" },
  "inv.hp":    { en: "HP",    zh: "血量" },
  "inv.vls":   { en: "VLS",   zh: "垂发" },
  "inv.sm2":   { en: "SM2",   zh: "SM2" },
  "inv.sm6":   { en: "SM6",   zh: "SM6" },
  "inv.essm":  { en: "ESSM",  zh: "ESSM" },
  "inv.mstk":  { en: "MSTK",  zh: "MSTK" },
  "inv.tlam":  { en: "TLAM",  zh: "TLAM" },

  // Ground inventory header columns
  "inv.unit":  { en: "UNIT",  zh: "单位" },
  "inv.rdr":   { en: "RDR",   zh: "雷达" },
  "inv.aaw":   { en: "AAW",   zh: "防空" },
  "inv.asuw":  { en: "ASUW",  zh: "反舰" },
  "inv.ac":    { en: "A/C",   zh: "飞机" },
  "inv.state": { en: "STATE", zh: "状态" },

  // Ground unit class labels / descriptions
  "ground.sam": { en: "SAM", zh: "防空" },
  "ground.cdb": { en: "CDB", zh: "岸舰" },
  "ground.ewr": { en: "EWR", zh: "预警" },
  "ground.group": { en: "Ground", zh: "陆基" },
  "naval.group":  { en: "Naval",  zh: "海上" },
  "air.group":    { en: "Air",    zh: "空中" },
  "ship.sam":  { en: "SAM", zh: "防空" },
  "ship.cdb":  { en: "CDB", zh: "岸舰" },
  "ship.ewr":  { en: "EWR", zh: "预警" },
  "ship.f22":  { en: "G5AA",  zh: "5代空优" },
  "ship.f35a": { en: "G5AG", zh: "5代对地" },
  "ship.f35c": { en: "G5AS", zh: "5代反舰" },
  "ship.f15e": { en: "G4AG", zh: "4代对地" },
  "ship.f15n": { en: "G4AS", zh: "4代反舰" },
  "ship.f15c": { en: "G4AA", zh: "4代空优" },
  "ship.awac": { en: "AWAC", zh: "预警机" },
  "ship.afb":  { en: "AFB", zh: "机场" },

  // Placement / setup
  "place.addBlue": { en: "Add blue unit", zh: "添加蓝方单位" },
  "place.addRed":  { en: "Add red unit",  zh: "添加红方单位" },
  "place.class":   { en: "Unit class for placement", zh: "选择单位类型" },
  "place.measure": { en: "Measure range/bearing (R)", zh: "测距/测向 (R)" },
  "place.revert":  { en: "Revert scenario",          zh: "重置想定" },
  "place.collapse":{ en: "Collapse panel (Tab)",      zh: "折叠面板 (Tab)" },

  // About overlay
  "about.title":      { en: "TOMAHAWK",            zh: "TOMAHAWK" },
  "about.subtitle":   { en: "Modern Battle Simulator v0.3",   zh: "现代战斗模拟器 v0.3" },
  "about.desc1":      {
    en: "TomaHawk is a deterministic modern battle simulator for testing force composition, sensing, cooperative engagement, and missile defense across sea, ground, and air units. Place Blue and Red forces, press Play, and let both command AIs fight from what they can actually detect. A side wins when the other side has no surviving unit.",
    zh: "TomaHawk 是一款确定性的现代战斗模拟器，用来测试海上、陆基与空中单位的兵力编组、探测、协同交战与导弹防御。部署蓝、红双方兵力后按下播放键，双方指挥 AI 会根据实际探测到的态势自主交战。一方失去全部存活单位时，另一方获胜。"
  },
  "about.h2loop":     { en: "Simulation loop", zh: "推演流程" },
  "about.flowSetup":  { en: "Deploy", zh: "部署" },
  "about.flowDetect": { en: "Detect", zh: "探测" },
  "about.flowFuse":   { en: "Share tracks", zh: "共享航迹" },
  "about.flowFire":   { en: "Plan fires", zh: "火力规划" },
  "about.flowResolve":{ en: "Resolve damage", zh: "结算损伤" },
  "about.h2model":    { en: "What is modeled", zh: "模型要点" },
  "about.modelSensorsH": { en: "Sensors", zh: "传感器" },
  "about.modelSensors":  {
    en: "Radar contacts have quality, uncertainty, range limits, scan intervals, and track ageing.",
    zh: "雷达接触包含航迹质量、不确定性、探测距离、扫描间隔与航迹衰减。"
  },
  "about.modelCommandH": { en: "Command", zh: "指挥" },
  "about.modelCommand":  {
    en: "Each side builds a fused picture from local and shared tracks, then chooses a posture from survival to saturation.",
    zh: "每一方会融合本舰探测与共享航迹，再在自保、压制、饱和打击等姿态之间切换。"
  },
  "about.modelWeaponsH": { en: "Weapons", zh: "武器" },
  "about.modelWeapons":  {
    en: "Magazines track VLS or hardpoint capacity, cell cost, salvo timing, guidance, seeker range, and terminal probability.",
    zh: "弹药库会记录垂发或挂架容量、单元占用、齐射节奏、制导方式、导引头距离与末段杀伤概率。"
  },
  "about.modelDamageH": { en: "Damage", zh: "损伤" },
  "about.modelDamage":  {
    en: "Hits reduce HP and degrade radar, propulsion, fire control, CIWS, CIC, or aircraft flight strength.",
    zh: "命中会扣减耐久，并可能削弱雷达、动力、射控、近防、战情中心或飞机编队规模。"
  },
  "about.h2controls": { en: "Controls",     zh: "操作" },
  "about.h2setup":    { en: "Setup",        zh: "部署" },
  "about.descSetup":  {
    en: "Pick BLUE or RED, choose a naval, ground, or air unit from the class list, then click the map to place it. Ships need water and most ground units need land; an illegal drop snaps back to the nearest legal spot. Drag a placed unit to reposition it, right-click to inspect it, and press Delete to remove your selection. Setup locks when the battle starts.",
    zh: "选择 BLUE 或 RED，再从类别列表中选择海上、陆基或空中单位，点击地图即可放置。舰艇需要水域，大多数陆基单位需要陆地；非法位置会自动吸附到最近的合法位置。拖动已放置单位可调整位置，右键可查看详情，按 Delete 可删除选中项。战斗开始后，部署内容会锁定。"
  },
  "about.h2workshop": { en: "Unit Workshop", zh: "单位工坊" },
  "about.descWorkshop": {
    en: "The folder button opens the Unit Workshop. Ships, ground sites, aircraft, and weapons are editable data records stored in the browser and exportable as JSON. Built-in records are locked; clone one when you want a custom variant.",
    zh: "点击文件夹按钮可打开单位工坊。舰艇、陆基阵地、飞机与武器都以数据记录形式编辑，保存在浏览器中，也可以导出为 JSON。内置记录会被锁定；需要自定义版本时，先克隆再修改。"
  },
  "about.kbSpace":    { en: "Play / Pause simulation",          zh: "播放 / 暂停模拟" },
  "about.kbEsc":      { en: "Cancel tool / deselect",           zh: "取消工具 / 取消选择" },
  "about.kbR":        { en: "Activate ruler tool",              zh: "启用标尺工具" },
  "about.kbTab":      { en: "Cycle selected ship",              zh: "循环选择舰艇" },
  "about.kbTilde":    { en: "Toggle tactical feed",             zh: "切换战术日志" },
  "about.kbDel":      { en: "Delete selected (setup only)",     zh: "删除选中（仅部署阶段）" },
  "about.kbLmb":      { en: "Select / place unit",              zh: "选择 / 放置单位" },
  "about.kbRmb":      { en: "Add to selection / box select",    zh: "追加选择 / 框选" },
  "about.kbMmb":      { en: "Pan map",                          zh: "平移地图" },
  "about.kbScroll":   { en: "Zoom in / out",                    zh: "缩放" },
  "about.close":      { en: "CLOSE",                            zh: "关闭" },

  // Tooltip hints for map options
  // Language toggle
  "lang.toggle": { en: "中", zh: "EN" },

  // Generic confirm dialog
  "confirm.yes": { en: "OK", zh: "确定" },

  // Save scenario popup
  "save.title":          { en: "SAVE SCENARIO", zh: "保存想定" },
  "save.name":           { en: "Name", zh: "名称" },
  "save.namePlaceholder":{ en: "Untitled", zh: "未命名" },
  "save.locDefault":     { en: "Default location", zh: "默认位置" },
  "save.locCustom":      { en: "Custom location", zh: "自定义位置" },
  "save.cancel":         { en: "CANCEL", zh: "取消" },
  "save.confirm":        { en: "SAVE", zh: "保存" },
  "save.overwrite":      { en: "A saved scenario named \"{n}\" already exists. Overwrite it?", zh: "已存在名为“{n}”的存档，是否覆盖？" },
  "save.done":           { en: "Scenario saved.", zh: "想定已保存。" },
  "save.failed":         { en: "Save failed.", zh: "保存失败。" },

  // Load scenario popup
  "load.title":   { en: "LOAD SCENARIO", zh: "载入想定" },
  "load.import":  { en: "IMPORT FROM FILE…", zh: "从文件导入…" },
  "load.empty":   { en: "No saved scenarios yet.", zh: "暂无已保存的想定。" },
  "load.delete":  { en: "Delete", zh: "删除" },
  "load.deleteConfirm": { en: "Delete saved scenario \"{n}\"?", zh: "删除存档“{n}”？" },
  "load.failed":  { en: "Could not load the scenario list.", zh: "无法加载存档列表。" },

  // Unit Workshop (modding)
  "mods.open":  { en: "Unit Workshop",  zh: "单位工坊" },
  "mods.title": { en: "UNIT WORKSHOP",  zh: "单位工坊" },
  "mods.close": { en: "CLOSE",          zh: "关闭" },
  "mods.hint":  { en: "Drag a unit .json here to import", zh: "将单位 .json 拖入此处以导入" },

  // Map role tags
  "role.otc":  { en: "OTC",  zh: "总指挥" },
  "role.aawc": { en: "AAWC", zh: "防空指挥" },

  // Event log side labels
  "side.blue":   { en: "B",   zh: "蓝" },
  "side.red":    { en: "R",   zh: "红" },
  "side.sys":    { en: "S",   zh: "系" },

  // Event log text fragments (for render-time translation)
  "evt.launched":   { en: "launched",     zh: "发射" },
  "evt.queued":     { en: "queued",       zh: "编队" },
  "evt.at":         { en: "at",           zh: "对" },
  "evt.intercepted":{ en: "intercepted",  zh: "拦截" },
  "evt.incoming":   { en: "incoming",     zh: "来袭" },
  "evt.failed":     { en: "failed to intercept", zh: "拦截失败" },
  "evt.hitBy":      { en: "hit by",       zh: "被命中" },
  "evt.damage":     { en: "Damage:",      zh: "伤害:" },
  "evt.missionKilled":{ en: "mission-killed", zh: "任务损毁" },
  "evt.hitsSustained":{ en: "hits sustained", zh: "累计命中" },
  "evt.classLimit": { en: "class limit",  zh: "舰级上限" },
  "evt.missed":     { en: "missed",       zh: "未命中" },
  "evt.exhausted":  { en: "exhausted fuel and fell into the sea.", zh: "燃料耗尽，坠入海中。" },
  "evt.selfDestruct":{ en: "received a midcourse abort and self-destructed after its target was destroyed.", zh: "中段自毁：目标已被摧毁。" },
  "evt.lostTarget": { en: "lost its target and fell into the sea.", zh: "丢失目标，坠入海中。" },
  "evt.ciwsDestroy":{ en: "CIWS destroyed incoming", zh: "近防系统击毁来袭" },
  "evt.ciwsFailed": { en: "CIWS failed against",    zh: "近防系统未能拦截" },
  "evt.subsysDmg":  { en: "subsystem damage:",       zh: "子系统损伤:" },
  "evt.placed":     { en: "placed.",                 zh: "部署完成。" },
  "evt.duplicated": { en: "duplicated from",         zh: "复制自" },
  "evt.removed":    { en: "removed from scenario.",  zh: "已从想定中移除。" },
  "evt.sideCleared":{ en: "side cleared from scenario.", zh: "该方已清除。" },
  "evt.controls":   { en: "side controls the battlespace. Simulation ended.", zh: "方控制战场。模拟结束。" },
  "evt.cannotRun":  { en: "Cannot run: both Blue and Red require at least one alive ship.", zh: "无法运行：蓝红双方各需至少一个存活单位。" },
};

/** Return the translated string for `key` in the current language. */
export function t(key) {
  const entry = strings[key];
  if (!entry) return key;
  return entry[currentLang] ?? entry.en ?? key;
}

/** Return the current language code. */
export function getLang() {
  return currentLang;
}

/** Set the language and return the new code. */
export function setLang(lang) {
  currentLang = lang === "zh" ? "zh" : "en";
  return currentLang;
}

/** Toggle between en and zh, returning the new code. */
export function toggleLang() {
  currentLang = currentLang === "en" ? "zh" : "en";
  return currentLang;
}

/** Return the localized hull designator (e.g. DDG → 驱逐舰 in zh). */
export function hullLabel(hull) {
  const key = `ship.${(hull || "DDG").toLowerCase()}`;
  return t(key);
}

/** Return the localized role tag for map labels. */
export function roleLabel(role) {
  if (role === "OTC") return t("role.otc");
  if (role === "AAWC") return t("role.aawc");
  return role;
}

/** Return the localized event side label (B/R/S or 蓝/红/系). */
export function sideLabel(side) {
  if (side === "BLUE") return t("side.blue");
  if (side === "RED") return t("side.red");
  return t("side.sys");
}

/** Translate an event log text string to the current language.
 *  Uses pattern-based replacement so the sim core stays untouched. */
export function translateEventText(text) {
  const normalizeTarget = (value) => value.replaceAll(
    "Arleigh Burke Flight IIA approx.",
    currentLang === "zh" ? "敌方 DDG" : "enemy DDG"
  );
  text = normalizeTarget(text);
  if (currentLang === "en") return text;
  const localizeSides = (value) => value
    .replaceAll("BLUE", "蓝方")
    .replaceAll("Blue", "蓝方")
    .replaceAll("RED", "红方")
    .replaceAll("Red", "红方");
  const normalizeChineseEvent = (value) => localizeSides(value)
    .replaceAll(" salvo", " 齐射")
    .replaceAll("approx.", "（近似）")
    .replaceAll("approx", "（近似）")
    .replaceAll(" 齐射 攻击", " 齐射攻击")
    .replaceAll("（近似） 发射", "（近似）发射")
    .replaceAll(".。", "。");
  const sentencePatterns = [
    [/^(.*?) launched (.*?) at (.*?)\.?$/, "$1 向 $3 发射 $2。"],
    [/^(.*?) queued (.*?) at (.*?)\.?$/, "$1 已安排使用 $2 攻击 $3。"],
    [/^(.*?) intercepted incoming (.*?)\.?$/, "$1 拦截来袭的 $2。"],
    [/^(.*?) failed to intercept (.*?)\.?$/, "$1 未能拦截 $2。"],
    [/^(.*?) hit by (.*?)\. Damage: (.*?)\.?$/, "$1 被 $2 命中。损伤：$3。"],
    [/^(.*?) CIWS destroyed incoming (.*?)\.?$/, "$1 的近防系统击毁来袭的 $2。"],
    [/^(.*?) CIWS failed against (.*?)\.?$/, "$1 的近防系统未能拦截 $2。"],
    [/^(.*?) missed (.*?)\.?$/, "$1 未命中 $2。"],
    [/^(.*?) placed\.$/, "$1 已部署。"],
    [/^(.*?) duplicated from (.*?)\.$/, "$1 已复制自 $2。"],
    [/^(.*?) removed from scenario\.$/, "$1 已从想定中移除。"],
    [/^(BLUE|RED) side cleared from scenario\.$/, "$1舰艇已从想定中清除。"],
    [/^(BLUE|RED) side controls the battlespace\. Simulation ended\.$/, "$1控制战场，推演结束。"],
  ];
  for (const [pattern, replacement] of sentencePatterns) {
    if (pattern.test(text)) {
      return normalizeChineseEvent(text.replace(pattern, replacement));
    }
  }
  let out = text;
  // Ordered longest-match-first to avoid partial replacements
  const pairs = [
    ["failed to intercept", "evt.failed"],
    ["received a midcourse abort and self-destructed after its target was destroyed.", "evt.selfDestruct"],
    ["exhausted fuel and fell into the sea.", "evt.exhausted"],
    ["lost its target and fell into the sea.", "evt.lostTarget"],
    ["CIWS destroyed incoming", "evt.ciwsDestroy"],
    ["CIWS failed against", "evt.ciwsFailed"],
    ["mission-killed", "evt.missionKilled"],
    ["hits sustained", "evt.hitsSustained"],
    ["class limit", "evt.classLimit"],
    ["subsystem damage:", "evt.subsysDmg"],
    ["side controls the battlespace. Simulation ended.", "evt.controls"],
    ["side cleared from scenario.", "evt.sideCleared"],
    ["removed from scenario.", "evt.removed"],
    ["Cannot run: both Blue and Red require at least one alive ship.", "evt.cannotRun"],
    ["launched", "evt.launched"],
    ["queued", "evt.queued"],
    ["intercepted", "evt.intercepted"],
    ["incoming", "evt.incoming"],
    ["hit by", "evt.hitBy"],
    ["Damage:", "evt.damage"],
    ["missed", "evt.missed"],
    ["duplicated from", "evt.duplicated"],
    ["placed.", "evt.placed"],
  ];
  for (const [en, key] of pairs) {
    out = out.replaceAll(en, t(key));
  }
  return normalizeChineseEvent(out);
}

/** Format clipboard log lines in the active UI language without duplicating side labels. */
export function formatLocalizedEventLines(events, formatEventTime) {
  return events
    .map((event) => `${formatEventTime(event.t)} ${translateEventText(event.text)}`)
    .join("\n");
}
