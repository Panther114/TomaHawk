import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("compact UI text renders at 10px despite a 14px browser minimum", () => {
  assert.match(css, /\.console-heading\s*\{[^}]*font-size:\s*14px;/s);
  assert.match(css, /\.console-heading > span\s*\{[^}]*zoom:\s*0\.7142857143;/s);
  assert.match(css, /#event-log\s*\{[^}]*font:\s*14px\/1 var\(--font-mono\);/s);
  assert.match(css, /#event-log \.event-time,[\s\S]*?font-size:\s*14px;[\s\S]*?zoom:\s*0\.7142857143;/);
  assert.match(css, /\.ship-detail-card\s*\{[^}]*font:\s*400 14px\/1 var\(--font-ui\);/s);
  assert.match(css, /\.ship-detail-heading b\s*\{[^}]*font-size:\s*14px;[^}]*zoom:\s*0\.7142857143;/s);
  assert.match(css, /\.ship-detail-grid > span:not\(\.subsystem-meter\),[\s\S]*?font-size:\s*14px;[\s\S]*?zoom:\s*0\.7142857143;/);
});

test("all DOM font declarations meet Edge's 14px minimum before compact-text zoom", () => {
  const declarations = [...css.matchAll(/([^\n{}]+)\{[^}]*?font(?:-size)?\s*:[^;{}]*?(\d+(?:\.\d+)?)px/gms)]
    .map((match) => ({ selector: match[1].trim(), size: Number(match[2]) }));
  const inventorySizes = declarations.filter((entry) => entry.selector.includes(".inventory-"));
  const otherSizes = declarations.filter((entry) => !entry.selector.includes(".inventory-"));
  assert.ok(inventorySizes.length >= 2, "expected inventory headings/rows to use 12px source text");
  assert.ok(inventorySizes.every((entry) => entry.size === 12), `expected 12px inventory text, got ${inventorySizes.map((entry) => `${entry.selector}:${entry.size}`).join(", ")}`);
  assert.ok(otherSizes.every((entry) => entry.size >= 14), `found sub-14px declarations outside inventory: ${otherSizes.filter((entry) => entry.size < 14).map((entry) => `${entry.selector}:${entry.size}`).join(", ")}`);
});

test("ship detail meter is centered by symmetric outer grid columns", () => {
  assert.match(css, /\.ship-detail-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 24px minmax\(0, 1fr\);/s);
});
