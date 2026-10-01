// Wave hatch — a tonal field: 70 cells, each hatched at a spacing and angle
// that two vanilla.waves samplers decide. No image, no gradient: only lines.
import { PlotterEngine } from "../../vanilla.penplotter.js";

export function createWaveHatch(waves, options = {}) {
  const columns = options.columns ?? 7;
  const rows = options.rows ?? 10;
  const plot = new PlotterEngine({ units: "mm", page: { width: 210, height: 297, margin: 18 } });
  const tone = waves.createSampler({ wave: "triangle sine", range: [1.3, 6.5], frequency: 0.19 });
  const turn = waves.createSampler({ wave: "triangle sine", range: [0, Math.PI], frequency: 0.07 });
  const cell = 24;
  const left = (210 - columns * cell) / 2;
  const top = (297 - rows * cell) / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = left + column * cell;
      const y = top + row * cell;
      const square = [
        { x: x + 1, y: y + 1 },
        { x: x + cell - 1, y: y + 1 },
        { x: x + cell - 1, y: y + cell - 1 },
        { x: x + 1, y: y + cell - 1 }
      ];
      // Time never changes: one sample per cell, the sheet is a still.
      const spacing = tone.sample(column * 1.9 + row * 1.1, 0);
      const angle = turn.sample(column * 0.8 + row * 2.3, 0);
      plot.hatch(square, { spacing, angle, metadata: { row, column } });
    }
  }
  plot.optimize({ simplifyTolerance: 0.02 });
  plot.plan();
  return plot;
}
