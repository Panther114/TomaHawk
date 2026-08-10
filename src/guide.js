// 战斧交互式操作手册 —— 全屏沉浸式教学
// 真实沙盘铺满整个屏幕；金色的光标提示反复指向目标，聚光灯高亮目标区域。
// 每一步只允许点击当前教学目标（严格点击门控），完成操作后自动进入下一步。
// 教程不持久化进度，每次打开都从第 1 步开始。
// 教学期间锁定地图缩放、平移与无关快捷键，保证镜头与推演状态稳定。

const POLL_MS = 200;
const AUTO_ADVANCE_MS = 450;
const READY_TIMEOUT_MS = 12000;
const STUCK_MS = 20000;

const byId = (id) => document.getElementById(id);
const frame = byId("sandbox-frame");

const CHAPTERS = [
  { title: "部署兵力", desc: "从零到第一支部队" },
  { title: "阵营与图层", desc: "双方就位，打开视野" },
  { title: "运行与判读", desc: "播放、调速、读战况" },
  { title: "系统工具", desc: "保存与单位工坊" }
];

const OVERLAY_SELECTORS = ["#equipment-overlay", "#mods-overlay", "#save-overlay", "#load-overlay"];

// 每个步骤由真实沙盘的 DOM 状态驱动：
// - allowed：本步（或本阶段）唯一可点击的目标选择器；其余一律被拦截。
// - phases：多操作步骤按阶段推进，每阶段有各自的检查、文案、目标与可点击范围。
// - readOnly：只读步骤（如读战况），无任何可点击目标，阅读后手动下一步。
// - coach：教学卡停靠方位，始终避开目标区域。
const STEPS = [
  {
    id: "deploy-open",
    chapter: 0,
    title: "打开装备库",
    body: "所有兵力都从装备库出发。装备库按水面、水下、地面、空中分类，也可以用搜索框直接找型号。",
    action: "点击左上角的「部署兵力」按钮。",
    target: "#deploy-open",
    coach: "right",
    hint: "点击这里",
    allowed: ["#deploy-open"],
    done: (doc) => !doc.querySelector("#equipment-overlay").hidden
  },
  {
    id: "library-pick",
    chapter: 0,
    title: "为蓝方选择装备",
    body: "悬停装备卡会出现蓝、红两个部署半区：左侧归蓝方，右侧归红方。我们先为蓝方选一艘驱逐舰 DDG。",
    action: "把鼠标移到「驱逐舰 DDG」卡片上，点击左侧的蓝色半区。",
    target: ".equipment-card[data-equipment='DDG'] .equipment-side-blue",
    coach: "bottom",
    hint: "点击蓝色半区",
    allowed: [".equipment-card[data-equipment='DDG'] .equipment-side-blue"],
    done: (doc) => !doc.querySelector("#placement-chip").hidden
  },
  {
    id: "place-unit",
    chapter: 0,
    title: "在海域放置单位",
    body: "移动光标时，符号是蓝色表示位置合法，红色表示非法——舰艇必须部署在水域。单击放置，保持部署模式可以连续放置。",
    action: "把光标移到海面上，确认轮廓为蓝色后单击放置。",
    target: null,
    spot: { fx: 0.32, fy: 0.42 },
    coach: "right",
    hint: "点击海面",
    keys: ["Esc", "结束部署"],
    allowed: ["#map"],
    done: (doc) => unitsOf(doc, "blue") >= 1
  },
  {
    id: "deploy-red",
    chapter: 1,
    title: "为红方部署兵力",
    body: "推演需要双方都有兵力。这次把单位划给红方：先打开装备库，再点击卡片右侧的红色半区，最后在海面放置。",
    action: "点击左上角「部署兵力」按钮。",
    target: "#deploy-open",
    coach: "right",
    allowed: ["#deploy-open"],
    phases: [
      {
        check: (doc) => !doc.querySelector("#equipment-overlay").hidden,
        action: "点击左上角「部署兵力」按钮。",
        target: "#deploy-open",
        hint: "点击这里",
        allowed: ["#deploy-open"]
      },
      {
        check: (doc) => {
          const chip = doc.querySelector("#placement-chip");
          return chip && !chip.hidden && chip.classList.contains("red");
        },
        action: "悬停「驱逐舰 DDG」卡片，点击右侧的红色半区。",
        target: ".equipment-card[data-equipment='DDG'] .equipment-side-red",
        hint: "点击红色半区",
        allowed: [".equipment-card[data-equipment='DDG'] .equipment-side-red"]
      },
      {
        check: (doc) => unitsOf(doc, "red") >= 1,
        action: "回到海面，单击放置红方单位。",
        spot: { fx: 0.68, fy: 0.58 },
        hint: "点击海面",
        allowed: ["#map"]
      }
    ],
    done: () => false
  },
  {
    id: "layers",
    chapter: 1,
    title: "用图层控制视野",
    body: "图层决定地图显示哪些信息：网格、航迹、雷达范围、武器射程和飞行武器。需要什么就开什么，避免范围环互相遮挡。",
    action: "点击左下角「图层」按钮。",
    target: "#layers-toggle",
    coach: "right",
    allowed: ["#layers-toggle"],
    phases: [
      {
        check: (doc) => !doc.querySelector("#map-options").hidden,
        action: "点击左下角「图层」按钮。",
        target: "#layers-toggle",
        hint: "点击图层按钮",
        allowed: ["#layers-toggle"]
      },
      {
        check: (doc) => doc.querySelector("#filter-radar").checked,
        action: "勾选「雷达范围」，其它图层开关也可以试试。",
        target: "#filter-radar",
        hint: "勾选这里",
        allowed: ['#map-options input[type="checkbox"]']
      }
    ],
    done: () => false
  },
  {
    id: "playback",
    chapter: 2,
    title: "开始推演",
    body: "点击播放后，双方指挥 AI 只依据本方传感器与共享航迹自主行动：机动、探测、发射与拦截都由系统接管。",
    action: "点击底部中央的 ▶ 播放按钮。",
    target: "#play",
    coach: "top",
    hint: "点击播放",
    keys: ["Space", "播放 / 暂停"],
    allowed: ["#play"],
    done: (doc) => (doc.querySelector("#play").textContent || "").includes("Ⅱ")
  },
  {
    id: "speed",
    chapter: 2,
    title: "调速与暂停",
    body: "速度滑杆从 1× 到 100×。平静阶段拉高速跳过，接近关键区域再降速观察；随时暂停，用句号键单步推进。",
    action: "把速度滑杆向右拖到 12× 以上，感受节奏。",
    target: "#speed",
    coach: "top",
    hint: "拖到这里",
    keys: [".", "单步推进"],
    allowed: ["#speed"],
    done: (doc) => speedOf(doc) >= 12
  },
  {
    id: "overview",
    chapter: 2,
    title: "读取战况总览",
    body: "顶部战况条实时汇总双方指标：存活目标、总生命、在空武器与拦截率。蓝方在左、红方在右；哪一方指标归零，就离失败不远了。",
    action: "对照双方的指标，阅读完成后点击「下一步」。",
    target: "#battle-overview",
    coach: "right",
    readOnly: true,
    allowed: [],
    done: () => false
  },
  {
    id: "select-unit",
    chapter: 2,
    title: "选中单位，读取详情",
    body: "右侧「兵力列表」实时显示每支部队的生命、弹药与状态。点击任意一行，地图上的对应单位会高亮。",
    action: "在右侧兵力列表中点击任意一行（也可以直接点击地图上的单位符号）。",
    target: "#unit-tab",
    coach: "left",
    hint: "点击一行",
    allowed: ["#unit-tab [data-select-ship]", "#map"],
    baseSelection: null,
    done(doc) {
      const selected = doc.querySelector("#unit-tab [data-select-ship].selected");
      const id = selected?.dataset.selectShip;
      return Boolean(id) && id !== this.baseSelection;
    }
  },
  {
    id: "save",
    chapter: 3,
    title: "保存推演",
    body: "系统工具在右下角：保存、载入、导出战报 AAR、单位工坊和重置都收在这里，不占用战术地图。",
    action: "点击「保存推演」，看到保存对话框。",
    target: "#save",
    coach: "left",
    allowed: ["#save"],
    phases: [
      {
        check: (doc) => !doc.querySelector("#save-overlay").hidden,
        action: "点击右下角「保存推演」，打开保存对话框。",
        target: "#save",
        hint: "点击这里",
        allowed: ["#save"]
      },
      {
        check: (doc) => doc.querySelector("#save-overlay").hidden,
        action: "现在点「取消」关闭对话框。",
        target: "#save-cancel",
        hint: "点这里",
        allowed: ["#save-cancel"]
      }
    ],
    done: () => false
  },
  {
    id: "workshop",
    chapter: 3,
    title: "认识单位工坊",
    body: "单位工坊是自定义装备的地方：左侧是内置单位模板（只读），右侧是参数编辑区。点「复制」把模板变成可编辑副本，修改名称、载荷与传感器参数后保存，新单位会带着「自定义」标记进入装备库。",
    action: "点击「单位工坊」，打开工坊。",
    target: "#mods-toggle",
    coach: "bottom",
    collapseByDefault: true,
    allowed: ["#mods-toggle"],
    phases: [
      {
        check: (doc) => !doc.querySelector("#mods-overlay").hidden,
        action: "点击右下角「单位工坊」，打开工坊。",
        target: "#mods-toggle",
        hint: "点击这里",
        allowed: ["#mods-toggle"]
      },
      {
        check: (doc) => doc.querySelector("#mods-overlay").hidden,
        action: "浏览左侧模板与右侧参数后，点击「关闭」。",
        target: "#mods-close",
        hint: "点这里",
        allowed: ["#mods-close"]
      }
    ],
    done: () => false
  }
];

// 当前步骤（或当前阶段）的教学元信息。
function currentMeta() {
  const step = currentStep();
  const phase = step.phases?.[phaseIndex] ?? null;
  return {
    step,
    phase,
    target: phase?.target ?? step.target,
    hint: phase?.hint ?? step.hint,
    spot: phase?.spot ?? step.spot,
    readOnly: step.readOnly ?? false,
    allowed: phase?.allowed ?? step.allowed ?? []
  };
}

function allowedTargets(doc) {
  return currentMeta().allowed.filter((selector) => doc.querySelector(selector));
}

// 每个步骤激活时，把沙盘整理到该步骤说明所假设的状态，避免残留状态卡住完成条件。
function prepareStage() {
  const doc = frame.contentDocument;
  if (!doc || !frameReady) return;
  const step = currentStep();
  if (step.id === "library-pick") {
    if (doc.querySelector("#equipment-overlay").hidden) doc.querySelector("#deploy-open")?.click();
  } else {
    OVERLAY_SELECTORS.forEach((selector) => {
      const overlay = doc.querySelector(selector);
      if (!overlay || overlay.hidden) return;
      const close = selector === "#equipment-overlay" ? "#equipment-close"
        : selector === "#mods-overlay" ? "#mods-close"
          : selector === "#save-overlay" ? "#save-cancel"
            : "#load-cancel";
      doc.querySelector(close)?.click();
    });
  }
  // 清理沙盘自己的提示对话框（临时创建的 notice-overlay）。
  doc.querySelectorAll(".about-overlay.notice-overlay").forEach((el) => el.remove());
  const panel = doc.querySelector("#right-panel");
  if (step.id === "select-unit") {
    panel?.classList.remove("retracted");
    doc.querySelector(".rp-collapse")?.setAttribute("aria-expanded", "true");
    step.baseSelection = selectedShipId(doc);
  } else if (panel && !panel.classList.contains("retracted")) {
    panel.classList.add("retracted");
    doc.querySelector(".rp-collapse")?.setAttribute("aria-expanded", "false");
  }
  if (step.id === "place-unit") {
    armPlacement(doc, "blue");
  } else if (!doc.querySelector("#placement-chip").hidden) {
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
}

function selectedShipId(doc) {
  return doc.querySelector("#unit-tab [data-select-ship].selected")?.dataset.selectShip ?? null;
}

function armPlacement(doc, side) {
  const chip = doc.querySelector("#placement-chip");
  if (chip && !chip.hidden && chip.classList.contains("red") === (side === "red")) return;
  doc.querySelector("#deploy-open")?.click();
  const card = doc.querySelector(`.equipment-card[data-equipment='DDG']`);
  if (!card) return;
  if (side === "red") {
    card.querySelector(".equipment-side-red")?.click();
  } else {
    card.querySelector(".equipment-side-blue")?.click();
  }
}

// 沙盘锁定：只允许当前步骤的可点击目标；键盘只放行输入框、Escape（部署/工坊上下文）与空格（推演开始后）。
function lockSandbox(doc) {
  if (doc.__guideLocked) return;
  doc.__guideLocked = true;

  doc.addEventListener("wheel", (event) => {
    const dialogOpen = OVERLAY_SELECTORS.some((selector) => {
      const overlay = doc.querySelector(selector);
      return overlay && !overlay.hidden;
    });
    if (!dialogOpen) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, { capture: true, passive: false });

  doc.addEventListener("keydown", (event) => {
    if (!event.isTrusted) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target?.isContentEditable) return;
    const meta = currentMeta();
    const mapContext = meta.allowed.includes("#map");
    const workshopOpen = !doc.querySelector("#mods-overlay")?.hidden;
    if (event.key === "Escape" && (mapContext || workshopOpen)) return;
    if (event.code === "Space" && doc.querySelector("#status")?.dataset.mode !== "部署就绪") return;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });

  const blockUnlessAllowed = (event) => {
    if (!event.isTrusted) return;
    if (event.type === "pointerdown" && event.button !== 0) {
      event.preventDefault();
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent("guide:denied"));
      return;
    }
    const meta = currentMeta();
    if (meta.allowed.some((selector) => event.target?.closest?.(selector))) return;
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent("guide:denied"));
  };
  doc.addEventListener("pointerdown", blockUnlessAllowed, { capture: true });
  doc.addEventListener("click", blockUnlessAllowed, { capture: true });
}

function unitsOf(doc, side) {
  const el = doc.querySelector(`.force-summary.${side} .summary-stat.units b`);
  const n = Number(el?.textContent);
  return Number.isFinite(n) ? n : 0;
}

function speedOf(doc) {
  const n = Number((doc.querySelector("#speed-value")?.textContent || "0").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// 当前会话内已完成的步骤（仅用于进度条与圆点显示，不持久化）。
const completed = new Set();

let stepIndex = 0;
let phaseIndex = 0;
let frameReady = false;
let busy = false;
let finished = false;
let stuckTimer = null;
let readyCheck = null;

const currentStep = () => STEPS[stepIndex];
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- 渲染 ----------

function setCoachStatus(state, text) {
  const el = byId("coach-status");
  if (!el) return;
  el.classList.toggle("done", state === "done");
  el.querySelector("span").textContent = text ?? (state === "done" ? "已完成" : "等待你的操作");
}

function coachSideStyle(side) {
  return {
    right: "right:26px;top:50%;transform:translateY(-50%);",
    left: "left:26px;top:50%;transform:translateY(-50%);",
    top: "left:50%;top:74px;transform:translateX(-50%);",
    bottom: "left:50%;bottom:58px;transform:translateX(-50%);"
  }[side] || "right:26px;top:50%;transform:translateY(-50%);";
}

function renderAction() {
  const step = currentStep();
  const phase = step.phases?.[phaseIndex];
  const action = phase?.action ?? step.action;
  byId("coach-action").textContent = action;
  byId("coach-pill-action").textContent = action;
}

function renderCoach() {
  const meta = currentMeta();
  const step = meta.step;
  const chapter = CHAPTERS[step.chapter];
  const phaseLabel = step.phases ? ` · 阶段 ${phaseIndex + 1}/${step.phases.length}` : "";
  byId("coach-kicker").textContent = `第 ${stepIndex + 1} 步 / 共 ${STEPS.length} 步 · ${chapter.title}${phaseLabel}`;
  byId("coach-title").textContent = step.title;
  byId("coach-body").textContent = step.body;
  renderAction();
  const keysEl = byId("coach-keys");
  keysEl.replaceChildren();
  if (step.keys && !step.phases) {
    step.keys.forEach((key) => {
      const kbd = document.createElement("kbd");
      kbd.textContent = key;
      keysEl.append(kbd);
    });
    keysEl.hidden = false;
  } else {
    keysEl.hidden = true;
  }
  byId("coach-prev").disabled = stepIndex === 0;
  byId("coach-next").textContent = stepIndex === STEPS.length - 1 ? "完成" : "下一步";
  if (step.readOnly) {
    setCoachStatus("waiting", "阅读后点击「下一步」");
  } else {
    setCoachStatus("waiting");
  }
  const coach = byId("coach");
  coach.style.cssText = `position:fixed;${coachSideStyle(step.coach)}`;
  byId("coach-card").style.maxHeight = ["top", "bottom"].includes(step.coach)
    ? "calc(100vh - 190px)"
    : "calc(100vh - 40px)";
  byId("coach-pill-step").textContent = `第 ${stepIndex + 1} 步 · ${step.title}`;
  renderDots();
  renderProgress();
}

function targetRect() {
  const meta = currentMeta();
  if (meta.spot) {
    const size = 80;
    const cx = meta.spot.fx != null ? innerWidth * meta.spot.fx : innerWidth / 2;
    const cy = meta.spot.fy != null ? innerHeight * meta.spot.fy : innerHeight / 2;
    return { left: cx - size / 2, top: cy - size / 2, width: size, height: size };
  }
  if (!meta.target) return null;
  const el = frame.contentDocument?.querySelector(meta.target);
  if (!el || !el.getClientRects().length) return null;
  return el.getBoundingClientRect();
}

function updateGuides() {
  const spot = byId("spotlight");
  const scrim = byId("scrim");
  const cursor = byId("cursor-hint");
  if (!frameReady || finished) {
    spot.hidden = true;
    scrim.hidden = true;
    cursor.hidden = true;
    return;
  }
  const meta = currentMeta();
  const rect = targetRect();
  if (!rect) {
    spot.hidden = true;
    scrim.hidden = true;
    cursor.hidden = true;
    return;
  }
  const pad = 7;
  spot.hidden = false;
  spot.style.left = `${rect.left - pad}px`;
  spot.style.top = `${rect.top - pad}px`;
  spot.style.width = `${rect.width + pad * 2}px`;
  spot.style.height = `${rect.height + pad * 2}px`;
  spot.classList.toggle("spot", Boolean(meta.spot));

  scrim.hidden = false;
  const pad2 = 16;
  scrim.style.left = `${rect.left - pad2}px`;
  scrim.style.top = `${rect.top - pad2}px`;
  scrim.style.width = `${rect.width + pad2 * 2}px`;
  scrim.style.height = `${rect.height + pad2 * 2}px`;

  cursor.hidden = meta.readOnly;
  if (!meta.readOnly) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    cursor.style.transform = `translate(${cx}px, ${cy}px)`;
    cursor.querySelector(".cursor-label").textContent = meta.hint ?? "点击这里";
  }
}

function showCompletion() {
  finished = true;
  byId("spotlight").hidden = true;
  byId("scrim").hidden = true;
  byId("cursor-hint").hidden = true;
  byId("coach").hidden = true;
  byId("completion").hidden = false;
  byId("top-progress-fill").style.transform = "scaleX(1)";
  const doc = frame.contentDocument;
  const close = doc?.querySelector("#mods-close");
  if (close && !doc.querySelector("#mods-overlay").hidden) close.click();
}

function renderDots() {
  const dots = byId("coach-dots");
  dots.replaceChildren();
  STEPS.forEach((step, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dot"
      + (completed.has(step.id) ? " done" : "")
      + (index === stepIndex ? " active" : "");
    button.setAttribute("aria-label", `${index + 1}. ${step.title}${completed.has(step.id) ? "，已完成" : ""}`);
    button.title = `${index + 1}. ${step.title}`;
    button.addEventListener("click", () => gotoStep(index));
    dots.append(button);
  });
}

function renderProgress() {
  byId("top-progress-fill").style.transform = `scaleX(${completed.size / STEPS.length})`;
  renderDots();
}

// ---------- 步骤机 ----------

function activateStep() {
  phaseIndex = 0;
  clearTimeout(stuckTimer);
  stuckTimer = null;
  byId("coach").classList.remove("stuck");
  byId("coach-card").hidden = false;
  byId("coach-collapse").hidden = false;
  byId("coach-pill").hidden = true;
  byId("coach-collapse").setAttribute("aria-expanded", "true");
  byId("spotlight").classList.remove("done");
  renderCoach();
  prepareStage();
  updateGuides();
  if (currentStep().collapseByDefault) {
    byId("coach-card").hidden = true;
    byId("coach-collapse").hidden = true;
    byId("coach-pill").hidden = false;
  }
  if (!finished) {
    stuckTimer = setTimeout(() => byId("coach").classList.add("stuck"), STUCK_MS);
  }
}

function gotoStep(index) {
  busy = false;
  finished = false;
  byId("completion").hidden = true;
  byId("coach").hidden = false;
  stepIndex = Math.max(0, Math.min(STEPS.length - 1, index));
  activateStep();
}

function stepIsDone(doc) {
  const step = currentStep();
  if (step.phases) {
    const phase = step.phases[phaseIndex];
    return phase ? phase.check(doc) : true;
  }
  return step.done(doc);
}

function completeStep() {
  if (busy || finished) return;
  busy = true;
  clearTimeout(stuckTimer);
  byId("coach").classList.remove("stuck");
  const step = currentStep();
  completed.add(step.id);
  renderProgress();
  setCoachStatus("done");
  byId("spotlight").classList.add("done");
  if (stepIndex === STEPS.length - 1) {
    showCompletion();
    return;
  }
  const completedAt = stepIndex;
  if (reducedMotion()) {
    busy = false;
    return;
  }
  setTimeout(() => {
    busy = false;
    if (stepIndex === completedAt) gotoStep(completedAt + 1);
  }, AUTO_ADVANCE_MS);
}

function poll() {
  if (!frameReady || busy || finished) return;
  const doc = frame.contentDocument;
  if (!doc) return;
  const step = currentStep();
  // 部署步骤自愈：部署条意外消失（如误按 Esc）时重新武装。
  if (step.id === "place-unit" || (step.id === "deploy-red" && phaseIndex >= 2)) {
    armPlacement(doc, step.id === "deploy-red" ? "red" : "blue");
  }
  updateGuides();
  if (step.phases && phaseIndex < step.phases.length) {
    if (step.phases[phaseIndex].check(doc)) {
      if (phaseIndex === step.phases.length - 1) {
        completeStep();
      } else {
        phaseIndex += 1;
        renderAction();
        updateGuides();
        setCoachStatus("done");
        const advancedAt = phaseIndex;
        if (!reducedMotion()) {
          setTimeout(() => {
            if (!finished && currentStep() === step && phaseIndex === advancedAt) setCoachStatus("waiting");
          }, 700);
        }
      }
    }
    return;
  }
  if (stepIsDone(doc)) completeStep();
}

// ---------- iframe 生命周期 ----------

function reloadFrame() {
  clearInterval(readyCheck);
  readyCheck = null;
  frameReady = false;
  busy = false;
  finished = false;
  phaseIndex = 0;
  byId("spotlight").hidden = true;
  byId("scrim").hidden = true;
  byId("cursor-hint").hidden = true;
  byId("completion").hidden = true;
  byId("stage-loading").hidden = false;
  byId("stage-fallback").hidden = true;
  frame.src = `/sandbox?t=${Date.now()}`;
  onFrameLoaded();
}

let deniedAt = 0;
let deniedTimer = null;
let deniedStatusTimer = null;
let quickPollTimer = null;

// 被拦截的点击：红色闪烁 + 状态提示，引导用户看向金色光标。
window.addEventListener("guide:denied", () => {
  if (Date.now() - (deniedAt || 0) < 800) return;
  deniedAt = Date.now();
  const spot = byId("spotlight");
  spot.classList.remove("denied");
  void spot.offsetWidth;
  spot.classList.add("denied");
  clearTimeout(deniedTimer);
  deniedTimer = setTimeout(() => spot.classList.remove("denied"), 520);
  const readOnly = currentMeta().readOnly;
  setCoachStatus("waiting", readOnly ? "本步骤只需阅读，完成后点击「下一步」" : "先点击金色光标所指的位置");
  clearTimeout(deniedStatusTimer);
  deniedStatusTimer = setTimeout(() => {
    if (!finished && !busy) {
      if (currentMeta().readOnly) setCoachStatus("waiting", "阅读后点击「下一步」");
      else setCoachStatus("waiting");
    }
  }, 1400);
});

// 沙盘内每次点击/输入后立即复查一次完成条件，缩短步骤切换的等待。
function wireQuickPoll(doc) {
  const quick = () => {
    clearTimeout(quickPollTimer);
    quickPollTimer = setTimeout(poll, 60);
  };
  doc.addEventListener("click", quick, { capture: true });
  doc.addEventListener("input", quick, { capture: true });
}

function onFrameLoaded() {
  clearInterval(readyCheck);
  byId("stage-loading").hidden = false;
  byId("stage-fallback").hidden = true;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  readyCheck = setInterval(() => {
    const doc = frame.contentDocument;
    if (doc && doc.querySelector("#app") && doc.querySelector("#map")?.width) {
      clearInterval(readyCheck);
      readyCheck = null;
      frameReady = true;
      byId("stage-loading").hidden = true;
      lockSandbox(doc);
      wireQuickPoll(doc);
      prepareStage();
      updateGuides();
      return;
    }
    if (Date.now() > deadline) {
      clearInterval(readyCheck);
      readyCheck = null;
      byId("stage-loading").hidden = true;
      byId("stage-fallback").hidden = false;
    }
  }, 120);
}

// ---------- 欢迎 / 完成 / 速查 ----------

function openReference() {
  byId("reference").hidden = false;
}

function closeReference() {
  byId("reference").hidden = true;
}

function resetAll() {
  completed.clear();
  renderProgress();
  gotoStep(0);
  reloadFrame();
}

function startTutorial() {
  byId("quick-start").hidden = true;
  gotoStep(0);
}

// ---------- 事件绑定 ----------

byId("start-tutorial").addEventListener("click", startTutorial);
byId("restart-tutorial").addEventListener("click", resetAll);
byId("stage-retry").addEventListener("click", reloadFrame);
byId("coach-prev").addEventListener("click", () => gotoStep(stepIndex - 1));
byId("coach-reset").addEventListener("click", reloadFrame);
byId("coach-next").addEventListener("click", () => {
  if (finished) {
    gotoStep(STEPS.length - 1);
  } else if (stepIndex === STEPS.length - 1 || currentStep().readOnly) {
    completeStep();
  } else {
    gotoStep(stepIndex + 1);
  }
});
byId("coach-collapse").addEventListener("click", () => {
  byId("coach-card").hidden = true;
  byId("coach-collapse").hidden = true;
  byId("coach-pill").hidden = false;
});
byId("coach-pill").addEventListener("click", () => {
  byId("coach-card").hidden = false;
  byId("coach-collapse").hidden = false;
  byId("coach-pill").hidden = true;
});
byId("coach-ref").addEventListener("click", openReference);
byId("welcome-ref").addEventListener("click", openReference);
byId("reference-close").addEventListener("click", closeReference);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!byId("reference").hidden) closeReference();
    return;
  }
  if (!byId("quick-start").hidden || !byId("reference").hidden || byId("completion").hidden === false) return;
  if (event.key === "ArrowLeft") {
    gotoStep(stepIndex - 1);
  } else if (event.key === "ArrowRight" || (event.key === "." && !event.ctrlKey && !event.metaKey && !event.altKey)) {
    event.preventDefault();
    gotoStep(stepIndex + 1);
  }
});

window.addEventListener("resize", updateGuides);
frame.addEventListener("load", onFrameLoaded);

if (frame.contentDocument?.readyState === "complete") onFrameLoaded();

window.addEventListener("beforeunload", () => {
  clearInterval(readyCheck);
  clearTimeout(stuckTimer);
});

renderProgress();
setInterval(poll, POLL_MS);
