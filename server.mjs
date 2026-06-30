import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4172);

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
    if (url.pathname === "/debug/save" && req.method === "POST") {
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
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
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
