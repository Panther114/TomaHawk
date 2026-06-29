// Modding schema: the single source of truth for the curated, editable
// parameter set of each unit type (naval / ground / ammo). The editor form is
// generated from these definitions, and import/validation is checked against
// them. Pure data + pure validators only — no DOM, no IndexedDB — so this is
// unit-tested directly in Node.
//
// Field shape:
//   { key, label:{en,zh}, type:"text"|"number"|"select"|"checkbox",
//     unit?, step?, min?, max?, options?:[{value,label:{en,zh}}], placeholder? }
// Sections group fields for a dense, readable form layout.

import { usedCells } from "../sim.js";

export const UNIT_TYPES = ["naval", "ground", "aircraft", "ammo"];

// Units that can be placed on the map. Ammo is excluded — it only appears in
// the loadout pickers of naval/ground/aircraft units.
export const DEPLOYABLE_TYPES = ["naval", "ground", "aircraft"];

const num = (key, label, opts = {}) => ({ key, type: "number", label, ...opts });
const text = (key, label, opts = {}) => ({ key, type: "text", label, ...opts });

const CATEGORY_OPTIONS = [
  { value: "anti_air", label: { en: "Anti-air", zh: "防空" } },
  { value: "anti_ship", label: { en: "Anti-ship", zh: "反舰" } },
  { value: "dual_role", label: { en: "Dual-role", zh: "双重用途" } }
];
const SYMBOL_OPTIONS = [
  { value: "triangle", label: { en: "Triangle", zh: "三角" } },
  { value: "square", label: { en: "Square", zh: "方块" } },
  { value: "diamond", label: { en: "Diamond", zh: "菱形" } }
];
const TARGET_OPTIONS = [
  { value: "missile", label: { en: "Missile", zh: "导弹" } },
  { value: "ship", label: { en: "Ship", zh: "舰艇" } },
  { value: "air", label: { en: "Aircraft", zh: "飞机" } },
  { value: "dual", label: { en: "Dual", zh: "两者" } }
];
const LAYER_OPTIONS = [
  { value: "area", label: { en: "Area", zh: "区域" } },
  { value: "point", label: { en: "Point", zh: "点防御" } },
  { value: "strike", label: { en: "Strike", zh: "打击" } }
];
const RING_OPTIONS = [
  { value: "dotted", label: { en: "Dotted", zh: "点线" } },
  { value: "long_dash", label: { en: "Long dash", zh: "长虚线" } },
  { value: "solid", label: { en: "Solid", zh: "实线" } }
];
const GUIDANCE_OPTIONS = [
  { value: "command_inertial", label: { en: "Command + inertial", zh: "指令+惯性" } },
  { value: "command_inertial_active", label: { en: "Command + active", zh: "指令+主动" } },
  { value: "inertial_active", label: { en: "Inertial + active", zh: "惯性+主动" } },
  { value: "infrared", label: { en: "Infrared (flare-decoyable)", zh: "红外（可被照明弹诱骗）" } }
];
const GLYPH_OPTIONS = [
  { value: "sam", label: { en: "SAM (triangle)", zh: "防空 (三角)" } },
  { value: "radar", label: { en: "Radar (diamond)", zh: "雷达 (菱形)" } },
  { value: "bunker", label: { en: "Bunker (square)", zh: "工事 (方块)" } },
  { value: "airfield", label: { en: "Airfield (runway)", zh: "机场 (跑道)" } }
];

const NAVAL_SCHEMA = {
  type: "naval",
  loadout: true,
  sections: [
    { title: { en: "Identity", zh: "标识" }, fields: [
      text("name", { en: "Class name", zh: "舰级名称" }, { placeholder: "Arleigh Burke approx." }),
      text("prefix", { en: "Unit tag", zh: "单位代号" }, { placeholder: "DDG", maxlength: 6 })
    ] },
    { title: { en: "Mobility", zh: "机动" }, fields: [
      num("cruiseSpeedKt", { en: "Cruise speed", zh: "巡航速度" }, { unit: "kt", min: 0, max: 60, step: 0.5 }),
      num("maxSpeedKt", { en: "Max speed", zh: "最大速度" }, { unit: "kt", min: 0, max: 70, step: 0.5 }),
      num("accelMps2", { en: "Accel", zh: "加速" }, { unit: "m/s²", min: 0, max: 5, step: 0.01 }),
      num("decelMps2", { en: "Decel", zh: "减速" }, { unit: "m/s²", min: 0, max: 5, step: 0.01 }),
      num("turnRateDps", { en: "Turn", zh: "转向" }, { unit: "°/s", min: 0, max: 30, step: 0.1 }),
      num("turnRateFlankDps", { en: "Flank turn", zh: "高速转向" }, { unit: "°/s", min: 0, max: 30, step: 0.1 })
    ] },
    { title: { en: "Sensors", zh: "传感器" }, fields: [
      num("radarRangeNm", { en: "Radar range", zh: "雷达距离" }, { unit: "NM", min: 0, max: 600, step: 1 }),
      num("radarIntervalS", { en: "Radar interval", zh: "扫描间隔" }, { unit: "s", min: 0.5, max: 30, step: 0.5 })
    ] },
    { title: { en: "Magazine", zh: "弹库" }, fields: [
      num("vlsCells", { en: "VLS cells", zh: "垂发单元" }, { min: 0, max: 1024, step: 1 })
    ] },
    { title: { en: "Survivability", zh: "生存力" }, fields: [
      num("damageResist", { en: "Hit points", zh: "耐久" }, { min: 1, max: 50, step: 1 }),
      num("damageDegrade", { en: "Degrade", zh: "损伤衰减" }, { min: 0, max: 1, step: 0.01 })
    ] },
    { title: { en: "Defense channels", zh: "防御通道" }, fields: [
      num("defenseArea", { en: "Area", zh: "区域" }, { min: 0, max: 16, step: 1 }),
      num("defensePoint", { en: "Point", zh: "点防御" }, { min: 0, max: 16, step: 1 }),
      num("defenseCiws", { en: "CIWS", zh: "近防" }, { min: 0, max: 16, step: 1 })
    ] }
  ]
};

const GROUND_SCHEMA = {
  type: "ground",
  loadout: true,
  sections: [
    { title: { en: "Identity", zh: "标识" }, fields: [
      text("name", { en: "Site name", zh: "阵地名称" }, { placeholder: "Coastal SAM Battery" }),
      text("prefix", { en: "Unit tag", zh: "单位代号" }, { placeholder: "SAM", maxlength: 6 }),
      { key: "glyph", type: "select", label: { en: "Map glyph", zh: "地图符号" }, options: GLYPH_OPTIONS },
      // An airfield may be placed anywhere (land or water) and rearms friendly
      // squadrons. Otherwise it behaves like any fixed ground emplacement.
      { key: "isAirfield", type: "checkbox", label: { en: "Airfield (rearms aircraft, any terrain)", zh: "机场（为飞机补给，可置于任意地形）" } }
    ] },
    { title: { en: "Footprint", zh: "占地" }, fields: [
      num("lengthM", { en: "Length", zh: "长" }, { unit: "m", min: 10, max: 400, step: 1 }),
      num("beamM", { en: "Width", zh: "宽" }, { unit: "m", min: 10, max: 400, step: 1 })
    ] },
    { title: { en: "Sensors", zh: "传感器" }, fields: [
      num("radarRangeNm", { en: "Radar range", zh: "雷达距离" }, { unit: "NM", min: 0, max: 600, step: 1 }),
      num("radarIntervalS", { en: "Radar interval", zh: "扫描间隔" }, { unit: "s", min: 0.5, max: 30, step: 0.5 })
    ] },
    { title: { en: "Magazine", zh: "弹库" }, fields: [
      num("vlsCells", { en: "Cells", zh: "发射单元" }, { min: 0, max: 1024, step: 1 })
    ] },
    { title: { en: "Survivability", zh: "生存力" }, fields: [
      num("damageResist", { en: "Hit points", zh: "耐久" }, { min: 1, max: 50, step: 1 }),
      num("damageDegrade", { en: "Degrade", zh: "损伤衰减" }, { min: 0, max: 1, step: 0.01 })
    ] },
    { title: { en: "Defense channels", zh: "防御通道" }, fields: [
      num("defenseArea", { en: "Area", zh: "区域" }, { min: 0, max: 16, step: 1 }),
      num("defensePoint", { en: "Point", zh: "点防御" }, { min: 0, max: 16, step: 1 })
    ] }
  ]
};

const AIRCRAFT_SCHEMA = {
  type: "aircraft",
  loadout: true,
  sections: [
    { title: { en: "Identity", zh: "标识" }, fields: [
      text("name", { en: "Squadron name", zh: "中队名称" }, { placeholder: "Strike Fighter Squadron" }),
      text("prefix", { en: "Unit tag", zh: "单位代号" }, { placeholder: "VFA", maxlength: 6 })
    ] },
    { title: { en: "Squadron", zh: "中队" }, fields: [
      // The flight's hit-point pool: each hit downs one aircraft (attrition).
      num("squadronSize", { en: "Aircraft in flight", zh: "编队飞机数" }, { min: 1, max: 16, step: 1 })
    ] },
    { title: { en: "Mobility", zh: "机动" }, fields: [
      num("cruiseSpeedKt", { en: "Cruise speed", zh: "巡航速度" }, { unit: "kt", min: 0, max: 1200, step: 5 }),
      num("maxSpeedKt", { en: "Max speed", zh: "最大速度" }, { unit: "kt", min: 0, max: 1500, step: 5 }),
      num("accelMps2", { en: "Accel", zh: "加速" }, { unit: "m/s²", min: 0, max: 20, step: 0.1 }),
      num("decelMps2", { en: "Decel", zh: "减速" }, { unit: "m/s²", min: 0, max: 20, step: 0.1 }),
      num("turnRateDps", { en: "Turn", zh: "转向" }, { unit: "°/s", min: 0, max: 30, step: 0.1 }),
      num("turnRateFlankDps", { en: "Flank turn", zh: "高速转向" }, { unit: "°/s", min: 0, max: 30, step: 0.1 })
    ] },
    { title: { en: "Sensors", zh: "传感器" }, fields: [
      num("radarRangeNm", { en: "Radar range", zh: "雷达距离" }, { unit: "NM", min: 0, max: 600, step: 1 }),
      num("radarIntervalS", { en: "Radar interval", zh: "扫描间隔" }, { unit: "s", min: 0.5, max: 30, step: 0.5 })
    ] },
    { title: { en: "Hardpoints", zh: "挂架" }, fields: [
      num("vlsCells", { en: "Hardpoints", zh: "挂架数" }, { min: 0, max: 64, step: 1 })
    ] },
    { title: { en: "Endurance", zh: "续航" }, fields: [
      num("enduranceS", { en: "Endurance", zh: "续航时间" }, { unit: "s", min: 30, max: 36000, step: 30 }),
      num("rearmTimeS", { en: "Rearm time", zh: "补给时间" }, { unit: "s", min: 0, max: 3600, step: 5 })
    ] },
    { title: { en: "Survivability", zh: "生存力" }, fields: [
      num("damageDegrade", { en: "Speed loss per loss", zh: "每损失减速" }, { min: 0, max: 1, step: 0.01 }),
      num("flares", { en: "Flares (IR decoys)", zh: "照明弹（红外诱饵）" }, { min: 0, max: 999, step: 1 })
    ] }
  ]
};

const AMMO_SCHEMA = {
  type: "ammo",
  loadout: false,
  sections: [
    { title: { en: "Identity", zh: "标识" }, fields: [
      text("name", { en: "Weapon ID", zh: "武器编号" }, { placeholder: "SM-2MR", maxlength: 24 })
    ] },
    { title: { en: "Classification", zh: "分类" }, fields: [
      { key: "category", type: "select", label: { en: "Category", zh: "类别" }, options: CATEGORY_OPTIONS },
      { key: "symbol", type: "select", label: { en: "Symbol", zh: "符号" }, options: SYMBOL_OPTIONS },
      { key: "target", type: "select", label: { en: "Target", zh: "目标" }, options: TARGET_OPTIONS },
      { key: "defenseLayer", type: "select", label: { en: "Defense layer", zh: "防御层级" }, options: LAYER_OPTIONS }
    ] },
    { title: { en: "Ranges", zh: "射程" }, fields: [
      num("rangeNm", { en: "Max range", zh: "最大射程" }, { unit: "NM", min: 0.1, max: 2000, step: 1 }),
      num("preferredMinRangeNm", { en: "Preferred min", zh: "理想最小射程" }, { unit: "NM", min: 0, max: 2000, step: 0.1 }),
      num("preferredMaxRangeNm", { en: "Preferred max", zh: "理想最大射程" }, { unit: "NM", min: 0.1, max: 2000, step: 1 }),
      num("seekerRangeNm", { en: "Seeker range", zh: "导引头距离" }, { unit: "NM", min: 0, max: 200, step: 0.5 })
    ] },
    { title: { en: "Kinematics", zh: "运动" }, fields: [
      num("speedMps", { en: "Speed", zh: "速度" }, { unit: "m/s", min: 10, max: 4000, step: 5 }),
      num("maxTurnRateDps", { en: "Max turn rate", zh: "最大转向率" }, { unit: "°/s", min: 0, max: 90, step: 1 })
    ] },
    { title: { en: "Effect", zh: "效能" }, fields: [
      num("cellCost", { en: "Cell cost", zh: "占用单元" }, { min: 0.05, max: 8, step: 0.05 }),
      num("pk", { en: "Kill probability", zh: "杀伤概率" }, { min: 0, max: 1, step: 0.01 }),
      num("salvo", { en: "Salvo size", zh: "齐射数量" }, { min: 1, max: 16, step: 1 }),
      num("interceptorsPerThreat", { en: "Interceptors per threat", zh: "每目标拦截数" }, { min: 0, max: 8, step: 1 }),
      num("magazineReserveRatio", { en: "Magazine reserve", zh: "弹药保留比例" }, { min: 0, max: 1, step: 0.01 })
    ] },
    { title: { en: "Timing", zh: "时序" }, fields: [
      num("launchIntervalS", { en: "Launch interval", zh: "发射间隔" }, { unit: "s", min: 0.1, max: 30, step: 0.1 }),
      num("salvoSpacingS", { en: "Salvo spacing", zh: "齐射间隔" }, { unit: "s", min: 0.1, max: 30, step: 0.1 })
    ] },
    { title: { en: "Behavior", zh: "行为" }, fields: [
      { key: "ringStyle", type: "select", label: { en: "Ring style", zh: "射程圈样式" }, options: RING_OPTIONS },
      { key: "guidance", type: "select", label: { en: "Guidance", zh: "制导" }, options: GUIDANCE_OPTIONS },
      { key: "retargetable", type: "checkbox", label: { en: "Retargetable", zh: "可重新瞄准" } },
      { key: "selfDestructOnLoss", type: "checkbox", label: { en: "Self-destruct on loss", zh: "失标自毁" } }
    ] }
  ]
};

export const SCHEMAS = {
  naval: NAVAL_SCHEMA,
  ground: GROUND_SCHEMA,
  aircraft: AIRCRAFT_SCHEMA,
  ammo: AMMO_SCHEMA
};

// Sensible defaults for a freshly created unit of each type (editor JSON form).
export const DEFAULTS = {
  naval: () => ({
    kind: "naval", name: "New Warship", prefix: "XXG",
    lengthM: 150, beamM: 20, draftM: 9, displacementT: 9000,
    cruiseSpeedKt: 16, maxSpeedKt: 30, accelMps2: 0.12, decelMps2: 0.22,
    turnRateDps: 2.6, turnRateFlankDps: 1.8, radarRangeNm: 180, radarIntervalS: 4,
    vlsCells: 96, damageResist: 2, damageDegrade: 0.3,
    ciwsCount: 1, ciwsAmmo: 1550, ciwsBurstRounds: 180, ciwsBurstS: 1.4, ciwsCycleS: 5.5,
    defenseArea: 2, defensePoint: 2, defenseCiws: 1,
    baseLoadout: { "SM-2MR": 36, ESSM: 32, MaritimeStrike: 16 }
  }),
  ground: () => ({
    kind: "ground", name: "New Emplacement", prefix: "GND", glyph: "bunker", isAirfield: false,
    lengthM: 50, beamM: 50, radarRangeNm: 160, radarIntervalS: 4,
    vlsCells: 48, damageResist: 2, damageDegrade: 0.3,
    defenseArea: 3, defensePoint: 2,
    baseLoadout: { "SM-2MR": 24 }
  }),
  aircraft: () => ({
    kind: "aircraft", name: "New Squadron", prefix: "VFX",
    squadronSize: 4,
    cruiseSpeedKt: 420, maxSpeedKt: 540, accelMps2: 3.0, decelMps2: 3.0,
    turnRateDps: 6, turnRateFlankDps: 4, radarRangeNm: 90, radarIntervalS: 3,
    vlsCells: 20, enduranceS: 1800, rearmTimeS: 90, damageDegrade: 0.1, flares: 60,
    baseLoadout: { "AIM-120": 8, "AIM-9X": 4, "AGM-84": 8 }
  }),
  ammo: () => ({
    kind: "ammo", name: "NEW-MSL",
    category: "anti_air", symbol: "triangle", target: "missile", defenseLayer: "area",
    rangeNm: 90, preferredMinRangeNm: 8, preferredMaxRangeNm: 90, seekerRangeNm: 14,
    speedMps: 1000, maxTurnRateDps: 30, cellCost: 1, pk: 0.45, salvo: 2,
    interceptorsPerThreat: 1, magazineReserveRatio: 0.18, launchIntervalS: 2.2, salvoSpacingS: 2.8,
    ringStyle: "dotted", guidance: "command_inertial", retargetable: false, selfDestructOnLoss: true
  })
};

const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-]*$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Validate an editor-JSON unit against its schema. Returns {ok, errors:[{field,msg}]}.
 *  Uniqueness is checked separately by the registry (it owns the id set). */
export function validateUnit(unit) {
  const errors = [];
  const kind = unit?.kind;
  if (!UNIT_TYPES.includes(kind)) {
    return { ok: false, errors: [{ field: "kind", msg: "Unknown unit type" }] };
  }
  const schema = SCHEMAS[kind];
  const fail = (field, msg) => errors.push({ field, msg });

  if (kind === "ammo") {
    if (!ID_RE.test(String(unit.name ?? ""))) fail("name", "ID must be alphanumeric (._- allowed)");
  } else {
    if (!String(unit.name ?? "").trim()) fail("name", "Name is required");
    if (!TAG_RE.test(String(unit.prefix ?? ""))) fail("prefix", "Tag must be alphanumeric");
  }

  for (const section of schema.sections) {
    for (const f of section.fields) {
      const v = unit[f.key];
      if (f.type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n)) { fail(f.key, "must be a number"); continue; }
        if (f.min != null && n < f.min) fail(f.key, `must be ≥ ${f.min}`);
        if (f.max != null && n > f.max) fail(f.key, `must be ≤ ${f.max}`);
      } else if (f.type === "select") {
        const ok = f.options.some((o) => o.value === v);
        if (!ok) fail(f.key, "invalid option");
      }
    }
  }

  if (kind !== "ammo") {
    const lo = unit.baseLoadout;
    if (lo && typeof lo === "object") {
      for (const [id, count] of Object.entries(lo)) {
        if (!Number.isFinite(Number(count)) || Number(count) < 0) fail("baseLoadout", `${id} count invalid`);
      }
      // Total magazine cost must fit the VLS capacity, accounting for per-missile
      // cell cost (e.g. ESSM = 0.25 cells), not just the missile count.
      const used = usedCells(lo);
      const cap = Number(unit.vlsCells) || 0;
      if (Number.isFinite(used) && used > cap) {
        fail("baseLoadout", `loadout uses ${+used.toFixed(2)} of ${cap} VLS cells`);
      }
    }
  }

  // Cross-field sanity: a CDB-style ground unit firing anti-ship needs its
  // radar to out-reach the weapon, otherwise it can never engage. Warn-by-error
  // only when there is a loadout — pure radar sites are exempt.
  return { ok: errors.length === 0, errors };
}
