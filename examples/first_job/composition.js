// First job — hatch, contour and a circle: the smallest complete job.
import { PlotterEngine } from "../../vanilla.penplotter.js";

export function buildFirstJob() {
  const plot = new PlotterEngine({
    units: "mm",
    page: { width: 210, height: 297, margin: 12 }
  });

  const polygon = [
    { x: 30, y: 42 },
    { x: 174, y: 31 },
    { x: 187, y: 224 },
    { x: 62, y: 258 },
    { x: 24, y: 172 }
  ];

  plot.hatch(polygon, {
    spacing: 4.5,
    angle: Math.PI / 7
  });
  plot.polygon(polygon);
  plot.circle(108, 145, 38, { segments: 120 });

  plot.optimize({
    mergeTolerance: 0.05,
    duplicateTolerance: 0.01,
    simplifyTolerance: 0.03
  });
  plot.plan({
    drawSpeed: 35,
    travelSpeed: 80,
    liftDelay: 0.15
  });
  return plot;
}
