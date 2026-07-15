import test from "node:test";
import assert from "node:assert/strict";
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

  assert.equal((await fetch(`${base}/src/app.js`)).status, 200);
  assert.equal((await fetch(`${base}/.git/HEAD`)).status, 403);
  assert.equal((await fetch(`${base}/scenario/list`)).status, 403);
  assert.equal((await fetch(`${base}/debug/save`, { method: "POST", body: "{}" })).status, 403);
});
