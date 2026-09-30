// SVG to pen: the road p5.plotSvg stops at, continued without vpype or
// Inkscape. Import → fit on the bed → optimize → plan → EBB driver.
import { PlotterEngine, Geometry, documentBounds } from "../../vanilla.penplotter.js";
import {
  EBB_PROFILES,
  EbbDriver,
  compileEbbPlan,
  createWebSerialTransport
} from "../../src/driver/ebb.js";

const profile = EBB_PROFILES["idraw-hse-a2"];
const $ = (selector) => document.querySelector(selector);
const context = $("#preview").getContext("2d");

// A small SVG in the shape p5.plotSvg writes: groups, paths, lines, a circle.
const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <g id="frame" transform="translate(20 20)">
    <rect x="0" y="0" width="360" height="260" fill="none" stroke="#000"/>
    <path d="M 20 130 C 80 20, 140 240, 200 130 S 320 20, 340 130" fill="none" stroke="#000"/>
    <path d="M 20 150 Q 110 260 200 150 T 340 150" fill="none" stroke="#000"/>
    <line x1="20" y1="240" x2="340" y2="240" stroke="#000"/>
    <circle cx="180" cy="130" r="48" fill="none" stroke="#000"/>
  </g>
</svg>`;

let plot = null;
let compiled = null;
let transport = null;
let driver = null;
let busy = false;

function status(message) { $("#status").textContent = message; }
function log(message) {
  status(message);
  const box = $("#log");
  box.textContent += `\n${message}`;
  box.scrollTop = box.scrollHeight;
}
function refreshButtons() {
  $("#plot").disabled = !transport || !compiled || busy;
  $("#connect").disabled = Boolean(transport) || busy;
  $("#stop").disabled = !busy;
  $("#download").disabled = !plot;
}

function build() {
  plot = null;
  compiled = null;
  for (const id of ["#imported", "#planned", "#travel", "#time"]) $(id).textContent = "—";
  try {
    const imported = Geometry.importSVG($("#source").value, { curveSteps: 24, arcSteps: 48 });
    const bounds = documentBounds(imported);
    if (!bounds) throw new Error("No drawable geometry found in this SVG.");
    const importedPaths = imported.layers.reduce((sum, layer) => sum + layer.paths.length, 0);

    // Fit: scale the drawing to the requested width, place it from the home corner.
    const scale = Number($("#fit").value) / (bounds.maxX - bounds.minX);
    const ox = Number($("#offset-x").value);
    const oy = Number($("#offset-y").value);
    const matrix = Geometry.Matrix.multiply(
      Geometry.Matrix.translate(ox - bounds.minX * scale, oy - bounds.minY * scale),
      Geometry.Matrix.scale(scale)
    );
    const fitted = Geometry.transformDocument(imported, matrix);

    plot = new PlotterEngine({ units: "mm", page: { ...profile.travel } });
    for (const layer of fitted.layers) plot.layer(layer.id).paths = layer.paths;
    plot.optimize({ mergeTolerance: 0.05, duplicateTolerance: 0.01, simplifyTolerance: 0.03 });
    const plan = plot.plan({ drawSpeed: profile.drawSpeed, travelSpeed: profile.travelSpeed });
    compiled = compileEbbPlan(plan, { profile });

    $("#imported").textContent = `${importedPaths} paths`;
    $("#planned").textContent = `${plan.stats.paths} paths · ${plan.stats.points} points`;
    $("#travel").textContent = `${compiled.stats.travelMm.toFixed(0)} mm`;
    $("#time").textContent = `${(compiled.stats.durationMs / 1000).toFixed(0)} s`;
    status(`Fitted ${(bounds.maxX - bounds.minX).toFixed(0)} × ${(bounds.maxY - bounds.minY).toFixed(0)} source units onto ${$("#fit").value} mm.`);
    plot.drawPreview(context, { showTravel: true, padding: 20, paper: "#fffdf6" });
  } catch (error) {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    status(`Not plottable: ${error.message}`);
  }
  refreshButtons();
}

async function connect() {
  status("Waiting for you to pick the plotter in the browser's list…");
  try {
    const granted = navigator.serial ? await navigator.serial.getPorts() : [];
    const candidate = createWebSerialTransport(granted[0] ?? null, { filters: [] });
    await candidate.open();
    transport = candidate;
    driver = new EbbDriver({ transport, profile });
    log(`Connected: ${await transport.send("V")}`);
  } catch (error) {
    log(/No port selected/i.test(error.message)
      ? "No plotter was chosen. If no list appeared at all, open this page in Chrome or Edge itself."
      : `Connect failed: ${error.message}`);
  }
  refreshButtons();
}

async function run() {
  const ok = window.confirm(
    "Plot now?\n\n" +
    "• The carriage is parked in the home corner (next to the board).\n" +
    "• Paper is in place and no magnet lies on the drawing or on the way to it.\n" +
    "• Hands are clear of the arm."
  );
  if (!ok) return;
  busy = true;
  refreshButtons();
  try {
    const result = await driver.run(compiled, {
      confirmed: true,
      onProgress: (index, total) => { if (index % 20 === 0 || index === total - 1) log(`${index + 1} / ${total}`); }
    });
    log(`Plot ${result.status}.`);
  } catch (error) {
    log(`Stopped safely: ${error.message}`);
  }
  busy = false;
  refreshButtons();
}

$("#source").value = SAMPLE;
for (const id of ["#fit", "#offset-x", "#offset-y"]) $(id).addEventListener("input", build);
$("#source").addEventListener("input", build);
$("#file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  $("#source").value = await file.text();
  build();
});
$("#download").addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([plot.exportSVG()], { type: "image/svg+xml" }));
  link.download = "planned.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$("#connect").addEventListener("click", connect);
$("#plot").addEventListener("click", run);
$("#stop").addEventListener("click", () => {
  if (driver) driver.abort();
  log("Stop requested: pen up, motors off.");
});
window.addEventListener("pagehide", () => { if (transport) transport.close(); });

build();
