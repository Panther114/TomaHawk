import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealthy(url) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if ((await fetch(`${url}/health`)).ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server did not become healthy");
}

test("hosted server exposes only application assets and disables shared scenario storage", async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(port), RAILWAY_ENVIRONMENT: "test" },
    stdio: "ignore"
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  await waitForHealthy(base);

  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/sandbox`)).status, 200);
  assert.equal((await fetch(`${base}/guide`)).status, 200);
  assert.equal((await fetch(`${base}/src/app.js`)).status, 200);
  const head = await fetch(`${base}/src/ui/data/east-china-sea-data.js`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers.get("content-length")) > 2_000_000);
  assert.equal((await head.text()).length, 0);
  assert.equal((await fetch(`${base}/.git/HEAD`)).status, 403);
  assert.equal((await fetch(`${base}/scenario/list`)).status, 403);
  assert.equal((await fetch(`${base}/debug/save`, { method: "POST", body: "{}" })).status, 403);
});

test("production entrypoint caps heap and static assets are streamed", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(packageJson.scripts.start, /--max-old-space-size=64/);
  assert.match(serverSource, /pipeline\(createReadStream\(file\), res\)/);
  assert.doesNotMatch(serverSource, /const body = await readFile\(file\)/);
});

test("same-name scenario creation is atomic and larger saves round trip", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "tomahawk-server-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], {
    cwd,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), RAILWAY_ENVIRONMENT: "" },
    stdio: "ignore"
  });
  const exited = once(child, "exit");
  t.after(async () => {
    child.kill();
    await exited;
    await rm(cwd, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + port;
  await waitForHealthy(base);
  const save = (name, data, force = false) => fetch(base + "/scenario/save", {
    method: "POST", body: JSON.stringify({ name, data, force })
  });
  const responses = await Promise.all(Array.from({ length: 20 }, async (_, client) => {
    const response = await save("same-name", { version: 2, ships: [], client });
    return { client, ...await response.json() };
  }));
  const winners = responses.filter(result => result.ok);
  assert.equal(winners.length, 1);
  assert.ok(responses.filter(result => !result.ok).every(result => result.reason === "exists"));
  const stored = await (await fetch(base + "/scenario/load?name=same-name")).json();
  assert.equal(stored.client, winners[0].client);
  const data = { version: 2, ships: [], fixture: "x".repeat(9 * 1024 * 1024) };
  assert.equal((await save("same-name", data, true)).status, 200);
  assert.equal((await (await fetch(base + "/scenario/load?name=same-name")).json()).fixture.length, data.fixture.length);
  assert.equal((await save("invalid", {})).status, 400);
});
