// 生成 README 使用的宣传截图（docs/screenshots/*.png）。
// 用法：npm run screenshot:docs
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = new URL("../docs/screenshots/", import.meta.url).pathname.replace(/^\/([A-Za-z]):/, "$1:");

const server = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 900));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await mkdir(OUT, { recursive: true });

async function waitSandboxReady() {
  await page.waitForFunction(() => {
    const canvas = document.querySelector("#map");
    return canvas && canvas.width > 0;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(700);
}

async function placeAt(x, y) {
  await page.evaluate(([px, py]) => {
    const canvas = document.querySelector("#map");
    for (const type of ["pointerdown", "pointerup"]) {
      canvas.dispatchEvent(new PointerEvent(type, {
        clientX: px, clientY: py, button: 0, bubbles: true, pointerId: 1, pointerType: "mouse"
      }));
    }
  }, [x, y]);
}

async function unitsOf(side) {
  return page.evaluate((s) => Number(document.querySelector(`.force-summary.${s} .summary-stat.units b`)?.textContent || 0), side);
}

try {
  // 1) 首页（landing page）
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/landing.png` });
  console.log("landing.png");

  // 2) 操作手册：欢迎页
  await page.goto(`${BASE}/guide`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#stage-loading")?.hidden === true, null, { timeout: 20000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/guide-welcome.png` });
  console.log("guide-welcome.png");

  // 3) 操作手册：教学进行中（聚光灯 + 光标提示 + 教学卡）
  await page.locator("#start-tutorial").click();
  await page.waitForFunction(() => document.querySelector("#coach-title")?.textContent === "打开装备库", null, { timeout: 8000 });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/guide-tutorial.png` });
  console.log("guide-tutorial.png");

  // 3) 沙盘：装备库
  await page.goto(`${BASE}/sandbox`, { waitUntil: "networkidle" });
  await waitSandboxReady();
  await page.evaluate(() => document.querySelector("#deploy-open").click());
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/sandbox-deploy.png` });
  console.log("sandbox-deploy.png");
  await page.evaluate(() => document.querySelector("#equipment-close").click());
  await page.waitForTimeout(200);

  // 3) 沙盘：正在交战的推演
  await page.evaluate(() => document.querySelector("#deploy-open").click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector(".equipment-card").click());
  await page.waitForTimeout(200);
  const water = [[640, 400], [640, 320], [520, 420], [700, 500], [820, 340], [520, 280], [820, 460], [560, 560]];
  for (const [x, y] of water) {
    if ((await unitsOf("blue")) >= 3) break;
    await placeAt(x, y);
  }
  await page.evaluate(() => document.querySelector("#deploy-open").click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector(".equipment-card .equipment-side-red").click());
  await page.waitForTimeout(200);
  for (const [x, y] of water) {
    if ((await unitsOf("red")) >= 2) break;
    await placeAt(x, y);
  }
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  await page.evaluate(() => {
    document.querySelector("#speed").value = "100";
    document.querySelector("#speed").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#play").click();
  });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/sandbox-battle.png` });
  console.log("sandbox-battle.png");
} finally {
  await browser.close();
  server.kill();
}
