import { createServer } from "node:http";
import { readFile, writeFile, mkdir, readdir, unlink, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4172);
const scenarioDir = resolve(root, "saves", "scenarios");
const hosted = Boolean(process.env.RAILWAY_ENVIRONMENT);
const scenarioStoreEnabled = !hosted;

function isPublicAsset(rel) {
  return rel === "index.html" || rel.startsWith("src/");
}

// Fixed on-disk save location: strips anything but word chars/space/dash so the
// name can't escape saves/scenarios/ via "../" or an absolute path.
function safeScenarioName(name) {
  const cleaned = String(name || "").replace(/[^\w \-]/g, "").trim();
  return (cleaned || "Untitled").slice(0, 80);
}

async function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    // Debug-log sink: the browser app POSTs its per-run performance + tactical
    // logs here so they are written to debug/ (overwritten every run), the same
    // files the headless runner produces. Local-only convenience; ignored if the
    // payload is malformed.
    if (scenarioStoreEnabled && url.pathname === "/debug/save" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
        if (chunks.reduce((n, c) => n + c.length, 0) > 8 * 1024 * 1024) break; // 8MB cap
      }
      try {
        const { perf, sim: simLog } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const dir = resolve(root, "debug");
        await mkdir(dir, { recursive: true });
        if (typeof perf === "string") await writeFile(resolve(dir, "perf-debug.log"), perf, "utf8");
        if (typeof simLog === "string") await writeFile(resolve(dir, "sim-debug.log"), simLog, "utf8");
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("saved");
      } catch {
        res.writeHead(400);
        res.end("bad debug payload");
      }
      return;
    }
    if (scenarioStoreEnabled && url.pathname === "/scenario/save" && req.method === "POST") {
      try {
        const { name, data, force } = await readJsonBody(req);
        const filename = `${safeScenarioName(name)}.json`;
        const file = resolve(scenarioDir, filename);
        await mkdir(scenarioDir, { recursive: true });
        let exists = false;
        try { await stat(file); exists = true; } catch {}
        if (exists && !force) {
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: false, reason: "exists", name: filename.replace(/\.json$/, "") }));
          return;
        }
        await writeFile(file, JSON.stringify(data, null, 2), "utf8");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, name: filename.replace(/\.json$/, "") }));
      } catch {
        res.writeHead(400);
        res.end("bad scenario payload");
      }
      return;
    }
    if (scenarioStoreEnabled && url.pathname === "/scenario/list" && req.method === "GET") {
      try {
        await mkdir(scenarioDir, { recursive: true });
        const files = (await readdir(scenarioDir)).filter((f) => f.endsWith(".json"));
        const entries = await Promise.all(files.map(async (f) => {
          const info = await stat(resolve(scenarioDir, f));
          return { name: f.replace(/\.json$/, ""), savedAt: info.mtimeMs };
        }));
        entries.sort((a, b) => b.savedAt - a.savedAt);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(entries));
      } catch {
        res.writeHead(500);
        res.end("could not list scenarios");
      }
      return;
    }
    if (scenarioStoreEnabled && url.pathname === "/scenario/load" && req.method === "GET") {
      const filename = `${safeScenarioName(url.searchParams.get("name"))}.json`;
      const file = resolve(scenarioDir, filename);
      if (!file.startsWith(`${scenarioDir}${sep}`)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      try {
        const body = await readFile(file, "utf8");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("scenario not found");
      }
      return;
    }
    if (scenarioStoreEnabled && url.pathname === "/scenario/delete" && req.method === "DELETE") {
      const filename = `${safeScenarioName(url.searchParams.get("name"))}.json`;
      const file = resolve(scenarioDir, filename);
      if (!file.startsWith(`${scenarioDir}${sep}`)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      try {
        await unlink(file);
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("deleted");
      } catch {
        res.writeHead(404);
        res.end("scenario not found");
      }
      return;
    }
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!isPublicAsset(rel)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const file = resolve(root, rel);
    if (!file.startsWith(`${root}${sep}`)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const body = await readFile(file);
    // No build step: source files are served as-is and change between runs.
    // Force revalidation so browsers never run a stale cached ES module (which
    // otherwise makes code fixes appear to "not take effect" until a hard reload).
    res.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, host, () => {
  const localUrl = `http://127.0.0.1:${port}`;
  const bindLabel = host === "0.0.0.0" ? `${host}:${port}` : localUrl;
  const localHint = host === "0.0.0.0" ? ` (local access: ${localUrl})` : "";
  console.log(`TomaHawk running on ${bindLabel}${localHint}`);
});
