import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageData = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const examplesRoot = path.join(root, "examples");
const examples = fs.readdirSync(examplesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const manifest = {
  version: packageData.version,
  generated: new Date().toISOString().slice(0, 10),
  schema: "vanilla.penplotter/document@1",
  plan_schema: "vanilla.penplotter/plan@1",
  stages: ["Geometry", "Optimizer", "Planner", "Renderer", "Driver"],
  exports: ["SVG", "HPGL", "G-code", "JSON"],
  examples,
  drivers: ["SimulationDriver", "WebSerialTextDriver", "EbbDriver"],
  tested_machines: ["idraw-hse-a2"],
  hardware_status: "one-tested-ebb-profile-otherwise-simulation-and-export"
};
fs.writeFileSync(
  path.join(root, "docs", "vanilla.penplotter.manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
console.log(`manifest ${manifest.version}: ${examples.length} examples`);
