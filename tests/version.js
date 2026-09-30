import assert from "node:assert/strict";
import fs from "node:fs";
import { PlotterEngine, VERSION } from "../vanilla.penplotter.js";

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const packageData = JSON.parse(read("package.json"));

// Adapters read PlotterEngine.version to refuse a core that is too old, so
// every place that states the version has to agree.
assert.equal(VERSION, packageData.version);
assert.equal(PlotterEngine.version, packageData.version);
assert.equal(JSON.parse(read("docs/vanilla.penplotter.manifest.json")).version, packageData.version);
assert.ok(read("README.md").includes(`**${packageData.version}**`), "README states the current version");
assert.ok(read("index.html").includes(`v${packageData.version}`), "landing page shows the current version");
for (const page of ["docs/guide.html", "docs/examples.html", "docs/possibilities.html", "docs/about.html"]) {
  assert.ok(read(page).includes(`v${packageData.version}`), `${page} shows the current version`);
}
assert.match(read("README.md"), /<!-- vereisten:start -->[\s\S]+<!-- vereisten:end -->/, "README carries the shared vereisten block");

console.log("vanilla.penplotter version: ok");
