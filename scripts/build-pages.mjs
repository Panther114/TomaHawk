import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL(".pages/", root);
await mkdir(output, { recursive: true });
await cp(new URL("src/", root), new URL("src/", output), { recursive: true });
for (const name of ["index.html", "sandbox.html", "guide.html"]) {
  const html = await readFile(new URL(name, root), "utf8");
  await writeFile(new URL(name, output), html.replace("<html ", '<html data-static-hosting="true" '));
}
await writeFile(new URL(".nojekyll", output), "");
