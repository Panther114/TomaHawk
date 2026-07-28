import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";

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
