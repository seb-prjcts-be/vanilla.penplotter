// Live previews for docs/examples.html: one builder per example, each using
// the example's own composition module. Tests run them headless.
import { PlotterEngine, Geometry } from "../vanilla.penplotter.js";
import { EBB_PROFILES } from "../src/driver/ebb.js";
import { buildFirstJob } from "../examples/first_job/composition.js";
import { buildTwoPens } from "../examples/two_pens/composition.js";
import { buildRouteLab } from "../examples/route_lab/composition.js";
import { createWaveDrawing } from "../examples/waves_svg/drawing.js";
import { createWaveHatch } from "../examples/wave_hatch/drawing.js";

const profile = EBB_PROFILES["idraw-hse-a2"];

function directPlot() {
  const plot = new PlotterEngine({ units: "mm", page: { ...profile.travel } });
  const ox = 80;
  const oy = 110;
  plot.polygon([{ x: ox, y: oy }, { x: ox + 40, y: oy }, { x: ox + 40, y: oy + 25 }, { x: ox, y: oy + 25 }]);
  const wave = [];
  for (let x = ox + 3; x <= ox + 37; x += 0.5) {
    wave.push({ x, y: oy + 12.5 + Math.sin(((x - ox - 3) / 34) * Math.PI * 4) * 8 });
  }
  plot.polyline(wave);
  plot.plan({ strategy: "input" });
  return plot;
}

function svgToPen() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g transform="translate(20 20)">
    <rect x="0" y="0" width="360" height="260"/><path d="M 20 130 C 80 20, 140 240, 200 130 S 320 20, 340 130"/>
    <path d="M 20 150 Q 110 260 200 150 T 340 150"/><line x1="20" y1="240" x2="340" y2="240"/><circle cx="180" cy="130" r="48"/></g></svg>`;
  const imported = Geometry.importSVG(svg, { curveSteps: 24 });
  const scale = 120 / 400;
  const fitted = Geometry.transformDocument(imported, Geometry.Matrix.multiply(Geometry.Matrix.translate(80, 110), Geometry.Matrix.scale(scale)));
  const plot = new PlotterEngine({ units: "mm", page: { ...profile.travel } });
  for (const layer of fitted.layers) plot.layer(layer.id).paths = layer.paths;
  plot.plan();
  return plot;
}

export const builders = {
  first_job: () => buildFirstJob(),
  two_pens: () => buildTwoPens(),
  route_lab: () => {
    const plot = buildRouteLab();
    plot.optimize({ mergeTolerance: 0.05, duplicateTolerance: 0.01, simplifyTolerance: 0.05 });
    plot.plan({ strategy: "nearest" });
    return plot;
  },
  waves_svg: (waves = globalThis.VanillaWaves) => createWaveDrawing(waves),
  wave_hatch: (waves = globalThis.VanillaWaves) => createWaveHatch(waves),
  svg_to_pen: svgToPen,
  direct_plot: directPlot
};

