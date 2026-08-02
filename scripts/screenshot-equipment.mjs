#!/usr/bin/env node
/**
 * Capture the equipment deploy library for visual QA.
 *
 * Usage:
 *   node scripts/screenshot-equipment.mjs
 *   node scripts/screenshot-equipment.mjs --url http://127.0.0.1:4202/sandbox.html
 *   node scripts/screenshot-equipment.mjs --out artifacts/equipment-library.png
 *
 * Starts the local static server when none is reachable, opens the sandbox,
 * opens the equipment overlay, waits for unit art to load, then writes a PNG.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";

const root = resolve(process.cwd());
const args = process.argv.slice(2);

function flag(name, fallback = null) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] ?? fallback;
}

const preferredUrl = flag("--url", process.env.DAWNFALL_URL || "http://127.0.0.1:4202/sandbox.html");
const outPath = resolve(root, flag("--out", "artifacts/equipment-library.png"));
const viewport = {
  width: Number(flag("--width", "1600")),
  height: Number(flag("--height", "900"))
};

async function isReachable(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok || res.status === 304;
  } catch {
    return false;
  }
}

async function ensureServer(url) {
  if (await isReachable(url)) {
    return { child: null, url };
  }
  const base = new URL(url);
  const port = base.port || "4202";
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: port, HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  for (let i = 0; i < 40; i++) {
    if (await isReachable(url)) return { child, url };
    if (child.exitCode != null) {
      throw new Error(`server exited early (${child.exitCode}): ${stderr || "no stderr"}`);
    }
    await sleep(150);
  }
  child.kill("SIGTERM");
  throw new Error(`server did not become ready at ${url}`);
}

async function waitForArt(page) {
  await page.waitForSelector("#equipment-overlay:not([hidden]) .equipment-card", {
    timeout: 15000
  });
  // Wait until artwork images are present and decoded (or fallback-only cards).
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll("#equipment-grid .equipment-card")];
    if (cards.length < 8) return false;
    const imgs = [...document.querySelectorAll("#equipment-grid .equipment-art img")];
    if (!imgs.length) return true;
    return imgs.every((img) => img.complete && img.naturalWidth > 0);
  }, { timeout: 20000 });
  // Settle layout after decode.
  await sleep(200);
}

async function capture() {
  const { child, url } = await ensureServer(preferredUrl);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#deploy-open", { timeout: 15000 });
    await page.click("#deploy-open");
    await waitForArt(page);

    // Prefer shell screenshot so the full library chrome is in frame.
    const shell = page.locator(".equipment-shell");
    await mkdir(dirname(outPath), { recursive: true });
    await shell.screenshot({ path: outPath, type: "png" });

    // Metrics for CI/self-check assertions.
    const metrics = await page.evaluate(() => {
      const grid = document.querySelector("#equipment-grid");
      const cards = [...document.querySelectorAll("#equipment-grid .equipment-card")];
      const imgs = [...document.querySelectorAll("#equipment-grid .equipment-art img")];
      const fallbacks = [...document.querySelectorAll("#equipment-grid .art-fallback")];
      const style = grid ? getComputedStyle(grid) : null;
      const first = cards[0]?.getBoundingClientRect();
      const second = cards[1]?.getBoundingClientRect();
      const sameRow = first && second
        ? Math.abs(first.top - second.top) < 4
        : false;
      // Count cards on the first row.
      let cols = 0;
      if (first) {
        cols = cards.filter((c) => Math.abs(c.getBoundingClientRect().top - first.top) < 4).length;
      }
      return {
        cardCount: cards.length,
        imageCount: imgs.length,
        loadedImages: imgs.filter((img) => img.complete && img.naturalWidth > 0).length,
        fallbackCount: fallbacks.length,
        gridColumns: style?.gridTemplateColumns || "",
        firstRowCount: cols,
        sameRow,
        artWithFallbackUnderImg: imgs.filter((img) => {
          const art = img.closest(".equipment-art");
          return art?.querySelector(".art-fallback");
        }).length
      };
    });

    const reportPath = outPath.replace(/\.png$/i, ".json");
    await writeFile(reportPath, JSON.stringify({ url, outPath, viewport, metrics }, null, 2));

    const problems = [];
    if (metrics.cardCount < 8) problems.push(`expected ≥8 cards, got ${metrics.cardCount}`);
    if (metrics.imageCount && metrics.loadedImages < metrics.imageCount) {
      problems.push(`only ${metrics.loadedImages}/${metrics.imageCount} images loaded`);
    }
    if (metrics.artWithFallbackUnderImg > 0) {
      problems.push(`${metrics.artWithFallbackUnderImg} cards still stack fallback under art`);
    }
    // At 1600×900 default, CSS targets 8 columns.
    if (viewport.width >= 1600 && metrics.firstRowCount !== 8) {
      problems.push(`expected 8 cards on first row at ${viewport.width}px, got ${metrics.firstRowCount}`);
    }

    console.log(JSON.stringify({ ok: problems.length === 0, outPath, reportPath, metrics, problems }, null, 2));
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

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
