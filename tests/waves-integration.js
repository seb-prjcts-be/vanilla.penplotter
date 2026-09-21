import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWaveDrawing } from "../examples/waves_svg/drawing.js";

// Supply a local copy of the pinned waves-core.js used by the browser example.
// This opt-in integration check keeps npm test independent of the network.
assert.ok(process.argv[2], "Usage: node tests/waves-integration.js <waves-core.js> [output.svg]");
await import(pathToFileURL(path.resolve(process.argv[2])).href);
const plot = createWaveDrawing(globalThis.VanillaWaves);
const plan = JSON.parse(plot.exportJSON());
const svg = plot.exportSVG();
assert.equal(plan.stats.paths, 32);
assert.match(svg, /width="210mm" height="297mm"/);
assert.equal((svg.match(/data-path=/g) || []).length, 32);
assert.doesNotMatch(svg, /NaN|Infinity/);
for (const route of plan.routes) {
  for (const point of route.path.points) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    assert.ok(point.x >= 18 && point.x <= 192);
    assert.ok(point.y >= 18 && point.y <= 279);
  }
}
assert.ok(plan.stats.drawDistance >= 32 * 174);
assert.equal(createWaveDrawing(globalThis.VanillaWaves).exportSVG(), svg);
if (process.argv[3]) fs.writeFileSync(process.argv[3], svg);
console.log("waves -> plotter -> SVG: ok", plan.stats);
