import { PlotterEngine } from "../../vanilla.penplotter.js";
import { mountPen } from "../pen.js";

const $ = (selector) => document.querySelector(selector);

// A 40 x 25 mm frame with two periods of a sine inside, drawn at the sheet's
// corner. Where the sheet lies on the bed is the pen panel's business.
const plot = new PlotterEngine({ units: "mm", page: { width: 40, height: 25, margin: 0 } });
plot.polygon([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }]);
const wave = [];
for (let x = 3; x <= 37; x += 0.5) {
  wave.push({ x, y: 12.5 + Math.sin(((x - 3) / 34) * Math.PI * 4) * 8 });
}
plot.polyline(wave);
const plan = plot.plan({ strategy: "input" });

plot.drawPreview($("#preview").getContext("2d"), { showTravel: true, padding: 40, paper: "#ffffff", travelColor: "rgba(0, 0, 0, .35)" });
$("#paths").textContent = String(plan.stats.paths);
$("#draw").textContent = `${plan.stats.drawDistance.toFixed(0)} mm`;

mountPen($("#pen"), { getPlot: () => plot, name: "direct-plot", offset: { x: 80, y: 110 } });
