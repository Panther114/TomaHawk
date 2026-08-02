#!/usr/bin/env node
/**
 * Generate the current-UI image set used by /guide.
 *
 * The script drives the normal sandbox controls at a fixed 1600x900 viewport;
 * it does not seed simulator state through private APIs. Rectangle annotations
 * remain responsive HTML in guide.html rather than being burned into the PNGs.
 *
 * Usage:
 *   npm run screenshot:guide
 *   node scripts/screenshot-guide.mjs --url http://127.0.0.1:4202/sandbox.html
 *   node scripts/screenshot-guide.mjs --out-dir artifacts/guide
 */
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const args = process.argv.slice(2);

function flag(name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

const targetUrl = flag("--url", "http://127.0.0.1:4202/sandbox.html");
const outDir = resolve(root, flag("--out-dir", "src/assets/guide"));
const reportPath = resolve(root, flag("--report", "artifacts/guide-screenshots.json"));
const viewport = {
  width: Number(flag("--width", "1600")),
  height: Number(flag("--height", "900"))
};

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok || response.status === 304;
  } catch {
    return false;
  }
}

async function ensureServer(url) {
  if (await isReachable(url)) return { child: null, url };
  const parsed = new URL(url);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: parsed.port || "4202"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isReachable(url)) return { child, url };
    if (child.exitCode != null) {
      throw new Error(`server exited early (${child.exitCode}): ${stderr || "no stderr"}`);
    }
    await sleep(150);
  }
  child.kill("SIGTERM");
  throw new Error(`server did not become ready at ${url}`);
}

async function waitForEquipment(page) {
  await page.waitForSelector("#equipment-overlay:not([hidden]) .equipment-card", { timeout: 15000 });
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll("#equipment-grid .equipment-card")];
    const images = [...document.querySelectorAll("#equipment-grid .equipment-art img")];
    return cards.length >= 8 && images.every((image) => image.complete && image.naturalWidth > 0);
  }, { timeout: 20000 });
  await sleep(180);
}

async function openEquipment(page, side = "blue") {
  await page.click("#deploy-open");
  await waitForEquipment(page);
  await page.click(`[data-deploy-side="${side}"]`);
}

async function beginPlacement(page, side, hull) {
  await openEquipment(page, side);
  await page.click(`[data-equipment="${hull}"]`);
  await page.waitForSelector("#placement-chip:not([hidden])");
}

async function capturePage(page, name, captures) {
  const path = resolve(outDir, name);
  await page.screenshot({ path, type: "png", fullPage: false });
  const info = await stat(path);
  const decoded = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    try {
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    } catch {
      return { width: 0, height: 0 };
    }
  }, `/src/assets/guide/${name}?capture=${Date.now()}`);
  captures.push({ name, path, bytes: info.size, ...decoded });
}

async function capture() {
  await mkdir(outDir, { recursive: true });
  await mkdir(resolve(reportPath, ".."), { recursive: true });
  const { child, url } = await ensureServer(targetUrl);
  const browser = await chromium.launch({ headless: true });
  const captures = [];
  const consoleErrors = [];
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce"
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForSelector("#map");
    await page.click("#tutorial-later").catch(() => {});
    await page.click("#empty-close").catch(() => {});

    await openEquipment(page, "blue");
    await capturePage(page, "deployment-library.png", captures);
    await page.click('[data-equipment="DDG"]');

    // The right half of the current East China Sea map is open water.
    await page.mouse.move(1010, 470);
    await sleep(160);
    await capturePage(page, "placement-valid.png", captures);

    // The left edge is mainland; naval placement is rejected there.
    await page.mouse.move(125, 465);
    await sleep(160);
    await capturePage(page, "placement-invalid.png", captures);

    await page.mouse.click(980, 500);
    await page.keyboard.press("Escape");
    await beginPlacement(page, "red", "DDG");
    await page.mouse.click(1220, 540);
    await page.keyboard.press("Escape");

    // Place aircraft for a richer running-state overview.
    await beginPlacement(page, "blue", "F35C");
    await page.mouse.click(880, 430);
    await page.keyboard.press("Escape");
    await beginPlacement(page, "red", "F22");
    await page.mouse.click(1320, 430);
    await page.keyboard.press("Escape");

    await page.click('[data-tool="select"]');
    await page.mouse.click(980, 500);
    await page.waitForSelector("#right-panel:not(.retracted)");
    await sleep(140);
    await capturePage(page, "unit-details.png", captures);

    await page.click("#layers-toggle");
    await page.check("#filter-radar");
    await page.click("#layers-toggle");
    await page.click("#play");
    await sleep(650);
    await page.click("#play");
    await capturePage(page, "sandbox-overview.png", captures);

    await page.click("#tools-toggle");
    await page.waitForSelector("#tools-menu:not([hidden])");
    await capturePage(page, "system-tools.png", captures);

    await page.click("#mods-toggle");
    await page.waitForSelector("#mods-overlay:not([hidden]) .mods-item", { timeout: 15000 });
    const ddg = page.locator('.mods-item[data-key="naval:DDG"]');
    if (!await ddg.count()) {
      const fallback = page.locator(".mods-item", { hasText: "DDG" }).first();
      await fallback.click();
    } else {
      await ddg.click();
    }
    await page.waitForSelector('#mods-detail [data-action="clone"]');
    await sleep(180);
    await capturePage(page, "workshop-builtin.png", captures);

    await page.click('#mods-detail [data-action="clone"]');
    await page.waitForSelector('#mods-detail [data-action="save"]');
    await sleep(180);
    await capturePage(page, "workshop-custom.png", captures);

    const problems = [];
    for (const image of captures) {
      if (image.bytes < 30000) problems.push(`${image.name} is unexpectedly small (${image.bytes} bytes)`);
      if (image.width !== viewport.width || image.height !== viewport.height) {
        problems.push(`${image.name} decoded as ${image.width}x${image.height}`);
      }
    }
    if (captures.length !== 8) problems.push(`expected 8 screenshots, captured ${captures.length}`);
    if (consoleErrors.length) problems.push(`${consoleErrors.length} browser console error(s)`);

    const report = {
      ok: problems.length === 0,
      generatedAt: new Date().toISOString(),
      url,
      viewport,
      captures,
      consoleErrors,
      problems
    };
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (problems.length) process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
    if (child) {
      child.kill("SIGTERM");
      await sleep(100);
      if (child.exitCode == null) child.kill("SIGKILL");
    }
  }
}

capture().catch((error) => {
  console.error(error);
  process.exit(1);
});
