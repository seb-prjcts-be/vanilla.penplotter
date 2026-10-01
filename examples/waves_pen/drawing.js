import { PlotterEngine } from "../../vanilla.penplotter.js";

// A fixed-time drawing: animation time never changes during sampling.
export function createWaveDrawing(waves) {
  const plot = new PlotterEngine({
    units: "mm",
    page: { width: 210, height: 297, margin: 18 }
  });
  const sampler = waves.createSampler({
    wave: "triangle sine", range: [-3, 3], frequency: 0.08
  });
  for (let row = 0; row < 32; row += 1) {
    const points = [];
    for (let step = 0; step <= 348; step += 1) {
      const x = 18 + step * 0.5;
      points.push({ x, y: 40 + row * 7 + sampler.sample(x + row * 2, 0) });
    }
    plot.polyline(points, { id: `wave-${row + 1}` });
  }
  plot.optimize({ simplifyTolerance: 0.02 });
  plot.plan();
  return plot;
}
