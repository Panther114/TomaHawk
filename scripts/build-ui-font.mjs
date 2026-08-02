import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const sourceDir = resolve(process.argv[2] || join(root, "tmp/font/extracted/OTF/SimplifiedChinese"));
const outputDir = join(root, "src/fonts");
const textFile = join(root, "tmp/font/tomahawk-glyphs.txt");
const readableExtensions = new Set([".html", ".css", ".js", ".mjs", ".svg"]);

async function sourceFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(full));
    else if (readableExtensions.has(extname(entry.name))) files.push(full);
  }
  return files;
}

const pageFiles = [
  join(root, "index.html"),
  join(root, "sandbox.html"),
  join(root, "guide.html"),
  ...await sourceFiles(join(root, "src"))
];
const characters = new Set([...Array.from({ length: 95 }, (_, i) => String.fromCodePoint(32 + i)).join("")]);
for (const file of pageFiles) {
  for (const character of await readFile(file, "utf8")) {
    if (character.codePointAt(0) >= 0x20) characters.add(character);
  }
}
await mkdir(outputDir, { recursive: true });
await writeFile(textFile, [...characters].sort().join(""), "utf8");

for (const [weight, output] of [
  ["Regular", "SourceHanSansSC-Regular.subset.woff2"],
  ["Medium", "SourceHanSansSC-Medium.subset.woff2"],
  ["Bold", "SourceHanSansSC-Bold.subset.woff2"]
]) {
  const input = join(sourceDir, `SourceHanSansSC-${weight}.otf`);
  const result = spawnSync("pyftsubset", [
    input,
    `--text-file=${textFile}`,
    `--output-file=${join(outputDir, output)}`,
    "--flavor=woff2",
    "--layout-features=*",
    "--desubroutinize",
    "--no-hinting"
  ], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Built Tomahawk UI font subset with ${characters.size} code points.`);
