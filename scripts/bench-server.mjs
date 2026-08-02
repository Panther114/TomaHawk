import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitForHealthy(base) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

function residentSetBytes(pid) {
  if (process.platform === "win32") {
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `(Get-Process -Id ${Number(pid)}).WorkingSet64`],
      { encoding: "utf8" }
    );
    return Number(output.trim());
  }
  if (process.platform === "linux") {
    const status = readFileSync(`/proc/${Number(pid)}/status`, "utf8");
    const kib = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1]);
    return kib * 1024;
  }
  return NaN;
}

const port = await freePort();
const child = spawn(process.execPath, ["--max-old-space-size=64", "server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    RAILWAY_ENVIRONMENT: "benchmark"
  },
  stdio: "ignore"
});

try {
  const base = `http://127.0.0.1:${port}`;
  await waitForHealthy(base);
  const response = await fetch(`${base}/src/ui/data/east-china-sea-data.js`);
  const assetBytes = (await response.arrayBuffer()).byteLength;
  const rssBytes = residentSetBytes(child.pid);
  console.log("Tomahawk static-server benchmark:");
  console.log(`  health: OK`);
  console.log(`  streamed asset: ${(assetBytes / 1024 / 1024).toFixed(2)} MiB`);
  console.log(`  resident memory: ${Number.isFinite(rssBytes) ? `${(rssBytes / 1024 / 1024).toFixed(1)} MiB` : "unavailable"}`);
  console.log(`  V8 heap ceiling: 64 MiB`);
} finally {
  child.kill();
}
