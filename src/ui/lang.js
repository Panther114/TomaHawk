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
  "opt.all":     { en: "ALL",     zh: "全部" },
  "opt.sel":     { en: "SEL",     zh: "选定" },
  "opt.off":     { en: "OFF",     zh: "关闭" },
  "map.select":       { en: "Tactical map", zh: "战术地图" },
  "map.eastChinaSea": { en: "EAST CHINA SEA", zh: "东海" },
  "map.openSea":      { en: "OPEN SEA", zh: "开放海域" },
  "scale.aria":       { en: "Map scale", zh: "地图比例尺" },
  "scale.grid":       { en: "GRID {n} km", zh: "网格 {n} 公里" },

  // Bottom bar buttons
  "btn.step":    { en: "STEP",    zh: "步进" },
  "btn.save":    { en: "SAVE",    zh: "保存" },
  "btn.load":    { en: "LOAD",    zh: "加载" },
  "btn.aar":     { en: "AAR",     zh: "战报" },
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
  "ship.f22":  { en: "F-22",  zh: "猛禽" },
  "ship.f35a": { en: "F-35A", zh: "隐攻" },
  "ship.f35c": { en: "F-35C", zh: "隐舰" },
  "ship.f15e": { en: "F-15E", zh: "攻鹰" },
  "ship.f15n": { en: "F-15N", zh: "舰鹰" },
  "ship.f15c": { en: "F-15C", zh: "空鹰" },
  "ship.afb":  { en: "AFB", zh: "机场" },

  // Placement / setup
  "place.addBlue": { en: "Add blue ship", zh: "添加蓝方舰艇" },
  "place.addRed":  { en: "Add red ship",  zh: "添加红方舰艇" },
  "place.class":   { en: "Ship class for placement", zh: "选择舰型" },
  "place.measure": { en: "Measure range/bearing (R)", zh: "测距/测向 (R)" },
  "place.revert":  { en: "Revert scenario",          zh: "重置想定" },
  "place.collapse":{ en: "Collapse panel (Tab)",      zh: "折叠面板 (Tab)" },

  // About overlay
  "about.title":      { en: "TOMAHAWK",            zh: "TOMAHAWK" },
  "about.subtitle":   { en: "Naval Sandbox v0.3",   zh: "海战沙盘 v0.3" },
  "about.desc1":      {
    en: "TomaHawk is a real-time naval-warfare sandbox. Place a Blue and a Red fleet, press Play, and watch two autonomous AI commands fight it out with radar detection, cooperative engagement, and layered missile defense. A side wins the instant the other has no ship left alive — there's no other scoring.",
    zh: "战斧是一款实时海战沙盘。为蓝、红双方部署舰队，按下播放键，观看两套自主 AI 指挥体系用雷达探测、协同交战与分层导弹防御展开较量。只要一方失去全部舰艇，对方立即获胜——没有其他计分方式。"
  },
  "about.h2controls": { en: "Controls",     zh: "操作" },
  "about.h2setup":    { en: "Setup",        zh: "部署" },
  "about.descSetup":  {
    en: "Pick BLUE or RED, choose a unit type — naval, ground, or air — from the class list, then click the map to place it. Ships need water and ground units need land; an illegal drop snaps back to the nearest legal spot. Drag a placed unit to reposition it, right-click to inspect it, and press Delete to remove your selection. Everything here locks the moment the battle starts.",
    zh: "选择 BLUE 或 RED，从类别列表中选取海上、陆基或空中单位，点击地图放置。舰艇需部署在水域，陆基单位需部署在陆地——放到非法位置会自动吸附回最近的合法位置。拖动已放置的单位可调整位置，右键可查看详情，按 Delete 可删除选中项。战斗一旦开始，这些操作全部锁定。"
  },
  "about.h2mechanics":{ en: "Mechanics",    zh: "机制" },
  "about.descMech1":  {
    en: "Each ship carries its own VLS magazine, six subsystems (radar, propulsion, fire control, CIWS, CIC) that degrade hit by hit, and a doctrine that governs how aggressively it fights. No unit ever sees the enemy's exact position — every contact is a radar track with quality and uncertainty that fades over time.",
    zh: "每艘舰艇都有自己的垂发弹药库、六个会随命中逐步受损的子系统（雷达、动力、射控、近防、战情），以及决定其交战积极程度的条令。没有任何单位能看到敌方的精确坐标——每个目标都只是一条带质量与不确定性、并会随时间衰减的雷达航迹。"
  },
  "about.descMech2":  {
    en: "SM-2MR and SM-6 are long-range air-defense interceptors, ESSM is the faster point-defense layer, and CIWS is the last-ditch gun. MaritimeStrike and TLAM are anti-ship strike missiles; AIM-120, AIM-9X, and AGM-84 arm your fighter squadrons for air-to-air combat and air-launched strikes.",
    zh: "SM-2MR 与 SM-6 是远程防空拦截弹，ESSM 是反应更快的点防御层，近防系统是最后一道防线；MaritimeStrike 与 TLAM 是反舰打击导弹；AIM-120、AIM-9X 与 AGM-84 则装备于战斗机中队，用于空战与机载对海打击。"
  },
  "about.descMech3":  {
    en: "The command AI weighs its own strength against whatever it can actually observe of the enemy, then settles into a posture from cautious survival to an all-out saturation strike — a concentrated, coordinated raid is what breaks through layered defenses, not a wide, thin one. Every ship always fires in self-defense, no matter its rules of engagement. Right-click any ship (or drag to select several) to inspect its live subsystem health and loadout.",
    zh: "指挥 AI 会将己方实力与观测到的敌情进行比较，并据此在“自保”与“全力饱和打击”之间切换姿态——真正能突破分层防御的，是集中、协同的齐射，而非分散的火力。无论交战规则如何设定，每艘舰艇始终会自卫还击。右键点击任意舰艇（或拖动多选）即可实时查看子系统状态与弹药情况。"
  },
  "about.kbSpace":    { en: "Play / Pause simulation",          zh: "播放 / 暂停模拟" },
  "about.kbDot":      { en: "Step forward 0.25 s",              zh: "前进 0.25 秒" },
  "about.kbEsc":      { en: "Cancel tool / deselect",           zh: "取消工具 / 取消选择" },
  "about.kbR":        { en: "Activate ruler tool",              zh: "启用标尺工具" },
  "about.kbTab":      { en: "Cycle selected ship",              zh: "循环选择舰艇" },
  "about.kbTilde":    { en: "Toggle tactical feed",             zh: "切换战术日志" },
  "about.kbDel":      { en: "Delete selected (setup only)",     zh: "删除选中（仅部署阶段）" },
  "about.kbLmb":      { en: "Select ship / place unit",         zh: "选择舰艇 / 放置单位" },
  "about.kbRmb":      { en: "Add to selection / box select",    zh: "追加选择 / 框选" },
  "about.kbMmb":      { en: "Pan map",                          zh: "平移地图" },
  "about.kbScroll":   { en: "Zoom in / out",                    zh: "缩放" },
  "about.close":      { en: "CLOSE",                            zh: "关闭" },

  // Tooltip hints for map options
  "tip.wzAll":   { en: "All ships",     zh: "全部舰艇" },
  "tip.wzSel":   { en: "Selected only", zh: "仅选中" },
  "tip.wzOff":   { en: "Hide rings",    zh: "隐藏" },
  "tip.wzMode":  { en: "Weapon range ring mode", zh: "武器射程圈显示模式" },

  // Language toggle
  "lang.toggle": { en: "中", zh: "EN" },

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
  "evt.cannotRun":  { en: "Cannot run: both Blue and Red require at least one alive ship.", zh: "无法运行：蓝红双方各需至少一艘存活舰艇。" },
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
