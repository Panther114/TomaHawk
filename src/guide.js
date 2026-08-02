import { GUIDE_LESSONS } from "./ui/tutorial.js";

const PROGRESS_KEY = "tomahawk.guideProgress.v1";
const DEMO_LESSON_IDS = ["side", "summary", "layers", "playback", "context"];
const demoLessons = DEMO_LESSON_IDS.map((id) => GUIDE_LESSONS.find((lesson) => lesson.id === id));

const SHOT_SETS = {
  deployment: {
    library: {
      src: "src/assets/guide/deployment-library.png",
      alt: "当前 Tomahawk 装备部署库",
      caption: "选阵营、找装备、回到地图部署。",
      notes: [
        { title: "阵营", text: "决定新单位属于蓝方或红方。", x: 3, y: 11.4, w: 12.2, h: 5.3 },
        { title: "筛选与搜索", text: "按作战域过滤，或直接搜索型号。", x: 15.9, y: 11.4, w: 81, h: 5.3 },
        { title: "装备卡", text: "点击装备后返回地图部署。", x: 2.5, y: 19, w: 96, h: 57 }
      ]
    },
    valid: {
      src: "src/assets/guide/placement-valid.png",
      alt: "舰艇在开放水域的合法部署预览",
      caption: "阵营色预览表示可以放置。",
      notes: [
        { title: "当前装备", text: "顶部显示阵营、型号和退出方法。", x: 43, y: 7.3, w: 14, h: 5.2 },
        { title: "合法预览", text: "蓝色符号表示位置可用。", x: 61.5, y: 50, w: 3.2, h: 4.4 }
      ]
    },
    invalid: {
      src: "src/assets/guide/placement-invalid.png",
      alt: "舰艇在陆地上的非法部署预览",
      caption: "红色预览表示位置无效。",
      notes: [
        { title: "无效位置", text: "红色符号不会放置单位。", x: 6.5, y: 50, w: 3.2, h: 4.4 },
        { title: "原因", text: "顶部会说明地形或间距问题。", x: 43, y: 7.3, w: 14, h: 6.2 }
      ]
    }
  },
  operations: {
    overview: {
      src: "src/assets/guide/sandbox-overview.png",
      alt: "运行中的 Tomahawk 控制台总览",
      caption: "先看战况，再看地图与单位详情。",
      notes: [
        { title: "主要工具", text: "部署阶段使用部署、选择与测距。", x: .7, y: .8, w: 24.5, h: 6 },
        { title: "双方战况", text: "存活、总生命、在空武器和攻势在这里汇总。", x: 26, y: .8, w: 49, h: 6 },
        { title: "兵力详情", text: "选中地图单位后，从右侧查看状态和载弹。", x: 92.5, y: 20, w: 7, h: 58 },
        { title: "图层与时间", text: "图层在左下，播放与速度在底部。", x: .7, y: 89, w: 65.3, h: 9 }
      ]
    },
    details: {
      src: "src/assets/guide/unit-details.png",
      alt: "选中单位后的兵力详情面板",
      caption: "选择单位后，从右侧确认状态和载弹。",
      notes: [
        { title: "地图选择", text: "被选中的单位会在地图上高亮。", x: 47, y: 43, w: 10, h: 16 },
        { title: "单位状态", text: "查看生命、任务和系统状态。", x: 80.8, y: 6, w: 18.8, h: 29.5 },
        { title: "兵力列表", text: "快速切换到其他单位。", x: 80.8, y: 35.5, w: 18.8, h: 55 }
      ]
    }
  },
  tools: {
    menu: {
      src: "src/assets/guide/system-tools.png",
      alt: "当前 Tomahawk 系统工具菜单",
      caption: "右上角集中放置低频操作。",
      notes: [
        { title: "保存与载入", text: "保存当前推演，或恢复已有进度。", x: 84.5, y: 10.4, w: 14.9, h: 8.3 },
        { title: "战报与工坊", text: "导出 AAR，或编辑自定义单位。", x: 84.5, y: 18.8, w: 14.9, h: 8.5 },
        { title: "重置与首页", text: "重置前先保存。", x: 84.5, y: 27.3, w: 14.9, h: 9.3 }
      ]
    }
  },
  workshop: {
    builtin: {
      src: "src/assets/guide/workshop-builtin.png",
      alt: "单位工坊内置单位只读状态",
      caption: "选择模板，复制后再编辑。",
      notes: [
        { title: "模板列表", text: "从左侧选择接近目标的内置单位。", x: 15.8, y: 15.8, w: 18, h: 77.5 },
        { title: "复制", text: "内置单位只读，先点击复制。", x: 35.6, y: 15.8, w: 8.2, h: 4.3 },
        { title: "参数", text: "复制后修改标识、机动与传感器。", x: 35.6, y: 31.1, w: 48.4, h: 62.2 }
      ]
    },
    custom: {
      src: "src/assets/guide/workshop-custom.png",
      alt: "单位工坊复制后的可编辑自定义单位",
      caption: "修改参数后保存，自定义单位会进入装备库。",
      notes: [
        { title: "保存与导出", text: "保存到浏览器，或导出 JSON。", x: 35.6, y: 15.8, w: 13.8, h: 4.3 },
        { title: "标识", text: "修改名称、代号和单位类型。", x: 35.6, y: 31.5, w: 48.4, h: 18.5 },
        { title: "性能参数", text: "调整机动、传感器等数值。", x: 35.6, y: 51.5, w: 48.4, h: 41.5 }
      ]
    }
  }
};

const byId = (id) => document.getElementById(id);
const demoConsole = byId("demo-console");
const demoMap = byId("demo-map");
const progressValue = byId("rail-progress-value");
const progressFill = byId("rail-progress-fill");
const resumeNote = byId("resume-note");
let activeHoverTarget = null;
let demoTimer = null;
let mapMessageTimer = null;
let demoSeconds = 0;
let demoSide = "blue";
let demoHull = "DDG";

function readProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
    if (saved.version !== 1 || !Array.isArray(saved.completed)) return new Set();
    return new Set(saved.completed.filter((id) => DEMO_LESSON_IDS.includes(id)));
  } catch {
    return new Set();
  }
}

const completedLessons = readProgress();

function writeProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ version: 1, completed: [...completedLessons] }));
  } catch {
    // The guide remains fully usable when storage is unavailable.
  }
}

function renderProgress() {
  const count = completedLessons.size;
  progressValue.textContent = String(count);
  progressFill.style.transform = `scaleX(${count / DEMO_LESSON_IDS.length})`;
  resumeNote.hidden = count === 0;
}

function markComplete(id) {
  if (!DEMO_LESSON_IDS.includes(id) || completedLessons.has(id)) return;
  completedLessons.add(id);
  writeProgress();
  renderProgress();
}

function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = hidden;
}

function setExpanded(button, expanded) {
  button?.setAttribute("aria-expanded", String(expanded));
}

function showMapMessage(text, error = false) {
  const message = byId("demo-map-message");
  if (!message) return;
  clearTimeout(mapMessageTimer);
  message.textContent = text;
  message.classList.toggle("error", error);
  message.hidden = false;
  mapMessageTimer = setTimeout(() => {
    message.hidden = true;
  }, 2200);
}

function demoTipContent(target) {
  const direct = target.dataset.demoTip;
  if (direct) {
    const [title, body] = direct.split("|");
    return { title, body };
  }
  const lesson = demoLessons.find((item) => item.id === target.dataset.guideLesson);
  return lesson
    ? { title: lesson.guide.label, body: lesson.guide.action }
    : null;
}

function positionDemoTip(target) {
  const popover = byId("demo-hover-popover");
  if (!demoConsole || !target || !popover || popover.hidden) return;
  const outer = demoConsole.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const popWidth = Math.min(300, outer.width - 24);
  const popHeight = popover.offsetHeight || 104;
  let left = rect.left - outer.left;
  let top = rect.bottom - outer.top + 10;
  if (left + popWidth > outer.width - 14) left = outer.width - popWidth - 14;
  if (left < 14) left = 14;
  if (top + popHeight > outer.height - 14) top = Math.max(14, rect.top - outer.top - popHeight - 10);
  popover.style.width = `${popWidth}px`;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function showDemoTip(target) {
  const content = demoTipContent(target);
  const popover = byId("demo-hover-popover");
  if (!content || !popover) return;
  activeHoverTarget?.classList.remove("hover-focus");
  activeHoverTarget = target;
  target.classList.add("hover-focus");
  popover.querySelector("b").textContent = content.title;
  popover.querySelector("p").textContent = content.body;
  popover.hidden = false;
  requestAnimationFrame(() => positionDemoTip(target));
}

function hideDemoTip(target) {
  if (activeHoverTarget !== target) return;
  target.classList.remove("hover-focus");
  activeHoverTarget = null;
  setHidden(byId("demo-hover-popover"), true);
}

function wireDemoTip(target) {
  target.addEventListener("pointerenter", () => showDemoTip(target));
  target.addEventListener("pointerleave", () => hideDemoTip(target));
  target.addEventListener("focusin", () => showDemoTip(target));
  target.addEventListener("focusout", (event) => {
    if (!target.contains(event.relatedTarget)) hideDemoTip(target);
  });
}

function formatDemoTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function renderDemoTime() {
  byId("demo-time").textContent = formatDemoTime(demoSeconds);
}

function setDemoPlaying(playing) {
  const play = byId("demo-play");
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
  play.classList.toggle("playing", playing);
  play.setAttribute("aria-label", playing ? "暂停演示" : "播放演示");
  play.querySelector("use")?.setAttribute("href", `src/assets/ui-icons.svg#${playing ? "pause" : "play"}`);
  if (playing) {
    markComplete("playback");
    demoTimer = setInterval(() => {
      demoSeconds += Number(byId("demo-speed").value) * .25;
      renderDemoTime();
    }, 250);
  }
}

function resetDemo() {
  setDemoPlaying(false);
  demoSeconds = 0;
  demoSide = "blue";
  demoHull = "DDG";
  renderDemoTime();
  byId("demo-speed").value = "8";
  byId("demo-speed-value").textContent = "8×";
  demoMap.className = "demo-map grid-on tracks-on";
  demoMap.dataset.mode = "deploy";
  document.querySelectorAll("[data-demo-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.demoMode === "deploy");
  });
  document.querySelectorAll("[data-demo-side]").forEach((button) => {
    button.classList.toggle("active", button.dataset.demoSide === "blue");
  });
  document.querySelectorAll("[data-demo-hull]").forEach((button) => {
    button.classList.toggle("active", button.dataset.demoHull === "DDG");
  });
  document.querySelectorAll("[data-demo-layer]").forEach((input) => {
    input.checked = input.dataset.demoLayer === "grid" || input.dataset.demoLayer === "tracks";
  });
  document.querySelectorAll(".demo-unit[data-generated='true']").forEach((unit) => unit.remove());
  setHidden(byId("demo-deploy-palette"), true);
  setHidden(byId("demo-layer-menu"), true);
  setHidden(byId("demo-tools-menu"), true);
  setExpanded(byId("demo-layers-toggle"), false);
  setExpanded(byId("demo-tools-toggle"), false);
  byId("demo-force")?.classList.remove("open");
  setExpanded(byId("demo-force-toggle"), false);
  if (activeHoverTarget) hideDemoTip(activeHoverTarget);
  clearTimeout(mapMessageTimer);
  setHidden(byId("demo-map-message"), true);
}

function setSelectedUnit(unit) {
  document.querySelectorAll(".demo-unit").forEach((item) => item.classList.toggle("selected", item === unit));
  byId("demo-force-name").textContent = unit.dataset.demoUnit || unit.getAttribute("aria-label") || "已选单位";
  byId("demo-force")?.classList.add("open");
  setExpanded(byId("demo-force-toggle"), true);
  markComplete("context");
}

function deployDemoUnit(event) {
  if (demoMap.dataset.mode !== "deploy" || event.target.closest(".demo-unit, .demo-deploy-palette, .demo-map-message")) return;
  const rect = demoMap.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  const invalid = x < 18 || (x > 76 && y < 27);
  if (invalid) {
    showMapMessage(demoHull === "DDG" ? "位置非法，舰艇需要开放水域。" : "位置非法，请移动到可部署区域。", true);
    return;
  }
  const unit = document.createElement("button");
  unit.type = "button";
  unit.className = `demo-unit ${demoSide}`;
  unit.dataset.generated = "true";
  unit.dataset.demoUnit = `${demoSide === "blue" ? "蓝方" : "红方"}${demoHull === "DDG" ? "驱逐舰 DDG" : " F-35C 中队"}`;
  unit.dataset.demoTip = "地图单位|点击单位符号查看状态、任务与载弹。";
  unit.setAttribute("aria-label", unit.dataset.demoUnit);
  unit.style.setProperty("--x", `${x}%`);
  unit.style.setProperty("--y", `${y}%`);
  unit.innerHTML = demoHull === "DDG"
    ? '<svg class="ui-icon" aria-hidden="true"><use href="src/assets/ui-icons.svg#force"></use></svg>'
    : "△";
  if (demoHull !== "DDG") unit.classList.add("air");
  demoMap.append(unit);
  wireDemoTip(unit);
  setSelectedUnit(unit);
  showMapMessage(`${unit.dataset.demoUnit}已部署。`);
  markComplete("side");
}

function togglePopover(button, panel) {
  const expanded = button.getAttribute("aria-expanded") !== "true";
  setExpanded(button, expanded);
  setHidden(panel, !expanded);
}

document.querySelectorAll("[data-scroll-to-demo]").forEach((button) => {
  button.addEventListener("click", () => byId("console")?.scrollIntoView({ behavior: "smooth", block: "start" }));
});

document.querySelectorAll("[data-guide-lesson], [data-demo-tip]").forEach(wireDemoTip);

document.querySelectorAll("[data-demo-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-demo-mode]").forEach((item) => item.classList.toggle("active", item === button));
    demoMap.dataset.mode = button.dataset.demoMode;
    setHidden(byId("demo-deploy-palette"), button.dataset.demoMode !== "deploy");
    showMapMessage(button.dataset.demoMode === "ruler"
      ? "测距模式：在地图上选择起点和终点。"
      : button.dataset.demoMode === "select"
        ? "选择模式：点击地图单位查看详情。"
        : "选择阵营与装备，然后在水域单击部署。");
  });
});

document.querySelectorAll("[data-demo-side]").forEach((button) => {
  button.addEventListener("click", () => {
    demoSide = button.dataset.demoSide;
    document.querySelectorAll("[data-demo-side]").forEach((item) => item.classList.toggle("active", item === button));
    markComplete("side");
  });
});

document.querySelectorAll("[data-demo-hull]").forEach((button) => {
  button.addEventListener("click", () => {
    demoHull = button.dataset.demoHull;
    document.querySelectorAll("[data-demo-hull]").forEach((item) => item.classList.toggle("active", item === button));
  });
});

demoMap?.addEventListener("click", (event) => {
  const unit = event.target.closest(".demo-unit");
  if (unit) {
    setSelectedUnit(unit);
    return;
  }
  deployDemoUnit(event);
});

byId("demo-layers-toggle")?.addEventListener("click", () => {
  hideDemoTip(byId("demo-layers"));
  togglePopover(byId("demo-layers-toggle"), byId("demo-layer-menu"));
});

document.querySelectorAll("[data-demo-layer]").forEach((input) => {
  input.addEventListener("change", () => {
    const className = `${input.dataset.demoLayer}-on`;
    demoMap.classList.toggle(className, input.checked);
    markComplete("layers");
  });
});

byId("demo-tools-toggle")?.addEventListener("click", () => {
  hideDemoTip(byId("demo-tools"));
  togglePopover(byId("demo-tools-toggle"), byId("demo-tools-menu"));
});

byId("demo-force-toggle")?.addEventListener("click", () => {
  hideDemoTip(byId("demo-force"));
  const force = byId("demo-force");
  const open = !force.classList.contains("open");
  force.classList.toggle("open", open);
  setExpanded(byId("demo-force-toggle"), open);
  if (open) markComplete("context");
});

byId("demo-play")?.addEventListener("click", () => setDemoPlaying(!byId("demo-play").classList.contains("playing")));
byId("demo-step")?.addEventListener("click", () => {
  setDemoPlaying(false);
  demoSeconds += 15;
  renderDemoTime();
  markComplete("playback");
});
byId("demo-speed")?.addEventListener("input", (event) => {
  byId("demo-speed-value").textContent = `${event.currentTarget.value}×`;
  markComplete("playback");
});

byId("clear-guide-progress")?.addEventListener("click", () => {
  completedLessons.clear();
  writeProgress();
  renderProgress();
  resetDemo();
});

const menuToggle = byId("guide-menu-toggle");
const guideNav = byId("guide-nav");
menuToggle?.addEventListener("click", () => {
  const open = !guideNav.classList.contains("open");
  guideNav.classList.toggle("open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
});
guideNav?.addEventListener("click", () => {
  guideNav.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
});

function initShotViewer(viewer) {
  const set = SHOT_SETS[viewer.dataset.shotSet];
  if (!set) return;
  const image = viewer.querySelector(".shot-image");
  const media = viewer.querySelector(".shot-media");
  const canvas = viewer.querySelector(".shot-canvas");
  const layer = viewer.querySelector(".shot-rect-layer");
  const list = viewer.querySelector(".shot-notes ol");
  const caption = viewer.querySelector("figcaption");
  const tabs = [...viewer.querySelectorAll("[data-shot-state]")];
  let currentState = tabs[0]?.dataset.shotState || Object.keys(set)[0];

  function selectNote(index) {
    const notes = [...list.querySelectorAll(".shot-note-button")];
    const rects = [...layer.querySelectorAll(".shot-rect")];
    notes.forEach((button, idx) => button.setAttribute("aria-pressed", String(idx === index)));
    rects.forEach((rect, idx) => rect.classList.toggle("active", idx === index));
    const note = set[currentState].notes[index];
    if (!note) return;
    canvas.style.setProperty("--focus-x", `${note.x + note.w / 2}%`);
    canvas.style.setProperty("--focus-y", `${note.y + note.h / 2}%`);
  }

  function renderState(state) {
    currentState = state;
    const shot = set[state];
    if (!shot) return;
    image.src = shot.src;
    image.alt = shot.alt;
    caption.textContent = shot.caption;
    layer.replaceChildren();
    list.replaceChildren();
    shot.notes.forEach((note, index) => {
      const rect = document.createElement("span");
      rect.className = "shot-rect";
      rect.dataset.number = String(index + 1);
      rect.style.setProperty("--x", `${note.x}%`);
      rect.style.setProperty("--y", `${note.y}%`);
      rect.style.setProperty("--w", `${note.w}%`);
      rect.style.setProperty("--h", `${note.h}%`);
      layer.append(rect);

      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "shot-note-button";
      button.innerHTML = `<span>${index + 1}</span><span><b>${note.title}</b><small>${note.text}</small></span>`;
      button.addEventListener("click", () => selectNote(index));
      item.append(button);
      list.append(item);
    });
    tabs.forEach((tab) => {
      const selected = tab.dataset.shotState === state;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    media.classList.remove("full");
    viewer.querySelector(".shot-full-toggle")?.setAttribute("aria-pressed", "false");
    viewer.querySelector(".shot-full-toggle").textContent = "查看全图";
    selectNote(0);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => renderState(tab.dataset.shotState));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = (index + delta + tabs.length) % tabs.length;
      renderState(tabs[next].dataset.shotState);
      tabs[next].focus();
    });
  });

  viewer.querySelector(".shot-full-toggle")?.addEventListener("click", (event) => {
    const full = !media.classList.contains("full");
    media.classList.toggle("full", full);
    event.currentTarget.setAttribute("aria-pressed", String(full));
    event.currentTarget.textContent = full ? "聚焦标注" : "查看全图";
  });

  image.addEventListener("error", () => {
    media.classList.add("asset-error");
    media.setAttribute("data-error", "截图暂时无法载入，请运行 npm run screenshot:guide 重新生成。");
  });
  image.addEventListener("load", () => {
    media.classList.remove("asset-error");
    media.removeAttribute("data-error");
  });
  renderState(currentState);
}

document.querySelectorAll(".shot-viewer").forEach(initShotViewer);

const sectionLinks = [...document.querySelectorAll("[data-section-link]")];
const topLinks = [...document.querySelectorAll(".guide-nav a[href^='#']")];
const sections = [...document.querySelectorAll("[data-guide-section]")];
const sectionObserver = new IntersectionObserver((entries) => {
  const visible = entries
    .filter((entry) => entry.isIntersecting)
    .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  const id = visible.target.id;
  [...sectionLinks, ...topLinks].forEach((link) => {
    const active = link.getAttribute("href") === `#${id}`;
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}, { rootMargin: "-18% 0px -62% 0px", threshold: [0, .1, .35] });
sections.forEach((section) => sectionObserver.observe(section));

window.addEventListener("resize", () => {
  if (activeHoverTarget) positionDemoTip(activeHoverTarget);
});
window.addEventListener("beforeunload", () => {
  if (demoTimer) clearInterval(demoTimer);
});

renderProgress();
resetDemo();
