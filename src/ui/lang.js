// 破晓前夜的集中式简体中文消息目录。军事型号与通用缩写保留原文。
const strings = {
  "scale.grid": "网格 {n} 公里",
  "status.ready": "部署就绪",
  "status.paused": "已暂停",
  "status.ended": "已结束",
  "status.running": "推演中",
  "status.invalid": "蓝红双方各需至少一个存活单位",
  "status.agg": "攻势",
  "detail.radar": "雷达",
  "detail.prop": "动力",
  "detail.vls": "垂发",
  "detail.fcs": "射控",
  "detail.ciws": "近防",
  "detail.cic": "战情",
  "detail.ac": "飞机",
  "detail.fuel": "燃油",
  "detail.flares": "诱饵",
  "detail.state": "状态",
  "detail.alt": "高度",
  "detail.aaw": "防空",
  "detail.asuw": "反舰",
  "detail.load": "弹药",
  "detail.rdr": "雷达距",
  "detail.depth": "深度",
  "detail.sonar": "声呐",
  "detail.esm": "电侦",
  "detail.jam": "干扰",
  "detail.decoy": "诱饵",
  "ship.ddg": "驱逐舰",
  "ship.ccg": "巡洋舰",
  "ship.bbg": "战列舰",
  "ship.ffg": "护卫舰",
  "ship.cvn": "航母",
  "ship.ssn": "攻击型核潜艇",
  "ship.sam": "防空营",
  "ship.thaad": "萨德反导营",
  "ship.cdb": "岸基反舰营",
  "ship.deb": "暗鹰导弹营",
  "ship.ewr": "预警雷达",
  "ship.afb": "空军基地",
  "ship.f22": "F-22",
  "ship.f35a": "F-35A",
  "ship.f35c": "F-35C",
  "ship.f15e": "F-15E",
  "ship.f15n": "F-15N",
  "ship.f15c": "F-15C",
  "ship.f15ex": "F-15EX",
  "ship.f16v": "F-16V",
  "ship.ea18g": "EA-18G 电子战机",
  "ship.awac": "预警机",
  "naval.group": "海上",
  "subsurface.group": "水下",
  "ground.group": "陆基",
  "air.group": "空中",
  "inv.ship": "舰名",
  "inv.unit": "单位",
  "inv.hp": "耐久",
  "inv.vls": "垂发",
  "inv.rdr": "雷达",
  "inv.aaw": "防空",
  "inv.asuw": "反舰",
  "inv.ac": "飞机",
  "inv.state": "状态",
  "role.otc": "总指挥",
  "role.aawc": "防空指挥",
  "side.blue": "蓝",
  "side.red": "红",
  "side.sys": "系",
  "confirm.yes": "确定",
  "save.cancel": "取消",
  "save.overwrite": "已存在名为“{n}”的想定，是否覆盖？",
  "save.done": "想定已保存。",
  "save.failed": "保存失败。",
  "load.empty": "暂无已保存的想定。",
  "load.delete": "删除",
  "load.deleteConfirm": "删除想定“{n}”？",
  "load.failed": "无法加载想定列表。",
  "opt.tracks": "锁定"
};

export function t(key) {
  return strings[key] ?? key;
}

export function hullLabel(hull) {
  return t(`ship.${(hull || "DDG").toLowerCase()}`);
}

export function roleLabel(role) {
  if (role === "OTC") return t("role.otc");
  if (role === "AAWC") return t("role.aawc");
  return role;
}

export function sideLabel(side) {
  const normalized = String(side ?? "").toUpperCase();
  if (normalized === "BLUE") return t("side.blue");
  if (normalized === "RED") return t("side.red");
  return t("side.sys");
}

function normalizeChineseEvent(value) {
  return value
    .replaceAll("BLUE", "蓝方")
    .replaceAll("Blue", "蓝方")
    .replaceAll("RED", "红方")
    .replaceAll("Red", "红方")
    .replaceAll(" salvo", " 齐射")
    .replaceAll("approx.", "（近似）")
    .replaceAll("approx", "（近似）")
    .replaceAll(" 齐射 攻击", " 齐射攻击")
    .replaceAll("（近似） 发射", "（近似）发射")
    .replaceAll(".。", "。");
}

/** 将模拟核心的稳定英文事件文本转换为自然中文显示文本。 */
export function translateEventText(rawText) {
  let text = String(rawText ?? "").replaceAll("Arleigh Burke Flight IIA approx.", "敌方 DDG");
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
    [/^(BLUE|RED) side cleared from scenario\.$/, "$1已从想定中清除。"],
    [/^(BLUE|RED) side controls the battlespace\. Simulation ended\.$/, "$1控制战场，推演结束。"]
  ];
  for (const [pattern, replacement] of sentencePatterns) {
    if (pattern.test(text)) return normalizeChineseEvent(text.replace(pattern, replacement));
  }
  const replacements = [
    ["received a midcourse abort and self-destructed after its target was destroyed.", "收到中段终止指令，因目标已摧毁而自毁。"],
    ["exhausted fuel and fell into the sea.", "燃料耗尽，坠入海中。"],
    ["lost its target and fell into the sea.", "丢失目标，坠入海中。"],
    ["failed to intercept", "未能拦截"],
    ["CIWS destroyed incoming", "近防系统击毁来袭"],
    ["CIWS failed against", "近防系统未能拦截"],
    ["mission-killed", "失去任务能力"],
    ["hits sustained", "累计命中"],
    ["class limit", "舰级上限"],
    ["subsystem damage:", "子系统损伤："],
    ["Cannot run: both Blue and Red require at least one alive ship.", "无法开始：蓝红双方各需至少一个存活单位。"],
    ["intercepted", "拦截"],
    ["incoming", "来袭"],
    ["hit by", "被命中"],
    ["Damage:", "损伤："],
    ["missed", "未命中"],
    ["duplicated from", "复制自"],
    ["placed.", "部署完成。"]
  ];
  for (const [source, translated] of replacements) text = text.replaceAll(source, translated);
  return normalizeChineseEvent(text);
}

export function formatLocalizedEventLines(events, formatEventTime) {
  return events
    .map((event) => `${formatEventTime(event.t)} ${translateEventText(event.text)}`)
    .join("\n");
}
