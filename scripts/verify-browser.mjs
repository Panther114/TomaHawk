import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { clearSide, createScenario, placeShip, SCENARIO_MODE, serializeScenario, SIDE } from "../src/sim.js";

const root = new URL(process.env.TOMAHAWK_TEST_URL ?? "http://127.0.0.1:4202/");
const edge = process.argv.includes("--edge");
const browser = await chromium.launch({ channel: edge ? "msedge" : "chromium" });
const consoleErrors = [];

function runningBattle(unitCount = 2) {
  const sim = createScenario(7, "openSea");
  if (unitCount > 2) {
    for (const side of Object.values(SIDE)) {
      clearSide(sim, side);
      for (let i = 0; i < unitCount / 2; i++) {
        const unit = placeShip(sim, side, (side === SIDE.BLUE ? -1 : 1) * (3000 + i * 30), i * 30);
        unit.loadout = {};
      }
    }
  }
  sim.mode = SCENARIO_MODE.RUNNING;
  sim.paused = false;
  return serializeScenario(sim);
}

const jsonFile = (data, name = "scenario.json") =>
  ({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) });

async function downloadJson(page, selector) {
  const result = page.waitForEvent("download");
  await page.locator(selector).click();
  const download = await result;
  const buffer = await readFile(await download.path());
  return { data: JSON.parse(buffer), buffer, name: download.suggestedFilename() };
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(6000);
  page.on("pageerror", error => consoleErrors.push(error.message));
  const click = selector => page.locator(selector).click();
  const visible = selector => page.locator(selector).waitFor({ state: "visible" });
  const hidden = selector => page.locator(selector).waitFor({ state: "hidden" });
  const importFile = async file => {
    await click("#load");
    await page.locator("#load-file").setInputFiles(file);
  };
  await page.goto(root.href);
  assert.match(await page.title(), /Tomahawk/);
  await click("[data-enter-simulation]");
  await page.waitForURL(new URL("sandbox.html", root).href);
  await visible("#map");
  await click("#deploy-open");
  await page.locator("#equipment-search").fill("F-22");
  assert.equal(await page.locator(".equipment-card").count(), 1);
  await page.keyboard.press("Escape");
  await hidden("#equipment-overlay");
  await click("#deploy-open");
  await page.locator("#equipment-search").fill("F-22");
  await page.locator(".equipment-card [data-deploy-side=red]").press("Enter");
  await visible("#placement-chip.red");
  await page.mouse.click(775, 490);
  await page.waitForFunction(() => document.querySelector(".force-summary.red .summary-stat.units b").textContent === "1");
  await page.keyboard.press("Escape");
  await page.locator("#map").focus();
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => document.querySelector(".force-summary.red .summary-stat.units b").textContent === "0");
  await page.keyboard.press("Tab");
  assert.notEqual(await page.evaluate(() => document.activeElement.id), "map");
  await page.keyboard.press("Control+s");
  await visible("#save-overlay");
  await page.keyboard.press("Escape");
  await hidden("#save-overlay");

  await click("#mods-toggle");
  await click('[data-new="ammo"]');
  const name = page.locator('#mods-detail [data-field="name"]');
  await name.fill("QA-AMMO-ORIGINAL");
  await click('#mods-detail [data-action="save"]');
  await visible('[data-key="ammo:QA-AMMO-ORIGINAL"]');
  await name.fill("QA-AMMO-RENAMED");
  await click('#mods-detail [data-action="save"]');
  await page.waitForFunction(() => document.querySelector('[data-key="ammo:QA-AMMO-ORIGINAL"]').textContent.includes("QA-AMMO-RENAMED"));
  await page.reload();
  await click("#mods-toggle");
  const renamed = page.locator('[data-key="ammo:QA-AMMO-ORIGINAL"]');
  assert.match(await renamed.innerText(), /QA-AMMO-RENAMED/);
  assert.equal(await page.locator('[data-key="ammo:QA-AMMO-RENAMED"]').count(), 0);
  await click("#mods-close");

  const staticHosting = await page.locator("html").getAttribute("data-static-hosting") === "true";
  if (!staticHosting) {
    await page.route("**/scenario/save", route => route.fulfill({ status: 503 }));
    await page.evaluate(() => {
      window.showSaveFilePicker = async () => { throw new DOMException("Cancelled", "AbortError"); };
    });
    await click("#save");
    const response = page.waitForResponse("**/scenario/save");
    await click("#save-confirm");
    await response;
    await page.waitForTimeout(150);
    await visible("#save-overlay");
    assert.equal(await page.locator("#operation-status").textContent(), "");
    await click("#save-cancel");

    let requested;
    let release;
    const requestStarted = new Promise(resolve => { requested = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    await page.route("**/scenario/list", route => route.fulfill({ json: [{ name: "QA Save", savedAt: 1700000000000 }] }));
    await page.route("**/scenario/load?*", async route => {
      requested();
      await released;
      await route.fulfill({ json: runningBattle() }).catch(() => {});
    });
    await click("#load");
    await page.locator(".load-entry").press("Enter");
    await requestStarted;
    await click("#load-cancel");
    release();
    await page.waitForTimeout(250);
    assert.equal((await downloadJson(page, "#aar")).data.ships.length, 0);
  }

  await importFile(jsonFile(runningBattle()));
  await hidden("#load-overlay");
  await page.waitForFunction(() => document.querySelector("#clock").textContent !== "00:00");
  await click("#load");
  const before = await page.locator("#clock").textContent();
  await page.keyboard.press("Space");
  await page.waitForTimeout(550);
  assert.equal(await page.locator("#clock").textContent(), before);
  await click("#load-cancel");

  const invalid = runningBattle();
  invalid.missiles = [{
    id: "M-1", missileId: "QA-ABSENT", targetId: invalid.ships[1].id,
    side: SIDE.BLUE, x: 0, y: 0, heading: 0, speed: 300, alive: true
  }];
  await importFile(jsonFile(invalid));
  await visible(".notice-overlay");
  assert.match(await page.locator(".notice-overlay").innerText(), /QA-ABSENT/);
  await page.keyboard.press("Escape");
  await click("#load-cancel");

  if (process.argv.includes("--large-save")) {
    await importFile(jsonFile(runningBattle(200)));
    await hidden("#load-overlay");
    await page.waitForFunction(() => Number(document.querySelector("#clock").textContent.slice(-2)) >= 10);
    await page.evaluate(() => { window.showSaveFilePicker = undefined; });
    await click("#save");
    await page.locator('input[name="save-location"][value="custom"]').check();
    const exported = await downloadJson(page, "#save-confirm");
    assert.equal(exported.data.ships.length, 200);
    assert.ok(exported.buffer.length > 5 * 1024 * 1024);
    await importFile({ name: exported.name, mimeType: "application/json", buffer: exported.buffer });
    await hidden("#load-overlay");
    await hidden(".notice-overlay");
    console.log("200-unit save round trip:", exported.buffer.length, "bytes");
  }

  await page.goto(new URL("guide.html", root).href);
  await click("#start-tutorial");
  await page.frameLocator("#sandbox-frame").locator("#deploy-open").click();
  await page.waitForFunction(() => document.querySelector("#coach-title").textContent === "为蓝方选择装备");
  await page.setViewportSize({ width: 390, height: 844 });
  await visible("#stage-size-notice");
  await hidden("#coach");
  assert.deepEqual(consoleErrors, []);
  console.log(edge ? "Edge" : "Chrome", "browser regression checks passed at", root.href);
} finally {
  await browser.close();
}
