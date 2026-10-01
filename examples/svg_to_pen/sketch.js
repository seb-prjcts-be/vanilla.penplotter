// SVG to pen: the road p5.plotSvg stops at, continued without vpype or
// Inkscape. Import → fit to a width → optimize → plan → the pen panel.
import { PlotterEngine, Geometry, documentBounds } from "../../vanilla.penplotter.js";
import { mountPen } from "../pen.js";

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

// An empty plot until something imports; the pen panel always has a plot to ask.
let plot = new PlotterEngine({ units: "mm", page: { width: 120, height: 90, margin: 0 } });
let pen = null;

function build() {
  for (const id of ["#imported", "#planned"]) $(id).textContent = "—";
  try {
    const imported = Geometry.importSVG($("#source").value, { curveSteps: 24, arcSteps: 48 });
    const bounds = documentBounds(imported);
    if (!bounds) throw new Error("No drawable geometry found in this SVG.");
    const importedPaths = imported.layers.reduce((sum, layer) => sum + layer.paths.length, 0);

    // Fit: scale the drawing to the requested width, corner at 0,0 of the sheet.
    const width = Number($("#fit").value);
    const scale = width / (bounds.maxX - bounds.minX);
    const height = (bounds.maxY - bounds.minY) * scale;
    const matrix = Geometry.Matrix.multiply(
      Geometry.Matrix.translate(-bounds.minX * scale, -bounds.minY * scale),
      Geometry.Matrix.scale(scale)
    );
    const fitted = Geometry.transformDocument(imported, matrix);

    plot = new PlotterEngine({ units: "mm", page: { width, height, margin: 0 } });
    for (const layer of fitted.layers) plot.layer(layer.id).paths = layer.paths;
    plot.optimize({ mergeTolerance: 0.05, duplicateTolerance: 0.01, simplifyTolerance: 0.03 });
    const plan = plot.plan();

    $("#imported").textContent = `${importedPaths} paths`;
    $("#planned").textContent = `${plan.stats.paths} paths · ${plan.stats.points} points`;
    $("#status").textContent = `Fitted ${(bounds.maxX - bounds.minX).toFixed(0)} × ${(bounds.maxY - bounds.minY).toFixed(0)} source units onto ${width} × ${height.toFixed(0)} mm.`;
    plot.drawRoute(context, { showTravel: true, padding: 30, paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)" });
  } catch (error) {
    context.clearRect(0, 0, context.canvas.width, context.canvas.height);
    plot = new PlotterEngine({ units: "mm", page: { width: 120, height: 90, margin: 0 } });
    $("#status").textContent = `Could not use this SVG: ${error.message}`;
  }
  if (pen) pen.refresh();
}

$("#source").value = SAMPLE;
$("#fit").addEventListener("input", build);
$("#source").addEventListener("input", build);
$("#file").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  $("#source").value = await file.text();
  build();
});

build();
pen = mountPen($("#pen"), { getPlot: () => plot, name: "from-svg", offset: { x: 80, y: 110 } });
