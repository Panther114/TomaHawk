import { MISSILES, NM, SHIP_CLASSES } from "../sim.js";

export const UNIT_CATEGORIES = [
  { id: "all", label: "全部装备" },
  { id: "sea", label: "海上" },
  { id: "subsurface", label: "水下" },
  { id: "ground", label: "陆基" },
  { id: "air", label: "空中" }
];

const BUILTIN = {
  DDG:  ["sea", "阿利·伯克级驱逐舰", "DDG", "区域防空 / 反舰", "surface-destroyer"],
  CCG:  ["sea", "提康德罗加级巡洋舰", "CG", "舰队防空指挥", "surface-cruiser"],
  BBG:  ["sea", "武库战列舰", "BBG", "重型远程打击", "surface-battleship"],
  FFG:  ["sea", "星座级护卫舰", "FFG", "护航 / 反潜", "surface-frigate"],
  CVN:  ["sea", "核动力航空母舰", "CVN", "舰载航空基地", "surface-carrier"],
  SSN:  ["subsurface", "弗吉尼亚级攻击核潜艇", "SSN", "水下伏击 / 远程打击", "submarine"],
  SAM:  ["ground", "岸基防空导弹营", "SAM", "区域防空", "ground-sam"],
  THAAD:["ground", "萨德反导营", "THAAD", "高超声速目标拦截", "ground-bmd"],
  CDB:  ["ground", "岸基反舰导弹营", "CDB", "远程反舰打击", "ground-strike"],
  DEB:  ["ground", "暗鹰高超声速导弹营", "LRHW", "高超声速远程打击", "ground-hypersonic"],
  EWR:  ["ground", "远程预警雷达站", "EWR", "远程搜索 / 航迹共享", "ground-radar"],
  AFB:  ["ground", "前沿空军基地", "AFB", "航空兵补给与再出动", "ground-airfield"],
  F22:  ["air", "F-22 猛禽战斗机", "F-22", "隐身制空", "air-fighter"],
  F35A: ["air", "F-35A 闪电 II 战斗机", "F-35A", "隐身对地打击", "air-strike"],
  F35C: ["air", "F-35C 闪电 II 舰载机", "F-35C", "舰载隐身反舰", "air-carrier-strike"],
  F15E: ["air", "F-15E 攻击鹰战斗机", "F-15E", "重型对地打击", "air-strike"],
  F15N: ["air", "F-15N 海上打击机", "F-15N", "重型反舰打击", "air-carrier-strike"],
  F15C: ["air", "F-15C 鹰式战斗机", "F-15C", "远程制空", "air-fighter"],
  F15EX:["air", "F-15EX 鹰 II 战斗机", "F-15EX", "多用途重型战斗机", "air-multirole"],
  F16V: ["air", "F-16V 蝰蛇战斗机", "F-16V", "轻型多用途打击", "air-multirole"],
  EA18G:["air", "EA-18G 咆哮者电子战机", "EA-18G", "电子压制 / 反辐射", "air-ew"],
  AWAC: ["air", "E-2D 鹰眼预警机", "E-2D AEW&C", "空中预警 / 指挥", "air-aew"]
};

function categoryForClass(cls) {
  if (cls.domain === "subsurface") return "subsurface";
  if (cls.domain === "air") return "air";
  if (cls.domain === "ground" || cls.isFixed) return "ground";
  return "sea";
}

function loadedRange(cls) {
  let rangeNm = 0;
  for (const id of Object.keys(cls.baseLoadout || {})) {
    rangeNm = Math.max(rangeNm, (MISSILES[id]?.rangeM || 0) / NM);
  }
  return Math.round(rangeNm);
}

function statsFor(cls) {
  const radar = Math.round(cls.radarRangeNm || 0);
  const speed = Math.round(cls.maxSpeedKt || 0);
  const weaponRange = loadedRange(cls);
  if (cls.domain === "air") {
    return [
      `${cls.damageResist || 1} 架`,
      speed ? `${speed} 节等效` : "固定翼",
      radar ? `雷达 ${radar} 海里` : "无主动雷达"
    ];
  }
  if (cls.domain === "ground" || cls.isFixed) {
    return [
      radar ? `雷达 ${radar} 海里` : "无主动雷达",
      weaponRange ? `射程 ${weaponRange} 海里` : "无武装",
      cls.isAirfield ? "航空保障" : "固定阵地"
    ];
  }
  return [
    speed ? `极速 ${speed} 节` : "隐蔽航行",
    radar ? `雷达 ${radar} 海里` : "被动探测",
    `${cls.vlsCells || 0} 单元`
  ];
}

export function unitCatalog() {
  return Object.entries(SHIP_CLASSES).map(([id, cls]) => {
    const preset = BUILTIN[id];
    const category = preset?.[0] || categoryForClass(cls);
    const zhName = preset?.[1] || cls.prefixZh || cls.prefix || id;
    const designation = preset?.[2] || id;
    const role = preset?.[3] || "自定义作战单位";
    const symbolId = preset?.[4] || `${category}-${cls.glyph || "unit"}`;
    return {
      id,
      category,
      zhName,
      designation,
      role,
      artwork: preset ? `src/assets/equipment/${id.toLowerCase()}.webp` : "",
      symbolId,
      searchTerms: [id, zhName, designation, role, cls.className, cls.prefix].filter(Boolean).join(" ").toLowerCase(),
      statSummary: statsFor(cls),
      custom: !preset
    };
  });
}

export function unitPresentation(id, cls = SHIP_CLASSES[id]) {
  return unitCatalog().find((item) => item.id === id) || {
    id,
    category: categoryForClass(cls || {}),
    zhName: cls?.prefixZh || cls?.prefix || id,
    designation: id,
    role: "自定义作战单位",
    artwork: "",
    symbolId: `${categoryForClass(cls || {})}-${cls?.glyph || "unit"}`,
    searchTerms: id.toLowerCase(),
    statSummary: statsFor(cls || {}),
    custom: true
  };
}

